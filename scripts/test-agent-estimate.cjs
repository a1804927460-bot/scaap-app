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
    assert.equal(pending.dataset.creditEstimate,language==='zh'?'预计 0.06 - 1.64 积分':'Estimated 0.06 - 1.64 credits');
    assert.equal(pending.title,undefined,'Internal pricing must not be exposed in a tooltip');
  }
  completeChat({ok:true});await task;
  completeQuote?.({available:true,min:1,max:2});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(pending.dataset.creditEstimate,undefined,'Late estimates must not reappear');
  assert.equal(pending.title,undefined);
}
(async()=>{await check('late');await check('throw');await check('quote');await check('quote','zh');console.log('Agent estimate labels, pricing scope, failure isolation and late-response cleanup passed.');})().catch(error=>{console.error(error);process.exitCode=1;});
