'use strict';
/* Custom title bar: window controls and the top-level section switcher. */

function initTitlebar() {
  initWindowControls();
  initAppSurfaceNavigation();
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

function setAppSurfaceNavigationActive(surface = '') {
  document.querySelectorAll('[data-app-surface]').forEach((button) => {
    const active = button.dataset.appSurface === surface;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function closeAppSurface(surface = '', options = {}) {
  const assistant = document.getElementById('ai-assistant-panel');
  const activeSurface = surface
    || document.querySelector('.app-surface-dialog.is-active')?.id.replace('section-', '')
    || (assistant?.classList.contains('is-fullscreen') ? 'agent' : '');
  if (activeSurface === 'agent') {
    if (typeof setAssistantFullscreen === 'function') setAssistantFullscreen(false);
  } else if (activeSurface) {
    const section = document.getElementById(`section-${activeSurface}`);
    if (section) {
      section.classList.remove('is-active');
      section.setAttribute('aria-hidden', 'true');
    }
  }
  document.body.classList.remove('is-app-surface-open');
  setAppSurfaceNavigationActive('');
  if (options.restoreFocus !== false && activeSurface) {
    document.querySelector(`[data-app-surface="${activeSurface}"]`)?.focus();
  }
}

function openAppSurface(surface) {
  if (surface !== 'agent') return;
  const assistant = document.getElementById('ai-assistant-panel');
  document.querySelectorAll('.app-surface-dialog.is-active').forEach((section) => {
    section.classList.remove('is-active');
    section.setAttribute('aria-hidden', 'true');
  });
  if (surface !== 'agent' && assistant && typeof setAssistantFullscreen === 'function') {
    setAssistantFullscreen(false);
  }
  if (typeof isBoardFullscreen === 'function' && isBoardFullscreen() && typeof exitBoardFullscreen === 'function') {
    exitBoardFullscreen();
  }
  if (surface === 'agent') {
    const fileDetail = document.getElementById('file-detail-panel');
    if (fileDetail && !fileDetail.hidden && typeof hideFileDetailPanel === 'function') hideFileDetailPanel();
    if (assistant && typeof setAssistantFullscreen === 'function') setAssistantFullscreen(true);
  } else {
    const section = document.getElementById(`section-${surface}`);
    if (!section) return;
    section.classList.add('is-active');
    section.setAttribute('aria-hidden', 'false');
    section.dispatchEvent(new CustomEvent('messs:surface-opened', { bubbles: true, detail: { surface } }));
    requestAnimationFrame(() => section.querySelector('[data-app-surface-panel]')?.focus?.());
  }
  document.body.classList.add('is-app-surface-open');
  setAppSurfaceNavigationActive(surface);
}

function initAppSurfaceNavigation() {
  document.querySelectorAll('[data-close-app-surface]').forEach((button) => {
    button.addEventListener('click', () => closeAppSurface(button.dataset.closeAppSurface));
  });
  document.querySelectorAll('.app-surface-dialog').forEach((section) => {
    section.addEventListener('click', (event) => {
      if (event.target === section) closeAppSurface(section.id.replace('section-', ''));
    });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const section = document.querySelector('.app-surface-dialog.is-active');
    if (!section) return;
    const nestedDialog = section.querySelector(
      '.app-surface-dialog.is-active'
    );
    if (!nestedDialog) closeAppSurface(section.id.replace('section-', ''));
  }, true);
}
