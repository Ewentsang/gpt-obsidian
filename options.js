const Conn = window.ChatGPTObsidianConnections;
const listBody = document.getElementById('list');
const statusEl = document.getElementById('status');
const detectResult = document.getElementById('detectResult');

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

function cell(node) {
  const td = document.createElement('td');
  td.appendChild(node);
  return td;
}

function render() {
  listBody.innerHTML = '';
  const multiple = state.connections.length > 1;

  for (const connection of state.connections) {
    const tr = document.createElement('tr');

    // "Default" only means something with more than one connection.
    const tdRadio = document.createElement('td');
    if (multiple) {
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'active';
      radio.checked = connection.id === state.activeConnectionId;
      radio.addEventListener('change', async () => {
        state = Conn.setActive(state, connection.id);
        await persist();
        flash('Default vault set');
      });
      tdRadio.appendChild(radio);
    } else {
      tdRadio.textContent = '—';
      tdRadio.className = 'muted';
    }

    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.value = connection.label || '';

    const portInput = document.createElement('input');
    portInput.type = 'number';
    portInput.value = connection.port;

    const keyInput = document.createElement('input');
    keyInput.type = 'password';
    keyInput.autocomplete = 'off';
    keyInput.value = connection.apiKey || '';

    const info = document.createElement('div');
    info.className = 'muted';

    // Edits persist automatically (on blur) — no separate Save step to forget.
    // Returns true if the row was valid and saved.
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

    const testBtn = document.createElement('button');
    testBtn.textContent = 'Test';
    testBtn.addEventListener('click', async () => {
      info.textContent = 'Testing…';
      const port = parseInt(portInput.value, 10);
      const apiKey = Conn.normalizeApiKey(keyInput.value);
      if (keyInput.value !== apiKey) keyInput.value = apiKey;
      let res;
      try {
        res = await chrome.runtime.sendMessage({ type: 'VERIFY_CONNECTION', port, apiKey });
      } catch (e) {
        info.textContent = 'Test failed: ' + e.message;
        return;
      }
      if (!res || !res.ok) { info.textContent = (res && res.error) || 'Test failed'; return; }
      if (!res.result.authenticated) { info.textContent = 'Reached the server, but the API key was rejected.'; return; }
      info.textContent = res.result.sampleFolders.length
        ? `OK — top folders: ${res.result.sampleFolders.join(', ')}`
        : 'OK — the vault root has no sub-folders yet.';
      // A verified connection should never be lost — persist it silently.
      await saveRow({ silent: true });
    });

    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', async () => {
      state = Conn.removeConnection(state, connection.id);
      await persist();
      render();
      flash('Removed');
    });

    const tdActions = document.createElement('td');
    tdActions.append(testBtn, document.createTextNode(' '), removeBtn);

    tr.append(tdRadio, cell(labelInput), cell(portInput), cell(keyInput), tdActions);
    listBody.appendChild(tr);

    // Test result gets its own full-width row so it never crowds the actions.
    const infoRow = document.createElement('tr');
    const infoTd = document.createElement('td');
    infoTd.colSpan = 5;
    infoTd.appendChild(info);
    infoRow.appendChild(infoTd);
    listBody.appendChild(infoRow);
  }
}

document.getElementById('add').addEventListener('click', async () => {
  const label = document.getElementById('addLabel').value.trim();
  const port = parseInt(document.getElementById('addPort').value, 10) || Conn.DEFAULT_PORT;
  const apiKey = Conn.normalizeApiKey(document.getElementById('addKey').value);
  if (!label || !apiKey) { flash('Label and API key are required'); return; }
  state = Conn.addConnection(state, { label, port, apiKey, lastFolder: 'inbox' });
  await persist();
  document.getElementById('addLabel').value = '';
  document.getElementById('addPort').value = '';
  document.getElementById('addKey').value = '';
  render();
  flash('Connection added');
});

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
  if (!live.length) {
    detectResult.textContent = 'No running vaults found — open Obsidian and enable the Local REST API HTTP server.';
    return;
  }
  const configured = new Set(state.connections.map((c) => c.port));
  const fresh = live.filter((p) => !configured.has(p));
  detectResult.textContent = `Found vault(s) on port(s): ${live.join(', ')}.` +
    (fresh.length ? ` New: ${fresh.join(', ')} — port prefilled below; paste that vault's key and a label.` : ' All already configured.');
  if (fresh.length) {
    document.getElementById('addPort').value = fresh[0];
    document.getElementById('addLabel').focus();
  }
});

(async () => { state = await loadState(); render(); })();
