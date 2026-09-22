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
  //
  // The clone must be temporarily attached to the document (off-screen) so
  // it gets a real layout box: `.innerText` on a node with no layout object
  // (which includes any detached node) silently falls back to `.textContent`
  // per spec, which would flatten paragraph/list/code-block formatting and
  // pull in `display:none` subtree text verbatim. `position: fixed` (not
  // `display: none` / `visibility: hidden`, both of which suppress layout)
  // keeps a layout box while staying out of the visible viewport. The clone
  // is always removed in `finally` so it never leaks even if something
  // throws while resolving footnotes.
  function resolveCiteFootnotes(mainContent, state) {
    const clone = mainContent.cloneNode(true);
    clone.style.position = 'fixed';
    clone.style.left = '-99999px';
    clone.style.top = '0';
    clone.style.pointerEvents = 'none';
    document.body.appendChild(clone);
    try {
      const anchors = clone.querySelectorAll('a:has(.ds-markdown-cite)');
      for (const anchor of anchors) {
        const url = anchor.getAttribute('href');
        if (!url) continue;
        anchor.textContent = formatFootnote(state, hostLabel(url), url);
      }
      return clone.innerText.trim();
    } finally {
      clone.remove();
    }
  }

  // `committedCounts` is a Map<string, number> shared across every call to
  // this function (one call per scroll pass) that tracks, per dedup key, how
  // many occurrences have actually been pushed to `out` so far across ALL
  // passes. Content-hash dedup alone can't distinguish "the same physical
  // message scraped again because scroll passes overlap" from "two distinct
  // messages that legitimately have identical text and are simultaneously
  // visible in the DOM right now" - a plain seen-before Set would wrongly
  // drop the second case. Comparing per-pass occurrence index against the
  // running committed count for that key handles both correctly (see the
  // hand-traced scenarios in the task report).
  function scrapeVisibleMessages(state, committedCounts, out) {
    const localCounts = new Map();

    function shouldCommit(key) {
      const occurrenceIndexInThisPass = localCounts.get(key) || 0;
      localCounts.set(key, occurrenceIndexInThisPass + 1);
      const committedSoFar = committedCounts.get(key) || 0;
      if (occurrenceIndexInThisPass < committedSoFar) return false;
      committedCounts.set(key, committedSoFar + 1);
      return true;
    }

    const nodes = document.querySelectorAll('.ds-message, .ds-collapsible-text');
    for (const node of nodes) {
      if (node.classList.contains('ds-collapsible-text')) {
        // A `.ds-collapsible-text` nested inside a `.ds-think-content` block
        // is the assistant's "thinking" content reusing the same collapsible
        // class, not a top-level user bubble - skip it here so it isn't
        // wrongly emitted as a user message. Checking `.ds-think-content`
        // specifically (rather than the generic `.ds-message` turn wrapper)
        // matters because `.ds-message` wraps EVERY turn, user included -
        // matching on it here would skip every user message, not just the
        // nested thinking block this guard is meant to catch. `continue`
        // (not `return`) is correct: this is a `for...of` loop over all
        // visible nodes, so we just move on to the next node rather than
        // aborting the pass.
        if (node.closest('.ds-think-content')) continue;
        const text = node.innerText.trim();
        if (!text) continue;
        const key = `user\u0000${text}`;
        if (!shouldCommit(key)) continue;
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
      if (!shouldCommit(key)) continue;

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
    const committedCounts = new Map();
    const messages = [];
    let lastScrollTop = -1;
    // Consecutive scroll positions advance by less than a full viewport so
    // they overlap: if the virtualized list mounts/unmounts rows
    // aggressively, a thin band of messages right at the seam between two
    // non-overlapping viewports could otherwise never be present in the DOM
    // at a moment this code samples it. The overlap means some messages get
    // scraped again in the next pass, which the committedCounts-based dedup
    // above handles correctly (re-scrapes are skipped, genuine repeats are
    // kept). This only affects the step size, not the `atBottom` check below
    // - that check is about loop termination (has the container already
    // reached its scroll limit), which is independent of how big each step is.
    const SCROLL_STEP_RATIO = 0.75;

    for (let i = 0; i < Math.ceil(200 / SCROLL_STEP_RATIO); i += 1) {
      scrapeVisibleMessages(state, committedCounts, messages);
      const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 4;
      if (atBottom || container.scrollTop === lastScrollTop) break;
      lastScrollTop = container.scrollTop;
      container.scrollTop = Math.min(
        container.scrollTop + container.clientHeight * SCROLL_STEP_RATIO,
        container.scrollHeight
      );
      await sleep(250);
    }

    return { messages, definitions: state.definitions };
  }

  function conversationTitle() {
    const raw = (document.title || '').trim();
    const cleaned = raw.replace(/[-|·]\s*DeepSeek\s*$/i, '').trim();
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

    return { title: conversationTitle(), source, platform: 'DeepSeek', transcript };
  }

  registerExtractor(extractConversation, '__deepseekObsidianExtract');
})();
