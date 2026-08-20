'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { app, BrowserWindow } = require('electron');

async function waitFor(window, expression, timeoutMs = 3000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

async function run() {
  const root = path.join(__dirname, '..');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'messs-board-zoom-'));
  const fixturePath = path.join(tempDir, 'fixture.html');
  const engineUrl = pathToFileURL(path.join(root, 'src', 'js', 'board-engine.js')).href;
  const boardUrl = pathToFileURL(path.join(root, 'src', 'js', 'board-canvas.js')).href;
  const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XvY7WQAAAABJRU5ErkJggg==';

  fs.writeFileSync(fixturePath, `<!doctype html><html><head><style>
    html,body{margin:0;width:100%;height:100%;overflow:hidden}
    #board-viewport{position:relative;width:900px;height:600px;overflow:hidden}
    #board-canvas{position:absolute;left:0;top:0;width:1px;height:1px;transform-origin:0 0}
    .board-item{position:absolute}.board-image-layer{display:block;width:100%;height:100%}
    .board-overview-canvas{position:absolute;inset:0}.board-overview-canvas[hidden]{display:none}
  </style></head><body>
    <div id="board-viewport"><div id="board-canvas"></div></div>
    <div id="board-zoom-label"></div>
    <script src="${engineUrl}"></script><script>
      window.AppState = { boardItems: [], files: [] };
      window.activeCanvasId = () => 'zoom-runtime';
      window.isImageExt = (ext) => ext === '.png';
      window.isVideoExt = () => false;
      window.isAudioExt = () => false;
      window.isModelFile = () => false;
      window.resolveImageDisplaySource = (file) => file.thumbUrl;
    </script><script src="${boardUrl}"></script><script>
      window.runZoomFixture = () => {
        const items = [];
        const files = [];
        for (let row = 0; row < 6; row += 1) {
          for (let column = 0; column < 10; column += 1) {
            const id = 'item-' + row + '-' + column;
            const fileId = 'file-' + row + '-' + column;
            files.push({
              id: fileId, name: fileId + '.png', ext: '.png', thumbUrl: ${JSON.stringify(pixel)},
              url: ${JSON.stringify(pixel)}, sourceWidth: 100, sourceHeight: 70
            });
            items.push({ id, fileId, x: column * 130, y: row * 100, width: 100, height: 70 });
          }
        }
        AppState.files = files;
        AppState.boardItems = items;
        rebuildBoardSpatialIndex();
        Board.zoom = 2.4;
        Board.panX = 0;
        Board.panY = 0;
        Board.zoomLod = 'detail';
        Board.lastZoomBucket = 'detail';

        createBoardItemElement = (item) => {
          const element = document.createElement('div');
          element.className = 'board-item board-item-image';
          element.dataset.boardId = item.id;
          element.style.left = item.x + 'px';
          element.style.top = item.y + 'px';
          element.style.width = item.width + 'px';
          element.style.height = item.height + 'px';
          const image = document.createElement('img');
          image.className = 'board-image-layer is-active';
          image.dataset.quality = 'thumb';
          image.src = ${JSON.stringify(pixel)};
          element.appendChild(image);
          return element;
        };

        const canvas = document.getElementById('board-canvas');
        items.slice(0, 6).forEach((item) => {
          const element = createBoardItemElement(item);
          canvas.appendChild(element);
          Board.mounted.set(item.id, element);
        });
        Board.visibleIds = new Set(items.slice(0, 6).map((item) => item.id));
        beginBoardWheelInteraction();
        setBoardZoomTarget({ x: 0, y: 0 }, 0.25);
        clearTimeout(Board.wheelSettleTimer);
        Board.wheelSettleTimer = setTimeout(finishBoardWheelInteraction, 500);
      };
      window.zoomFixtureState = () => ({
        mounted: Board.mounted.size,
        targetVisible: Board.interactionVisibleIds.size,
        queue: Board.mountQueue.size,
        wheel: Board.isWheelZooming,
        animating: Boolean(Board.zoomFrame || Board.zoomTarget),
        zoom: Board.zoom,
        visible: Board.visibleIds.size,
        missingVisible: [...Board.visibleIds].filter((id) => !Board.mounted.has(id)).length,
        unpaintedVisible: unpaintedVisibleBoardIds().size,
        overviewHidden: !Board.overviewCanvas || Board.overviewCanvas.hidden
      });
    </script></body></html>`, 'utf8');

  const window = new BrowserWindow({
    width: 960,
    height: 700,
    x: -10000,
    y: -10000,
    show: true,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });
  try {
    await window.loadFile(fixturePath);
    await window.webContents.executeJavaScript('runZoomFixture()');
    try {
      await waitFor(window, 'zoomFixtureState().mounted >= 24 && zoomFixtureState().wheel', 400);
    } catch (error) {
      const state = await window.webContents.executeJavaScript('zoomFixtureState()');
      throw new Error(`${error.message}: ${JSON.stringify(state)}`);
    }
    const during = await window.webContents.executeJavaScript('zoomFixtureState()');
    try {
      await waitFor(window, '!zoomFixtureState().animating && zoomFixtureState().missingVisible === 0 && zoomFixtureState().unpaintedVisible === 0');
    } catch (error) {
      const state = await window.webContents.executeJavaScript('zoomFixtureState()');
      throw new Error(`${error.message}: ${JSON.stringify(state)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
    const settled = await window.webContents.executeJavaScript('zoomFixtureState()');
    if (during.targetVisible !== 60 || during.mounted < 24 || !during.wheel) {
      throw new Error(`Target viewport was not pre-mounted during zoom: ${JSON.stringify(during)}`);
    }
    if (settled.visible !== 60 || settled.missingVisible !== 0 || settled.unpaintedVisible !== 0 ||
        !settled.overviewHidden || Math.abs(settled.zoom - 0.6) > 0.001) {
      throw new Error(`Zoom settled with missing or fallback media: ${JSON.stringify(settled)}`);
    }
    process.stdout.write(`BOARD_ZOOM_RUNTIME_OK during=${during.mounted}/60 settled=${settled.mounted}/60\n`);
  } finally {
    window.destroy();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

app.whenReady().then(run).then(() => app.quit()).catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  app.exit(1);
});
