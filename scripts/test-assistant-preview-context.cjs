const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
 const browser = await chromium.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true });
 try {
  const page = await browser.newPage({viewport:{width:1200,height:800}});
  await page.route('**/js/app.js',r=>r.fulfill({body:''}));
  await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
  await page.evaluate(()=>{
   delete document.documentElement.dataset.startupPending;
   window.messsAPI={onAchievementsUpdated(){}};
   setAssistantFullscreen(true,{syncNavigation:true});initStatsDetail();initFullscreenOverlay();
   const area=document.querySelector('.ai-assistant-messages');
   area.hidden=false;document.querySelector('.ai-assistant-home').hidden=true;
   document.getElementById('ai-assistant-panel').hidden=false;
   area.innerHTML='<button id="preview-fixture"><img alt="Generated image" style="width:100px;height:80px;object-fit:contain"></button>';
   const c=document.createElement('canvas');c.width=800;c.height=450;
   const ctx=c.getContext('2d');ctx.fillStyle='#2680d9';ctx.fillRect(0,0,800,450);
   const image=area.querySelector('img');image.src=c.toDataURL();
   document.getElementById('preview-fixture').onclick=()=>showFullscreenMedia(image);
  });
  fs.mkdirSync('test-artifacts/assistant-preview-context',{recursive:true});
  for(const [width,height] of [[1560,1020],[1200,800],[640,600],[390,600]]) {
   await page.setViewportSize({width,height});
   for (const [kind,w,h] of [['square',2400,2400],['portrait',1600,4800],['landscape',4800,1200],['small',80,60],['viewbox',900,1500]]) {
   await page.evaluate(async ({kind,w,h})=>{
    const image=document.querySelector('#preview-fixture img');
    const dimensions=kind==='viewbox'?'':`width="${w}" height="${h}"`;
    image.src='data:image/svg+xml;base64,'+btoa(`<svg xmlns="http://www.w3.org/2000/svg" ${dimensions} viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#2680d9"/><rect x="4" y="4" width="${w-8}" height="${h-8}" fill="none" stroke="white" stroke-width="8"/></svg>`);
    await image.decode();
   },{kind,w,h});
   await page.locator('#preview-fixture').click();
   await page.evaluate(async()=>{
    await Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a=>a.finished.catch(()=>{})));
   });
   const state=await page.evaluate(()=>{
    const host=document.querySelector('.ai-assistant-main').getBoundingClientRect(),overlay=document.getElementById('fullscreen-overlay').getBoundingClientRect();
    return {tab:document.querySelector('.section-tab.is-active').dataset.section,dx:Math.abs(host.x-overlay.x),dy:Math.abs(host.y-overlay.y),dw:Math.abs(host.width-overlay.width),parent:document.getElementById('fullscreen-overlay').parentElement.className};
   });
   assert.equal(state.tab,'assistant');assert.ok(state.dx<1&&state.dy<1&&state.dw<1,JSON.stringify(state));
   assert.ok(state.parent.includes('ai-assistant-main'));
   const fit=await page.evaluate(()=>{
    const stage=document.getElementById('fullscreen-stage');
    const s=stage.getBoundingClientRect(),css=getComputedStyle(stage);
    const img=stage.querySelector('img'),r=img.getBoundingClientRect();
    const left=s.left+parseFloat(css.paddingLeft),right=s.right-parseFloat(css.paddingRight);
    const top=s.top+parseFloat(css.paddingTop),bottom=s.bottom-parseFloat(css.paddingBottom);
    const close=document.getElementById('fullscreen-close').getBoundingClientRect();
    return {inside:r.left>=left-1&&r.right<=right+1&&r.top>=top-1&&r.bottom<=bottom+1,
     centered:Math.abs((r.left+r.right)-(left+right))<2&&Math.abs((r.top+r.bottom)-(top+bottom))<2,
     noScroll:stage.scrollHeight<=stage.clientHeight+1&&stage.scrollWidth<=stage.clientWidth+1,
     closeClear:r.top>=close.bottom, width:r.width,height:r.height,ratio:img.naturalWidth/img.naturalHeight};
   });
   assert.ok(fit.inside&&fit.centered&&fit.noScroll&&fit.closeClear,JSON.stringify({width,height,kind,fit}));
   assert.ok(Math.abs(fit.width/fit.height-fit.ratio)<.02,'Preserve intrinsic aspect ratio');
   if(kind==='small') assert.ok(fit.width<=80&&fit.height<=60,'Do not enlarge small images');
   if(kind==='portrait') await page.screenshot({path:`test-artifacts/assistant-preview-context/${width}.png`});
   await page.keyboard.press('Escape');await page.waitForTimeout(200);
   assert.equal(await page.locator('#fullscreen-overlay').isVisible(),false);
   assert.equal(await page.locator('#ai-assistant-panel').evaluate(el=>el.classList.contains('is-fullscreen')),true);
   assert.equal(await page.locator('.section-tab.is-active').getAttribute('data-section'),'assistant');
   }
  }
  console.log('Assistant preview stays inside chat, preserves navigation and closes independently with Escape at desktop/compact widths.');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
