const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try {
  const page=await browser.newPage();
  await page.route('**/js/app.js',r=>r.fulfill({body:''}));
  await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
  await page.evaluate(()=>{
   delete document.documentElement.dataset.startupPending;
   window.t=(en,zh)=>zh;
   document.body.innerHTML='<div id="board-viewport" class="board-viewport" style="position:fixed;inset:0;background:#15171b"><img src="assets/canvas-folder-brand-3d.png" style="position:absolute;left:140px;top:170px;width:220px;height:165px"></div>';
   Board.zoom=1;Board.panX=0;Board.panY=0;
   window.item={id:'item',x:140,y:170,width:220,height:165,selected:true};
   window.launchBoardButlerImageTool=(action,file,item,options)=>{window.submission={action,options};return true;};
   window.openFixture=()=>openBoardButlerExpandPanel(null,{id:'source',name:'Preview',sourceWidth:1024,sourceHeight:768,thumbUrl:'assets/canvas-folder-brand-3d.png'},item);
   openFixture();
  });
  const panel=page.locator('.board-inline-resize');
  await panel.locator('select').selectOption(String(16/9));
  await panel.locator('[name="width"]').fill('1920');
  await panel.locator('[name="width"]').blur();
  assert.equal(await panel.locator('[name="height"]').inputValue(),'1080');
  await panel.locator('select').selectOption('0');
  const before=Number(await panel.locator('[name="width"]').inputValue());
  const handle=await panel.locator('.is-se').boundingBox();
  await page.mouse.move(handle.x+10,handle.y+10);await page.mouse.down();
  await page.mouse.move(handle.x+35,handle.y+25,{steps:10});await page.mouse.up();
  assert.ok(Number(await panel.locator('[name="width"]').inputValue())>before);
  await panel.locator('select').selectOption('1');
  await panel.locator('.is-se').focus();await page.keyboard.press('ArrowRight');
  assert.equal(await panel.locator('[name="width"]').inputValue(),await panel.locator('[name="height"]').inputValue());
  fs.mkdirSync('test-artifacts/smart-resize',{recursive:true});
  for(const width of [1200,390])for(const theme of ['dark','light']){
   await page.setViewportSize({width,height:760});
   await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.body.dataset.theme=theme;boardButlerExpandEditor._layout();},theme);
   await page.waitForTimeout(300);
   const rect=await panel.locator('.board-inline-resize-toolbar').boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=width+1);
   assert.equal(await panel.locator('img').count(),0);
   await page.screenshot({path:`test-artifacts/smart-resize/${theme}-${width}.png`});
  }
  const expected={width:Number(await panel.locator('[name="width"]').inputValue()),height:Number(await panel.locator('[name="height"]').inputValue())};
  await page.evaluate(()=>{Board.zoom=.7;Board.panX=15;boardButlerExpandEditor._layout();});
  const frame=await panel.locator('.board-inline-resize-frame').boundingBox();
  assert.ok(Math.abs(frame.width-expected.width/1024*220*.7)<1);
  await panel.getByRole('button',{name:'应用',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>submission),{action:'imageExpand',options:expected});
  await page.evaluate(()=>openFixture());await page.keyboard.press('Escape');
  assert.equal(await page.locator('.board-inline-resize').count(),0);
  assert.deepEqual(await page.evaluate(()=>[item.x,item.y,item.width,item.height]),[140,170,220,165]);
  console.log('Smart resize passed: ratio, numeric sync, pointer/keyboard resize, themes, compact layout and submission.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
