'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { app, BrowserWindow } = require('electron');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  const root = path.join(__dirname, '..');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'messs-butler-drag-'));
  const fixturePath = path.join(tempDir, 'fixture.html');
  const themeUrl = pathToFileURL(path.join(root, 'src', 'styles', 'theme.css')).href;
  const mainUrl = pathToFileURL(path.join(root, 'src', 'styles', 'main.css')).href;
  const butlerUrl = pathToFileURL(path.join(root, 'src', 'js', 'board-media-meta.js')).href;

  fs.writeFileSync(fixturePath, `<!doctype html><html data-theme="light"><head><meta charset="utf-8">
    <link rel="stylesheet" href="${themeUrl}"><link rel="stylesheet" href="${mainUrl}">
    <style>body{background:var(--board-workspace-bg)}#anchor{position:fixed;left:240px;top:30px;width:90px;height:32px;background:#fff}</style>
    <script>window.t=(english)=>english;</script><script src="${butlerUrl}"></script>
    </head><body><button id="anchor">Butler</button></body></html>`, 'utf8');

  const window = new BrowserWindow({
    width: 760,
    height: 540,
    show: false,
    webPreferences: { contextIsolation: false, nodeIntegration: false, sandbox: false, offscreen: true }
  });

  try {
    await window.loadFile(fixturePath);
    await window.webContents.executeJavaScript(`(() => {
      const created = createBoardButlerConfigPanel(
        document.getElementById('anchor'),
        BOARD_BUTLER_ICONS.generate3d,
        'Generate 3D',
        'Hunyuan 3D'
      );
      created.body.innerHTML = '<div style="height:310px"></div>';
    })()`);
    await wait(180);

    const before = await window.webContents.executeJavaScript(`(() => {
      const rect = document.querySelector('.board-butler-config-panel').getBoundingClientRect();
      const header = document.querySelector('.board-butler-config-header').getBoundingClientRect();
      return { panel: { left:rect.left, top:rect.top, right:rect.right, bottom:rect.bottom }, header: { x:header.x, y:header.y, width:header.width, height:header.height } };
    })()`);
    const startX = Math.round(before.header.x + before.header.width / 2);
    const startY = Math.round(before.header.y + before.header.height / 2);
    window.webContents.sendInputEvent({ type: 'mouseMove', x: startX, y: startY });
    window.webContents.sendInputEvent({ type: 'mouseDown', x: startX, y: startY, button: 'left', clickCount: 1 });
    window.webContents.sendInputEvent({ type: 'mouseMove', x: 900, y: 700, button: 'left' });
    window.webContents.sendInputEvent({ type: 'mouseUp', x: 900, y: 700, button: 'left', clickCount: 1 });
    await wait(180);

    const dragged = await window.webContents.executeJavaScript(`(() => {
      const rect = document.querySelector('.board-butler-config-panel').getBoundingClientRect();
      return { left:rect.left, top:rect.top, right:rect.right, bottom:rect.bottom };
    })()`);
    if (dragged.left <= before.panel.left || dragged.top <= before.panel.top) {
      throw new Error(`Butler panel did not follow the drag: ${JSON.stringify({ before: before.panel, dragged })}`);
    }

    const after = await window.webContents.executeJavaScript(`(() => {
      const panel = document.querySelector('.board-butler-config-panel');
      panel.querySelector('.board-butler-config-body > div').style.height = '680px';
      return true;
    })()`);
    if (!after) throw new Error('Butler panel fixture did not update.');
    await wait(180);

    const result = await window.webContents.executeJavaScript(`(() => {
      const rect = document.querySelector('.board-butler-config-panel').getBoundingClientRect();
      return { left:rect.left, top:rect.top, right:rect.right, bottom:rect.bottom, width:rect.width, height:rect.height, viewport:{ width:innerWidth, height:innerHeight } };
    })()`);
    if (result.left < 11 || result.top < 11 || result.right > result.viewport.width - 11 || result.bottom > result.viewport.height - 11) {
      throw new Error(`Dragged Butler panel escaped the viewport: ${JSON.stringify(result)}`);
    }
    process.stdout.write(`BUTLER_PANEL_DRAG_OK panel=${Math.round(result.width)}x${Math.round(result.height)} position=${Math.round(result.left)},${Math.round(result.top)}\n`);
  } finally {
    window.destroy();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

app.whenReady().then(run).then(() => app.quit()).catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  app.exit(1);
});
