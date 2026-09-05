// backend/routes/progress.js
//
// Wires frontend/progress.html to a REAL progress report instead of the
// hardcoded demo numbers (which turned out to be a copy of cpp_engine/
// progressReport.cpp's own old hardcoded main() - that program was never
// actually invoked from Node at all). Same pattern as schedule.js and
// materials.js: this route only gathers this user's real tasks (with
// planned minutes from their section, actual minutes summed from any
// logged study_sessions, and status/course from the DB), pipes them into
// progressReport.exe, and returns what comes back. No progress math
// happens in JS - it all lives in the C++ ProgressReport class.

const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { execFileSync } = require('child_process');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();

const dbPath = path.join(__dirname, '../../database/studygps.db');
const db = new Database(dbPath);

router.use(requireAuth);

// Every real task for this user, joined with its section (for the task's
// display name, estimated/"planned" minutes, and course) plus the sum of
// any actual_minutes logged against it in study_sessions (a task can have
// zero sessions logged yet, or several across multiple timer runs).
// sections.course_id is used directly rather than going through
// materials - some legacy/manually-seeded sections have no material_id,
// but every section has a course_id.
function getTasksForReport(userId) {
    return db.prepare(`
        SELECT
            t.id AS task_id,
            t.status AS status,
            s.title AS task_name,
            COALESCE(s.estimated_minutes, 0) AS planned_minutes,
            c.name AS course_name,
            COALESCE(
                (SELECT SUM(ss.actual_minutes) FROM study_sessions ss WHERE ss.task_id = t.id),
                0
            ) AS actual_minutes
        FROM tasks t
        JOIN sections s ON s.id = t.section_id
        JOIN courses c ON c.id = s.course_id
        WHERE c.user_id = ?
        ORDER BY t.id
    `).all(userId);
}

// Run cpp_engine/progressReport.exe: pipe TASK lines in (pipe-delimited,
// one per line), get a REPORT line plus one COURSE line per course out
// (key=value, same CLI contract the other engines use). Throws on any
// failure instead of returning fake-looking zeros.
function runProgressReport(taskRows) {
    const exePath = path.join(__dirname, '../../cpp_engine/progressReport.exe');

    if (!fs.existsSync(exePath)) {
        throw new Error(`progressReport.exe not found at ${exePath} - rebuild it with: g++ -std=c++17 -O2 -o cpp_engine/progressReport.exe cpp_engine/progressReport.cpp`);
    }

    const input = taskRows
        .map((t) => [t.task_name, t.course_name, t.status, t.planned_minutes, t.actual_minutes].join('|'))
        .map((line) => `TASK|${line}`)
        .join('\n') + '\n';

    let stdout;
    try {
        stdout = execFileSync(exePath, [], { input, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    } catch (err) {
        const details = [
            err.message,
            err.stderr ? `stderr: ${String(err.stderr).slice(0, 500)}` : null,
            err.stdout ? `stdout: ${String(err.stdout).slice(0, 500)}` : null
        ].filter(Boolean).join(' | ');
        throw new Error(`progressReport.exe failed to run: ${details}`);
    }

    const reportRe = /^REPORT\s+tasks_completed=(\d+)\s+tasks_total=(\d+)\s+completion_rate=([\d.]+)\s+study_minutes=(\d+)\s+schedule_adherence=([\d.]+)/;
    const courseRe = /^COURSE\s+total=(\d+)\s+completed=(\d+)\s+percentage=([\d.]+)\s+name=(.+)$/;

    let report = null;
    const courses = [];

    for (const rawLine of stdout.split('\n')) {
        const line = rawLine.replace(/\r$/, ''); // tolerate Windows CRLF output

        const reportMatch = line.match(reportRe);
        if (reportMatch) {
            report = {
                tasks_completed: Number(reportMatch[1]),
                tasks_total: Number(reportMatch[2]),
                completion_rate: Number(reportMatch[3]),
                study_minutes: Number(reportMatch[4]),
                schedule_adherence: Number(reportMatch[5])
            };
            continue;
        }

        const courseMatch = line.match(courseRe);
        if (courseMatch) {
            courses.push({
                total: Number(courseMatch[1]),
                completed: Number(courseMatch[2]),
                percentage: Number(courseMatch[3]),
                name: courseMatch[4].trim()
            });
        }
    }

    if (!report) {
        throw new Error(
            `progressReport.exe ran but produced no parseable REPORT line for ${taskRows.length} task(s). ` +
            `Raw output (first 500 chars): ${JSON.stringify(stdout.slice(0, 500))}`
        );
    }

    return { report, courses };
}

// GET /api/progress
// Real weekly progress for the logged-in user: task completion, study
// time, schedule adherence, and a per-course breakdown - all computed by
// cpp_engine/progressReport.exe from this user's actual tasks/sections/
// study_sessions rows. A user with zero tasks yet gets an all-zero report
// (not an error), so a brand-new account sees an honest empty state
// instead of a crash.
router.get('/', (req, res) => {
    try {
        const taskRows = getTasksForReport(req.user.id);

        if (taskRows.length === 0) {
            return res.json({
                success: true,
                report: {
                    tasks_completed: 0,
                    tasks_total: 0,
                    completion_rate: 0,
                    study_minutes: 0,
                    schedule_adherence: 0
                },
                courses: []
            });
        }

        const { report, courses } = runProgressReport(taskRows);
        res.json({ success: true, report, courses });
    } catch (error) {
        console.error('Get progress error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
