'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 720, height: 620 } });
    await page.route('**/js/app.js', route => route.fulfill({ body: '' }));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    await page.evaluate(() => {
      delete document.documentElement.dataset.startupPending;
      document.documentElement.dataset.theme = 'dark';
      document.body.dataset.theme = 'dark';
      document.body.innerHTML = `
        <main style="max-width:620px;margin:36px auto;display:grid;gap:28px">
          <section class="ai-assistant-panel" style="position:static;width:auto;height:auto;padding:24px">
            <div class="ai-assistant-message is-assistant">
              <div id="main-agent-reply" class="ai-assistant-message-body" style="max-width:100%;padding:18px">主 Agent 已完成的文字回答。右键时应显示选中效果。</div>
            </div>
          </section>
          <section id="board-agent-panel" style="position:static;width:auto;height:auto;transform:none;padding:24px">
            <div class="board-agent-messages" style="margin:0;padding:0">
              <div id="canvas-agent-reply" class="board-agent-message is-assistant">画布 Agent 已完成的文字回答。右键时应显示选中效果。</div>
            </div>
          </section>
        </main>`;
      window.t = (en, zh) => zh;
    });

    async function openMenu(selector, x, y) {
      await page.evaluate(({ selector, x, y }) => {
        const target = document.querySelector(selector);
        showAgentTextContextMenu({ target, clientX: x, clientY: y, preventDefault() {}, stopPropagation() {} });
      }, { selector, x, y });
      assert.equal(await page.locator(selector).evaluate(element => element.classList.contains('is-agent-context-selected')), true);
      assert.equal(await page.locator('#agent-text-context-menu').isVisible(), true);
    }

    await openMenu('#main-agent-reply', 420, 140);
    const outline = await page.locator('#main-agent-reply').evaluate(element => getComputedStyle(element).boxShadow);
    assert.notEqual(outline, 'none');
    fs.mkdirSync('test-artifacts/agent-text-context', { recursive: true });
    await page.screenshot({ path: 'test-artifacts/agent-text-context/selected-dark.png' });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#main-agent-reply').evaluate(element => element.classList.contains('is-agent-context-selected')), false);

    await openMenu('#canvas-agent-reply', 410, 360);
    await page.mouse.click(24, 24);
    assert.equal(await page.locator('#canvas-agent-reply').evaluate(element => element.classList.contains('is-agent-context-selected')), false);
    console.log('Agent text context selection passed: main/canvas highlight, Escape and outside-click cleanup.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
