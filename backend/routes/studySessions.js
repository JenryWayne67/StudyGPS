
const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const { execFile } = require('child_process');

const router = express.Router();

const dbPath = path.join(__dirname, '../../database/studygps.db');
const db = new Database(dbPath);

// POST /api/study-sessions
router.post('/', (req, res) => {
    try {
        const {
            task_id,
            planned_minutes,
            actual_seconds,
            start_time,
            end_time,
            completed
        } = req.body;

        // Validate task ID
        if (!task_id) {
            return res.status(400).json({
                success: false,
                error: 'task_id is required'
            });
        }

        // Get task using the columns that actually exist
        const task = db.prepare(`
            SELECT id, section_id
            FROM tasks
            WHERE id = ?
        `).get(task_id);

        if (!task) {
            return res.status(404).json({
                success: false,
                error: `Task ${task_id} does not exist`
            });
        }

        const plannedMinutes = Number(planned_minutes) || 50;
        const actualSeconds = Number(actual_seconds) || 0;

        // C++ executable
        const cppEnginePath = path.join(
            __dirname,
            '../../cpp_engine/studyTracker.exe'
        );

        // Get section information for task name
        let taskName = `Task ${task.id}`;

        try {
            const section = db.prepare(`
                SELECT title
                FROM sections
                WHERE id = ?
            `).get(task.section_id);

            if (section && section.title) {
                taskName = section.title;
            }
        } catch (err) {
            console.log('Could not get section title, using task ID.');
        }

        // Run C++ engine
        execFile(
            cppEnginePath,
            [
                String(task.id),
                String(taskName),
                String(plannedMinutes),
                String(actualSeconds)
            ],
            (error, stdout, stderr) => {

                if (error) {
                    console.error('C++ engine error:', error);
                    console.error('C++ stderr:', stderr);

                    return res.status(500).json({
                        success: false,
                        error: 'C++ study tracker failed',
                        details: stderr || error.message
                    });
                }

                console.log('C++ StudyTracker output:');
                console.log(stdout);

                // Expected:
                // task_id=1 planned_minutes=50 actual_minutes=43 completed=1

                const resultMatch = stdout.match(
                    /task_id=(\d+)\s+planned_minutes=(\d+)\s+actual_minutes=(\d+)\s+completed=(\d+)/
                );

                if (!resultMatch) {
                    return res.status(500).json({
                        success: false,
                        error: 'Could not read result from C++ engine',
                        cpp_output: stdout
                    });
                }

                const cppTaskId = Number(resultMatch[1]);
                const cppPlannedMinutes = Number(resultMatch[2]);
                const cppActualMinutes = Number(resultMatch[3]);
                const cppCompleted = Number(resultMatch[4]);

                // Save result to SQLite
                const stmt = db.prepare(`
                    INSERT INTO study_sessions
                    (
                        task_id,
                        planned_minutes,
                        actual_minutes,
                        start_time,
                        end_time,
                        completed
                    )
                    VALUES (?, ?, ?, ?, ?, ?)
                `);

                const result = stmt.run(
                    cppTaskId,
                    cppPlannedMinutes,
                    cppActualMinutes,
                    start_time || null,
                    end_time || null,
                    cppCompleted
                );

                const newSession = db.prepare(`
                    SELECT *
                    FROM study_sessions
                    WHERE id = ?
                `).get(result.lastInsertRowid);

                res.status(201).json({
                    success: true,
                    message: 'Study session recorded by C++ engine',
                    session: newSession,
                    cpp: {
                        task_id: cppTaskId,
                        planned_minutes: cppPlannedMinutes,
                        actual_minutes: cppActualMinutes,
                        completed: cppCompleted
                    }
                });
            }
        );

    } catch (error) {
        console.error('Study session error:', error);

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});


// GET /api/study-sessions
router.get('/', (req, res) => {
    try {
        const sessions = db.prepare(`
            SELECT *
            FROM study_sessions
            ORDER BY id DESC
        `).all();

        res.json({
            success: true,
            sessions
        });

    } catch (error) {
        console.error('Get study sessions error:', error);

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;

