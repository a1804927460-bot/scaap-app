const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
    await page.route('**/js/app.js', r => r.fulfill({ body: '' }));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    await page.evaluate(() => {
      delete document.documentElement.dataset.startupPending;
      window.messsAPI = { onAchievementsUpdated() {} };
      window.renderTopStats = () => {};
      initStatsDetail();
      setAssistantFullscreen(true, { syncNavigation: true });
    });
    for (const target of ['#ai-assistant-home-button', '#ai-assistant-history']) {
      await page.evaluate(() => {
        AiAssistant.sessions = [{ id: 'saved-chat', title: 'Saved conversation', messages: [{ role: 'user', text: 'Keep this conversation' }], updatedAt: Date.now() }];
        AiAssistant.activeSessionId = 'saved-chat';
        AiAssistant.messages = [{ role: 'user', text: 'Keep this conversation' }];
        document.getElementById('ai-assistant-home').hidden = true;
        document.getElementById('ai-assistant-messages').hidden = false;
      });
      await page.locator(target).click();
      assert.equal(await page.locator('#ai-assistant-home').isVisible(), true);
      assert.equal(await page.locator('#ai-assistant-messages').isVisible(), false);
      assert.equal(await page.evaluate(() => AiAssistant.sessions[0].messages[0].text), 'Keep this conversation');
      assert.equal(await page.evaluate(() => AiAssistant.activeSessionId), null);
      assert.equal(await page.locator('.section-tab[data-section="assistant"]').getAttribute('aria-selected'), 'true');
    }
    fs.mkdirSync('test-artifacts/assistant-home', { recursive: true });
    for (const theme of ['dark', 'light']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      const colors = await page.evaluate(() => ({
        word: getComputedStyle(document.querySelector('.ai-assistant-brand-word')).color,
        dot: getComputedStyle(document.querySelector('.ai-assistant-brand-dot')).color
      }));
      assert.equal(colors.word, colors.dot);
      await page.screenshot({ path: `test-artifacts/assistant-home/${theme}.png` });
    }
    console.log('Both header buttons return home, preserve history and navigation; brand punctuation matches in both themes.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
