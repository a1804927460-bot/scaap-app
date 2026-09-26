const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const extract = (file, start, end) => {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  return source.slice(source.indexOf(`function ${start}(`), source.indexOf(`function ${end}(`));
};
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/js/app.js', route => route.fulfill({ body: '' }));
    await page.goto(pathToFileURL(path.join(root, 'src/index.html')).href);
    await page.evaluate(() => {
      delete document.documentElement.dataset.startupPending;
      const assistant = document.querySelector('.ai-assistant-model-picker').cloneNode(true);
      const agent = document.querySelector('.board-agent-model-picker').cloneNode(true);
      document.body.replaceChildren(assistant, agent);
      document.body.style.cssText = 'display:flex;gap:24px;padding:16px;align-items:flex-start;overflow:auto';
      for (const picker of [assistant, agent]) picker.style.cssText = 'width:300px;flex:0 0 300px';
      for (const id of ['ai-assistant-submit']) {
        const button = document.createElement('button'); button.id = id; document.body.append(button);
      }
      window.t = (en, zh) => zh;
      window.testProviders = ['gemini-3.8-flash', 'gemini-3.1-pro', 'gpt-5.6-sol', 'kimi-k3'].map((model, i) => ({
        id: `chat-${i}::${model}`, providerId: `chat-${i}`, model, name: model
      }));
      window.AiAssistant = { kind: 'chat', config: {} };
      window.configuredAssistantProviders = () => testProviders;
      window.syncAssistantMediaOptions = () => {};
      window.updateAssistantCreditEstimate = () => {};
      window.CanvasWorkspace = { agentMode: 'chat', agentChatProviderId: 'chat-1', agentChatModel: 'gemini-3.1-pro' };
      window.canvasAgentChatProviders = () => testProviders;
      window.canvasAgentMediaProviders = () => [{ id: 'image-1', name: 'Nano Banana Pro' }, { id: 'image-2', name: 'Nano Banana 2' }, { id: 'image-6', name: 'GPT Image 2' }];
      window.activeCanvasAgentProvider = () => testProviders.find(p => p.model === CanvasWorkspace.agentChatModel);
    });
    await page.evaluate(extract('src/js/ai-assistant.js', 'renderAssistantModels', 'selectedAssistantProvider'));
    await page.evaluate(extract('src/js/canvas-workspace.js', 'renderCanvasAgentModels', 'canvasAgentReferenceLimit'));
    await page.evaluate(() => { renderAssistantModels(); renderCanvasAgentModels(); });
    for (const menu of ['ai-assistant-model-menu', 'board-agent-model-menu']) {
      await page.locator(`#${menu}`).evaluate(el => { el.hidden = false; el.style.cssText = 'position:relative;left:0;bottom:auto;width:100%;max-height:none'; });
      assert.equal(await page.locator(`#${menu} .ai-chat-preset`).count(), 3);
      for (const model of ['gemini-3.8-flash', 'gemini-3.1-pro', 'gpt-5.6-sol']) {
        await page.locator(`#${menu}`).evaluate(el => { el.hidden = false; });
        await page.locator(`#${menu} [data-preset-model="${model}"]`).click();
        assert.equal(await page.evaluate(id => id === 'ai-assistant-model-menu'
          ? document.getElementById('ai-assistant-model').value.split('::')[1]
          : CanvasWorkspace.agentChatModel, menu), model);
        const labelId = menu === 'ai-assistant-model-menu' ? 'ai-assistant-model-label' : 'board-agent-model-label';
        const expected = { 'gemini-3.8-flash': '\u5feb\u901f', 'gemini-3.1-pro': '\u5747\u8861', 'gpt-5.6-sol': '\u6781\u81f4' }[model];
        assert.equal(await page.locator(`#${labelId}`).textContent(), expected);
        assert.equal(await page.locator(`#${menu} .ai-chat-preset.is-active, #${menu} .ai-model-picker-option.is-active, #${menu} [data-agent-chat-model].is-active`).count(), 1);
      }
      await page.locator(`#${menu}`).evaluate(el => { el.hidden = false; });
    }
    assert.equal(await page.locator('.ai-model-picker-option').count(), 0);
    assert.equal(await page.locator('[data-agent-chat-model]').count(), 0);
    assert.equal(await page.locator('#board-agent-model-options button').count(), 3);
    fs.mkdirSync(path.join(root, 'test-artifacts/chat-presets'), { recursive: true });
    for (const width of [1440, 720]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ['dark', 'light']) {
        await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.body.dataset.theme = theme; }, theme);
        await page.waitForFunction(() => [...document.querySelectorAll('.ai-chat-preset-icon')].every(img => img.complete && img.naturalWidth > 0));
        await page.waitForTimeout(350);
        const sizes = await page.locator('#board-agent-model-options button > span').evaluateAll(labels => labels.map(el => ({ width: el.clientWidth, scroll: el.scrollWidth })));
        assert.ok(sizes.every(size => size.width > 180 && size.scroll <= size.width));
        await page.screenshot({ path: path.join(root, `test-artifacts/chat-presets/${theme}-${width}.png`) });
      }
    }
    await page.evaluate(() => {
      const holder = document.createElement('div');
      MesssAiProviderOptions.appendChatPresets(holder, [], null, () => { throw new Error('Unavailable model selected'); }, t);
      if ([...holder.querySelectorAll('button')].some(button => !button.disabled)) throw new Error('Unavailable preset enabled');
    });
    console.log('Chat presets: both selectors, hidden provider identities, model mappings, missing providers and four layouts passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
