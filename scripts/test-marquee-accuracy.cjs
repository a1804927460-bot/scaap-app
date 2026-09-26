const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1200,height:900}});
  await page.route('**/js/app.js',r=>r.fulfill({body:''}));
  await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
  await page.evaluate(()=>{
   delete document.documentElement.dataset.startupPending;
   document.body.innerHTML='<div id="board-viewport" style="position:fixed;left:130px;top:60px;right:0;bottom:0"></div>';
   window.durations=[];
   boardPartitionAtPoint=()=>null;setActiveBoardPartition=()=>{};
   syncBoardSelectionGroup=scheduleMountedImageQuality=scheduleBoardReconcile=syncCanvasAgentReferencesToSelection=()=>{};
   window.setup=(zoom)=>{
    Board.panX=180;Board.panY=100;Board.zoom=zoom;
    AppState.boardItems=Array.from({length:5000},(_,i)=>({id:String(i),x:(i%100)*30,y:Math.floor(i/100)*30,width:20,height:20,selected:i===4999}));
    Board.filesById=new Map();Board.metrics.clear();Board.mounted.clear();
    Board.itemsById=new Map(AppState.boardItems.map(i=>[i.id,{...i,x:-999,y:-999}]));
    Board.spatialIndex={query:()=>new Set(['4999'])};
    Board.selectedIds=new Set(['4998']);Board.selectedCount=1;
    for(const id of ['0','4999']) {
     const el=document.createElement('div');el.className='board-item is-selected';el.dataset.boardId=id;
     document.getElementById('board-viewport').append(el);Board.mounted.set(id,el);
    }
   };
   window.drag=(start,end,shift=false,changeCamera=false)=>{
    const screen=p=>({clientX:130+Board.panX+p[0]*Board.zoom,clientY:60+Board.panY+p[1]*Board.zoom});
    const a=screen(start),b=screen(end);
    startBoxSelect({...a,shiftKey:shift});
    if(changeCamera){Board.zoom*=1.2;Board.panY+=18;}
    const t=performance.now();document.dispatchEvent(new MouseEvent('mouseup',b));durations.push(performance.now()-t);
    const r={left:Math.min(a.clientX,b.clientX),right:Math.max(a.clientX,b.clientX),top:Math.min(a.clientY,b.clientY),bottom:Math.max(a.clientY,b.clientY)};
    const expected=AppState.boardItems.filter(i=>{
     const x=130+Board.panX+i.x*Board.zoom,y=60+Board.panY+i.y*Board.zoom;
     return x<r.right&&x+20*Board.zoom>r.left&&y<r.bottom&&y+20*Board.zoom>r.top;
    }).map(i=>i.id);
    if(shift&&!expected.includes('4999'))expected.push('4999');
    return {expected:expected.sort(),actual:[...Board.selectedIds].sort(),flags:AppState.boardItems.filter(i=>i.selected).map(i=>i.id).sort()};
   };
  });
  for(const zoom of [.08,.25,1,2])for(const reverse of [false,true])for(const shift of [false,true]) {
   const result=await page.evaluate(({zoom,reverse,shift})=>{setup(zoom);return drag(reverse?[380,340]:[-10,-10],reverse?[-10,-10]:[380,340],shift);},{zoom,reverse,shift});
   assert.deepEqual(result.actual,result.expected);assert.deepEqual(result.flags,result.expected);
  }
  const moved=await page.evaluate(()=>{setup(.25);return drag([-10,-10],[380,340],false,true);});
  assert.deepEqual(moved.actual,moved.expected);
  await page.evaluate(()=>{setup(1);startBoxSelect({clientX:310,clientY:160,shiftKey:false});document.dispatchEvent(new MouseEvent('mousemove',{clientX:600,clientY:500}));});
  await page.waitForTimeout(40);
  assert.ok(await page.evaluate(()=>Board.selectedIds.size)>0);
  await page.evaluate(()=>document.dispatchEvent(new MouseEvent('mouseup',{clientX:311,clientY:161})));
  assert.equal(await page.evaluate(()=>Board.selectedIds.size),0);
  assert.equal(await page.locator('.board-select-box').count(),0);
  console.log('Marquee: 5000 live items, stale index/references/selection, 4 zooms, reverse/Shift, camera drift, final mouseup and collapsed box passed.',await page.evaluate(()=>({maxMs:Math.max(...durations)})));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
