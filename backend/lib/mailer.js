// backend/lib/mailer.js
//
// Thin wrapper around nodemailer for StudyGPS's email notifications
// (schedule reminders, deadline nudges). Configured entirely via .env -
// see .env.example - the same "works with nothing configured, degrades
// gracefully" pattern this app already uses for Google OAuth
// (backend/routes/auth.js's ensureGoogleConfigured): with no SMTP_* vars
// set, every call here just logs why it skipped and returns
// { sent: false, reason }, instead of crashing the whole server or
// silently pretending an email went out.
//
// require('nodemailer') is wrapped in try/catch on purpose: this package
// was just added to package.json's dependencies, but this app is reached
// through a file bridge with no way to run `npm install` on the user's
// machine for them - so until they run it themselves, nodemailer's
// package folder may not exist on disk yet. Rather than have that missing
// folder crash the entire server on startup (breaking every other route
// in the app over an optional feature), this degrades the same way as
// having no SMTP_* vars set: notifications just don't send until it's
// installed.

let nodemailer = null;
try {
    nodemailer = require('nodemailer');
} catch (err) {
    console.warn(
        '⚠️  nodemailer is not installed yet - email notifications are disabled ' +
        'until you run `npm install` (it was just added to package.json).'
    );
}

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;

let cachedTransporter = null;
let warnedNotConfigured = false;

function isConfigured() {
    return Boolean(nodemailer && SMTP_HOST && SMTP_USER && SMTP_PASS);
}

function getTransporter() {
    if (!isConfigured()) return null;
    if (cachedTransporter) return cachedTransporter;

    cachedTransporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465, // true for the implicit-TLS port, STARTTLS otherwise
        auth: { user: SMTP_USER, pass: SMTP_PASS }
    });
    return cachedTransporter;
}

// Sends one email. Never throws - a notification failing to send should
// never take down whatever real work triggered it (saving a task,
// generating a schedule, etc.). Returns { sent: true } on success, or
// { sent: false, reason } when skipped/failed, so a caller that wants to
// surface that (e.g. the Settings "send test email" button) can.
async function sendMail({ to, subject, text, html }) {
    if (!nodemailer) {
        return { sent: false, reason: 'nodemailer is not installed - run `npm install` and restart the server.' };
    }
    if (!isConfigured()) {
        if (!warnedNotConfigured) {
            console.warn(
                '⚠️  Email notifications are enabled by a user but SMTP_HOST/SMTP_USER/SMTP_PASS ' +
                'are not set in .env - see .env.example. Skipping email send(s).'
            );
            warnedNotConfigured = true;
        }
        return { sent: false, reason: 'Email sending is not configured on the server yet (missing SMTP settings).' };
    }
    if (!to) {
        return { sent: false, reason: 'No recipient email address.' };
    }

    try {
        const transporter = getTransporter();
        await transporter.sendMail({ from: SMTP_FROM, to, subject, text, html });
        return { sent: true };
    } catch (err) {
        console.error('Failed to send email:', err.message);
        return { sent: false, reason: err.message };
    }
}

module.exports = { sendMail, isConfigured };
