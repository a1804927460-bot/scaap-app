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
