const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('src/js/board-canvas.js','utf8');
const start=source.indexOf('function updateLeaferFullImageWindow()');
const end=source.indexOf('function scheduleBoardInteractionPrefetch',start);
const cached=new Set(),requested=[];
const context={
 Board:{visibleIds:new Set(),filesById:new Map(),leaferFullItemIds:new Set(),leaferSourceByItem:new Map(),fullImagePending:new Map(),failedFullImageSources:new Set(),zoom:1,lifecycleToken:1},
 AppState:{boardItems:[]},window:{devicePixelRatio:1},isBoardViewportInteracting:()=>false,
 isImageExt:()=>true,resolveImageDisplaySource:(file,full)=>full?file.url:file.thumbUrl,
 boardItemBounds:item=>({w:item.width,h:item.height}),cachedBoardFullImage:url=>cached.has(url),
 preloadBoardFullImage:url=>{requested.push(url);context.Board.fullImagePending.set(url,true);return new Promise(()=>{});},
 scheduleBoardLeaferSync:()=>{},
 BOARD_THUMBNAIL_MAX_EDGE:400,BOARD_LEAFER_FULL_IMAGE_MIN_SCREEN_EDGE:220,
 BOARD_LEAFER_FULL_IMAGE_EXIT_SCREEN_EDGE:140,BOARD_LEAFER_FULL_ITEM_LIMIT:8,
 BOARD_FULL_IMAGE_CACHE_PIXEL_BUDGET:24000000
};
vm.createContext(context);vm.runInContext(source.slice(start,end),context);
for(let i=0;i<6;i++){
 const id=String(i),url=`full-${i}`;
 context.AppState.boardItems.push({id,fileId:id,width:500,height:500});
 context.Board.visibleIds.add(id);context.Board.filesById.set(id,{sourceWidth:1000,sourceHeight:1000,url,thumbUrl:`thumb-${i}`});
 cached.add(url);
}
context.updateLeaferFullImageWindow();assert.equal(context.Board.leaferFullItemIds.size,6);
for(const id of context.Board.leaferFullItemIds)context.Board.leaferSourceByItem.set(id,`full-${id}`);
cached.clear();context.updateLeaferFullImageWindow();
assert.equal(context.Board.leaferFullItemIds.size,6,'Decoder LRU eviction must not demote scene textures');
context.Board.zoom=.35;context.updateLeaferFullImageWindow();assert.equal(context.Board.leaferFullItemIds.size,6,'Exit threshold retains detail');
context.Board.zoom=.2;context.updateLeaferFullImageWindow();assert.equal(context.Board.leaferFullItemIds.size,0);
context.Board.zoom=1;context.updateLeaferFullImageWindow();assert.equal(requested.length,1,'Scene prewarms without DOM nodes and bounds concurrent work');
context.Board.fullImagePending.clear();
for(const file of context.Board.filesById.values()){file.sourceWidth=4000;file.sourceHeight=4000;cached.add(file.url);}
context.updateLeaferFullImageWindow();assert.equal(context.Board.leaferFullItemIds.size,1,'Decoded pixel budget remains bounded');
console.log('Quality window passed: DOM-independent demand, stable texture retention, hysteresis and pixel/concurrency budgets.');
