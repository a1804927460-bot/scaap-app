const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route('**/js/app.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    await page.evaluate(() => {
      delete document.documentElement.dataset.startupPending;
      const overlay = document.getElementById('moodboard-overlay');
      document.body.replaceChildren(overlay);
      window.t = (en, zh) => zh;
      window.syncMountedBoardItemGeometry = (el) => { el.style.cssText = 'position:absolute;left:40px;top:40px;width:360px;height:260px'; };
      window.makeBoardItemDraggable = () => {};
      window.openAiComposerForSelection = async (...args) => { window.generated = args; };
      window.buildAndShowSimpleMenu = entries => { window.menuEntries = entries; };
      window.realOpenMoodboardEditor = openMoodboardEditor;
      window.openMoodboardEditor = () => { window.editorOpened = true; };
      window.showToast = () => {};
      const canvas = document.createElement('div');
      canvas.id = 'board-canvas';
      canvas.dataset.boardRenderer = 'leafer';
      document.body.append(canvas);
      window.testMoodboard = { id: 'test', moodboardText: 'Soft light, quiet space', title: 'Moodboard' };
      canvas.append(buildBoardMoodboardElement(testMoodboard));
    });
    const button = page.locator('.board-moodboard-generate');
    assert.equal(await button.evaluate(el => getComputedStyle(el).opacity), '1');
    await button.click();
    assert.deepEqual(await page.evaluate(() => generated.slice(0, 2)), ['image', 'Soft light, quiet space']);
    assert.equal(await button.textContent(), '');
    assert.equal(await button.getAttribute('aria-haspopup'), 'dialog');
    assert.ok(await page.evaluate(() => generated[2].moodboardAnchor.width > 0));
    await page.evaluate(() => { testMoodboard.moodboardText = ''; });
    await button.click();
    assert.equal(await page.evaluate(() => editorOpened), true);
    await page.evaluate(() => {
      testMoodboard.isMoodboard = true;
      testMoodboard.moodboardText = 'Soft light, quiet space\nMaterial, color and atmosphere';
      AppState.boardItems = [testMoodboard];
      if (!realOpenMoodboardEditor(testMoodboard)) throw new Error('Rich text editor failed to open');
    });
    fs.mkdirSync('test-artifacts/moodboard', { recursive: true });
    for (const [width, height] of [[1440, 900], [520, 640]]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(300);
      const size = await page.locator('.moodboard-editor-panel').boundingBox();
      assert.ok(size.width <= 680 && size.width <= width - 32);
      assert.ok(size.height <= 540 && size.height <= height - 64);
      const overflow = await page.locator('.moodboard-agent-bar').evaluate(el => el.scrollWidth > el.clientWidth);
      assert.equal(overflow, false);
      await page.screenshot({ path: `test-artifacts/moodboard/editor-${width}.png` });
    }
    console.log('Moodboard generation forwarding, empty content and responsive editor checks passed (isolated browser fixture).');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
