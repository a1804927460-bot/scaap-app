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
  const appliedTheme = initialTheme === 'dark' ? 'dark' : 'light';
  applyTheme(appliedTheme);

  document.querySelectorAll('.theme-opt').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const choice = btn.dataset.themeChoice;
      applyTheme(choice);
      await window.messsAPI.setTheme(choice);
    });
  });

  const settingsBtn = document.getElementById('settings-btn');
  const accountBtn = document.getElementById('account-menu-open');
  const settingsPopover = document.getElementById('settings-popover');
  const accountPopover = document.getElementById('account-popover');
  const togglePopover = (popover, otherPopover) => (e) => {
    e.stopPropagation();
    otherPopover.hidden = true;
    popover.hidden = !popover.hidden;
  };
  settingsBtn.addEventListener('click', togglePopover(settingsPopover, accountPopover));
  accountBtn.addEventListener('click', togglePopover(accountPopover, settingsPopover));
  document.addEventListener('click', (e) => {
    if (!settingsPopover.hidden && !settingsPopover.contains(e.target) && !settingsBtn.contains(e.target)) {
      settingsPopover.hidden = true;
    }
    if (!accountPopover.hidden && !accountPopover.contains(e.target) && !accountBtn.contains(e.target)) {
      accountPopover.hidden = true;
    }
  });
}
