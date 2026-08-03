'use strict';
/* App bootstrap: load initial state from main process, wire up all modules. */

function bootstrapMainApp(initial) {
  beginRefreshRateSampling();
  AppState.files = initial.files;
  AppState.folders = initial.folders || [];
  AppState.defaultFolderName = initial.defaultFolderName || 'Library';
  AppState.boardItems = initial.boardItems || [];
  AppState.language = initial.language === 'zh' ? 'zh' : 'en';
  initCanvasWorkspace(initial);
  AppState.usage = initial.usage;
  AppState.achievements = initial.achievements;
  AppState.viewMode = initial.viewMode || 'grid';

  renderFileList(currentFileListScope());
  renderFolderList();
  renderBoard();
  renderTopStats();
  setSidebarCollapsed(!!initial.sidebarCollapsed);

  initFolders();
  initSidebar();
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
}

document.addEventListener('DOMContentLoaded', async () => {
  initTitlebar();
  const initial = await window.messsAPI.getInitialState();
  initTheme(initial.theme);
  initUpdater();
  await initActivation(initial.activation);
  initStartScreen(() => bootstrapMainApp(initial));
});
