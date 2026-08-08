'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { app, BrowserWindow } = require('electron');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const fixtureSummary = {
  authenticated: true,
  summary: {
    range: '30d',
    period: { from: '2026-07-10', to: '2026-08-08', days: 30 },
    account: { balance: 1280, reserved: 40, availableCredits: 1240, membershipTier: 'free' },
    totals: { credits: 286, generations: 17, requests: 17, averagePerDay: 9.53 },
    byType: [
      { kind: 'image', credits: 126, generations: 10, requests: 10 },
      { kind: 'video', credits: 160, generations: 7, requests: 7 },
      { kind: 'chat', credits: 0, generations: 0, requests: 23 }
    ],
    daily: Array.from({ length: 30 }, (_, index) => ({
      date: `2026-07-${String(10 + index).padStart(2, '0')}`,
      credits: [0, 8, 12, 4, 0, 18, 6, 10, 22, 9][index % 10],
      generations: index % 3,
      requests: index % 3
    })).map((entry, index) => index < 22 ? entry : ({ ...entry, date: `2026-08-${String(index - 21).padStart(2, '0')}` })),
    byModel: [
      { providerId: 'video-1', kind: 'video', credits: 160, generations: 7, requests: 7 },
      { providerId: 'image-1', kind: 'image', credits: 80, generations: 5, requests: 5 },
      { providerId: 'image-6', kind: 'image', credits: 46, generations: 5, requests: 5 },
      { providerId: 'chat-2', kind: 'chat', credits: 0, generations: 0, requests: 23 }
    ]
  }
};

async function inspectLayout(window, label) {
  const layout = await window.webContents.executeJavaScript(`(() => {
    const manager = document.querySelector('.ai-provider-manager').getBoundingClientRect();
    const usage = document.getElementById('settings-usage-view');
    const usageRect = usage.getBoundingClientRect();
    const toolbar = document.querySelector('.usage-page-toolbar').getBoundingClientRect();
    const range = document.getElementById('usage-range-switch').getBoundingClientRect();
    const dashboard = document.getElementById('usage-dashboard');
    const loading = document.getElementById('usage-loading');
    const auth = document.getElementById('usage-auth-state');
    const error = document.getElementById('usage-error-state');
    return {
      viewport: { width: innerWidth, height: innerHeight },
      manager: { left: manager.left, top: manager.top, right: manager.right, bottom: manager.bottom, width: manager.width, height: manager.height },
      usage: { width: usageRect.width, height: usageRect.height, scrollWidth: usage.scrollWidth, clientWidth: usage.clientWidth, scrollHeight: usage.scrollHeight, clientHeight: usage.clientHeight },
      toolbar: { left: toolbar.left, top: toolbar.top, right: toolbar.right, bottom: toolbar.bottom },
      range: { left: range.left, top: range.top, right: range.right, bottom: range.bottom },
      dashboardVisible: !dashboard.hidden,
      state: { loading: !loading.hidden, auth: !auth.hidden, error: !error.hidden, errorMessage: document.getElementById('usage-error-message').textContent }
    };
  })()`);
  const { viewport, manager, usage, range } = layout;
  if (manager.left < 0 || manager.top < 0 || manager.right > viewport.width || manager.bottom > viewport.height) {
    throw new Error(`${label} manager escaped viewport: ${JSON.stringify(layout)}`);
  }
  if (usage.scrollWidth > usage.clientWidth + 1) throw new Error(`${label} usage has horizontal overflow: ${JSON.stringify(usage)}`);
  if (range.left < manager.left || range.right > manager.right || range.top < manager.top || range.bottom > manager.bottom) {
    throw new Error(`${label} range switch is clipped: ${JSON.stringify(layout)}`);
  }
  if (!layout.dashboardVisible) throw new Error(`${label} dashboard did not render: ${JSON.stringify(layout.state)}`);

  const redemption = await window.webContents.executeJavaScript(`(async () => {
    const usage = document.getElementById('settings-usage-view');
    const panel = document.querySelector('.usage-settings-view .activation-settings-section');
    panel.scrollIntoView({ block: 'end' });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const usageRect = usage.getBoundingClientRect();
    const rect = panel.getBoundingClientRect();
    return { usage: { left: usageRect.left, top: usageRect.top, right: usageRect.right, bottom: usageRect.bottom }, panel: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } };
  })()`);
  if (redemption.panel.left < redemption.usage.left - 1 || redemption.panel.right > redemption.usage.right + 1 || redemption.panel.bottom > redemption.usage.bottom + 1) {
    throw new Error(`${label} redemption controls are unreachable: ${JSON.stringify(redemption)}`);
  }
  return layout;
}

async function run() {
  const root = path.join(__dirname, '..');
  const source = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
  const start = source.indexOf('<div id="ai-provider-overlay"');
  const end = source.indexOf('<div id="detail-overlay"', start);
  if (start < 0 || end < 0) throw new Error('Could not extract the settings dialog fixture.');
  const modal = source.slice(start, end);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'messs-usage-visual-'));
  const htmlPath = path.join(tempDir, 'usage.html');
  const themeUrl = pathToFileURL(path.join(root, 'src', 'styles', 'theme.css')).href;
  const stylesUrl = pathToFileURL(path.join(root, 'src', 'styles', 'main.css')).href;
  const usageUrl = pathToFileURL(path.join(root, 'src', 'js', 'usage-settings.js')).href;
  fs.writeFileSync(htmlPath, `<!doctype html>
    <html data-theme="dark"><head><meta charset="utf-8"><link rel="stylesheet" href="${themeUrl}"><link rel="stylesheet" href="${stylesUrl}"></head>
    <body>${modal}<script>
      window.AppState = { language: 'en' };
      window.t = (english) => english;
      window.appLocale = () => 'en-US';
      window.messsAPI = { getUsageSummary: async () => (${JSON.stringify(fixtureSummary)}) };
    </script><script src="${usageUrl}"></script><script>
      addEventListener('DOMContentLoaded', () => {
        document.getElementById('ai-provider-overlay').hidden = false;
        initUsageSettings();
        setSettingsView('usage');
      });
    </script></body></html>`, 'utf8');

  const window = new BrowserWindow({
    width: 1120,
    height: 820,
    show: false,
    webPreferences: { contextIsolation: false, nodeIntegration: false, sandbox: false, offscreen: true, backgroundThrottling: false }
  });
  await window.loadFile(htmlPath);
  await wait(250);
  const desktop = await inspectLayout(window, 'desktop-dark');

  const screenshotDir = path.join(root, 'test-artifacts');
  fs.mkdirSync(screenshotDir, { recursive: true });
  await window.webContents.executeJavaScript("document.getElementById('settings-usage-view').scrollTo({ top: 0, behavior: 'auto' })");
  await wait(100);
  fs.writeFileSync(path.join(screenshotDir, 'usage-settings-desktop-dark.png'), (await window.webContents.capturePage()).toPNG());

  await window.webContents.executeJavaScript("document.documentElement.dataset.theme = 'light'; document.getElementById('settings-usage-view').scrollTop = 0;");
  window.setSize(520, 420);
  await wait(220);
  const compact = await inspectLayout(window, 'compact-light');
  await window.webContents.executeJavaScript("document.getElementById('settings-usage-view').scrollTo({ top: 0, behavior: 'auto' })");
  await wait(100);
  fs.writeFileSync(path.join(screenshotDir, 'usage-settings-compact-light.png'), (await window.webContents.capturePage()).toPNG());

  window.destroy();
  fs.rmSync(tempDir, { recursive: true, force: true });
  process.stdout.write(`USAGE_VISUAL_OK desktop=${Math.round(desktop.manager.width)}x${Math.round(desktop.manager.height)} compact=${Math.round(compact.manager.width)}x${Math.round(compact.manager.height)}\n`);
}

app.whenReady().then(run).then(() => app.quit()).catch((error) => {
  console.error(error && error.stack || error);
  app.exit(1);
});
