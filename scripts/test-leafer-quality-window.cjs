const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('src/js/board-canvas.js','utf8');
const start=source.indexOf('function boardMediaDetailPreview(');
const end=source.indexOf('function scheduleBoardInteractionPrefetch',start);
const cached=new Set(),requested=[];
let interacting=false;
const context={
 Board:{visibleIds:new Set(),filesById:new Map(),leaferFullItemIds:new Set(),leaferSourceByItem:new Map(),leaferDetailSources:new Map(),mounted:new Map(),fullImageCache:new Map(),fullImagePending:new Map(),failedFullImageSources:new Set(),zoom:1,lifecycleToken:1},
 AppState:{boardItems:[]},window:{devicePixelRatio:1},isBoardViewportInteracting:()=>interacting,
 URL,isVideoExt:ext=>ext==='.mp4',isImageExt:ext=>ext!=='.mp4',resolveImageDisplaySource:(file,full)=>full?file.url:file.thumbUrl,
 boardItemBounds:item=>({w:item.width,h:item.height}),cachedBoardFullImage:url=>cached.has(url),
 preloadBoardFullImage:url=>{requested.push(url);context.Board.fullImagePending.set(url,true);return new Promise(()=>{});},
 scheduleBoardLeaferSync:()=>{},
 BOARD_THUMBNAIL_MAX_EDGE:400,BOARD_LEAFER_FULL_IMAGE_MIN_SCREEN_EDGE:220,
 BOARD_LEAFER_FULL_IMAGE_EXIT_SCREEN_EDGE:140,BOARD_LEAFER_FULL_ITEM_LIMIT:8,
 BOARD_FULL_IMAGE_CACHE_PIXEL_BUDGET:24000000,BOARD_FULL_IMAGE_CACHE_LIMIT:32,BOARD_FULL_IMAGE_LIMIT:4,BOARD_FULL_IMAGE_SINGLE_PIXEL_LIMIT:40000000
};
vm.createContext(context);vm.runInContext(source.slice(start,end),context);
const sourceStart=source.indexOf('function boardLeaferSource(');
vm.runInContext(source.slice(sourceStart,source.indexOf('function boardLeaferSyncOptions(',sourceStart)),context);
for(let i=0;i<6;i++){
 const id=String(i),url=`full-${i}`;
 context.AppState.boardItems.push({id,fileId:id,width:500,height:500});
 context.Board.visibleIds.add(id);context.Board.filesById.set(id,{sourceWidth:1000,sourceHeight:1000,url,thumbUrl:`thumb-${i}`});
 cached.add(url);
}
context.updateLeaferFullImageWindow();assert.equal(context.Board.leaferFullItemIds.size,4);
for(const id of context.Board.leaferFullItemIds)context.Board.leaferSourceByItem.set(id,`full-${id}`);
for(let i=6;i<600;i++){
 const id=String(i),file={url:`full-${i}`,thumbUrl:`thumb-${i}`};
 context.AppState.boardItems.push({id,fileId:id,width:60,height:60});
 context.Board.filesById.set(id,file);
}
for(const item of context.AppState.boardItems)context.boardLeaferSource(context.Board.filesById.get(item.fileId),item);
assert.equal(context.Board.leaferSourceByItem.get('0'),'full-0','A large scene must retain the visible original source');
interacting=true;
assert.equal(context.boardLeaferSource(context.Board.filesById.get('0'),context.AppState.boardItems[0]),'full-0','Camera motion must not switch an existing texture');
interacting=false;
cached.clear();context.updateLeaferFullImageWindow();
assert.equal(context.Board.leaferFullItemIds.size,4,'Decoder LRU eviction must not demote scene textures');
context.Board.zoom=.35;context.updateLeaferFullImageWindow();assert.equal(context.Board.leaferFullItemIds.size,4,'Exit threshold retains detail');
context.Board.zoom=.2;context.updateLeaferFullImageWindow();assert.equal(context.Board.leaferFullItemIds.size,0);
context.Board.zoom=1;context.updateLeaferFullImageWindow();assert.equal(requested.length,1,'Scene prewarms without DOM nodes and bounds concurrent work');
context.Board.fullImagePending.clear();
for(const file of context.Board.filesById.values()){file.sourceWidth=4000;file.sourceHeight=4000;cached.add(file.url);}
context.updateLeaferFullImageWindow();assert.equal(context.Board.leaferFullItemIds.size,1,'Decoded pixel budget remains bounded');
function resetMedia(count, edge = 500) {
 context.AppState.boardItems=[];
 for (const name of ['visibleIds','filesById','leaferFullItemIds','leaferSourceByItem','leaferDetailSources','fullImageCache','fullImagePending','failedFullImageSources']) context.Board[name].clear();
 cached.clear();requested.length=0;context.Board.zoom=1;context.window.devicePixelRatio=1;
 for(let i=0;i<count;i++) {
  const id=String(i),file={ext:i%2?'.mp4':'.png',sourceWidth:3840,sourceHeight:2160,url:`full-${i}`,thumbUrl:`messs-thumb://${i}`};
  context.AppState.boardItems.push({id,fileId:id,width:edge,height:edge*9/16});
  context.Board.visibleIds.add(id);context.Board.filesById.set(id,file);
  for(const tier of [768,1536])cached.add(context.boardMediaDetailPreview(file,tier===768?500:1000).source);
 }
}
resetMedia(24);
context.updateLeaferFullImageWindow();
assert.equal(context.Board.leaferFullItemIds.size,24,'Dense mixed scenes must not stop after four sharp files');
assert.ok([...context.Board.leaferDetailSources.values()].every(url=>url.includes('edge=768')));
context.AppState.boardItems[0].selected=true;
context.updateLeaferFullImageWindow();
assert.ok(context.Board.leaferDetailSources.get('0').includes('edge=768'),'Selection alone must not create a sharp/blurry jump');
resetMedia(12);
context.window.devicePixelRatio=2;
context.updateLeaferFullImageWindow();
assert.equal(context.Board.leaferFullItemIds.size,12);
assert.ok([...context.Board.leaferDetailSources.values()].every(url=>url.includes('edge=1536')),'Video posters account for device pixels too');
const revision=context.Board.leaferContentRevision;
context.window.devicePixelRatio=1;
context.updateLeaferFullImageWindow();
assert.ok(context.Board.leaferContentRevision>revision,'Cached tier changes invalidate the scene even with identical item IDs');
resetMedia(1,650);
context.updateLeaferFullImageWindow();
const low=context.Board.leaferDetailSources.get('0');
context.AppState.boardItems[0].width=800;
cached.clear();context.updateLeaferFullImageWindow();
assert.equal(context.Board.leaferDetailSources.get('0'),low,'Keep a decoded preview while a larger tier loads');
assert.equal(requested.length,1);
cached.add(requested[0]);context.Board.fullImagePending.clear();context.updateLeaferFullImageWindow();
assert.ok(context.Board.leaferDetailSources.get('0').includes('edge=1536'));
context.AppState.boardItems[0].width=600;context.updateLeaferFullImageWindow();
assert.ok(context.Board.leaferDetailSources.get('0').includes('edge=1536'),'Tier hysteresis prevents zoom oscillation');
interacting=true;
const stable=context.Board.leaferDetailSources.get('0');
context.Board.leaferSourceByItem.set('0',stable);
assert.equal(context.boardLeaferSource({...context.Board.filesById.get('0'),ext:'.mp4'},context.AppState.boardItems[0]),stable);
interacting=false;
resetMedia(40,1000);
for(const file of context.Board.filesById.values())file.thumbUrl='messs-thumb://shared';
cached.add(context.boardMediaDetailPreview(context.Board.filesById.get('0'),1000).source);
context.updateLeaferFullImageWindow();
assert.equal(context.Board.leaferFullItemIds.size,40,'Repeated media share a decode budget instead of leaving duplicates blurry');
resetMedia(30,1000);
context.updateLeaferFullImageWindow();
let total=0;
for(const [id,url] of context.Board.leaferDetailSources)total+=context.boardMediaDetailPreview(context.Board.filesById.get(id),url.includes('1536')?1000:0).pixels;
assert.ok(total<=24000000,'Mixed detail tiers retain the decoded pixel cap');
assert.ok(context.Board.leaferFullItemIds.size>4);
resetMedia(3,2000);
for(const file of context.Board.filesById.values())cached.add(file.url);
context.updateLeaferFullImageWindow();
assert.equal(context.Board.leaferFullItemIds.size,3,'Original promotion cannot starve neighboring video previews');
assert.equal(context.Board.leaferDetailSources.get('0'),'full-0');
assert.ok(context.Board.leaferDetailSources.get('1').includes('1536'));
const stableOriginals=JSON.stringify([...context.Board.leaferDetailSources]);
for(let i=0;i<5;i++)context.updateLeaferFullImageWindow();
assert.equal(JSON.stringify([...context.Board.leaferDetailSources]),stableOriginals,'Original allocations must not oscillate between neighbors on each sync');
context.Board.visibleIds.clear();context.updateLeaferFullImageWindow();
assert.equal(context.Board.leaferDetailSources.size,0,'Offscreen media relinquish the detail window');
resetMedia(2,1000);
const failed=context.boardMediaDetailPreview(context.Board.filesById.get('0'),1000).source;
context.Board.failedFullImageSources.add(failed);context.updateLeaferFullImageWindow();
assert.ok(context.Board.leaferDetailSources.get('0').includes('768'),'Failed detail falls back to the smaller preview');
console.log('Quality window passed: dense image/video previews, shared decodes, DPR, stable tier transitions, failure fallback and bounded budgets.');
