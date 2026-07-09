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

function render() {
  listBody.innerHTML = '';
  for (const connection of state.connections) {
    const tr = document.createElement('tr');

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'active';
    radio.checked = connection.id === state.activeConnectionId;
    radio.addEventListener('change', async () => {
      state = Conn.setActive(state, connection.id);
      await persist();
      flash('Default vault set');
    });
    const tdRadio = document.createElement('td');
    tdRadio.appendChild(radio);

    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.value = connection.label || '';
    const tdLabel = document.createElement('td');
    tdLabel.appendChild(labelInput);

    const portInput = document.createElement('input');
    portInput.type = 'number';
    portInput.value = connection.port;
    const tdPort = document.createElement('td');
    tdPort.appendChild(portInput);

    const keyInput = document.createElement('input');
    keyInput.type = 'password';
    keyInput.value = connection.apiKey || '';
    keyInput.autocomplete = 'off';
    const tdKey = document.createElement('td');
    tdKey.appendChild(keyInput);

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', async () => {
      const label = labelInput.value.trim();
      const port = parseInt(portInput.value, 10);
      const apiKey = keyInput.value.trim();
      if (!label || !port || !apiKey) { flash('Label, port and key are all required'); return; }
      state = Conn.updateConnection(state, connection.id, { label, port, apiKey });
      await persist();
      flash('Saved');
    });

    const testBtn = document.createElement('button');
    testBtn.textContent = 'Test';
    const info = document.createElement('div');
    info.className = 'muted';
    testBtn.addEventListener('click', async () => {
      info.textContent = 'Testing…';
      const port = parseInt(portInput.value, 10);
      const apiKey = keyInput.value.trim();
      const res = await chrome.runtime.sendMessage({ type: 'VERIFY_CONNECTION', port, apiKey });
      if (!res || !res.ok) { info.textContent = (res && res.error) || 'Test failed'; return; }
      if (!res.result.authenticated) { info.textContent = 'Reached the server, but the API key was rejected.'; return; }
      info.textContent = res.result.sampleFolders.length
        ? `OK — top folders: ${res.result.sampleFolders.join(', ')}`
        : 'OK — the vault root has no sub-folders yet.';
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
    tdActions.append(saveBtn, document.createTextNode(' '), testBtn, document.createTextNode(' '), removeBtn, info);

    tr.append(tdRadio, tdLabel, tdPort, tdKey, tdActions);
    listBody.appendChild(tr);
  }
}

document.getElementById('add').addEventListener('click', async () => {
  const label = document.getElementById('addLabel').value.trim();
  const port = parseInt(document.getElementById('addPort').value, 10) || Conn.DEFAULT_PORT;
  const apiKey = document.getElementById('addKey').value.trim();
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
  const res = await chrome.runtime.sendMessage({ type: 'DETECT_VAULTS' });
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
