'use strict';
/* App bootstrap: load initial state from main process, wire up all modules. */

function bootstrapMainApp(initial) {
  beginRefreshRateSampling();
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
  renderBoard();
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
  initCanvasNodeMode();
  initPanelResize();
  initPanelLayout();
  initStatsDetail();
  initAiAssistant();
  initFullscreenOverlay();
  if (typeof restoreBoardButlerTasks === 'function') restoreBoardButlerTasks(initial.butlerTasks);
}

document.addEventListener('DOMContentLoaded', async () => {
  initTitlebar();
  const startupLanguage = normalizeAppLanguage(document.documentElement.dataset.language || 'ko');
  AppState.language = startupLanguage;
  applyLanguageChoice(startupLanguage, { rerender: false });
  const initial = await window.messsAPI.getInitialState();
  AppState.language = normalizeAppLanguage(initial.language);
  applyLanguageChoice(AppState.language, { rerender: false });
  initTheme(initial.theme);
  initTextSizeSettings(initial.textSize);
  initUpdater();
  void initActivation(initial.activation);
  initStartScreen(() => bootstrapMainApp(initial), { enterImmediately: true });
  window.messsAPI.readyForInteraction();
});
