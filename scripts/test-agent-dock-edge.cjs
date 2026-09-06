const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try {
  const page=await browser.newPage();
  await page.route('**/js/app.js',r=>r.fulfill({body:''}));
  await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
  await page.evaluate(()=>{
   delete document.documentElement.dataset.startupPending;
   const body=document.getElementById('board-workspace-body');
   document.body.replaceChildren(body);
   body.hidden=false;body.style.cssText='position:fixed;inset:0;display:flex';
   document.getElementById('board-agent-panel').classList.remove('is-hidden');
   document.querySelector('.board-agent-messages').innerHTML='<div class="board-agent-message">构图与材质建议：保留主体轮廓，使用柔和侧光。</div><div class="board-agent-message is-user">根据参考图继续调整</div>';
  });
  fs.mkdirSync('test-artifacts/agent-dock-edge',{recursive:true});
  for(const width of [1200,640])for(const theme of ['light','dark']){
   await page.setViewportSize({width,height:800});
   await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.body.dataset.theme=theme;},theme);
   for(const agentWidth of [280,420]){
    await page.evaluate(w=>document.getElementById('board-workspace-body').style.setProperty('--agent-w',w+'px'),agentWidth);
    await page.waitForTimeout(300);
    const result=await page.evaluate(()=>{
     const panel=document.getElementById('board-agent-panel'),handle=document.getElementById('resize-handle-board-agent');
     const p=panel.getBoundingClientRect(),h=handle.getBoundingClientRect(),s=getComputedStyle(panel),line=getComputedStyle(handle,'::before');
     return {left:p.left,right:p.right,top:p.top,bottom:p.bottom,radius:s.borderRadius,margin:s.margin,line:h.left+parseFloat(line.left),formRadius:getComputedStyle(panel.querySelector('.board-agent-form')).borderRadius};
    });
    assert.equal(result.radius,'0px');assert.equal(result.margin,'0px');
    assert.ok(Math.abs(result.line-result.left)<=1);assert.equal(result.right,width);
    assert.equal(result.top,0);assert.equal(result.bottom,800);assert.notEqual(result.formRadius,'0px');
   }
   await page.screenshot({path:`test-artifacts/agent-dock-edge/${theme}-${width}.png`});
   if(theme==='light') {
    const colors=await page.evaluate(()=>{
     const color=selector=>getComputedStyle(document.querySelector(selector)).backgroundColor;
     return {canvas:color('#board-viewport'),agent:color('#board-agent-panel'),message:color('.board-agent-message'),user:color('.board-agent-message.is-user'),form:color('.board-agent-form')};
    });
    assert.notEqual(colors.canvas,colors.agent);assert.notEqual(colors.message,colors.agent);
    assert.notEqual(colors.message,colors.user);assert.notEqual(colors.form,colors.agent);
   }
  }
  await page.evaluate(()=>document.getElementById('board-agent-panel').classList.add('is-hidden'));
  assert.equal(await page.locator('#resize-handle-board-agent').isVisible(),false);
  console.log('Agent dock passed: flush edges, divider alignment, retained composer corners, both themes, widths and hidden state.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
