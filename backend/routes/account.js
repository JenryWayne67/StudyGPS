const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { db } = require('../lib/db');

const router = express.Router();

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
router.post('/clear-study-data', async (req, res) => {
    try {
        const userId = req.user.id;

        const clear = db.transaction(async (tx) => {
            const courseIds = (await tx.prepare(`SELECT id FROM courses WHERE user_id = ?`).all(userId)).map((r) => r.id);
            if (courseIds.length === 0) {
                return { materialsDeleted: 0 };
            }
            const coursePlaceholders = courseIds.map(() => '?').join(',');

            const materialRows = await tx.prepare(`
                SELECT id FROM materials WHERE course_id IN (${coursePlaceholders})
            `).all(...courseIds);

            // sections carries course_id directly (not just the nullable
            // material_id), so this reaches manually-seeded sections too.
            const sectionIds = (await tx.prepare(`
                SELECT id FROM sections WHERE course_id IN (${coursePlaceholders})
            `).all(...courseIds)).map((r) => r.id);

            let taskIds = [];
            if (sectionIds.length > 0) {
                const sectionPlaceholders = sectionIds.map(() => '?').join(',');
                taskIds = (await tx.prepare(`
                    SELECT id FROM tasks WHERE section_id IN (${sectionPlaceholders})
                `).all(...sectionIds)).map((r) => r.id);
            }

            if (taskIds.length > 0) {
                const taskPlaceholders = taskIds.map(() => '?').join(',');
                await tx.prepare(`DELETE FROM schedules WHERE task_id IN (${taskPlaceholders})`).run(...taskIds);
                await tx.prepare(`DELETE FROM study_sessions WHERE task_id IN (${taskPlaceholders})`).run(...taskIds);
                await tx.prepare(`DELETE FROM tasks WHERE id IN (${taskPlaceholders})`).run(...taskIds);
            }

            if (materialRows.length > 0) {
                const materialPlaceholders = materialRows.map(() => '?').join(',');
                const materialIds = materialRows.map((r) => r.id);
                await tx.prepare(`DELETE FROM material_pages WHERE material_id IN (${materialPlaceholders})`).run(...materialIds);
            }

            await tx.prepare(`DELETE FROM sections WHERE course_id IN (${coursePlaceholders})`).run(...courseIds);
            // Uploaded PDF bytes live in materials.file_data (see backend/
            // routes/materials.js) - deleting the row is enough, there's no
            // separate file on disk to clean up anymore.
            await tx.prepare(`DELETE FROM materials WHERE course_id IN (${coursePlaceholders})`).run(...courseIds);

            return { materialsDeleted: materialRows.length };
        });

        const result = await clear();

        res.json({
            success: true,
            message: `Cleared ${result.materialsDeleted} material(s) and all their sections, tasks, schedule, and study history. Your courses were kept.`,
            materials_deleted: result.materialsDeleted
        });
    } catch (error) {
        console.error('Clear study data error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
