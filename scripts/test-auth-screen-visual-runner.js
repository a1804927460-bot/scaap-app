'use strict';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function capture(window, outputName) {
  const metrics = await window.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('.account-auth-card').getBoundingClientRect();
    const screen = document.getElementById('account-auth-screen').getBoundingClientRect();
    const controls = [...document.querySelectorAll('.account-auth-form input, .account-auth-form > button')]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      });
    return {
      card: { left: card.left, right: card.right, top: card.top, bottom: card.bottom, width: card.width, height: card.height },
      screen: { left: screen.left, right: screen.right, top: screen.top, bottom: screen.bottom },
      controls,
      tabsVisible: getComputedStyle(document.getElementById('section-tabs')).display !== 'none'
    };
  })()`);
  if (metrics.card.width < 300
    || metrics.card.left < metrics.screen.left
    || metrics.card.right > metrics.screen.right
    || metrics.card.top < metrics.screen.top
    || metrics.card.bottom > metrics.screen.bottom
    || metrics.controls.some((control) => control.left < metrics.card.left || control.right > metrics.card.right)
    || metrics.tabsVisible) {
    throw new Error(`Authentication screen overflowed: ${JSON.stringify(metrics)}`);
  }
  const outputDir = path.join(__dirname, '..', 'test-artifacts');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, outputName), (await window.webContents.capturePage()).toPNG());
}

async function run() {
  const root = path.join(__dirname, '..');
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: { contextIsolation: false, nodeIntegration: false, sandbox: false, offscreen: true }
  });
  await window.loadFile(path.join(root, 'src', 'index.html'));
  await wait(700);
  await window.webContents.executeJavaScript(`(() => {
    document.documentElement.dataset.theme = 'light';
    applyLanguageChoice('zh', { rerender: false });
    syncAccountAuthScreen({ cloudConfigured: true, cloudSession: { configured: true, authenticated: false } });
  })()`);
  await wait(150);
  await capture(window, 'account-auth-screen.png');
  window.setSize(700, 720);
  await wait(150);
  await capture(window, 'account-auth-screen-compact.png');
  window.destroy();
}

app.whenReady().then(run).then(() => app.quit()).catch((error) => {
  console.error(error);
  app.exit(1);
});
