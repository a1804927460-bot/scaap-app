const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async()=>{
  const browser = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:900}});
    await page.route('**/js/app.js',route=>route.fulfill({body:''}));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    await page.evaluate(()=>{
      delete document.documentElement.dataset.startupPending;
      document.documentElement.dataset.theme='dark';
      AiAssistant.activeSessionId='reading-session';
      const panel=document.getElementById('ai-assistant-panel');panel.hidden=false;panel.style.display='flex';
      window.t=en=>en;
      document.getElementById('ai-assistant-home').hidden=true;
      const messages=document.getElementById('ai-assistant-messages');messages.hidden=false;
      for(let i=0;i<60;i++){
        const row=document.createElement('div');row.className='ai-assistant-message is-assistant';
        row.textContent=`Message ${i}: `+'A detailed response with enough text to wrap at different window widths. '.repeat(12);
        messages.append(row);
      }
      initSectionTabs();
    });
    await page.locator('[data-section="assistant"]').click();
    await page.waitForTimeout(450);
    const before=await page.evaluate(()=>{
      const messages=document.getElementById('ai-assistant-messages');messages.scrollTo({top:1700,behavior:'instant'});
      const row=Array.from(messages.children).find(row=>row.getBoundingClientRect().bottom>messages.getBoundingClientRect().top);
      window.readingAnchor=row;
      return {top:messages.scrollTop,offset:row.getBoundingClientRect().top-messages.getBoundingClientRect().top,height:messages.clientHeight,scroll:messages.scrollHeight,panel:document.getElementById('ai-assistant-panel').className};
    });
    assert.ok(before.top>1000,JSON.stringify(before));
    for(let i=0;i<3;i++){
      await page.locator('[data-section="messs"]').click();
      // A response finishing while the user is away must not replace the bookmark.
      await page.evaluate(()=>appendAssistantText('user','Background result'));
      await page.locator('[data-section="assistant"]').click();
      await page.waitForTimeout(450);
      const top=await page.locator('#ai-assistant-messages').evaluate(el=>el.scrollTop);
      assert.ok(Math.abs(top-before.top)<2,`Reading position changed: ${top}`);
    }
    await page.locator('[data-section="messs"]').click();
    await page.setViewportSize({width:1000,height:720});
    await page.locator('[data-section="assistant"]').click();
    await page.waitForTimeout(450);
    const offset=await page.evaluate(()=>readingAnchor.getBoundingClientRect().top-document.getElementById('ai-assistant-messages').getBoundingClientRect().top);
    assert.ok(Math.abs(offset-before.offset)<3,`Resize must retain the same reading anchor: ${offset} versus ${before.offset}`);
    fs.mkdirSync('test-artifacts/assistant-scroll',{recursive:true});
    await page.screenshot({path:'test-artifacts/assistant-scroll/returned.png'});
    await page.locator('[data-section="messs"]').click();
    await page.evaluate(()=>{
      AiAssistant.activeSessionId='different-session';
      const messages=document.getElementById('ai-assistant-messages');messages.replaceChildren();messages.scrollTop=0;
    });
    await page.locator('[data-section="assistant"]').click();
    assert.equal(await page.locator('#ai-assistant-messages').evaluate(el=>el.scrollTop),0);
    console.log('Reading position passed: real section tabs, repeated return, background completion, window resize and session isolation.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
