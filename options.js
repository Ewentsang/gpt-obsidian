const apiKeyInput = document.getElementById('apiKey');
const saveButton = document.getElementById('save');
const statusEl = document.getElementById('status');

async function loadApiKey() {
  const { localRestApiKey } = await chrome.storage.local.get('localRestApiKey');
  if (localRestApiKey) {
    apiKeyInput.value = localRestApiKey;
  }
}

saveButton.addEventListener('click', async () => {
  await chrome.storage.local.set({ localRestApiKey: apiKeyInput.value.trim() });
  statusEl.textContent = '已保存';
  setTimeout(() => {
    statusEl.textContent = '';
  }, 2000);
});

loadApiKey();
