const {chromium}=require('playwright');const fs=require('fs'),path=require('path'),assert=require('assert/strict');const {pathToFileURL}=require('url');
(async()=>{const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});try {
 const page=await browser.newPage({viewport:{width:1100,height:850}});await page.route('**/js/app.js',r=>r.fulfill({body:''}));await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
 const result=await page.evaluate(async()=>{
  window.t=(en,zh)=>zh;AppState.language='zh';delete document.documentElement.dataset.startupPending;
  const receipts=[];
  window.messsAPI={estimateAgentCredits:async()=>({available:true,min:.1,max:.8}),chatWithAi:async()=>({ok:true,text:'已完成',creditsCharged:.14})};
  for(const surface of ['ai-assistant-messages','board-agent-messages']) {
   const list=document.createElement('div');list.className=surface;document.body.append(list);const pending=document.createElement('div');list.append(pending);
   const response=await chatWithAgentEstimate(pending,{prompt:'hello'});renderAgentMessageContent(pending,response.text);appendAgentCharge(pending,response);receipts.push(pending.querySelector('.agent-charge-receipt').textContent);
   const session={id:'test',canvasId:'canvas-test',messages:[{role:'assistant',content:response.text,creditsCharged:response.creditsCharged}]};
   const normalized=surface==='ai-assistant-messages'?normalizeAiChatSession(session):normalizeCanvasAgentSession(session,'canvas-test');
   const row=document.createElement('div');list.append(row);renderAgentMessageContent(row,normalized.messages[0].content);appendAgentCharge(row,normalized.messages[0]);receipts.push(row.querySelector('.agent-charge-receipt').textContent);
   appendAgentCharge(row,{creditsCharged:null});receipts.push(row.querySelector('.agent-charge-receipt')===null);
   pending.agentPreviewText='部分回复';pending.agentReceipt={creditsCharged:.05};const interrupted=preserveInterruptedAgentReply(pending);receipts.push(interrupted.creditsCharged);
   list.remove();
  }
  renderCanvasUsageDetails({canvas:{name:'画布账单'},cloudAvailable:true,totals:{creditsCharged:19.14,pendingCredits:13,generations:4},breakdown:{image:{creditsCharged:19,generations:1},chat:{creditsCharged:.14}},details:[
   {kind:'image',modelName:'Midjourney V8.2',status:'succeeded',creditsCharged:19,estimatedCredits:50,name:'四宫格',createdAt:'2026-09-09'},
   {kind:'chat',modelName:'GPT-5.6 Sol',status:'succeeded',creditsCharged:.14,createdAt:'2026-09-09'},
   {kind:'image',modelName:'Midjourney V8.2',status:'pending',creditsCharged:null,estimatedCredits:13,createdAt:'2026-09-09'},
   {kind:'image',status:'succeeded',creditsCharged:null,estimatedCredits:9,createdAt:'2026-09-09'}]});
  document.getElementById('canvas-usage-overlay').hidden=false;
  document.getElementById('canvas-usage-overlay').classList.add('is-visible');
  document.getElementById('canvas-usage-content').hidden=false;
  document.getElementById('canvas-usage-loading').hidden=true;
  return {receipts,rows:[...document.querySelectorAll('#canvas-usage-rows tr')].map(row=>row.lastElementChild.textContent),summary:document.getElementById('canvas-usage-summary').textContent};
 });
 assert.deepEqual(result.receipts,['已扣 0.14 积分','已扣 0.14 积分',true,.05,'已扣 0.14 积分','已扣 0.14 积分',true,.05]);assert.deepEqual(result.rows,['19','0.14','待结算','未记录']);assert.ok(result.summary.includes('19.14'));fs.mkdirSync('test-artifacts/billing',{recursive:true});await page.addStyleTag({content:'*,*::before,*::after{transition:none!important;animation:none!important}'});assert.equal(await page.locator('#canvas-usage-rows').isVisible(),true);await page.screenshot({path:'test-artifacts/billing/canvas-receipts.png'});console.log('Both Agent views: new/restored/partial/unknown receipts passed; canvas shows actual, fractional, pending and unknown charges.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
