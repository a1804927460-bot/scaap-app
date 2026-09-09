'use strict';
const assert=require('node:assert/strict');
const {requestChat}=require('../lib/ai-chat-provider');
const {CHAT_RATES}=require('../lib/chat-rates');
const {calculateChatCost}=require('../lib/chat-cost-pricing');
const c=require('../config/provider-catalog.json');
(async()=>{
 const p=c.providers.find(p=>p.models?.includes('gpt-6-astra'));assert.equal(p.id,'chat-9');
 const answer=await requestChat(async(url,options)=>{
  assert.equal(url,'https://aireiter.com/api/v1/chat/completions');assert.equal(JSON.parse(options.body).model,'gpt-6-astra');
  return new Response(JSON.stringify({choices:[{message:{content:'OK'},finish_reason:'stop'}],usage:{prompt_tokens:21,completion_tokens:5}}),{status:200,headers:{'content-type':'application/json'}});
 },{apiKey:'fixture',chatEndpoint:p.endpoint,chatModel:p.upstreamModels['gpt-6-astra'],returnUsage:true,requireUsage:true},{prompt:'OK'});
 assert.equal(answer.text,'OK');assert.equal(answer.usage.inputTokens,21);
 const rate=CHAT_RATES['gpt-6-astra'];
 assert.equal(calculateChatCost([{inputTokens:272000,outputTokens:0}],rate).upstreamCostCny,5.9568);
 assert.equal(calculateChatCost([{inputTokens:272001,outputTokens:0}],rate).upstreamCostCny,11.9136438);
 assert.equal(calculateChatCost([{inputTokens:1000000,cachedInputTokens:1000000,outputTokens:0}],rate).upstreamCostCny,4.38);
 assert.equal(calculateChatCost([{inputTokens:100,outputTokens:0},{inputTokens:1000000,outputTokens:0}],rate).upstreamCostCny,43.80219);
 console.log('Astra endpoint, model, usage, 272K boundary, cache and per-request tier pricing passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
