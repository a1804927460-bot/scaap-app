'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { app, BrowserWindow } = require('electron');
const sharp = require('sharp');

async function waitFor(window, expression, timeoutMs = 3000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

async function pngDataUrl(width, color) {
  const buffer = await sharp({
    create: { width, height: width, channels: 4, background: color }
  }).png().toBuffer();
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

async function run() {
  const root = path.join(__dirname, '..');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'messs-image-quality-'));
  const fixturePath = path.join(tempDir, 'fixture.html');
  const engineUrl = pathToFileURL(path.join(root, 'src', 'js', 'board-engine.js')).href;
  const boardUrl = pathToFileURL(path.join(root, 'src', 'js', 'board-canvas.js')).href;
  const thumb = await pngDataUrl(48, '#46576d');
  const full = await pngDataUrl(640, '#4cc9a4');
  const secondThumb = await pngDataUrl(48, '#5b465f');
  const secondFull = await pngDataUrl(640, '#f2b84b');

  fs.writeFileSync(fixturePath, `<!doctype html><html><body>
    <div id="board-viewport"><div id="board-canvas"></div></div>
    <div id="board-empty"></div><div id="board-zoom-label"></div>
    <script src="${engineUrl}"></script><script>
      window.AppState = { boardItems: [], files: [] };
      window.isImageExt = (ext) => ext === '.png';
      window.isVideoExt = () => false;
      window.isAudioExt = () => false;
      window.isModelFile = () => false;
      window.resolveImageDisplaySource = (file, full) => full ? file.url : file.thumbUrl;
    </script><script src="${boardUrl}"></script><script>
      window.runQualityFixture = async () => {
        const makeHost = (id, thumbSource, fullSource) => {
          const host = document.createElement('div');
          host.className = 'board-item';
          const stack = document.createElement('div');
          stack.className = 'board-image-stack';
          stack.dataset.pendingQuality = '';
          const image = document.createElement('img');
          image.className = 'board-image-layer is-active';
          image.dataset.quality = 'thumb';
          image.dataset.thumbSrc = thumbSource;
          image.dataset.fullSrc = fullSource;
          image.src = thumbSource;
          stack.appendChild(image);
          host.appendChild(stack);
          document.body.appendChild(host);
          return host;
        };

        const first = makeHost('first', ${JSON.stringify(thumb)}, ${JSON.stringify(full)});
        transitionBoardImageQuality(first, 'full');
        window.__qualityInitial = activeBoardImage(first).dataset.quality;
        window.__qualityFirst = first;

        const second = makeHost('second', ${JSON.stringify(secondThumb)}, ${JSON.stringify(secondFull)});
        const secondItem = { id: 'second', fileId: 'file-second', x: 0, y: 0, width: 260, height: 260 };
        Board.mounted.set('second', second);
        Board.itemsById.set('second', secondItem);
        Board.filesById.set('file-second', {
          id: 'file-second', ext: '.png', sourceWidth: 640, sourceHeight: 640,
          thumbUrl: ${JSON.stringify(secondThumb)}, url: ${JSON.stringify(secondFull)}
        });
        Board.visibleIds.add('second');
        scheduleBoardFullImagePrewarm(1);
      };
    </script></body></html>`, 'utf8');

  const window = new BrowserWindow({
    width: 640,
    height: 480,
    show: false,
    webPreferences: { contextIsolation: false, nodeIntegration: false, sandbox: false }
  });
  try {
    await window.loadFile(fixturePath);
    await window.webContents.executeJavaScript('runQualityFixture()');
    await waitFor(window, `activeBoardImage(window.__qualityFirst)?.dataset.quality === 'full'`);
    await waitFor(window, `Board.fullImageCache.has(${JSON.stringify(secondFull)})`);
    await new Promise((resolve) => setTimeout(resolve, 340));
    const result = await window.webContents.executeJavaScript(`(() => {
      const content = document.createElement('div');
      renderBoardItemContent(content, {
        id: 'file-first', name: 'first.png', ext: '.png',
        thumbUrl: ${JSON.stringify(thumb)}, url: ${JSON.stringify(full)}
      }, { id: 'remount', fileId: 'file-first', width: 220 });
      const remounted = activeBoardImage(content);
      return {
        initialQuality: window.__qualityInitial,
        finalQuality: activeBoardImage(window.__qualityFirst)?.dataset.quality,
        layerCount: window.__qualityFirst.querySelectorAll('.board-image-layer').length,
        remountedQuality: remounted?.dataset.quality,
        remountedLoading: remounted?.loading,
        cacheSize: Board.fullImageCache.size
      };
    })()`);
    if (result.initialQuality !== 'thumb' || result.finalQuality !== 'full' ||
        result.layerCount !== 1 || result.remountedQuality !== 'full' ||
        result.remountedLoading !== 'eager' || result.cacheSize < 2) {
      throw new Error(`Image quality transition regression: ${JSON.stringify(result)}`);
    }
    process.stdout.write(`BOARD_IMAGE_QUALITY_RUNTIME_OK cache=${result.cacheSize}\n`);
  } finally {
    window.destroy();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

app.whenReady().then(run).then(() => app.quit()).catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  app.exit(1);
});
