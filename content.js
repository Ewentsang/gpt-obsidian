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
      if (messages.length === 0) {
        throw new Error('对话为空');
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
