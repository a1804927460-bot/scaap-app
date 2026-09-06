'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { app, BrowserWindow } = require('electron');

async function run() {
  const root = path.join(__dirname, '..');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'messs-board-leafer-'));
  const fixturePath = path.join(tempDir, 'fixture.html');
  const leaferUrl = pathToFileURL(path.join(root, 'src', 'vendor', 'leafer-ui.web.min.js')).href;
  const exportUrl = pathToFileURL(path.join(root, 'src', 'vendor', 'leafer-export.min.js')).href;
  const layerUrl = pathToFileURL(path.join(root, 'src', 'js', 'board-leafer-layer.js')).href;
  const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XvY7WQAAAABJRU5ErkJggg==';

  fs.writeFileSync(fixturePath, `<!doctype html><html><head><style>
    html,body{margin:0;width:100%;height:100%;overflow:hidden}
    #board-viewport{position:relative;width:800px;height:500px;overflow:hidden}
    #board-overview{position:absolute;inset:0;pointer-events:none}
  </style></head><body>
    <div id="board-viewport"><canvas id="board-overview"></canvas></div>
    <script src="${leaferUrl}"></script><script src="${exportUrl}"></script><script src="${layerUrl}"></script><script>
      window.runLeaferFixture = async () => {
        const canvas = document.getElementById('board-overview');
        const items = [];
        const bounds = new Map();
        const files = new Map([
          ['image-file', { id: 'image-file', kind: 'image', thumbUrl: ${JSON.stringify(pixel)} }],
          ['image-pending', { id: 'image-pending', kind: 'image', thumbUrl: '' }]
        ]);
        for (let index = 0; index < 5000; index += 1) {
          const item = {
            id: 'item-' + index,
            x: (index % 100) * 110,
            y: Math.floor(index / 100) * 90,
            width: 80,
            height: 60,
            zIndex: 1
          };
          if (index === 0) item.isPartition = true;
          if (index === 1) { item.isNote = true; item.text = 'Leafer note'; item.color = '#f1f3f7'; }
          if (index === 2) { item.fileId = 'image-file'; }
          if (index === 3) { item.fileId = 'image-pending'; }
          items.push(item);
          bounds.set(item.id, { x: item.x, y: item.y, w: item.width, h: item.height });
        }
        const layer = window.MesssBoardLeaferLayer;
        const initialized = layer.init({ canvas, width: 800, height: 500, pixelRatio: 1 });
        const syncStartedAt = performance.now();
        const synced = layer.sync({
          cacheKey: 'fixture:1:all',
          items,
          getBounds: (item) => bounds.get(item.id),
          getFile: (item) => files.get(item.fileId),
          getSource: (file) => file && file.thumbUrl,
          getColor: () => '#536176'
        });
        const syncMs = performance.now() - syncStartedAt;
        const syncCalls = layer.syncCalls;
        const cachedSync = layer.sync({
          cacheKey: 'fixture:1:all',
          items,
          getBounds: (item) => bounds.get(item.id),
          getFile: (item) => files.get(item.fileId),
          getSource: (file) => file && file.thumbUrl,
          getColor: () => '#536176'
        });
        layer.setTransform({ panX: 120, panY: 80, zoom: 0.72 });
        const beforeResize = { width: canvas.width, height: canvas.height };
        const initialPixelRatio = layer.pixelRatio;
        const exported = await Promise.resolve(layer.toDataURL({
          pixelRatio: 2,
          clip: { x: 0, y: 0, width: 800, height: 500 }
        }));
        const exportImage = await new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
          image.onerror = () => reject(new Error('Leafer export image could not be decoded'));
          image.src = exported;
        });
        layer.resize(800, 500, 1.5);
        const resizeCalls = layer.resizeCalls;
        layer.resize(800, 500, 1.5);
        const afterResize = { width: canvas.width, height: canvas.height };
        return {
          initialized,
          synced,
          cachedSync,
          itemCount: layer.itemCount,
          syncMs,
          syncCalls,
          syncCallsAfterCached: layer.syncCalls,
          initialPixelRatio,
          pixelRatio: layer.pixelRatio,
          beforeResize,
          afterResize,
          resizeCalls,
          resizeCallsAfterRepeat: layer.resizeCalls,
          exportImage,
          exportPrefix: String(exported || '').slice(0, 22),
          exportLength: String(exported || '').length,
          visible: layer.visible,
          hasGlobal: Boolean(window.LeaferUI && window.LeaferUI.Leafer)
        };
      };
    </script></body></html>`, 'utf8');

  const window = new BrowserWindow({
    width: 840,
    height: 540,
    show: false,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });
  try {
    await window.loadFile(fixturePath);
    const result = await window.webContents.executeJavaScript('runLeaferFixture()');
    if (!result.initialized || !result.synced || !result.cachedSync || result.itemCount !== 5000 ||
        result.syncMs > 2000 || result.syncCalls !== result.syncCallsAfterCached ||
        result.initialPixelRatio !== 1 || result.pixelRatio !== 1.5 || result.beforeResize.width !== 800 ||
        result.beforeResize.height !== 500 || result.afterResize.width !== 1200 ||
        result.afterResize.height !== 750 || !result.visible || !result.hasGlobal ||
        result.resizeCalls !== result.resizeCallsAfterRepeat ||
        result.exportImage.width !== 1600 || result.exportImage.height !== 1000 ||
        !result.exportPrefix.startsWith('data:image/') || result.exportLength < 100) {
      throw new Error(`Leafer layer fixture failed: ${JSON.stringify(result)}`);
    }
    const source = fs.readFileSync(path.join(root, 'src', 'js', 'board-leafer-layer.js'), 'utf8');
    if (!source.includes("placeholderColor: 'rgba(0, 0, 0, 0)'")) {
      throw new Error('Leafer media placeholders must remain transparent during async decode.');
    }
    if (!source.includes("colorMode === 'auto' || (!colorMode && color === '#15171c')")) {
      throw new Error('Auto-colored text notes must stay readable after switching to Leafer.');
    }
    if (!source.includes("item.isNote ? 160 : 36")) {
      throw new Error('Leafer text notes must preserve the large editor font range.');
    }
    if (!source.includes("moodboardBodyForItem(item), '#f3f5f8'") ||
        !source.includes('fontSize: 18') || !source.includes('fontSize: 17') ||
        !source.includes("lineHeight: { type: 'percent', value: 1.5 }")) {
      throw new Error('Leafer moodboard text must use the readable large-text style.');
    }
    process.stdout.write(`BOARD_LEAFER_LAYER_OK items=${result.itemCount} resize=${result.afterResize.width}x${result.afterResize.height}\n`);
  } finally {
    window.destroy();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

app.whenReady().then(run).then(() => app.quit()).catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  app.exit(1);
});
