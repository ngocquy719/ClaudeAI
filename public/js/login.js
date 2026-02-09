/**
 * Login and first-time bootstrap. No public registration.
 */

(function () {
  const messageEl = document.getElementById('message');
  const bootstrapSection = document.getElementById('bootstrapSection');
  const showBootstrapLink = document.getElementById('showBootstrap');

  function showMessage(text, isError) {
    messageEl.textContent = text;
    messageEl.className = 'message ' + (isError ? 'error' : 'success');
    messageEl.hidden = false;
  }

  function hideMessage() {
    messageEl.hidden = true;
  }

  if (auth.getToken()) {
    window.location.href = '/';
    return;
  }

  showBootstrapLink.addEventListener('click', function (e) {
    e.preventDefault();
    bootstrapSection.hidden = !bootstrapSection.hidden;
  });

  document.getElementById('loginForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    hideMessage();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(function () { return {}; });

      if (!res.ok) {
        showMessage(data.error || 'Login failed', true);
        return;
      }

      auth.setToken(data.token);
      window.location.href = '/';
    } catch (err) {
      showMessage('Network error. Is the server running?', true);
    }
  });

  document.getElementById('bootstrapForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    hideMessage();
    const secret = document.getElementById('boot-secret').value.trim();
    const username = document.getElementById('boot-username').value.trim();
    const password = document.getElementById('boot-password').value;

    if (!username || !password) {
      showMessage('Username and password are required', true);
      return;
    }
    if (!secret) {
      showMessage('Enter BOOTSTRAP_SECRET (same value as in .env)', true);
      return;
    }

    try {
      const res = await fetch('/api/auth/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, secret }),
      });
      const data = await res.json().catch(function () { return {}; });

      if (!res.ok) {
        showMessage(data.error || 'Bootstrap failed', true);
        return;
      }

      showMessage(data.message || 'First admin created. You can log in above.', false);
      bootstrapSection.hidden = true;
    } catch (err) {
      showMessage('Network error.', true);
    }
  });
})();
