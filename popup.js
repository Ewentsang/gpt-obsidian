const mainEl = document.getElementById('main');
const emptyEl = document.getElementById('empty');
const vaultSelect = document.getElementById('vault');
const dotEl = document.getElementById('dot');
const breadcrumbEl = document.getElementById('breadcrumb');
const foldersEl = document.getElementById('folders');
const newFolderName = document.getElementById('newFolderName');
const newFolderUse = document.getElementById('newFolderUse');
const hereEl = document.getElementById('here');
const captureButton = document.getElementById('capture');
const previewEl = document.getElementById('preview');
const statusEl = document.getElementById('status');
const openOptionsButton = document.getElementById('openOptions');

let connections = [];
let activeId = null;
let path = []; // segments of the current folder
let pendingNewFolder = ''; // a not-yet-created subfolder name to save into

function setStatus(text, kind) {
  statusEl.textContent = text || '';
  statusEl.className = kind || '';
}

function currentFolder() {
  const base = path.join('/');
  if (pendingNewFolder) {
    return base ? `${base}/${pendingNewFolder}` : pendingNewFolder;
  }
  return base;
}

function activeConnection() {
  return connections.find((c) => c.id === activeId) || null;
}

function renderBreadcrumb() {
  breadcrumbEl.innerHTML = '';
  const root = document.createElement('span');
  root.className = 'seg';
  root.textContent = '📂 /';
  root.addEventListener('click', () => { path = []; pendingNewFolder = ''; loadFolder(); });
  breadcrumbEl.appendChild(root);
  path.forEach((segment, index) => {
    breadcrumbEl.appendChild(document.createTextNode(' › '));
    const seg = document.createElement('span');
    seg.className = 'seg';
    seg.textContent = segment;
    seg.addEventListener('click', () => { path = path.slice(0, index + 1); pendingNewFolder = ''; loadFolder(); });
    breadcrumbEl.appendChild(seg);
  });
}

function renderHere() {
  const folder = currentFolder();
  hereEl.textContent = folder ? `Save into: ${folder}` : 'Save into: (vault root)';
}

function renderFolders(folders) {
  foldersEl.innerHTML = '';
  if (!folders.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No sub-folders here.';
    foldersEl.appendChild(li);
    return;
  }
  for (const name of folders) {
    const li = document.createElement('li');
    li.textContent = `📁 ${name}`;
    li.addEventListener('click', () => {
      path = path.concat([name]);
      pendingNewFolder = '';
      newFolderName.value = '';
      loadFolder();
    });
    foldersEl.appendChild(li);
  }
}

function setDot(kind, title) {
  dotEl.className = `dot ${kind || ''}`.trim();
  dotEl.title = title || 'connection status';
}

async function loadFolder() {
  renderBreadcrumb();
  renderHere();
  const conn = activeConnection();
  if (!conn) return;
  let res;
  try {
    res = await chrome.runtime.sendMessage({
      type: 'LIST_SUBFOLDERS',
      connectionId: conn.id,
      folder: path.join('/')
    });
  } catch (e) {
    res = null;
  }
  if (!res || !res.ok) {
    setDot('bad', 'unreachable');
    setStatus(res && res.error ? res.error : 'Could not list folders', 'error');
    captureButton.disabled = true;
    renderFolders([]);
    return;
  }
  setDot('ok', 'connected');
  setStatus('', '');
  captureButton.disabled = false;
  renderFolders(res.result.folders);
}

function selectVault(id) {
  activeId = id;
  const conn = activeConnection();
  path = conn && conn.lastFolder ? conn.lastFolder.split('/').filter(Boolean) : [];
  pendingNewFolder = '';
  newFolderName.value = '';
  loadFolder();
}

async function init() {
  let res;
  try {
    res = await chrome.runtime.sendMessage({ type: 'LIST_CONNECTIONS' });
  } catch (e) {
    res = null;
  }
  connections = res && res.ok ? res.result.connections : [];
  activeId = res && res.ok ? res.result.activeConnectionId : null;

  if (!connections.length) {
    emptyEl.classList.remove('hidden');
    return;
  }
  mainEl.classList.remove('hidden');

  vaultSelect.innerHTML = '';
  for (const c of connections) {
    const option = document.createElement('option');
    option.value = c.id;
    option.textContent = c.label;
    vaultSelect.appendChild(option);
  }
  if (!activeId || !activeConnection()) activeId = connections[0].id;
  vaultSelect.value = activeId;

  vaultSelect.addEventListener('change', async () => {
    try {
      await chrome.runtime.sendMessage({ type: 'SET_ACTIVE_CONNECTION', connectionId: vaultSelect.value });
    } catch (e) {
      // best-effort; still switch the view so the browser matches the dropdown
    }
    selectVault(vaultSelect.value);
  });

  newFolderUse.addEventListener('click', () => {
    pendingNewFolder = newFolderName.value.trim().replace(/^\/+|\/+$/g, '');
    renderHere();
  });
  newFolderName.addEventListener('input', () => {
    pendingNewFolder = newFolderName.value.trim().replace(/^\/+|\/+$/g, '');
    renderHere();
  });

  selectVault(activeId);
}

openOptionsButton.addEventListener('click', () => chrome.runtime.openOptionsPage());
document.getElementById('openOptionsMain').addEventListener('click', () => chrome.runtime.openOptionsPage());

captureButton.addEventListener('click', async () => {
  captureButton.disabled = true;
  setStatus('Reading conversation…', '');
  previewEl.textContent = '';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) throw new Error('Could not find the active tab');

    let extractResponse;
    try {
      extractResponse = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_CONVERSATION' });
    } catch (sendError) {
      // Content script not injected yet (tab predates the extension load); inject and retry once.
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['lib/conversation.js', 'content.js'] });
        extractResponse = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_CONVERSATION' });
      } catch (retryError) {
        throw new Error('Failed to read the conversation — make sure this tab is a ChatGPT conversation');
      }
    }
    if (!extractResponse || !extractResponse.ok) {
      throw new Error((extractResponse && extractResponse.error) || 'Failed to read the conversation — make sure this tab is a ChatGPT conversation');
    }

    previewEl.textContent = `Title: ${extractResponse.result.title}`;
    setStatus('Saving to Obsidian…', '');

    const saveResponse = await chrome.runtime.sendMessage({
      type: 'SAVE_TO_INBOX',
      payload: Object.assign({}, extractResponse.result, {
        connectionId: activeId,
        folder: currentFolder()
      })
    });
    if (!saveResponse || !saveResponse.ok) {
      throw new Error((saveResponse && saveResponse.error) || 'Save failed');
    }

    const { label, folder, filename } = saveResponse.result;
    const savedPath = folder ? `${folder}/${filename}` : filename;
    setStatus(`Saved to ${label} · ${savedPath}`, 'success');

    // Adopt the folder we just saved into (incl. any new subfolder) as the browser location.
    path = folder ? folder.split('/').filter(Boolean) : [];
    pendingNewFolder = '';
    newFolderName.value = '';
    loadFolder();
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    captureButton.disabled = false;
  }
});

init();
