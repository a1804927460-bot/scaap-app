const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const page=await browser.newPage();
  await page.route('**/js/app.js',r=>r.fulfill({body:''}));
  await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
  await page.evaluate(()=>{
   delete document.documentElement.dataset.startupPending;
   document.body.innerHTML='<div id="board-viewport" style="position:fixed;left:120px;top:50px;right:0;bottom:0"><div id="board-canvas"></div></div>';
   AppState.boardItems=Array.from({length:5000},(_,i)=>({id:String(i),fileId:String(i),x:i*250,y:0,width:220,height:140}));
   Board.filesById=new Map(AppState.boardItems.map(i=>[i.id,{id:i.id,ext:'.png',sourceWidth:2000,sourceHeight:1000}]));
   Board.itemsById=new Map(AppState.boardItems.map(i=>[i.id,i]));Board.metrics.clear();Board.mounted.clear();
   Board.zoom=.29;Board.panX=-4999*250*.29;Board.panY=20;
   const actual=createBoardItemElement;
   createBoardItemElement=i=>{const el=document.createElement('div');el.className='board-item';el.dataset.boardId=i.id;return el;};
   const hit=mountBoardItemAtPointer({clientX:120+10,clientY:50+25});
   if(hit?.dataset.boardId!=='4999'||Board.mounted.size!==1)throw Error('Visible unmounted item was not hit');
   if(mountBoardItemAtPointer({clientX:120+100,clientY:50+25}))throw Error('Empty space selected a file');
   createBoardItemElement=actual;
   AppState.boardItems=AppState.boardItems.slice(0,12);
   AppState.boardItems[11].selected=true;
   Board.visibleIds=new Set(AppState.boardItems.map(i=>i.id));Board.zoom=4;Board.disposed=false;
   Board.leaferFullItemIds.clear();Board.leaferSourceByItem.clear();Board.fullImagePending.clear();
   isBoardViewportInteracting=()=>false;
   resolveImageDisplaySource=(f,full)=>(full?'full:':'thumb:')+f.id;
   window.decoded=new Set();window.loads=[];window.complete=null;
   cachedBoardFullImage=source=>decoded.has(source)?{}:null;
   preloadBoardFullImage=source=>{
    loads.push(source);Board.fullImagePending.set(source,true);
    return new Promise(resolve=>{complete=()=>{decoded.add(source);Board.fullImagePending.delete(source);resolve({});};});
   };
   scheduleBoardLeaferSync=()=>{};
  });
  for(let i=0;i<8;i++)await page.evaluate(async()=>{updateLeaferFullImageWindow();if(complete){const done=complete;complete=null;done();await Promise.resolve();}});
  const result=await page.evaluate(()=>({loads,ids:[...Board.leaferFullItemIds]}));
  assert.equal(result.loads[0],'full:11');assert.equal(result.loads.length,4);assert.equal(result.ids.length,4);
  assert.ok(result.ids.includes('11'));
  await page.evaluate(()=>{
   Board.leaferFullItemIds=new Set(['0','1','2','3']);
   for(const id of Board.leaferFullItemIds) { Board.leaferSourceByItem.set(id,'full:'+id); decoded.add('full:'+id); }
   AppState.boardItems.forEach(i=>{i.selected=false;i.width=i.id==='4'?221:220;});
   updateLeaferFullImageWindow();
   if([...Board.leaferFullItemIds].join(',')!=='0,1,2,3')throw Error('Minor size change evicted visible originals');
   const large=AppState.boardItems[11];large.selected=true;
   Board.filesById.set('11',{id:'11',ext:'.png',sourceWidth:6000,sourceHeight:5000});
   decoded.delete('full:11');loads.length=0;Board.fullImagePending.clear();
   updateLeaferFullImageWindow();
   if(loads[0]!=='full:11'||loads.length!==1)throw Error('30 MP original never promoted');
  });
  await page.evaluate(()=>{
   let moving=false;
   isBoardViewportInteracting=()=>moving;
   Object.defineProperty(window,'devicePixelRatio',{configurable:true,value:2});
   Board.leaferPixelRatio=1;
   Board.leaferLayer={resize:(w,h,dpr)=>{window.lastDpr=dpr;},setTransform:()=>{},setVisible:()=>{}};
   moving=true;ensureBoardLeaferCanvas();
   if(lastDpr!==1)throw Error('DPI changed during camera gesture');
   moving=false;ensureBoardLeaferCanvas();
   if(lastDpr!==2)throw Error('High DPI was not restored at rest');
  });
  console.log('Dense board: 5000-file hit testing, bounded originals, 30 MP promotion, stable retention and idle-only DPI change passed.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
