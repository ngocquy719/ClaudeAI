/**
 * Socket.IO: auth, join sheet room, broadcast sheet updates for realtime sync.
 */

const jwt = require('jsonwebtoken');
const { getSheetPermission, getSheetRow } = require('./middleware/roles');
const { db } = require('./config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

function saveVersion(sheetId, content, userId) {
  db.prepare(
    'INSERT INTO sheet_versions (sheet_id, content, created_by) VALUES (?, ?, ?)'
  ).run(sheetId, content, userId || null);
}

function attachSocket(io) {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error('auth required'));
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      socket.userId = decoded.userId;
      socket.username = decoded.username;
      socket.role = decoded.role || null;
      next();
    } catch (err) {
      next(new Error('invalid token'));
    }
  });

  io.on('connection', (socket) => {
    socket.on('join', (sheetId, ack) => {
      const id = parseInt(sheetId, 10);
      if (Number.isNaN(id)) return ack && ack({ error: 'Invalid sheet id' });
      const sheet = getSheetRow(id);
      if (!sheet) return ack && ack({ error: 'Sheet not found' });
      let perm = getSheetPermission(id, socket.userId);
      if (socket.role === 'admin') perm = perm || 'owner';
      if (!perm) return ack && ack({ error: 'No access' });
      socket.sheetId = id;
      socket.join('sheet:' + id);
      ack && ack({ ok: true, permission: perm });
    });

    socket.on('sheet:update', (payload, ack) => {
      const sheetId = parseInt(payload?.sheetId, 10);
      if (Number.isNaN(sheetId) || !payload?.content) {
        return ack && ack({ error: 'Invalid payload' });
      }
      let perm = getSheetPermission(sheetId, socket.userId);
      if (socket.role === 'admin') perm = perm || 'owner';
      if (perm !== 'owner' && perm !== 'edit') {
        return ack && ack({ error: 'Need edit permission' });
      }
      const contentStr = typeof payload.content === 'string'
        ? payload.content
        : JSON.stringify(payload.content);
      const prev = db.prepare('SELECT content FROM sheets WHERE id = ?').get(sheetId);
      if (prev) saveVersion(sheetId, prev.content, socket.userId);
      db.prepare("UPDATE sheets SET content = ?, updated_at = datetime('now') WHERE id = ?").run(contentStr, sheetId);
      socket.to('sheet:' + sheetId).emit('sheet:content', { content: payload.content });
      ack && ack({ ok: true });
    });

    socket.on('disconnect', () => {});
  });

  return io;
}

module.exports = { attachSocket };
