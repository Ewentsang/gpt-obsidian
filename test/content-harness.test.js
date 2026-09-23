const test = require('node:test');
const assert = require('node:assert/strict');
const { registerExtractor } = require('../lib/content-harness.js');

function makeFakeRuntime() {
  const listeners = [];
  return {
    runtime: {
      onMessage: {
        addListener(fn) {
          listeners.push(fn);
        }
      }
    },
    listeners
  };
}

test('registerExtractor exposes the extractor under the given debug global name', () => {
  const globalObj = {};
  const { runtime } = makeFakeRuntime();
  const extractConversation = async () => ({ title: 't' });
  registerExtractor(extractConversation, '__testExtract', { globalObj, runtime });
  assert.equal(globalObj.__testExtract, extractConversation);
});

test('registerExtractor ignores messages of other types', () => {
  const { runtime, listeners } = makeFakeRuntime();
  registerExtractor(async () => ({}), '__testExtract', { globalObj: {}, runtime });
  const listener = listeners[0];
  const result = listener({ type: 'SOMETHING_ELSE' }, {}, () => {
    throw new Error('sendResponse should not be called');
  });
  assert.equal(result, undefined);
});

test('registerExtractor resolves EXTRACT_CONVERSATION with ok:true and the result', async () => {
  const { runtime, listeners } = makeFakeRuntime();
  const result = { title: 'hello' };
  registerExtractor(async () => result, '__testExtract', { globalObj: {}, runtime });
  const listener = listeners[0];
  const responses = [];
  const keepChannelOpen = listener(
    { type: 'EXTRACT_CONVERSATION' },
    {},
    (response) => responses.push(response)
  );
  assert.equal(keepChannelOpen, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(responses, [{ ok: true, result }]);
});

test('registerExtractor resolves EXTRACT_CONVERSATION with ok:false and the error message on failure', async () => {
  const { runtime, listeners } = makeFakeRuntime();
  registerExtractor(
    async () => {
      throw new Error('boom');
    },
    '__testExtract',
    { globalObj: {}, runtime }
  );
  const listener = listeners[0];
  const responses = [];
  listener({ type: 'EXTRACT_CONVERSATION' }, {}, (response) => responses.push(response));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(responses, [{ ok: false, error: 'boom' }]);
});
