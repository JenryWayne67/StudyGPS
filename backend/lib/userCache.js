// backend/lib/userCache.js
//
// A short-lived in-memory copy of user rows for passport.deserializeUser
// (server.js), which runs on EVERY logged-in request - re-reading `users`
// each time added a database round trip to every API call. Entries live for
// a minute; anything that changes a user row calls forgetCachedUser() so the
// change shows up right away. Render runs this app as a single process, so
// this memory is the only copy that can go stale.

const USER_CACHE_MS = 60 * 1000;
const CACHE_LIMIT = 5000;
const cache = new Map(); // id -> { user, at }

function getCachedUser(id) {
    const entry = cache.get(id);
    return entry && Date.now() - entry.at < USER_CACHE_MS ? entry.user : null;
}

function cacheUser(id, user) {
    cache.delete(id);
    cache.set(id, { user, at: Date.now() });
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
}

function forgetCachedUser(id) {
    cache.delete(id);
}

module.exports = { getCachedUser, cacheUser, forgetCachedUser };
