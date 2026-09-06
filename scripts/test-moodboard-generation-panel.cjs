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
          await page.waitForTimeout(200);
          await page.screenshot({ path: `test-artifacts/moodboard-generation/${theme}-${width}-${kind}.png` });
        }
      }
    }
    console.log('Moodboard generation panel: real composer, image/video modes, both themes and viewport bounds passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
