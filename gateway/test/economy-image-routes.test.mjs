import test from 'node:test';
import assert from 'node:assert/strict';
import economy from '../../lib/economy-image-routes.js';

const primary = {id:'image-2',logicalModel:'nano-banana-2',model:'nano_banana_v2',endpoint:'https://aireiter.com/api/openapi/submit',capabilities:{sizes:['1K','2K','4K'],ratios:['auto','1:1','16:9'],maxReferenceImages:8}};
const fal = {...primary,id:'fal-backup-nano-2',endpoint:'https://queue.fal.run/fal-ai/nano-banana-2'};
const select = (routes, body={}, prices) => economy.selectEconomyImageRoutes(primary,routes,body,prices).map(r=>r.id);

test('ordinary GPT 2.5 retains all published resolutions and only admits routes that preserve the target margin',()=>{
  const gpt={...primary,id:'image-19',logicalModel:'gpt-image-2.5',model:'gpt_image_2_5_flare'};
  const backup={...gpt,id:'fal-backup-gpt-image-25-flare',endpoint:'https://queue.fal.run/openai/gpt-image-2.5/flare'};
  for(const size of ['1K','2K','4K']) {
    assert.deepEqual(economy.selectEconomyImageRoutes(gpt,[gpt],{size,aspectRatio:'1:1'}).map(r=>r.id),['image-19']);
    assert.deepEqual(economy.selectEconomyImageRoutes(gpt,[gpt],{size},{'image-19':{[size]:1}}),[]);
  }
  assert.deepEqual(economy.selectEconomyImageRoutes(gpt,[backup],{size:'1K'}).map(route=>route.id),['fal-backup-gpt-image-25-flare']);
  assert.deepEqual(economy.selectEconomyImageRoutes(gpt,[gpt],{size:'8K'}),[]);
});

test('verified high-cost backups never enter an economy quote, regardless of candidate order',()=>{
  for(const size of ['1K','2K','4K']) assert.deepEqual(select([fal,primary],{size}),['image-2']);
  assert.deepEqual(select([fal],{size:'4K'}),[]);
});

test('capability selection can choose another upstream without changing dimensions or references',()=>{
  // Synthetic prices exercise ordering independently of current public tariffs.
  const prices={nano_banana_v2:{'2K':0.03},'fal-backup-nano-2':{'2K':0.025}};
  assert.deepEqual(select([primary,fal],{size:' 2k '},prices),['fal-backup-nano-2','image-2']);
  const narrow={...primary,capabilities:{...primary.capabilities,sizes:['1K']}};
  assert.deepEqual(select([narrow,fal],{size:'2K',urls:['https://example.com/ref.png']},prices),['fal-backup-nano-2']);
  assert.deepEqual(select([primary,fal],{size:'8K'},prices),[]);
  assert.deepEqual(select([primary,fal],{urls:Array(9).fill('ref')},prices),[]);
});

test('same transport, unverified host, unsupported ratio and non-edit routes are excluded',()=>{
  assert.deepEqual(select([{...primary,logicalModel:'nano-banana-pro'}]),[]);
  assert.deepEqual(select([{...primary,endpoint:'https://unknown.example/api'}]),[]);
  assert.deepEqual(select([primary],{ratio:'7:1'}),[]);
  assert.deepEqual(select([{...primary,capabilities:{...primary.capabilities,supportsEdit:false}}],{urls:['ref']}),[]);
});
