const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/js/app.js', r => r.fulfill({ body: '' }));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    await page.evaluate(() => {
      delete document.documentElement.dataset.startupPending;
      window.signOutCalls = 0;
      window.signOutCloudAccount = async () => { window.signOutCalls++; await new Promise(resolve => { window.completeSignOut = resolve; }); };
      confirmSignOutCloudAccount(); confirmSignOutCloudAccount();
    });
    assert.equal(await page.locator('#sign-out-dialog').count(), 1);
    assert.equal(await page.locator('[data-sign-out-cancel]').evaluate(el => el === document.activeElement), true);
    fs.mkdirSync('test-artifacts/sign-out', { recursive: true });
    for (const width of [390, 1280]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 800 });
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      await page.waitForTimeout(300);
      assert.equal(await page.locator('#sign-out-dialog').evaluate(el => el.scrollWidth <= el.clientWidth), true);
      await page.screenshot({ path: `test-artifacts/sign-out/${theme}-${width}.png` });
    }
    await page.locator('[data-sign-out-cancel]').click();
    assert.equal(await page.evaluate(() => window.signOutCalls), 0);
    await page.evaluate(() => confirmSignOutCloudAccount());
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#sign-out-dialog').count(), 0);
    await page.evaluate(() => confirmSignOutCloudAccount());
    await page.locator('.sign-out-confirm').click();
    assert.equal(await page.locator('.sign-out-confirm').isDisabled(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#sign-out-dialog').count(), 1);
    await page.evaluate(() => window.completeSignOut());
    await page.locator('#sign-out-dialog').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => window.signOutCalls), 1);
    await page.evaluate(() => { window.signOutCloudAccount = async () => { throw new Error('offline'); }; confirmSignOutCloudAccount(); });
    await page.locator('.sign-out-confirm').click();
    assert.ok(await page.locator('.sign-out-error').textContent());
    assert.equal(await page.locator('.sign-out-confirm').isEnabled(), true);
    console.log('Sign out dialog: themes, responsive, cancel/Escape, single submission, busy state and error retry passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
