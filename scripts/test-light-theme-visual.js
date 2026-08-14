'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { app, BrowserWindow } = require('electron');

async function run() {
  const root = path.join(__dirname, '..');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'messs-light-theme-'));
  const fixturePath = path.join(tempDir, 'light-theme.html');
  const themeUrl = pathToFileURL(path.join(root, 'src', 'styles', 'theme.css')).href;
  const mainUrl = pathToFileURL(path.join(root, 'src', 'styles', 'main.css')).href;
  const outputDir = path.join(root, 'test-artifacts', 'light-theme-v24');
  fs.writeFileSync(fixturePath, `<!doctype html><html data-theme="light"><head><meta charset="utf-8">
    <link rel="stylesheet" href="${themeUrl}"><link rel="stylesheet" href="${mainUrl}">
    <style>
      body{display:grid;grid-template-rows:38px 1fr}.app-titlebar{position:relative;inset:auto}
      .fixture{display:grid;grid-template-columns:260px 1fr 300px;gap:10px;padding:10px;background:var(--bg-base)}
      .fixture-panel{border:1px solid var(--border-hairline);border-radius:8px;background:var(--bg-surface);padding:18px}
      .fixture-main{display:grid;grid-template-rows:58px 1fr;min-width:0;border:1px solid var(--border-hairline);border-radius:8px;overflow:hidden;background:var(--bg-elevated)}
      .fixture-header{display:flex;align-items:center;padding:0 22px;border-bottom:1px solid var(--border-hairline);font-size:18px;font-weight:700}
      .fixture-canvas{display:grid;place-items:center;background:var(--board-workspace-bg);background-image:radial-gradient(circle,var(--border-hairline) 1px,transparent 1px);background-size:28px 28px}
      .fixture-media{width:min(560px,76%);aspect-ratio:16/9;border-radius:7px;background:linear-gradient(135deg,#193244,#7692a0);box-shadow:0 12px 30px rgba(0,0,0,.12)}
      .fixture-panel h1{margin:0 0 22px;font-size:28px}.fixture-panel i{display:block;height:42px;margin:10px 0;border-radius:7px;background:var(--bg-elevated);border:1px solid var(--border-hairline)}
      .fixture-panel strong{display:block;margin:8px 0 20px}.fixture-detail{background:var(--bg-surface)}
    </style></head><body>
      <div class="app-titlebar"><div class="titlebar-drag-region"></div><nav class="section-tabs"><button class="section-tab is-active">Messs</button><button class="section-tab">Chat</button><button class="section-tab">Market</button></nav><div class="titlebar-window-controls"></div></div>
      <main class="fixture"><aside class="fixture-panel"><h1>Messs.</h1><i></i><i></i><i></i><i></i></aside><section class="fixture-main"><header class="fixture-header">Integrated canvas</header><div class="fixture-canvas"><div class="fixture-media"></div></div></section><aside class="fixture-panel fixture-detail"><strong>File details</strong><i></i><i></i><i></i></aside></main>
    </body></html>`, 'utf8');

  const window = new BrowserWindow({ width: 1280, height: 760, show: false, backgroundColor: '#fafafa' });
  try {
    await window.loadFile(fixturePath);
    await new Promise((resolve) => setTimeout(resolve, 180));
    const colors = await window.webContents.executeJavaScript(`({
      base: getComputedStyle(document.documentElement).getPropertyValue('--bg-base').trim(),
      frame: getComputedStyle(document.documentElement).getPropertyValue('--bg-frame').trim(),
      surface: getComputedStyle(document.documentElement).getPropertyValue('--bg-surface').trim(),
      titlebar: getComputedStyle(document.querySelector('.app-titlebar')).backgroundColor,
      canvas: getComputedStyle(document.querySelector('.fixture-canvas')).backgroundColor
    })`);
    assert.deepStrictEqual(colors, {
      base: '#fafafa',
      frame: '#e3e3e8',
      surface: '#f5f5f7',
      titlebar: 'rgb(227, 227, 232)',
      canvas: 'rgb(238, 238, 236)'
    });
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'light-theme.png'), (await window.webContents.capturePage()).toPNG());
    process.stdout.write(`LIGHT_THEME_VISUAL_OK ${JSON.stringify(colors)}\n`);
  } finally {
    window.destroy();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

app.whenReady().then(run).then(() => app.quit()).catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  app.exit(1);
});
