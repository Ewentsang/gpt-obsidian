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
