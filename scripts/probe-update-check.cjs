const { app } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { autoUpdater } = require('electron-updater');
const semver = require('semver');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'messs-update-probe-')));
const timer = setTimeout(() => { console.error('UPDATE_PROBE_TIMEOUT'); app.exit(1); }, 60000);
app.whenReady().then(async () => {
  const { getNetSession } = require('electron-updater/out/electronHttpExecutor');
  getNetSession().webRequest.onBeforeRequest((details, callback) => {
    console.log('UPDATE_REQUEST', new URL(details.url).origin + new URL(details.url).pathname);
    callback({});
  });
  autoUpdater.forceDevUpdateConfig = true;
  autoUpdater.autoDownload = false;
  autoUpdater.currentVersion = semver.parse('0.0.110');
  autoUpdater.logger = Object.fromEntries(['info', 'warn', 'error', 'debug'].map(level => [level,
    (...args) => console.log(level, ...args.map(v => String(v).slice(0, 1800)))]));
  autoUpdater.setFeedURL(process.argv.includes('--generic')
    ? { provider: 'generic', url: 'https://github.com/a1804927460-bot/messs-releases/releases/latest/download/', useMultipleRangeRequest: false }
    : { provider: 'github', owner: 'a1804927460-bot', repo: 'messs-releases', private: false });
  try {
    const result = await autoUpdater.checkForUpdates();
    console.log('UPDATE_PROBE_RESULT', JSON.stringify({ version: result?.updateInfo?.version,
      files: result?.updateInfo?.files?.map(f => ({ url: f.url, size: f.size })) }));
    clearTimeout(timer); app.exit(0);
  } catch (error) {
    console.error('UPDATE_PROBE_ERROR', error.code, String(error.message).slice(0, 2000));
    clearTimeout(timer); app.exit(1);
  }
});
