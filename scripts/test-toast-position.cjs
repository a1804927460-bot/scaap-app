const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const page=await browser.newPage();await page.route('**/js/app.js',r=>r.fulfill({body:''}));
  await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
  await page.evaluate(()=>{
   delete document.documentElement.dataset.startupPending;
   document.body.innerHTML='<div id="board-viewport" style="position:fixed;inset:40px 20px 20px 20px"></div><div class="board-bottom-bar" style="height:48px;width:260px;bottom:30px"></div><div id="toast" class="toast" hidden></div>';
   window.t=(en,zh)=>zh;
  });
  for(const width of [1280,390]){
   await page.setViewportSize({width,height:720});
   await page.evaluate(()=>showToast('视频结果正在恢复，请保留任务，不要重复提交。'.repeat(3),'AI'));
   await page.waitForTimeout(400);
   const toast=await page.locator('#toast').boundingBox(),bar=await page.locator('.board-bottom-bar').boundingBox();
   assert.ok(toast.y+toast.height<=bar.y-10);assert.ok(toast.x>=0&&toast.x+toast.width<=width);
   assert.equal(await page.locator('.toast-brand-logo').evaluate(el=>el.complete&&el.naturalWidth>0),true);
  }
  await page.locator('.toast-dismiss').click();await page.waitForTimeout(400);
  assert.equal(await page.locator('#toast').isVisible(),false);
  console.log('Toast position: above toolbar, wrapped narrow viewport, brand asset and explicit dismissal passed.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
