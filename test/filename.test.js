const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeTitle, buildBaseName, dedupeFilename } = require('../lib/filename.js');

test('sanitizeTitle strips emoji and illegal characters', () => {
  assert.equal(sanitizeTitle('🚀 Project: Falcon/Plan'), 'Project- Falcon-Plan');
});

test('sanitizeTitle falls back for empty titles', () => {
  assert.equal(sanitizeTitle('   '), 'untitled-conversation');
  assert.equal(sanitizeTitle(''), 'untitled-conversation');
});

test('sanitizeTitle keeps Chinese characters', () => {
  assert.equal(sanitizeTitle('晚间复盘：职业规划'), '晚间复盘-职业规划');
});

test('buildBaseName prefixes the sanitized title with the captured date', () => {
  assert.equal(buildBaseName('🚀 Project: Falcon/Plan', '2026-07-08'), '2026-07-08 Project- Falcon-Plan');
});

test('dedupeFilename returns base name when free', () => {
  assert.equal(dedupeFilename('daily-log', ['other.md']), 'daily-log.md');
});

test('dedupeFilename appends -2, -3 when taken', () => {
  assert.equal(dedupeFilename('daily-log', ['daily-log.md']), 'daily-log-2.md');
  assert.equal(
    dedupeFilename('daily-log', ['daily-log.md', 'daily-log-2.md']),
    'daily-log-3.md'
  );
});
