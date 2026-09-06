const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const workspace=require('../lib/ai-workspace');
const attachments=require('../lib/ai-attachments');
(async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'messs-ipc-work-'));
  try {
    const source=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');
    const handlers=new Map(),events=[];
    let approve=true;
    const context={
      ...workspace,...attachments,console,Buffer,fs,mainWindow:{},
      ipcMain:{handle:(name,handler)=>handlers.set(name,handler)},
      BrowserWindow:{fromWebContents:()=>({})},
      aiWorkspaceOwner:()=> 'test-owner',aiWorkspaceStore:()=>workspace.createArtifactStore(root,'test-owner'),aiWorkspaceBusy:false,
      resolveAiChatMessageAttachments:async()=>[{name:'input.txt',kind:'text',content:'Example input',readable:true}],
      sanitizeAiRequest:r=>r,
      membershipService:{beginUsage:()=>({ok:true,usageId:'usage'}),finishUsage:()=>{}},CHAT_CREDITS:0,
      generateAiChatReply:async()=>'<messs-work>return {files:[{name:"task.pptx",type:"pptx",slides:[{title:"Upload",body:uploads[0].content}]}]};</messs-work>',
      dialog:{showMessageBox:async()=>({response:approve?1:0}),showSaveDialog:async()=>({filePath:path.join(root,'download.pptx')})},
      localizedMessage:(en,zh)=>zh,conciseAiErrorMessage:e=>e.message,runtimeConfig:{},transientAiOutputFiles:new Map()
    };
    vm.runInNewContext(source.slice(source.indexOf("  ipcMain.handle('ai:chat'"),source.indexOf("  ipcMain.handle('files:transcodeVideo'")),context);
    const event={sender:{isDestroyed:()=>false,send:(name,data)=>events.push(data)}};
    const request={prompt:'Create slides',messages:[{role:'user',content:'Create slides'}],workRequestId:'request-1'};
    const response=await handlers.get('ai:chat')(event,request);
    assert.equal(response.ok,true);assert.equal(response.files.length,1);
    assert.deepEqual(events.map(e=>e.phase),['approval','executing','saving']);
    assert.equal((await handlers.get('ai:saveGeneratedFile')(event,response.files[0].token)).ok,true);
    assert.equal(fs.readFileSync(path.join(root,'download.pptx')).subarray(0,2).toString(),'PK');
    approve=false;
    const canceled=await handlers.get('ai:chat')(event,request);
    assert.equal(canceled.files.length,0);assert.match(canceled.text,/已取消/);
    console.log('Chat IPC: approved execution, upload forwarding, durable binary download, progress and cancellation passed (mock provider/dialog).');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
