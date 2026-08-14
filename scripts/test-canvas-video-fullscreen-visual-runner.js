'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { app, BrowserWindow } = require('electron');

app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

async function run() {
  const root = path.join(__dirname, '..');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'messs-video-fullscreen-'));
  const htmlPath = path.join(tempDir, 'video-fullscreen.html');
  const styleUrl = pathToFileURL(path.join(root, 'src', 'styles', 'main.css')).href;
  const themeUrl = pathToFileURL(path.join(root, 'src', 'styles', 'theme.css')).href;
  const storeUrl = pathToFileURL(path.join(root, 'src', 'js', 'store-client.js')).href;
  const previewUrl = pathToFileURL(path.join(root, 'src', 'js', 'preview-canvas.js')).href;
  const mediaMetaUrl = pathToFileURL(path.join(root, 'src', 'js', 'board-media-meta.js')).href;

  fs.writeFileSync(htmlPath, `<!doctype html>
    <html data-theme="dark"><head><meta charset="utf-8">
      <link rel="stylesheet" href="${themeUrl}"><link rel="stylesheet" href="${styleUrl}">
      <style>body { margin: 0; background: #f4f5f7; } .fixture-stage { position: fixed; inset: 0; display: grid; place-items: center; }</style>
    </head><body>
      <div class="fixture-stage"></div>
      <div id="fullscreen-overlay" class="fullscreen-overlay" hidden>
        <button id="fullscreen-close" class="icon-btn-sm fullscreen-close" type="button">x</button>
        <div id="fullscreen-stage" class="fullscreen-stage"></div>
      </div>
      <script>
        window.t = (en) => en;
        window.AppState = { language: 'en', files: [], boardItems: [] };
        window.showToast = () => {};
        window.resolveImageDisplaySource = () => '';
        window.messsAPI = {
          getPreview: async () => ({ type: 'video', url: 'data:video/mp4;base64,' }),
          transcodeVideo: async () => ({ ok: false })
        };
      </script>
      <script src="${storeUrl}"></script><script src="${previewUrl}"></script><script src="${mediaMetaUrl}"></script>
      <script>
        initFullscreenOverlay();
        const card = document.createElement('div');
        card.className = 'board-item board-item-video is-selected is-single-selection';
        card.style.position = 'relative';
        card.style.width = '640px';
        card.style.height = '360px';
        const content = document.createElement('div');
        content.className = 'board-item-content';
        const player = document.createElement('div');
        player.className = 'mini-video-player';
        const video = document.createElement('video');
        video.src = 'data:video/mp4;base64,';
        player.appendChild(video);
        content.appendChild(player);
        card.appendChild(content);
        document.querySelector('.fixture-stage').appendChild(card);
        appendBoardVideoButlerToolbar(card, {
          id: 'fixture-video', name: 'fixture.mp4', ext: '.mp4', sourceWidth: 1920, sourceHeight: 1080
        }, { id: 'fixture-item', x: 0, y: 0, width: 640, height: 360 });
      </script>
    </body></html>`, 'utf8');

  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    show: false,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      offscreen: true
    }
  });
  try {
    await window.loadFile(htmlPath);
    const toolbar = await window.webContents.executeJavaScript(`(() => {
      const card = document.querySelector('.board-item-video').getBoundingClientRect();
      const bar = document.querySelector('.board-video-butler-toolbar').getBoundingClientRect();
      const button = document.querySelector('.board-video-fullscreen').getBoundingClientRect();
      return {
        card: { left: card.left, top: card.top, right: card.right },
        bar: { left: bar.left, top: bar.top, right: bar.right, bottom: bar.bottom },
        button: { left: button.left, top: button.top, right: button.right, bottom: button.bottom },
        title: document.querySelector('.board-video-fullscreen').title
      };
    })()`);
    if (
      toolbar.button.left < toolbar.bar.left || toolbar.button.right > toolbar.bar.right ||
      toolbar.button.top < toolbar.bar.top || toolbar.button.bottom > toolbar.bar.bottom ||
      toolbar.bar.right > toolbar.card.right + 1 || toolbar.bar.bottom >= toolbar.card.top ||
      toolbar.title !== 'View fullscreen video'
    ) {
      throw new Error(`Video fullscreen toolbar is misplaced: ${JSON.stringify(toolbar)}`);
    }

    await window.webContents.executeJavaScript("document.querySelector('.board-video-fullscreen').click()");
    const fullscreen = await window.webContents.executeJavaScript(`(() => {
      const overlay = document.getElementById('fullscreen-overlay');
      const player = overlay.querySelector('.messs-video-player.is-fullscreen-player');
      const video = player && player.querySelector('video');
      const controls = player && player.querySelector('.video-control-capsule');
      const rect = player && player.getBoundingClientRect();
      return {
        visible: !overlay.hidden,
        hasPlayer: !!player,
        hasVideo: !!video,
        hasControls: !!controls,
        rect: rect && { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        viewport: { width: innerWidth, height: innerHeight }
      };
    })()`);
    if (
      !fullscreen.visible || !fullscreen.hasPlayer || !fullscreen.hasVideo || !fullscreen.hasControls ||
      !fullscreen.rect || fullscreen.rect.left < 0 || fullscreen.rect.top < 0 ||
      fullscreen.rect.right > fullscreen.viewport.width || fullscreen.rect.bottom > fullscreen.viewport.height
    ) {
      throw new Error(`Canvas video fullscreen viewer is invalid: ${JSON.stringify(fullscreen)}`);
    }

    const mediaClickKeptOpen = await window.webContents.executeJavaScript(`(() => {
      document.querySelector('#fullscreen-stage video').click();
      return !document.getElementById('fullscreen-overlay').hidden;
    })()`);
    if (!mediaClickKeptOpen) throw new Error('Clicking the fullscreen media closed the viewer.');
    await window.webContents.executeJavaScript("document.getElementById('fullscreen-stage').click()");
    const closed = await window.webContents.executeJavaScript(`({
      hidden: document.getElementById('fullscreen-overlay').hidden,
      children: document.getElementById('fullscreen-stage').childElementCount
    })`);
    if (!closed.hidden || closed.children !== 0) throw new Error(`Clicking outside the fullscreen media did not close it: ${JSON.stringify(closed)}`);
    const imageBackdropClick = await window.webContents.executeJavaScript(`(() => {
      const image = document.createElement('img');
      image.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="%23c9a45a"/></svg>';
      showFullscreenMedia(image);
      document.querySelector('#fullscreen-stage > img').click();
      const mediaClickKeptOpen = !document.getElementById('fullscreen-overlay').hidden;
      document.getElementById('fullscreen-stage').click();
      return {
        mediaClickKeptOpen,
        backdropClickClosed: document.getElementById('fullscreen-overlay').hidden
      };
    })()`);
    if (!imageBackdropClick.mediaClickKeptOpen || !imageBackdropClick.backdropClickClosed) {
      throw new Error(`Fullscreen image outside-click behavior is invalid: ${JSON.stringify(imageBackdropClick)}`);
    }
    process.stdout.write(`CANVAS_VIDEO_FULLSCREEN_OK toolbar=${Math.round(toolbar.bar.right - toolbar.bar.left)} player=${Math.round(fullscreen.rect.right - fullscreen.rect.left)}x${Math.round(fullscreen.rect.bottom - fullscreen.rect.top)}\n`);
  } finally {
    if (!window.isDestroyed()) window.destroy();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

app.whenReady().then(run).then(() => app.quit()).catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  app.exit(1);
});
