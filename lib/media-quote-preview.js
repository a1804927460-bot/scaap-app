'use strict';

// UI estimates only. Generation reservations must use the authoritative path.
function createMediaQuotePreview({localQuote, remoteQuote, scope, ttlMs = 15000, waitMs = 200, now = Date.now}) {
  const cache = new Map();
  return async function preview(request = {}) {
    const fallback = { ...localQuote(request), authoritative: false, quoteSource: 'local' };
    const key = JSON.stringify([scope(), Object.keys(request).sort().map(k => [k, request[k]])]);
    let entry = cache.get(key);
    if (entry && entry.value && entry.expires > now()) return structuredClone(entry.value);
    if (!entry?.pending) {
      if (cache.size >= 128) cache.delete(cache.keys().next().value);
      entry = {};
      cache.set(key, entry);
      entry.pending = Promise.resolve().then(() => remoteQuote(request)).then(value => {
        entry.value = structuredClone(value); entry.expires = now() + ttlMs;
        return value;
      }).catch(() => {
        if (cache.get(key) === entry) cache.delete(key);
        return fallback;
      }).finally(() => { entry.pending = null; });
    }
    let timer;
    try {
      return structuredClone(await Promise.race([
        entry.pending,
        new Promise(resolve => { timer = setTimeout(() => resolve(fallback), waitMs); })
      ]));
    } finally { clearTimeout(timer); }
  };
}
module.exports = {createMediaQuotePreview};
