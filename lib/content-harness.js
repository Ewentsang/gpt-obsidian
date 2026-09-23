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
