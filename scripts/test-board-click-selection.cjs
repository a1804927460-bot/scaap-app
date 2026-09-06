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
      document.body.innerHTML = '<div id="board-viewport" style="position:fixed;inset:40px;background:#121415"></div>';
      Board.panX = Board.panY = 0; Board.zoom = 1;
      AppState.boardItems = [{ id: 'test', x:180,y:180,width:40,height:40, selected: true }];
      Board.selectedIds = new Set(['test']);
      Board.itemsById = new Map([['test', AppState.boardItems[0]]]);
      Board.spatialIndex = { query: () => new Set(['test']) };
      boardPartitionAtPoint = () => null;
      setActiveBoardPartition = () => {};
      syncBoardSelectionClasses = () => { Board.selectedIds = new Set(AppState.boardItems.filter(item => item.selected).map(item => item.id)); };
      document.getElementById('board-viewport').addEventListener('mousedown', startBoxSelect);
    });
    await page.mouse.move(200, 200);
    await page.mouse.down();
    assert.equal(await page.locator('.board-select-box').isVisible(), false, 'Mouse down must not show an origin dot');
    await page.mouse.move(201, 201);
    await page.waitForTimeout(40);
    assert.equal(await page.locator('.board-select-box').isVisible(), false, 'Pointer jitter must not show a dot');
    await page.mouse.up();
    assert.equal(await page.locator('.board-select-box').count(), 0);
    assert.equal(await page.evaluate(() => Board.selectedIds.size), 0, 'Click still clears selection');
    await page.mouse.move(200, 200);
    await page.mouse.down();
    await page.mouse.move(300, 320);
    await page.waitForTimeout(40);
    const box = await page.locator('.board-select-box').boundingBox();
    assert.deepEqual({ x: box.x, y: box.y, width: box.width, height: box.height }, { x: 200, y: 200, width: 100, height: 120 });
    await page.mouse.up();
    assert.equal(await page.evaluate(() => Board.selectedIds.has('test')), true, 'Drag selection still works');
    for (const event of ['blur', 'pointercancel']) {
      await page.mouse.down();
      await page.mouse.move(340, 350);
      await page.evaluate(event => (event === 'blur' ? window : document).dispatchEvent(new Event(event)), event);
      await page.waitForTimeout(40);
      assert.equal(await page.locator('.board-select-box').count(), 0);
      assert.equal(await page.evaluate(() => Board.cancelBoxSelect), null);
      await page.mouse.up();
    }
    console.log('Canvas click: no origin dot, jitter threshold, drag selection and canceled gesture cleanup passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
