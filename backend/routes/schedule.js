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
    day_schedule: {},
    session_length: 50,
    break_length: 10,
    max_daily_minutes: 120
};

const DAYS_TO_PLAN = 14; // how far ahead to open up study slots

function parseDaySchedule(raw) {
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (err) {
        return {};
    }
}

async function getPreferences(userId) {
    const row = await db.prepare(`
        SELECT study_days, preferred_start, preferred_end, day_schedule, session_length, break_length, max_daily_minutes
        FROM user_preferences
        WHERE user_id = ?
    `).get(userId);

    if (!row) return { ...DEFAULT_PREFERENCES };

    return {
        study_days: row.study_days || DEFAULT_PREFERENCES.study_days,
        preferred_start: row.preferred_start || DEFAULT_PREFERENCES.preferred_start,
        preferred_end: row.preferred_end || DEFAULT_PREFERENCES.preferred_end,
        day_schedule: parseDaySchedule(row.day_schedule),
        session_length: row.session_length || DEFAULT_PREFERENCES.session_length,
        break_length: row.break_length ?? DEFAULT_PREFERENCES.break_length,
        max_daily_minutes: row.max_daily_minutes || DEFAULT_PREFERENCES.max_daily_minutes
    };
}

// This day's actual study window: its own entry in day_schedule if the
// user set one (e.g. Saturday -> 2:30pm-10:00pm), otherwise the account-wide
// preferred_start/preferred_end fallback. This is the fix for schedules
// that ignored per-day hours and used one flat window for every day.
function getDayWindow(preferences, dayLabel) {
    const override = preferences.day_schedule && preferences.day_schedule[dayLabel];
    if (override && override.start && override.end) {
        return { start: override.start, end: override.end };
    }
    return { start: preferences.preferred_start, end: preferences.preferred_end };
}

// "HH:MM" -> minutes since midnight
function timeToMinutes(hhmm) {
    const [h, m] = String(hhmm).split(':').map(Number);
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

// minutes since midnight -> "HH:MM". Past midnight of a study night it keeps
// counting (25:10 = 1:10am), so the session stays on that night's date.
function minutesToTime(totalMinutes) {
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
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

// "Today" and the current time as the user's browser sees them (sent by the
// Regenerate buttons). The server runs in another time zone (Render uses
// UTC), which put "today" on the wrong date near midnight and made "times
// already past" wrong. Falls back to the server's own clock.
function readClock(body) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String((body && body.today) || ''));
    const nowMinutes = Number(body && body.now_minutes);
    if (match && Number.isInteger(nowMinutes) && nowMinutes >= 0 && nowMinutes < 1440) {
        return { today: new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])), nowMinutes };
    }
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    return { today, nowMinutes: now.getHours() * 60 + now.getMinutes() };
}

// A day's start/end is when the user is AVAILABLE, not a promise that
// every one of those minutes should be filled with back-to-back sessions.
// A long window (e.g. 2:30pm-10:00pm) realistically has to make room for
// dinner and a break in the evening, not just the short inter-session
// breaks used between study chunks. So any day whose window spans this
// range gets split into an "afternoon" slot and a "night" slot around it,
// the same way a person would actually plan their evening.
//
// Fixed for now rather than a new preference - a sensible default that
// covers the common dinner/wind-down slot. Worth making configurable if
// users want to shift it.
const LONG_BREAK_START_MINUTES = timeToMinutes('18:00'); // 6:00 PM
const LONG_BREAK_END_MINUTES = timeToMinutes('19:30');   // 7:30 PM
const MIN_USABLE_SEGMENT_MINUTES = 30; // a sliver shorter than this isn't worth its own session

function splitAroundLongBreak(startMinutes, endMinutes) {
    // Only carve out a dinner break when the window genuinely SPANS it -
    // starts at/before 6:00pm AND runs past 7:30pm. A window that starts
    // later than 6:00pm (e.g. the weekday 6:30pm-10:00pm case) means
    // dinner already happened before study time even begins, so there's
    // nothing to split out of it.
    const spansBreak = startMinutes <= LONG_BREAK_START_MINUTES && endMinutes >= LONG_BREAK_END_MINUTES;
    if (!spansBreak) {
        return [{ startMinutes, endMinutes }];
    }

    const beforeEnd = Math.min(endMinutes, LONG_BREAK_START_MINUTES);
    const afterStart = Math.max(startMinutes, LONG_BREAK_END_MINUTES);

    const segments = [];
    if (beforeEnd - startMinutes >= MIN_USABLE_SEGMENT_MINUTES) {
        segments.push({ startMinutes, endMinutes: beforeEnd });
    }
    if (endMinutes - afterStart >= MIN_USABLE_SEGMENT_MINUTES) {
        segments.push({ startMinutes: afterStart, endMinutes });
    }

    // Both sides too small to bother with (e.g. someone's only free time IS
    // 6:00-7:30pm) - keep the original window rather than losing the day.
    if (segments.length === 0) {
        return [{ startMinutes, endMinutes }];
    }
    return segments;
}

const MINUTES_PER_DAY = 1440;

// Build one or more SLOTs per study day for the next DAYS_TO_PLAN days
// starting today (dayIndex 0), each day with its own hours (day_schedule) and
// split around dinner (splitAroundLongBreak()).
//
// A window that ends before it starts runs past midnight (e.g. 8:30pm-2am).
// The whole night stays on its study day - same date, same daily limit - with
// times past midnight counted on from 24:00 (so a session can run across
// midnight), and stops where the next day's own hours begin. Nothing is
// scheduled earlier today than the current time; last night's window still
// counts for whatever of it is left after midnight.
function buildSlotsAndDateMap(preferences, clock) {
    const studyDays = new Set(
        (preferences.study_days || '')
            .split(',')
            .map((d) => d.trim())
            .filter(Boolean)
    );

    const dateFor = (dayIndex) => {
        const date = new Date(clock.today);
        date.setDate(date.getDate() + dayIndex);
        return date;
    };

    // A day's window in minutes (end past 1440 if it runs past midnight), or
    // null for a day off.
    const windowFor = (dayIndex) => {
        const dayLabel = dateFor(dayIndex).toLocaleDateString('en-US', { weekday: 'long' });
        if (studyDays.size > 0 && !studyDays.has(dayLabel)) return null;
        const hours = getDayWindow(preferences, dayLabel);
        const start = timeToMinutes(hours.start);
        let end = timeToMinutes(hours.end);
        if (end < start) end += MINUTES_PER_DAY;
        return { dayLabel, start, end };
    };

    const dateByDayIndex = new Map();
    for (let dayIndex = -1; dayIndex < DAYS_TO_PLAN; dayIndex++) {
        dateByDayIndex.set(dayIndex, formatDate(dateFor(dayIndex)));
    }

    const earliestToday = Math.ceil(clock.nowMinutes / 5) * 5;
    const slots = [];

    for (let dayIndex = -1; dayIndex < DAYS_TO_PLAN; dayIndex++) {
        const window = windowFor(dayIndex);
        if (!window) continue;
        let { start, end } = window;

        const next = windowFor(dayIndex + 1);
        if (end > MINUTES_PER_DAY && next) end = Math.min(end, MINUTES_PER_DAY + next.start);

        // What's already past: today before now, and all of yesterday's
        // window up to now (after midnight).
        const pastUntil = dayIndex === -1 ? MINUTES_PER_DAY + earliestToday : dayIndex === 0 ? earliestToday : 0;
        start = Math.max(start, pastUntil);
        if (end <= start) continue;

        for (const seg of splitAroundLongBreak(start, end)) {
            slots.push({
                dayLabel: window.dayLabel,
                dayIndex,
                startMinutes: seg.startMinutes,
                endMinutes: seg.endMinutes
            });
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
            -- A PDF's deadline (set on the Materials page) applies to all of
            -- its sections unless a task has its own. Previously only the
            -- task's own deadline was read, so PDF deadlines were ignored.
            COALESCE(t.deadline, m.deadline) AS deadline,
            s.title,
            s.start_page,
            s.end_page,
            s.estimated_minutes,
            s.difficulty,
            s.material_id,
            s.minutes_customized,
            s.course_id
        FROM tasks t
        JOIN sections s ON s.id = t.section_id
        JOIN courses c ON c.id = s.course_id
        LEFT JOIN materials m ON m.id = s.material_id
        WHERE c.user_id = ? AND t.status != 'Completed'
        ORDER BY t.priority DESC
    `).all(userId);
}

function daysUntil(deadline, today) {
    if (!deadline) return 30; // no deadline set - treat as not urgent
    // "YYYY-MM-DD" as a local calendar date (new Date("2026-09-14") would be
    // midnight UTC, a day off in some time zones).
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(deadline));
    const due = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date(deadline);
    if (Number.isNaN(due.getTime())) return 30;
    const diffMs = due.getTime() - today.getTime();
    return Math.round(diffMs / (1000 * 60 * 60 * 24)); // may be negative if overdue
}

// Run cpp_engine/scheduler.exe: pipe CONFIG/TASK/SLOT lines in, read
// scheduled sessions (key=value) back out - same Node<->C++ boundary
// convention as runSectionTaskManager() in materials.js.
function runScheduler({ preferences, tasks, slots, today }) {
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
            daysUntil(task.deadline, today),
            task.difficulty || 1,
            task.start_page ?? -1,
            task.end_page ?? -1,
            // Same-material tasks (same PDF) must stay in page order - see
            // buildStreams() in scheduler.cpp. Empty
            // string (not 0/null) so a task with no material never
            // "matches" another one that also has no material.
            task.material_id != null ? task.material_id : '',
            // 1 = the user set this duration themselves, so the engine keeps
            // it exact (full sessions + a shorter last one) instead of
            // rounding to whole sessions. Custom tasks (no material) always
            // count, including ones created before minutes_customized existed.
            (task.minutes_customized || task.material_id == null) ? 1 : 0,
            // A course's PDFs are scheduled one after another, in upload
            // order - one lecture file finished before the next starts.
            task.course_id != null ? task.course_id : ''
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
        const [preferences, tasks] = await Promise.all([getPreferences(userId), getPendingTasks(userId)]);
        const clock = readClock(req.body);
        const { slots, dateByDayIndex } = buildSlotsAndDateMap(preferences, clock);

        if (tasks.length === 0) {
            return res.json({ success: true, message: 'No pending tasks to schedule.', schedule: [], warnings: [] });
        }

        const { sessions, warnings } = runScheduler({ preferences, tasks, slots, today: clock.today });

        const replace = db.transaction(async (tx) => {
            // Clear only this user's existing schedule rows before
            // rebuilding - never touches other users' schedules.
            await tx.prepare(`
                DELETE FROM schedules
                WHERE task_id IN (
                    SELECT t.id
                    FROM tasks t
                    JOIN sections s ON s.id = t.section_id
                    JOIN courses c ON c.id = s.course_id
                    WHERE c.user_id = ?
                )
            `).run(userId);

            const rows = sessions.map((s) => ({
                task_id: s.task_id,
                date: dateByDayIndex.get(s.day_index) || null,
                start_time: minutesToTime(s.start_minutes),
                end_time: minutesToTime(s.end_minutes),
                start_page: s.start_page >= 0 ? s.start_page : null,
                end_page: s.end_page >= 0 ? s.end_page : null,
                part: s.part,
                total_parts: s.total_parts
            }));

            // Every new session in one database round trip, not one each.
            const results = await tx.batch(rows.map((r) => ({
                sql: `INSERT INTO schedules (task_id, date, start_time, end_time, start_page, end_page)
                      VALUES (?, ?, ?, ?, ?, ?)`,
                args: [r.task_id, r.date, r.start_time, r.end_time, r.start_page, r.end_page]
            })));

            return rows.map((r, i) => ({ id: results[i].lastInsertRowid, ...r }));
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
                m.filename AS material_name,
                c.id AS course_id,
                c.name AS course_name,
                c.color AS course_color,
                t.status AS task_status,
                t.priority
            FROM schedules sch
            JOIN tasks t ON t.id = sch.task_id
            JOIN sections s ON s.id = t.section_id
            JOIN courses c ON c.id = s.course_id
            LEFT JOIN materials m ON m.id = s.material_id
            WHERE c.user_id = ?
            ORDER BY sch.date ASC, sch.start_time ASC, sch.id ASC
        `).all(req.user.id);

        res.json({ success: true, schedule: rows });
    } catch (error) {
        console.error('Get schedule error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// Up to 47:59 - times after midnight of a study night count on from 24:00.
const TIME_PATTERN = /^([0-3]\d|4[0-7]):[0-5]\d$/;

// ==========================================
// PUT /api/schedule/:id
// Manually move or resize one scheduled session - for when the
// C++-generated time just doesn't work and the user would rather adjust
// it directly than regenerate the whole week. date/start_time/end_time
// are all optional; whichever are omitted keep their current value.
// ==========================================
router.put('/:id', async (req, res) => {
    try {
        const scheduleId = Number(req.params.id);
        if (!scheduleId) {
            return res.status(400).json({ success: false, error: 'Invalid schedule ID' });
        }

        const existing = await db.prepare(`
            SELECT sch.id, sch.date, sch.start_time, sch.end_time, c.user_id AS owner_user_id
            FROM schedules sch
            JOIN tasks t ON t.id = sch.task_id
            JOIN sections s ON s.id = t.section_id
            JOIN courses c ON c.id = s.course_id
            WHERE sch.id = ?
        `).get(scheduleId);

        // Same 404 whether the schedule entry doesn't exist or just isn't
        // this user's - don't reveal that an ID belongs to someone else.
        if (!existing || existing.owner_user_id !== req.user.id) {
            return res.status(404).json({ success: false, error: `Schedule entry ${scheduleId} does not exist` });
        }

        const body = req.body || {};
        const date = body.date !== undefined ? String(body.date) : existing.date;
        const startTime = body.start_time !== undefined ? String(body.start_time) : existing.start_time;
        const endTime = body.end_time !== undefined ? String(body.end_time) : existing.end_time;

        if (!DATE_PATTERN.test(date)) {
            return res.status(400).json({ success: false, error: 'date must be in YYYY-MM-DD format.' });
        }
        if (!TIME_PATTERN.test(startTime) || !TIME_PATTERN.test(endTime)) {
            return res.status(400).json({ success: false, error: 'start_time/end_time must be in 24-hour HH:MM format.' });
        }
        if (startTime >= endTime) {
            return res.status(400).json({ success: false, error: 'end_time must be after start_time.' });
        }

        await db.prepare(`
            UPDATE schedules SET date = ?, start_time = ?, end_time = ? WHERE id = ?
        `).run(date, startTime, endTime, scheduleId);

        res.json({
            success: true,
            message: 'Session time updated successfully',
            schedule: { id: scheduleId, date, start_time: startTime, end_time: endTime }
        });
    } catch (error) {
        console.error('Update schedule entry error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
