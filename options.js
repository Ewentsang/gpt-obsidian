const apiKeyInput = document.getElementById('apiKey');
const folderInput = document.getElementById('folder');
const saveButton = document.getElementById('save');
const statusEl = document.getElementById('status');

const DEFAULT_FOLDER = 'inbox';

async function loadSettings() {
  const { localRestApiKey, targetFolder } = await chrome.storage.local.get([
    'localRestApiKey',
    'targetFolder'
  ]);
  if (localRestApiKey) {
    apiKeyInput.value = localRestApiKey;
  }
  folderInput.value = targetFolder === undefined ? DEFAULT_FOLDER : targetFolder;
}

saveButton.addEventListener('click', async () => {
  await chrome.storage.local.set({
    localRestApiKey: apiKeyInput.value.trim(),
    targetFolder: folderInput.value.trim()
  });
  statusEl.textContent = 'Saved';
  setTimeout(() => {
    statusEl.textContent = '';
  }, 2000);
});

loadSettings();
