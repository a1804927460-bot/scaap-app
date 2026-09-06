const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/js/app.js', route => route.fulfill({ body: '' }));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    for (const mode of ['no-preference', 'reduce']) {
      await page.emulateMedia({ reducedMotion: mode });
      const result = await page.evaluate(() => {
        document.body.replaceChildren();
        const dialog = document.createElement('dialog'); dialog.id = 'sign-out-dialog';
        dialog.textContent = 'Sign out'; document.body.append(dialog); dialog.showModal();
        const row = document.createElement('div'); row.className = 'assistant-queue-item is-queue-enter';
        row.textContent = 'Queued message'; document.body.append(row);
        return [dialog, row].map(element => {
          const style = getComputedStyle(element);
          return { name: style.animationName, willChange: style.willChange,
            animations: element.getAnimations().map(animation => ({
              duration: animation.effect.getTiming().duration,
              iterations: animation.effect.getTiming().iterations,
              fill: animation.effect.getTiming().fill,
              keys: Object.keys(animation.effect.getKeyframes()[0])
            })) };
        });
      });
      for (const item of result) {
        assert.equal(item.willChange, 'auto');
        if (mode === 'reduce') assert.equal(item.name, 'none');
        else {
          assert.equal(item.animations.length, 1);
          assert.ok(item.animations[0].duration <= 180);
          assert.equal(item.animations[0].iterations, 1);
          assert.equal(item.animations[0].fill, 'none');
          assert.ok(item.animations[0].keys.every(key => ['offset', 'computedOffset', 'easing', 'composite', 'opacity', 'transform'].includes(key)));
        }
      }
      await page.waitForTimeout(250);
      assert.equal(await page.evaluate(() => document.querySelector('#sign-out-dialog').getAnimations().length), 0);
    }
    console.log('UI motion passed: compositor properties, finite duration, no retained animation/layer hint, reduced-motion respected.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
