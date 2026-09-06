const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/js/app.js', r => r.fulfill({ body: '' }));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    await page.evaluate(() => {
      delete document.documentElement.dataset.startupPending;
      const usageOverlay = document.getElementById('canvas-usage-overlay');
      document.body.innerHTML = '<div id="canvas-library-grid" style="display:grid;grid-template-columns:240px 240px;padding:30px"></div>';
      document.body.append(usageOverlay);
      window.t = (en, zh) => zh;
      AppState.canvases = [{ id: 'c1', name: 'Canvas', projectId: null }];
      AppState.canvasProjects = [{ id: 'p1', name: 'Folder' }];
      CanvasWorkspace.libraryProjectId = null;
      CanvasWorkspace.libraryQuery = '';
      window.canvasPreviewEntries = () => [{ kind: 'image', name: 'Preview', src: 'assets/canvas-folder-brand-3d.png' }];
      window.opened = 0; window.saves = 0; window.failSave = false;
      window.switchCanvas = () => { window.opened++; };
      window.canvasWorkspaceSave = async () => { window.saves++; if (window.failSave) throw new Error('save failed'); };
      window.renderCanvasWorkspaceControls = () => renderCanvasLibrary();
      window.renderFileList = () => {};
      window.showToast = () => {};
      renderCanvasLibrary();
    });
    await page.evaluate(() => {
      window.usageRequests = [];
      window.activeCanvasId = () => 'other-canvas';
      window.messsAPI = { getCanvasCreditUsage: async id => { window.usageRequests.push(id); return { ok: true, canvasId: id }; } };
      window.renderCanvasUsageDetails = result => { window.renderedUsageId = result.canvasId; };
    });
    await page.locator('.canvas-library-card-menu-trigger').click();
    await page.locator('[data-canvas-action="usage"]').click();
    await page.waitForFunction(() => window.renderedUsageId === 'c1');
    assert.equal(await page.evaluate(() => window.opened), 0);
    assert.deepEqual(await page.evaluate(() => window.usageRequests), ['c1']);
    await page.locator('#canvas-usage-close').click();
    await page.waitForTimeout(200);
    await page.evaluate(() => openCanvasUsageDetails());
    assert.equal(await page.evaluate(() => window.renderedUsageId), 'other-canvas');
    await page.locator('#canvas-usage-close').click();
    await page.waitForTimeout(250);
    for (const [selector, name] of [['.canvas-library-folder-title', 'Renamed folder'], ['.canvas-library-card-title', 'Renamed canvas']]) {
      await page.locator(selector).dblclick();
      assert.equal(await page.evaluate(() => opened), 0);
      await page.locator(selector + ' input').fill(name);
      await page.locator(selector + ' input').press('Enter');
      await page.waitForFunction(({selector,name}) => document.querySelector(selector).textContent === name, {selector,name});
      await page.locator(selector).dblclick();
      await page.locator(selector + ' input').fill('Canceled');
      await page.locator(selector + ' input').press('Escape');
      assert.equal(await page.locator(selector).textContent(), name);
      await page.evaluate(() => { window.failSave = true; });
      await page.locator(selector).dblclick();
      await page.locator(selector + ' input').fill('Failed');
      await page.locator(selector + ' input').press('Tab');
      await page.waitForFunction(({selector,name}) => document.querySelector(selector).textContent === name, {selector,name});
      await page.evaluate(() => { window.failSave = false; });
    }
    assert.equal(await page.locator('.canvas-library-mosaic img').evaluate(el => el.draggable), false);
    await page.evaluate(async () => {
      window.detachedCalls = [];
      window.flushBoardViewportSave = () => {};
      window.messsAPI.openDetachedCanvas = async (id, point) => {
        window.detachedCalls.push({ id, point });
        return { ok: true };
      };
      const card = document.querySelector('.canvas-library-card');
      const end = async ({ outside = false, cancel = false, drop = false, zero = false } = {}) => {
        const dataTransfer = new DataTransfer();
        card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
        if (cancel) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        if (drop) window.dispatchEvent(new DragEvent('drop', { dataTransfer }));
        card.dispatchEvent(new DragEvent('dragend', {
          bubbles: true, dataTransfer,
          screenX: zero ? 0 : window.screenX + (outside ? window.outerWidth + 100 : 100),
          screenY: zero ? 0 : window.screenY + 100
        }));
        await new Promise(resolve => setTimeout(resolve, 0));
      };
      await end();
      await end({ outside: true, cancel: true });
      await end({ outside: true, drop: true });
      await end({ zero: true });
      if (window.detachedCalls.length) throw new Error('Canceled/internal drops must not detach');
      await end({ outside: true });
      if (window.detachedCalls.length !== 1 || window.detachedCalls[0].id !== 'c1') throw new Error('Detach dragged canvas, not active canvas');
      if (CanvasWorkspace.draggingCanvasId !== null || card.classList.contains('is-dragging')) throw new Error('Drag state leaked');
      CanvasWorkspace.detachInFlight = true;
      await end({ outside: true });
      CanvasWorkspace.detachInFlight = false;
      if (window.detachedCalls.length !== 1) throw new Error('Duplicate detach while busy');
    });
    await page.evaluate(() => {
      const card = document.querySelector('.canvas-library-card');
      window.dragImageIsCard = false;
      card.addEventListener('dragstart', event => {
        const original = event.dataTransfer.setDragImage.bind(event.dataTransfer);
        event.dataTransfer.setDragImage = (element, x, y) => { window.dragImageIsCard = element === card; original(element, x, y); };
      }, { capture: true });
    });
    const thumb = await page.locator('.canvas-library-mosaic img').boundingBox();
    const folder = await page.locator('.canvas-library-folder-card').boundingBox();
    await page.mouse.move(thumb.x + 15, thumb.y + 15);
    await page.mouse.down();
    await page.mouse.move(thumb.x + 40, thumb.y + 25, { steps: 5 });
    await page.mouse.move(folder.x + 40, folder.y + 50, { steps: 10 });
    await page.mouse.move(folder.x + 45, folder.y + 55);
    assert.equal(await page.evaluate(() => dragImageIsCard), true);
    assert.equal(await page.locator('.canvas-library-folder-card').evaluate(el => el.classList.contains('is-drop-target')), true);
    fs.mkdirSync('test-artifacts/library-interactions', { recursive: true });
    await page.screenshot({ path: 'test-artifacts/library-interactions/folder-drop.png' });
    await page.mouse.up();
    await page.waitForFunction(() => AppState.canvases[0].projectId === 'p1');
    assert.equal(await page.evaluate(() => window.detachedCalls.length), 1, 'Folder move must not detach');
    console.log('Passed: inline rename, cancel, save rollback, whole-card drag from thumbnail, folder highlight and move.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
