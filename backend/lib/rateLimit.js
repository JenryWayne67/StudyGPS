// backend/lib/rateLimit.js
//
// Minimal in-memory rate limiter - no new npm dependency. Good enough to
// blunt basic password-guessing/brute-force against /login and /signup on
// a single-process deployment. Keyed by IP + route name.
//
// NOTE: state lives in process memory, so it resets on restart and isn't
// shared across multiple processes/instances. That's an acceptable
// trade-off here (no dependency, no extra infra) but worth knowing if
// this is ever scaled horizontally - a real deployment would move this
// to a shared store (e.g. Redis) instead.

const buckets = new Map();

// Periodically forget old buckets so this can't grow unbounded over a
// long-running process.
setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
        if (now - bucket.windowStart > 60 * 60 * 1000) {
            buckets.delete(key);
        }
    }
}, 15 * 60 * 1000).unref();

function rateLimit({ windowMs, max, keyPrefix }) {
    return (req, res, next) => {
        const ip = req.ip || req.connection?.remoteAddress || 'unknown';
        const key = `${keyPrefix}:${ip}`;
        const now = Date.now();

        let bucket = buckets.get(key);
        if (!bucket || now - bucket.windowStart > windowMs) {
            bucket = { windowStart: now, count: 0 };
            buckets.set(key, bucket);
        }

        bucket.count += 1;

        if (bucket.count > max) {
            const retryAfterSeconds = Math.ceil((bucket.windowStart + windowMs - now) / 1000);
            res.set('Retry-After', String(Math.max(retryAfterSeconds, 1)));
            return res.status(429).json({
                error: 'Too many attempts. Please wait a bit before trying again.'
            });
        }

        next();
    };
}

module.exports = { rateLimit };
