// backend/routes/preferences.js
//
// Per-user preferences: dark_mode, study days/times, and now a per-day
// schedule override (day_schedule) so "6:30-10:00pm on weekdays but
// 2:30-10:00pm on weekends" is actually stored, not collapsed into one
// flat start/end for every day. Backs frontend/javascript/theme.js (dark
// mode) and interview.html/settings.html (study hours).
//
// preferred_start/preferred_end remain as the fallback used for any
// study day that has no entry in day_schedule (e.g. an older client that
// never sent per-day times, or a day added to study_days without its own
// hours yet) - see backend/routes/schedule.js's getDayWindow().

const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { db } = require('../lib/db');

const router = express.Router();

router.use(requireAuth);

const DEFAULTS = {
    study_days: 'Monday,Tuesday,Wednesday,Thursday,Friday',
    preferred_start: '18:00',
    preferred_end: '21:00',
    day_schedule: {},
    session_length: 50,
    break_length: 10,
    max_daily_minutes: 120,
    dark_mode: 0,
    email_notifications: 0
};

function parseDaySchedule(raw) {
    if (!raw) return {};
    if (typeof raw === 'object') return raw; // already an object (e.g. from `current`)
    try {
        const parsed = JSON.parse(raw);
        return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (err) {
        return {};
    }
}

function shapeRow(row) {
    const merged = { ...DEFAULTS, ...(row || {}) };
    return {
        study_days: merged.study_days || DEFAULTS.study_days,
        preferred_start: merged.preferred_start || DEFAULTS.preferred_start,
        preferred_end: merged.preferred_end || DEFAULTS.preferred_end,
        day_schedule: parseDaySchedule(merged.day_schedule),
        session_length: merged.session_length || DEFAULTS.session_length,
        break_length: merged.break_length ?? DEFAULTS.break_length,
        max_daily_minutes: merged.max_daily_minutes || DEFAULTS.max_daily_minutes,
        dark_mode: !!merged.dark_mode,
        email_notifications: !!merged.email_notifications
    };
}

// GET /api/preferences
// Returns the full set of study-time preferences (used by schedule.html's
// hours editor) plus dark_mode (used by theme.js) - defaults filled in for
// any user who hasn't saved preferences yet. day_schedule is returned as a
// parsed object: { "Monday": { "start": "18:00", "end": "21:00" }, ... }.
router.get('/', async (req, res) => {
    try {
        const row = await db.prepare(`
            SELECT study_days, preferred_start, preferred_end, day_schedule, session_length, break_length, max_daily_minutes, dark_mode, email_notifications
            FROM user_preferences WHERE user_id = ?
        `).get(req.user.id);

        res.json({ success: true, ...shapeRow(row) });
    } catch (error) {
        console.error('Get preferences error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// PUT /api/preferences
// Accepts any subset of { dark_mode, study_days, preferred_start,
// preferred_end, day_schedule, session_length, break_length,
// max_daily_minutes } and merges it into the user's existing row
// (creating one on first write).
// study_days may be sent as an array (["Monday", "Tuesday"]) or a
// pre-joined CSV string - schedule.js's scheduler input reads it as CSV.
// day_schedule, when sent, should be an object keyed by day name with
// { start, end } in 24-hour "HH:MM" - any day not present falls back to
// preferred_start/preferred_end when the schedule is generated.
router.put('/', async (req, res) => {
    try {
        const userId = req.user.id;

        const existing = await db.prepare(`
            SELECT study_days, preferred_start, preferred_end, day_schedule, session_length, break_length, max_daily_minutes, dark_mode, email_notifications
            FROM user_preferences WHERE user_id = ?
        `).get(userId);

        const current = shapeRow(existing);
        const body = req.body || {};

        const next = {
            study_days: Array.isArray(body.study_days) ? body.study_days.join(',') : (body.study_days ?? current.study_days),
            preferred_start: body.preferred_start ?? current.preferred_start,
            preferred_end: body.preferred_end ?? current.preferred_end,
            day_schedule: body.day_schedule && typeof body.day_schedule === 'object' ? body.day_schedule : current.day_schedule,
            session_length: body.session_length != null ? Number(body.session_length) : current.session_length,
            break_length: body.break_length != null ? Number(body.break_length) : current.break_length,
            max_daily_minutes: body.max_daily_minutes != null ? Number(body.max_daily_minutes) : current.max_daily_minutes,
            dark_mode: body.dark_mode != null ? (body.dark_mode ? 1 : 0) : (current.dark_mode ? 1 : 0),
            email_notifications: body.email_notifications != null ? (body.email_notifications ? 1 : 0) : (current.email_notifications ? 1 : 0)
        };

        const daySchedJson = JSON.stringify(next.day_schedule || {});

        if (existing) {
            await db.prepare(`
                UPDATE user_preferences
                SET study_days = ?, preferred_start = ?, preferred_end = ?, day_schedule = ?,
                    session_length = ?, break_length = ?, max_daily_minutes = ?, dark_mode = ?, email_notifications = ?
                WHERE user_id = ?
            `).run(
                next.study_days, next.preferred_start, next.preferred_end, daySchedJson,
                next.session_length, next.break_length, next.max_daily_minutes, next.dark_mode, next.email_notifications,
                userId
            );
        } else {
            await db.prepare(`
                INSERT INTO user_preferences
                    (user_id, study_days, preferred_start, preferred_end, day_schedule, session_length, break_length, max_daily_minutes, dark_mode, email_notifications)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                userId, next.study_days, next.preferred_start, next.preferred_end, daySchedJson,
                next.session_length, next.break_length, next.max_daily_minutes, next.dark_mode, next.email_notifications
            );
        }

        res.json({ success: true, ...shapeRow(next) });
    } catch (error) {
        console.error('Update preferences error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
