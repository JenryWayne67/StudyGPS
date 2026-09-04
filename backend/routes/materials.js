const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { PDFParse } = require('pdf-parse');
const Database = require('better-sqlite3');
const { execFileSync } = require('child_process');

const router = express.Router();

const dbPath = path.join(__dirname, '../../database/studygps.db');
const db = new Database(dbPath);

// ==========================================
// PDF UPLOAD CONFIGURATION
// ==========================================

const uploadDir = path.join(__dirname, '../../uploads');

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },

    filename: (req, file, cb) => {
        const safeName = file.originalname
            .replace(/[^a-zA-Z0-9.-]/g, '_');

        cb(null, Date.now() + '-' + safeName);
    }
});

const upload = multer({
    storage: storage,

    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed'));
        }
    },

    limits: {
        fileSize: 50 * 1024 * 1024
    }
});

// ==========================================
// GET /api/materials
// ==========================================

router.get('/', (req, res) => {
    try {
        const courseId = Number(req.query.course_id);

        let materials;

        if (courseId) {
            materials = db.prepare(`
                SELECT
                    id,
                    course_id,
                    filename,
                    file_path,
                    uploaded_at,
                    status,
                    page_count,
                    file_size
                FROM materials
                WHERE course_id = ?
                ORDER BY id DESC
            `).all(courseId);
        } else {
            materials = db.prepare(`
                SELECT
                    id,
                    course_id,
                    filename,
                    file_path,
                    uploaded_at,
                    status,
                    page_count,
                    file_size
                FROM materials
                ORDER BY id DESC
            `).all();
        }

        res.json({
            success: true,
            materials
        });

    } catch (error) {
        console.error('Get materials error:', error);

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});


// ==========================================
// POST /api/materials
// JSON material creation
// ==========================================

router.post('/', (req, res) => {
    try {
        const {
            course_id,
            filename,
            file_path,
            status,
            page_count,
            file_size
        } = req.body;

        const courseId = Number(course_id);

        if (!courseId) {
            return res.status(400).json({
                success: false,
                error: 'course_id is required'
            });
        }

        if (!filename || !filename.trim()) {
            return res.status(400).json({
                success: false,
                error: 'filename is required'
            });
        }

        const course = db.prepare(`
            SELECT id, name
            FROM courses
            WHERE id = ?
        `).get(courseId);

        if (!course) {
            return res.status(404).json({
                success: false,
                error: 'Course not found'
            });
        }

        const result = db.prepare(`
            INSERT INTO materials (
                course_id,
                filename,
                file_path,
                status,
                page_count,
                file_size
            )
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            courseId,
            filename.trim(),
            file_path || null,
            status || 'pending',
            page_count || null,
            file_size || null
        );

        const material = db.prepare(`
            SELECT
                id,
                course_id,
                filename,
                file_path,
                uploaded_at,
                status,
                page_count,
                file_size
            FROM materials
            WHERE id = ?
        `).get(result.lastInsertRowid);

        res.status(201).json({
            success: true,
            message: 'Material created successfully',
            material
        });

    } catch (error) {
        console.error('Create material error:', error);

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==========================================
// POST /api/materials/upload
// ACTUAL PDF UPLOAD
// ==========================================

router.post('/upload', upload.single('pdf'), (req, res) => {
    try {
        const courseId = Number(req.body.course_id);

        if (!courseId) {
            if (req.file) {
                fs.unlinkSync(req.file.path);
            }

            return res.status(400).json({
                success: false,
                error: 'course_id is required'
            });
        }

        const course = db.prepare(`
            SELECT id, name
            FROM courses
            WHERE id = ?
        `).get(courseId);

        if (!course) {
            if (req.file) {
                fs.unlinkSync(req.file.path);
            }

            return res.status(404).json({
                success: false,
                error: 'Course not found'
            });
        }

        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'PDF file is required'
            });
        }

        const result = db.prepare(`
            INSERT INTO materials (
                course_id,
                filename,
                file_path,
                status,
                page_count,
                file_size
            )
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            courseId,
            req.file.originalname,
            req.file.path,
            'uploaded',
            null,
            req.file.size
        );

        const material = db.prepare(`
            SELECT
                id,
                course_id,
                filename,
                file_path,
                uploaded_at,
                status,
                page_count,
                file_size
            FROM materials
            WHERE id = ?
        `).get(result.lastInsertRowid);

        res.status(201).json({
            success: true,
            message: 'PDF uploaded successfully',
            material
        });

    } catch (error) {
        console.error('PDF upload error:', error);

        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});



// ==========================================
// PDF -> pages -> sections -> tasks helpers
// ==========================================

// Split the full extracted text into per-page chunks using the
// "-- <page> of <total> --" markers pdf-parse inserts between pages.
// Content BEFORE a marker belongs to the page number named in that
// marker (verified against material 2: 54 markers for 54 pages).
function splitIntoPages(fullText) {
    const markerRe = /--\s*(\d+)\s*of\s*(\d+)\s*--/g;
    const pages = [];
    let lastIndex = 0;
    let match;

    while ((match = markerRe.exec(fullText)) !== null) {
        const pageNumber = Number(match[1]);
        const content = fullText.slice(lastIndex, match.index).trim();
        pages.push({ page_number: pageNumber, content });
        lastIndex = markerRe.lastIndex;
    }

    // No markers found at all (single-page PDF, or a PDF whose text
    // extraction doesn't emit them) - fall back to one page.
    if (pages.length === 0) {
        const content = fullText.trim();
        if (content) pages.push({ page_number: 1, content });
        return pages;
    }

    // Anything after the final marker (rare) gets folded into the last page
    const trailing = fullText.slice(lastIndex).trim();
    if (trailing) {
        pages[pages.length - 1].content += '\n' + trailing;
    }

    return pages;
}

// Detect logical sections from each page's heading/footer line.
// These slide decks repeat the current subsection label (e.g.
// "6.1 Class and Object") on most pages; a page missing that label
// (a chapter-overview / table-of-contents page) is folded into the
// section it introduces. Consecutive pages sharing a label become one
// section, so a section can span multiple pages.
function detectSections(pages) {
    const labelPattern = /^(\d+\.\d+)\s+([A-Z][^\n]{1,80})$/;

    const labeled = pages.map((p) => {
        const lines = p.content.split('\n').map((l) => l.trim()).filter(Boolean);
        const matches = lines
            .map((line) => line.match(labelPattern))
            .filter(Boolean)
            .map((m) => `${m[1]} ${m[2]}`);

        // A page naming exactly one subsection is confidently "on" that
        // subsection. A page naming several (a table-of-contents /
        // chapter-overview page listing 6.1, 6.2, 6.3...) isn't reliably
        // about any single one of them, so leave it unlabeled and let it
        // fold into whichever section follows it.
        const label = matches.length === 1 ? matches[0] : null;
        return { page_number: p.page_number, label };
    });

    // Backward-fill: a label-less page belongs to the section
    // introduced by the next labeled page.
    let nextLabel = null;
    for (let i = labeled.length - 1; i >= 0; i--) {
        if (labeled[i].label) nextLabel = labeled[i].label;
        else labeled[i].label = nextLabel;
    }
    // Forward-fill any still-unlabeled trailing pages (edge case: no
    // labeled page exists at all after them).
    let prevLabel = null;
    for (let i = 0; i < labeled.length; i++) {
        if (labeled[i].label) prevLabel = labeled[i].label;
        else labeled[i].label = prevLabel || 'Untitled Section';
    }

    const sections = [];
    for (const { page_number, label } of labeled) {
        const last = sections[sections.length - 1];
        if (last && last.title === label) {
            last.end_page = page_number;
        } else {
            sections.push({ title: label, start_page: page_number, end_page: page_number });
        }
    }

    return sections.map((s) => {
        const pageCount = s.end_page - s.start_page + 1;
        return {
            ...s,
            estimated_minutes: Math.max(5, pageCount * 3),
            difficulty: 1
        };
    });
}

// Run cpp_engine/sectionTaskManager.exe: pipe sections in (pipe-delimited,
// one per line), get tasks out (key=value, one per line) - same CLI
// contract studyTracker.cpp already uses for the Node <-> C++ boundary.
function runSectionTaskManager(sectionRows) {
    const exePath = path.join(__dirname, '../../cpp_engine/sectionTaskManager.exe');

    const input = sectionRows
        .map((s) => [s.id, s.title, s.start_page, s.end_page, s.estimated_minutes, s.difficulty].join('|'))
        .join('\n') + '\n';

    const stdout = execFileSync(exePath, [], { input, encoding: 'utf8' });

    const tasks = [];
    const lineRe = /section_id=(\d+)\s+priority=(\d+)\s+status=(.+)$/;
    for (const line of stdout.split('\n')) {
        const m = line.match(lineRe);
        if (m) {
            tasks.push({
                section_id: Number(m[1]),
                priority: Number(m[2]),
                status: m[3].trim()
            });
        }
    }
    return tasks;
}

// ==========================================
// POST /api/materials/:id/process
// PDF -> pages -> sections -> tasks (idempotent: safe to re-run)
// ==========================================

router.post('/:id/process', async (req, res) => {
    let parser;

    try {
        const materialId = Number(req.params.id);

        if (!materialId) {
            return res.status(400).json({
                success: false,
                error: 'Invalid material ID'
            });
        }

        const material = db.prepare(`
            SELECT
                id,
                course_id,
                filename,
                file_path,
                status
            FROM materials
            WHERE id = ?
        `).get(materialId);

        if (!material) {
            return res.status(404).json({
                success: false,
                error: 'Material not found'
            });
        }

        if (!material.file_path || !fs.existsSync(material.file_path)) {
            return res.status(404).json({
                success: false,
                error: 'PDF file not found on server'
            });
        }

        // Read the PDF file
        const dataBuffer = fs.readFileSync(material.file_path);

        // Create PDF parser
        parser = new PDFParse({
            data: dataBuffer
        });

        // Extract text
        const result = await parser.getText();

        const pageCount = result.total;
        const pages = splitIntoPages(result.text);
        const detectedSections = detectSections(pages);

        // Everything below is one atomic, idempotent unit: reprocessing
        // the same material clears only ITS OWN pages/sections/tasks
        // (never other materials' data) before rebuilding them.
        const applyProcessing = db.transaction(() => {
            // 1. material_pages (replace this material's pages only)
            db.prepare(`DELETE FROM material_pages WHERE material_id = ?`).run(materialId);

            const insertPage = db.prepare(`
                INSERT INTO material_pages (material_id, page_number, content)
                VALUES (?, ?, ?)
            `);
            for (const p of pages) {
                insertPage.run(materialId, p.page_number, p.content);
            }

            // 2. sections (replace this material's sections + their tasks only)
            const oldSectionIds = db.prepare(`
                SELECT id FROM sections WHERE material_id = ?
            `).all(materialId).map((r) => r.id);

            if (oldSectionIds.length > 0) {
                const placeholders = oldSectionIds.map(() => '?').join(',');
                db.prepare(`DELETE FROM tasks WHERE section_id IN (${placeholders})`).run(...oldSectionIds);
                db.prepare(`DELETE FROM sections WHERE id IN (${placeholders})`).run(...oldSectionIds);
            }

            const insertSection = db.prepare(`
                INSERT INTO sections
                    (course_id, material_id, title, start_page, end_page, estimated_minutes, difficulty)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);

            const insertedSections = detectedSections.map((s) => {
                const info = insertSection.run(
                    material.course_id,
                    materialId,
                    s.title,
                    s.start_page,
                    s.end_page,
                    s.estimated_minutes,
                    s.difficulty
                );
                return { id: info.lastInsertRowid, ...s };
            });

            // 3. tasks, produced by the C++ section/task engine
            let insertedTasks = [];
            if (insertedSections.length > 0) {
                const tasksFromCpp = runSectionTaskManager(insertedSections);

                const insertTask = db.prepare(`
                    INSERT INTO tasks (section_id, priority, deadline, status)
                    VALUES (?, ?, NULL, ?)
                `);

                insertedTasks = tasksFromCpp.map((t) => {
                    const info = insertTask.run(t.section_id, t.priority, t.status);
                    return { id: info.lastInsertRowid, ...t };
                });
            }

            // 4. materials status/page_count
            db.prepare(`
                UPDATE materials
                SET page_count = ?,
                    status = ?
                WHERE id = ?
            `).run(pageCount, 'processed', materialId);

            return { insertedSections, insertedTasks };
        });

        const { insertedSections, insertedTasks } = applyProcessing();

        res.json({
            success: true,
            message: 'PDF processed successfully',
            material_id: materialId,
            filename: material.filename,
            page_count: pageCount,
            pages_stored: pages.length,
            sections: insertedSections,
            tasks: insertedTasks,
            text_preview: result.text.substring(0, 2000)
        });

    } catch (error) {
        console.error('PDF processing error:', error);

        res.status(500).json({
            success: false,
            error: error.message
        });

    } finally {
        if (parser) {
            await parser.destroy();
        }
    }
});

module.exports = router;