const test = require('node:test');
const assert = require('node:assert/strict');
const { extractMessages, assembleTranscript } = require('../lib/conversation.js');

const FIXTURE = {
  current_node: 'msg2-id',
  mapping: {
    'root-id': { id: 'root-id', message: null, parent: null, children: ['msg1-id'] },
    'msg1-id': {
      id: 'msg1-id',
      parent: 'root-id',
      children: ['msg2-id'],
      message: {
        id: 'msg1-id',
        author: { role: 'user' },
        content: { content_type: 'text', parts: ['Hello, how are you?'] },
        recipient: 'all'
      }
    },
    'msg2-id': {
      id: 'msg2-id',
      parent: 'msg1-id',
      children: [],
      message: {
        id: 'msg2-id',
        author: { role: 'assistant' },
        content: {
          content_type: 'text',
          parts: ["I'm doing well, thanks!\n\n```js\nconsole.log('hi')\n```"]
        },
        recipient: 'all'
      }
    }
  }
};

test('extractMessages walks the current_node parent chain in order', () => {
  const messages = extractMessages(FIXTURE);
  assert.deepEqual(messages, [
    { role: 'user', text: 'Hello, how are you?' },
    { role: 'assistant', text: "I'm doing well, thanks!\n\n```js\nconsole.log('hi')\n```" }
  ]);
});

test('extractMessages skips tool/system noise', () => {
  const withTool = {
    current_node: 'msg2-id',
    mapping: {
      ...FIXTURE.mapping,
      'msg1-id': {
        ...FIXTURE.mapping['msg1-id'],
        message: {
          ...FIXTURE.mapping['msg1-id'].message,
          recipient: 'browser'
        }
      }
    }
  };
  const messages = extractMessages(withTool);
  assert.deepEqual(messages, [
    { role: 'assistant', text: "I'm doing well, thanks!\n\n```js\nconsole.log('hi')\n```" }
  ]);
});

test('extractMessages throws on an unrecognized shape', () => {
  assert.throws(() => extractMessages({}), /Unexpected conversation shape/);
});

test('extractMessages throws when a node in the parent chain is missing from mapping', () => {
  const broken = {
    current_node: 'msg2-id',
    mapping: {
      'msg2-id': FIXTURE.mapping['msg2-id']
    }
  };
  assert.throws(() => extractMessages(broken), /missing mapping entry/);
});

test('assembleTranscript labels turns and separates with a blank line', () => {
  const transcript = assembleTranscript([
    { role: 'user', text: 'Hi' },
    { role: 'assistant', text: 'Hello!' }
  ]);
  assert.equal(transcript, '**You:**\nHi\n\n**ChatGPT:**\nHello!');
});
