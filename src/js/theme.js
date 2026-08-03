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
  const accountBtn = document.getElementById('account-menu-open');
  const popover = document.getElementById('settings-popover');
  const togglePopover = (e) => {
    e.stopPropagation();
    popover.hidden = !popover.hidden;
  };
  settingsBtn.addEventListener('click', togglePopover);
  accountBtn.addEventListener('click', togglePopover);
  document.addEventListener('click', (e) => {
    if (!popover.hidden && !popover.contains(e.target) && !settingsBtn.contains(e.target) && !accountBtn.contains(e.target)) {
      popover.hidden = true;
    }
  });
}
