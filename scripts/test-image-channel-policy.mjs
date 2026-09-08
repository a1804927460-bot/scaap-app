import assert from 'node:assert/strict';
import {selectImageChannel,recordImageChannelResult} from '../gateway/src/image-channel-policy.js';
const provider={id:'image-5',kind:'image',protocol:'aireiter-async',endpoint:'https://aireiter.com/api/openapi/submit',model:'nano_banana_v2_max'};
const env={AIREITER_IMAGE_PLUS_PERCENT:'60',AIREITER_IMAGE_ROUTING_SECRET:'test-only-secret-with-at-least-32-characters'};
let selected=0, example;
for(let i=0;i<10000;i++){
  const body={operationId:`request-${i}`,size:'4K',aspectRatio:'16:9',urls:['reference']};
  const route=selectImageChannel(provider,body,env,1000);
  if(route.model.endsWith('_plus')) {selected++;example=body;}
  assert.equal(route.model,selectImageChannel(provider,body,env,1000).model);
  assert.equal(body.size,'4K');assert.equal(route.id,provider.id);
}
assert.ok(selected>5800&&selected<6200,`Unexpected distribution: ${selected}`);
assert.equal(selectImageChannel(provider,example,{}),provider);
for (const percent of ['0', '-1', '61', '100', 'NaN', 'Infinity']) {
  assert.equal(selectImageChannel(provider,example,{...env,AIREITER_IMAGE_PLUS_PERCENT:percent}),provider);
}
assert.equal(selectImageChannel(provider,{...example,_acceptedTask:{taskId:'accepted'}},env),provider);
assert.equal(selectImageChannel(provider,{},env),provider);
for(const model of ['gpt_image_2_official','nano_banana_pro','other']){
  const unchanged={...provider,model};assert.equal(selectImageChannel(unchanged,example,env),unchanged);
}
const video={...provider,kind:'video'};assert.equal(selectImageChannel(video,example,env),video);
for(let i=0;i<3;i++)recordImageChannelResult('nano_banana_v2_plus',new Error('capacity'),1000+i);
assert.equal(selectImageChannel(provider,example,env,2000),provider);
assert.equal(selectImageChannel(provider,example,env,700000).model,'nano_banana_v2_plus');
recordImageChannelResult('nano_banana_v2_plus',null);
console.log(`Image channel policy passed: ${selected}/10000 canary assignments, stable identity, unchanged parameters, disabled default, 60% cap, recovery bypass, circuit cooldown, GPT/video unchanged.`);
