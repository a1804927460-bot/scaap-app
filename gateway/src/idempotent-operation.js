export function createIdempotentOperationRunner({
  ttlMs = 30 * 60_000,
  maxEntries = 200
} = {}) {
  const cache = new Map();

  return function runIdempotentOperation(key, factory) {
    const now = Date.now();
    for (const [entryKey, entry] of cache) {
      if (entry.expiresAt <= now) cache.delete(entryKey);
    }

    const cacheKey = String(key || '');
    const existing = cache.get(cacheKey);
    if (existing) return existing.promise;

    const entry = {
      expiresAt: now + ttlMs,
      promise: null
    };
    entry.promise = Promise.resolve()
      .then(factory)
      .catch((error) => {
        // A failed operation must be retryable. Keep successful results
        // idempotent, but never pin a transient upstream or recovery error.
        if (cache.get(cacheKey) === entry) cache.delete(cacheKey);
        throw error;
      });
    cache.set(cacheKey, entry);
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
    return entry.promise;
  };
}
