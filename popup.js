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
  setStatus('正在读取对话…', '');
  previewEl.textContent = '';
  openOptionsButton.style.display = 'none';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      throw new Error('找不到当前标签页');
    }

    let extractResponse;
    try {
      extractResponse = await chrome.tabs.sendMessage(tab.id, {
        type: 'EXTRACT_CONVERSATION'
      });
    } catch (sendError) {
      throw new Error('读取对话失败，请确认当前页面是 ChatGPT 对话');
    }
    if (!extractResponse || !extractResponse.ok) {
      throw new Error(
        (extractResponse && extractResponse.error) ||
          '读取对话失败，请确认当前页面是 ChatGPT 对话'
      );
    }

    previewEl.textContent = `标题：${extractResponse.result.title}`;
    setStatus('正在存入 Obsidian…', '');

    const saveResponse = await chrome.runtime.sendMessage({
      type: 'SAVE_TO_INBOX',
      payload: extractResponse.result
    });
    if (!saveResponse || !saveResponse.ok) {
      throw new Error((saveResponse && saveResponse.error) || '存入失败');
    }

    setStatus(`已存入 inbox/${saveResponse.result.filename}`, 'success');
  } catch (error) {
    setStatus(error.message, 'error');
    openOptionsButton.style.display = error.message.includes('API key') ? 'block' : 'none';
  } finally {
    captureButton.disabled = false;
  }
});
