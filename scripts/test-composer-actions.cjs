const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try {
 const page=await browser.newPage({viewport:{width:1100,height:800}});
 await page.route('**/js/app.js',r=>r.fulfill({body:''}));
 await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
 await page.evaluate(()=>{
   delete document.documentElement.dataset.startupPending;AppState.language='zh';
   window.permissionChanges=[];
   window.messsAPI={setAiPermissionMode:async p=>{permissionChanges.push(p);return {mode:p.mode};},onAiPermissionRequest:cb=>{window.permissionRequest=cb;},replyAiPermission:async p=>{window.permissionReply=p;}};
   window.loadAiChatHistory=async()=>{};window.refreshAssistantConfig=async()=>{};window.startAiDynamicPrompt=()=>{};
   window.uploadAssistantFiles=async()=>{window.uploaded=true;};
   initAiAssistant();setAssistantFullscreen(true);
 });
 assert.equal(await page.locator('[data-assistant-kind="chat"]').isVisible(),false);
 const plus = await page.locator('#ai-assistant-upload').evaluate(async button => {
   const icon=button.querySelector('img');await icon.decode();
   const b=button.getBoundingClientRect(),i=icon.getBoundingClientRect();
   const style=getComputedStyle(icon);
   return {dx:Math.abs(b.x+b.width/2-i.x-i.width/2),dy:Math.abs(b.y+b.height/2-i.y-i.height/2),width:parseFloat(style.width),height:parseFloat(style.height)};
 });
 assert.ok(plus.dx<0.5 && plus.dy<0.5,JSON.stringify(plus));
 assert.equal(plus.width,18);assert.equal(plus.height,18);
 await page.locator('#ai-assistant-upload').click();
 assert.equal(await page.locator('[data-assistant-kind="video"]').isVisible(),true);
 await page.evaluate(() => { MesssComposerActions.refresh(); MesssComposerActions.refresh(); });
 assert.equal(await page.locator('#ai-assistant-add-menu .messs-composer-action-icon').count(),4);
 for(const theme of ['light','dark']) {
   await page.evaluate(theme => { document.documentElement.dataset.theme=theme; },theme);
   const icons=await page.locator('#ai-assistant-add-menu .messs-composer-action-icon').evaluateAll(async icons => {
     await Promise.all(icons.map(icon=>icon.decode()));
     return icons.map(icon=>{const r=icon.getBoundingClientRect(); const b=icon.parentElement.getBoundingClientRect();return {w:r.width,h:r.height,x:r.x,center:Math.abs(r.y+r.height/2-b.y-b.height/2)};});
   });
   assert.ok(icons.every(icon=>icon.w===16 && icon.h===16 && icon.center<1));
   assert.ok(icons.every(icon=>Math.abs(icon.x-icons[0].x)<1));
   await page.screenshot({path:`test-artifacts/composer-actions/add-icons-${theme}.png`});
 }
 await page.locator('#ai-assistant-add-local').click();assert.equal(await page.evaluate(()=>window.uploaded),true);
 await page.locator('#ai-assistant-upload').click();await page.locator('[data-assistant-kind="image"]').click();
 assert.equal(await page.evaluate(()=>AiAssistant.kind),'image');
 await page.locator('#ai-assistant-permissions').click();
 assert.equal(await page.locator('#messs-permission-menu .messs-permission-icon').count(),2);
 assert.equal(await page.locator('#ai-assistant-permissions .is-ask').count(),1);
 fs.mkdirSync('test-artifacts/composer-actions',{recursive:true});
 for(const theme of ['dark','light']) {
   await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
   await page.screenshot({path:`test-artifacts/composer-actions/permission-icons-${theme}.png`});
   for(const icon of ['lock-keyhole','shield-check']) {
     assert.equal(await page.evaluate(async icon=>{const image=new Image();image.src=`assets/icons/lucide/${icon}.svg`;await image.decode();return image.naturalWidth>0;},icon),true);
   }
 }
 await page.locator('#messs-permission-menu button').nth(1).click();
 assert.equal(await page.evaluate(()=>permissionChanges.length),0);
 await page.locator('.messs-permission-dialog .permission-allow').click();
 await page.waitForFunction(()=>permissionChanges.length===1);
 assert.equal(await page.locator('#ai-assistant-permissions').textContent(),'完全访问');
 assert.equal(await page.locator('#ai-assistant-permissions .is-full').count(),1);
 await page.evaluate(()=>startNewAiChat());
 assert.equal(await page.locator('#ai-assistant-permissions').textContent(),'请求批准');
 fs.mkdirSync('test-artifacts/composer-actions',{recursive:true});
 for(const theme of ['dark','light']) {
   await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;void permissionRequest({id:'test',session:MesssComposerActions.session,type:'read',target:'C:/example/report.txt'});},theme);
   const dialog=page.locator('.messs-permission-dialog');await dialog.waitFor();
   assert.ok((await dialog.boundingBox()).width<=402);
   await page.screenshot({path:`test-artifacts/composer-actions/${theme}.png`});
   await dialog.locator('button').first().click();
   await page.waitForFunction(()=>window.permissionReply?.allow===false);
 }
 await page.setViewportSize({width:520,height:720});
 await page.locator('#ai-assistant-upload').click();
 const menu=await page.locator('#ai-assistant-add-menu').boundingBox();
 assert.ok(menu.x>=0 && menu.x+menu.width<=520 && menu.y>=0);
 await page.screenshot({path:'test-artifacts/composer-actions/compact-menu.png'});
 console.log('Composer: plus menu, upload, generation mode, explicit session grant, reset and themed task confirmation passed.');
 await page.waitForTimeout(250);
 assert.equal(await page.locator('#ai-assistant-add-menu').evaluate(el=>el.getAnimations().length),0);
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.evaluate(()=>{
   const menu=document.getElementById('ai-assistant-add-menu');
   MesssUiMotion.enter(menu);
 });
 assert.equal(await page.locator('#ai-assistant-add-menu').evaluate(el=>el.getAnimations().length),0);
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.evaluate(()=>{
   const menu=document.getElementById('ai-assistant-add-menu');
   for(let i=0;i<8;i++){MesssUiMotion.enter(menu);MesssUiMotion.stop(menu);}
 });
 assert.equal(await page.locator('#ai-assistant-add-menu').evaluate(el=>el.getAnimations().length),0);
 for(const width of [1100,390]) for(const theme of ['dark','light']) {
   await page.setViewportSize({width,height:800});
   await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
   const estimates=await page.evaluate(async()=>{
     const rows=['ai-assistant-message','board-agent-message'].map(className=>{
       const row=document.createElement('div');row.className=className;document.body.append(row);return row;
     });
     let finish;
     window.messsAPI.estimateAgentCredits=async()=>({available:true,min:0.06,max:1.64});
     window.messsAPI.chatWithAi=()=>new Promise(resolve=>{finish=resolve;});
     const results=[];
     for(const row of rows){
       const task=chatWithAgentEstimate(row,{});
       await new Promise(resolve=>setTimeout(resolve,0));
       results.push({label:row.dataset.creditEstimate,icon:getComputedStyle(row,'::after').content,title:row.getAttribute('title')});
       finish({ok:true});await task;
       if(row.hasAttribute('data-credit-estimate'))throw Error('Estimate did not clear');
       row.remove();
     }
     return results;
   });
   for(const estimate of estimates){
     assert.equal(estimate.label,'预计 0.06 - 1.64 积分');
     assert.ok(estimate.icon.includes('\u2726'),'Estimate must have a solid four-point star');
     assert.equal(estimate.title,null,'No internal pricing tooltip');
   }
 }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
