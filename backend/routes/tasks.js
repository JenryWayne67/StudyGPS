const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');

const router = express.Router();

const dbPath = path.join(__dirname, '../../database/studygps.db');
const db = new Database(dbPath);

// ==========================================
// GET /api/tasks/:id
// Read back one real task, joined with its section (title, pages,
// planned minutes) and course - what timer.html needs to show a real
// task instead of the localStorage mock.
// ==========================================

router.get('/:id', (req, res) => {
    try {
        const taskId = Number(req.params.id);

        if (!taskId) {
            return res.status(400).json({
                success: false,
                error: 'Invalid task ID'
            });
        }

        const task = db.prepare(`
            SELECT
                t.id,
                t.section_id,
                t.priority,
                t.deadline,
                t.status,
                s.title,
                s.start_page,
                s.end_page,
                s.estimated_minutes,
                s.difficulty,
                s.material_id,
                s.course_id,
                c.name AS course_name
            FROM tasks t
            JOIN sections s ON s.id = t.section_id
            LEFT JOIN courses c ON c.id = s.course_id
            WHERE t.id = ?
        `).get(taskId);

        if (!task) {
            return res.status(404).json({
                success: false,
                error: `Task ${taskId} does not exist`
            });
        }

        res.json({
            success: true,
            task
        });

    } catch (error) {
        console.error('Get task error:', error);

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
