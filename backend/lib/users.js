// backend/lib/users.js
//
// Shared helper: turn a Google (or Google-shaped, for dev-login) profile
// into a real row in the `users` table, creating it on first sign-in and
// keeping it updated on every sign-in after that. Used by both the real
// Google OAuth strategy and the dev-login fallback in server.js /
// backend/routes/auth.js, so both paths store users the same way.

function upsertGoogleUser(db, { googleId, name, email }) {
    let user = db.prepare(`SELECT * FROM users WHERE google_id = ?`).get(googleId);

    // Fall back to matching by email in case this user already exists
    // (e.g. seeded manually) without a google_id attached yet.
    if (!user && email) {
        user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email);
    }

    if (user) {
        db.prepare(`UPDATE users SET google_id = ?, name = ? WHERE id = ?`)
            .run(googleId, name, user.id);
        return db.prepare(`SELECT * FROM users WHERE id = ?`).get(user.id);
    }

    const info = db.prepare(`
        INSERT INTO users (google_id, name, email)
        VALUES (?, ?, ?)
    `).run(googleId, name, email);

    return db.prepare(`SELECT * FROM users WHERE id = ?`).get(info.lastInsertRowid);
}

module.exports = { upsertGoogleUser };
