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
  const outputDir = path.join(root, 'test-artifacts', 'prompt-optimizer');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'messs-prompt-optimizer-'));
  const htmlPath = path.join(tempDir, 'prompt-optimizer.html');
  fs.mkdirSync(outputDir, { recursive: true });
  const themeUrl = pathToFileURL(path.join(root, 'src', 'styles', 'theme.css')).href;
  const stylesUrl = pathToFileURL(path.join(root, 'src', 'styles', 'main.css')).href;
  const contextMenuUrl = pathToFileURL(path.join(root, 'src', 'js', 'context-menu.js')).href;
  fs.writeFileSync(htmlPath, `<!doctype html>
  <html data-theme="dark" data-language="zh"><head><meta charset="utf-8">
    <link rel="stylesheet" href="${themeUrl}"><link rel="stylesheet" href="${stylesUrl}">
    <style>
      html,body{width:100%;height:100%;margin:0!important;overflow:hidden}
      body.main-app{display:block;opacity:1;transform:none;background:var(--board-workspace-bg)}
      .fixture-titlebar{height:var(--titlebar-h);background:var(--bg-base);border-bottom:1px solid var(--border-hairline)}
      .fixture-stage{height:calc(100% - var(--titlebar-h));display:grid;place-items:center;background-image:radial-gradient(circle,var(--border-hairline) 1px,transparent 1px);background-size:28px 28px}
      .ai-composer{width:min(900px,calc(100vw - 36px));padding:16px;border:1px solid var(--border-hairline);border-radius:8px;background:var(--bg-elevated);box-shadow:var(--shadow-elevated)}
      .ai-composer-prompt{box-sizing:border-box;width:100%;height:150px;padding:14px;border:1px solid var(--border-hairline);border-radius:6px;color:var(--text-primary);background:var(--bg-surface);font:14px/1.6 sans-serif}
    </style>
  </head><body class="main-app"><div class="fixture-titlebar"></div><main class="fixture-stage">
    <section class="ai-composer" data-kind="image"><textarea class="ai-composer-prompt">把图1的logo放到图2左上角，保持图2构图和比例不变，把图1的logo放到图2左上角，保持logo清晰，不要改变品牌颜色。</textarea></section>
  </main>
  <script>
    window.t=(en,zh,ko)=>zh;
    window.isZh=()=>true;
    window.isKo=()=>false;
    window.showToast=()=>{};
    window.promptOptimizerRequests=0;
    window.promptOptimizerSource='';
    window.requestCanvasAgentText=async(options)=>{
      window.promptOptimizerRequests+=1;
      window.promptOptimizerSource=options.contextualPrompt;
      await new Promise((resolve)=>setTimeout(resolve,40));
      const text='将图1的 Logo 清晰地置于图2左上角，保持图2原有构图与画面比例，并严格保留 Logo 的品牌色。';
      await options.onResponse(text,{ok:true,text});
      return {ok:true,text};
    };
  </script>
  <script src="${contextMenuUrl}"></script>
  <script>document.querySelector('.ai-composer-prompt').addEventListener('contextmenu',showPromptTextContextMenu);</script>
  </body></html>`, 'utf8');

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: { offscreen: true, backgroundThrottling: false }
  });
  try {
    await win.loadFile(htmlPath);
    const menuLabel = await win.webContents.executeJavaScript(`(() => {
      const input=document.querySelector('.ai-composer-prompt');
      input.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:360,clientY:360}));
      return document.querySelector('#prompt-text-context-menu .context-menu-item span:last-child').textContent;
    })()`);
    if (menuLabel !== '使用 Agent 优化提示词') throw new Error(`Prompt menu was not localized: ${menuLabel}`);
    await win.webContents.executeJavaScript(`document.querySelector('#prompt-text-context-menu .context-menu-item').click()`);
    await wait(240);
    const beforeConfirm = await win.webContents.executeJavaScript(`(() => ({
      requests:window.promptOptimizerRequests,
      editable:!document.querySelector('.prompt-optimizer-original').readOnly,
      result:document.querySelector('.prompt-optimizer-result').value,
      prompt:document.querySelector('.ai-composer-prompt').value,
      confirmVisible:!document.querySelector('.prompt-optimizer-confirm').hidden,
      brand:document.querySelector('.prompt-optimizer-brand strong')?.textContent,
      modes:document.querySelectorAll('button[data-optimizer-mode]').length
    }))()`);
    if (beforeConfirm.requests !== 0 || !beforeConfirm.editable || beforeConfirm.result || !beforeConfirm.confirmVisible || beforeConfirm.brand !== 'Messs.' || beforeConfirm.modes !== 2) throw new Error(`Optimization dialog was not ready: ${JSON.stringify(beforeConfirm)}`);
    fs.writeFileSync(path.join(outputDir, 'prompt-optimizer-confirm.png'), (await win.webContents.capturePage()).toPNG());
    const editedSource = '把图1的 Logo 放到图2左上角，保持构图、比例和品牌颜色不变。';
    await win.webContents.executeJavaScript(`(() => {
      const field=document.querySelector('.prompt-optimizer-original');
      field.value=${JSON.stringify('把图1的 Logo 放到图2左上角，保持构图、比例和品牌颜色不变。')};
      document.querySelector('.prompt-optimizer-confirm').click();
    })()`);
    await wait(100);
    const readMetrics = () => win.webContents.executeJavaScript(`(() => {
      const rect=(selector)=>{const r=document.querySelector(selector).getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:Math.round(r.width),height:Math.round(r.height)}};
      const result=document.querySelector('.prompt-optimizer-result');
      return {viewport:{width:innerWidth,height:innerHeight},dialog:rect('.prompt-optimizer-dialog'),original:rect('.prompt-optimizer-original'),result:rect('.prompt-optimizer-result'),originalText:document.querySelector('.prompt-optimizer-original').value,resultText:result.value,resultEditable:!result.readOnly,replaceEnabled:!document.querySelector('.prompt-optimizer-replace').disabled,prompt:document.querySelector('.ai-composer-prompt').value,requests:window.promptOptimizerRequests,source:window.promptOptimizerSource};
    })()`);
    const desktop = await readMetrics();
    if (!desktop.resultText || !desktop.resultEditable || !desktop.replaceEnabled) throw new Error(`Agent result was not reviewable: ${JSON.stringify(desktop)}`);
    if (desktop.requests !== 1 || desktop.originalText !== editedSource || !desktop.source.includes(editedSource)) throw new Error(`Edited prompt was not confirmed before optimization: ${JSON.stringify(desktop)}`);
    if (desktop.dialog.left < 12 || desktop.dialog.top < 12 || desktop.dialog.right > desktop.viewport.width - 12 || desktop.dialog.bottom > desktop.viewport.height - 12) throw new Error(`Desktop dialog escaped viewport: ${JSON.stringify(desktop)}`);
    if (desktop.original.width < 500 || desktop.result.width < 500 || desktop.result.bottom > desktop.original.top + 1) throw new Error(`Desktop conversation layout overlapped: ${JSON.stringify(desktop)}`);
    if (desktop.prompt === desktop.resultText) throw new Error('The prompt changed before explicit confirmation.');
    fs.writeFileSync(path.join(outputDir, 'prompt-optimizer-dark.png'), (await win.webContents.capturePage()).toPNG());

    win.setSize(680, 720);
    await wait(120);
    const compact = await readMetrics();
    if (compact.dialog.left < 8 || compact.dialog.right > compact.viewport.width - 8 || compact.dialog.bottom > compact.viewport.height - 8) throw new Error(`Compact dialog escaped viewport: ${JSON.stringify(compact)}`);
    if (compact.result.bottom > compact.original.top + 1 || compact.original.height < 70 || compact.result.height < 100) throw new Error(`Compact conversation did not stack safely: ${JSON.stringify(compact)}`);
    fs.writeFileSync(path.join(outputDir, 'prompt-optimizer-compact.png'), (await win.webContents.capturePage()).toPNG());

    const replacement = compact.resultText;
    await win.webContents.executeJavaScript(`document.querySelector('.prompt-optimizer-replace').click()`);
    await wait(220);
    const replaced = await win.webContents.executeJavaScript(`({prompt:document.querySelector('.ai-composer-prompt').value,dialog:!!document.getElementById('prompt-optimizer-overlay')})`);
    if (replaced.dialog || replaced.prompt !== replacement) throw new Error(`Confirmed replacement failed: ${JSON.stringify(replaced)}`);
    process.stdout.write(`PROMPT_OPTIMIZER_VISUAL_OK desktop=${desktop.dialog.width}x${desktop.dialog.height} compact=${compact.dialog.width}x${compact.dialog.height}\n`);
  } finally {
    win.destroy();
    app.quit();
  }
}

run().catch((error) => {
  console.error(error && error.stack || error);
  app.exit(1);
});
