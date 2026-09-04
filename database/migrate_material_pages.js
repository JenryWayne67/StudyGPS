// database/migrate_material_pages.js
//
// One-off, idempotent migration. Does NOT touch schema.sql and does NOT
// drop/rebuild any existing table. Safe to run multiple times.
//
// Adds:
//   - material_pages(material_id, page_number, content)   [new table]
//   - sections.material_id                                [new column, nullable]
//
// Run:  node database/migrate_material_pages.js

const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, 'studygps.db');
const db = new Database(dbPath);

db.pragma('foreign_keys = ON');

function columnExists(table, column) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    return cols.some((c) => c.name === column);
}

const migration = db.transaction(() => {
    // 1. material_pages table (additive only)
    db.exec(`
        CREATE TABLE IF NOT EXISTS material_pages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            material_id INTEGER NOT NULL,
            page_number INTEGER NOT NULL,
            content TEXT,
            UNIQUE(material_id, page_number),
            FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE
        )
    `);

    // 2. sections.material_id (existing rows keep course_id; new column is
    //    nullable so nothing existing breaks)
    if (!columnExists('sections', 'material_id')) {
        db.exec(`ALTER TABLE sections ADD COLUMN material_id INTEGER REFERENCES materials(id)`);
    }
});

migration();

console.log('Migration complete.');
console.log('material_pages table:', db.prepare(`PRAGMA table_info(material_pages)`).all());
console.log('sections table:', db.prepare(`PRAGMA table_info(sections)`).all());

db.close();
