const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
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
        const source = document.querySelector(`[data-library-key="${sourceKey}"]`);
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
    const order = () => page.locator('#canvas-library-grid > article').evaluateAll(nodes => nodes.map(node => node.dataset.libraryKey));
    await page.evaluate(() => dropCard('canvas:c', 'canvas:a'));
    assert.deepEqual(await order(), ['folder:x', 'folder:y', 'canvas:c', 'canvas:a', 'canvas:b']);
    assert.equal(await page.evaluate(() => indicator), 'before');
    await page.evaluate(() => dropCard('folder:y', 'canvas:a', .9));
    assert.deepEqual(await order(), ['folder:x', 'canvas:c', 'canvas:a', 'folder:y', 'canvas:b']);
    await page.evaluate(() => {
      const data = JSON.parse(saved);
      AppState.canvases = data.canvases;
      AppState.canvasProjects = data.projects.map(normalizeCanvasProject);
      renderCanvasLibrary();
    });
    assert.deepEqual(await order(), ['folder:x', 'canvas:c', 'canvas:a', 'folder:y', 'canvas:b']);
    await page.evaluate(async () => { window.failSave = true; await dropCard('folder:x', 'canvas:b', .9); window.failSave = false; });
    assert.deepEqual(await order(), ['folder:x', 'canvas:c', 'canvas:a', 'folder:y', 'canvas:b']);
    await page.evaluate(() => dropCard('canvas:a', 'folder:x', .5));
    assert.equal(await page.evaluate(() => moves[0][1]), 'x');
    assert.equal(await page.evaluate(() => moves.length), 1);
    await page.evaluate(async () => {
      CanvasWorkspace.libraryQuery = 'a';
      await reorderCanvasLibrary('canvas:b', 'canvas:c', false);
      CanvasWorkspace.libraryQuery = '';
      renderCanvasLibrary();
    });
    assert.deepEqual(await order(), ['folder:x', 'canvas:b', 'canvas:c', 'canvas:a', 'folder:y']);
    await page.evaluate(() => {
      AppState.canvases.find(c => c.id === 'a').pinned = true;
      renderCanvasLibrary();
    });
    await page.evaluate(() => dropCard('folder:x', 'canvas:a'));
    assert.deepEqual(await order(), ['canvas:b','canvas:c','folder:x','canvas:a','folder:y']);
    assert.equal(await page.locator('[data-library-drop]').count(), 0);
    const from = await page.locator('[data-library-key="folder:y"]').boundingBox();
    const to = await page.locator('[data-library-key="folder:x"]').boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(420);
    assert.equal(await page.locator('#canvas-library-grid .is-longpress-dragging').count(),1);
    await page.mouse.move(from.x + from.width / 2 + 15, from.y + from.height / 2, { steps: 5 });
    await page.mouse.move(to.x + 10, to.y + to.height / 2, { steps: 10 });
    await page.mouse.move(to.x + 11, to.y + to.height / 2);
    const longPressIndicators = await page.locator('#canvas-library-grid > article').evaluateAll(nodes => nodes.map(node => ({ key: node.dataset.libraryKey, drop: node.dataset.libraryDrop || null, translate: node.style.translate || null })));
    assert.equal(await page.locator('[data-library-key="folder:x"]').getAttribute('data-library-drop'), 'before', JSON.stringify(longPressIndicators));
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      await page.screenshot({ path: `test-artifacts/library-reorder/${theme}.png` });
    }
    await page.mouse.up();
    await page.waitForFunction(() => !CanvasWorkspace.libraryOrderSaving);
    assert.deepEqual(await order(), ['canvas:b','canvas:c','folder:y','folder:x','canvas:a']);
    assert.equal(await page.evaluate(()=>moves.length),1,'Long press must not move into a folder');
    console.log('Canvas/folder reorder, restore, rollback, folder move, hidden entries and pin priority passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
