(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ChatGPTObsidianLocalRestApi = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const BASE_URL = 'http://127.0.0.1:27123';
  const DEFAULT_FOLDER = 'inbox';

  // Turn whatever the user typed into a clean vault-relative folder path.
  // Accepts backslashes, stray/leading/trailing slashes, and empty input.
  // Returns '' for the vault root, or a path like 'notes/ChatGPT'.
  function normalizeFolder(folder) {
    if (folder === undefined || folder === null) {
      return '';
    }
    return String(folder)
      .replace(/\\/g, '/')
      .split('/')
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0)
      .join('/');
  }

  // Encode each path segment for the URL while keeping '/' as a separator.
  function encodeFolderPath(folder) {
    return folder
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
  }

  function folderVaultUrl(folder) {
    const normalized = normalizeFolder(folder);
    return normalized ? `${BASE_URL}/vault/${encodeFolderPath(normalized)}/` : `${BASE_URL}/vault/`;
  }

  function buildListRequest(apiKey, folder) {
    return {
      url: folderVaultUrl(folder),
      options: {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` }
      }
    };
  }

  function buildWriteRequest(apiKey, folder, filename, content) {
    return {
      url: `${folderVaultUrl(folder)}${encodeURIComponent(filename)}`,
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

  return {
    BASE_URL,
    DEFAULT_FOLDER,
    normalizeFolder,
    encodeFolderPath,
    buildListRequest,
    buildWriteRequest
  };
});
