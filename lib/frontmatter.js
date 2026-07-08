(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ChatGPTObsidianFrontmatter = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  function escapeYamlString(value) {
    if (value.includes(': ') || /:$/.test(value) || value.includes('#') || value.includes('"')) {
      return `"${value.replace(/"/g, '\\"')}"`;
    }
    return value;
  }

  function buildInboxMarkdown({ title, source, captured, transcript }) {
    const lines = [
      '---',
      `title: ${escapeYamlString(title)}`,
      `source: ${escapeYamlString(source)}`,
      `captured: ${captured}`,
      'tags: [inbox]',
      '---',
      '',
      transcript.trim(),
      ''
    ];
    return lines.join('\n');
  }

  function todayLocalDate(date) {
    const d = date || new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  return { buildInboxMarkdown, escapeYamlString, todayLocalDate };
});
