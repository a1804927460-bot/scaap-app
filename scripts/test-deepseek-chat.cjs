const assert=require('node:assert/strict');
const {requestChat}=require('../lib/ai-chat-provider');
const {CHAT_RATES}=require('../lib/chat-rates');
const {calculateChatCost}=require('../lib/chat-cost-pricing');
const catalog=require('../config/provider-catalog.json');
(async()=>{
 for(const model of ['deepseek-v4-flash','deepseek-v4-pro']){
  const provider=catalog.providers.find(p=>p.models?.includes(model));assert.ok(provider&&!provider.hidden);
  const result=await requestChat(async(url,options)=>{
   assert.equal(url,'https://aireiter.com/api/v1/messages');const body=JSON.parse(options.body);
   assert.equal(body.model,model);assert.equal(body.system,'System instructions');assert.equal(options.headers['anthropic-version'],'2023-06-01');
   return new Response(JSON.stringify({type:'message',content:[{type:'text',text:'OK'}],stop_reason:'end_turn',usage:{input_tokens:10,output_tokens:2,cache_read_input_tokens:4}}),{status:200,headers:{'content-type':'application/json'}});
  },{apiKey:'test-key',chatEndpoint:provider.endpoint,chatModel:provider.upstreamModels[model],returnUsage:true,requireUsage:true},{prompt:'hello',messages:[{role:'system',content:'System instructions'},{role:'user',content:'hello'}]});
  assert.equal(result.text,'OK');assert.equal(result.usage.inputTokens,14);assert.equal(result.usage.cachedInputTokens,4);
 }
 assert.equal(calculateChatCost([{inputTokens:1000000,cachedInputTokens:1000000,outputTokens:0}],CHAT_RATES['deepseek-v4-pro']).upstreamCostCny,0.0079424);
 console.log('DeepSeek Messages protocol, model IDs, cached usage and exact seven-decimal pricing passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
