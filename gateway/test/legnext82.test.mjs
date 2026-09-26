import test from 'node:test';
import assert from 'node:assert/strict';
import media from '../../lib/ai-media-provider.js';
import {publicProviderConfig} from '../src/providers.js';
import {quoteUsage} from '../src/usage.js';
import pricing from '../../lib/credit-pricing.js';
const config={apiKey:'test',imageEndpoint:'https://api.legnext.ai/api/v1/diffusion',imageModel:'8.2',pollIntervalMs:800};
const png=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.write('IHDR',12);png.writeUInt32BE(4096,16);png.writeUInt32BE(4096,20);
test('Midjourney 8.2 public entry, version lock and bounded pricing',()=>{
  const old=process.env.LEGNEXT_API_KEY;process.env.LEGNEXT_API_KEY='test';
  try {const p=publicProviderConfig().providers;assert.equal(p.filter(x=>x.id==='image-18').length,1);assert.equal(p.some(x=>x.id==='image-17'),false);}finally{if(old===undefined)delete process.env.LEGNEXT_API_KEY;else process.env.LEGNEXT_API_KEY=old;}
  for(const [size,cost,expected] of [['1K',.08,16],['2K',.12,23]]) {
    for(const count of [1,2,4])assert.equal(quoteUsage('image',{providerId:'image-18',size,count}).credits,expected*count);
    assert.equal(pricing.quoteMediaCredits({kind:'image',providerId:'image-18',size}).totalCredits,expected);
    assert.ok((expected*.07*.919-(cost*7.3+.013)*1.10)/(expected*.07)>=.30);
    const text=media.withLegnextMidjourneyParameters('scene --v 7 --q 4 --turbo --hd','8.2','16:9',size);
    assert.equal(text,`scene --v 8.2 --ar 16:9${size==='2K'?' --hd':''} --fast`);
  }
  for(const prompt of ['scene --repeat 40','scene --r=2','scene {red,blue}','scene --draft','scene --niji 6','scene --relax','x'.repeat(8192)]) assert.throws(()=>media.withLegnextMidjourneyParameters(prompt,'8.2','1:1','2K'),{code:'invalid-prompt'});
});
test('Legnext accepted task recovery only polls and saves grid; missing ID is never replayable',async()=>{
  const calls=[];
  const fetchImpl=async(url,init={})=>{calls.push([url,init.method||'GET']);return url.includes('/job/')?Response.json({status:'completed',output:{image_url:'https://cdn.test/grid.png',image_urls:['https://cdn.test/single.png']}}):new Response(png);};
  let ready=false;
  const result=await media.recoverMediaBuffer(fetchImpl,config,'image',{size:'2K'},{taskId:'accepted-task'},null,async()=>{},{onReady:async()=>{ready=true;}});
  assert.deepEqual(result,png);assert.ok(ready);assert.deepEqual(calls,[['https://api.legnext.ai/api/v1/job/accepted-task','GET'],['https://cdn.test/grid.png','GET']]);
  let submits=0;
  await assert.rejects(media.generateMediaBuffer(async()=>{submits++;return Response.json({status:'pending'});},config,'image',{prompt:'test',size:'1K'},null,async()=>{}),e=>e.submissionAmbiguous===true&&e.retryable===false);
  assert.equal(submits,1);
});
