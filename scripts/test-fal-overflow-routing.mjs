import assert from 'node:assert/strict';
import sharp from 'sharp';
import { generateMedia, recoverMedia, publicProviderConfig } from '../gateway/src/providers.js';
process.env.AIREITER_API_KEY='test-primary';
process.env.FAL_KEY='test-backup';
delete process.env.FAL_API_KEY;
process.env.FAL_NANO_BACKUP_ENABLED='true';
const png=await sharp({create:{width:1024,height:1024,channels:3,background:'#5599cc'}}).png().toBuffer();
const json=(body,status=200)=>new Response(JSON.stringify(body),{status});
let calls=[],accepted,hold,entered;
const fetchOriginal=globalThis.fetch;
const body={providerId:'image-1',prompt:'test generation',size:'1K',aspectRatio:'1:1'};
let mode='reject';
globalThis.fetch=async(url,options={})=>{
  url=String(url);calls.push({url,method:options.method});
  if(url.endsWith('/submit')) {
    if(mode==='hold') { entered(); await new Promise(resolve=>{hold=resolve;}); }
    return json({},429);
  }
  if(url==='https://queue.fal.run/fal-ai/nano-banana-pro') return json({request_id:'fal-task'});
  if(url.endsWith('/fal-task/status')) return json({status:'COMPLETED'});
  if(url.endsWith('/requests/fal-task')) return json({images:[{url:'https://cdn.example.com/fal.png'}]});
  if(url==='https://cdn.example.com/fal.png')return new Response(png);
  throw new Error(`Unexpected route ${url}`);
};
try {
  const hooks={onAccepted:async task=>{accepted=task;}};
  assert.deepEqual(await generateMedia('image',body,null,hooks),png);
  assert.equal(accepted.providerId,'fal-backup-nano-pro');
  assert.equal(calls.filter(c=>c.url.endsWith('/submit')).length,1);
  assert.ok(!JSON.stringify(publicProviderConfig()).includes('fal-backup-nano-pro'));
  process.env.FAL_NANO_BACKUP_ENABLED='false'; calls=[];
  await recoverMedia('image',body,{providerId:accepted.providerId,providerTaskId:accepted.taskId,pollUrl:accepted.pollUrl},null,hooks);
  assert.equal(calls.filter(c=>c.method==='POST').length,0,'Rollback must retain recovery without creation');
  process.env.FAL_NANO_BACKUP_ENABLED='true';
  process.env.AIREITER_NANO_OVERFLOW_AT='1';
  mode='hold';calls=[];
  const submitted=new Promise(resolve=>{entered=resolve;});
  const first=generateMedia('image',{...body,operationId:'first'},null,hooks);
  await submitted;
  await generateMedia('image',{...body,operationId:'second'},null,hooks);
  assert.equal(calls.filter(c=>c.url.endsWith('/submit')).length,1,'Concurrent second request must overflow before primary POST');
  hold(); await first;
  mode='reject';calls=[];
  await generateMedia('image',body,null,hooks);
  assert.ok(calls[0].url.endsWith('/submit'),'Capacity must be released after completion');
  console.log('FAL real routing: primary rejection, proactive overflow, hidden config, rollback recovery and capacity release passed.');
} finally { globalThis.fetch=fetchOriginal; }
