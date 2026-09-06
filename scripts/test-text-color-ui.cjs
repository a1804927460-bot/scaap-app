const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try {
  const page=await browser.newPage();
  await page.route('**/js/app.js',r=>r.fulfill({body:''}));
  await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
  await page.evaluate(()=>{
   delete document.documentElement.dataset.startupPending;
   const toolbar=document.getElementById('text-tool-panel');document.body.replaceChildren(toolbar);toolbar.hidden=false;
   toolbar.style.animation='none';
   document.getElementById('text-color-input').addEventListener('input',e=>window.chosen=e.target.value);
  });
  fs.mkdirSync('test-artifacts/text-color',{recursive:true});
  for(const width of [1100,390])for(const theme of ['dark','light']) {
   await page.setViewportSize({width,height:700});
   await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.body.dataset.theme=theme;document.getElementById('text-color-popover')?.remove();openTextColorPopover();},theme);
   const pop=page.locator('#text-color-popover'),box=await pop.boundingBox();
   assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=width);
   await pop.getByRole('button',{name:'#ef6464',exact:true}).click();
   assert.equal(await page.evaluate(()=>chosen),'#ef6464');
   await pop.getByRole('textbox',{name:'HEX'}).fill('#0057ff');await pop.getByRole('textbox',{name:'HEX'}).blur();
   assert.equal(await page.evaluate(()=>chosen),'#0057ff');
   await page.screenshot({path:`test-artifacts/text-color/${theme}-${width}.png`});
   await pop.getByRole('textbox',{name:'HEX'}).focus();await page.keyboard.press('Escape');
   assert.equal(await pop.count(),0);
  }
  console.log('Text color: theme popover, palette/HEX, viewport bounds, Escape passed.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
