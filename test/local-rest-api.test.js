const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildListRequest,
  buildWriteRequest,
  normalizeFolder
} = require('../lib/local-rest-api.js');

test('buildListRequest targets the given folder with a bearer token', () => {
  const { url, options } = buildListRequest('secret-key', 'inbox');
  assert.equal(url, 'http://127.0.0.1:27123/vault/inbox/');
  assert.equal(options.method, 'GET');
  assert.equal(options.headers.Authorization, 'Bearer secret-key');
});

test('buildListRequest targets the vault root when the folder is empty', () => {
  const { url } = buildListRequest('secret-key', '');
  assert.equal(url, 'http://127.0.0.1:27123/vault/');
});

test('buildWriteRequest PUTs markdown content to the encoded folder + filename', () => {
  const { url, options } = buildWriteRequest('secret-key', 'inbox', 'weekend planning.md', '# hi');
  assert.equal(url, 'http://127.0.0.1:27123/vault/inbox/weekend%20planning.md');
  assert.equal(options.method, 'PUT');
  assert.equal(options.headers.Authorization, 'Bearer secret-key');
  assert.equal(options.headers['Content-Type'], 'text/markdown');
  assert.equal(options.body, '# hi');
});

test('buildWriteRequest encodes each segment of a nested folder path', () => {
  const { url } = buildWriteRequest('k', 'my notes/ChatGPT', 'a.md', 'x');
  assert.equal(url, 'http://127.0.0.1:27123/vault/my%20notes/ChatGPT/a.md');
});

test('buildWriteRequest writes to the vault root when the folder is empty', () => {
  const { url } = buildWriteRequest('k', '', 'a.md', 'x');
  assert.equal(url, 'http://127.0.0.1:27123/vault/a.md');
});

test('normalizeFolder trims, drops stray slashes, and normalizes separators', () => {
  assert.equal(normalizeFolder('  inbox  '), 'inbox');
  assert.equal(normalizeFolder('/inbox/'), 'inbox');
  assert.equal(normalizeFolder('notes//ChatGPT/'), 'notes/ChatGPT');
  assert.equal(normalizeFolder('notes\\ChatGPT'), 'notes/ChatGPT');
  assert.equal(normalizeFolder('  a / b '), 'a/b');
});

test('normalizeFolder returns an empty string for empty or missing input', () => {
  assert.equal(normalizeFolder(''), '');
  assert.equal(normalizeFolder('   '), '');
  assert.equal(normalizeFolder('/'), '');
  assert.equal(normalizeFolder(undefined), '');
  assert.equal(normalizeFolder(null), '');
});
