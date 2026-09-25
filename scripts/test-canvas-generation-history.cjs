'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-artifacts', 'canvas-generation-history');

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    await page.route('**/*.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
    await page.goto(pathToFileURL(path.join(root, 'src', 'index.html')).href);
    await page.evaluate(() => {
      delete document.documentElement.dataset.startupPending;
      document.documentElement.dataset.theme = 'dark';
      document.documentElement.dataset.language = 'zh';
      window.t = (_en, zh) => zh;
      window.isImageExt = ext => ['.png', '.jpg', '.jpeg', '.webp'].includes(String(ext).toLowerCase());
      window.isVideoExt = ext => ['.mp4', '.webm', '.mov'].includes(String(ext).toLowerCase());
      window.publicModelLabel = name => name === 'internal-model' ? 'Mess Image2' : name;
      window.activeCanvasId = () => 'canvas-a';
      window.boardViewportCenterCoords = () => ({ x: 640, y: 410 });
      window.showToast = message => { window.historyToast = message; };
      window.addFilesToBoard = async (ids, x, y, options) => { window.historyAdd = { ids, x, y, options }; };
      window.openFileFullscreenPreview = file => { window.historyPreview = file.id; };
      window.appendFileThumbnail = (container, file, alt) => {
        const image = document.createElement('img');
        image.alt = alt;
        image.src = file.thumbUrl;
        container.appendChild(image);
      };
      const pixel = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
      window.AppState = { files: [
        { id: 'new-image', name: '最新图片.png', ext: '.png', canvasId: 'canvas-a', thumbUrl: pixel, importedAt: '2026-09-25T10:00:00Z', aiGeneration: { kind: 'image', prompt: '清晨的城市', modelName: 'internal-model', createdAt: '2026-09-25T10:00:00Z' } },
        { id: 'video', name: '运镜.mp4', ext: '.mp4', canvasId: 'canvas-a', thumbUrl: pixel, importedAt: '2026-09-25T09:00:00Z', aiGeneration: { kind: 'video', prompt: '缓慢推进', modelName: 'Mess Video', createdAt: '2026-09-25T09:00:00Z' } },
        { id: 'butler', name: '增强图片.png', ext: '.png', canvasId: 'canvas-a', thumbUrl: pixel, importedAt: '2026-09-25T08:00:00Z', butlerOperation: { kind: 'upscale', modelId: 'Enhance', createdAt: '2026-09-25T08:00:00Z' } },
        { id: 'legacy', name: '旧版生成.png', ext: '.png', canvasId: 'canvas-a', sourceFolder: 'AI Generated', thumbUrl: pixel, importedAt: '2026-09-25T07:30:00Z' },
        { id: 'import', name: '普通导入.png', ext: '.png', canvasId: 'canvas-a', thumbUrl: pixel, importedAt: '2026-09-25T07:00:00Z' },
        { id: 'other-canvas', name: '其他画布.png', ext: '.png', canvasId: 'canvas-b', thumbUrl: pixel, aiGeneration: { kind: 'image', createdAt: '2026-09-25T11:00:00Z' } }
      ] };
    });
    await page.unroute('**/*.js');
    await page.addScriptTag({ url: pathToFileURL(path.join(root, 'src', 'js', 'context-menu.js')).href });

    await page.evaluate(() => showBoardCanvasContextMenu(100, 100));
    assert.match(await page.locator('#board-canvas-context-menu').innerText(), /生成历史/);
    await page.getByText('生成历史', { exact: true }).click();

    const overlay = page.locator('#canvas-generation-history-overlay');
    assert.equal(await overlay.isVisible(), true);
    assert.equal(await page.locator('.canvas-generation-history-card').count(), 4, 'Only generated media from the active canvas should render.');
    assert.equal(await page.locator('.canvas-generation-history-name').first().innerText(), '最新图片.png', 'History should be newest first.');
    assert.equal(await page.locator('.canvas-generation-history-name', { hasText: '普通导入.png' }).count(), 0);
    assert.equal(await page.locator('.canvas-generation-history-name', { hasText: '其他画布.png' }).count(), 0);

    await page.locator('[data-history-filter="image"]').click();
    assert.equal(await page.locator('.canvas-generation-history-card').count(), 3);
    await page.locator('[data-history-filter="video"]').click();
    assert.equal(await page.locator('.canvas-generation-history-card').count(), 1);
    assert.match(await page.locator('#canvas-generation-history-count').innerText(), /^1 /);

    await page.locator('.canvas-generation-history-preview').click();
    assert.equal(await page.evaluate(() => window.historyPreview), 'video');
    await page.locator('.canvas-generation-history-actions button:last-child').click();
    assert.deepEqual(await page.evaluate(() => window.historyAdd), {
      ids: ['video'], x: 640, y: 410, options: { selectAdded: true, promptDuplicates: true }
    });

    fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'dark.png') });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(190);
    assert.equal(await overlay.isVisible(), false);

    await page.evaluate(() => openCanvasGenerationHistory());
    await page.setViewportSize({ width: 390, height: 760 });
    await page.waitForTimeout(80);
    const dialog = await page.locator('.canvas-generation-history-dialog').boundingBox();
    assert.ok(dialog.x >= 0 && dialog.width <= 390 && dialog.height <= 760, 'Dialog must fit a compact viewport.');
    await page.screenshot({ path: path.join(output, 'mobile.png') });
    console.log('Canvas generation history: active-canvas filtering, media filters, preview, canvas placement and responsive modal passed.');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
