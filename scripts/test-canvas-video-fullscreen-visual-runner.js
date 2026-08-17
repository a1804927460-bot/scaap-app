'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, protocol } = require('electron');
const ffmpegPath = require('ffmpeg-static');
const { createLocalFileResponse } = require('../lib/local-file-response');

protocol.registerSchemesAsPrivileged([
  { scheme: 'messs-transcode', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

async function run() {
  const root = path.join(__dirname, '..');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'messs-video-fullscreen-'));
  const htmlPath = path.join(tempDir, 'video-fullscreen.html');
  const videoPath = path.join(tempDir, 'prepared-preview.mp4');
  const generated = spawnSync(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=s=360x640:d=3:r=24',
    '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    videoPath
  ], { encoding: 'utf8', windowsHide: true });
  if (generated.status !== 0) throw new Error(generated.stderr || 'Could not create the playback fixture.');
  const videoSource = 'messs-transcode://fixture-video';
  const styleUrl = pathToFileURL(path.join(root, 'src', 'styles', 'main.css')).href;
  const themeUrl = pathToFileURL(path.join(root, 'src', 'styles', 'theme.css')).href;
  const storeUrl = pathToFileURL(path.join(root, 'src', 'js', 'store-client.js')).href;
  const previewUrl = pathToFileURL(path.join(root, 'src', 'js', 'preview-canvas.js')).href;
  const mediaMetaUrl = pathToFileURL(path.join(root, 'src', 'js', 'board-media-meta.js')).href;
  const boardEngineUrl = pathToFileURL(path.join(root, 'src', 'js', 'board-engine.js')).href;
  const boardCanvasUrl = pathToFileURL(path.join(root, 'src', 'js', 'board-canvas.js')).href;

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
          getPreview: async () => ({ type: 'video', url: ${JSON.stringify(videoSource)}, transcoded: true }),
          transcodeVideo: async () => ({ ok: false })
        };
      </script>
      <script src="${storeUrl}"></script><script src="${previewUrl}"></script><script src="${mediaMetaUrl}"></script>
      <script src="${boardEngineUrl}"></script><script src="${boardCanvasUrl}"></script>
      <script>
        initFullscreenOverlay();
        const card = document.createElement('div');
        card.className = 'board-item board-item-video is-selected is-single-selection';
        card.style.position = 'relative';
        card.style.width = '640px';
        card.style.height = '360px';
        const content = document.createElement('div');
        content.className = 'board-item-content';
        const fixtureFile = {
          id: 'fixture-video', name: 'fixture.mp4', ext: '.mp4', thumbUrl: '',
          sourceWidth: 1080, sourceHeight: 1920, sourceDuration: 3, videoPreviewReady: false
        };
        const fixtureItem = { id: 'fixture-item', fileId: fixtureFile.id, x: 0, y: 0, width: 640, height: 360 };
        AppState.files = [fixtureFile];
        card.appendChild(content);
        document.querySelector('.fixture-stage').appendChild(card);
        renderBoardItemContent(content, fixtureFile, fixtureItem);
        appendBoardVideoButlerToolbar(card, fixtureFile, fixtureItem);
      </script>
    </body></html>`, 'utf8');

  protocol.handle('messs-transcode', (request) => createLocalFileResponse(request, videoPath, 'video/mp4'));

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
    const canvasPlayback = await window.webContents.executeJavaScript(`(async () => {
      const content = document.querySelector('.board-item-content');
      content.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
      await new Promise((resolve) => setTimeout(resolve, 120));
      const video = content.querySelector('.mini-video-player video');
      if (!video) return { missingPlayer: true };
      await new Promise((resolve) => setTimeout(resolve, 650));
      const state = {
        currentTime: video.currentTime,
        readyState: video.readyState,
        paused: video.paused,
        error: video.error && video.error.code
      };
      video.pause();
      video.currentTime = 0;
      return state;
    })()`);
    if (
      canvasPlayback.missingPlayer || canvasPlayback.error || canvasPlayback.readyState < 2 ||
      canvasPlayback.paused || canvasPlayback.currentTime < 0.2
    ) {
      throw new Error(`Canvas video did not play through the registered media protocol: ${JSON.stringify(canvasPlayback)}`);
    }
    const dragGuard = await window.webContents.executeJavaScript(`(async () => {
      const content = document.querySelector('.board-item-content');
      const player = content.querySelector('.mini-video-player');
      const video = player.querySelector('video');
      player._boardStopPreview();
      Board.lastDragEndedAt = Date.now();
      content.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
      await new Promise((resolve) => setTimeout(resolve, 220));
      return { paused: video.paused, currentTime: video.currentTime };
    })()`);
    if (!dragGuard.paused || dragGuard.currentTime > 0.05) {
      throw new Error(`A click immediately following a drag started video playback: ${JSON.stringify(dragGuard)}`);
    }
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

    const compactToolbarExpected = await window.webContents.executeJavaScript(`(() => {
      const card = document.querySelector('.board-item-video');
      const zoom = 3.06;
      const progress = Math.min(1, Math.max(0, (zoom - 1.6) / (3.2 - 1.6)));
      const eased = progress * progress * (3 - 2 * progress);
      const screenScale = 1 - (1 - 0.86) * eased;
      card.style.width = '260px';
      card.style.height = '146px';
      card.style.transformOrigin = 'center center';
      card.style.transform = 'scale(' + zoom + ')';
      card.style.setProperty('--board-toolbar-scale', String(screenScale / zoom));
      card.style.setProperty('--board-toolbar-gap', String(7 / zoom) + 'px');
      return { zoom, screenScale };
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 220));
    const compactToolbarMeasurement = await window.webContents.executeJavaScript(`(() => {
      const card = document.querySelector('.board-item-video');
      const bar = card.querySelector('.board-video-butler-toolbar');
      const cardRect = card.getBoundingClientRect();
      const barRect = bar.getBoundingClientRect();
      return {
        width: barRect.width,
        height: barRect.height,
        gap: cardRect.top - barRect.bottom,
        transform: getComputedStyle(bar).transform,
        scaleVariable: getComputedStyle(bar).getPropertyValue('--board-toolbar-scale')
      };
    })()`);
    const compactToolbar = {
      ...compactToolbarExpected,
      ...compactToolbarMeasurement
    };
    if (
      compactToolbar.width >= (toolbar.bar.right - toolbar.bar.left) * 0.91 ||
      compactToolbar.width < (toolbar.bar.right - toolbar.bar.left) * 0.82 ||
      compactToolbar.height < 24 || compactToolbar.height > 27 ||
      Math.abs(compactToolbar.gap - 7) > 1
    ) {
      throw new Error(`High-zoom video toolbar did not compact smoothly: ${JSON.stringify(compactToolbar)}`);
    }
    await window.webContents.executeJavaScript(`(() => {
      const card = document.querySelector('.board-item-video');
      card.style.width = '640px';
      card.style.height = '360px';
      card.style.transform = '';
      card.style.removeProperty('--board-toolbar-scale');
      card.style.removeProperty('--board-toolbar-gap');
    })()`);

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
        videoRect: video && (() => { const value = video.getBoundingClientRect(); return { width: value.width, height: value.height }; })(),
        objectFit: video && getComputedStyle(video).objectFit,
        viewport: { width: innerWidth, height: innerHeight }
      };
    })()`);
    if (
      !fullscreen.visible || !fullscreen.hasPlayer || !fullscreen.hasVideo || !fullscreen.hasControls ||
      !fullscreen.rect || fullscreen.rect.left < 0 || fullscreen.rect.top < 0 ||
      fullscreen.objectFit !== 'contain' || !fullscreen.videoRect ||
      fullscreen.videoRect.width > fullscreen.rect.right - fullscreen.rect.left + 1 ||
      fullscreen.videoRect.height > fullscreen.rect.bottom - fullscreen.rect.top + 1 ||
      fullscreen.rect.right > fullscreen.viewport.width || fullscreen.rect.bottom > fullscreen.viewport.height
    ) {
      throw new Error(`Canvas video fullscreen viewer is invalid: ${JSON.stringify(fullscreen)}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 1200));
    const playback = await window.webContents.executeJavaScript(`(() => {
      const video = document.querySelector('#fullscreen-stage video');
      return video && {
        currentTime: video.currentTime,
        readyState: video.readyState,
        paused: video.paused,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        error: video.error && video.error.code
      };
    })()`);
    if (
      !playback || playback.error || playback.readyState < 2 || playback.paused || playback.currentTime < 0.2 ||
      playback.videoHeight <= playback.videoWidth
    ) {
      throw new Error(`Prepared video did not begin playing immediately: ${JSON.stringify(playback)}`);
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
    process.stdout.write(`CANVAS_VIDEO_FULLSCREEN_OK canvas=${canvasPlayback.currentTime.toFixed(2)} toolbar=${Math.round(toolbar.bar.right - toolbar.bar.left)} compact=${compactToolbar.width.toFixed(1)}x${compactToolbar.height.toFixed(1)} gap=${compactToolbar.gap.toFixed(1)} player=${Math.round(fullscreen.rect.right - fullscreen.rect.left)}x${Math.round(fullscreen.rect.bottom - fullscreen.rect.top)} played=${playback.currentTime.toFixed(2)}\n`);
  } finally {
    if (!window.isDestroyed()) window.destroy();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

app.whenReady().then(run).then(() => app.quit()).catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  app.exit(1);
});
