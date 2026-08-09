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
  try { fs.unlinkSync(path.join(outputDir, 'error.txt')); } catch (error) {}
  fs.writeFileSync(fixturePath, `<!doctype html><html lang="en" data-theme="dark"><head>
    <meta charset="utf-8"><link rel="stylesheet" href="../../src/styles/theme.css">
    <link rel="stylesheet" href="../../src/styles/main.css">
    <link rel="stylesheet" href="../../node_modules/drawflow/dist/drawflow.min.css">
    <style>html,body{width:100%;height:100%;margin:0;overflow:hidden}.board-node-mode{width:100%;height:100%}</style>
  </head><body><div id="board-node-mode" class="board-node-mode"><div id="board-node-editor" class="board-node-editor"></div>
    <div class="board-node-add"><div class="board-node-add-menu" hidden></div><button class="board-node-add-toggle"><b>+</b><span>Add node</span></button></div>
  </div>
  <script src="../../node_modules/drawflow/dist/drawflow.min.js"></script>
  <script src="../../src/js/canvas-node-mode.js"></script><script>
    const editor = ensureCanvasNodeEditor();
    const icon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m3 17 5-5 4 4 3-3 6 6"/></svg>';
    const media = (type,title,color) => '<article class="canvas-media-node"><header><span class="canvas-node-title-icon">'+icon+'<b>'+type+'</b></span><button class="canvas-node-open">Open</button></header><div class="canvas-node-preview" style="background:'+color+'"><span class="canvas-node-placeholder">'+(type==='Video'?'VID':'IMG')+'</span></div><footer>'+title+'</footer></article>';
    const prompt = '<article class="canvas-flow-node canvas-text-node"><header><span class="canvas-node-title-icon">'+icon+'<b>Text prompt</b></span></header><textarea class="canvas-node-textarea" rows="5">Cinematic product shot, precise light and motion.</textarea><footer>Connect this to a generation node</footer></article>';
    const generate = '<article class="canvas-flow-node canvas-generate-node" data-node-action="settings" role="button" tabindex="0"><header><span class="canvas-node-title-icon">'+icon+'<b>Video generation</b></span><i class="canvas-node-status">Ready</i></header></article>';
    const first = editor.addNode('image',1,1,70,80,'messs-media-node',{},media('Image','Campaign still.png','#252a34'),false);
    const text = editor.addNode('text',0,1,70,390,'messs-flow-node messs-text-node',{},prompt,false);
    const generator = editor.addNode('generate',1,1,430,185,'messs-flow-node messs-generate-node',{},generate,false);
    const output = editor.addNode('video',1,1,800,125,'messs-media-node',{},media('Video','Launch sequence.mp4','#171a21'),false);
    editor.addConnection(first,generator,'output_1','input_1'); editor.addConnection(text,generator,'output_1','input_1'); editor.addConnection(generator,output,'output_1','input_1');
    document.getElementById('node-'+generator).dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:500,clientY:220}));
  </script></body></html>`, 'utf8');

  const window = new BrowserWindow({
    width: 1360,
    height: 820,
    show: false,
    backgroundColor: '#111318',
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  await window.loadFile(fixturePath);
  await new Promise((resolve) => setTimeout(resolve, 350));
  const flowState = await window.webContents.executeJavaScript(`({
    active: document.querySelectorAll('.connection.is-flowing').length,
    pulses: document.querySelectorAll('.canvas-node-flow-pulse').length,
    activePulses: document.querySelectorAll('.connection.is-flowing .canvas-node-flow-pulse').length
  })`);
  if (flowState.active !== 3 || flowState.pulses !== 3 || flowState.activePulses !== 3) {
    throw new Error(`Selected node connections did not receive flow indicators: ${JSON.stringify(flowState)}`);
  }
  const animationName = await window.webContents.executeJavaScript(
    `getComputedStyle(document.querySelector('.connection.is-flowing .canvas-node-flow-pulse')).animationName`
  );
  if (animationName !== 'canvas-node-signal-flow') {
    throw new Error(`Connection flow animation is not running: ${animationName}`);
  }
  const titleLayout = await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.canvas-node-title-icon')).map((title) => {
    const icon = title.querySelector('svg').getBoundingClientRect();
    const text = title.querySelector('b').getBoundingClientRect();
    return { position: getComputedStyle(title.querySelector('svg')).position, iconRight: icon.right, textLeft: text.left };
  })`);
  if (titleLayout.some((item) => item.position !== 'static' || item.iconRight + 6 > item.textLeft)) {
    throw new Error(`Node title icon overlaps its label: ${JSON.stringify(titleLayout)}`);
  }
  const desktop = await window.webContents.capturePage();
  fs.writeFileSync(path.join(outputDir, 'desktop.png'), desktop.toPNG());
  window.setSize(760, 620);
  await new Promise((resolve) => setTimeout(resolve, 180));
  const narrow = await window.webContents.capturePage();
  fs.writeFileSync(path.join(outputDir, 'narrow.png'), narrow.toPNG());
  window.setSize(1360, 820);
  await new Promise((resolve) => setTimeout(resolve, 120));
  const beforePan = await window.webContents.executeJavaScript('({ x: CanvasNodeMode.editor.canvas_x, y: CanvasNodeMode.editor.canvas_y })');
  window.webContents.sendInputEvent({ type: 'mouseDown', x: 760, y: 310, button: 'middle', clickCount: 1 });
  window.webContents.sendInputEvent({ type: 'mouseMove', x: 880, y: 390, button: 'middle' });
  window.webContents.sendInputEvent({ type: 'mouseUp', x: 880, y: 390, button: 'middle', clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const afterPan = await window.webContents.executeJavaScript('({ x: CanvasNodeMode.editor.canvas_x, y: CanvasNodeMode.editor.canvas_y })');
  if (afterPan.x - beforePan.x < 100 || afterPan.y - beforePan.y < 60) {
    throw new Error(`Node canvas did not follow middle-button drag: ${JSON.stringify({ beforePan, afterPan })}`);
  }
  const composerTrigger = await window.webContents.executeJavaScript(`new Promise((resolve) => {
    CanvasNodeMode.editor.canvas_x = 0;
    CanvasNodeMode.editor.canvas_y = 0;
    CanvasNodeMode.editor.precanvas.style.transform = 'translate(0px, 0px) scale(' + CanvasNodeMode.editor.zoom + ')';
    window.AppState = { files: [], boardItems: [] };
    window.activeCanvasId = () => 'visual-test';
    window.isImageExt = (ext) => ext === '.png';
    window.isVideoExt = (ext) => ext === '.mp4';
    window.isModelFile = () => false;
    window.t = (english) => english;
    window.escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
    CanvasNodeMode.canvasId = 'visual-test';
    window.syncBoardSelectionClasses = () => {};
    window.openAiComposerForSelection = async (kind, prompt, hooks) => {
      window.__nodeGenerationHooks = hooks;
      window.__nodeComposerTrigger = { kind, prompt, hasCompletion: typeof hooks.onComplete === 'function' };
    };
    const nodeId = addCanvasWorkflowNode('generate', 'image', { x: 650, y: 400 });
    setTimeout(() => {
      const node = document.getElementById('node-' + nodeId);
      resolve({
        trigger: window.__nodeComposerTrigger,
        promptDisplay: getComputedStyle(node.querySelector('.canvas-node-textarea')).display,
        actionsDisplay: getComputedStyle(node.querySelector('.canvas-node-actions')).display
      });
    }, 30);
  })`);
  if (!composerTrigger.trigger || composerTrigger.trigger.kind !== 'image' || !composerTrigger.trigger.hasCompletion) {
    throw new Error(`Generation node did not open the matching full composer: ${JSON.stringify(composerTrigger)}`);
  }
  if (composerTrigger.promptDisplay !== 'none' || composerTrigger.actionsDisplay !== 'none') {
    throw new Error(`Generation node still exposes embedded controls: ${JSON.stringify(composerTrigger)}`);
  }
  const embeddedResult = await window.webContents.executeJavaScript(`(() => {
    const file = { id: 'generated-1', name: 'result.png', ext: '.png', url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2D8sAAAAASUVORK5CYII=' };
    AppState.files = [file];
    AppState.boardItems = [{ id: 'result-item', fileId: file.id, canvasId: 'visual-test' }];
    window.__nodeGenerationHooks.onComplete([file]);
    const generationNode = Object.entries(canvasNodeData()).find(([, node]) => node.data && node.data.nodeRole === 'generate');
    return {
      resultCount: document.querySelectorAll('#node-' + generationNode[0] + ' .canvas-generate-result').length,
      standaloneResultNodes: Object.values(canvasNodeData()).filter((node) => node.data && node.data.fileId === file.id).length
    };
  })()`);
  if (embeddedResult.resultCount !== 1 || embeddedResult.standaloneResultNodes !== 0) {
    throw new Error(`Generated output was not kept inside its generation node: ${JSON.stringify(embeddedResult)}`);
  }
  const textPopup = await window.webContents.executeJavaScript(`new Promise((resolve) => {
    const nodeId = addCanvasWorkflowNode('text', null, { x: 70, y: 650 });
    setTimeout(() => {
      const popup = document.querySelector('.board-node-text-editor');
      resolve({
        popupOpened: Boolean(popup),
        nodeId,
        inlineDisplay: getComputedStyle(document.querySelector('#node-' + nodeId + ' textarea[df-text]')).display
      });
    }, 30);
  })`);
  if (!textPopup.popupOpened || textPopup.inlineDisplay !== 'none') {
    throw new Error(`Text node popup did not open and persist: ${JSON.stringify(textPopup)}`);
  }
  const textEditor = await window.webContents.capturePage();
  fs.writeFileSync(path.join(outputDir, 'text-editor.png'), textEditor.toPNG());
  const savedText = await window.webContents.executeJavaScript(`(() => {
    const popup = document.querySelector('.board-node-text-editor');
    popup.querySelector('textarea').value = 'Saved from the popup';
    popup.querySelector('form').requestSubmit();
    return canvasNodeData()[${JSON.stringify(textPopup.nodeId)}];
  })()`);
  if (!savedText || savedText.data.text !== 'Saved from the popup') {
    throw new Error(`Text node popup did not persist its value: ${JSON.stringify(savedText)}`);
  }
  const embedded = await window.webContents.capturePage();
  fs.writeFileSync(path.join(outputDir, 'embedded-results.png'), embedded.toPNG());
  window.destroy();
  app.quit();
}

main().catch((error) => {
  try { fs.writeFileSync(path.join(outputDir, 'error.txt'), String(error && error.stack || error), 'utf8'); } catch (writeError) {}
  console.error(error);
  app.exit(1);
});
