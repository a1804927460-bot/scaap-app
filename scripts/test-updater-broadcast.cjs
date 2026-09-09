const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('main.js','utf8');
const events=[];
const window=id=>({isDestroyed:()=>false,webContents:{send:(channel,data)=>events.push({id,channel,data})}});
const context={mainWindow:window('main'),detachedCanvasWindows:new Map([['a',window('canvas')],['b',{isDestroyed:()=>true}]]),
 app:{isPackaged:true},process:{platform:'win32'},updaterState:{enabled:true}};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function notifyUpdateDownloaded('),source.indexOf('async function checkForUpdates(')),context);
context.notifyUpdateDownloaded({version:'0.0.117'});
assert.equal(events.filter(e=>e.channel==='updater:status'&&e.data.status==='downloaded').length,2);
assert.equal(events.filter(e=>e.channel==='updater:downloaded').length,2);
assert.match(source,/autoUpdateEnabled !== false/);
assert.match(source,/if \(updaterState.enabled\) checkForUpdatesQuietly\(\)/);
assert.match(source,/setInterval\(checkForUpdatesQuietly, 15 \* 60 \* 1000\)/);
assert.match(source,/autoUpdater.autoInstallOnAppQuit = updaterState.enabled/);
console.log('Updater: startup defaults, periodic checks, main/detached notifications and automatic quit installation and explicit restart passed.');
