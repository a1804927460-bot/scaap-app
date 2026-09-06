const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/js/app.js', route => route.fulfill({ body: '' }));
    await page.goto(pathToFileURL(path.join(root, 'src/index.html')).href);
    await page.evaluate(() => {
      delete document.documentElement.dataset.startupPending;
      const form = document.querySelector('.ai-assistant-form').cloneNode(true);
      document.body.replaceChildren();
      const panel = document.createElement('div');
      panel.className = 'ai-assistant-panel';
      panel.style.cssText = 'display:block;position:fixed;inset:auto 16px 16px;width:auto;height:220px';
      form.style.cssText = 'display:block;position:relative;width:100%;height:220px;margin:0';
      panel.append(form); document.body.append(panel);
      document.getElementById('ai-assistant-options-toggle').hidden = false;
      document.getElementById('ai-assistant-ratio').replaceChildren(...['auto','1:1','16:9','9:16','4:3','3:4','3:2','2:3','5:4','4:5','21:9'].map(value => new Option(value === 'auto' ? '自动' : value, value)));
      document.getElementById('ai-assistant-size-wrap').hidden = false;
      document.getElementById('ai-assistant-count-wrap').hidden = false;
      document.getElementById('ai-assistant-duration-wrap').hidden = true;
      document.querySelector('[data-option-picker="ai-assistant-ratio"]').parentElement.firstElementChild.textContent = '画面比例';
      document.querySelector('#ai-assistant-size-wrap > span').textContent = '分辨率';
      document.querySelector('#ai-assistant-count-wrap > span').textContent = '数量';
      window.AiAssistant = { kind: 'image' }; window.t = (en, zh) => zh;
    });
    const source = fs.readFileSync(path.join(root, 'src/js/ai-assistant.js'), 'utf8');
    await page.evaluate('void 0;\n' + source.slice(source.indexOf('function closeAssistantOptionMenus('), source.indexOf('function setAssistantKind(')));
    await page.evaluate(() => {
      initAssistantOptionPickers();
      document.getElementById('ai-assistant-options-toggle').addEventListener('click', () => setAssistantOptionsOpen(document.getElementById('ai-assistant-options').hidden));
      document.getElementById('ai-assistant-options').addEventListener('change', () => { refreshAssistantOptionPickers(); refreshAssistantOptionSummary(); });
    });
    fs.mkdirSync(path.join(root, 'test-artifacts/parameter-popover'), { recursive: true });
    for (const width of [1200, 420]) {
      await page.setViewportSize({ width, height: 820 });
      for (const theme of ['dark', 'light']) {
        await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.body.dataset.theme = theme; setAssistantOptionsOpen(false); }, theme);
        const before = await page.locator('.ai-assistant-form').boundingBox();
        await page.locator('#ai-assistant-options-toggle').click();
        assert.deepEqual(await page.locator('.ai-assistant-form').boundingBox(), before);
        await page.locator('[data-option-picker="ai-assistant-ratio"] [data-option-value="16:9"]').click();
        await page.locator('[data-option-picker="ai-assistant-size"] [data-option-value="2K"]').click();
        await page.locator('[data-option-picker="ai-assistant-count"] [data-option-value="3"]').click();
        assert.equal(await page.locator('#ai-assistant-ratio').inputValue(), '16:9');
        assert.equal(await page.locator('#ai-assistant-size').inputValue(), '2K');
        assert.equal(await page.locator('#ai-assistant-count').inputValue(), '3');
        const popup = await page.locator('#ai-assistant-options').boundingBox();
        const trigger = await page.locator('#ai-assistant-options-toggle').boundingBox();
        assert.ok(popup.y >= 0 && popup.x >= 0 && popup.x + popup.width <= width && popup.y + popup.height <= trigger.y);
        await page.waitForTimeout(350);
        await page.screenshot({ path: path.join(root, `test-artifacts/parameter-popover/${theme}-${width}.png`) });
        await page.keyboard.press('Escape');
        assert.ok(await page.locator('#ai-assistant-options').isHidden());
        await page.locator('#ai-assistant-options-toggle').click();
        await page.mouse.click(5, 5);
        assert.ok(await page.locator('#ai-assistant-options').isHidden());
      }
    }
    console.log('Parameter popover: selection, stable composer, viewport bounds, dismissal and four layouts passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
