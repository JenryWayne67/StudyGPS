// backend/lib/sessionStore.js
//
// A persistent, Turso-backed express-session store.
//
// Without this, express-session falls back to its built-in MemoryStore -
// which keeps every logged-in session only in the Node process's RAM.
// That's fine for local dev, but on a host like Render every redeploy,
// restart, or (on the free/hobby tier) the dyno simply going to sleep on
// inactivity wipes that memory - so everyone gets silently logged out,
// even though their actual account data in Turso was never touched. That
// silent, unexplained "you got logged out for no reason" is exactly the
// auto-logout behavior real websites don't have, because real websites
// store sessions somewhere durable. This does the same thing the rest of
// this app already does for real data: store it in Turso via the same
// `client` used everywhere else (see backend/lib/db.js), so a session
// survives a restart exactly like a task or a course does.
//
// Implements the handful of methods express-session's Store base class
// expects (get/set/destroy/touch) - see
// https://github.com/expressjs/session#session-store-implementation

const { Store } = require('express-session');

class TursoSessionStore extends Store {
    constructor(client) {
        super();
        this.client = client;
    }

    async get(sid, callback) {
        try {
            const res = await this.client.execute({
                sql: `SELECT sess, expires FROM sessions WHERE sid = ?`,
                args: [sid]
            });
            const row = res.rows[0];
            if (!row) return callback(null, null);

            if (row.expires != null && Number(row.expires) < Date.now()) {
                // Expired - clean it up lazily instead of relying on a
                // separate sweep job, and report it as "no session" (not
                // an error) so the request is simply treated as signed out.
                await this.client.execute({ sql: `DELETE FROM sessions WHERE sid = ?`, args: [sid] });
                return callback(null, null);
            }

            callback(null, JSON.parse(row.sess));
        } catch (err) {
            callback(err);
        }
    }

    async set(sid, session, callback) {
        try {
            const expires = session.cookie && session.cookie.expires
                ? new Date(session.cookie.expires).getTime()
                : Date.now() + 24 * 60 * 60 * 1000; // defensive fallback only
            const sess = JSON.stringify(session);

            await this.client.execute({
                sql: `INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?)
                      ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires`,
                args: [sid, sess, expires]
            });

            if (callback) callback(null);
        } catch (err) {
            if (callback) callback(err);
        }
    }

    // Called on every authenticated request when `rolling: true` re-issues
    // the cookie's expiry - just re-saves with the session's (now later)
    // cookie.expires, same as set().
    async touch(sid, session, callback) {
        return this.set(sid, session, callback);
    }

    async destroy(sid, callback) {
        try {
            await this.client.execute({ sql: `DELETE FROM sessions WHERE sid = ?`, args: [sid] });
            if (callback) callback(null);
        } catch (err) {
            if (callback) callback(err);
        }
    }
}

module.exports = { TursoSessionStore };
