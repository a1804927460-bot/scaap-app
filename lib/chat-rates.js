'use strict';

// AI Reiter market SKU cents per million tokens, verified 2026-09-07.
// Keep estimates and authoritative settlement on the same versioned rate set.
const CHAT_RATE_VERSION = '20260909';
const rows = {
  'gemini-3.8-flash': [1.6425, 8.2125, 0.16425],
  'gemini-3.1-pro': [4.38, 26.28, 0.438],
  'gpt-5.6-sol': [8.76, 43.8, 0.876],
  'kimi-k3': [10.95, 54.75, 1.095],
  'deepseek-v4-flash': [0.3066, 0.6132, 0.006132],
  'deepseek-v4-pro': [0.95265, 1.9053, 0.0079424],
  'gpt-6-astra': [21.9, 109.5, 2.19]
};
const CHAT_RATES = Object.freeze(Object.fromEntries(Object.entries(rows).map(([model, values]) => [model,
  Object.freeze({ inputCnyPerMillion: values[0], outputCnyPerMillion: values[1],
    cachedInputCnyPerMillion: values[2], source: 'https://aireiter.com/market',
    ...(model === 'gpt-6-astra' ? {longContext: Object.freeze({aboveInputTokens:272000,
      inputCnyPerMillion:43.8, outputCnyPerMillion:164.25, cachedInputCnyPerMillion:4.38})} : {}),
    verifiedAt: model.startsWith('deepseek-v4-') || model === 'gpt-6-astra' ? '2026-09-09' : '2026-09-07', version: CHAT_RATE_VERSION })
])));
module.exports = { CHAT_RATES, CHAT_RATE_VERSION };
