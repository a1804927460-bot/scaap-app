const {app,BrowserWindow,protocol}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');
app.setPath('userData',fs.mkdtempSync(path.join(require('node:os').tmpdir(),'messs-director-test-')));
app.commandLine.appendSwitch('use-angle','swiftshader');
app.commandLine.appendSwitch('enable-webgl');
protocol.registerSchemesAsPrivileged([{scheme:'messs-director',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}}]);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 const requests=[],failedResources=[];const started=Date.now();
 protocol.handle('messs-director',r=>{requests.push(r.url);const response=require('../lib/director-protocol.cjs').createDirectorResponse(path.join(root,'src/vendor/awplanet'),r);if(response.status>=400)failedResources.push(r.url);return response});
 const fixture=path.join(root,'work/awplanet-fixture.html');
 fs.mkdirSync(path.dirname(fixture),{recursive:true});
 const url=p=>pathToFileURL(path.join(root,p)).href;
 fs.writeFileSync(fixture,'<!doctype html><html data-theme="dark" data-language="zh"><head><link rel="stylesheet" href="'+url('src/styles/theme.css')+'"><link rel="stylesheet" href="'+url('src/styles/three-d-director.css')+'"></head><body><script src="'+url('src/js/three-d-director.js')+'"></script></body></html>');
 const win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{offscreen:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 let errors=[];win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)});
 // Match the production page's encoding.
 fs.writeFileSync(fixture,fs.readFileSync(fixture,'utf8').replace('<head>','<head><meta charset="utf-8">'));
 await win.loadFile(fixture);
 await win.webContents.executeJavaScript(`window.activeCanvasId=()=> 'test-scene';window.AppState={files:[]};window.boardViewportCenterCoords=()=>({x:10,y:20});window.addFilesToBoard=async ids=>window.added=ids;window.messsAPI={importCroppedImage:async request=>{window.captured=request;return {ok:true,file:{id:'shot-1'}}}};window.showToast=m=>window.toast=m;openThreeDDirector();`);
 for(let i=0;i<100;i++){if(await win.webContents.executeJavaScript('ThreeDDirector.ready'))break;await pause(200);}
 assert.ok(await win.webContents.executeJavaScript('ThreeDDirector.ready'),errors.join('\n'));
 const frame=win.webContents.mainFrame.frames[0];
 for(const target of [frame,win.webContents]){
   assert.equal(await target.executeJavaScript(`document.fonts.load('14px "Messs Source Han Sans"','导演台保存项目').then(fonts=>fonts.length>0&&fonts.every(font=>font.status==='loaded'))`),true,'Bundled Source Han Sans must decode and load offline');
 }
 assert.ok(await frame.executeJavaScript(`[...document.querySelectorAll('.engine-panel-tabs button,input,.engine-info-row')].every(e=>getComputedStyle(e).fontFamily.includes('Messs Source Han Sans'))`),'Director controls must use Source Han Sans');
 await pause(3000);
 console.log('DIRECTOR_STARTUP',JSON.stringify({elapsed:Date.now()-started,requests:requests.length,optional:requests.filter(url=>/animations|nature|brand/.test(url)).length}));
 assert.ok(requests.length<60,'Default scene must load on demand, not fetch the whole library');
 assert.equal(await frame.executeJavaScript('document.body.dataset.assetWarmupStatus'),null,'Opening must not eagerly warm the entire asset library');
 assert.equal(await frame.executeJavaScript('getComputedStyle(document.querySelector(".engine-native-badge")).display'),'none','Product viewport must not show the upstream logo');
 assert.equal(await win.webContents.executeJavaScript('document.querySelector(".three-d-director-header").innerText.includes("awplanet")'),false);
 assert.ok(await frame.executeJavaScript('[...document.querySelectorAll(".engine-panel-tabs button")].every(e=>parseFloat(getComputedStyle(e).fontSize)>=12)'),'Panel text must be readable');
 const info=await frame.executeJavaScript('({canvas:!!document.querySelector("canvas"),mounted:document.body.dataset.runtimeCanvasMounted,text:document.body.innerText.slice(0,300),preload:typeof window.messsAPI})');
 assert.ok(info.canvas,JSON.stringify({info,errors}));assert.equal(info.preload,'undefined');
 const renderInfo=await frame.executeJavaScript('(()=>{const c=document.querySelector("canvas");const r=c.getBoundingClientRect();const gl=c.getContext("webgl2");return {width:c.width,height:c.height,cssWidth:r.width,cssHeight:r.height,dpr:devicePixelRatio,antialias:gl?.getContextAttributes().antialias}})()');
 console.log('DIRECTOR_RESOLUTION',JSON.stringify(renderInfo));
 assert.equal(renderInfo.antialias,true,'Desktop renderer must enable native antialiasing');
 assert.ok(renderInfo.width>=renderInfo.cssWidth-1,'Preview must not render below its CSS resolution');
 await frame.executeJavaScript(`(() => { const input=[...document.querySelectorAll('input')].find(i=>i.value==='project 1'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Messs saved scene'); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
 await pause(100);
 await win.webContents.executeJavaScript('directorAction("snapshot")');
 const snapshot=await win.webContents.executeJavaScript('window.captured');
 assert.ok(snapshot?.dataUrl?.startsWith('data:image/png;base64,'),JSON.stringify({info,errors,toast:await win.webContents.executeJavaScript('window.toast')}));
 const sharp=require('sharp');const bytes=Buffer.from(snapshot.dataUrl.split(',')[1],'base64');
 const stats=await sharp(bytes).stats();assert.ok(stats.channels.slice(0,3).reduce((n,c)=>n+c.stdev,0)>10,'Rendered frame must not be blank');
 const metadata=await sharp(bytes).metadata();assert.ok(metadata.width>=renderInfo.width*.9&&metadata.height>=renderInfo.height*.9,'Captured camera frame must preserve the high resolution canvas');
 console.log('DIRECTOR_EXPORT',JSON.stringify({width:metadata.width,height:metadata.height,format:metadata.format}));
 assert.ok(Math.abs(Math.max(metadata.width,metadata.height)-2560)<=1,'Export must render at 2560px independently of viewport');
 assert.deepEqual(await frame.executeJavaScript('(()=>{const c=document.querySelector("canvas");return [c.width,c.height]})()'),[renderInfo.width,renderInfo.height],'Export must restore the preview resolution');
 const output=path.join(root,'test-artifacts/awplanet');fs.mkdirSync(output,{recursive:true});
 fs.writeFileSync(path.join(output,'quality-'+(process.env.DIRECTOR_TEST_SCALE||'1')+'.png'),bytes);
 fs.writeFileSync(path.join(output,'dark.png'),(await win.webContents.capturePage()).toPNG());
 await win.webContents.executeJavaScript('document.documentElement.dataset.theme="light"');
 await pause(300);
 assert.equal(await frame.executeJavaScript('document.documentElement.dataset.theme'),'light');
 assert.equal(await frame.executeJavaScript('getComputedStyle(document.querySelector("button")).backgroundColor'),'rgb(255, 255, 255)');
 fs.writeFileSync(path.join(output,'light.png'),(await win.webContents.capturePage()).toPNG());
 for(const width of [1100,900]){
   win.setSize(width,900);await pause(200);
   const count=await frame.executeJavaScript('document.querySelectorAll(".engine-panel-tabs button").length');
   for(let i=0;i<count;i++){
     await frame.executeJavaScript(`document.querySelectorAll('.engine-panel-tabs button')[${i}].click();void 0;`);await pause(150);
     assert.ok(await frame.executeJavaScript(`(()=>{const p=document.querySelector('.engine-panel-stack');const r=p.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&p.scrollWidth<=p.clientWidth+1})()`),'Panel must fit without horizontal overflow');
   }
   fs.writeFileSync(path.join(output,'panels-'+width+'.png'),(await win.webContents.capturePage()).toPNG());
 }
 win.setSize(1440,1000);await pause(200);
 await win.webContents.executeJavaScript('closeThreeDDirector()');await pause(200);
 assert.equal(await win.webContents.executeJavaScript('document.querySelectorAll(".three-d-director-viewport iframe").length'),0,'Close must remove the embedded frame');
 await win.webContents.executeJavaScript('openThreeDDirector()');await pause(1500);
 assert.ok(await win.webContents.executeJavaScript('ThreeDDirector.ready'));
 assert.ok(await win.webContents.mainFrame.frames[0].executeJavaScript(`[...document.querySelectorAll('input')].some(i=>i.value==='Messs saved scene')`),'Reopen must preserve scene changes');
 await win.webContents.executeJavaScript(`window.showAiImagePopover=async kind=>{document.getElementById('ai-image-popover')?.remove();const composer=document.createElement('div');composer.id='ai-image-popover';composer._toggleBoardReference=async id=>{window.reference={kind,id};};document.body.append(composer);};void 0;`);
 for(const kind of ['image','video']) {
   await win.webContents.executeJavaScript('directorAction('+JSON.stringify(kind)+')');
   assert.deepEqual(await win.webContents.executeJavaScript('window.reference'),{kind,id:'shot-1'});
   await win.webContents.executeJavaScript('openThreeDDirector()');await pause(1500);
 }
 let downloaded=false;
 win.webContents.session.once('will-download',(event,item)=>{downloaded=item.getFilename()==='Messs-3D-shot.png';event.preventDefault();});
 await win.webContents.executeJavaScript('directorAction("download")');await pause(200);
 assert.ok(downloaded,'Save image must trigger a native download');
 assert.deepEqual(errors,[],'Embedded editor must not report resource/CSP/runtime errors');
 const missingAssets=failedResources.filter(url=>!url.includes('/__phone-pilot/'));
 console.log('DIRECTOR_UNAVAILABLE_PHONE_REQUESTS',failedResources.length-missingAssets.length);
 assert.equal(requests.filter(url=>url.includes('/__phone-pilot/')).length,0,'Disabled phone integration must not poll');
 assert.deepEqual(missingAssets,[],'On-demand panel assets must load without missing files');
 console.log('AWPLANET_OK: local assets, rendered scene, canvas bridge, light/dark theme, isolation and reopen passed.');
 win.destroy();app.quit();
}).catch(e=>{console.error(e);app.exit(1)});
