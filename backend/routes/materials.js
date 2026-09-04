const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { PDFParse } = require('pdf-parse');
const Database = require('better-sqlite3');

const router = express.Router();

const dbPath = path.join(__dirname, '../../database/studygps.db');
const db = new Database(dbPath);

// ==========================================
// PDF UPLOAD CONFIGURATION
// ==========================================

const uploadDir = path.join(__dirname, '../../uploads');

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },

    filename: (req, file, cb) => {
        const safeName = file.originalname
            .replace(/[^a-zA-Z0-9.-]/g, '_');

        cb(null, Date.now() + '-' + safeName);
    }
});

const upload = multer({
    storage: storage,

    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed'));
        }
    },

    limits: {
        fileSize: 50 * 1024 * 1024
    }
});

// ==========================================
// GET /api/materials
// ==========================================

router.get('/', (req, res) => {
    try {
        const courseId = Number(req.query.course_id);

        let materials;

        if (courseId) {
            materials = db.prepare(`
                SELECT
                    id,
                    course_id,
                    filename,
                    file_path,
                    uploaded_at,
                    status,
                    page_count,
                    file_size
                FROM materials
                WHERE course_id = ?
                ORDER BY id DESC
            `).all(courseId);
        } else {
            materials = db.prepare(`
                SELECT
                    id,
                    course_id,
                    filename,
                    file_path,
                    uploaded_at,
                    status,
                    page_count,
                    file_size
                FROM materials
                ORDER BY id DESC
            `).all();
        }

        res.json({
            success: true,
            materials
        });

    } catch (error) {
        console.error('Get materials error:', error);

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});


// ==========================================
// POST /api/materials
// JSON material creation
// ==========================================

router.post('/', (req, res) => {
    try {
        const {
            course_id,
            filename,
            file_path,
            status,
            page_count,
            file_size
        } = req.body;

        const courseId = Number(course_id);

        if (!courseId) {
            return res.status(400).json({
                success: false,
                error: 'course_id is required'
            });
        }

        if (!filename || !filename.trim()) {
            return res.status(400).json({
                success: false,
                error: 'filename is required'
            });
        }

        const course = db.prepare(`
            SELECT id, name
            FROM courses
            WHERE id = ?
        `).get(courseId);

        if (!course) {
            return res.status(404).json({
                success: false,
                error: 'Course not found'
            });
        }

        const result = db.prepare(`
            INSERT INTO materials (
                course_id,
                filename,
                file_path,
                status,
                page_count,
                file_size
            )
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            courseId,
            filename.trim(),
            file_path || null,
            status || 'pending',
            page_count || null,
            file_size || null
        );

        const material = db.prepare(`
            SELECT
                id,
                course_id,
                filename,
                file_path,
                uploaded_at,
                status,
                page_count,
                file_size
            FROM materials
            WHERE id = ?
        `).get(result.lastInsertRowid);

        res.status(201).json({
            success: true,
            message: 'Material created successfully',
            material
        });

    } catch (error) {
        console.error('Create material error:', error);

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==========================================
// POST /api/materials/upload
// ACTUAL PDF UPLOAD
// ==========================================

router.post('/upload', upload.single('pdf'), (req, res) => {
    try {
        const courseId = Number(req.body.course_id);

        if (!courseId) {
            if (req.file) {
                fs.unlinkSync(req.file.path);
            }

            return res.status(400).json({
                success: false,
                error: 'course_id is required'
            });
        }

        const course = db.prepare(`
            SELECT id, name
            FROM courses
            WHERE id = ?
        `).get(courseId);

        if (!course) {
            if (req.file) {
                fs.unlinkSync(req.file.path);
            }

            return res.status(404).json({
                success: false,
                error: 'Course not found'
            });
        }

        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'PDF file is required'
            });
        }

        const result = db.prepare(`
            INSERT INTO materials (
                course_id,
                filename,
                file_path,
                status,
                page_count,
                file_size
            )
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            courseId,
            req.file.originalname,
            req.file.path,
            'uploaded',
            null,
            req.file.size
        );

        const material = db.prepare(`
            SELECT
                id,
                course_id,
                filename,
                file_path,
                uploaded_at,
                status,
                page_count,
                file_size
            FROM materials
            WHERE id = ?
        `).get(result.lastInsertRowid);

        res.status(201).json({
            success: true,
            message: 'PDF uploaded successfully',
            material
        });

    } catch (error) {
        console.error('PDF upload error:', error);

        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});



// ==========================================
// POST /api/materials/:id/process
// EXTRACT TEXT AND PAGE COUNT FROM PDF
// ==========================================

router.post('/:id/process', async (req, res) => {
    let parser;

    try {
        const materialId = Number(req.params.id);

        if (!materialId) {
            return res.status(400).json({
                success: false,
                error: 'Invalid material ID'
            });
        }

        const material = db.prepare(`
            SELECT
                id,
                course_id,
                filename,
                file_path,
                status
            FROM materials
            WHERE id = ?
        `).get(materialId);

        if (!material) {
            return res.status(404).json({
                success: false,
                error: 'Material not found'
            });
        }

        if (!material.file_path || !fs.existsSync(material.file_path)) {
            return res.status(404).json({
                success: false,
                error: 'PDF file not found on server'
            });
        }

        // Read the PDF file
        const dataBuffer = fs.readFileSync(material.file_path);

        // Create PDF parser
        parser = new PDFParse({
            data: dataBuffer
        });

        // Extract text
        const result = await parser.getText();

        const pageCount = result.total;

        // Update database
        db.prepare(`
            UPDATE materials
            SET page_count = ?,
                status = ?
            WHERE id = ?
        `).run(
            pageCount,
            'processed',
            materialId
        );

        res.json({
            success: true,
            message: 'PDF processed successfully',
            material_id: materialId,
            filename: material.filename,
            page_count: pageCount,
            text_preview: result.text.substring(0, 2000)
        });

    } catch (error) {
        console.error('PDF processing error:', error);

        res.status(500).json({
            success: false,
            error: error.message
        });

    } finally {
        if (parser) {
            await parser.destroy();
        }
    }
});

module.exports = router;