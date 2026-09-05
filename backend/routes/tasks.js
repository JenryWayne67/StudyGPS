const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();

const dbPath = path.join(__dirname, '../../database/studygps.db');
const db = new Database(dbPath);

router.use(requireAuth);

// ==========================================
// GET /api/tasks
// List every real task for the logged-in user, joined with its section
// and course, plus whether it's scheduled for today (per the real
// `schedules` table) - what tasks.html/dashboard.html need to replace
// the localStorage mock's TODAY/UPCOMING grouping with real data.
// ==========================================

router.get('/', (req, res) => {
    try {
        const today = new Date().toISOString().slice(0, 10);

        const tasks = db.prepare(`
            SELECT
                t.id,
                t.priority,
                t.deadline,
                t.status,
                s.title,
                s.start_page,
                s.end_page,
                s.estimated_minutes,
                s.difficulty,
                s.material_id,
                s.course_id,
                c.name AS course_name,
                EXISTS(
                    SELECT 1 FROM schedules sch WHERE sch.task_id = t.id AND sch.date = ?
                ) AS scheduled_today
            FROM tasks t
            JOIN sections s ON s.id = t.section_id
            JOIN courses c ON c.id = s.course_id
            WHERE c.user_id = ?
            ORDER BY t.priority DESC
        `).all(today, req.user.id);

        const shaped = tasks.map((t) => ({
            ...t,
            pages: (t.start_page != null && t.end_page != null) ? `Pages ${t.start_page}-${t.end_page}` : 'No pages',
            time_group: t.scheduled_today ? 'TODAY' : 'UPCOMING'
        }));

        res.json({ success: true, tasks: shaped });
    } catch (error) {
        console.error('List tasks error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// GET /api/tasks/:id
// Read back one real task, joined with its section (title, pages,
// planned minutes) and course - what timer.html needs to show a real
// task instead of the localStorage mock.
// ==========================================

router.get('/:id', (req, res) => {
    try {
        const taskId = Number(req.params.id);

        if (!taskId) {
            return res.status(400).json({
                success: false,
                error: 'Invalid task ID'
            });
        }

        const task = db.prepare(`
            SELECT
                t.id,
                t.section_id,
                t.priority,
                t.deadline,
                t.status,
                s.title,
                s.start_page,
                s.end_page,
                s.estimated_minutes,
                s.difficulty,
                s.material_id,
                s.course_id,
                c.name AS course_name,
                c.user_id AS owner_user_id
            FROM tasks t
            JOIN sections s ON s.id = t.section_id
            LEFT JOIN courses c ON c.id = s.course_id
            WHERE t.id = ?
        `).get(taskId);

        // Same 404 whether the task doesn't exist or just isn't this
        // user's - don't reveal that a task ID belongs to someone else.
        if (!task || task.owner_user_id !== req.user.id) {
            return res.status(404).json({
                success: false,
                error: `Task ${taskId} does not exist`
            });
        }
        delete task.owner_user_id;

        res.json({
            success: true,
            task
        });

    } catch (error) {
        console.error('Get task error:', error);

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
