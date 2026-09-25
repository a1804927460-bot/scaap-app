const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const catalog=require('../config/provider-catalog.json');
(async()=>{
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1200,height:950}});
    await page.route('**/js/app.js',r=>r.fulfill({body:''}));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    await page.addStyleTag({content:'*, *::before, *::after {transition:none!important;animation:none!important}'});
    await page.evaluate(provider=>{
      delete document.documentElement.dataset.startupPending;
      document.body.replaceChildren();window.t=(en,zh)=>zh;AppState.language='zh';
      window.isBoardFullscreen=()=>false;window.markBoardUiLayer=()=>{};window.updateUiLanguage=()=>{};
      window.quotes=[];
      window.messsAPI={quoteMediaCredits:async r=>{quotes.push(r);return {totalCredits:String(r.size||r.resolution).toUpperCase()==='2K'?19:13};}};
      window.testPop=buildAiComposer({imageProviders:[provider],activeImageProviderId:'image-18'},'image');
      document.body.append(testPop);
      testPop.style.cssText='position:absolute;left:40px;top:620px;bottom:auto;right:auto;width:700px;transform:none;transition:none;animation:none';
    },catalog.providers.find(p=>p.id==='image-18'));
    assert.equal(await page.locator('.ai-composer-submit-wrap > .ai-options-toggle').count(),1);
    assert.equal(await page.locator('.ai-options-toggle-icon').count(),1);
    assert.equal(await page.locator('.ai-options-toggle-chevron').count(),1);
    assert.equal(await page.locator('.ai-savings-badge').innerText(),'省50%');
    assert.equal(await page.locator('.ai-savings-badge').evaluate((badge) => {
      const offer = badge.getBoundingClientRect();
      const submit = badge.parentElement.querySelector('.ai-composer-submit').getBoundingClientRect();
      return offer.bottom < submit.top;
    }), true);
    await page.locator('.ai-options-toggle').click();
    assert.equal(await page.locator('.ai-model-picker-trigger').innerText(),'Mess Jennie');
    assert.deepEqual(await page.locator('[data-option="size"] [data-value]').evaluateAll(es=>es.map(e=>e.dataset.value)),['1K','2K']);
    assert.equal(await page.locator('[data-generation-heading="count"]').innerText(),'组数（每组四宫格）');
    await page.locator('[data-option="size"] [data-value="2K"]').click();
    await page.waitForFunction(()=>quotes.at(-1)?.providerId==='image-18' && String(quotes.at(-1)?.size||quotes.at(-1)?.resolution).toUpperCase()==='2K');
    await page.evaluate(()=>testPop._applyGenerationPreset({kind:'image',providerId:'image-18',size:'1K',resolution:'1K',aspectRatio:'16:9'}));
    await page.waitForFunction(()=>String(quotes.at(-1)?.size||quotes.at(-1)?.resolution).toUpperCase()==='1K');
    assert.match(await page.locator('.ai-options-summary').innerText(),/^16:9 · 1K · ×1$/);
    fs.mkdirSync('test-artifacts/legnext82',{recursive:true});
    for(const width of [1200,480]) {
      await page.setViewportSize({width,height:950});
      await page.evaluate(width=>{testPop.style.width=Math.min(700,width-48)+'px';testPop.style.left='24px';},width);
      const fits=await page.locator('.ai-options-panel').evaluate(e=>e.scrollWidth<=e.clientWidth+1);
      assert.ok(fits,'Midjourney settings must not overflow horizontally');
      for (const theme of ['dark','light']) {
        await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.body.dataset.theme=theme;},theme);
        await page.screenshot({path:`test-artifacts/legnext82/composer-${width}-${theme}.png`});
      }
    }
    await page.setViewportSize({width:1200,height:950});
    await page.evaluate(()=>{testPop.style.width='700px';testPop.style.left='24px';document.documentElement.dataset.theme='dark';document.body.dataset.theme='dark';});
    await page.locator('.ai-options-toggle').click();
    assert.equal(await page.locator('.ai-options-panel').isHidden(),true);
    assert.equal(await page.locator('.ai-savings-badge').isVisible(),true);
    await page.screenshot({path:'test-artifacts/legnext82/composer-offer-dark.png'});
    console.log('Midjourney 8.2 composer: version label, two resolutions, grid count, quotes, restored preset and responsive themes passed.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
