const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 640 } });
    await page.route('**/js/app.js', route => route.fulfill({ body: '' }));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    await page.evaluate(() => {
      delete document.documentElement.dataset.startupPending;
      const selects = ['text-font-select', 'text-weight-select', 'market-sort', 'workshop-sort'].map(id => document.getElementById(id));
      document.body.replaceChildren();
      document.body.style.cssText = 'padding:32px;display:flex;align-items:flex-start;gap:20px;flex-wrap:wrap';
      for (const select of selects) {
        if (select.id === 'market-sort' || select.id === 'workshop-sort') {
          const label = document.createElement('label');
          label.className = select.id.replace('-sort', '-sort-label');
          label.append('排序', select);document.body.append(label);
          continue;
        }
        select.style.cssText = 'width:160px;height:36px;background:var(--bg-elevated);color:var(--text-primary);border:1px solid var(--border-strong);border-radius:6px';
        document.body.append(select);
      }
      const dynamic = document.createElement('select'); dynamic.id = 'dynamic-select';
      dynamic.innerHTML = '<optgroup label="Sizes"><option value="1">1K</option><option disabled value="2">2K</option><option value="4">4K</option></optgroup>';
      document.body.append(dynamic);
      window.changes = 0;
      document.addEventListener('change', () => changes++);
    });
    fs.mkdirSync('test-artifacts/themed-selects', { recursive: true });
    for (const theme of ['dark', 'light']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      await page.waitForTimeout(400);
      for (const id of ['text-font-select', 'text-weight-select', 'market-sort', 'workshop-sort', 'dynamic-select']) {
        const select = page.locator(`#${id}`);
        assert.equal(await select.evaluate(el => getComputedStyle(el).appearance), 'base-select');
        if (id === 'market-sort' || id === 'workshop-sort') {
          const aligned = await select.evaluate(el => ({align:getComputedStyle(el).alignItems, arrow:getComputedStyle(el,'::picker-icon').alignSelf,height:el.getBoundingClientRect().height}));
          assert.equal(aligned.align,'center');assert.equal(aligned.arrow,'center');assert.equal(aligned.height,32);
        }
        await select.click();
        assert.equal(await select.evaluate(el => el.matches(':open')), true);
        const colors = await select.evaluate(el => ({ menu: getComputedStyle(el, '::picker(select)').backgroundColor, option: getComputedStyle(el.options[0]).color, expected: getComputedStyle(document.body).color }));
        assert.equal(colors.option, colors.expected);
        assert.notEqual(colors.menu, 'rgba(0, 0, 0, 0)');
        await page.screenshot({ path: `test-artifacts/themed-selects/${theme}-${id}.png` });
        await page.keyboard.press('Escape');
        assert.equal(await select.evaluate(el => el.matches(':open')), false);
      }
    }
    const weight = page.locator('#text-weight-select');
    await weight.click();
    await page.getByRole('option', { name: 'Bold', exact: true }).click();
    assert.equal(await weight.inputValue(), '700');
    assert.equal(await page.evaluate(() => changes), 1);
    await page.locator('#dynamic-select').click();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#dynamic-select').inputValue(), '4');
    await page.setViewportSize({ width: 390, height: 560 });
    await weight.click();
    const option = await page.getByRole('option', { name: 'Black', exact: true }).boundingBox();
    assert.ok(option.x >= 0 && option.x + option.width <= 390 && option.y + option.height <= 560);
    await page.screenshot({ path: 'test-artifacts/themed-selects/compact.png' });
    console.log('Themed selects: dark/light, dynamic options, pointer/keyboard changes, disabled options and compact viewport passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
