/**
 * Sheet editor: load/save, permissions, share UI, version history, realtime sync (socket.io).
 */

(function () {
  if (!auth.requireAuth()) return;

  const AUTO_SAVE_INTERVAL_MS = 15000;
  const containerId = 'luckysheet-container';
  const sheetId = (function () {
    const m = /[?&]id=(\d+)/.exec(window.location.search);
    return m ? parseInt(m[1], 10) : null;
  })();

  if (!sheetId) {
    document.getElementById('sheetTitle').textContent = 'Invalid sheet (missing id)';
    return;
  }

  const titleEl = document.getElementById('sheetTitle');
  const saveStatusEl = document.getElementById('saveStatus');
  const myPermissionBadge = document.getElementById('myPermissionBadge');
  const exportBtn = document.getElementById('exportExcelBtn');
  const importInput = document.getElementById('importExcelInput');
  const shareBtn = document.getElementById('shareBtn');
  const historyBtn = document.getElementById('historyBtn');

  let currentSheetData = null;
  let autoSaveTimer = null;
  let myPermission = 'view';
  let socket = null;
  let lastPermissionsData = null;

  function headers() {
    return auth.authHeaders();
  }

  function escapeHtml(s) {
    if (s == null) return '';
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function setStatus(text) {
    saveStatusEl.textContent = text;
  }

  function getWorkbookData() {
    if (typeof window.luckysheetfile !== 'undefined' && Array.isArray(window.luckysheetfile)) {
      return window.luckysheetfile;
    }
    if (window.luckysheet && typeof window.luckysheet.getAllSheets === 'function') {
      try {
        return window.luckysheet.getAllSheets() || currentSheetData;
      } catch (_) {}
    }
    return currentSheetData;
  }

  function saveToServer() {
    if (myPermission !== 'edit' && myPermission !== 'owner') return Promise.resolve();
    const data = getWorkbookData();
    if (!data) return Promise.resolve();
    const body = JSON.stringify({ content: data });
    return fetch('/api/sheets/' + sheetId, {
      method: 'PUT',
      headers: headers(),
      body: body,
    }).then(function (res) {
      if (res.status === 401) {
        auth.clearToken();
        window.location.href = '/login.html';
        return;
      }
      if (res.ok) setStatus('Saved');
      else setStatus('Save failed');
    }).catch(function () {
      setStatus('Save failed');
    });
  }

  function connectSocket() {
    const token = auth.getToken();
    if (!token) return;
    socket = window.io(window.location.origin, {
      path: '/socket.io',
      auth: { token: token },
    });
    socket.on('connect', function () {
      socket.emit('join', sheetId, function (ack) {
        if (ack && ack.error) setStatus(ack.error);
      });
    });
    socket.on('sheet:content', function (payload) {
      if (!payload || !payload.content) return;
      const content = Array.isArray(payload.content) ? payload.content : [];
      if (window.luckysheet && window.luckysheet.destroy) {
        try { window.luckysheet.destroy(); } catch (_) {}
      }
      if (autoSaveTimer) clearInterval(autoSaveTimer);
      currentSheetData = content.length ? content : [
        { name: 'Sheet1', color: '', status: 1, order: 0, data: [], config: {}, index: 0 },
      ];
      window.luckysheet.create({
        container: containerId,
        title: titleEl.textContent || 'Sheet',
        lang: 'en',
        data: currentSheetData,
        showinfobar: false,
        showstatisticBar: true,
        sheetFormulaBar: true,
        enableAddRow: true,
        enableAddBackTop: true,
        userInfo: false,
      });
      autoSaveTimer = setInterval(function () {
        setStatus('Saving…');
        saveToServer().then(function () {});
      }, AUTO_SAVE_INTERVAL_MS);
      setStatus('Updated from another user');
    });
    socket.on('connect_error', function () {
      setStatus('Realtime disconnected');
    });
  }

  function initLuckysheet(sheetName, data, permission) {
    myPermission = permission || 'view';
    myPermissionBadge.textContent = myPermission === 'owner' ? 'Owner' : myPermission === 'edit' ? 'Editor' : 'Viewer';
    currentSheetData = Array.isArray(data) && data.length ? data : [
      { name: 'Sheet1', color: '', status: 1, order: 0, data: [], config: {}, index: 0 },
    ];
    titleEl.textContent = sheetName || 'Sheet';
    if (myPermission === 'view') {
      exportBtn.style.display = '';
      if (importInput && importInput.closest('label')) importInput.closest('label').style.display = 'none';
    } else {
      exportBtn.style.display = '';
      if (importInput && importInput.closest('label')) importInput.closest('label').style.display = '';
    }
    window.luckysheet.create({
      container: containerId,
      title: sheetName || 'Sheet',
      lang: 'en',
      data: currentSheetData,
      showinfobar: false,
      showstatisticBar: true,
      sheetFormulaBar: true,
      enableAddRow: myPermission !== 'view',
      enableAddBackTop: true,
      userInfo: false,
    });

    if (myPermission !== 'view') {
      autoSaveTimer = setInterval(function () {
        setStatus('Saving…');
        saveToServer().then(function () {});
      }, AUTO_SAVE_INTERVAL_MS);
    }
    connectSocket();
  }

  function loadSheet() {
    setStatus('Loading…');
    fetch('/api/sheets/' + sheetId, { headers: headers() })
      .then(function (res) {
        if (res.status === 401) {
          auth.clearToken();
          window.location.href = '/login.html';
          return;
        }
        if (!res.ok) throw new Error('Failed to load');
        return res.json();
      })
      .then(function (row) {
        if (!row) return;
        let content = row.content;
        if (typeof content === 'string') {
          try {
            content = JSON.parse(content);
          } catch (_) {
            content = null;
          }
        }
        initLuckysheet(row.name, content, row.myPermission);
        setStatus('');
      })
      .catch(function () {
        setStatus('Load failed');
      });
  }

  exportBtn.addEventListener('click', function (e) {
    e.preventDefault();
    fetch('/api/sheets/' + sheetId + '/export-excel', { headers: headers() })
      .then(function (res) {
        if (!res.ok) throw new Error('Export failed');
        return res.blob();
      })
      .then(function (blob) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = (titleEl.textContent || 'sheet') + '.xlsx';
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch(function () {
        setStatus('Export failed');
      });
  });

  importInput.addEventListener('change', function () {
    const file = this.files && this.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    setStatus('Importing…');
    fetch('/api/sheets/' + sheetId + '/import-excel', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + (auth.getToken() || '') },
      body: fd,
    })
      .then(function (res) {
        if (res.status === 401) {
          auth.clearToken();
          window.location.href = '/login.html';
          return;
        }
        return res.json();
      })
      .then(function (data) {
        importInput.value = '';
        if (data && data.content && Array.isArray(data.content)) {
          if (window.luckysheet && window.luckysheet.destroy) window.luckysheet.destroy();
          if (autoSaveTimer) clearInterval(autoSaveTimer);
          initLuckysheet(titleEl.textContent, data.content, myPermission);
          setStatus('Imported');
        } else {
          setStatus(data && data.error ? data.error : 'Import failed');
        }
      })
      .catch(function () {
        importInput.value = '';
        setStatus('Import failed');
      });
  });

  function openShareModal() {
    const modal = document.getElementById('shareModal');
    const listEl = document.getElementById('shareList');
    const userSelect = document.getElementById('shareUserSelect');
    listEl.innerHTML = '';
    fetch('/api/sheets/' + sheetId + '/permissions', { headers: headers() })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        lastPermissionsData = data || null;
        if (!data) return;
        if (data.owner) {
          const li = document.createElement('li');
          li.textContent = data.owner.username + ' (Owner)';
          listEl.appendChild(li);
        }
        (data.shared || []).forEach(function (s) {
          const li = document.createElement('li');
          li.className = 'share-list-item';
          li.innerHTML =
            '<span>' + escapeHtml(s.username) + ' – ' + escapeHtml(s.permission) + '</span>' +
            '<button type="button" class="btn btn-danger btn-sm share-remove" data-user-id="' + s.user_id + '">Xóa</button>';
          listEl.appendChild(li);
        });
        listEl.querySelectorAll('.share-remove').forEach(function (btn) {
          btn.addEventListener('click', function () {
            const removeUserId = String(this.getAttribute('data-user-id'));
            const existing = (lastPermissionsData && lastPermissionsData.shared || [])
              .filter(function (s) { return String(s.user_id) !== removeUserId; })
              .map(function (s) { return { userId: String(s.user_id), permission: s.permission }; });
            fetch('/api/sheets/' + sheetId + '/share', {
              method: 'PUT',
              headers: headers(),
              body: JSON.stringify({ shares: existing }),
            })
              .then(function (r) {
                if (r.ok) openShareModal();
              });
          });
        });
      });
    fetch('/api/users', { headers: headers() })
      .then(function (r) { return r.json(); })
      .then(function (users) {
        userSelect.innerHTML = '<option value="">-- Choose user --</option>';
        (users || []).forEach(function (u) {
          const opt = document.createElement('option');
          opt.value = u.id;
          opt.textContent = u.username;
          userSelect.appendChild(opt);
        });
      });
    modal.classList.remove('hidden');
  }

  document.getElementById('shareCloseBtn').addEventListener('click', function () {
    document.getElementById('shareModal').classList.add('hidden');
  });

  document.getElementById('shareAddBtn').addEventListener('click', function () {
    const userId = document.getElementById('shareUserSelect').value;
    const permission = document.getElementById('sharePermSelect').value;
    if (!userId) return;
    const existing = (lastPermissionsData && lastPermissionsData.shared || []).map(function (s) {
      return { userId: String(s.user_id), permission: s.permission };
    });
    if (existing.some(function (s) { return s.userId === userId; })) return;
    existing.push({ userId: userId, permission: permission });
    fetch('/api/sheets/' + sheetId + '/share', {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ shares: existing }),
    })
      .then(function (r) {
        if (r.ok) openShareModal();
      });
  });

  shareBtn.addEventListener('click', openShareModal);

  function openHistoryModal() {
    const modal = document.getElementById('historyModal');
    const listEl = document.getElementById('versionList');
    listEl.innerHTML = '';
    fetch('/api/sheets/' + sheetId + '/versions', { headers: headers() })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (versions) {
        versions.forEach(function (v) {
          const li = document.createElement('li');
          const meta = new Date(v.created_at).toLocaleString() + (v.created_by_username ? ' by ' + v.created_by_username : '');
          li.innerHTML = '<span class="version-meta">' + meta + '</span><button type="button" class="btn restore-version" data-id="' + v.id + '">Restore</button>';
          listEl.appendChild(li);
        });
        listEl.querySelectorAll('.restore-version').forEach(function (btn) {
          btn.addEventListener('click', function () {
            const vid = this.getAttribute('data-id');
            fetch('/api/sheets/' + sheetId + '/versions/' + vid + '/restore', {
              method: 'POST',
              headers: headers(),
            })
              .then(function (r) { return r.ok ? r.json() : null; })
              .then(function (data) {
                if (data && data.content) {
                  modal.classList.add('hidden');
                  if (window.luckysheet && window.luckysheet.destroy) window.luckysheet.destroy();
                  if (autoSaveTimer) clearInterval(autoSaveTimer);
                  initLuckysheet(titleEl.textContent, data.content, myPermission);
                  setStatus('Version restored');
                }
              });
          });
        });
      });
    modal.classList.remove('hidden');
  }

  document.getElementById('historyCloseBtn').addEventListener('click', function () {
    document.getElementById('historyModal').classList.add('hidden');
  });

  historyBtn.addEventListener('click', openHistoryModal);

  loadSheet();
})();
