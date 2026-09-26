'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  const source = fs.readFileSync(path.join(root, 'src/js/board-canvas.js'), 'utf8');
  const themeStyles = fs.readFileSync(path.join(root, 'src/styles/theme.css'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'src/styles/main.css'), 'utf8');
  const settingsStart = source.indexOf('const MESSS_SHORTCUTS_STORAGE_KEY');
  const settingsEnd = source.indexOf('function boardFullscreenToggleTitle', settingsStart);
  const renderStart = source.indexOf('function renderShortcutsPopover');
  const renderEnd = source.indexOf('function refreshBoardLanguage', renderStart);
  assert.ok(settingsStart >= 0 && settingsEnd > settingsStart && renderStart >= 0 && renderEnd > renderStart);

  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.route('http://shortcut.test/', route => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html data-theme="dark"><body></body></html>'
    }));
    await page.goto('http://shortcut.test/');
    await page.addStyleTag({ content: `${themeStyles}\n${styles}` });
    await page.addScriptTag({ content: `
      window.t = (en, zh) => zh;
      window.escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
      window.showToast = message => { window.__toast = message; };
      ${source.slice(settingsStart, settingsEnd)}
      ${source.slice(renderStart, renderEnd)}
      window.ShortcutTest = { renderShortcutsPopover, matchesMesssShortcut, getMesssShortcutBindings };
    ` });

    await page.evaluate(() => {
      const overlay = document.createElement('div');
      overlay.id = 'shortcuts-popover';
      overlay.className = 'shortcuts-overlay is-settings-shortcuts';
      overlay._closeShortcuts = () => overlay.remove();
      document.body.append(overlay);
      ShortcutTest.renderShortcutsPopover(overlay);
    });
    await page.locator('.shortcuts-popover').evaluate(async (dialog) => {
      await Promise.all(dialog.getAnimations().map((animation) => animation.finished));
    });
    assert.equal(await page.locator('button[data-shortcut-category]').count(), 3);
    let bounds = await page.locator('.shortcuts-popover').boundingBox();
    assert.ok(Math.abs(bounds.x + bounds.width / 2 - 600) < 2, JSON.stringify(bounds));
    assert.ok(Math.abs(bounds.y + bounds.height / 2 - 400) < 2, JSON.stringify(bounds));

    await page.locator('[data-shortcut-category="view"]').click();
    await page.locator('[data-shortcut-action="zoomIn"]').click();
    await page.keyboard.press('Control+Shift+K');
    assert.equal(await page.locator('[data-shortcut-action="zoomIn"]').innerText(), 'Ctrl + Shift + K');
    await page.locator('[data-shortcut-save]').click();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('messs.canvas-shortcuts.v1')).zoomIn.code), 'KeyK');
    assert.equal(await page.evaluate(() => ShortcutTest.matchesMesssShortcut(new KeyboardEvent('keydown', { code: 'KeyK', ctrlKey: true, shiftKey: true }), 'zoomIn')), true);
    assert.equal(await page.evaluate(() => ShortcutTest.matchesMesssShortcut(new KeyboardEvent('keydown', { code: 'Equal', ctrlKey: true }), 'zoomIn')), false);

    await page.evaluate(() => {
      const overlay = document.createElement('div');
      overlay.id = 'shortcuts-popover';
      overlay.className = 'shortcuts-overlay is-settings-shortcuts';
      overlay._closeShortcuts = () => overlay.remove();
      document.body.append(overlay);
      ShortcutTest.renderShortcutsPopover(overlay);
    });
    await page.locator('[data-shortcut-category="view"]').click();
    await page.locator('[data-shortcut-action="zoomOut"]').click();
    await page.keyboard.press('Control+Shift+K');
    assert.match(await page.locator('.shortcuts-record-status').innerText(), /已被/);

    await page.setViewportSize({ width: 390, height: 760 });
    bounds = await page.locator('.shortcuts-popover').boundingBox();
    assert.ok(bounds.x >= 13 && bounds.x + bounds.width <= 377);
    assert.ok(bounds.y >= 13 && bounds.y + bounds.height <= 747);
    const artifactDir = path.join(root, 'test-artifacts/shortcut-settings');
    fs.mkdirSync(artifactDir, { recursive: true });
    await page.screenshot({ path: path.join(artifactDir, 'mobile.png') });
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.screenshot({ path: path.join(artifactDir, 'desktop.png') });
    console.log('Shortcut settings passed: centered dialog, rebinding, persistence, conflict protection and responsive layout.');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
