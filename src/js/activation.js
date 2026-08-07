'use strict';

function renderActivationStatus(status) {
  document.body.classList.remove('is-activation-locked');
  document.getElementById('activation-overlay').hidden = true;
  const settingsStatus = document.getElementById('activation-settings-status');
  const settingsNote = document.getElementById('activation-settings-note');
  if (settingsStatus) {
    settingsStatus.hidden = true;
    settingsStatus.textContent = '';
    settingsStatus.classList.remove('is-ready');
  }
  if (settingsNote) {
    settingsNote.textContent = '';
    settingsNote.hidden = true;
  }
}

async function submitActivation(input, button, feedback) {
  const code = input.value.trim();
  if (!code) {
    feedback.textContent = 'Enter a redemption code.';
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
        : 'Invalid redemption code.';
      feedback.hidden = false;
      input.focus();
      return false;
    }
    input.value = '';
    renderActivationStatus(result);
    if (result.membership && window.MesssCredits) {
      window.MesssCredits.publish(result.membership);
    }
    if (feedback) {
      feedback.textContent = result.creditsAdded > 0
        ? `${result.creditsAdded} points added.`
        : (result.redemptionReason === 'already-redeemed' ? 'Code already redeemed on this device.' : 'Code accepted.');
      feedback.hidden = false;
    }
    return true;
  } catch (activationError) {
    feedback.textContent = activationError && activationError.message
      ? activationError.message
      : 'Redemption failed. Please try again.';
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
