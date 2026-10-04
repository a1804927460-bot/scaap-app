const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const engine = require('../src/js/board-engine.js');
const source = fs.readFileSync('src/js/context-menu.js','utf8');
let saved=[];
const context={window:{MesssBoardEngine:engine,messsAPI:{upsertBoardItems:async items=>{saved=items;}}},
  AppState:{files:[{id:'image',ext:'.png'},{id:'video',ext:'.mp4'}]},
  isImageExt:ext=>ext==='.png',isVideoExt:ext=>ext==='.mp4',renderBoard(){},
  boardItemBounds:item=>({x:item.x,y:item.y,w:item.width,h:item.isNote?Math.max(430,item.height):item.height})};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('async function arrangeItemsGrid('),source.indexOf('function showMultiFileContextMenu(')),context);
(async()=>{
  const items=[{id:'image',fileId:'image'},{id:'video',fileId:'video'},
    {id:'text',isNote:true},{id:'draw',isDoodle:true},{id:'mood',isMoodboard:true}]
    .map((item,i)=>({...item,x:20,y:30,width:220+i*60,height:160+i*30}));
  const partition={id:'partition',isPartition:true,x:-100,y:-100,width:2000,height:2000};
  await context.arrangeItemsGrid([...items,partition]);
  assert.equal(saved.length,5);
  assert.equal(items[2].height,430,'Use measured text height, not stale stored height');
  assert.equal(partition.x,-100);
  for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){
    assert.equal(engine.intersects(context.boardItemBounds(items[i]),context.boardItemBounds(items[j])),false,'Mixed content must not overlap');
  }
  for(const direction of ['row','column']){
    context.arrangeItemsLine(items,direction);
    for(let i=1;i<items.length;i++){
      const previous=context.boardItemBounds(items[i-1]);
      assert.ok(direction==='row'?items[i].x>=previous.x+previous.w+12:items[i].y>=previous.y+previous.h+12);
    }
  }
  await context.arrangeItemsGrid(items.filter(item=>!item.fileId));
  assert.equal(saved.length,3,'A selection containing only text/drawings/moodboards must arrange');
  console.log('Mixed canvas arrangement passed: all five types, actual bounds, no overlap, row/column, non-media-only selection, persistence.');
})().catch(e=>{console.error(e);process.exitCode=1;});
