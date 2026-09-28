import assert from 'node:assert/strict';
import test from 'node:test';
import { recordImageProviderResult } from '../src/image-jobs.js';

const userId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const stored = `storage://messs-ai-image-results/${userId}/${requestId}.png`;
const providerUrl = 'https://assets.example.com/generated.png';

test('legacy image result RPC accepts the provider URL after rejecting private storage reference', async () => {
  const previousSecret = process.env.SUPABASE_SECRET_KEY;
  process.env.SUPABASE_SECRET_KEY = 'test-secret';
  const requests = [];
  try {
    const result = await recordImageProviderResult(userId, requestId, stored, async (_url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body.p_result_url);
      return new Response(JSON.stringify(requests.length === 1
        ? { ok: false, reason: 'invalid-result-url' }
        : { ok: true, status: 'ready', resultUrl: providerUrl }), { status: 200 });
    }, providerUrl);
    assert.deepEqual(requests, [stored, providerUrl]);
    assert.equal(result.status, 'ready');
  } finally {
    if (previousSecret === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = previousSecret;
  }
});

test('legacy image result RPC also falls back when the old schema uses HTTP 400', async () => {
  const previousSecret = process.env.SUPABASE_SECRET_KEY;
  process.env.SUPABASE_SECRET_KEY = 'test-secret';
  const calls = [];
  try {
    const result = await recordImageProviderResult('user-1', 'request-1',
      'storage://messs-ai-image-results/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222.png',
      async (_url, options) => {
        const body = JSON.parse(options.body);
        calls.push(body.p_result_url);
        if (calls.length === 1) {
          return new Response(JSON.stringify({ ok: false, reason: 'invalid-result-url' }), { status: 400 });
        }
        return new Response(JSON.stringify({ ok: true, request_id: 'request-1' }), { status: 200 });
      },
      'https://cdn.example.test/result.png');
    assert.equal(result.ok, true);
    assert.deepEqual(calls, [
      'storage://messs-ai-image-results/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222.png',
      'https://cdn.example.test/result.png'
    ]);
  } finally {
    if (previousSecret === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = previousSecret;
  }
});

test('image result RPC never falls back to a non-HTTPS reference', async () => {
  const previousSecret = process.env.SUPABASE_SECRET_KEY;
  process.env.SUPABASE_SECRET_KEY = 'test-secret';
  let calls = 0;
  try {
    await assert.rejects(recordImageProviderResult(userId, requestId, stored, async () => {
      calls += 1;
      return new Response(JSON.stringify({ ok: false, reason: 'invalid-result-url' }), { status: 200 });
    }, 'http://assets.example.com/generated.png'), { code: 'image-job-record-failed' });
    assert.equal(calls, 1);
  } finally {
    if (previousSecret === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = previousSecret;
  }
});
