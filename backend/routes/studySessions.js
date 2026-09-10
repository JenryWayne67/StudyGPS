
const express = require('express');
const path = require('path');
const { execFile } = require('child_process');
const { requireAuth } = require('../middleware/requireAuth');
const { db } = require('../lib/db');

const router = express.Router();

router.use(requireAuth);

// Does this task belong (via section -> course) to the logged-in user?
function taskOwnedByUser(taskId, userId) {
    return db.prepare(`
        SELECT t.id, t.section_id
        FROM tasks t
        JOIN sections s ON s.id = t.section_id
        JOIN courses c ON c.id = s.course_id
        WHERE t.id = ? AND c.user_id = ?
    `).get(taskId, userId);
}

// POST /api/study-sessions
router.post('/', async (req, res) => {
    try {
        const {
            task_id,
            schedule_id,
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

        // Get task using the columns that actually exist, scoped to this user
        const task = await taskOwnedByUser(task_id, req.user.id);

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
            const section = await db.prepare(`
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
            async (error, stdout, stderr) => {

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
                // The caller can say this session doesn't finish the task
                // (a section that continues in a later scheduled session):
                // it's still logged, and the task stays In Progress.
                const cppCompleted = completed === false ? 0 : Number(resultMatch[4]);

                try {
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

                    const result = await stmt.run(
                        cppTaskId,
                        cppPlannedMinutes,
                        cppActualMinutes,
                        start_time || null,
                        end_time || null,
                        cppCompleted
                    );

                    // The C++ engine's completion verdict is what actually
                    // moves the task forward - reflect it on the task itself
                    // so tasks.html/dashboard.html show real status, not just
                    // a logged session.
                    await db.prepare(`
                        UPDATE tasks
                        SET status = ?
                        WHERE id = ? AND status != 'Completed'
                    `).run(cppCompleted ? 'Completed' : 'In Progress', cppTaskId);

                    // Mark the scheduled session this was studied in as done,
                    // so it shows finished on Tasks even when the section
                    // continues in a later session (task still In Progress).
                    if (schedule_id) {
                        await db.prepare(`
                            UPDATE schedules SET completed = 1 WHERE id = ? AND task_id = ?
                        `).run(Number(schedule_id), cppTaskId);
                    }

                    const newSession = await db.prepare(`
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
                } catch (dbError) {
                    console.error('Study session save error:', dbError);
                    res.status(500).json({ success: false, error: dbError.message });
                }
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
router.get('/', async (req, res) => {
    try {
        const sessions = await db.prepare(`
            SELECT ss.*
            FROM study_sessions ss
            JOIN tasks t ON t.id = ss.task_id
            JOIN sections s ON s.id = t.section_id
            JOIN courses c ON c.id = s.course_id
            WHERE c.user_id = ?
            ORDER BY ss.id DESC
        `).all(req.user.id);

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

