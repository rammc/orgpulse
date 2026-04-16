const STORAGE_KEY = 'orgpulse_api_key';

export function getApiKey() {
  return localStorage.getItem(STORAGE_KEY) || '';
}

export function hasApiKey() {
  return !!getApiKey();
}

export function initSettings() {
  const modal = document.getElementById('settings-modal');
  const settingsBtn = document.getElementById('settings-btn');
  const closeBtn = document.getElementById('close-modal-btn');
  const saveBtn = document.getElementById('save-key-btn');
  const removeBtn = document.getElementById('remove-key-btn');
  const input = document.getElementById('api-key-input');
  const errorEl = document.getElementById('api-key-error');
  const statusEl = document.getElementById('key-status');

  function openModal() {
    modal.classList.add('modal-overlay--visible');
    input.value = getApiKey();
    errorEl.classList.remove('modal__error--visible');
    statusEl.classList.remove('modal__status--visible');
  }

  function closeModal() {
    modal.classList.remove('modal-overlay--visible');
  }

  function showStatus(message, type) {
    statusEl.textContent = message;
    statusEl.className = `modal__status modal__status--visible modal__status--${type}`;
  }

  settingsBtn.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('modal-overlay--visible')) {
      closeModal();
    }
  });

  saveBtn.addEventListener('click', () => {
    const key = input.value.trim();

    if (!key.startsWith('sk-ant-')) {
      errorEl.classList.add('modal__error--visible');
      input.classList.add('modal__input--error');
      return;
    }

    errorEl.classList.remove('modal__error--visible');
    input.classList.remove('modal__input--error');
    localStorage.setItem(STORAGE_KEY, key);
    showStatus('API key saved to LocalStorage.', 'success');
  });

  removeBtn.addEventListener('click', () => {
    localStorage.removeItem(STORAGE_KEY);
    input.value = '';
    showStatus('API key removed from LocalStorage.', 'removed');
  });
}
