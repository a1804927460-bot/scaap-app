const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
 const browser = await chromium.launch({channel:'chrome',headless:true});
 try {
  const page = await browser.newPage({viewport:{width:800,height:700}});
  await page.route('**/js/app.js',r=>r.fulfill({body:''}));
  await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
  const source = '### 整合版提示词\n\n```text\n高清画面，柔和光线。\nC# / #123456 / 3 * 4\n```\n\n**保留正文**，以及 `x = a * b`。\n\n- 第一项\n- 第二项\n\n<script>window.bad=true</script>\n\n[链接](javascript:alert(1))';
  await page.evaluate(source=>{
   delete document.documentElement.dataset.startupPending;
   document.body.replaceChildren();
   const row=document.createElement('div');row.id='result';row.className='board-agent-message is-assistant';row.style.cssText='max-width:480px;margin:40px;padding:20px';document.body.append(row);
   renderAgentMessageContent(row,source);
  },source);
  assert.equal(await page.locator('#result h4').textContent(),'整合版提示词');
  assert.equal(await page.locator('#result strong').textContent(),'保留正文');
  assert.equal(await page.locator('#result li').count(),2);
  const text=await page.locator('#result').textContent();
  assert.ok(!text.includes('```')&&!text.includes('###')&&!text.includes('**'));
  assert.ok(text.includes('C# / #123456 / 3 * 4')&&text.includes('x = a * b'));
  assert.equal(await page.locator('#result script, #result a, #result img').count(),0);
  assert.equal(await page.evaluate(()=>window.bad),undefined);
  await page.evaluate(() => {
    const home=document.createElement('div');home.id='ai-assistant-home';document.body.append(home);
    const messages=document.createElement('div');messages.id='ai-assistant-messages';document.body.append(messages);
    const row=appendAssistantText('assistant','### Model\n\n**Ready**\n\n[File: phone.obj]');
    appendAssistantOutputFiles(row,[{name:'phone.obj',sizeBytes:120,token:'test'}]);
  });
  assert.equal(await page.locator('#ai-assistant-messages h4').textContent(),'Model');
  assert.equal(await page.locator('#ai-assistant-messages strong').textContent(),'Ready');
  assert.ok(!(await page.locator('#ai-assistant-messages .ai-assistant-message-body').textContent()).includes('[File:'));
  assert.equal(await page.locator('#ai-assistant-messages .ai-assistant-output-file').count(),1);
  const restored = await page.evaluate(() => {
    const session=normalizeCanvasAgentSession({id:'parity-test',messages:[{role:'assistant',content:'### Model\n\n**Ready**\n\n[File: phone.obj]',generatedFiles:[{token:'test',name:'phone.obj',sizeBytes:120}]}]});
    const message=session.messages[0];
    const row=document.createElement('div');row.id='canvas-parity';row.className='board-agent-message';document.body.append(row);
    renderAgentMessageContent(row,message.content);appendAssistantOutputFiles(row,message.generatedFiles);
    return message.generatedFiles;
  });
  assert.equal(restored[0].name,'phone.obj');
  assert.equal(await page.locator('#canvas-parity h4').textContent(),'Model');
  assert.equal(await page.locator('#canvas-parity .ai-assistant-output-file').count(),1);
  assert.ok(!(await page.locator('#canvas-parity').textContent()).includes('[File:'));
  const question = JSON.stringify({questionId:'meal-scene-details',title:'提问',questions:[{id:'characters',label:'吃饭场景中保留哪些角色？',type:'single',options:[{id:'five',label:'全部保留'}]}]});
  await page.evaluate(question => {
    const row = document.createElement('div'); row.id = 'private-protocol'; document.body.append(row);
    renderAgentMessageContent(row, `<think>internal routing</think>\n\n\`\`\`messs-question\n${question}`);
  }, question);
  assert.equal(await page.locator('#private-protocol .agent-question-card').count(), 1);
  const protocolText = await page.locator('#private-protocol').textContent();
  assert.ok(!protocolText.includes('messs-question') && !protocolText.includes('questionId') && !protocolText.includes('internal routing'));
  await page.evaluate(() => renderAgentMessageContent(document.getElementById('private-protocol'), '```messs-question\n{"questionId":'));
  assert.ok(!(await page.locator('#private-protocol').textContent()).includes('messs-question'));
  assert.equal(await page.evaluate(() => agentVisibleUserText('提问 clarify-generation-request 的回答：\nQ: 内容？\nA: 保留')), '提问的回答：\nQ: 内容？\nA: 保留');
  await page.evaluate(() => renderAgentMessageContent(document.getElementById('private-protocol'), '内部工具 clarify-generation-request 已完成。'));
  assert.ok(!(await page.locator('#private-protocol').textContent()).includes('clarify-generation-request'));
  fs.mkdirSync('test-artifacts/agent-format',{recursive:true});
  for(const theme of ['dark','light']){
   await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.waitForTimeout(350);
   await page.screenshot({path:`test-artifacts/agent-format/${theme}.png`});
  }
  await page.evaluate(()=>renderAgentMessageContent(document.getElementById('result'),'```text\n尚未闭合的内容'));
  assert.equal(await page.locator('#result pre').textContent(),'尚未闭合的内容');
  console.log('Agent formatting: headings/fences/bold/lists, normal punctuation/code preserved, unclosed fence, HTML and URL safety passed.');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
