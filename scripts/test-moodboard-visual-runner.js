'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { app, BrowserWindow } = require('electron');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  await app.whenReady();
  const root = path.join(__dirname, '..');
  const outputDir = path.join(root, 'test-artifacts', 'moodboard');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'messs-moodboard-'));
  const htmlPath = path.join(tempDir, 'moodboard.html');
  fs.mkdirSync(outputDir, { recursive: true });
  const themeUrl = pathToFileURL(path.join(root, 'src', 'styles', 'theme.css')).href;
  const stylesUrl = pathToFileURL(path.join(root, 'src', 'styles', 'main.css')).href;
  const quillCssUrl = pathToFileURL(path.join(root, 'node_modules', 'quill', 'dist', 'quill.snow.css')).href;
  const quillUrl = pathToFileURL(path.join(root, 'node_modules', 'quill', 'dist', 'quill.js')).href;
  const moodboardUrl = pathToFileURL(path.join(root, 'src', 'js', 'moodboard.js')).href;
  fs.writeFileSync(htmlPath, `<!doctype html>
  <html data-theme="dark"><head><meta charset="utf-8">
    <link rel="stylesheet" href="${themeUrl}"><link rel="stylesheet" href="${stylesUrl}"><link rel="stylesheet" href="${quillCssUrl}">
    <style>html,body{width:100%;height:100%;margin:0!important;padding:0!important;overflow:hidden}body.main-app{display:block;opacity:1;transform:none;background:var(--board-workspace-bg)}#board-viewport{position:fixed;inset:0;background:var(--board-workspace-bg);background-image:radial-gradient(circle,var(--border-hairline) 1px,transparent 1px);background-size:28px 28px}.board-canvas{position:absolute;inset:0;transform:none}.board-bottom-bar{display:flex}.fixture-titlebar{position:fixed;left:0;right:0;top:0;height:var(--titlebar-h);background:var(--bg-base);z-index:300}</style>
  </head><body class="main-app"><div class="fixture-titlebar"></div>
    <div id="board-viewport" class="board-viewport"><div id="board-canvas" class="board-canvas"></div></div>
    <div id="board-bottom-bar" class="board-bottom-bar"><div class="board-bottom-group board-bottom-tools"><button id="board-tool-moodboard" class="icon-btn-sm" type="button">M</button></div></div>
    <div id="moodboard-overlay" class="moodboard-overlay" hidden>
      <button id="moodboard-backdrop" class="moodboard-backdrop" type="button"></button>
      <section class="moodboard-editor-panel" role="dialog" aria-modal="true">
        <header class="moodboard-editor-header"><span class="moodboard-editor-mark">M</span><input id="moodboard-editor-title" type="text"><span id="moodboard-save-state" class="moodboard-save-state"></span><button id="moodboard-editor-close" class="icon-btn-sm">x</button></header>
        <div class="moodboard-agent-bar"><span class="moodboard-agent-label">Agent</span><button data-moodboard-agent-action="polish">Polish</button><button data-moodboard-agent-action="shorten">Shorten</button><button data-moodboard-agent-action="expand">Expand</button><div class="moodboard-agent-custom"><input id="moodboard-agent-instruction"><button id="moodboard-agent-submit">A</button></div></div>
        <div id="moodboard-format-toolbar" class="moodboard-format-toolbar"><select class="ql-header"><option value="1"></option><option value="2"></option><option selected></option></select><button class="ql-bold"></button><button class="ql-italic"></button><button class="ql-list" value="ordered"></button><button class="ql-list" value="bullet"></button><button class="ql-blockquote"></button><button class="ql-clean"></button></div>
        <div class="moodboard-editor-workspace"><div id="moodboard-editor" class="moodboard-editor"></div><aside id="moodboard-agent-suggestion" class="moodboard-agent-suggestion" hidden><header><strong>Agent suggestion</strong><button id="moodboard-suggestion-dismiss">x</button></header><div id="moodboard-suggestion-text" class="moodboard-suggestion-text"></div><footer><button id="moodboard-suggestion-copy">Copy</button><button id="moodboard-suggestion-append">Append</button><button id="moodboard-suggestion-replace" class="is-primary">Replace</button></footer></aside></div>
        <footer class="moodboard-editor-footer"><span id="moodboard-text-count"></span><span id="moodboard-agent-status"></span></footer>
      </section>
    </div>
    <script>window.AppState={boardItems:[]};window.Board={};window.t=(en,zh)=>zh;window.isZh=()=>true;window.isKo=()=>false;window.activeCanvasId=()=>"canvas-test";window.boardViewportCenterCoords=()=>({x:390,y:320});window.canvasWorkspaceAddItem=()=>{};window.persistBoardItemMutation=()=>{};window.recordBoardItemsHistory=()=>{};window.showToast=()=>{};window.syncBoardSelectionClasses=()=>{};window.showBoardMultiContextMenu=()=>{};window.showBoardItemContextMenu=()=>{};window.makeBoardItemDraggable=()=>{};window.syncMountedBoardItemGeometry=(el,item)=>{el.style.left=item.x+"px";el.style.top=item.y+"px";el.style.width=item.width+"px";el.style.height=item.height+"px"};window.renderBoard=()=>{const canvas=document.getElementById("board-canvas");canvas.replaceChildren(...AppState.boardItems.map(buildBoardMoodboardElement))};window.writePlainTextToClipboard=async()=>true;window.setCanvasAgentOpen=()=>true;window.requestCanvasAgentText=async(options)=>{await options.onResponse("更清晰的创意方向：保留核心概念，强化材质、光线与情绪之间的关系。\\n\\n第二方向关注克制的色彩和明确的空间秩序。");return {ok:true}};window.messsAPI={upsertBoardItem:async()=>true};</script>
    <script src="${quillUrl}"></script><script src="${moodboardUrl}"></script>
  </body></html>`, 'utf8');

  const win = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: { offscreen: true, backgroundThrottling: false } });
  try {
    win.webContents.on('console-message', (_event, level, message) => {
      if (level >= 2) process.stderr.write(`[renderer] ${message}\n`);
    });
    await win.loadFile(htmlPath);
    const setup = await win.webContents.executeJavaScript(`(() => { try { initBoardMoodboards(); document.getElementById('board-tool-moodboard').click(); return {ok:true}; } catch (error) { return {ok:false,error:error && error.stack || String(error)}; } })()`);
    if (!setup.ok) throw new Error(`Moodboard setup failed: ${setup.error}`);
    await wait(180);
    const edit = await win.webContents.executeJavaScript(`(() => { try { const quill=Quill.find(document.querySelector('#moodboard-editor')); quill.setText('视觉方向一\\n保留克制的黑色轮廓，以冷色光线建立节奏。\\n\\n视觉方向二\\n强调材质反差与清晰的空间层级。'); document.querySelector('[data-moodboard-agent-action="polish"]').click(); return {ok:true}; } catch (error) { return {ok:false,error:error && error.stack || String(error)}; } })()`);
    if (!edit.ok) throw new Error(`Moodboard edit failed: ${edit.error}`);
    await wait(220);
    const metrics = await win.webContents.executeJavaScript(`(() => { const rect=(selector)=>{const r=document.querySelector(selector).getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:Math.round(r.width),height:Math.round(r.height),centerX:(r.left+r.right)/2,centerY:(r.top+r.bottom)/2}}; const node=rect('.board-moodboard'); const overlay=rect('.moodboard-overlay'); const panel=rect('.moodboard-editor-panel'); const editor=rect('.moodboard-editor'); const suggestion=rect('.moodboard-agent-suggestion'); const title=document.querySelector('.board-moodboard-title').textContent; const toolbar=rect('.moodboard-format-toolbar'); const body=document.querySelector('.ql-editor').innerText; const panelStyle=getComputedStyle(document.querySelector('.moodboard-editor-panel')); return {node,overlayRect:overlay,panel,editor,suggestion,toolbar,title,body,panelRadius:parseFloat(panelStyle.borderTopLeftRadius),viewport:{width:innerWidth,height:innerHeight},overlay:!document.getElementById('moodboard-overlay').hidden,suggestionVisible:!document.getElementById('moodboard-agent-suggestion').hidden}; })()`);
    if (!metrics.overlay || !metrics.suggestionVisible) throw new Error(`Moodboard workflow did not open: ${JSON.stringify(metrics)}`);
    if (metrics.node.width !== 360 || metrics.node.height !== 260) throw new Error(`Moodboard node size shifted: ${JSON.stringify(metrics)}`);
    if (metrics.panel.width < 900 || metrics.panel.width > 1000 || metrics.panel.height < 640 || metrics.panel.height > 780) throw new Error(`Centered panel is not half-screen sized: ${JSON.stringify(metrics)}`);
    if (Math.abs(metrics.panel.centerX - metrics.overlayRect.centerX) > 2 || Math.abs(metrics.panel.centerY - metrics.overlayRect.centerY) > 2) throw new Error(`Moodboard panel is not centered: ${JSON.stringify(metrics)}`);
    if (metrics.panel.left < metrics.overlayRect.left + 12 || metrics.panel.top < metrics.overlayRect.top + 12 || metrics.panel.right > metrics.overlayRect.right - 12 || metrics.panel.bottom > metrics.overlayRect.bottom - 12 || metrics.panelRadius < 8) throw new Error(`Rounded panel escaped its safe margins: ${JSON.stringify(metrics)}`);
    if (metrics.editor.width < 300 || metrics.suggestion.width < 240 || metrics.editor.right > metrics.suggestion.left + 1) throw new Error(`Editor comparison layout overlaps: ${JSON.stringify(metrics)}`);
    if (metrics.toolbar.bottom > metrics.editor.bottom || !metrics.body.includes('视觉方向一')) throw new Error(`Editor text or toolbar is not visible: ${JSON.stringify(metrics)}`);
    fs.writeFileSync(path.join(outputDir, 'moodboard-dark.png'), (await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript(`document.documentElement.dataset.theme='light'`);
    await wait(80);
    fs.writeFileSync(path.join(outputDir, 'moodboard-light.png'), (await win.webContents.capturePage()).toPNG());
    process.stdout.write(`MOODBOARD_VISUAL_OK node=${metrics.node.width}x${metrics.node.height} panel=${metrics.panel.width}x${metrics.panel.height} editor=${metrics.editor.width}x${metrics.editor.height} suggestion=${metrics.suggestion.width}x${metrics.suggestion.height}\n`);
  } finally {
    win.destroy();
    app.quit();
  }
}

run().catch((error) => {
  console.error(error && error.stack || error);
  app.exit(1);
});
