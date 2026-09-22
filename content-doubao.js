(function () {
  const { assembleTranscript } = self.ChatGPTObsidianConversation;
  const { registerExtractor } = self.ChatGPTObsidianContentHarness;

  function assertOnConversationPage() {
    const match = window.location.pathname.match(/\/chat\/([a-zA-Z0-9]+)/);
    if (!match) {
      throw new Error('Not on a specific Doubao conversation page (no /chat/<id> in the URL)');
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

  // Doubao's message list virtualizes/lazy-loads like DeepSeek's: messages
  // scrolled out of view can be unmounted from the DOM, so scraping from the
  // default (bottom) scroll position silently drops earlier turns. Find the
  // scrollable ancestor of a known message node so we can drive it manually
  // — same approach as content-deepseek.js's findScrollContainer.
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

  // `[data-streaming].md-box-root` is the markdown content root Doubao
  // renders for both user and assistant turns; UI-only siblings (like the
  // "searched N keywords" summary block) live outside this node and are
  // never matched.
  //
  // `committedCounts` is a Map<string, number> shared across every scroll
  // pass that tracks, per dedup key, how many occurrences have actually been
  // pushed to `out` so far across ALL passes. Consecutive scroll steps
  // overlap (see SCROLL_STEP_RATIO below), so the same message is often
  // re-scraped; comparing this pass's occurrence index against the running
  // committed count distinguishes "scraped again because passes overlap"
  // from "two distinct messages that legitimately have identical text."
  function scrapeVisibleMessages(committedCounts, out) {
    const localCounts = new Map();
    const nodes = document.querySelectorAll('[data-streaming].md-box-root');
    for (const node of nodes) {
      const text = node.innerText.trim();
      if (!text) continue;
      const role = isUserBubble(node) ? 'user' : 'assistant';
      const key = `${role}\u0000${text}`;
      const occurrenceIndexInThisPass = localCounts.get(key) || 0;
      localCounts.set(key, occurrenceIndexInThisPass + 1);
      const committedSoFar = committedCounts.get(key) || 0;
      if (occurrenceIndexInThisPass < committedSoFar) continue;
      committedCounts.set(key, committedSoFar + 1);
      out.push({ role, text });
    }
  }

  async function collectAllMessages() {
    const anyMessage = document.querySelector('[data-streaming].md-box-root');
    const container = findScrollContainer(anyMessage);
    await loadEarliestHistory(container);

    const committedCounts = new Map();
    const messages = [];
    let lastScrollTop = -1;
    // Consecutive scroll positions advance by less than a full viewport so
    // they overlap: if the virtualized list mounts/unmounts rows
    // aggressively, a thin band of messages right at the seam between two
    // non-overlapping viewports could otherwise never be present in the DOM
    // at a moment this code samples it. See content-deepseek.js's
    // collectAllMessages for the full rationale.
    const SCROLL_STEP_RATIO = 0.75;

    for (let i = 0; i < Math.ceil(200 / SCROLL_STEP_RATIO); i += 1) {
      scrapeVisibleMessages(committedCounts, messages);
      const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 4;
      if (atBottom || container.scrollTop === lastScrollTop) break;
      lastScrollTop = container.scrollTop;
      container.scrollTop = Math.min(
        container.scrollTop + container.clientHeight * SCROLL_STEP_RATIO,
        container.scrollHeight
      );
      await sleep(250);
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
    const messages = await collectAllMessages();
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
