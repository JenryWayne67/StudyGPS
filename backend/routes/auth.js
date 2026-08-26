const express = require('express');
const passport = require('passport');
const router = express.Router();

// Trigger Google Login
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

// Google Callback Route
router.get('/google/callback', 
  passport.authenticate('google', { failureRedirect: '/index.html' }),
  (req, res) => {
    // Redirect to schedule page after successful login
    res.redirect('/schedule.html');
  }
);

// Get Currently Logged-In User
router.get('/me', (req, res) => {
  if (req.isAuthenticated()) {
    res.json({ loggedIn: true, user: req.user });
  } else {
    res.status(401).json({ loggedIn: false });
  }
});

// Logout Route
router.get('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.redirect('/index.html');
  });
});

module.exports = router;