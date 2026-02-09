/**
 * Users page: Admin/Leader only. Create users, list, đổi role (chỉ admin chính), xóa (theo quyền).
 */

(function () {
  if (!auth.requireAuth()) return;

  const usernameEl = document.getElementById('username');
  const createUserSection = document.getElementById('createUserSection');
  const newUsername = document.getElementById('newUsername');
  const newPassword = document.getElementById('newPassword');
  const newRole = document.getElementById('newRole');
  const createUserBtn = document.getElementById('createUserBtn');
  const usersList = document.getElementById('usersList');
  const userMessage = document.getElementById('userMessage');

  let me = { userId: null, role: '', isRootAdmin: false };

  function showMessage(text, isError) {
    userMessage.textContent = text;
    userMessage.className = 'message ' + (isError ? 'error' : 'success');
    userMessage.hidden = false;
  }

  async function loadUser() {
    try {
      const res = await fetch('/api/me', { headers: auth.authHeaders() });
      if (res.ok) {
        const data = await res.json();
        me = {
          userId: data.user?.id ?? data.user?.userId,
          role: data.user?.role || '',
          isRootAdmin: !!data.user?.isRootAdmin,
        };
        usernameEl.textContent = data.user?.username ?? 'User';
        if (me.role !== 'admin' && me.role !== 'leader') {
          userMessage.textContent = 'Chỉ Admin hoặc Leader mới truy cập trang này.';
          userMessage.className = 'message error';
          userMessage.hidden = false;
          createUserSection.style.display = 'none';
          document.getElementById('permissionSection').style.display = 'none';
          return;
        }
        if (me.role === 'admin') {
          newRole.innerHTML = '<option value="admin">Admin</option><option value="leader">Leader</option><option value="editor">Editor</option><option value="viewer">Viewer</option>';
        } else {
          newRole.innerHTML = '<option value="editor">Editor</option><option value="viewer">Viewer</option>';
        }
      }
    } catch (_) {}
  }

  function canChangeRole(u) {
    return me.isRootAdmin && !u.is_root_admin;
  }

  function canDeleteUser(u) {
    if (u.is_root_admin) return false;
    if (u.id === me.userId) return false;
    if (me.isRootAdmin) return true;
    return (me.role === 'admin' || me.role === 'leader') && u.created_by === me.userId;
  }

  async function loadUsers() {
    try {
      const res = await fetch('/api/users', { headers: auth.authHeaders() });
      if (res.status === 401) {
        auth.clearToken();
        window.location.href = '/login.html';
        return;
      }
      if (res.status === 403) {
        usersList.innerHTML = '<tr><td colspan="4" style="color:#666;">Bạn không được xem danh sách user.</td></tr>';
        return;
      }
      const list = await res.json();
      usersList.innerHTML = '';
      if (list.length === 0) {
        usersList.innerHTML = '<tr><td colspan="4" style="color:#666;">Chưa có user (Leader chỉ thấy user do mình tạo).</td></tr>';
        return;
      }
      const roles = ['admin', 'leader', 'editor', 'viewer'];
      list.forEach(function (u) {
        const tr = document.createElement('tr');
        const roleLabel = { admin: 'Admin', leader: 'Leader', editor: 'Editor', viewer: 'Viewer' }[u.role] || u.role;
        const badge = u.is_root_admin ? ' <span class="badge badge-root">Admin chính</span>' : '';
        const by = u.created_by_username ? escapeHtml(u.created_by_username) : '–';
        let actions = '';
        if (canChangeRole(u)) {
          const opts = roles.map(function (r) {
            const label = { admin: 'Admin', leader: 'Leader', editor: 'Editor', viewer: 'Viewer' }[r];
            return '<option value="' + r + '"' + (u.role === r ? ' selected' : '') + '>' + label + '</option>';
          }).join('');
          actions += '<select class="role-select" data-user-id="' + u.id + '">' + opts + '</select> ';
        }
        if (canDeleteUser(u)) {
          actions += '<button type="button" class="btn btn-danger btn-sm delete-user" data-user-id="' + u.id + '" data-username="' + escapeAttr(u.username) + '">Xóa</button>';
        }
        if (!actions) actions = '–';
        tr.innerHTML =
          '<td><strong>' + escapeHtml(u.username) + '</strong>' + badge + '</td>' +
          '<td>' + escapeHtml(roleLabel) + '</td>' +
          '<td>' + by + '</td>' +
          '<td class="actions">' + actions + '</td>';
        usersList.appendChild(tr);
      });
      usersList.querySelectorAll('.role-select').forEach(function (sel) {
        sel.addEventListener('change', function () {
          const id = parseInt(sel.dataset.userId, 10);
          const role = sel.value;
          patchRole(id, role);
        });
      });
      usersList.querySelectorAll('.delete-user').forEach(function (btn) {
        btn.addEventListener('click', function () {
          const id = parseInt(btn.dataset.userId, 10);
          const name = btn.dataset.username || '';
          if (confirm('Xóa user “‘ + name + ’”? Không thể hoàn tác.')) deleteUser(id);
        });
      });
    } catch (err) {
      usersList.innerHTML = '<tr><td colspan="4" style="color:#c00;">Lỗi tải danh sách.</td></tr>';
    }
  }

  function escapeAttr(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;');
  }

  function escapeHtml(s) {
    if (s == null) return '';
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  async function patchRole(userId, role) {
    try {
      const res = await fetch('/api/users/' + userId, {
        method: 'PATCH',
        headers: auth.authHeaders(),
        body: JSON.stringify({ role: role }),
      });
      const data = await res.json().catch(function () { return {}; });
      if (res.status === 401) { auth.clearToken(); window.location.href = '/login.html'; return; }
      if (res.ok) {
        showMessage('Đã đổi vai trò.', false);
        loadUsers();
      } else {
        showMessage(data.error || 'Không đổi được vai trò', true);
      }
    } catch (err) {
      showMessage('Lỗi mạng.', true);
    }
  }

  async function deleteUser(userId) {
    try {
      const res = await fetch('/api/users/' + userId, { method: 'DELETE', headers: auth.authHeaders() });
      const data = await res.json().catch(function () { return {}; });
      if (res.status === 401) { auth.clearToken(); window.location.href = '/login.html'; return; }
      if (res.ok) {
        showMessage('Đã xóa user.', false);
        loadUsers();
      } else {
        showMessage(data.error || 'Không xóa được user', true);
      }
    } catch (err) {
      showMessage('Lỗi mạng.', true);
    }
  }

  createUserBtn.addEventListener('click', async function () {
    const username = newUsername.value.trim();
    const password = newPassword.value;
    const role = newRole.value;
    if (!username || !password) {
      showMessage('Username and password are required', true);
      return;
    }
    if (username.length < 2) {
      showMessage('Username at least 2 characters', true);
      return;
    }
    if (password.length < 6) {
      showMessage('Password at least 6 characters', true);
      return;
    }
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: auth.authHeaders(),
        body: JSON.stringify({ username, password, role }),
      });
      const data = await res.json().catch(function () { return {}; });
      if (res.status === 401) {
        auth.clearToken();
        window.location.href = '/login.html';
        return;
      }
      if (res.ok) {
        showMessage('Đã tạo user.', false);
        newUsername.value = '';
        newPassword.value = '';
        loadUsers();
      } else {
        showMessage(data.error || 'Tạo user thất bại', true);
      }
    } catch (err) {
      showMessage('Lỗi mạng.', true);
    }
  });

  document.getElementById('logoutBtn').addEventListener('click', function () {
    auth.clearToken();
    window.location.href = '/login.html';
  });

  loadUser().then(function () { loadUsers(); });
})();
