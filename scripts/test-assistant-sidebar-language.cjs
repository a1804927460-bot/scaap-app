const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try {
    const page = await browser.newPage();
    await page.route('**/js/app.js', route => route.fulfill({body:''}));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    await page.evaluate(() => {
      AppState.language = 'zh';
      window.loadAiChatHistory = async () => {};
      window.refreshAssistantConfig = async () => {};
      window.startAiDynamicPrompt = () => {};
      initAiAssistant();
    });
    const labels = () => page.evaluate(() => [
      document.querySelector('#ai-chat-new > span').textContent,
      document.getElementById('ai-chat-history-pinned-label').textContent,
      document.getElementById('ai-chat-history-recent-label').textContent
    ]);
    assert.deepEqual(await labels(),['新对话','置顶','最近']);
    assert.equal(await page.locator('.ai-chat-history-heading').count(),0);
    for (const language of ['en','zh']) {
      await page.evaluate(language => {
        AppState.language = language;
        document.dispatchEvent(new Event('messs:language-changed'));
      }, language);
      assert.deepEqual(await labels(),language === 'zh' ? ['新对话','置顶','最近'] : ['New chat','Pinned','Recent']);
    }
    assert.equal(await page.locator('#ai-chat-new > svg').count(),1);
    console.log('Assistant sidebar: initial Chinese, English/Chinese switching, no redundant heading and preserved icon passed.');
  } finally {await browser.close();}
})().catch(error => {console.error(error);process.exitCode=1;});
