const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    await page.route('**/js/app.js', route => route.fulfill({ body: '' }));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    await page.evaluate(() => {
      delete document.documentElement.dataset.startupPending;
      document.body.innerHTML = '<canvas id="stable-scene"></canvas><div id="board-canvas" class="board-canvas" data-board-renderer="leafer"><div class="board-item is-selected" style="left:40px;top:40px;width:60px;height:60px"><div class="board-item-content"><div class="board-video-thumbnail"><img id="live-poster"></div></div><div class="board-resize-handle corner-nw"></div></div></div>';
      const canvas = document.getElementById('stable-scene');
      const layer = window.MesssBoardLeaferLayer;
      layer.init({ canvas, width: 1100, height: 800, pixelRatio: 1 });
      const makeImage = color => {
        const c = document.createElement('canvas'); c.width = c.height = 60;
        const ctx = c.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, 60, 60);
        return c.toDataURL();
      };
      window.red = makeImage('#ff0000'); window.blue = makeImage('#0000ff');
      document.getElementById('live-poster').src = red;
      window.items = Array.from({ length: 5000 }, (_, i) => ({ id: `frame-${i}`, fileId: 'f', x: i ? 2000 + i % 100 * 80 : 40, y: i ? 2000 + Math.floor(i / 100) * 80 : 40, width: 60, height: 60 }));
      window.sceneOptions = { getFile: () => ({ kind: 'image' }), getSource: () => red };
      layer.sync({ items, ...sceneOptions });
      Object.assign(Board, { leaferLayer: layer, panX: 0, panY: 0, zoom: 1, isWheelZooming: true });
      // Isolate persistence/virtualization; exercise the actual camera commit path.
      scheduleBoardReconcile = scheduleBoardViewportSave = scheduleBoardFullImagePrewarm = scheduleMountedImageQuality = updateInfiniteGrid = () => {};
      window.sample = (x, y) => Array.from(canvas.getContext('2d').getImageData(x, y, 1, 1).data);
    });
    await page.waitForFunction(() => sample(70, 70)[0] === 255);
    const result = await page.evaluate(async () => {
      const times = [];
      const sizes = [];
      for (let i = 0; i < 90; i++) {
        await new Promise(requestAnimationFrame);
        Board.zoom = 0.5 + (i % 30) / 20;
        Board.panX = 25 + i * 2.2; Board.panY = 35 + i * 0.2;
        const start = performance.now();
        applyBoardTransformNow();
        times.push(performance.now() - start);
        const pixel = sample(Math.round(Board.panX + 70 * Board.zoom), Math.round(Board.panY + 70 * Board.zoom));
        if (pixel[0] !== 255 || pixel[3] !== 255) throw new Error(`Camera pixel lag at frame ${i}: ${pixel}`);
        const left = Board.panX + 40 * Board.zoom;
        const right = Board.panX + 100 * Board.zoom;
        const middleY = Math.round(Board.panY + 70 * Board.zoom);
        if (sample(Math.ceil(left + 2), middleY)[3] !== 255 || sample(Math.floor(left - 2), middleY)[3] !== 0 || sample(Math.ceil(right + 2), middleY)[3] !== 0) throw new Error(`Texture edges lagged camera at frame ${i}`);
        if (getComputedStyle(document.getElementById('live-poster')).visibility !== 'visible') throw new Error('Video poster hidden during motion');
        sizes.push(document.getElementById('stable-scene').width);
      }
      Board.isWheelZooming = false; applyBoardTransformNow();
      Board.isWheelZooming = true; applyBoardTransformNow();
      await new Promise(resolve => setTimeout(resolve, 600));
      if (!document.getElementById('board-canvas').classList.contains('is-transforming')) throw new Error('Old settle timer interrupted a new gesture');
      Board.isWheelZooming = false; Board.panX = Board.panY = 0; Board.zoom = 1; applyBoardTransformNow();
      return { frames: times.length, maxMs: Math.max(...times), medianMs: times.sort((a,b) => a-b)[45], sizes: [...new Set(sizes)] };
    });
    assert.deepEqual(result.sizes, [1100]);
    const blue = Buffer.from((await page.evaluate(() => blue)).split(',')[1], 'base64');
    let release;
    const delayed = new Promise(resolve => { release = resolve; });
    await page.route('https://texture.supabase.co/slow.png', async route => {
      await delayed;
      await route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: blue });
    });
    await page.evaluate(() => MesssBoardLeaferLayer.updateItem(items[0], { ...sceneOptions, getSource: () => 'https://texture.supabase.co/slow.png' }));
    for (let i = 0; i < 12; i++) {
      assert.deepEqual(await page.evaluate(() => sample(70, 70)), [255, 0, 0, 255], 'Old texture must remain until replacement is ready');
      await page.waitForTimeout(16);
    }
    release();
    await page.waitForFunction(() => sample(70, 70)[2] === 255);
    await page.route('https://texture.supabase.co/broken.png', route => route.abort());
    await page.evaluate(() => MesssBoardLeaferLayer.updateItem(items[0], { ...sceneOptions, getSource: () => 'https://texture.supabase.co/broken.png' }));
    await page.waitForTimeout(150);
    assert.deepEqual(await page.evaluate(() => sample(70, 70)), [0, 0, 255, 255], 'Failed replacement must preserve visible texture');
    let releaseDeleted;
    const deletedDelay = new Promise(resolve => { releaseDeleted = resolve; });
    await page.route('https://texture.supabase.co/deleted.png', async route => {
      await deletedDelay;
      await route.fulfill({ contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: blue });
    });
    await page.evaluate(() => {
      const manager = LeaferUI.ImageManager;
      const originalGet = manager.get;
      window.textureLease = null;
      manager.get = function(config, ...args) {
        const image = originalGet.call(this, config, ...args);
        if (config.url.endsWith('/deleted.png')) window.textureLease = image;
        return image;
      };
      MesssBoardLeaferLayer.updateItem(items[0], { ...sceneOptions, getSource: () => 'https://texture.supabase.co/deleted.png' });
      MesssBoardLeaferLayer.removeItems([items[0].id]);
      if (!textureLease || textureLease.use !== 0) throw new Error('Deleted item retained a texture lease');
    });
    releaseDeleted();
    await page.waitForTimeout(120);
    assert.equal(await page.evaluate(() => sample(70, 70)[3]), 0, 'Deleted item must not reappear when its texture completes');
    await page.evaluate(() => MesssBoardLeaferLayer.updateItem(items[0], sceneOptions));
    await page.waitForFunction(() => sample(70, 70)[0] === 255);
    fs.mkdirSync('test-artifacts/jitter', { recursive: true });
    await page.screenshot({ path: 'test-artifacts/jitter/stable-desktop.png' });
    await page.setViewportSize({ width: 520, height: 700 });
    await page.screenshot({ path: 'test-artifacts/jitter/stable-compact.png' });
    await page.evaluate(() => MesssBoardLeaferLayer.destroy());
    console.log('Canvas frame stability passed:', result);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
