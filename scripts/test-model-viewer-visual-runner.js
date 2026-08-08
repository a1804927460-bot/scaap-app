'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { app, BrowserWindow } = require('electron');
const sharp = require('sharp');

app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

function padChunk(buffer, byte = 0x20) {
  const padding = (4 - (buffer.length % 4)) % 4;
  return padding ? Buffer.concat([buffer, Buffer.alloc(padding, byte)]) : buffer;
}

function minimalTriangleGlb() {
  const positions = Buffer.alloc(36);
  [-1, -1, 0, 1, -1, 0, 0, 1, 0].forEach((value, index) => positions.writeFloatLE(value, index * 4));
  const indices = Buffer.alloc(6);
  [0, 1, 2].forEach((value, index) => indices.writeUInt16LE(value, index * 2));
  const binary = padChunk(Buffer.concat([positions, indices]), 0);
  const document = {
    asset: { version: '2.0', generator: 'Messs visual test' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.12, 0.82, 0.32, 1], metallicFactor: 0, roughnessFactor: 0.72 } }],
    buffers: [{ byteLength: 42 }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 },
      { buffer: 0, byteOffset: 36, byteLength: 6, target: 34963 }
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-1, -1, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' }
    ]
  };
  const json = padChunk(Buffer.from(JSON.stringify(document), 'utf8'));
  const totalLength = 12 + 8 + json.length + 8 + binary.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(json.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binaryHeader = Buffer.alloc(8);
  binaryHeader.writeUInt32LE(binary.length, 0);
  binaryHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, json, binaryHeader, binary]);
}

function minimalTriangleObj() {
  return Buffer.from([
    'o MesssTriangle',
    'v -1 -1 0',
    'v 1 -1 0',
    'v 0 1 0',
    'f 1 2 3',
    ''
  ].join('\n'), 'utf8');
}

function minimalTriangleFbx() {
  return Buffer.from([
    '; FBX 7.4.0 project file',
    'FBXHeaderExtension:  {',
    '\tFBXHeaderVersion: 1003',
    '\tFBXVersion: 7400',
    '\tCreator: "Messs visual test"',
    '}',
    'Objects:  {',
    '\tGeometry: 1, "Geometry::MesssTriangle", "Mesh" {',
    '\t\tGeometryVersion: 124',
    '\t\tVertices: *9 {',
    '\t\t\ta: -1,-1,0,1,-1,0,0,1,0',
    '\t\t}',
    '\t\tPolygonVertexIndex: *3 {',
    '\t\t\ta: 0,1,-3',
    '\t\t}',
    '\t}',
    '\tModel: 2, "Model::MesssTriangle", "Mesh" {',
    '\t\tVersion: 232',
    '\t\tShading: T',
    '\t\tCulling: "CullingOff"',
    '\t}',
    '}',
    'Connections:  {',
    '\tC: "OO",1,2',
    '}',
    ''
  ].join('\n'), 'utf8');
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForViewerState(window, expected, timeoutMs = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const state = await window.webContents.executeJavaScript(
      "document.querySelector('.board-model-viewer-overlay')?.dataset.state || 'missing'"
    );
    if (state === expected) return;
    if (state === 'error') throw new Error('Model viewer entered its error state.');
    await wait(100);
  }
  throw new Error(`Timed out waiting for model viewer state: ${expected}`);
}

async function captureModelPixels(window, label) {
  const layout = await window.webContents.executeJavaScript(`(() => {
    const viewport = { width: innerWidth, height: innerHeight };
    const dialog = document.querySelector('.board-model-viewer-dialog').getBoundingClientRect();
    const canvas = document.querySelector('.board-model-viewer-canvas').getBoundingClientRect();
    return {
      viewport,
      dialog: { left: dialog.left, top: dialog.top, right: dialog.right, bottom: dialog.bottom },
      canvas: { x: Math.round(canvas.x), y: Math.round(canvas.y), width: Math.round(canvas.width), height: Math.round(canvas.height) }
    };
  })()`);
  if (layout.dialog.left < 0 || layout.dialog.top < 0 ||
      layout.dialog.right > layout.viewport.width || layout.dialog.bottom > layout.viewport.height) {
    throw new Error(`${label} model dialog extends outside the viewport: ${JSON.stringify(layout)}`);
  }
  if (layout.canvas.width < 240 || layout.canvas.height < 220) {
    throw new Error(`${label} model canvas is too small: ${JSON.stringify(layout.canvas)}`);
  }
  const screenshot = await window.webContents.capturePage(layout.canvas);
  const screenshotDir = String(process.env.MESSS_MODEL_VIEWER_SCREENSHOT_DIR || '').trim();
  if (screenshotDir) {
    fs.mkdirSync(screenshotDir, { recursive: true });
    fs.writeFileSync(path.join(screenshotDir, `model-viewer-${label}.png`), screenshot.toPNG());
  }
  const { data, info } = await sharp(screenshot.toPNG()).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const background = [data[0], data[1], data[2]];
  let modelPixels = 0;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const difference = Math.abs(data[offset] - background[0]) +
      Math.abs(data[offset + 1] - background[1]) +
      Math.abs(data[offset + 2] - background[2]);
    if (difference > 32) modelPixels += 1;
  }
  if (modelPixels < 120) throw new Error(`${label} rendered model appears blank (${modelPixels} non-background pixels).`);
  return { modelPixels, rect: layout.canvas };
}

async function captureButlerLayout(window, label, width, height) {
  window.setSize(width, height);
  await wait(180);
  await window.webContents.executeJavaScript(`(() => {
    closeBoardButlerMenu();
    document.body.replaceChildren();
    document.body.style.background = '#292c32';
    const card = document.createElement('div');
    card.className = 'board-item board-item-image is-selected is-single-selection';
    card.style.position = 'fixed';
    card.style.left = Math.round((innerWidth - 220) / 2) + 'px';
    card.style.top = Math.round((innerHeight - 156) / 2) + 'px';
    card.style.width = '220px';
    card.style.height = '156px';
    card.style.border = '1px solid rgba(255,255,255,.18)';
    card.style.borderRadius = '7px';
    card.style.background = '#17191d';
    document.body.appendChild(card);
    appendBoardImageToolbar(card, { id: 'fixture-image', name: 'fixture.png', ext: '.png' }, { id: 'fixture-item', x: 0, y: 0, width: 220 });
    card.querySelector('.board-butler-trigger').click();
    const modelTrigger = document.querySelector('.board-butler-menu-item.has-submenu');
    const modelGroup = modelTrigger.closest('.board-butler-model-group');
    modelTrigger.click();
    modelGroup.dispatchEvent(new MouseEvent('mouseenter'));
  })()`);
  await wait(180);
  const layout = await window.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('.board-item-image');
    const modelTrigger = document.querySelector('.board-butler-menu-item.has-submenu');
    const modelGroup = modelTrigger.closest('.board-butler-model-group');
    const toRect = (element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      toolbar: toRect(card.querySelector('.board-image-toolbar')),
      menu: toRect(document.querySelector('.board-butler-menu')),
      modelMenu: toRect(document.querySelector('.board-butler-model-menu')),
      modelMenuVisible: getComputedStyle(document.querySelector('.board-butler-model-menu')).visibility,
      clickExpanded: modelTrigger.getAttribute('aria-expanded'),
      modelGroupClass: modelGroup.className
    };
  })()`);
  for (const key of ['toolbar', 'menu', 'modelMenu']) {
    const rect = layout[key];
    if (rect.left < 0 || rect.top < 0 || rect.right > layout.viewport.width || rect.bottom > layout.viewport.height) {
      throw new Error(`${label} Butler ${key} extends outside the viewport: ${JSON.stringify(layout)}`);
    }
  }
  if (layout.clickExpanded !== 'true' || layout.modelMenuVisible !== 'visible') {
    throw new Error(`${label} 3D provider menu did not open: ${JSON.stringify(layout)}.`);
  }
  const screenshotDir = String(process.env.MESSS_MODEL_VIEWER_SCREENSHOT_DIR || '').trim();
  if (screenshotDir) {
    const screenshot = await window.webContents.capturePage({
      x: 0,
      y: 0,
      width: Math.round(layout.viewport.width),
      height: Math.round(layout.viewport.height)
    });
    fs.writeFileSync(path.join(screenshotDir, `butler-${label}.png`), screenshot.toPNG());
  }

  await window.webContents.executeJavaScript(
    "document.querySelector('[data-butler-action=\"imageEdit\"]').click()"
  );
  await wait(180);
  const panelLayout = await window.webContents.executeJavaScript(`(() => {
    const panel = document.querySelector('.board-butler-config-panel');
    const rect = panel.getBoundingClientRect();
    return {
      viewport: { width: innerWidth, height: innerHeight },
      panel: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      promptVisible: !!panel.querySelector('textarea') && getComputedStyle(panel.querySelector('textarea')).visibility === 'visible',
      model: panel.querySelector('.board-butler-config-heading small')?.textContent || ''
    };
  })()`);
  if (panelLayout.panel.left < 0 || panelLayout.panel.top < 0 ||
      panelLayout.panel.right > panelLayout.viewport.width || panelLayout.panel.bottom > panelLayout.viewport.height ||
      !panelLayout.promptVisible || panelLayout.model !== 'Qwen-Image-Edit-Plus') {
    throw new Error(`${label} Butler image-edit panel is invalid: ${JSON.stringify(panelLayout)}`);
  }
  if (screenshotDir) {
    const screenshot = await window.webContents.capturePage({
      x: 0,
      y: 0,
      width: Math.round(panelLayout.viewport.width),
      height: Math.round(panelLayout.viewport.height)
    });
    fs.writeFileSync(path.join(screenshotDir, `butler-config-${label}.png`), screenshot.toPNG());
  }
  await window.webContents.executeJavaScript(`(() => {
    closeBoardButlerPanel();
    closeBoardButlerMenu();
    document.body.replaceChildren();
    document.body.style.background = '#292c32';
    const card = document.createElement('div');
    card.className = 'board-item board-item-video is-selected is-single-selection';
    card.style.position = 'fixed';
    card.style.left = Math.round((innerWidth - 220) / 2) + 'px';
    card.style.top = Math.round((innerHeight - 156) / 2) + 'px';
    card.style.width = '220px';
    card.style.height = '156px';
    document.body.appendChild(card);
    appendBoardVideoButlerToolbar(card, {
      id: 'fixture-video', name: 'fixture.mp4', ext: '.mp4', sourceWidth: 1920, sourceHeight: 1080
    }, { id: 'fixture-video-item', x: 0, y: 0, width: 220 });
    card.querySelector('.board-butler-trigger').click();
    window.__videoButlerActionCount = document.querySelectorAll('.board-butler-menu > [data-butler-action]').length;
    window.__videoButlerAction = document.querySelector('.board-butler-menu > [data-butler-action]')?.dataset.butlerAction || '';
    document.querySelector('[data-butler-action="videoUpscale"]').click();
  })()`);
  await wait(180);
  const videoPanel = await window.webContents.executeJavaScript(`(() => {
    const panel = document.querySelector('.board-butler-config-panel');
    const rect = panel.getBoundingClientRect();
    return {
      actionCount: window.__videoButlerActionCount,
      action: window.__videoButlerAction,
      viewport: { width: innerWidth, height: innerHeight },
      panel: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      model: document.querySelector('.board-butler-config-heading small')?.textContent || '',
      resolutions: [...document.querySelectorAll('input[name="butler-video-resolution"]')].map((input) => input.value),
      frameRates: [...document.querySelectorAll('input[name="butler-video-frame-rate"]')].map((input) => input.value),
      cost: document.querySelector('.board-butler-cost-estimate')?.textContent || ''
    };
  })()`);
  if (videoPanel.actionCount !== 1 || videoPanel.action !== 'videoUpscale' ||
      videoPanel.model !== 'Topaz Video AI' || videoPanel.resolutions.length !== 3 || videoPanel.frameRates.length !== 2 ||
      !/\d+\s*pts/i.test(videoPanel.cost) || videoPanel.panel.left < 0 || videoPanel.panel.top < 0 ||
      videoPanel.panel.right > videoPanel.viewport.width || videoPanel.panel.bottom > videoPanel.viewport.height) {
    throw new Error(`${label} Butler video panel is invalid: ${JSON.stringify(videoPanel)}`);
  }
  if (screenshotDir) {
    const screenshot = await window.webContents.capturePage({
      x: 0,
      y: 0,
      width: Math.round(videoPanel.viewport.width),
      height: Math.round(videoPanel.viewport.height)
    });
    fs.writeFileSync(path.join(screenshotDir, `butler-video-${label}.png`), screenshot.toPNG());
  }
  await window.webContents.executeJavaScript(`(() => {
    closeBoardButlerPanel();
    closeBoardButlerMenu();
    document.body.replaceChildren();
    document.body.style.background = '#292c32';
    const card = document.createElement('div');
    card.className = 'board-item board-item-image is-selected is-single-selection';
    card.style.position = 'fixed';
    card.style.left = Math.round((innerWidth - 220) / 2) + 'px';
    card.style.top = Math.round((innerHeight - 156) / 2) + 'px';
    card.style.width = '220px';
    card.style.height = '156px';
    document.body.appendChild(card);
    appendBoardImageToolbar(card, {
      id: 'fixture-mask-image',
      name: 'mask.png',
      ext: '.png',
      sourceWidth: 640,
      sourceHeight: 480,
      url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlKoAAAAASUVORK5CYII='
    }, { id: 'fixture-mask-item', x: 0, y: 0, width: 220, height: 165 });
    card.querySelector('.board-butler-trigger').click();
    document.querySelector('[data-butler-action="eraseObject"]').click();
  })()`);
  await wait(240);
  const maskLayout = await window.webContents.executeJavaScript(`(() => {
    const dialog = document.querySelector('.board-butler-mask-dialog');
    const stage = document.querySelector('.board-butler-mask-stage');
    const canvasRect = stage.querySelector('canvas').getBoundingClientRect();
    const rect = dialog.getBoundingClientRect();
    return {
      viewport: { width: innerWidth, height: innerHeight },
      dialog: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      state: stage.dataset.state,
      canvas: { width: stage.querySelector('canvas').width, height: stage.querySelector('canvas').height },
      canvasRect: { left: canvasRect.left, top: canvasRect.top, width: canvasRect.width, height: canvasRect.height },
      modes: document.querySelectorAll('[data-mask-mode]').length,
      submitDisabled: document.querySelector('[data-mask-submit]').disabled
    };
  })()`);
  if (maskLayout.dialog.left < 0 || maskLayout.dialog.top < 0 ||
      maskLayout.dialog.right > maskLayout.viewport.width || maskLayout.dialog.bottom > maskLayout.viewport.height ||
      maskLayout.state !== 'ready' || maskLayout.canvas.width < 1 || maskLayout.canvas.height < 1 ||
      maskLayout.modes !== 2 || maskLayout.submitDisabled !== true) {
    throw new Error(`${label} Butler mask dialog is invalid: ${JSON.stringify(maskLayout)}`);
  }
  const maskStartX = Math.round(maskLayout.canvasRect.left + maskLayout.canvasRect.width * .45);
  const maskStartY = Math.round(maskLayout.canvasRect.top + maskLayout.canvasRect.height * .45);
  const maskEndX = Math.round(maskLayout.canvasRect.left + maskLayout.canvasRect.width * .58);
  const maskEndY = Math.round(maskLayout.canvasRect.top + maskLayout.canvasRect.height * .55);
  window.webContents.sendInputEvent({ type: 'mouseMove', x: maskStartX, y: maskStartY });
  window.webContents.sendInputEvent({ type: 'mouseDown', x: maskStartX, y: maskStartY, button: 'left', clickCount: 1 });
  window.webContents.sendInputEvent({ type: 'mouseMove', x: maskEndX, y: maskEndY, button: 'left' });
  window.webContents.sendInputEvent({ type: 'mouseUp', x: maskEndX, y: maskEndY, button: 'left', clickCount: 1 });
  await wait(100);
  const maskPainted = await window.webContents.executeJavaScript(
    "!document.querySelector('[data-mask-submit]').disabled"
  );
  if (!maskPainted) throw new Error(`${label} Butler mask brush did not enable submission.`);
  if (screenshotDir) {
    const screenshot = await window.webContents.capturePage({
      x: 0,
      y: 0,
      width: Math.round(maskLayout.viewport.width),
      height: Math.round(maskLayout.viewport.height)
    });
    fs.writeFileSync(path.join(screenshotDir, `butler-mask-${label}.png`), screenshot.toPNG());
  }
  await window.webContents.executeJavaScript('closeBoardButlerPanel(); closeBoardButlerMenu();');
}

async function run() {
  const root = path.join(__dirname, '..');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'messs-model-viewer-'));
  const htmlPath = path.join(tempDir, 'viewer-test.html');
  const bundleUrl = pathToFileURL(path.join(root, 'src', 'vendor', 'model-viewer.bundle.js')).href;
  const controllerUrl = pathToFileURL(path.join(root, 'src', 'js', 'model-viewer.js')).href;
  const styleUrl = pathToFileURL(path.join(root, 'src', 'styles', 'main.css')).href;
  const themeStyleUrl = pathToFileURL(path.join(root, 'src', 'styles', 'theme.css')).href;
  const boardMediaUrl = pathToFileURL(path.join(root, 'src', 'js', 'board-media-meta.js')).href;
  const modelFixtures = {
    glb: minimalTriangleGlb().toString('base64'),
    fbx: minimalTriangleFbx().toString('base64'),
    obj: minimalTriangleObj().toString('base64')
  };
  fs.writeFileSync(htmlPath, `<!doctype html>
    <html data-theme="dark"><head><meta charset="utf-8"><link rel="stylesheet" href="${themeStyleUrl}"><link rel="stylesheet" href="${styleUrl}"></head>
    <body><script>
      window.t = (en) => en;
      window.showToast = () => {};
      window.isModelFile = (file) => file && ['.glb', '.fbx', '.obj'].includes(file.ext);
      window.isVideoExt = (ext) => ext === '.mp4';
      window.AppState = { language: 'en', files: [], boardItems: [] };
      const modelFixtures = ${JSON.stringify(modelFixtures)};
      const decodeFixture = (base64) => {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        return bytes;
      };
      window.messsAPI = {
        exportFile: async () => ({ ok: true }),
        readModelData: async (id) => {
          const format = String(id).replace(/^fixture-/, '');
          return { ok: true, format, data: decodeFixture(modelFixtures[format]) };
        },
        butler: {
          removeBackground: async () => ({ ok: false }),
          create3d: async () => ({ ok: false }),
          get3dStatus: async () => ({ ok: false }),
          download3d: async () => ({ ok: false })
        }
      };
    </script><script src="${bundleUrl}"></script><script src="${controllerUrl}"></script><script src="${boardMediaUrl}"></script><script>
      addEventListener('DOMContentLoaded', () => openBoardModelViewer({ id: 'fixture-glb', name: 'fixture.glb', ext: '.glb' }));
    </script></body></html>`, 'utf8');

  const window = new BrowserWindow({
    width: 980,
    height: 720,
    show: false,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      offscreen: true
    }
  });
  await window.loadFile(htmlPath);
  await waitForViewerState(window, 'ready');
  await wait(350);
  const desktop = await captureModelPixels(window, 'desktop');
  window.setSize(520, 420);
  await wait(320);
  const compact = await captureModelPixels(window, 'compact');
  const interactionRect = compact.rect;

  const before = await window.webContents.executeJavaScript(
    "window.MesssBoardModelViewer.camera.position.toArray()"
  );
  const startX = Math.round(interactionRect.x + interactionRect.width * .5);
  const startY = Math.round(interactionRect.y + interactionRect.height * .5);
  const endX = Math.round(interactionRect.x + interactionRect.width * .68);
  const endY = Math.round(interactionRect.y + interactionRect.height * .43);
  window.webContents.sendInputEvent({ type: 'mouseMove', x: startX, y: startY });
  window.webContents.sendInputEvent({ type: 'mouseDown', x: startX, y: startY, button: 'left', clickCount: 1 });
  window.webContents.sendInputEvent({ type: 'mouseMove', x: endX, y: endY, button: 'left' });
  window.webContents.sendInputEvent({ type: 'mouseUp', x: endX, y: endY, button: 'left', clickCount: 1 });
  await wait(280);
  const after = await window.webContents.executeJavaScript(
    "window.MesssBoardModelViewer.camera.position.toArray()"
  );
  const rotationDelta = Math.sqrt(after.reduce((sum, value, index) => sum + ((value - before[index]) ** 2), 0));
  if (!(rotationDelta > 0.01)) throw new Error(`OrbitControls did not rotate the camera (${rotationDelta}).`);

  await window.webContents.executeJavaScript('closeBoardModelViewer()');
  const released = await window.webContents.executeJavaScript(`({
    overlay: !!document.querySelector('.board-model-viewer-overlay'),
    renderer: window.MesssBoardModelViewer.renderer,
    animationFrame: window.MesssBoardModelViewer.animationFrame
  })`);
  if (released.overlay || released.renderer !== null || released.animationFrame !== 0) {
    throw new Error(`Viewer resources were not released: ${JSON.stringify(released)}`);
  }
  const formatPixels = {};
  for (const format of ['fbx', 'obj']) {
    await window.webContents.executeJavaScript(
      `openBoardModelViewer({ id: 'fixture-${format}', name: 'fixture.${format}', ext: '.${format}' })`
    );
    await waitForViewerState(window, 'ready');
    await wait(180);
    formatPixels[format] = (await captureModelPixels(window, format)).modelPixels;
    await window.webContents.executeJavaScript('closeBoardModelViewer()');
  }
  await captureButlerLayout(window, 'desktop', 980, 720);
  await captureButlerLayout(window, 'compact', 520, 420);
  window.destroy();
  fs.rmSync(tempDir, { recursive: true, force: true });
  process.stdout.write(`MODEL_VIEWER_VISUAL_OK desktop=${desktop.modelPixels} compact=${compact.modelPixels} rotation=${rotationDelta.toFixed(3)} fbx=${formatPixels.fbx} obj=${formatPixels.obj}\n`);
}

app.whenReady().then(run).then(() => app.quit()).catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  app.exit(1);
});
