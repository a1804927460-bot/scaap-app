const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
 const page=await browser.newPage({viewport:{width:720,height:600}});
 await page.route('**/js/app.js',r=>r.fulfill({body:''}));
 await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
 await page.evaluate(()=>{
   delete document.documentElement.dataset.startupPending;
   document.body.innerHTML='<div id="ai-assistant-messages" style="padding:30px"></div>';
   window.showToast=()=>{};window.showFullscreenMedia=image=>{window.previewOpened=image.src;};
   const svg='<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#2575dd"/><text x="40" y="110" fill="white" font-size="30">Messs image</text><script>window.svgExecuted=true</script></svg>';
   window.messsAPI={previewGeneratedAiFile:async()=>({ok:true,dataUrl:'data:image/svg+xml;base64,'+btoa(svg)}),saveGeneratedAiFile:async()=>{window.downloaded=true;return {ok:true};}};
   const row=document.createElement('div');document.getElementById('ai-assistant-messages').append(row);
   appendAssistantOutputFiles(row,[{token:'work-test',name:'picture.svg',sizeBytes:1234}]);
 });
 await page.locator('.ai-output-image-preview').waitFor({state:'visible'});
 assert.ok(await page.locator('.ai-output-image-preview img').evaluate(image=>image.naturalWidth>0));
 assert.equal(await page.evaluate(()=>!!window.svgExecuted),false);
 await page.locator('.ai-output-image-preview').click();assert.match(await page.evaluate(()=>window.previewOpened),/^data:image/);
 await page.locator('.ai-assistant-output-file').click();assert.equal(await page.evaluate(()=>window.downloaded),true);
 fs.mkdirSync('test-artifacts/output-preview',{recursive:true});
 await page.screenshot({path:'test-artifacts/output-preview/image.png'});
 console.log('Image result: decoded thumbnail, inert SVG, separate preview and original download passed.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
