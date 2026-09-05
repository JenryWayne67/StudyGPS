// backend/routes/schedule.js
//
// Wires dashboard.html/schedule.html to a REAL generated study schedule.
// All the actual scheduling logic (task prioritization, session-length
// chunking, page-range splitting across parts) lives in cpp_engine/
// scheduler.cpp - this route only gathers this user's real tasks +
// their study-time preferences, pipes them into that C++ engine (same
// stdin/stdout CLI pattern as sectionTaskManager.js's runSectionTaskManager),
// and stores what comes back. No scheduling math happens in JS.

const express = require('express');
const path = require('path');
const { execFileSync } = require('child_process');
const { requireAuth } = require('../middleware/requireAuth');
const { db } = require('../lib/db');

const router = express.Router();

router.use(requireAuth);

const DEFAULT_PREFERENCES = {
    study_days: 'Monday,Tuesday,Wednesday,Thursday,Friday',
    preferred_start: '18:00',
    preferred_end: '21:00',
    session_length: 50,
    break_length: 10,
    max_daily_minutes: 120
};

const DAYS_TO_PLAN = 14; // how far ahead to open up study slots

async function getPreferences(userId) {
    const row = await db.prepare(`
        SELECT study_days, preferred_start, preferred_end, session_length, break_length, max_daily_minutes
        FROM user_preferences
        WHERE user_id = ?
    `).get(userId);

    if (!row) return { ...DEFAULT_PREFERENCES };

    return {
        study_days: row.study_days || DEFAULT_PREFERENCES.study_days,
        preferred_start: row.preferred_start || DEFAULT_PREFERENCES.preferred_start,
        preferred_end: row.preferred_end || DEFAULT_PREFERENCES.preferred_end,
        session_length: row.session_length || DEFAULT_PREFERENCES.session_length,
        break_length: row.break_length ?? DEFAULT_PREFERENCES.break_length,
        max_daily_minutes: row.max_daily_minutes || DEFAULT_PREFERENCES.max_daily_minutes
    };
}

// "HH:MM" -> minutes since midnight
function timeToMinutes(hhmm) {
    const [h, m] = String(hhmm).split(':').map(Number);
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

// minutes since midnight -> "HH:MM" (24-hour, for storage/display)
function minutesToTime(totalMinutes) {
    const wrapped = ((totalMinutes % 1440) + 1440) % 1440;
    const h = Math.floor(wrapped / 60);
    const m = wrapped % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Local calendar date -> "YYYY-MM-DD". Deliberately NOT toISOString(),
// which converts to UTC first - for a server running in a timezone ahead
// of UTC (e.g. UTC+6:30), local midnight for "tomorrow" is still today's
// date in UTC, and that mismatch was silently storing every session under
// a date one day earlier than its actual dayLabel/weekday. frontend/
// schedule.html's toDateStr() must build dates the same way, or the two
// will disagree by a day again.
function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// Build one SLOT per upcoming day that falls on one of the user's study
// days, for the next DAYS_TO_PLAN days starting today (dayIndex 0).
function buildSlotsAndDateMap(preferences) {
    const studyDays = new Set(
        (preferences.study_days || '')
            .split(',')
            .map((d) => d.trim())
            .filter(Boolean)
    );

    const startMinutes = timeToMinutes(preferences.preferred_start);
    const endMinutes = timeToMinutes(preferences.preferred_end);

    const slots = [];
    const dateByDayIndex = new Map();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let dayIndex = 0; dayIndex < DAYS_TO_PLAN; dayIndex++) {
        const date = new Date(today);
        date.setDate(date.getDate() + dayIndex);

        const dayLabel = date.toLocaleDateString('en-US', { weekday: 'long' });
        dateByDayIndex.set(dayIndex, formatDate(date));

        if (studyDays.size === 0 || studyDays.has(dayLabel)) {
            slots.push({ dayLabel, dayIndex, startMinutes, endMinutes });
        }
    }

    return { slots, dateByDayIndex };
}

// Real, pending tasks for this user, joined with their section (for
// name/pages/estimated minutes/difficulty) - exactly what the scheduler
// needs, nothing invented.
async function getPendingTasks(userId) {
    return db.prepare(`
        SELECT
            t.id,
            t.priority,
            t.deadline,
            s.title,
            s.start_page,
            s.end_page,
            s.estimated_minutes,
            s.difficulty
        FROM tasks t
        JOIN sections s ON s.id = t.section_id
        JOIN courses c ON c.id = s.course_id
        WHERE c.user_id = ? AND t.status != 'Completed'
        ORDER BY t.priority DESC
    `).all(userId);
}

function daysUntil(deadline) {
    if (!deadline) return 30; // no deadline set - treat as not urgent
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(deadline);
    if (Number.isNaN(due.getTime())) return 30;
    const diffMs = due.getTime() - today.getTime();
    return Math.round(diffMs / (1000 * 60 * 60 * 24)); // may be negative if overdue
}

// Run cpp_engine/scheduler.exe: pipe CONFIG/TASK/SLOT lines in, read
// scheduled sessions (key=value) back out - same Node<->C++ boundary
// convention as runSectionTaskManager() in materials.js.
function runScheduler({ preferences, tasks, slots }) {
    const exePath = path.join(__dirname, '../../cpp_engine/scheduler.exe');

    const lines = [];
    lines.push(['CONFIG', preferences.session_length, preferences.break_length, preferences.max_daily_minutes].join('|'));

    for (const task of tasks) {
        lines.push([
            'TASK',
            task.id,
            task.title,
            task.estimated_minutes || 0,
            task.priority || 0,
            daysUntil(task.deadline),
            task.difficulty || 1,
            task.start_page ?? -1,
            task.end_page ?? -1
        ].join('|'));
    }

    for (const slot of slots) {
        lines.push(['SLOT', slot.dayLabel, slot.dayIndex, slot.startMinutes, slot.endMinutes].join('|'));
    }

    const input = lines.join('\n') + '\n';
    const stdout = execFileSync(exePath, [], { input, encoding: 'utf8' });

    const sessions = [];
    const warnings = [];
    const sessionRe = /task_id=(\S+)\s+day_index=(-?\d+)\s+day_label=(\S+)\s+start_minutes=(\d+)\s+end_minutes=(\d+)\s+start_page=(-?\d+)\s+end_page=(-?\d+)\s+part=(\d+)\s+total_parts=(\d+)/;
    const warningRe = /^warning=(.*)$/;

    for (const line of stdout.split('\n')) {
        const m = line.match(sessionRe);
        if (m) {
            sessions.push({
                task_id: Number(m[1]),
                day_index: Number(m[2]),
                day_label: m[3],
                start_minutes: Number(m[4]),
                end_minutes: Number(m[5]),
                start_page: Number(m[6]),
                end_page: Number(m[7]),
                part: Number(m[8]),
                total_parts: Number(m[9])
            });
            continue;
        }
        const w = line.match(warningRe);
        if (w) warnings.push(w[1]);
    }

    return { sessions, warnings };
}

// ==========================================
// POST /api/schedule/generate
// Regenerate this user's schedule from their real pending tasks and
// study-time preferences. Idempotent: only replaces THIS user's own
// schedule rows.
// ==========================================
router.post('/generate', async (req, res) => {
    try {
        const userId = req.user.id;
        const preferences = await getPreferences(userId);
        const tasks = await getPendingTasks(userId);
        const { slots, dateByDayIndex } = buildSlotsAndDateMap(preferences);

        if (tasks.length === 0) {
            return res.json({ success: true, message: 'No pending tasks to schedule.', schedule: [], warnings: [] });
        }

        const { sessions, warnings } = runScheduler({ preferences, tasks, slots });

        const replace = db.transaction(async (tx) => {
            // Clear only this user's existing schedule rows before
            // rebuilding - never touches other users' schedules.
            const oldIds = (await tx.prepare(`
                SELECT sch.id
                FROM schedules sch
                JOIN tasks t ON t.id = sch.task_id
                JOIN sections s ON s.id = t.section_id
                JOIN courses c ON c.id = s.course_id
                WHERE c.user_id = ?
            `).all(userId)).map((r) => r.id);

            if (oldIds.length > 0) {
                const placeholders = oldIds.map(() => '?').join(',');
                await tx.prepare(`DELETE FROM schedules WHERE id IN (${placeholders})`).run(...oldIds);
            }

            const insertSession = tx.prepare(`
                INSERT INTO schedules (task_id, date, start_time, end_time, start_page, end_page)
                VALUES (?, ?, ?, ?, ?, ?)
            `);

            const inserted = [];
            for (const s of sessions) {
                const date = dateByDayIndex.get(s.day_index) || null;
                const info = await insertSession.run(
                    s.task_id,
                    date,
                    minutesToTime(s.start_minutes),
                    minutesToTime(s.end_minutes),
                    s.start_page >= 0 ? s.start_page : null,
                    s.end_page >= 0 ? s.end_page : null
                );
                inserted.push({
                    id: info.lastInsertRowid,
                    task_id: s.task_id,
                    date,
                    start_time: minutesToTime(s.start_minutes),
                    end_time: minutesToTime(s.end_minutes),
                    start_page: s.start_page >= 0 ? s.start_page : null,
                    end_page: s.end_page >= 0 ? s.end_page : null,
                    part: s.part,
                    total_parts: s.total_parts
                });
            }

            return inserted;
        });

        const schedule = await replace();

        res.json({
            success: true,
            message: 'Schedule generated by the C++ scheduling engine',
            schedule,
            warnings
        });
    } catch (error) {
        console.error('Generate schedule error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// GET /api/schedule
// Read back this user's current stored schedule, with enough joined
// task/section/course info for the dashboard/schedule pages to render
// without a second round trip.
// ==========================================
router.get('/', async (req, res) => {
    try {
        const rows = await db.prepare(`
            SELECT
                sch.id,
                sch.task_id,
                sch.date,
                sch.start_time,
                sch.end_time,
                sch.start_page,
                sch.end_page,
                s.title,
                s.material_id,
                c.name AS course_name,
                t.status AS task_status,
                t.priority
            FROM schedules sch
            JOIN tasks t ON t.id = sch.task_id
            JOIN sections s ON s.id = t.section_id
            JOIN courses c ON c.id = s.course_id
            WHERE c.user_id = ?
            ORDER BY sch.date ASC, sch.start_time ASC
        `).all(req.user.id);

        res.json({ success: true, schedule: rows });
    } catch (error) {
        console.error('Get schedule error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
