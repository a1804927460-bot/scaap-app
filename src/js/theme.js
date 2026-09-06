'use strict';
/* Theme toggle: dark <-> light, persisted via main process. */

function applyTheme(theme) {
  const previous = document.documentElement.getAttribute('data-theme');
  document.documentElement.setAttribute('data-theme', theme);
  AppState.theme = theme;
  document.querySelectorAll('.theme-opt').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.themeChoice === theme);
  });
  if (previous !== theme && AppState.boardItems?.length && typeof renderBoard === 'function' && document.getElementById('board-canvas')) {
    renderBoard();
  }
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
    document.body.appendChild(popover);
    const anchor = e.currentTarget.getBoundingClientRect();
    popover.style.position = 'fixed';
    popover.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - 316))}px`;
    popover.style.bottom = `${Math.max(8, window.innerHeight - anchor.top + 8)}px`;
    popover.hidden = !popover.hidden;
  };
  settingsBtn.addEventListener('click', togglePopover(settingsPopover, accountPopover));
  accountBtn.addEventListener('click', togglePopover(accountPopover, settingsPopover));
  document.getElementById('ai-account-menu-open')?.addEventListener('click', togglePopover(accountPopover, settingsPopover));
  document.getElementById('ai-settings-btn')?.addEventListener('click', togglePopover(settingsPopover, accountPopover));
  document.addEventListener('click', (e) => {
    if (!settingsPopover.hidden && !settingsPopover.contains(e.target) && !settingsBtn.contains(e.target)) {
      settingsPopover.hidden = true;
    }
    if (!accountPopover.hidden && !accountPopover.contains(e.target) && !accountBtn.contains(e.target)) {
      accountPopover.hidden = true;
    }
  });
}
