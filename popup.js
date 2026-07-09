const captureButton = document.getElementById('capture');
const statusEl = document.getElementById('status');
const previewEl = document.getElementById('preview');
const openOptionsButton = document.getElementById('openOptions');

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = kind || '';
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
      payload: extractResponse.result
    });
    if (!saveResponse || !saveResponse.ok) {
      throw new Error((saveResponse && saveResponse.error) || 'Save failed');
    }

    setStatus(`Saved to inbox/${saveResponse.result.filename}`, 'success');
  } catch (error) {
    setStatus(error.message, 'error');
    openOptionsButton.style.display = error.message.includes('API key') ? 'block' : 'none';
  } finally {
    captureButton.disabled = false;
  }
});
