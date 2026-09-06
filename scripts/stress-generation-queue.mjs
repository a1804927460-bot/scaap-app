import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { FairConcurrencyGate } from '../gateway/src/fair-concurrency-gate.js';
const require = createRequire(import.meta.url);
const { AiGatewayClient } = require('../lib/ai-gateway-client');
const gate = new FairConcurrencyGate({ maxConcurrent: 8, maxPerKey: 2, maxQueue: 2500, timeoutMs: 60000 });
const perUser = new Map();
let active = 0;
let peak = 0;
const start = performance.now();
const completed = await Promise.all(Array.from({ length: 2000 }, (_, id) => {
  const owner = `user-${id % 100}`;
  return gate.run(owner, async () => {
    active++;
    peak = Math.max(peak, active);
    perUser.set(owner, (perUser.get(owner) || 0) + 1);
    assert.ok(active <= 8);
    assert.ok(perUser.get(owner) <= 2);
    await new Promise(resolve => setTimeout(resolve, 2));
    active--;
    perUser.set(owner, perUser.get(owner) - 1);
    return id;
  });
}));
assert.equal(new Set(completed).size, 2000);
assert.equal(gate.active, 0);
assert.equal(gate.queued, 0);
assert.equal(gate.queues.size, 0);
assert.equal(gate.activeByKey.size, 0);
assert.equal(gate.roundRobinKeys.length, 0);

const identities = [];
const client = Object.create(AiGatewayClient.prototype);
client.request = async (_path, options) => {
  identities.push(options.operationId);
  if (identities.length === 1) throw Object.assign(new Error('queue full'), {
    status: 429, code: 'gateway-queue-full', retryAfterMs: 1
  });
  return 'delivered';
};
assert.equal(await client.idempotentPaidRequest('/v1/media/image'), 'delivered');
assert.equal(new Set(identities).size, 1);
console.log(JSON.stringify({ tasks: completed.length, users: 100, peak, queueRemaining: gate.queued,
  elapsedMs: Math.round(performance.now() - start), overloadRetrySameId: true }));
