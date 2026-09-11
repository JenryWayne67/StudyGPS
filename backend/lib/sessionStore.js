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
// Speed: every logged-in request used to cost two extra database round
// trips here - reading the session, then (because of `rolling: true`)
// writing it back just to push its expiry forward. Sessions are now also
// kept in memory: a read is served from memory when this process already
// has the session, and a pure expiry refresh (touch) only goes to the
// database once a day per session. The database stays the durable copy, so
// a restart still keeps everyone logged in. Render runs this app as a
// single process, so this memory can't disagree with another server; if
// the app is ever scaled to more than one instance, drop the cache first.
//
// Implements the handful of methods express-session's Store base class
// expects (get/set/destroy/touch) - see
// https://github.com/expressjs/session#session-store-implementation

const { Store } = require('express-session');

const CACHE_LIMIT = 5000;
const TOUCH_WRITE_INTERVAL_MS = 24 * 60 * 60 * 1000;

function expiresOf(session) {
    return session.cookie && session.cookie.expires
        ? new Date(session.cookie.expires).getTime()
        : Date.now() + 24 * 60 * 60 * 1000; // defensive fallback only
}

class TursoSessionStore extends Store {
    constructor(client) {
        super();
        this.client = client;
        this.cache = new Map(); // sid -> { json, expires, writtenAt }
    }

    remember(sid, json, expires, writtenAt) {
        this.cache.delete(sid); // re-insert so the Map's order is least-recently-used first
        this.cache.set(sid, { json, expires, writtenAt });
        if (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value);
    }

    async get(sid, callback) {
        try {
            const cached = this.cache.get(sid);
            if (cached && (cached.expires == null || cached.expires >= Date.now())) {
                return callback(null, JSON.parse(cached.json));
            }
            this.cache.delete(sid);

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

            this.remember(sid, row.sess, row.expires == null ? null : Number(row.expires), Date.now());
            callback(null, JSON.parse(row.sess));
        } catch (err) {
            callback(err);
        }
    }

    async set(sid, session, callback) {
        try {
            const expires = expiresOf(session);
            const sess = JSON.stringify(session);

            await this.client.execute({
                sql: `INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?)
                      ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires`,
                args: [sid, sess, expires]
            });
            this.remember(sid, sess, expires, Date.now());

            if (callback) callback(null);
        } catch (err) {
            if (callback) callback(err);
        }
    }

    // Called on every authenticated request when `rolling: true` re-issues
    // the cookie's expiry. The session itself hasn't changed (set() handles
    // that), only its expiry - which is 400 days out, so writing the new
    // one to the database once a day is plenty.
    async touch(sid, session, callback) {
        const cached = this.cache.get(sid);
        if (cached && Date.now() - cached.writtenAt < TOUCH_WRITE_INTERVAL_MS) {
            cached.expires = expiresOf(session);
            if (callback) callback(null);
            return;
        }
        return this.set(sid, session, callback);
    }

    async destroy(sid, callback) {
        try {
            this.cache.delete(sid);
            await this.client.execute({ sql: `DELETE FROM sessions WHERE sid = ?`, args: [sid] });
            if (callback) callback(null);
        } catch (err) {
            if (callback) callback(err);
        }
    }
}

module.exports = { TursoSessionStore };
