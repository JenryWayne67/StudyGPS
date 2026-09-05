// migrate-to-turso.js
//
// One-time script: copies your REAL existing local data (from
// database/studygps.db) into your Turso database, so nothing you've
// already created - your account, courses, uploaded materials, tasks,
// schedule, study history - is lost when the app switches from the local
// file to Turso.
//
// Run this ONCE, from the StudyGPS folder, after `npm install` and after
// TURSO_DATABASE_URL / TURSO_AUTH_TOKEN are set in your .env:
//
//     node migrate-to-turso.js
//
// Safe to look at before running: it only READS database/studygps.db and
// your uploaded PDF files, and only WRITES to Turso - your local database
// file is never modified or deleted.
//
// If you ever need to run it again from scratch, first delete all rows
// from every table in the Turso database (or just recreate the Turso
// database) - re-running it against a Turso database that already has
// these rows will fail with a "UNIQUE constraint" / primary-key conflict
// rather than silently duplicating anything.

require('./backend/lib/env');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!TURSO_URL || !TURSO_TOKEN) {
    console.error('TURSO_DATABASE_URL and/or TURSO_AUTH_TOKEN are not set in your .env - add them first.');
    process.exit(1);
}

const localDbPath = path.join(__dirname, 'database/studygps.db');
if (!fs.existsSync(localDbPath)) {
    console.error(`No local database found at ${localDbPath} - nothing to migrate.`);
    process.exit(1);
}

const local = createClient({ url: `file:${localDbPath}`, intMode: 'number' });
const remote = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN, intMode: 'number' });

// Tables in FK-safe order: parents before children, so every foreign key
// a row points at already exists on the Turso side by the time it's
// inserted.
const TABLES = [
    'users',
    'user_preferences',
    'courses',
    'materials',
    'material_pages',
    'sections',
    'tasks',
    'schedules',
    'study_sessions'
];

async function ensureRemoteSchema() {
    const usersTable = await remote.execute(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'`
    );
    if (usersTable.rows.length > 0) {
        console.log('Turso database already has tables - skipping schema creation.');
        return;
    }
    const schemaSql = fs.readFileSync(path.join(__dirname, 'database/schema.sql'), 'utf8');
    await remote.executeMultiple(schemaSql);
    console.log('Created schema on Turso.');
}

async function columnsOf(client, table) {
    const res = await client.execute(`PRAGMA table_info(${table})`);
    return res.rows.map((r) => r.name);
}

async function migrateTable(table) {
    const localCols = await columnsOf(local, table);
    const rows = (await local.execute(`SELECT * FROM ${table}`)).rows;

    if (rows.length === 0) {
        console.log(`${table}: 0 rows - nothing to copy.`);
        return 0;
    }

    // materials is the one table needing extra handling: older local
    // databases still point at a file on disk (file_path) rather than
    // holding the PDF bytes (file_data). Read the bytes straight from
    // disk here so Turso gets file_data populated either way, without
    // requiring the local server to have been restarted first.
    const isMaterials = table === 'materials';

    const insertCols = localCols.filter((c) => c !== 'file_data' || isMaterials);
    const finalCols = isMaterials && !insertCols.includes('file_data')
        ? [...insertCols, 'file_data']
        : insertCols;

    const placeholders = finalCols.map(() => '?').join(', ');
    const sql = `INSERT INTO ${table} (${finalCols.join(', ')}) VALUES (${placeholders})`;

    let copied = 0;
    for (const row of rows) {
        const args = finalCols.map((col) => {
            if (isMaterials && col === 'file_data') {
                if (row.file_data != null) return row.file_data;
                if (row.file_path && fs.existsSync(row.file_path)) {
                    try {
                        return fs.readFileSync(row.file_path);
                    } catch (err) {
                        console.warn(`  material ${row.id}: couldn't read ${row.file_path} (${err.message}) - file_data left NULL.`);
                        return null;
                    }
                }
                return null;
            }
            return row[col] === undefined ? null : row[col];
        });
        await remote.execute({ sql, args });
        copied++;
    }
    console.log(`${table}: copied ${copied} row(s).`);
    return copied;
}

async function main() {
    console.log(`Migrating ${localDbPath} -> ${TURSO_URL}\n`);
    await ensureRemoteSchema();

    const summary = {};
    for (const table of TABLES) {
        summary[table] = await migrateTable(table);
    }

    console.log('\nDone. Row counts copied:');
    for (const [table, count] of Object.entries(summary)) {
        console.log(`  ${table}: ${count}`);
    }
    console.log('\nYour local database/studygps.db was not modified. Once you\'ve');
    console.log('confirmed everything looks right on Turso, the app (local or on');
    console.log('Render) will use Turso automatically as long as TURSO_DATABASE_URL');
    console.log('and TURSO_AUTH_TOKEN are set.');
}

main().catch((err) => {
    console.error('\nMigration failed:', err);
    process.exit(1);
});
