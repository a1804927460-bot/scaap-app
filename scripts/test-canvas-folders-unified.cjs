const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {pathToFileURL}=require('node:url');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try {
  const page=await browser.newPage();
  await page.route('**/js/app.js',r=>r.fulfill({body:''}));
  await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
  await page.evaluate(()=>{
   delete document.documentElement.dataset.startupPending;
   window.t=(en,zh)=>zh;
   AppState.canvasProjects=[{id:'personal',name:'个人旧文件夹',scope:'personal'},{id:'team',name:'团队旧文件夹',scope:'team'}];
   CanvasWorkspace.libraryScope='team';
   window.answer=null;
   showCanvasTextDialog({title:'新建文件夹',label:'文件夹名称',initialValue:'新文件夹'}).then(result=>window.answer=result);
  });
  assert.equal(await page.locator('.canvas-scope-input').count(),0);
  assert.equal(await page.locator('.canvas-project-field').isVisible(),false);
  await page.locator('.canvas-name-input').fill('设计素材');
  await page.locator('.canvas-name-dialog button[type="submit"]').click();
  assert.equal(await page.evaluate(()=>answer.name),'设计素材');
  assert.deepEqual(await page.evaluate(()=>canvasProjectsForScope().map(p=>p.id)),['personal','team']);
  const options=await page.evaluate(()=>{const select=document.createElement('select');appendCanvasProjectOptions(select,AppState.canvasProjects,'team');return {groups:select.querySelectorAll('optgroup').length,count:select.options.length,selected:select.value};});
  assert.deepEqual(options,{groups:0,count:2,selected:'team'});
  assert.deepEqual(await page.evaluate(()=>AppState.canvasProjects.map(p=>p.scope)),['personal','team']);
  console.log('Unified canvas folders: name-only dialog, all legacy folders selectable, no scope groups and preserved data passed.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
