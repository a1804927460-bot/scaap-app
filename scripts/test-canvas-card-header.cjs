const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try {
  const page=await browser.newPage();
  await page.route('**/js/app.js',r=>r.fulfill({body:''}));
  await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
  await page.evaluate(()=>{
   delete document.documentElement.dataset.startupPending;
   document.body.innerHTML='<div id="canvas-library-grid" style="display:flex;padding:24px;gap:16px"></div>';
   for(const pinned of [true,false]){
    const card=document.createElement('div');card.className='canvas-library-card';
    card.style.cssText='flex:none;width:220px';
    card.innerHTML='<div class="canvas-library-card-header"><div class="canvas-library-card-title"></div><span class="canvas-library-card-pin">P</span><button class="canvas-library-card-menu-trigger">...</button></div>';
    const title=card.querySelector('.canvas-library-card-title');title.textContent=title.title='两难总决赛+二泉录音室超长画布名称测试';
    card.querySelector('.canvas-library-card-pin').hidden=!pinned;
    document.getElementById('canvas-library-grid').append(card);
   }
   observeCanvasCardDensity(document.getElementById('canvas-library-grid'));
  });
  fs.mkdirSync('test-artifacts/card-header',{recursive:true});
  for(const width of [172,220,260])for(const theme of ['dark','light']){
   await page.evaluate(({width,theme})=>{document.documentElement.dataset.theme=theme;document.querySelectorAll('.canvas-library-card').forEach(el=>el.style.width=width+'px');},{width,theme});
   await page.waitForTimeout(100);
   assert.equal(await page.locator('.canvas-library-card-pin').first().isVisible(),false);
   for(const card of await page.locator('.canvas-library-card').all()){
    const title=card.locator('.canvas-library-card-title'), menu=card.locator('.canvas-library-card-menu-trigger'),pin=card.locator('.canvas-library-card-pin');
    const a=await title.boundingBox(),b=await menu.boundingBox(),c=await pin.boundingBox();
    assert.ok(a.x+a.width<=(c||b).x);assert.ok(a.width>50);assert.equal(Math.round(b.width),27);
    assert.equal(await title.evaluate(el=>getComputedStyle(el).textOverflow),'ellipsis');
    assert.ok(await title.getAttribute('title'));
   }
   await page.screenshot({path:`test-artifacts/card-header/${theme}-${width}.png`});
  }
  await page.evaluate(()=>document.querySelectorAll('.canvas-library-card').forEach(el=>el.style.width='700px'));
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.canvas-library-card-pin').first().isVisible(),true);
  assert.equal(await page.locator('.canvas-library-card-pin').last().isVisible(),false);
  await page.evaluate(()=>{
    const card=document.querySelector('.canvas-library-card');
    card.style.width='172px';card.querySelector('.canvas-library-card-title').textContent='短标题';
    const meta=document.createElement('div');meta.className='canvas-library-card-meta';
    meta.innerHTML='<span>Very long folder name</span><span>20 hours ago</span>';card.append(meta);
    observeCanvasCardDensity(document.getElementById('canvas-library-grid'));
  });
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.canvas-library-card-pin').first().isVisible(),true);
  assert.equal(await page.locator('.canvas-library-card-meta > span').first().isVisible(),false);
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.canvas-library-card-meta > span').first().isVisible(),false);
  await page.evaluate(()=>document.querySelector('.canvas-library-card').style.width='700px');
  await page.waitForTimeout(150);
  assert.equal(await page.locator('.canvas-library-card-meta > span').first().isVisible(),true);
  console.log('Canvas card headers: long titles, pinned/unpinned, three widths and both themes passed.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
