import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import {
  filterProviderConfigForAccount,
  CREDIT_PRICING_VERSION,
  confirmUsageDelivery,
  getCanvasUsage,
  getUsageAccount,
  getUsageSummary,
  providerRequiresActivation,
  quoteUsage,
  quoteUsageForUser,
  isFreeChatReservation,
  redeemUsageCode,
  reserveToolUsage,
  reserveUsage,
  settleToolUsage,
  touchToolUsage,
  settleUsage,
  tagUsageCanvas
} from '../src/usage.js';
import {
  APP_CREDITS_PER_CNY,
  BUTLER_FIXED_RETAIL_CREDITS,
  PROFIT_PER_REQUEST_CNY,
  RETAIL_MARKUP_PERCENT,
  RETAIL_MULTIPLIER,
  USD_TO_CNY,
  quoteButlerRetailCredits,
  quoteRetailCreditsFromCny,
  quoteThreeDProviderCostPtcCents,
  quoteThreeDRetailCredits,
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
  assert.equal(quoteUsage('image', { providerId: 'image-1' }).credits, 26);
  assert.equal(quoteUsage('image', { providerId: 'image-2' }).credits, 18);
  assert.equal(quoteUsage('image', { providerId: 'image-3' }).credits, 7);
  assert.equal(quoteUsage('image', { providerId: 'image-4' }).credits, 5);
  assert.equal(quoteUsage('image', { providerId: 'image-5' }).credits, 5);
  assert.equal(quoteUsage('image', { providerId: 'image-9' }).credits, 7);
  assert.equal(quoteUsage('image', { providerId: 'image-1', size: '4K' }).credits, 51);
  assert.equal(quoteUsage('image', { providerId: 'image-2', size: '1K' }).credits, 13);
  assert.deepEqual(quoteUsage('image', { providerId: 'image-6', quality: 'high' }), {
    kind: 'image', providerId: 'image-6', credits: 51, unitCredits: 51, totalCredits: 51, count: 1, resolution: 'high', quality: 'high',
    imageResolution: '1k', billingResolution: 'high:1k', duration: null, requiresActivation: false
  });
  assert.equal(quoteUsage('image', { providerId: 'image-6', quality: 'low' }).credits, 4);
  assert.equal(quoteUsage('image', { providerId: 'image-6', quality: 'medium', size: '2K' }).credits, 16);
  assert.equal(quoteUsage('image', { providerId: 'image-6', quality: 'auto', size: '4K' }).credits, 27);
  assert.equal(quoteUsage('image', { providerId: 'image-6', quality: 'invalid' }).credits, 15);
  assert.deepEqual(quoteUsage('image', { providerId: 'image-7', size: '720p' }), {
    kind: 'image', providerId: 'image-7', credits: 5, unitCredits: 5, totalCredits: 5, count: 1, resolution: '720p', imageResolution: '720p', duration: null, requiresActivation: false
  });
  assert.deepEqual(quoteUsage('image', { providerId: 'image-8', resolution: '1080p' }), {
    kind: 'image', providerId: 'image-8', credits: 9, unitCredits: 9, totalCredits: 9, count: 1, resolution: '1080p', imageResolution: '1080p', duration: null, requiresActivation: false
  });
  assert.throws(() => quoteUsage('image', { providerId: 'image-free-bypass' }), { code: 'provider-not-allowed' });
});

test('video quote clamps provider parameters, keeps chat free, and no provider requires activation', () => {
  assert.deepEqual(quoteUsage('video', { providerId: 'video-1', resolution: '2k', duration: 7 }), {
    kind: 'video', providerId: 'video-1', credits: 201, unitCredits: 28, fixedCredits: 0, minimumCredits: 0, resolution: '2K', duration: 7, requiresActivation: false
  });
  assert.equal(quoteUsage('video', { providerId: 'video-1', resolution: '768P', duration: 1 }).credits, 75);
  assert.equal(quoteUsage('video', { providerId: 'video-1', resolution: '2K', duration: 99 }).credits, 424);
  assert.equal(quoteUsage('video', { providerId: 'video-1', resolution: '768P', duration: 6, referenceMediaTypes: ['video'] }).credits, 367);
  assert.equal(quoteUsage('video', { providerId: 'video-1', resolution: '2K', duration: 6, referenceMediaTypes: Array(9).fill('image') }).credits, 207);
  assert.deepEqual(
    quoteUsage('video', { providerId: 'video-2', resolution: '720P', duration: -1 }),
    {
      kind: 'video', providerId: 'video-2', credits: 565, unitCredits: 38, fixedCredits: 0, minimumCredits: 0,
      resolution: '720P', duration: 15, requiresActivation: false
    }
  );
  assert.deepEqual(
    quoteUsage('video', { providerId: 'video-3', resolution: '720P', duration: -1 }),
    {
      kind: 'video', providerId: 'video-3', credits: 1396, unitCredits: 47, fixedCredits: 0, minimumCredits: 0,
      resolution: '720P', duration: 30, requiresActivation: false
    }
  );
  assert.deepEqual(quoteUsage('video', { providerId: 'video-2', resolution: '480p', duration: 5 }), {
    kind: 'video', providerId: 'video-2', credits: 92, unitCredits: 18, fixedCredits: 0, minimumCredits: 0, resolution: '480P', duration: 5, requiresActivation: false
  });
  assert.equal(quoteUsage('video', { providerId: 'video-2', resolution: 'unsupported', duration: 6 }).credits, 229);
  assert.deepEqual(quoteUsage('video', { providerId: 'video-3', resolution: '720p', duration: 5 }), {
    kind: 'video', providerId: 'video-3', credits: 237, unitCredits: 47, fixedCredits: 0, minimumCredits: 0, resolution: '720P', duration: 5, requiresActivation: false
  });
  assert.equal(quoteUsage('video', { providerId: 'video-3', resolution: '720p', duration: 10 }).credits, 469);
  assert.equal(quoteUsage('video', { providerId: 'video-3', resolution: '1440P-SR', duration: 6 }).credits, 653);
  assert.deepEqual(quoteUsage('video', { providerId: 'video-3', resolution: '4K-ESR', duration: 10 }), {
    kind: 'video', providerId: 'video-3', credits: 3542, unitCredits: 354, fixedCredits: 0, minimumCredits: 0,
    resolution: '4K-ESR', duration: 10, requiresActivation: false
  });
  assert.equal(quoteUsage('video', { providerId: 'video-2', resolution: '720p', duration: 10 }).credits, 378);
  for (const providerId of ['video-4', 'video-10', 'video-12']) {
    assert.throws(() => quoteUsage('video', { providerId, resolution: '720p', duration: 5 }), {
      code: 'provider-not-allowed'
    });
  }
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
      return jsonResponse({ ok: true, reason: 'reserved', credits: 201, balance: 300, reserved: 201, availableCredits: 99 });
    };
    const result = await reserveUsage(
      '00000000-0000-4000-8000-000000000001',
      'video',
      '00000000-0000-4000-8000-000000000002',
      { providerId: 'video-1', resolution: '2k', duration: 7 },
      fetchMock
    );
    assert.match(call.url, /\/rpc\/reserve_ai_video_credits$/);
    assert.deepEqual(call.body, {
      p_user_id: '00000000-0000-4000-8000-000000000001',
      p_kind: 'video',
      p_provider_id: 'video-1',
      p_request_id: '00000000-0000-4000-8000-000000000002',
      p_resolution: '2K',
      p_duration: 7,
      p_expected_credits: 201,
      p_reference_image_count: 0,
      p_has_reference_video: false
    });
    assert.equal(call.options.headers.Authorization, undefined);
    assert.equal(result.ok, true);
    assert.equal(result.availableCredits, 99);
  });
});

test('all paid video models use the unified authoritative reservation RPC', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test', REQUIRE_DURABLE_QUOTA: 'true' }, async () => {
    const calls = [];
    const fetchMock = async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return jsonResponse({ ok: true, reason: 'reserved', credits: calls.at(-1).body.p_expected_credits });
    };
    for (const providerId of ['video-1', 'video-2', 'video-3']) {
      await reserveUsage(
        '00000000-0000-4000-8000-000000000021',
        'video',
        `00000000-0000-4000-8000-${String(calls.length + 22).padStart(12, '0')}`,
        { providerId, resolution: '720P', duration: 6 },
        fetchMock
      );
    }
    assert.equal(calls.length, 3);
    assert.ok(calls.every((call) => /\/rpc\/reserve_ai_video_credits$/.test(call.url)));
    assert.ok(calls.every((call) => call.body.p_kind === 'video'));
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

test('retail formula applies the safety buffer and current segmented gross margins, with one PTC treated as one USD', () => {
  assert.equal(CREDIT_PRICING_VERSION, '202609060001');
  assert.equal(APP_CREDITS_PER_CNY, 1000 / 70);
  assert.equal(RETAIL_MARKUP_PERCENT, 33.33333333333333);
  assert.equal(RETAIL_MULTIPLIER, 4 / 3);
  assert.equal(PROFIT_PER_REQUEST_CNY, 0);
  assert.equal(USD_TO_CNY, 7.3);
  assert.equal(quoteRetailCreditsFromCny(1.5), 32);
  assert.equal(quoteTopazRetailCredits(1), 23);
  assert.equal(quoteUsage('video', { providerId: 'video-3', resolution: '4K-ESR', duration: 6 }).credits, 3542);
});

test('free chat reservations never need a settlement row', () => {
  assert.equal(isFreeChatReservation('chat', { reason: 'free', credits: 0 }), true);
  assert.equal(isFreeChatReservation('chat', { reason: 'development-bypass', credits: 0 }), true);
  assert.equal(isFreeChatReservation('image', { reason: 'free', credits: 0 }), false);
  assert.equal(isFreeChatReservation('chat', { reason: 'reserved', credits: 1 }), false);
});

test('Legnext Midjourney uses its dedicated RPC and HD price', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test', REQUIRE_DURABLE_QUOTA: 'true' }, async () => {
    let call;
    const fetchMock = async (url, options) => {
      call = { url, options, body: JSON.parse(options.body) };
      return jsonResponse({ ok: true, reason: 'reserved', credits: 49, balance: 100, reserved: 49, availableCredits: 51 });
    };
    const result = await reserveUsage(
      '00000000-0000-4000-8000-000000000011',
      'image',
      '00000000-0000-4000-8000-000000000012',
      { providerId: 'image-18', size: '2K' },
      fetchMock
    );
    assert.match(call.url, /\/rpc\/reserve_ai_media_credits$/);
    assert.equal(call.body.p_provider_id, 'image-18');
    assert.equal(call.body.p_resolution, '2k');
    assert.equal(call.body.p_expected_credits, 50);
    assert.equal(call.body.p_count, 1);
    assert.equal(result.ok, true);
  });
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
    assert.equal(quote.credits, 51);
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
          ? jsonResponse({ ok: false, reason: 'pricing-mismatch', credits: 10 })
          : jsonResponse({ ok: true, reason: 'reserved', credits: 10, availableCredits: 90 });
      });
    assert.equal(result.credits, 10);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'pricing-mismatch');
    assert.equal(calls.length, 1);
    assert.equal(Object.hasOwn(calls[0], 'pricingTier'), false);
    assert.equal(Object.hasOwn(result, 'pricingTier'), false);
  });
});

test('Butler Topaz tools reserve conservative retail credits and preserve provider audit data', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test', REQUIRE_DURABLE_QUOTA: 'true' }, async () => {
    const calls = [];
    const fetchMock = async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return jsonResponse({ ok: true, reason: 'reserved', credits: 482, availableCredits: 518 });
    };
    const userId = '00000000-0000-4000-8000-000000000031';
    const requestId = '00000000-0000-4000-8000-000000000032';
    const reserved = await reserveToolUsage(userId, requestId, {
      providerId: 'topaz-video-upscale',
      providerCost: 21,
      credits: 482,
      resolution: '3840x2160',
      duration: 13
    }, fetchMock);
    assert.equal(reserved.providerCost, 21);
    assert.equal(reserved.credits, 482);
    assert.equal(reserved.reason, 'reserved');
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/rpc\/reserve_ai_tool_credits$/);
    assert.equal(calls[0].body.p_provider_cost, 21);
    assert.equal(calls[0].body.p_credits, 482);
  });
});

test('Butler Topaz reservations fail closed when the credit service is unavailable', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test', REQUIRE_DURABLE_QUOTA: 'true' }, async () => {
    const userId = '00000000-0000-4000-8000-000000000033';
    const requestId = '00000000-0000-4000-8000-000000000034';
    let attempt = 0;
    await assert.rejects(
      () => reserveToolUsage(userId, requestId, {
        providerId: 'topaz-video-upscale',
        providerCost: 21,
        credits: 482,
        resolution: '3840x2160',
        duration: 13
      }, async () => {
        attempt += 1;
        throw new Error('credit service unavailable');
      }),
      (error) => error && error.code === 'credit-service-failed'
    );
    assert.equal(attempt, 2);
  });
});

test('Butler image, enhancement, and 3D tools all use conservative paid pricing', async () => {
  assert.deepEqual(BUTLER_FIXED_RETAIL_CREDITS, {
    'background-remove': 1,
    'seededit-v3': 8,
    'clipdrop-uncrop': 31,
    'kling-image-expand': 77,
    cleanup: 77,
    'clipdrop-upscale': 77,
    'generative-upscale': 123,
    'qwen-image-edit-plus': 16,
    'qwen-image-layered': 8,
    'super-upscale-v2': 16,
    erase: 77
  });
  assert.equal(quoteThreeDRetailCredits('hunyuan3d'), 62);
  assert.equal(quoteThreeDRetailCredits('hyper3d'), 108);
  assert.equal(quoteThreeDRetailCredits('tripo3d', { textureQuality: 'detailed' }), 92);
  assert.equal(quoteThreeDProviderCostPtcCents('hyper3d'), 70);
  assert.throws(() => quoteButlerRetailCredits('unknown-tool'), { code: 'provider-not-allowed' });

  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test', REQUIRE_DURABLE_QUOTA: 'true' }, async () => {
    const userId = '00000000-0000-4000-8000-000000000041';
    const calls = [];
    for (const [providerId, credits] of Object.entries(BUTLER_FIXED_RETAIL_CREDITS)) {
      const requestId = crypto.randomUUID();
      const result = await reserveToolUsage(userId, requestId, { providerId }, async (url, options) => {
        const body = JSON.parse(options.body);
        calls.push({ url, body });
        return jsonResponse({ ok: true, reason: 'reserved', credits, availableCredits: 1000 - credits });
      });
      assert.equal(result.credits, credits);
      assert.equal(result.reason, 'reserved');
      assert.equal(calls.at(-1).body.p_credits ?? calls.at(-1).body.p_expected_credits, credits);
    }
    assert.equal(calls.length, Object.keys(BUTLER_FIXED_RETAIL_CREDITS).length);

    await assert.rejects(
      () => reserveToolUsage(userId, crypto.randomUUID(), {
        providerId: 'hyper3d', credits: 1, providerCost: 70, options: {}
      }, async () => jsonResponse({ ok: true, reason: 'reserved' })),
      (error) => error && error.code === 'provider-not-allowed' && error.status === 400
    );
    const threeDRequestId = crypto.randomUUID();
    const threeD = await reserveToolUsage(userId, threeDRequestId, {
       providerId: 'hyper3d', credits: 108, providerCost: 70, options: {}
    }, async (_url, options) => jsonResponse({
      ok: true, reason: 'reserved', credits: 108, availableCredits: 892,
      request: JSON.parse(options.body)
    }));
    assert.equal(threeD.credits, 108);
  });
});

test('GPT Image 2 reserves the selected quality price through the existing RPC parameter', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test', REQUIRE_DURABLE_QUOTA: 'true' }, async () => {
    let call;
    const result = await reserveUsage(
      '00000000-0000-4000-8000-000000000021',
      'image',
      '00000000-0000-4000-8000-000000000022',
      { providerId: 'image-6', quality: 'medium', size: '1K' },
      async (url, options) => {
        call = { url, body: JSON.parse(options.body) };
      return jsonResponse({ ok: true, reason: 'reserved', credits: 15, availableCredits: 85 });
      }
    );
    assert.match(call.url, /\/rpc\/reserve_ai_media_credits$/);
    assert.deepEqual(call.body, {
      p_user_id: '00000000-0000-4000-8000-000000000021',
      p_kind: 'image',
      p_provider_id: 'image-6',
      p_request_id: '00000000-0000-4000-8000-000000000022',
      p_resolution: 'medium:1k',
      p_duration: null,
      p_expected_credits: 15,
      p_count: 1
    });
    assert.equal(result.quality, 'medium');
    assert.equal(result.credits, 15);
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
        return jsonResponse({ ok: true, reason: 'reserved', credits: 9, availableCredits: 91 });
      }
    );
    assert.match(call.url, /\/rpc\/reserve_ai_media_credits$/);
    assert.deepEqual(call.body, {
      p_user_id: '00000000-0000-4000-8000-000000000051',
      p_kind: 'image',
      p_provider_id: 'image-7',
      p_request_id: '00000000-0000-4000-8000-000000000052',
      p_resolution: '1080p',
      p_duration: null,
      p_expected_credits: 9,
      p_count: 1
    });
    assert.equal(result.imageResolution, '1080p');
    assert.equal(result.credits, 9);
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
    assert.match(calls[0].url, /\/rpc\/reserve_ai_media_credits$/);
    assert.equal(
      calls[1].url,
      `https://trmbhcniijedpmohkbzx.supabase.co/rest/v1/ai_credit_accounts?user_id=eq.${userId}&select=user_id%2Coverseas_unlocked`
    );
    assert.equal(calls[1].options.method, 'PATCH');
    assert.equal(calls[1].options.headers.apikey, 'sb_secret_test');
    assert.equal(calls[1].options.headers.Prefer, 'return=representation');
    assert.deepEqual(calls[1].body, { overseas_unlocked: true });
    assert.match(calls[2].url, /\/rpc\/reserve_ai_media_credits$/);
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

test('free chat bypasses legacy activation compatibility RPCs', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test', REQUIRE_DURABLE_QUOTA: 'true' }, async () => {
    const userId = '00000000-0000-4000-8000-000000000013';
    let calls = 0;
    const result = await reserveUsage(userId, 'chat', 'request-two', { providerId: 'chat-1' }, async () => {
      calls += 1;
      return jsonResponse({ ok: false });
    });

    assert.equal(calls, 0);
    assert.equal(result.ok, true);
    assert.equal(result.reason, 'free');
    assert.equal(result.credits, 0);
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

test('recovery-pending settlement responses are preserved for media and tools', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test', REQUIRE_DURABLE_QUOTA: 'true' }, async () => {
    const recovery = {
      ok: false,
      reason: 'provider-task-recovery-pending',
      status: 'reserved',
      creditsHeld: 37
    };
    await assert.rejects(
      () => settleUsage('00000000-0000-4000-8000-000000000041', 'failed', 0, async () => jsonResponse(recovery)),
      (error) => error && error.code === 'provider-task-recovery-pending' && error.status === 503
    );
    await assert.rejects(
      () => confirmUsageDelivery(
        '00000000-0000-4000-8000-000000000042',
        '00000000-0000-4000-8000-000000000043',
        false,
        0,
        async () => jsonResponse(recovery)
      ),
      (error) => error && error.code === 'provider-task-recovery-pending' && error.status === 503
    );
    await assert.rejects(
      () => settleToolUsage(
        '00000000-0000-4000-8000-000000000044',
        '00000000-0000-4000-8000-000000000045',
        'failed',
        0,
        async () => jsonResponse(recovery)
      ),
      (error) => error && error.code === 'provider-task-recovery-pending' && error.status === 503
    );
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

test('local media delivery confirmation is owner-bound and sends only normalized settlement data', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test', REQUIRE_DURABLE_QUOTA: 'true' }, async () => {
    const userId = '00000000-0000-4000-8000-000000000031';
    const requestId = '00000000-0000-4000-8000-000000000032';
    const calls = [];
    const confirmed = await confirmUsageDelivery(userId.toUpperCase(), requestId.toUpperCase(), true, 123.6, async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      return jsonResponse({
        ok: true,
        reason: 'delivery-confirmed',
        status: 'succeeded',
        creditsEstimated: 37,
        creditsCharged: 37
      });
    });
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/rpc\/confirm_ai_media_delivery$/);
    assert.deepEqual(calls[0].body, {
      p_user_id: userId,
      p_request_id: requestId,
      p_delivered: true,
      p_duration_ms: 124
    });
    assert.equal(calls[0].options.headers.Authorization, undefined);
    assert.equal(calls[0].options.headers.apikey, 'sb_secret_test');
    assert.equal(confirmed.creditsCharged, 37);

    const released = await confirmUsageDelivery(userId, requestId, false, 0, async (_url, options) => {
      assert.equal(JSON.parse(options.body).p_delivered, false);
      return jsonResponse({
        ok: true,
        reason: 'already-confirmed',
        status: 'failed',
        creditsReleased: 37,
        creditsCharged: 0
      });
    });
    assert.equal(released.status, 'failed');
    assert.equal(released.creditsCharged, 0);
  });
});

test('local media delivery rejects invalid identities and opposite prior settlements', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test', REQUIRE_DURABLE_QUOTA: 'true' }, async () => {
    await assert.rejects(
      () => confirmUsageDelivery('not-a-user', 'not-a-request', true, 0, async () => jsonResponse({ ok: true })),
      (error) => error && error.code === 'invalid-delivery-confirmation' && error.status === 400
    );
    await assert.rejects(
      () => confirmUsageDelivery(
        '00000000-0000-4000-8000-000000000033',
        '00000000-0000-4000-8000-000000000034',
        true,
        0,
        async () => jsonResponse({ ok: false, reason: 'delivery-status-conflict', status: 'failed' })
      ),
      (error) => error && error.code === 'delivery-status-conflict' && error.status === 409
    );
  });
});

test('credit migration atomically releases failed reservations', () => {
  const migration = fs.readFileSync(new URL('../../supabase/migrations/202608040002_ai_credits.sql', import.meta.url), 'utf8');
  assert.match(migration, /create or replace function public\.settle_ai_credits/i);
  assert.match(migration, /set reserved = reserved - charge, updated_at = now\(\)/i);
  assert.match(migration, /\(target_user_id, 'release', 0, -charge/i);
  assert.match(migration, /if account_record\.balance - account_record\.reserved < quoted_credits then/i);
});

test('delivery confirmation migration settles only owner media reservations and remains idempotent', () => {
  const migration = fs.readFileSync(
    new URL('../../supabase/migrations/202608220004_confirm_local_media_delivery.sql', import.meta.url),
    'utf8'
  );
  assert.match(migration, /create or replace function public\.confirm_ai_media_delivery/i);
  assert.match(migration, /where request_id = p_request_id[\s\S]*?and user_id = p_user_id[\s\S]*?and kind in \('image', 'video', '3d'\)[\s\S]*?for update/i);
  assert.match(migration, /if usage_record\.status = expected_status[\s\S]*?'already-confirmed'/i);
  assert.match(migration, /public\.settle_ai_credits\([\s\S]*?expected_status/i);
  assert.match(migration, /revoke all on function public\.confirm_ai_media_delivery[\s\S]*?from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.confirm_ai_media_delivery[\s\S]*?to service_role/i);
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

test('latest async migration accepts the complete Seedance matrix and prices logical routes with Atlas catalog credits', () => {
  const migration = fs.readFileSync(
    new URL('../../supabase/migrations/202608200001_fix_atlas_seedance_async_jobs.sql', import.meta.url),
    'utf8'
  );
  assert.match(migration, /check \(upper\(trim\(resolution\)\) in \([\s\S]*?'720P-SR'[\s\S]*?'1080P-ESR'[\s\S]*?'4K-ESR'/i);
  assert.match(migration, /duration_seconds between 3 and 30/i);
  assert.match(migration, /normalized_provider in \([\s\S]*?'video-2'[\s\S]*?'video-3'[\s\S]*?'atlas-video-seedance25-ref'/i);
  assert.match(migration, /reservation := public\.reserve_atlas_catalog_credits\(/i);
  assert.match(migration, /reservation := public\.reserve_kling_video_credits\(/i);
  assert.match(migration, /else\s+reservation := public\.reserve_ai_credits\(/i);
});

test('rebuilt pricing migration matches the gateway Atlas, GPT Image 2, and USD tool tables', () => {
  const migration = fs.readFileSync(
    new URL('../../supabase/migrations/202608200002_rebuild_credit_pricing.sql', import.meta.url),
    'utf8'
  );
  assert.match(migration, /USD 1 = CNY 7\.3/i);
  assert.match(migration, /when '720P' then 17\.7828/i);
  assert.match(migration, /when '4K-ESR' then 166\.294/i);
  assert.match(migration, /normalized_quality \|\| ':' \|\| normalized_image_resolution/i);
  assert.match(migration, /when 'medium' then case normalized_image_resolution when '1k' then 19 when '2k' then 23 else 22 end/i);
  assert.match(migration, /when 'background-remove' then 51/i);
  assert.match(migration, /when 'generative-upscale' then 73/i);
  assert.match(migration, /p_provider_cost::numeric \* 7\.3/i);
  assert.match(migration, /grant execute on function public\.reserve_atlas_catalog_credits[\s\S]*?to service_role/i);
});

test('latest pricing migration applies the 20% rule to every dedicated billing RPC', () => {
  const migration = fs.readFileSync(
    new URL('../../supabase/migrations/202608200003_percentage_markup_credit_pricing.sql', import.meta.url),
    'utf8'
  );
  assert.match(migration, /upstream cost plus 20%/i);
  assert.match(migration, /23\.11727243/);
  assert.match(migration, /quote_retail_credits_from_upstream_points/i);
  assert.match(migration, /create or replace function public\.reserve_nano_banana_credits/i);
  assert.match(migration, /create or replace function public\.reserve_higgsfield_credits/i);
  assert.match(migration, /create or replace function public\.reserve_legnext_credits/i);
  assert.match(migration, /create or replace function public\.reserve_kling_video_credits/i);
  assert.match(migration, /p_provider_cost::numeric \* 0\.01 \* 7\.3 \* 10 \* 1\.20/i);
  assert.match(migration, /expected_credits := 0/i);
  assert.doesNotMatch(migration, /greatest\(30|\+\s*14/);
});

test('authoritative pricing migration covers every image and video route', () => {
  const migration = fs.readFileSync(
    new URL('../../supabase/migrations/202609030001_authoritative_credit_pricing.sql', import.meta.url),
    'utf8'
  );
  assert.match(migration, /create or replace function public\.reserve_ai_video_credits/i);
  assert.match(migration, /create or replace function public\.quote_ai_video_retail_credits/i);
  for (const providerId of ['video-1', 'video-2', 'video-3', 'video-4', 'video-5', 'video-6', 'video-7', 'video-8', 'video-9', 'video-10', 'video-11', 'video-12', 'video-13']) {
    assert.match(migration, new RegExp(`provider_id = '${providerId}'|in \\([^\\n]*'${providerId}'`, 'i'));
  }
  assert.match(migration, /start_ai_video_job[\s\S]*?reserve_ai_video_credits/i);
  assert.match(migration, /settle_ai_video_download[\s\S]*?quote_ai_video_retail_credits/i);
});

test('retired video migration blocks new reservations but preserves historical pricing', () => {
  const migration = fs.readFileSync(
    new URL('../../supabase/migrations/202609040002_retire_legacy_video_models.sql', import.meta.url),
    'utf8'
  );
  assert.match(migration, /normalized_provider not in \('video-1', 'video-2', 'video-3'\)/i);
  assert.match(migration, /quote_ai_video_retail_credits/i);
  assert.doesNotMatch(migration, /create or replace function public\.quote_ai_video_retail_credits/i);
  assert.match(migration, /grant execute on function public\.reserve_ai_video_credits[\s\S]*?to service_role/i);
});

test('final point-denomination migration matches the deployed redemption-code schema', () => {
  const migration = fs.readFileSync(
    new URL('../../supabase/migrations/202608220003_points70_margin25_pricing.sql', import.meta.url),
    'utf8'
  );
  assert.match(migration, /1000 app points = CNY 70/i);
  assert.match(migration, /credit_amount = ceil\(credit_amount::numeric \* 10 \/ 7\)::integer/i);
  assert.match(migration, /denomination_version = 2[\s\S]*?where denomination_version < 2/i);
  assert.doesNotMatch(
    migration,
    /update public\.ai_redemption_codes[\s\S]{0,240}?updated_at/i,
    'The deployed redemption-code table has no updated_at column.'
  );
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

test('free chat does not call legacy quota RPCs during migration', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test', REQUIRE_DURABLE_QUOTA: 'false' }, async () => {
    let calls = 0;
    const result = await reserveUsage('u', 'chat', 'r', { providerId: 'chat-1' }, async () => {
      calls += 1;
      return jsonResponse(true);
    });
    assert.equal(calls, 0);
    assert.equal(result.ok, true);
    assert.equal(result.reason, 'free');
    assert.equal(result.credits, 0);
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

test('account and usage reads fail closed on a missing balance but preserve an explicit zero', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test', REQUIRE_DURABLE_QUOTA: 'true' }, async () => {
    await assert.rejects(
      () => getUsageAccount('u', async () => jsonResponse({ reserved: 0 })),
      (error) => error && error.code === 'credit-service-failed'
    );
    const zero = await getUsageAccount('u', async () => jsonResponse({ balance: 0, reserved: 0 }));
    assert.equal(zero.balance, 0);
    assert.equal(zero.availableCredits, 0);

    await assert.rejects(
      () => getUsageSummary('u', '7d', async () => jsonResponse({
        range: '7d',
        period: { from: '2026-08-01', to: '2026-08-07', days: 7 },
        account: { reserved: 0 },
        totals: {},
        byType: [],
        daily: [],
        byModel: []
      })),
      (error) => error && error.code === 'credit-service-failed'
    );
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

test('custom calendar usage calls the date-range RPC with a bounded timezone offset', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test', REQUIRE_DURABLE_QUOTA: 'true' }, async () => {
    let call;
    const summary = await getUsageSummary(
      '00000000-0000-4000-8000-000000000041',
      { from: '2026-08-01', to: '2026-08-19', timeZoneOffset: 480 },
      async (url, options) => {
        call = { url, body: JSON.parse(options.body) };
        return jsonResponse({
          range: 'custom',
          period: { from: '2026-08-01', to: '2026-08-19', days: 19 },
          account: { balance: 500, availableCredits: 500 },
          totals: { credits: 81, generations: 3, requests: 3, averagePerDay: 4.26 },
          byType: [], daily: [], byModel: []
        });
      }
    );
    assert.match(call.url, /\/rpc\/get_ai_usage_summary_between$/);
    assert.deepEqual(call.body, {
      p_user_id: '00000000-0000-4000-8000-000000000041',
      p_from: '2026-08-01',
      p_to: '2026-08-19',
      p_tz_offset: 480
    });
    assert.equal(summary.range, 'custom');
    assert.equal(summary.totals.credits, 81);
  });
});

test('canvas accounting tags a paid request and exposes sanitized all-time details', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test', REQUIRE_DURABLE_QUOTA: 'true' }, async () => {
    const calls = [];
    const fetchMock = async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      if (url.endsWith('/set_ai_usage_canvas')) return jsonResponse(true);
      return jsonResponse({
        canvasId: 'canvas-1',
        totals: { estimatedCredits: 31, credits: 28, generations: 1, providerCost: 99 },
        details: [{
          requestId: '00000000-0000-4000-8000-000000000099',
          kind: 'image', providerId: 'image-6', credits: 28,
          estimatedCredits: 31,
          resolution: 'high', duration: null, createdAt: '2026-08-19T10:00:00.000Z',
          providerCost: 99
        }]
      });
    };
    const tagged = await tagUsageCanvas(
      '00000000-0000-4000-8000-000000000041',
      '00000000-0000-4000-8000-000000000099',
      'canvas-1',
      fetchMock
    );
    assert.equal(tagged.ok, true);
    const usage = await getCanvasUsage('00000000-0000-4000-8000-000000000041', 'canvas-1', fetchMock);
    assert.equal(usage.totals.estimatedCredits, 31);
    assert.equal(usage.totals.credits, undefined);
    assert.equal(usage.details[0].requestId, '00000000-0000-4000-8000-000000000099');
    assert.equal(usage.details[0].estimatedCredits, 31);
    assert.equal(usage.details[0].credits, undefined);
    assert.equal(usage.details[0].creditsCharged, undefined);
    assert.doesNotMatch(JSON.stringify(usage), /providerCost|provider_cost/i);
    assert.match(calls[0].url, /\/rpc\/set_ai_usage_canvas$/);
    assert.match(calls[1].url, /\/rpc\/get_canvas_ai_usage_summary$/);
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

test('canvas usage migration keeps attribution and custom dates server-authoritative', () => {
  const migration = fs.readFileSync(new URL('../../supabase/migrations/202608190003_canvas_usage_history.sql', import.meta.url), 'utf8');
  assert.match(migration, /alter table public\.ai_usage add column if not exists canvas_id text/i);
  assert.match(migration, /create or replace function public\.set_ai_usage_canvas/i);
  assert.match(migration, /where request_id = p_request_id[\s\S]*and user_id = p_user_id/i);
  assert.match(migration, /create or replace function public\.get_canvas_ai_usage_summary/i);
  assert.match(migration, /usage_row\.status = 'succeeded'/i);
  assert.match(migration, /create or replace function public\.get_ai_usage_summary_between/i);
  assert.match(migration, /make_interval\(mins => normalized_offset\)/i);
  assert.doesNotMatch(migration, /provider_cost|providerCost/);
});

test('settled usage reports use current policy prices without mutating the immutable ledger', () => {
  const migration = fs.readFileSync(new URL('../../supabase/migrations/202608220007_reprice_settled_usage_reporting.sql', import.meta.url), 'utf8');
  assert.match(migration, /create or replace function public\.current_policy_ai_usage_credits/i);
  assert.match(migration, /historical_credits_charged/i);
  assert.match(migration, /'historicalCreditsCharged'/i);
  assert.match(migration, /greatest\(\s*0, coalesce\(usage_row\.credits_charged, 0\), coalesce\(/i);
  assert.match(migration, /get_canvas_ai_usage_summary/i);
  assert.match(migration, /get_ai_usage_summary_between/i);
  assert.match(migration, /get_ai_usage_summary\(/i);
});

test('usage summary HTTP route remains behind authentication', () => {
  const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const authenticationAt = server.indexOf('const user = await authenticate(request)');
  const usageRouteAt = server.indexOf("url.pathname === '/v1/usage/summary'");
  const canvasUsageRouteAt = server.indexOf("url.pathname === '/v1/usage/canvas'");
  assert.ok(authenticationAt >= 0);
  assert.ok(usageRouteAt > authenticationAt);
  assert.ok(canvasUsageRouteAt > authenticationAt);
  assert.match(server.slice(usageRouteAt, usageRouteAt + 700), /getUsageSummary\(user\.id, range\)/);
  assert.match(server.slice(canvasUsageRouteAt, canvasUsageRouteAt + 250), /getCanvasUsage\(user\.id, canvasId\)/);
});

test('video delivery confirmation preserves accepted tasks when local metadata is invalid', () => {
  const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const confirmAt = server.indexOf("url.pathname === '/v1/media/video/tasks/confirm'");
  const releaseAt = server.indexOf("url.pathname === '/v1/media/video/tasks/release'");
  assert.ok(confirmAt >= 0);
  assert.ok(releaseAt > confirmAt);
  const route = server.slice(confirmAt, releaseAt);
  assert.ok(route.includes("!/^video\\/[a-z0-9.+-]+$/i.test(contentType)"));
  assert.match(route, /Number\.isSafeInteger\(bytes\)/);
  assert.match(route, /bytes > MAX_GENERATED_VIDEO_BYTES/);
  assert.match(route, /getVideoJob\(user\.id, taskToken\)/);
  assert.match(route, /videoDeliveryRecoveryPendingError\(\)/);
  assert.doesNotMatch(route, /failVideoDownload\(user\.id, taskToken/);
  assert.doesNotMatch(route, /released && released\.status/);
});

test('latest settlement migration holds live image and video recovery reservations', () => {
  const migration = fs.readFileSync(
    new URL('../../supabase/migrations/202608280005_guard_settle_ai_credits_recovery.sql', import.meta.url),
    'utf8'
  );
  assert.match(migration, /create or replace function public\.settle_ai_credits/i);
  assert.match(migration, /image_job\.status in \('starting', 'submitted', 'ready'\)[\s\S]*?image_job\.deadline_at > now\(\)/i);
  assert.match(migration, /video_job\.status in \('starting', 'submitted', 'polling', 'ready'\)[\s\S]*?video_job\.deadline_at > now\(\)/i);
  assert.match(migration, /'provider-task-recovery-pending'/i);
  assert.match(migration, /'status', 'reserved'/i);
  assert.match(migration, /revoke all on function public\.settle_ai_credits[\s\S]*?grant execute on function public\.settle_ai_credits[\s\S]*?to service_role/i);
});

test('historical failed video refunds are idempotent and require unambiguous failed evidence', () => {
  const migration = fs.readFileSync(new URL('../../supabase/migrations/202608230001_failed_delivery_refunds.sql', import.meta.url), 'utf8');
  assert.match(migration, /create or replace function public\.refund_failed_ai_video_delivery/i);
  assert.match(migration, /job\.status.*failed/i);
  assert.match(migration, /usage_record\.status.*succeeded/i);
  assert.match(migration, /usage_record\.request_id is null/i);
  assert.match(migration, /coalesce\(usage_record\.credits_charged, 0\) <= 0/i);
  assert.match(migration, /coalesce\(usage_row\.credits_charged, 0\) > 0/i);
  assert.match(migration, /refund:failed-video-delivery:/i);
  assert.match(migration, /on conflict|already-refunded/i);
  assert.match(migration, /event_type, balance_delta, reserved_delta/i);
  assert.match(migration, /grant execute on function public\.refund_failed_ai_video_delivery[\s\S]*to service_role/i);
});
