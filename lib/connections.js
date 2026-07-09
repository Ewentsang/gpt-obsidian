(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ChatGPTObsidianConnections = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const DEFAULT_PORT = 27123;
  const DEFAULT_FOLDER = 'inbox';

  function emptyState() {
    return { connections: [], activeConnectionId: null };
  }

  function nextConnectionId(connections) {
    let max = 0;
    for (const c of connections) {
      const match = /^c(\d+)$/.exec(c.id || '');
      if (match) {
        max = Math.max(max, parseInt(match[1], 10));
      }
    }
    return `c${max + 1}`;
  }

  function migrateLegacy(raw) {
    const source = raw || {};
    if (Array.isArray(source.connections)) {
      return {
        connections: source.connections,
        activeConnectionId:
          source.activeConnectionId ||
          (source.connections[0] && source.connections[0].id) ||
          null
      };
    }
    if (source.localRestApiKey) {
      const connection = {
        id: 'c1',
        label: 'My vault',
        port: DEFAULT_PORT,
        apiKey: source.localRestApiKey,
        lastFolder: source.targetFolder === undefined ? DEFAULT_FOLDER : source.targetFolder
      };
      return { connections: [connection], activeConnectionId: 'c1' };
    }
    return emptyState();
  }

  function getActive(state) {
    if (!state || !state.activeConnectionId) {
      return null;
    }
    return state.connections.find((c) => c.id === state.activeConnectionId) || null;
  }

  function getById(state, id) {
    return ((state && state.connections) || []).find((c) => c.id === id) || null;
  }

  function addConnection(state, fields) {
    const id = nextConnectionId(state.connections);
    const connection = {
      id,
      label: fields.label,
      port: fields.port,
      apiKey: fields.apiKey,
      lastFolder: fields.lastFolder === undefined ? '' : fields.lastFolder
    };
    return {
      connections: state.connections.concat([connection]),
      activeConnectionId: state.activeConnectionId || id
    };
  }

  function updateConnection(state, id, patch) {
    return {
      connections: state.connections.map((c) => (c.id === id ? Object.assign({}, c, patch) : c)),
      activeConnectionId: state.activeConnectionId
    };
  }

  function removeConnection(state, id) {
    const connections = state.connections.filter((c) => c.id !== id);
    let activeConnectionId = state.activeConnectionId;
    if (activeConnectionId === id) {
      activeConnectionId = connections.length ? connections[0].id : null;
    }
    return { connections, activeConnectionId };
  }

  function setActive(state, id) {
    return { connections: state.connections, activeConnectionId: id };
  }

  function setLastFolder(state, id, folder) {
    return updateConnection(state, id, { lastFolder: folder });
  }

  return {
    DEFAULT_PORT,
    DEFAULT_FOLDER,
    emptyState,
    nextConnectionId,
    migrateLegacy,
    getActive,
    getById,
    addConnection,
    updateConnection,
    removeConnection,
    setActive,
    setLastFolder
  };
});
