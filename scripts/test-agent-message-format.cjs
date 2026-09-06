const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
 const browser = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
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
