const assert = require('node:assert/strict');
const {calculateChatCost} = require('../lib/chat-cost-pricing');
// Synthetic test rates. These are NOT AI Reiter production prices.
const rates = {inputCnyPerMillion:'7',outputCnyPerMillion:'14',cachedInputCnyPerMillion:'1',source:'test-fixture',verifiedAt:'2026-09-06'};
assert.equal(calculateChatCost([{inputTokens:1000000,outputTokens:0}],rates).credits,110);
assert.equal(calculateChatCost([{inputTokens:0,outputTokens:1000000}],rates).credits,220);
assert.equal(calculateChatCost([{inputTokens:1000000,cachedInputTokens:500000,outputTokens:0}],rates).upstreamCostCny,4);
assert.equal(calculateChatCost([{inputTokens:1,outputTokens:0},{inputTokens:1,outputTokens:0}],rates).credits,.01);
assert.throws(()=>calculateChatCost([null],rates));
assert.throws(()=>calculateChatCost([{inputTokens:1,outputTokens:0,cachedInputTokens:2}],rates));
assert.throws(()=>calculateChatCost([{inputTokens:1,outputTokens:0}],{}));
assert.throws(()=>calculateChatCost([{inputTokens:1,outputTokens:0,cachedInputTokens:1}],{...rates,cachedInputCnyPerMillion:undefined}));
console.log('Chat costs: cost x1.10, no margin, cached tokens, accumulated rounding and missing-price/usage rejection passed.');
