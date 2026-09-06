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
   window.launchBoardButlerImageTool=(action,file,item,options)=>{window.submission={action,options};return true;};
   window.openFixture=()=>openBoardButlerExpandPanel(null,{id:'source',name:'Preview',sourceWidth:1024,sourceHeight:768,thumbUrl:'assets/canvas-folder-brand-3d.png'},{id:'item'});
   openFixture();
  });
  const panel=page.locator('.board-smart-resize-panel').last();
  await panel.getByRole('button',{name:'16:9',exact:true}).click();
  await panel.locator('[name="width"]').fill('1920');
  assert.equal(await panel.locator('[name="height"]').inputValue(),'1080');
  await panel.getByRole('button',{name:'自由',exact:true}).click();
  const before=Number(await panel.locator('[name="width"]').inputValue());
  const handle=await panel.locator('.is-se').boundingBox();
  await page.mouse.move(handle.x+10,handle.y+10);await page.mouse.down();
  await page.mouse.move(handle.x+35,handle.y+25,{steps:10});await page.mouse.up();
  assert.ok(Number(await panel.locator('[name="width"]').inputValue())>before);
  await panel.getByRole('button',{name:'1:1',exact:true}).click();
  await panel.locator('.is-se').focus();await page.keyboard.press('ArrowRight');
  assert.equal(await panel.locator('[name="width"]').inputValue(),await panel.locator('[name="height"]').inputValue());
  fs.mkdirSync('test-artifacts/smart-resize',{recursive:true});
  for(const width of [1200,390])for(const theme of ['dark','light']){
   await page.setViewportSize({width,height:760});
   await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.body.dataset.theme=theme;positionBoardButlerPanel(boardButlerPanel,null);clampBoardButlerPanelToViewport(boardButlerPanel);},theme);
   await page.waitForTimeout(300);
   const rect=await panel.boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=width+1);
   const img=panel.locator('.board-smart-resize-frame img');
   assert.equal(await img.evaluate(el=>el.complete&&el.naturalWidth>0),true);
   await page.screenshot({path:`test-artifacts/smart-resize/${theme}-${width}.png`});
  }
  const expected={width:Number(await panel.locator('[name="width"]').inputValue()),height:Number(await panel.locator('[name="height"]').inputValue())};
  await panel.getByRole('button',{name:'修改尺寸',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>submission),{action:'imageExpand',options:expected});
  console.log('Smart resize passed: ratio, numeric sync, pointer/keyboard resize, themes, compact layout and submission.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
