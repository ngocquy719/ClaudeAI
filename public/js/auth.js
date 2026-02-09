/**
 * Shared auth helpers: token storage and redirect if not logged in.
 * Exposed as global `auth` so login.js and app.js can use it.
 */

const TOKEN_KEY = 'private_app_token';

const auth = {
  getToken() {
    return localStorage.getItem(TOKEN_KEY);
  },
  setToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
  },
  clearToken() {
    localStorage.removeItem(TOKEN_KEY);
  },
  /**
   * If we're on the app page (index) and there's no token, redirect to login.
   */
  requireAuth() {
    if (!this.getToken()) {
      window.location.href = '/login.html';
      return false;
    }
    return true;
  },
  /**
   * Build headers with JWT for API requests.
   */
  authHeaders() {
    const token = this.getToken();
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  },
};
