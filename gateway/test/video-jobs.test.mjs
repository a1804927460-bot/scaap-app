import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createVideoTask, generateLegacyVideo, pollVideoTask } from '../src/providers.js';
import {
  canonicalRequestBody,
  failVideoDownload,
  finalizeVideoJob,
  getVideoDownload,
  getVideoJob,
  hashVideoRequest,
  hashVideoTaskToken,
  markVideoJobReady,
  runVideoJobWorkerCycle,
  sanitizeVideoJobError,
  settleVideoDownload,
  startVideoJob,
  startVideoJobWorker
} from '../src/video-jobs.js';

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
  return Promise.resolve().then(callback).finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test('canonical request hashes are stable across property order', () => {
  const first = { prompt: 'ocean', duration: 6, nested: { b: 2, a: 1 }, urls: ['https://example.test/a.png'] };
  const second = { urls: ['https://example.test/a.png'], nested: { a: 1, b: 2 }, duration: 6, prompt: 'ocean' };
  assert.equal(canonicalRequestBody(first), canonicalRequestBody(second));
  assert.equal(hashVideoRequest(first), hashVideoRequest(second));
  assert.notEqual(hashVideoRequest(first), hashVideoRequest({ ...first, duration: 7 }));
  assert.match(hashVideoTaskToken('task-token-1234567890'), /^[0-9a-f]{64}$/);
});

test('start is idempotency-bound to operation, owner token, and canonical request without persisting secrets', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test' }, async () => {
    const taskToken = 'client-task-token-1234567890';
    const operationId = '00000000-0000-4000-8000-000000000101';
    const userId = '00000000-0000-4000-8000-000000000102';
    const bodyOne = { prompt: 'private prompt text', providerId: 'video-1', resolution: '2K', duration: 7, aspectRatio: '16:9' };
    const bodyTwo = { aspectRatio: '16:9', duration: 7, resolution: '2K', providerId: 'video-1', prompt: 'private prompt text' };
    const calls = [];
    const fetchMock = async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return jsonResponse({
        ok: true,
        reason: calls.length === 1 ? 'reserved' : 'already-started',
        requestId: operationId,
        status: 'starting',
        credits: 189
      });
    };

    const created = await startVideoJob({ userId, operationId, taskToken, body: bodyOne, fetchImpl: fetchMock });
    const repeated = await startVideoJob({ userId, operationId, taskToken, body: bodyTwo, fetchImpl: fetchMock });

    assert.equal(created.created, true);
    assert.equal(repeated.created, false);
    assert.equal(created.credits, 189);
    assert.match(calls[0].url, /\/rpc\/start_ai_video_job$/);
    assert.equal(calls[0].body.p_request_id, operationId);
    assert.equal(calls[0].body.p_user_id, userId);
    assert.equal(calls[0].body.p_token_hash, hashVideoTaskToken(taskToken));
    assert.equal(calls[0].body.p_request_hash, calls[1].body.p_request_hash);
    assert.equal(calls[0].body.p_expected_credits, 189);
    assert.equal(JSON.stringify(calls[0].body).includes(taskToken), false);
    assert.equal(JSON.stringify(calls[0].body).includes('private prompt text'), false);
  });
});

test('start accepts only a higher server-authorized price without exposing an account tier', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test' }, async () => {
    const calls = [];
    const created = await startVideoJob({
      userId: '00000000-0000-4000-8000-000000000111',
      operationId: '00000000-0000-4000-8000-000000000112',
      taskToken: 'internal-price-task-token-1234567890',
      body: { prompt: 'test', providerId: 'video-1', resolution: '2K', duration: 7 },
      fetchImpl: async (_url, options) => {
        calls.push(JSON.parse(options.body));
        return calls.length === 1
          ? jsonResponse({ ok: false, reason: 'pricing-mismatch', credits: 210 })
          : jsonResponse({ ok: true, reason: 'reserved', credits: 210, status: 'starting' });
      }
    });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].p_expected_credits, 189);
    assert.equal(calls[1].p_expected_credits, 210);
    assert.equal(created.credits, 210);
    assert.equal(JSON.stringify(created).includes('pricingTier'), false);
  });
});

test('start rejects a stale server price below the conservative gateway quote', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test' }, async () => {
    let calls = 0;
    const result = await startVideoJob({
      userId: '00000000-0000-4000-8000-000000000141',
      operationId: '00000000-0000-4000-8000-000000000142',
      taskToken: 'stale-price-task-token-1234567890',
      body: { prompt: 'test', providerId: 'video-1', resolution: '2K', duration: 7 },
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse({ ok: false, reason: 'pricing-mismatch', credits: 60 });
      }
    });
    assert.equal(calls, 1);
    assert.equal(result.created, false);
    assert.equal(result.reason, 'pricing-mismatch');
    assert.equal(result.credits, 60);
  });
});
test('retired video models are rejected before a credit reservation is created', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test' }, async () => {
    let calls = 0;
    await assert.rejects(
      startVideoJob({
        userId: '00000000-0000-4000-8000-000000000115',
        operationId: '00000000-0000-4000-8000-000000000116',
        taskToken: 'retired-video-task-token-1234567890',
        body: {
          prompt: 'test', providerId: 'video-10', serviceTier: 'pro',
          resolution: '1080P', duration: 10, aspectRatio: 'adaptive'
        },
        fetchImpl: async () => {
          calls += 1;
          return jsonResponse({ ok: true, reason: 'reserved', credits: 484, status: 'starting' });
        }
      }),
      (error) => error && error.code === 'provider-not-allowed'
    );
    assert.equal(calls, 0);
  });
});

test('async job RPC retries a transient transport failure with the same idempotent payload', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test' }, async () => {
    let attempts = 0;
    const result = await getVideoJob(
      '00000000-0000-4000-8000-000000000113',
      'retryable-owner-token-123456',
      async (_url, options) => {
        attempts += 1;
        if (attempts === 1) throw new Error('temporary network reset');
        assert.equal(JSON.parse(options.body).p_user_id, '00000000-0000-4000-8000-000000000113');
        return jsonResponse({ ok: true, status: 'submitted' });
      }
    );
    assert.equal(result.status, 'submitted');
    assert.equal(attempts, 2);
  });
});

test('owner status and download calls send only the task token hash', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test' }, async () => {
    const token = 'owner-download-token-123456';
    const calls = [];
    const fetchMock = async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return url.endsWith('get_ai_video_job_download')
        ? jsonResponse({ ok: true, status: 'succeeded', url: 'https://example.test/video.mp4' })
        : jsonResponse({ ok: true, status: 'polling' });
    };
    assert.equal((await getVideoJob('user-one', token, fetchMock)).status, 'polling');
    assert.equal((await getVideoDownload('user-one', token, fetchMock)).status, 'succeeded');
    assert.deepEqual(calls.map((call) => call.body), [
      { p_user_id: 'user-one', p_token_hash: hashVideoTaskToken(token) },
      { p_user_id: 'user-one', p_token_hash: hashVideoTaskToken(token) }
    ]);
    assert.equal(JSON.stringify(calls).includes(token), false);
  });
});

test('provider-ready, download settlement, and download failure RPCs preserve authoritative usage', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test' }, async () => {
    const calls = [];
    const fetchMock = async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push({ url, body });
      if (url.endsWith('/record_ai_video_provider_result')) return jsonResponse({ ok: true, status: 'ready' });
      if (url.endsWith('/settle_ai_video_download')) return jsonResponse({ ok: true, creditsEstimated: 168, creditsCharged: 168 });
      if (url.endsWith('/fail_ai_video_download')) return jsonResponse({ ok: true, creditsCharged: 0, creditsReleased: 168 });
      throw new Error('Unexpected RPC ' + url);
    };
    await markVideoJobReady({
      requestId: '00000000-0000-4000-8000-000000000131',
      leaseToken: '00000000-0000-4000-8000-000000000132',
      resultUrl: 'https://cdn.example.test/result.mp4',
      usage: { totalSeconds: 21, inputSeconds: 15, outputSeconds: 6, inputImageCount: 9 },
      durationMs: 12_000,
      fetchImpl: fetchMock
    });
    const settled = await settleVideoDownload('user-one', 'owner-download-token-123456', {
      contentType: 'video/mp4', bytes: 1024
    }, fetchMock);
    const failed = await failVideoDownload('user-one', 'owner-download-token-123456', {
      code: 'invalid-media', message: 'invalid media'
    }, fetchMock);
    assert.equal(settled.creditsCharged, 168);
    assert.equal(failed.creditsCharged, 0);
    assert.deepEqual(calls[0].body, {
      p_request_id: '00000000-0000-4000-8000-000000000131',
      p_lease_token: '00000000-0000-4000-8000-000000000132',
      p_result_url: 'https://cdn.example.test/result.mp4',
      p_total_seconds: 21,
      p_input_seconds: 15,
      p_output_seconds: 6,
      p_input_image_count: 9,
      p_duration_ms: 12000
    });
    assert.equal(calls[1].body.p_token_hash, hashVideoTaskToken('owner-download-token-123456'));
    assert.equal(calls[2].body.p_error_code, 'invalid-media');
  });
});
test('finalization rejects a mocked credit/job settlement status mismatch', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test' }, async () => {
    await assert.rejects(() => finalizeVideoJob({
      requestId: '00000000-0000-4000-8000-000000000103',
      leaseToken: '00000000-0000-4000-8000-000000000104',
      status: 'succeeded',
      resultUrl: 'https://example.test/video.mp4',
      fetchImpl: async () => jsonResponse({ ok: true, reason: 'already-finalized', status: 'failed' })
    }), { code: 'video-job-status-mismatch' });
  });
});

test('worker reschedules 429 responses using provider retry-after without exposing credentials', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test' }, async () => {
    const calls = [];
    const fetchMock = async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push({ url, body });
      if (url.endsWith('/claim_due_ai_video_jobs')) {
        return jsonResponse([{
          request_id: '00000000-0000-4000-8000-000000000105',
          provider_id: 'video-1',
          provider_task_id: 'provider-task-one',
          status: 'submitted',
          attempt_count: 0,
          lease_token: '00000000-0000-4000-8000-000000000106',
          created_at: '2026-08-08T00:00:00.000Z',
          deadline_at: '2099-08-08T00:20:00.000Z'
        }]);
      }
      if (url.endsWith('/reschedule_ai_video_job')) return jsonResponse({ ok: true, status: 'polling' });
      throw new Error(`Unexpected RPC ${url}`);
    };
    const summary = await runVideoJobWorkerCycle({
      fetchImpl: fetchMock,
      now: () => new Date('2026-08-08T00:01:00.000Z').getTime(),
      pollVideoTask: async () => {
        throw Object.assign(new Error('Bearer secret-provider-token temporarily throttled'), {
          status: 429,
          code: 'provider-rate-limited',
          retryAfterMs: 45_000
        });
      }
    });
    assert.deepEqual(summary, { claimed: 1, succeeded: 0, failed: 0, pending: 1, errors: 0 });
    assert.equal(calls.length, 2);
    assert.match(calls[1].url, /\/reschedule_ai_video_job$/);
    assert.equal(calls[1].body.p_delay_seconds, 45);
    assert.equal(calls[1].body.p_error_code, 'provider-rate-limited');
    assert.equal(calls[1].body.p_error_message.includes('secret-provider-token'), false);
  });
});

test('worker keeps timeout and transport failures pending instead of releasing credits', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test' }, async () => {
    const calls = [];
    const fetchMock = async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push({ url, body });
      if (url.endsWith('/claim_due_ai_video_jobs')) {
        return jsonResponse([{
          request_id: '00000000-0000-4000-8000-000000000107',
          provider_id: 'video-1',
          provider_task_id: 'provider-task-timeout',
          status: 'polling',
          attempt_count: 1,
          lease_token: '00000000-0000-4000-8000-000000000108',
          created_at: '2026-08-08T00:00:00.000Z',
          deadline_at: '2099-08-08T00:20:00.000Z'
        }]);
      }
      if (url.endsWith('/reschedule_ai_video_job')) return jsonResponse({ ok: true, status: 'polling' });
      throw new Error(`Unexpected RPC ${url}`);
    };
    const summary = await runVideoJobWorkerCycle({
      fetchImpl: fetchMock,
      now: () => new Date('2026-08-08T00:01:00.000Z').getTime(),
      pollVideoTask: async () => {
        const error = new Error('upstream timed out');
        error.name = 'TimeoutError';
        throw error;
      }
    });
    assert.deepEqual(summary, { claimed: 1, succeeded: 0, failed: 0, pending: 1, errors: 0 });
    assert.match(calls[1].url, /\/reschedule_ai_video_job$/);
    assert.equal(calls[1].body.p_delay_seconds, 20);
  });
});

test('worker fails closed after one clear error when the asynchronous schema is missing', async () => {
  await withEnvironment({ SUPABASE_SECRET_KEY: 'sb_secret_test' }, async () => {
    let claimCalls = 0;
    let resolveError;
    const reported = new Promise((resolve) => { resolveError = resolve; });
    const worker = startVideoJobWorker({
      intervalMs: 3_000,
      pollVideoTask: async () => { throw new Error('must not poll'); },
      fetchImpl: async (url) => {
        claimCalls += 1;
        assert.match(String(url), /\/claim_due_ai_video_jobs$/);
        return jsonResponse({ code: 'PGRST202', message: 'function is missing' }, 404);
      },
      onError: resolveError
    });
    try {
      const error = await reported;
      assert.equal(error.code, 'video-job-schema-missing');
      assert.match(error.message, /schema is not installed/i);
      assert.equal(claimCalls, 1);
      assert.equal(await worker.runNow(), null);
      assert.equal(claimCalls, 1, 'a disabled worker must not keep probing a missing schema');
    } finally {
      worker.stop();
    }
  });
});

test('MiniMax H3 sends the official multimodal contract and preserves usage', async () => {
  const previousFetch = globalThis.fetch;
  await withEnvironment({ MINIMAX_API_KEY: 'minimax-test-key' }, async () => {
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url) === 'https://api.minimaxi.com/v2/video_generation') {
        return jsonResponse({ task_id: 'multimodal-task-id' });
      }
      if (String(url) === 'https://api.minimaxi.com/v2/query/video_generation/multimodal-task-id') {
        return jsonResponse({
          task: {
            id: 'multimodal-task-id', status: 'succeeded',
            content: { url: 'https://cdn.example.test/multimodal.mp4' },
            usage: { total_seconds: 21, input_seconds: 15, output_seconds: 6, input_image_count: 1 }
          }
        });
      }
      throw new Error('Unexpected URL: ' + url);
    };
    try {
      const created = await createVideoTask({
        providerId: 'video-1', prompt: 'multimodal', resolution: '768P', duration: 6,
        aspectRatio: '16:9', videoMode: 'omni',
        urls: ['https://cdn.example.test/reference.png', 'https://cdn.example.test/reference.mp4'],
        referenceMediaTypes: ['image', 'video'],
        referenceAudioUrls: ['https://cdn.example.test/reference.mp3']
      });
      const request = JSON.parse(calls[0].options.body);
      assert.deepEqual(request, {
        model: 'MiniMax-H3',
        content: [
          { type: 'text', text: 'multimodal' },
          { type: 'image_url', image_url: { url: 'https://cdn.example.test/reference.png' }, role: 'reference_image' },
          { type: 'video_url', video_url: { url: 'https://cdn.example.test/reference.mp4' }, role: 'reference_video' },
          { type: 'audio_url', audio_url: { url: 'https://cdn.example.test/reference.mp3' }, role: 'reference_audio' }
        ],
        resolution: '768P',
        duration: 6,
        ratio: '16:9',
        aigc_watermark: false
      });
      assert.equal(calls[0].options.headers.Authorization, 'Bearer minimax-test-key');
      assert.equal(calls.some((call) => call.url.includes('api.atlascloud.ai')), false);
      const result = await pollVideoTask(created.providerId, created.taskId);
      assert.deepEqual(result.usage, {
        totalSeconds: 21, inputSeconds: 15, outputSeconds: 6, inputImageCount: 1
      });
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

test('MiniMax H3 official frame routes use only documented fields', async () => {
  const previousFetch = globalThis.fetch;
  await withEnvironment({ MINIMAX_API_KEY: 'minimax-test-key' }, async () => {
    const calls = [];
    let createCount = 0;
    globalThis.fetch = async (url, options = {}) => {
      const value = String(url);
      calls.push({ url: value, options });
      if (value === 'https://api.minimaxi.com/v2/video_generation') {
        createCount += 1;
        return jsonResponse({ task_id: `h3-task-${createCount}` });
      }
      throw new Error('Unexpected URL: ' + url);
    };
    try {
      await createVideoTask({
        providerId: 'video-1', prompt: 'frame route', resolution: '768P', duration: 4,
        aspectRatio: 'adaptive', videoMode: 'first-last-frame',
        urls: ['https://cdn.example.test/first.png', 'https://cdn.example.test/last.png'],
        referenceMediaTypes: ['image', 'image']
      });
      const frameRequest = JSON.parse(calls[0].options.body);
      assert.deepEqual(frameRequest, {
        model: 'MiniMax-H3',
        content: [
          { type: 'text', text: 'frame route' },
          { type: 'image_url', image_url: { url: 'https://cdn.example.test/first.png' }, role: 'first_frame' },
          { type: 'image_url', image_url: { url: 'https://cdn.example.test/last.png' }, role: 'last_frame' }
        ],
        resolution: '768P',
        duration: 4,
        ratio: 'adaptive',
        aigc_watermark: false
      });
      assert.equal(calls[0].options.headers.Authorization, 'Bearer minimax-test-key');
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

test('MiniMax H3 rejects legacy empty frame requests before upstream submission', async () => {
  const previousFetch = globalThis.fetch;
  await withEnvironment({ MINIMAX_API_KEY: 'minimax-test-key' }, async () => {
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url) === 'https://api.minimaxi.com/v2/video_generation') {
        return jsonResponse({ task_id: 'h3-legacy-empty-frame-task' });
      }
      throw new Error('Unexpected URL: ' + url);
    };
    try {
      await assert.rejects(() => createVideoTask({
        providerId: 'video-1', prompt: 'legacy H3 prompt', resolution: '2K', duration: 5,
        aspectRatio: 'adaptive', videoMode: 'first-last-frame', urls: []
      }), (error) => error && error.code === 'reference-required');
      assert.equal(calls.length, 0);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

test('MiniMax H3 sends validated local first and last frames inline without a media upload', async () => {
  const previousFetch = globalThis.fetch;
  await withEnvironment({ MINIMAX_API_KEY: 'minimax-test-key' }, async () => {
    const localFrame = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url) === 'https://api.minimaxi.com/v2/video_generation') {
        return jsonResponse({ task_id: 'h3-local-frame-task' });
      }
      throw new Error('Unexpected URL: ' + url);
    };
    try {
      await createVideoTask({
        providerId: 'video-1', prompt: 'local first and last frames', resolution: '768P',
        duration: 4, aspectRatio: 'adaptive', videoMode: 'first-last-frame',
        urls: [localFrame, localFrame], referenceMediaTypes: ['image', 'image']
      });
      assert.equal(calls.length, 1);
      const request = JSON.parse(calls[0].options.body);
      assert.match(request.content[1].image_url.url, /^data:image\/png;base64,/);
      assert.match(request.content[2].image_url.url, /^data:image\/png;base64,/);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

test('MiniMax H3 official submission outages remain ambiguous after the paid request starts', async () => {
  const previousFetch = globalThis.fetch;
  await withEnvironment({ MINIMAX_API_KEY: 'minimax-test-key' }, async () => {
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      return jsonResponse({ message: 'temporary creation failure' }, 503);
    };
    try {
      await assert.rejects(
        createVideoTask({
          providerId: 'video-1', prompt: 'local reference', resolution: '768P',
          duration: 4, aspectRatio: 'adaptive', videoMode: 'first-frame',
          urls: ['https://cdn.example.test/reference.png'], referenceMediaTypes: ['image']
        }),
        (error) => error && error.submissionAmbiguous === true
      );
      assert.deepEqual(calls, ['https://api.minimaxi.com/v2/video_generation']);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

test('MiniMax H3 official polling waits for output and reports terminal failures', async () => {
  const previousFetch = globalThis.fetch;
  await withEnvironment({ MINIMAX_API_KEY: 'minimax-test-key' }, async () => {
    let polls = 0;
    globalThis.fetch = async (url) => {
      if (String(url) === 'https://api.minimaxi.com/v2/video_generation') {
        return jsonResponse({ task_id: 'h3-failed-task' });
      }
      if (String(url) === 'https://api.minimaxi.com/v2/query/video_generation/h3-failed-task') {
        polls += 1;
        return polls === 1
          ? jsonResponse({ task: { id: 'h3-failed-task', status: 'processing' } })
          : jsonResponse({ task: { id: 'h3-failed-task', status: 'failed', error_code: 'content_rejected', message: 'The content was rejected.' } });
      }
      throw new Error('Unexpected URL: ' + url);
    };
    try {
      const created = await createVideoTask({
        providerId: 'video-1', prompt: 'failed result', resolution: '768P',
        duration: 4, aspectRatio: 'adaptive', videoMode: 'first-frame',
        urls: ['https://cdn.example.test/moderation-reference.png'],
        referenceMediaTypes: ['image']
      });
      assert.deepEqual(await pollVideoTask(created.providerId, created.taskId), { status: 'running' });
      assert.deepEqual(await pollVideoTask(created.providerId, created.taskId), {
        status: 'failed',
        errorCode: 'content_rejected',
        errorMessage: 'The content was rejected.'
      });
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

test('reference copyright policy rejections keep a specific public-safe error code', async () => {
  const previousFetch = globalThis.fetch;
  await withEnvironment({ ATLASCLOUD_API_KEY: 'atlas-test-key' }, async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return jsonResponse({
        error: {
          code: 'InputImageSensitiveContentDetected.PolicyViolation',
          message: 'The request failed because the input image may be related to copyright restrictions. Request ID: private-upstream-id'
        }
      }, 400);
    };
    try {
      await assert.rejects(
        createVideoTask({
          providerId: 'video-3',
          prompt: 'animate this image',
          resolution: '720P',
          duration: 6,
          aspectRatio: '3:4',
          videoMode: 'first-frame',
          urls: ['https://cdn.example.test/reference.png'],
          referenceMediaTypes: ['image']
        }),
        (error) => {
          assert.equal(error.code, 'reference-policy-rejected');
          assert.equal(error.status, 400);
          assert.match(error.message, /copyrighted or restricted content/i);
          assert.equal(error.message.includes('private-upstream-id'), false);
          assert.equal(error.message.includes('Atlas'), false);
          return true;
        }
      );
      assert.equal(calls, 1, 'a policy rejection must not be retried through another upstream');
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});
test('legacy synchronous video compatibility still creates, polls, and downloads MiniMax image-to-video output', async () => {
  const previousFetch = globalThis.fetch;
  await withEnvironment({ MINIMAX_API_KEY: 'minimax-test-key' }, async () => {
    const video = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url) === 'https://api.minimaxi.com/v2/video_generation') {
        return jsonResponse({ task_id: 'legacy-task-id' });
      }
      if (String(url) === 'https://api.minimaxi.com/v2/query/video_generation/legacy-task-id') {
        return jsonResponse({ task: { status: 'succeeded', content: { url: 'https://cdn.example.test/legacy.mp4' } } });
      }
      if (String(url) === 'https://cdn.example.test/legacy.mp4') {
        return new Response(video, {
          status: 200,
          headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(video.length) }
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    };
    try {
      const result = await generateLegacyVideo({
        providerId: 'video-1',
        prompt: 'legacy compatibility',
        resolution: '768P',
        duration: 5,
        aspectRatio: 'adaptive',
        videoMode: 'first-frame',
        urls: ['https://cdn.example.test/legacy-reference.png'],
        referenceMediaTypes: ['image']
      });
      assert.deepEqual(result, video);
      assert.equal(calls.length, 3);
      assert.equal(calls[0].options.headers.Authorization, 'Bearer minimax-test-key');
      assert.equal(calls[1].options.headers.Authorization, 'Bearer minimax-test-key');
      assert.equal(calls[2].options.headers && calls[2].options.headers.Authorization, undefined);
      assert.equal(calls.some((call) => call.url.includes('api.atlascloud.ai')), false);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

test('legacy synchronous video compatibility rejects an HTTP 200 error page', async () => {
  const previousFetch = globalThis.fetch;
  await withEnvironment({ MINIMAX_API_KEY: 'minimax-test-key' }, async () => {
    globalThis.fetch = async (url) => {
      if (String(url) === 'https://api.minimaxi.com/v2/video_generation') {
        return jsonResponse({ task_id: 'invalid-legacy-task' });
      }
      if (String(url) === 'https://api.minimaxi.com/v2/query/video_generation/invalid-legacy-task') {
        return jsonResponse({ task: { status: 'succeeded', content: { url: 'https://cdn.example.test/error.mp4' } } });
      }
      if (String(url) === 'https://cdn.example.test/error.mp4') {
        return new Response(Buffer.from('<html>upstream error</html>'), { status: 200 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    };
    try {
      await assert.rejects(
        generateLegacyVideo({
          providerId: 'video-1', prompt: 'invalid legacy result', resolution: '768P',
          duration: 5, aspectRatio: 'adaptive', videoMode: 'first-frame',
          urls: ['https://cdn.example.test/error-reference.png'], referenceMediaTypes: ['image']
        }),
        (error) => error && error.code === 'invalid-media'
      );
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

test('provider errors are bounded and redact credential-like values', () => {
  const result = sanitizeVideoJobError({
    code: 'UPSTREAM BAD CODE',
    message: 'Bearer abc.def.ghi failed at https://example.test/path?token=my-secret-token'
  });
  assert.equal(result.code, 'video-generation-failed');
  assert.equal(result.message.includes('abc.def.ghi'), false);
  assert.equal(result.message.includes('my-secret-token'), false);
  assert.ok(result.message.length <= 300);
});

test('migration enforces service-only jobs, atomic reserve/settle, leases, and active-job cleanup protection', () => {
  const migration = fs.readFileSync(new URL('../../supabase/migrations/202608080003_async_video_jobs.sql', import.meta.url), 'utf8');
  const seedanceMigration = fs.readFileSync(new URL('../../supabase/migrations/202608080007_seedance_video_credits.sql', import.meta.url), 'utf8');
  const verifiedMigration = fs.readFileSync(new URL('../../supabase/migrations/202608210004_minimax_h3_verified_settlement.sql', import.meta.url), 'utf8');
  assert.match(migration, /alter table public\.ai_video_jobs enable row level security/i);
  assert.match(migration, /revoke all on table public\.ai_video_jobs from public, anon, authenticated/i);
  assert.match(migration, /create or replace function public\.start_ai_video_job[\s\S]*?reservation := public\.reserve_ai_credits/i);
  assert.match(migration, /existing_job\.token_hash <> lower\(trim\(p_token_hash\)\)[\s\S]*?existing_job\.request_hash <> lower\(trim\(p_request_hash\)\)/i);
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /job\.status = 'starting' and job\.deadline_at <= now\(\)/i);
  assert.match(migration, /video_job\.status in \('starting', 'submitted', 'polling'\)[\s\S]*?video_job\.deadline_at > now\(\)/i);
  assert.match(migration, /deadline_at timestamptz not null default \(now\(\) \+ interval '20 minutes'\)/i);
  assert.match(migration, /settlement := public\.settle_ai_credits/i);
  assert.match(migration, /coalesce\(settlement->>'status', ''\) <> normalized_status[\s\S]*?credit settlement status mismatch/i);
  assert.match(migration, /get_ai_video_job_download[\s\S]*?usage_row\.status = 'succeeded'/i);
  assert.match(migration, /job\.lease_token is null[\s\S]*?job\.lease_token is distinct from p_lease_token[\s\S]*?job\.leased_until is null/i);
  assert.match(seedanceMigration, /drop constraint if exists ai_video_jobs_resolution_check/i);
  assert.match(seedanceMigration, /check \(resolution in \('480P', '720P', '768P', '2K'\)\)/i);
  assert.match(verifiedMigration, /status in \('starting', 'submitted', 'polling', 'ready', 'succeeded', 'failed'\)/i);
  assert.match(verifiedMigration, /target_credits := greatest\(target_credits, actual_retail_credits\)/i);
  assert.match(verifiedMigration, /public\.settle_ai_credits\([\s\S]*?'failed'/i);
  assert.match(verifiedMigration, /grant execute on function public\.settle_ai_video_download/i);
});

test('gateway exposes async task routes while preserving the v0.0.5 synchronous video route', () => {
  const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.match(server, /\/v1\/media\/video\/tasks\/create/);
  assert.match(server, /\/v1\/media\/video\/tasks\/status/);
  assert.match(server, /\/v1\/media\/video\/tasks\/download/);
  assert.match(server, /startVideoJobWorker\([\s\S]*?pollVideoTask/);
  assert.match(server, /url\.pathname === '\/v1\/media\/video'\) kind = 'video'/);
  assert.match(server, /kind === 'video'[\s\S]*?generateLegacyVideo/);
  assert.doesNotMatch(server, /client-update-required/);
  assert.match(server, /video-job-schema-missing'[\s\S]*?video-worker-disabled/);
  assert.match(server, /providerCapabilities\(kind, providerId\)/);
  assert.match(server, /capabilities\.resolutions[\s\S]*?invalid-resolution/);
  assert.match(server, /capabilities\.durations[\s\S]*?invalid-duration/);
  assert.match(server, /capabilities\.frameReferenceRatios[\s\S]*?invalid-aspect-ratio/);
  assert.match(
    server,
    /const generalRatios = new Set\(configuredGeneralRatios\.map\(String\)\)[\s\S]*?videoMode === 'text' \? textRatios : generalRatios/,
    'Omni and video-reference modes must use general ratios rather than the text-only matrix.'
  );
  assert.match(
    server,
    /submittedReferenceCount > 0 && allowedRatios\.size === 1 && allowedRatios\.has\('adaptive'\)[\s\S]*?requestedRatio = 'adaptive'/
  );
  assert.doesNotMatch(server, /MiniMax H3 resolution must be/);
});
