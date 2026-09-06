const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.setContent('<canvas id="board-overview"></canvas>');
    for (const file of ['src/vendor/leafer-ui.web.min.js', 'src/vendor/leafer-export.min.js', 'src/js/board-leafer-layer.js']) await page.addScriptTag({ path: path.join(root, file) });
    const results = await page.evaluate(async () => {
      const layer = window.MesssBoardLeaferLayer;
      layer.init({ canvas: document.querySelector('canvas'), width: 800, height: 600, pixelRatio: 1 });
      const results = [];
      for (const zoom of [0.5, 1, 1.5]) {
        const item = { id: 'text', isNote: true, text: 'a'.repeat(110), x: 20, y: 20, width: 300, height: 300, fontSize: 32, color: '#ffffff' };
        layer.sync({ items: [item], cacheKey: String(zoom), getBounds: () => ({ x:20, y:20, w:300, h:300 }), getColor: () => '#ffffff' });
        layer.setTransform({ panX: 0, panY: 0, zoom });
        const url = await layer.toDataURL({ pixelRatio: 1, clip: { x: 0, y: 0, width: 800, height: 600 } });
        const img = new Image(); img.src = url; await img.decode();
        const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 600;
        const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
        const pixels = ctx.getImageData(0, 0, 800, 600).data;
        let painted = 0, outside = 0;
        for (let y = 0; y < 600; y++) for (let x = 0; x < 800; x++) {
          if (pixels[(y * 800 + x) * 4 + 3] < 32) continue;
          painted++;
          if (x > 320 * zoom + 1 || y > 320 * zoom + 1) outside++;
        }
        results.push({ zoom, painted, outside });
      }
      layer.destroy(); return results;
    });
    for (const result of results) { assert.ok(result.painted > 100, JSON.stringify(result)); assert.equal(result.outside, 0, JSON.stringify(result)); }
    fs.mkdirSync(path.join(root, 'test-artifacts/text-wrap'), { recursive: true });
    console.log(JSON.stringify(results));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
