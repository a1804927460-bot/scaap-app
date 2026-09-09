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
      window.messsAPI={quoteMediaCredits:async r=>{quotes.push(r);return {totalCredits:r.generateAudio?90:60};}};
      window.testPop=buildAiComposer({videoProviders:[provider],activeVideoProviderId:'video-14'},'video');
      document.body.append(testPop);
      testPop.style.cssText='position:absolute;left:40px;top:620px;bottom:auto;right:auto;width:700px;transform:none;transition:none;animation:none';
    },catalog.providers.find(p=>p.id==='video-14'));
    await page.locator('.ai-options-toggle').click();
    assert.equal(await page.locator('.ai-kling-variants button').count(),5);
    assert.equal(await page.locator('.ai-model-picker-trigger').innerText(),'Kling');
    await page.getByRole('button',{name:'V3 Turbo',exact:true}).click();
    assert.equal(await page.locator('.ai-kling-sound').isDisabled(),true);
    assert.deepEqual(await page.locator('[data-option="size"] [data-value]').evaluateAll(es=>es.map(e=>e.dataset.value)),['720P','1080P']);
    await page.getByRole('button',{name:'O3 4K',exact:true}).click();
    assert.deepEqual(await page.locator('[data-option="size"] [data-value]').evaluateAll(es=>es.map(e=>e.dataset.value)),['4K']);
    await page.locator('.ai-kling-sound').check();
    await page.waitForFunction(()=>quotes.at(-1)?.serviceTier==='o3-4k'&&quotes.at(-1)?.generateAudio===true&&quotes.at(-1)?.resolution==='4K');
    await page.evaluate(()=>testPop._applyGenerationPreset({kind:'video',providerId:'video-14',serviceTier:'pro',generateAudio:true,resolution:'1440P-SR',duration:10,videoMode:'first-frame',aspectRatio:'adaptive'}));
    assert.equal(await page.locator('.ai-kling-variants .is-active').innerText(),'V3 Pro');
    assert.equal(await page.locator('.ai-kling-sound').isChecked(),true);
    await page.waitForFunction(()=>quotes.at(-1)?.serviceTier==='pro'&&quotes.at(-1)?.duration===10);
    fs.mkdirSync('test-artifacts/kling',{recursive:true});
    for(const width of [1200,480]) {
      await page.setViewportSize({width,height:950});
      await page.evaluate(width=>{testPop.style.width=Math.min(700,width-48)+'px';testPop.style.left='24px';},width);
      const fits=await page.locator('.ai-options-panel').evaluate(e=>e.scrollWidth<=e.clientWidth+1);
      assert.ok(fits,'Kling settings must not overflow horizontally');
      for (const theme of ['dark','light']) {
        await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.body.dataset.theme=theme;},theme);
        await page.screenshot({path:`test-artifacts/kling/composer-${width}-${theme}.png`});
      }
    }
    console.log('Kling composer: one entry, five variants, constraints, audio quote, restored preset and responsive widths passed.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
