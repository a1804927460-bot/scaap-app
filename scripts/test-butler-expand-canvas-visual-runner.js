'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { app, BrowserWindow } = require('electron');
const sharp = require('sharp');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  const root = path.join(__dirname, '..');
  const viewportWidth = Math.max(700, Number(process.env.MESSS_EXPAND_TEST_WIDTH) || 1280);
  const viewportHeight = Math.max(560, Number(process.env.MESSS_EXPAND_TEST_HEIGHT) || 800);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'messs-butler-expand-'));
  const fixturePath = path.join(tempDir, 'fixture.html');
  const screenshotPath = path.join(root, 'test-artifacts', 'butler-expand-canvas.png');
  const themeUrl = pathToFileURL(path.join(root, 'src', 'styles', 'theme.css')).href;
  const mainUrl = pathToFileURL(path.join(root, 'src', 'styles', 'main.css')).href;
  const butlerUrl = pathToFileURL(path.join(root, 'src', 'js', 'board-media-meta.js')).href;

  fs.writeFileSync(fixturePath, `<!doctype html><html data-theme="dark"><head><meta charset="utf-8">
    <link rel="stylesheet" href="${themeUrl}"><link rel="stylesheet" href="${mainUrl}">
    <style>
      #board-viewport{position:fixed;inset:0;overflow:hidden;background:#101114}
      #board-canvas{position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;transform-origin:0 0;--board-toolbar-scale:1;--board-toolbar-gap:7px;--board-selection-width:1px;--board-expand-hit-size:18px;--board-expand-grip-thickness:4px;--board-expand-grip-length:30px}
      .fixture-image{width:100%;height:100%;display:block;object-fit:cover}
    </style>
    <script>
      window.t=(english,chinese)=>chinese||english;
      window.Board={zoom:1,panX:450,panY:275,zoomTarget:null};
      window.AppState={boardItems:[]};
      window.activeCanvasId=()=> 'canvas-1';
      window.showToast=()=>{};
      window.applyBoardTransform=()=>{document.getElementById('board-canvas').style.transform='translate3d('+Board.panX+'px,'+Board.panY+'px,0) scale('+Board.zoom+')'};
      window.messsAPI={butler:{expandImage:()=>({ok:true})}};
    </script>
    <script src="${butlerUrl}"></script>
    </head><body><div id="board-viewport"><div id="board-canvas"></div></div></body></html>`, 'utf8');

  const window = new BrowserWindow({
    width: viewportWidth,
    height: viewportHeight,
    show: false,
    webPreferences: { contextIsolation: false, nodeIntegration: false, sandbox: false, offscreen: true }
  });

  try {
    await window.loadFile(fixturePath);
    await window.webContents.executeJavaScript(`(() => {
      const item = { id:'expand-source', fileId:'file-1', canvasId:'canvas-1', x:0, y:0, width:320, height:200, zIndex:4, selected:true };
      const imageData = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><rect width="1600" height="1000" fill="#13181e"/><rect x="340" y="130" width="920" height="740" rx="28" fill="#46a5cf"/><circle cx="800" cy="500" r="270" fill="#f1cc58"/><circle cx="800" cy="500" r="155" fill="#20242b"/></svg>');
      const element = document.createElement('div');
      element.className = 'board-item board-item-image is-selected is-single-selection';
      element.dataset.boardId = item.id;
      Object.assign(element.style, { left:'0px', top:'0px', width:'320px', height:'200px', zIndex:'4' });
      element.innerHTML = '<img class="fixture-image" draggable="false" />';
      element.querySelector('img').src = imageData;
      document.getElementById('board-canvas').appendChild(element);
      AppState.boardItems = [item];
      applyBoardTransform();
      openBoardButlerExpandPanel(null, { id:'file-1', name:'fixture.svg', ext:'.png', sourceWidth:1600, sourceHeight:1000, thumbUrl:imageData }, item);
    })()`);
    await wait(220);

    const before = await window.webContents.executeJavaScript(`(() => {
      const editor = document.querySelector('.board-butler-expand-editor');
      const ratio = document.querySelector('.board-butler-expand-ratio-toolbar');
      const controls = document.querySelector('.board-butler-expand-controls');
      const rightHandle = document.querySelector('[data-expand-edge="right"]');
      const rect = editor.getBoundingClientRect();
      const ratioRect = ratio.getBoundingClientRect();
      const controlsRect = controls.getBoundingClientRect();
      const handleRect = rightHandle.getBoundingClientRect();
      return {
        editor:{left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height},
        ratio:{left:ratioRect.left,top:ratioRect.top,right:ratioRect.right,bottom:ratioRect.bottom},
        controls:{left:controlsRect.left,top:controlsRect.top,right:controlsRect.right,bottom:controlsRect.bottom},
        handle:{x:handleRect.x,y:handleRect.y,width:handleRect.width,height:handleRect.height},
        width:Number(document.querySelector('[name="butler-expand-width"]').value),
        zIndex:Number(getComputedStyle(editor).zIndex),
        viewport:{width:innerWidth,height:innerHeight}
      };
    })()`);
    if (before.zIndex !== 120000) throw new Error(`Expansion editor layer is incorrect: ${before.zIndex}`);
    if (before.ratio.bottom > before.editor.top + 1 || before.controls.top < before.editor.bottom - 1) {
      throw new Error(`Expansion capsules overlap the editable image: ${JSON.stringify(before)}`);
    }
    if (before.ratio.left < 18 || before.ratio.right > before.viewport.width - 18 ||
        before.controls.left < 18 || before.controls.right > before.viewport.width - 18) {
      throw new Error(`Expansion capsules escaped the viewport: ${JSON.stringify(before)}`);
    }

    const dragX = Math.round(before.handle.x + before.handle.width / 2);
    const dragY = Math.round(before.handle.y + before.handle.height / 2);
    window.webContents.sendInputEvent({ type: 'mouseMove', x: dragX, y: dragY });
    window.webContents.sendInputEvent({ type: 'mouseDown', x: dragX, y: dragY, button: 'left', clickCount: 1 });
    window.webContents.sendInputEvent({ type: 'mouseMove', x: dragX + 80, y: dragY, button: 'left' });
    window.webContents.sendInputEvent({ type: 'mouseUp', x: dragX + 80, y: dragY, button: 'left', clickCount: 1 });
    await wait(160);

    const interaction = await window.webContents.executeJavaScript(`(() => {
      const draggedWidth = Number(document.querySelector('[name="butler-expand-width"]').value);
      document.querySelector('[data-expand-ratio="16:9"]').click();
      const width = Number(document.querySelector('[name="butler-expand-width"]').value);
      const height = Number(document.querySelector('[name="butler-expand-height"]').value);
      return { draggedWidth, width, height, active:document.querySelector('[data-expand-ratio="16:9"]').classList.contains('is-active') };
    })()`);
    await wait(160);
    if (interaction.draggedWidth <= before.width) throw new Error(`Right-edge drag did not expand width: ${JSON.stringify({ before:before.width, interaction })}`);
    if (!interaction.active || Math.abs(interaction.width / interaction.height - 16 / 9) > 0.01) {
      throw new Error(`16:9 preset did not update the canvas frame: ${JSON.stringify(interaction)}`);
    }

    const submission = await window.webContents.executeJavaScript(`(() => {
      window.__expandSubmission = null;
      launchBoardButlerImageTool = (action, file, item, options) => {
        window.__expandSubmission = { action, fileId:file.id, itemId:item.id, options };
        return false;
      };
      document.querySelector('[name="butler-expand-seed"]').value = '42';
      document.querySelector('.board-butler-expand-editor').requestSubmit();
      return window.__expandSubmission;
    })()`);
    if (!submission || submission.action !== 'imageExpand' || submission.options.seed !== 42) {
      throw new Error(`Canvas expansion did not use the paid tool submission path: ${JSON.stringify(submission)}`);
    }
    if (submission.options.left + submission.options.right !== interaction.width - 1600 ||
        submission.options.up + submission.options.down !== interaction.height - 1000) {
      throw new Error(`Submitted offsets do not match the visible target frame: ${JSON.stringify({ interaction, submission })}`);
    }

    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    const screenshot = await window.webContents.capturePage();
    const png = screenshot.toPNG();
    fs.writeFileSync(screenshotPath, png);
    const stats = await sharp(png).stats();
    const colors = stats.channels.reduce((sum, channel) => sum + Math.max(1, Math.round(channel.stdev)), 0);
    if (colors < 20) throw new Error(`Expansion screenshot appears blank: colors=${colors}`);
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    await wait(80);
    const escaped = await window.webContents.executeJavaScript(`!document.querySelector('.board-butler-expand-editor')`);
    if (!escaped) throw new Error('Escape did not close the canvas expansion editor.');
    process.stdout.write(`BUTLER_EXPAND_CANVAS_OK editor=${Math.round(before.editor.width)}x${Math.round(before.editor.height)} dragged=${interaction.draggedWidth} ratio=16:9 colors=${colors}\n`);
  } finally {
    window.destroy();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

app.whenReady().then(run).then(() => app.quit()).catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  app.exit(1);
});
