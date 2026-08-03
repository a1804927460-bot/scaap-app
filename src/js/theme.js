'use strict';
/* Theme toggle: dark <-> light, persisted via main process. */

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  AppState.theme = theme;
  document.querySelectorAll('.theme-opt').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.themeChoice === theme);
  });
}

function initTheme(initialTheme) {
  applyTheme(initialTheme || 'dark');

  document.querySelectorAll('.theme-opt').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const choice = btn.dataset.themeChoice;
      applyTheme(choice);
      await window.messsAPI.setTheme(choice);
    });
  });

  const settingsBtn = document.getElementById('settings-btn');
  const popover = document.getElementById('settings-popover');
  settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    popover.hidden = !popover.hidden;
  });
  document.addEventListener('click', (e) => {
    if (!popover.hidden && !popover.contains(e.target) && e.target !== settingsBtn) {
      popover.hidden = true;
    }
  });
}
