const express = require('express');
const authRoutes = require('./routes/auth');
// ... your other setup (passport, session, database) ...

// Mount auth routes under /api/auth
app.use('/api/auth', authRoutes);