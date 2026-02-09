/**
 * Role and sheet-permission middleware.
 * Assumes req.user exists (requireAuth) with userId, username, role.
 */

const { db } = require('../config/database');

const ROLE_ORDER = { admin: 4, leader: 3, editor: 2, viewer: 1 };
const PERM_ORDER = { owner: 3, edit: 2, view: 1 };

function hasRole(userRole, requiredRoles) {
  if (!userRole || !requiredRoles || !requiredRoles.length) return false;
  if (requiredRoles.includes(userRole)) return true;
  const userLevel = ROLE_ORDER[userRole] || 0;
  const maxRequired = Math.max(...requiredRoles.map((r) => ROLE_ORDER[r] || 0));
  return userLevel >= maxRequired;
}

function ensureRoleLoaded(req) {
  if (req.user && req.user.userId && req.user.role == null) {
    const u = db.prepare('SELECT role FROM users WHERE id = ?').get(req.user.userId);
    req.user.role = u ? u.role : 'editor';
  }
}

function requireRole(allowedRoles) {
  return (req, res, next) => {
    ensureRoleLoaded(req);
    const role = req.user && req.user.role;
    if (!role) return res.status(403).json({ error: 'Forbidden' });
    if (Array.isArray(allowedRoles) && !allowedRoles.includes(role)) {
      return res.status(403).json({ error: 'Insufficient role' });
    }
    next();
  };
}

function getSheetPermission(sheetId, userId) {
  const sheet = db.prepare('SELECT id, user_id FROM sheets WHERE id = ?').get(sheetId);
  if (!sheet) return null;
  if (sheet.user_id === userId) return 'owner';
  const row = db.prepare(
    'SELECT permission FROM sheet_permissions WHERE sheet_id = ? AND user_id = ?'
  ).get(sheetId, userId);
  return row ? row.permission : null;
}

function getSheetRow(sheetId) {
  return db.prepare('SELECT id, user_id, name, content, created_at, updated_at FROM sheets WHERE id = ?').get(sheetId);
}

/** Admin chính: user có created_by IS NULL, không ai thay thế được. */
function isRootAdmin(userId) {
  if (!userId) return false;
  const u = db.prepare('SELECT created_by FROM users WHERE id = ?').get(userId);
  return u ? u.created_by == null : false;
}

function canManageSharing(sheetId, userId, userRole) {
  if (userRole === 'admin') return true;
  const perm = getSheetPermission(sheetId, userId);
  return perm === 'owner';
}

/** Admin: all user ids. Leader: only users they created. Editor/Viewer: empty. */
function getVisibleUserIds(req) {
  ensureRoleLoaded(req);
  const role = req.user && req.user.role;
  const userId = req.user && req.user.userId;
  if (role === 'admin') {
    const rows = db.prepare('SELECT id FROM users').all();
    return rows.map((r) => r.id);
  }
  if (role === 'leader') {
    const rows = db.prepare('SELECT id FROM users WHERE created_by = ?').all(userId);
    return rows.map((r) => r.id);
  }
  return [];
}

function requireSheetPermission(minPermission) {
  return (req, res, next) => {
    ensureRoleLoaded(req);
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    const userId = req.user.userId;
    const userRole = req.user.role;
    const sheet = getSheetRow(id);
    if (!sheet) return res.status(404).json({ error: 'Sheet not found' });
    let perm = getSheetPermission(id, userId);
    if (userRole === 'admin') perm = perm || 'owner';
    if (!perm) return res.status(403).json({ error: 'No access to this sheet' });
    const minLevel = PERM_ORDER[minPermission] || 0;
    const userLevel = PERM_ORDER[perm] || 0;
    if (userLevel < minLevel) return res.status(403).json({ error: 'Insufficient permission' });
    req.sheet = sheet;
    req.sheetPermission = perm;
    next();
  };
}

module.exports = {
  hasRole,
  ensureRoleLoaded,
  requireRole,
  getSheetPermission,
  getSheetRow,
  canManageSharing,
  getVisibleUserIds,
  requireSheetPermission,
  isRootAdmin,
};
