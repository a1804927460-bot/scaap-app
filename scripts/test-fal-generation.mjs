import assert from 'node:assert/strict';
import { falNanoInput, generateFalNano } from '../gateway/src/fal-generation.js';
const provider={id:'fal-backup-nano-pro',apiKey:'test-only'};
const body={prompt:'test image',size:'4K',aspectRatio:'16:9',urls:['https://example.com/image.png']};
assert.equal(falNanoInput(body).resolution,'4K');
assert.equal(falNanoInput(body).num_images,1);
assert.throws(()=>falNanoInput({...body,aspectRatio:'9:21'}));
assert.throws(()=>falNanoInput({...body,count:2}));
const json=(data,status=200)=>new Response(JSON.stringify(data),{status});
let calls=[],recorded,ready;
const deps={sleep:async()=>{}, download:async()=>Buffer.from('validated-image'),fetchImpl:async(url,options)=>{
  calls.push({url,method:options.method});
  assert.equal(options.headers.Authorization,'Key test-only');
  if(options.method==='POST') return json({request_id:'task-1',response_url:'https://queue.fal.run/fal-ai/nano-banana-pro/requests/task-1'});
  if(url.endsWith('/status'))return json({status:'COMPLETED'});
  return json({images:[{url:'https://cdn.example.com/result.png'}]});
}};
const hooks={onAccepted:async task=>{recorded=task;},onReady:async result=>{ready=result;}};
await generateFalNano(provider,body,null,hooks,deps);
assert.equal(calls.filter(c=>c.method==='POST').length,1);
assert.equal(recorded.providerId,provider.id);
assert.equal(ready.buffer.toString(),'validated-image');
calls=[];
await generateFalNano(provider,{...body,_acceptedTask:recorded},null,hooks,deps);
assert.equal(calls.filter(c=>c.method==='POST').length,0);
for(const status of [401,429]) {
  await assert.rejects(()=>generateFalNano(provider,body,null,hooks,{...deps,fetchImpl:async()=>json({},status)}),e=>e.safeToFallback===true&&!e.submissionAmbiguous);
}
for(const status of [403,422,500]) {
  await assert.rejects(()=>generateFalNano(provider,body,null,hooks,{...deps,fetchImpl:async()=>json({},status)}),e=>!e.safeToFallback);
}
await assert.rejects(()=>generateFalNano(provider,body,null,hooks,{...deps,fetchImpl:async()=>{throw new Error('socket disconnected');}}),e=>e.submissionAmbiguous===true);
await assert.rejects(()=>generateFalNano(provider,body,null,{onAccepted:async()=>{throw new Error('database down');}},deps),e=>e.providerTaskAccepted===true&&e.taskId==='task-1'&&!e.safeToFallback);
await assert.rejects(()=>generateFalNano(provider,body,null,hooks,{...deps,download:async()=>{throw new Error('download failed');}}),e=>e.providerTaskAccepted===true&&!e.safeToFallback);
await assert.rejects(()=>generateFalNano(provider,body,null,{...hooks,onReady:async()=>{throw new Error('storage failed');}},deps),e=>e.providerTaskAccepted===true&&!e.safeToFallback);
console.log('FAL task acceptance, no duplicate POST, recovery, input mapping, rejection and delivery fault tests passed.');
