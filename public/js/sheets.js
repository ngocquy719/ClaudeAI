/**
 * Sheets list page: require auth, list sheets, create new.
 */

(function () {
  if (!auth.requireAuth()) return;

  const usernameEl = document.getElementById('username');
  const newSheetName = document.getElementById('newSheetName');
  const createBtn = document.getElementById('createBtn');
  const sheetsList = document.getElementById('sheetsList');
  const messageEl = document.getElementById('message');

  function showMessage(text, isError) {
    messageEl.textContent = text;
    messageEl.className = 'message ' + (isError ? 'error' : 'success');
    messageEl.hidden = false;
  }

  let userRole = 'user';
  async function loadUser() {
    try {
      const res = await fetch('/api/me', { headers: auth.authHeaders() });
      if (res.ok) {
        const data = await res.json();
        usernameEl.textContent = data.user?.username ?? 'User';
        userRole = data.user?.role || 'user';
        const canCreate = userRole === 'admin' || userRole === 'leader';
        var toolbar = document.querySelector('.sheets-toolbar');
        if (toolbar) toolbar.style.display = canCreate ? '' : 'none';
      }
    } catch (_) {}
  }

  async function loadSheets() {
    try {
      const res = await fetch('/api/sheets', { headers: auth.authHeaders() });
      if (res.status === 401) {
        auth.clearToken();
        window.location.href = '/login.html';
        return;
      }
      const list = await res.json();
      sheetsList.innerHTML = '';
      if (list.length === 0) {
        sheetsList.innerHTML = '<li style="color:#666;">No sheets yet. Create one above.</li>';
        return;
      }
      list.forEach(function (s) {
        const li = document.createElement('li');
        const updated = s.updated_at ? new Date(s.updated_at).toLocaleString() : '';
        const perm = s.my_permission ? ' (' + s.my_permission + ')' : '';
        let right = '<span class="meta">' + escapeHtml(updated) + perm + '</span>';
        if (s.can_delete) {
          right = '<button type="button" class="btn btn-danger btn-sm sheet-delete" data-id="' + s.id + '" data-name="' + escapeAttr(s.name) + '">Xóa</button> ' + right;
        }
        li.innerHTML =
          '<a href="/sheet.html?id=' + s.id + '">' + escapeHtml(s.name) + '</a>' +
          right;
        sheetsList.appendChild(li);
      });
      sheetsList.querySelectorAll('.sheet-delete').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          const id = parseInt(btn.dataset.id, 10);
          const name = btn.dataset.name || '';
          if (confirm('Xóa sheet “‘ + name + ’”? Không thể hoàn tác.')) deleteSheet(id);
        });
      });
    } catch (err) {
      sheetsList.innerHTML = '<li style="color:#c00;">Failed to load list.</li>';
    }
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function escapeAttr(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;');
  }

  async function deleteSheet(id) {
    try {
      const res = await fetch('/api/sheets/' + id, { method: 'DELETE', headers: auth.authHeaders() });
      if (res.status === 401) {
        auth.clearToken();
        window.location.href = '/login.html';
        return;
      }
      const data = await res.json().catch(function () { return {}; });
      if (res.ok) {
        showMessage('Đã xóa sheet.', false);
        loadSheets();
      } else {
        showMessage(data.error || 'Không xóa được sheet', true);
      }
    } catch (err) {
      showMessage('Lỗi mạng.', true);
    }
  }

  createBtn.addEventListener('click', async function () {
    const name = newSheetName.value.trim() || 'Untitled';
    try {
      const res = await fetch('/api/sheets', {
        method: 'POST',
        headers: auth.authHeaders(),
        body: JSON.stringify({ name: name }),
      });
      if (res.status === 401) {
        auth.clearToken();
        window.location.href = '/login.html';
        return;
      }
      const data = await res.json().catch(function () { return {}; });
      if (res.ok && data.id) {
        window.location.href = '/sheet.html?id=' + data.id;
      } else {
        showMessage(data.error || 'Failed to create sheet', true);
      }
    } catch (err) {
      showMessage('Network error.', true);
    }
  });

  document.getElementById('logoutBtn').addEventListener('click', function () {
    auth.clearToken();
    window.location.href = '/login.html';
  });

  loadUser();
  loadSheets();
})();
