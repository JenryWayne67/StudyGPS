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
        // Link the google_id (in case this was an email/password account
        // signing in with Google for the first time), but never overwrite
        // a name the person has already set - Google's displayName isn't
        // more authoritative than a name they typed into the interview.
        db.prepare(`UPDATE users SET google_id = ? WHERE id = ?`)
            .run(googleId, user.id);
        return db.prepare(`SELECT * FROM users WHERE id = ?`).get(user.id);
    }

    const info = db.prepare(`
        INSERT INTO users (google_id, name, email)
        VALUES (?, ?, ?)
    `).run(googleId, name, email);

    return db.prepare(`SELECT * FROM users WHERE id = ?`).get(info.lastInsertRowid);
}

function findUserByEmail(db, email) {
    return db.prepare(`SELECT * FROM users WHERE email = ?`).get(email);
}

function findUserById(db, id) {
    return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
}

// Create a new email/password account. Callers must already have checked
// findUserByEmail() for a collision - this always inserts.
function createLocalUser(db, { name, email, passwordHash }) {
    const info = db.prepare(`
        INSERT INTO users (name, email, password_hash)
        VALUES (?, ?, ?)
    `).run(name, email, passwordHash);

    return db.prepare(`SELECT * FROM users WHERE id = ?`).get(info.lastInsertRowid);
}

// The subset of a user row that's safe to send to the client / put in the
// session - never include password_hash.
function toPublicUser(user) {
    if (!user) return null;
    const { id, google_id, name, email } = user;
    return { id, google_id, name, email };
}

// A user has "completed onboarding" once they have a user_preferences row -
// the interview page is what creates that row (via PUT /api/preferences),
// so its existence is the signal that they've been through the interview
// at least once before. First-time sign-ups/sign-ins (no row yet) get sent
// to the interview; everyone else skips straight to the dashboard.
function hasCompletedOnboarding(db, userId) {
    const row = db.prepare(`SELECT 1 FROM user_preferences WHERE user_id = ?`).get(userId);
    return !!row;
}

// Let a user set/change their display name (e.g. from the interview page,
// where a Google sign-in's name can be edited or a dev/demo name replaced).
function updateUserName(db, userId, name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return findUserById(db, userId);
    db.prepare(`UPDATE users SET name = ? WHERE id = ?`).run(trimmed, userId);
    return findUserById(db, userId);
}

module.exports = {
    upsertGoogleUser,
    findUserByEmail,
    findUserById,
    createLocalUser,
    toPublicUser,
    hasCompletedOnboarding,
    updateUserName
};
