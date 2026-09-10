// backend/lib/materialFiles.js
//
// Storage and text extraction for uploaded PDFs.
//
// A PDF used to be stored as ONE value in materials.file_data. Against the
// hosted Turso database every request travels as JSON with BLOBs base64-
// encoded, so a 24 MB PDF became a ~32 MB string plus several copies of it
// in memory on every upload or read - measured at ~200 MB extra for one
// round trip, which together with the analysis right after an upload pushed
// Render's 512 MB instance over its memory limit. PDFs are now stored as
// 1 MB pieces in material_file_chunks and read one piece per request.
// materials.file_data is still read for PDFs uploaded before this change.

const { PDFParse } = require('pdf-parse');
const { db } = require('./db');

const CHUNK_SIZE = 1024 * 1024;

// Readable characters (not counting whitespace or pdf-parse's page markers)
// a PDF needs per page, on average, for section detection to have anything
// to work with. Scanned pages or slides saved as pictures have almost none.
const MIN_TEXT_CHARS_PER_PAGE = 30;

// A PDF StudyGPS can't use; the message is written for the user.
class UnusablePdfError extends Error {}

async function saveMaterialFile(materialId, buffer) {
    for (let offset = 0, index = 0; offset < buffer.length; offset += CHUNK_SIZE, index++) {
        await db.prepare(`
            INSERT INTO material_file_chunks (material_id, chunk_index, data) VALUES (?, ?, ?)
        `).run(materialId, index, buffer.subarray(offset, offset + CHUNK_SIZE));
    }
}

async function deleteMaterialFile(materialId) {
    await db.prepare(`DELETE FROM material_file_chunks WHERE material_id = ?`).run(materialId);
}

// Calls onChunk(buffer) for each piece of the stored PDF, in order, fetching
// one piece per database request so only one piece is in memory at a time.
// Returns false if the material has no stored PDF at all.
async function forEachMaterialFileChunk(materialId, onChunk) {
    const { count } = await db.prepare(`
        SELECT COUNT(*) AS count FROM material_file_chunks WHERE material_id = ?
    `).get(materialId);

    if (Number(count) > 0) {
        for (let index = 0; index < Number(count); index++) {
            const row = await db.prepare(`
                SELECT data FROM material_file_chunks WHERE material_id = ? AND chunk_index = ?
            `).get(materialId, index);
            await onChunk(Buffer.from(row.data));
        }
        return true;
    }

    // Uploaded before PDFs were stored in pieces.
    const legacy = await db.prepare(`SELECT file_data FROM materials WHERE id = ?`).get(materialId);
    if (!legacy || !legacy.file_data) return false;
    await onChunk(Buffer.from(legacy.file_data));
    return true;
}

// The whole stored PDF as one Buffer (only analysis of an old upload needs
// this), or null if there's none.
async function loadMaterialFile(materialId) {
    const parts = [];
    const found = await forEachMaterialFileChunk(materialId, (chunk) => { parts.push(chunk); });
    return found ? Buffer.concat(parts) : null;
}

// Why a PDF's extracted text isn't enough to find sections in, or null if
// it's fine.
function unreadableReason(text, pageCount) {
    const readable = String(text || '')
        .replace(/--\s*\d+\s*of\s*\d+\s*--/g, '')
        .replace(/\s+/g, '')
        .length;
    if (readable >= MIN_TEXT_CHARS_PER_PAGE * Math.max(1, Number(pageCount) || 1)) return null;
    return "it has almost no readable text - its pages look like images or scans, so StudyGPS can't find its sections. " +
        'Upload a version with selectable text (for example, export the original slides to PDF), or run it through OCR first.';
}

// Reads a PDF's text once, straight from the uploaded bytes. Throws an
// UnusablePdfError when the PDF can't be used.
async function extractPdfText(buffer) {
    let parser;
    let result;
    try {
        // A copy: pdf.js may take ownership of the bytes it's given, and the
        // caller still needs the original to store.
        parser = new PDFParse({ data: new Uint8Array(buffer) });
        result = await parser.getText();
    } catch (err) {
        throw new UnusablePdfError("This PDF can't be uploaded: it couldn't be opened - it may be damaged or password-protected.");
    } finally {
        if (parser) {
            try { await parser.destroy(); } catch (_) { /* nothing left to free */ }
        }
    }

    const reason = unreadableReason(result.text, result.total);
    if (reason) throw new UnusablePdfError(`This PDF can't be uploaded: ${reason}`);
    return { text: result.text, pageCount: result.total };
}

module.exports = {
    saveMaterialFile,
    deleteMaterialFile,
    forEachMaterialFileChunk,
    loadMaterialFile,
    unreadableReason,
    extractPdfText,
    UnusablePdfError
};
