(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ChatGPTObsidianLocalRestApi = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const DEFAULT_FOLDER = 'inbox';

  function baseUrlFor(connection) {
    return `http://127.0.0.1:${connection.port}`;
  }

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

  function encodeFolderPath(folder) {
    return folder
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
  }

  function folderVaultUrl(baseUrl, folder) {
    const normalized = normalizeFolder(folder);
    return normalized ? `${baseUrl}/vault/${encodeFolderPath(normalized)}/` : `${baseUrl}/vault/`;
  }

  function subfoldersOf(entries) {
    return (entries || [])
      .filter((entry) => typeof entry === 'string' && entry.endsWith('/'))
      .map((entry) => entry.slice(0, -1))
      .sort();
  }

  function buildInfoRequest(baseUrl, apiKey) {
    const headers = {};
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    return { url: `${baseUrl}/`, options: { method: 'GET', headers } };
  }

  function buildListRequest(baseUrl, apiKey, folder) {
    return {
      url: folderVaultUrl(baseUrl, folder),
      options: { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` } }
    };
  }

  function buildWriteRequest(baseUrl, apiKey, folder, filename, content) {
    return {
      url: `${folderVaultUrl(baseUrl, folder)}${encodeURIComponent(filename)}`,
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
    DEFAULT_FOLDER,
    baseUrlFor,
    normalizeFolder,
    encodeFolderPath,
    subfoldersOf,
    buildInfoRequest,
    buildListRequest,
    buildWriteRequest
  };
});
