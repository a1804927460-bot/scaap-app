'use strict';

const { app } = require('electron');

const screenshotsModule = require('electron-screenshots');
const ElectronScreenshots = screenshotsModule.default || screenshotsModule;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout(promise, milliseconds, label) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds}ms`)), milliseconds);
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function waitUntil(predicate, label, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await predicate()) return;
    await wait(50);
  }
  throw new Error(`${label} did not become ready.`);
}

async function captureAndCancel(tool) {
  const startedAt = Date.now();
  const cancelled = new Promise((resolve) => tool.once('cancel', resolve));
  await withTimeout(tool.startCapture(), 15_000, 'Screenshot capture');
  await waitUntil(async () => tool.$view.webContents.executeJavaScript(`(() => {
    const image = document.querySelector('.screenshots-background-image');
    return Boolean(image && image.src.startsWith('data:image/png;base64,') && image.src.length > 100);
  })()`), 'Screenshot image');

  if (!tool.$win || tool.$win.isDestroyed() || !tool.$win.isVisible()) {
    throw new Error('The screenshot selection window was not shown.');
  }
  tool.$view.webContents.sendInputEvent({ type: 'mouseDown', x: 120, y: 120, button: 'left', clickCount: 1 });
  tool.$view.webContents.sendInputEvent({ type: 'mouseMove', x: 420, y: 320, button: 'left' });
  tool.$view.webContents.sendInputEvent({ type: 'mouseUp', x: 420, y: 320, button: 'left', clickCount: 1 });
  await waitUntil(async () => tool.$view.webContents.executeJavaScript(
    `Boolean(document.querySelector('.screenshots') && document.querySelector('.screenshots-operations'))`
  ), 'Screenshot editor controls');

  await tool.$view.webContents.executeJavaScript('window.screenshots.cancel()');
  await withTimeout(cancelled, 3_000, 'Screenshot cancellation');
  await waitUntil(() => !tool.$win || tool.$win.isDestroyed() || !tool.$win.isVisible(), 'Screenshot window cleanup');
  return Date.now() - startedAt;
}

async function run() {
  const tool = new ElectronScreenshots({ singleWindow: true, logger: () => {} });
  try {
    const first = await captureAndCancel(tool);
    const firstWindow = tool.$win;
    const second = await captureAndCancel(tool);
    if (!firstWindow || tool.$win !== firstWindow) throw new Error('The screenshot window was not reused.');
    process.stdout.write(`SCREENSHOT_RUNTIME_OK first=${first}ms second=${second}ms reused=true\n`);
  } finally {
    await tool.endCapture().catch(() => {});
  }
}

app.whenReady().then(run).then(() => app.quit()).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  app.exit(1);
});
