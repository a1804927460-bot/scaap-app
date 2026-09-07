import { createHash } from 'node:crypto';
import { BrokenCircuitError, CircuitState, ConsecutiveBreaker, DelegateBackoff,
  circuitBreaker, handleWhen, retry } from 'cockatiel';

export function safeRouteFallback(error) {
  return Boolean(error && error.name !== 'AbortError' && error.safeToFallback === true
    && !error.taskId && !error.providerTaskId && !error.providerTaskAccepted && !error.submissionAmbiguous);
}

function transientFailure(error) {
  if (!error || error.name === 'AbortError' || error.providerTaskAccepted) return false;
  return [401, 402, 429].includes(Number(error.status)) || Number(error.status) >= 500
    || /^(provider-)?(timeout|invalid-response|empty-response)$/.test(String(error.code || ''));
}

export function createRouteHealth({ cooldownMs = 2000, exhaustedCooldownMs = 60000, maxEntries = 256 } = {}) {
  const records = new Map();
  function record(provider, model) {
    // Model and credential boundaries matter: one depleted pool must not disable
    // another model on the same upstream, and rotating a key resets its health.
    const key = createHash('sha256').update(JSON.stringify([
      provider.id, provider.endpoint, provider.protocol, model, provider.apiKey
    ])).digest('hex');
    if (records.has(key)) return records.get(key);
    if (records.size >= maxEntries) {
      const idle = [...records].find(([, value]) => value.active === 0 && value.until <= Date.now());
      if (idle) records.delete(idle[0]);
    }
    const value = { until: 0, active: 0, lastSuccessAt: 0, lastFailureAt: 0, latencyMs: 0 };
    value.breaker = circuitBreaker(handleWhen(transientFailure), {
      breaker: new ConsecutiveBreaker(1),
      halfOpenAfter: new DelegateBackoff(({ result }) => {
        const error = result.error;
        const delay = Math.max(cooldownMs, Number(error?.retryAfterMs) || 0,
          error?.upstreamCapacityExhausted || [401, 402].includes(Number(error?.status)) ? exhaustedCooldownMs : 0);
        value.until = Date.now() + Math.min(delay, 24 * 60 * 60 * 1000);
        return value.until - Date.now();
      })
    });
    if (records.size < maxEntries) records.set(key, value);
    return value;
  }
  return {
    prioritize(candidates, identity) {
      const score = candidate => {
        const { provider, model } = identity(candidate);
        const value = record(provider, model), now = Date.now();
        if (value.until > now || value.breaker.state === CircuitState.HalfOpen) return 3;
        if (value.lastFailureAt > value.lastSuccessAt && now - value.lastFailureAt < 120000) return 2;
        if (value.lastSuccessAt && now - value.lastSuccessAt < 300000 && value.latencyMs < 10000) return 0;
        return 1;
      };
      return [...candidates].sort((left, right) => score(left) - score(right));
    },
    async execute(provider, model, operation, signal) {
      signal?.throwIfAborted();
      const value = record(provider, model);
      try {
        // Do not queue user requests behind a half-open probe; let them use
        // another healthy route, never share another user's response.
        if (value.breaker.state === CircuitState.HalfOpen) throw new BrokenCircuitError();
        value.active++;
        const started = Date.now();
        try {
          const result = await value.breaker.execute(operation, signal);
          value.lastSuccessAt = Date.now();
          value.until = 0;
          value.latencyMs = value.latencyMs ? value.latencyMs * 0.5 + (Date.now() - started) * 0.5 : Date.now() - started;
          return result;
        }
        finally { value.active--; }
      } catch (error) {
        if (transientFailure(error)) value.lastFailureAt = Date.now();
        if (!(error instanceof BrokenCircuitError)) throw error;
        throw Object.assign(new Error('The selected route is temporarily cooling down.'), {
          code: 'provider-rate-limited', status: 429, safeToFallback: true,
          routeCoolingDown: true, retryAfterMs: Math.max(cooldownMs, value.until - Date.now())
        });
      }
    }
  };
}

export async function withSafeRouteRetry(operation, signal, { maxWaitMs = 3000, budgetMs = 20000, jitter = Math.random } = {}) {
  const started = Date.now();
  const delayFor = error => Math.max(1000, Number(error?.retryAfterMs) || 2000) + Math.floor(jitter() * 200);
  const policy = retry(handleWhen(error => safeRouteFallback(error)
    && [425, 429, 502, 503, 504].includes(Number(error.status))
    && !error.upstreamCapacityExhausted
    && delayFor(error) <= maxWaitMs && Date.now() - started + delayFor(error) < budgetMs), {
    maxAttempts: 1,
    backoff: new DelegateBackoff(({ result }) => delayFor(result.error))
  });
  return policy.execute(() => { signal?.throwIfAborted(); return operation(); }, signal);
}
