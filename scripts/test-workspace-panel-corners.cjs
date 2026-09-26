const { chromium }=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage();
    await page.route('**/js/app.js',r=>r.fulfill({body:''}));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    await page.evaluate(()=>{
      delete document.documentElement.dataset.startupPending;
      const panel=document.getElementById('board-panel').cloneNode(true);
      document.body.replaceChildren(panel);
      document.body.style.cssText='display:block;background:var(--bg-surface)';
      panel.classList.remove('is-canvas-library');
      panel.style.cssText='display:flex;position:fixed;left:40px;right:16px;top:32px;bottom:16px';
      document.getElementById('canvas-library-view').hidden=true;
      document.getElementById('board-workspace-body').hidden=false;
      document.getElementById('board-agent-panel').classList.add('is-hidden');
      document.getElementById('board-viewport').innerHTML='<img src="assets/canvas-folder-3d.png" style="width:160px;height:160px;position:absolute;top:70px;left:80px">';
    });
    fs.mkdirSync('test-artifacts/workspace-corners',{recursive:true});
    for(const width of [1280,640]) for(const theme of ['dark','light']) {
      await page.setViewportSize({width,height:800});
      await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.body.dataset.theme=theme;},theme);
      await page.waitForTimeout(300);
      const result=await page.evaluate(()=>{
        const panel=document.getElementById('board-panel'),style=getComputedStyle(panel);
        return {radius:parseFloat(style.borderTopLeftRadius),bottom:style.borderBottomLeftRadius,top:style.borderTopLeftRadius,clip:style.overflow,header:getComputedStyle(panel.querySelector('.panel-header')).backgroundColor,viewport:getComputedStyle(document.getElementById('board-viewport')).backgroundColor,body:getComputedStyle(document.body).backgroundColor};
      });
      assert.ok(result.radius>=20);assert.equal(result.top,result.bottom);assert.equal(result.clip,'hidden');assert.equal(result.header,result.viewport);assert.notEqual(result.header,result.body);
      await page.screenshot({path:`test-artifacts/workspace-corners/${theme}-${width}.png`});
    }
    console.log('Workspace corners: continuous header/canvas surface, clipped corners and light/dark narrow/wide layouts passed.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
