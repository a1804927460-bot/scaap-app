import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import {
  filterProviderConfigForAccount,
  getUsageAccount,
  providerRequiresActivation,
  quoteUsage,
  redeemUsageCode,
  reserveUsage,
  settleUsage
} from '../src/usage.js';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function withEnvironment(values, callback) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === null) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

test('gateway quote matches the desktop image table', () => {
  assert.equal(quoteUsage('image', { providerId: 'image-1' }).credits, 16);
  assert.equal(quoteUsage('image', { providerId: 'image-2' }).credits, 7);
  assert.equal(quoteUsage('image', { providerId: 'image-3' }).credits, 5);
  assert.equal(quoteUsage('image', { providerId: 'image-4' }).credits, 4);
  assert.equal(quoteUsage('image', { providerId: 'image-5' }).credits, 8);
  assert.throws(() => quoteUsage('image', { providerId: 'image-free-bypass' }), { code: 'provider-not-allowed' });
});

test('video quote clamps provider parameters and chat remains free', () => {
  assert.deepEqual(quoteUsage('video', { providerId: 'video-1', resolution: '2k', duration: 7 }), {
    kind: 'video', providerId: 'video-1', credits: 112, resolution: '2K', duration: 7, requiresActivation: false
  });
  assert.equal(quoteUsage('video', { providerId: 'video-1', resolution: '768P', duration: 1 }).credits, 40);
  assert.equal(quoteUsage('video', { providerId: 'video-1', resolution: '2K', duration: 99 }).credits, 240);
  assert.equal(quoteUsage('chat', { providerId: 'chat-1' }).credits, 0);
  assert.equal(providerRequiresActivation('chat', 'chat-1'), true);
  assert.equal(providerRequiresActivation('image', 'image-1'), true);
  assert.equal(providerRequiresActivation('video', 'video-1'), false);
});

test('provider config hides overseas models until the server account unlocks them', () => {
  const config = {
    catalogVersion: 9,
    providers: [
      { id: 'image-1', kind: 'image' },
      { id: 'image-5', kind: 'image' },
      { id: 'chat-1', kind: 'chat' },
      { id: 'video-1', kind: 'video' }
    ]
  };
  assert.deepEqual(
    filterProviderConfigForAccount(config, { overseasUnlocked: false }).providers.map((provider) => provider.id),
    ['video-1']
  );
  assert.deepEqual(
    filterProviderConfigForAccount(config, { overseasUnlocked: true }).providers.map((provider) => provider.id),
    ['image-1', 'image-5', 'chat-1', 'video-1']
  );
  assert.deepEqual(
    filterProviderConfigForAccount(config, null).providers.map((provider) => provider.id),
    ['image-1', 'image-5', 'chat-1', 'video-1']
  );
});

test('reserve sends normalized server-authoritative pricing parameters', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test', REQUIRE_DURABLE_QUOTA: 'true' }, async () => {
    let call;
    const fetchMock = async (url, options) => {
      call = { url, options, body: JSON.parse(options.body) };
      return jsonResponse({ ok: true, reason: 'reserved', credits: 112, balance: 200, reserved: 112, availableCredits: 88 });
    };
    const result = await reserveUsage(
      '00000000-0000-4000-8000-000000000001',
      'video',
      '00000000-0000-4000-8000-000000000002',
      { providerId: 'video-1', resolution: '2k', duration: 7 },
      fetchMock
    );
    assert.match(call.url, /\/rpc\/reserve_ai_credits$/);
    assert.deepEqual(call.body, {
      p_user_id: '00000000-0000-4000-8000-000000000001',
      p_kind: 'video',
      p_provider_id: 'video-1',
      p_request_id: '00000000-0000-4000-8000-000000000002',
      p_resolution: '2K',
      p_duration: 7,
      p_expected_credits: 112
    });
    assert.equal(call.options.headers.Authorization, undefined);
    assert.equal(result.ok, true);
    assert.equal(result.availableCredits, 88);
  });
});

test('reserve exposes explicit activation and insufficient-credit denials', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'legacy-service-role-token', REQUIRE_DURABLE_QUOTA: 'true' }, async () => {
    const activation = await reserveUsage('u', 'image', 'r1', { providerId: 'image-1' }, async () =>
      jsonResponse({ ok: false, reason: 'activation-required', credits: 16, availableCredits: 100 }));
    assert.equal(activation.ok, false);
    assert.equal(activation.reason, 'activation-required');

    const credits = await reserveUsage('u', 'video', 'r2', { providerId: 'video-1', duration: 6 }, async () =>
      jsonResponse({ ok: false, reason: 'insufficient-credits', credits: 60, availableCredits: 59 }));
    assert.equal(credits.ok, false);
    assert.equal(credits.reason, 'insufficient-credits');
    assert.equal(credits.credits, 60);
    assert.equal(credits.availableCredits, 59);
  });
});

test('failed generation settles as a release request', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test', REQUIRE_DURABLE_QUOTA: 'true' }, async () => {
    let call;
    const result = await settleUsage(
      '00000000-0000-4000-8000-000000000003',
      'failed',
      1234.6,
      async (url, options) => {
        call = { url, body: JSON.parse(options.body) };
        return jsonResponse({ ok: true, reason: 'settled', status: 'failed', creditsReleased: 16 });
      }
    );
    assert.match(call.url, /\/rpc\/settle_ai_credits$/);
    assert.deepEqual(call.body, {
      p_request_id: '00000000-0000-4000-8000-000000000003',
      p_status: 'failed',
      p_duration_ms: 1235
    });
    assert.equal(result.creditsReleased, 16);
  });
});

test('settlement retries once without risking a duplicate charge', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test', REQUIRE_DURABLE_QUOTA: 'true' }, async () => {
    let attempts = 0;
    const result = await settleUsage('00000000-0000-4000-8000-000000000004', 'succeeded', 20, async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('synthetic dropped response');
      return jsonResponse({ ok: true, reason: 'already-settled', status: 'succeeded', creditsCharged: 16 });
    });
    assert.equal(attempts, 2);
    assert.equal(result.status, 'succeeded');
    assert.equal(result.creditsCharged, 16);
  });
});

test('credit migration atomically releases failed reservations', () => {
  const migration = fs.readFileSync(new URL('../../supabase/migrations/202608040002_ai_credits.sql', import.meta.url), 'utf8');
  assert.match(migration, /create or replace function public\.settle_ai_credits/i);
  assert.match(migration, /set reserved = reserved - charge, updated_at = now\(\)/i);
  assert.match(migration, /\(target_user_id, 'release', 0, -charge/i);
  assert.match(migration, /if account_record\.balance - account_record\.reserved < quoted_credits then/i);
});

test('durable mode fails closed when secret or credit schema is missing', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: null, REQUIRE_DURABLE_QUOTA: 'true' }, async () => {
    await assert.rejects(() => reserveUsage('u', 'video', 'r', { providerId: 'video-1' }), { code: 'credit-service-not-configured' });
  });
  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test', REQUIRE_DURABLE_QUOTA: 'true' }, async () => {
    await assert.rejects(
      () => reserveUsage('u', 'video', 'r', { providerId: 'video-1' }, async () => jsonResponse({ code: 'PGRST202' }, 404)),
      { code: 'credit-schema-missing' }
    );
  });
});

test('non-durable migration mode can fall back to the legacy quota RPC', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test', REQUIRE_DURABLE_QUOTA: 'false' }, async () => {
    const calls = [];
    const result = await reserveUsage('u', 'chat', 'r', { providerId: 'chat-1' }, async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return calls.length === 1 ? jsonResponse({ code: 'PGRST202' }, 404) : jsonResponse(true);
    });
    assert.equal(calls.length, 2);
    assert.match(calls[1].url, /\/rpc\/reserve_ai_request$/);
    assert.equal(result.ok, true);
    assert.equal(result.legacy, true);
  });
});

test('redemption hashes the submitted code and account reads remain server-only', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test', REQUIRE_DURABLE_QUOTA: 'true' }, async () => {
    const submittedCode = 'synthetic-test-code';
    let redemptionBody;
    const redemption = await redeemUsageCode('u', submittedCode, async (url, options) => {
      assert.match(url, /\/rpc\/redeem_ai_credit_code$/);
      redemptionBody = JSON.parse(options.body);
      return jsonResponse({ ok: true, reason: 'redeemed', creditsAdded: 100, account: { balance: 100, overseasUnlocked: true } });
    });
    assert.equal(redemptionBody.p_code_hash, crypto.createHash('sha256').update(submittedCode).digest('hex'));
    assert.equal(JSON.stringify(redemptionBody).includes(submittedCode), false);
    assert.equal(redemption.creditsAdded, 100);

    const account = await getUsageAccount('u', async (url, options) => {
      assert.match(url, /\/rpc\/get_ai_credit_account$/);
      assert.deepEqual(JSON.parse(options.body), { p_user_id: 'u' });
      return jsonResponse({ balance: 100, reserved: 0, availableCredits: 100, overseasUnlocked: true });
    });
    assert.equal(account.overseasUnlocked, true);
  });
});
