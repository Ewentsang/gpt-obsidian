const Conn = window.ChatGPTObsidianConnections;
const listEl = document.getElementById('list');
const statusEl = document.getElementById('status');
const detectResult = document.getElementById('detectResult');
const addToggle = document.getElementById('addToggle');
const addCard = document.getElementById('addCard');
const addLabel = document.getElementById('addLabel');
const addPort = document.getElementById('addPort');
const addKey = document.getElementById('addKey');

let state = Conn.emptyState();

async function loadState() {
  const raw = await chrome.storage.local.get([
    'connections', 'activeConnectionId', 'localRestApiKey', 'targetFolder'
  ]);
  const migrated = Conn.migrateLegacy(raw);
  if (!Array.isArray(raw.connections) && migrated.connections.length) {
    await chrome.storage.local.set({
      connections: migrated.connections,
      activeConnectionId: migrated.activeConnectionId
    });
    await chrome.storage.local.remove(['localRestApiKey', 'targetFolder']);
  }
  return migrated;
}

async function persist() {
  await chrome.storage.local.set({
    connections: state.connections,
    activeConnectionId: state.activeConnectionId
  });
}

function flash(message) {
  statusEl.textContent = message;
  setTimeout(() => { statusEl.textContent = ''; }, 2000);
}

function makeInput(className, type, value) {
  const el = document.createElement('input');
  el.className = className;
  el.type = type;
  if (value !== undefined && value !== null) el.value = value;
  if (type === 'password') el.autocomplete = 'off';
  return el;
}

function render() {
  listEl.innerHTML = '';
  const multiple = state.connections.length > 1;

  for (const connection of state.connections) {
    const card = document.createElement('div');
    card.className = 'card';

    const top = document.createElement('div');
    top.className = 'card-top';

    // "Default" only means something with more than one connection.
    if (multiple) {
      const dot = document.createElement('input');
      dot.type = 'radio';
      dot.name = 'active';
      dot.className = 'dot-default';
      dot.checked = connection.id === state.activeConnectionId;
      dot.title = 'Default vault';
      dot.addEventListener('change', async () => {
        state = Conn.setActive(state, connection.id);
        await persist();
        flash('Default vault set');
      });
      top.appendChild(dot);
    }

    const labelInput = makeInput('f-label', 'text', connection.label || '');
    labelInput.placeholder = 'Label';
    top.appendChild(labelInput);

    const actions = document.createElement('div');
    actions.className = 'card-actions';
    const testBtn = document.createElement('button');
    testBtn.className = 'tbtn';
    testBtn.textContent = 'Test';
    const removeBtn = document.createElement('button');
    removeBtn.className = 'tbtn danger';
    removeBtn.textContent = 'Remove';
    actions.append(testBtn, removeBtn);
    top.appendChild(actions);

    const meta = document.createElement('div');
    meta.className = 'card-meta';
    const host = document.createElement('span');
    host.className = 'host';
    host.textContent = 'localhost:';
    const portInput = makeInput('f-port', 'number', connection.port);
    const sep = document.createElement('span');
    sep.className = 'host';
    sep.textContent = '·';
    const keyInput = makeInput('f-key', 'password', connection.apiKey || '');
    keyInput.placeholder = 'API key';
    meta.append(host, portInput, sep, keyInput);

    const result = document.createElement('div');
    result.className = 'card-result';

    card.append(top, meta, result);
    listEl.appendChild(card);

    // Edits persist automatically (on blur) — no separate Save step to forget.
    async function saveRow(options) {
      const label = labelInput.value.trim();
      const port = parseInt(portInput.value, 10);
      const apiKey = Conn.normalizeApiKey(keyInput.value);
      // Reflect a stripped "Bearer " prefix back into the field so the user sees it.
      if (keyInput.value !== apiKey) keyInput.value = apiKey;
      if (!label || !port || !apiKey) {
        flash('Label, port and key are all required');
        return false;
      }
      state = Conn.updateConnection(state, connection.id, { label, port, apiKey });
      await persist();
      if (!options || !options.silent) flash('Saved');
      return true;
    }

    labelInput.addEventListener('change', () => saveRow());
    portInput.addEventListener('change', () => saveRow());
    keyInput.addEventListener('change', () => saveRow());

    testBtn.addEventListener('click', async () => {
      result.className = 'card-result';
      result.textContent = 'Testing…';
      const port = parseInt(portInput.value, 10);
      const apiKey = Conn.normalizeApiKey(keyInput.value);
      if (keyInput.value !== apiKey) keyInput.value = apiKey;
      let res;
      try {
        res = await chrome.runtime.sendMessage({ type: 'VERIFY_CONNECTION', port, apiKey });
      } catch (e) {
        result.className = 'card-result err';
        result.textContent = 'Test failed: ' + e.message;
        return;
      }
      if (!res || !res.ok) {
        result.className = 'card-result err';
        result.textContent = (res && res.error) || 'Test failed';
        return;
      }
      if (!res.result.authenticated) {
        result.className = 'card-result err';
        result.textContent = 'Reached the server, but the API key was rejected.';
        return;
      }
      result.className = 'card-result ok';
      result.textContent = res.result.sampleFolders.length
        ? `Connected — top folders: ${res.result.sampleFolders.join(', ')}`
        : 'Connected — the vault root has no sub-folders yet.';
      // A verified connection should never be lost — persist it silently.
      await saveRow({ silent: true });
    });

    removeBtn.addEventListener('click', async () => {
      state = Conn.removeConnection(state, connection.id);
      await persist();
      render();
      flash('Removed');
    });
  }

  refreshSuggestedPort();
}

function clearAddFields() {
  addLabel.value = '';
  addPort.value = '';
  addKey.value = '';
}

addToggle.addEventListener('click', () => {
  addCard.classList.remove('hidden');
  addLabel.focus();
});

document.getElementById('addCancel').addEventListener('click', () => {
  addCard.classList.add('hidden');
  clearAddFields();
});

document.getElementById('add').addEventListener('click', async () => {
  const label = addLabel.value.trim();
  const port = parseInt(addPort.value, 10) || Conn.DEFAULT_PORT;
  const apiKey = Conn.normalizeApiKey(addKey.value);
  if (!label || !apiKey) { flash('Label and API key are required'); return; }
  state = Conn.addConnection(state, { label, port, apiKey, lastFolder: 'inbox' });
  await persist();
  clearAddFields();
  addCard.classList.add('hidden');
  render();
  flash('Connection added');
});

// The lowest scan-range port that nothing is using yet — suggested to the
// user when a vault needs its own port. `extra` = ports seen live this scan.
// For each known HTTP port we also reserve port+1, since the plugin's HTTPS
// server usually sits there (we can't see it over HTTP) and would collide.
function firstFreePort(extra) {
  const used = new Set();
  const mark = (p) => { used.add(p); used.add(p + 1); };
  state.connections.forEach((c) => mark(c.port));
  (extra || []).forEach(mark);
  for (let p = 27123; p <= 27133; p++) {
    if (!used.has(p)) return p;
  }
  return null;
}

// Fill the "another vault not showing up?" recipe with a concrete port the
// user can copy, so they don't have to pick one themselves.
function refreshSuggestedPort(extra) {
  const el = document.getElementById('suggestedPort');
  if (!el) return;
  const free = firstFreePort(extra);
  el.textContent = free !== null ? String(free) : 'a free port (27123–27133)';
}

document.getElementById('detect').addEventListener('click', async () => {
  detectResult.textContent = 'Scanning ports 27123–27133…';
  let res;
  try {
    res = await chrome.runtime.sendMessage({ type: 'DETECT_VAULTS' });
  } catch (e) {
    detectResult.textContent = 'Detection failed: ' + e.message;
    return;
  }
  if (!res || !res.ok) { detectResult.textContent = 'Detection failed'; return; }
  const live = res.result.ports;
  const configured = new Set(state.connections.map((c) => c.port));
  const fresh = live.filter((p) => !configured.has(p));
  refreshSuggestedPort(live);

  if (!live.length) {
    detectResult.textContent = 'No running vaults found — open Obsidian and enable the Local REST API HTTP server.';
    document.getElementById('whyDetails').open = true;
    return;
  }
  detectResult.textContent = `Found vault(s) on port(s): ${live.join(', ')}.` +
    (fresh.length ? ` New: ${fresh.join(', ')} — prefilled below; paste that vault's key and a label.` : ' All already configured.');
  if (fresh.length) {
    addCard.classList.remove('hidden');
    addPort.value = fresh[0];
    addLabel.focus();
  } else {
    // Detect found only vaults you already have. If you expected another,
    // it's probably sharing a port — surface the fix.
    document.getElementById('whyDetails').open = true;
  }
});

// Appearance: System / Light / Dark. "system" follows prefers-color-scheme;
// an explicit choice wins over it (fixes environments that mis-report dark).
const themeSeg = document.getElementById('themeSeg');

function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.dataset.theme = theme;
  } else {
    delete document.documentElement.dataset.theme;
  }
}

function markTheme(theme) {
  for (const btn of themeSeg.querySelectorAll('button')) {
    btn.classList.toggle('active', btn.dataset.themeChoice === theme);
  }
}

themeSeg.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-theme-choice]');
  if (!btn) return;
  const theme = btn.dataset.themeChoice;
  applyTheme(theme);
  markTheme(theme);
  await chrome.storage.local.set({ theme });
});

(async () => {
  const { theme } = await chrome.storage.local.get('theme');
  const current = theme || 'system';
  applyTheme(current);
  markTheme(current);
  state = await loadState();
  render();
})();
