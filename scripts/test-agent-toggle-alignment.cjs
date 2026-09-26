const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage();
  await page.route('**/js/app.js',r=>r.fulfill({body:''}));
  await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
  await page.evaluate(()=>{
   delete document.documentElement.dataset.startupPending;
   const panel=document.getElementById('board-panel');
   document.body.replaceChildren(panel);panel.classList.remove('is-canvas-library');
   panel.style.cssText='display:flex;position:fixed;inset:30px 10px';
   document.getElementById('canvas-library-view').hidden=true;
  });
  fs.mkdirSync('test-artifacts/agent-toggle',{recursive:true});
  for(const detached of [false,true])for(const width of [640,1280])for(const theme of ['dark','light']){
   await page.setViewportSize({width,height:700});
   await page.evaluate(({detached,theme})=>{document.body.classList.toggle('is-detached-canvas-window',detached);document.documentElement.dataset.theme=theme;document.body.dataset.theme=theme;},{detached,theme});
   await page.waitForTimeout(200);
   const geometry=await page.locator('#board-agent-toggle').evaluate(el=>{
    const b=el.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(el);const r=range.getBoundingClientRect();
    return {dx:Math.abs((b.left+b.right-r.left-r.right)/2),dy:Math.abs((b.top+b.bottom-r.top-r.bottom)/2),height:b.height,align:getComputedStyle(el).alignItems};
   });
   assert.equal(geometry.align,'center');assert.ok(geometry.dx<1);assert.ok(geometry.dy<2);assert.equal(geometry.height,28);
   await page.screenshot({path:`test-artifacts/agent-toggle/${detached?'detached':'main'}-${theme}-${width}.png`});
  }
  console.log('Agent label centered: detached/main windows, compact/wide layouts, light/dark themes.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
