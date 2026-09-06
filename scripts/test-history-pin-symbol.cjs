const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
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
    assert.equal(await page.locator('.ai-chat-history-copy small').count(),0);
    assert.equal(await page.locator('.ai-chat-history-item').first().getAttribute('title'),'Conversation');
    await page.evaluate(()=>{
      delete document.documentElement.dataset.startupPending;
      const panel=document.getElementById('ai-assistant-panel');document.body.append(panel);
      panel.hidden=false;panel.classList.add('is-fullscreen');panel.style.display='flex';
      AiAssistant.sessions=Array.from({length:12},(_,i)=>({id:String(i),title:'\u5e2e\u6211\u8bbe\u8ba1\u4e00\u5f20\u821e\u7f8e\u89c6\u89c9\u6d77\u62a5 '+i,updatedAt:new Date().toISOString()}));
      renderAiChatHistory();
    });
    fs.mkdirSync('test-artifacts/history-density',{recursive:true});
    for(const theme of ['light','dark']){
      await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
      await page.waitForTimeout(400);
      assert.equal(await page.locator('.ai-chat-history-item').first().evaluate(el=>getComputedStyle(el).fontSize),'13px');
      await page.locator('.ai-chat-history-sidebar').screenshot({path:`test-artifacts/history-density/${theme}.png`});
    }
    const scrolling = await page.locator('.ai-chat-history-sections').evaluate(el => {
      el.style.height='220px'; el.style.flex='0 0 220px';
      el.scrollTop=80;
      return { width:getComputedStyle(el,'::-webkit-scrollbar').width, top:el.scrollTop,
        track:getComputedStyle(el,'::-webkit-scrollbar-track').backgroundColor, clientWidth:el.clientWidth };
    });
    assert.equal(scrolling.width,'6px');
    assert.equal(scrolling.track,'rgba(0, 0, 0, 0)');
    assert.ok(scrolling.top>0);
    await page.locator('.ai-chat-history-sections').hover();
    assert.equal(await page.locator('.ai-chat-history-sections').evaluate(el=>el.clientWidth),scrolling.clientWidth);
    console.log('History pin symbols passed: main assistant and canvas Agent, pin/unpin, actions retained.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
