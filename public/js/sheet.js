import * as Y from 'https://esm.sh/yjs@13.6.17';

(function () {
  if (!window.auth || !window.auth.requireAuth()) return;

  const containerId = 'luckysheet-container';
  const sheetId = (function () {
    const m = /[?&]id=(\d+)/.exec(window.location.search);
    return m ? parseInt(m[1], 10) : null;
  })();

  if (!sheetId) {
    document.getElementById('sheetTitle').textContent = 'Invalid sheet (missing id)';
    return;
  }

  const auth = window.auth;
  const titleEl = document.getElementById('sheetTitle');
  const saveStatusEl = document.getElementById('saveStatus');
  const myPermissionBadge = document.getElementById('myPermissionBadge');
  const onlineUsersEl = document.getElementById('onlineUsers');
  const exportBtn = document.getElementById('exportExcelBtn');
  const importInput = document.getElementById('importExcelInput');
  const shareBtn = document.getElementById('shareBtn');
  const historyBtn = document.getElementById('historyBtn');

  let luckysheetInitialized = false;
  let ydoc = null;
  let cellsMap = null;
  let myPermission = 'viewer';
  let canManageShare = false;
  let socket = null;
  let lastPermissionsData = null;
  let isApplyingRemoteUpdate = false;
  const SOCKET_ORIGIN = {};
  const onlineUsers = {};
  let skipObserveOnce = false;

  function headers() {
    return auth ? auth.authHeaders() : {};
  }

  function escapeHtml(s) {
    if (s == null) return '';
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function setStatus(text) {
    if (saveStatusEl) saveStatusEl.textContent = text;
  }

  function updateOnlineUI() {
    const list = Object.keys(onlineUsers).map(function (id) { return onlineUsers[id].username || id; }).filter(Boolean);
    if (onlineUsersEl) onlineUsersEl.textContent = list.length ? list.join(', ') + ' online' : '';
  }

  function contentToCellsMap(content, cells) {
    if (!Array.isArray(content) || !content[0]) return;
    const sheet0 = content[0];
    const data = sheet0.data;
    if (Array.isArray(data)) {
      for (let r = 0; r < data.length; r++) {
        if (!Array.isArray(data[r])) continue;
        for (let c = 0; c < data[r].length; c++) {
          const cell = data[r][c];
          if (cell == null) continue;
          cells.set(r + '_' + c, JSON.stringify(cell));
        }
      }
    }
    const celldata = sheet0.celldata;
    if (Array.isArray(celldata)) {
      for (let i = 0; i < celldata.length; i++) {
        const cell = celldata[i];
        const r = cell.r != null ? cell.r : cell.row;
        const c = cell.c != null ? cell.c : cell.column;
        if (r == null || c == null) continue;
        const val = (cell.v !== undefined && typeof cell.v === 'object' && cell.v !== null)
          ? cell.v
          : { v: cell.v, m: cell.m };
        cells.set(r + '_' + c, JSON.stringify(val));
      }
    }
  }

  function cellsMapToSheetData(cells, sheetName) {
    const data = [];
    cells.forEach(function (val, key) {
      const parts = String(key).split('_');
      const r = parseInt(parts[0], 10);
      const c = parseInt(parts[1], 10);
      if (Number.isNaN(r) || Number.isNaN(c)) return;
      if (!data[r]) data[r] = [];
      try {
        data[r][c] = val ? JSON.parse(val) : null;
      } catch (_) {
        data[r][c] = { v: val };
      }
    });
    return [{ name: sheetName || 'Sheet1', color: '', status: 1, order: 0, data: data, config: {}, index: 0 }];
  }

  function connectSocket() {
    const token = auth.getToken();
    if (!token) return;
    socket = window.io(window.location.origin, { path: '/socket.io', auth: { token: token } });
    socket.on('connect', function () {
      socket.emit('join', { sheetId: sheetId }, function (ack) {
        if (ack && ack.error) setStatus(ack.error);
      });
    });
    socket.on('yjs-init', function (payload) {
      if (!payload || payload.sheetId !== sheetId || !ydoc) return;
      try {
        const state = Uint8Array.from(atob(payload.state), function (c) { return c.charCodeAt(0); });
        Y.applyUpdate(ydoc, state, SOCKET_ORIGIN);
      } catch (_) {}
    });
    socket.on('yjs-update', function (payload) {
      if (!payload || !ydoc) return;
      isApplyingRemoteUpdate = true;
      try {
        const state = Uint8Array.from(atob(payload.state), function (c) { return c.charCodeAt(0); });
        Y.applyUpdate(ydoc, state, SOCKET_ORIGIN);
      } catch (_) {}
      isApplyingRemoteUpdate = false;
    });
    socket.on('awareness:join', function (data) {
      if (data && data.userId) onlineUsers[data.userId] = { username: data.username || '' };
      updateOnlineUI();
    });
    socket.on('awareness:leave', function (data) {
      if (data && data.userId) delete onlineUsers[data.userId];
      updateOnlineUI();
    });
    socket.on('awareness:update', function (data) {
      if (data && data.userId) onlineUsers[data.userId] = { username: data.username || '', cell: data.cell };
      updateOnlineUI();
    });
    socket.on('connect_error', function () {
      setStatus('Realtime disconnected');
    });
  }

  function initLuckysheet(sheetName, data, permission) {
    if (luckysheetInitialized) return;
    luckysheetInitialized = true;
    myPermission = permission || 'viewer';
    myPermissionBadge.textContent = myPermission === 'owner' ? 'Owner' : myPermission === 'editor' ? 'Editor' : 'Viewer';
    const sheetData = Array.isArray(data) && data.length ? data : [
      { name: 'Sheet1', color: '', status: 1, order: 0, data: [], config: {}, index: 0 },
    ];
    titleEl.textContent = sheetName || 'Sheet';
    exportBtn.style.display = '';
    if (importInput && importInput.closest('label')) {
      importInput.closest('label').style.display = myPermission === 'viewer' ? 'none' : '';
    }
    const canEdit = myPermission === 'owner' || myPermission === 'editor';

    ydoc = new Y.Doc();
    cellsMap = ydoc.getMap('cells');
    contentToCellsMap(sheetData, cellsMap);
    let displayData = cellsMapToSheetData(cellsMap, sheetName || 'Sheet1');
    if (!Array.isArray(displayData) || !displayData.length) {
      displayData = [{ name: sheetName || 'Sheet1', color: '', status: 1, order: 0, data: [], config: {}, index: 0 }];
    }
    if (!Array.isArray(displayData[0].data)) {
      displayData[0].data = [];
    }

    // Apply remote changes per cell (LWW). Update data only; no full refresh (isRefresh: false).
    cellsMap.observe(function (event) {
      if (skipObserveOnce) { skipObserveOnce = false; return; }
      if (isApplyingRemoteUpdate) return;
      if (!window.luckysheet || typeof window.luckysheet.setCellValue !== 'function') return;
      const keys = event.keysChanged || (event.changes && event.changes.keys && Array.from(event.changes.keys())) || [];
      const keyList = typeof keys.forEach === 'function' ? Array.from(keys) : Array.from(keys);
      if (!keyList.length) return;
      const map = cellsMap;
      requestAnimationFrame(function () {
        isApplyingRemoteUpdate = true;
        try {
          keyList.forEach(function (key) {
            const parts = String(key).split('_');
            const r = parseInt(parts[0], 10);
            const c = parseInt(parts[1], 10);
            if (Number.isNaN(r) || Number.isNaN(c)) return;
            const val = map.get(key);
            let cell;
            if (val === undefined) {
              cell = null;
            } else {
              try {
                cell = val ? JSON.parse(val) : null;
              } catch (_) {
                cell = { v: val };
              }
            }
            window.luckysheet.setCellValue(r, c, cell, { order: 0, isRefresh: false });
          });
          if (typeof window.luckysheet.flowForce === 'function') {
            window.luckysheet.flowForce();
          }
        } catch (_) {}
        isApplyingRemoteUpdate = false;
      });
    });

    // Immediate sync: send every Yjs update as soon as it happens (no debounce, no batching).
    // Each update is a CRDT delta; one cell commit = one update = one message.
    ydoc.on('update', function (update, origin) {
      if (origin === SOCKET_ORIGIN || !socket || !socket.connected) return;
      if (myPermission !== 'owner' && myPermission !== 'editor') return;
      try {
        const b64 = btoa(String.fromCharCode.apply(null, new Uint8Array(update)));
        socket.emit('yjs-update', { state: b64 }, function (ack) {
          if (ack && ack.error) setStatus(ack.error);
        });
      } catch (_) {}
    });

    window.luckysheet.create({
      container: containerId,
      title: sheetName || 'Sheet',
      lang: 'en',
      data: displayData,
      allowUpdate: false,
      updateUrl: '',
      loadUrl: '',
      showinfobar: false,
      showstatisticBar: true,
      sheetFormulaBar: true,
      enableAddRow: canEdit,
      enableAddBackTop: true,
      userInfo: false,
      hook: {
        // Fired on cell commit (Enter, blur, or move to another cell). Sync immediately; no delay/debounce.
        cellUpdated: function (r, c, oldValue, newValue) {
          if (isApplyingRemoteUpdate) return;
          if (!canEdit || !cellsMap) return;
          const key = r + '_' + c;
          const isEmpty = newValue == null || newValue === '' ||
            (typeof newValue === 'object' && (newValue.v === '' || newValue.v == null) && (newValue.m === '' || newValue.m == null));
          skipObserveOnce = true;
          ydoc.transact(function () {
            if (isEmpty) {
              cellsMap.delete(key);
            } else {
              const value = typeof newValue === 'object' && newValue !== null ? newValue : { v: newValue };
              cellsMap.set(key, JSON.stringify(value));
            }
          });
          if (socket && socket.connected) {
            socket.emit('awareness', { cell: [r, c] });
          }
        },
      },
    });

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
        canManageShare = !!row.canManageShare;
        shareBtn.style.display = canManageShare ? '' : 'none';
        let content = row.content;
        if (typeof content === 'string') {
          try {
            content = JSON.parse(content);
          } catch (_) {
            content = null;
          }
        }
        setStatus('');
        initLuckysheet(row.name, content, row.myPermission);
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
          if (window.luckysheet && window.luckysheet.destroy) {
            try { window.luckysheet.destroy(); } catch (_) {}
          }
          if (ydoc) ydoc.destroy();
          luckysheetInitialized = false;
          ydoc = null;
          cellsMap = null;
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
                  if (window.luckysheet && window.luckysheet.destroy) {
                    try { window.luckysheet.destroy(); } catch (_) {}
                  }
                  if (ydoc) ydoc.destroy();
                  luckysheetInitialized = false;
                  ydoc = null;
                  cellsMap = null;
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
