const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();

const dbPath = path.join(__dirname, '../../database/studygps.db');
const db = new Database(dbPath);

router.use(requireAuth);

// ==========================================
// POST /api/account/clear-study-data
// Wipes this user's uploaded materials, detected sections, generated
// tasks, generated schedule, and study-session/timer history - but
// keeps their course list intact (settings.html asks for this
// specifically: "study data only, keep courses"). Entirely scoped to
// req.user.id via the courses table, never touches another user's rows.
//
// Deletes in FK-safe order (schedules/study_sessions -> tasks ->
// material_pages/sections -> materials) - same ordering fix as
// materials.js's reprocess path, since better-sqlite3 enforces foreign
// keys by default and schedules.task_id/study_sessions.task_id have no
// ON DELETE CASCADE.
// ==========================================
router.post('/clear-study-data', (req, res) => {
    try {
        const userId = req.user.id;

        const result = db.transaction(() => {
            const courseIds = db.prepare(`SELECT id FROM courses WHERE user_id = ?`).all(userId).map((r) => r.id);
            if (courseIds.length === 0) {
                return { materialsDeleted: 0, filesToDelete: [] };
            }
            const coursePlaceholders = courseIds.map(() => '?').join(',');

            const materialRows = db.prepare(`
                SELECT id, file_path FROM materials WHERE course_id IN (${coursePlaceholders})
            `).all(...courseIds);

            // sections carries course_id directly (not just the nullable
            // material_id), so this reaches manually-seeded sections too.
            const sectionIds = db.prepare(`
                SELECT id FROM sections WHERE course_id IN (${coursePlaceholders})
            `).all(...courseIds).map((r) => r.id);

            let taskIds = [];
            if (sectionIds.length > 0) {
                const sectionPlaceholders = sectionIds.map(() => '?').join(',');
                taskIds = db.prepare(`
                    SELECT id FROM tasks WHERE section_id IN (${sectionPlaceholders})
                `).all(...sectionIds).map((r) => r.id);
            }

            if (taskIds.length > 0) {
                const taskPlaceholders = taskIds.map(() => '?').join(',');
                db.prepare(`DELETE FROM schedules WHERE task_id IN (${taskPlaceholders})`).run(...taskIds);
                db.prepare(`DELETE FROM study_sessions WHERE task_id IN (${taskPlaceholders})`).run(...taskIds);
                db.prepare(`DELETE FROM tasks WHERE id IN (${taskPlaceholders})`).run(...taskIds);
            }

            if (materialRows.length > 0) {
                const materialPlaceholders = materialRows.map(() => '?').join(',');
                const materialIds = materialRows.map((r) => r.id);
                db.prepare(`DELETE FROM material_pages WHERE material_id IN (${materialPlaceholders})`).run(...materialIds);
            }

            db.prepare(`DELETE FROM sections WHERE course_id IN (${coursePlaceholders})`).run(...courseIds);
            db.prepare(`DELETE FROM materials WHERE course_id IN (${coursePlaceholders})`).run(...courseIds);

            return {
                materialsDeleted: materialRows.length,
                filesToDelete: materialRows.map((r) => r.file_path).filter(Boolean)
            };
        })();

        // Best-effort cleanup of the actual uploaded PDF files on disk,
        // done AFTER the DB transaction commits - a locked/missing file
        // shouldn't roll back data that already cleared successfully.
        let filesDeleted = 0;
        const fileErrors = [];
        for (const filePath of result.filesToDelete) {
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    filesDeleted++;
                }
            } catch (err) {
                fileErrors.push(`${filePath}: ${err.message}`);
            }
        }

        res.json({
            success: true,
            message: `Cleared ${result.materialsDeleted} material(s) and all their sections, tasks, schedule, and study history. Your courses were kept.`,
            materials_deleted: result.materialsDeleted,
            files_deleted: filesDeleted,
            file_errors: fileErrors
        });
    } catch (error) {
        console.error('Clear study data error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
