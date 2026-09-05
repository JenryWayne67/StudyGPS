const express = require('express');
const path = require('path');
const passport = require('passport');
const Database = require('better-sqlite3');
const { upsertGoogleUser } = require('../lib/users');

const router = express.Router();

const dbPath = path.join(__dirname, '../../database/studygps.db');
const db = new Database(dbPath);

// Middleware to check if Google Strategy is configured
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '817397034800-uruk0oe4n0f33au5nmm4uvlunutu6mge.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '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';

const ensureGoogleConfigured = (req, res, next) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    // If not configured yet, provide helpful message or dev preview demo login
    return res.status(503).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Google OAuth Configuration Needed</title>
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body class="bg-slate-50 flex items-center justify-center min-h-screen p-4 font-sans text-slate-800">
        <div class="max-w-md w-full bg-white p-6 rounded-2xl shadow-sm border border-slate-200 text-center space-y-4">
          <div class="w-12 h-12 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center mx-auto text-xl font-bold">!</div>
          <h2 class="text-lg font-bold text-slate-900">Google OAuth Credentials Required</h2>
          <p class="text-xs text-slate-600 leading-relaxed">
            To use Google Login, please set <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> in the project settings or <code>.env</code>.
          </p>
          <div class="pt-2 flex flex-col gap-2">
            <a href="/api/auth/dev-login" class="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold py-2.5 px-4 rounded-xl transition">
              Continue with Demo Student Account &rarr;
            </a>
            <a href="/onboarding.html" class="text-xs text-slate-500 hover:underline">
              Back to Onboarding
            </a>
          </div>
        </div>
      </body>
      </html>
    `);
  }
  next();
};

// Dev fallback quick login for preview testing when credentials aren't set.
// Still goes through the same users-table upsert as real Google login, so
// it produces a real, persisted user - not just a session-only fake.
router.get('/dev-login', (req, res) => {
  try {
    const dbUser = upsertGoogleUser(db, {
      googleId: 'google-demo-101',
      name: 'Alex Morgan',
      email: 'alex.morgan@university.edu'
    });

    req.login(dbUser, (err) => {
      if (err) return res.redirect('/index.html');
      res.redirect('/dashboard.html');
    });
  } catch (error) {
    console.error('Dev login error:', error);
    res.redirect('/index.html');
  }
});

// Trigger Google Login
router.get('/google', ensureGoogleConfigured, passport.authenticate('google', { 
  scope: ['profile', 'email'],
  prompt: 'select_account'
}));

// Google Callback Route
router.get('/google/callback', 
  ensureGoogleConfigured,
  passport.authenticate('google', { failureRedirect: '/index.html' }),
  (req, res) => {
    // Redirect to dashboard page after successful login
    res.redirect('/dashboard.html');
  }
);

// Get Currently Logged-In User
router.get('/me', (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    res.json({ loggedIn: true, user: req.user });
  } else {
    res.status(401).json({ loggedIn: false });
  }
});

// Logout Route
router.get('/logout', (req, res, next) => {
  if (req.logout) {
    req.logout((err) => {
      if (err) return next(err);
      res.redirect('/index.html');
    });
  } else {
    res.redirect('/index.html');
  }
});

module.exports = router;
