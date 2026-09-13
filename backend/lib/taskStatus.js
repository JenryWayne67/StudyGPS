// backend/lib/taskStatus.js
//
// A scheduled task is split into sessions (one schedules row each). Finishing
// one session only marks that row done; the task itself is Completed only once
// every one of its sessions is. Marking one session used to complete the whole
// task, which ticked all of its other sessions too.

const { db } = require('./db');

// Recompute tasks.status from its sessions. Returns the new status, or null
// when the task has no scheduled sessions (the caller decides then).
async function refreshTaskStatusFromSessions(taskId) {
    const counts = await db.prepare(`
        SELECT COUNT(*) AS total, SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) AS done
        FROM schedules
        WHERE task_id = ?
    `).get(taskId);

    const total = Number(counts && counts.total) || 0;
    if (total === 0) return null;
    const done = Number(counts.done) || 0;

    let status = 'Completed';
    if (done < total) {
        const logged = await db.prepare(`SELECT COUNT(*) AS n FROM study_sessions WHERE task_id = ?`).get(taskId);
        status = done > 0 || Number(logged && logged.n) > 0 ? 'In Progress' : 'Not Started';
    }

    await db.prepare(`UPDATE tasks SET status = ? WHERE id = ?`).run(status, taskId);
    return status;
}

module.exports = { refreshTaskStatusFromSessions };
