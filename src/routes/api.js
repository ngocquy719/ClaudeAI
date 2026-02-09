/**
 * Protected API routes.
 * All routes here require a valid JWT (Authorization: Bearer <token>).
 */

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { ensureRoleLoaded, isRootAdmin } = require('../middleware/roles');
const pkg = require('../../package.json');

const router = express.Router();

// All routes in this file require authentication
router.use(requireAuth);

/**
 * GET /api/me
 * Returns current user (id, username, role, isRootAdmin).
 */
router.get('/me', (req, res) => {
  ensureRoleLoaded(req);
  const user = { ...req.user, isRootAdmin: isRootAdmin(req.user.userId) };
  res.json({ user });
});

/**
 * GET /api/dashboard
 */
router.get('/dashboard', (req, res) => {
  res.json({
    message: `Hello, ${req.user.username}. This is your private dashboard.`,
    time: new Date().toISOString(),
  });
});

/**
 * GET /api/version
 * Exposes backend version info so the UI can show which build is running.
 */
router.get('/version', (req, res) => {
  const version = pkg.version || '0.0.0';
  const build = process.env.BUILD_ID || process.env.RENDER_GIT_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA || null;
  res.json({
    version,
    build,
  });
});

module.exports = router;
