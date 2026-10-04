const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');
(async () => {
  const browser = await chromium.launch({channel:'chrome',headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1200,height:900}});
    await page.route('**/js/app.js',r=>r.fulfill({body:''}));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    await page.evaluate(() => {
      document.body.innerHTML='<div id="board-viewport" style="position:fixed;inset:0"><div id="board-canvas"></div></div>';
      window.p={id:'p',isPartition:true,x:30,y:30,width:500,height:400};
      window.n={id:'n',isNote:true,partitionId:'p',x:60,y:120,width:120,height:80,text:'Text',fontSize:20};
      window.media={id:'m',partitionId:'p',x:250,y:120,width:100,height:80};
      AppState.boardItems=[p,n,media]; Board.zoom=1;
      Board.itemsById=new Map(AppState.boardItems.map(i=>[i.id,i]));
      window.MesssCanvasPluginAdapter=null;
      setActiveBoardPartition=()=>{}; syncBoardSelectionClasses=()=>{};
      markBoardInteraction=()=>{}; syncBoardLeaferItems=()=>{};
      updateBoardItemIndex=()=>{}; scheduleBoardReconcile=()=>{};
      persistBoardMoveHistory=()=>{}; pauseBoardElementMedia=()=>{};
      window.savedHistory=null; recordBoardHistoryEntry=e=>{window.savedHistory=e;return true;};
      const host=document.getElementById('board-canvas');
      const part=buildBoardPartitionElement(p); host.append(part); Board.mounted.set(p.id,part);
      for(const i of [n,media]) {
        const el=document.createElement('div');el.className='board-item';el.dataset.boardId=i.id;
        host.append(el);Board.mounted.set(i.id,el);syncMountedBoardItemGeometry(el,i);makeBoardItemDraggable(el,i);
      }
      window.drag=async(id,dx,dy,hold=false)=>{
        const el=Board.mounted.get(id);
        el.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:100,clientY:200}));
        if(hold)await new Promise(r=>setTimeout(r,480));
        document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:100+dx,clientY:200+dy}));
        document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
      };
    });
    await page.evaluate(()=>drag('p',100,50));
    let result=await page.evaluate(()=>({p,n,media}));
    assert.equal(result.p.x,130);assert.equal(result.n.x,160);assert.equal(result.media.x,350);
    assert.equal(result.n.y,170);
    await page.evaluate(()=>drag('n',700,0));
    result=await page.evaluate(()=>({p,n}));
    assert.equal(result.n.partitionId,'p');assert.ok(result.n.x<630,'Ordinary dragging stays inside');
    await page.evaluate(()=>drag('n',700,0,true));
    result=await page.evaluate(()=>({p,n,media}));
    assert.equal(result.n.partitionId,undefined);assert.ok(result.n.x>630);
    assert.equal(result.media.partitionId,'p');assert.equal(result.media.x,350);
    await page.evaluate(()=>applyBoardMoveHistory(savedHistory,'before'));
    assert.equal(await page.evaluate(()=>n.partitionId),'p');
    await page.evaluate(()=>applyBoardMoveHistory(savedHistory,'after'));
    assert.equal(await page.evaluate(()=>n.partitionId),undefined);
    const style=await page.locator('.board-partition').evaluate(el=>({radius:getComputedStyle(el).borderRadius,pointer:getComputedStyle(el).pointerEvents,font:getComputedStyle(el.querySelector('.board-partition-title')).fontSize}));
    assert.equal(style.radius,'24px');assert.equal(style.pointer,'auto');assert.equal(style.font,'40px');
    console.log('Partition drag passed: background drag includes text/media; normal drag constrained; hold detaches one item; undo/redo restores membership.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
