importScripts('lib/filename.js', 'lib/frontmatter.js', 'lib/local-rest-api.js');

async function listInboxFilenames(apiKey) {
  const { url, options } = self.ChatGPTObsidianLocalRestApi.buildListRequest(apiKey);
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
  const data = await response.json();
  return data.files || [];
}

async function writeToInbox(apiKey, filename, content) {
  const { url, options } = self.ChatGPTObsidianLocalRestApi.buildWriteRequest(
    apiKey,
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

async function saveConversationToInbox({ title, source, transcript }) {
  const { localRestApiKey: apiKey } = await chrome.storage.local.get('localRestApiKey');
  if (!apiKey) {
    throw new Error('No Local REST API key set — open the extension settings page and add one first');
  }

  const { buildBaseName, dedupeFilename } = self.ChatGPTObsidianFilename;
  const { buildInboxMarkdown, todayLocalDate } = self.ChatGPTObsidianFrontmatter;

  const existingFilenames = await listInboxFilenames(apiKey);
  const captured = todayLocalDate();
  const baseName = buildBaseName(title, captured);
  const filename = dedupeFilename(baseName, existingFilenames);
  const content = buildInboxMarkdown({ title, source, captured, transcript });

  await writeToInbox(apiKey, filename, content);
  return { filename };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'SAVE_TO_INBOX') return undefined;
  saveConversationToInbox(message.payload)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
