'use strict';
/* Custom title bar: window controls and the top-level section switcher. */

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
  closeBtn.title = isDetachedCanvasWindow()
    ? t('Close window', '关闭窗口')
    : t('Run in background', '在后台运行');
  closeBtn.setAttribute('aria-label', closeBtn.title);
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
  const closeBtn = document.getElementById('win-close-btn');
  if (closeBtn) {
    closeBtn.title = isDetachedCanvasWindow()
      ? t('Close window', '关闭窗口')
      : t('Run in background', '在后台运行');
    closeBtn.setAttribute('aria-label', closeBtn.title);
  }
}

function initSectionTabs() {
  document.querySelectorAll('.section-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const section = tab.dataset.section;
      const assistant = document.getElementById('ai-assistant-panel');
      const isAssistantSection = section === 'assistant';
      if (assistant && assistant.classList.contains('is-fullscreen') && !isAssistantSection && typeof setAssistantFullscreen === 'function') {
        setAssistantFullscreen(false);
      }
      if (typeof isBoardFullscreen === 'function' && isBoardFullscreen() && typeof exitBoardFullscreen === 'function') {
        exitBoardFullscreen();
      }
      if (isAssistantSection) {
        const fileDetail = document.getElementById('file-detail-panel');
        if (fileDetail && !fileDetail.hidden && typeof hideFileDetailPanel === 'function') hideFileDetailPanel();
        if (assistant && typeof setAssistantFullscreen === 'function') setAssistantFullscreen(true);
      }
      document.querySelectorAll('.section-tab').forEach((t) => {
        const isActive = t === tab;
        t.classList.toggle('is-active', isActive);
        t.setAttribute('aria-selected', String(isActive));
      });
      document.querySelectorAll('.app-section').forEach((el) => {
        el.classList.toggle('is-active', el.id === 'section-' + (isAssistantSection ? 'messs' : section));
      });
    });
  });
}
