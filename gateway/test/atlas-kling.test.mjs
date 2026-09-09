import test from 'node:test';
import assert from 'node:assert/strict';
import {createVideoTask,pollVideoTask,publicProviderConfig} from '../src/providers.js';
import {quoteUsage} from '../src/usage.js';
import options from '../../lib/kling-options.js';
import pricing from '../../lib/credit-pricing.js';

const base={providerId:'video-14',prompt:'A slow camera move across the scene',urls:['https://example.com/start.png'],videoMode:'first-frame',aspectRatio:'adaptive',duration:5};

test('Kling variants preserve model, sound, dimensions, quote and billing-bound task recovery',async()=>{
  const previous=globalThis.fetch,oldKey=process.env.ATLASCLOUD_API_KEY;
  process.env.ATLASCLOUD_API_KEY='test-only';
  try {
    const publicVideo=publicProviderConfig().providers.filter(p=>p.kind==='video');
    assert.equal(publicVideo.filter(x=>x.name==='Kling').length,1);
    assert.equal(Object.keys(publicVideo.find(x=>x.id==='video-14').capabilities.variantOptions).length,5);
    for(const [serviceTier,variant] of Object.entries(options.KLING_VARIANTS)) for(const resolution of Object.keys(variant.rates)) for(const sound of variant.sound?[false,true]:[false]) {
      const body={...base,serviceTier,resolution,generateAudio:sound};
      const selected=options.klingSelection(body);const calls=[];
      globalThis.fetch=async(url,init={})=>{
        calls.push({url:String(url),body:init.body?JSON.parse(init.body):null});
        if(String(url).endsWith('/calculate')) return Response.json({code:200,data:{price:String(selected.usdPerSecond*5)}});
        if(String(url).endsWith('/generateVideo')) return Response.json({code:200,data:{id:'kling-task',status:'created'}});
        if(String(url).endsWith('/prediction/kling-task')) return Response.json({code:200,data:{id:'kling-task',status:'completed',outputs:['https://cdn.example.com/video.mp4']}});
        throw Error('Unexpected endpoint');
      };
      const quoted=quoteUsage('video',body);
      assert.equal(quoted.credits,pricing.quoteMediaCredits({...body,kind:'video'}).totalCredits);
      assert.equal(quoted.providerId,selected.billingId);
      const task=await createVideoTask(body);
      assert.equal(task.taskId,'messs-route:video-14:kling-task');
      assert.deepEqual(calls[1].body,options.klingInput(body).payload);
      assert.equal(calls[1].body.model,variant.model);
      if(serviceTier.endsWith('4k'))assert.ok(!Object.hasOwn(calls[1].body,'resolution'));
      const result=await pollVideoTask(quoted.providerId,task.taskId);
      assert.equal(result.status,'succeeded');
      assert.equal(result.resultUrl,'https://cdn.example.com/video.mp4');
      const sale=quoted.credits*.07;
      assert.ok((sale*.919-selected.usdPerSecond*5*7.3-.25)/sale>=.10);
    }
  } finally {globalThis.fetch=previous;if(oldKey===undefined)delete process.env.ATLASCLOUD_API_KEY;else process.env.ATLASCLOUD_API_KEY=oldKey;}
});

test('Kling rejects unsupported combinations before any upstream request',async()=>{
  for(const change of [{serviceTier:'unknown'},{serviceTier:'turbo',generateAudio:true},{serviceTier:'turbo',urls:['a','b'],videoMode:'first-last-frame'},{serviceTier:'standard',resolution:'4K'},{duration:6},{urls:[]},{referenceMediaTypes:['video']},{aspectRatio:'16:9'}]) {
    assert.throws(()=>options.klingInput({...base,...change}));
  }
  const two=options.klingInput({...base,urls:['a','b'],videoMode:'first-last-frame'});
  assert.equal(two.payload.end_image,'b');assert.equal(two.payload.sound,false);
});

test('expired discounts and ambiguous submissions never trigger another billable request',async()=>{
  const previous=globalThis.fetch,oldKey=process.env.ATLASCLOUD_API_KEY;process.env.ATLASCLOUD_API_KEY='test-only';
  try {
    let submits=0;
    globalThis.fetch=async()=>Response.json({code:200,data:{price:'99'}});
    await assert.rejects(createVideoTask(base),e=>e.code==='provider-price-changed');
    globalThis.fetch=async(url)=>{
      if(String(url).endsWith('/calculate'))return Response.json({code:200,data:{price:'0.357'}});
      submits++;throw new TypeError('connection interrupted');
    };
    await assert.rejects(createVideoTask(base));assert.equal(submits,1);
  } finally {globalThis.fetch=previous;if(oldKey===undefined)delete process.env.ATLASCLOUD_API_KEY;else process.env.ATLASCLOUD_API_KEY=oldKey;}
});
