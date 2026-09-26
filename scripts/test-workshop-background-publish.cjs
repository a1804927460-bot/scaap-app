const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage();
    await page.route('**/js/app.js',r=>r.fulfill({body:''}));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    await page.evaluate(()=>{
      window.t=(en,zh)=>zh; window.notices=[];window.workshopToast=text=>notices.push(text);
      window.calls=[];window.messsAPI={workshop:{publish:(id,metadata)=>new Promise(resolve=>calls.push({id,metadata,resolve}))}};
      AppState.files=[{id:'photo',name:'Photo.png',ext:'.png'}];
      AppState.boardItems=[{fileId:'photo',selected:true}];
      openWorkshopPublish(); document.getElementById('workshop-publish-name').value='First title';
      document.getElementById('workshop-publish-description').value='Keep description';
      document.getElementById('workshop-publish-tags').value='one,two';
      window.task=publishWorkshop();void publishWorkshop();
    });
    await page.waitForFunction(()=>document.getElementById('workshop-publish-overlay').hidden);
    assert.equal(await page.evaluate(()=>calls.length),1);
    assert.equal(await page.evaluate(()=>WorkshopState.publishing),true);
    assert.ok(!(await page.evaluate(()=>notices.join(' '))).includes('已发布到'));
    await page.evaluate(()=>{calls[0].resolve({ok:false});});await page.evaluate(()=>task);
    assert.equal(await page.evaluate(()=>WorkshopState.posts.length),0,'Failure must not create a fake published post');
    await page.evaluate(()=>openWorkshopPublish());
    assert.equal(await page.locator('#workshop-publish-name').inputValue(),'First title');
    assert.equal(await page.locator('#workshop-publish-description').inputValue(),'Keep description');
    assert.equal(await page.locator('#workshop-publish-tags').inputValue(),'one、two');
    await page.evaluate(()=>{window.task=publishWorkshop();calls[1].resolve({ok:true,post:{id:'cloud-post',title:'First title'}});});
    await page.evaluate(()=>task);
    assert.equal(await page.evaluate(()=>WorkshopState.posts[0].id),'cloud-post');
    assert.equal(await page.evaluate(()=>WorkshopState.failedPublishDraft),null);
    assert.equal(await page.evaluate(()=>WorkshopState.publishing),false);
    assert.equal(await page.evaluate(()=>document.getElementById('workshop-publish-progress').hidden),true);
    console.log('PASS: immediate dialog dismissal, duplicate protection, truthful completion and failed draft recovery.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
