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
