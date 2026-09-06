const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    await page.route('**/js/app.js', route => route.fulfill({ body: '' }));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    const cases = await page.evaluate(() => {
      document.body.innerHTML = '<div id="board-canvas" class="board-canvas" data-board-renderer="leafer" style="position:relative;transform-origin:0 0"></div>';
      window.requestBoardModelPreview = async () => null;
      const results = [];
      for (const ext of ['.glb', '.obj', '.fbx']) for (const height of [undefined, 180, 300]) {
        const file = { id: 'model-file', name: 'Model'+ext, ext };
        const item = { id: 'model', fileId: file.id, x: 30, y: 30, width: 220, height, selected: true };
        Board.filesById = new Map([[file.id, file]]); Board.metrics.clear();
        const element = createBoardItemElement(item);
        document.getElementById('board-canvas').replaceChildren(element);
        for (const zoom of [0.4, 1, 2.87]) {
          document.getElementById('board-canvas').style.transform = `scale(${zoom})`;
          syncMountedBoardItemGeometry(element, item);
          const expected = boardItemBounds(item);
          const outer = element.getBoundingClientRect();
          const content = element.querySelector('.board-item-content').getBoundingClientRect();
          const preview = element.querySelector('.board-model-thumbnail').getBoundingClientRect();
          results.push({ ext, zoom, delta: Math.max(Math.abs(outer.height - expected.h * zoom), Math.abs(outer.width - expected.w * zoom), Math.abs(content.bottom - outer.bottom), Math.abs(preview.bottom - outer.bottom)), nameHidden: element.querySelector('.board-item-name').hidden });
        }
        element.remove();
      }
      return results;
    });
    for (const result of cases) { assert.ok(result.delta < 0.1, JSON.stringify(result)); assert.equal(result.nameHidden, true); }
    console.log(`Model selection bounds: ${cases.length} format/size/zoom cases match card, preview and selection geometry.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
