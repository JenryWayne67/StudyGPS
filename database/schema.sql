PRAGMA foreign_keys = ON;

-- ==========================================
-- USERS
-- ==========================================

CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    google_id TEXT UNIQUE,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL
);


-- ==========================================
-- USER STUDY PREFERENCES
-- ==========================================

CREATE TABLE user_preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,

    study_days TEXT,
    preferred_start TEXT,
    preferred_end TEXT,

    session_length INTEGER DEFAULT 50,
    break_length INTEGER DEFAULT 10,
    max_daily_minutes INTEGER DEFAULT 120,

    FOREIGN KEY (user_id) REFERENCES users(id)
);


-- ==========================================
-- COURSES
-- ==========================================

CREATE TABLE courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,

    name TEXT NOT NULL,

    FOREIGN KEY (user_id) REFERENCES users(id)
);


-- ==========================================
-- PDF SECTIONS
-- ==========================================

CREATE TABLE sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id INTEGER NOT NULL,

    title TEXT NOT NULL,

    start_page INTEGER,
    end_page INTEGER,

    estimated_minutes INTEGER,
    difficulty INTEGER DEFAULT 1,

    FOREIGN KEY (course_id) REFERENCES courses(id)
);


-- ==========================================
-- TASKS
-- ==========================================

CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section_id INTEGER NOT NULL,

    priority INTEGER DEFAULT 0,
    deadline TEXT,

    status TEXT DEFAULT 'Not Started',

    FOREIGN KEY (section_id) REFERENCES sections(id)
);


-- ==========================================
-- SCHEDULE
-- ==========================================

CREATE TABLE schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,

    date TEXT NOT NULL,

    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,

    start_page INTEGER,
    end_page INTEGER,

    FOREIGN KEY (task_id) REFERENCES tasks(id)
);


-- ==========================================
-- STUDY SESSIONS
-- ==========================================

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