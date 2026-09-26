const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const dpr of [1, 1.5, 2]) {
      const page = await browser.newPage({ viewport: { width: 780, height: 580 }, deviceScaleFactor: dpr });
      await page.route('**/js/app.js', route => route.fulfill({ body: '' }));
      await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
      await page.evaluate(async dpr => {
        delete document.documentElement.dataset.startupPending;
        document.body.innerHTML = '<canvas id="motion-scene"></canvas>';
        const source = document.createElement('canvas'); source.width = 600; source.height = 400;
        const ctx = source.getContext('2d');
        ctx.fillStyle = '#eeeeee'; ctx.fillRect(0, 0, 600, 400);
        for (let x = 0; x < 600; x += 24) {
          ctx.fillStyle = '#154baf'; ctx.fillRect(x, 0, 6, 400);
        }
        for (let y = 0; y < 400; y += 32) {
          ctx.fillStyle = '#e63545'; ctx.fillRect(0, y, 600, 8);
        }
        window.motionImage = new Image(); motionImage.src = source.toDataURL(); await motionImage.decode();
        window.motionItem = { id: 'visible', fileId: 'f', x: 17.375, y: 23.125, width: 271.25, height: 271.25 * 2 / 3 };
        const items = [motionItem, ...Array.from({ length: 4999 }, (_, i) => ({
          id: `offscreen-${i}`, fileId: 'f', x: 2000 + (i % 100) * 80, y: 2000 + Math.floor(i / 100) * 80, width: 60, height: 40
        }))];
        MesssBoardLeaferLayer.init({ canvas: document.getElementById('motion-scene'), width: 780, height: 580, pixelRatio: dpr });
        MesssBoardLeaferLayer.sync({ items, getFile: () => ({ kind: 'image' }), getSource: () => motionImage.src });
        MesssBoardLeaferLayer.setTransform({ panX: 30, panY: 20, zoom: 1, sync: true });
      }, dpr);
      await page.waitForTimeout(250);
      const result = await page.evaluate(async dpr => {
        const scene = document.getElementById('motion-scene');
        const reference = document.createElement('canvas'); reference.width = scene.width; reference.height = scene.height;
        const ctx = reference.getContext('2d');
        const errors = [], times = [];
        for (let frame = 0; frame < 72; frame++) {
          await new Promise(requestAnimationFrame);
          const zoom = 0.65 + (frame < 36 ? frame : 71 - frame) * 0.036;
          const panX = 30 + frame * 0.23, panY = 20 + frame * 0.19;
          const start = performance.now();
          MesssBoardLeaferLayer.setTransform({ panX, panY, zoom, sync: true });
          times.push(performance.now() - start);
          ctx.resetTransform(); ctx.clearRect(0, 0, reference.width, reference.height);
          ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * panX, dpr * panY);
          ctx.drawImage(motionImage, motionItem.x, motionItem.y, motionItem.width, motionItem.height);
          const x = Math.ceil((panX + motionItem.x * zoom) * dpr) + 3;
          const y = Math.ceil((panY + motionItem.y * zoom) * dpr) + 3;
          const width = Math.floor(motionItem.width * zoom * dpr) - 6;
          const height = Math.floor(motionItem.height * zoom * dpr) - 6;
          const actual = scene.getContext('2d').getImageData(x, y, width, height).data;
          const expected = ctx.getImageData(x, y, width, height).data;
          let error = 0;
          for (let p = 0; p < actual.length; p++) error += Math.abs(actual[p] - expected[p]);
          errors.push(error / actual.length);
        }
        return { maxError: Math.max(...errors), meanError: errors.reduce((a,b) => a+b, 0) / errors.length,
          maxMs: Math.max(...times), medianMs: times.sort((a,b) => a-b)[36] };
      }, dpr);
      console.log({ dpr, ...result });
      assert.ok(result.maxError < 3, 'Texture detail must track the camera without a stale resampled frame');
      const geometryError = await page.evaluate(() => {
        const board = document.createElement('div'); board.className = 'board-canvas';
        const element = document.createElement('div'); element.className = 'board-item board-item-image';
        board.append(element); document.body.append(board);
        Board.filesById.set('f', { ext: '.png', sourceWidth: 600, sourceHeight: 400 });
        syncMountedBoardItemGeometry(element, motionItem);
        const errors = [0.29, 1, 2.7, 5].map(zoom => {
          board.style.transform = `scale(${zoom})`;
          const box = element.getBoundingClientRect();
          const expected = boardItemBounds(motionItem);
          return Math.max(Math.abs(box.width - expected.w * zoom), Math.abs(box.height - expected.h * zoom));
        });
        board.remove();
        return Math.max(...errors);
      });
      assert.ok(geometryError < 0.1, `Selection geometry must match the image: ${geometryError}`);
      fs.mkdirSync('test-artifacts/jitter', { recursive: true });
      await page.screenshot({ path: `test-artifacts/jitter/textured-${dpr}.png` });
      const dense = await page.evaluate(async () => {
        const layer = MesssBoardLeaferLayer;
        const tiles = Array.from({ length: 5000 }, (_, i) => ({
          id: `dense-${i}`, fileId: 'f', x: i % 100 * 40, y: Math.floor(i / 100) * 32, width: 36, height: 24
        }));
        layer.sync({ items: tiles, getFile: () => ({ kind: 'image' }), getSource: () => motionImage.src });
        const times = [];
        for (let i = 0; i < 60; i++) {
          await new Promise(requestAnimationFrame);
          const start = performance.now();
          layer.setTransform({ panX: -i * 0.4, panY: -i * 0.3, zoom: 0.7 + i * 0.004, sync: true });
          times.push(performance.now() - start);
        }
        const canvas = document.getElementById('motion-scene');
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let visible = 0;
        for (let p = 3; p < pixels.length; p += 4) if (pixels[p] > 0) visible++;
        return { medianMs: times.sort((a,b) => a-b)[30], p95Ms: times[57], visibleFraction: visible / (pixels.length / 4) };
      });
      console.log({ dpr, dense });
      assert.ok(dense.medianMs < 33 && dense.p95Ms < 80, 'Dense-board camera rendering must remain bounded');
      assert.ok(dense.visibleFraction > 0.5, 'Dense-board performance check must actually paint the visible images');
      await page.screenshot({ path: `test-artifacts/jitter/dense-${dpr}.png` });
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
