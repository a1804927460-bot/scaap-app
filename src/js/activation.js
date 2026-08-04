'use strict';

function renderActivationStatus(status) {
  const activated = !!(status && status.activated);
  document.body.classList.remove('is-activation-locked');
  document.getElementById('activation-overlay').hidden = true;
  const settingsStatus = document.getElementById('activation-settings-status');
  const settingsNote = document.getElementById('activation-settings-note');
  if (settingsStatus) {
    settingsStatus.textContent = activated ? 'Activated' : 'Not activated';
    settingsStatus.classList.toggle('is-ready', activated);
  }
  if (settingsNote) {
    settingsNote.textContent = activated
      ? 'This device is authorized for the development build.'
      : 'Enter an activation code here when one is required.';
  }
  return activated;
}

async function submitActivation(input, button, error) {
  const code = input.value.trim();
  if (!code) {
    error.textContent = 'Enter the activation code.';
    error.hidden = false;
    input.focus();
    return false;
  }
  button.disabled = true;
  error.hidden = true;
  try {
    const result = await window.messsAPI.activateApp(code);
    input.value = '';
    if (!result || !result.ok) {
      error.textContent = 'Invalid activation code.';
      error.hidden = false;
      input.focus();
      return false;
    }
    renderActivationStatus(result);
    const config = typeof refreshAiMediaSettings === 'function'
      ? await refreshAiMediaSettings()
      : await window.messsAPI.getAiMediaConfig();
    document.dispatchEvent(new CustomEvent('messs:ai-config-updated', { detail: config }));
    return true;
  } finally {
    button.disabled = false;
  }
}

async function initActivation(initialStatus) {
  const settingsForm = document.getElementById('activation-settings-form');
  const settingsInput = document.getElementById('activation-settings-code');
  const settingsButton = settingsForm.querySelector('button');
  const settingsNote = document.getElementById('activation-settings-note');

  settingsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const ok = await submitActivation(settingsInput, settingsButton, settingsNote);
    if (ok) settingsNote.textContent = 'Activation verified for this device.';
  });

  const status = initialStatus || await window.messsAPI.getActivationStatus();
  renderActivationStatus(status);
}
