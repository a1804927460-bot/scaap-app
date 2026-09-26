const {chromium}=require('playwright');const assert=require('node:assert/strict');const {pathToFileURL}=require('url');const path=require('path');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{const page=await browser.newPage();await page.route('**/js/app.js',r=>r.fulfill({body:''}));await page.goto(pathToFileURL(path.resolve('src/index.html')).href);await page.evaluate(()=>{
 delete document.documentElement.dataset.startupPending;
 AppState.files=[{id:'f',name:'Photo.png',ext:'.png'}];AppState.canvases=[{id:'a',name:'画布一'},{id:'b',name:'画布二'}];
 window.messsAPI={listScheduleProjects:async()=>[],listWorkspaceResources:async()=>[]};window.appendFileThumbnail=el=>el.textContent='Photo';
 window.activeCanvasRecord=()=>AppState.canvases.find(c=>c.id===AppState.activeCanvasId);window.activeCanvasId=()=>AppState.activeCanvasId;
 window.switchCanvas=id=>{AppState.activeCanvasId=id;const w=document.getElementById('board-workspace-body');w.hidden=false;document.body.append(w);w.style.cssText='position:fixed;inset:0;display:block';const v=document.getElementById('board-viewport');v.style.cssText='position:absolute;inset:0;display:block';};
 window.clientToBoardCoords=(x,y)=>({x:(x-20)/2,y:(y-30)/2});window.calls=[];window.addFilesToBoard=async(...args)=>calls.push(args);
 });await page.evaluate(()=>MesssWorkHub.open('files'));
 await page.getByRole('button',{name:'用于画布',exact:true}).click();await page.locator('.hub-editor select').selectOption('b');await page.getByRole('button',{name:'选择放置位置',exact:true}).click();
 await page.locator('.hub-canvas-placement').waitFor();await page.mouse.click(300,240);assert.deepEqual(await page.evaluate(()=>calls[0]),[['f'],140,105,{selectAdded:true}]);assert.equal(await page.evaluate(()=>activeCanvasId()),'b');assert.equal(await page.locator('.hub-canvas-placement').count(),0);
 await page.evaluate(()=>MesssWorkHub.open('files'));await page.getByRole('button',{name:'用于画布',exact:true}).click();assert.equal(await page.locator('.hub-editor').count(),0);await page.keyboard.press('Escape');assert.equal(await page.locator('.hub-canvas-placement').count(),0);assert.equal(await page.evaluate(()=>calls.length),1);
 console.log('PASS: choose target, pointer placement with zoom/pan, existing canvas, Escape cancellation');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
