const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    await page.route('**/js/app.js', route => route.fulfill({ body: '' }));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    await page.evaluate(async () => {
      document.body.innerHTML = '<canvas id="detail"></canvas>';
      const source = document.createElement('canvas'); source.width = 600; source.height = 1800;
      const ctx = source.getContext('2d');
      for (let y = 0; y < 1800; y++) for (let x = 0; x < 600; x++) {
        ctx.fillStyle = (Math.floor(x / 2) + Math.floor(y / 2)) % 2 ? '#fff' : '#000';
        ctx.fillRect(x, y, 1, 1);
      }
      window.detailSource = source.toDataURL();
      window.detailItem = { id: 'detail', fileId: 'image', x: 0, y: 0, width: 200, height: 600 };
      const layer = MesssBoardLeaferLayer;
      layer.init({ canvas: document.getElementById('detail'), width: 1100, height: 800, pixelRatio: 1 });
      layer.sync({ items: [detailItem], getFile: () => ({ kind: 'image' }), getSource: () => detailSource });
      layer.setVisible(true); layer.setTransform({ zoom: 0.3, panX: 0, panY: 0, sync: true });
    });
    await page.waitForTimeout(300);
    await page.evaluate(() => MesssBoardLeaferLayer.setTransform({ zoom: 3, panX: 0, panY: 0, sync: true }));
    await page.waitForTimeout(500);
    const result = await page.evaluate(() => {
      const data = document.getElementById('detail').getContext('2d').getImageData(0, 0, 600, 600).data;
      let error = 0;
      for (let y = 0; y < 600; y++) for (let x = 0; x < 600; x++) {
        const expected = (Math.floor(x / 2) + Math.floor(y / 2)) % 2 ? 255 : 0;
        error += Math.abs(data[(y * 600 + x) * 4] - expected);
      }
      return { meanPixelError: error / 360000 };
    });
    console.log(result);
    assert.ok(result.meanPixelError < 2, 'Zoomed original must retain source pixel detail');
    const promotion = await page.evaluate(async () => {
      const thumb = document.createElement('canvas'); thumb.width = 40; thumb.height = 120;
      const full = new Image(); full.src = detailSource; await full.decode();
      thumb.getContext('2d').drawImage(full, 0, 0, 40, 120);
      const file = { id: 'image', ext: '.png', sourceWidth: 600, sourceHeight: 1800,
        url: detailSource, thumbUrl: thumb.toDataURL() };
      AppState.boardItems = [detailItem]; detailItem.selected = true;
      Object.assign(Board, { disposed: false, zoom: 3, leaferLayer: MesssBoardLeaferLayer,
        visibleIds: new Set(['detail']), filesById: new Map([['image', file]]) });
      Board.leaferFullItemIds.clear(); Board.leaferSourceByItem.clear();
      isBoardViewportInteracting = () => false;
      let notifications = 0;
      scheduleBoardLeaferSync = () => {
        notifications++;
        updateLeaferFullImageWindow();
        MesssBoardLeaferLayer.updateItem(detailItem, { getFile: () => file, getSource: boardLeaferSource });
      };
      // A load begun outside the scene must still promote its texture on completion.
      const pending = preloadBoardFullImage(file.url);
      updateLeaferFullImageWindow();
      await pending;
      const promoted = Board.leaferFullItemIds.has('detail');
      let hiddenLoads = 0;
      mountedFullImageCandidates = () => { hiddenLoads++; return []; };
      Board.isWheelZooming = Board.isPanning = false; Board.zoomFrame = 0; Board.interactingUntil = 0;
      prewarmMountedFullImages(3); syncMountedImageQuality();
      return { promoted, notifications, hiddenLoads, sourceIsOriginal: boardLeaferSource(file, detailItem) === file.url };
    });
    assert.equal(promotion.promoted, true, 'External decoder completion must wake the scene');
    assert.equal(promotion.sourceIsOriginal, true);
    assert.equal(promotion.hiddenLoads, 0, 'Hidden DOM must not compete for original textures');
    console.log(promotion);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
