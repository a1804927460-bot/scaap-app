const assert = require('node:assert/strict');
const {calculateChatCost} = require('../lib/chat-cost-pricing');
// Synthetic test rates. These are NOT AI Reiter production prices.
const rates = {inputCnyPerMillion:'7',outputCnyPerMillion:'14',cachedInputCnyPerMillion:'1',source:'test-fixture',verifiedAt:'2026-09-06'};
assert.equal(calculateChatCost([{inputTokens:1000000,outputTokens:0}],rates).credits,120);
assert.equal(calculateChatCost([{inputTokens:0,outputTokens:1000000}],rates).credits,240);
assert.equal(calculateChatCost([{inputTokens:1000000,cachedInputTokens:500000,outputTokens:0}],rates).upstreamCostCny,4);
assert.equal(calculateChatCost([{inputTokens:1,outputTokens:0},{inputTokens:1,outputTokens:0}],rates).credits,.01);
assert.throws(()=>calculateChatCost([null],rates));
assert.throws(()=>calculateChatCost([{inputTokens:1,outputTokens:0,cachedInputTokens:2}],rates));
assert.throws(()=>calculateChatCost([{inputTokens:1,outputTokens:0}],{}));
assert.throws(()=>calculateChatCost([{inputTokens:1,outputTokens:0,cachedInputTokens:1}],{...rates,cachedInputCnyPerMillion:undefined}));
assert.equal(calculateChatCost([{inputTokens:1000000,outputTokens:0}],rates).protectionPercent,20);
assert.throws(()=>calculateChatCost([{inputTokens:1,outputTokens:0,cacheCreationTokens:1}],rates));
assert.throws(()=>calculateChatCost([{inputTokens:-1,outputTokens:0}],rates));
assert.throws(()=>calculateChatCost([{inputTokens:1.5,outputTokens:0}],rates));
assert.throws(()=>calculateChatCost([],rates));
// Verified base channel rates converted at the product's existing USD/CNY 7.3.
const channelRates = [
  ['1.6425','8.2125','0.16425',28.16,140.79],
  ['4.38','26.28','0.438',75.09,450.52],
  ['8.76','43.8','0.876',150.18,750.86],
];
for (const [input,output,cached,expectedInput,expectedOutput] of channelRates) {
  const verified = {inputCnyPerMillion:input,outputCnyPerMillion:output,
    cachedInputCnyPerMillion:cached,source:'https://aireiter.com/market',verifiedAt:'2026-09-07'};
  assert.equal(calculateChatCost([{inputTokens:1000000,outputTokens:0}],verified).credits,expectedInput);
  assert.equal(calculateChatCost([{inputTokens:0,outputTokens:1000000}],verified).credits,expectedOutput);
  const all = calculateChatCost([{inputTokens:600,outputTokens:900},{inputTokens:700,outputTokens:800}],verified);
  const merged = calculateChatCost([{inputTokens:1300,outputTokens:1700}],verified);
  assert.equal(all.credits,merged.credits);
}
console.log('Chat costs: cost x1.20, no margin, cached tokens, accumulated rounding and missing-price/usage rejection passed.');
