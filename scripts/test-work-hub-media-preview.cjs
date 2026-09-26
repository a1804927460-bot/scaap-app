'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const systemChrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const browser = await chromium.launch({
    ...(fs.existsSync(systemChrome) ? { executablePath: systemChrome } : {}),
    headless: true
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.route('**/js/app.js', route => route.fulfill({ body: '' }));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    await page.evaluate(() => {
      delete document.documentElement.dataset.startupPending;
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#111"/><circle cx="160" cy="90" r="54" fill="#fff"/><script>window.workHubSvgExecuted=true</script></svg>';
      const svgUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      const modelPreview = new URL('assets/logo-mark.png', location.href).href;
      window.svgPreviewSource = svgUrl;
      AppState.files = [
        { id: 'svg-file', name: 'vector.svg', ext: '.svg', url: svgUrl, thumbUrl: 'broken:thumbnail' },
        { id: 'model-file', name: 'scene.glb', ext: '.glb' },
        ...Array.from({ length: 36 }, (_, index) => ({
          id: `image-${index}`,
          name: `image-${index}.png`,
          ext: '.png',
          url: modelPreview,
          thumbUrl: modelPreview
        }))
      ];
      AppState.canvases = [];
      window.messsAPI = {
        listScheduleProjects: async () => [],
        listWorkspaceResources: async () => []
      };
      window.requestBoardModelPreview = async file => {
        window.requestedModelPreview = file.id;
        return modelPreview;
      };
      window.openBoardModelViewer = file => { window.openedModelViewer = file.id; };
      window.openFileFullscreenPreview = async file => { window.openedMediaPreview = file.id; };
    });

    await page.evaluate(() => MesssWorkHub.open('files'));
    const svgImage = page.locator('[data-file-id="svg-file"] .hub-asset-preview img');
    const modelImage = page.locator('[data-file-id="model-file"] .hub-asset-preview img');
    await svgImage.waitFor();
    await page.waitForFunction(() => window.requestedModelPreview === 'model-file');
    await page.waitForFunction(() => {
      const image = document.querySelector('[data-file-id="model-file"] .hub-asset-preview img');
      return image && !image.hidden && image.naturalWidth > 0;
    });

    assert.equal(await svgImage.getAttribute('src'), await page.evaluate(() => window.svgPreviewSource));
    assert.equal(await page.evaluate(() => Boolean(window.workHubSvgExecuted)), false);
    assert.match(await modelImage.getAttribute('src'), /\/assets\/logo-mark\.png$/);

    await page.locator('[data-file-id="model-file"] .hub-asset-preview').click();
    assert.equal(await page.evaluate(() => window.openedModelViewer), 'model-file');
    await page.evaluate(() => MesssWorkHub.open('files'));
    await page.locator('[data-hub-action="filter-image"]').click();
    const previousScrollTop = await page.locator('.hub-content').evaluate(node => {
      node.scrollTop = 720;
      return node.scrollTop;
    });
    assert.ok(previousScrollTop > 0);
    await page.locator('[data-file-id="svg-file"] .hub-asset-preview').evaluate(button => button.click());
    assert.equal(await page.evaluate(() => window.openedMediaPreview), 'svg-file');
    await page.evaluate(() => MesssWorkHub.open('files', { restoreFromPreview: true }));
    assert.equal(await page.locator('.hub-content').evaluate(node => node.scrollTop), previousScrollTop);
    assert.equal(await page.locator('[data-hub-action="filter-image"]').getAttribute('class'), 'is-active');
    const scrollTopButton = page.locator('.hub-scroll-top');
    assert.equal(await scrollTopButton.getAttribute('aria-hidden'), 'false');
    const [hubBox, buttonBox] = await Promise.all([page.locator('.work-hub').boundingBox(), scrollTopButton.boundingBox()]);
    assert.ok(buttonBox.x >= hubBox.x && buttonBox.x + buttonBox.width <= hubBox.x + hubBox.width);
    assert.ok(buttonBox.y >= hubBox.y && buttonBox.y + buttonBox.height <= hubBox.y + hubBox.height);
    await scrollTopButton.click();
    await page.waitForFunction(() => document.querySelector('.hub-content').scrollTop === 0);
    assert.equal(await scrollTopButton.getAttribute('aria-hidden'), 'true');

    console.log('PASS work hub renders safe SVG and 3D thumbnails and opens their dedicated previews');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
