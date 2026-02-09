/**
 * Express application setup.
 * Mounts API routes and serves the frontend static files.
 */

const express = require('express');
const path = require('path');
const fs = require('fs');

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

// Public path: cwd-based so it works on Render (and with ES modules if switched later)
const publicPath = path.resolve(process.cwd(), 'public');
if (!fs.existsSync(publicPath)) {
  console.warn('Public path missing:', publicPath);
}

// Serve static files with explicit MIME types (avoids text/plain on Render)
const mime = { '.css': 'text/css', '.js': 'application/javascript', '.html': 'text/html', '.ico': 'image/x-icon', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2' };
app.use(express.static(publicPath, {
  setHeaders: (res, filePath) => {
    const ext = path.extname(filePath);
    if (mime[ext]) res.setHeader('Content-Type', mime[ext]);
  },
}));

// SPA-style: for any non-API GET request, serve index.html
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(publicPath, 'index.html'));
});

module.exports = app;
