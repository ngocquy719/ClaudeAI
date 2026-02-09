/**
 * Express application setup.
 * Mounts API routes and serves the frontend static files.
 */

const express = require('express');
const path = require('path');

const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const usersRoutes = require('./routes/users');
const sheetsRoutes = require('./routes/sheets');

const app = express();

// Parse JSON body for API
app.use(express.json());

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/sheets', sheetsRoutes);
app.use('/api', apiRoutes);

// Serve static frontend from /public
const publicPath = path.join(__dirname, '..', 'public');
app.use(express.static(publicPath));

// SPA-style: for any non-API GET request, serve index.html so frontend router can handle it
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(publicPath, 'index.html'));
});

module.exports = app;
