import assert from 'node:assert/strict';
import test from 'node:test';
import { createIdempotentOperationRunner } from '../src/idempotent-operation.js';

test('idempotent operations share concurrent work and retry after rejection', async () => {
  const run = createIdempotentOperationRunner({ ttlMs: 60_000 });
  let calls = 0;
  let release;
  const first = run('same-request', async () => {
    calls += 1;
    await new Promise((resolve) => { release = resolve; });
    throw new Error('temporary failure');
  });
  const concurrent = run('same-request', () => {
    calls += 1;
    return 'unexpected duplicate';
  });
  assert.strictEqual(first, concurrent);
  await new Promise((resolve) => setImmediate(resolve));
  release();
  await assert.rejects(first, /temporary failure/);

  const retry = await run('same-request', async () => {
    calls += 1;
    return 'retry succeeded';
  });
  assert.strictEqual(retry, 'retry succeeded');
  assert.strictEqual(calls, 2);
});

test('successful idempotent operations remain shared during their ttl', async () => {
  const run = createIdempotentOperationRunner({ ttlMs: 60_000 });
  let calls = 0;
  const factory = async () => {
    calls += 1;
    return { ok: true };
  };
  const first = await run('successful-request', factory);
  const second = await run('successful-request', factory);
  assert.deepStrictEqual(second, first);
  assert.strictEqual(calls, 1);
});
