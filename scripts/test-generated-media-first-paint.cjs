const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/js/app.js', r => r.fulfill({body:''}));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    await page.evaluate(() => {
      document.body.innerHTML = '<canvas id="fixture"></canvas>';
      const layer = window.MesssBoardLeaferLayer;
      layer.destroy();
      layer.init({ canvas: document.getElementById('fixture'), width: 400, height: 200, pixelRatio: 1 });
      const poster = document.createElement('canvas'); poster.width = 32; poster.height = 32;
      const ctx = poster.getContext('2d'); ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 32, 32);
      window.fixtureSource = poster.toDataURL();
      window.fixtureItems = [{id:'image-result',isAiPlaceholder:true,x:10,y:10,width:100,height:100},
        {id:'video-result',isAiPlaceholder:true,x:150,y:10,width:100,height:100}];
      window.fixtureSync = key => layer.sync({ items: fixtureItems, cacheKey:key,
        getBounds:item=>({x:item.x,y:item.y,w:item.width,h:item.height}),
        getFile:item=>item.fileId ? {kind:item.fileId, ext:item.fileId==='video'?'.mp4':'.png'} : null,
        getSource:file=>file?fixtureSource:'', getColor:()=> '#444444' });
      fixtureSync('pending');
      fixtureItems = fixtureItems.map((item,index)=>{const next={...item,fileId:index?'video':'image'};delete next.isAiPlaceholder;return next;});
      fixtureSync('complete');
    });
    // No new request, selection, pan or second sync is allowed to trigger paint.
    await page.waitForFunction(() => {
      const ctx = document.getElementById('fixture').getContext('2d');
      return [30,170].every(x=>{const p=ctx.getImageData(x,30,1,1).data;return p[0]>220&&p[1]<40&&p[2]<40&&p[3]>220;});
    }, null, {timeout:5000});
    fs.mkdirSync('test-artifacts/generated-first-paint', {recursive:true});
    await page.screenshot({path:'test-artifacts/generated-first-paint/result.png'});
    assert.equal(await page.evaluate(()=>MesssBoardLeaferLayer.itemCount),2);
    await page.evaluate(() => {
      AppState.allBoardItems = [{id:'pending',isAiPlaceholder:true,canvasId:'canvas-1',x:0,y:0,width:100,height:100}];
      AppState.boardItems = AppState.allBoardItems;
      window.activeCanvasId = () => 'canvas-1';
      window.invalidateBoardPreview = () => {};
      window.setActiveBoardPartition = () => {};
      window.renderCanvasLibrary = () => {};
      window.canvasWorkspaceTouch = () => {};
      window.canvasWorkspaceSave = async () => {};
      window.paintedResult = false;
      window.renderBoard = () => { window.paintedResult = AppState.boardItems.some(item=>item.fileId==='saved-file'); };
      window.messsAPI = {upsertBoardItems: () => new Promise(resolve => {window.finishWrite=resolve;})};
      window.deliveryPromise = replaceAiPlaceholders(AppState.boardItems, [{id:'saved-file',sourceWidth:100,sourceHeight:100}], {canvasId:'canvas-1',aspectRatio:'1:1'});
    });
    assert.equal(await page.evaluate(()=>paintedResult),true, 'Durably saved media must paint before reconciliation IPC resolves.');
    await page.evaluate(async()=>{
      AppState.allBoardItems.push({id:'added-while-saving',canvasId:'canvas-1'});
      finishWrite(); await deliveryPromise;
    });
    assert.equal(await page.evaluate(()=>AppState.allBoardItems.some(item=>item.id==='added-while-saving')),true);
    const recovered = await page.evaluate(async () => {
      const durable = { id: 'durable-result', fileId: 'recovered-video', canvasId: 'other-canvas', x: 120, y: 230, width: 300, height: 170 };
      AppState.allBoardItems = [{ ...durable, x: 450 }];
      AppState.boardItems = [];
      window.boardViewportCenterCoords = () => ({ x: 0, y: 0 });
      window.messsAPI.upsertBoardItems = async () => {};
      window.partitionChanges = 0;
      window.setActiveBoardPartition = () => { window.partitionChanges++; };
      for (let i = 0; i < 5; i++) {
        await replaceAiPlaceholders([], [{ id: 'recovered-video' }], { canvasId: 'other-canvas', aspectRatio: '16:9' }, [durable]);
      }
      return { items: AppState.allBoardItems, visible: AppState.boardItems, partitionChanges };
    });
    assert.equal(recovered.items.length, 1, 'Repeated delivery must not duplicate persisted media');
    assert.equal(recovered.items[0].id, 'durable-result');
    assert.equal(recovered.items[0].x, 450, 'Preserve user movement during recovery');
    assert.equal(recovered.visible.length, 0, 'Do not insert into another active canvas');
    assert.equal(recovered.partitionChanges, 0, 'Background delivery must not change active partition');
    const partial = await page.evaluate(async () => {
      const slots = ['first', 'second'].map(id => ({id, canvasId:'canvas-1', isAiPlaceholder:true, x:0, y:0, width:100, height:100}));
      AppState.allBoardItems = [{...slots[0], isAiPlaceholder:false, fileId:'first-result', x:250}, slots[1]];
      AppState.boardItems = AppState.allBoardItems;
      await replaceAiPlaceholders(slots, [{id:'second-result'}], {canvasId:'canvas-1', aspectRatio:'1:1'}, [{...slots[1], fileId:'second-result'}]);
      await replaceAiPlaceholders(slots, [{id:'second-result'}], {canvasId:'canvas-1', aspectRatio:'1:1'});
      return AppState.boardItems;
    });
    assert.equal(partial.length, 2, 'Partial and repeated delivery must retain completed slots');
    assert.equal(partial.find(item => item.id === 'first').fileId, 'first-result');
    assert.equal(partial.find(item => item.id === 'first').x, 250, 'Keep movement of an already delivered image');
    assert.equal(partial.find(item => item.id === 'second').fileId, 'second-result');
    console.log('Passed: same-ID image and video placeholder replacement paints without any subsequent interaction.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
