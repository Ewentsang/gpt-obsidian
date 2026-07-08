const test = require('node:test');
const assert = require('node:assert/strict');
const { buildInboxMarkdown, todayLocalDate } = require('../lib/frontmatter.js');

test('buildInboxMarkdown produces the inbox skill frontmatter shape', () => {
  const result = buildInboxMarkdown({
    title: 'Weekend planning',
    source: 'https://chatgpt.com/c/abc123',
    captured: '2026-07-08',
    transcript: '**You:**\nHi\n\n**ChatGPT:**\nHello!'
  });

  assert.equal(
    result,
    [
      '---',
      'title: Weekend planning',
      'source: https://chatgpt.com/c/abc123',
      'captured: 2026-07-08',
      'tags: [inbox]',
      '---',
      '',
      '**You:**\nHi\n\n**ChatGPT:**\nHello!',
      ''
    ].join('\n')
  );
});

test('buildInboxMarkdown quotes titles containing YAML-sensitive characters', () => {
  const result = buildInboxMarkdown({
    title: 'Q&A: budget #2026',
    source: '',
    captured: '2026-07-08',
    transcript: 'body'
  });

  assert.ok(result.includes('title: "Q&A: budget #2026"'));
});

test('buildInboxMarkdown quotes a title ending in an unspaced colon', () => {
  const result = buildInboxMarkdown({
    title: 'Notes:',
    source: '',
    captured: '2026-07-08',
    transcript: 'body'
  });

  assert.ok(result.includes('title: "Notes:"'));
});

test('todayLocalDate formats a given date as YYYY-MM-DD using local fields', () => {
  assert.equal(todayLocalDate(new Date(2026, 6, 8)), '2026-07-08');
});
