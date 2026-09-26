const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/js/app.js', r => r.fulfill({ body: '' }));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    await page.evaluate(() => {
      delete document.documentElement.dataset.startupPending;
      document.body.innerHTML = '<div class="board-canvas" data-board-renderer="leafer" style="position:relative;margin:30px;transform:none"><div class="board-item-content" style="width:280px;height:240px"></div></div>';
      window.requestBoardModelPreview = async () => null;
      renderBoardItemContent(document.querySelector('.board-item-content'), { id: 'model', name: 'Stage lighting fixture with a very long filename.glb', ext: '.glb' }, { id: 'item' });
    });
    fs.mkdirSync('test-artifacts/model-label', { recursive: true });
    for (const theme of ['dark', 'light']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      for (const width of [140, 280]) {
        await page.locator('.board-item-content').evaluate((el, width) => { el.style.width = width + 'px'; }, width);
        assert.equal(await page.locator('.board-model-thumbnail').evaluate(el => getComputedStyle(el).opacity), '1');
        assert.equal(await page.locator('.board-model-thumbnail-mark strong').textContent(), '3D');
        assert.equal(await page.locator('.board-model-caption b').textContent(), 'GLB');
        const boxes = await page.locator('.board-model-caption').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
        assert.ok(boxes.scroll <= boxes.width);
      }
      await page.waitForTimeout(400);
      await page.screenshot({ path: `test-artifacts/model-label/${theme}.png` });
    }
    assert.equal(await page.locator('canvas').count(), 0, 'Label must not allocate a WebGL renderer');
    console.log('Model labels passed: Leafer visibility, 3D/format identification, long names, both themes, bounded UI.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
