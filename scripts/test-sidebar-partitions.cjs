const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1040, height: 760 } });
    await page.route('**/js/app.js', r => r.fulfill({body:''}));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    await page.evaluate(() => {
      delete document.documentElement.dataset.startupPending;
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
    assert.equal(await page.locator('.sidebar-partition-wheel button').count(), 4);
    assert.equal(await page.locator('.sidebar-partition-wheel button:disabled').count(), 3);
    await page.waitForTimeout(800);
    fs.mkdirSync('test-artifacts/partitions', { recursive: true });
    await page.screenshot({ path: 'test-artifacts/partitions/wheel.png' });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    assert.equal(await page.locator('.sidebar-partition-wheel').evaluate(el => el.open), false);
    await brand.press('ArrowDown');
    await page.locator('button.slot-current').click();
    await page.waitForTimeout(400);
    assert.equal(await brand.getAttribute('aria-expanded'), 'false');
    for (const width of [1040,390]) for (const theme of ['dark','light']) {
      await page.setViewportSize({width,height:760});
      await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.body.dataset.theme=theme;},theme);
      await brand.press('ArrowDown');
      await page.waitForTimeout(800);
      const boxes=await page.locator('.partition-slot').evaluateAll(elements=>elements.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,opacity:getComputedStyle(el).opacity};}));
      for(const b of boxes){assert.ok(b.x>=0&&b.right<=width);assert.equal(b.opacity,'1');}
      for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
        const a=boxes[i],b=boxes[j];assert.ok(a.right<=b.x||b.right<=a.x||a.bottom<=b.y||b.bottom<=a.y);
      }
      await page.screenshot({path:`test-artifacts/partitions/${theme}-${width}.png`});
      await page.keyboard.press('Escape');await page.waitForTimeout(400);
    }
    await brand.press('ArrowDown');await page.waitForTimeout(80);await page.keyboard.press('Escape');await page.waitForTimeout(400);
    assert.equal(await page.locator('.sidebar-partition-wheel').evaluate(el=>el.open),false);
    await page.emulateMedia({reducedMotion:'reduce'});
    await brand.press('ArrowDown');await page.waitForTimeout(50);
    assert.equal(await page.locator('.slot-current').evaluate(el=>getComputedStyle(el).opacity),'1');
    await page.keyboard.press('Escape');await page.waitForTimeout(50);
    console.log('Partition wheel hold, click isolation, keyboard and selection passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
