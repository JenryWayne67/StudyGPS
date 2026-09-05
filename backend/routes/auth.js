const express = require('express');
const path = require('path');
const passport = require('passport');
const Database = require('better-sqlite3');
const { upsertGoogleUser, findUserByEmail, createLocalUser, toPublicUser, hasCompletedOnboarding, updateUserName } = require('../lib/users');
const { hashPassword, verifyPassword } = require('../lib/passwords');
const { rateLimit } = require('../lib/rateLimit');

const router = express.Router();

const dbPath = path.join(__dirname, '../../database/studygps.db');
const db = new Database(dbPath);

// Real values only ever come from .env now (see .env.example) - no secret
// literals live in source anymore.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';

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
            <a href="/index.html" class="text-xs text-slate-500 hover:underline">
              Back to Login
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
      res.redirect(hasCompletedOnboarding(db, dbUser.id) ? '/dashboard.html' : '/interview.html');
    });
  } catch (error) {
    console.error('Dev login error:', error);
    res.redirect('/index.html');
  }
});

const authAttemptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  keyPrefix: 'auth'
});

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Email/password signup - creates a real row in `users` alongside the
// Google-login path (upsertGoogleUser). A user can also later "link"
// Google to the same email via upsertGoogleUser's email-match fallback.
router.post('/signup', authAttemptLimiter, (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are all required.' });
    }
    if (!EMAIL_PATTERN.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const existing = findUserByEmail(db, email);
    if (existing) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }

    const passwordHash = hashPassword(password);
    const dbUser = createLocalUser(db, { name, email, passwordHash });

    req.login(dbUser, (err) => {
      if (err) return res.status(500).json({ error: 'Account created, but login failed. Please try logging in.' });
      // A brand-new signup never has a preferences row yet, so this is
      // always true - but compute it the same way as everywhere else
      // rather than hardcoding, in case that ever changes.
      res.status(201).json({ user: toPublicUser(dbUser), needsInterview: !hasCompletedOnboarding(db, dbUser.id) });
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Something went wrong creating your account.' });
  }
});

// Email/password login
router.post('/login', authAttemptLimiter, (req, res) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const dbUser = findUserByEmail(db, email);

    // Same generic error whether the email doesn't exist or the password
    // doesn't match, and whether the account has no password set (e.g. a
    // Google-only account) - don't leak which case it was.
    if (!dbUser || !verifyPassword(password, dbUser.password_hash)) {
      return res.status(401).json({ error: 'Incorrect email or password.' });
    }

    req.login(dbUser, (err) => {
      if (err) return res.status(500).json({ error: 'Login failed. Please try again.' });
      res.json({ user: toPublicUser(dbUser), needsInterview: !hasCompletedOnboarding(db, dbUser.id) });
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Something went wrong logging in.' });
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
    // First-time sign-ins (no user_preferences row yet) go through the
    // interview so we can capture their name/study preferences before the
    // scheduler needs them; returning users skip straight to the dashboard.
    res.redirect(hasCompletedOnboarding(db, req.user.id) ? '/dashboard.html' : '/interview.html');
  }
);

// Update the logged-in user's display name (used by the interview page,
// which lets a person confirm/edit the name pulled from Google or typed
// during signup before it's saved for good).
router.put('/me/name', (req, res) => {
  if (!(req.isAuthenticated && req.isAuthenticated())) {
    return res.status(401).json({ error: 'Not logged in.' });
  }
  const name = (req.body.name || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'Name is required.' });
  }
  const updated = updateUserName(db, req.user.id, name);
  res.json({ user: toPublicUser(updated) });
});

// Get Currently Logged-In User
router.get('/me', (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    res.json({
      loggedIn: true,
      user: toPublicUser(req.user),
      needsInterview: !hasCompletedOnboarding(db, req.user.id)
    });
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
