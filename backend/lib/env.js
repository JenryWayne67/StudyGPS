// backend/lib/env.js
//
// Minimal, dependency-free ".env" loader. StudyGPS avoids adding new npm
// packages that would need `npm install` run again (nobody automates that
// here), so this is a small hand-rolled stand-in for the `dotenv` package:
// reads a KEY=VALUE file and fills in any process.env value that isn't
// already set (a real environment variable always wins over the file).
//
// Require this once, as early as possible (top of server.js), before
// reading any process.env.* value.

const fs = require('fs');
const path = require('path');

function loadEnvFile(envPath) {
    if (!fs.existsSync(envPath)) {
        return;
    }

    const raw = fs.readFileSync(envPath, 'utf8');

    for (const rawLine of raw.split('\n')) {
        const line = rawLine.trim();

        if (!line || line.startsWith('#')) {
            continue;
        }

        const eqIndex = line.indexOf('=');
        if (eqIndex === -1) {
            continue;
        }

        const key = line.slice(0, eqIndex).trim();
        let value = line.slice(eqIndex + 1).trim();

        // Strip a single pair of matching surrounding quotes, if present.
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        if (key && !(key in process.env)) {
            process.env[key] = value;
        }
    }
}

loadEnvFile(path.join(__dirname, '../../.env'));

module.exports = { loadEnvFile };
