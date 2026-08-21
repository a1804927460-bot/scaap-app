import assert from 'node:assert/strict';
import test from 'node:test';
import { FairConcurrencyGate } from '../src/fair-concurrency-gate.js';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('fair gate rotates users and enforces global and per-user limits', async () => {
  const gate = new FairConcurrencyGate({ maxConcurrent: 2, maxPerKey: 1, maxQueue: 20, timeoutMs: 2_000 });
  const active = new Map();
  let peak = 0;
  const started = [];
  const jobs = Array.from({ length: 4 }, (_, index) => gate.run(index < 3 ? 'user-a' : 'user-b', async () => {
    active.set(index < 3 ? 'user-a' : 'user-b', (active.get(index < 3 ? 'user-a' : 'user-b') || 0) + 1);
    peak = Math.max(peak, [...active.values()].reduce((sum, value) => sum + value, 0));
    started.push(index);
    await pause(2);
    const owner = index < 3 ? 'user-a' : 'user-b';
    active.set(owner, active.get(owner) - 1);
    return index;
  }));
  assert.deepEqual(await Promise.all(jobs), [0, 1, 2, 3]);
  assert.equal(peak, 2);
  assert.equal(started[0], 0);
  assert.equal(started[1], 3, 'the second slot must go to another user');
  assert.equal(gate.snapshot().active, 0);
  assert.equal(gate.snapshot().queued, 0);
});

test('queued work can be cancelled without leaking capacity', async () => {
  const gate = new FairConcurrencyGate({ maxConcurrent: 1, maxPerKey: 1, maxQueue: 2, timeoutMs: 2_000 });
  let release;
  const first = gate.run('user-a', () => new Promise((resolve) => { release = resolve; }));
  const controller = new AbortController();
  const second = gate.run('user-b', () => 'never', { signal: controller.signal });
  controller.abort();
  await assert.rejects(second, (error) => error && error.code === 'request-aborted');
  release();
  await first;
  assert.equal(gate.snapshot().active, 0);
  assert.equal(gate.snapshot().queued, 0);
});
