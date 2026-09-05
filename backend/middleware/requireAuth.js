// backend/middleware/requireAuth.js
//
// Gate for every per-user API route (courses, materials, tasks,
// study-sessions). Rejects with 401 JSON instead of redirecting, because
// these are called via fetch() from the frontend pages, not navigated to
// directly - the frontend's own auth check (see javascript/theme.js /
// each page's init) is what sends a signed-out visitor to /login.
function requireAuth(req, res, next) {
    if (req.isAuthenticated && req.isAuthenticated()) {
        return next();
    }
    return res.status(401).json({ success: false, error: 'You must be logged in.' });
}

module.exports = { requireAuth };
