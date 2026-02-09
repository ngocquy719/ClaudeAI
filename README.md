# Private Web App

A simple fullstack web app for personal use. It uses **Node.js + Express** on the backend, **SQLite** for storage, and **JWT** for authentication. The frontend is a minimal web UI; all pages require login.

## Folder structure

```
private-web/
├── public/                 # Frontend (static files served by Express)
│   ├── index.html          # Dashboard (after login)
│   ├── login.html          # Login; first-time setup (bootstrap) to create first admin
│   ├── users.html          # Users (Admin/Leader: create user, list visible users)
│   ├── sheets.html         # Sheets list (create, open)
│   ├── sheet.html          # Sheet editor (Luckysheet UI)
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── auth.js         # Token storage, auth helpers
│       ├── login.js        # Login and bootstrap form
│       ├── app.js          # Dashboard and logout
│       ├── users.js        # Users page (create user, list)
│       ├── sheets.js       # Sheets list page
│       └── sheet.js        # Sheet editor (load, auto-save, import/export Excel)
├── src/                    # Backend
│   ├── config/
│   │   └── database.js     # SQLite + tables (users, sheets, sheet_permissions, sheet_versions)
│   ├── lib/
│   │   └── excel.js        # Excel import/export
│   ├── middleware/
│   │   ├── auth.js         # JWT verification
│   │   └── roles.js        # requireRole, requireSheetPermission, getSheetPermission
│   ├── routes/
│   │   ├── auth.js         # POST /api/auth/bootstrap (first admin), POST /api/auth/login
│   │   ├── api.js          # GET /api/me, /api/dashboard
│   │   ├── users.js        # POST /api/users (create), GET /api/users (list visible)
│   │   └── sheets.js       # Sheets CRUD, share, versions, restore, import/export
│   ├── socket.js           # Socket.IO: auth, join sheet room, sheet:update → save + broadcast
│   ├── app.js              # Express app (routes + static)
│   └── server.js           # HTTP server + Socket.IO attach
├── data/                   # SQLite DB (created on first run)
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## How to run the project

### 1. Install Node.js

You need **Node.js 18** or newer. Check:

```bash
node -v
```

### 2. Install dependencies

In the project root (`private-web`):

```bash
npm install
```

### 3. Environment variables

Copy the example env file and edit if needed:

```bash
copy .env.example .env
```

- **PORT** – Port for the server (default `3000`).
- **JWT_SECRET** – Secret used to sign JWTs. **Use a long, random value in production.**
- **BOOTSTRAP_SECRET** – Required to create the first admin (no public registration). Use on login page “First-time setup” once.
- **DATABASE_PATH** – Path to the SQLite file (default `./data/app.db`).

### 4. Start the server

```bash
npm start
```

For development with auto-restart on file changes:

```bash
npm run dev
```

### 5. Open in browser

- **http://localhost:3000** – Dashboard (or login).
- **http://localhost:3000/login.html** – Login. **First time:** use “First-time setup” with `BOOTSTRAP_SECRET` (from .env) to create the first admin, then log in.
- **http://localhost:3000/users.html** – Users (Admin/Leader only: create users, list visible). **Auth required.**
- **http://localhost:3000/sheets.html** – Sheets list (create, open). **Auth required.**
- **http://localhost:3000/sheet.html?id=1** – Edit sheet 1 (Luckysheet, share, version history). **Auth required.**

**No public registration.** Users are created only by Admin or Leader (see Users page). Admin creates any role; Leader creates only Editor or Viewer. Leader sees only users they created; Admin sees all. Sheet sharing: Admin can share with any user; Leader only with users they created.

## Database schema

- **users:** `id`, `username` (unique), `password_hash`, `role` (admin | leader | editor | viewer), `created_by` (FK users.id; NULL for first admin), `created_at`
- **sheets:** `id`, `user_id` (owner), `name`, `content` (JSON), `created_at`, `updated_at`
- **sheet_permissions:** `sheet_id`, `user_id`, `permission` (owner | edit | view). Owner row created on sheet create; sharing adds edit/view rows.
- **sheet_versions:** `id`, `sheet_id`, `content`, `created_at`, `created_by` (user_id). Snapshot on each save/import for version history.

## Permissions & collaboration

- **Global roles (users.role):**  
  - **admin** – Full control (create any user, see all users, sheets, sharing with any user).  
  - **leader** – Create sheets; create only Editor/Viewer users; see only users they created; share only with those users.  
  - **editor** – Can edit sheets shared with them; cannot delete; cannot create users or share.  
  - **viewer** – Read-only; cannot create users or share.  
  No public registration. First user: create via **First-time setup** on login page with `BOOTSTRAP_SECRET`. All other users are created by Admin or Leader (Users page).

- **Per-sheet permissions:**  
  - **owner** – Creator; can share and delete.  
  - **edit** – Can edit and import/export.  
  - **view** – Read-only; can export.  
  Only **admin** or **owner** can manage sharing (Share dialog).

- **Share sheet:** In the sheet editor, click **Share**. Loads current permissions; add users (view/edit) and save. Uses `PUT /api/sheets/:id/share` with `{ shares: [ { userId, permission } ] }`.

- **Version history:** Click **Version history**. Lists snapshots (date, user). **Restore** loads that version into the sheet. Snapshots are created on each save and on import.

- **Realtime:** Socket.IO at path `/socket.io`. Client connects with JWT in `auth.token`. Emits **join** with `sheetId`; receives **yjs-init** (full state) and **yjs-update** (CRDT deltas). Cell-level sync via Yjs; no polling, no full-sheet reload.

## Sheets (Google Sheets–like)

- **UI:** [Luckysheet](https://github.com/dream-num/Luckysheet) (open-source), served from the same Express app.
- **Storage:** One row per sheet in SQLite; `content` is a JSON snapshot of the workbook (array of sheet configs).
- **Auto-save:** Realtime sync via Yjs + Socket.IO (no periodic save; persist to DB is debounced on server after edits).
- **Excel:** Import (.xlsx) via “Import .xlsx”; export via “Export .xlsx” (server uses luckyexcel + ExcelJS).

### Sheets API (all require `Authorization: Bearer <token>`)

| Method | Path | Description |
|--------|------|-------------|
| POST   | `/api/sheets` | Create sheet. Body: `{ name?: string }`. |
| GET    | `/api/sheets` | List current user’s sheets. |
| GET    | `/api/sheets/:id` | Load one sheet (id, name, content). |
| PUT    | `/api/sheets/:id` | Save. Body: `{ name?: string, content?: string }`. |
| POST   | `/api/sheets/:id/import-excel` | Import .xlsx (multipart field `file`). |
| GET    | `/api/sheets/:id/export-excel` | Download sheet as .xlsx. |

## API (for reference)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST   | `/api/auth/register` | No  | Create user `{ username, password }` |
| POST   | `/api/auth/login`    | No  | Login, returns `{ token, user }`     |
| GET    | `/api/me`           | Yes | Current user from JWT                |
| GET    | `/api/dashboard`    | Yes | Example protected data               |

Protected routes need header: `Authorization: Bearer <token>`.

## Tech stack

- **Backend:** Node.js, Express, better-sqlite3, bcryptjs, jsonwebtoken, dotenv, multer, luckyexcel, exceljs
- **Frontend:** Plain HTML, CSS, JavaScript; Luckysheet (CDN) for spreadsheets
- **Auth:** Username/password, JWT in `localStorage`

## Production notes

- Set a strong **JWT_SECRET** in `.env`.
- Use HTTPS in production.
- Keep `data/` (and `.env`) out of version control (see `.gitignore`).
