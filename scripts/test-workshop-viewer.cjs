const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {pathToFileURL}=require('node:url');const path=require('node:path');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
const page=await browser.newPage({viewport:{width:1280,height:800}});
await page.route('**/js/app.js',r=>r.fulfill({body:''}));
await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
await page.evaluate(()=>{
 delete document.documentElement.dataset.startupPending;
 window.t=(en,zh)=>zh;document.body.append(document.getElementById('workshop-detail-overlay'));
 const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const ctx=canvas.getContext('2d');
 const gradient=ctx.createLinearGradient(0,0,0,720);gradient.addColorStop(0,'#112340');gradient.addColorStop(.6,'#e1a88a');gradient.addColorStop(1,'#152b38');ctx.fillStyle=gradient;ctx.fillRect(0,0,1280,720);
 ctx.fillStyle='#f8d4b3';ctx.beginPath();ctx.arc(850,280,70,0,Math.PI*2);ctx.fill();
 for(let i=0;i<4;i++){ctx.fillStyle=['#657080','#465c6a','#2b424f','#142b35'][i];ctx.beginPath();ctx.moveTo(0,460+i*55);for(let x=0;x<=1280;x+=20)ctx.lineTo(x,460+i*55+Math.sin(x/170+i)*70);ctx.lineTo(1280,720);ctx.lineTo(0,720);ctx.fill();}
 window.testImage=canvas.toDataURL();
 window.post={id:'test',kind:'image',title:'山海之间',description:'光影与空间',tags:['空间'],mediaUrl:testImage,createdAt:new Date().toISOString()};
 renderWorkshopDetail(post);setWorkshopOverlay('workshop-detail-overlay',true);
});
await page.waitForTimeout(300);
assert.equal(await page.locator('.workshop-detail-dialog').evaluate(el=>getComputedStyle(el).borderTopWidth),'0px');
assert.equal(await page.locator('.workshop-card-media.is-detail').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(0, 0, 0)');
await page.mouse.move(300,300);await page.mouse.down();await page.mouse.move(440,350);
assert.ok(await page.locator('.is-detail > img').evaluate(el=>el.style.transform.includes('rotateY')));
await page.mouse.up();assert.equal(await page.locator('.is-detail > img').evaluate(el=>el.style.transform),'');
await page.getByRole('button',{name:'全屏',exact:true}).click();await page.waitForFunction(()=>Boolean(document.fullscreenElement));
await page.getByRole('button',{name:'退出全屏',exact:true}).click();await page.waitForFunction(()=>!document.fullscreenElement);
await page.screenshot({path:'test-artifacts/workshop-viewer.png'});
await page.evaluate(()=>{
 const frame=document.querySelector('.workshop-card-media.is-detail');frame.replaceChildren();
 const video=document.createElement('video');video.muted=true;frame.append(video);workshopSetupViewer(frame,video,true);
 const canvas=document.createElement('canvas');canvas.width=100;canvas.height=100;video.srcObject=canvas.captureStream(10);
});
await page.getByRole('button',{name:'播放',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.is-detail video').paused);
await page.getByRole('button',{name:'开启声音',exact:true}).click();assert.equal(await page.locator('.is-detail video').evaluate(el=>el.muted),false);
await page.evaluate(()=>{window.testVideo=document.querySelector('.is-detail video');closeWorkshopDetail();});
assert.equal(await page.evaluate(()=>testVideo.paused),true);
await page.setViewportSize({width:390,height:844});
await page.evaluate(()=>{renderWorkshopDetail(post);setWorkshopOverlay('workshop-detail-overlay',true);});
assert.ok(await page.locator('.workshop-viewer-controls').evaluate(el=>el.getBoundingClientRect().right<=innerWidth));
console.log('PASS: black borderless viewer, drag/reset, real fullscreen enter/exit, playback/mute, close cleanup, narrow controls');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
