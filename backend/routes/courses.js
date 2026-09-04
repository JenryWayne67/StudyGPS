const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');

const router = express.Router();
console.log('COURSES ROUTE LOADED');


const dbPath = path.join(__dirname, '../../database/studygps.db');
const db = new Database(dbPath);

router.get('/test', (req, res) => {
    res.json({
        success: true,
        message: 'Courses route is working'
    });
});
// GET /api/courses
// Return all courses for a user
router.get('/', (req, res) => {
    try {
        const userId = Number(req.query.user_id) || 1;

        const courses = db.prepare(`
            SELECT id, user_id, name
            FROM courses
            WHERE user_id = ?
            ORDER BY id ASC
        `).all(userId);

        res.json({
            success: true,
            courses
        });

    } catch (error) {
        console.error('Get courses error:', error);

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});


// POST /api/courses
// Create a new course
router.post('/', (req, res) => {
    try {
        const { user_id, name } = req.body;

        const userId = Number(user_id) || 1;

        if (!name || !name.trim()) {
            return res.status(400).json({
                success: false,
                error: 'Course name is required'
            });
        }

        const result = db.prepare(`
            INSERT INTO courses (user_id, name)
            VALUES (?, ?)
        `).run(userId, name.trim());

        const newCourse = db.prepare(`
            SELECT id, user_id, name
            FROM courses
            WHERE id = ?
        `).get(result.lastInsertRowid);

        res.status(201).json({
            success: true,
            message: 'Course created successfully',
            course: newCourse
        });

    } catch (error) {
        console.error('Create course error:', error);

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});


module.exports = router;