(function () {
  const { extractMessages, assembleTranscript } = self.ChatGPTObsidianConversation;

  function getConversationId() {
    const match = window.location.pathname.match(/\/c\/([a-zA-Z0-9-]+)/);
    if (!match) {
      throw new Error('Not on a specific ChatGPT conversation page (no /c/<id> in the URL)');
    }
    return match[1];
  }

  async function getAccessToken() {
    const response = await fetch('/api/auth/session', { credentials: 'include' });
    if (!response.ok) {
      throw new Error(`Could not read login status (HTTP ${response.status})`);
    }
    const data = await response.json();
    if (!data.accessToken) {
      throw new Error('Not logged into ChatGPT, or the session has expired');
    }
    return data.accessToken;
  }

  async function fetchConversationJson(id, accessToken) {
    const response = await fetch(`/backend-api/conversation/${id}`, {
      credentials: 'include',
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) {
      throw new Error(`Could not read the conversation (HTTP ${response.status})`);
    }
    return response.json();
  }

  function scrapeDomFallback() {
    const nodes = document.querySelectorAll('[data-message-author-role]');
    if (nodes.length === 0) {
      throw new Error('No conversation content found on the page');
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
        throw new Error('Conversation is empty');
      }
      return {
        title: conversationTitle(conversationJson),
        source,
        transcript: assembleTranscript(messages)
      };
    } catch (apiError) {
      const messages = scrapeDomFallback();
      if (messages.length === 0) {
        throw new Error('Conversation is empty');
      }
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
