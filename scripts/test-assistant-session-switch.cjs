const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
  const page=await browser.newPage();
  await page.route('**/js/app.js',r=>r.fulfill({body:''}));
  await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
  await page.evaluate(()=>{
   window.t=en=>en;
   window.activeCanvasId=()=> 'canvas-a';
   window.selectedAssistantProvider=()=>({name:'Model A',providerId:'p',model:'a'});
   window.renderAssistantAttachments=()=>{};
   window.renderAiChatHistory=()=>{};
   window.persistAiChatHistory=()=>{};
   window.showToast=()=>{};
   window.appendAssistantMessageAttachments=(row,files)=>{row.dataset.attachments=JSON.stringify(files);};
   window.appendAssistantOutputFiles=(row,files)=>{row.dataset.outputs=JSON.stringify(files||[]);};
   window.MesssComposerActions={session:'permission-a',resetPermissions(){this.session='permission-'+crypto.randomUUID();}};
   window.calls=[];window.resolvers=[];window.listeners=new Set();
   window.messsAPI={
    onAiChatDelta(callback){listeners.add(callback);return()=>listeners.delete(callback);},
    chatWithAi:request=>new Promise(resolve=>{calls.push(structuredClone(request));resolvers.push(resolve);})
   };
   AiAssistant.sessions=[{id:'a',title:'A',messages:[]},{id:'b',title:'B',messages:[{role:'user',content:'B history'}]}];
   AiAssistant.activeSessionId='a';
   document.getElementById('ai-assistant-messages').replaceChildren();
   document.getElementById('ai-assistant-input').value='A task';submitAssistantMessage();
   document.getElementById('ai-assistant-input').value='A draft';
   AiAssistant.attachments=[{id:'a-file',name:'A.png'}];
   loadAiChatSession('b');
  });
  assert.equal(await page.evaluate(()=>AiAssistant.activeSessionId),'b');
  assert.equal(await page.locator('#ai-assistant-messages').textContent(),'B history');
  assert.deepEqual(await page.evaluate(()=>AiAssistant.attachments),[]);
  await page.evaluate(()=>{
   document.getElementById('ai-assistant-input').value='B draft';
   AiAssistant.attachments=[{id:'b-file',name:'B.png'}];
   listeners.forEach(fn=>fn({requestId:calls[0].workRequestId,text:'A streaming'}));
  });
  assert.equal(await page.locator('#ai-assistant-messages').textContent(),'B history');
  await page.evaluate(()=>loadAiChatSession('a'));
  assert.ok((await page.locator('#ai-assistant-messages').textContent()).includes('A streaming'));
  assert.equal(await page.locator('#ai-assistant-input').inputValue(),'A draft');
  assert.equal(await page.evaluate(()=>AiAssistant.attachments[0].id),'a-file');
  await page.evaluate(()=>{loadAiChatSession('b');resolvers.shift()({ok:true,text:'A final',files:[{token:'output-a',name:'A.obj'}]});});
  await page.waitForFunction(()=>!AiAssistant.queueRunning);
  assert.equal(await page.locator('#ai-assistant-messages').textContent(),'B history');
  assert.equal(await page.evaluate(()=>AiAssistant.sessions.find(s=>s.id==='a').unread),true);
  assert.equal(await page.locator('#ai-assistant-input').inputValue(),'B draft');
  assert.equal(await page.evaluate(()=>AiAssistant.attachments[0].id),'b-file');
  await page.evaluate(()=>loadAiChatSession('a'));
  assert.ok((await page.locator('#ai-assistant-messages').textContent()).includes('A final'));
  assert.ok((await page.locator('#ai-assistant-messages .is-assistant').last().getAttribute('data-outputs')).includes('output-a'));
  assert.equal(await page.evaluate(()=>listeners.size),0);
  assert.equal(await page.evaluate(()=>calls[0].permissionSession),'permission-a');
  await page.evaluate(()=>{
   document.getElementById('ai-assistant-input').value='failure in A';submitAssistantMessage();
   loadAiChatSession('b');resolvers.shift()({ok:false,message:'A failure'});
  });
  await page.waitForFunction(()=>!AiAssistant.queueRunning);
  assert.equal(await page.locator('#ai-assistant-messages').textContent(),'B history');
  await page.evaluate(()=>loadAiChatSession('a'));
  assert.ok((await page.locator('#ai-assistant-messages').textContent()).includes('A failure'));
  console.log('Session switching passed: detached SSE, result/files/error ownership, drafts, attachments, permissions and unread state.');
 } finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
