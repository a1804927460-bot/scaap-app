'use strict';

// Rates are actual channel costs in CNY per million tokens, never retail prices.
// No guessed defaults: callers must obtain a verified provider/model rate.
function microCny(value) {
  const text = String(value);
  if (!/^\d{1,9}(?:\.\d{1,6})?$/.test(text)) throw new Error('Invalid CNY token rate');
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
}
function tokens(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Token usage must be a nonnegative safe integer');
  return BigInt(value);
}
function calculateChatCost(turns, rates) {
  if (!Array.isArray(turns) || !turns.length || !rates || !rates.source || !rates.verifiedAt) {
    throw new Error('Verified rates and actual usage are required');
  }
  const inputRate = microCny(rates.inputCnyPerMillion);
  const outputRate = microCny(rates.outputCnyPerMillion);
  let numerator = 0n;
  for (const usage of turns) {
    if (!usage) throw new Error('Missing upstream usage');
    const input = tokens(usage.inputTokens), output = tokens(usage.outputTokens);
    const cached = tokens(usage.cachedInputTokens ?? 0);
    if (cached > input) throw new Error('Cached tokens exceed input tokens');
    if (usage.cacheCreationTokens) throw new Error('Cache creation requires a separately verified rate');
    const cachedRate = cached ? microCny(rates.cachedInputCnyPerMillion) : 0n;
    numerator += (input - cached) * inputRate + cached * cachedRate + output * outputRate;
  }
  // numerator / 1e12 is CNY. 1000 credits = CNY 70; cost protection = 1.20.
  // Round upward once for the whole task, to hundredths of a credit.
  const denominator = 7000000000000n;
  const hundredths = (numerator * 12000n + denominator - 1n) / denominator;
  if (hundredths > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Chat charge exceeds safe range');
  return { upstreamCostCny: Number(numerator) / 1e12, credits: Number(hundredths) / 100,
    protectionPercent: 20, profitPercent: 0, rateSource: rates.source, rateVerifiedAt: rates.verifiedAt };
}
module.exports = { calculateChatCost };
