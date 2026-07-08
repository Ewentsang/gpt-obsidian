# chatgpt-to-obsidian Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome extension that captures the currently-open ChatGPT conversation and writes a cleaned markdown transcript into the `inbox/` folder of the `my-wiki` Obsidian vault, on a manual button click.

**Architecture:** A content script running on chatgpt.com fetches the conversation's raw JSON from ChatGPT's own `/backend-api/conversation/<id>` endpoint (falling back to DOM scraping if that fails), assembles a plain transcript. A popup triggers the capture and hands the result to a background service worker, which formats it with vault-matching YAML frontmatter and writes it to Obsidian via the **Local REST API** community plugin's local HTTP endpoint. Pure logic (filename sanitization, frontmatter building, conversation parsing, request building) lives in small dependency-free `lib/*.js` files, each loaded as a classic script that attaches its exports to a shared global object — this lets the exact same file run unmodified under Chrome (content script / service worker via `importScripts`) and under Node's built-in test runner (via `require`).

**Tech Stack:** Vanilla JS, Manifest V3 Chrome extension, no build step, no npm dependencies. Tests run with Node's built-in `node:test` (Node 18+) — no test framework to install.

## Global Constraints

- Target vault path (fixed, from spec): `/Users/ewen/Library/Mobile Documents/iCloud~md~obsidian/Documents/my-wiki/inbox/`
- No summarization or LLM calls anywhere in the extension — capture and clean only.
- Manual trigger only (a popup button) — no auto-capture, no scheduling, in v1.
- One file per capture — no same-day append/merge logic.
- Frontmatter must exactly match the vault's `inbox` skill convention:
  ```yaml
  ---
  title: <title>
  source: <source>
  captured: <YYYY-MM-DD>
  tags: [inbox]
  ---
  ```
- Filename: sanitized title (emoji stripped, `:` and `/` → `-`, Chinese kept), `-2`/`-3` suffix on collision — same rule the `inbox` skill uses elsewhere.
- Obsidian Local REST API plugin, insecure HTTP mode, fixed base URL `http://127.0.0.1:27123` (avoids self-signed HTTPS cert friction since traffic never leaves the machine).
- Project root: `/Users/ewen/Desktop/gpt_obsidian` (already a git repo with the design spec committed).

---

### Task 1: Project scaffold

**Files:**
- Create: `manifest.json`
- Create: `package.json`
- Create: `.gitignore`
- Create: `SETUP.md`
- Create: `icons/icon16.png`, `icons/icon48.png`, `icons/icon128.png`

**Interfaces:**
- Produces: a loadable Chrome extension skeleton; `npm test` command later tasks will use to run `node --test`.

- [ ] **Step 1: Write `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "ChatGPT → Obsidian Inbox",
  "version": "0.1.0",
  "description": "手动把当前 ChatGPT 对话存入 Obsidian vault 的 inbox/",
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["https://chatgpt.com/*", "https://chat.openai.com/*"],
      "js": ["lib/conversation.js", "content.js"]
    }
  ],
  "options_ui": {
    "page": "options.html",
    "open_in_tab": true
  },
  "permissions": ["storage"],
  "host_permissions": [
    "https://chatgpt.com/*",
    "https://chat.openai.com/*",
    "http://127.0.0.1:27123/*"
  ],
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "chatgpt-to-obsidian",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "test": "node --test test/"
  }
}
```

- [ ] **Step 3: Write `.gitignore`**

```
node_modules/
.DS_Store
```

- [ ] **Step 4: Write `SETUP.md`**

```markdown
# One-time setup

1. In Obsidian, install and enable the community plugin **Local REST API**.
2. In the plugin settings, enable **"Enable Non-encrypted (HTTP) Server"**
   (binds to `http://127.0.0.1:27123`). This avoids dealing with the
   plugin's self-signed HTTPS certificate since traffic never leaves
   this machine.
3. Copy the generated **API key** from the plugin settings.
4. Click the extension icon → the popup won't have a settings link yet
   in early tasks; once Task 9 (options page) is done, open the
   extension's options page and paste the API key there.
```

- [ ] **Step 5: Generate placeholder icons**

Run:
```bash
cd ~/Desktop/gpt_obsidian
mkdir -p icons
python3 <<'PY'
import struct, zlib

def write_png(path, size, color=(66, 133, 244, 255)):
    width = height = size
    raw = b""
    for _ in range(height):
        raw += b"\x00" + bytes(color) * width

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    idat = zlib.compress(raw, 9)
    png = sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)

write_png("icons/icon16.png", 16)
write_png("icons/icon48.png", 48)
write_png("icons/icon128.png", 128)
PY
```
Expected: three PNG files exist under `icons/`.

- [ ] **Step 6: Verify Node version**

Run: `node --version`
Expected: `v18.x` or higher (Node's built-in `node:test` module requires it).

- [ ] **Step 7: Load the unpacked extension and verify no manifest errors**

In Chrome: `chrome://extensions` → enable Developer mode → "加载已解压的扩展程序" → select `~/Desktop/gpt_obsidian`.
Expected: extension card appears titled "ChatGPT → Obsidian Inbox" with no red error banner, toolbar icon visible.

- [ ] **Step 8: Commit**

```bash
cd ~/Desktop/gpt_obsidian
git add manifest.json package.json .gitignore SETUP.md icons/
git commit -m "chore: scaffold extension project"
```

---

### Task 2: `lib/filename.js` — title sanitizing and collision handling

**Files:**
- Create: `lib/filename.js`
- Create: `test/filename.test.js`

**Interfaces:**
- Produces: `sanitizeTitle(title: string): string`, `dedupeFilename(baseName: string, existingNames: string[]): string`. Later tasks (background.js) call these via `self.ChatGPTObsidianFilename`.

- [ ] **Step 1: Write the failing tests**

`test/filename.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeTitle, dedupeFilename } = require('../lib/filename.js');

test('sanitizeTitle strips emoji and illegal characters', () => {
  assert.equal(sanitizeTitle('🚀 Project: Falcon/Plan'), 'Project- Falcon-Plan');
});

test('sanitizeTitle falls back for empty titles', () => {
  assert.equal(sanitizeTitle('   '), 'untitled-conversation');
  assert.equal(sanitizeTitle(''), 'untitled-conversation');
});

test('sanitizeTitle keeps Chinese characters', () => {
  assert.equal(sanitizeTitle('晚间复盘：职业规划'), '晚间复盘-职业规划');
});

test('dedupeFilename returns base name when free', () => {
  assert.equal(dedupeFilename('daily-log', ['other.md']), 'daily-log.md');
});

test('dedupeFilename appends -2, -3 when taken', () => {
  assert.equal(dedupeFilename('daily-log', ['daily-log.md']), 'daily-log-2.md');
  assert.equal(
    dedupeFilename('daily-log', ['daily-log.md', 'daily-log-2.md']),
    'daily-log-3.md'
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../lib/filename.js'`

- [ ] **Step 3: Write the implementation**

`lib/filename.js`:
```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ChatGPTObsidianFilename = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  function sanitizeTitle(title) {
    if (!title || !title.trim()) {
      return 'untitled-conversation';
    }
    return title
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
      .replace(/:/g, '-')
      .replace(/\//g, '-')
      .replace(/[\\?*"<>|]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function dedupeFilename(baseName, existingNames) {
    const existing = new Set(existingNames);
    const candidate = `${baseName}.md`;
    if (!existing.has(candidate)) {
      return candidate;
    }
    let suffix = 2;
    while (existing.has(`${baseName}-${suffix}.md`)) {
      suffix += 1;
    }
    return `${baseName}-${suffix}.md`;
  }

  return { sanitizeTitle, dedupeFilename };
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add lib/filename.js test/filename.test.js
git commit -m "feat: add filename sanitizing and collision handling"
```

---

### Task 3: `lib/frontmatter.js` — inbox file formatting

**Files:**
- Create: `lib/frontmatter.js`
- Create: `test/frontmatter.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `buildInboxMarkdown({ title, source, captured, transcript }): string`, `todayLocalDate(date?: Date): string`. Later tasks (background.js) call these via `self.ChatGPTObsidianFrontmatter`.

- [ ] **Step 1: Write the failing tests**

`test/frontmatter.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildInboxMarkdown, todayLocalDate } = require('../lib/frontmatter.js');

test('buildInboxMarkdown produces the inbox skill frontmatter shape', () => {
  const result = buildInboxMarkdown({
    title: 'Weekend planning',
    source: 'https://chatgpt.com/c/abc123',
    captured: '2026-07-08',
    transcript: '**You:**\nHi\n\n**ChatGPT:**\nHello!'
  });

  assert.equal(
    result,
    [
      '---',
      'title: Weekend planning',
      'source: https://chatgpt.com/c/abc123',
      'captured: 2026-07-08',
      'tags: [inbox]',
      '---',
      '',
      '**You:**\nHi\n\n**ChatGPT:**\nHello!',
      ''
    ].join('\n')
  );
});

test('buildInboxMarkdown quotes titles containing YAML-sensitive characters', () => {
  const result = buildInboxMarkdown({
    title: 'Q&A: budget #2026',
    source: '',
    captured: '2026-07-08',
    transcript: 'body'
  });

  assert.ok(result.includes('title: "Q&A: budget #2026"'));
});

test('todayLocalDate formats a given date as YYYY-MM-DD using local fields', () => {
  assert.equal(todayLocalDate(new Date(2026, 6, 8)), '2026-07-08');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../lib/frontmatter.js'`

- [ ] **Step 3: Write the implementation**

`lib/frontmatter.js`:
```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ChatGPTObsidianFrontmatter = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  function escapeYamlString(value) {
    if (value.includes(':') || value.includes('#') || value.includes('"')) {
      return `"${value.replace(/"/g, '\\"')}"`;
    }
    return value;
  }

  function buildInboxMarkdown({ title, source, captured, transcript }) {
    const lines = [
      '---',
      `title: ${escapeYamlString(title)}`,
      `source: ${escapeYamlString(source)}`,
      `captured: ${captured}`,
      'tags: [inbox]',
      '---',
      '',
      transcript.trim(),
      ''
    ];
    return lines.join('\n');
  }

  function todayLocalDate(date) {
    const d = date || new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  return { buildInboxMarkdown, escapeYamlString, todayLocalDate };
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, 8 tests total (5 from Task 2 + 3 here)

- [ ] **Step 5: Commit**

```bash
git add lib/frontmatter.js test/frontmatter.test.js
git commit -m "feat: add inbox frontmatter builder"
```

---

### Task 4: `lib/conversation.js` — parse ChatGPT's backend-api conversation JSON

**Files:**
- Create: `lib/conversation.js`
- Create: `test/conversation.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `extractMessages(conversationJson): Array<{role: 'user'|'assistant', text: string}>`, `assembleTranscript(messages): string`. Later tasks (content.js) call these via `self.ChatGPTObsidianConversation`.

- [ ] **Step 1: Write the failing tests**

`test/conversation.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractMessages, assembleTranscript } = require('../lib/conversation.js');

const FIXTURE = {
  current_node: 'msg2-id',
  mapping: {
    'root-id': { id: 'root-id', message: null, parent: null, children: ['msg1-id'] },
    'msg1-id': {
      id: 'msg1-id',
      parent: 'root-id',
      children: ['msg2-id'],
      message: {
        id: 'msg1-id',
        author: { role: 'user' },
        content: { content_type: 'text', parts: ['Hello, how are you?'] },
        recipient: 'all'
      }
    },
    'msg2-id': {
      id: 'msg2-id',
      parent: 'msg1-id',
      children: [],
      message: {
        id: 'msg2-id',
        author: { role: 'assistant' },
        content: {
          content_type: 'text',
          parts: ["I'm doing well, thanks!\n\n```js\nconsole.log('hi')\n```"]
        },
        recipient: 'all'
      }
    }
  }
};

test('extractMessages walks the current_node parent chain in order', () => {
  const messages = extractMessages(FIXTURE);
  assert.deepEqual(messages, [
    { role: 'user', text: 'Hello, how are you?' },
    { role: 'assistant', text: "I'm doing well, thanks!\n\n```js\nconsole.log('hi')\n```" }
  ]);
});

test('extractMessages skips tool/system noise', () => {
  const withTool = {
    current_node: 'msg2-id',
    mapping: {
      ...FIXTURE.mapping,
      'msg1-id': {
        ...FIXTURE.mapping['msg1-id'],
        message: {
          ...FIXTURE.mapping['msg1-id'].message,
          recipient: 'browser'
        }
      }
    }
  };
  const messages = extractMessages(withTool);
  assert.deepEqual(messages, [
    { role: 'assistant', text: "I'm doing well, thanks!\n\n```js\nconsole.log('hi')\n```" }
  ]);
});

test('extractMessages throws on an unrecognized shape', () => {
  assert.throws(() => extractMessages({}), /Unexpected conversation shape/);
});

test('assembleTranscript labels turns and separates with a blank line', () => {
  const transcript = assembleTranscript([
    { role: 'user', text: 'Hi' },
    { role: 'assistant', text: 'Hello!' }
  ]);
  assert.equal(transcript, '**You:**\nHi\n\n**ChatGPT:**\nHello!');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../lib/conversation.js'`

- [ ] **Step 3: Write the implementation**

`lib/conversation.js`:
```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ChatGPTObsidianConversation = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  function extractMessages(conversationJson) {
    const mapping = conversationJson && conversationJson.mapping;
    const currentNode = conversationJson && conversationJson.current_node;
    if (!mapping || !currentNode) {
      throw new Error('Unexpected conversation shape: missing mapping or current_node');
    }

    const chain = [];
    let nodeId = currentNode;
    while (nodeId) {
      const node = mapping[nodeId];
      if (!node) break;
      chain.push(node);
      nodeId = node.parent;
    }
    chain.reverse();

    const messages = [];
    for (const node of chain) {
      const message = node.message;
      if (!message) continue;
      const role = message.author && message.author.role;
      if (role !== 'user' && role !== 'assistant') continue;
      if (message.recipient && message.recipient !== 'all') continue;
      const content = message.content;
      if (!content || content.content_type !== 'text') continue;
      const text = (content.parts || []).join('\n').trim();
      if (!text) continue;
      messages.push({ role, text });
    }
    return messages;
  }

  function assembleTranscript(messages) {
    return messages
      .map((m) => `**${m.role === 'user' ? 'You' : 'ChatGPT'}:**\n${m.text}`)
      .join('\n\n');
  }

  return { extractMessages, assembleTranscript };
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, 12 tests total

- [ ] **Step 5: Commit**

```bash
git add lib/conversation.js test/conversation.test.js
git commit -m "feat: parse ChatGPT backend-api conversation JSON into a transcript"
```

---

### Task 5: `lib/local-rest-api.js` — Obsidian Local REST API request builders

**Files:**
- Create: `lib/local-rest-api.js`
- Create: `test/local-rest-api.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `BASE_URL: string`, `buildListRequest(apiKey): {url, options}`, `buildWriteRequest(apiKey, filename, content): {url, options}`. Later tasks (background.js) call these via `self.ChatGPTObsidianLocalRestApi`.

- [ ] **Step 1: Write the failing tests**

`test/local-rest-api.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildListRequest, buildWriteRequest } = require('../lib/local-rest-api.js');

test('buildListRequest targets the inbox directory with a bearer token', () => {
  const { url, options } = buildListRequest('secret-key');
  assert.equal(url, 'http://127.0.0.1:27123/vault/inbox/');
  assert.equal(options.method, 'GET');
  assert.equal(options.headers.Authorization, 'Bearer secret-key');
});

test('buildWriteRequest PUTs markdown content to the encoded filename', () => {
  const { url, options } = buildWriteRequest('secret-key', 'weekend planning.md', '# hi');
  assert.equal(url, 'http://127.0.0.1:27123/vault/inbox/weekend%20planning.md');
  assert.equal(options.method, 'PUT');
  assert.equal(options.headers.Authorization, 'Bearer secret-key');
  assert.equal(options.headers['Content-Type'], 'text/markdown');
  assert.equal(options.body, '# hi');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../lib/local-rest-api.js'`

- [ ] **Step 3: Write the implementation**

`lib/local-rest-api.js`:
```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ChatGPTObsidianLocalRestApi = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const BASE_URL = 'http://127.0.0.1:27123';

  function buildListRequest(apiKey) {
    return {
      url: `${BASE_URL}/vault/inbox/`,
      options: {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` }
      }
    };
  }

  function buildWriteRequest(apiKey, filename, content) {
    return {
      url: `${BASE_URL}/vault/inbox/${encodeURIComponent(filename)}`,
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

  return { BASE_URL, buildListRequest, buildWriteRequest };
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, 14 tests total

- [ ] **Step 5: Commit**

```bash
git add lib/local-rest-api.js test/local-rest-api.test.js
git commit -m "feat: add Obsidian Local REST API request builders"
```

---

### Task 6: `content.js` — extraction wiring on the ChatGPT page

**Files:**
- Create: `content.js`

**Interfaces:**
- Consumes: `self.ChatGPTObsidianConversation.extractMessages`, `self.ChatGPTObsidianConversation.assembleTranscript` (Task 4).
- Produces: a `chrome.runtime.onMessage` listener responding to `{ type: 'EXTRACT_CONVERSATION' }` with `{ ok: true, result: { title, source, transcript } }` or `{ ok: false, error }`. Also exposes `window.__chatgptObsidianExtract()` for manual console testing. Later tasks (popup.js) send the `EXTRACT_CONVERSATION` message.

No automated test — this file depends on live `window.location`, `fetch`, and `document`, which only exist meaningfully on a real ChatGPT page. It's verified manually in Step 3 below.

- [ ] **Step 1: Write `content.js`**

```js
(function () {
  const { extractMessages, assembleTranscript } = self.ChatGPTObsidianConversation;

  function getConversationId() {
    const match = window.location.pathname.match(/\/c\/([a-zA-Z0-9-]+)/);
    if (!match) {
      throw new Error('未在一个具体的 ChatGPT 对话页面上（URL 里没有 /c/<id>）');
    }
    return match[1];
  }

  async function getAccessToken() {
    const response = await fetch('/api/auth/session', { credentials: 'include' });
    if (!response.ok) {
      throw new Error(`无法读取登录状态 (HTTP ${response.status})`);
    }
    const data = await response.json();
    if (!data.accessToken) {
      throw new Error('未登录 ChatGPT，或会话已过期');
    }
    return data.accessToken;
  }

  async function fetchConversationJson(id, accessToken) {
    const response = await fetch(`/backend-api/conversation/${id}`, {
      credentials: 'include',
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) {
      throw new Error(`无法读取对话内容 (HTTP ${response.status})`);
    }
    return response.json();
  }

  function scrapeDomFallback() {
    const nodes = document.querySelectorAll('[data-message-author-role]');
    if (nodes.length === 0) {
      throw new Error('页面上没有找到任何对话内容');
    }
    const messages = [];
    for (const node of nodes) {
      const role = node.getAttribute('data-message-author-role');
      if (role !== 'user' && role !== 'assistant') continue;
      const text = node.innerText.trim();
      if (!text) continue;
      messages.push({ role, text });
    }
    return messages;
  }

  function conversationTitle(conversationJson) {
    if (conversationJson && conversationJson.title) {
      return conversationJson.title;
    }
    const fallback = document.title.replace(/^ChatGPT( - )?/, '').trim();
    return fallback || 'untitled-conversation';
  }

  async function extractConversation() {
    const id = getConversationId();
    const source = window.location.href;

    try {
      const accessToken = await getAccessToken();
      const conversationJson = await fetchConversationJson(id, accessToken);
      const messages = extractMessages(conversationJson);
      if (messages.length === 0) {
        throw new Error('对话为空');
      }
      return {
        title: conversationTitle(conversationJson),
        source,
        transcript: assembleTranscript(messages)
      };
    } catch (apiError) {
      const messages = scrapeDomFallback();
      return {
        title: conversationTitle(null),
        source,
        transcript: assembleTranscript(messages)
      };
    }
  }

  // Exposed so it can be exercised from the DevTools console before the
  // popup exists (Task 8): `await window.__chatgptObsidianExtract()`.
  window.__chatgptObsidianExtract = extractConversation;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== 'EXTRACT_CONVERSATION') return undefined;
    extractConversation()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true; // keep the message channel open for the async response
  });
})();
```

- [ ] **Step 2: Reload the extension**

In `chrome://extensions`, click the reload icon on the extension card.

- [ ] **Step 3: Manually verify extraction on a real conversation**

1. Open any existing conversation at `https://chatgpt.com/c/<id>`.
2. Open DevTools (Cmd+Opt+I) → Console, make sure it's scoped to the page (not the extension).
3. Run: `await window.__chatgptObsidianExtract()`
4. Expected: a resolved object like `{ title: "...", source: "https://chatgpt.com/c/...", transcript: "**You:**\n...\n\n**ChatGPT:**\n..." }` whose `transcript` matches what's actually in the conversation (spot-check a code block turn if the conversation has one — it should still show fenced ```` ``` ```` syntax).

- [ ] **Step 4: Commit**

```bash
git add content.js
git commit -m "feat: extract ChatGPT conversations via backend-api with DOM fallback"
```

---

### Task 7: `background.js` — write to Obsidian via Local REST API

**Files:**
- Create: `background.js`

**Interfaces:**
- Consumes: `self.ChatGPTObsidianFilename.{sanitizeTitle,dedupeFilename}` (Task 2), `self.ChatGPTObsidianFrontmatter.{buildInboxMarkdown,todayLocalDate}` (Task 3), `self.ChatGPTObsidianLocalRestApi.{buildListRequest,buildWriteRequest}` (Task 5).
- Produces: a `chrome.runtime.onMessage` listener responding to `{ type: 'SAVE_TO_INBOX', payload: {title, source, transcript} }` with `{ ok: true, result: { filename } }` or `{ ok: false, error }`. Later tasks (popup.js) send the `SAVE_TO_INBOX` message.

No automated test — this file performs real network calls to a locally running Obsidian instance. Verified manually in Step 3.

- [ ] **Step 1: Write `background.js`**

```js
importScripts('lib/filename.js', 'lib/frontmatter.js', 'lib/local-rest-api.js');

async function listInboxFilenames(apiKey) {
  const { url, options } = self.ChatGPTObsidianLocalRestApi.buildListRequest(apiKey);
  const response = await fetch(url, options);
  if (response.status === 401) {
    throw new Error('API key 无效，请到设置页检查');
  }
  if (!response.ok) {
    throw new Error(`无法连接 Obsidian，请确认 Local REST API 插件已开启 (HTTP ${response.status})`);
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
  const response = await fetch(url, options);
  if (response.status === 401) {
    throw new Error('API key 无效，请到设置页检查');
  }
  if (!response.ok) {
    throw new Error(`写入失败 (HTTP ${response.status})`);
  }
}

async function saveConversationToInbox({ title, source, transcript }) {
  const { localRestApiKey: apiKey } = await chrome.storage.local.get('localRestApiKey');
  if (!apiKey) {
    throw new Error('尚未设置 Local REST API key，请先打开插件设置页填写');
  }

  const { sanitizeTitle, dedupeFilename } = self.ChatGPTObsidianFilename;
  const { buildInboxMarkdown, todayLocalDate } = self.ChatGPTObsidianFrontmatter;

  const existingFilenames = await listInboxFilenames(apiKey);
  const baseName = sanitizeTitle(title);
  const filename = dedupeFilename(baseName, existingFilenames);
  const captured = todayLocalDate();
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
```

- [ ] **Step 2: Sanity-check the Local REST API plugin with curl before wiring the extension to it**

Complete `SETUP.md` first (enable the plugin's HTTP server, copy the API key), then run:
```bash
curl -H "Authorization: Bearer <paste-your-api-key>" http://127.0.0.1:27123/vault/inbox/
```
Expected: JSON like `{"files":[...]}` (an empty array is fine if inbox/ is empty).

- [ ] **Step 3: Manually verify the background handler end-to-end**

1. Reload the extension in `chrome://extensions`.
2. On the extension card, click "service worker" under "Inspect views" to open its DevTools.
3. In that console, temporarily set a key for testing:
   ```js
   await chrome.storage.local.set({ localRestApiKey: '<paste-your-api-key>' });
   ```
4. Simulate a save:
   ```js
   await chrome.runtime.sendMessage({
     type: 'SAVE_TO_INBOX',
     payload: { title: 'Manual test note', source: 'https://chatgpt.com/c/test', transcript: '**You:**\nhi\n\n**ChatGPT:**\nhello' }
   });
   ```
5. Expected: resolves to `{ ok: true, result: { filename: 'Manual test note.md' } }`, and the file appears in the vault's `inbox/` folder with the correct frontmatter and body.

- [ ] **Step 4: Commit**

```bash
git add background.js
git commit -m "feat: write captured conversations to Obsidian via Local REST API"
```

---

### Task 8: `popup.html` / `popup.js` — the capture button

**Files:**
- Create: `popup.html`
- Create: `popup.js`

**Interfaces:**
- Consumes: `EXTRACT_CONVERSATION` message handled by `content.js` (Task 6), `SAVE_TO_INBOX` message handled by `background.js` (Task 7).
- Produces: the end-user-facing capture flow.

- [ ] **Step 1: Write `popup.html`**

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { font-family: system-ui, sans-serif; width: 320px; padding: 12px; }
      button { width: 100%; padding: 8px; font-size: 14px; cursor: pointer; }
      #status { margin-top: 10px; font-size: 13px; white-space: pre-wrap; }
      #status.error { color: #b00020; }
      #status.success { color: #1b7a1b; }
      #preview { margin-top: 8px; font-size: 12px; color: #555; }
    </style>
  </head>
  <body>
    <button id="capture">存入 Obsidian inbox</button>
    <div id="preview"></div>
    <div id="status"></div>
    <script src="popup.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Write `popup.js`**

```js
const captureButton = document.getElementById('capture');
const statusEl = document.getElementById('status');
const previewEl = document.getElementById('preview');

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = kind || '';
}

captureButton.addEventListener('click', async () => {
  captureButton.disabled = true;
  setStatus('正在读取对话…', '');
  previewEl.textContent = '';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      throw new Error('找不到当前标签页');
    }

    const extractResponse = await chrome.tabs.sendMessage(tab.id, {
      type: 'EXTRACT_CONVERSATION'
    });
    if (!extractResponse || !extractResponse.ok) {
      throw new Error(
        (extractResponse && extractResponse.error) ||
          '读取对话失败，请确认当前页面是 ChatGPT 对话'
      );
    }

    previewEl.textContent = `标题：${extractResponse.result.title}`;
    setStatus('正在存入 Obsidian…', '');

    const saveResponse = await chrome.runtime.sendMessage({
      type: 'SAVE_TO_INBOX',
      payload: extractResponse.result
    });
    if (!saveResponse || !saveResponse.ok) {
      throw new Error((saveResponse && saveResponse.error) || '存入失败');
    }

    setStatus(`已存入 inbox/${saveResponse.result.filename}`, 'success');
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    captureButton.disabled = false;
  }
});
```

- [ ] **Step 3: Manually verify the full click-through**

1. Reload the extension.
2. Open a real ChatGPT conversation.
3. Click the extension's toolbar icon, then click "存入 Obsidian inbox".
4. Expected: preview shows the conversation title, then status turns green with "已存入 inbox/<filename>.md". Confirm the file exists in the vault with correct content.

- [ ] **Step 4: Commit**

```bash
git add popup.html popup.js
git commit -m "feat: add capture popup UI"
```

---

### Task 9: `options.html` / `options.js` — API key settings

**Files:**
- Create: `options.html`
- Create: `options.js`

**Interfaces:**
- Consumes: `chrome.storage.local` key `localRestApiKey` (same key `background.js` reads in Task 7).
- Produces: a settings UI for the one manual credential the extension needs.

- [ ] **Step 1: Write `options.html`**

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { font-family: system-ui, sans-serif; padding: 16px; max-width: 480px; }
      label { display: block; margin-bottom: 6px; font-weight: 600; }
      input { width: 100%; padding: 6px; box-sizing: border-box; }
      button { margin-top: 10px; padding: 6px 14px; cursor: pointer; }
      #status { margin-top: 8px; font-size: 13px; color: #1b7a1b; }
    </style>
  </head>
  <body>
    <label for="apiKey">Obsidian Local REST API key</label>
    <input id="apiKey" type="password" autocomplete="off" />
    <button id="save">保存</button>
    <div id="status"></div>
    <script src="options.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Write `options.js`**

```js
const apiKeyInput = document.getElementById('apiKey');
const saveButton = document.getElementById('save');
const statusEl = document.getElementById('status');

async function loadApiKey() {
  const { localRestApiKey } = await chrome.storage.local.get('localRestApiKey');
  if (localRestApiKey) {
    apiKeyInput.value = localRestApiKey;
  }
}

saveButton.addEventListener('click', async () => {
  await chrome.storage.local.set({ localRestApiKey: apiKeyInput.value.trim() });
  statusEl.textContent = '已保存';
  setTimeout(() => {
    statusEl.textContent = '';
  }, 2000);
});

loadApiKey();
```

- [ ] **Step 3: Manually verify persistence**

1. Reload the extension.
2. Right-click the extension icon → "选项" (or `chrome://extensions` → "扩展程序选项").
3. Paste the real API key, click 保存.
4. Reload the options page.
5. Expected: the field is pre-filled with the saved key.
6. Remove the temporary key you set manually in Task 7 Step 3 (it's now redundant with this real settings flow) and re-run the Task 8 click-through end to end using only the options page to configure the key.

- [ ] **Step 4: Commit**

```bash
git add options.html options.js
git commit -m "feat: add options page for the Local REST API key"
```

---

### Task 10: End-to-end verification and edge cases

**Files:**
- Modify: none (verification only)

**Interfaces:**
- Consumes: the complete extension from Tasks 1–9.

- [ ] **Step 1: Verify the happy path**

Capture a real conversation via the popup. Confirm in the Obsidian vault (`my-wiki/inbox/`) that:
- Frontmatter has `title`, `source`, `captured` (today's local date), `tags: [inbox]`.
- The transcript reads in the correct order and any code blocks are still fenced.

- [ ] **Step 2: Verify the collision case**

Capture the exact same conversation a second time.
Expected: a second file is created with a `-2` suffix (e.g. `My Conversation-2.md`); the first file is untouched.

- [ ] **Step 3: Verify the "Local REST API not running" error path**

In Obsidian, disable the Local REST API plugin. Try to capture a conversation via the popup.
Expected: popup shows "无法连接 Obsidian，请确认 Local REST API 插件已开启" and no partial file is written. Re-enable the plugin afterward.

- [ ] **Step 4: Verify the "invalid API key" error path**

In the options page, temporarily change the saved key to a wrong value, save, then try to capture.
Expected: popup shows "API key 无效，请到设置页检查". Restore the correct key afterward and confirm capture works again.

- [ ] **Step 5: Verify the DOM fallback**

This is hard to trigger for real (it only fires when `/backend-api/conversation/<id>` fails). As a smoke test, open the extension's content-script console on a ChatGPT conversation page and run:
```js
document.querySelectorAll('[data-message-author-role]').length
```
Expected: a number greater than 0, confirming the fallback selector still matches ChatGPT's current DOM structure (if it doesn't, note this as a known-fragile fallback in a follow-up, since it only degrades gracefully when the primary path already works).

- [ ] **Step 6: Run the full automated test suite one last time**

Run: `npm test`
Expected: PASS, 14 tests, 0 failures.

- [ ] **Step 7: Final commit**

```bash
git add -A
git status --short
git commit -m "chore: verify end-to-end capture flow" --allow-empty
```
(Use `--allow-empty` only if Steps 1–6 didn't change any tracked files; otherwise commit whatever was actually touched.)
