# Multi-vault Connections + Folder Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user define and switch between multiple named Obsidian vault connections (auto-detected by port) and pick the destination folder by browsing the vault, instead of a single hardcoded endpoint and typed path.

**Architecture:** Pure, Node-testable logic lives in `lib/*.js` (request building + connection-model helpers). The `background.js` service worker owns all networking and routes each message to the active/selected connection `(port + key)`. `popup.js` and `options.js` are thin UI layers that talk to the background only through `chrome.runtime.sendMessage`. Folder browsing is lazy, one directory level per `GET /vault/<path>/`.

**Tech Stack:** Vanilla JS (Manifest V3 Chrome extension), no build step, no dependencies. Tests use Node's built-in runner (`node --test`).

## Global Constraints

- Zero runtime dependencies, zero build step. Only `lib/*.js` is unit-tested (Node `node --test`); Chrome-API files are verified manually by loading the unpacked extension.
- No `Date.now()` / `Math.random()` for identifiers — connection ids are derived deterministically (`c<max+1>`).
- HTTP only, host is always `127.0.0.1`. No HTTPS, no remote hosts, no native-messaging.
- The API key is mandatory per connection and is never sent from background to the popup (only `id`, `label`, `port`, `lastFolder` are).
- Port scan range is exactly `27123`–`27133` (11 ports).
- Storage shape: `{ connections: [{id,label,port,apiKey,lastFolder}], activeConnectionId }`. Legacy `{localRestApiKey, targetFolder}` migrates to a single connection then those keys are removed.
- Error copy (verbatim): unreachable → `Can't reach "<label>" — is that vault's Obsidian open?`; bad key → `API key for "<label>" is wrong — fix it in Settings`; no connection → `No Obsidian vault configured — open the extension settings to add one`.
- Work continues on branch `feat/configurable-target-folder`.

---

### Task 1: Rework `lib/local-rest-api.js` for per-connection base URLs

**Files:**
- Modify: `lib/local-rest-api.js`
- Test: `test/local-rest-api.test.js`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `baseUrlFor({ port })` → `"http://127.0.0.1:<port>"`
  - `normalizeFolder(folder)` → normalized vault-relative path string (`""` = root)
  - `encodeFolderPath(folder)` → per-segment `encodeURIComponent`, `/` preserved
  - `subfoldersOf(entries)` → `string[]` of sub-folder names (entries ending in `/`, slash stripped, sorted)
  - `buildInfoRequest(baseUrl, apiKey?)` → `{ url, options }` GET `/` (Authorization only if `apiKey` given)
  - `buildListRequest(baseUrl, apiKey, folder)` → `{ url, options }` GET `/vault/<folder>/`
  - `buildWriteRequest(baseUrl, apiKey, folder, filename, content)` → `{ url, options }` PUT

- [ ] **Step 1: Replace the test file with coverage for the new signatures**

Overwrite `test/local-rest-api.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  baseUrlFor,
  normalizeFolder,
  subfoldersOf,
  buildInfoRequest,
  buildListRequest,
  buildWriteRequest
} = require('../lib/local-rest-api.js');

test('baseUrlFor builds a loopback URL from the port', () => {
  assert.equal(baseUrlFor({ port: 27123 }), 'http://127.0.0.1:27123');
  assert.equal(baseUrlFor({ port: 27124 }), 'http://127.0.0.1:27124');
});

test('buildInfoRequest hits the health endpoint without auth by default', () => {
  const { url, options } = buildInfoRequest('http://127.0.0.1:27123');
  assert.equal(url, 'http://127.0.0.1:27123/');
  assert.equal(options.method, 'GET');
  assert.equal(options.headers.Authorization, undefined);
});

test('buildInfoRequest adds a bearer token when a key is given', () => {
  const { options } = buildInfoRequest('http://127.0.0.1:27123', 'k');
  assert.equal(options.headers.Authorization, 'Bearer k');
});

test('buildListRequest targets the given folder with a bearer token', () => {
  const { url, options } = buildListRequest('http://127.0.0.1:27124', 'secret', 'inbox');
  assert.equal(url, 'http://127.0.0.1:27124/vault/inbox/');
  assert.equal(options.method, 'GET');
  assert.equal(options.headers.Authorization, 'Bearer secret');
});

test('buildListRequest targets the vault root when the folder is empty', () => {
  const { url } = buildListRequest('http://127.0.0.1:27123', 'k', '');
  assert.equal(url, 'http://127.0.0.1:27123/vault/');
});

test('buildWriteRequest PUTs markdown to the encoded folder + filename', () => {
  const { url, options } = buildWriteRequest(
    'http://127.0.0.1:27123', 'secret', 'inbox', 'weekend planning.md', '# hi'
  );
  assert.equal(url, 'http://127.0.0.1:27123/vault/inbox/weekend%20planning.md');
  assert.equal(options.method, 'PUT');
  assert.equal(options.headers.Authorization, 'Bearer secret');
  assert.equal(options.headers['Content-Type'], 'text/markdown');
  assert.equal(options.body, '# hi');
});

test('buildWriteRequest encodes each segment of a nested folder path', () => {
  const { url } = buildWriteRequest('http://127.0.0.1:27123', 'k', 'my notes/ChatGPT', 'a.md', 'x');
  assert.equal(url, 'http://127.0.0.1:27123/vault/my%20notes/ChatGPT/a.md');
});

test('buildWriteRequest writes to the vault root when the folder is empty', () => {
  const { url } = buildWriteRequest('http://127.0.0.1:27123', 'k', '', 'a.md', 'x');
  assert.equal(url, 'http://127.0.0.1:27123/vault/a.md');
});

test('normalizeFolder trims, drops stray slashes, normalizes separators', () => {
  assert.equal(normalizeFolder('  inbox  '), 'inbox');
  assert.equal(normalizeFolder('/inbox/'), 'inbox');
  assert.equal(normalizeFolder('notes//ChatGPT/'), 'notes/ChatGPT');
  assert.equal(normalizeFolder('notes\\ChatGPT'), 'notes/ChatGPT');
});

test('normalizeFolder returns empty for empty/missing input', () => {
  assert.equal(normalizeFolder(''), '');
  assert.equal(normalizeFolder('/'), '');
  assert.equal(normalizeFolder(undefined), '');
  assert.equal(normalizeFolder(null), '');
});

test('subfoldersOf keeps only folder entries, strips the slash, sorts', () => {
  const entries = ['Zebra/', 'note.md', 'Alpha/', 'sub folder/', 'image.png'];
  assert.deepEqual(subfoldersOf(entries), ['Alpha', 'Zebra', 'sub folder']);
});

test('subfoldersOf tolerates missing input', () => {
  assert.deepEqual(subfoldersOf(undefined), []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "test/local-rest-api.test.js"`
Expected: FAIL — `baseUrlFor`/`subfoldersOf` are not exported yet and the old two-arg signatures don't match.

- [ ] **Step 3: Replace `lib/local-rest-api.js` with the new implementation**

```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ChatGPTObsidianLocalRestApi = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const DEFAULT_FOLDER = 'inbox';

  function baseUrlFor(connection) {
    return `http://127.0.0.1:${connection.port}`;
  }

  function normalizeFolder(folder) {
    if (folder === undefined || folder === null) {
      return '';
    }
    return String(folder)
      .replace(/\\/g, '/')
      .split('/')
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0)
      .join('/');
  }

  function encodeFolderPath(folder) {
    return folder
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
  }

  function folderVaultUrl(baseUrl, folder) {
    const normalized = normalizeFolder(folder);
    return normalized ? `${baseUrl}/vault/${encodeFolderPath(normalized)}/` : `${baseUrl}/vault/`;
  }

  function subfoldersOf(entries) {
    return (entries || [])
      .filter((entry) => typeof entry === 'string' && entry.endsWith('/'))
      .map((entry) => entry.slice(0, -1))
      .sort((a, b) => a.localeCompare(b));
  }

  function buildInfoRequest(baseUrl, apiKey) {
    const headers = {};
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    return { url: `${baseUrl}/`, options: { method: 'GET', headers } };
  }

  function buildListRequest(baseUrl, apiKey, folder) {
    return {
      url: folderVaultUrl(baseUrl, folder),
      options: { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` } }
    };
  }

  function buildWriteRequest(baseUrl, apiKey, folder, filename, content) {
    return {
      url: `${folderVaultUrl(baseUrl, folder)}${encodeURIComponent(filename)}`,
      options: {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'text/markdown'
        },
        body: content
      }
    };
  }

  return {
    DEFAULT_FOLDER,
    baseUrlFor,
    normalizeFolder,
    encodeFolderPath,
    subfoldersOf,
    buildInfoRequest,
    buildListRequest,
    buildWriteRequest
  };
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "test/local-rest-api.test.js"`
Expected: PASS — all cases in this file green.

- [ ] **Step 5: Commit**

```bash
git add lib/local-rest-api.js test/local-rest-api.test.js
git commit -m "refactor: local-rest-api takes a baseUrl + adds info/subfolder helpers"
```

---

### Task 2: Add the connection-model helpers `lib/connections.js`

**Files:**
- Create: `lib/connections.js`
- Test: `test/connections.test.js`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces (all pure; `state` = `{ connections, activeConnectionId }`):
  - `DEFAULT_PORT` = `27123`, `DEFAULT_FOLDER` = `'inbox'`
  - `emptyState()` → `{ connections: [], activeConnectionId: null }`
  - `nextConnectionId(connections)` → `"c<max+1>"`
  - `migrateLegacy(raw)` → `state` (from new shape, legacy shape, or empty)
  - `getActive(state)` / `getById(state, id)` → connection | null
  - `addConnection(state, {label, port, apiKey, lastFolder?})` → new state (first one becomes active)
  - `updateConnection(state, id, patch)` → new state
  - `removeConnection(state, id)` → new state (active reassigned if removed)
  - `setActive(state, id)` → new state
  - `setLastFolder(state, id, folder)` → new state

- [ ] **Step 1: Write the failing test**

Create `test/connections.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../lib/connections.js');

test('migrateLegacy returns empty state when nothing is stored', () => {
  assert.deepEqual(C.migrateLegacy({}), { connections: [], activeConnectionId: null });
  assert.deepEqual(C.migrateLegacy(undefined), { connections: [], activeConnectionId: null });
});

test('migrateLegacy converts a legacy key + folder into one connection', () => {
  const state = C.migrateLegacy({ localRestApiKey: 'abc', targetFolder: 'notes' });
  assert.equal(state.connections.length, 1);
  assert.deepEqual(state.connections[0], {
    id: 'c1', label: 'My vault', port: 27123, apiKey: 'abc', lastFolder: 'notes'
  });
  assert.equal(state.activeConnectionId, 'c1');
});

test('migrateLegacy defaults the legacy folder to inbox when absent', () => {
  const state = C.migrateLegacy({ localRestApiKey: 'abc' });
  assert.equal(state.connections[0].lastFolder, 'inbox');
});

test('migrateLegacy passes through the new shape unchanged', () => {
  const raw = { connections: [{ id: 'c2', label: 'X', port: 27124, apiKey: 'k', lastFolder: '' }], activeConnectionId: 'c2' };
  assert.deepEqual(C.migrateLegacy(raw), raw);
});

test('migrateLegacy repairs a missing activeConnectionId on the new shape', () => {
  const raw = { connections: [{ id: 'c5', label: 'X', port: 27124, apiKey: 'k', lastFolder: '' }] };
  assert.equal(C.migrateLegacy(raw).activeConnectionId, 'c5');
});

test('nextConnectionId is max suffix + 1', () => {
  assert.equal(C.nextConnectionId([]), 'c1');
  assert.equal(C.nextConnectionId([{ id: 'c1' }, { id: 'c3' }]), 'c4');
});

test('addConnection assigns an id and makes the first one active', () => {
  let state = C.emptyState();
  state = C.addConnection(state, { label: 'Work', port: 27123, apiKey: 'k1' });
  assert.equal(state.connections[0].id, 'c1');
  assert.equal(state.connections[0].lastFolder, '');
  assert.equal(state.activeConnectionId, 'c1');
  state = C.addConnection(state, { label: 'Personal', port: 27124, apiKey: 'k2' });
  assert.equal(state.connections[1].id, 'c2');
  assert.equal(state.activeConnectionId, 'c1'); // unchanged
});

test('updateConnection patches only the matching connection', () => {
  let state = C.addConnection(C.emptyState(), { label: 'Work', port: 27123, apiKey: 'k1' });
  state = C.updateConnection(state, 'c1', { label: 'Job', port: 27130 });
  assert.equal(state.connections[0].label, 'Job');
  assert.equal(state.connections[0].port, 27130);
  assert.equal(state.connections[0].apiKey, 'k1');
});

test('removeConnection reassigns the active id to the first remaining', () => {
  let state = C.addConnection(C.emptyState(), { label: 'A', port: 1, apiKey: 'k' });
  state = C.addConnection(state, { label: 'B', port: 2, apiKey: 'k' });
  state = C.removeConnection(state, 'c1');
  assert.equal(state.connections.length, 1);
  assert.equal(state.activeConnectionId, 'c2');
});

test('removeConnection clears the active id when the list empties', () => {
  let state = C.addConnection(C.emptyState(), { label: 'A', port: 1, apiKey: 'k' });
  state = C.removeConnection(state, 'c1');
  assert.equal(state.activeConnectionId, null);
});

test('setActive and setLastFolder update the right fields', () => {
  let state = C.addConnection(C.emptyState(), { label: 'A', port: 1, apiKey: 'k' });
  state = C.addConnection(state, { label: 'B', port: 2, apiKey: 'k' });
  state = C.setActive(state, 'c2');
  assert.equal(state.activeConnectionId, 'c2');
  state = C.setLastFolder(state, 'c2', 'inbox/sub');
  assert.equal(C.getById(state, 'c2').lastFolder, 'inbox/sub');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "test/connections.test.js"`
Expected: FAIL with `Cannot find module '../lib/connections.js'`.

- [ ] **Step 3: Write the implementation**

Create `lib/connections.js`:

```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ChatGPTObsidianConnections = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const DEFAULT_PORT = 27123;
  const DEFAULT_FOLDER = 'inbox';

  function emptyState() {
    return { connections: [], activeConnectionId: null };
  }

  function nextConnectionId(connections) {
    let max = 0;
    for (const c of connections) {
      const match = /^c(\d+)$/.exec(c.id || '');
      if (match) {
        max = Math.max(max, parseInt(match[1], 10));
      }
    }
    return `c${max + 1}`;
  }

  function migrateLegacy(raw) {
    const source = raw || {};
    if (Array.isArray(source.connections)) {
      return {
        connections: source.connections,
        activeConnectionId:
          source.activeConnectionId ||
          (source.connections[0] && source.connections[0].id) ||
          null
      };
    }
    if (source.localRestApiKey) {
      const connection = {
        id: 'c1',
        label: 'My vault',
        port: DEFAULT_PORT,
        apiKey: source.localRestApiKey,
        lastFolder: source.targetFolder === undefined ? DEFAULT_FOLDER : source.targetFolder
      };
      return { connections: [connection], activeConnectionId: 'c1' };
    }
    return emptyState();
  }

  function getActive(state) {
    if (!state || !state.activeConnectionId) {
      return null;
    }
    return state.connections.find((c) => c.id === state.activeConnectionId) || null;
  }

  function getById(state, id) {
    return ((state && state.connections) || []).find((c) => c.id === id) || null;
  }

  function addConnection(state, fields) {
    const id = nextConnectionId(state.connections);
    const connection = {
      id,
      label: fields.label,
      port: fields.port,
      apiKey: fields.apiKey,
      lastFolder: fields.lastFolder === undefined ? '' : fields.lastFolder
    };
    return {
      connections: state.connections.concat([connection]),
      activeConnectionId: state.activeConnectionId || id
    };
  }

  function updateConnection(state, id, patch) {
    return {
      connections: state.connections.map((c) => (c.id === id ? Object.assign({}, c, patch) : c)),
      activeConnectionId: state.activeConnectionId
    };
  }

  function removeConnection(state, id) {
    const connections = state.connections.filter((c) => c.id !== id);
    let activeConnectionId = state.activeConnectionId;
    if (activeConnectionId === id) {
      activeConnectionId = connections.length ? connections[0].id : null;
    }
    return { connections, activeConnectionId };
  }

  function setActive(state, id) {
    return { connections: state.connections, activeConnectionId: id };
  }

  function setLastFolder(state, id, folder) {
    return updateConnection(state, id, { lastFolder: folder });
  }

  return {
    DEFAULT_PORT,
    DEFAULT_FOLDER,
    emptyState,
    nextConnectionId,
    migrateLegacy,
    getActive,
    getById,
    addConnection,
    updateConnection,
    removeConnection,
    setActive,
    setLastFolder
  };
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test "test/connections.test.js"`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `node --test "test/**/*.test.js"`
Expected: PASS (all files).

- [ ] **Step 6: Commit**

```bash
git add lib/connections.js test/connections.test.js
git commit -m "feat: add pure connection-model helpers (migrate, add, remove, active)"
```

---

### Task 3: Rewrite `background.js` for connection routing + broaden host permission

**Files:**
- Modify: `manifest.json` (host_permissions)
- Modify: `background.js` (full rewrite)

**Interfaces:**
- Consumes: `lib/local-rest-api.js`, `lib/connections.js`, `lib/filename.js`, `lib/frontmatter.js`.
- Produces (message API, each replies `{ ok, result }` or `{ ok:false, error }`):
  - `LIST_CONNECTIONS` → `{ connections: [{id,label,port,lastFolder}], activeConnectionId }`
  - `SET_ACTIVE_CONNECTION { connectionId }` → `{ activeConnectionId }`
  - `DETECT_VAULTS` → `{ ports: number[] }`
  - `VERIFY_CONNECTION { connectionId } | { port, apiKey }` → `{ authenticated, sampleFolders }`
  - `LIST_SUBFOLDERS { connectionId?, folder }` → `{ folder, folders: string[] }`
  - `SAVE_TO_INBOX { payload:{ title, source, transcript, connectionId?, folder } }` → `{ label, folder, filename }`

- [ ] **Step 1: Broaden the loopback host permission**

In `manifest.json`, change the `host_permissions` array entry `"http://127.0.0.1:27123/*"` to `"http://127.0.0.1/*"` (Chrome match patterns ignore the port, so this covers every local port). Leave the two ChatGPT entries unchanged. Resulting array:

```json
  "host_permissions": [
    "https://chatgpt.com/*",
    "https://chat.openai.com/*",
    "http://127.0.0.1/*"
  ],
```

- [ ] **Step 2: Replace `background.js`**

```js
importScripts(
  'lib/filename.js',
  'lib/frontmatter.js',
  'lib/local-rest-api.js',
  'lib/connections.js'
);

const Api = self.ChatGPTObsidianLocalRestApi;
const Conn = self.ChatGPTObsidianConnections;

const STATE_KEYS = ['connections', 'activeConnectionId', 'localRestApiKey', 'targetFolder'];
// Scan the plugin's default HTTP port and the ten above it (27123..27133).
const DETECT_PORTS = Array.from({ length: 11 }, (_, i) => 27123 + i);

async function loadState() {
  const raw = await chrome.storage.local.get(STATE_KEYS);
  const state = Conn.migrateLegacy(raw);
  // One-time migration from the legacy single-key shape.
  if (!Array.isArray(raw.connections) && state.connections.length) {
    await chrome.storage.local.set({
      connections: state.connections,
      activeConnectionId: state.activeConnectionId
    });
    await chrome.storage.local.remove(['localRestApiKey', 'targetFolder']);
  }
  return state;
}

async function saveState(state) {
  await chrome.storage.local.set({
    connections: state.connections,
    activeConnectionId: state.activeConnectionId
  });
}

function resolveConnection(state, connectionId) {
  const conn = connectionId ? Conn.getById(state, connectionId) : Conn.getActive(state);
  if (!conn) {
    throw new Error('No Obsidian vault configured — open the extension settings to add one');
  }
  return conn;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, Object.assign({}, options, { signal: controller.signal }));
  } finally {
    clearTimeout(timer);
  }
}

const unreachable = (label) => new Error(`Can't reach "${label}" — is that vault's Obsidian open?`);
const badKey = (label) => new Error(`API key for "${label}" is wrong — fix it in Settings`);

async function listEntries(conn, folder) {
  const baseUrl = Api.baseUrlFor(conn);
  const { url, options } = Api.buildListRequest(baseUrl, conn.apiKey, folder);
  let response;
  try {
    response = await fetch(url, options);
  } catch (e) {
    throw unreachable(conn.label);
  }
  if (response.status === 401) throw badKey(conn.label);
  if (response.status === 404) return [];
  if (!response.ok) throw unreachable(conn.label);
  const data = await response.json();
  return data.files || [];
}

async function handleListConnections() {
  const state = await loadState();
  return {
    connections: state.connections.map((c) => ({
      id: c.id,
      label: c.label,
      port: c.port,
      lastFolder: c.lastFolder || ''
    })),
    activeConnectionId: state.activeConnectionId
  };
}

async function handleSetActive(connectionId) {
  const state = await loadState();
  await saveState(Conn.setActive(state, connectionId));
  return { activeConnectionId: connectionId };
}

async function handleDetectVaults() {
  const probes = await Promise.all(
    DETECT_PORTS.map(async (port) => {
      const { url, options } = Api.buildInfoRequest(Api.baseUrlFor({ port }));
      try {
        const res = await fetchWithTimeout(url, options, 600);
        if (!res.ok) return null;
        const data = await res.json().catch(() => ({}));
        return data && data.service === 'Obsidian Local REST API' ? port : null;
      } catch (e) {
        return null;
      }
    })
  );
  return { ports: probes.filter((p) => p !== null) };
}

async function handleVerify(input) {
  const state = await loadState();
  const conn = input.connectionId
    ? resolveConnection(state, input.connectionId)
    : { label: `port ${input.port}`, port: input.port, apiKey: input.apiKey };
  const baseUrl = Api.baseUrlFor(conn);
  const info = Api.buildInfoRequest(baseUrl, conn.apiKey);
  let authenticated = false;
  try {
    const res = await fetchWithTimeout(info.url, info.options, 1500);
    const data = await res.json().catch(() => ({}));
    authenticated = !!data.authenticated;
  } catch (e) {
    throw unreachable(conn.label);
  }
  let sampleFolders = [];
  if (authenticated) {
    sampleFolders = Api.subfoldersOf(await listEntries(conn, '')).slice(0, 8);
  }
  return { authenticated, sampleFolders };
}

async function handleListSubfolders(input) {
  const state = await loadState();
  const conn = resolveConnection(state, input.connectionId);
  const entries = await listEntries(conn, input.folder);
  return { folder: Api.normalizeFolder(input.folder), folders: Api.subfoldersOf(entries) };
}

async function handleSave(payload) {
  const state = await loadState();
  const conn = resolveConnection(state, payload.connectionId);
  const targetFolder = Api.normalizeFolder(payload.folder);

  const { buildBaseName, dedupeFilename } = self.ChatGPTObsidianFilename;
  const { buildInboxMarkdown, todayLocalDate } = self.ChatGPTObsidianFrontmatter;

  const existing = await listEntries(conn, targetFolder);
  const captured = todayLocalDate();
  const baseName = buildBaseName(payload.title, captured);
  const filename = dedupeFilename(baseName, existing);
  const content = buildInboxMarkdown({
    title: payload.title,
    source: payload.source,
    captured,
    transcript: payload.transcript
  });

  const baseUrl = Api.baseUrlFor(conn);
  const write = Api.buildWriteRequest(baseUrl, conn.apiKey, targetFolder, filename, content);
  let response;
  try {
    response = await fetch(write.url, write.options);
  } catch (e) {
    throw unreachable(conn.label);
  }
  if (response.status === 401) throw badKey(conn.label);
  if (!response.ok) throw unreachable(conn.label);

  await saveState(Conn.setLastFolder(state, conn.id, targetFolder));
  return { label: conn.label, folder: targetFolder, filename };
}

const HANDLERS = {
  LIST_CONNECTIONS: () => handleListConnections(),
  SET_ACTIVE_CONNECTION: (m) => handleSetActive(m.connectionId),
  DETECT_VAULTS: () => handleDetectVaults(),
  VERIFY_CONNECTION: (m) => handleVerify(m),
  LIST_SUBFOLDERS: (m) => handleListSubfolders(m),
  SAVE_TO_INBOX: (m) => handleSave(m.payload)
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = HANDLERS[message.type];
  if (!handler) return undefined;
  Promise.resolve(handler(message))
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
```

- [ ] **Step 3: Syntax-check the changed scripts**

Run: `node --check background.js && node --check lib/connections.js && node --check lib/local-rest-api.js`
Expected: no output, exit 0 (Chrome globals aren't referenced at parse time).

- [ ] **Step 4: Load and manually verify the background**

1. `chrome://extensions` → reload the extension → click the **service worker** link to open its DevTools console.
2. In that console run:
   ```js
   chrome.runtime.sendMessage({ type: 'DETECT_VAULTS' }, console.log);
   ```
   Expected: `{ ok: true, result: { ports: [...] } }` — includes 27123 when a vault's HTTP server is running (empty array is fine if none open).
3. Run `chrome.runtime.sendMessage({ type: 'LIST_CONNECTIONS' }, console.log);`
   Expected: `{ ok:true, result:{ connections:[...], activeConnectionId } }`. If you had a key saved from the interim version, it now appears as one migrated connection and the old `localRestApiKey`/`targetFolder` keys are gone (`chrome.storage.local.get(console.log)` to confirm).

- [ ] **Step 5: Commit**

```bash
git add manifest.json background.js
git commit -m "feat: route background through named connections + detect/verify/list-subfolders"
```

---

### Task 4: Rebuild the options page (connection management + detect + test)

**Files:**
- Modify: `options.html`
- Modify: `options.js`

**Interfaces:**
- Consumes: `lib/connections.js` (loaded via `<script>`), background messages `DETECT_VAULTS`, `VERIFY_CONNECTION`.
- Produces: persisted `connections` / `activeConnectionId` in `chrome.storage.local` (read by background).

- [ ] **Step 1: Replace `options.html`**

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { font-family: system-ui, sans-serif; padding: 16px; max-width: 640px; }
      h2 { margin: 0 0 4px; }
      .help { font-size: 13px; color: #555; line-height: 1.5; }
      code { background: #f0f0f0; padding: 1px 4px; border-radius: 3px; }
      button { padding: 6px 12px; cursor: pointer; }
      table { width: 100%; border-collapse: collapse; margin-top: 12px; }
      th, td { text-align: left; padding: 6px 6px; border-bottom: 1px solid #eee; font-size: 13px; vertical-align: top; }
      input[type="text"], input[type="password"], input[type="number"] { width: 100%; padding: 5px; box-sizing: border-box; }
      .addrow { display: grid; grid-template-columns: 1fr 100px 1fr auto; gap: 8px; margin-top: 8px; align-items: center; }
      .muted { color: #666; font-size: 12px; }
      #detectResult { margin-top: 8px; }
      #status { margin-top: 10px; font-size: 13px; color: #1b7a1b; min-height: 16px; }
    </style>
  </head>
  <body>
    <h2>Obsidian vault connections</h2>
    <p class="help">
      Each Obsidian vault runs its own Local REST API server on its own port with its own API key.
      Add one connection per vault. Vaults you keep open at the same time must each use a
      <strong>different port</strong> — set it in that vault's Local REST API plugin settings, with
      <em>Enable Non-encrypted (HTTP) Server</em> turned on. Give each connection a label so you can
      tell them apart (the API can't report the vault's name).
    </p>

    <button id="detect">Detect running vaults</button>
    <div id="detectResult" class="muted"></div>

    <table>
      <thead>
        <tr><th>Default</th><th>Label</th><th>Port</th><th>API key</th><th>Actions</th></tr>
      </thead>
      <tbody id="list"></tbody>
    </table>

    <h3>Add a connection</h3>
    <div class="addrow">
      <input id="addLabel" type="text" placeholder="Label, e.g. Work" />
      <input id="addPort" type="number" placeholder="27123" />
      <input id="addKey" type="password" placeholder="API key" autocomplete="off" />
      <button id="add">Add</button>
    </div>

    <div id="status"></div>

    <script src="lib/connections.js"></script>
    <script src="options.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Replace `options.js`**

```js
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
```

- [ ] **Step 3: Manually verify the options page**

1. Reload the extension, open its **Options**.
2. Click **Detect running vaults** with at least one vault's HTTP server on. Expected: the found port(s) listed; a new port prefilled into the Add row.
3. Paste that vault's API key, give it a label (e.g. `Work`), click **Add**. The row appears.
4. Click **Test** on the row. Expected: `OK — top folders: …` (or the empty-root message). Wrong key → the rejected-key message.
5. Add a second connection on another port/label. Toggle the **Default** radio between them; reopen Options and confirm the choice persisted.

- [ ] **Step 4: Commit**

```bash
git add options.html options.js
git commit -m "feat: options page manages multiple vault connections with detect + test"
```

---

### Task 5: Rebuild the popup (vault switcher + folder browser + save)

**Files:**
- Modify: `popup.html`
- Modify: `popup.js`

**Interfaces:**
- Consumes: background messages `LIST_CONNECTIONS`, `SET_ACTIVE_CONNECTION`, `VERIFY_CONNECTION`, `LIST_SUBFOLDERS`, `SAVE_TO_INBOX`; content-script message `EXTRACT_CONVERSATION` (unchanged).
- Produces: nothing consumed by other tasks (top of the stack).

- [ ] **Step 1: Replace `popup.html`**

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      :root { --accent: #7c3aed; --accent-hover: #6d28d9; --accent-active: #5b21b6; }
      * { box-sizing: border-box; }
      html, body { margin: 0; }
      html, body { background: #fafafa; }
      body { font-family: system-ui, -apple-system, sans-serif; width: 300px; padding: 14px; }
      .row { display: flex; align-items: center; gap: 8px; }
      label.lbl { font-size: 12px; font-weight: 600; color: #444; }
      select { flex: 1; padding: 5px; border: 1px solid #d4d4d8; border-radius: 6px; font-family: inherit; font-size: 13px; }
      .dot { width: 9px; height: 9px; border-radius: 50%; background: #bbb; flex: 0 0 auto; }
      .dot.ok { background: #1b7a1b; }
      .dot.bad { background: #b00020; }
      #browser { margin-top: 10px; border: 1px solid #e5e5e5; border-radius: 8px; background: #fff; overflow: hidden; }
      #breadcrumb { padding: 7px 9px; font-size: 12px; color: #555; border-bottom: 1px solid #eee; word-break: break-word; }
      #breadcrumb .seg { color: var(--accent); cursor: pointer; }
      #breadcrumb .seg:hover { text-decoration: underline; }
      #folders { list-style: none; margin: 0; padding: 0; max-height: 190px; overflow-y: auto; }
      #folders li { padding: 8px 10px; font-size: 13px; cursor: pointer; border-bottom: 1px solid #f2f2f2; }
      #folders li:hover { background: #f6f1ff; }
      #folders li.empty { color: #999; cursor: default; }
      #folders li.empty:hover { background: transparent; }
      .newfolder { display: flex; gap: 6px; padding: 8px 10px; border-top: 1px solid #eee; }
      .newfolder input { flex: 1; padding: 5px; border: 1px solid #d4d4d8; border-radius: 6px; font-size: 12px; }
      .newfolder button { border: none; background: #f1e9ff; color: var(--accent); border-radius: 6px; padding: 5px 8px; cursor: pointer; font-size: 12px; }
      #here { margin-top: 8px; font-size: 12px; color: #333; word-break: break-word; }
      button.primary {
        width: 100%; margin-top: 8px; border: none; border-radius: 8px; cursor: pointer;
        padding: 10px 12px; font-size: 14px; font-weight: 600; color: #fff; background: var(--accent);
        font-family: inherit; transition: background-color 0.15s ease, transform 0.05s ease;
      }
      button.primary:hover:not(:disabled) { background: var(--accent-hover); }
      button.primary:active:not(:disabled) { background: var(--accent-active); transform: translateY(1px); }
      button.primary:disabled { background: #c4b5fd; cursor: default; }
      #preview { margin-top: 8px; font-size: 12px; color: #555; word-break: break-word; }
      #status { margin-top: 8px; font-size: 13px; line-height: 1.4; white-space: pre-wrap; }
      #status.error { color: #b00020; }
      #status.success { color: #1b7a1b; }
      #empty { font-size: 13px; color: #444; line-height: 1.5; }
      #openOptions { width: 100%; margin-top: 8px; border: none; border-radius: 8px; padding: 8px; font-size: 13px; font-weight: 500; color: var(--accent); background: #f1e9ff; cursor: pointer; }
      .hidden { display: none; }
    </style>
  </head>
  <body>
    <div id="main" class="hidden">
      <div class="row">
        <label class="lbl" for="vault">Vault</label>
        <select id="vault"></select>
        <span id="dot" class="dot" title="connection status"></span>
      </div>

      <div id="browser">
        <div id="breadcrumb"></div>
        <ul id="folders"></ul>
        <div class="newfolder">
          <input id="newFolderName" type="text" placeholder="New subfolder here…" autocomplete="off" />
          <button id="newFolderUse" type="button">Use</button>
        </div>
      </div>

      <div id="here"></div>
      <button id="capture" class="primary">📥 Save here</button>
      <div id="preview"></div>
      <div id="status"></div>
    </div>

    <div id="empty" class="hidden">
      No Obsidian vault is configured yet. Open settings to detect your vaults and add one.
      <button id="openOptions">Open Settings</button>
    </div>

    <script src="popup.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Replace `popup.js`**

```js
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
  const res = await chrome.runtime.sendMessage({
    type: 'LIST_SUBFOLDERS',
    connectionId: conn.id,
    folder: path.join('/')
  });
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
  const res = await chrome.runtime.sendMessage({ type: 'LIST_CONNECTIONS' });
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
    await chrome.runtime.sendMessage({ type: 'SET_ACTIVE_CONNECTION', connectionId: vaultSelect.value });
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
    path = folder ? folder.split('/') : [];
    pendingNewFolder = '';
    newFolderName.value = '';
    renderBreadcrumb();
    renderHere();
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    captureButton.disabled = false;
  }
});

init();
```

- [ ] **Step 3: Manually verify end-to-end (two vaults)**

Precondition: two Obsidian vaults open, each with the Local REST API HTTP server on a distinct port, both added in Options.
1. Reload the extension. Open a ChatGPT conversation (`.../c/<id>`). Click the toolbar icon.
2. The **Vault** dropdown lists both labels; the status dot is green for a reachable vault.
3. Click into a subfolder, then a deeper one; use the breadcrumb to jump back. "Save into:" tracks the path.
4. Click **📥 Save here**. Expected: `Saved to <label> · <folder>/<YYYY-MM-DD Title>.md`; the file exists in that vault, that folder.
5. Type a name in **New subfolder here…**, click Use (or just type), then Save. Expected: the file lands in the new subfolder (created on write). Verify in Obsidian.
6. Switch the dropdown to the second vault; confirm the browser resets to that vault's last folder and the dot re-checks. Save there; confirm the file lands in the **second** vault, not the first.
7. Switch to a vault whose Obsidian you then close; reopen the popup. Expected: red dot, the "Can't reach …" message, Save disabled.

- [ ] **Step 4: Commit**

```bash
git add popup.html popup.js
git commit -m "feat: popup vault switcher + click-through folder browser with new-subfolder"
```

---

### Task 6: Update the READMEs

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`

**Interfaces:** none (docs).

- [ ] **Step 1: Update `README.md`**

Replace the intro paragraph (the "drops it into the vault folder of your choice…" sentence from the interim change) and the Setup/Usage sections so they describe:
- Multiple vault connections, one per vault, each on its own HTTP port with its own key.
- Setup: open Options → **Detect running vaults** → paste each vault's key + label (mention distinct ports for simultaneously-open vaults, and enabling the HTTP server).
- Usage: pick the vault in the dropdown, browse to a folder (or make a new subfolder), click **Save here**; the confirmation names the vault + path.
- Update the Features list: "Multiple vaults — switch between them in the popup" and "Browse your vault's folders to pick a destination (or create a new subfolder)".

Concretely, set the intro sentence to:

```markdown
Click the extension icon while viewing any ChatGPT conversation, and it pulls the full conversation, cleans it up, and drops it into the vault and folder you pick — browse your vault's real folders in the popup (or make a new subfolder), and switch between multiple vaults from a dropdown. Files are saved as properly formatted markdown with YAML frontmatter (title, source URL, capture date, and an `inbox` tag).
```

Replace the Features bullets `- One-click manual capture …`, the folder bullet, and the date bullet with:

```markdown
- One-click manual capture — you decide what's worth saving
- Multiple vaults — add one connection per vault (auto-detected by port) and switch between them in the popup
- Browse to your destination — click through your vault's real folders, or create a new subfolder on the spot; no path typing
- Filenames prefixed with the capture date (`YYYY-MM-DD Title.md`), sortable in your vault's file explorer
```

Replace setup step 5 and the Usage section:

```markdown
5. Right-click the extension's toolbar icon and choose **"Options"**. Click **Detect running vaults** to find the port(s) your open vaults are serving, then for each vault paste its API key and give it a label (e.g. "Work", "Personal"). If you keep several vaults open at once, give each a different HTTP port in its Local REST API settings first.

## Usage

1. Open a conversation on `chatgpt.com` or `chat.openai.com` (the URL should look like `.../c/<some-id>`).
2. Click the extension's toolbar icon.
3. Pick the **Vault** from the dropdown (the dot shows whether it's reachable).
4. Browse to the destination folder, or type a name under **New subfolder here…** to create one.
5. Click **"Save here"**. The popup shows the conversation title, then a success message naming the vault and exact path the file was saved to.
```

- [ ] **Step 2: Update `README.zh-CN.md`**

Mirror the same changes in Chinese. Set the intro sentence to:

```markdown
在任意 ChatGPT 对话页面点一下扩展图标,它会读取完整对话、清理格式,然后存入你选定的库和文件夹——在弹窗里直接浏览你库里真实的文件夹(也可以现建一个子文件夹),还能从下拉里切换多个库。文件以规范的 markdown 保存,带 YAML frontmatter(标题、来源链接、抓取日期、`inbox` 标签)。
```

Replace the features bullets with:

```markdown
- 手动一键抓取——由你决定哪些对话值得保存
- 多库支持——每个库加一条连接(按端口自动探测),在弹窗里随时切换
- 浏览着选目的地——逐层点开你库里真实的文件夹,或当场新建子文件夹,无需手打路径
- 文件名带抓取日期前缀(`YYYY-MM-DD 标题.md`),在 vault 的文件列表里可以按日期排序
```

Replace setup step 5 and the Usage section:

```markdown
5. 右键点击扩展的工具栏图标,选择 **"Options"**。点 **Detect running vaults** 自动探测正在运行的库的端口,然后为每个库粘上它的 API key 并起个名字(如"工作库""个人库")。如果你经常同时开多个库,先在各自的 Local REST API 设置里把它们改成不同的 HTTP 端口。

## 使用方法

1. 打开 `chatgpt.com` 或 `chat.openai.com` 上的一个对话(网址形如 `.../c/<某个id>`)。
2. 点击扩展的工具栏图标。
3. 从 **Vault** 下拉选择要存入的库(小圆点显示是否连得上)。
4. 浏览到目标文件夹,或在 **New subfolder here…** 里输入名字新建一个。
5. 点击 **"Save here"**。弹窗会先显示对话标题,保存成功后显示提示,并给出库名 + 完整保存路径。
```

- [ ] **Step 3: Commit**

```bash
git add README.md README.zh-CN.md
git commit -m "docs: document multi-vault connections and the folder browser"
```

---

## Self-Review

**Spec coverage:**
- Multi-vault named connections → Tasks 2 (model), 3 (routing), 4 (management UI). ✓
- Port auto-detection (27123–27133) → Task 3 `DETECT_VAULTS`, Task 4 Detect button. ✓
- API key mandatory, never sent to popup → Task 3 `handleListConnections` omits `apiKey`. ✓
- Click-through folder browser + lazy one-level listing → Task 3 `LIST_SUBFOLDERS`, Task 5 popup. ✓
- New-subfolder create path → Task 5 `pendingNewFolder` + write auto-creates dirs. ✓
- Vault identity shown via user label + connectivity dot → Task 5. ✓
- Auto-migration of legacy single connection + legacy key removal → Task 2 `migrateLegacy`, Task 3 `loadState`, Task 4 `loadState`. ✓
- HTTP-only, loopback, no HTTPS/native → Task 1 `baseUrlFor`, Task 3 manifest `http://127.0.0.1/*`. ✓
- Error copy verbatim → Task 3 `unreachable`/`badKey`/`resolveConnection`. ✓
- Node-testable pure logic in `lib` → Tasks 1, 2 with real red/green cycles; Chrome files verified manually. ✓
- READMEs updated → Task 6. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; manual-verification steps list concrete actions and expected results. ✓

**Type consistency:** `baseUrlFor({port})`, `buildInfoRequest(baseUrl, apiKey?)`, `buildListRequest(baseUrl, apiKey, folder)`, `buildWriteRequest(baseUrl, apiKey, folder, filename, content)`, `subfoldersOf(entries)` used identically in Tasks 1/3. Connection helpers (`migrateLegacy`, `addConnection`, `getById`, `setActive`, `setLastFolder`) used with matching shapes in Tasks 2/3/4. Message names (`LIST_CONNECTIONS`, `SET_ACTIVE_CONNECTION`, `DETECT_VAULTS`, `VERIFY_CONNECTION`, `LIST_SUBFOLDERS`, `SAVE_TO_INBOX`) and result fields (`{connections,activeConnectionId}`, `{ports}`, `{authenticated,sampleFolders}`, `{folder,folders}`, `{label,folder,filename}`) match between Task 3 producers and Task 4/5 consumers. ✓
