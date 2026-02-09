/**
 * Main app page: require login, show user and dashboard, handle logout.
 */

(function () {
  // Redirect to login if not authenticated
  if (!auth.requireAuth()) return;

  const usernameEl = document.getElementById('username');
  const dashboardEl = document.getElementById('dashboardMessage');
  const logoutBtn = document.getElementById('logoutBtn');
  const versionEl = document.getElementById('versionInfo');

  async function loadDashboard() {
    try {
      const res = await fetch('/api/dashboard', {
        headers: auth.authHeaders(),
      });

      if (res.status === 401) {
        auth.clearToken();
        window.location.href = '/login.html';
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        dashboardEl.textContent = data.message ?? 'Welcome.';
      } else {
        dashboardEl.textContent = data.error || 'Failed to load.';
      }
    } catch (err) {
      dashboardEl.textContent = 'Network error. Is the server running?';
    }
  }

  async function loadVersion() {
    if (!versionEl) return;
    try {
      const res = await fetch('/api/version', {
        headers: auth.authHeaders(),
      });
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      if (!data) return;
      const version = data.version || '0.0.0';
      const build = data.build;
      let text = `Version: ${version}`;
      if (build) text += ` (${String(build).slice(0, 7)})`;
      versionEl.textContent = text;
    } catch (_) {
      // Silent fail; version info is optional
    }
  }

  // Get username and role from /api/me for header
  async function loadUser() {
    try {
      const res = await fetch('/api/me', { headers: auth.authHeaders() });
      if (res.ok) {
        const data = await res.json();
        usernameEl.textContent = data.user?.username ?? 'User';
        const role = data.user?.role;
        const usersLink = document.getElementById('usersLink');
        if (usersLink && (role === 'admin' || role === 'leader')) usersLink.style.display = '';
      }
    } catch (_) {}
  }

  loadUser();
  loadDashboard();
  loadVersion();

  logoutBtn.addEventListener('click', () => {
    auth.clearToken();
    window.location.href = '/login.html';
  });
})();
