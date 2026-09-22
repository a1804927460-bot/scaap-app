const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/js/app.js', r => r.fulfill({ body: '' }));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    await page.evaluate(() => {
      delete document.documentElement.dataset.startupPending;
      activeAccountAvatarUserId = 'user1'; accountProfileDisplayName = 'Chaser'; accountProfileSignature = 'Artist';
      window.messsAPI = {
        getProfileMood: async () => ({ userId: 'user1', mood: 'focus' }),
        previewProfileAvatar: async () => ({ ok: true, dataUrl: 'assets/avatars/avatar-4.png' }),
        saveProfileDraft: async draft => { window.savedDraft = draft; return { ok: true, ...draft, dataUrl: `assets/avatars/avatar-${draft.preset || 4}.png` }; }
      };
      openProfileEditor();
    });
    assert.equal(await page.locator('[data-avatar]').count(), 12);
    fs.mkdirSync('test-artifacts/profile-editor', { recursive: true });
    for (const width of [390, 1280]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 850 });
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      await page.waitForTimeout(350);
      assert.equal(await page.locator('#profile-editor').evaluate(el => el.scrollWidth <= el.clientWidth), true);
      assert.equal(await page.locator('.profile-avatar-grid img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)), true);
      await page.screenshot({ path: `test-artifacts/profile-editor/${theme}-${width}.png` });
    }
    await page.locator('[data-avatar="2"]').click();
    await page.locator('input[name="name"]').fill('New name');
    await page.locator('input[name="mood"][value="happy"]').check();
    await page.locator('[data-profile-cancel]').click();
    assert.equal(await page.evaluate(() => window.savedDraft), undefined);
    await page.evaluate(() => openProfileEditor());
    assert.equal(await page.locator('input[name="name"]').inputValue(), 'Chaser');
    await page.locator('[data-profile-upload]').click();
    await page.locator('[data-avatar="3"]').click();
    await page.locator('input[name="name"]').fill('New name');
    await page.locator('input[name="mood"][value="happy"]').check();
    await page.locator('.profile-editor-save').click();
    assert.equal(await page.locator('#profile-editor').count(), 0);
    assert.equal(await page.evaluate(() => window.savedDraft.preset), null);
    assert.match(await page.evaluate(() => window.savedDraft.avatarDataUrl), /^data:image\/webp;base64,/);
    assert.equal(await page.evaluate(() => window.savedDraft.avatarDataUrl === profileEmojiAvatar(2)), true);
    assert.equal(await page.locator('#ai-account-footer-name').textContent(), 'New name');
    assert.equal(await page.locator('.account-footer-copy .profile-mood-badge[data-mood="happy"]').count(), 2);
    await page.evaluate(() => { window.messsAPI.saveProfileDraft = async () => ({ ok: false }); openProfileEditor(); });
    await page.locator('.profile-editor-save').click();
    assert.equal(await page.locator('#profile-editor').isVisible(), true);
    assert.equal(await page.locator('.profile-editor-save').isEnabled(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#profile-editor').count(), 0);
    console.log('Profile editor: 12 images, themes/responsive layout, preview/upload, cancel, save, shared mood, failure recovery and Escape passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
