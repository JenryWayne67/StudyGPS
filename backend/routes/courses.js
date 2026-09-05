const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();
console.log('COURSES ROUTE LOADED');


const dbPath = path.join(__dirname, '../../database/studygps.db');
const db = new Database(dbPath);

router.use(requireAuth);

router.get('/test', (req, res) => {
    res.json({
        success: true,
        message: 'Courses route is working'
    });
});
// GET /api/courses
// Return all courses for the logged-in user
router.get('/', (req, res) => {
    try {
        const userId = req.user.id;

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
// Create a new course, owned by the logged-in user
router.post('/', (req, res) => {
    try {
        const { name } = req.body;
        const userId = req.user.id;

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