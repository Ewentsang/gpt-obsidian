const test = require('node:test');
const assert = require('node:assert/strict');
const { buildListRequest, buildWriteRequest } = require('../lib/local-rest-api.js');

test('buildListRequest targets the inbox directory with a bearer token', () => {
  const { url, options } = buildListRequest('secret-key');
  assert.equal(url, 'http://127.0.0.1:27123/vault/inbox/');
  assert.equal(options.method, 'GET');
  assert.equal(options.headers.Authorization, 'Bearer secret-key');
});

test('buildWriteRequest PUTs markdown content to the encoded filename', () => {
  const { url, options } = buildWriteRequest('secret-key', 'weekend planning.md', '# hi');
  assert.equal(url, 'http://127.0.0.1:27123/vault/inbox/weekend%20planning.md');
  assert.equal(options.method, 'PUT');
  assert.equal(options.headers.Authorization, 'Bearer secret-key');
  assert.equal(options.headers['Content-Type'], 'text/markdown');
  assert.equal(options.body, '# hi');
});
