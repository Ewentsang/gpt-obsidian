(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ChatGPTObsidianConversation = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  function extractMessages(conversationJson) {
    const mapping = conversationJson && conversationJson.mapping;
    const currentNode = conversationJson && conversationJson.current_node;
    if (!mapping || !currentNode) {
      throw new Error('Unexpected conversation shape: missing mapping or current_node');
    }

    const chain = [];
    let nodeId = currentNode;
    while (nodeId) {
      const node = mapping[nodeId];
      if (!node) {
        throw new Error(`Unexpected conversation shape: missing mapping entry for node ${nodeId}`);
      }
      chain.push(node);
      nodeId = node.parent;
    }
    chain.reverse();

    const messages = [];
    for (const node of chain) {
      const message = node.message;
      if (!message) continue;
      const role = message.author && message.author.role;
      if (role !== 'user' && role !== 'assistant') continue;
      if (message.recipient && message.recipient !== 'all') continue;
      const content = message.content;
      if (!content || content.content_type !== 'text') continue;
      const text = (content.parts || []).join('\n').trim();
      if (!text) continue;
      messages.push({ role, text });
    }
    return messages;
  }

  function assembleTranscript(messages) {
    return messages
      .map((m) => `**${m.role === 'user' ? 'You' : 'ChatGPT'}:**\n${m.text}`)
      .join('\n\n');
  }

  return { extractMessages, assembleTranscript };
});
