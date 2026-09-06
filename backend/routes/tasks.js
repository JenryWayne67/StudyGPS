const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { db } = require('../lib/db');

const router = express.Router();

router.use(requireAuth);

// A custom task (added by the user directly from Tasks & Timer, not
// derived from an uploaded PDF) still needs a course + section row to fit
// the existing tasks/schedules data model - schedule.js's scheduler picks
// up ANY pending task via `tasks JOIN sections JOIN courses WHERE
// c.user_id = ?`, so a custom task rides along into the real schedule for
// free as long as it's stored the same way. Every user gets exactly one
// personal "catch-all" course, created lazily on their first custom task,
// so they're never asked to pick/create a course just to jot down "buy
// notebook" or "call study group".
const PERSONAL_COURSE_NAME = 'Personal Tasks';

async function ensurePersonalCourseId(userId) {
    const existing = await db.prepare(`
        SELECT id FROM courses WHERE user_id = ? AND name = ?
    `).get(userId, PERSONAL_COURSE_NAME);

    if (existing) return existing.id;

    const info = await db.prepare(`
        INSERT INTO courses (user_id, name) VALUES (?, ?)
    `).run(userId, PERSONAL_COURSE_NAME);

    return info.lastInsertRowid;
}

// ==========================================
// POST /api/tasks
// Add a standalone task the user typed in themselves - e.g. "Finish
// worksheet 3" or "Call study group" - with no PDF/material behind it.
// Stored as a section (material_id left NULL) + task under this user's
// personal catch-all course, so it shows up on the Tasks page and is
// picked up by schedule.js's /api/schedule/generate exactly like any
// material-derived task, without any change needed there.
// ==========================================
router.post('/', async (req, res) => {
    try {
        const userId = req.user.id;
        const body = req.body || {};

        const title = String(body.title || '').trim();
        if (!title) {
            return res.status(400).json({ success: false, error: 'Task title is required.' });
        }

        const estimatedMinutes = Number(body.estimated_minutes);
        if (!Number.isFinite(estimatedMinutes) || estimatedMinutes <= 0) {
            return res.status(400).json({ success: false, error: 'estimated_minutes must be a positive number.' });
        }

        // Same priority scale sectionTaskManager.cpp uses for PDF-derived
        // tasks (difficulty*10 + up to ~20 for length), so a custom task
        // competes fairly for schedule slots instead of always winning or
        // always losing against real material tasks.
        const priorityInput = String(body.priority || 'medium').toLowerCase();
        const priorityMap = { low: 20, medium: 45, high: 70 };
        const priority = priorityMap[priorityInput] ?? priorityMap.medium;

        const deadline = body.deadline ? String(body.deadline) : null;

        const courseId = await ensurePersonalCourseId(userId);

        const sectionInfo = await db.prepare(`
            INSERT INTO sections (course_id, title, start_page, end_page, estimated_minutes, difficulty, material_id)
            VALUES (?, ?, NULL, NULL, ?, 1, NULL)
        `).run(courseId, title, estimatedMinutes);

        const taskInfo = await db.prepare(`
            INSERT INTO tasks (section_id, priority, deadline, status)
            VALUES (?, ?, ?, 'Not Started')
        `).run(sectionInfo.lastInsertRowid, priority, deadline);

        res.json({
            success: true,
            task: {
                id: taskInfo.lastInsertRowid,
                section_id: sectionInfo.lastInsertRowid,
                title,
                estimated_minutes: estimatedMinutes,
                priority,
                deadline,
                status: 'Not Started',
                course_name: PERSONAL_COURSE_NAME,
                material_name: null,
                start_page: null,
                end_page: null
            }
        });
    } catch (error) {
        console.error('Create custom task error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// GET /api/tasks
// List every real task for the logged-in user, joined with its section
// and course, plus whether it's scheduled for today (per the real
// `schedules` table) - what tasks.html/dashboard.html need to replace
// the localStorage mock's TODAY/UPCOMING grouping with real data.
// ==========================================

// A task longer than one study session gets split by the C++ scheduler
// (cpp_engine/scheduler.cpp) into several session-length chunks, each its
// own row in `schedules`, possibly on different days (e.g. one task
// spread across tonight AND tomorrow night). This route used to collapse
// every task down to a single row via correlated subqueries that only
// ever picked ONE "next" schedule chunk - so a task with two scheduled
// sessions silently only ever showed one of them here, even though
// Schedule showed both. Now it returns one row per scheduled session (so
// the Tasks & Timer page can render - and let the user start a timer
// for - every session, not just one), plus exactly one row for a task
// that has no scheduled session yet at all.
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
                m.filename AS material_name
            FROM tasks t
            JOIN sections s ON s.id = t.section_id
            JOIN courses c ON c.id = s.course_id
            LEFT JOIN materials m ON m.id = s.material_id
            WHERE c.user_id = ?
            ORDER BY t.priority DESC
        `).all(req.user.id);

        const taskIds = tasks.map((t) => t.id);
        const schedulesByTask = new Map();
        if (taskIds.length > 0) {
            const placeholders = taskIds.map(() => '?').join(',');
            const scheduleRows = await db.prepare(`
                SELECT id, task_id, date, start_time, end_time, start_page, end_page
                FROM schedules
                WHERE task_id IN (${placeholders})
                ORDER BY date ASC, start_time ASC
            `).all(...taskIds);
            for (const row of scheduleRows) {
                if (!schedulesByTask.has(row.task_id)) schedulesByTask.set(row.task_id, []);
                schedulesByTask.get(row.task_id).push(row);
            }
        }

        const shaped = [];
        for (const t of tasks) {
            const sessions = schedulesByTask.get(t.id) || [];

            if (sessions.length === 0) {
                shaped.push({
                    ...t,
                    schedule_id: null,
                    pages: (t.start_page != null && t.end_page != null) ? `Pages ${t.start_page}-${t.end_page}` : 'No pages',
                    time_group: 'UPCOMING',
                    session_date: null,
                    session_start_time: null,
                    session_end_time: null,
                    session_minutes: null
                });
                continue;
            }

            for (const sch of sessions) {
                // Prefer this specific chunk's own page range when the
                // scheduler recorded one (a task split into parts covers a
                // different sub-range per session); fall back to the
                // section's full range for a single-session task or one
                // with no pages at all (e.g. a custom task).
                const startPage = sch.start_page != null ? sch.start_page : t.start_page;
                const endPage = sch.end_page != null ? sch.end_page : t.end_page;

                shaped.push({
                    ...t,
                    schedule_id: sch.id,
                    pages: (startPage != null && endPage != null) ? `Pages ${startPage}-${endPage}` : 'No pages',
                    time_group: sch.date === today ? 'TODAY' : 'UPCOMING',
                    session_date: sch.date,
                    session_start_time: sch.start_time,
                    session_end_time: sch.end_time,
                    session_minutes: sessionDuration(sch.start_time, sch.end_time)
                });
            }
        }

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
