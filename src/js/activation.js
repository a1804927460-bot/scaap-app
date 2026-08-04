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
    settingsNote.textContent = status && status.cloudSyncRequired
      ? 'Re-enter your redemption code to sync cloud access.'
      : (activated ? 'Redemption verified.' : '');
    settingsNote.hidden = !activated && !(status && status.cloudSyncRequired);
  }
  return activated;
}

async function submitActivation(input, button, feedback) {
  const code = input.value.trim();
  if (!code) {
    feedback.textContent = 'Enter the activation code.';
    feedback.hidden = false;
    input.focus();
    return false;
  }
  button.disabled = true;
  feedback.hidden = true;
  try {
    const result = await window.messsAPI.activateApp(code);
    if (!result || !result.ok) {
      feedback.textContent = result && result.message
        ? result.message
        : 'Invalid activation code.';
      feedback.hidden = false;
      input.focus();
      return false;
    }
    input.value = '';
    renderActivationStatus(result);
    if (result.membership && window.MesssCredits) {
      window.MesssCredits.publish(result.membership);
    }
    const config = typeof refreshAiMediaSettings === 'function'
      ? await refreshAiMediaSettings()
      : await window.messsAPI.getAiMediaConfig();
    document.dispatchEvent(new CustomEvent('messs:ai-config-updated', { detail: config }));
    if (feedback) {
      feedback.textContent = result.creditsAdded > 0
        ? `${result.creditsAdded} points added.`
        : (result.redemptionReason === 'already-redeemed' ? 'Code already redeemed on this device.' : 'Redemption verified.');
      feedback.hidden = false;
    }
    return true;
  } catch (activationError) {
    feedback.textContent = activationError && activationError.message
      ? activationError.message
      : 'Activation failed. Please try again.';
    feedback.hidden = false;
    return false;
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
    await submitActivation(settingsInput, settingsButton, settingsNote);
  });

  const status = initialStatus || await window.messsAPI.getActivationStatus();
  renderActivationStatus(status);
  if (typeof window.messsAPI.onActivationUpdated === 'function') {
    window.messsAPI.onActivationUpdated((nextStatus) => renderActivationStatus(nextStatus));
  }
}
