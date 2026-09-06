const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { parseDocument } = require('htmlparser2');
const { findAll, getOuterHTML } = require('domutils');
const root = path.resolve(__dirname, '..');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const doc = parseDocument(fs.readFileSync(path.join(root, 'src/index.html'), 'utf8'));
  const labels = findAll(n => n.name === 'label' && /^(canvas-library-search|market-search|workshop-search)( |$)/.test(n.attribs.class || ''), doc.children);
  const out = path.join(root, 'test-artifacts/gooey-search');
  fs.mkdirSync(out, { recursive: true });
  const fixture = path.join(out, 'preview.html');
  fs.writeFileSync(fixture, `<html><head><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(path.join(root, 'src/styles/main.css'))}"><link rel="stylesheet" href="${pathToFileURL(path.join(root, 'src/styles/gooey-search.css'))}"><style>body{display:flex!important;flex-direction:column;gap:32px;padding:40px;overflow:auto!important}label.gooey-search{width:100%!important;max-width:500px;flex:none!important}h2{font-size:18px;color:var(--text-primary)}</style></head><body><h2>Search</h2>${labels.map(getOuterHTML).join('')}<script src="${pathToFileURL(path.join(root, 'src/js/gooey-search.js'))}"></script></body></html>`);
  const win = new BrowserWindow({ show: false, width: 800, height: 400, webPreferences: { contextIsolation: true, offscreen: true, backgroundThrottling: false } });
  await win.loadFile(fixture);
  win.webContents.on('console-message', (_event, _level, message) => console.log(message));
  for (const theme of ['dark', 'light']) {
    for (const width of [800, 380]) {
      win.setSize(width, 400);
      await win.webContents.executeJavaScript(`document.documentElement.setAttribute('data-theme', '${theme}'); document.body.setAttribute('data-theme', '${theme}');`);
      for (let i = 0; i < 3; i++) {
        await win.webContents.executeJavaScript(`(() => { const input=document.querySelectorAll('.gooey-search input')[${i}]; input.focus(); input.dispatchEvent(new FocusEvent('focusin', {bubbles:true})); })()`);
        await new Promise(r => setTimeout(r, 450));
        const state = await win.webContents.executeJavaScript(`(() => {const r=document.querySelectorAll('.gooey-search')[${i}]; const input=r.querySelector('input'); const b=r.getBoundingClientRect();return {expanded:r.classList.contains('is-expanded'),overflow:b.right>innerWidth,inputWidth:input.getBoundingClientRect().width,filter:getComputedStyle(r.querySelector('.gooey-search-surfaces')).filter}})()`);
        if (!state.expanded || state.overflow || state.inputWidth < 120 || state.filter !== 'none') throw new Error(JSON.stringify(state));
      }
      fs.writeFileSync(path.join(out, `${theme}-${width}.png`), (await win.webContents.capturePage({}, { stayHidden: true, stayAwake: true })).toPNG());
    }
  }
  console.log('GOOEY_SEARCH_OK');
  win.destroy();
  app.quit();
}).catch(e => { console.error(e); app.exit(1); });
