const assert = require('node:assert/strict');
const {resolveAgentRoute, windowAgentMessages} = require('../lib/agent-routing');
const policy = require('../config/agent-routing.json');
const providers = Object.values(policy.models).map((model,index)=>({id:`p${index}`,models:[model]}));
const route = (strategy,prompt) => resolveAgentRoute({strategy,prompt,providers});
for (const strategy of ['fast','balanced','ultimate']) assert.equal(route(strategy,'hello').model,policy.models.light);
assert.equal(route('balanced','implement python code').model,policy.models.standard);
assert.equal(route('balanced','concurrency architecture refactor').model,policy.models.advanced);
assert.equal(route('fast','concurrency architecture refactor').model,policy.models.standard);
assert.equal(route('ultimate','implement python code').model,policy.models.advanced);
assert.equal(resolveAgentRoute({strategy:'balanced',prompt:'continue',providers,messages:[{role:'user',content:'architecture refactor'}]}).model,policy.models.advanced);
assert.equal(route(null,'hello'),null,'manual model is not rerouted');
assert.equal(route('__proto__','hello'),null);
assert.throws(()=>resolveAgentRoute({strategy:'balanced',prompt:'hello',providers:[]}),/No configured/);
assert.throws(()=>resolveAgentRoute({strategy:'fast',prompt:'hello',providers:[{...providers[0],hidden:true}]}));
const messages=[{role:'system',content:'trusted'}, {role:'user',content:'old'.repeat(100)},
  {role:'assistant',content:'old answer'}, {role:'user',content:'latest'}, {role:'assistant',content:'tool call'},
  {role:'user',hostToolResult:true,content:'tool output'}];
const window = windowAgentMessages(messages,180);
assert.deepEqual(window.messages,[messages[0],...messages.slice(3)]);
assert.equal(window.droppedMessages,2);
assert.throws(()=>windowAgentMessages(messages,50),/exceeds/);
assert.equal(messages.length,6,'transcript remains intact');
console.log('Agent policies and context windows passed: task tiers, manual selection, unavailable routes, complete tool turns, retained system prompt and budget rejection.');

const longHistory = [{role:'system',content:'trusted policy'}];
for(let i=0;i<30;i++) longHistory.push({role:'user',content:(i===0?'Project delivery Friday. ':'Request '+i+' ')+ 'detail '.repeat(180)}, {role:'assistant',content:'Proposed, not completed. '+ 'response '.repeat(80)});
longHistory.push({role:'user',content:'Continue with the revised deadline.'});
const preserved = windowAgentMessages(longHistory,12000);
assert.ok(preserved.estimatedTokens <= 12000);
assert.ok(preserved.historyExcerptMessages > 0);
assert.equal(preserved.messages[0],longHistory[0]);
assert.match(preserved.messages[1].content,/Project delivery Friday/);
assert.equal(preserved.messages.at(-1),longHistory.at(-1));
assert.equal(longHistory.length,62);
assert.deepEqual(windowAgentMessages([{role:'user',content:'New conversation'}],12000).messages,[{role:'user',content:'New conversation'}]);
console.log('Long history excerpts retain original requirements within budget without crossing conversations.');

require('../src/js/ai-provider-options');
const options=global.MesssAiProviderOptions;
for (const [model,strategy] of [['gemini-3.8-flash','fast'],['gemini-3.1-pro','balanced'],['gpt-5.6-sol','ultimate']]) {
  assert.equal(options.routingStrategy(model,true),strategy);
  assert.equal(options.routingStrategy(model,false),null);
  assert.equal(resolveAgentRoute({strategy:options.routingStrategy(model,true),prompt:'你是谁',providers}).model,policy.models.light);
}
assert.equal(options.routingStrategy('unknown',true),null);
console.log('Preset selections preserve fast/balanced/ultimate and manual model choice.');
