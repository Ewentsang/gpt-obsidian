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
      // Keep the raw (untrimmed) text so content_references character offsets
      // still line up; trimming happens later in assembleTranscript.
      const text = (content.parts || []).join('\n');
      if (!text.trim()) continue;
      const references = (message.metadata && message.metadata.content_references) || [];
      messages.push({ role, text, references });
    }
    return messages;
  }

  // ChatGPT embeds citation/entity markers inline in the message text (wrapped
  // in invisible private-use characters) and describes each one in
  // metadata.content_references. Left alone they leak into the vault as noise
  // like `entity["people","Boris Cherny",...]` or `cite…turn0search3…`. This
  // resolves each marker to something readable using ChatGPT's own metadata.
  function hostLabel(url) {
    const match = /^https?:\/\/([^/]+)/i.exec(url || '');
    if (!match) return url || '';
    return match[1].replace(/^www\./, '');
  }

  function citationReplacement(ref, state) {
    switch (ref.type) {
      case 'entity':
        // A named entity (person, place, org). Fall back through the fields
        // ChatGPT populates with the plain display text.
        return ref.alt || ref.name || ref.prompt_text || '';
      case 'grouped_webpages': {
        // A web citation chip. Turn it into a Markdown footnote pointing at the
        // primary source, and collect the definition for the end of the note.
        const items = (ref.items && ref.items.length ? ref.items : ref.fallback_items) || [];
        const item = items[0];
        if (!item || !item.url) return '';
        const n = state.nextFootnote++;
        const label = item.attribution || hostLabel(item.url);
        state.definitions.push(`[^${n}]: [${label}](${item.url})`);
        return `[^${n}]`;
      }
      default:
        // sources_footnote (an aggregate "Sources" block, redundant with the
        // inline footnotes) and any unknown marker type: prefer its display
        // text if present, otherwise strip it so no raw token leaks through.
        return typeof ref.alt === 'string' ? ref.alt : '';
    }
  }

  function resolveCitations(text, references, state) {
    if (!Array.isArray(references) || references.length === 0) return text;

    // Assign footnote numbers in the order the markers appear in the text.
    const edits = [];
    const ordered = references
      .filter(
        (r) =>
          r &&
          typeof r.start_idx === 'number' &&
          typeof r.end_idx === 'number' &&
          r.end_idx > r.start_idx // ignore zero-length insertion points
      )
      .slice()
      .sort((a, b) => a.start_idx - b.start_idx);

    for (const ref of ordered) {
      edits.push({
        start: ref.start_idx,
        end: ref.end_idx,
        matched: ref.matched_text,
        replacement: citationReplacement(ref, state)
      });
    }
    if (edits.length === 0) return text;

    // Trust the offsets only if every span still matches what ChatGPT recorded;
    // otherwise fall back to replacing the (delimiter-wrapped, effectively
    // unique) matched_text so we never splice the wrong slice of the message.
    const indicesValid = edits.every(
      (e) => typeof e.matched === 'string' && text.slice(e.start, e.end) === e.matched
    );

    if (indicesValid) {
      // Apply back-to-front so earlier offsets stay valid as we splice.
      for (const e of edits.slice().sort((a, b) => b.start - a.start)) {
        text = text.slice(0, e.start) + e.replacement + text.slice(e.end);
      }
    } else {
      for (const e of edits) {
        if (typeof e.matched === 'string' && e.matched.length > 0) {
          text = text.split(e.matched).join(e.replacement);
        }
      }
    }
    return text;
  }

  function assembleTranscript(messages) {
    const state = { nextFootnote: 1, definitions: [] };
    const body = messages
      .map((m) => {
        const label = m.role === 'user' ? 'You' : 'ChatGPT';
        const text = resolveCitations(m.text, m.references || [], state).trim();
        return `**${label}:**\n${text}`;
      })
      .join('\n\n');
    if (state.definitions.length === 0) return body;
    return `${body}\n\n${state.definitions.join('\n')}`;
  }

  return { extractMessages, assembleTranscript, resolveCitations };
});
