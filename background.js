importScripts('lib/filename.js', 'lib/frontmatter.js', 'lib/local-rest-api.js');

async function listInboxFilenames(apiKey) {
  const { url, options } = self.ChatGPTObsidianLocalRestApi.buildListRequest(apiKey);
  let response;
  try {
    response = await fetch(url, options);
  } catch (networkError) {
    throw new Error('无法连接 Obsidian，请确认 Local REST API 插件已开启');
  }
  if (response.status === 401) {
    throw new Error('API key 无效，请到设置页检查');
  }
  if (!response.ok) {
    throw new Error('无法连接 Obsidian，请确认 Local REST API 插件已开启');
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
    throw new Error('无法连接 Obsidian，请确认 Local REST API 插件已开启');
  }
  if (response.status === 401) {
    throw new Error('API key 无效，请到设置页检查');
  }
  if (!response.ok) {
    throw new Error('无法连接 Obsidian，请确认 Local REST API 插件已开启');
  }
}

async function saveConversationToInbox({ title, source, transcript }) {
  const { localRestApiKey: apiKey } = await chrome.storage.local.get('localRestApiKey');
  if (!apiKey) {
    throw new Error('尚未设置 Local REST API key，请先打开插件设置页填写');
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
