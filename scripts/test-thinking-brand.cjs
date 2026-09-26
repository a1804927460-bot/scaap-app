const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:800,height:600}});
  await page.route('**/js/app.js',r=>r.fulfill({body:''}));
  await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
  await page.evaluate(()=>{
   delete document.documentElement.dataset.startupPending;
   document.body.innerHTML='<main style="display:flex;gap:30px;padding:24px"><section style="width:300px"><div class="ai-assistant-message is-pending is-chat-thinking"><div class="ai-assistant-message-body">思考中... 6 秒</div></div><div id="media" class="ai-assistant-message is-pending"><div class="ai-assistant-message-body">正在生成图片</div></div></section><section id="board-agent-panel" style="width:300px;flex:0 0 300px;padding:16px"><div class="board-agent-message is-pending">思考中... 6 秒</div></section></main>';
  });
  fs.mkdirSync('test-artifacts/thinking-brand',{recursive:true});
  for(const theme of ['light','dark']){
   await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.body.dataset.theme=theme;},theme);
   await page.waitForTimeout(250);
   for(const selector of ['.is-chat-thinking','.board-agent-message']){
    const style=await page.locator(selector).evaluate(el=>({content:getComputedStyle(el,'::before').content,image:getComputedStyle(el,'::before').backgroundImage,color:getComputedStyle(el,'::before').color}));
    assert.equal(style.content,'"SCAAP."');assert.match(style.image,/logo-mark\.png/);
    assert.equal(style.color,await page.locator(selector).evaluate(el=>getComputedStyle(el).getPropertyValue('--text-primary').trim().startsWith('#') ? getComputedStyle(document.body).color : getComputedStyle(el,'::before').color));
   }
   assert.equal(await page.locator('#media').evaluate(el=>getComputedStyle(el,'::before').content),'none');
   await page.screenshot({path:`test-artifacts/thinking-brand/${theme}.png`});
  }
  await page.locator('.board-agent-message').evaluate(el=>el.textContent='思考中... 7 秒');
  assert.equal(await page.locator('.board-agent-message').evaluate(el=>getComputedStyle(el,'::before').content),'"SCAAP."');
  await page.locator('.is-chat-thinking, .board-agent-message').evaluateAll(elements=>elements.forEach(el=>el.classList.remove('is-pending')));
  assert.equal(await page.locator('.board-agent-message').evaluate(el=>getComputedStyle(el,'::before').content),'none');
  console.log('Thinking brand: both chat surfaces, themes, timer updates, completion and media exclusion passed.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
