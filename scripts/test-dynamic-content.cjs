'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
  const main = read('main.js');
  const preload = read('preload.js');
  const html = read('src', 'index.html');
  const partitions = read('src', 'js', 'sidebar-partitions.js');
  const board = read('src', 'js', 'board-canvas.js');
  const templateLibrary = read('src', 'js', 'template-library.js');
  const themeStyles = read('src', 'styles', 'theme.css');
  const styles = read('src', 'styles', 'main.css');
  const migration = read('supabase', 'migrations', '202609270001_dynamic_app_content.sql');

  assert.match(main, /PUBLIC_CONTENT_SURFACES = new Set\(\['templates'\]\)/);
  assert.doesNotMatch(html, /section-market|section-workshop|js\/market\.js|js\/workshop\.js/);
  assert.doesNotMatch(partitions, /id:'market'|id:'workshop'/);
  assert.match(main, /ipcMain\.handle\('content:list'[\s\S]*?listPublicContent/);
  assert.match(preload, /content:\s*Object\.freeze\([\s\S]*?content:list/);
  assert.match(board, /class="ai-composer-templates"[\s\S]*?openMesssTemplateLibrary/);
  assert.match(migration, /create table if not exists public\.app_content_items/);
  assert.match(migration, /surface in \('templates', 'market'\)/);
  assert.match(migration, /music-cover[\s\S]*?stage-visual/);
  assert.match(migration, /revoke insert, update, delete[\s\S]*?anon, authenticated/);

  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
    await page.route('http://templates.test/', route => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html data-theme="dark"><body></body></html>'
    }));
    await page.goto('http://templates.test/');
    await page.addStyleTag({ content: `${themeStyles}\n${styles}` });
    await page.addScriptTag({ content: `
      window.t = (en, zh) => zh;
      window.messsAPI = { content: { list: async surface => ({ ok: true, items: surface === 'templates' ? [{
        id: 'remote-stage-loop', surface: 'templates', category: 'stage-visual', title: '远程舞台循环',
        description: '无需更新客户端出现', prompt: '远程模板提示词', kind: 'video', imageUrl: '',
        metadata: { tone: 'silver', categoryLabelZh: '舞美视觉' }, sortOrder: 1
      }] : [] }) } };
      ${templateLibrary}
      window.__selectedTemplate = null;
      openMesssTemplateLibrary({ onSelect: item => { window.__selectedTemplate = item; } });
    ` });
    await page.waitForFunction(() => document.querySelector('[data-template-id="remote-stage-loop"]'));
    await page.waitForTimeout(650);
    assert.equal(await page.locator('.messs-template-dialog').evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return Math.abs(rect.left + rect.width / 2 - innerWidth / 2) < 2
        && Math.abs(rect.top + rect.height / 2 - innerHeight / 2) < 2;
    }), true);
    assert.equal(await page.getByRole('button', { name: '音乐封面' }).count(), 1);
    assert.equal(await page.getByRole('button', { name: '舞美视觉' }).count(), 1);
    await page.locator('[data-template-id="remote-stage-loop"]').click();
    await page.waitForFunction(() => window.__selectedTemplate?.prompt === '远程模板提示词');
    await page.waitForFunction(() => !document.getElementById('messs-template-library'));
    assert.equal(await page.locator('#messs-template-library').count(), 0);

    await page.evaluate(() => openMesssTemplateLibrary({ onSelect: item => { window.__selectedTemplate = item; } }));
    await page.waitForFunction(() => document.querySelector('[data-template-id="remote-stage-loop"]'));
    await page.waitForTimeout(650);
    const artifactDir = path.join(root, 'test-artifacts', 'dynamic-content');
    fs.mkdirSync(artifactDir, { recursive: true });
    await page.screenshot({ path: path.join(artifactDir, 'template-library.png') });
    await page.setViewportSize({ width: 390, height: 800 });
    const mobileBounds = await page.locator('.messs-template-dialog').boundingBox();
    assert.ok(mobileBounds.x >= 11 && mobileBounds.x + mobileBounds.width <= 379);
    assert.ok(mobileBounds.y >= 11 && mobileBounds.y + mobileBounds.height <= 789);
    await page.screenshot({ path: path.join(artifactDir, 'template-library-mobile.png') });
  } finally {
    await browser.close();
  }
  console.log('Dynamic content passed: remote templates and responsive template dialog.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
