const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/js/app.js', route => route.fulfill({ body: '' }));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    await page.evaluate(() => {
      delete document.documentElement.dataset.startupPending;
      document.body.replaceChildren();
      window.t = (en, zh) => zh;
      window.isBoardFullscreen = () => false;
      window.markBoardUiLayer = () => {};
      window.updateUiLanguage = () => {};
      window.messsAPI = { quoteAiMedia: async () => ({ credits: 26 }) };
      const config = {
        imageProviders: [{ id: 'image-1', name: 'Nano Banana Pro', endpoint: 'https://test.invalid', capabilities: { sizes: ['1K','2K','4K'], aspectRatios: ['auto','1:1','16:9','9:16'], maxCount: 4 } }],
        videoProviders: [{ id: 'video-1', name: 'MiniMax H3', endpoint: 'https://test.invalid', capabilities: { resolutions: ['768P','1080P'], aspectRatios: ['16:9','9:16'], durations: [6,10], modes: ['image'] } }]
      };
      window.testPop = buildAiComposer(config, 'image');
      document.body.append(testPop);
      testPop.querySelector('.ai-composer-prompt').value = '柔和光线，金属材质，冷色舞台。';
      document.body.style.cssText = 'position:relative;width:100vw;height:100vh';
    });
    fs.mkdirSync('test-artifacts/moodboard-generation', { recursive: true });
    for (const width of [1200, 420]) {
      await page.setViewportSize({ width, height: 850 });
      for (const theme of ['dark', 'light']) {
        await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.body.dataset.theme = theme; }, theme);
        for (const kind of ['image', 'video']) {
          await page.evaluate(kind => { testPop._setMode(kind); layoutMoodboardComposer(testPop, { left: 40, right: 70, top: 80 }); }, kind);
          assert.ok(await page.locator('.ai-options-panel').isVisible());
          assert.equal(await page.locator('.ai-options-toggle').isVisible(), false);
          assert.equal(await page.locator('.ai-model-picker').count(), 1);
          const box = await page.locator('#ai-image-popover').boundingBox();
          assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= 850, JSON.stringify(box));
          assert.equal(await page.locator('#ai-image-popover').evaluate(el => el.scrollWidth > el.clientWidth), false);
          assert.equal(await page.locator('#ai-image-popover').evaluate(el => el.scrollHeight > el.clientHeight + 1), false, `${width}/${theme}/${kind}: all controls must fit`);
          await page.waitForTimeout(200);
          await page.screenshot({ path: `test-artifacts/moodboard-generation/${theme}-${width}-${kind}.png` });
        }
      }
    }
    await page.setViewportSize({ width: 1200, height: 850 });
    await page.evaluate(() => {
      testPop._disposeMoodboardLayout(); testPop._disposeMoodboardLayout = null;
      const board = document.createElement('div'); board.className = 'board-moodboard'; board.id = 'anchor-board';
      board.style.cssText = 'position:absolute;left:40px;top:60px;width:320px;height:360px';
      const trigger = document.createElement('button'); board.append(trigger); document.body.append(board);
      layoutMoodboardComposer(testPop, trigger);
    });
    await page.waitForTimeout(100);
    assert.equal(Math.round((await page.locator('#ai-image-popover').boundingBox()).width), 320);
    await page.locator('#anchor-board').evaluate(el => { el.style.width = '400px'; el.style.height = '480px'; });
    await page.waitForTimeout(100);
    assert.equal(Math.round((await page.locator('#ai-image-popover').boundingBox()).width), 400);
    for (const scroll of [0, 500]) {
      await page.locator('#ai-image-popover').evaluate((el, scroll) => el.scrollTop = scroll, scroll);
      const close = await page.locator('.ai-composer-close').boundingBox();
      const modes = await page.locator('.ai-composer-mode').boundingBox();
      assert.ok(Math.abs(close.y + close.height / 2 - modes.y - modes.height / 2) < 1);
      assert.ok(close.x >= modes.x + modes.width);
      assert.equal(await page.locator('.ai-composer-close').evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)); }), true);
    }
    await page.screenshot({ path: 'test-artifacts/moodboard-generation/anchored-scroll.png' });
    await page.locator('#anchor-board').evaluate(el => { el.style.width = '150px'; el.style.height = '80px'; });
    await page.waitForTimeout(100);
    for (const kind of ['image', 'video']) {
      await page.evaluate(kind => {
        testPop._setMode(kind);
        layoutMoodboardComposer(testPop, document.querySelector('#anchor-board button'));
      }, kind);
      assert.equal(await page.locator('#ai-image-popover').evaluate(el => el.scrollHeight > el.clientHeight + 1), false, 'Zoomed-out board must not constrain panel height');
    }
    await page.setViewportSize({ width: 420, height: 400 });
    await page.waitForTimeout(100);
    const smallBox = await page.locator('#ai-image-popover').boundingBox();
    assert.ok(smallBox.y >= 0 && smallBox.y + smallBox.height <= 400);
    await page.locator('#ai-image-popover').evaluate(el => el.scrollTop = el.scrollHeight);
    assert.equal(await page.locator('.ai-composer-submit').evaluate(el => {
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    }), true, 'Small-window fallback must keep submit reachable');
    await page.evaluate(() => testPop._disposeMoodboardLayout());
    console.log('Moodboard generation panel: image/video, themes, bounds, live board sizing and aligned close button passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
