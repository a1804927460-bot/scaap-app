'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { setTimeout: wait } = require('timers/promises');

const root = path.join(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'messs-detached-canvas-'));
const debugPort = 9350 + (process.pid % 200);
let child = null;

async function targets() {
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
  if (!response.ok) throw new Error(`Debug target request failed with HTTP ${response.status}.`);
  return (await response.json()).filter((entry) => (
    entry.type === 'page' && /src[\\/]index\.html|src%5Cindex\.html/i.test(entry.url)
  ));
}

async function waitForTargets(predicate, timeoutMs = 12_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const current = await targets();
      const value = predicate(current);
      if (value) return value;
    } catch (error) {}
    await wait(100);
  }
  throw new Error('Timed out waiting for the expected Messs renderer windows.');
}

function connectDebugger(url) {
  const socket = new WebSocket(url);
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
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
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Renderer evaluation failed.');
  }
  return result.result && result.result.value;
}

async function waitForRenderer(send, expression, timeoutMs = 10_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await evaluate(send, expression)) return;
    await wait(80);
  }
  throw new Error(`Timed out waiting for renderer state: ${expression}`);
}

async function run() {
  const electron = require('electron');
  child = spawn(electron, [root], {
    cwd: root,
    env: {
      ...process.env,
      MESSS_USER_DATA_DIR: path.join(tempRoot, 'user-data'),
      MESSS_QA_REMOTE_DEBUG_PORT: String(debugPort),
      MESSS_DISABLE_GPU: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  let diagnostics = '';
  child.stdout.on('data', (chunk) => { diagnostics += String(chunk); });
  child.stderr.on('data', (chunk) => { diagnostics += String(chunk); });

  const mainTarget = await waitForTargets((current) => current.find((entry) => !/detachedCanvas=/i.test(entry.url)));
  const mainDebugger = await connectDebugger(mainTarget.webSocketDebuggerUrl);
  await mainDebugger.send('Runtime.enable');
  await waitForRenderer(mainDebugger.send, `typeof AppState !== 'undefined' && AppState.canvases.length > 0`);

  const sourceCanvasId = await evaluate(mainDebugger.send, `(async () => {
    showCanvasWorkspace();
    const canvasId = activeCanvasId();
    const result = await openActiveCanvasInDetachedWindow({ x: window.screenX + window.outerWidth + 30, y: window.screenY + 120 });
    if (!result || !result.ok) throw new Error('The detach action was rejected.');
    return canvasId;
  })()`);

  const detachedTarget = await waitForTargets((current) => current.find((entry) => /detachedCanvas=/i.test(entry.url)));
  const detachedDebugger = await connectDebugger(detachedTarget.webSocketDebuggerUrl);
  await detachedDebugger.send('Runtime.enable');
  await waitForRenderer(detachedDebugger.send, `Boolean(document.body && document.getElementById('board-workspace-body') && document.body.classList.contains('is-detached-canvas-window') && !document.getElementById('board-workspace-body').hidden)`);

  const detachedLayout = await evaluate(detachedDebugger.send, `(() => ({
    canvasId: activeCanvasId(),
    detached: isDetachedCanvasWindow(),
    boardVisible: getComputedStyle(document.getElementById('board-panel')).display !== 'none',
    sidebarHidden: getComputedStyle(document.getElementById('sidebar')).display === 'none',
    libraryHidden: document.getElementById('canvas-library-view').hidden
  }))()`);
  if (!detachedLayout.detached || detachedLayout.canvasId !== sourceCanvasId || !detachedLayout.boardVisible || !detachedLayout.sidebarHidden || !detachedLayout.libraryHidden) {
    throw new Error(`Detached renderer did not lock to the source canvas: ${JSON.stringify(detachedLayout)}`);
  }
  await waitForRenderer(mainDebugger.send, `Boolean(document.getElementById('board-panel') && document.getElementById('board-panel').classList.contains('is-canvas-library') && !document.getElementById('canvas-library-view').hidden)`);
  await detachedDebugger.send('Page.enable');
  const screenshot = await detachedDebugger.send('Page.captureScreenshot', { format: 'png' });
  const screenshotDir = path.join(root, 'test-artifacts');
  fs.mkdirSync(screenshotDir, { recursive: true });
  fs.writeFileSync(path.join(screenshotDir, 'detached-canvas-window.png'), Buffer.from(screenshot.data, 'base64'));

  const secondCanvasId = await evaluate(mainDebugger.send, `(async () => {
    const id = 'qa-second-canvas';
    if (!AppState.canvases.some((canvas) => canvas.id === id)) {
      AppState.canvases.push({
        id,
        projectId: AppState.canvases[0].projectId,
        name: 'QA Second Canvas',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      await canvasWorkspaceSave();
    }
    switchCanvas(id, { enterWorkspace: true });
    return activeCanvasId();
  })()`);
  if (secondCanvasId !== 'qa-second-canvas') throw new Error('The main window did not switch to the second canvas.');
  const detachedCanvasAfterSwitch = await evaluate(detachedDebugger.send, 'activeCanvasId()');
  if (detachedCanvasAfterSwitch !== sourceCanvasId) throw new Error('The detached window followed the main canvas selection.');
  const detachedSavePreservedMainCanvas = await evaluate(detachedDebugger.send, `(async () => {
    await canvasWorkspaceSave();
    return AppState.canvases.some((canvas) => canvas.id === 'qa-second-canvas');
  })()`);
  if (!detachedSavePreservedMainCanvas) throw new Error('Detached canvas metadata save removed a canvas created by the main window.');

  const itemId = `qa-detached-item-${Date.now()}`;
  await evaluate(detachedDebugger.send, `(async () => {
    const item = { id: ${JSON.stringify(itemId)}, canvasId: activeCanvasId(), type: 'text', text: 'Detached sync', x: 40, y: 40, width: 220, height: 80, zIndex: 1 };
    canvasWorkspaceAddItem(item);
    AppState.boardItems = AppState.allBoardItems.filter((entry) => entry.canvasId === activeCanvasId());
    await window.messsAPI.upsertBoardItem(item);
    return true;
  })()`);
  await waitForRenderer(mainDebugger.send, `AppState.allBoardItems.some((item) => item.id === ${JSON.stringify(itemId)})`);

  const reuse = await evaluate(mainDebugger.send, `window.messsAPI.openDetachedCanvas(${JSON.stringify(sourceCanvasId)}, {})`);
  if (!reuse || !reuse.ok || !reuse.reused) throw new Error(`Repeated detach did not reuse the window: ${JSON.stringify(reuse)}`);
  const rendererCount = (await targets()).length;
  if (rendererCount !== 2) throw new Error(`Expected two renderer windows, found ${rendererCount}.`);

  mainDebugger.socket.close();
  detachedDebugger.socket.close();
  process.stdout.write(`DETACHED_CANVAS_RUNTIME_OK source=${sourceCanvasId} main=${secondCanvasId} windows=${rendererCount}\n`);
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}).finally(async () => {
  if (child && !child.killed) child.kill();
  await wait(150);
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
