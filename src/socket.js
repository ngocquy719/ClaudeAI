const jwt = require('jsonwebtoken');
const Y = require('yjs');
const { getSheetPermission, getSheetRow } = require('./middleware/roles');
const { db } = require('./config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

const sheetDocs = new Map();
// Debounce only for DB persist (writes). Realtime broadcast to other clients is always immediate.
const PERSIST_DEBOUNCE_MS = 800;

function contentToYDoc(contentStr) {
  const doc = new Y.Doc();
  const cells = doc.getMap('cells');
  let sheets;
  try {
    sheets = typeof contentStr === 'string' ? JSON.parse(contentStr) : contentStr;
  } catch (_) {
    return doc;
  }
  if (!Array.isArray(sheets) || !sheets[0]) return doc;
  const sheet0 = sheets[0];
  const data = sheet0.data;
  if (Array.isArray(data)) {
    for (let r = 0; r < data.length; r++) {
      if (!Array.isArray(data[r])) continue;
      for (let c = 0; c < data[r].length; c++) {
        const cell = data[r][c];
        if (cell == null) continue;
        cells.set(r + '_' + c, JSON.stringify(cell));
      }
    }
  }
  const celldata = sheet0.celldata;
  if (Array.isArray(celldata)) {
    for (let i = 0; i < celldata.length; i++) {
      const cell = celldata[i];
      const r = cell.r != null ? cell.r : cell.row;
      const c = cell.c != null ? cell.c : cell.column;
      if (r == null || c == null) continue;
      const key = r + '_' + c;
      const val = cell.v !== undefined && typeof cell.v === 'object' && cell.v !== null
        ? cell.v
        : { v: cell.v, m: cell.m };
      cells.set(key, JSON.stringify(val));
    }
  }
  return doc;
}

function yDocToContent(doc, sheetName) {
  const cells = doc.getMap('cells');
  const data = [];
  cells.forEach((val, key) => {
    const parts = key.split('_');
    const r = parseInt(parts[0], 10);
    const c = parseInt(parts[1], 10);
    if (Number.isNaN(r) || Number.isNaN(c)) return;
    if (!data[r]) data[r] = [];
    try {
      data[r][c] = JSON.parse(val);
    } catch (_) {
      data[r][c] = { v: val };
    }
  });
  const sheets = [{
    name: sheetName || 'Sheet1',
    color: '',
    status: 1,
    order: 0,
    index: 0,
    data,
    config: {},
  }];
  return JSON.stringify(sheets);
}

function getOrCreateSheetDoc(sheetId, contentStr, sheetName) {
  let entry = sheetDocs.get(sheetId);
  if (entry) return entry.doc;
  const doc = contentToYDoc(contentStr || '[]');
  entry = { doc, sheetName: sheetName || 'Sheet1', persistTimer: null };
  sheetDocs.set(sheetId, entry);
  return doc;
}

function schedulePersist(sheetId) {
  const entry = sheetDocs.get(sheetId);
  if (!entry) return;
  if (entry.persistTimer) clearTimeout(entry.persistTimer);
  entry.persistTimer = setTimeout(() => {
    entry.persistTimer = null;
    try {
      const contentStr = yDocToContent(entry.doc, entry.sheetName);
      db.prepare("UPDATE sheets SET content = ?, updated_at = datetime('now') WHERE id = ?").run(contentStr, sheetId);
    } catch (_) {}
  }, PERSIST_DEBOUNCE_MS);
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
    socket.on('join', (payload, ack) => {
      const sheetId = typeof payload === 'object' && payload != null ? parseInt(payload.sheetId, 10) : parseInt(payload, 10);
      if (Number.isNaN(sheetId)) return ack && ack({ error: 'Invalid sheet id' });
      const row = getSheetRow(sheetId);
      if (!row) return ack && ack({ error: 'Sheet not found' });
      let perm = getSheetPermission(sheetId, socket.userId);
      if (socket.role === 'admin') perm = perm || 'owner';
      if (!perm) return ack && ack({ error: 'No access' });
      socket.sheetId = sheetId;
      socket.join('sheet:' + sheetId);
      const sheetName = (row.name || 'Sheet1').trim() || 'Sheet1';
      const entry = sheetDocs.get(sheetId);
      if (entry) entry.sheetName = sheetName;
      const doc = getOrCreateSheetDoc(sheetId, row.content, sheetName);
      const state = Y.encodeStateAsUpdate(doc);
      const stateB64 = Buffer.from(state).toString('base64');
      socket.emit('yjs-init', { sheetId, state: stateB64 });
      socket.to('sheet:' + sheetId).emit('awareness:join', { userId: socket.userId, username: socket.username || '' });
      io.in('sheet:' + sheetId).fetchSockets().then(function (sockets) {
        sockets.forEach(function (s) {
          if (s.id !== socket.id && s.userId != null) {
            socket.emit('awareness:join', { userId: s.userId, username: s.username || '' });
          }
        });
      });
      ack && ack({ ok: true, permission: perm });
    });

    // Cell-level CRDT: apply incoming update and broadcast immediately (no batching, no delay).
    socket.on('yjs-update', (payload, ack) => {
      const sheetId = socket.sheetId;
      if (sheetId == null) return ack && ack({ error: 'Not joined' });
      let perm = getSheetPermission(sheetId, socket.userId);
      if (socket.role === 'admin') perm = perm || 'owner';
      if (perm !== 'owner' && perm !== 'editor') return ack && ack({ error: 'Need edit permission' });
      const entry = sheetDocs.get(sheetId);
      if (!entry) return ack && ack({ error: 'Sheet doc not found' });
      let update;
      if (typeof payload === 'string') {
        update = Buffer.from(payload, 'base64');
      } else if (payload && payload.state) {
        update = Buffer.from(payload.state, 'base64');
      } else {
        return ack && ack({ error: 'Invalid payload' });
      }
      try {
        Y.applyUpdate(entry.doc, new Uint8Array(update));
      } catch (e) {
        return ack && ack({ error: 'Apply failed' });
      }
      // Broadcast to other clients immediately (event-based sync only).
      socket.to('sheet:' + sheetId).emit('yjs-update', { state: Buffer.from(update).toString('base64') });
      schedulePersist(sheetId);
      ack && ack({ ok: true });
    });

    socket.on('awareness', (data) => {
      if (socket.sheetId == null) return;
      socket.to('sheet:' + socket.sheetId).emit('awareness:update', {
        userId: socket.userId,
        username: socket.username || '',
        cell: data && data.cell,
      });
    });

    socket.on('disconnect', () => {
      if (socket.sheetId != null) {
        socket.to('sheet:' + socket.sheetId).emit('awareness:leave', { userId: socket.userId });
      }
    });
  });

  return io;
}

module.exports = { attachSocket };
