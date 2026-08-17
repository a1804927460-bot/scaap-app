import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import {
  filterProviderConfigForAccount,
  getUsageAccount,
  getUsageSummary,
  providerRequiresActivation,
  quoteUsage,
  quoteUsageForUser,
  redeemUsageCode,
  reserveToolUsage,
  reserveUsage,
  settleToolUsage,
  touchToolUsage,
  settleUsage
} from '../src/usage.js';
import {
  APP_CREDITS_PER_CNY,
  BUTLER_FIXED_RETAIL_CREDITS,
  PROFIT_PER_REQUEST_CNY,
  USD_TO_CNY,
  quoteButlerRetailCredits,
  quoteRetailCreditsFromCny,
  quoteTopazRetailCredits
} from '../src/tool-pricing.js';

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
  assert.equal(quoteUsage('image', { providerId: 'image-1' }).credits, 22);
  assert.equal(quoteUsage('image', { providerId: 'image-2' }).credits, 20);
  assert.equal(quoteUsage('image', { providerId: 'image-3' }).credits, 17);
  assert.equal(quoteUsage('image', { providerId: 'image-4' }).credits, 16);
  assert.equal(quoteUsage('image', { providerId: 'image-5' }).credits, 16);
  assert.equal(quoteUsage('image', { providerId: 'image-9' }).credits, 17);
  assert.equal(quoteUsage('image', { providerId: 'image-1', size: '4K' }).credits, 28);
  assert.equal(quoteUsage('image', { providerId: 'image-2', size: '1K' }).credits, 18);
  assert.deepEqual(quoteUsage('image', { providerId: 'image-6', quality: 'high' }), {
    kind: 'image', providerId: 'image-6', credits: 28, resolution: 'high', quality: 'high', duration: null, requiresActivation: false
  });
  assert.equal(quoteUsage('image', { providerId: 'image-6', quality: 'low' }).credits, 16);
  assert.equal(quoteUsage('image', { providerId: 'image-6', quality: 'medium' }).credits, 18);
  assert.equal(quoteUsage('image', { providerId: 'image-6', quality: 'invalid' }).credits, 20);
  assert.deepEqual(quoteUsage('image', { providerId: 'image-7', size: '720p' }), {
    kind: 'image', providerId: 'image-7', credits: 16, resolution: '720p', imageResolution: '720p', duration: null, requiresActivation: false
  });
  assert.deepEqual(quoteUsage('image', { providerId: 'image-8', resolution: '1080p' }), {
    kind: 'image', providerId: 'image-8', credits: 18, resolution: '1080p', imageResolution: '1080p', duration: null, requiresActivation: false
  });
  assert.throws(() => quoteUsage('image', { providerId: 'image-free-bypass' }), { code: 'provider-not-allowed' });
});

test('video quote clamps provider parameters, chat remains free, and no provider requires activation', () => {
  assert.deepEqual(quoteUsage('video', { providerId: 'video-1', resolution: '2k', duration: 7 }), {
    kind: 'video', providerId: 'video-1', credits: 70, resolution: '2K', duration: 7, requiresActivation: false
  });
  assert.equal(quoteUsage('video', { providerId: 'video-1', resolution: '768P', duration: 1 }).credits, 34);
  assert.equal(quoteUsage('video', { providerId: 'video-1', resolution: '2K', duration: 99 }).credits, 134);
  assert.deepEqual(quoteUsage('video', { providerId: 'video-2', resolution: '480p', duration: 5 }), {
    kind: 'video', providerId: 'video-2', credits: 49, resolution: '480P', duration: 5, requiresActivation: false
  });
  assert.equal(quoteUsage('video', { providerId: 'video-2', resolution: 'unsupported', duration: 6 }).credits, 98);
  assert.deepEqual(quoteUsage('video', { providerId: 'video-3', resolution: '720p', duration: 5 }), {
    kind: 'video', providerId: 'video-3', credits: 103, resolution: '720P', duration: 5, requiresActivation: false
  });
  assert.equal(quoteUsage('video', { providerId: 'video-3', resolution: '720p', duration: 10 }).credits, 191);
  assert.equal(quoteUsage('video', { providerId: 'video-2', resolution: '720p', duration: 10 }).credits, 153);
  assert.equal(quoteUsage('video', { providerId: 'video-4', resolution: '720p', duration: 10 }).credits, 129);
  assert.equal(quoteUsage('chat', { providerId: 'chat-1' }).credits, 0);
  assert.equal(quoteUsage('chat', { providerId: 'chat-2' }).credits, 0);
  assert.equal(quoteUsage('chat', { providerId: 'chat-1' }).requiresActivation, false);
  assert.equal(quoteUsage('image', { providerId: 'image-1' }).requiresActivation, false);
  assert.equal(providerRequiresActivation('chat', 'chat-1'), false);
  assert.equal(providerRequiresActivation('image', 'image-1'), false);
  assert.equal(providerRequiresActivation('video', 'video-1'), false);
});

test('provider config always exposes the complete catalog regardless of legacy activation state', () => {
  const config = {
    catalogVersion: 9,
    providers: [
      { id: 'image-1', kind: 'image' },
      { id: 'image-5', kind: 'image' },
      { id: 'image-6', kind: 'image' },
      { id: 'chat-1', kind: 'chat' },
      { id: 'video-1', kind: 'video' }
    ]
  };
  assert.deepEqual(
    filterProviderConfigForAccount(config, { overseasUnlocked: false }).providers.map((provider) => provider.id),
    ['image-1', 'image-5', 'image-6', 'chat-1', 'video-1']
  );
  assert.deepEqual(
    filterProviderConfigForAccount(config, { overseasUnlocked: true }).providers.map((provider) => provider.id),
    ['image-1', 'image-5', 'image-6', 'chat-1', 'video-1']
  );
  assert.deepEqual(
    filterProviderConfigForAccount(config, null).providers.map((provider) => provider.id),
    ['image-1', 'image-5', 'image-6', 'chat-1', 'video-1']
  );
});

test('reserve sends normalized server-authoritative pricing parameters', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test', REQUIRE_DURABLE_QUOTA: 'true' }, async () => {
    let call;
    const fetchMock = async (url, options) => {
      call = { url, options, body: JSON.parse(options.body) };
      return jsonResponse({ ok: true, reason: 'reserved', credits: 70, balance: 200, reserved: 70, availableCredits: 130 });
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
      p_expected_credits: 70
    });
    assert.equal(call.options.headers.Authorization, undefined);
    assert.equal(result.ok, true);
    assert.equal(result.availableCredits, 130);
  });
});

test('reserve exposes insufficient-credit denials', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'legacy-service-role-token', REQUIRE_DURABLE_QUOTA: 'true' }, async () => {
    const credits = await reserveUsage('u', 'video', 'r2', { providerId: 'video-1', duration: 6 }, async () =>
      jsonResponse({ ok: false, reason: 'insufficient-credits', credits: 60, availableCredits: 59 }));
    assert.equal(credits.ok, false);
    assert.equal(credits.reason, 'insufficient-credits');
    assert.equal(credits.credits, 60);
    assert.equal(credits.availableCredits, 59);
  });
});

test('retail formula adds CNY 1.4 once and treats one PTC as one USD', () => {
  assert.equal(APP_CREDITS_PER_CNY, 10);
  assert.equal(PROFIT_PER_REQUEST_CNY, 1.4);
  assert.equal(USD_TO_CNY, 6.8);
  assert.equal(quoteRetailCreditsFromCny(1.5), 29);
  assert.equal(quoteTopazRetailCredits(1), 82);
});

test('every account receives the same quote without consulting a pricing-tier RPC', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test', REQUIRE_DURABLE_QUOTA: 'true' }, async () => {
    let fetchCalls = 0;
    const quote = await quoteUsageForUser(
      '00000000-0000-4000-8000-000000000003',
      'image',
      { providerId: 'image-1', size: '4K' },
      async () => { fetchCalls += 1; return jsonResponse({}, 500); }
    );
    assert.equal(quote.credits, 28);
    assert.equal(fetchCalls, 0);
  });
});

test('client pricing-tier fields cannot alter the unified server quote', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test', REQUIRE_DURABLE_QUOTA: 'true' }, async () => {
    const calls = [];
    const result = await reserveUsage('00000000-0000-4000-8000-000000000061', 'image',
      '00000000-0000-4000-8000-000000000062', { providerId: 'image-1', pricingTier: 'staff15' },
      async (url, options) => {
        calls.push(JSON.parse(options.body));
        return calls.length === 1
          ? jsonResponse({ ok: false, reason: 'pricing-mismatch', credits: 22 })
          : jsonResponse({ ok: true, reason: 'reserved', credits: 22, availableCredits: 78 });
      });
    assert.equal(result.credits, 22);
    assert.equal(calls.length, 2);
    assert.equal(Object.hasOwn(calls[0], 'pricingTier'), false);
    assert.equal(Object.hasOwn(result, 'pricingTier'), false);
  });
});

test('Butler Topaz accounting converts provider cost to retail credits and preserves both values', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test', REQUIRE_DURABLE_QUOTA: 'true' }, async () => {
    const calls = [];
    const fetchMock = async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push({ url, body });
      if (url.endsWith('/reserve_ai_tool_credits')) {
        return jsonResponse({
          ok: true, reason: 'reserved', credits: 1442, providerCost: 21,
          balance: 2000, reserved: 1442, availableCredits: 558
        });
      }
      if (url.endsWith('/touch_ai_tool_credits')) {
        return jsonResponse({ ok: true, reason: 'touched', status: 'processing' });
      }
      return jsonResponse({
        ok: true, reason: 'settled', status: 'succeeded',
        creditsCharged: 1442, creditsReleased: 0
      });
    };
    const userId = '00000000-0000-4000-8000-000000000031';
    const requestId = '00000000-0000-4000-8000-000000000032';
    const reserved = await reserveToolUsage(userId, requestId, {
      providerId: 'topaz-video-upscale',
      providerCost: 21,
      credits: 1442,
      resolution: '3840x2160',
      duration: 13
    }, fetchMock);
    assert.equal(reserved.providerCost, 21);
    assert.equal(reserved.credits, 1442);
    assert.equal(reserved.availableCredits, 558);
    assert.deepEqual(calls[0].body, {
      p_user_id: userId,
      p_request_id: requestId,
      p_provider_id: 'topaz-video-upscale',
      p_credits: 1442,
      p_provider_cost: 21,
      p_resolution: '3840x2160',
      p_duration: 13
    });

    const touched = await touchToolUsage(userId, requestId, fetchMock);
    assert.equal(touched.ok, true);
    assert.deepEqual(calls[1].body, { p_request_id: requestId, p_user_id: userId });
    const settled = await settleToolUsage(userId, requestId, 'succeeded', 1234.6, fetchMock);
    assert.equal(settled.creditsCharged, 1442);
    assert.deepEqual(calls[2].body, {
      p_request_id: requestId,
      p_user_id: userId,
      p_status: 'succeeded',
      p_duration_ms: 1235
    });

    await assert.rejects(
      () => reserveToolUsage(userId, requestId, {
        providerId: 'topaz-video-upscale', providerCost: 21, credits: 21
      }, fetchMock),
      (error) => error && error.code === 'provider-not-allowed' && error.status === 400
    );
  });
});

test('Butler Topaz accounting retries a transient reservation failure with the same request', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test', REQUIRE_DURABLE_QUOTA: 'true' }, async () => {
    const userId = '00000000-0000-4000-8000-000000000033';
    const requestId = '00000000-0000-4000-8000-000000000034';
    const bodies = [];
    let attempt = 0;
    const reserved = await reserveToolUsage(userId, requestId, {
      providerId: 'topaz-video-upscale',
      providerCost: 21,
      credits: 1442,
      resolution: '3840x2160',
      duration: 13
    }, async (url, options) => {
      attempt += 1;
      bodies.push(JSON.parse(options.body));
      if (attempt === 1) throw new Error('temporary network failure');
      return jsonResponse({ ok: true, reason: 'reserved', availableCredits: 937 });
    });
    assert.equal(reserved.ok, true);
    assert.equal(attempt, 2);
    assert.deepEqual(bodies[0], bodies[1]);
    assert.equal(bodies[0].p_request_id, requestId);
  });
});

test('Butler fixed-price tools use the server table and never accept caller pricing or provider cost', async () => {
  assert.deepEqual(BUTLER_FIXED_RETAIL_CREDITS, {
    'background-remove': 48,
    'seededit-v3': 18,
    'kling-image-expand': 48,
    cleanup: 48,
    'generative-upscale': 69,
    'qwen-image-edit-plus': 16,
    'qwen-image-layered': 16,
    'super-upscale-v2': 16,
    erase: 16,
    hunyuan3d: 22,
    hyper3d: 28,
    tripo3d: 24
  });
  assert.equal(quoteButlerRetailCredits('HUNYUAN3D'), 22);
  assert.throws(() => quoteButlerRetailCredits('unknown-tool'), { code: 'provider-not-allowed' });

  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test', REQUIRE_DURABLE_QUOTA: 'true' }, async () => {
    const userId = '00000000-0000-4000-8000-000000000041';
    const calls = [];
    for (const [providerId, credits] of Object.entries(BUTLER_FIXED_RETAIL_CREDITS)) {
      const requestId = crypto.randomUUID();
      const result = await reserveToolUsage(userId, requestId, { providerId }, async (url, options) => {
        calls.push({ url, body: JSON.parse(options.body) });
        return jsonResponse({ ok: true, reason: 'reserved', credits, availableCredits: 100 - credits });
      });
      assert.equal(result.credits, credits);
      assert.equal(result.providerCost, null);
      assert.deepEqual(calls.at(-1).body, {
        p_user_id: userId,
        p_request_id: requestId,
        p_provider_id: providerId,
        p_credits: credits,
        p_provider_cost: null,
        p_resolution: null,
        p_duration: null
      });
    }

    await assert.rejects(
      () => reserveToolUsage(userId, crypto.randomUUID(), {
        providerId: 'hyper3d', credits: 1
      }, async () => jsonResponse({ ok: true, reason: 'reserved' })),
      (error) => error && error.code === 'provider-not-allowed' && error.status === 400
    );
    await assert.rejects(
      () => reserveToolUsage(userId, crypto.randomUUID(), {
        providerId: 'erase', credits: 1, providerCost: 1
      }, async () => jsonResponse({ ok: true, reason: 'reserved' })),
      (error) => error && error.code === 'provider-not-allowed' && error.status === 400
    );
  });
});

test('GPT Image 2 reserves the selected quality price through the existing RPC parameter', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test', REQUIRE_DURABLE_QUOTA: 'true' }, async () => {
    let call;
    const result = await reserveUsage(
      '00000000-0000-4000-8000-000000000021',
      'image',
      '00000000-0000-4000-8000-000000000022',
      { providerId: 'image-6', quality: 'medium' },
      async (url, options) => {
        call = { url, body: JSON.parse(options.body) };
        return jsonResponse({ ok: true, reason: 'reserved', credits: 18, availableCredits: 82 });
      }
    );
    assert.match(call.url, /\/rpc\/reserve_ai_credits$/);
    assert.deepEqual(call.body, {
      p_user_id: '00000000-0000-4000-8000-000000000021',
      p_kind: 'image',
      p_provider_id: 'image-6',
      p_request_id: '00000000-0000-4000-8000-000000000022',
      p_resolution: 'medium',
      p_duration: null,
      p_expected_credits: 18
    });
    assert.equal(result.quality, 'medium');
    assert.equal(result.credits, 18);
  });
});

test('Higgsfield reserves resolution pricing through its server-authoritative RPC', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test', REQUIRE_DURABLE_QUOTA: 'true' }, async () => {
    let call;
    const result = await reserveUsage(
      '00000000-0000-4000-8000-000000000051',
      'image',
      '00000000-0000-4000-8000-000000000052',
      { providerId: 'image-7', size: '1080p' },
      async (url, options) => {
        call = { url, body: JSON.parse(options.body) };
        return jsonResponse({ ok: true, reason: 'reserved', credits: 18, availableCredits: 82 });
      }
    );
    assert.match(call.url, /\/rpc\/reserve_higgsfield_credits$/);
    assert.deepEqual(call.body, {
      p_user_id: '00000000-0000-4000-8000-000000000051',
      p_kind: 'image',
      p_provider_id: 'image-7',
      p_request_id: '00000000-0000-4000-8000-000000000052',
      p_resolution: '1080p',
      p_duration: null,
      p_expected_credits: 18
    });
    assert.equal(result.imageResolution, '1080p');
    assert.equal(result.credits, 18);
  });
});

test('legacy activation denial opens only the current account and retries the identical reservation once', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test', REQUIRE_DURABLE_QUOTA: 'true' }, async () => {
    const userId = '00000000-0000-4000-8000-000000000011';
    const requestId = '00000000-0000-4000-8000-000000000012';
    const calls = [];
    const result = await reserveUsage(userId, 'image', requestId, { providerId: 'image-1' }, async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      if (calls.length === 1) {
        return jsonResponse({ ok: false, reason: 'activation-required', credits: 16, availableCredits: 100 });
      }
      if (calls.length === 2) {
        return jsonResponse([{ user_id: userId, overseas_unlocked: true }]);
      }
      return jsonResponse({ ok: true, reason: 'reserved', credits: 16, balance: 100, reserved: 16, availableCredits: 84 });
    });

    assert.equal(calls.length, 3);
    assert.match(calls[0].url, /\/rpc\/reserve_nano_banana_credits$/);
    assert.equal(
      calls[1].url,
      `https://trmbhcniijedpmohkbzx.supabase.co/rest/v1/ai_credit_accounts?user_id=eq.${userId}&select=user_id%2Coverseas_unlocked`
    );
    assert.equal(calls[1].options.method, 'PATCH');
    assert.equal(calls[1].options.headers.apikey, 'sb_secret_test');
    assert.equal(calls[1].options.headers.Prefer, 'return=representation');
    assert.deepEqual(calls[1].body, { overseas_unlocked: true });
    assert.match(calls[2].url, /\/rpc\/reserve_nano_banana_credits$/);
    assert.equal(calls[0].options.body, calls[2].options.body);
    assert.equal(result.ok, true);
    assert.equal(result.availableCredits, 84);
  });
});

test('failed legacy account update keeps the activation denial and does not retry reservation', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test', REQUIRE_DURABLE_QUOTA: 'true' }, async () => {
    const userId = '00000000-0000-4000-8000-000000000014';
    const calls = [];
    const result = await reserveUsage(userId, 'image', 'request-one', { providerId: 'image-2' }, async (url, options) => {
      calls.push({ url, options });
      return calls.length === 1
        ? jsonResponse({ ok: false, reason: 'activation-required', credits: 12, availableCredits: 100 })
        : jsonResponse({ message: 'synthetic update failure' }, 500);
    });

    assert.equal(calls.length, 2);
    assert.match(calls[1].url, new RegExp(`ai_credit_accounts\\?user_id=eq\\.${userId}&select=`));
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'activation-required');
    assert.equal(result.credits, 12);
  });
});

test('legacy activation compatibility retries at most once when the old RPC still denies access', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test', REQUIRE_DURABLE_QUOTA: 'true' }, async () => {
    const userId = '00000000-0000-4000-8000-000000000013';
    const calls = [];
    const result = await reserveUsage(userId, 'chat', 'request-two', { providerId: 'chat-1' }, async (url) => {
      calls.push(url);
      if (calls.length === 2) return jsonResponse([{ user_id: userId, overseas_unlocked: true }]);
      return jsonResponse({ ok: false, reason: 'activation-required', credits: 0, availableCredits: 100 });
    });

    assert.equal(calls.length, 3);
    assert.match(calls[0], /\/rpc\/reserve_ai_credits$/);
    assert.match(calls[1], /\/ai_credit_accounts\?/);
    assert.match(calls[2], /\/rpc\/reserve_ai_credits$/);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'activation-required');
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

test('settlement rejects an already-settled result with the opposite status', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test', REQUIRE_DURABLE_QUOTA: 'true' }, async () => {
    await assert.rejects(
      () => settleUsage('00000000-0000-4000-8000-000000000005', 'succeeded', 20, async () =>
        jsonResponse({ ok: true, reason: 'already-settled', status: 'failed', creditsCharged: 0 })),
      (error) => error && error.code === 'credit-settlement-conflict' && error.status === 409
    );
  });
});

test('forward migration opens model access while preserving server-authoritative credits', () => {
  const migration = fs.readFileSync(new URL('../../supabase/migrations/202608080001_open_ai_model_access.sql', import.meta.url), 'utf8');
  assert.match(migration, /create or replace function public\.reserve_ai_credits/i);
  assert.match(migration, /if normalized_kind = 'chat'[\s\S]*?quoted_credits := 0/i);
  assert.match(migration, /if account_record\.balance - account_record\.reserved < quoted_credits then/i);
  assert.match(migration, /set reserved = reserved \+ quoted_credits, updated_at = now\(\)/i);
  assert.doesNotMatch(migration, /activation-required/i);
  assert.doesNotMatch(migration, /overseas_unlocked/i);
});

test('GPT Image 2 forward migration preserves async reservations and recomputes quality pricing', () => {
  const migration = fs.readFileSync(new URL('../../supabase/migrations/202608080004_gpt_image_2_credits.sql', import.meta.url), 'utf8');
  assert.match(migration, /create or replace function public\.reserve_ai_credits/i);
  assert.match(migration, /normalized_provider = 'image-6'[\s\S]*?when 'low' then 3[\s\S]*?when 'medium' then 8[\s\S]*?when 'high' then 28[\s\S]*?else 12/i);
  assert.match(migration, /p_expected_credits is not null and p_expected_credits <> quoted_credits/i);
  assert.match(migration, /not exists \([\s\S]*?from public\.ai_video_jobs[\s\S]*?status in \('starting', 'submitted', 'polling'\)[\s\S]*?deadline_at > now\(\)/i);
  assert.match(migration, /revoke all on function public\.reserve_ai_credits/i);
  assert.match(migration, /grant execute on function public\.reserve_ai_credits[\s\S]*?to service_role/i);
  assert.doesNotMatch(migration, /activation-required/i);
});

test('Kling async video jobs reserve through the Kling provider allow-list', () => {
  const migration = fs.readFileSync(
    new URL('../../supabase/migrations/202608180004_route_kling_async_video_jobs.sql', import.meta.url),
    'utf8'
  );
  assert.match(migration, /create or replace function public\.reserve_kling_video_credits/i);
  assert.match(migration, /normalized_provider in \('video-10', 'video-11', 'video-12', 'video-13'\)/i);
  assert.match(migration, /duration_seconds between 3 and 30/i);
  assert.match(migration, /reservation := public\.reserve_kling_video_credits\(/i);
  assert.match(migration, /else\s+reservation := public\.reserve_ai_credits\(/i);
  assert.match(migration, /create or replace function public\.start_ai_video_job/i);
  assert.match(migration, /grant execute on function public\.start_ai_video_job[\s\S]*?to service_role/i);
});

test('Nano Banana migration enforces provider and resolution pricing server-side', () => {
  const migration = fs.readFileSync(new URL('../../supabase/migrations/202608090003_nano_banana_credits.sql', import.meta.url), 'utf8');
  assert.match(migration, /create or replace function public\.reserve_nano_banana_credits/i);
  assert.match(migration, /normalized_provider not in \('image-1', 'image-2', 'image-5', 'image-9'\)/i);
  assert.match(migration, /normalized_provider = 'image-1'[\s\S]*?when '4k' then 28 else 16/i);
  assert.match(migration, /normalized_provider = 'image-2'[\s\S]*?not in \('1k', '2k', '4k'\)[\s\S]*?when '1k' then 8[\s\S]*?when '4k' then 16 else 12/i);
  assert.doesNotMatch(migration, /0\.5k/i);
  assert.match(migration, /p_expected_credits is not null and p_expected_credits <> quoted_credits/i);
  assert.match(migration, /grant execute on function public\.reserve_nano_banana_credits[\s\S]*?to service_role/i);
});

test('Butler video migration enforces retail pricing and keeps provider-cost audit data server-only', () => {
  const migration = fs.readFileSync(new URL('../../supabase/migrations/202608080005_butler_video_credits.sql', import.meta.url), 'utf8');
  assert.match(migration, /provider_cost integer not null/i);
  assert.match(migration, /retail_credits integer not null/i);
  assert.match(migration, /expected_credits integer := ceil\([\s\S]*?p_provider_cost[\s\S]*?0\.15 \* 10 \* 2/i);
  assert.match(migration, /p_credits <> expected_credits/i);
  assert.match(migration, /jsonb_build_object\('kind', 'video'[\s\S]*?'providerCost', p_provider_cost[\s\S]*?'retailCredits', p_credits/i);
  assert.match(migration, /revoke all on table public\.ai_tool_jobs from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.reserve_ai_tool_credits[\s\S]*?to service_role/i);
});

test('Butler and Seedance forward migration independently enforces every retail price', () => {
  const migration = fs.readFileSync(new URL('../../supabase/migrations/202608080008_butler_tool_credits.sql', import.meta.url), 'utf8');
  assert.match(migration, /ai_usage_kind_check check \(kind in \('chat', 'image', 'video', '3d'\)\)/i);
  assert.match(migration, /normalized_provider = 'video-2'[\s\S]*?when '480P' then 3 else 5 end/i);
  assert.match(migration, /normalized_provider = 'video-3'[\s\S]*?when '480P' then 4 else 6 end/i);
  assert.match(migration, /when 'background-remove' then 1/i);
  assert.match(migration, /when 'qwen-image-edit-plus' then 2/i);
  assert.match(migration, /when 'qwen-image-layered' then 1/i);
  assert.match(migration, /when 'super-upscale-v2' then 2/i);
  assert.match(migration, /when 'erase' then 1/i);
  assert.match(migration, /when 'hunyuan3d' then 8/i);
  assert.match(migration, /when 'hyper3d' then 14/i);
  assert.match(migration, /when 'topaz-video-upscale'[\s\S]*?ceil\(p_provider_cost::numeric \* 0\.15 \* 10 \* 2\)/i);
  assert.match(migration, /p_credits <> expected_credits/i);
  assert.match(migration, /normalized_provider <> 'topaz-video-upscale' and p_provider_cost is not null/i);
  assert.match(migration, /when normalized_provider in \('hunyuan3d', 'hyper3d'\) then '3d'/i);
  assert.match(migration, /set reserved = greatest\(0, reserved - stale_record\.credits_reserved\)/i);
  assert.match(migration, /settlement := public\.settle_ai_credits[\s\S]*?normalized_status/i);
  assert.match(migration, /array\['chat', 'image', 'video', '3d'\]::text\[\]/i);
  assert.match(migration, /revoke all on function public\.reserve_ai_tool_credits[\s\S]*?from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.reserve_ai_tool_credits[\s\S]*?to service_role/i);
});

test('Tripo3D forward migration adds durable fixed-price 3D accounting', () => {
  const migration = fs.readFileSync(new URL('../../supabase/migrations/202608090002_tripo3d_credits.sql', import.meta.url), 'utf8');
  assert.match(migration, /ai_tool_jobs_provider_supported[\s\S]*?'tripo3d'/i);
  assert.match(migration, /normalized_provider in \('hunyuan3d', 'hyper3d', 'tripo3d'\) then '3d'/i);
  assert.match(migration, /when 'tripo3d' then 10/i);
  assert.match(migration, /p_credits <> expected_credits/i);
  assert.match(migration, /grant execute on function public\.reserve_ai_tool_credits[\s\S]*?to service_role/i);
});

test('gateway config and model routes do not consult the legacy unlock flag', () => {
  const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const configRoute = server.match(/url\.pathname === '\/v1\/config'[\s\S]*?url\.pathname === '\/v1\/models'/i)?.[0] || '';
  const modelsRoute = server.match(/if \(request\.method === 'GET' && url\.pathname === '\/v1\/models'\) \{[\s\S]*?\n  \}/i)?.[0] || '';
  assert.match(configRoute, /publicProviderConfig\(\)/i);
  assert.doesNotMatch(configRoute, /getUsageAccount|overseas|activation/i);
  assert.match(modelsRoute, /await models\(requestedProviderId\)/i);
  assert.doesNotMatch(modelsRoute, /getUsageAccount|overseas|activation/i);
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
      return jsonResponse({ ok: true, reason: 'redeemed', creditsAdded: 100, account: { balance: 100, overseasUnlocked: true, pricing_tier: 'staff15' } });
    });
    assert.equal(redemptionBody.p_code_hash, crypto.createHash('sha256').update(submittedCode).digest('hex'));
    assert.equal(JSON.stringify(redemptionBody).includes(submittedCode), false);
    assert.equal(redemption.creditsAdded, 100);
    assert.equal(Object.hasOwn(redemption.account, 'pricing_tier'), false);
    assert.equal(JSON.stringify(redemption).includes('staff15'), false);

    const account = await getUsageAccount('u', async (url, options) => {
      assert.match(url, /\/rpc\/get_ai_credit_account$/);
      assert.deepEqual(JSON.parse(options.body), { p_user_id: 'u' });
      return jsonResponse({ balance: 100, reserved: 0, availableCredits: 100, overseasUnlocked: true });
    });
    assert.equal(account.overseasUnlocked, true);
  });
});

test('usage summary calls the service-only RPC and exposes only public retail fields', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test', REQUIRE_DURABLE_QUOTA: 'true' }, async () => {
    let call;
    const summary = await getUsageSummary(
      '00000000-0000-4000-8000-000000000041',
      '30',
      async (url, options) => {
        call = { url, options, body: JSON.parse(options.body) };
        return jsonResponse({
          range: '30d',
          timeZone: 'UTC',
          period: { from: '2026-07-10', to: '2026-08-08', days: 30 },
          account: { balance: 800, reserved: 20, availableCredits: 780, membershipTier: 'free', providerCost: 999 },
          totals: { credits: 120, generations: 4, requests: 6, averagePerDay: 4, providerCost: 40 },
          byType: [
            { kind: 'image', credits: 40, generations: 3, requests: 3, providerCost: 12 },
            { kind: 'video', credits: 80, generations: 1, requests: 1 }
          ],
          daily: [{ date: '2026-08-08', credits: 80, generations: 1, requests: 1, providerCost: 20 }],
          byModel: [{ providerId: 'video-1', kind: 'video', credits: 80, generations: 1, requests: 1, providerCost: 20 }],
          updatedAt: '2026-08-08T12:00:00.000Z',
          providerCost: 999
        });
      }
    );

    assert.match(call.url, /\/rpc\/get_ai_usage_summary$/);
    assert.deepEqual(call.body, {
      p_user_id: '00000000-0000-4000-8000-000000000041',
      p_range: '30d'
    });
    assert.equal(call.options.headers.apikey, 'sb_secret_test');
    assert.equal(call.options.headers.Authorization, undefined);
    assert.equal(summary.range, '30d');
    assert.equal(summary.account.availableCredits, 780);
    assert.equal(summary.totals.generations, 4);
    assert.equal(summary.byModel[0].providerId, 'video-1');
    assert.doesNotMatch(JSON.stringify(summary), /providerCost|provider_cost/i);
  });
});

test('usage summary rejects invalid ranges before making a request', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test' }, async () => {
    let called = false;
    await assert.rejects(
      () => getUsageSummary('user', 'year', async () => {
        called = true;
        return jsonResponse({});
      }),
      (error) => error && error.code === 'invalid-usage-range' && error.status === 400
    );
    assert.equal(called, false);
  });
});

test('usage summary migration aggregates successful retail usage and is service-role only', () => {
  const migration = fs.readFileSync(new URL('../../supabase/migrations/202608080006_ai_usage_summary.sql', import.meta.url), 'utf8');
  assert.match(migration, /create or replace function public\.get_ai_usage_summary\s*\(/i);
  assert.match(migration, /from public\.ai_usage/i);
  assert.match(migration, /from public\.ai_credit_accounts/i);
  assert.match(migration, /usage_row\.status = 'succeeded'/i);
  assert.match(migration, /usage_row\.credits_charged/i);
  assert.match(migration, /generate_series\(period_start, today_utc, interval '1 day'\)/i);
  assert.match(migration, /revoke all on function public\.get_ai_usage_summary\(uuid, text\) from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.get_ai_usage_summary\(uuid, text\) to service_role/i);
  assert.doesNotMatch(migration, /provider_cost|providerCost/);
});

test('usage summary HTTP route remains behind authentication', () => {
  const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const authenticationAt = server.indexOf('const user = await authenticate(request)');
  const usageRouteAt = server.indexOf("url.pathname === '/v1/usage/summary'");
  assert.ok(authenticationAt >= 0);
  assert.ok(usageRouteAt > authenticationAt);
  assert.match(server.slice(usageRouteAt, usageRouteAt + 300), /getUsageSummary\(user\.id, range\)/);
});
