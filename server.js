const express = require('express');
const cors = require('cors');

const app = express();
const PORT = 3000;


app.use(cors());


const path = require('path');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const authRoutes = require('./backend/routes/auth');
const studySessionRoutes = require('./backend/routes/studySessions');
const courseRoutes = require('./backend/routes/courses');
const materialRoutes = require('./backend/routes/materials');
console.log('MATERIAL ROUTES TYPE:', typeof materialRoutes);
console.log('MATERIAL ROUTES:', materialRoutes);

const frontendPath = path.join(__dirname, 'frontend');

// Trust reverse proxy for secure cookies and https URLs
app.set('trust proxy', 1);

// JSON and URL-encoded body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'studygps_secure_dev_secret_key',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: 'auto',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  })
);

// Initialize Passport and session
app.use(passport.initialize());
app.use(passport.session());

// Passport serialization
passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

// Google OAuth credentials configuration
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '817397034800-uruk0oe4n0f33au5nmm4uvlunutu6mge.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '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';

if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL || '/api/auth/google/callback',
        proxy: true
      },
      (accessToken, refreshToken, profile, done) => {
        // Return authenticated Google user profile
        return done(null, profile);
      }
    )
  );
}

// Mount auth routes under /api/auth
app.use('/api/auth', authRoutes);

// Mount study session routes
app.use('/api/study-sessions', studySessionRoutes);

// Mount course routes
app.use('/api/courses', courseRoutes);

// Mount Material routes
app.use('/api/materials', materialRoutes);

// Serve static frontend assets
app.use(express.static(frontendPath));

// API health endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'StudyGPS' });
});

// Route aliases for clean navigation
app.get('/login', (req, res) => {
  res.sendFile(path.join(frontendPath, 'login.html'));
});

app.get('/interview', (req, res) => {
  res.sendFile(path.join(frontendPath, 'interview.html'));
});

app.get('/materials', (req, res) => {
  res.sendFile(path.join(frontendPath, 'materials.html'));
});

app.get('/signup', (req, res) => {
  res.sendFile(path.join(frontendPath, 'interview.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(frontendPath, 'dashboard.html'));
});

app.get('/courses', (req, res) => {
  res.sendFile(path.join(frontendPath, 'materials.html'));
});

app.get('/route', (req, res) => {
  res.sendFile(path.join(frontendPath, 'route.html'));
});

app.get('/tasks', (req, res) => {
  res.sendFile(path.join(frontendPath, 'tasks.html'));
});

app.get('/quiz', (req, res) => {
  res.sendFile(path.join(frontendPath, 'quiz.html'));
});

app.get('/progress', (req, res) => {
  res.sendFile(path.join(frontendPath, 'progress.html'));
});

app.get('/reports', (req, res) => {
  res.sendFile(path.join(frontendPath, 'reports.html'));
});

app.get('/schedule', (req, res) => {
  res.sendFile(path.join(frontendPath, 'schedule.html'));
});

app.get('/timer', (req, res) => {
  res.sendFile(path.join(frontendPath, 'timer.html'));
});

// Fallback for direct browser refresh or navigation
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`StudyGPS server running on http://0.0.0.0:${PORT}`);
});
