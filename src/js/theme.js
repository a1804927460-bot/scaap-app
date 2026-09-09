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
  // Keep appearance, usage, update and provider shortcuts in the avatar menu.
  // This gives the account surface one predictable home on both the main and
  // Agent sidebars while preserving the existing setting element IDs.
  if (settingsPopover && accountPopover && settingsPopover.parentElement !== accountPopover) {
    accountPopover.appendChild(settingsPopover);
    settingsPopover.hidden = false;
    settingsPopover.classList.add('is-account-inline-settings');
  }
  const togglePopover = (popover, otherPopover) => (e) => {
    e.stopPropagation();
    if (popover === settingsPopover && accountPopover?.contains(settingsPopover)) {
      accountPopover.hidden = false;
      settingsPopover.hidden = false;
      return;
    }
    otherPopover.hidden = true;
    document.body.appendChild(popover);
    const anchor = e.currentTarget.getBoundingClientRect();
    popover.style.position = 'fixed';
    popover.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - 316))}px`;
    popover.style.bottom = `${Math.max(8, window.innerHeight - anchor.top + 8)}px`;
    popover.hidden = !popover.hidden;
  };
  settingsBtn.addEventListener('click', togglePopover(accountPopover, settingsPopover));
  accountBtn.addEventListener('click', togglePopover(accountPopover, settingsPopover));
  document.getElementById('ai-account-menu-open')?.addEventListener('click', togglePopover(accountPopover, settingsPopover));
  document.getElementById('ai-settings-btn')?.addEventListener('click', togglePopover(accountPopover, settingsPopover));
  document.addEventListener('click', (e) => {
    if (!accountPopover.contains(settingsPopover) && !settingsPopover.hidden && !settingsPopover.contains(e.target) && !settingsBtn.contains(e.target)) {
      settingsPopover.hidden = true;
    }
    if (!accountPopover.hidden && !accountPopover.contains(e.target) && !accountBtn.contains(e.target)) {
      accountPopover.hidden = true;
      if (accountPopover.contains(settingsPopover)) settingsPopover.hidden = false;
    }
  });
}
