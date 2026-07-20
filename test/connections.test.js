const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../lib/connections.js');

test('migrateLegacy returns empty state when nothing is stored', () => {
  assert.deepEqual(C.migrateLegacy({}), { connections: [], activeConnectionId: null });
  assert.deepEqual(C.migrateLegacy(undefined), { connections: [], activeConnectionId: null });
});

test('migrateLegacy converts a legacy key + folder into one connection', () => {
  const state = C.migrateLegacy({ localRestApiKey: 'abc', targetFolder: 'notes' });
  assert.equal(state.connections.length, 1);
  assert.deepEqual(state.connections[0], {
    id: 'c1', label: 'My vault', port: 27123, apiKey: 'abc', lastFolder: 'notes'
  });
  assert.equal(state.activeConnectionId, 'c1');
});

test('migrateLegacy defaults the legacy folder to inbox when absent', () => {
  const state = C.migrateLegacy({ localRestApiKey: 'abc' });
  assert.equal(state.connections[0].lastFolder, 'inbox');
});

test('migrateLegacy treats an empty legacy key as no connection', () => {
  assert.deepEqual(
    C.migrateLegacy({ localRestApiKey: '', targetFolder: 'x' }),
    { connections: [], activeConnectionId: null }
  );
});

test('migrateLegacy passes through the new shape unchanged', () => {
  const raw = { connections: [{ id: 'c2', label: 'X', port: 27124, apiKey: 'k', lastFolder: '' }], activeConnectionId: 'c2' };
  assert.deepEqual(C.migrateLegacy(raw), raw);
});

test('migrateLegacy repairs a missing activeConnectionId on the new shape', () => {
  const raw = { connections: [{ id: 'c5', label: 'X', port: 27124, apiKey: 'k', lastFolder: '' }] };
  assert.equal(C.migrateLegacy(raw).activeConnectionId, 'c5');
});

test('nextConnectionId is max suffix + 1', () => {
  assert.equal(C.nextConnectionId([]), 'c1');
  assert.equal(C.nextConnectionId([{ id: 'c1' }, { id: 'c3' }]), 'c4');
});

test('addConnection assigns an id and makes the first one active', () => {
  let state = C.emptyState();
  state = C.addConnection(state, { label: 'Work', port: 27123, apiKey: 'k1' });
  assert.equal(state.connections[0].id, 'c1');
  assert.equal(state.connections[0].lastFolder, '');
  assert.equal(state.activeConnectionId, 'c1');
  state = C.addConnection(state, { label: 'Personal', port: 27124, apiKey: 'k2' });
  assert.equal(state.connections[1].id, 'c2');
  assert.equal(state.activeConnectionId, 'c1'); // unchanged
});

test('updateConnection patches only the matching connection', () => {
  let state = C.addConnection(C.emptyState(), { label: 'Work', port: 27123, apiKey: 'k1' });
  state = C.updateConnection(state, 'c1', { label: 'Job', port: 27130 });
  assert.equal(state.connections[0].label, 'Job');
  assert.equal(state.connections[0].port, 27130);
  assert.equal(state.connections[0].apiKey, 'k1');
});

test('removeConnection reassigns the active id to the first remaining', () => {
  let state = C.addConnection(C.emptyState(), { label: 'A', port: 1, apiKey: 'k' });
  state = C.addConnection(state, { label: 'B', port: 2, apiKey: 'k' });
  state = C.removeConnection(state, 'c1');
  assert.equal(state.connections.length, 1);
  assert.equal(state.activeConnectionId, 'c2');
});

test('removeConnection clears the active id when the list empties', () => {
  let state = C.addConnection(C.emptyState(), { label: 'A', port: 1, apiKey: 'k' });
  state = C.removeConnection(state, 'c1');
  assert.equal(state.activeConnectionId, null);
});

test('setActive and setLastFolder update the right fields', () => {
  let state = C.addConnection(C.emptyState(), { label: 'A', port: 1, apiKey: 'k' });
  state = C.addConnection(state, { label: 'B', port: 2, apiKey: 'k' });
  state = C.setActive(state, 'c2');
  assert.equal(state.activeConnectionId, 'c2');
  state = C.setLastFolder(state, 'c2', 'inbox/sub');
  assert.equal(C.getById(state, 'c2').lastFolder, 'inbox/sub');
});

test('normalizeApiKey strips a leading Bearer prefix (case-insensitive) and trims', () => {
  assert.equal(C.normalizeApiKey('Bearer abc123'), 'abc123');
  assert.equal(C.normalizeApiKey('bearer   abc123'), 'abc123');
  assert.equal(C.normalizeApiKey('BEARER\tabc123'), 'abc123');
  assert.equal(C.normalizeApiKey('  abc123  '), 'abc123');
  assert.equal(C.normalizeApiKey('abc123'), 'abc123');
});

test('normalizeApiKey does not strip Bearer when it is not a prefix token', () => {
  // No whitespace after "Bearer" → not the header prefix, leave it alone.
  assert.equal(C.normalizeApiKey('Bearerabc'), 'Bearerabc');
  // A key that merely contains the substring later is untouched.
  assert.equal(C.normalizeApiKey('abcBearer'), 'abcBearer');
});

test('normalizeApiKey handles empty and missing input', () => {
  assert.equal(C.normalizeApiKey(''), '');
  assert.equal(C.normalizeApiKey('   '), '');
  assert.equal(C.normalizeApiKey(undefined), '');
  assert.equal(C.normalizeApiKey(null), '');
});
