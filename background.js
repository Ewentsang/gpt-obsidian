importScripts('lib/filename.js', 'lib/frontmatter.js', 'lib/local-rest-api.js');

const { DEFAULT_FOLDER, normalizeFolder } = self.ChatGPTObsidianLocalRestApi;

async function getTargetFolder() {
  const { targetFolder } = await chrome.storage.local.get('targetFolder');
  // `undefined` means the user has never chosen one, so fall back to the
  // original default. An explicit empty string means "save to the vault root".
  return targetFolder === undefined ? DEFAULT_FOLDER : normalizeFolder(targetFolder);
}

// List the entries directly inside a folder. Returns the raw entry names
// (Obsidian marks sub-folders with a trailing slash). A missing folder is
// treated as empty rather than an error.
async function listFolderEntries(apiKey, folder) {
  const { url, options } = self.ChatGPTObsidianLocalRestApi.buildListRequest(apiKey, folder);
  let response;
  try {
    response = await fetch(url, options);
  } catch (networkError) {
    throw new Error('Could not connect to Obsidian — make sure the Local REST API plugin is running');
  }
  if (response.status === 401) {
    throw new Error('Invalid API key — check it on the settings page');
  }
  if (response.status === 404) {
    return [];
  }
  if (!response.ok) {
    throw new Error('Could not connect to Obsidian — make sure the Local REST API plugin is running');
  }
  const data = await response.json();
  return data.files || [];
}

// Walk the vault a couple of levels deep and collect folder paths, so the
// popup can offer real folders as autocomplete suggestions. Best-effort and
// bounded — a huge vault won't stall the popup or hammer the API.
async function collectVaultFolders(apiKey, { maxDepth = 2, maxFolders = 250 } = {}) {
  const found = [];
  const seen = new Set();

  async function walk(prefix, depth) {
    if (depth > maxDepth || found.length >= maxFolders) {
      return;
    }
    let entries;
    try {
      entries = await listFolderEntries(apiKey, prefix);
    } catch (error) {
      return; // suggestions are optional; ignore any listing failure
    }
    for (const entry of entries) {
      if (!entry.endsWith('/')) continue;
      const path = normalizeFolder(`${prefix}/${entry}`);
      if (!path || seen.has(path)) continue;
      seen.add(path);
      found.push(path);
      if (found.length >= maxFolders) return;
      await walk(path, depth + 1);
    }
  }

  await walk('', 1);
  found.sort((a, b) => a.localeCompare(b));
  return found;
}

async function writeConversation(apiKey, folder, filename, content) {
  const { url, options } = self.ChatGPTObsidianLocalRestApi.buildWriteRequest(
    apiKey,
    folder,
    filename,
    content
  );
  let response;
  try {
    response = await fetch(url, options);
  } catch (networkError) {
    throw new Error('Could not connect to Obsidian — make sure the Local REST API plugin is running');
  }
  if (response.status === 401) {
    throw new Error('Invalid API key — check it on the settings page');
  }
  if (!response.ok) {
    throw new Error('Could not connect to Obsidian — make sure the Local REST API plugin is running');
  }
}

async function saveConversation({ title, source, transcript, folder }) {
  const { localRestApiKey: apiKey } = await chrome.storage.local.get('localRestApiKey');
  if (!apiKey) {
    throw new Error('No Local REST API key set — open the extension settings page and add one first');
  }

  // A folder passed from the popup wins (and is remembered as the new
  // default); otherwise use whatever is saved in settings.
  let targetFolder;
  if (folder === undefined) {
    targetFolder = await getTargetFolder();
  } else {
    targetFolder = normalizeFolder(folder);
    await chrome.storage.local.set({ targetFolder });
  }

  const { buildBaseName, dedupeFilename } = self.ChatGPTObsidianFilename;
  const { buildInboxMarkdown, todayLocalDate } = self.ChatGPTObsidianFrontmatter;

  const existingFilenames = await listFolderEntries(apiKey, targetFolder);
  const captured = todayLocalDate();
  const baseName = buildBaseName(title, captured);
  const filename = dedupeFilename(baseName, existingFilenames);
  const content = buildInboxMarkdown({ title, source, captured, transcript });

  await writeConversation(apiKey, targetFolder, filename, content);
  return { filename, folder: targetFolder };
}

async function listFolders() {
  const { localRestApiKey: apiKey } = await chrome.storage.local.get('localRestApiKey');
  if (!apiKey) {
    return { folders: [] };
  }
  const folders = await collectVaultFolders(apiKey);
  return { folders };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SAVE_TO_INBOX') {
    saveConversation(message.payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'LIST_FOLDERS') {
    listFolders()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  return undefined;
});
