const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
    await page.route('**/js/app.js', r => r.fulfill({ body: '' }));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    await page.evaluate(() => {
      delete document.documentElement.dataset.startupPending;
      document.querySelectorAll('.app-section').forEach(el => el.classList.toggle('is-active', el.id === 'section-market'));
      window.open = url => { window.openedDownload = url; };
    });
    assert.match(await page.locator('.market-card').first().textContent(), /PHASE X/);
    assert.equal(await page.locator('.market-card').first().locator('img').evaluate(el => el.complete && el.naturalWidth > 0), true);
    await page.locator('[data-market-category="software"]').click();
    assert.equal(await page.locator('.market-card').count(), 1);
    await page.locator('.market-card button').click();
    assert.equal(await page.locator('#market-detail-action').isEnabled(), true);
    await page.locator('#market-detail-action').click();
    assert.match(await page.evaluate(() => window.openedDownload), /phasex-v1\.0\.0\/PHASE-X-1\.0\.0-Windows-x64\.exe$/);
    fs.mkdirSync('test-artifacts/phasex-market', { recursive: true });
    for (const theme of ['dark', 'light']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      await page.waitForTimeout(500);
      await page.screenshot({ path: `test-artifacts/phasex-market/${theme}.png` });
    }
    await page.locator('#market-detail-close').click();
    await page.locator('[data-market-category="plugin"]').click();
    await page.locator('.market-card button').first().click();
    assert.equal(await page.locator('#market-detail-action').isDisabled(), true);
    console.log('PHASE X market passed: first listing, software filter, real logo, public download without account/credits, placeholder downloads disabled.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
