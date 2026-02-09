/**
 * Sheets API: create, list, get, save, share, versions (auth + permissions).
 * Excel import/export. Realtime via socket.io (see server).
 */

const express = require('express');
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');
const {
  requireRole,
  getSheetPermission,
  getSheetRow,
  canManageSharing,
  getVisibleUserIds,
  requireSheetPermission,
  isRootAdmin,
} = require('../middleware/roles');
const { db } = require('../config/database');
const { importExcelToLuckysheetJson, exportLuckysheetJsonToExcelBuffer } = require('../lib/excel');

const router = express.Router();
router.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const defaultContent = JSON.stringify([
  { name: 'Sheet1', color: '', status: 1, order: 0, data: [], config: {}, index: 0 },
]);

function saveVersion(sheetId, content, userId) {
  db.prepare(
    'INSERT INTO sheet_versions (sheet_id, content, created_by) VALUES (?, ?, ?)'
  ).run(sheetId, content, userId || null);
}

/**
 * POST /api/sheets - Create sheet. Leader or Admin only.
 */
router.post('/', requireRole(['admin', 'leader']), (req, res) => {
  const name = (req.body.name || 'Untitled').trim() || 'Untitled';
  const userId = req.user.userId;
  try {
    const stmt = db.prepare('INSERT INTO sheets (user_id, name, content) VALUES (?, ?, ?)');
    const result = stmt.run(userId, name, defaultContent);
    const sheetId = result.lastInsertRowid;
    db.prepare(
      'INSERT INTO sheet_permissions (sheet_id, user_id, permission) VALUES (?, ?, ?)'
    ).run(sheetId, userId, 'owner');
    const row = db.prepare(
      'SELECT id, name, created_at, updated_at FROM sheets WHERE id = ?'
    ).get(sheetId);
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create sheet' });
  }
});

/**
 * GET /api/sheets - List sheets (owned or shared with me). can_delete: chỉ owner hoặc admin chính.
 */
router.get('/', (req, res) => {
  const userId = req.user.userId;
  const rootAdmin = isRootAdmin(userId);
  const rows = db.prepare(`
    SELECT s.id, s.name, s.created_at, s.updated_at, s.user_id AS owner_id,
           COALESCE(p.permission, 'owner') AS my_permission
    FROM sheets s
    LEFT JOIN sheet_permissions p ON p.sheet_id = s.id AND p.user_id = ?
    WHERE s.user_id = ? OR p.user_id IS NOT NULL
    ORDER BY s.updated_at DESC
  `).all(userId, userId);
  const withDelete = rows.map((r) => ({
    ...r,
    can_delete: r.owner_id === userId || rootAdmin,
  }));
  res.json(withDelete);
});

/**
 * GET /api/sheets/:id - Load sheet. View permission. Returns content + myPermission.
 */
router.get('/:id', requireSheetPermission('view'), (req, res) => {
  const row = req.sheet;
  res.json({
    id: row.id,
    name: row.name,
    content: row.content,
    created_at: row.created_at,
    updated_at: row.updated_at,
    myPermission: req.sheetPermission,
  });
});

/**
 * PUT /api/sheets/:id - Save. Edit or owner. Creates version snapshot on content change.
 */
router.put('/:id', requireSheetPermission('edit'), (req, res) => {
  const id = req.sheet.id;
  const updates = [];
  const params = [];
  if (req.body.name !== undefined) {
    updates.push('name = ?');
    params.push((req.body.name || 'Untitled').trim() || 'Untitled');
  }
  if (req.body.content !== undefined) {
    const contentStr = typeof req.body.content === 'string'
      ? req.body.content
      : JSON.stringify(req.body.content);
    const prev = db.prepare('SELECT content FROM sheets WHERE id = ?').get(id);
    if (prev && prev.content !== contentStr) {
      saveVersion(id, prev.content, req.user.userId);
    }
    updates.push('content = ?');
    params.push(contentStr);
  }
  updates.push("updated_at = datetime('now')");
  params.push(id);
  if (updates.length <= 1) return res.json({ ok: true });
  db.prepare(`UPDATE sheets SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  const io = req.app.locals.io;
  if (io && req.body.content !== undefined) {
    const content = typeof req.body.content === 'string' ? req.body.content : JSON.stringify(req.body.content);
    io.to('sheet:' + id).emit('sheet:content', { content: req.body.content });
  }
  res.json({ ok: true });
});

/**
 * DELETE /api/sheets/:id - Chỉ chủ sở hữu sheet hoặc admin chính mới xóa được.
 * User do leader tạo không thể xóa sheet của cấp cao hơn.
 */
router.delete('/:id', requireSheetPermission('view'), (req, res) => {
  const sheet = req.sheet;
  const userId = req.user.userId;
  const canDelete = sheet.user_id === userId || isRootAdmin(userId);
  if (!canDelete) {
    return res.status(403).json({ error: 'Only sheet owner or root admin can delete this sheet' });
  }
  db.prepare('DELETE FROM sheet_permissions WHERE sheet_id = ?').run(sheet.id);
  db.prepare('DELETE FROM sheet_versions WHERE sheet_id = ?').run(sheet.id);
  db.prepare('DELETE FROM sheets WHERE id = ?').run(sheet.id);
  res.json({ ok: true });
});

/**
 * GET /api/sheets/:id/permissions - List who has access. Owner or Admin only.
 */
router.get('/:id/permissions', requireSheetPermission('view'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!canManageSharing(id, req.user.userId, req.user.role)) {
    return res.status(403).json({ error: 'Only owner or admin can view permissions' });
  }
  const sheet = getSheetRow(id);
  const owner = db.prepare('SELECT id, username FROM users WHERE id = ?').get(sheet.user_id);
  const shared = db.prepare(`
    SELECT p.user_id, p.permission, u.username
    FROM sheet_permissions p
    JOIN users u ON u.id = p.user_id
    WHERE p.sheet_id = ? AND p.permission != 'owner'
    ORDER BY u.username
  `).all(id);
  res.json({
    owner: owner ? { id: owner.id, username: owner.username, permission: 'owner' } : null,
    shared,
  });
});

/**
 * PUT /api/sheets/:id/share - Set sharing. Body: { shares: [ { userId, permission: 'view'|'edit' } ] }. Owner or Admin only.
 */
router.put('/:id/share', requireSheetPermission('view'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!canManageSharing(id, req.user.userId, req.user.role)) {
    return res.status(403).json({ error: 'Only owner or admin can manage sharing' });
  }
  const sheet = getSheetRow(id);
  const ownerId = sheet.user_id;
  const shares = Array.isArray(req.body.shares) ? req.body.shares : [];
  const visibleIds = getVisibleUserIds(req);
  for (const s of shares) {
    const uid = parseInt(s.userId, 10);
    if (Number.isNaN(uid) || uid === ownerId) continue;
    if (req.user.role === 'leader' && !visibleIds.includes(uid)) {
      return res.status(403).json({ error: 'Leader can only share with users they created' });
    }
  }
  db.prepare('DELETE FROM sheet_permissions WHERE sheet_id = ? AND user_id != ?').run(id, ownerId);
  const insert = db.prepare(
    'INSERT OR REPLACE INTO sheet_permissions (sheet_id, user_id, permission) VALUES (?, ?, ?)'
  );
  for (const s of shares) {
    const uid = parseInt(s.userId, 10);
    const perm = s.permission === 'edit' ? 'edit' : 'view';
    if (Number.isNaN(uid) || uid === ownerId) continue;
    if (req.user.role === 'leader' && !visibleIds.includes(uid)) continue;
    insert.run(id, uid, perm);
  }
  res.json({ ok: true });
});

/**
 * GET /api/sheets/:id/versions - List version history. View permission.
 */
router.get('/:id/versions', requireSheetPermission('view'), (req, res) => {
  const id = req.sheet.id;
  const rows = db.prepare(`
    SELECT v.id, v.sheet_id, v.created_at, v.created_by, u.username AS created_by_username
    FROM sheet_versions v
    LEFT JOIN users u ON u.id = v.created_by
    WHERE v.sheet_id = ?
    ORDER BY v.created_at DESC
    LIMIT 100
  `).all(id);
  res.json(rows);
});

/**
 * POST /api/sheets/:id/versions/:versionId/restore - Restore a version. Edit or owner.
 */
router.post('/:id/versions/:versionId/restore', requireSheetPermission('edit'), (req, res) => {
  const sheetId = req.sheet.id;
  const versionId = parseInt(req.params.versionId, 10);
  if (Number.isNaN(versionId)) return res.status(400).json({ error: 'Invalid version id' });
  const v = db.prepare('SELECT id, content FROM sheet_versions WHERE id = ? AND sheet_id = ?').get(versionId, sheetId);
  if (!v) return res.status(404).json({ error: 'Version not found' });
  db.prepare("UPDATE sheets SET content = ?, updated_at = datetime('now') WHERE id = ?").run(v.content, sheetId);
  res.json({ ok: true, content: JSON.parse(v.content) });
});

/**
 * POST /api/sheets/:id/import-excel
 */
router.post('/:id/import-excel', upload.single('file'), requireSheetPermission('edit'), async (req, res) => {
  const id = req.sheet.id;
  if (!req.file || !req.file.buffer) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const content = await importExcelToLuckysheetJson(req.file.buffer);
    const prev = db.prepare('SELECT content FROM sheets WHERE id = ?').get(id);
    if (prev) saveVersion(id, prev.content, req.user.userId);
    db.prepare("UPDATE sheets SET content = ?, updated_at = datetime('now') WHERE id = ?").run(content, id);
    res.json({ ok: true, content: JSON.parse(content) });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Import failed' });
  }
});

/**
 * GET /api/sheets/:id/export-excel
 */
router.get('/:id/export-excel', requireSheetPermission('view'), async (req, res) => {
  const row = req.sheet;
  try {
    const buffer = await exportLuckysheetJsonToExcelBuffer(row.content, row.name);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(row.name || 'sheet')}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Export failed' });
  }
});

module.exports = router;
