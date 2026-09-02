import assert from 'node:assert/strict';
import test from 'node:test';
import { chat, createVideoTask, generateMedia, pollVideoTask } from '../src/providers.js';
import { providerUserId } from '../src/provider-user.js';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function withEnvironment(values, operation) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.entries(values).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = String(value);
  });
  return Promise.resolve().then(operation).finally(() => {
    Object.entries(previous).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  });
}

test('provider user IDs are stable, distinct, and contain no account data', () => {
  const first = providerUserId('google-user@example.com', 'test-provider-secret');
  const repeat = providerUserId('google-user@example.com', 'test-provider-secret');
  const second = providerUserId('other-user@example.com', 'test-provider-secret');
  assert.equal(first, repeat);
  assert.notEqual(first, second);
  assert.match(first, /^u_[a-f0-9]{20}$/);
  assert.equal(first.includes('google'), false);
  assert.throws(() => providerUserId('user-id', ''), { code: 'provider-user-secret-missing' });
});

test('AI Reiter image routing uses a caller-owned anonymous task ID and returns the completed file', async () => {
  const previousFetch = globalThis.fetch;
  await withEnvironment({
    AIREITER_API_KEY: 'aireiter-key',
    AIREITER_TRAFFIC_PERCENT: '100',
    QUICKROUTER_API_KEY: 'legacy-key'
  }, async () => {
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
      const value = String(url);
      calls.push({ url: value, options });
      if (value.endsWith('/api/openapi/submit')) {
        const body = JSON.parse(options.body);
        assert.equal(body.model, 'nano_banana_pro');
        assert.match(body.out_task_id, /^u_[a-f0-9]{20}_[a-f0-9]{32}$/);
        assert.equal(body.out_task_id.length <= 64, true);
        assert.equal(options.headers['X-End-User-Id'], 'u_0123456789abcdef0123');
        return jsonResponse({ statusCode: 200, data: { status: 'pending' } });
      }
      if (value.endsWith('/api/openapi/query')) {
        return jsonResponse({ statusCode: 200, data: {
          status: 'completed', output: [{ url: 'https://assets.example.com/result.png' }]
        } });
      }
      if (value === 'https://assets.example.com/result.png') {
        return new Response(PNG, { status: 200, headers: { 'Content-Type': 'image/png' } });
      }
      throw new Error(`Unexpected route: ${value}`);
    };

    const result = await generateMedia('image', {
      providerId: 'image-1',
      operationId: '11111111-1111-4111-8111-111111111111',
      endUserId: 'u_0123456789abcdef0123',
      prompt: 'test image',
      size: '2K',
      aspectRatio: '16:9'
    });
    assert.deepEqual(result, PNG);
    assert.deepEqual(calls.map((call) => call.url), [
      'https://aireiter.com/api/openapi/submit',
      'https://aireiter.com/api/openapi/query',
      'https://assets.example.com/result.png'
    ]);
  }).finally(() => { globalThis.fetch = previousFetch; });
});

test('AI Reiter video tasks stay pinned to their accepted route', async () => {
  const previousFetch = globalThis.fetch;
  await withEnvironment({
    AIREITER_API_KEY: 'aireiter-key',
    AIREITER_TRAFFIC_PERCENT: '100',
    MINIMAX_API_KEY: 'legacy-key'
  }, async () => {
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
      const value = String(url);
      calls.push({ url: value, options });
      if (value.endsWith('/api/openapi/submit')) {
        const body = JSON.parse(options.body);
        assert.equal(body.model, 'minimax_h3');
        assert.equal(body.params.type, 'first_last_frame');
        assert.deepEqual(body.params.image_url, ['https://assets.example.com/first.png']);
        return jsonResponse({ statusCode: 200, data: { status: 'pending' } });
      }
      if (value.endsWith('/api/openapi/query')) {
        return jsonResponse({ statusCode: 200, data: {
          status: 'completed', output: [{ url: 'https://assets.example.com/result.mp4' }]
        } });
      }
      throw new Error(`Unexpected route: ${value}`);
    };

    const task = await createVideoTask({
      providerId: 'video-1',
      operationId: '22222222-2222-4222-8222-222222222222',
      endUserId: 'u_0123456789abcdef0123',
      prompt: 'test video',
      resolution: '2K',
      duration: 5,
      aspectRatio: 'adaptive',
      videoMode: 'first-frame',
      urls: ['https://assets.example.com/first.png'],
      referenceMediaTypes: ['image']
    });
    assert.equal(task.providerId, 'aireiter-video-minimax-h3');
    assert.match(task.taskId, /^messs-route:aireiter-video-minimax-h3:/);
    assert.deepEqual(await pollVideoTask(task.providerId, task.taskId), {
      status: 'succeeded', resultUrl: 'https://assets.example.com/result.mp4'
    });
    assert.equal(calls.some((call) => call.url.includes('api.minimaxi.com')), false);
  }).finally(() => { globalThis.fetch = previousFetch; });
});

test('Agent mixed routing sends only the anonymous user field', async () => {
  const previousFetch = globalThis.fetch;
  await withEnvironment({
    AIREITER_API_KEY: 'aireiter-key',
    AIREITER_TRAFFIC_PERCENT: '100',
    AI302_KEY: 'legacy-key'
  }, async () => {
    globalThis.fetch = async (url, options = {}) => {
      assert.equal(String(url), 'https://aireiter.com/api/v1/chat/completions');
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'gpt-5.2');
      assert.equal(body.user, 'u_0123456789abcdef0123');
      assert.equal(JSON.stringify(body).includes('@example.com'), false);
      return jsonResponse({ choices: [{ message: { role: 'assistant', content: 'ok' } }] });
    };
    assert.deepEqual(await chat({
      providerId: 'chat-1',
      model: 'gemini-3.7-flash',
      operationId: '33333333-3333-4333-8333-333333333333',
      endUserId: 'u_0123456789abcdef0123',
      messages: [{ role: 'user', content: 'hello' }]
    }), { text: 'ok', usage: null });
  }).finally(() => { globalThis.fetch = previousFetch; });
});

test('the default 60/40 split is deterministic from the operation ID', async () => {
  const previousFetch = globalThis.fetch;
  await withEnvironment({
    AIREITER_API_KEY: 'aireiter-key',
    AIREITER_TRAFFIC_PERCENT: undefined,
    AIREITER_TRAFFIC_JSON: undefined,
    QUICKROUTER_API_KEY: 'legacy-key'
  }, async () => {
    let activeOperation = '';
    const routes = new Map();
    globalThis.fetch = async (url) => {
      const value = String(url);
      if (value.endsWith('/api/openapi/submit')) {
        if (!routes.has(activeOperation)) routes.set(activeOperation, 'aireiter');
        return jsonResponse({ statusCode: 200, data: { status: 'pending' } });
      }
      if (value.endsWith('/api/openapi/query')) {
        return jsonResponse({ statusCode: 200, data: {
          status: 'completed', output: [{ url: 'https://assets.example.com/weighted.png' }]
        } });
      }
      if (value === 'https://assets.example.com/weighted.png') {
        return new Response(PNG, { status: 200, headers: { 'Content-Type': 'image/png' } });
      }
      if (value.includes('api.quickrouter.ai')) {
        if (!routes.has(activeOperation)) routes.set(activeOperation, 'existing');
        return jsonResponse({ candidates: [{ content: { parts: [{ inlineData: {
          mimeType: 'image/png', data: PNG.toString('base64')
        } }] } }] });
      }
      throw new Error(`Unexpected route: ${value}`);
    };

    for (let index = 0; index < 40; index += 1) {
      activeOperation = `weighted-${index}`;
      await generateMedia('image', {
        providerId: 'image-1', operationId: activeOperation,
        prompt: 'weighted image', size: '1K', aspectRatio: '1:1'
      });
    }
    assert.equal([...routes.values()].filter((route) => route === 'aireiter').length, 24);
    assert.equal([...routes.values()].filter((route) => route === 'existing').length, 16);

    const repeatedOperation = 'weighted-7';
    const originalRoute = routes.get(repeatedOperation);
    routes.delete(repeatedOperation);
    activeOperation = repeatedOperation;
    await generateMedia('image', {
      providerId: 'image-1', operationId: repeatedOperation,
      prompt: 'weighted image', size: '1K', aspectRatio: '1:1'
    });
    assert.equal(routes.get(repeatedOperation), originalRoute);
  }).finally(() => { globalThis.fetch = previousFetch; });
});

test('an ambiguous AI Reiter submission is never replayed on a legacy paid route', async () => {
  const previousFetch = globalThis.fetch;
  await withEnvironment({
    AIREITER_API_KEY: 'aireiter-key',
    AIREITER_TRAFFIC_PERCENT: '100',
    MINIMAX_API_KEY: 'legacy-key'
  }, async () => {
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      return jsonResponse({ message: 'temporary failure' }, 500);
    };
    await assert.rejects(createVideoTask({
      providerId: 'video-1',
      operationId: '44444444-4444-4444-8444-444444444444',
      endUserId: 'u_0123456789abcdef0123',
      prompt: 'test video',
      resolution: '768P',
      duration: 5,
      aspectRatio: 'adaptive',
      videoMode: 'first-frame',
      urls: ['https://assets.example.com/first.png'],
      referenceMediaTypes: ['image']
    }), (error) => error.submissionAmbiguous === true && error.safeToFallback !== true);
    assert.deepEqual(calls, ['https://aireiter.com/api/openapi/submit']);
  }).finally(() => { globalThis.fetch = previousFetch; });
});

test('zero AI Reiter traffic keeps the existing route and ChaserPro remains untouched', async () => {
  const previousFetch = globalThis.fetch;
  await withEnvironment({
    AIREITER_API_KEY: 'aireiter-key',
    AIREITER_TRAFFIC_PERCENT: '0',
    QUICKROUTER_API_KEY: 'legacy-key',
    AI302_KEY: 'legacy-302-key'
  }, async () => {
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      return jsonResponse({ candidates: [{ content: { parts: [{ inlineData: {
        mimeType: 'image/png', data: PNG.toString('base64')
      } }] } }] });
    };
    assert.deepEqual(await generateMedia('image', {
      providerId: 'image-1',
      operationId: '55555555-5555-4555-8555-555555555555',
      prompt: 'legacy image',
      size: '1K',
      aspectRatio: '1:1'
    }), PNG);
    assert.equal(calls[0].includes('api.quickrouter.ai'), true);
    assert.equal(calls.some((url) => url.includes('aireiter.com')), false);

    const catalog = JSON.parse(await (await import('node:fs/promises')).readFile(
      new URL('../../config/provider-catalog.json', import.meta.url), 'utf8'
    ));
    const chaser = catalog.providers.find((provider) => provider.id === 'image-3');
    assert.deepEqual(chaser.fallbackProviderIds, undefined);
    assert.equal(chaser.endpoint, 'https://api.302.ai/doubao/images/generations');
  }).finally(() => { globalThis.fetch = previousFetch; });
});
