PRAGMA foreign_keys = ON;

-- Clean up existing tables in reverse dependency order
DROP TABLE IF EXISTS study_sessions;
DROP TABLE IF EXISTS schedules;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS sections;
DROP TABLE IF EXISTS materials;
DROP TABLE IF EXISTS courses;
DROP TABLE IF EXISTS user_preferences;
DROP TABLE IF EXISTS users;

-- USERS
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    google_id TEXT UNIQUE,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL
);

-- USER STUDY PREFERENCES
CREATE TABLE user_preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    study_days TEXT,
    preferred_start TEXT,
    preferred_end TEXT,
    session_length INTEGER DEFAULT 50,
    break_length INTEGER DEFAULT 10,
    max_daily_minutes INTEGER DEFAULT 120,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- COURSES
CREATE TABLE courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- MATERIALS (PDFs / Books)
CREATE TABLE materials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    file_path TEXT NOT NULL,
    uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);

-- PDF SECTIONS
CREATE TABLE sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    material_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    start_page INTEGER,
    end_page INTEGER,
    estimated_minutes INTEGER,
    difficulty INTEGER DEFAULT 1,
    FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE
);

-- TASKS
CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section_id INTEGER NOT NULL,
    priority INTEGER DEFAULT 0,
    deadline TEXT,
    status TEXT DEFAULT 'Not Started',
    FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE
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
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
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
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);