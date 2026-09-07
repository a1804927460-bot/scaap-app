'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/js/app.js', route => route.fulfill({ body: '' }));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    await page.evaluate(() => {
      delete document.documentElement.dataset.startupPending;
      document.body.innerHTML = '<main style="max-width:700px;margin:24px auto;padding:16px"><div class="ai-assistant-messages"><div id="main-pending" class="ai-assistant-message is-pending is-chat-thinking"><div class="ai-assistant-message-body">Thinking...</div></div></div><section id="board-agent-panel" style="position:static;width:100%;transform:none;margin-top:28px"><div class="board-agent-messages"><div id="canvas-pending" class="board-agent-message is-pending">Thinking...</div></div></section></main>';
      window.t = (en, zh) => zh;
      window.listeners = new Set();
      window.completions = new Map();
      window.tasks = [];
      window.messsAPI = {
        onAiChatDelta(callback) { listeners.add(callback); return () => listeners.delete(callback); },
        estimateAgentCredits: async () => ({ available: true, min: 0.04, max: 0.23 }),
        chatWithAi: request => new Promise(resolve => completions.set(request.workRequestId, resolve))
      };
      for (const id of ['main', 'canvas']) {
        tasks.push(chatWithAgentEstimate(document.getElementById(`${id}-pending`), { prompt: 'test', workRequestId: id }));
      }
      window.emit = (requestId, text) => listeners.forEach(listener => listener({ requestId, text }));
      emit('unrelated', 'MUST NOT APPEAR');
      emit('main', '\u6211\u4f1a\u5148\u68c0\u67e5\u8d44\u6599\uff0c\u518d\u6574\u7406\u4e3a\u53ef\u4e0b\u8f7d\u7684\u6587\u4ef6\u3002');
      emit('canvas', '\u6b63\u5728\u6574\u7406\u753b\u5e03\u4e2d\u7684\u5185\u5bb9\u3002');
    });
    assert.equal(await page.locator('.is-streaming').count(), 2);
    assert.equal(await page.locator('main').innerText().then(text => text.includes('MUST NOT APPEAR')), false);
    await page.evaluate(() => emit('main', '<img src=x onerror="window.bad=true">'));
    assert.equal(await page.locator('#main-pending img').count(), 0, 'Stream previews must be inert text');
    await page.evaluate(() => emit('main', '\u6211\u4f1a\u5148\u68c0\u67e5\u8d44\u6599\uff0c\u518d\u6574\u7406\u4e3a\u53ef\u4e0b\u8f7d\u7684\u6587\u4ef6\u3002\n\u5df2\u6536\u5230\u7b2c\u4e00\u90e8\u5206\u5185\u5bb9\u3002'));
    for (const theme of ['light', 'dark']) {
      for (const width of [480, 1280]) {
        await page.setViewportSize({ width, height: 800 });
        await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.body.dataset.theme = theme; }, theme);
        await page.waitForTimeout(350);
        fs.mkdirSync('test-artifacts/chat-stream', { recursive: true });
        await page.screenshot({ path: `test-artifacts/chat-stream/${theme}-${width}.png` });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      }
    }
    await page.evaluate(async () => {
      document.getElementById('canvas-pending').remove();
      emit('canvas', 'detached');
      completions.forEach(resolve => resolve({ ok: true, text: 'final' }));
      await Promise.all(tasks);
    });
    assert.equal(await page.evaluate(() => listeners.size), 0);
    assert.equal(await page.locator('.is-streaming').count(), 0);
    assert.equal(await page.locator('[data-credit-estimate]').count(), 0);
    const before = await page.locator('#main-pending').innerText();
    await page.evaluate(() => emit('main', 'late'));
    assert.equal(await page.locator('#main-pending').innerText(), before);
    // Both real thinking timers must yield once actual streamed content exists.
    assert.match(fs.readFileSync('src/js/ai-assistant.js', 'utf8'), /const progress = setInterval\(\(\) => \{\s*if \(pending\.dataset\.streaming === 'true'\) return/);
    assert.equal((fs.readFileSync('src/js/canvas-workspace.js', 'utf8').match(/if \(!pending\.isConnected \|\| pending\.dataset\.streaming === 'true'\) return/g) || []).length, 2);
    console.log('Both Agent streaming previews: isolation, cleanup, safe text, desktop/compact light/dark passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
