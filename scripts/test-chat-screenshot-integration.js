'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { setTimeout: wait } = require('timers/promises');

const root = path.join(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'messs-screenshot-integration-'));
const debugPort = 9341;
let child = null;
let currentStage = 'starting';
let diagnostics = '';

async function listTargets() {
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
  if (!response.ok) throw new Error(`Remote debugger returned HTTP ${response.status}.`);
  return response.json();
}

async function waitForTarget(predicate, label) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      const target = (await listTargets()).find(predicate);
      if (target && target.webSocketDebuggerUrl) return target;
    } catch (error) {}
    await wait(100);
  }
  throw new Error(`${label} target was not exposed.`);
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
  socket.addEventListener('close', () => {
    for (const { reject } of pending.values()) reject(new Error(`Remote debugger target closed.\\n${diagnostics}`));
    pending.clear();
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
  const result = await Promise.race([
    send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }),
    wait(5_000).then(() => { throw new Error('Remote debugger evaluation timed out.'); })
  ]);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result && result.result.value;
}

async function waitForValue(send, expression, label) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const value = await evaluate(send, expression);
    if (value) return value;
    await wait(100);
  }
  throw new Error(`${label} did not become ready.`);
}

async function run() {
  const packagedExecutable = String(process.env.MESSS_SCREENSHOT_PACKAGED_EXE || '').trim();
  const executable = packagedExecutable || require('electron');
  child = spawn(executable, packagedExecutable ? [] : [root], {
    cwd: root,
    env: {
      ...process.env,
      MESSS_USER_DATA_DIR: path.join(tempRoot, 'user-data'),
      MESSS_LIBRARY_ROOT: path.join(tempRoot, 'library'),
      MESSS_QA_REMOTE_DEBUG_PORT: String(debugPort),
      MESSS_DISABLE_GPU: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  child.stdout.on('data', (chunk) => { diagnostics += String(chunk); });
  child.stderr.on('data', (chunk) => { diagnostics += String(chunk); });

  currentStage = 'waiting for app renderer';
  const appTarget = await waitForTarget(
    (target) => target.type === 'page' && /src[\\/]index\.html|src%5Cindex\.html/i.test(target.url),
    'SCAAP renderer'
  );
  const appDebugger = await connectDebugger(appTarget.webSocketDebuggerUrl);
  await appDebugger.send('Runtime.enable');
  await waitForValue(appDebugger.send, `typeof window.messsAPI?.captureChatScreenshotDraft === 'function'`, 'Screenshot IPC');
  const startedAt = Date.now();
  currentStage = 'starting screenshot IPC';
  await evaluate(appDebugger.send, `(() => {
    window.__screenshotIntegrationResult = null;
    window.messsAPI.captureChatScreenshotDraft()
      .then((value) => { window.__screenshotIntegrationResult = value; })
      .catch((error) => { window.__screenshotIntegrationResult = { ok: false, message: error.message }; });
    return true;
  })()`);

  currentStage = 'waiting for screenshot editor';
  const screenshotTarget = await waitForTarget(
    (target) => target.type === 'page' && /react-screenshots[\\/]dist[\\/]electron\.html/i.test(decodeURIComponent(target.url)),
    'Screenshot editor'
  );
  const screenshotDebugger = await connectDebugger(screenshotTarget.webSocketDebuggerUrl);
  await screenshotDebugger.send('Runtime.enable');
  currentStage = 'waiting for screenshot image';
  await waitForValue(screenshotDebugger.send,
    `document.querySelector('.screenshots-background-image')?.src?.startsWith('data:image/png;base64,')`,
    'Screenshot image');

  currentStage = 'selecting screenshot bounds';
  await screenshotDebugger.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 120, y: 120, button: 'left', clickCount: 1 });
  await screenshotDebugger.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 520, y: 360, button: 'left' });
  await screenshotDebugger.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 520, y: 360, button: 'left', clickCount: 1 });
  await waitForValue(screenshotDebugger.send, `Boolean(document.querySelector('.icon-ok'))`, 'Screenshot confirmation control');
  await waitForValue(screenshotDebugger.send,
    `(() => { const toolbar = document.querySelector('.screenshots-operations-buttons'); return Boolean(toolbar && getComputedStyle(toolbar).backgroundColor !== 'rgb(255, 255, 255)'); })()`,
    'Screenshot editor theme');
  await waitForValue(screenshotDebugger.send,
    `window.__messsScreenshotPolishInstalled === true`,
    'Screenshot editor size formatter');
  await evaluate(screenshotDebugger.send,
    `(() => { const size = document.querySelector('.screenshots-canvas-size'); if (!size) return false; size.textContent = '349.3333740234375 × 195.333740234375'; return true; })()`);
  await waitForValue(screenshotDebugger.send,
    `document.querySelector('.screenshots-canvas-size')?.textContent === '349 × 195'`,
    'Screenshot editor integer size');
  const presentation = await evaluate(screenshotDebugger.send, `(() => {
    const toolbar = document.querySelector('.screenshots-operations-buttons');
    const size = document.querySelector('.screenshots-canvas-size');
    if (!toolbar || !size) return null;
    const style = getComputedStyle(toolbar);
    return {
      background: style.backgroundColor,
      borderRadius: style.borderRadius,
      sizeText: size.textContent.trim()
    };
  })()`);
  assert.ok(presentation, 'Screenshot editor presentation is missing.');
  assert.notStrictEqual(presentation.background, 'rgb(255, 255, 255)');
  assert.strictEqual(presentation.borderRadius, '10px');
  assert.match(presentation.sizeText, /^\d+ × \d+$/);
  currentStage = 'confirming screenshot';
  const clicked = await evaluate(screenshotDebugger.send,
    `Boolean(document.querySelector('.icon-ok')?.closest('.screenshots-button')?.click() ?? true)`);
  assert.strictEqual(clicked, true);

  currentStage = 'waiting for chat attachment draft';
  const result = await waitForValue(appDebugger.send, `window.__screenshotIntegrationResult`, 'Screenshot chat draft');
  assert.strictEqual(result.ok, true, `${JSON.stringify(result)}\n${diagnostics}`);
  assert.strictEqual(result.draft.kind, 'image');
  assert.strictEqual(result.draft.mime, 'image/png');
  assert.ok(result.draft.size > 100);
  assert.match(result.draft.previewDataUrl || '', /^data:image\/png;base64,/);
  await evaluate(appDebugger.send, `window.messsAPI.discardChatAttachmentDraft(${JSON.stringify(result.draft.token)})`);

  screenshotDebugger.socket.close();
  appDebugger.socket.close();
  process.stdout.write(`CHAT_SCREENSHOT_INTEGRATION_OK ${Date.now() - startedAt}ms size=${result.draft.size}\n`);
}

run().catch((error) => {
  process.stderr.write(`Stage: ${currentStage}\n${error.stack || error.message}\n${diagnostics}`);
  process.exitCode = 1;
}).finally(async () => {
  if (child && !child.killed) child.kill();
  await wait(250);
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
