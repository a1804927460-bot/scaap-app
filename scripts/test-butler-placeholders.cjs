const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname,'../src/js/board-media-meta.js'),'utf8');
const slice = source.slice(source.indexOf('function createBoardButlerPlaceholder'), source.indexOf('function launchBoardButlerImageTool'));
let finish;
const response = new Promise(resolve => { finish=resolve; });
const events=[];
const state={files:[],boardItems:[],allBoardItems:[]};
const context = {
  AppState:state, t:(en,zh)=>zh, activeCanvasId:()=> 'canvas-a',
  createAiPlaceholders:()=>[{id:'pending',width:300,height:200,isAiPlaceholder:true}],
  canvasWorkspaceAddItem:()=>{},renderBoard:()=>{},getBoardButlerTask:()=>null,
  boardButlerApi:()=>({}), BOARD_BUTLER_IMAGE_TOOL_HOOKS:{imageEnhance:{toolId:'clipdrop-upscale'}},
  boardButlerImageToolInvoker:()=>async()=>response,
  setBoardButlerTask:()=>{},syncBoardButlerTaskUi:()=>{},
  resolveBoardButlerImageToolResult:async(_api,_hook,result)=>[result.file],
  replaceAiPlaceholders:async(p,files,request)=>{events.push(['replace',p[0].x,p[0].y,request.canvasId,files[0].id]);},
  confirmBoardButlerDeliveries:async()=>events.push(['confirm']),
  clearCompletedBoardButlerTask:()=>{},showToast:()=>{},
  preserveAiPlaceholders:()=>events.push(['failed']),
  boardButlerError:r=>new Error(r.message),
};
vm.createContext(context);
vm.runInContext(slice,context);
(async()=>{
 const run=context.runBoardButlerImageTool('imageEnhance',{id:'source',sourceWidth:1200,sourceHeight:800},{x:100,y:70,width:400,height:260,canvasId:'canvas-a'},{});
 assert.equal(state.boardItems.length,1,'placeholder appears before request completes');
 assert.equal(state.boardItems[0].x,534);
 assert.equal(state.boardItems[0].y,70);
 context.activeCanvasId=()=> 'canvas-b';
 finish({ok:true,file:{id:'result'}});
 await run;
 assert.deepEqual(events,[['replace',534,70,'canvas-a','result'],['confirm']]);
 context.boardButlerImageToolInvoker=()=>async()=>({ok:false,message:'temporary failure'});
 await context.runBoardButlerImageTool('imageEnhance',{id:'source'},{x:0,y:0,width:400,canvasId:'canvas-a'},{});
 assert.deepEqual(events.at(-1),['failed']);
 console.log('Butler immediate placeholder, original canvas delivery and failure retention passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
