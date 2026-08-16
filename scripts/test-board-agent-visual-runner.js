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
  const root = path.join(__dirname, '..');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'messs-board-agent-'));
  const htmlPath = path.join(tempDir, 'fixture.html');
  const themeUrl = pathToFileURL(path.join(root, 'src', 'styles', 'theme.css')).href;
  const stylesUrl = pathToFileURL(path.join(root, 'src', 'styles', 'main.css')).href;
  const freehandUrl = pathToFileURL(path.join(root, 'src', 'js', 'vendor', 'perfect-freehand.js')).href;
  const logoUrl = pathToFileURL(path.join(root, 'src', 'assets', 'logo-mark.png')).href;
  fs.writeFileSync(htmlPath, `<!doctype html>
    <html data-theme="light"><head><meta charset="utf-8">
      <link rel="stylesheet" href="${themeUrl}"><link rel="stylesheet" href="${stylesUrl}">
      <style>body{background:var(--bg-base)}#board-panel{position:fixed;inset:38px 0 0}.fixture-canvas{position:absolute;inset:0;background-image:radial-gradient(circle,var(--border-hairline) 1px,transparent 1px);background-size:28px 28px}.ai-composer{animation:none!important}.qa-text{position:absolute;left:120px;top:95px;z-index:2}.qa-text-edit{top:155px}.qa-doodle{position:absolute;left:110px;top:245px;width:360px;height:160px;z-index:2}</style>
      <script src="${freehandUrl}"></script>
    </head><body>
      <section id="board-panel" class="board-panel is-fullscreen">
        <header class="panel-header"><span class="panel-title">Project</span><div class="panel-tools"><button id="board-agent-toggle" class="pill-btn pill-btn-ghost">Messs Agent</button><span class="zoom-label">100%</span></div></header>
        <div class="board-workspace-body">
          <div id="board-viewport" class="board-viewport"><div class="fixture-canvas"></div>
            <div class="board-item board-text-note qa-text"><div class="board-text-note-content">Confirmed text</div></div>
            <div class="board-item board-text-note is-text-editing qa-text qa-text-edit"><div class="board-text-note-content">Editing text</div></div>
            <canvas class="qa-doodle"></canvas>
            <div class="ai-image-popover ai-composer"><form class="ai-composer-form"><div class="ai-composer-mode-row"><div class="ai-composer-mode"><button class="is-active">Image</button><button>Video</button></div><div class="ai-composer-reference-strip" hidden><div class="ai-composer-reference-thumb"><img src="${logoUrl}" alt="Reference"><span class="ai-composer-reference-order">1</span></div></div></div><textarea class="ai-composer-prompt" placeholder="Describe what you want to create"></textarea><div class="ai-composer-footer"><div class="ai-composer-controls"><button class="ai-model-picker-trigger">Seedance 2.0 Fast</button><div class="ai-video-mode-picker"><button class="ai-video-mode-trigger"><span>First frame</span></button></div><button class="ai-options-toggle">Options</button></div><button class="ai-composer-submit">&#8593;</button></div></form></div>
          </div>
          <div id="resize-handle-board-agent" class="resize-handle resize-handle-v"></div>
          <aside id="board-agent-panel" class="board-agent-panel">
            <button id="board-agent-close" class="board-agent-close"><span>x</span></button>
            <div id="board-agent-messages" class="board-agent-messages"><div id="board-agent-welcome" class="board-agent-welcome"><img src="${logoUrl}" alt=""><strong>Messs Agent</strong><span>Solve your problem.</span></div></div>
            <form class="board-agent-form">
              <div class="board-agent-references"><button class="board-agent-reference"><img src="${logoUrl}" alt="Reference"><span>&times;</span></button></div>
              <textarea rows="2" placeholder="Ask about this canvas..."></textarea>
              <div class="board-agent-form-footer"><div class="board-agent-form-tools"><button class="board-agent-tool-btn">+</button><div class="board-agent-model-picker"><button class="board-agent-model-trigger" aria-expanded="true"><span>Nano Banana Pro</span></button><div class="board-agent-model-menu"><div class="board-agent-model-menu-title">生成时使用的模型</div><button class="board-agent-model-option"><span></span><span>Agent 对话</span><i>✓</i></button><div class="board-agent-kind-switch"><button class="is-active">图片</button><button>视频</button></div><div class="board-agent-model-options"><button class="board-agent-model-option is-active"><span class="ai-model-badge ai-model-badge-banana-pro">🍌</span><span>Nano Banana Pro</span><i>✓</i></button></div></div></div></div><button class="icon-btn-sm">&#8593;</button></div>
            </form>
          </aside>
        </div>
        <div id="board-bottom-bar" class="board-bottom-bar"><button class="icon-btn-sm">-</button><span class="zoom-label">100%</span><button class="icon-btn-sm">+</button></div>
      </section>
    </body></html>`, 'utf8');

  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    webPreferences: { contextIsolation: false, nodeIntegration: false, sandbox: false, offscreen: true }
  });
  await window.loadFile(htmlPath);
  const freehand = await window.webContents.executeJavaScript(`(() => {
    const canvas = document.querySelector('.qa-doodle');
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(360 * dpr);
    canvas.height = Math.round(160 * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const points = Array.from({length: 70}, (_, index) => [
      14 + index * 4.7,
      78 + Math.sin(index / 7) * 40,
      0.25 + (index % 18) / 36
    ]);
    const outline = PerfectFreehand.getStroke(points, { size: 14, thinning: .38, smoothing: .72, streamline: .48, last: true });
    ctx.fillStyle = '#3157d5';
    ctx.beginPath();
    ctx.moveTo(outline[0][0], outline[0][1]);
    for (let index = 1; index < outline.length; index += 1) {
      const point = outline[index];
      const next = outline[(index + 1) % outline.length];
      ctx.quadraticCurveTo(point[0], point[1], (point[0] + next[0]) / 2, (point[1] + next[1]) / 2);
    }
    ctx.closePath();
    ctx.fill();
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let alphaPixels = 0;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index]) alphaPixels += 1;
    return { alphaPixels, cssWidth: canvas.getBoundingClientRect().width, pixelWidth: canvas.width, dpr };
  })()`);
  await wait(700);
  const full = await window.webContents.executeJavaScript(`(() => {
    const rect = (selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return { left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height }; };
    const agent = rect('.board-agent-panel');
    const logo = rect('.board-agent-welcome img');
    const composer = rect('.ai-composer');
    const composerPrompt = rect('.ai-composer-prompt');
    const viewport = rect('#board-viewport');
    const bottomBar = rect('#board-bottom-bar');
    const agentForm = rect('.board-agent-form');
    const agentInput = rect('.board-agent-form textarea');
    const agentMenu = rect('.board-agent-model-menu');
    const confirmedText = getComputedStyle(document.querySelector('.qa-text:not(.is-text-editing)'));
    const editingText = getComputedStyle(document.querySelector('.qa-text-edit'));
    return { agent, logo, composer, composerPrompt, viewport, bottomBar, agentForm, agentInput, agentMenu, radius:getComputedStyle(document.querySelector('.board-agent-panel')).borderRadius, toggle:getComputedStyle(document.getElementById('board-agent-toggle')).display, confirmedText:{background:confirmedText.backgroundColor,borderWidth:confirmedText.borderTopWidth,shadow:confirmedText.boxShadow}, editingText:{background:editingText.backgroundColor,borderWidth:editingText.borderTopWidth,shadow:editingText.boxShadow} };
  })()`);
  if (full.agent.width < 300 || full.agent.right > 1440 || full.agent.bottom > full.viewport.bottom + 1) throw new Error(`Agent escaped workspace: ${JSON.stringify(full)}`);
  if (!/18px\s+0px\s+0px\s+18px/.test(full.radius)) throw new Error(`Agent outer shell does not have the restrained exposed-edge radius: ${full.radius}`);
  if (Math.abs(full.agent.top - full.viewport.top) > 1 || Math.abs(full.agent.bottom - full.viewport.bottom) > 1) {
    throw new Error(`Agent does not fill the workspace height: ${JSON.stringify(full)}`);
  }
  if (Math.abs((full.logo.left + full.logo.right) / 2 - (full.agent.left + full.agent.right) / 2) > 2) throw new Error(`Agent logo is not centered: ${JSON.stringify(full)}`);
  if (full.agentInput.height > 70) throw new Error(`Agent input was not shortened: ${JSON.stringify(full)}`);
  if (full.agentMenu.left < full.agent.left || full.agentMenu.right > full.agent.right || full.agentMenu.top >= full.agentForm.top || full.agentMenu.bottom > full.agent.bottom) {
    throw new Error(`Agent model menu escaped its panel: ${JSON.stringify(full)}`);
  }
  if (full.composer.width < 740 || full.composer.width > 780 || full.composer.height < 168 || full.composer.height > 184) {
    throw new Error(`Composer size is outside the compact range: ${JSON.stringify(full.composer)}`);
  }
  if (full.composerPrompt.width < 700 || full.composerPrompt.height < 76) {
    throw new Error(`Composer prompt did not receive the intended writing space: ${JSON.stringify(full.composerPrompt)}`);
  }
  const composerCenter = (full.composer.left + full.composer.right) / 2;
  const viewportCenter = (full.viewport.left + full.viewport.right) / 2;
  if (Math.abs(composerCenter - viewportCenter) > 2) {
    throw new Error(`Composer is not centered in the drawable canvas: ${JSON.stringify(full)}`);
  }
  const bottomBarCenter = (full.bottomBar.left + full.bottomBar.right) / 2;
  if (Math.abs(bottomBarCenter - viewportCenter) > 2) {
    throw new Error(`Bottom toolbar is not centered in the drawable canvas: ${JSON.stringify(full)}`);
  }
  const composerWithReference = await window.webContents.executeJavaScript(`(() => {
    document.querySelector('.ai-composer-reference-strip').hidden = false;
    const composer = document.querySelector('.ai-composer').getBoundingClientRect();
    const header = document.querySelector('.ai-composer-mode-row').getBoundingClientRect();
    const reference = document.querySelector('.ai-composer-reference-thumb').getBoundingClientRect();
    const videoMode = document.querySelector('.ai-video-mode-picker').getBoundingClientRect();
    return { composer:{width:composer.width,height:composer.height}, header:{top:header.top,bottom:header.bottom}, reference:{top:reference.top,bottom:reference.bottom}, videoMode:{width:videoMode.width,height:videoMode.height} };
  })()`);
  if (Math.abs(composerWithReference.composer.height - full.composer.height) > 1 || composerWithReference.reference.top < composerWithReference.header.top || composerWithReference.reference.bottom > composerWithReference.header.bottom + 1 || composerWithReference.videoMode.width < 68) {
    throw new Error(`Composer references or video mode escaped the compact layout: ${JSON.stringify(composerWithReference)}`);
  }
  await window.webContents.executeJavaScript(`document.querySelector('.ai-composer-reference-strip').hidden = true`);
  if (full.confirmedText.background !== 'rgba(0, 0, 0, 0)' || full.confirmedText.borderWidth !== '0px' || full.confirmedText.shadow !== 'none' || full.editingText.background === 'rgba(0, 0, 0, 0)' || full.editingText.borderWidth !== '1px') {
    throw new Error(`Text editing chrome did not transition cleanly: ${JSON.stringify(full)}`);
  }
  if (freehand.alphaPixels < 1000 || freehand.pixelWidth < freehand.cssWidth * freehand.dpr - 1) {
    throw new Error(`Smooth high-DPI doodle did not render: ${JSON.stringify(freehand)}`);
  }
  const screenshotDir = path.join(root, 'test-artifacts');
  fs.mkdirSync(screenshotDir, { recursive: true });
  fs.writeFileSync(path.join(screenshotDir, 'board-agent-fullscreen.png'), (await window.webContents.capturePage()).toPNG());

  window.setSize(900, 650);
  await wait(180);
  const smallComposer = await window.webContents.executeJavaScript(`(() => {
    const r = document.querySelector('.ai-composer').getBoundingClientRect();
    return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height };
  })()`);
  if (smallComposer.left < 16 || smallComposer.right > 884 || smallComposer.bottom > 650) {
    throw new Error(`Composer escaped compact viewport: ${JSON.stringify(smallComposer)}`);
  }

  const compact = await window.webContents.executeJavaScript(`(() => {
    document.getElementById('board-panel').classList.remove('is-fullscreen');
    const composer = document.querySelector('.ai-composer').getBoundingClientRect();
    const bottomBar = document.getElementById('board-bottom-bar').getBoundingClientRect();
    return {
      toggle:getComputedStyle(document.getElementById('board-agent-toggle')).display,
      agent:getComputedStyle(document.getElementById('board-agent-panel')).display,
      composer:{top:composer.top,bottom:composer.bottom},
      bottomBar:{top:bottomBar.top,bottom:bottomBar.bottom}
    };
  })()`);
  if (compact.toggle !== 'none' || compact.agent !== 'none') throw new Error(`Compact canvas exposed Agent: ${JSON.stringify(compact)}`);
  if (compact.composer.bottom > compact.bottomBar.top - 10) {
    throw new Error(`Compact composer overlaps the bottom toolbar: ${JSON.stringify(compact)}`);
  }
  window.destroy();
  fs.rmSync(tempDir, { recursive: true, force: true });
  process.stdout.write(`BOARD_AGENT_VISUAL_OK agent=${Math.round(full.agent.width)}x${Math.round(full.agent.height)} composer=${Math.round(full.composer.width)}x${Math.round(full.composer.height)} doodlePixels=${freehand.alphaPixels}\n`);
}

app.whenReady().then(run).then(() => app.quit()).catch((error) => {
  console.error(error && error.stack || error);
  app.exit(1);
});
