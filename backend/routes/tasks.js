const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { db } = require('../lib/db');

const router = express.Router();

router.use(requireAuth);

// ==========================================
// GET /api/tasks
// List every real task for the logged-in user, joined with its section
// and course, plus whether it's scheduled for today (per the real
// `schedules` table) - what tasks.html/dashboard.html need to replace
// the localStorage mock's TODAY/UPCOMING grouping with real data.
// ==========================================

// A task longer than one study session gets split by the C++ scheduler
// (cpp_engine/scheduler.cpp) into several session-length chunks, each its
// own row in `schedules`, possibly on different days. This is exactly
// what schedule.html shows (each chunk's own start_time/end_time) - but
// this route used to only ever return the section's FULL estimated_minutes,
// with no link back to any specific chunk. That's what made the Tasks
// page's duration disagree with Schedule's: Schedule showed one chunk's
// real (often shorter) length, Tasks always showed the task's total.
// The three correlated subqueries below pull in that task's next
// upcoming (or, if none upcoming, most recent) schedule chunk - date/
// start/end - so the Tasks page can show and start a timer for the SAME
// block Schedule shows, not the task's grand total.
router.get('/', async (req, res) => {
    try {
        const today = new Date().toISOString().slice(0, 10);

        const tasks = await db.prepare(`
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
                m.filename AS material_name,
                EXISTS(
                    SELECT 1 FROM schedules sch WHERE sch.task_id = t.id AND sch.date = ?
                ) AS scheduled_today,
                (
                    SELECT sch.date FROM schedules sch WHERE sch.task_id = t.id
                    ORDER BY (sch.date >= ?) DESC, sch.date ASC, sch.start_time ASC LIMIT 1
                ) AS session_date,
                (
                    SELECT sch.start_time FROM schedules sch WHERE sch.task_id = t.id
                    ORDER BY (sch.date >= ?) DESC, sch.date ASC, sch.start_time ASC LIMIT 1
                ) AS session_start_time,
                (
                    SELECT sch.end_time FROM schedules sch WHERE sch.task_id = t.id
                    ORDER BY (sch.date >= ?) DESC, sch.date ASC, sch.start_time ASC LIMIT 1
                ) AS session_end_time
            FROM tasks t
            JOIN sections s ON s.id = t.section_id
            JOIN courses c ON c.id = s.course_id
            LEFT JOIN materials m ON m.id = s.material_id
            WHERE c.user_id = ?
            ORDER BY t.priority DESC
        `).all(today, today, today, today, req.user.id);

        const shaped = tasks.map((t) => {
            const sessionMinutes = sessionDuration(t.session_start_time, t.session_end_time);
            return {
                ...t,
                pages: (t.start_page != null && t.end_page != null) ? `Pages ${t.start_page}-${t.end_page}` : 'No pages',
                time_group: t.scheduled_today ? 'TODAY' : 'UPCOMING',
                // The specific chunk's own length, when this task has a
                // scheduled session - falls back to null (full
                // estimated_minutes) for a task never scheduled yet.
                session_minutes: sessionMinutes
            };
        });

        res.json({ success: true, tasks: shaped });
    } catch (error) {
        console.error('List tasks error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// "HH:MM" start/end -> minutes between them, or null if either is
// missing/malformed. Same computation schedule.html/dashboard.html do
// client-side for the same reason - kept here too so the API itself can
// hand back a ready-to-use number instead of every page re-deriving it.
function sessionDuration(startHHMM, endHHMM) {
    if (!startHHMM || !endHHMM) return null;
    const [sh, sm] = String(startHHMM).split(':').map(Number);
    const [eh, em] = String(endHHMM).split(':').map(Number);
    if (![sh, sm, eh, em].every(Number.isFinite)) return null;
    const diff = (eh * 60 + em) - (sh * 60 + sm);
    return diff > 0 ? diff : null;
}

// ==========================================
// GET /api/tasks/:id
// Read back one real task, joined with its section (title, pages,
// planned minutes) and course - what timer.html needs to show a real
// task instead of the localStorage mock.
// ==========================================

router.get('/:id', async (req, res) => {
    try {
        const taskId = Number(req.params.id);

        if (!taskId) {
            return res.status(400).json({
                success: false,
                error: 'Invalid task ID'
            });
        }

        const task = await db.prepare(`
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
                m.filename AS material_name,
                c.user_id AS owner_user_id
            FROM tasks t
            JOIN sections s ON s.id = t.section_id
            LEFT JOIN courses c ON c.id = s.course_id
            LEFT JOIN materials m ON m.id = s.material_id
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
