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
      const panel = document.getElementById('ai-assistant-panel');
      document.body.append(panel);
      panel.classList.add('is-fullscreen');
      panel.style.cssText = 'display:flex;position:fixed;inset:16px;width:auto;height:auto';
      document.querySelectorAll('.section-tab').forEach(tab=>{
        const active = tab.dataset.section === 'assistant';
        tab.classList.toggle('is-active',active); tab.setAttribute('aria-selected',String(active));
      });
      accountProfileDisplayName = 'Chaser';
      accountProfileSignature = 'Artist';
      renderAccountProfileText();
      renderAccountAvatars('C', 'assets/logo-mark.png');
      window.membershipCreditValues = () => ({ available: 6228 });
      renderAccountFooterCredits({});
      initTheme('dark');
      activeAccountAvatarUserId = 'test-account';
      window.messsAPI = { getProfileMood: async () => ({userId:'test-account',mood:''}), setTheme:async theme=>theme };
      initUsageSettings();
      window.loadUsageSummary = () => { window.usageRequested = true; };
    });
    const sidebar = fs.readFileSync('src/js/sidebar.js','utf8');
    await page.evaluate(sidebar.slice(sidebar.indexOf("  document.getElementById('ai-provider-manager-open').addEventListener"),sidebar.indexOf("  document.getElementById('cloud-account-sign-in').addEventListener")));
    assert.equal(await page.locator('#ai-account-footer-name').textContent(), 'Chaser');
    assert.equal(await page.locator('#ai-account-footer-signature').textContent(), 'Artist');
    assert.equal(await page.locator('#ai-account-footer-credits b').textContent(), await page.locator('#account-footer-credits b').textContent());
    assert.equal(await page.locator('#ai-account-footer-avatar img').count(), 1);
    fs.mkdirSync('test-artifacts/ai-account', { recursive: true });
    for (const width of [900, 1440]) for (const theme of ['dark', 'light']) {
      await page.setViewportSize({ width, height: 850 });
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      await page.waitForTimeout(400);
      const bounds = await page.locator('.ai-account-footer').evaluate(el => {
        const r = el.getBoundingClientRect(), p = el.parentElement.getBoundingClientRect();
        return { visible: r.height > 0, fits: r.left >= p.left && r.right <= p.right && r.bottom <= p.bottom, overflow: el.scrollWidth > el.clientWidth };
      });
      assert.equal(bounds.visible, true); assert.equal(bounds.fits, true); assert.equal(bounds.overflow, false);
      await page.screenshot({ path: `test-artifacts/ai-account/${theme}-${width}.png` });
    }
    await page.locator('#ai-account-menu-open').click();
    await page.locator('#account-popover').waitFor({ state: 'visible' });
    const assertTopmost = async selector => {
      await page.waitForTimeout(450);
      assert.equal(await page.locator(selector).evaluate(el => {
        const r = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      }), true, `${selector} must receive clicks above the real fullscreen panel`);
    };
    await assertTopmost('#account-popover');
    await page.locator('.account-popover-head').click();
    await page.locator('#profile-editor').waitFor({state:'visible'});
    assert.equal(await page.locator('#profile-editor [data-avatar]').count(),12);
    await page.locator('.profile-editor-close').click();
    await page.locator('#ai-settings-btn').click();
    await page.locator('#settings-popover').waitFor({ state: 'visible' });
    await assertTopmost('#settings-popover');
    assert.equal(await page.locator('#account-popover').isVisible(), false);
    await page.locator('#settings-popover [data-theme-choice="dark"]').click();
    assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
    await page.locator('#settings-popover [data-theme-choice="light"]').click();
    assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
    await page.locator('#usage-settings-open').click();
    await assertTopmost('#ai-provider-overlay .ai-provider-manager');
    assert.equal(await page.locator('.ai-provider-manager').getAttribute('data-settings-view'),'usage');
    assert.equal(await page.evaluate(() => window.usageRequested),true);
    assert.equal(await page.locator('#ai-assistant-panel').isVisible(),true);
    assert.equal(await page.locator('#ai-provider-overlay').evaluate(el=>el.parentElement===document.body),true);
    await page.locator('#ai-provider-manager-close').click();
    await page.locator('#ai-provider-overlay').waitFor({state:'hidden'});
    assert.equal(await page.locator('.section-tab.is-active').getAttribute('data-section'),'assistant');
    assert.equal(await page.locator('#ai-assistant-panel').isVisible(),true);
    await page.locator('#ai-settings-btn').click();
    await page.locator('#ai-provider-manager-open').click();
    await assertTopmost('#ai-provider-overlay .ai-provider-manager');
    assert.equal(await page.locator('.ai-provider-manager').getAttribute('data-settings-view'),'general');
    await page.screenshot({path:'test-artifacts/ai-account/settings-over-messs.png'});
    await page.locator('#ai-provider-manager-close').click();
    await page.locator('#ai-provider-overlay').waitFor({state:'hidden'});
    assert.equal(await page.locator('.section-tab.is-active').getAttribute('data-section'),'assistant');
    await page.evaluate(() => renderAccountCreditUnavailable());
    assert.equal(await page.locator('#ai-account-footer-credits b').textContent(), '...');
    console.log('AI account footer: shared profile/credits, unavailable state, both popovers, compact/wide and light/dark layouts passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
