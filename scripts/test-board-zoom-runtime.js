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
  const leaferUrl = pathToFileURL(path.join(root, 'src', 'vendor', 'leafer-ui.web.min.js')).href;
  const leaferLayerUrl = pathToFileURL(path.join(root, 'src', 'js', 'board-leafer-layer.js')).href;
  const freehandUrl = pathToFileURL(path.join(root, 'src', 'js', 'vendor', 'perfect-freehand.js')).href;
  const boardUrl = pathToFileURL(path.join(root, 'src', 'js', 'board-canvas.js')).href;
  const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XvY7WQAAAABJRU5ErkJggg==';

  fs.writeFileSync(fixturePath, `<!doctype html><html><head><style>
    html,body{margin:0;width:100%;height:100%;overflow:hidden}
    #board-viewport{position:relative;width:900px;height:600px;overflow:hidden}
    #board-canvas{position:absolute;left:0;top:0;width:1px;height:1px;transform-origin:0 0}
    .board-item{position:absolute}.board-image-layer{display:block;width:100%;height:100%}
    .board-overview-canvas{position:absolute;inset:0}.board-overview-canvas[hidden]{display:none}
    </style></head><body>
    <div id="board-viewport"><div id="board-canvas"></div><canvas id="board-doodle-canvas" hidden></canvas></div>
    <button id="board-tool-doodle"></button><div id="doodle-color-panel" hidden></div>
    <div id="board-zoom-label"></div>
    <script src="${leaferUrl}"></script><script src="${leaferLayerUrl}"></script><script src="${engineUrl}"></script><script src="${freehandUrl}"></script><script>
      // Keep the logic test deterministic when the host OS throttles an
      // unfocused Electron test window.
      window.requestAnimationFrame = (callback) => setTimeout(() => callback(performance.now()), 0);
      window.cancelAnimationFrame = (handle) => clearTimeout(handle);
      window.createLatestFrameRunner = (callback) => {
        let frameId = 0;
        let latestValue;
        const run = () => {
          frameId = 0;
          if (latestValue === undefined) return;
          const value = latestValue;
          latestValue = undefined;
          callback(value);
        };
        return {
          push(value) { latestValue = value; if (!frameId) frameId = requestAnimationFrame(run); },
          flush() { if (frameId) cancelAnimationFrame(frameId); frameId = 0; run(); }
        };
      };
      window.AppState = { boardItems: [], files: [] };
      window.activeCanvasId = () => 'zoom-runtime';
      window.canvasWorkspaceTouch = () => {};
      window.canvasWorkspaceSave = async () => {};
      window.messsAPI = { upsertBoardItems: async () => {} };
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
          makeBoardItemDraggable(element, item);
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
        items: AppState.boardItems.length,
        mounted: Board.mounted.size,
        targetVisible: Board.interactionVisibleIds.size,
        leaferItems: Board.leaferLayer ? Board.leaferLayer.itemCount : 0,
        queue: Board.mountQueue.size,
        wheel: Board.isWheelZooming,
        animating: Boolean(Board.zoomFrame || Board.zoomTarget),
        zoom: Board.zoom,
        visible: Board.visibleIds.size,
        missingVisible: [...Board.visibleIds].filter((id) => !Board.mounted.has(id)).length,
        invalidMounted: [...Board.mounted.keys()].filter((id) => !Board.itemsById.has(id)).length,
        unpaintedVisible: unpaintedVisibleBoardIds().size,
        motionFallbackVisible: Boolean(Board.overviewCanvas && !Board.overviewCanvas.hidden),
        overviewHidden: !Board.overviewCanvas || Board.overviewCanvas.hidden
      });
      window.runSelectionFixture = () => {
        Board.zoom = 1;
        Board.panX = 0;
        Board.panY = 0;
        Board.zoomTarget = null;
        Board.zoomFrame = 0;
        document.getElementById('board-canvas').style.transform = boardTransform();

        const first = Board.itemsById.get('item-0-0');
        const second = Board.itemsById.get('item-0-1');
        const staleGroupMate = Board.itemsById.get('item-0-9');
        AppState.boardItems.forEach((item) => { item.selected = false; item.groupId = null; item.partitionId = null; });
        first.partitionId = 'partition-a';
        first.groupId = 'legacy-group';
        staleGroupMate.groupId = 'legacy-group';
        rebuildBoardSpatialIndex();

        startBoxSelect({ clientX: 0, clientY: 0, shiftKey: false });
        document.dispatchEvent(new MouseEvent('mouseup', {
          bubbles: true,
          clientX: 240,
          clientY: 90
        }));
        const selectedBeforeDrag = AppState.boardItems.filter((item) => item.selected).map((item) => item.id).sort();
        const before = {
          first: { x: first.x, y: first.y },
          second: { x: second.x, y: second.y },
          stale: { x: staleGroupMate.x, y: staleGroupMate.y }
        };

        const firstElement = Board.mounted.get(first.id);
        firstElement.dispatchEvent(new MouseEvent('mousedown', {
          bubbles: true,
          button: 0,
          clientX: 20,
          clientY: 20
        }));
        document.dispatchEvent(new MouseEvent('mousemove', {
          bubbles: true,
          clientX: 70,
          clientY: 50
        }));
        document.dispatchEvent(new MouseEvent('mouseup', {
          bubbles: true,
          clientX: 70,
          clientY: 50
        }));

        return {
          selectedBeforeDrag,
          firstDelta: { x: first.x - before.first.x, y: first.y - before.first.y },
          secondDelta: { x: second.x - before.second.x, y: second.y - before.second.y },
          staleDelta: { x: staleGroupMate.x - before.stale.x, y: staleGroupMate.y - before.stale.y }
        };
      };
      window.runDoodleZoomFixture = async () => {
        const canvas = document.getElementById('board-doodle-canvas');
        enterDoodleMode();
        const startRect = canvas.getBoundingClientRect();
        canvas.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true, button: 0, buttons: 1, pointerId: 19,
          pointerType: 'mouse', clientX: 120, clientY: 150
        }));
        canvas.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true, button: 0, buttons: 1, pointerId: 19,
          pointerType: 'mouse', clientX: 220, clientY: 150
        }));
        canvas.dispatchEvent(new PointerEvent('pointerup', {
          bubbles: true, button: 0, buttons: 0, pointerId: 19,
          pointerType: 'mouse', clientX: 220, clientY: 150
        }));
        const sampleInk = (cssX, cssY) => {
          const context = canvas.getContext('2d');
          const ratio = Math.max(1, Number(doodlePixelRatio) || 1);
          const centerX = Math.round(cssX * ratio);
          const centerY = Math.round(cssY * ratio);
          let alpha = 0;
          for (let y = centerY - Math.ceil(4 * ratio); y <= centerY + Math.ceil(4 * ratio); y += 1) {
            for (let x = centerX - Math.ceil(4 * ratio); x <= centerX + Math.ceil(4 * ratio); x += 1) {
              if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) continue;
              alpha = Math.max(alpha, context.getImageData(x, y, 1, 1).data[3]);
            }
          }
          return alpha;
        };
        const beforePixel = sampleInk(170, 150);
        const beforeTransform = getComputedStyle(canvas).transform;
        Board.isWheelZooming = true;
        Board.zoom = 1.8;
        Board.panX = -80;
        Board.panY = -45;
        applyBoardTransform();
        await new Promise((resolve) => setTimeout(resolve, 20));
        const afterRect = canvas.getBoundingClientRect();
        const afterPixel = sampleInk(170, 150);
        const afterTransform = getComputedStyle(canvas).transform;
        const boardTransformValue = getComputedStyle(document.getElementById('board-canvas')).transform;
        Board.isWheelZooming = false;
        Board.zoomTarget = null;
        exitDoodleMode(false);
        return {
          beforeRect: { left: startRect.left, top: startRect.top, width: startRect.width, height: startRect.height },
          afterRect: { left: afterRect.left, top: afterRect.top, width: afterRect.width, height: afterRect.height },
          beforePixel, afterPixel, beforeTransform, afterTransform, boardTransformValue
        };
      };
    </script></body></html>`, 'utf8');

  const window = new BrowserWindow({
    width: 960,
    height: 700,
    x: 20,
    y: 20,
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
      await waitFor(window, 'zoomFixtureState().wheel && zoomFixtureState().targetVisible === 60 && (zoomFixtureState().mounted >= 6 || zoomFixtureState().leaferItems === 60)', 400);
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
    if (during.targetVisible !== 60 || (!during.mounted && during.leaferItems !== 60) || !during.wheel) {
      throw new Error(`Target viewport was not represented during zoom: ${JSON.stringify(during)}`);
    }
    if (!during.motionFallbackVisible) {
      throw new Error(`Zoom interaction exposed an empty frame before mounts completed: ${JSON.stringify(during)}`);
    }
    if (settled.items !== 60 || settled.visible !== 60 || settled.missingVisible !== 0 ||
        settled.invalidMounted !== 0 || settled.unpaintedVisible !== 0 ||
        !settled.overviewHidden || Math.abs(settled.zoom - 0.6) > 0.001) {
      throw new Error(`Zoom settled with missing or fallback media: ${JSON.stringify(settled)}`);
    }
    const selection = await window.webContents.executeJavaScript(`(() => {
      try { return runSelectionFixture(); }
      catch (error) { return { error: error && error.stack || String(error) }; }
    })()`);
    if (selection.error) throw new Error(`Selection fixture failed: ${selection.error}`);
    if (selection.selectedBeforeDrag.join(',') !== 'item-0-0,item-0-1' ||
        selection.firstDelta.x !== 50 || selection.firstDelta.y !== 30 ||
        selection.secondDelta.x !== 50 || selection.secondDelta.y !== 30 ||
        selection.staleDelta.x !== 0 || selection.staleDelta.y !== 0) {
      throw new Error(`Marquee selection or grouped drag regressed: ${JSON.stringify(selection)}`);
    }
    const doodle = await window.webContents.executeJavaScript('runDoodleZoomFixture()');
    const rectStable = Math.abs(doodle.beforeRect.left - doodle.afterRect.left) < 0.01 &&
      Math.abs(doodle.beforeRect.top - doodle.afterRect.top) < 0.01 &&
      Math.abs(doodle.beforeRect.width - doodle.afterRect.width) < 0.01 &&
      Math.abs(doodle.beforeRect.height - doodle.afterRect.height) < 0.01;
    if (doodle.beforePixel === 0 || doodle.afterPixel === 0 || !rectStable ||
        doodle.beforeTransform !== 'none' || doodle.afterTransform !== 'none' ||
        doodle.boardTransformValue === 'none') {
      throw new Error(`Doodle overlay followed board zoom: ${JSON.stringify(doodle)}`);
    }
    process.stdout.write(`BOARD_ZOOM_RUNTIME_OK during=leafer:${during.leaferItems}/dom:${during.mounted} settled=${settled.mounted}/60 selection=2 drag=50x30 doodle=screen-locked\n`);
  } finally {
    window.destroy();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

app.whenReady().then(run).then(() => app.quit()).catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  app.exit(1);
});
