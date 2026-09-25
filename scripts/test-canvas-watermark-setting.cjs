'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-artifacts', 'canvas-watermark');
const boardSource = fs.readFileSync(path.join(root, 'src', 'js', 'board-canvas.js'), 'utf8');

assert.match(boardSource, /function boardAiWatermarkEnabled\(\)[\s\S]*?localStorage\.getItem\(BOARD_AI_WATERMARK_KEY\) === 'true'[\s\S]*?return false;/,
  'AI generation marks must default to off.');
assert.equal((boardSource.match(/watermark: boardAiWatermarkEnabled\(\)/g) || []).length, 3,
  'Every canvas generation path must forward the saved mark preference.');

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
    await page.route('**/js/app.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
    await page.goto(pathToFileURL(path.join(root, 'src', 'index.html')).href);
    await page.evaluate(() => {
      delete document.documentElement.dataset.startupPending;
      document.documentElement.dataset.language = 'zh';
      document.documentElement.dataset.theme = 'dark';
      localStorage.removeItem('messs.canvas-ai-watermark.v1');
      window.t = (_en, zh) => zh;
      window.showToast = message => { window.watermarkToast = message; };
      window.loadAiMediaConfigCached = async () => ({});
      window.messsAPI = {
        setTheme: async () => {},
        pickFiles: async () => []
      };
      const settings = document.getElementById('board-canvas-settings');
      const overlay = document.getElementById('board-watermark-overlay');
      document.body.append(settings, overlay);
      settings.hidden = false;
      settings.style.cssText = 'position:fixed;right:24px;bottom:24px;display:block';
      initBoardBottomBar();
    });

    assert.equal(await page.locator('#board-settings-watermark-value').innerText(), '关闭');
    await page.locator('#board-settings-toggle').click();
    await page.locator('#board-settings-watermark').click();
    const overlay = page.locator('#board-watermark-overlay');
    assert.equal(await overlay.isVisible(), true);
    assert.equal(await page.locator('#board-watermark-switch').getAttribute('aria-checked'), 'false');
    assert.match(await page.locator('#board-watermark-description').innerText(), /Messs/);
    assert.match(await page.locator('#board-watermark-option-note').innerText(), /默认关闭/);

    fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'dark-off.png') });
    await page.locator('#board-watermark-switch').click();
    await page.locator('#board-watermark-save').click();
    await page.waitForTimeout(190);
    assert.equal(await page.evaluate(() => localStorage.getItem('messs.canvas-ai-watermark.v1')), 'true');
    assert.equal(await page.locator('#board-settings-watermark-value').innerText(), '开启');
    assert.match(await page.evaluate(() => window.watermarkToast), /已开启/);

    await page.locator('#board-settings-toggle').click();
    await page.locator('#board-settings-watermark').click();
    assert.equal(await page.locator('#board-watermark-switch').getAttribute('aria-checked'), 'true');
    await page.locator('#board-watermark-switch').click();
    await page.locator('#board-watermark-save').click();
    await page.waitForTimeout(190);
    assert.equal(await page.evaluate(() => localStorage.getItem('messs.canvas-ai-watermark.v1')), null);
    assert.equal(await page.locator('#board-settings-watermark-value').innerText(), '关闭');
    console.log('Canvas AI generation mark: default-off, Messs copy, persistence and generation wiring passed.');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
