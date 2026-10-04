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
    channel: 'chrome',
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
      const pixel = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#314957"/><circle cx="240" cy="55" r="25" fill="#e8c997"/><path d="M0 200L110 60L220 200M140 200L240 105L320 200" fill="#65968b"/></svg>');
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
    const canvasMenuText = await page.locator('#board-canvas-context-menu').innerText();
    assert.match(canvasMenuText, /生成历史/);
    assert.doesNotMatch(canvasMenuText, /查看积分用量/);
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
    await page.setViewportSize({ width: 1600, height: 960 });
    await page.evaluate(() => {
      const template = AppState.files[0];
      AppState.files = Array.from({length:464}, (_,i) => ({...template,id:'bulk-'+i,name:'生成图片-'+i+'.png'}));
      openCanvasGenerationHistory();
    });
    await page.waitForTimeout(240);
    assert.equal(await page.locator('.canvas-generation-history-preview img').first().evaluate(img => img.complete && img.naturalWidth > 0), true, 'History thumbnail must decode');
    const bulk = await page.evaluate(() => {
      const grid = document.querySelector('.canvas-generation-history-grid');
      const card = grid.firstElementChild;
      return {card:card.getBoundingClientRect().height,preview:card.querySelector('button').getBoundingClientRect().height,scroll:grid.scrollHeight,viewport:grid.clientHeight};
    });
    assert.ok(bulk.card > 200 && bulk.preview > 100 && bulk.scroll > bulk.viewport, 'Large history must retain readable cards: '+JSON.stringify(bulk));
    await page.screenshot({ path: path.join(output, 'large-dark.png') });
    for (const theme of ['light','dark']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      await page.setViewportSize({ width: 390, height: 760 });
      const last = page.locator('.canvas-generation-history-card').last();
      await last.scrollIntoViewIfNeeded();
      const bounds = await last.boundingBox();
      assert.ok(bounds.height > 200, 'Last card must remain readable on mobile');
      await last.locator('.canvas-generation-history-actions button:last-child').click();
      assert.equal(await page.evaluate(() => window.historyAdd.ids[0]), 'bulk-463');
      await page.locator('[data-history-filter="video"]').click();
      assert.equal(await page.locator('#canvas-generation-history-empty').isVisible(), true);
      await page.locator('[data-history-filter="all"]').click();
      assert.equal(await page.locator('.canvas-generation-history-card').count(), 464);
    }
    // Use the real preview lifecycle and hit testing: a callback-only mock
    // cannot detect a preview trapped underneath a body-level history modal.
    await page.addScriptTag({url:pathToFileURL(path.join(root,'src/js/preview-canvas.js')).href});
    await page.evaluate(()=>{
      window.resolveImageDisplaySource=file=>file.thumbUrl;
      initFullscreenOverlay();
      window.previewOriginalParent=document.getElementById('fullscreen-overlay').parentElement;
    });
    await page.locator('.canvas-generation-history-actions button:first-child').last().scrollIntoViewIfNeeded();
    const beforeScroll=await page.locator('#canvas-generation-history-grid').evaluate(e=>e.scrollTop);
    await page.locator('.canvas-generation-history-actions button:first-child').last().click();
    await page.waitForTimeout(300);
    assert.ok(await page.evaluate(()=>document.elementFromPoint(innerWidth/2,innerHeight/2)?.closest('#fullscreen-overlay')),'Preview must be in front of history');
    await page.keyboard.press('Escape');await page.waitForTimeout(200);
    assert.equal(await overlay.isVisible(),true,'Escape closes only preview, preserving history');
    assert.equal(await page.locator('#canvas-generation-history-grid').evaluate(e=>e.scrollTop),beforeScroll);
    assert.ok(await page.evaluate(()=>document.getElementById('fullscreen-overlay').parentElement===window.previewOriginalParent),'Preview must return to its original host after close');
    console.log('Canvas generation history: active-canvas filtering, media filters, preview, canvas placement and responsive modal passed.');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
