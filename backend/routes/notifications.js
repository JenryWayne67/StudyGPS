// backend/routes/notifications.js
//
// POST /api/notifications/test - lets a user verify their email
// notifications actually work the moment they turn the toggle on in
// Settings, instead of just trusting it silently and finding out (or
// not) whenever the next real reminder would have fired. Real reminder
// emails for upcoming scheduled sessions are sent by the background
// check in server.js (checkAndSendScheduleReminders), not here - this
// route only ever sends one manual test message.

const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { sendMail, isConfigured } = require('../lib/mailer');

const router = express.Router();

router.use(requireAuth);

router.post('/test', async (req, res) => {
    try {
        const to = req.user.email;
        if (!to) {
            return res.status(400).json({ success: false, error: 'Your account has no email address on file.' });
        }

        const result = await sendMail({
            to,
            subject: 'StudyGPS - test notification',
            text: `Hi ${req.user.name || 'there'}, this is a test email from StudyGPS. If you got this, email notifications are working.`,
            html: `<p>Hi ${req.user.name || 'there'},</p><p>This is a test email from StudyGPS. If you got this, email notifications are working.</p>`
        });

        if (!result.sent) {
            return res.status(503).json({ success: false, error: result.reason || 'Could not send test email.' });
        }

        res.json({ success: true, message: `Test email sent to ${to}.` });
    } catch (error) {
        console.error('Send test notification error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/notifications/status - whether the SERVER has SMTP configured
// at all, so Settings can show "ask your admin to configure this" instead
// of a confusing failure only after the user opts in and hits Send Test.
router.get('/status', (req, res) => {
    res.json({ success: true, configured: isConfigured() });
});

module.exports = router;
