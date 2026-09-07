import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { createRouteHealth, safeRouteFallback, withSafeRouteRetry } from '../src/route-resilience.js';
import { chat } from '../src/providers.js';
import { publicGatewayError } from '../src/public-errors.js';
const { requestChat } = createRequire(import.meta.url)('../../lib/ai-chat-provider');
const provider = {id:'test',endpoint:'https://example.com/v1/chat/completions',apiKey:'test-key'};
const config = {chatEndpoint:provider.endpoint,apiKey:provider.apiKey,chatModel:'test'};
const reply = () => Response.json({choices:[{message:{content:'OK'}}],usage:{prompt_tokens:1,completion_tokens:1}});

test('chat recognizes capacity rejection envelopes, preserves Retry-After and never renders errors as replies', async () => {
  for (const status of [200,429,503]) {
    await assert.rejects(requestChat(async()=>Response.json({error:{message:'All available accounts exhausted'}},
      {status,headers:{'Retry-After':'12'}}),config,{prompt:'hello'}),error=>
      error.upstreamCapacityExhausted && safeRouteFallback(error) && error.retryAfterMs===12000);
  }
  await assert.rejects(requestChat(async()=>new Response('<html>busy</html>',{status:429,headers:{'Retry-After':'5'}}),
    config,{prompt:'hello'}),error=>safeRouteFallback(error)&&error.status===429&&error.retryAfterMs===5000);
  await assert.rejects(requestChat(async()=>Response.json({error:{message:'Internal error'}},{status:503}),
    config,{prompt:'hello'}),error=>error.submissionAmbiguous&&!safeRouteFallback(error));
  await assert.rejects(requestChat(async()=>Response.json({task_id:'accepted',error:{message:'All available accounts exhausted'}},{status:429}),
    config,{prompt:'hello'}),error=>error.providerTaskAccepted&&!safeRouteFallback(error));
  await assert.rejects(requestChat(async()=>Response.json({error:{message:'Blocked content by safety policy'}},{status:403}),
    config,{prompt:'hello'}),error=>error.code==='reference-policy-rejected'&&!safeRouteFallback(error));
});

test('circuit cooldown is model/key scoped, allows recovery probes and prioritizes healthy routes', async () => {
  const health=createRouteHealth({cooldownMs:15,exhaustedCooldownMs:25});
  const rejected=()=>Object.assign(new Error('busy'),{status:429,safeToFallback:true});
  let calls=0;
  await assert.rejects(health.execute(provider,'flash',()=>{calls++;throw rejected();}));
  await assert.rejects(health.execute(provider,'flash',()=>{calls++;}),error=>error.routeCoolingDown);
  assert.equal(calls,1);
  await health.execute(provider,'sol',async()=>'OK');
  await health.execute({...provider,apiKey:'rotated'},'flash',async()=>'OK');
  assert.deepEqual(health.prioritize(['flash','sol'],model=>({provider,model})),['sol','flash']);
  await new Promise(resolve=>setTimeout(resolve,20));
  let resolveProbe;
  const probe=health.execute(provider,'flash',()=>new Promise(resolve=>{resolveProbe=resolve;}));
  await assert.rejects(health.execute(provider,'flash',async()=>'other user'),error=>error.routeCoolingDown);
  resolveProbe('probe');assert.equal(await probe,'probe');
  assert.equal(await health.execute(provider,'flash',async()=>'own reply'),'own reply');
});

test('safe retries are bounded and do not retry accepted, ambiguous, exhausted or long Retry-After requests', async () => {
  let count=0;
  assert.equal(await withSafeRouteRetry(()=>{if(++count===1)throw Object.assign(new Error('busy'),{status:429,safeToFallback:true,retryAfterMs:1});return 'OK';},undefined,{jitter:()=>0}), 'OK');
  assert.equal(count,2);
  for(const metadata of [{providerTaskAccepted:true},{submissionAmbiguous:true},{taskId:'accepted'},
    {upstreamCapacityExhausted:true},{retryAfterMs:60000}]) {
    count=0;
    await assert.rejects(withSafeRouteRetry(()=>{count++;throw Object.assign(new Error('busy'),{status:429,safeToFallback:true,...metadata});}));
    assert.equal(count,1);
  }
});

test('automatic chat bypasses depleted models on later requests; manual models never change silently', async () => {
  const savedKey=process.env.AIREITER_API_KEY, savedFetch=globalThis.fetch;
  process.env.AIREITER_API_KEY='resilience-test-'+Date.now();
  const calls=[];
  globalThis.fetch=async(url,options)=>{
    const body=JSON.parse(options.body);calls.push(body.model);
    return body.model==='chat-gpt-5.6-sol'?reply():Response.json({error:{message:'All available accounts exhausted'}},{status:429});
  };
  try {
    assert.equal((await chat({routingStrategy:'balanced',prompt:'hello',operationId:'test-auto-1'})).text,'OK');
    assert.deepEqual(calls,['chat-gemini-3.8-flash','chat-gemini-3.1-pro','chat-gpt-5.6-sol']);
    calls.length=0;
    assert.equal((await chat({routingStrategy:'fast',prompt:'hello',operationId:'test-auto-2'})).text,'OK');
    assert.deepEqual(calls,['chat-gpt-5.6-sol']);
    calls.length=0;
    await assert.rejects(chat({providerId:'chat-6',model:'gemini-3.8-flash',prompt:'hello'}),error=>error.routeCoolingDown);
    assert.deepEqual(calls,[]);
  } finally {
    globalThis.fetch=savedFetch;
    if(savedKey===undefined)delete process.env.AIREITER_API_KEY;else process.env.AIREITER_API_KEY=savedKey;
  }
});

test('chat errors do not promise media recovery or held credits', () => {
  const chatError=publicGatewayError(Object.assign(new Error('timeout'),{operationKind:'chat',submissionAmbiguous:true,status:503}));
  assert.equal(chatError.code,'chat-response-unavailable');
  assert.doesNotMatch(chatError.message,/recover|points|held/i);
  assert.equal(publicGatewayError({operationKind:'chat',status:429}).code,'chat-service-busy');
  assert.equal(publicGatewayError({submissionAmbiguous:true,status:503}).code,'provider-task-recovery-pending');
});

test('cold automatic routes use verified availability order without changing manual models or overriding health', async () => {
  const savedKey=process.env.AIREITER_API_KEY, savedOrder=process.env.MESSS_CHAT_COLD_ROUTE_ORDER, savedFetch=globalThis.fetch;
  process.env.AIREITER_API_KEY='cold-route-test-'+Date.now();
  process.env.MESSS_CHAT_COLD_ROUTE_ORDER='missing, chat-4,chat-4,chat-3,chat-6';
  const calls=[];
  let solAvailable=true;
  globalThis.fetch=async(_url,options)=>{
    const body=JSON.parse(options.body);calls.push(body.model);
    return body.model==='chat-gpt-5.6-sol' && !solAvailable
      ? Response.json({error:{message:'All available accounts exhausted'}},{status:429}) : reply();
  };
  try {
    assert.equal((await chat({routingStrategy:'fast',prompt:'hello'})).text,'OK');
    assert.deepEqual(calls,['chat-gpt-5.6-sol']);
    calls.length=0;
    assert.equal((await chat({providerId:'chat-6',model:'gemini-3.8-flash',prompt:'hello'})).text,'OK');
    assert.deepEqual(calls,['chat-gemini-3.8-flash']);
    calls.length=0;solAvailable=false;
    assert.equal((await chat({routingStrategy:'fast',prompt:'hello'})).text,'OK');
    assert.equal(calls[0],'chat-gpt-5.6-sol');
    assert.equal(calls.at(-1),'chat-gemini-3.8-flash');
    calls.length=0;
    assert.equal((await chat({routingStrategy:'fast',prompt:'hello'})).text,'OK');
    assert.deepEqual(calls,['chat-gemini-3.8-flash']);
  } finally {
    globalThis.fetch=savedFetch;
    if(savedKey===undefined)delete process.env.AIREITER_API_KEY;else process.env.AIREITER_API_KEY=savedKey;
    if(savedOrder===undefined)delete process.env.MESSS_CHAT_COLD_ROUTE_ORDER;else process.env.MESSS_CHAT_COLD_ROUTE_ORDER=savedOrder;
  }
});

test('an interrupted streamed automatic request is not replayed to another model', async () => {
  const savedKey=process.env.AIREITER_API_KEY,savedFetch=globalThis.fetch;
  process.env.AIREITER_API_KEY='stream-route-test-'+Date.now();
  let calls=0;
  globalThis.fetch=async()=>{
    calls++;
    return new Response('data: {"choices":[{"index":0,"delta":{"content":"partial"}}]}\n\n', {headers:{'Content-Type':'text/event-stream'}});
  };
  try {
    const parts=[];
    await assert.rejects(chat({routingStrategy:'fast',prompt:'hello'},undefined,text=>parts.push(text)),error=>error.providerTaskAccepted);
    assert.equal(calls,1);
    assert.deepEqual(parts,['partial']);
  } finally {
    globalThis.fetch=savedFetch;
    if(savedKey===undefined)delete process.env.AIREITER_API_KEY;else process.env.AIREITER_API_KEY=savedKey;
  }
});
