const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.route('**/js/app.js', route => route.fulfill({ body: '' }));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    await page.evaluate(() => {
      delete document.documentElement.dataset.startupPending;
      const body = document.getElementById('board-workspace-body');
      document.body.replaceChildren(body);
      body.hidden = false;
      body.style.cssText = 'position:fixed;inset:0;display:flex';
      document.getElementById('board-agent-panel').classList.remove('is-hidden');
    });
    fs.mkdirSync('test-artifacts/canvas-keyboard-outline', { recursive: true });
    for (const theme of ['dark', 'light']) {
      await page.evaluate(theme => {
        document.documentElement.dataset.theme = theme;
        document.body.dataset.theme = theme;
      }, theme);
      await page.keyboard.press('a');
      await page.locator('#board-viewport').focus();
      for (const key of ['a', 'Shift', 'ArrowRight', 'Escape']) {
        await page.keyboard.press(key);
        const state = await page.locator('#board-viewport').evaluate(el => ({
          focused: document.activeElement === el,
          visible: el.matches(':focus-visible'),
          outline: getComputedStyle(el).outlineStyle
        }));
        assert.ok(state.focused && state.visible, 'Exercise real keyboard focus');
        assert.equal(state.outline, 'none', 'Canvas must not paint a structural focus border');
      }
      await page.screenshot({ path: `test-artifacts/canvas-keyboard-outline/${theme}.png` });
      const button = page.locator('#board-agent-panel button').first();
      await button.focus();
      assert.notEqual(await button.evaluate(el => getComputedStyle(el).outlineStyle), 'none', 'Keep button keyboard focus indication');
    }
    console.log('Canvas keyboard outline: both themes passed; control focus preserved.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
