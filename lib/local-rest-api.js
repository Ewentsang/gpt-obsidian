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
