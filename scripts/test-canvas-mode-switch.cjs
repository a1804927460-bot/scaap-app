const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 760 }, colorScheme: 'dark' });
    await page.route('**/js/app.js', route => route.fulfill({ body: '' }));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    await page.evaluate(() => {
      delete document.documentElement.dataset.startupPending;
      document.body.innerHTML = `
        <main id="board-viewport" class="board-viewport" style="position:relative;width:100vw;height:100vh;overflow:hidden;background:#111316">
          <canvas class="board-leafer-canvas"></canvas>
          <div class="board-canvas"></div>
          <div id="board-performance-switch" class="board-performance-switch" role="group" aria-label="画布生成模式">
            <span class="board-performance-thumb" aria-hidden="true"></span>
            <button type="button" class="ai-performance-option is-active" data-performance-mode="normal" aria-pressed="true"><img src="assets/icons/lucide/circle-check.svg" alt=""><span>普通</span></button>
            <button type="button" class="ai-performance-option" data-performance-mode="performance" aria-pressed="false"><img src="assets/icons/lucide/zap.svg" alt=""><span>性能</span></button>
          </div>
        </main>`;
      const control = document.getElementById('board-performance-switch');
      control.addEventListener('click', event => {
        const button = event.target.closest('[data-performance-mode]');
        if (!button) return;
        const mode = button.dataset.performanceMode;
        control.classList.toggle('is-performance', mode === 'performance');
        control.querySelectorAll('button').forEach(item => {
          const active = item === button;
          item.classList.toggle('is-active', active);
          item.setAttribute('aria-pressed', String(active));
        });
        window.MesssUiMotion.canvasModeSwitch(control, document.getElementById('board-viewport'), mode, true);
      });
    });

    const buttons = page.locator('.ai-performance-option');
    assert.equal(await buttons.count(), 2);
    const normalBox = await buttons.nth(0).boundingBox();
    const performanceBox = await buttons.nth(1).boundingBox();
    assert.ok(normalBox.width >= 68 && performanceBox.x >= normalBox.x + normalBox.width - 1);

    await buttons.nth(1).click();
    await page.waitForTimeout(260);
    assert.equal(await buttons.nth(1).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('.board-mode-wave-ring').count(), 4);
    const thumbTransform = await page.locator('.board-performance-thumb').evaluate(element => getComputedStyle(element).transform);
    assert.notEqual(thumbTransform, 'none');
    assert.ok(Number(thumbTransform.split(',')[4]) > 60, thumbTransform);

    fs.mkdirSync('test-artifacts/canvas-mode-switch', { recursive: true });
    await page.screenshot({ path: 'test-artifacts/canvas-mode-switch/performance-wave.png' });
    await buttons.nth(0).click();
    await page.waitForTimeout(80);
    assert.equal(await page.locator('.board-mode-wave-layer').count(), 1, 'Rapid toggles must replace the previous wave');
    assert.equal(await buttons.nth(0).getAttribute('aria-pressed'), 'true');
    await page.waitForTimeout(1600);
    assert.equal(await page.locator('.board-mode-wave-layer').count(), 0);
    console.log('Canvas mode switch: split control, spring thumb and full-canvas Motion wave passed.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
