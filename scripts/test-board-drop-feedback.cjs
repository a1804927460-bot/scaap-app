const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const page=await browser.newPage();await page.route('**/js/app.js',r=>r.fulfill({body:''}));
  await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
  await page.evaluate(()=>{
   document.body.innerHTML='<div id="board-viewport" style="width:800px;height:600px"><div id="child"></div><div id="board-file-drop-indicator" hidden></div></div>';
   window.layoutReads=0;const viewport=document.getElementById('board-viewport');
   const original=viewport.getBoundingClientRect.bind(viewport);viewport.getBoundingClientRect=()=>{layoutReads++;return original();};
  });
  const source=fs.readFileSync('src/js/board-canvas.js','utf8');
  const start=source.indexOf("  const dropIndicator = document.getElementById('board-file-drop-indicator');");
  const end=source.indexOf("  viewport.addEventListener('contextmenu'",start);
  await page.evaluate(`void 0; {const viewport=document.getElementById('board-viewport');${source.slice(start,end)}}`);
  const drag=()=>page.evaluate(()=>{
   const viewport=document.getElementById('board-viewport');
   for(let i=0;i<100;i++)viewport.dispatchEvent(new DragEvent('dragover',{dataTransfer:new DataTransfer(),clientX:100+i,clientY:150,bubbles:true,cancelable:true}));
  });
  await drag();await page.waitForTimeout(50);assert.equal(await page.evaluate(()=>layoutReads),1);
  assert.equal(await page.locator('#board-file-drop-indicator').evaluate(el=>el.hidden),false);
  await page.evaluate(()=>{
   const v=document.getElementById('board-viewport');
   for(let i=0;i<5;i++)v.dispatchEvent(new DragEvent('dragenter',{dataTransfer:new DataTransfer()}));
   v.dispatchEvent(new DragEvent('dragleave',{relatedTarget:document.body}));
  });
  await page.waitForTimeout(30);assert.equal(await page.locator('#board-file-drop-indicator').evaluate(el=>el.hidden),true);
  for(const type of ['dragend','drop','blur','Escape']){
   await drag();await page.waitForTimeout(30);
   await page.evaluate(type=>{
    if(type==='blur')window.dispatchEvent(new Event('blur'));
    else if(type==='Escape')document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));
    else document.dispatchEvent(new DragEvent(type));
   },type);
   assert.equal(await page.locator('#board-file-drop-indicator').evaluate(el=>el.hidden),true);
  }
  await drag();await page.evaluate(()=>Board.disposeFileDrop());await page.waitForTimeout(30);
  assert.equal(await page.locator('#board-file-drop-indicator').evaluate(el=>el.hidden),true);
  console.log('Drop feedback passed: 100 events coalesced to one layout read, nested leave, drop/cancel/blur/disposal cleanup.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
