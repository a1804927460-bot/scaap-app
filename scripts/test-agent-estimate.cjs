const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {estimateAgentCredits}=require('../lib/agent-credit-estimate');
for(const chatModel of ['gemini-3.8-flash','gemini-3.1-pro','gpt-5.6-sol']) {
  const quote=estimateAgentCredits({chatModel,prompt:'test'});
  assert.equal(quote.available,true);
  assert.equal(quote.scope,'initial-response');
  assert.ok(quote.min>=0 && quote.max>=quote.min);
}
assert.equal(estimateAgentCredits({chatModel:'unpriced'}).available,false);
for (const [routingStrategy,prompt,chatModel] of [
  ['auto','Write a short caption','gemini-3.8-flash'],
  ['auto','Analyze this report','gemini-3.1-pro'],
  ['ultimate','Analyze this report','gpt-5.6-sol'],
  ['auto','Review the architecture','gpt-5.6-sol']
]) {
  const routed=estimateAgentCredits({routingStrategy,prompt}), manual=estimateAgentCredits({chatModel,prompt});
  assert.equal(routed.model,manual.model);assert.equal(routed.min,manual.min);assert.ok(routed.max>=manual.max);
}
const followUp={prompt:'continue',messages:[{role:'user',content:'Review the architecture'}]};
assert.deepEqual(estimateAgentCredits({...followUp,routingStrategy:'auto'}),
  estimateAgentCredits({...followUp,chatModel:'gpt-5.6-sol'}));
assert.deepEqual(estimateAgentCredits({chatModel:'gpt-5.6-sol',attachmentFileIds:['a','a']}),
  estimateAgentCredits({chatModel:'gpt-5.6-sol',attachmentFileIds:['a']}));
assert.deepEqual(estimateAgentCredits({chatModel:'gpt-5.6-sol',messages:[{content:[{type:'text',text:'hello'}]}]}),
  estimateAgentCredits({chatModel:'gpt-5.6-sol',messages:[{content:'hello'}]}));

const short=estimateAgentCredits({chatModel:'gpt-6-astra',messages:[{role:'user',content:'hello'}]});
const long=estimateAgentCredits({chatModel:'gpt-6-astra',messages:[{role:'user',content:'x'.repeat(300000)},...Array.from({length:30},()=>({role:'assistant',content:'recent'}))]});
assert.ok(long.max>short.max*10,'History before the last 19 messages must be included, including long-context tier');
assert.equal(estimateAgentCredits({chatModel:'gpt-6-astra',attachmentFileIds:['document']}).available,false);
const attachment=estimateAgentCredits({chatModel:'gpt-6-astra',attachmentsResolved:true,messages:[{role:'user',content:'hello',attachments:[{kind:'file',content:'z'.repeat(50000)}]}]});
assert.ok(attachment.max>short.max,'Resolved document content contributes to the preview');
const code=fs.readFileSync('src/js/composer-actions.js','utf8').split('window.MesssComposerActions =')[0];
async function check(mode,language='en') {
  let completeQuote,completeChat,calls=0;
  const pending={isConnected:true,dataset:{},classList:{remove(){}},removeAttribute(name){delete this[name];}};
  const context=vm.createContext({
    crypto:require('node:crypto'),
    document:{createElement:()=>({})},t:(en,zh)=>language==='zh'?zh:en,
    window:{messsAPI:{
      estimateAgentCredits:()=>{if(mode==='throw')throw Error('unavailable');return new Promise(resolve=>{completeQuote=resolve;});},
      chatWithAi:()=>{calls++;return new Promise(resolve=>{completeChat=resolve;});}
    }}
  });
  vm.runInContext(code,context);
  const task=context.chatWithAgentEstimate(pending,{});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,1);
  if(mode==='quote') {
    completeQuote({available:true,min:0.06,max:1.64});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(pending.dataset.creditEstimate,language==='zh'?'首轮预计 0.06 - 1.64 积分；工具和续写另计':'First reply estimate 0.06 - 1.64 credits; tools and continuations extra');
    assert.equal(pending.title,undefined,'Internal pricing must not be exposed in a tooltip');
  }
  completeChat({ok:true});await task;
  completeQuote?.({available:true,min:1,max:2});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(pending.dataset.creditEstimate,undefined,'Late estimates must not reappear');
  assert.equal(pending.title,undefined);
}
(async()=>{await check('late');await check('throw');await check('quote');await check('quote','zh');console.log('Agent estimate labels, pricing scope, failure isolation and late-response cleanup passed.');})().catch(error=>{console.error(error);process.exitCode=1;});
