require('./backend/lib/env'); // loads .env into process.env before anything below reads it

const express = require('express');
const cors = require('cors');

const app = express();
const PORT = 3000;


app.use(cors());


const path = require('path');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const Database = require('better-sqlite3');
const authRoutes = require('./backend/routes/auth');
const studySessionRoutes = require('./backend/routes/studySessions');
const courseRoutes = require('./backend/routes/courses');
const materialRoutes = require('./backend/routes/materials');
const taskRoutes = require('./backend/routes/tasks');
const preferencesRoutes = require('./backend/routes/preferences');
const scheduleRoutes = require('./backend/routes/schedule');
const progressRoutes = require('./backend/routes/progress');
const accountRoutes = require('./backend/routes/account');
const { upsertGoogleUser } = require('./backend/lib/users');
console.log('MATERIAL ROUTES TYPE:', typeof materialRoutes);
console.log('MATERIAL ROUTES:', materialRoutes);

const frontendPath = path.join(__dirname, 'frontend');
const dbPath = path.join(__dirname, 'database/studygps.db');
const db = new Database(dbPath);

// Trust reverse proxy for secure cookies and https URLs
app.set('trust proxy', 1);

// JSON and URL-encoded body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration
if (!process.env.SESSION_SECRET) {
  console.warn(
    '⚠️  SESSION_SECRET is not set (add it to .env) - falling back to an ' +
    'insecure default. Set a real, random SESSION_SECRET before deploying.'
  );
}

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'studygps_insecure_default_secret_change_me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: 'auto',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  })
);

// Initialize Passport and session
app.use(passport.initialize());
app.use(passport.session());

// Passport serialization - the session cookie only ever carries the
// database user id; every request re-reads the real row from `users`.
passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser((id, done) => {
  try {
    const dbUser = db.prepare(`SELECT id, google_id, name, email FROM users WHERE id = ?`).get(id);
    done(null, dbUser || null);
  } catch (err) {
    done(err);
  }
});

// Google OAuth credentials configuration - real values only ever come from
// .env now (see .env.example). No secret literals live in source anymore.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';

if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL || '/api/auth/google/callback',
        proxy: true
      },
      (accessToken, refreshToken, profile, done) => {
        // Turn the Google profile into (or match it to) a real row in
        // the `users` table - this is what actually makes login "real"
        // instead of just holding the OAuth profile in the cookie.
        try {
          const dbUser = upsertGoogleUser(db, {
            googleId: profile.id,
            name: profile.displayName || 'Google User',
            email: (profile.emails && profile.emails[0] && profile.emails[0].value) || null
          });
          return done(null, dbUser);
        } catch (err) {
          return done(err);
        }
      }
    )
  );
}

// Mount auth routes under /api/auth
app.use('/api/auth', authRoutes);

// Mount study session routes
app.use('/api/study-sessions', studySessionRoutes);

// Mount course routes
app.use('/api/courses', courseRoutes);

// Mount Material routes
app.use('/api/materials', materialRoutes);

// Mount Task routes
app.use('/api/tasks', taskRoutes);

// Mount Preferences routes (dark mode, etc.)
app.use('/api/preferences', preferencesRoutes);

// Mount Schedule routes (real generated study schedule)
app.use('/api/schedule', scheduleRoutes);

// Mount Progress routes (real weekly progress report)
app.use('/api/progress', progressRoutes);

// Mount Account routes (clear study data, etc.)
app.use('/api/account', accountRoutes);

// Serve static frontend assets
app.use(express.static(frontendPath));

// API health endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'StudyGPS' });
});

// Route aliases for clean navigation
app.get('/login', (req, res) => {
  res.sendFile(path.join(frontendPath, 'login.html'));
});

app.get('/interview', (req, res) => {
  res.sendFile(path.join(frontendPath, 'interview.html'));
});

app.get('/materials', (req, res) => {
  res.sendFile(path.join(frontendPath, 'materials.html'));
});

// GET /signup used to send interview.html (leftover from before login.html
// grew a real Sign Up tab) - the actual signup form lives on login.html
// (POST /api/auth/signup), so this alias now matches /login instead of
// pointing at a page with no signup form on it.
app.get('/signup', (req, res) => {
  res.sendFile(path.join(frontendPath, 'login.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(frontendPath, 'dashboard.html'));
});

app.get('/courses', (req, res) => {
  res.sendFile(path.join(frontendPath, 'materials.html'));
});

app.get('/tasks', (req, res) => {
  res.sendFile(path.join(frontendPath, 'tasks.html'));
});

app.get('/progress', (req, res) => {
  res.sendFile(path.join(frontendPath, 'progress.html'));
});

app.get('/schedule', (req, res) => {
  res.sendFile(path.join(frontendPath, 'schedule.html'));
});

app.get('/settings', (req, res) => {
  res.sendFile(path.join(frontendPath, 'settings.html'));
});

// Fallback for direct browser refresh or navigation
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`StudyGPS server running on http://0.0.0.0:${PORT}`);
});
