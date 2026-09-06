'use strict';
const defaultPolicy = require('../config/agent-routing.json');

function classifyTask(prompt) {
  const text = String(prompt || '').slice(0,24000);
  const complex = /architecture|refactor|migration|concurren|security audit|multi.step|\u67b6\u6784|\u91cd\u6784|\u8fc1\u79fb|\u5e76\u53d1|\u5b89\u5168\u5ba1\u8ba1|\u591a\u6b65\u9aa4|\u6df1\u5ea6\u4fee\u590d/i.test(text);
  const technical = /\b(code|debug|implement|sql|python|javascript|analy[sz]e|report)\b|\u4ee3\u7801|\u7f16\u7a0b|\u5206\u6790|\u62a5\u8868|\u8c03\u8bd5|\u5efa\u6a21|\u751f\u6210.*3d/i.test(text);
  return complex || text.length > 6000 ? 2 : technical || text.length > 1200 ? 1 : 0;
}

function resolveAgentRoute({strategy, prompt, messages = [], providers, policy = defaultPolicy}) {
  if (!Object.hasOwn(policy.strategies, strategy || '')) return null;
  const followUp = /^(continue|go on|fix it|\u7ee7\u7eed|\u63a5\u7740|\u4fee\u590d\u4e00\u4e0b)[.!\u3002\s]*$/i.test(String(prompt || '').trim());
  const recent = followUp ? messages.filter(message=>message.role === 'user' && !message.hostToolResult).slice(-4).map(message=>message.content).join('\n') : '';
  const complexity = Math.max(classifyTask(prompt),classifyTask(recent));
  const tier = policy.strategies[strategy][complexity];
  const model = policy.models[tier];
  const provider = providers.find(entry => !entry.hidden && entry.available !== false
    && entry.models?.includes(model));
  if (!provider) throw Object.assign(new Error('No configured model is available for this Agent strategy.'), {code:'agent-route-unavailable'});
  return {providerId:provider.id,model,strategy,complexity,policyVersion:policy.version};
}

// Conservative budgeting, not billable usage. UTF-8 bytes overestimate typical
// text tokens and reserve additional space for image payloads without counting base64.
function estimateMessageTokens(message) {
  return 16 + Buffer.byteLength(String(message.content || ''),'utf8')
    + (message.images?.length || 0) * 4096
    + (message.attachments || []).reduce((sum,file)=>sum+Buffer.byteLength(String(file.content || ''),'utf8')+64,0);
}

function windowAgentMessages(messages, budget = defaultPolicy.contextTokenBudget) {
  if (!Number.isSafeInteger(budget) || budget < 1) throw new Error('Invalid context budget');
  const system = messages.filter(message=>message.role === 'system');
  const history = messages.filter(message=>message.role !== 'system');
  // Evict complete user/assistant turns, not individual halves of a tool exchange.
  const turns = [];
  for (const message of history) {
    if ((message.role === 'user' && message.hostToolResult !== true) || !turns.length) turns.push([]);
    turns[turns.length-1].push(message);
  }
  let used = system.reduce((sum,message)=>sum+estimateMessageTokens(message),0);
  const kept = [];
  for (let index=turns.length-1;index>=0;index--) {
    const cost = turns[index].reduce((sum,message)=>sum+estimateMessageTokens(message),0);
    if (used + cost > budget) {
      if (!kept.length) throw Object.assign(new Error('The current task exceeds the context budget. Reduce attachments or split the task.'),{code:'agent-context-too-large'});
      break;
    }
    kept.unshift(...turns[index]); used += cost;
  }
  while (kept[0]?.role === 'assistant') kept.shift();
  return {messages:[...system,...kept],estimatedTokens:used,droppedMessages:messages.length-system.length-kept.length};
}

module.exports = {classifyTask,resolveAgentRoute,windowAgentMessages};
