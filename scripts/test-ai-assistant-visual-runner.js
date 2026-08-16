'use strict';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  const root = path.join(__dirname, '..');
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#f5f5f7',
    webPreferences: { contextIsolation: false, nodeIntegration: false, sandbox: false, offscreen: true }
  });

  await window.loadFile(path.join(root, 'src', 'index.html'));
  await wait(900);
  await window.webContents.executeJavaScript(`(() => {
    document.documentElement.dataset.theme = 'light';
    document.documentElement.dataset.language = 'zh';
    const style = document.createElement('style');
    style.textContent = '.ai-assistant-panel,.ai-assistant-panel *{animation:none!important;transition:none!important}';
    document.head.appendChild(style);
    setAssistantFullscreen(true);
    document.getElementById('ai-assistant-home').hidden = false;
    document.getElementById('ai-assistant-messages').hidden = true;
    const history = document.getElementById('ai-chat-history-list');
    history.innerHTML = ['帮我理清产品首页的信息层级', '生成一张夏日音乐节海报', 'Understanding the Chinese market', '短视频镜头与节奏设计'].map((title, index) => '<div class="ai-chat-history-entry"><button class="ai-chat-history-item' + (index === 0 ? ' is-active' : '') + '"><span>' + title + '</span></button><button class="ai-chat-history-more">...</button></div>').join('');
    document.getElementById('ai-chat-history-empty').hidden = true;
  })()`);
  await wait(500);

  const metrics = await window.webContents.executeJavaScript(`(() => {
    const box = (selector) => {
      const element = document.querySelector(selector);
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const form = box('.ai-assistant-form');
    const mode = box('.ai-assistant-mode');
    const input = box('#ai-assistant-input');
    const footer = box('.ai-assistant-form-footer');
    const submit = box('#ai-assistant-submit');
    const historyItems = [...document.querySelectorAll('.ai-chat-history-item')].map((button) => {
      const rect = button.getBoundingClientRect();
      const label = button.querySelector('span');
      return { width: rect.width, height: rect.height, fontSize: getComputedStyle(button).fontSize, clipped: label.scrollWidth > label.clientWidth };
    });
    const quick = [...document.querySelectorAll('.ai-assistant-quick-prompts button')].map((button) => {
      const rect = button.getBoundingClientRect();
      return { text: button.textContent.trim(), left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, scrollWidth: button.scrollWidth, clientWidth: button.clientWidth };
    });
    return { form, mode, input, footer, submit, historyItems, quick, headingSize: getComputedStyle(document.querySelector('.ai-assistant-home h2')).fontSize };
  })()`);

  if (metrics.form.width < 700 || metrics.form.height < 120) {
    throw new Error(`Fullscreen assistant did not render at a useful size: ${JSON.stringify(metrics)}`);
  }
  if (metrics.mode.top < metrics.input.bottom - 1 || metrics.mode.bottom > metrics.form.bottom) {
    throw new Error(`Mode controls are not in the lower composer row: ${JSON.stringify(metrics)}`);
  }
  if (metrics.mode.left >= metrics.submit.left || metrics.submit.right > metrics.form.right) {
    throw new Error(`Composer footer alignment failed: ${JSON.stringify(metrics)}`);
  }
  if (metrics.quick.length !== 4 || metrics.quick.some((button) => button.scrollWidth > button.clientWidth + 1)) {
    throw new Error(`Quick actions are missing or clipped: ${JSON.stringify(metrics.quick)}`);
  }
  if (metrics.historyItems.length !== 4 || metrics.historyItems.some((item) => item.height < 40 || item.fontSize !== '15px')) {
    throw new Error(`History type does not match the reference scale: ${JSON.stringify(metrics.historyItems)}`);
  }
  for (let index = 1; index < metrics.quick.length; index += 1) {
    if (metrics.quick[index].left < metrics.quick[index - 1].right - 1) {
      throw new Error(`Quick actions overlap: ${JSON.stringify(metrics.quick)}`);
    }
  }

  const screenshotDir = path.join(root, 'test-artifacts');
  fs.mkdirSync(screenshotDir, { recursive: true });
  const screenshotPath = path.join(screenshotDir, 'ai-assistant-layout.png');
  fs.writeFileSync(screenshotPath, (await window.webContents.capturePage()).toPNG());

  window.setSize(900, 650);
  await wait(250);
  const compact = await window.webContents.executeJavaScript(`(() => {
    const form = document.querySelector('.ai-assistant-form').getBoundingClientRect();
    const footer = document.querySelector('.ai-assistant-form-footer').getBoundingClientRect();
    const quick = [...document.querySelectorAll('.ai-assistant-quick-prompts button')].map((button) => button.getBoundingClientRect());
    return { form: { left: form.left, right: form.right, bottom: form.bottom }, footer: { left: footer.left, right: footer.right }, quick: quick.map((rect) => ({ left: rect.left, right: rect.right, bottom: rect.bottom })) };
  })()`);
  if (compact.form.left < 264 || compact.form.right > 900 || compact.form.bottom > 650 || compact.footer.left < compact.form.left || compact.footer.right > compact.form.right) {
    throw new Error(`Compact assistant layout escaped the viewport: ${JSON.stringify(compact)}`);
  }
  if (compact.quick.some((button) => button.left < 264 || button.right > 900 || button.bottom > 650)) {
    throw new Error(`Compact quick actions escaped the viewport: ${JSON.stringify(compact.quick)}`);
  }

  await window.webContents.executeJavaScript(`(() => {
    setAssistantFullscreen(false);
    const main = document.querySelector('.main-app');
    main.style.gridTemplateColumns = '0 minmax(0, 1fr) 260px';
    const picker = document.querySelector('.ai-assistant-model-picker');
    picker.hidden = false;
    document.getElementById('ai-assistant-options-toggle').hidden = false;
    document.getElementById('ai-assistant-model-label').textContent = 'Nano Banana Pro';
    const estimate = document.getElementById('ai-assistant-credit-estimate');
    estimate.hidden = false;
    estimate.textContent = '16 积分';
  })()`);
  await wait(180);

  async function narrowAssistantMetrics(width) {
    await window.webContents.executeJavaScript(`document.querySelector('.main-app').style.gridTemplateColumns = '0 minmax(0, 1fr) ${width}px'`);
    await wait(120);
    return window.webContents.executeJavaScript(`(() => {
      const form = document.querySelector('.ai-assistant-form').getBoundingClientRect();
      const footer = document.querySelector('.ai-assistant-form-footer').getBoundingClientRect();
      const controls = [...document.querySelectorAll('.ai-assistant-mode button, #ai-assistant-model-trigger, #ai-assistant-options-toggle, #ai-assistant-credit-estimate, #ai-assistant-submit')]
        .filter((element) => !element.hidden && getComputedStyle(element).display !== 'none')
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return { id: element.id || element.dataset.assistantKind, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
        });
      const overlaps = [];
      for (let left = 0; left < controls.length; left += 1) {
        for (let right = left + 1; right < controls.length; right += 1) {
          const a = controls[left];
          const b = controls[right];
          if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) {
            overlaps.push([a.id, b.id]);
          }
        }
      }
      return {
        form: { left: form.left, right: form.right },
        footer: { left: footer.left, right: footer.right, height: footer.height },
        controls,
        overlaps,
        escaped: controls.filter((control) => control.left < form.left - 1 || control.right > form.right + 1).map((control) => control.id)
      };
    })()`);
  }

  const narrow = await narrowAssistantMetrics(260);
  const minimum = await narrowAssistantMetrics(220);
  if (narrow.overlaps.length || narrow.escaped.length || narrow.footer.height < 60) {
    throw new Error(`Narrow assistant controls overlap: ${JSON.stringify(narrow)}`);
  }
  if (minimum.overlaps.length || minimum.escaped.length || minimum.footer.height < narrow.footer.height) {
    throw new Error(`Minimum-width assistant controls overlap: ${JSON.stringify(minimum)}`);
  }
  fs.writeFileSync(path.join(screenshotDir, 'ai-assistant-narrow.png'), (await window.webContents.capturePage()).toPNG());
  window.destroy();
  process.stdout.write(`AI_ASSISTANT_VISUAL_OK heading=${metrics.headingSize} form=${Math.round(metrics.form.width)}x${Math.round(metrics.form.height)} quick=${metrics.quick.map((item) => item.text).join('|')} screenshot=${screenshotPath}\n`);
}

app.whenReady().then(run).then(() => app.quit()).catch((error) => {
  console.error(error && error.stack || error);
  app.exit(1);
});
