(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ChatGPTObsidianFilename = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  function sanitizeTitle(title) {
    if (!title || !title.trim()) {
      return 'untitled-conversation';
    }
    return title
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
      .replace(/[:：]/g, '-')
      .replace(/[\/]/g, '-')
      .replace(/[\\?*"<>|]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function buildBaseName(title, captured) {
    return `${captured} ${sanitizeTitle(title)}`;
  }

  function dedupeFilename(baseName, existingNames) {
    const existing = new Set(existingNames);
    const candidate = `${baseName}.md`;
    if (!existing.has(candidate)) {
      return candidate;
    }
    let suffix = 2;
    while (existing.has(`${baseName}-${suffix}.md`)) {
      suffix += 1;
    }
    return `${baseName}-${suffix}.md`;
  }

  return { sanitizeTitle, buildBaseName, dedupeFilename };
});
