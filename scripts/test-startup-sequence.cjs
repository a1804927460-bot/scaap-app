const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/js/app.js', 'utf8');

(async () => {
  for (const language of ['zh', 'ko', 'en']) {
    const calls = [];
    const frames = [];
    const timers = [];
    const dataset = { startupPending: 'true', language };
    const ctx = {
      URLSearchParams, console, AppState: {},
      document: { documentElement: { dataset }, body: { classList: { toggle() {} } }, addEventListener() {} },
      window: { location: { search: `?language=${language}` }, messsAPI: {
        getInitialState: async () => ({ language, files: [], boardItems: [] }),
        setSidebarCollapsed() {}, readyForInteraction: () => calls.push('ready')
      } },
      normalizeAppLanguage: value => value,
      applyLanguageChoice: value => calls.push(`language:${value}`),
      initStartScreen: fn => { calls.push('workspace'); fn(); },
      requestAnimationFrame: fn => frames.push(fn),
      setTimeout: fn => timers.push(fn),
      currentFileListScope: () => [],
    };
    for (const name of ['beginRefreshRateSampling', 'initCanvasWorkspace', 'renderFileList', 'renderFolderList', 'renderBoard', 'renderTopStats', 'setSidebarCollapsed', 'initFolders', 'initSidebar', 'initContextMenu', 'initDocumentEditor', 'initDetailPanel', 'initPreviewCanvas', 'initBoardCanvas', 'initPanelResize', 'initPanelLayout', 'initStatsDetail', 'initAiAssistant', 'initFullscreenOverlay', 'initTitlebar', 'initTheme', 'initTextSizeSettings', 'initUpdater', 'initActivation']) {
      ctx[name] = () => calls.push(name);
    }
    vm.createContext(ctx);
    vm.runInContext(source, ctx);
    await ctx.startMainApp();
    assert.deepEqual(calls.filter(value => value.startsWith('language:')), [`language:${language}`]);
    assert.ok(calls.indexOf(`language:${language}`) < calls.indexOf('workspace'));
    assert.equal(calls.includes('renderBoard'), false);
    assert.equal(calls.includes('initUpdater'), false);
    assert.equal(dataset.startupPending, undefined);
    frames.shift()();
    assert.equal(calls.includes('ready'), true);
    timers.shift()();
    assert.equal(calls.includes('initUpdater'), true);
  }
  const workspace = fs.readFileSync('src/js/canvas-workspace.js', 'utf8').split('async function initCanvasWorkspace(initial)')[1];
  assert.ok(workspace.indexOf('showCanvasLibrary();') < workspace.indexOf('await window.messsAPI.getAiMediaConfig()'));
  const main = fs.readFileSync('main.js', 'utf8');
  const handler = main.split("ipcMain.handle('app:getInitialState', async () => {")[1].split("ipcMain.handle('settings:setTheme'")[0];
  assert.equal(handler.includes('pruneMissingFiles()'), false);
  console.log('Startup: persisted languages, local workspace before config, deferred work and no synchronous pruning passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
