'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { setTimeout: wait } = require('timers/promises');

const root = path.join(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'messs-clipboard-runtime-'));
const userData = path.join(tempRoot, 'user-data');
const debugPort = 9339;
let child = null;

async function json(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response.json();
}

async function waitForTarget() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const targets = await json(`http://127.0.0.1:${debugPort}/json/list`);
      const target = targets.find((entry) => entry.type === 'page' && /src[\\/]index\.html|src%5Cindex\.html/i.test(entry.url));
      if (target && target.webSocketDebuggerUrl) return target;
    } catch (error) {}
    await wait(100);
  }
  throw new Error('The Messs renderer did not expose its QA debug target.');
}

function connectDebugger(url) {
  const socket = new WebSocket(url);
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  return new Promise((resolve, reject) => {
    socket.addEventListener('error', reject, { once: true });
    socket.addEventListener('open', () => resolve({
      socket,
      send(method, params = {}) {
        const id = nextId++;
        return new Promise((resolveMessage, rejectMessage) => {
          pending.set(id, { resolve: resolveMessage, reject: rejectMessage });
          socket.send(JSON.stringify({ id, method, params }));
        });
      }
    }), { once: true });
  });
}

async function evaluate(send, expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Renderer evaluation failed.');
  return result.result && result.result.value;
}

async function run() {
  const electron = require('electron');
  const png = await require('sharp')({
    create: { width: 4, height: 3, channels: 4, background: { r: 44, g: 91, b: 210, alpha: 1 } }
  }).png().toBuffer();
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
  child = spawn(electron, [root], {
    cwd: root,
    env: {
      ...process.env,
      MESSS_USER_DATA_DIR: userData,
      MESSS_QA_REMOTE_DEBUG_PORT: String(debugPort),
      MESSS_DISABLE_GPU: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  let diagnostics = '';
  child.stdout.on('data', (chunk) => { diagnostics += String(chunk); });
  child.stderr.on('data', (chunk) => { diagnostics += String(chunk); });

  const target = await waitForTarget();
  const { socket, send } = await connectDebugger(target.webSocketDebuggerUrl);
  await send('Runtime.enable');
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const ready = await evaluate(send, `typeof AppState !== 'undefined' && Array.isArray(AppState.canvases) && AppState.canvases.length > 0`);
    if (ready) break;
    if (attempt === 99) throw new Error(`Messs did not finish bootstrapping.\n${diagnostics}`);
    await wait(100);
  }

  const result = await evaluate(send, `(async () => {
    showCanvasWorkspace();
    for (let attempt = 0; attempt < 50 && !document.getElementById('board-viewport'); attempt += 1) {
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    }
    if (!document.getElementById('board-viewport')) {
      return { prevented: false, fileDelta: 0, reason: 'board-viewport-not-mounted' };
    }
    const before = AppState.files.length;
    const dataUrl = ${JSON.stringify(dataUrl)};
    const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'image/png' });
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'external-image.png', { type: 'image/png' }));
    transfer.setData('text/html', '<img src="' + dataUrl + '">');
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer });
    document.getElementById('board-viewport').dispatchEvent(event);
    for (let attempt = 0; attempt < 50 && AppState.files.length === before; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const file = AppState.files[0];
    const item = AppState.boardItems.find((entry) => entry.fileId === (file && file.id));
    if (!file || !item) {
      return { prevented: event.defaultPrevented, fileDelta: AppState.files.length - before, ext: file && file.ext, hasBoardItem: false };
    }

    const sourceCanvasId = AppState.activeCanvasId;
    const targetCanvasId = 'qa-cross-canvas';
    if (!AppState.canvases.some((canvas) => canvas.id === targetCanvasId)) {
      AppState.canvases.push({
        id: targetCanvasId,
        projectId: AppState.canvases[0].projectId,
        name: 'QA Cross Canvas',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
    const sourceItem = {
      id: 'qa-source-' + Date.now(),
      fileId: file.id,
      x: 80,
      y: 80,
      width: 220,
      height: 165,
      zIndex: 1,
      canvasId: sourceCanvasId,
      selected: true
    };
    AppState.allBoardItems.push(sourceItem);
    AppState.boardItems = AppState.allBoardItems.filter((entry) => entry.canvasId === sourceCanvasId);
    await window.messsAPI.upsertBoardItem(sourceItem);
    renderBoard();

    const copyEvent = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(copyEvent);
    // Switching through the canvas library can briefly blur the window. The
    // in-app clipboard must still be available when the target opens.
    window.dispatchEvent(new Event('blur'));
    switchCanvas(targetCanvasId, { enterWorkspace: true });
    const pasteEvent = new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(pasteEvent);
    await (Board.historyPersistPromise || Promise.resolve());
    const pastedItem = AppState.allBoardItems.find((entry) => entry.id !== sourceItem.id && entry.fileId === file.id && entry.canvasId === targetCanvasId);
    if (!pastedItem) {
      return { prevented: event.defaultPrevented, fileDelta: AppState.files.length - before, ext: file && file.ext,
        hasBoardItem: !!item, crossCanvasCopyPrevented: copyEvent.defaultPrevented,
        crossCanvasPastePrevented: pasteEvent.defaultPrevented, crossCanvasPasted: false,
        visibleAfterSwitch, reason: 'cross-canvas-paste-missing', activeCanvasId: AppState.activeCanvasId,
        clipboard: { preferInternal: BoardClipboard.preferInternal, items: BoardClipboard.items.length,
          mediaFileIds: BoardClipboard.mediaFileIds, sourceCanvasId: BoardClipboard.sourceCanvasId } };
    }
    switchCanvas(sourceCanvasId, { enterWorkspace: true });
    switchCanvas(targetCanvasId, { enterWorkspace: true });
    const visibleAfterSwitch = AppState.boardItems.some((entry) => entry.id === (pastedItem && pastedItem.id));
    showCanvasLibrary();
    for (let attempt = 0; attempt < 50 && !document.querySelector('[data-canvas-id="' + targetCanvasId + '"]'); attempt += 1) {
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    }
    const targetCard = document.querySelector('[data-canvas-id="' + targetCanvasId + '"]');
    if (!targetCard) {
      return { prevented: event.defaultPrevented, fileDelta: AppState.files.length - before, ext: file && file.ext,
        hasBoardItem: !!item, crossCanvasCopyPrevented: copyEvent.defaultPrevented,
        crossCanvasPastePrevented: pasteEvent.defaultPrevented, crossCanvasPasted: !!pastedItem,
        visibleAfterSwitch, reason: 'canvas-library-card-not-mounted' };
    }
    const contextEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 120 });
    targetCard.dispatchEvent(contextEvent);
    const pinMenu = document.getElementById('canvas-card-context-menu');
    const pinAction = pinMenu && pinMenu.querySelector('.context-menu-item');
    if (pinAction) pinAction.click();
    await new Promise((resolve) => setTimeout(resolve, 150));
    const pinnedCanvas = AppState.canvases.find((canvas) => canvas.id === targetCanvasId);
    const pinnedCard = document.querySelector('[data-canvas-id="' + targetCanvasId + '"]');
    const orderedCanvases = filteredCanvases();
    const persisted = await window.messsAPI.getInitialState();
    const persistedAfterReload = persisted.boardItems.some((entry) => entry.id === (pastedItem && pastedItem.id) && entry.canvasId === targetCanvasId);
    const persistedPin = persisted.canvases.some((canvas) => canvas.id === targetCanvasId && canvas.pinned === true);
    return {
      prevented: event.defaultPrevented,
      fileDelta: AppState.files.length - before,
      ext: file && file.ext,
      hasBoardItem: !!item,
      crossCanvasCopyPrevented: copyEvent.defaultPrevented,
      crossCanvasPastePrevented: pasteEvent.defaultPrevented,
      crossCanvasPasted: !!pastedItem,
      visibleAfterSwitch,
      persistedAfterReload,
      pinContextMenuOpened: !!pinMenu,
      pinned: !!(pinnedCanvas && pinnedCanvas.pinned),
      pinBadgeVisible: !!(pinnedCard && !pinnedCard.querySelector('.canvas-library-card-pin').hidden),
      pinnedFirst: orderedCanvases[0] && orderedCanvases[0].id === targetCanvasId,
      persistedPin
    };
  })()`);
  socket.close();
  if (!result || !result.prevented || result.fileDelta !== 1 || result.ext !== '.png' || !result.hasBoardItem
    || !result.crossCanvasCopyPrevented || !result.crossCanvasPastePrevented || !result.crossCanvasPasted
    || !result.visibleAfterSwitch || !result.persistedAfterReload || !result.pinContextMenuOpened
    || !result.pinned || !result.pinBadgeVisible || !result.pinnedFirst || !result.persistedPin) {
    throw new Error(`Clipboard IPC paste did not reach the canvas: ${JSON.stringify(result)}\n${diagnostics}`);
  }
  process.stdout.write(`CLIPBOARD_PASTE_RUNTIME_OK ${JSON.stringify(result)}\n`);
}

run().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
}).finally(async () => {
  if (child && !child.killed) child.kill();
  await wait(200);
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
