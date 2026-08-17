'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outputDir = path.join(root, 'test-artifacts', 'canvas-node-mode');
const fixturePath = path.join(outputDir, 'fixture.html');

async function main() {
  await app.whenReady();
  fs.mkdirSync(outputDir, { recursive: true });
  const fixture = `<!doctype html><html lang="en" data-theme="dark"><head>
    <meta charset="utf-8">
    <link rel="stylesheet" href="../../src/styles/theme.css">
    <link rel="stylesheet" href="../../src/styles/main.css">
    <link rel="stylesheet" href="../../node_modules/drawflow/dist/drawflow.min.css">
    <style>html,body{width:100%;height:100%;margin:0;overflow:hidden}.board-panel,.board-workspace-body,.board-node-mode{width:100%;height:100%}.board-workspace-body{display:flex}</style>
  </head><body><main id="board-panel" class="board-panel is-node-mode">
    <div class="board-workspace-body"><div id="board-node-mode" class="board-node-mode">
      <div id="board-node-editor" class="board-node-editor"></div>
      <div id="board-node-empty" class="board-node-empty">Right-click to add a node, or drop media here</div>
      <div id="board-node-add-menu" class="board-node-add-menu" role="menu" hidden>
        <strong class="board-node-add-title">Add node</strong>
        <button data-add-node="text"><span class="board-node-menu-icon">T</span><span class="board-node-menu-copy"><b>Text</b></span></button>
        <button data-add-node="image"><span class="board-node-menu-icon" data-node-menu-icon="image"></span><span class="board-node-menu-copy"><b>Image</b><small>Poster, cover, campaign visual</small></span></button>
        <button data-add-node="video"><span class="board-node-menu-icon" data-node-menu-icon="video"></span><span class="board-node-menu-copy"><b>Video</b></span></button>
        <button data-add-node="audio"><span class="board-node-menu-icon" data-node-menu-icon="audio"></span><span class="board-node-menu-copy"><b>Audio</b></span></button>
        <button data-add-node="model"><span class="board-node-menu-icon" data-node-menu-icon="model"></span><span class="board-node-menu-copy"><b>3D</b></span></button>
      </div>
    </div></div><button id="board-mode-toggle"></button>
  </main>
  <script>
    window.AppState={files:[],boardItems:[{id:'ordinary-item',fileId:'ordinary-file'}],activeFolderId:null};
    window.activeCanvasId=()=> 'visual-canvas';
    window.t=(english)=>english;
    window.escapeHtml=(value)=>String(value).replace(/[&<>"']/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
    window.isImageExt=(ext)=>['.png','.jpg'].includes(ext);
    window.isVideoExt=(ext)=>ext==='.mp4';
    window.isAudioExt=(ext)=>ext==='.mp3';
    window.isModelFile=(file)=>String(file&&file.ext||file)==='.glb';
    window.selectFileForPreview=()=>{};
    window.closeAiImagePopover=()=>{};
    window.setCanvasAgentOpen=()=>{};
    window.__composerCalls=0;
    window.openAiComposerForSelection=async()=>{window.__composerCalls+=1;};
    window.localStorage.removeItem('messs.canvas.nodes.v2.visual-canvas');
    window.localStorage.setItem('messs.canvas.mode.v1','node');
  </script>
  <script src="../../node_modules/drawflow/dist/drawflow.min.js"></script>
  <script src="../../src/js/canvas-node-mode.js"></script>
  <script>initCanvasNodeMode();</script></body></html>`;
  fs.writeFileSync(fixturePath, fixture, 'utf8');

  const win = new BrowserWindow({
    width: 1360,
    height: 820,
    show: true,
    backgroundColor: '#111318',
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  await win.loadFile(fixturePath);
  await new Promise((resolve) => setTimeout(resolve, 180));

  const empty = await win.webContents.executeJavaScript(`({
    nodeCount:Object.keys(canvasNodeData()).length,
    boardCount:AppState.boardItems.length,
    emptyHidden:document.getElementById('board-node-empty').hidden
  })`);
  if (empty.nodeCount !== 0 || empty.boardCount !== 1 || empty.emptyHidden) {
    throw new Error(`Node canvas did not start independently empty: ${JSON.stringify(empty)}`);
  }

  win.webContents.sendInputEvent({ type: 'mouseDown', x: 360, y: 260, button: 'right', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x: 360, y: 260, button: 'right', clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const menu = await win.webContents.executeJavaScript(`({
    hidden:document.getElementById('board-node-add-menu').hidden,
    labels:[...document.querySelectorAll('#board-node-add-menu .board-node-menu-copy b')].map((el)=>el.textContent),
    rect:document.getElementById('board-node-add-menu').getBoundingClientRect().toJSON()
  })`);
  if (menu.hidden || menu.labels.join('|') !== 'Text|Image|Video|Audio|3D' || menu.rect.width < 240) {
    throw new Error(`Right-click node menu is incomplete: ${JSON.stringify(menu)}`);
  }
  const menuShot = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outputDir, 'context-menu.png'), menuShot.toPNG());

  const state = await win.webContents.executeJavaScript(`new Promise((resolve)=>{
    document.querySelector('[data-add-node="image"]').click();
    const generation=Object.entries(canvasNodeData()).find(([,node])=>node.data.nodeRole==='generate');
    const portrait={id:'portrait',name:'portrait.png',ext:'.png',url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2D8sAAAAASUVORK5CYII=',sourceWidth:900,sourceHeight:1600};
    const landscape={id:'landscape',name:'landscape.mp4',ext:'.mp4',thumbUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2D8sAAAAASUVORK5CYII=',sourceWidth:1920,sourceHeight:1080};
    AppState.files.push(portrait,landscape);
    const portraitId=addCanvasMediaNode(portrait,{x:70,y:390});
    addCanvasMediaNode(landscape,{x:430,y:390});
    setTimeout(()=>{
      const generationElement=document.getElementById('node-'+generation[0]);
      const before=window.__composerCalls;
      generationElement.querySelector('.canvas-generate-node').click();
      setTimeout(()=>{
        const portraitRect=document.querySelector('#node-'+portraitId+' .canvas-node-preview').getBoundingClientRect();
        resolve({generationId:generation[0],before,after:window.__composerCalls,ratio:portraitRect.width/portraitRect.height,files:AppState.files.length,boardItems:AppState.boardItems.length,menuHidden:document.getElementById('board-node-add-menu').hidden});
      },20);
    },20);
  })`);
  if (state.before !== 0 || state.after !== 1 || Math.abs(state.ratio - 0.5625) > 0.01 || state.boardItems !== 1 || !state.menuHidden) {
    throw new Error(`Node creation/composer/ratio isolation failed: ${JSON.stringify(state)}`);
  }

  await new Promise((resolve) => setTimeout(resolve, 120));
  const nodeShot = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outputDir, 'nodes-live.png'), nodeShot.toPNG());

  const ports = await win.webContents.executeJavaScript(`(()=>{
    const generation=Object.entries(canvasNodeData()).find(([,node])=>node.data.nodeRole==='generate');
    const element=document.getElementById('node-'+generation[0]);
    const input=element.querySelector('.input');
    const output=element.querySelector('.output');
    const nodeRect=element.getBoundingClientRect();
    const rect=(target)=>{const value=target.getBoundingClientRect();return {x:value.x+value.width/2,y:value.y+value.height/2};};
    const inputCenter=rect(input);
    const outputCenter=rect(output);
    return {
      input:inputCenter,
      output:outputCenter,
      inputGap:nodeRect.left-inputCenter.x,
      outputGap:outputCenter.x-nodeRect.right,
      inputMark:getComputedStyle(input,'::after').content,
      outputMark:getComputedStyle(output,'::after').content,
      faceWidth:getComputedStyle(output,'::before').width,
      faceBackground:getComputedStyle(output,'::before').backgroundColor,
      inputRadius:getComputedStyle(input).borderRadius,
      outputRadius:getComputedStyle(output).borderRadius,
      legacyButtons:element.querySelectorAll('.canvas-node-add-media').length
    };
  })()`);
  if (!ports.inputMark.includes('+') || !ports.outputMark.includes('+') || ports.legacyButtons !== 0 ||
      ports.inputRadius !== '50%' || ports.outputRadius !== '50%' ||
      Math.abs(ports.inputGap - ports.outputGap) > 1 || ports.outputGap > 38 ||
      ports.faceWidth !== '34px' || /rgba\([^)]*,\s*0\)/.test(ports.faceBackground)) {
    throw new Error(`Node ports are not the single plus controls: ${JSON.stringify(ports)}`);
  }

  win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(ports.input.x - 42), y: Math.round(ports.input.y), movementX: -42, movementY: 0 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const magnet = await win.webContents.executeJavaScript(`(()=>{
    const generation=Object.entries(canvasNodeData()).find(([,node])=>node.data.nodeRole==='generate');
    const input=document.querySelector('#node-'+generation[0]+' .input');
    return {
      active:input.classList.contains('is-magnetic'),
      pullX:input.style.getPropertyValue('--node-port-magnet-x'),
      pullY:input.style.getPropertyValue('--node-port-magnet-y')
    };
  })()`);
  if (!magnet.active || !magnet.pullX || !magnet.pullY) {
    throw new Error(`Node port did not magnetize near the pointer: ${JSON.stringify(magnet)}`);
  }

  win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(ports.input.x), y: Math.round(ports.input.y), button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(ports.input.x - 150), y: Math.round(ports.input.y - 150), movementX: -150, movementY: -150 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(ports.input.x - 150), y: Math.round(ports.input.y - 150), button: 'left', clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 80));
  const leftMenu = await win.webContents.executeJavaScript(`({
    choices:[...document.querySelectorAll('.board-node-connection-menu button')].map((button)=>button.textContent.trim()),
    drafts:document.querySelectorAll('.board-node-link-draft').length,
    orphanConnections:[...document.querySelectorAll('.drawflow .connection')].filter((connection)=>connection.classList.length<5).length
  })`);
  if (leftMenu.choices.join('|') !== 'Text prompt|Image generation|Video generation' || leftMenu.drafts || leftMenu.orphanConnections) {
    throw new Error(`Left plus drag did not produce a clean upstream menu: ${JSON.stringify(leftMenu)}`);
  }
  await win.webContents.executeJavaScript(`closeCanvasNodeConnectionMenu()`);

  win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(ports.output.x), y: Math.round(ports.output.y), button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(ports.output.x + 150), y: Math.round(ports.output.y - 150), movementX: 150, movementY: -150 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(ports.output.x + 150), y: Math.round(ports.output.y - 150), button: 'left', clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 80));
  const rightMenu = await win.webContents.executeJavaScript(`({
    choices:[...document.querySelectorAll('.board-node-connection-menu button')].map((button)=>button.textContent.trim()),
    drafts:document.querySelectorAll('.board-node-link-draft').length,
    orphanConnections:[...document.querySelectorAll('.drawflow .connection')].filter((connection)=>connection.classList.length<5).length
  })`);
  if (rightMenu.choices.join('|') !== 'Image generation|Video generation' || rightMenu.drafts || rightMenu.orphanConnections) {
    throw new Error(`Right plus drag did not produce a clean downstream menu: ${JSON.stringify(rightMenu)}`);
  }
  const portsShot = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outputDir, 'plus-connection-menu.png'), portsShot.toPNG());
  await win.webContents.executeJavaScript(`closeCanvasNodeConnectionMenu()`);

  const deletion = await win.webContents.executeJavaScript(`new Promise((resolve)=>{
    const mediaEntry=Object.entries(canvasNodeData()).find(([,node])=>node.data.fileId==='portrait');
    applyCanvasNodeSelection(new Set([mediaEntry[0]]));
    document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true,cancelable:true}));
    setTimeout(()=>resolve({nodeStillExists:Boolean(canvasNodeData()[mediaEntry[0]]),files:AppState.files.map((file)=>file.id),boardItems:AppState.boardItems.map((item)=>item.id)}),20);
  })`);
  if (deletion.nodeStillExists || !deletion.files.includes('portrait') || deletion.boardItems.join('|') !== 'ordinary-item') {
    throw new Error(`Node deletion altered archived or ordinary canvas data: ${JSON.stringify(deletion)}`);
  }

  win.destroy();
  app.quit();
  process.stdout.write('Canvas node mode visual tests passed.\n');
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
