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
    response = await fetchWithTimeout(url, options, 8000);
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
    response = await fetchWithTimeout(write.url, write.options, 8000);
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
