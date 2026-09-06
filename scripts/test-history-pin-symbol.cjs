const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/js/app.js', route => route.fulfill({ body: '' }));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    const result = await page.evaluate(() => {
      window.activeCanvasId = () => 'canvas';
      const sessions = [false, true].map((favorite, i) => ({ id: String(i), canvasId: 'canvas', title: 'Conversation', favorite, updatedAt: new Date().toISOString() }));
      AiAssistant.sessions = sessions;
      CanvasWorkspace.agentSessions = sessions;
      const read = () => {
        renderAiChatHistory();
        renderCanvasAgentHistory();
        return ['ai-chat-history-entry', 'board-agent-history-row'].map(selector =>
          [0, 1].map(id => document.querySelector(`.${selector}[data-session-id="${id}"] [class$="history-star"]`).textContent));
      };
      const before = read();
      sessions[0].favorite = true;
      sessions[1].favorite = false;
      return { before, after: read(), menu: !!document.querySelector('.ai-chat-history-more') };
    });
    assert.deepEqual(result.before, [['', '\u2605'], ['', '\u2605']]);
    assert.deepEqual(result.after, [['\u2605', ''], ['\u2605', '']]);
    assert.equal(result.menu, true);
    console.log('History pin symbols passed: main assistant and canvas Agent, pin/unpin, actions retained.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
