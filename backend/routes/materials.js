const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { PDFParse } = require('pdf-parse');
const { execFileSync } = require('child_process');
const { requireAuth } = require('../middleware/requireAuth');
const { db } = require('../lib/db');

const router = express.Router();

router.use(requireAuth);

// Shared ownership check: does this course belong to the logged-in user?
function courseBelongsToUser(courseId, userId) {
    return db.prepare(`SELECT id FROM courses WHERE id = ? AND user_id = ?`).get(courseId, userId);
}

// Shared ownership check: does this material's course belong to the
// logged-in user? Returns the material row (with course_id) if so.
function materialOwnedByUser(materialId, userId) {
    return db.prepare(`
        SELECT m.*
        FROM materials m
        JOIN courses c ON c.id = m.course_id
        WHERE m.id = ? AND c.user_id = ?
    `).get(materialId, userId);
}

// ==========================================
// PDF UPLOAD CONFIGURATION
//
// Uploaded PDFs are held in memory only long enough to be written into
// the `materials.file_data` column (see database/schema.sql) instead of
// a local uploads/ folder. A folder on disk doesn't survive Render's
// ephemeral filesystem (wiped on every restart/redeploy/sleep), and
// wouldn't survive at all once the app can run on more than one host -
// storing the bytes in the same database as everything else means a PDF
// persists exactly as reliably as the rest of a user's data, with
// nothing extra to configure.
// ==========================================

const upload = multer({
    storage: multer.memoryStorage(),

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

router.get('/', async (req, res) => {
    try {
        const courseId = Number(req.query.course_id);
        const userId = req.user.id;

        let materials;

        if (courseId) {
            if (!(await courseBelongsToUser(courseId, userId))) {
                return res.status(404).json({ success: false, error: 'Course not found' });
            }

            materials = await db.prepare(`
                SELECT
                    id,
                    course_id,
                    filename,
                    uploaded_at,
                    status,
                    page_count,
                    file_size
                FROM materials
                WHERE course_id = ?
                ORDER BY id DESC
            `).all(courseId);
        } else {
            materials = await db.prepare(`
                SELECT
                    m.id,
                    m.course_id,
                    m.filename,
                    m.uploaded_at,
                    m.status,
                    m.page_count,
                    m.file_size
                FROM materials m
                JOIN courses c ON c.id = m.course_id
                WHERE c.user_id = ?
                ORDER BY m.id DESC
            `).all(userId);
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

router.post('/', async (req, res) => {
    try {
        const {
            course_id,
            filename,
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

        const course = await courseBelongsToUser(courseId, req.user.id);

        if (!course) {
            return res.status(404).json({
                success: false,
                error: 'Course not found'
            });
        }

        const result = await db.prepare(`
            INSERT INTO materials (
                course_id,
                filename,
                status,
                page_count,
                file_size
            )
            VALUES (?, ?, ?, ?, ?)
        `).run(
            courseId,
            filename.trim(),
            status || 'pending',
            page_count || null,
            file_size || null
        );

        const material = await db.prepare(`
            SELECT
                id,
                course_id,
                filename,
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

router.post('/upload', upload.single('pdf'), async (req, res) => {
    try {
        const courseId = Number(req.body.course_id);

        if (!courseId) {
            return res.status(400).json({
                success: false,
                error: 'course_id is required'
            });
        }

        const course = await courseBelongsToUser(courseId, req.user.id);

        if (!course) {
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

        // req.file.buffer is the whole PDF's bytes, held in memory only for
        // this request (multer.memoryStorage() - see the upload config
        // above) - stored straight into the database as a BLOB rather than
        // a local file, so it survives restarts/redeploys the same way the
        // rest of the user's data does.
        const result = await db.prepare(`
            INSERT INTO materials (
                course_id,
                filename,
                file_data,
                status,
                page_count,
                file_size
            )
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            courseId,
            req.file.originalname,
            req.file.buffer,
            'uploaded',
            null,
            req.file.size
        );

        const material = await db.prepare(`
            SELECT
                id,
                course_id,
                filename,
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
//
// Not every PDF numbers its subsections that way - some have real
// section titles and page numbers but no "6.1"-style label at all
// (just "Propositions", "Truth Tables", etc. repeated on each page of
// that section). Without a fallback for that, none of those pages ever
// matched, every page fell back to one giant "Untitled Section" for the
// whole document, and processing effectively produced nothing useful.
// Two extra patterns are tried per line, in that order:
//   1. "Chapter 6: Title" / "Unit 3 - Title" / "Lecture 2 Title" -
//      still has a number, just not the "6.1" decimal shape.
//   2. Any other short (<=80 char) line starting with a capital letter,
//      but ONLY if that exact line repeats verbatim on 2+ pages of this
//      document - the same "same label reappears on most pages" signal
//      the numbered case relies on, just without requiring a number.
//      Requiring a repeat is what keeps this from grabbing random
//      one-off body text as a fake section boundary.
function detectSections(pages) {
    const numberedPattern = /^(\d+\.\d+)\s+([A-Z][^\n]{1,80})$/;
    const chapterPattern = /^((?:Chapter|Unit|Section|Lecture|Lesson)\s+\d+\s*[:.\-]?\s*[A-Z][^\n]{1,80})$/i;
    const looseHeadingPattern = /^[A-Z][^\n]{1,80}$/;

    // Count how many distinct pages each unnumbered heading-shaped line
    // appears on, so only genuinely repeating titles are trusted.
    const unnumberedPageCounts = new Map();
    for (const p of pages) {
        const lines = p.content.split('\n').map((l) => l.trim()).filter(Boolean);
        const seenOnThisPage = new Set();
        for (const line of lines) {
            if (numberedPattern.test(line) || chapterPattern.test(line)) continue;
            if (looseHeadingPattern.test(line) && !seenOnThisPage.has(line)) {
                seenOnThisPage.add(line);
                unnumberedPageCounts.set(line, (unnumberedPageCounts.get(line) || 0) + 1);
            }
        }
    }

    const labeled = pages.map((p) => {
        const lines = p.content.split('\n').map((l) => l.trim()).filter(Boolean);

        // Numbered/chapter matches are checked FIRST and, if any are
        // found, are the only thing that counts for this page - a slide
        // that says "6.1 Class and Object" often also has its own
        // unrelated subheading on it (e.g. "Getters and Setters"), and if
        // that subheading happens to repeat on another page too, it would
        // otherwise get counted as a second candidate and wrongly
        // disqualify a page that actually has a perfectly good numbered
        // label. The loose unnumbered fallback only gets a turn on pages
        // that have no numbered/chapter heading at all.
        const strongMatches = [];
        for (const line of lines) {
            const numbered = line.match(numberedPattern);
            if (numbered) { strongMatches.push(`${numbered[1]} ${numbered[2]}`); continue; }

            const chapter = line.match(chapterPattern);
            if (chapter) strongMatches.push(chapter[1]);
        }

        let matches = strongMatches;
        if (matches.length === 0) {
            matches = lines.filter((line) =>
                looseHeadingPattern.test(line) && (unnumberedPageCounts.get(line) || 0) >= 2
            );
        }

        // Dedupe first (the same heading can legitimately appear twice on
        // one page - e.g. once in a header, once repeated in a footer -
        // that's still only ONE subsection, not several).
        const uniqueMatches = [...new Set(matches)];

        // A page naming exactly one subsection is confidently "on" that
        // subsection. A page naming several (a table-of-contents /
        // chapter-overview page listing 6.1, 6.2, 6.3...) isn't reliably
        // about any single one of them, so leave it unlabeled and let it
        // fold into whichever section follows it.
        const label = uniqueMatches.length === 1 ? uniqueMatches[0] : null;
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
//
// Deliberately NOT called from inside a db.transaction() - execFileSync
// blocks on an external process, and better-sqlite3 transactions should
// stay short, DB-only operations. Throws on any failure (missing exe,
// non-zero exit, or output that doesn't match the expected shape at all)
// with a message that names exactly what went wrong, instead of quietly
// returning an empty task list - a caller that wants "sections saved even
// if task generation fails" should catch this explicitly, not rely on it
// failing silently.
function runSectionTaskManager(sectionRows) {
    const exePath = path.join(__dirname, '../../cpp_engine/sectionTaskManager.exe');

    if (!fs.existsSync(exePath)) {
        throw new Error(`sectionTaskManager.exe not found at ${exePath} - rebuild it with: g++ -std=c++17 -O2 -o cpp_engine/sectionTaskManager.exe cpp_engine/sectionTaskManager.cpp`);
    }

    const input = sectionRows
        .map((s) => [s.id, s.title, s.start_page, s.end_page, s.estimated_minutes, s.difficulty].join('|'))
        .join('\n') + '\n';

    let stdout;
    try {
        stdout = execFileSync(exePath, [], { input, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    } catch (err) {
        // err.stderr/err.stdout are populated by execFileSync on a
        // non-zero exit or spawn failure - surface all of it so a real
        // failure (missing DLL, crash, antivirus block, etc.) is visible
        // instead of looking like "0 tasks" for no reason.
        const details = [
            err.message,
            err.stderr ? `stderr: ${String(err.stderr).slice(0, 500)}` : null,
            err.stdout ? `stdout: ${String(err.stdout).slice(0, 500)}` : null
        ].filter(Boolean).join(' | ');
        throw new Error(`sectionTaskManager.exe failed to run: ${details}`);
    }

    const tasks = [];
    const lineRe = /section_id=(\d+)\s+priority=(\d+)\s+status=(.+)$/;
    for (const rawLine of stdout.split('\n')) {
        const line = rawLine.replace(/\r$/, ''); // tolerate Windows CRLF output
        const m = line.match(lineRe);
        if (m) {
            tasks.push({
                section_id: Number(m[1]),
                priority: Number(m[2]),
                status: m[3].trim()
            });
        }
    }

    if (tasks.length === 0 && sectionRows.length > 0) {
        // The exe ran (no throw above) but produced nothing we could
        // parse for a non-empty input - that's exactly the "silent
        // failure" this function exists to prevent, so treat it as an
        // error with the raw output attached for diagnosis.
        throw new Error(
            `sectionTaskManager.exe ran but produced 0 parseable task lines for ${sectionRows.length} section(s). ` +
            `Raw output (first 500 chars): ${JSON.stringify(stdout.slice(0, 500))}`
        );
    }

    return tasks;
}

// Insert tasks for a batch of already-persisted sections, in one small
// transaction. Separate from section/page insertion so a slow/failing
// C++ call never happens while a write transaction is open.
async function insertTasksForSections(insertedSections) {
    if (insertedSections.length === 0) return [];

    const tasksFromCpp = runSectionTaskManager(insertedSections);

    const applyInsert = db.transaction(async (tx, rows) => {
        const insertTask = tx.prepare(`
            INSERT INTO tasks (section_id, priority, deadline, status)
            VALUES (?, ?, NULL, ?)
        `);
        const out = [];
        for (const t of rows) {
            const info = await insertTask.run(t.section_id, t.priority, t.status);
            out.push({ id: info.lastInsertRowid, ...t });
        }
        return out;
    });

    return applyInsert(tasksFromCpp);
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

const material = await materialOwnedByUser(materialId, req.user.id);

        if (!material) {
            return res.status(404).json({
                success: false,
                error: 'Material not found'
            });
        }

        if (!material.file_data) {
            return res.status(404).json({
                success: false,
                error: 'PDF file not found on server'
            });
        }

        // material.file_data comes back from the database as an
        // ArrayBuffer (libsql's BLOB representation) - PDFParse and the
        // rest of Node's Buffer-based APIs need a real Buffer.
        const dataBuffer = Buffer.from(material.file_data);

        // Create PDF parser
        parser = new PDFParse({
            data: dataBuffer
        });

        // Extract text
        const result = await parser.getText();

        const pageCount = result.total;
        const pages = splitIntoPages(result.text);
        const detectedSections = detectSections(pages);

        // Step 1: pages + sections, in one atomic, idempotent unit -
        // reprocessing the same material clears only ITS OWN pages/
        // sections/tasks (never other materials' data) before rebuilding
        // them. Deliberately does NOT include the C++ task-generation
        // call - that runs an external process and must not happen while
        // a write transaction is open.
const applyPagesAndSections = db.transaction(async (tx) => {
            await tx.prepare(`DELETE FROM material_pages WHERE material_id = ?`).run(materialId);

            const insertPage = tx.prepare(`
                INSERT INTO material_pages (material_id, page_number, content)
                VALUES (?, ?, ?)
            `);
            for (const p of pages) {
                await insertPage.run(materialId, p.page_number, p.content);
            }

            const oldSectionIds = (await tx.prepare(`
                SELECT id FROM sections WHERE material_id = ?
            `).all(materialId)).map((r) => r.id);

            if (oldSectionIds.length > 0) {
                const sectionPlaceholders = oldSectionIds.map(() => '?').join(',');

                const oldTaskIds = (await tx.prepare(`
                    SELECT id FROM tasks WHERE section_id IN (${sectionPlaceholders})
                `).all(...oldSectionIds)).map((r) => r.id);

                // schedules.task_id and study_sessions.task_id have no
                // ON DELETE CASCADE (see database/schema.sql), and
                // foreign keys are enforced by default - so re-analyzing
                // (or re-uploading) a material that already has a
                // generated schedule block or a logged study session
                // against its old tasks used to fail outright with
                // "FOREIGN KEY constraint failed" the moment it tried to
                // delete those old tasks out from under them. Those rows
                // describe tasks that are about to stop existing, so
                // they have to go too - reprocessing a material is meant
                // to replace its old sections/tasks wholesale, and a
                // schedule row pointing at a deleted task isn't
                // something to keep around. Re-run "Regenerate Week" on
                // the Schedule page afterward to reschedule the freshly
                // generated tasks.
                if (oldTaskIds.length > 0) {
                    const taskPlaceholders = oldTaskIds.map(() => '?').join(',');
                    await tx.prepare(`DELETE FROM schedules WHERE task_id IN (${taskPlaceholders})`).run(...oldTaskIds);
                    await tx.prepare(`DELETE FROM study_sessions WHERE task_id IN (${taskPlaceholders})`).run(...oldTaskIds);
                }

                await tx.prepare(`DELETE FROM tasks WHERE section_id IN (${sectionPlaceholders})`).run(...oldSectionIds);
                await tx.prepare(`DELETE FROM sections WHERE id IN (${sectionPlaceholders})`).run(...oldSectionIds);
            }

            const insertSection = tx.prepare(`
                INSERT INTO sections
                    (course_id, material_id, title, start_page, end_page, estimated_minutes, difficulty)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);

            const out = [];
            for (const s of detectedSections) {
                const info = await insertSection.run(
                    material.course_id,
                    materialId,
                    s.title,
                    s.start_page,
                    s.end_page,
                    s.estimated_minutes,
                    s.difficulty
                );
                out.push({ id: info.lastInsertRowid, ...s });
            }
            return out;
        });

        const insertedSections = await applyPagesAndSections();

        // Step 2: tasks, produced by the C++ section/task engine - kept
        // separate so a failure here (missing/broken exe) still leaves
        // the pages/sections just saved above intact, and is reported
        // back clearly instead of looking like "0 tasks, all good".
        let insertedTasks = [];
        let taskGenerationError = null;
        try {
            insertedTasks = await insertTasksForSections(insertedSections);
        } catch (err) {
            console.error(`Task generation failed for material ${materialId}:`, err.message);
            taskGenerationError = err.message;
        }

        // Step 3: mark the material processed regardless of task-generation
        // outcome - the sections/pages are real and saved; tasks can be
        // retried via POST /:id/regenerate-tasks without reprocessing the PDF.
        await db.prepare(`
            UPDATE materials
            SET page_count = ?, status = ?
            WHERE id = ?
        `).run(pageCount, 'processed', materialId);

        res.json({
            success: true,
            message: taskGenerationError
                ? 'PDF processed, but task generation failed - see task_generation_error'
                : 'PDF processed successfully',
            material_id: materialId,
            filename: material.filename,
            page_count: pageCount,
            pages_stored: pages.length,
            sections: insertedSections,
            tasks: insertedTasks,
            task_generation_error: taskGenerationError,
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

// ==========================================
// POST /api/materials/:id/regenerate-tasks
// Re-run the C++ task-generation step for a material's EXISTING sections,
// without reparsing the PDF. Use this to retry after a task_generation_error
// from /process, or to pick up a rebuilt sectionTaskManager.exe.
// ==========================================

router.post('/:id/regenerate-tasks', async (req, res) => {
    try {
        const materialId = Number(req.params.id);
        const material = await materialOwnedByUser(materialId, req.user.id);

        if (!material) {
            return res.status(404).json({ success: false, error: 'Material not found' });
        }

        const sections = await db.prepare(`
            SELECT id, title, start_page, end_page, estimated_minutes, difficulty
            FROM sections WHERE material_id = ?
        `).all(materialId);

        if (sections.length === 0) {
            return res.status(400).json({ success: false, error: 'This material has no sections yet - process it first.' });
        }

        // Clear this material's existing tasks only, then regenerate.
        // Same FK ordering fix as /process: schedules/study_sessions rows
        // pointing at the old tasks have to be cleared first, or the
        // DELETE FROM tasks below fails with "FOREIGN KEY constraint
        // failed" the moment any of those tasks has a schedule block or
        // a logged study session against it.
        const clearOldTasks = db.transaction(async (tx) => {
            const sectionIds = sections.map((s) => s.id);
            const sectionPlaceholders = sectionIds.map(() => '?').join(',');

            const oldTaskIds = (await tx.prepare(`
                SELECT id FROM tasks WHERE section_id IN (${sectionPlaceholders})
            `).all(...sectionIds)).map((r) => r.id);

            if (oldTaskIds.length > 0) {
                const taskPlaceholders = oldTaskIds.map(() => '?').join(',');
                await tx.prepare(`DELETE FROM schedules WHERE task_id IN (${taskPlaceholders})`).run(...oldTaskIds);
                await tx.prepare(`DELETE FROM study_sessions WHERE task_id IN (${taskPlaceholders})`).run(...oldTaskIds);
            }

            await tx.prepare(`DELETE FROM tasks WHERE section_id IN (${sectionPlaceholders})`).run(...sectionIds);
        });
        await clearOldTasks();

        const insertedTasks = await insertTasksForSections(sections);

        res.json({
            success: true,
            message: `Generated ${insertedTasks.length} task(s) for ${sections.length} section(s)`,
            material_id: materialId,
            tasks: insertedTasks
        });
    } catch (error) {
        console.error(`Regenerate tasks error for material ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// GET /api/materials/:id/sections
// Read back previously detected sections (+ their tasks) without
// re-parsing the PDF. Empty array if the material hasn't been
// processed yet.
// ==========================================

router.get('/:id/sections', async (req, res) => {
    try {
        const materialId = Number(req.params.id);

        if (!materialId) {
            return res.status(400).json({
                success: false,
                error: 'Invalid material ID'
            });
        }

        const material = await materialOwnedByUser(materialId, req.user.id);

        if (!material) {
            return res.status(404).json({
                success: false,
                error: 'Material not found'
            });
        }

        const sections = await db.prepare(`
            SELECT
                s.id,
                s.title,
                s.start_page,
                s.end_page,
                s.estimated_minutes,
                s.difficulty,
                t.id AS task_id,
                t.priority AS task_priority,
                t.status AS task_status
            FROM sections s
            LEFT JOIN tasks t ON t.section_id = s.id
            WHERE s.material_id = ?
            ORDER BY s.start_page ASC
        `).all(materialId);

        res.json({
            success: true,
            material_id: materialId,
            sections
        });

    } catch (error) {
        console.error('Get material sections error:', error);

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==========================================
// GET /api/materials/:id/file
// Streams the raw PDF bytes back out of `materials.file_data` so the
// browser can render it directly - used by tasks.html/schedule.html to
// embed the PDF in an <iframe> right next to the study timer, instead of
// only offering a download. `inline` (not `attachment`) is what tells
// the browser to display it rather than save it, and the session cookie
// that requireAuth checks travels automatically with a same-origin
// <iframe src="...">, so no separate token/link-sharing scheme is needed.
// ==========================================

router.get('/:id/file', async (req, res) => {
    try {
        const materialId = Number(req.params.id);

        if (!materialId) {
            return res.status(400).json({
                success: false,
                error: 'Invalid material ID'
            });
        }

        const material = await materialOwnedByUser(materialId, req.user.id);

        if (!material) {
            return res.status(404).json({
                success: false,
                error: 'Material not found'
            });
        }

        if (!material.file_data) {
            return res.status(404).json({
                success: false,
                error: 'PDF file not found - it may need to be re-uploaded'
            });
        }

        const dataBuffer = Buffer.from(material.file_data);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${material.filename || 'material.pdf'}"`);
        res.send(dataBuffer);

    } catch (error) {
        console.error('Get material file error:', error);

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;