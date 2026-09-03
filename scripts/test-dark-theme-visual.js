'use strict';

const assert = require('assert');
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
    backgroundColor: '#101112',
    webPreferences: { contextIsolation: false, nodeIntegration: false, sandbox: false, offscreen: true }
  });

  try {
    await window.loadFile(path.join(root, 'src', 'index.html'));
    await wait(700);
    const colors = await window.webContents.executeJavaScript(`(() => {
      document.documentElement.dataset.theme = 'dark';
      document.getElementById('start-screen').hidden = true;
      const main = document.getElementById('main-app');
      main.hidden = false;
      main.classList.add('is-visible');
      const board = document.querySelector('.board-panel');
      board.classList.add('is-canvas-library');
      document.querySelector('.canvas-library-view').hidden = false;
      document.querySelector('.board-workspace-body').hidden = true;
      document.querySelector('.canvas-library-grid').innerHTML = Array.from({ length: 6 }, (_, index) =>
        '<button class="canvas-library-card"><strong class="canvas-library-card-title">项目 ' + (index + 1) + '</strong><span class="canvas-library-card-meta">最近使用</span><span class="canvas-library-mosaic"></span></button>'
      ).join('');
      const color = (selector) => getComputedStyle(document.querySelector(selector)).backgroundColor;
      const tokens = getComputedStyle(document.documentElement);
      return {
        deep: tokens.getPropertyValue('--bg-deep').trim(),
        base: tokens.getPropertyValue('--bg-base').trim(),
        surface: tokens.getPropertyValue('--bg-surface').trim(),
        elevated: tokens.getPropertyValue('--bg-elevated').trim(),
        interaction: tokens.getPropertyValue('--bg-surface-2').trim(),
        frame: color('.app-titlebar'),
        app: color('.main-app'),
        sidebar: color('.sidebar'),
        preview: color('.preview-canvas'),
        library: color('.canvas-library-content'),
        card: color('.canvas-library-card'),
        toolbarPresent: !!document.querySelector('.canvas-library-toolbar'),
        headerPlusPresent: !!document.querySelector('#canvas-header-new')
      };
    })()`);

    assert.deepStrictEqual(colors, {
      deep: '#0a0a0a',
      base: '#101112',
      surface: '#151618',
      elevated: '#1a1b1d',
      interaction: '#292b2e',
      frame: 'rgb(16, 17, 18)',
      app: 'rgb(16, 17, 18)',
      sidebar: 'rgb(21, 22, 24)',
      preview: 'rgb(10, 10, 10)',
      library: 'rgb(10, 10, 10)',
      card: 'rgb(26, 27, 29)',
      toolbarPresent: true,
      headerPlusPresent: false
    });

    const outputDir = path.join(root, 'test-artifacts');
    fs.mkdirSync(outputDir, { recursive: true });
    const screenshotPath = path.join(outputDir, 'dark-theme-layers.png');
    fs.writeFileSync(screenshotPath, (await window.webContents.capturePage()).toPNG());
    process.stdout.write(`DARK_THEME_VISUAL_OK ${JSON.stringify(colors)} screenshot=${screenshotPath}\n`);
  } finally {
    window.destroy();
  }
}

app.whenReady().then(run).then(() => app.quit()).catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  app.exit(1);
});
