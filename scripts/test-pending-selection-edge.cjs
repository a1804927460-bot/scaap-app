const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try {
  const page=await browser.newPage();
  await page.route('**/js/app.js',r=>r.fulfill({body:''}));
  await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
  await page.evaluate(()=>{
   document.body.innerHTML='<canvas id="fixture"></canvas>';
   const layer=window.MesssBoardLeaferLayer;layer.destroy();
   layer.init({canvas:document.getElementById('fixture'),width:800,height:600,pixelRatio:1});
   window.pending={id:'pending',isAiPlaceholder:true,x:20,y:20,width:160,height:180};
   window.options={items:[pending],getBounds:i=>({x:i.x,y:i.y,w:i.width,h:i.height}),getSource:()=>'',getColor:()=> '#333333'};
  });
  fs.mkdirSync('test-artifacts/pending-selection',{recursive:true});
  for(const zoom of [0.5,1,2.61])for(const selected of [false,true,false]){
   await page.evaluate(({zoom,selected})=>{
    pending.selected=selected;MesssBoardLeaferLayer.setTransform({panX:0,panY:0,zoom});
    MesssBoardLeaferLayer.sync({...options,cacheKey:`${zoom}:${selected}`});
   },{zoom,selected});
   await page.waitForTimeout(100);
   const bright=await page.evaluate(()=>{
    const pixels=document.getElementById('fixture').getContext('2d').getImageData(0,0,800,600).data;
    let count=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]>180&&pixels[i+1]>180&&pixels[i+2]>180&&pixels[i+3]>100)count++;
    return count;
   });
   assert.equal(bright,0,`No baked-in white stroke at zoom ${zoom}, selected ${selected}`);
  }
  await page.screenshot({path:'test-artifacts/pending-selection/deselected.png'});
  console.log('Pending scene: no white stroke before, during or after selection at 50%, 100% and 261% zoom.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
