const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/*.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
    await page.goto(pathToFileURL(path.join(root, 'src/index.html')).href);
    const source = fs.readFileSync(path.join(root, 'src/js/canvas-workspace.js'), 'utf8');
    const start = source.indexOf('function buildCanvasLibraryFolderCard(');
    const end = source.indexOf('\nfunction ', start + 10);
    await page.evaluate(`window.buildCanvasLibraryFolderCard = (${source.slice(start, end)});`);
    await page.evaluate(() => {
      window.t = (en, zh) => zh;
      window.AppState = { canvases: [], canvasProjects: [] };
      window.CanvasWorkspace = { libraryProjectId: null };
      window.renderCanvasLibrary = () => {};
      window.bindCanvasLibraryReorder = () => {};
      window.bindCanvasLibraryInlineRename = () => {};
      const section = document.getElementById('canvas-library-view').cloneNode(true);
      document.body.replaceChildren(section);
      document.body.style.cssText = 'display:block;height:auto;overflow:auto;padding:24px;background:#101112';
      section.style.cssText = 'display:block;overflow:visible';
      document.documentElement.dataset.theme = 'dark';
      const grid = section.querySelector('#canvas-library-grid');
      grid.replaceChildren(buildCanvasLibraryFolderCard({ id: 'folder-test', name: '设计项目' }));
      for (let i = 0; i < 8; i++) {
        const card = document.createElement('article');
        card.className = 'canvas-library-card';
        const title = document.createElement('strong');
        title.className = 'canvas-library-card-title';
        title.textContent = '舞台设计与视觉参考项目 ' + (i + 1);
        const mosaic = document.createElement('div');
        mosaic.className = 'canvas-library-mosaic';
        for (let j = 0; j < 5; j++) {
          const thumb = document.createElement('div');
          thumb.className = 'canvas-library-thumb';
          const img = document.createElement('img');
          img.src = 'assets/canvas-folder-3d.png';
          thumb.append(img);
          mosaic.append(thumb);
        }
        card.append(title, mosaic);
        grid.append(card);
      }
      document.querySelector('#canvas-import').title = '导入画布';
    });
    for (const width of [1920, 1440, 1000, 760, 520]) {
      await page.setViewportSize({ width, height: 800 });
      await page.locator('.canvas-library-folder-icon img').evaluate(img => img.decode());
      assert.equal(await page.locator('#canvas-library-folder-back').isVisible(), false);
      assert.equal(await page.locator('.canvas-library-folder-card').evaluate(el => getComputedStyle(el).borderTopWidth), '0px');
      assert.equal(await page.locator('.canvas-library-folder-hint').count(), 0);
      assert.equal(await page.locator('.canvas-library-folder-icon img').evaluate(el => el.naturalWidth > 0), true);
      const layout = await page.evaluate(() => {
        const grid = document.getElementById('canvas-library-grid');
        const cards = [...grid.children].map(el => el.getBoundingClientRect());
        const bounds = grid.getBoundingClientRect();
        return { overflow: cards.some(r => r.right > bounds.right + 1),
          columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
          headingWidth: document.querySelector('.canvas-library-topline > div').getBoundingClientRect().width };
      });
      assert.equal(layout.overflow, false);
      assert.ok(layout.columns >= 2, 'Compact library should not become one oversized column');
      assert.ok(layout.headingWidth >= 180);
      await page.locator('.canvas-library-folder-card').click();
      assert.equal(await page.evaluate(() => CanvasWorkspace.libraryProjectId), 'folder-test');
      await page.locator('#canvas-library-folder-back').evaluate(el => { el.hidden = false; });
      assert.equal(await page.locator('#canvas-library-folder-back').isVisible(), true);
      await page.locator('#canvas-library-folder-back').evaluate(el => { el.hidden = true; });
      fs.mkdirSync(path.join(root, 'test-artifacts/canvas-library'), { recursive: true });
      await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('.canvas-library-content').scrollTop = 0; });
      await page.screenshot({ path: path.join(root, `test-artifacts/canvas-library/${width}.png`) });
    }
    console.log('Canvas library responsive UI passed at 1920, 1440, 1000, 760 and 520px.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
