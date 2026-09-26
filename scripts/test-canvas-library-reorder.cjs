const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/js/app.js', route => route.fulfill({ body: '' }));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    await page.evaluate(() => {
      delete document.documentElement.dataset.startupPending;
      document.body.innerHTML = '<div id="canvas-library-grid" style="display:grid;grid-template-columns:240px 240px;gap:16px;padding:30px"></div>';
      window.t = en => en;
      AppState.canvases = ['a', 'b', 'c'].map(id => ({ id, name: id, projectId: null }));
      AppState.canvasProjects = ['x', 'y'].map(id => ({ id, name: id }));
      CanvasWorkspace.libraryProjectId = null;
      CanvasWorkspace.libraryQuery = '';
      window.canvasPreviewEntries = () => [];
      window.showToast = () => {};
      window.canvasWorkspaceSave = async () => {
        if (window.failSave) throw new Error('failed');
        window.saved = JSON.stringify({ canvases: AppState.canvases, projects: AppState.canvasProjects });
      };
      window.moves = [];
      window.moveCanvasToProject = async (...args) => { window.moves.push(args); };
      window.dropCard = async (sourceKey, targetKey, fraction = .1) => {
        const source = document.querySelector(`[data-library-key="${sourceKey}"]`)
          || document.querySelector(`[data-canvas-id="${sourceKey.replace('canvas:', '')}"]`);
        const target = document.querySelector(`[data-library-key="${targetKey}"]`);
        const dataTransfer = new DataTransfer();
        source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
        const rect = target.getBoundingClientRect();
        const options = { bubbles: true, cancelable: true, dataTransfer, clientX: rect.left + rect.width * fraction, clientY: rect.top + rect.height / 2 };
        target.dispatchEvent(new DragEvent('dragover', options));
        window.indicator = target.dataset.libraryDrop;
        target.dispatchEvent(new DragEvent('drop', options));
        source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
        await new Promise(resolve => setTimeout(resolve, 0));
      };
      renderCanvasLibrary();
    });
    const order = () => page.locator('#canvas-library-grid > article').evaluateAll(nodes => nodes.map(node => node.dataset.libraryKey || `canvas:${node.dataset.canvasId}`));
    assert.deepEqual(await order(), ['folder:x', 'folder:y', 'canvas:a', 'canvas:b', 'canvas:c']);
    assert.equal(await page.locator('.canvas-library-folder-card[draggable="true"]').count(), 0);
    await page.evaluate(() => dropCard('canvas:a', 'folder:x', .5));
    assert.equal(await page.evaluate(() => moves[0][1]), 'x');
    assert.equal(await page.evaluate(() => moves.length), 1);
    await page.evaluate(() => {
      AppState.canvases.find(c => c.id === 'b').lastOpenedAt = '2026-09-27T10:00:00.000Z';
      renderCanvasLibrary();
    });
    assert.deepEqual(await order(), ['folder:x', 'folder:y', 'canvas:b', 'canvas:a', 'canvas:c']);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      await page.screenshot({ path: `test-artifacts/library-reorder/${theme}.png` });
    }
    console.log('Folders stay first, canvases follow open history, and folder drops remain available');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
