const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 740 } });
    await page.route('**/js/app.js', route => route.fulfill({ body: '' }));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    await page.evaluate(() => {
      delete document.documentElement.dataset.startupPending;
      const overlay = document.getElementById('moodboard-overlay');
      document.body.replaceChildren(overlay);
      window.t = (en, zh) => zh;
      window.isZh = () => true;
      window.syncMoodboardNodePreview = () => {};
      window.moodboardPersistItem = () => {};
      window.setCanvasAgentOpen = () => {};
      window.renderCanvasAgentModels = () => {};
      window.showToast = message => { window.lastToast = message; };
      window.testItem = { id: 'm', isMoodboard: true, moodboardTitle: '文字情绪板 1', moodboardText: '柔和侧光勾勒金属轮廓。' };
      AppState.boardItems = [testItem];
      CanvasWorkspace.config = { chatProviders: [{ id: 'test-provider', name: 'Test', endpoint: 'https://example.test', models: ['gemini-3.8-flash', 'gemini-3.1-pro'] }] };
      window.requests = [];
      window.requestCanvasAgentText = async options => {
        requests.push({ model: activeCanvasAgentProvider().model, prompt: options.contextualPrompt });
        options.onResponse('## 文字情绪板 1\n\n新的正文');
        return { ok: true };
      };
      openMoodboardEditor(testItem);
      refreshMoodboardLanguage();
    });
    assert.equal(await page.locator('#moodboard-format-toolbar, #moodboard-editor .ql-toolbar').count(), 0);
    assert.equal(await page.locator('#moodboard-agent-presets button[aria-pressed="true"]').innerText(), '快速');
    await page.evaluate(() => requestMoodboardAgentOptimization('polish'));
    assert.equal(await page.evaluate(() => requests[0].model), 'gemini-3.8-flash');
    await page.locator('[data-moodboard-model="gemini-3.1-pro"]').click();
    await page.evaluate(() => requestMoodboardAgentOptimization('custom', '精简这段文字'));
    assert.equal(await page.evaluate(() => requests[1].model), 'gemini-3.1-pro');
    assert.equal(await page.evaluate(() => testItem.moodboardSuggestion.text), '新的正文');
    assert.equal(await page.evaluate(() => moodboardRevisionBody('其他标题\n正文', testItem.moodboardTitle)), '其他标题\n正文');
    assert.equal(await page.locator('#moodboard-agent-presets button[aria-pressed="true"]').count(), 1);
    await page.evaluate(() => {
      setMoodboardAgentBusy(true);
    });
    assert.equal(await page.locator('#moodboard-agent-presets button:disabled').count(), 2);
    await page.evaluate(() => { setMoodboardAgentBusy(false); renderMoodboardSuggestion(null); });
    fs.mkdirSync('test-artifacts/moodboard-presets', { recursive: true });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      for (const width of [1100, 390]) {
        await page.setViewportSize({ width, height: 740 });
        await page.waitForTimeout(220);
        assert.equal(await page.locator('.moodboard-agent-bar').evaluate(el => el.scrollWidth > el.clientWidth), false);
        assert.ok((await page.locator('.ql-editor').boundingBox()).height > 150);
        await page.screenshot({ path: `test-artifacts/moodboard-presets/${theme}-${width}.png` });
      }
    }
    await page.evaluate(() => { CanvasWorkspace.config.chatProviders = []; renderMoodboardAgentPresets(); });
    assert.equal(await page.locator('#moodboard-agent-presets button:disabled').count(), 2);
    console.log('Moodboard simplified toolbar, Fast/Balanced routing, title cleanup, busy/unavailable states and responsive themes passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
