import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {quickRouterImageRoutes,createQuickRouterPriceGuard} from '../src/quickrouter-image-routes.js';
import {generateMedia,recoverMedia} from '../src/providers.js';
import economy from '../../lib/economy-image-routes.js';
const key='test-fixed-group-key';
const profile={group:'Discounted-Banana-1',keySha256:createHash('sha256').update(key).digest('hex'),verifiedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),usdBySize:{'1K':.02},publishedUnitUsd:.1655*.07353,ratios:['auto','1:1','16:9'],maxReferenceImages:0};
const env={QUICKROUTER_BANANA_1_API_KEY:key,QUICKROUTER_IMAGE_VERIFIED_PROFILES:JSON.stringify({'quickrouter-nano-2-1':profile})};
const price={success:true,data:[{model_name:'gemini-3.1-flash-image-preview',quota_type:1,model_price:.1655,enable_groups:['Discounted-Banana-1']}],group_ratio:{'Discounted-Banana-1':.07353}};
const primary={id:'image-2',logicalModel:'nano-banana-2',model:'nano_banana_v2',endpoint:'https://aireiter.com/api/openapi/submit',capabilities:{sizes:['1K','2K','4K'],ratios:['auto','1:1','16:9'],maxReferenceImages:8}};
const png=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.write('IHDR',12);png.writeUInt32BE(1024,16);png.writeUInt32BE(1024,20);
test('QuickRouter routes require fixed-group key, bounded verified cost and unexpired profile',()=>{
 const r=quickRouterImageRoutes(env).find(x=>x.id==='quickrouter-nano-2-1');assert.equal(r.quickRouterVerified,true);
 for(const bad of [{...env,QUICKROUTER_BANANA_1_API_KEY:'replaced-key'},{...env,QUICKROUTER_IMAGE_VERIFIED_PROFILES:'invalid'},{}])assert.ok(quickRouterImageRoutes(bad).every(x=>!x.quickRouterVerified));
 assert.ok(quickRouterImageRoutes(env,Date.now()+8*86400000).every(x=>!x.quickRouterVerified));
 const choose=body=>economy.selectEconomyImageRoutes(primary,[primary,r],body).map(x=>x.id);
 assert.deepEqual(choose({size:'1K'}),[r.id,'image-2']);assert.deepEqual(choose({size:'2K'}),['image-2']);assert.deepEqual(choose({size:'1K',urls:['reference']}),['image-2']);
 assert.deepEqual(economy.selectEconomyImageRoutes(primary,[{...r,quickRouterCosts:{'1K':.5}}],{size:'1K'}),[]);
});
test('Live public price guard rejects changed group price, missing contract and outages before submission',async()=>{
 const r=quickRouterImageRoutes(env).find(x=>x.quickRouterVerified);
 await createQuickRouterPriceGuard({fetchImpl:async()=>Response.json(price)})(r);
 for(const data of [{...price,group_ratio:{'Discounted-Banana-1':1}},{...price,data:[]},{success:false}])await assert.rejects(createQuickRouterPriceGuard({fetchImpl:async()=>Response.json(data)})(r),e=>e.preSubmissionFailure&&e.safeToFallback);
 await assert.rejects(createQuickRouterPriceGuard({fetchImpl:async()=>{throw Error('offline')}})(r),{code:'provider-price-unverified'});
});
test('Verified cheap route generates same model/size; ambiguous acceptance never replays; recovery survives expired profile',async()=>{
 const savedFetch=globalThis.fetch,old={};for(const name of [...Object.keys(env),'AIREITER_API_KEY']){old[name]=process.env[name];process.env[name]=env[name]||'primary-test';}
 try {
  const calls=[];globalThis.fetch=async(url,init={})=>{calls.push({url:String(url),init});if(String(url).endsWith('/api/pricing'))return Response.json(price);return Response.json({candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:png.toString('base64')}}]}}]});};
  let accepted;
  const result=await generateMedia('image',{providerId:'image-2',prompt:'studio still life',size:'1K',aspectRatio:'16:9' },AbortSignal.timeout(5000),{onAccepted:async value=>{accepted=value;}});
  assert.deepEqual(result,png);assert.equal(accepted.providerId,'quickrouter-nano-2-1');
  const submitted=calls.find(c=>c.init.method==='POST');assert.match(submitted.url,/gemini-3\.1-flash-image-preview:generateContent$/);assert.equal(submitted.init.headers.Authorization,'Bearer '+key);assert.equal(JSON.parse(submitted.init.body).generationConfig.imageConfig.imageSize,'1K');assert.ok(!calls.some(c=>c.url.includes('aireiter')));
  let submits=0;globalThis.fetch=async()=>{submits++;throw new TypeError('connection lost');};
  await assert.rejects(generateMedia('image',{providerId:'image-2',prompt:'test',size:'1K'},AbortSignal.timeout(5000)),e=>e.submissionAmbiguous===true);assert.equal(submits,1);
  delete process.env.QUICKROUTER_IMAGE_VERIFIED_PROFILES;
  const recovered=await recoverMedia('image',{providerId:'image-2',size:'1K'},{providerId:'quickrouter-nano-2-1',providerTaskId:'inline:00000000-0000-4000-8000-000000000001',resultUrl:'data:image/png;base64,'+png.toString('base64')},AbortSignal.timeout(5000));
  assert.deepEqual(recovered,png);assert.equal(submits,1);
 }finally{globalThis.fetch=savedFetch;for(const [name,value]of Object.entries(old)){if(value===undefined)delete process.env[name];else process.env[name]=value;}}
});
