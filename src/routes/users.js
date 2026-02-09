const express = require('express');
const bcrypt = require('bcryptjs');
const { requireAuth } = require('../middleware/auth');
const { ensureRoleLoaded, isRootAdmin } = require('../middleware/roles');
const { db } = require('../config/database');

const router = express.Router();
router.use(requireAuth);

const SALT_ROUNDS = 10;

router.post('/', (req, res) => {
  ensureRoleLoaded(req);
  const role = req.user.role;
  if (role !== 'admin' && role !== 'leader') {
    return res.status(403).json({ error: 'Only admin or leader can create users' });
  }

  const { username, password, role: newRole } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  if (username.length < 2) return res.status(400).json({ error: 'Username at least 2 characters' });
  if (password.length < 6) return res.status(400).json({ error: 'Password at least 6 characters' });

  let roleToSet = 'user';
  if (role === 'admin' && (newRole === 'leader' || newRole === 'user')) {
    roleToSet = newRole;
  } else if (role === 'leader' && newRole === 'user') {
    roleToSet = 'user';
  } else if (role === 'admin' && newRole === 'admin') {
    return res.status(403).json({ error: 'Only bootstrap can create admin' });
  }

  const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);
  const createdBy = req.user.userId;

  try {
    db.prepare(
      'INSERT INTO users (username, password_hash, role, created_by) VALUES (?, ?, ?, ?)'
    ).run(username, passwordHash, roleToSet, createdBy);
    const row = db.prepare(
      'SELECT id, username, role, created_by, created_at FROM users WHERE id = last_insert_rowid()'
    ).get();
    res.status(201).json(row);
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Username already exists' });
    }
    throw err;
  }
});

router.get('/', (req, res) => {
  ensureRoleLoaded(req);
  const role = req.user.role;
  if (role !== 'admin' && role !== 'leader') {
    return res.status(403).json({ error: 'Only admin or leader can list users' });
  }

  let rows;
  if (role === 'admin') {
    rows = db.prepare(`
      SELECT u.id, u.username, u.role, u.created_by, u.created_at,
             c.username AS created_by_username
      FROM users u
      LEFT JOIN users c ON c.id = u.created_by
      ORDER BY u.username
    `).all();
  } else {
    rows = db.prepare(`
      SELECT u.id, u.username, u.role, u.created_by, u.created_at,
             c.username AS created_by_username
      FROM users u
      LEFT JOIN users c ON c.id = u.created_by
      WHERE u.created_by = ?
      ORDER BY u.username
    `).all(req.user.userId);
  }

  const withRoot = rows.map((r) => ({ ...r, is_root_admin: r.created_by == null }));
  res.json(withRoot);
});

/**
 * PATCH /api/users/:id - Đổi role. Chỉ admin chính được đổi role user khác; không được đổi role admin chính.
 */
router.patch('/:id', (req, res) => {
  ensureRoleLoaded(req);
  const currentId = req.user.userId;
  if (!isRootAdmin(currentId)) {
    return res.status(403).json({ error: 'Only root admin can change user roles' });
  }
  const targetId = parseInt(req.params.id, 10);
  if (Number.isNaN(targetId)) return res.status(400).json({ error: 'Invalid id' });
  const target = db.prepare('SELECT id, created_by, role FROM users WHERE id = ?').get(targetId);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.created_by == null) {
    return res.status(403).json({ error: 'Cannot change root admin role' });
  }
  const newRole = req.body.role;
  const allowed = ['admin', 'leader', 'user'];
  if (!allowed.includes(newRole)) return res.status(400).json({ error: 'Invalid role' });
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(newRole, targetId);
  res.json({ ok: true, role: newRole });
});

/**
 * DELETE /api/users/:id - Xóa user. Admin chính: xóa bất kỳ (trừ chính mình). Admin sub/Leader: chỉ xóa user do mình tạo.
 * Không thể xóa admin chính.
 */
router.delete('/:id', (req, res) => {
  ensureRoleLoaded(req);
  const currentId = req.user.userId;
  const targetId = parseInt(req.params.id, 10);
  if (Number.isNaN(targetId)) return res.status(400).json({ error: 'Invalid id' });
  const target = db.prepare('SELECT id, created_by, role FROM users WHERE id = ?').get(targetId);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.created_by == null) {
    return res.status(403).json({ error: 'Cannot delete root admin' });
  }
  if (targetId === currentId) {
    return res.status(400).json({ error: 'Cannot delete yourself' });
  }
  if (isRootAdmin(currentId)) {
    db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
    return res.json({ ok: true });
  }
  const role = req.user.role;
  if ((role === 'admin' || role === 'leader') && target.created_by === currentId) {
    db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
    return res.json({ ok: true });
  }
  return res.status(403).json({ error: 'You can only delete users you created' });
});

module.exports = router;
