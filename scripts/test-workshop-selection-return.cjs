const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.route('**/js/app.js', r => r.fulfill({ body: '' }));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    await page.evaluate(() => {
      delete document.documentElement.dataset.startupPending;
      window.showCanvasWorkspace = () => {};
      window.workshopToast = () => {};
      window.isDetachedCanvasWindow = () => false;
      initSectionTabs();
      AppState.files = [{ id: 'photo', name: 'Photo.png', ext: '.png', thumbUrl: 'assets/logo-mark.png' }, { id: 'video', name: 'Video.mp4', ext: '.mp4' }];
      AppState.boardItems = [{ id: 'item', fileId: 'photo', selected: true }];
      document.querySelector('[data-section="workshop"]').click();
      openWorkshopPublish();
    });
    await page.locator('#workshop-publish-name').fill('Saved title');
    await page.locator('#workshop-publish-description').fill('Saved description');
    await page.locator('#workshop-publish-tags').fill('Saved tags');
    for (const fileId of ['photo', 'video']) {
      await page.evaluate(fileId => {
        workshopBeginCanvasSelection();
        AppState.boardItems = [{ id: 'item', fileId, selected: true }];
        document.querySelector('[data-section="workshop"]').click();
      }, fileId);
      await page.waitForTimeout(250);
      assert.equal(await page.locator('#workshop-publish-overlay').isVisible(), true);
      assert.equal(await page.evaluate(() => WorkshopState.publishFileId), fileId);
      assert.equal(await page.locator('#workshop-publish-name').inputValue(), 'Saved title');
      assert.equal(await page.locator('#workshop-publish-description').inputValue(), 'Saved description');
      assert.equal(await page.locator('#workshop-publish-tags').inputValue(), 'Saved tags');
    }
    await page.evaluate(() => { workshopBeginCanvasSelection(); AppState.boardItems = []; document.querySelector('[data-section="workshop"]').click(); });
    await page.waitForTimeout(250);
    assert.equal(await page.locator('#workshop-publish-overlay').isVisible(), true);
    assert.equal(await page.locator('#workshop-publish-selection .workshop-selection-empty').count(), 1);
    await page.evaluate(() => { closeWorkshopPublish(); document.querySelector('[data-section="messs"]').click(); document.querySelector('[data-section="workshop"]').click(); });
    await page.waitForTimeout(250);
    assert.equal(await page.locator('#workshop-publish-overlay').isVisible(), false);
    await page.evaluate(() => { AppState.boardItems = [{ id: 'item', fileId: 'photo', selected: true }]; openWorkshopPublish(); });
    assert.equal(await page.locator('#workshop-publish-name').inputValue(), '');
    fs.mkdirSync('test-artifacts/workshop-return', { recursive: true });
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'test-artifacts/workshop-return/dialog.png' });
    console.log('Workshop return passed: image/video selection, preserved draft, rapid close/reopen, empty selection, explicit cancel and fresh form.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
