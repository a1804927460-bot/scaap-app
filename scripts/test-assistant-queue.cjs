const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/js/app.js', r => r.fulfill({ body: '' }));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    await page.evaluate(() => {
      delete document.documentElement.dataset.startupPending;
      const form = document.getElementById('ai-assistant-form');
      document.body.replaceChildren(form);
      form.style.cssText = 'width: min(700px, 95vw);margin:20px auto;display:flex;flex-direction:column;';
      window.t = (en) => en;
      window.calls = []; window.resolvers = [];
      window.activeCanvasId = () => 'original-canvas';
      window.selectedAssistantProvider = () => ({ name: 'Model A', providerId: 'p', model: 'a' });
      window.renderAssistantAttachments = () => {};
      window.ensureAiChatSession = () => { AiAssistant.activeSessionId = 'session-a'; };
      window.persistActiveAiChatSession = () => {};
      window.appendAssistantMessageAttachments = () => {};
      window.appendAssistantOutputFiles = () => {};
      window.showToast = () => {};
      window.appendAssistantText = () => {
        const row = document.createElement('div');
        row.innerHTML = '<div class="ai-assistant-message-body"></div>';
        return row;
      };
      window.messsAPI = { chatWithAi: request => new Promise(resolve => {
        calls.push(structuredClone(request)); resolvers.push(resolve);
      }) };
      window.send = prompt => {
        document.getElementById('ai-assistant-input').value = prompt;
        submitAssistantMessage();
      };
      send('first'); send('second'); send('third');
    });
    assert.equal(await page.evaluate(() => calls.length), 1);
    await page.evaluate(() => { window.activeCanvasId = () => 'different-canvas'; });
    assert.equal(await page.evaluate(() => AiAssistant.queue[0].canvasId), 'original-canvas');
    assert.equal(await page.locator('.assistant-queue-item').count(), 2);
    await page.locator('.assistant-queue-item').first().getByRole('button', { name: 'Edit', exact: true }).click();
    await page.locator('#ai-assistant-queue textarea').fill('edited second');
    await page.evaluate(() => resolvers.shift()({ ok: true, text: 'first answer' }));
    await page.waitForFunction(() => !AiAssistant.queueRunning);
    assert.equal(await page.evaluate(() => calls.length), 1, 'Do not dispatch while editing');
    await page.locator('.assistant-queue-item').last().getByRole('button', { name: 'Delete queued message' }).click();
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.body.dataset.theme = theme; }, theme);
      await page.setViewportSize({ width: 480, height: 800 });
      await page.waitForTimeout(400);
      fs.mkdirSync('test-artifacts/assistant-queue', { recursive: true });
      await page.screenshot({ path: `test-artifacts/assistant-queue/${theme}.png` });
    }
    await page.locator('#ai-assistant-queue').getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForFunction(() => calls.length === 2);
    assert.equal(await page.evaluate(() => calls[1].prompt), 'edited second');
    assert.equal(await page.evaluate(() => calls[1].messages[1].content), 'first answer');
    await page.evaluate(() => { send('fourth'); send('fifth'); });
    await page.locator('.assistant-queue-item').last().getByRole('button', { name: 'Move up' }).click();
    await page.evaluate(() => resolvers.shift()({ ok: false, message: 'failed' }));
    await page.waitForFunction(() => !AiAssistant.queueRunning);
    assert.equal(await page.evaluate(() => AiAssistant.queuePaused), true);
    assert.equal(await page.evaluate(() => calls.length), 2);
    await page.locator('#ai-assistant-queue').getByRole('button', { name: 'Continue queue' }).click();
    await page.waitForFunction(() => calls.length === 3);
    assert.equal(await page.evaluate(() => calls[2].prompt), 'fifth');
    await page.evaluate(() => resolvers.shift()({ ok: true, text: 'fifth answer' }));
    await page.waitForFunction(() => calls.length === 4);
    assert.equal(await page.evaluate(() => calls[3].prompt), 'fourth');
    await page.evaluate(() => resolvers.shift()({ ok: true, text: 'fourth answer' }));
    await page.waitForFunction(() => !AiAssistant.queueRunning);
    assert.equal(await page.evaluate(() => AiAssistant.activeTasks), 0);
    assert.equal(await page.locator('#ai-assistant-queue').isVisible(), false);
    console.log('Queue passed: FIFO, edit lock, delete, reorder, failure pause, manual resume, context continuity.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
