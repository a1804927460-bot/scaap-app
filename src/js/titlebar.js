'use strict';
/* Custom title bar: window controls (minimize/maximize/close) and the
   Messs / Chat / Market / 创意工坊 section switcher. Sections other than
   "messs" (the actual app) are just placeholders for now. */

function initTitlebar() {
  initWindowControls();
  initSectionTabs();
}

function initWindowControls() {
  const minBtn = document.getElementById('win-minimize-btn');
  const maxBtn = document.getElementById('win-maximize-btn');
  const closeBtn = document.getElementById('win-close-btn');
  const maxIcon = document.getElementById('win-maximize-icon');

  minBtn.addEventListener('click', () => window.messsAPI.minimizeWindow());
  closeBtn.addEventListener('click', () => window.messsAPI.closeWindow());
  maxBtn.addEventListener('click', async () => {
    const isMaximized = await window.messsAPI.toggleMaximizeWindow();
    setMaximizeIcon(isMaximized);
  });

  window.messsAPI.isWindowMaximized().then(setMaximizeIcon);
  window.messsAPI.onWindowMaximizedChanged(setMaximizeIcon);

  function setMaximizeIcon(isMaximized) {
    document.documentElement.dataset.windowMaximized = String(isMaximized);
    maxBtn.title = isMaximized ? t('Restore', '还原') : t('Maximize', '最大化');
    maxBtn.setAttribute('aria-label', maxBtn.title);
    maxIcon.innerHTML = isMaximized
      ? '<rect x="1.5" y="3.5" width="7" height="7"/><polyline points="3.5,3.5 3.5,1.5 10.5,1.5 10.5,8.5 8.5,8.5" fill="none"/>'
      : '<rect x="1.5" y="1.5" width="9" height="9"/>';
  }
}

function refreshTitlebarLanguage() {
  const maxBtn = document.getElementById('win-maximize-btn');
  if (!maxBtn) return;
  const isMaximized = document.documentElement.dataset.windowMaximized === 'true';
  maxBtn.title = isMaximized ? t('Restore', '还原') : t('Maximize', '最大化');
  maxBtn.setAttribute('aria-label', maxBtn.title);
}

function initSectionTabs() {
  document.querySelectorAll('.section-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const section = tab.dataset.section;
      document.querySelectorAll('.section-tab').forEach((t) => {
        const isActive = t === tab;
        t.classList.toggle('is-active', isActive);
        t.setAttribute('aria-selected', String(isActive));
      });
      document.querySelectorAll('.app-section').forEach((el) => {
        el.classList.toggle('is-active', el.id === 'section-' + section);
      });
    });
  });
}
