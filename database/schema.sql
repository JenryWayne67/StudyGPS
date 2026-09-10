PRAGMA foreign_keys = ON;

-- Clean up existing tables in reverse dependency order
DROP TABLE IF EXISTS study_sessions;
DROP TABLE IF EXISTS schedules;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS material_pages;
DROP TABLE IF EXISTS sections;
DROP TABLE IF EXISTS materials;
DROP TABLE IF EXISTS courses;
DROP TABLE IF EXISTS user_preferences;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;

-- USERS
-- password_hash is nullable: a Google-only account never sets one
-- (upsertGoogleUser never touches it), only email/password signup does.
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    google_id TEXT UNIQUE,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT
);

-- LOGIN SESSIONS (backend/lib/sessionStore.js) - persisted here instead of
-- express-session's default in-memory store, so a logged-in user stays
-- logged in across server restarts/redeploys, not just within one
-- process's uptime. `sess` is the session JSON blob; `expires` is a Unix
-- ms timestamp mirroring the cookie's own expiry.
CREATE TABLE sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expires INTEGER NOT NULL
);

-- USER STUDY PREFERENCES
CREATE TABLE user_preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    study_days TEXT,
    preferred_start TEXT,
    preferred_end TEXT,
    day_schedule TEXT, -- JSON: {"Monday":{"start":"18:00","end":"21:00"}, ...} per-day override
    session_length INTEGER DEFAULT 50,
    break_length INTEGER DEFAULT 10,
    max_daily_minutes INTEGER DEFAULT 120,
    dark_mode INTEGER DEFAULT 0,
    email_notifications INTEGER DEFAULT 0, -- opt-in reminder emails for upcoming study sessions
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- COURSES
-- color is a "#rrggbb" hex string used to color-code a course's sessions
-- on the Schedule page and its chip on Materials; nullable so an older
-- row (or one created without picking a color) falls back to the
-- palette-position color the frontend/backend both compute on the fly.
CREATE TABLE courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    color TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- MATERIALS (PDFs / Books)
CREATE TABLE materials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    file_path TEXT,
    uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'pending',
    page_count INTEGER,
    file_size TEXT,
    extracted_text TEXT,
    deadline TEXT, -- optional "YYYY-MM-DD" the whole material is due by
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);

-- MATERIAL PAGES (raw extracted text per PDF page, used for section
-- detection - see backend/routes/materials.js's splitIntoPages/detectSections)
CREATE TABLE material_pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    material_id INTEGER NOT NULL,
    page_number INTEGER NOT NULL,
    content TEXT,
    UNIQUE(material_id, page_number),
    FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE
);

-- PDF SECTIONS
-- course_id is the reliable, always-present join back to a course; some
-- manually-seeded sections have no material_id, so that one stays nullable.
CREATE TABLE sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    start_page INTEGER,
    end_page INTEGER,
    estimated_minutes INTEGER,
    difficulty INTEGER DEFAULT 1,
    material_id INTEGER REFERENCES materials(id),
    minutes_customized INTEGER DEFAULT 0, -- 1 when the user set estimated_minutes themselves; the scheduler then keeps it exact
    FOREIGN KEY (course_id) REFERENCES courses(id)
);

-- TASKS
CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section_id INTEGER NOT NULL,
    priority INTEGER DEFAULT 0,
    deadline TEXT,
    status TEXT DEFAULT 'Not Started',
    FOREIGN KEY (section_id) REFERENCES sections(id)
);

-- SCHEDULE
CREATE TABLE schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    start_page INTEGER,
    end_page INTEGER,
    reminder_sent INTEGER DEFAULT 0, -- dedup flag for the email-reminder background check in server.js
    completed INTEGER DEFAULT 0, -- 1 once this scheduled session was finished (Complete Session / ticking its section on Tasks)
    FOREIGN KEY (task_id) REFERENCES tasks(id)
);

-- STUDY SESSIONS
CREATE TABLE study_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    planned_minutes INTEGER,
    actual_minutes INTEGER,
    start_time TEXT,
    end_time TEXT,
    completed INTEGER DEFAULT 0,
    FOREIGN KEY (task_id) REFERENCES tasks(id)
);
