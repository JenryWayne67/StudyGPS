// backend/routes/timer.js
//
// The user's one running/paused study timer, kept on the server so it
// survives a reload, a logout, or a different device - the countdown itself
// used to live only in the page's memory, so signing out started it over.
// While a timer runs the page saves it every minute, which doubles as the
// keep-alive that stops Render's free instance sleeping mid-session.

const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { db } = require('../lib/db');

const router = express.Router();

router.use(requireAuth);

// The task has to still exist and still be this user's.
async function ownsTask(taskId, userId) {
    const row = await db.prepare(`
        SELECT t.id
        FROM tasks t
        JOIN sections s ON s.id = t.section_id
        JOIN courses c ON c.id = s.course_id
        WHERE t.id = ? AND c.user_id = ?
    `).get(taskId, userId);
    return Boolean(row);
}

// ==========================================
// GET /api/timer
// The saved timer, with the time that passed since it was saved already
// taken off a running countdown (studying continues while the page is
// closed). Returns timer: null when there's nothing to resume.
// ==========================================
router.get('/', async (req, res) => {
    try {
        const row = await db.prepare(`SELECT * FROM active_timers WHERE user_id = ?`).get(req.user.id);
        if (!row) return res.json({ success: true, timer: null });

        if (!(await ownsTask(row.task_id, req.user.id))) {
            await db.prepare(`DELETE FROM active_timers WHERE user_id = ?`).run(req.user.id);
            return res.json({ success: true, timer: null });
        }

        let remaining = Number(row.remaining_seconds);
        let running = Number(row.is_running) === 1;
        if (running) {
            const elapsed = Math.floor((Date.now() - Number(row.updated_at)) / 1000);
            remaining = Math.max(0, remaining - Math.max(0, elapsed));
            if (remaining === 0) running = false; // ran out while away - let the user finish it
        }

        res.json({
            success: true,
            timer: {
                task_id: row.task_id,
                schedule_id: row.schedule_id,
                occurrence_key: row.occurrence_key,
                planned_minutes: Number(row.planned_minutes),
                total_seconds: Number(row.total_seconds),
                remaining_seconds: remaining,
                is_running: running
            }
        });
    } catch (error) {
        console.error('Get timer error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// PUT /api/timer
// Save the current timer (start/pause/resume/reset/add time, and once a
// minute while it runs).
// ==========================================
router.put('/', async (req, res) => {
    try {
        const body = req.body || {};
        const taskId = Number(body.task_id);
        const plannedMinutes = Number(body.planned_minutes);
        const totalSeconds = Number(body.total_seconds);
        const remainingSeconds = Number(body.remaining_seconds);

        if (!Number.isInteger(taskId) || taskId <= 0) {
            return res.status(400).json({ success: false, error: 'task_id is required.' });
        }
        if (![plannedMinutes, totalSeconds, remainingSeconds].every((n) => Number.isFinite(n) && n >= 0)) {
            return res.status(400).json({ success: false, error: 'planned_minutes/total_seconds/remaining_seconds must be numbers.' });
        }
        if (!(await ownsTask(taskId, req.user.id))) {
            return res.status(404).json({ success: false, error: `Task ${taskId} does not exist` });
        }

        await db.prepare(`
            INSERT INTO active_timers
                (user_id, task_id, schedule_id, occurrence_key, planned_minutes, total_seconds, remaining_seconds, is_running, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                task_id = excluded.task_id,
                schedule_id = excluded.schedule_id,
                occurrence_key = excluded.occurrence_key,
                planned_minutes = excluded.planned_minutes,
                total_seconds = excluded.total_seconds,
                remaining_seconds = excluded.remaining_seconds,
                is_running = excluded.is_running,
                updated_at = excluded.updated_at
        `).run(
            req.user.id,
            taskId,
            body.schedule_id != null ? Number(body.schedule_id) : null,
            body.occurrence_key != null ? String(body.occurrence_key) : null,
            Math.round(plannedMinutes),
            Math.round(totalSeconds),
            Math.round(remainingSeconds),
            body.is_running ? 1 : 0,
            Date.now()
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Save timer error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// DELETE /api/timer
// Clear it - the session was finished or dismissed.
// ==========================================
router.delete('/', async (req, res) => {
    try {
        await db.prepare(`DELETE FROM active_timers WHERE user_id = ?`).run(req.user.id);
        res.json({ success: true });
    } catch (error) {
        console.error('Clear timer error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
