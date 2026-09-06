const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {createHostTools,parseHostTool}=require('../lib/ai-host-tools');
(async()=>{
  const handlers=new Map();let account='a',requests=0;
  const sender=new EventEmitter();sender.id=1;sender.isDestroyed=()=>false;
  const session='session-12345678901234567890';
  const tools=createHostTools({ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},owner:()=>account});
  const tool=parseHostTool('<messs-tool>{"type":"read","path":"'+__filename.replaceAll('\\','\\\\')+'"}</messs-tool>');
  sender.send=(_name,payload)=>{requests++;setImmediate(()=>handlers.get('ai:permissionReply')({sender},{id:payload.id,allow:false}));};
  assert.deepEqual(await tools.run(sender,session,tool),{denied:true});
  assert.equal(requests,1);
  await handlers.get('ai:permissionMode')({sender},{session,mode:'full'});
  assert.match((await tools.run(sender,session,tool)).text,/createHostTools/);
  assert.equal(requests,1);
  account='b';assert.deepEqual(await tools.run(sender,session,tool),{denied:true});
  account='a';
  await handlers.get('ai:permissionMode')({sender},{session,mode:'ask'});
  assert.deepEqual(await tools.run(sender,session,tool),{denied:true});
  sender.send=(_name,payload)=>{requests++;setImmediate(()=>handlers.get('ai:permissionReply')({sender},{id:payload.id,allow:true}));};
  assert.match((await tools.run(sender,session,tool)).text,/createHostTools/);
  const before=requests;await tools.run(sender,session,tool);assert.equal(requests,before+1);
  await handlers.get('ai:permissionMode')({sender},{session,mode:'full'});
  sender.emit('did-start-navigation',{},'local',false,true);
  await tools.run(sender,session,tool);assert.equal(requests,before+2);
  const command=await tools.run(sender,session,{type:'command',command:process.platform==='win32'?"Write-Output 'messs-permission-test'":"printf messs-permission-test"});
  assert.match(command.text,/messs-permission-test/);assert.equal(command.exitCode,0);
  const server=require('node:http').createServer((_req,res)=>res.end('permission-network-test'));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {const result=await tools.run(sender,session,{type:'network',url:`http://127.0.0.1:${server.address().port}/`});assert.equal(result.text,'permission-network-test');}
  finally {await new Promise(resolve=>server.close(resolve));}
  console.log('Host permissions: deny, once, full-session, revoke, account isolation and navigation reset passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
