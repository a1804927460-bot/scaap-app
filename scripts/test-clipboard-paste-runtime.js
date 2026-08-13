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
    return { prevented: event.defaultPrevented, fileDelta: AppState.files.length - before, ext: file && file.ext, hasBoardItem: !!item };
  })()`);
  socket.close();
  if (!result || !result.prevented || result.fileDelta !== 1 || result.ext !== '.png' || !result.hasBoardItem) {
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
