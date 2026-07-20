const test = require('node:test');
const assert = require('node:assert/strict');
const {
  baseUrlFor,
  normalizeFolder,
  subfoldersOf,
  buildInfoRequest,
  buildListRequest,
  buildWriteRequest
} = require('../lib/local-rest-api.js');

test('baseUrlFor builds a loopback URL from the port', () => {
  assert.equal(baseUrlFor({ port: 27123 }), 'http://127.0.0.1:27123');
  assert.equal(baseUrlFor({ port: 27124 }), 'http://127.0.0.1:27124');
});

test('buildInfoRequest hits the health endpoint without auth by default', () => {
  const { url, options } = buildInfoRequest('http://127.0.0.1:27123');
  assert.equal(url, 'http://127.0.0.1:27123/');
  assert.equal(options.method, 'GET');
  assert.equal(options.headers.Authorization, undefined);
});

test('buildInfoRequest adds a bearer token when a key is given', () => {
  const { options } = buildInfoRequest('http://127.0.0.1:27123', 'k');
  assert.equal(options.headers.Authorization, 'Bearer k');
});

test('buildListRequest targets the given folder with a bearer token', () => {
  const { url, options } = buildListRequest('http://127.0.0.1:27124', 'secret', 'inbox');
  assert.equal(url, 'http://127.0.0.1:27124/vault/inbox/');
  assert.equal(options.method, 'GET');
  assert.equal(options.headers.Authorization, 'Bearer secret');
});

test('buildListRequest targets the vault root when the folder is empty', () => {
  const { url } = buildListRequest('http://127.0.0.1:27123', 'k', '');
  assert.equal(url, 'http://127.0.0.1:27123/vault/');
});

test('buildWriteRequest PUTs markdown to the encoded folder + filename', () => {
  const { url, options } = buildWriteRequest(
    'http://127.0.0.1:27123', 'secret', 'inbox', 'weekend planning.md', '# hi'
  );
  assert.equal(url, 'http://127.0.0.1:27123/vault/inbox/weekend%20planning.md');
  assert.equal(options.method, 'PUT');
  assert.equal(options.headers.Authorization, 'Bearer secret');
  assert.equal(options.headers['Content-Type'], 'text/markdown');
  assert.equal(options.body, '# hi');
});

test('buildWriteRequest encodes each segment of a nested folder path', () => {
  const { url } = buildWriteRequest('http://127.0.0.1:27123', 'k', 'my notes/ChatGPT', 'a.md', 'x');
  assert.equal(url, 'http://127.0.0.1:27123/vault/my%20notes/ChatGPT/a.md');
});

test('buildWriteRequest writes to the vault root when the folder is empty', () => {
  const { url } = buildWriteRequest('http://127.0.0.1:27123', 'k', '', 'a.md', 'x');
  assert.equal(url, 'http://127.0.0.1:27123/vault/a.md');
});

test('normalizeFolder trims, drops stray slashes, normalizes separators', () => {
  assert.equal(normalizeFolder('  inbox  '), 'inbox');
  assert.equal(normalizeFolder('/inbox/'), 'inbox');
  assert.equal(normalizeFolder('notes//ChatGPT/'), 'notes/ChatGPT');
  assert.equal(normalizeFolder('notes\\ChatGPT'), 'notes/ChatGPT');
});

test('normalizeFolder returns empty for empty/missing input', () => {
  assert.equal(normalizeFolder(''), '');
  assert.equal(normalizeFolder('/'), '');
  assert.equal(normalizeFolder(undefined), '');
  assert.equal(normalizeFolder(null), '');
});

test('subfoldersOf keeps only folder entries, strips the slash, sorts', () => {
  const entries = ['Zebra/', 'note.md', 'Alpha/', 'sub folder/', 'image.png'];
  assert.deepEqual(subfoldersOf(entries), ['Alpha', 'Zebra', 'sub folder']);
});

test('subfoldersOf tolerates missing input', () => {
  assert.deepEqual(subfoldersOf(undefined), []);
});
