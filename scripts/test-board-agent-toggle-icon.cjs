'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 420, height: 180 } });
    await page.route('**/js/app.js', route => route.fulfill({ body: '' }));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    await page.evaluate(() => {
      delete document.documentElement.dataset.startupPending;
      const button = document.getElementById('board-agent-toggle');
      button.classList.remove('board-workspace-only');
      button.hidden = false;
      document.body.replaceChildren(button);
      Object.assign(document.body.style, { display: 'grid', placeItems: 'center', minHeight: '100vh', margin: '0' });
    });
    fs.mkdirSync('test-artifacts/board-agent-toggle', { recursive: true });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => {
        document.documentElement.dataset.theme = value;
        document.body.dataset.theme = value;
      }, theme);
      const metrics = await page.locator('#board-agent-toggle').evaluate(button => {
        const icon = button.querySelector('.board-agent-toggle-icon').getBoundingClientRect();
        const label = button.querySelector('.board-agent-toggle-label').getBoundingClientRect();
        const rect = button.getBoundingClientRect();
        return { iconWidth: icon.width, iconHeight: icon.height, centerDelta: Math.abs((icon.top + icon.height / 2) - (label.top + label.height / 2)), height: rect.height, overflow: button.scrollWidth > button.clientWidth };
      });
      assert.deepEqual(metrics, { iconWidth: 15, iconHeight: 15, centerDelta: 0, height: 28, overflow: false });
      await page.screenshot({ path: `test-artifacts/board-agent-toggle/${theme}.png` });
    }
    console.log('Canvas Agent entry icon passed: visible, aligned, stable 28px control in light/dark themes.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
