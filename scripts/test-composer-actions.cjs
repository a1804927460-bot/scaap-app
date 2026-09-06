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
 await page.locator('#ai-assistant-upload').click();
 assert.equal(await page.locator('[data-assistant-kind="video"]').isVisible(),true);
 await page.locator('#ai-assistant-add-local').click();assert.equal(await page.evaluate(()=>window.uploaded),true);
 await page.locator('#ai-assistant-upload').click();await page.locator('[data-assistant-kind="image"]').click();
 assert.equal(await page.evaluate(()=>AiAssistant.kind),'image');
 await page.locator('#ai-assistant-permissions').click();
 await page.locator('#messs-permission-menu button').nth(1).click();
 assert.equal(await page.evaluate(()=>permissionChanges.length),0);
 await page.locator('.messs-permission-dialog .permission-allow').click();
 await page.waitForFunction(()=>permissionChanges.length===1);
 assert.equal(await page.locator('#ai-assistant-permissions').textContent(),'完全访问');
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
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
