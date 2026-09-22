# 豆包与 DeepSeek 支持 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 豆包 (doubao.com) and DeepSeek (chat.deepseek.com) as supported capture sources, alongside the existing ChatGPT support, using pure DOM scraping (no private API path exists for either site).

**Architecture:** Each site gets its own content script (`content-doubao.js`, `content-deepseek.js`) registered via a shared `lib/content-harness.js` (extracted from the messaging boilerplate that already exists in `content.js`). `lib/conversation.js`'s `assembleTranscript` is generalized to accept a per-site assistant label and exports its footnote-formatting helper (`formatFootnote`) plus `hostLabel` so DeepSeek's inline citation links can be converted to the same footnote style ChatGPT uses. `manifest.json` gets two new `content_scripts` blocks and an `activeTab` permission (needed so `popup.js` can read the active tab's URL and re-inject the right files on tabs that were already open before the extension loaded). `popup.js`'s hardcoded retry-injection file list becomes a small per-hostname lookup table.

**Tech Stack:** Vanilla JS, Chrome Extension Manifest V3, Node's built-in `node:test` runner (no external dependencies, no build step — matches the existing project).

## Global Constraints

- Zero external dependencies, zero build step (existing project convention — do not add npm packages).
- Pure logic that doesn't touch the DOM/`chrome.*` APIs must be unit-testable with plain `node:test` (existing convention for `lib/*.js`).
- DOM-scraping logic that inherently needs a real page (role detection, virtual-list scrolling) is **not** unit tested — this matches the existing precedent of `scrapeDomFallback` in `content.js`, which has never had automated coverage. It gets a manual verification step instead.
- Doubao conversation URL pattern: `https://www.doubao.com/chat/<id>` — path regex `/\/chat\/([a-zA-Z0-9]+)/`.
- DeepSeek conversation URL pattern: `https://chat.deepseek.com/a/chat/s/<uuid>` — path regex `/\/a\/chat\/s\/([a-zA-Z0-9-]+)/`.
- Doubao assistant label in the saved transcript: `豆包`. DeepSeek assistant label: `DeepSeek`. (ChatGPT keeps its existing default `ChatGPT`.)
- DeepSeek's "已深度思考" reasoning content must be captured and kept, formatted as a blockquote before the final answer (per user decision during design).
- Existing UMD module-export pattern must be followed for any new `lib/*.js` file: `root.<GlobalName> = factory()` in browser, `module.exports = factory()` in Node — see `lib/conversation.js:1-7` for the exact shape to copy.

---

### Task 1: Generalize `lib/conversation.js` for multi-site reuse

**Files:**
- Modify: `lib/conversation.js`
- Modify: `test/conversation.test.js`

**Interfaces:**
- Consumes: nothing new (this is the foundational task).
- Produces:
  - `assembleTranscript(messages, assistantLabel)` — `assistantLabel` is optional, defaults to `'ChatGPT'`. Existing call sites that pass only `messages` are unaffected.
  - `formatFootnote(state, label, url)` — pure function, `state` is `{ nextFootnote: number, definitions: string[] }` (mutated in place), returns the footnote marker string (e.g. `'[^1]'`).
  - `hostLabel(url)` — already existed as a private function; now exported.
  - Module exports become: `{ extractMessages, assembleTranscript, resolveCitations, hostLabel, formatFootnote }`.

- [ ] **Step 1: Write the failing tests**

Open `test/conversation.test.js` and change the top `require` line from:

```js
const { extractMessages, assembleTranscript, resolveCitations } = require('../lib/conversation.js');
```

to:

```js
const { extractMessages, assembleTranscript, resolveCitations, hostLabel, formatFootnote } = require('../lib/conversation.js');
```

Then append these tests at the end of the file (before the final closing, i.e. just add them as new top-level `test(...)` calls anywhere after the existing ones):

```js
test('assembleTranscript uses a custom assistant label when provided', () => {
  const transcript = assembleTranscript(
    [
      { role: 'user', text: 'Hi' },
      { role: 'assistant', text: 'Hello!' }
    ],
    'DeepSeek'
  );
  assert.equal(transcript, '**You:**\nHi\n\n**DeepSeek:**\nHello!');
});

test('assembleTranscript still defaults to the ChatGPT label when none is given', () => {
  const transcript = assembleTranscript([
    { role: 'user', text: 'Hi' },
    { role: 'assistant', text: 'Hello!' }
  ]);
  assert.equal(transcript, '**You:**\nHi\n\n**ChatGPT:**\nHello!');
});

test('formatFootnote assigns sequential numbers and records definitions', () => {
  const state = { nextFootnote: 1, definitions: [] };
  const first = formatFootnote(state, 'Example', 'https://example.com');
  const second = formatFootnote(state, 'Other', 'https://other.com');
  assert.equal(first, '[^1]');
  assert.equal(second, '[^2]');
  assert.deepEqual(state.definitions, [
    '[^1]: [Example](https://example.com)',
    '[^2]: [Other](https://other.com)'
  ]);
});

test('hostLabel strips protocol and a leading www.', () => {
  assert.equal(hostLabel('https://www.example.com/path'), 'example.com');
  assert.equal(hostLabel('https://example.org'), 'example.org');
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `npm test`
Expected: FAIL — `hostLabel` and `formatFootnote` are `undefined` (destructured from an export object that doesn't have them yet), and the custom-label test fails because `assembleTranscript` still hardcodes `'ChatGPT'`.

- [ ] **Step 3: Implement the changes in `lib/conversation.js`**

Replace the `citationReplacement` function (currently at `lib/conversation.js:57-80`) with:

```js
  function formatFootnote(state, label, url) {
    const n = state.nextFootnote++;
    state.definitions.push(`[^${n}]: [${label}](${url})`);
    return `[^${n}]`;
  }

  function citationReplacement(ref, state) {
    switch (ref.type) {
      case 'entity':
        // A named entity (person, place, org). Fall back through the fields
        // ChatGPT populates with the plain display text.
        return ref.alt || ref.name || ref.prompt_text || '';
      case 'grouped_webpages': {
        // A web citation chip. Turn it into a Markdown footnote pointing at the
        // primary source, and collect the definition for the end of the note.
        const items = (ref.items && ref.items.length ? ref.items : ref.fallback_items) || [];
        const item = items[0];
        if (!item || !item.url) return '';
        return formatFootnote(state, item.attribution || hostLabel(item.url), item.url);
      }
      default:
        // sources_footnote (an aggregate "Sources" block, redundant with the
        // inline footnotes) and any unknown marker type: prefer its display
        // text if present, otherwise strip it so no raw token leaks through.
        return typeof ref.alt === 'string' ? ref.alt : '';
    }
  }
```

Replace `assembleTranscript` (currently at `lib/conversation.js:130-141`) with:

```js
  function assembleTranscript(messages, assistantLabel) {
    const resolvedAssistantLabel = assistantLabel || 'ChatGPT';
    const state = { nextFootnote: 1, definitions: [] };
    const body = messages
      .map((m) => {
        const label = m.role === 'user' ? 'You' : resolvedAssistantLabel;
        const text = resolveCitations(m.text, m.references || [], state).trim();
        return `**${label}:**\n${text}`;
      })
      .join('\n\n');
    if (state.definitions.length === 0) return body;
    return `${body}\n\n${state.definitions.join('\n')}`;
  }
```

Update the final `return` statement (currently `lib/conversation.js:143`) to:

```js
  return { extractMessages, assembleTranscript, resolveCitations, hostLabel, formatFootnote };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: all tests pass, including the 4 new ones (total test count goes from 24 to 28).

- [ ] **Step 5: Commit**

```bash
git add lib/conversation.js test/conversation.test.js
git commit -m "$(cat <<'EOF'
refactor: generalize assembleTranscript for multi-site reuse

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Shared content-script messaging harness

**Files:**
- Create: `lib/content-harness.js`
- Create: `test/content-harness.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `registerExtractor(extractConversation, debugGlobalName, deps)`.
  - `extractConversation` — `() => Promise<{ title, source, transcript }>`.
  - `debugGlobalName` — string, e.g. `'__doubaoObsidianExtract'`.
  - `deps` — optional, `{ globalObj, runtime }`, used by tests to inject fakes; in the browser both default to the real `window` and `chrome.runtime`.
  - Registers a `chrome.runtime.onMessage` listener that responds to `{ type: 'EXTRACT_CONVERSATION' }` with `{ ok: true, result }` or `{ ok: false, error: error.message }`, and returns `true` from the listener to keep the message channel open for the async response (same contract as `content.js:92-98` today).

- [ ] **Step 1: Write the failing tests**

Create `test/content-harness.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { registerExtractor } = require('../lib/content-harness.js');

function makeFakeRuntime() {
  const listeners = [];
  return {
    runtime: {
      onMessage: {
        addListener(fn) {
          listeners.push(fn);
        }
      }
    },
    listeners
  };
}

test('registerExtractor exposes the extractor under the given debug global name', () => {
  const globalObj = {};
  const { runtime } = makeFakeRuntime();
  const extractConversation = async () => ({ title: 't' });
  registerExtractor(extractConversation, '__testExtract', { globalObj, runtime });
  assert.equal(globalObj.__testExtract, extractConversation);
});

test('registerExtractor ignores messages of other types', () => {
  const { runtime, listeners } = makeFakeRuntime();
  registerExtractor(async () => ({}), '__testExtract', { globalObj: {}, runtime });
  const listener = listeners[0];
  const result = listener({ type: 'SOMETHING_ELSE' }, {}, () => {
    throw new Error('sendResponse should not be called');
  });
  assert.equal(result, undefined);
});

test('registerExtractor resolves EXTRACT_CONVERSATION with ok:true and the result', async () => {
  const { runtime, listeners } = makeFakeRuntime();
  const result = { title: 'hello' };
  registerExtractor(async () => result, '__testExtract', { globalObj: {}, runtime });
  const listener = listeners[0];
  const responses = [];
  const keepChannelOpen = listener(
    { type: 'EXTRACT_CONVERSATION' },
    {},
    (response) => responses.push(response)
  );
  assert.equal(keepChannelOpen, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(responses, [{ ok: true, result }]);
});

test('registerExtractor resolves EXTRACT_CONVERSATION with ok:false and the error message on failure', async () => {
  const { runtime, listeners } = makeFakeRuntime();
  registerExtractor(
    async () => {
      throw new Error('boom');
    },
    '__testExtract',
    { globalObj: {}, runtime }
  );
  const listener = listeners[0];
  const responses = [];
  listener({ type: 'EXTRACT_CONVERSATION' }, {}, (response) => responses.push(response));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(responses, [{ ok: false, error: 'boom' }]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL with `Cannot find module '../lib/content-harness.js'`.

- [ ] **Step 3: Implement `lib/content-harness.js`**

```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ChatGPTObsidianContentHarness = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  function registerExtractor(extractConversation, debugGlobalName, deps) {
    const globalObj = (deps && deps.globalObj) || (typeof window !== 'undefined' ? window : self);
    const runtime = (deps && deps.runtime) || (typeof chrome !== 'undefined' ? chrome.runtime : undefined);

    globalObj[debugGlobalName] = extractConversation;

    runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type !== 'EXTRACT_CONVERSATION') return undefined;
      extractConversation()
        .then((result) => sendResponse({ ok: true, result }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true; // keep the message channel open for the async response
    });
  }

  return { registerExtractor };
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: all tests pass (total test count goes from 28 to 32).

- [ ] **Step 5: Commit**

```bash
git add lib/content-harness.js test/content-harness.test.js
git commit -m "$(cat <<'EOF'
feat: extract shared content-script messaging harness

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `content-doubao.js`

**Files:**
- Create: `content-doubao.js`

**Interfaces:**
- Consumes: `self.ChatGPTObsidianConversation.assembleTranscript(messages, assistantLabel)` (Task 1), `self.ChatGPTObsidianContentHarness.registerExtractor(extractConversation, debugGlobalName)` (Task 2).
- Produces: registers `window.__doubaoObsidianExtract` (debug hook) and the `EXTRACT_CONVERSATION` listener. Not consumed by any other task directly — `manifest.json` (Task 5) references this file by path, and `popup.js` (Task 6) references it by path.

This task has no automated test (DOM-only logic, see Global Constraints). Verification is a manual step at the end of the task.

- [ ] **Step 1: Write `content-doubao.js`**

```js
(function () {
  const { assembleTranscript } = self.ChatGPTObsidianConversation;
  const { registerExtractor } = self.ChatGPTObsidianContentHarness;

  function assertOnConversationPage() {
    const match = window.location.pathname.match(/\/chat\/([a-zA-Z0-9]+)/);
    if (!match) {
      throw new Error('Not on a specific Doubao conversation page (no /chat/<id> in the URL)');
    }
  }

  // Doubao's class names are largely CSS-module hashes that rotate across
  // builds (e.g. `content-KTJ1Rj`). The one stable signal for "this bubble is
  // the user's" is a semantic utility class containing this substring
  // (observed as `bg-g-send-msg-bubble-bg`); assistant replies render as plain
  // text with no such wrapper.
  function isUserBubble(node) {
    let el = node;
    while (el && el !== document.body) {
      if (el.classList) {
        for (const cls of el.classList) {
          if (cls.includes('send-msg-bubble')) return true;
        }
      }
      el = el.parentElement;
    }
    return false;
  }

  function scrapeMessages() {
    // `[data-streaming].md-box-root` is the markdown content root Doubao
    // renders for both user and assistant turns; UI-only siblings (like the
    // "searched N keywords" summary block) live outside this node and are
    // never matched.
    const nodes = document.querySelectorAll('[data-streaming].md-box-root');
    const messages = [];
    for (const node of nodes) {
      const text = node.innerText.trim();
      if (!text) continue;
      const role = isUserBubble(node) ? 'user' : 'assistant';
      messages.push({ role, text });
    }
    return messages;
  }

  function conversationTitle() {
    const raw = (document.title || '').trim();
    const cleaned = raw.replace(/[-|·]\s*豆包\s*$/u, '').trim();
    return cleaned || 'untitled-conversation';
  }

  async function extractConversation() {
    assertOnConversationPage();
    const source = window.location.href;
    const messages = scrapeMessages();
    if (messages.length === 0) {
      throw new Error('Conversation is empty');
    }
    return {
      title: conversationTitle(),
      source,
      transcript: assembleTranscript(messages, '豆包')
    };
  }

  registerExtractor(extractConversation, '__doubaoObsidianExtract');
})();
```

- [ ] **Step 2: Sanity-check the file parses**

Run: `node --check content-doubao.js`
Expected: no output, exit code 0 (this only validates JavaScript syntax — it cannot execute the file, since it relies on browser globals like `window`/`document`/`chrome`/`self` that don't exist in Node).

- [ ] **Step 3: Run the full test suite to make sure nothing else broke**

Run: `npm test`
Expected: all 32 tests still pass (this file adds none).

- [ ] **Step 4: Commit**

```bash
git add content-doubao.js
git commit -m "$(cat <<'EOF'
feat: add Doubao conversation capture via DOM scraping

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Manual verification (requires a human with a logged-in Doubao session — a subagent cannot complete this step)**

1. Load the unpacked extension in Chrome (`chrome://extensions` → Developer mode → Load unpacked).
2. Open a Doubao conversation with at least 2-3 turns at `https://www.doubao.com/chat/<id>`.
3. Click the extension icon → "Save to Obsidian Inbox".
4. Confirm the saved file in the vault's `inbox/` folder has: correct title, correct `source` URL, and turns alternating `**You:**` / `**豆包:**` in the right order with the right text.
5. If any turn is mislabeled (assistant text tagged as user or vice versa), inspect that bubble's HTML in DevTools and report back — the `send-msg-bubble` substring check in `isUserBubble` may need adjusting for that message shape.

---

### Task 4: `content-deepseek.js`

**Files:**
- Create: `content-deepseek.js`

**Interfaces:**
- Consumes: `self.ChatGPTObsidianConversation.assembleTranscript(messages, assistantLabel)`, `self.ChatGPTObsidianConversation.formatFootnote(state, label, url)`, `self.ChatGPTObsidianConversation.hostLabel(url)` (all from Task 1), `self.ChatGPTObsidianContentHarness.registerExtractor(extractConversation, debugGlobalName)` (Task 2).
- Produces: registers `window.__deepseekObsidianExtract` and the `EXTRACT_CONVERSATION` listener. Referenced by path from `manifest.json` (Task 5) and `popup.js` (Task 6).

No automated test (DOM-only logic). Manual verification at the end.

- [ ] **Step 1: Write `content-deepseek.js`**

```js
(function () {
  const { assembleTranscript, formatFootnote, hostLabel } = self.ChatGPTObsidianConversation;
  const { registerExtractor } = self.ChatGPTObsidianContentHarness;

  function assertOnConversationPage() {
    const match = window.location.pathname.match(/\/a\/chat\/s\/([a-zA-Z0-9-]+)/);
    if (!match) {
      throw new Error('Not on a specific DeepSeek conversation page (no /a/chat/s/<id> in the URL)');
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // DeepSeek's chat pane uses a virtualized list (confirmed by the
  // `--dsl-virtual-list-*` CSS custom properties it sets), so messages
  // scrolled out of view may not exist in the DOM. Find the scrollable
  // ancestor of a known message node so we can drive it manually.
  function findScrollContainer(fromNode) {
    let el = fromNode ? fromNode.parentElement : null;
    while (el && el !== document.body) {
      if (el.scrollHeight > el.clientHeight + 4) return el;
      el = el.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  async function loadEarliestHistory(container) {
    let previousScrollHeight = -1;
    for (let i = 0; i < 30; i += 1) {
      container.scrollTop = 0;
      await sleep(250);
      if (container.scrollTop === 0 && container.scrollHeight === previousScrollHeight) {
        break;
      }
      previousScrollHeight = container.scrollHeight;
    }
  }

  // DeepSeek renders inline citation markers as `.ds-markdown-cite` spans
  // wrapped in an `<a href>`. Convert each to the same `[^n]` footnote style
  // used for ChatGPT, on a detached clone so the live page is never touched.
  function resolveCiteFootnotes(mainContent, state) {
    const clone = mainContent.cloneNode(true);
    const anchors = clone.querySelectorAll('a:has(.ds-markdown-cite)');
    for (const anchor of anchors) {
      const url = anchor.getAttribute('href');
      if (!url) continue;
      anchor.textContent = formatFootnote(state, hostLabel(url), url);
    }
    return clone.innerText.trim();
  }

  function scrapeVisibleMessages(state, seen, out) {
    const nodes = document.querySelectorAll('.ds-message, .ds-collapsible-text');
    for (const node of nodes) {
      if (node.classList.contains('ds-collapsible-text')) {
        const text = node.innerText.trim();
        if (!text) continue;
        const key = `user\u0000${text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ role: 'user', text });
        continue;
      }

      const mainContent = node.querySelector('.ds-markdown.ds-assistant-message-main-content');
      if (!mainContent) continue;
      const rawAnswer = mainContent.innerText.trim();
      if (!rawAnswer) continue;
      const thinkNode = node.querySelector('.ds-think-content');
      const rawThink = thinkNode ? thinkNode.innerText.trim() : '';

      // Dedupe on the raw (pre-footnote) text before generating any
      // footnotes, so re-scraping the same message across scroll steps never
      // assigns it a second set of footnote numbers.
      const key = `assistant\u0000${rawThink}\u0000${rawAnswer}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const answer = resolveCiteFootnotes(mainContent, state);
      let text = answer;
      if (rawThink) {
        const quoted = rawThink
          .split('\n')
          .map((line) => `> ${line}`)
          .join('\n');
        text = `> 已深度思考：\n${quoted}\n\n${answer}`;
      }
      out.push({ role: 'assistant', text });
    }
  }

  async function collectAllMessages() {
    const anyMessage = document.querySelector('.ds-message, .ds-collapsible-text');
    const container = findScrollContainer(anyMessage);
    await loadEarliestHistory(container);

    const state = { nextFootnote: 1, definitions: [] };
    const seen = new Set();
    const messages = [];
    let lastScrollTop = -1;

    for (let i = 0; i < 200; i += 1) {
      scrapeVisibleMessages(state, seen, messages);
      const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 4;
      if (atBottom || container.scrollTop === lastScrollTop) break;
      lastScrollTop = container.scrollTop;
      container.scrollTop = Math.min(container.scrollTop + container.clientHeight, container.scrollHeight);
      await sleep(250);
    }

    return { messages, definitions: state.definitions };
  }

  function conversationTitle() {
    const raw = (document.title || '').trim();
    const cleaned = raw.replace(/[-|·]\s*DeepSeek.*$/i, '').trim();
    return cleaned || 'untitled-conversation';
  }

  async function extractConversation() {
    assertOnConversationPage();
    const source = window.location.href;
    const { messages, definitions } = await collectAllMessages();
    if (messages.length === 0) {
      throw new Error('Conversation is empty');
    }
    const body = assembleTranscript(messages, 'DeepSeek');
    const transcript = definitions.length ? `${body}\n\n${definitions.join('\n')}` : body;

    return { title: conversationTitle(), source, transcript };
  }

  registerExtractor(extractConversation, '__deepseekObsidianExtract');
})();
```

- [ ] **Step 2: Sanity-check the file parses**

Run: `node --check content-deepseek.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Run the full test suite to make sure nothing else broke**

Run: `npm test`
Expected: all 32 tests still pass.

- [ ] **Step 4: Commit**

```bash
git add content-deepseek.js
git commit -m "$(cat <<'EOF'
feat: add DeepSeek conversation capture via DOM scraping

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Manual verification (requires a human with a logged-in DeepSeek session — a subagent cannot complete this step)**

1. Load the unpacked extension (reload it in `chrome://extensions` if already loaded).
2. Open a DeepSeek conversation at `https://chat.deepseek.com/a/chat/s/<id>` that includes: a reasoning-model turn (has a "已深度思考" block) and, if possible, a turn with web-search citations.
3. Click the extension icon → "Save to Obsidian Inbox".
4. Confirm the saved file has: turns alternating `**You:**` / `**DeepSeek:**`, the thinking content preserved as a `>`-quoted block ahead of the final answer, and citation markers rendered as `[^n]` with matching `[^n]: [label](url)` definitions at the end of the file.
5. If the conversation is long enough to require scrolling, confirm early turns (that would have scrolled out of view) are present and in the correct order. If any are missing or duplicated, report the container/selector details so `findScrollContainer`/`scrapeVisibleMessages` can be adjusted.
6. If step 5 reveals messages are missing, capture the conversation's scroll container's outer HTML (one level up) from DevTools and report back.

---

### Task 5: Wire up `manifest.json`

**Files:**
- Modify: `manifest.json`

**Interfaces:**
- Consumes: `content-doubao.js` (Task 3), `content-deepseek.js` (Task 4), `lib/content-harness.js` (Task 2), `lib/conversation.js` (Task 1) — all referenced by path.
- Produces: nothing consumed by later tasks directly, but Task 6 (`popup.js`) must use hostnames consistent with the `matches` patterns declared here.

**Correction from the design doc:** the design doc assumed no new `host_permissions` were needed since neither new site needs cross-origin `fetch`. That's true for the content scripts themselves, but `popup.js`'s *retry-injection* fallback (Task 6) calls `chrome.tabs.query` to read the active tab's `url` and `chrome.scripting.executeScript` to inject files into it — both require either matching `host_permissions` or the `activeTab` permission. `activeTab` is the minimal-footprint choice here: it only grants access to the tab the user is actively interacting with when they click the extension icon (which is exactly the popup's flow), rather than declaring persistent host access to two more domains.

- [ ] **Step 1: Edit `manifest.json`**

Change the `"permissions"` array (currently `manifest.json:19`) from:

```json
  "permissions": ["storage", "scripting"],
```

to:

```json
  "permissions": ["storage", "scripting", "activeTab"],
```

Change the `"content_scripts"` array (currently `manifest.json:12-18`) from:

```json
  "content_scripts": [
    {
      "matches": ["https://chatgpt.com/*", "https://chat.openai.com/*"],
      "js": ["lib/conversation.js", "content.js"]
    }
  ],
```

to:

```json
  "content_scripts": [
    {
      "matches": ["https://chatgpt.com/*", "https://chat.openai.com/*"],
      "js": ["lib/conversation.js", "content.js"]
    },
    {
      "matches": ["https://www.doubao.com/*"],
      "js": ["lib/conversation.js", "lib/content-harness.js", "content-doubao.js"]
    },
    {
      "matches": ["https://chat.deepseek.com/*"],
      "js": ["lib/conversation.js", "lib/content-harness.js", "content-deepseek.js"]
    }
  ],
```

- [ ] **Step 2: Verify the JSON is still well-formed**

Run: `node -e "JSON.parse(require('fs').readFileSync('manifest.json', 'utf8')); console.log('valid JSON')"`
Expected output: `valid JSON`

- [ ] **Step 3: Run the full test suite to make sure nothing else broke**

Run: `npm test`
Expected: all 32 tests still pass (manifest.json isn't exercised by the test suite; this is just a regression guard).

- [ ] **Step 4: Commit**

```bash
git add manifest.json
git commit -m "$(cat <<'EOF'
feat: register Doubao and DeepSeek content scripts in the manifest

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `popup.js` dynamic file selection for retry-injection

**Files:**
- Modify: `popup.js`

**Interfaces:**
- Consumes: the exact file lists declared per site in `manifest.json` (Task 5) — must stay in sync.
- Produces: nothing consumed elsewhere; this is the last piece of glue.

No automated test (this file has no existing test coverage — it's Chrome-API glue code, consistent with the existing precedent that `popup.js`/`background.js` are verified manually rather than unit tested). Manual verification at the end.

- [ ] **Step 1: Edit `popup.js`**

At the top of the file (after the existing `const` declarations at `popup.js:1-4`), add:

```js
const SITE_FILES = {
  'chatgpt.com': ['lib/conversation.js', 'content.js'],
  'chat.openai.com': ['lib/conversation.js', 'content.js'],
  'www.doubao.com': ['lib/conversation.js', 'lib/content-harness.js', 'content-doubao.js'],
  'chat.deepseek.com': ['lib/conversation.js', 'lib/content-harness.js', 'content-deepseek.js']
};

function filesForTab(tab) {
  if (!tab.url) return undefined;
  return SITE_FILES[new URL(tab.url).hostname];
}
```

Replace the retry-injection block (currently `popup.js:32-47`):

```js
    let extractResponse;
    try {
      extractResponse = await chrome.tabs.sendMessage(tab.id, {
        type: 'EXTRACT_CONVERSATION'
      });
    } catch (sendError) {
      // No content script listening yet — happens when the tab was already
      // open before the extension was loaded/reloaded. Inject it and retry
      // once instead of asking the user to refresh the page.
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['lib/conversation.js', 'content.js']
        });
        extractResponse = await chrome.tabs.sendMessage(tab.id, {
          type: 'EXTRACT_CONVERSATION'
        });
      } catch (retryError) {
        throw new Error('Failed to read the conversation — make sure this tab is a ChatGPT conversation');
      }
    }
```

with:

```js
    let extractResponse;
    try {
      extractResponse = await chrome.tabs.sendMessage(tab.id, {
        type: 'EXTRACT_CONVERSATION'
      });
    } catch (sendError) {
      // No content script listening yet — happens when the tab was already
      // open before the extension was loaded/reloaded. Inject it and retry
      // once instead of asking the user to refresh the page.
      const files = filesForTab(tab);
      if (!files) {
        throw new Error('This tab is not a supported conversation page (ChatGPT, Doubao, or DeepSeek)');
      }
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files
        });
        extractResponse = await chrome.tabs.sendMessage(tab.id, {
          type: 'EXTRACT_CONVERSATION'
        });
      } catch (retryError) {
        throw new Error('Failed to read the conversation — make sure this tab is a supported conversation page');
      }
    }
```

- [ ] **Step 2: Sanity-check the file parses**

Run: `node --check popup.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Run the full test suite to make sure nothing else broke**

Run: `npm test`
Expected: all 32 tests still pass.

- [ ] **Step 4: Commit**

```bash
git add popup.js
git commit -m "$(cat <<'EOF'
feat: pick retry-injection files by the active tab's site

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Manual verification (requires a human — a subagent cannot complete this step)**

1. Reload the unpacked extension.
2. Open a Doubao (or DeepSeek) conversation tab that was already open *before* reloading the extension (so no content script is listening yet).
3. Click the extension icon → "Save to Obsidian Inbox" immediately, without refreshing the page.
4. Confirm it succeeds without asking you to refresh — this exercises the retry-injection path with the new per-site file list.

---

### Task 7: Update README files

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Update `README.md`**

Change the opening description line (currently `README.md:5`):

```md
A lightweight Chrome extension that captures your ChatGPT conversations straight into your Obsidian vault — no copy-pasting, no manual formatting.
```

to:

```md
A lightweight Chrome extension that captures your ChatGPT, Doubao, or DeepSeek conversations straight into your Obsidian vault — no copy-pasting, no manual formatting.
```

Change the "How it works" paragraph's opening clause (currently `README.md:9`, starts with "the extension reads the conversation directly from ChatGPT's own data") to:

```md
**How it works:** for ChatGPT, the extension reads the conversation directly from ChatGPT's own data (not by scraping the visible page), which makes it accurate and resistant to UI redesigns — with a DOM-based fallback for the rare case that path fails. Doubao and DeepSeek don't expose a usable conversation API from the browser, so those two are captured by reading the page's own DOM directly. Everything happens locally: your conversation data is sent directly from your browser to your own Obsidian vault via the Local REST API community plugin, over a connection that never leaves your machine. No cloud service, no third-party server, no account required beyond your existing chat and Obsidian setup.
```

Change the "Requirements" list item (currently `README.md:~25`, "An active ChatGPT account") to:

```md
- An active account on whichever of ChatGPT, Doubao, or DeepSeek you want to capture from
```

Change the "Usage" step 1 (currently `README.md:~34`) from:

```md
1. Open a conversation on `chatgpt.com` or `chat.openai.com` (the URL should look like `.../c/<some-id>`).
```

to:

```md
1. Open a conversation on `chatgpt.com`/`chat.openai.com` (`.../c/<some-id>`), `www.doubao.com` (`.../chat/<some-id>`), or `chat.deepseek.com` (`.../a/chat/s/<some-id>`).
```

- [ ] **Step 2: Apply the equivalent updates to `README.zh-CN.md`**

Read `README.zh-CN.md` first to find the corresponding lines (it mirrors `README.md`'s structure section-for-section), then apply the same four changes translated to match the existing Chinese phrasing style already used in that file — mention 豆包 and 、DeepSeek alongside ChatGPT in the intro, the "工作原理" paragraph, the前提条件/requirements list, and the使用步骤 1.

- [ ] **Step 3: Run the full test suite to make sure nothing broke**

Run: `npm test`
Expected: all 32 tests still pass (docs changes don't affect tests; this is just a final regression guard before committing).

- [ ] **Step 4: Commit**

```bash
git add README.md README.zh-CN.md
git commit -m "$(cat <<'EOF'
docs: mention Doubao and DeepSeek support in the README

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** every section of `docs/superpowers/specs/2026-09-22-doubao-deepseek-support-design.md` maps to a task — manifest changes → Task 5; shared harness → Task 2; Doubao extraction → Task 3; DeepSeek extraction (including virtual-list scrolling, thinking-block handling, citation footnotes) → Task 4; `assembleTranscript` generalization → Task 1; `popup.js` dynamic file selection → Task 6. README updates weren't in the design doc's scope list but are a natural, low-risk addition to keep docs truthful; flagged here rather than silently added.
- **Correction surfaced:** Task 5 documents and fixes a gap in the design doc (need for `activeTab` permission) rather than silently deviating from it.
- **Type/name consistency:** `assembleTranscript(messages, assistantLabel)`, `formatFootnote(state, label, url)`, and `hostLabel(url)` from Task 1 are used with matching signatures in Task 3 and Task 4. `registerExtractor(extractConversation, debugGlobalName, deps)` from Task 2 is used identically (without the optional third arg) in Tasks 3 and 4. File lists in Task 5's `manifest.json` and Task 6's `SITE_FILES` are identical per hostname.
