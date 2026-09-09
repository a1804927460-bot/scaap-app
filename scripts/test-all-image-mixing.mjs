import assert from 'node:assert/strict';
import sharp from 'sharp';
import { falImageInput, falImageRoutes, generateFalNano } from '../gateway/src/fal-generation.js';
import { preferFalImageChannel } from '../gateway/src/image-channel-policy.js';
import { generateMedia, recoverMedia, publicProviderConfig } from '../gateway/src/providers.js';

process.env.AIREITER_API_KEY='test-primary';
process.env.FAL_KEY='test-backup';
delete process.env.FAL_API_KEY;
process.env.FAL_IMAGE_BACKUP_ENABLED='true';
process.env.FAL_IMAGE_MIX_PERCENT='10';
process.env.FAL_GPT_IMAGE_MIX_PERCENT='20';
process.env.AIREITER_IMAGE_ROUTING_SECRET='test-routing-secret-not-for-production';
process.env.AIREITER_IMAGE_PLUS_PERCENT='0';
delete process.env.AIREITER_NANO_OVERFLOW_AT;
delete process.env.FAL_NANO_BACKUP_ENABLED;
const png=await sharp({create:{width:1024,height:1024,channels:3,background:'#5599cc'}}).png().toBuffer();
const json=(data,status=200)=>new Response(JSON.stringify(data),{status});
const originalFetch=globalThis.fetch;
let calls=[],mode='ok',accepted;
const bodyFor=(route, preferred=true)=>{
  let operationId;
  for(let i=0;i<10000;i++) {
    operationId=`mix-test-${i}`;
    if(preferFalImageChannel({id:route.providerId,kind:'image'},{operationId})===preferred) break;
  }
  return {providerId:route.providerId,operationId,prompt:'test image generation',size:'1K',aspectRatio:'1:1',quality:'medium',urls:[]};
};
try {
  for(const route of falImageRoutes) {
    const body=bodyFor(route);
    const provider={id:route.id};
    for(const size of ['1K','2K','4K']) {
      const ratios=['1:1','3:2','2:3','4:3','3:4','5:4','4:5','16:9','9:16','21:9'];
      if(route.model==='gpt-image-2')ratios.push('2:1','1:2','9:21');
      for(const ratio of ratios) {
        if(route.model==='gpt-image-2' && size==='4K' && !['16:9','9:16','21:9','2:1','1:2','9:21'].includes(ratio)) continue;
        for(const quality of ['low','medium','high']) {
          const input=falImageInput(provider,{...body,size,aspectRatio:ratio,quality});
          if(route.model==='gpt-image-2') {
            assert.equal(input.quality,quality);
            assert.ok(input.image_size.width%16===0 && input.image_size.height%16===0);
            const pixels=input.image_size.width*input.image_size.height;
            assert.ok(pixels>=655360 && pixels<=8294400);
          } else assert.equal(input.resolution,size);
        }
      }
    }
    const maxRefs=route.model==='gpt-image-2'?9:8;
    assert.equal(falImageInput(provider,{...body,urls:Array(maxRefs).fill('https://example.com/ref.png')}).image_urls.length,maxRefs);
    assert.throws(()=>falImageInput(provider,{...body,urls:Array(maxRefs+1).fill('https://example.com/ref.png')}));
    assert.throws(()=>falImageInput(provider,{...body,count:2}));
    let selected=0;
    for(let i=0;i<10000;i++) {
      const request={operationId:`distribution-${i}`};
      const p={id:route.providerId,kind:'image'};
      const choice=preferFalImageChannel(p,request);
      assert.equal(preferFalImageChannel(p,request),choice);
      if(choice)selected++;
    }
    const expected=route.model==='gpt-image-2'?2000:1000;
    assert.ok(Math.abs(selected-expected)<200,`${route.model}: ${selected}`);
    assert.equal(preferFalImageChannel({id:route.providerId,kind:'image'},{...body,_acceptedTask:{taskId:'accepted'}}),false);

    globalThis.fetch=async(url,options={})=>{
      url=String(url);calls.push({url,method:options.method,body:options.body&&JSON.parse(options.body)});
      if(url.endsWith('/submit')) {
        if(mode==='reject-primary') return json({},429);
        return json({data:{task_id:'primary-task',status:'submitted'}});
      }
      if(url.endsWith('/query')) return json({data:{status:'succeeded',output:['https://cdn.example.com/result.png']}});
      if(url.startsWith('https://queue.fal.run/')) {
        if(options.method==='POST') {
          if(mode==='reject-fal')return json({},429);
          if(mode==='ambiguous')throw new Error('connection lost');
          if(mode==='moderated')return json({},422);
          return json({request_id:'fal-task',response_url:`https://queue.fal.run/fal-ai/${route.model}/requests/fal-task`});
        }
        if(mode==='poll-failed')return json({},503);
        if(url.endsWith('/status'))return json({status:'COMPLETED'});
        return json({images:[{url:'https://cdn.example.com/result.png'}]});
      }
      if(url==='https://cdn.example.com/result.png')return new Response(png);
      throw new Error(`Unexpected request ${url}`);
    };
    const hooks={onAccepted:async task=>{accepted=task;}};
    if (route.model !== 'gpt-image-2') {
      for (const urls of [[], ['https://example.com/ref.png']]) {
        mode='ok'; calls=[];
        assert.deepEqual(await generateMedia('image',{...body,urls},null,hooks),png);
        assert.equal(calls[0].url,'https://aireiter.com/api/openapi/submit','Economy quote must override costly mixed-channel preference');
        assert.equal(accepted.providerId,route.providerId);
        assert.ok(!calls.some(c=>c.url.startsWith('https://queue.fal.run/')));
      }
      mode='reject-primary'; calls=[];
      await assert.rejects(()=>generateMedia('image',body,null,hooks));
      assert.ok(!calls.some(c=>c.url.startsWith('https://queue.fal.run/')),'An outage must not spend beyond the quoted budget');
      mode='ok'; calls=[];
      process.env.FAL_IMAGE_BACKUP_ENABLED='false';
      await recoverMedia('image',body,{providerId:route.id,providerTaskId:'fal-task',pollUrl:`https://queue.fal.run/fal-ai/${route.model}/requests/fal-task/status`},null,hooks);
      assert.equal(calls.filter(c=>c.method==='POST').length,0,'Previously accepted costly tasks remain recoverable after repricing');
      process.env.FAL_IMAGE_BACKUP_ENABLED='true';
      delete process.env.AIREITER_API_KEY; calls=[];
      await assert.rejects(()=>generateMedia('image',body,null,hooks),e=>e.code==='compatible-route-unavailable');
      assert.equal(calls.length,0,'Missing cheap credentials cannot enable a loss-making route');
      process.env.AIREITER_API_KEY='test-primary';
      continue;
    }
    for(const urls of [[],['https://example.com/ref.png']]) {
      mode='ok';calls=[];
      assert.deepEqual(await generateMedia('image',{...body,urls},null,hooks),png);
      assert.equal(calls[0].url,`https://queue.fal.run/fal-ai/${route.model}${urls.length?'/edit':''}`);
      assert.equal(calls.filter(c=>c.method==='POST').length,1);
      assert.equal(accepted.providerId,route.id);
      assert.ok(!JSON.stringify(publicProviderConfig()).includes(route.id));
      process.env.FAL_IMAGE_BACKUP_ENABLED='false';calls=[];
      await recoverMedia('image',{...body,urls},{providerId:accepted.providerId,providerTaskId:accepted.taskId,pollUrl:accepted.pollUrl},null,hooks);
      assert.equal(calls.filter(c=>c.method==='POST').length,0,'Recovery after rollback never submits again');
      process.env.FAL_IMAGE_BACKUP_ENABLED='true';
    }
    for(const fault of ['ambiguous','moderated','poll-failed']) {
      mode=fault;calls=[];
      await assert.rejects(()=>generateMedia('image',body,null,hooks));
      assert.equal(calls.filter(c=>c.method==='POST').length,1,`${fault} must not replay`);
      assert.ok(!calls.some(c=>c.url.endsWith('/submit')));
    }
    mode='ok';calls=[];
    await assert.rejects(()=>generateMedia('image',body,null,{onAccepted:async()=>{throw new Error('storage down');}}),e=>e.providerTaskAccepted===true);
    assert.equal(calls.length,1,'Persistence failure must not replay');
    mode='reject-fal';calls=[];
    await generateMedia('image',body,null,hooks);
    assert.equal(accepted.providerId,route.providerId,'Explicit FAL rejection may use original model');
    assert.equal(calls.filter(c=>c.url.endsWith('/submit')).length,1);
    mode='reject-primary';calls=[];
    await generateMedia('image',bodyFor(route,false),null,hooks);
    assert.equal(accepted.providerId,route.id,'Explicit primary rejection may use FAL');
    assert.ok(calls[0].url.endsWith('/submit'));
    mode='ok';calls=[];
    await assert.rejects(()=>generateFalNano(provider,{...body,_acceptedTask:{taskId:'fal-task',pollUrl:'https://queue.fal.run/fal-ai/wrong-model/requests/fal-task/status'}},null,{},{}));
    assert.equal(calls.length,0,'Stored endpoints cannot poll another model');
    delete process.env.FAL_KEY;calls=[];
    await generateMedia('image',body,null,hooks);
    assert.ok(calls[0].url.endsWith('/submit'),'Missing backup key must leave primary usable');
    process.env.FAL_KEY='test-backup';
    process.env.FAL_IMAGE_BACKUP_ENABLED='false';calls=[];
    await generateMedia('image',body,null,hooks);
    assert.ok(calls[0].url.endsWith('/submit'),'Rollback disables new FAL submissions');
    process.env.FAL_IMAGE_BACKUP_ENABLED='true';
    delete process.env.AIREITER_API_KEY;calls=[];
    await assert.rejects(()=>generateMedia('image',{...body,prompt:'x'},null,hooks),e=>e.code==='invalid-reference-media');
    assert.equal(calls.length,0);
    process.env.AIREITER_API_KEY='test-primary';
  }
  const gpt={id:'fal-backup-gpt-image-2'};
  assert.deepEqual(falImageInput(gpt,{prompt:'test',size:'2K',aspectRatio:'3:2',quality:'high'}).image_size,{width:2048,height:1360});
  assert.deepEqual(falImageInput(gpt,{prompt:'test',size:'4K',aspectRatio:'9:21'}).image_size,{width:1648,height:3840});
  assert.throws(()=>falImageInput(gpt,{prompt:'test',size:'4K',aspectRatio:'1:1'}));
  assert.throws(()=>falImageInput(gpt,{prompt:'test',quality:'auto'}));
  assert.equal(preferFalImageChannel({kind:'video',id:'image-1'},{operationId:'test'}),false);
  for(const percent of ['-1','41','NaN','Infinity']) {
    assert.equal(preferFalImageChannel({kind:'image',id:'image-6'},{operationId:'test'},{...process.env,FAL_GPT_IMAGE_MIX_PERCENT:percent}),false);
  }
  console.log('All public image routes: mapping, mixed distribution, edit, hidden config, rejection fallback, acceptance and rollback recovery passed.');
} finally { globalThis.fetch=originalFetch; }
