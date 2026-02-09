# Deploy Private Web App (Express + SQLite + JWT + Luckysheet) to Render

## Deliverables summary

| Item | Status |
|------|--------|
| Code changes | Server listens on `0.0.0.0`, uses `process.env.PORT`, no localhost in logs; JWT from `process.env.JWT_SECRET` |
| Config | `render.yaml` (Blueprint); no Docker or other config files |
| Git commands | See "Exact git commands" below |
| Public URL | `https://<service-name>.onrender.com` |
| Free-tier limits | Sleep after ~15 min; ephemeral disk (see section 6) |

---

## Exact git commands (all you need to run)

```bash
git add .
git commit -m "Render deploy: render.yaml and server 0.0.0.0"
git push origin main
```

Then in Render: **New → Blueprint** (or **Web Service**), connect this repo, apply. No other deploy commands.

---

## Platform: **Render**

**Why Render**
- Free tier for Node.js web services, no credit card required.
- WebSockets (Socket.IO) work out of the box on web services.
- No Docker required: set build + start commands and deploy from Git.
- Single config file (`render.yaml`) or simple dashboard setup.

---

## 1. Prepare the repo

Ensure your app runs locally and is pushed to GitHub (or GitLab/Bitbucket):

```bash
git add .
git commit -m "Prepare for Render deploy"
git push origin main
```

---

## 2. Create the service on Render

### Option A – From Blueprint (recommended)

1. Go to [https://dashboard.render.com](https://dashboard.render.com) and sign in (or sign up with GitHub).
2. Click **New** → **Blueprint**.
3. Connect your Git provider if needed, then select the repository that contains this app.
4. Render will detect `render.yaml`. Click **Apply**.
5. After the service is created, open the service → **Environment**.
6. Copy the auto-generated **JWT_SECRET** and **BOOTSTRAP_SECRET** (or set your own). You need **BOOTSTRAP_SECRET** to create the first admin (bootstrap) once deployed.

### Option B – Manual Web Service

1. Go to [https://dashboard.render.com](https://dashboard.render.com) → **New** → **Web Service**.
2. Connect the repository that contains this app.
3. Use:
   - **Name:** `private-web` (or any name).
   - **Region:** Oregon (or closest to you).
   - **Branch:** `main` (or your default branch).
   - **Runtime:** Node.
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free.
4. Under **Environment**, add:
   - **JWT_SECRET** – set to a long random string (e.g. generate one: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
   - **BOOTSTRAP_SECRET** – same idea; used only for creating the first admin account.
5. Click **Create Web Service**.

---

## 3. Commands you need (summary)

| Step | Command / action |
|------|-------------------|
| Push code | `git push origin main` |
| Build (on Render) | Automatic: `npm install` |
| Start (on Render) | Automatic: `npm start` |
| First admin | Open `https://<your-service>.onrender.com/login.html` → use Bootstrap form with your **BOOTSTRAP_SECRET** and desired username/password. |

No local deploy commands: Render builds and runs from your Git repo.

---

## 4. Public URL

After the first successful deploy:

- **URL:** `https://<your-service-name>.onrender.com`
- Example: `https://private-web-xxxx.onrender.com`

Replace `<your-service-name>` with the name you gave the Web Service (e.g. `private-web`). You can see the exact URL in the Render dashboard on the service page.

---

## 5. Environment variables (reference)

| Variable | Required | Purpose |
|----------|----------|---------|
| `PORT` | No (set by Render) | Render sets this; app uses `process.env.PORT \|\| 3000`. |
| `JWT_SECRET` | **Yes** | Secret for signing JWTs. Set a long random string in Production. |
| `BOOTSTRAP_SECRET` | Yes for first admin | Used on login page to create the first admin (bootstrap). |
| `NODE_ENV` | No | Set to `production` on Render. |
| `DATABASE_PATH` | No | Default: `data/app.db`. On Render the filesystem is ephemeral (see below). |

---

## 6. Free-tier limitations (important)

- **Sleep:** The free instance spins down after about **15 minutes** of no traffic. The first request after that may take **30–60 seconds** (cold start). Then the app and Socket.IO work normally until the next spin-down.
- **No persistent disk:** The filesystem is **ephemeral**. Anything written to `data/` (SQLite DB) is **lost on deploy or restart**. So:
  - SQLite is fine for a **demo** or **short-lived data**.
  - For real persistence you’d need an external DB (e.g. Render PostgreSQL, or another host) and code changes to use it.
- **WebSockets:** Supported. When the instance is awake, realtime collaboration (Socket.IO) works. When it spins down, connections drop and will reconnect after the next cold start.

---

## 7. After deploy checklist

1. Open `https://<your-service>.onrender.com`.
2. You should see the app (login or dashboard depending on route).
3. Open `https://<your-service>.onrender.com/login.html` and use the **Bootstrap** form with your **BOOTSTRAP_SECRET** to create the first admin.
4. Log in with that admin, then use **Users** to create more users and **Sheets** to test Luckysheet and sharing.
5. Open a sheet in two browser tabs/windows to verify **realtime** updates (Socket.IO) when the instance is awake.

---

## 8. Optional: custom domain

In Render: open your Web Service → **Settings** → **Custom Domains** → add your domain and follow the DNS instructions.
