const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1040, height: 760 } });
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    await page.evaluate(() => {
      const brand = document.getElementById('sidebar-brand-btn');
      document.body.append(brand);
      brand.style.cssText = 'position:fixed;top:80px;left:24px;width:240px;z-index:10';
      window.brandClicks = 0;
      brand.addEventListener('click', () => brandClicks++);
    });
    const brand = page.locator('#sidebar-brand-btn');
    await brand.click();
    assert.equal(await page.evaluate(() => brandClicks), 1);
    const box = await brand.boundingBox();
    await page.mouse.move(box.x + 50, box.y + 20);
    await page.mouse.down();
    await page.waitForTimeout(520);
    await page.mouse.up();
    assert.equal(await page.locator('.sidebar-partition-wheel').evaluate(el => el.open), true);
    assert.equal(await page.evaluate(() => brandClicks), 1);
    assert.equal(await page.locator('.sidebar-partition-wheel button').count(), 1);
    fs.mkdirSync('test-artifacts/partitions', { recursive: true });
    await page.screenshot({ path: 'test-artifacts/partitions/wheel.png' });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(260);
    assert.equal(await page.locator('.sidebar-partition-wheel').evaluate(el => el.open), false);
    await brand.press('ArrowDown');
    await page.locator('button.slot-current').click();
    await page.waitForTimeout(260);
    assert.equal(await brand.getAttribute('aria-expanded'), 'false');
    console.log('Partition wheel hold, click isolation, keyboard and selection passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
