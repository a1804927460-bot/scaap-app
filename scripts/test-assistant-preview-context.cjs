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
   area.innerHTML='<button id="preview-fixture"><img alt="Generated image"></button>';
   const c=document.createElement('canvas');c.width=800;c.height=450;
   const ctx=c.getContext('2d');ctx.fillStyle='#2680d9';ctx.fillRect(0,0,800,450);
   const image=area.querySelector('img');image.src=c.toDataURL();
   document.getElementById('preview-fixture').onclick=()=>showFullscreenMedia(image);
  });
  fs.mkdirSync('test-artifacts/assistant-preview-context',{recursive:true});
  for(const width of [1200,640]) {
   await page.setViewportSize({width,height:800});
   await page.locator('#preview-fixture').click();
   await page.waitForTimeout(250);
   const state=await page.evaluate(()=>{
    const host=document.querySelector('.ai-assistant-main').getBoundingClientRect(),overlay=document.getElementById('fullscreen-overlay').getBoundingClientRect();
    return {tab:document.querySelector('.section-tab.is-active').dataset.section,dx:Math.abs(host.x-overlay.x),dy:Math.abs(host.y-overlay.y),dw:Math.abs(host.width-overlay.width),parent:document.getElementById('fullscreen-overlay').parentElement.className};
   });
   assert.equal(state.tab,'assistant');assert.ok(state.dx<1&&state.dy<1&&state.dw<1,JSON.stringify(state));
   assert.ok(state.parent.includes('ai-assistant-main'));
   await page.screenshot({path:`test-artifacts/assistant-preview-context/${width}.png`});
   await page.keyboard.press('Escape');await page.waitForTimeout(200);
   assert.equal(await page.locator('#fullscreen-overlay').isVisible(),false);
   assert.equal(await page.locator('#ai-assistant-panel').evaluate(el=>el.classList.contains('is-fullscreen')),true);
   assert.equal(await page.locator('.section-tab.is-active').getAttribute('data-section'),'assistant');
  }
  console.log('Assistant preview stays inside chat, preserves navigation and closes independently with Escape at desktop/compact widths.');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
