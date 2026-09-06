'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createEmbeddedMcpSession } = require('../lib/embedded-mcp');
const { createHostTools } = require('../lib/ai-host-tools');

(async () => {
  let account = 'account-a';
  const handlers = new Map();
  const hostTools = createHostTools({ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},owner:()=>account});
  const sender = new EventEmitter(); sender.id = 17; sender.isDestroyed = () => false;
  let prompts = 0;
  sender.send = (name, payload) => {
    assert.equal(name,'ai:permissionRequest'); prompts++;
    assert.equal(handlers.get('ai:permissionReply')({sender:{id:18}},{id:payload.id,allow:true}),false);
    handlers.get('ai:permissionReply')({sender},{id:payload.id,allow:false});
  };
  const context = {sender,session:'session-abcdefghijklmnop',owner:()=>account,hostTools,
    executeWork:require('../lib/ai-workspace').executeWork};
  const connection = await createEmbeddedMcpSession(context);
  try {
    assert.deepEqual((await connection.listTools()).tools.map(t=>t.name).sort(),
      ['execute_isolated','fetch_url','read_file','run_command']);
    assert.deepEqual(await connection.call('run_command',{command:'echo never-execute'}),{denied:true});
    assert.equal(prompts,1);
    await assert.rejects(connection.call('read_file',{path:'relative.txt'}),/absolute/);
    await assert.rejects(connection.call('fetch_url',{url:'file:///private'}),/HTTP/);
    await assert.rejects(connection.call('unknown',{}));
    await assert.rejects(connection.call('run_command',{command:123}));
    const output = await connection.call('execute_isolated',{code:'return {files:[{name:"test.txt",content:String(6*7)}]};'});
    assert.equal(output.files[0].content,'42');
    assert.equal(prompts,1,'isolated work requires no host permission');
    handlers.get('ai:permissionMode')({sender},{session:context.session,mode:'full'});
    const read = await connection.call('read_file',{path:__filename});
    assert.ok(read.text.includes('test-embedded-mcp'));
    assert.equal(prompts,1,'reuse explicit session approval');
    const other = await createEmbeddedMcpSession({...context,session:'other-session-abcdefghijklmnop'});
    try { assert.deepEqual(await other.call('read_file',{path:__filename}),{denied:true}); }
    finally { await other.close(); }
    assert.equal(prompts,2,'session approval must not leak');
    const oldSend = sender.send;
    let saved = false;
    sender.send = (name,payload)=>{
      assert.equal(payload.type,'memory');
      handlers.get('ai:permissionReply')({sender},{id:payload.id,allow:true});
    };
    const memory = await createEmbeddedMcpSession({...context,localMemory:{
      add:async()=>{saved=true;return {id:'stored'};},search:async()=>[],list:async()=>[],remove:async()=>({removed:false})
    }});
    try {
      assert.deepEqual(await memory.call('memory_add',{path:__filename}),{id:'stored'});
      assert.equal(saved,true,'persistent memory requires and receives explicit approval');
      await assert.rejects(memory.call('memory_add',{path:require('node:path').resolve('.env')}),/blocked/);
    } finally { await memory.close(); sender.send = oldSend; }
    hostTools.revokeAll();
    assert.deepEqual(await connection.call('read_file',{path:__filename}),{denied:true});
    account = 'account-b';
    await assert.rejects(connection.call('read_file',{path:__filename}),/context expired/);
  } finally { await connection.close(); hostTools.revokeAll(); }
  await assert.rejects(connection.call('read_file',{path:__filename}),/context expired/);
  console.log('Embedded MCP passed: discovery, SDK validation, isolated execution, permission denial, sender/session isolation, revocation, account change and close.');
})().catch(error=>{console.error(error);process.exitCode=1;});
