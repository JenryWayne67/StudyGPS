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
const { TursoSessionStore } = require('./backend/lib/sessionStore');
const { getCachedUser, cacheUser, forgetCachedUser } = require('./backend/lib/userCache');
const authRoutes = require('./backend/routes/auth');
const studySessionRoutes = require('./backend/routes/studySessions');
const courseRoutes = require('./backend/routes/courses');
const materialRoutes = require('./backend/routes/materials');
const taskRoutes = require('./backend/routes/tasks');
const preferencesRoutes = require('./backend/routes/preferences');
const scheduleRoutes = require('./backend/routes/schedule');
const progressRoutes = require('./backend/routes/progress');
const accountRoutes = require('./backend/routes/account');
const notificationRoutes = require('./backend/routes/notifications');
const { upsertGoogleUser } = require('./backend/lib/users');
const { sendMail } = require('./backend/lib/mailer');
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

  if (!columnNames.includes('deadline')) {
    await client.execute(`ALTER TABLE materials ADD COLUMN deadline TEXT`);
    console.log('Migrated: added materials.deadline column.');
  }

  if (!columnNames.includes('extracted_text')) {
    await client.execute(`ALTER TABLE materials ADD COLUMN extracted_text TEXT`);
    console.log('Migrated: added materials.extracted_text column.');
  }

  // PDFs are stored in 1 MB pieces (see backend/lib/materialFiles.js)
  // instead of one huge materials.file_data value.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS material_file_chunks (
      material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      data BLOB NOT NULL,
      PRIMARY KEY (material_id, chunk_index)
    )
  `);

  // Persistent session storage (backend/lib/sessionStore.js) - a database
  // that predates this table just never had one; create it the same way
  // schema.sql would on a fresh database.
  const sessionsTable = await client.execute(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sessions'`
  );
  if (sessionsTable.rows.length === 0) {
    await client.execute(`
      CREATE TABLE sessions (
          sid TEXT PRIMARY KEY,
          sess TEXT NOT NULL,
          expires INTEGER NOT NULL
      )
    `);
    console.log('Migrated: created sessions table.');
  }

  const prefCols = await client.execute(`PRAGMA table_info(user_preferences)`);
  const prefColumnNames = prefCols.rows.map((r) => r.name);

  if (!prefColumnNames.includes('day_schedule')) {
    await client.execute(`ALTER TABLE user_preferences ADD COLUMN day_schedule TEXT`);
    console.log('Migrated: added user_preferences.day_schedule column.');
  }

  if (!prefColumnNames.includes('email_notifications')) {
    await client.execute(`ALTER TABLE user_preferences ADD COLUMN email_notifications INTEGER DEFAULT 0`);
    console.log('Migrated: added user_preferences.email_notifications column.');
  }

  const scheduleCols = await client.execute(`PRAGMA table_info(schedules)`);
  const scheduleColumnNames = scheduleCols.rows.map((r) => r.name);

  if (!scheduleColumnNames.includes('reminder_sent')) {
    await client.execute(`ALTER TABLE schedules ADD COLUMN reminder_sent INTEGER DEFAULT 0`);
    console.log('Migrated: added schedules.reminder_sent column.');
  }

  // 1 once the user finished this scheduled session (Complete Session on
  // Tasks, or ticking its section) - lets a session show as done even when
  // one of its sections continues in a later session.
  if (!scheduleColumnNames.includes('completed')) {
    await client.execute(`ALTER TABLE schedules ADD COLUMN completed INTEGER DEFAULT 0`);
    console.log('Migrated: added schedules.completed column.');
  }

  const sectionCols = await client.execute(`PRAGMA table_info(sections)`);
  const sectionColumnNames = sectionCols.rows.map((r) => r.name);

  // 1 when the user typed this section's duration themselves (Add Task, or
  // editing its minutes on the Tasks page) - the scheduler then keeps that
  // exact time instead of rounding it to whole sessions.
  if (!sectionColumnNames.includes('minutes_customized')) {
    await client.execute(`ALTER TABLE sections ADD COLUMN minutes_customized INTEGER DEFAULT 0`);
    console.log('Migrated: added sections.minutes_customized column.');
  }

  // A PDF attached to a custom task, only for reading (see backend/routes/tasks.js).
  if (!sectionColumnNames.includes('attachment_id')) {
    await client.execute(`ALTER TABLE sections ADD COLUMN attachment_id INTEGER`);
    console.log('Migrated: added sections.attachment_id column.');
  }

  // The user's running/paused study timer (see backend/routes/timer.js), so it
  // survives a reload, a logout, or moving to another device.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS active_timers (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      task_id INTEGER NOT NULL,
      schedule_id INTEGER,
      occurrence_key TEXT,
      planned_minutes INTEGER NOT NULL,
      total_seconds INTEGER NOT NULL,
      remaining_seconds INTEGER NOT NULL,
      is_running INTEGER DEFAULT 0,
      updated_at INTEGER NOT NULL
    )
  `);

  const courseCols = await client.execute(`PRAGMA table_info(courses)`);
  const courseColumnNames = courseCols.rows.map((r) => r.name);

  if (!courseColumnNames.includes('color')) {
    await client.execute(`ALTER TABLE courses ADD COLUMN color TEXT`);
    console.log('Migrated: added courses.color column.');
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
    // A logged-in user should stay logged in - like any normal website -
    // until they explicitly log out or sign in from a different browser,
    // not get silently booted back to the login page after 24 hours of
    // real, active use. 400 days is the longest a cookie can actually
    // live (browsers cap Set-Cookie's Max-Age/Expires there and silently
    // clamp anything longer), and `rolling: true` re-issues that same
    // 400-day window on every request, so someone who keeps using the
    // app effectively never expires - only real inactivity for over a
    // year would ever log them out on its own.
    rolling: true,
    // Persisted in Turso (see backend/lib/sessionStore.js) instead of the
    // default in-memory store, so a session survives a server restart -
    // otherwise the long cookie maxAge below wouldn't matter; the session
    // would still vanish the moment the process restarted.
    store: new TursoSessionStore(client),
    cookie: {
      secure: 'auto',
      sameSite: 'lax',
      maxAge: 400 * 24 * 60 * 60 * 1000 // 400 days (the practical browser max)
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

// deserializeUser runs on EVERY logged-in request - the row is served from
// a short-lived memory cache (backend/lib/userCache.js) instead of a
// database round trip each time.
passport.deserializeUser((id, done) => {
  const cached = getCachedUser(id);
  if (cached) return done(null, cached);
  db.prepare(`SELECT id, google_id, name, email FROM users WHERE id = ?`).get(id)
    .then((dbUser) => {
      if (dbUser) cacheUser(id, dbUser);
      else forgetCachedUser(id);
      done(null, dbUser || null);
    })
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
app.use('/api/timer', require('./backend/routes/timer'));

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

// Mount Notification routes (test email, SMTP-configured status)
app.use('/api/notifications', notificationRoutes);

// Serve static frontend assets
// Browser caching for static files. Every request to the Render server is a
// ~0.3 s round trip, and with Express's default (max-age=0) every page load
// re-checked every stylesheet, script and image. HTML is still re-checked
// each time so an update shows up right away; CSS/JS are reused for an
// hour, images for 30 days.
app.use(express.static(frontendPath, {
  setHeaders(res, filePath) {
    if (/\.(png|jpe?g|gif|svg|ico|webp)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=2592000');
    } else if (/\.(css|js)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    } else {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

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

// ==========================================
// Email reminders for upcoming scheduled study sessions
// ==========================================
// A lightweight polling job (no extra dependency for a real job
// scheduler) that, every few minutes, looks for schedule sessions
// starting soon for a user who's opted into email notifications
// (user_preferences.email_notifications - see backend/routes/preferences.js
// and Settings) and emails them a reminder exactly once each
// (schedules.reminder_sent dedup flag - a session already reminded-about
// is never emailed again even if this check runs again before it starts).
// Sending itself goes through backend/lib/mailer.js, which no-ops with a
// clear log line when SMTP isn't configured, so this is always safe to
// run even before that's set up.
const REMINDER_WINDOW_MINUTES = 15;
const REMINDER_CHECK_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes

// Times after midnight of a study night are stored as 24:00+ (25:10 = 1:10 AM).
function formatClock12(hhmm) {
  const [hRaw, m] = String(hhmm).split(':').map(Number);
  const h = hRaw % 24;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const ampm = h < 12 ? 'AM' : 'PM';
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

async function checkAndSendScheduleReminders() {
  try {
    const now = new Date();
    const dateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const today = dateStr(now);
    // After midnight, last night's sessions are stored on yesterday's date as 24:00+.
    const yesterday = dateStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const windowEndMinutes = nowMinutes + REMINDER_WINDOW_MINUTES;

    const rows = await db.prepare(`
      SELECT
          sch.id AS schedule_id, sch.date, sch.start_time, sch.end_time,
          s.title, c.name AS course_name,
          u.id AS user_id, u.email, u.name AS user_name
      FROM schedules sch
      JOIN tasks t ON t.id = sch.task_id
      JOIN sections s ON s.id = t.section_id
      JOIN courses c ON c.id = s.course_id
      JOIN users u ON u.id = c.user_id
      JOIN user_preferences up ON up.user_id = u.id
      WHERE sch.date IN (?, ?)
        AND (sch.reminder_sent IS NULL OR sch.reminder_sent = 0)
        AND up.email_notifications = 1
        AND t.status != 'Completed'
    `).all(today, yesterday);

    // One session can cover several short sections - one schedules row
    // per section, all sharing the same start/end time. Send one reminder
    // per session, not one per row.
    const sessions = new Map();
    for (const row of rows) {
      const key = `${row.user_id}|${row.date}|${row.start_time}|${row.end_time}`;
      if (!sessions.has(key)) sessions.set(key, { ...row, titles: [], scheduleIds: [] });
      const session = sessions.get(key);
      session.titles.push(row.title);
      session.scheduleIds.push(row.schedule_id);
    }

    for (const session of sessions.values()) {
      const [sh, sm] = String(session.start_time).split(':').map(Number);
      const startMinutes = sh * 60 + sm - (session.date === yesterday ? 1440 : 0);
      // Not upcoming within the reminder window yet (or its window has
      // already passed) - leave it for a later check, or let it quietly
      // stop being retried once it's no longer "upcoming" at all.
      if (startMinutes < nowMinutes || startMinutes > windowEndMinutes) continue;
      if (!session.email) continue;

      const title = session.titles.join(', ');
      const result = await sendMail({
        to: session.email,
        subject: `StudyGPS reminder: "${title}" starts at ${formatClock12(session.start_time)}`,
        text: `Hi ${session.user_name || 'there'},\n\nYour study session "${title}" (${session.course_name}) is scheduled from ${formatClock12(session.start_time)} to ${formatClock12(session.end_time)} today.\n\nGood luck!\n- StudyGPS`,
        html: `<p>Hi ${session.user_name || 'there'},</p><p>Your study session <strong>${title}</strong> (${session.course_name}) is scheduled from ${formatClock12(session.start_time)} to ${formatClock12(session.end_time)} today.</p><p>Good luck!<br>- StudyGPS</p>`
      });

      if (result.sent) {
        const placeholders = session.scheduleIds.map(() => '?').join(',');
        await db.prepare(`UPDATE schedules SET reminder_sent = 1 WHERE id IN (${placeholders})`).run(...session.scheduleIds);
      }
      // A failed send (SMTP not configured, transient network error, etc.)
      // leaves reminder_sent at 0 so the next check retries it, up until
      // the session's own window passes and the filter above stops
      // matching it - no infinite retry, no crash either way.
    }
  } catch (err) {
    // Never let a reminder-check failure take down the interval it runs
    // on, or the server it's attached to.
    console.error('Schedule reminder check failed:', err.message);
  }
}

// The server only starts accepting requests once the database schema is
// confirmed to exist - on a brand-new Turso database (first deploy, or a
// fresh free-tier account) there's no `users` table yet until this runs,
// and every route ultimately depends on it.
async function start() {
  await ensureSchema();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`StudyGPS server running on http://0.0.0.0:${PORT}`);
  });

  // Runs once right after boot (catches anything due in the next few
  // minutes even right after a restart) and then on a fixed interval.
  checkAndSendScheduleReminders();
  setInterval(checkAndSendScheduleReminders, REMINDER_CHECK_INTERVAL_MS);
}

start().catch((err) => {
  console.error('Failed to start StudyGPS server:', err);
  process.exit(1);
});
