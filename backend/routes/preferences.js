// backend/routes/preferences.js
//
// Per-user preferences, currently just dark_mode. Backs frontend/javascript/
// theme.js: GET on page load to sync the toggle, PUT when the user flips it.
// A user with no user_preferences row yet (most existing accounts - that
// row has historically only been created by the interview/schedule flow)
// gets sensible defaults back instead of a 404, and PUT creates the row on
// first write rather than requiring it to already exist.

const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();

const dbPath = path.join(__dirname, '../../database/studygps.db');
const db = new Database(dbPath);

router.use(requireAuth);

const DEFAULTS = {
    study_days: 'Monday,Tuesday,Wednesday,Thursday,Friday',
    preferred_start: '18:00',
    preferred_end: '21:00',
    session_length: 50,
    break_length: 10,
    max_daily_minutes: 120,
    dark_mode: 0
};

function shapeRow(row) {
    const merged = { ...DEFAULTS, ...(row || {}) };
    return {
        study_days: merged.study_days || DEFAULTS.study_days,
        preferred_start: merged.preferred_start || DEFAULTS.preferred_start,
        preferred_end: merged.preferred_end || DEFAULTS.preferred_end,
        session_length: merged.session_length || DEFAULTS.session_length,
        break_length: merged.break_length ?? DEFAULTS.break_length,
        max_daily_minutes: merged.max_daily_minutes || DEFAULTS.max_daily_minutes,
        dark_mode: !!merged.dark_mode
    };
}

// GET /api/preferences
// Returns the full set of study-time preferences (used by schedule.html's
// hours editor) plus dark_mode (used by theme.js) - defaults filled in for
// any user who hasn't saved preferences yet.
router.get('/', (req, res) => {
    try {
        const row = db.prepare(`
            SELECT study_days, preferred_start, preferred_end, session_length, break_length, max_daily_minutes, dark_mode
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
// preferred_end, session_length, break_length, max_daily_minutes } and
// merges it into the user's existing row (creating one on first write).
// study_days may be sent as an array (["Monday", "Tuesday"]) or a
// pre-joined CSV string - schedule.js's scheduler input reads it as CSV.
router.put('/', (req, res) => {
    try {
        const userId = req.user.id;

        const existing = db.prepare(`
            SELECT study_days, preferred_start, preferred_end, session_length, break_length, max_daily_minutes, dark_mode
            FROM user_preferences WHERE user_id = ?
        `).get(userId);

        const current = shapeRow(existing);
        const body = req.body || {};

        const next = {
            study_days: Array.isArray(body.study_days) ? body.study_days.join(',') : (body.study_days ?? current.study_days),
            preferred_start: body.preferred_start ?? current.preferred_start,
            preferred_end: body.preferred_end ?? current.preferred_end,
            session_length: body.session_length != null ? Number(body.session_length) : current.session_length,
            break_length: body.break_length != null ? Number(body.break_length) : current.break_length,
            max_daily_minutes: body.max_daily_minutes != null ? Number(body.max_daily_minutes) : current.max_daily_minutes,
            dark_mode: body.dark_mode != null ? (body.dark_mode ? 1 : 0) : (current.dark_mode ? 1 : 0)
        };

        if (existing) {
            db.prepare(`
                UPDATE user_preferences
                SET study_days = ?, preferred_start = ?, preferred_end = ?,
                    session_length = ?, break_length = ?, max_daily_minutes = ?, dark_mode = ?
                WHERE user_id = ?
            `).run(
                next.study_days, next.preferred_start, next.preferred_end,
                next.session_length, next.break_length, next.max_daily_minutes, next.dark_mode,
                userId
            );
        } else {
            db.prepare(`
                INSERT INTO user_preferences
                    (user_id, study_days, preferred_start, preferred_end, session_length, break_length, max_daily_minutes, dark_mode)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                userId, next.study_days, next.preferred_start, next.preferred_end,
                next.session_length, next.break_length, next.max_daily_minutes, next.dark_mode
            );
        }

        res.json({ success: true, ...shapeRow(next) });
    } catch (error) {
        console.error('Update preferences error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
