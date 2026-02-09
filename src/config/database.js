/**
 * SQLite database setup.
 * Creates the database file and tables if they don't exist.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Use env or default path. Ensure data directory exists.
const dbDir = path.resolve(process.cwd(), 'data');
const dbPath = process.env.DATABASE_PATH
  ? path.resolve(process.cwd(), process.env.DATABASE_PATH)
  : path.join(dbDir, 'app.db');

const dirToCreate = path.dirname(dbPath);
if (!fs.existsSync(dirToCreate)) {
  fs.mkdirSync(dirToCreate, { recursive: true });
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

const ROLES = ['admin', 'leader', 'editor', 'viewer'];
const SHEET_PERMISSIONS = ['owner', 'edit', 'view'];

function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'editor',
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

    CREATE TABLE IF NOT EXISTS sheets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL DEFAULT 'Untitled',
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_sheets_user_id ON sheets(user_id);

    CREATE TABLE IF NOT EXISTS sheet_permissions (
      sheet_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      permission TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (sheet_id, user_id),
      FOREIGN KEY (sheet_id) REFERENCES sheets(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_sheet_permissions_sheet ON sheet_permissions(sheet_id);
    CREATE INDEX IF NOT EXISTS idx_sheet_permissions_user ON sheet_permissions(user_id);

    CREATE TABLE IF NOT EXISTS sheet_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sheet_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      created_by INTEGER,
      FOREIGN KEY (sheet_id) REFERENCES sheets(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_sheet_versions_sheet ON sheet_versions(sheet_id);
  `);
  try {
    db.exec(`ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'editor'`);
    db.exec(`UPDATE users SET role = 'editor' WHERE role IS NULL`);
  } catch (e) {
    if (!e.message.includes('duplicate column')) throw e;
  }
  try {
    db.exec(`ALTER TABLE users ADD COLUMN created_by INTEGER REFERENCES users(id)`);
  } catch (e) {
    if (!e.message.includes('duplicate column')) throw e;
  }
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_users_created_by ON users(created_by)`);
  } catch (e) {
    if (!e.message.includes('duplicate') && !e.message.includes('already exists')) throw e;
  }
  return db;
}

module.exports.ROLES = ROLES;
module.exports.SHEET_PERMISSIONS = SHEET_PERMISSIONS;

module.exports = { db, initDatabase };
