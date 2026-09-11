// Shared database connection - replaces the old pattern of every route file
// doing its own `const db = new Database(dbPath)` with better-sqlite3.
//
// This app moved off better-sqlite3 (a local file on disk) to Turso/libSQL
// (a hosted SQLite-compatible database reached over the network) so that
// user data survives Render's ephemeral disk being wiped on every restart/
// redeploy/sleep cycle. Same SQL dialect, same schema - the one real
// difference is that every call is now async (it's a network round trip),
// so every route handler that touches the database has to be `async` and
// every `db.prepare(sql).get/.all/.run(...)` call needs an `await` in
// front of it. This module keeps that call-site shape as close to the old
// synchronous better-sqlite3 API as possible to make that migration
// mechanical rather than a rewrite.
//
// Local dev with no Turso env vars set still works exactly as before: it
// falls back to a local SQLite file (via libSQL's embedded/file: mode),
// so `npm run dev` with no cloud account needs no changes.

const path = require('path');
const { createClient } = require('@libsql/client');

const localDbPath = path.join(__dirname, '../../database/studygps.db');
const url = process.env.TURSO_DATABASE_URL || `file:${localDbPath}`;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (process.env.TURSO_DATABASE_URL && !authToken) {
  console.warn(
    '⚠️  TURSO_DATABASE_URL is set but TURSO_AUTH_TOKEN is not - remote ' +
    'Turso databases require an auth token. Falling back may fail.'
  );
}

const client = createClient({
  url,
  ...(authToken ? { authToken } : {}),
  // Keep ordinary integer columns (ids, counts, minutes, etc.) as normal
  // JS numbers instead of BigInt, so JSON.stringify(...) in every route's
  // res.json(...) call keeps working exactly like it did with
  // better-sqlite3, with no BigInt handling anywhere else in the app.
  intMode: 'number'
});

function makeStatement(execTarget, sql) {
  return {
    async get(...args) {
      const res = await execTarget.execute({ sql, args });
      return res.rows[0];
    },
    async all(...args) {
      const res = await execTarget.execute({ sql, args });
      return res.rows;
    },
    async run(...args) {
      const res = await execTarget.execute({ sql, args });
      return {
        changes: Number(res.rowsAffected),
        // better-sqlite3 returns a plain number here; libsql returns a
        // BigInt (`1n`) regardless of intMode, so it's converted the same
        // way at every call site instead of leaking BigInt into route code.
        lastInsertRowid:
          res.lastInsertRowid === undefined || res.lastInsertRowid === null
            ? undefined
            : Number(res.lastInsertRowid)
      };
    }
  };
}

// Runs several statements in ONE database round trip instead of one per
// statement - for writing many rows at once (schedule sessions, a PDF's
// pages/sections/tasks). Against the hosted database every round trip costs
// real time, so a 40-row insert used to wait for 40 of them.
// statements: [{ sql, args }]. Returns [{ changes, lastInsertRowid }] in the
// same order.
function makeBatch(execTarget, inTransaction) {
  return async (statements) => {
    if (statements.length === 0) return [];
    const results = inTransaction
      ? await execTarget.batch(statements)
      : await execTarget.batch(statements, 'write');
    return results.map((res) => ({
      changes: Number(res.rowsAffected),
      lastInsertRowid:
        res.lastInsertRowid === undefined || res.lastInsertRowid === null
          ? undefined
          : Number(res.lastInsertRowid)
    }));
  };
}

const db = {
  prepare(sql) {
    return makeStatement(client, sql);
  },

  batch: makeBatch(client, false),

  // Async replacement for better-sqlite3's synchronous `db.transaction(fn)`.
  // better-sqlite3 usage was:
  //   const applyInsert = db.transaction((rows) => { ...db.prepare(...).run()... });
  //   const result = applyInsert(rows);
  // The migrated shape is the same, just async and explicit about which
  // `db` the statements inside run against (the open transaction, not the
  // module-level `db`), so a mid-way failure really rolls everything back:
  //   const applyInsert = db.transaction(async (tx, rows) => { ...tx.prepare(...).run()... });
  //   const result = await applyInsert(rows);
  transaction(fn) {
    return async (...callArgs) => {
      const tx = await client.transaction('write');
      const txDb = { prepare: (sql) => makeStatement(tx, sql), batch: makeBatch(tx, true) };
      try {
        const result = await fn(txDb, ...callArgs);
        await tx.commit();
        return result;
      } catch (err) {
        try {
          await tx.rollback();
        } catch (_) {
          // rollback failing after an already-failed transaction isn't
          // something the caller can do anything about - surface the
          // original error, not this one.
        }
        throw err;
      }
    };
  }
};

module.exports = { db, client };
