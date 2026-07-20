const test = require('node:test');
const assert = require('node:assert/strict');
const { extractMessages, assembleTranscript, resolveCitations } = require('../lib/conversation.js');

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
    { role: 'user', text: 'Hello, how are you?', references: [] },
    {
      role: 'assistant',
      text: "I'm doing well, thanks!\n\n```js\nconsole.log('hi')\n```",
      references: []
    }
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
    {
      role: 'assistant',
      text: "I'm doing well, thanks!\n\n```js\nconsole.log('hi')\n```",
      references: []
    }
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

test('extractMessages carries content_references from message metadata', () => {
  const withRefs = {
    current_node: 'a',
    mapping: {
      root: { id: 'root', message: null, parent: null, children: ['a'] },
      a: {
        id: 'a',
        parent: 'root',
        children: [],
        message: {
          id: 'a',
          author: { role: 'assistant' },
          content: { content_type: 'text', parts: ['hi'] },
          recipient: 'all',
          metadata: { content_references: [{ type: 'entity', alt: 'X' }] }
        }
      }
    }
  };
  assert.deepEqual(extractMessages(withRefs), [
    { role: 'assistant', text: 'hi', references: [{ type: 'entity', alt: 'X' }] }
  ]);
});

test('resolveCitations replaces entity markers with their plain name', () => {
  const marker = 'entity["people","Boris Cherny","creator of Claude Code"]';
  const prefix = '作者是 ';
  const text = `${prefix}${marker}。`;
  const refs = [
    {
      type: 'entity',
      matched_text: marker,
      start_idx: prefix.length,
      end_idx: prefix.length + marker.length,
      alt: 'Boris Cherny'
    }
  ];
  const state = { nextFootnote: 1, definitions: [] };
  assert.equal(resolveCitations(text, refs, state), '作者是 Boris Cherny。');
  assert.deepEqual(state.definitions, []);
});

test('resolveCitations turns grouped_webpages into a footnote and records its definition', () => {
  const marker = 'citeSEARCH';
  const text = `见此。${marker}`;
  const refs = [
    {
      type: 'grouped_webpages',
      matched_text: marker,
      start_idx: 3,
      end_idx: 3 + marker.length,
      items: [{ url: 'https://www.skool.com/x?utm_source=chatgpt.com', attribution: 'Skool' }]
    }
  ];
  const state = { nextFootnote: 1, definitions: [] };
  assert.equal(resolveCitations(text, refs, state), '见此。[^1]');
  assert.deepEqual(state.definitions, [
    '[^1]: [Skool](https://www.skool.com/x?utm_source=chatgpt.com)'
  ]);
});

test('grouped_webpages falls back to the URL host when attribution is missing', () => {
  const marker = 'cite';
  const refs = [
    {
      type: 'grouped_webpages',
      matched_text: marker,
      start_idx: 0,
      end_idx: marker.length,
      items: [{ url: 'https://www.arxiv.org/abs/1' }]
    }
  ];
  const state = { nextFootnote: 1, definitions: [] };
  assert.equal(resolveCitations(marker, refs, state), '[^1]');
  assert.deepEqual(state.definitions, ['[^1]: [arxiv.org](https://www.arxiv.org/abs/1)']);
});

test('resolveCitations ignores zero-length sources_footnote markers', () => {
  const text = 'a b c';
  const refs = [{ type: 'sources_footnote', matched_text: ' ', start_idx: 1, end_idx: 1 }];
  const state = { nextFootnote: 1, definitions: [] };
  assert.equal(resolveCitations(text, refs, state), 'a b c');
});

test('resolveCitations falls back to matched_text replacement when offsets do not line up', () => {
  const marker = 'entity["people","Ada"]';
  const text = `x ${marker} y`;
  const refs = [
    {
      type: 'entity',
      matched_text: marker,
      start_idx: 999, // wrong on purpose — forces the matched_text fallback
      end_idx: 1005,
      alt: 'Ada'
    }
  ];
  const state = { nextFootnote: 1, definitions: [] };
  assert.equal(resolveCitations(text, refs, state), 'x Ada y');
});

test('assembleTranscript shares one footnote counter and appends definitions at the end', () => {
  const messages = [
    { role: 'user', text: 'q' },
    {
      role: 'assistant',
      text: 'first A',
      references: [
        {
          type: 'grouped_webpages',
          matched_text: 'A',
          start_idx: 6,
          end_idx: 7,
          items: [{ url: 'https://a.com/1', attribution: 'A site' }]
        }
      ]
    },
    {
      role: 'assistant',
      text: 'second B',
      references: [
        {
          type: 'grouped_webpages',
          matched_text: 'B',
          start_idx: 7,
          end_idx: 8,
          items: [{ url: 'https://b.com/2', attribution: 'B site' }]
        }
      ]
    }
  ];
  const transcript = assembleTranscript(messages);
  assert.equal(
    transcript,
    '**You:**\nq\n\n' +
      '**ChatGPT:**\nfirst [^1]\n\n' +
      '**ChatGPT:**\nsecond [^2]\n\n' +
      '[^1]: [A site](https://a.com/1)\n' +
      '[^2]: [B site](https://b.com/2)'
  );
});
