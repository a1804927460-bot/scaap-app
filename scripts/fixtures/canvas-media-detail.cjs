const { app, BrowserWindow, protocol, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');
const thumbnails = require('../../lib/thumbnails');
app.setPath('userData', path.join(process.env.MESSS_DETAIL_FIXTURE, 'user-data'));
protocol.registerSchemesAsPrivileged([{ scheme: 'messs-thumb', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
app.whenReady().then(async () => {
  const thumbCacheDir = path.join(process.env.MESSS_DETAIL_FIXTURE, 'cache');
  const store = { getFile(id) {
    if (!/^(image|video)-\d+$/.test(id)) return null;
    const name = id.startsWith('video') ? 'video.mp4' : 'image.png';
    return { id, name, storedPath: path.join(process.env.MESSS_DETAIL_FIXTURE, name) };
  } };
  // Exercise the production handler, including query parsing and bounded fallback.
  const source = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const start = source.indexOf("protocol.handle('messs-thumb',");
  vm.runInNewContext(source.slice(start, source.indexOf("protocol.handle('messs-preview',", start)),
    { protocol, net, store, thumbnails, thumbCacheDir, URL, Response, path, pathToFileURL });
  const window = new BrowserWindow({ show: false, width: 1440, height: 960, webPreferences: { backgroundThrottling: false } });
  await window.loadFile(path.join(__dirname, 'canvas-media-detail.html'));
}).catch(error => { console.error(error); app.exit(1); });
app.on('window-all-closed', () => app.quit());
