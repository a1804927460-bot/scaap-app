const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
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
   await page.evaluate(()=>showToast('视频生成失败，请重试。'.repeat(3),'AI', {category:'ai-generation-failure'}));
   await page.waitForTimeout(400);
   const toast=await page.locator('#toast').boundingBox(),bar=await page.locator('.board-bottom-bar').boundingBox();
   assert.ok(toast.y+toast.height<=bar.y-10);assert.ok(toast.x>=0&&toast.x+toast.width<=width);
   assert.equal(await page.locator('.toast-brand-logo').evaluate(el=>el.complete&&el.naturalWidth>0),true);
  }
  await page.locator('.toast-dismiss').click();await page.waitForTimeout(400);
  assert.equal(await page.locator('#toast').isVisible(),false);
  await page.evaluate(()=>showToast('Folder renamed', 'Messs'));
  assert.equal(await page.locator('.toast-dismiss').count(),0);
  await page.waitForTimeout(3500);
  assert.equal(await page.locator('#toast').isVisible(),true);
  await page.waitForTimeout(2000);
  assert.equal(await page.locator('#toast').isVisible(),false);
  await page.evaluate(()=>{
   showToast('Image generation failed', 'AI', {category:'ai-generation-failure'});
   showToast('Folder renamed again', 'Messs');
   showToast('Video saved to canvas', 'AI');
  });
  await page.waitForTimeout(5500);
  assert.equal(await page.locator('.toast-message').textContent(),'Image generation failed');
  assert.equal(await page.locator('#toast').isVisible(),true);
  await page.locator('.toast-dismiss').click();await page.waitForTimeout(400);
  assert.equal(await page.locator('.toast-message').textContent(),'Video saved to canvas');
  assert.equal(await page.locator('.toast-dismiss').count(),0);
  await page.waitForTimeout(4000);
  assert.equal(await page.locator('#toast').isVisible(),true);
  await page.waitForTimeout(1500);
  assert.equal(await page.locator('#toast').isVisible(),false);
  console.log('Toast position: above toolbar, wrapped narrow viewport, brand asset and explicit dismissal passed.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
