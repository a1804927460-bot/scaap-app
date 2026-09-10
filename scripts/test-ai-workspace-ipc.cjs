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
    const context={
      require: name=>require(path.join(__dirname,'..',name)),
      getPublicAiMediaConfig:async()=>({imageProviders:[]}),
      ...require('../lib/agent-routing'),
      ...require('../lib/agent-local-memory'),app:{getPath:()=>root},
      ...require('../lib/embedded-mcp'),...require('../lib/ai-model-export'),hostTools:{run:async()=>({denied:true})},
      ...workspace,...attachments,...require('../lib/ai-host-tools'),console,Buffer,fs,path,sharp:require('sharp'),mainWindow:{},
      ipcMain:{handle:(name,handler)=>handlers.set(name,handler)},
      BrowserWindow:{fromWebContents:()=>({})},
      aiWorkspaceOwner:()=> 'test-owner',aiWorkspaceStore:()=>workspace.createArtifactStore(root,'test-owner'),aiWorkspaceBusy:false,
      resolveAiChatMessageAttachments:async()=>[{name:'input.txt',kind:'text',content:'Example input',readable:true}],
      sanitizeAiRequest:r=>r,
      membershipService:{beginUsage:()=>({ok:true,usageId:'usage'}),finishUsage:()=>{}},CHAT_CREDITS:0,
      generateAiChatReply:async()=>'<messs-work>return {files:[{name:"task.pptx",type:"pptx",slides:[{title:"Upload",body:uploads[0].content}]}]};</messs-work>',
      dialog:{showMessageBox:async()=>{throw new Error('Unexpected confirmation');},showSaveDialog:async()=>({filePath:path.join(root,'download.pptx')})},
      localizedMessage:(en,zh)=>zh,conciseAiErrorMessage:e=>e.message,runtimeConfig:{},transientAiOutputFiles:new Map()
    };
    vm.runInNewContext(source.slice(source.indexOf("  ipcMain.handle('ai:chat'"),source.indexOf("  ipcMain.handle('files:transcodeVideo'")),context);
    const event={sender:{isDestroyed:()=>false,send:(name,data)=>events.push(data)}};
    const request={prompt:'Create slides',messages:[{role:'user',content:'Create slides'}],workRequestId:'request-1'};
    const response=await handlers.get('ai:chat')(event,request);
    assert.equal(response.ok,true);assert.equal(response.files.length,1);
    assert.deepEqual(events.map(e=>e.phase),['executing','saving']);
    assert.equal((await handlers.get('ai:saveGeneratedFile')(event,response.files[0].token)).ok,true);
    assert.equal(fs.readFileSync(path.join(root,'download.pptx')).subarray(0,2).toString(),'PK');
    const imageFiles=await workspace.materialize({files:[{name:'picture.jpg',type:'image',text:'Hello',width:256,height:256}]});
    const imageRecords=await context.aiWorkspaceStore().save(imageFiles);
    const imagePreview=await handlers.get('ai:previewGeneratedFile')(event,imageRecords[0].token);
    assert.equal(imagePreview.ok,true);assert.match(imagePreview.dataUrl,/^data:image\/png;base64,/);
    assert.deepEqual((await context.aiWorkspaceStore().read(imageRecords[0].token)).data,imageFiles[0].data);
    context.generateAiChatReply=async()=>'<messs-work>return process.env;</messs-work>';
    const failed=await handlers.get('ai:chat')(event,request);
    assert.equal(failed.files.length,0);assert.match(failed.text,/文件任务未完成/);
    let steps=0,hostCalls=0;
    context.hostTools={run:async()=>{hostCalls++;return {text:'host-result'};}};
    context.generateAiChatReply=async(_prompt,messages)=>{
      if(steps++===0)return '<messs-tool>{"type":"command","command":"echo test"}</messs-tool>';
      assert.match(messages.at(-1).content,/host-result/);
      return 'Tool completed';
    };
    const hostResponse=await handlers.get('ai:chat')(event,{...request,permissionSession:'session-12345678901234567890'});
    assert.equal(hostCalls,1);assert.equal(hostResponse.text,'Tool completed');
    console.log('Chat IPC: automatic isolated execution, upload forwarding, binary download, progress and denied host access passed (mock provider/dialog).');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
