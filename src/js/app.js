'use strict';
/* App bootstrap: load initial state from main process, wire up all modules. */

function bootstrapMainApp(initial) {
  AppState.files = initial.files;
  AppState.folders = initial.folders || [];
  AppState.defaultFolderName = initial.defaultFolderName || 'Library';
  AppState.boardItems = initial.boardItems || [];
  AppState.language = normalizeAppLanguage(initial.language);
  initCanvasWorkspace(initial);
  AppState.usage = initial.usage;
  AppState.achievements = initial.achievements;
  AppState.viewMode = initial.viewMode || 'grid';

  renderFileList(currentFileListScope());
  renderFolderList();
  if (detachedCanvasIdForStartup()) renderBoard();
  renderTopStats();
  setSidebarCollapsed(false);
  window.messsAPI.setSidebarCollapsed(false);

  initFolders();
  initSidebar(initial);
  initContextMenu();
  initDocumentEditor();
  initDetailPanel();
  initPreviewCanvas();
  initBoardCanvas();
  initPanelResize();
  initPanelLayout();
  initStatsDetail();
  initAiAssistant();
  initFullscreenOverlay();
  if (typeof restoreBoardButlerTasks === 'function') restoreBoardButlerTasks(initial.butlerTasks);
  if (window.messsAPI && typeof window.messsAPI.onFilesChanged === 'function') {
    window.messsAPI.onFilesChanged(applyRemoteFileChange);
  }
}

function applyRemoteFileChange(payload = {}) {
  const file = payload && payload.file;
  if (!file || !file.id) return;
  const index = AppState.files.findIndex((entry) => entry.id === file.id);
  const merged = index === -1 ? file : { ...AppState.files[index], ...file };
  if (index === -1) AppState.files.push(merged);
  else AppState.files[index] = merged;
  if (typeof Board !== 'undefined' && Board.filesById instanceof Map) {
    Board.filesById.set(file.id, merged);
  }
  if (typeof renderFileList === 'function' && typeof currentFileListScope === 'function') {
    renderFileList(currentFileListScope());
  }
  if (typeof renderFolderGridIfActive === 'function') renderFolderGridIfActive();
}

function detachedCanvasIdForStartup() {
  return String(new URLSearchParams(window.location.search).get('detachedCanvas') || '').trim();
}

async function startMainApp() {
  const detachedCanvasId = detachedCanvasIdForStartup();
  document.body.classList.toggle('is-detached-canvas-window', !!detachedCanvasId);
  initTitlebar();
  const initial = await window.messsAPI.getInitialState();
  AppState.language = normalizeAppLanguage(initial.language);
  applyLanguageChoice(AppState.language, { rerender: false });
  initTheme(initial.theme);
  initTextSizeSettings(initial.textSize);
  void initActivation(initial.activation);
  initStartScreen(() => bootstrapMainApp(initial), { enterImmediately: true });
  delete document.documentElement.dataset.startupPending;
  requestAnimationFrame(() => {
    window.messsAPI.readyForInteraction();
    setTimeout(() => {
      initUpdater();
      beginRefreshRateSampling();
    }, 250);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  startMainApp().catch((error) => {
    console.error('Workspace startup failed:', error);
    const language = document.documentElement.dataset.language;
    const messages = language === 'zh'
      ? ['工作区加载失败', '重新加载']
      : language === 'ko' ? ['작업 공간을 불러오지 못했습니다', '다시 로드'] : ['Workspace could not load', 'Reload'];
    const panel = document.createElement('main');
    panel.className = 'startup-error';
    const title = document.createElement('h1');
    title.textContent = messages[0];
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = messages[1];
    retry.addEventListener('click', () => window.location.reload());
    panel.append(title, retry);
    document.body.replaceChildren(panel);
    delete document.documentElement.dataset.startupPending;
    window.messsAPI.readyForInteraction();
  });
});
