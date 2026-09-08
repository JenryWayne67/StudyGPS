const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { db } = require('../lib/db');

const router = express.Router();

router.use(requireAuth);

// Same 10-color set schedule.html assigns to courses that have no stored
// color of their own (kept in sync by hand - the frontend can't import a
// server module, and this is the only other place a "default" color for a
// course is ever picked). A course created without an explicit color gets
// one of these, cycling by how many courses this user already has, so it
// still shows up distinctly instead of every new course landing on blue.
const DEFAULT_COLOR_PALETTE = [
    '#3b82f6', '#10b981', '#f59e0b', '#6366f1', '#ec4899',
    '#06b6d4', '#f97316', '#8b5cf6', '#ef4444', '#14b8a6'
];

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function normalizeColor(input) {
    const value = String(input || '').trim();
    return HEX_COLOR_PATTERN.test(value) ? value.toLowerCase() : null;
}

router.get('/test', (req, res) => {
    res.json({
        success: true,
        message: 'Courses route is working'
    });
});
// GET /api/courses
// Return all courses for the logged-in user
router.get('/', async (req, res) => {
    try {
        const userId = req.user.id;

        const courses = await db.prepare(`
            SELECT id, user_id, name, color
            FROM courses
            WHERE user_id = ?
            ORDER BY id ASC
        `).all(userId);

        res.json({
            success: true,
            courses
        });

    } catch (error) {
        console.error('Get courses error:', error);

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});


// POST /api/courses
// Create a new course, owned by the logged-in user
router.post('/', async (req, res) => {
    try {
        const { name } = req.body;
        const userId = req.user.id;

        if (!name || !name.trim()) {
            return res.status(400).json({
                success: false,
                error: 'Course name is required'
            });
        }

        // An explicit, validly-formatted color is honored as-is; anything
        // else (omitted, blank, malformed) falls back to the next color in
        // the palette rather than rejecting the whole request over it.
        let color = normalizeColor(req.body.color);
        if (!color) {
            const { count } = await db.prepare(`
                SELECT COUNT(*) AS count FROM courses WHERE user_id = ?
            `).get(userId);
            color = DEFAULT_COLOR_PALETTE[count % DEFAULT_COLOR_PALETTE.length];
        }

        const result = await db.prepare(`
            INSERT INTO courses (user_id, name, color)
            VALUES (?, ?, ?)
        `).run(userId, name.trim(), color);

        const newCourse = await db.prepare(`
            SELECT id, user_id, name, color
            FROM courses
            WHERE id = ?
        `).get(result.lastInsertRowid);

        res.status(201).json({
            success: true,
            message: 'Course created successfully',
            course: newCourse
        });

    } catch (error) {
        console.error('Create course error:', error);

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==========================================
// PUT /api/courses/:id
// Rename and/or recolor an existing course. Either field can be omitted
// to leave it unchanged.
// ==========================================
router.put('/:id', async (req, res) => {
    try {
        const courseId = Number(req.params.id);
        if (!courseId) {
            return res.status(400).json({ success: false, error: 'Invalid course ID' });
        }

        const course = await db.prepare(`
            SELECT id, user_id, name, color FROM courses WHERE id = ?
        `).get(courseId);

        // Same 404 whether the course doesn't exist or just isn't this
        // user's - don't reveal that a course ID belongs to someone else.
        if (!course || course.user_id !== req.user.id) {
            return res.status(404).json({ success: false, error: `Course ${courseId} does not exist` });
        }

        let name = course.name;
        if (req.body.name !== undefined) {
            name = String(req.body.name).trim();
            if (!name) {
                return res.status(400).json({ success: false, error: 'Course name is required' });
            }
        }

        let color = course.color;
        if (req.body.color !== undefined) {
            color = normalizeColor(req.body.color);
            if (!color) {
                return res.status(400).json({ success: false, error: 'Color must be a hex value like #3b82f6' });
            }
        }

        await db.prepare(`
            UPDATE courses SET name = ?, color = ? WHERE id = ?
        `).run(name, color, courseId);

        const updated = await db.prepare(`
            SELECT id, user_id, name, color FROM courses WHERE id = ?
        `).get(courseId);

        res.json({ success: true, message: 'Course updated successfully', course: updated });
    } catch (error) {
        console.error('Update course error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// DELETE /api/courses/:id
// Removes a course and everything under it - materials, their pages,
// sections, tasks, and any schedules/study_sessions those tasks had.
// None of those foreign keys cascade in schema.sql (only
// materials -> material_pages and courses -> materials do), so each layer
// is deleted explicitly, in one transaction, in dependency order.
// ==========================================
router.delete('/:id', async (req, res) => {
    try {
        const courseId = Number(req.params.id);
        if (!courseId) {
            return res.status(400).json({ success: false, error: 'Invalid course ID' });
        }

        const course = await db.prepare(`
            SELECT id, user_id FROM courses WHERE id = ?
        `).get(courseId);

        if (!course || course.user_id !== req.user.id) {
            return res.status(404).json({ success: false, error: `Course ${courseId} does not exist` });
        }

        const deleteCourse = db.transaction(async (tx) => {
            const sectionIds = (await tx.prepare(`
                SELECT id FROM sections WHERE course_id = ?
            `).all(courseId)).map((r) => r.id);

            if (sectionIds.length > 0) {
                const sectionPlaceholders = sectionIds.map(() => '?').join(',');

                const taskIds = (await tx.prepare(`
                    SELECT id FROM tasks WHERE section_id IN (${sectionPlaceholders})
                `).all(...sectionIds)).map((r) => r.id);

                if (taskIds.length > 0) {
                    const taskPlaceholders = taskIds.map(() => '?').join(',');
                    await tx.prepare(`DELETE FROM schedules WHERE task_id IN (${taskPlaceholders})`).run(...taskIds);
                    await tx.prepare(`DELETE FROM study_sessions WHERE task_id IN (${taskPlaceholders})`).run(...taskIds);
                    await tx.prepare(`DELETE FROM tasks WHERE id IN (${taskPlaceholders})`).run(...taskIds);
                }

                await tx.prepare(`DELETE FROM sections WHERE id IN (${sectionPlaceholders})`).run(...sectionIds);
            }

            const materialIds = (await tx.prepare(`
                SELECT id FROM materials WHERE course_id = ?
            `).all(courseId)).map((r) => r.id);

            if (materialIds.length > 0) {
                const materialPlaceholders = materialIds.map(() => '?').join(',');
                await tx.prepare(`DELETE FROM material_pages WHERE material_id IN (${materialPlaceholders})`).run(...materialIds);
                await tx.prepare(`DELETE FROM materials WHERE id IN (${materialPlaceholders})`).run(...materialIds);
            }

            await tx.prepare(`DELETE FROM courses WHERE id = ?`).run(courseId);
        });

        await deleteCourse();

        res.json({ success: true, message: 'Course deleted successfully' });
    } catch (error) {
        console.error('Delete course error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});


module.exports = router;
