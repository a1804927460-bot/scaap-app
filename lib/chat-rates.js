'use strict';

// AI Reiter market SKU cents per million tokens, verified 2026-09-07.
// Keep estimates and authoritative settlement on the same versioned rate set.
const CHAT_RATE_VERSION = '20260907';
const rows = {
  'gemini-3.8-flash': [1.6425, 8.2125, 0.16425],
  'gemini-3.1-pro': [4.38, 26.28, 0.438],
  'gpt-5.6-sol': [8.76, 43.8, 0.876],
  'kimi-k3': [10.95, 54.75, 1.095]
};
const CHAT_RATES = Object.freeze(Object.fromEntries(Object.entries(rows).map(([model, values]) => [model,
  Object.freeze({ inputCnyPerMillion: values[0], outputCnyPerMillion: values[1],
    cachedInputCnyPerMillion: values[2], source: 'https://aireiter.com/market',
    verifiedAt: '2026-09-07', version: CHAT_RATE_VERSION })
])));
module.exports = { CHAT_RATES, CHAT_RATE_VERSION };
