'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
const providers = [
  { id: 'image-1', name: 'Nano Banana Pro' },
  { id: 'image-2', name: 'Nano Banana 2' },
  { id: 'image-6', name: 'GPT Image 2' },
  { id: 'image-19', name: 'GPT Image 2.5' },
  { id: 'image-18', name: 'Midjourney V8.2' }
];

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 460, height: 580 },
      bypassCSP: true
    });
    const page = await context.newPage();
    await page.route('**/*.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
    await page.goto(pathToFileURL(path.join(root, 'src/index.html')).href);
    await page.addScriptTag({ path: path.join(root, 'src/js/public-model-label.js') });
    await page.addScriptTag({ path: path.join(root, 'src/js/model-badges.js') });
    await page.evaluate((items) => {
      document.documentElement.dataset.language = 'zh';
      document.body.innerHTML = '<main><h1>模型</h1><section class="ai-model-picker-menu" role="listbox"></section></main>';
      document.body.style.cssText = 'margin:0;min-height:100vh;padding:28px;background:var(--bg-base);color:var(--text-primary)';
      const main = document.querySelector('main');
      main.style.cssText = 'width:360px;margin:auto';
      document.querySelector('h1').style.cssText = 'margin:0 0 14px;font-size:18px';
      const menu = document.querySelector('.ai-model-picker-menu');
      menu.style.cssText = 'position:static;width:100%;max-width:none;max-height:none';
      items.forEach((provider, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `ai-model-picker-option${index === 0 ? ' is-active' : ''}`;
        appendAiModelLabel(button, provider, { details: true });
        menu.append(button);
      });
    }, providers);

    assert.deepEqual(await page.locator('.ai-model-label-text').allTextContents(),
      ['Mess NPro', 'Mess N2', 'Mess Image2', 'Mess Image2.5', 'Mess Jennie']);
    assert.equal(await page.locator('.ai-model-description').count(), 5);
    assert.equal(await page.locator('.ai-model-best').count(), 1);
    assert.equal(await page.locator('.ai-model-badge-banana').count(), 2);
    assert.equal(await page.locator('.ai-model-badge-flower').count(), 2);
    assert.equal(await page.locator('.ai-model-badge-sail').count(), 1);
    assert.equal(await page.locator('.ai-model-picker-option').evaluateAll(items =>
      items.every(item => item.scrollWidth <= item.clientWidth)), true);

    await page.evaluate((provider) => {
      const label = document.createElement('span');
      label.id = 'selected-model-label';
      appendAiModelLabel(label, provider, { showIcon: false });
      document.querySelector('main').append(label);
    }, providers[0]);
    assert.equal(await page.locator('#selected-model-label .ai-model-badge').count(), 0);
    assert.equal(await page.locator('#selected-model-label .ai-model-best').count(), 1);

    const output = path.join(root, 'test-artifacts/messs-image-model-menu');
    fs.mkdirSync(output, { recursive: true });
    for (const theme of ['dark', 'light']) {
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      await page.screenshot({ path: path.join(output, `${theme}.png`) });
    }
    console.log('Messs image model names, icons, descriptions, Best badge and responsive menu passed.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
