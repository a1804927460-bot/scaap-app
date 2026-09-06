const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('src/js/board-canvas.js','utf8');
const context={
 boardPartitionById:id=>({id}),boardPartitionContentBounds:()=>({x:0,y:0,w:300,h:300}),
 boardItemBounds:item=>({w:item.width,h:item.height}),
 boardSelectionBounds:items=>{
  const x=Math.min(...items.map(i=>i.x)),y=Math.min(...items.map(i=>i.y));
  return {x,y,w:Math.max(...items.map(i=>i.x+i.width))-x,h:Math.max(...items.map(i=>i.y+i.height))-y};
 }
};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function constrainedBoardMoveDeltas('),source.indexOf('function boardItemBounds(')),context);
const entries=Array.from({length:100},(_,i)=>({item:{id:String(i),width:30,height:30,partitionId:i===0?'p1':i===1?'p2':null},startLeft:i===0?260:20,startTop:20}));
for(const [dx,dy] of [[100,40],[-100,-100],[0,0]]){
 const deltas=context.constrainedBoardMoveDeltas(entries,dx,dy);
 assert.equal(deltas.size,100);
 const first=deltas.get('0');
 for(const delta of deltas.values())assert.deepEqual(delta,first);
 if(dx===100)assert.equal(first.dx,10);
 if(dx===-100)assert.equal(first.dx,-20);
}
// Also exercise the drag handler with stale DOM closures and no mounted siblings.
const handlers={},docHandlers={};
const el={dataset:{boardId:'0'},style:{},classList:{add(){},remove(){}},addEventListener:(name,fn)=>handlers[name]=fn};
context.AppState={boardItems:entries.map(e=>({...e.item,x:e.startLeft,y:e.startTop,selected:true,partitionId:null}))};
context.Board={zoom:1,itemsById:new Map(context.AppState.boardItems.map(i=>[i.id,i]))};
context.document={querySelector:()=>null,addEventListener:(name,fn)=>docHandlers[name]=fn,removeEventListener:()=>{}};
for(const name of ['pauseBoardElementMedia','markBoardInteraction','addResizeHandles','updateBoardItemIndex','recordBoardMoveHistory','syncBoardSelectionGroup','scheduleBoardReconcile'])context[name]=()=>{};
context.isBoardUiEventTarget=()=>false;
context.ensureBoardSelectionGroup=()=>({style:{}});
context.createLatestFrameRunner=fn=>({push:fn,flush(){}});
context.syncBoardLeaferItems=items=>{context.synced=items.length;};
context.persistBoardMoveHistory=items=>{context.saved=items.length;};
context.syncMountedBoardItemGeometry=()=>{};
vm.runInContext(source.slice(source.indexOf('function makeBoardItemDraggable('),source.indexOf('const DEFAULT_BOARD_ITEM_WIDTH')),context);
context.makeBoardItemDraggable(el,{id:'0',selected:false,x:-500,y:-500});
handlers.mousedown({button:0,clientX:0,clientY:0,target:{closest:()=>null,classList:{contains:()=>false}},stopPropagation(){}});
docHandlers.mousemove({clientX:50,clientY:70});docHandlers.mouseup();
assert.equal(context.synced,100);assert.equal(context.saved,100);
context.AppState.boardItems.forEach((item,i)=>{assert.equal(item.x,entries[i].startLeft+50);assert.equal(item.y,90);});
context.AppState.boardItems.forEach(item=>{item.selected=false;item.groupId='legacy';});
const previous=context.AppState.boardItems.map(item=>({x:item.x,y:item.y}));
handlers.mousedown({button:0,clientX:0,clientY:0,target:{closest:()=>null,classList:{contains:()=>false}},stopPropagation(){}});
docHandlers.mousemove({clientX:10,clientY:10});docHandlers.mouseup();
assert.equal(context.saved,1);
context.AppState.boardItems.forEach((item,i)=>{assert.equal(item.x,previous[i].x+(i===0?10:0));assert.equal(item.y,previous[i].y+(i===0?10:0));});
const menuSource=fs.readFileSync('src/js/context-menu.js','utf8');
context.AppState.boardItems[0].isMoodboard=true;
for(const zoom of [0.05,0.1,0.25,1]){
 context.Board.zoom=zoom;
 const item=context.AppState.boardItems[0],before={x:item.x,y:item.y};
 handlers.mousedown({button:0,clientX:0,clientY:0,target:{closest:()=>null,classList:{contains:()=>false}},stopPropagation(){}});
 docHandlers.mousemove({clientX:20,clientY:10});docHandlers.mouseup();
 assert.equal(item.x,before.x+20/zoom);assert.equal(item.y,before.y+10/zoom);assert.equal(context.saved,1);
}
context.BOARD_DOM_ITEM_LIMIT=100;
context.Board.selectedIds=new Set(['mood']);
context.Board.spatialIndex={getBounds:id=>id==='offscreen'?null:{x:0,y:0,w:300,h:200}};
context.BoardEngine={intersects:()=>true};context.isMountableBoardItem=()=>true;
vm.runInContext(source.slice(source.indexOf('function prioritizeSelectedBoardMounts('),source.indexOf('function reconcileBoardViewport(')),context);
const crowded=new Set(Array.from({length:5000},(_,i)=>String(i)));
let mounted=context.prioritizeSelectedBoardMounts(crowded,{});
assert.equal(mounted.size,100);assert.equal([...mounted][0],'mood');
context.Board.selectedIds=new Set(['offscreen',...crowded]);
mounted=context.prioritizeSelectedBoardMounts(crowded,{});
assert.equal(mounted.size,100);assert.equal(mounted.has('offscreen'),false);
vm.runInContext(menuSource.slice(menuSource.indexOf('const MULTI_MENU_ITEMS = ['),menuSource.indexOf('function showBoardMultiContextMenu('))+'\nglobalThis.menuItems=MULTI_MENU_ITEMS;',context);
assert.equal(context.menuItems[0].key,'secondary-partition');
assert.equal(context.menuItems.some(item=>['group','ungroup'].includes(item.key)),false);
assert.doesNotMatch(menuSource,/case '(?:group|ungroup)'/);
console.log('Selection drag passed: 100 items, complete persistence, legacy grouping disabled, partition menu first.');
