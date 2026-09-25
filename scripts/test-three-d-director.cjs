'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-artifacts', 'three-d-director');

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-webgl']
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route('**/*.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
    await page.goto(pathToFileURL(path.join(root, 'src', 'index.html')).href);
    await page.evaluate(() => {
      delete document.documentElement.dataset.startupPending;
      document.documentElement.dataset.theme = 'dark';
      document.documentElement.dataset.language = 'zh';
      window.t = (_en, zh) => zh;
      window.showToast = (message) => { window.lastToast = message; };
      window.AppState = { files: [], activeFolderId: null };
      window.activeCanvasId = () => 'canvas-1';
      window.currentFileListScope = () => [];
      window.renderFileList = () => {};
      window.renderFolderGridIfActive = () => {};
      window.boardViewportCenterCoords = () => ({ x: 120, y: 160 });
      window.addFilesToBoard = async ids => { window.addedDirectorFiles = ids; };
      window.messsAPI = {
        importCroppedImage: async request => {
          window.directorImport = request;
          return { ok: true, file: { id: `director-${Date.now()}`, name: '3D-shot.png', ext: '.png' } };
        }
      };
      window.showAiImagePopover = async kind => {
        const composer = document.createElement('div');
        composer.id = 'ai-image-popover';
        composer.dataset.kind = kind;
        composer.innerHTML = '<textarea class="ai-composer-prompt"></textarea>';
        composer._toggleBoardReference = async id => { window.directorReferenceId = id; };
        document.body.append(composer);
      };
    });
    await page.unroute('**/*.js');
    for (const file of ['src/vendor/model-viewer.bundle.js', 'src/js/context-menu.js', 'src/js/three-d-director.js']) {
      await page.addScriptTag({ url: pathToFileURL(path.join(root, file)).href });
    }

    await page.evaluate(() => showBoardCanvasContextMenu(120, 140));
    const menuItems = page.locator('#board-canvas-context-menu .context-menu-item');
    assert.equal(await menuItems.first().innerText(), '3D \u5bfc\u6f14\u53f0');
    assert.equal(await page.locator('#board-canvas-context-menu .context-menu-divider').count(), 1);
    await menuItems.first().click();
    await page.waitForTimeout(700);

    const overlay = page.locator('#three-d-director-overlay');
    assert.equal(await overlay.isVisible(), true);
    const canvas = page.locator('.three-d-director-viewport canvas');
    assert.equal(await canvas.count(), 1, 'The director must reuse one WebGL canvas.');
    assert.ok((await canvas.boundingBox()).width > 600);

    fs.mkdirSync(output, { recursive: true });
    const canvasPath = path.join(output, 'scene.png');
    const canvasDataUrl = await canvas.evaluate(element => element.toDataURL('image/png'));
    fs.writeFileSync(canvasPath, Buffer.from(canvasDataUrl.split(',')[1], 'base64'));
    const stats = await sharp(canvasPath).stats();
    const spread = stats.channels.slice(0, 3).reduce((sum, channel) => sum + channel.stdev, 0);
    const brightness = stats.channels.slice(0, 3).reduce((sum, channel) => sum + channel.mean, 0);
    assert.ok(spread > 18, `The 3D scene must contain visible geometry; spread=${spread}.`);
    assert.ok(brightness > 20, `The 3D scene must not be blank; brightness=${brightness}.`);

    await page.locator('[data-shot="close"]').click({ force: true });
    await page.locator('[data-layout="product"]').click({ force: true });
    await page.locator('[data-light="sunset"]').click({ force: true });
    // WebGL can intercept the scroll phase on hosted Windows runners even
    // when the control is visible and stable; the click target is verified.
    await page.locator('[data-aspect="9:16"]').click({ force: true });
    assert.equal(await page.locator('[data-aspect="9:16"]').getAttribute('class'), 'is-active');
    assert.equal(await page.locator('[data-aspect="16:9"]').getAttribute('class'), '');
    await page.waitForFunction(() => (
      getComputedStyle(document.querySelector('[data-aspect="9:16"]')).backgroundColor === 'rgb(27, 48, 57)'
    ));
    assert.equal(await page.locator('[data-aspect="9:16"]').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(27, 48, 57)');
    await page.locator('#three-d-director-movement').selectOption('dolly');
    const prompt = await page.locator('.three-d-director-prompt').inputValue();
    assert.match(prompt, /\u7279\u5199/);
    assert.match(prompt, /85mm/);
    assert.match(prompt, /\u4ea7\u54c1/);
    assert.match(prompt, /\u9ec4\u660f/);
    assert.match(prompt, /9:16/);

    const bounds = await page.evaluate(() => {
      const rect = selector => { const box = document.querySelector(selector).getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height }; };
      return { stage: rect('.three-d-director-stage'), inspector: rect('.three-d-director-inspector') };
    });
    assert.ok(bounds.stage.x + bounds.stage.width <= bounds.inspector.x + 1, 'Stage and inspector must not overlap.');
    await page.screenshot({ path: path.join(output, 'desktop.png') });

    await page.locator('[data-director-action="snapshot"]').click({ force: true });
    await page.waitForFunction(() => Array.isArray(window.addedDirectorFiles) && window.addedDirectorFiles.length === 1);
    const importPayload = await page.evaluate(() => window.directorImport);
    assert.match(importPayload.dataUrl, /^data:image\/png;base64,/);

    await page.locator('[data-director-action="image"]').click({ force: true });
    await page.waitForFunction(() => document.querySelector('#ai-image-popover .ai-composer-prompt'));
    assert.equal(await page.locator('#three-d-director-overlay').isVisible(), false);
    assert.equal(await page.locator('#ai-image-popover').getAttribute('data-kind'), 'image');
    assert.match(await page.locator('#ai-image-popover .ai-composer-prompt').inputValue(), /9:16/);
    assert.ok(await page.evaluate(() => Boolean(window.directorReferenceId)));
    await page.locator('#ai-image-popover').evaluate(element => element.remove());

    await page.evaluate(() => window.MesssThreeDDirector.open());
    await page.locator('[data-director-action="video"]').click({ force: true });
    await page.waitForFunction(() => document.querySelector('#ai-image-popover .ai-composer-prompt'));
    assert.equal(await page.locator('#ai-image-popover').getAttribute('data-kind'), 'video');
    assert.match(await page.locator('#ai-image-popover .ai-composer-prompt').inputValue(), /\u7f13\u6162\u63a8\u8f68/);
    assert.ok(await page.evaluate(() => Boolean(window.directorReferenceId)));
    await page.locator('#ai-image-popover').evaluate(element => element.remove());

    await page.evaluate(() => window.MesssThreeDDirector.open());
    await page.setViewportSize({ width: 690, height: 820 });
    await page.waitForTimeout(400);
    const mobileBounds = await page.evaluate(() => {
      const rect = selector => { const box = document.querySelector(selector).getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height }; };
      return { shell: rect('.three-d-director-shell'), inspector: rect('.three-d-director-inspector'), footer: rect('.three-d-director-footer') };
    });
    const mobileShell = mobileBounds.shell;
    const mobileInspector = mobileBounds.inspector;
    const mobileFooter = mobileBounds.footer;
    assert.ok(mobileInspector.y + mobileInspector.height <= mobileFooter.y + 1);
    assert.ok(mobileShell.width <= 690 && mobileShell.height <= 782);
    await page.screenshot({ path: path.join(output, 'mobile.png') });

    await page.evaluate(() => window.MesssThreeDDirector.close());
    assert.equal(await overlay.isVisible(), false);
    console.log('3D Director: context menu, WebGL scene, shot controls, snapshot, AI handoff and responsive layout passed.');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
