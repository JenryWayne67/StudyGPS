require('./backend/lib/env'); // loads .env into process.env before anything below reads it

const express = require('express');
const cors = require('cors');

const app = express();
// Render (and most hosts) assign the port at runtime via $PORT and expect
// the app to listen on exactly that port - hardcoding 3000 would make the
// deployed service unreachable. Local dev has no PORT set, so it still
// falls back to 3000 exactly as before.
const PORT = process.env.PORT || 3000;


app.use(cors());


const path = require('path');
const fs = require('fs');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { db, client } = require('./backend/lib/db');
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

// On a database that's ever empty at startup - a brand-new Turso database
// on first deploy, or (previously) Render's ephemeral local-disk fallback -
// "does the users table already exist" has to be checked every time the
// server boots, not assumed. Without this, a fresh/empty database means
// every single query in the app fails with "no such table: users" instead
// of the app just working again with an empty database.
async function ensureSchema() {
  const usersTable = await db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'`
  ).get();

  if (!usersTable) {
    const schemaPath = path.join(__dirname, 'database/schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    await client.executeMultiple(schemaSql);
    console.log('Database schema initialized (empty/fresh database detected).');
    return;
  }

  // Existing database (e.g. the real local studygps.db from before this
  // upgrade) - it has a `users` table already, but may predate columns
  // schema.sql has grown since. Add anything missing rather than
  // requiring a full reset, so real existing data is never at risk.
  await migrateExistingDatabase();
}

// Lightweight, additive migrations for a database created by an older
// version of schema.sql. Each one only runs if it hasn't already.
async function migrateExistingDatabase() {
  const materialsCols = await client.execute(`PRAGMA table_info(materials)`);
  const columnNames = materialsCols.rows.map((r) => r.name);

  if (!columnNames.includes('file_data')) {
    await client.execute(`ALTER TABLE materials ADD COLUMN file_data BLOB`);
    console.log('Migrated: added materials.file_data column.');
  }

  const prefCols = await client.execute(`PRAGMA table_info(user_preferences)`);
  const prefColumnNames = prefCols.rows.map((r) => r.name);

  if (!prefColumnNames.includes('day_schedule')) {
    await client.execute(`ALTER TABLE user_preferences ADD COLUMN day_schedule TEXT`);
    console.log('Migrated: added user_preferences.day_schedule column.');
  }

  // Backfill: materials uploaded before this change have their PDF bytes
  // on disk at the old file_path, not in the database yet. Read each one
  // in now so existing uploads (re-analyze, etc.) keep working without
  // the user having to re-upload everything. Best-effort - a file that's
  // moved or missing just logs a warning instead of blocking startup.
  const legacyMaterials = await db.prepare(`
    SELECT id, file_path FROM materials WHERE file_path IS NOT NULL AND file_data IS NULL
  `).all();

  for (const m of legacyMaterials) {
    try {
      if (fs.existsSync(m.file_path)) {
        const bytes = fs.readFileSync(m.file_path);
        await db.prepare(`UPDATE materials SET file_data = ? WHERE id = ?`).run(bytes, m.id);
      } else {
        console.warn(`Migration: material ${m.id}'s old file (${m.file_path}) no longer exists on disk - it will need to be re-uploaded.`);
      }
    } catch (err) {
      console.warn(`Migration: couldn't backfill material ${m.id} from ${m.file_path}:`, err.message);
    }
  }

  if (legacyMaterials.length > 0) {
    console.log(`Migrated ${legacyMaterials.length} existing material(s) from disk into the database.`);
  }
}

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
  db.prepare(`SELECT id, google_id, name, email FROM users WHERE id = ?`).get(id)
    .then((dbUser) => done(null, dbUser || null))
    .catch((err) => done(err));
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
        upsertGoogleUser(db, {
          googleId: profile.id,
          name: profile.displayName || 'Google User',
          email: (profile.emails && profile.emails[0] && profile.emails[0].value) || null
        })
          .then((dbUser) => done(null, dbUser))
          .catch((err) => done(err));
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

// The server only starts accepting requests once the database schema is
// confirmed to exist - on a brand-new Turso database (first deploy, or a
// fresh free-tier account) there's no `users` table yet until this runs,
// and every route ultimately depends on it.
async function start() {
  await ensureSchema();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`StudyGPS server running on http://0.0.0.0:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start StudyGPS server:', err);
  process.exit(1);
});
