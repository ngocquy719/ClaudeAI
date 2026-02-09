/**
 * Auth: login only. No public registration.
 * First user: POST /api/auth/bootstrap with BOOTSTRAP_SECRET (env) + username, password.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../config/database');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();
const SALT_ROUNDS = 10;

/**
 * POST /api/auth/bootstrap
 * Creates the first admin user when:
 * - No users exist, OR
 * - No admin exists yet (recovery: add first admin).
 * Body: { username, password, secret }
 * secret must match env BOOTSTRAP_SECRET (trimmed).
 */
router.post('/bootstrap', (req, res) => {
  const rawSecret = process.env.BOOTSTRAP_SECRET;
  const envSecret = rawSecret ? String(rawSecret).trim() : '';
  const bodySecret = req.body.secret != null ? String(req.body.secret).trim() : '';
  if (!envSecret) {
    return res.status(503).json({ error: 'Bootstrap not configured. Set BOOTSTRAP_SECRET in .env' });
  }
  if (bodySecret !== envSecret) {
    return res.status(403).json({ error: 'Invalid bootstrap secret. Check BOOTSTRAP_SECRET in .env' });
  }

  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  const adminCount = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get();
  const allowBootstrap = count.n === 0 || adminCount.n === 0;
  if (!allowBootstrap) {
    return res.status(400).json({
      error: 'An admin already exists. Use login. If you need to reset, remove data/app.db and restart.',
    });
  }

  const username = req.body.username != null ? String(req.body.username).trim() : '';
  const password = req.body.password;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  if (username.length < 2) return res.status(400).json({ error: 'Username at least 2 characters' });
  if (password.length < 6) return res.status(400).json({ error: 'Password at least 6 characters' });

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(409).json({
      error: 'Username already taken. Choose another username or use login.',
    });
  }

  const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);
  db.prepare('INSERT INTO users (username, password_hash, role, created_by) VALUES (?, ?, ?, ?)')
    .run(username, passwordHash, 'admin', null);
  res.status(201).json({ message: 'First admin created. You can now log in.' });
});

/**
 * POST /api/auth/login
 * Body: { username, password }
 * Returns: { token, user: { id, username, role } }
 */
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const row = db.prepare('SELECT id, username, password_hash, role FROM users WHERE username = ?').get(username);
  if (!row) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const valid = bcrypt.compareSync(password, row.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const role = row.role || 'editor';
  const token = jwt.sign(
    { userId: row.id, username: row.username, role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({
    token,
    user: { id: row.id, username: row.username, role },
  });
});

module.exports = router;
