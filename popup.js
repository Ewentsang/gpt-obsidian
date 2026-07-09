const captureButton = document.getElementById('capture');
const statusEl = document.getElementById('status');
const previewEl = document.getElementById('preview');
const openOptionsButton = document.getElementById('openOptions');
const folderInput = document.getElementById('folder');
const folderSuggestions = document.getElementById('folderSuggestions');

const DEFAULT_FOLDER = 'inbox';

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = kind || '';
}

// Pre-fill the folder with whatever the user last chose (defaulting to
// `inbox` on first run) so a plain click just works.
async function loadSavedFolder() {
  const { targetFolder } = await chrome.storage.local.get('targetFolder');
  folderInput.value = targetFolder === undefined ? DEFAULT_FOLDER : targetFolder;
}

// Populate the autocomplete list with the vault's real folders. Best-effort:
// if the key is missing or Obsidian is unreachable, the field still accepts
// any free-text path.
async function loadFolderSuggestions() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'LIST_FOLDERS' });
    if (!response || !response.ok || !response.result.folders.length) {
      return;
    }
    folderSuggestions.innerHTML = '';
    for (const folder of response.result.folders) {
      const option = document.createElement('option');
      option.value = folder;
      folderSuggestions.appendChild(option);
    }
  } catch (error) {
    // Ignore — suggestions are a convenience, not a requirement.
  }
}

openOptionsButton.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

captureButton.addEventListener('click', async () => {
  captureButton.disabled = true;
  setStatus('Reading conversation…', '');
  previewEl.textContent = '';
  openOptionsButton.style.display = 'none';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      throw new Error('Could not find the active tab');
    }

    let extractResponse;
    try {
      extractResponse = await chrome.tabs.sendMessage(tab.id, {
        type: 'EXTRACT_CONVERSATION'
      });
    } catch (sendError) {
      // No content script listening yet — happens when the tab was already
      // open before the extension was loaded/reloaded. Inject it and retry
      // once instead of asking the user to refresh the page.
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['lib/conversation.js', 'content.js']
        });
        extractResponse = await chrome.tabs.sendMessage(tab.id, {
          type: 'EXTRACT_CONVERSATION'
        });
      } catch (retryError) {
        throw new Error('Failed to read the conversation — make sure this tab is a ChatGPT conversation');
      }
    }
    if (!extractResponse || !extractResponse.ok) {
      throw new Error(
        (extractResponse && extractResponse.error) ||
          'Failed to read the conversation — make sure this tab is a ChatGPT conversation'
      );
    }

    previewEl.textContent = `Title: ${extractResponse.result.title}`;
    setStatus('Saving to Obsidian…', '');

    const saveResponse = await chrome.runtime.sendMessage({
      type: 'SAVE_TO_INBOX',
      payload: { ...extractResponse.result, folder: folderInput.value }
    });
    if (!saveResponse || !saveResponse.ok) {
      throw new Error((saveResponse && saveResponse.error) || 'Save failed');
    }

    const { folder, filename } = saveResponse.result;
    // Reflect the normalized folder the background actually saved into.
    folderInput.value = folder;
    const savedPath = folder ? `${folder}/${filename}` : filename;
    setStatus(`Saved to ${savedPath}`, 'success');
  } catch (error) {
    setStatus(error.message, 'error');
    openOptionsButton.style.display = error.message.includes('API key') ? 'block' : 'none';
  } finally {
    captureButton.disabled = false;
  }
});

loadSavedFolder();
loadFolderSuggestions();
