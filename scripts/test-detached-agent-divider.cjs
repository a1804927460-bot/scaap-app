const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/js/app.js', route => route.fulfill({ body: '' }));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    await page.evaluate(() => {
      delete document.documentElement.dataset.startupPending;
      document.body.innerHTML = '<div id="main-app"><div id="board-panel" class="board-panel"><div class="board-workspace-body"><div id="board-agent-panel" class="board-agent-panel"></div><div id="resize-handle-board-agent" style="position:absolute;width:20px;height:400px"></div></div></div></div>';
    });
    for (const theme of ['dark', 'light']) for (const detached of [false, true]) for (const fullscreen of [false, true]) for (const hidden of [true, false, true]) {
      await page.evaluate(({ theme, detached, fullscreen, hidden }) => {
        document.documentElement.dataset.theme = theme;
        document.body.classList.toggle('is-detached-canvas-window', detached);
        document.getElementById('board-panel').classList.toggle('is-fullscreen', fullscreen);
        document.getElementById('board-agent-panel').classList.toggle('is-hidden', hidden);
      }, { theme, detached, fullscreen, hidden });
      assert.equal(await page.locator('#resize-handle-board-agent').evaluate(el => getComputedStyle(el).display === 'none'), hidden, JSON.stringify({theme,detached,fullscreen,hidden}));
    }
    await page.evaluate(() => {
      document.getElementById('board-agent-panel').classList.remove('is-hidden');
      document.getElementById('board-panel').classList.add('is-canvas-library');
    });
    assert.equal(await page.locator('#resize-handle-board-agent').evaluate(el => getComputedStyle(el).display), 'none');
    console.log('Agent divider: main/detached, fullscreen, dark/light, open/close and library visibility passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
