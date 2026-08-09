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
  const logoUrl = pathToFileURL(path.join(root, 'src', 'assets', 'logo-mark.png')).href;
  fs.writeFileSync(htmlPath, `<!doctype html>
    <html data-theme="light"><head><meta charset="utf-8">
      <link rel="stylesheet" href="${themeUrl}"><link rel="stylesheet" href="${stylesUrl}">
      <style>body{background:var(--bg-base)}#board-panel{position:fixed;inset:38px 0 0}.fixture-canvas{position:absolute;inset:0;background-image:radial-gradient(circle,var(--border-hairline) 1px,transparent 1px);background-size:28px 28px}.ai-composer{animation:none!important}</style>
    </head><body>
      <section id="board-panel" class="board-panel is-fullscreen">
        <header class="panel-header"><span class="panel-title">Project</span><div class="panel-tools"><button id="board-agent-toggle" class="pill-btn pill-btn-ghost">Messs Agent</button><span class="zoom-label">100%</span></div></header>
        <div class="board-workspace-body">
          <div id="board-viewport" class="board-viewport"><div class="fixture-canvas"></div>
            <div class="ai-image-popover ai-composer"><form class="ai-composer-form"><div class="ai-composer-mode"><button class="is-active">Image</button><button>Video</button></div><textarea class="ai-composer-prompt" placeholder="Describe what you want to create"></textarea><div class="ai-composer-footer"><div class="ai-composer-controls"><button class="ai-options-toggle">Options</button></div><button class="ai-composer-submit">&#8593;</button></div></form></div>
          </div>
          <div id="resize-handle-board-agent" class="resize-handle resize-handle-v"></div>
          <aside id="board-agent-panel" class="board-agent-panel">
            <button id="board-agent-close" class="board-agent-close"><span>x</span></button>
            <div id="board-agent-messages" class="board-agent-messages"><div id="board-agent-welcome" class="board-agent-welcome"><img src="${logoUrl}" alt=""><strong>Messs Agent</strong><span>Solve your problem.</span></div></div>
            <form class="board-agent-form"><textarea placeholder="Ask about this canvas..."></textarea><div class="board-agent-form-footer"><button class="icon-btn-sm">&#8593;</button></div></form>
          </aside>
        </div>
      </section>
    </body></html>`, 'utf8');

  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    webPreferences: { contextIsolation: false, nodeIntegration: false, sandbox: false, offscreen: true }
  });
  await window.loadFile(htmlPath);
  await wait(700);
  const full = await window.webContents.executeJavaScript(`(() => {
    const rect = (selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return { left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height }; };
    const agent = rect('.board-agent-panel');
    const logo = rect('.board-agent-welcome img');
    const composer = rect('.ai-composer');
    return { agent, logo, composer, radius:getComputedStyle(document.querySelector('.board-agent-panel')).borderRadius, toggle:getComputedStyle(document.getElementById('board-agent-toggle')).display };
  })()`);
  if (full.agent.width < 300 || full.agent.right > 1440 || full.agent.bottom > 900) throw new Error(`Agent escaped viewport: ${JSON.stringify(full)}`);
  if (full.radius !== '18px') throw new Error(`Agent radius mismatch: ${full.radius}`);
  if (Math.abs((full.logo.left + full.logo.right) / 2 - (full.agent.left + full.agent.right) / 2) > 2) throw new Error(`Agent logo is not centered: ${JSON.stringify(full)}`);
  if (full.composer.width < 440 || full.composer.width > 620 || full.composer.height < 220) {
    throw new Error(`Composer size is outside the compact range: ${JSON.stringify(full.composer)}`);
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
    return {
      toggle:getComputedStyle(document.getElementById('board-agent-toggle')).display,
      agent:getComputedStyle(document.getElementById('board-agent-panel')).display
    };
  })()`);
  if (compact.toggle !== 'none' || compact.agent !== 'none') throw new Error(`Compact canvas exposed Agent: ${JSON.stringify(compact)}`);
  window.destroy();
  fs.rmSync(tempDir, { recursive: true, force: true });
  process.stdout.write(`BOARD_AGENT_VISUAL_OK agent=${Math.round(full.agent.width)}x${Math.round(full.agent.height)} composer=${Math.round(full.composer.width)}x${Math.round(full.composer.height)}\n`);
}

app.whenReady().then(run).then(() => app.quit()).catch((error) => {
  console.error(error && error.stack || error);
  app.exit(1);
});
