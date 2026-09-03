import assert from 'node:assert/strict';
import test from 'node:test';
import { chat, createVideoTask, generateMedia, pollVideoTask } from '../src/providers.js';
import { getAi302RelayAsset } from '../src/ai302-tools.js';
import { providerUserId } from '../src/provider-user.js';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const VALID_PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const VALID_PNG = Buffer.from(VALID_PNG_DATA_URL.split(',')[1], 'base64');

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

test('QuickRouter remains the primary Nano Banana Pro route', async () => {
  const previousFetch = globalThis.fetch;
  await withEnvironment({
    AIREITER_API_KEY: 'aireiter-key',
    QUICKROUTER_API_KEY: 'quickrouter-key'
  }, async () => {
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
      const value = String(url);
      calls.push({ url: value, options });
      if (value.includes('api.quickrouter.ai')) {
        const body = JSON.parse(options.body);
        assert.equal(body.contents[0].parts[0].text, 'test image');
        return jsonResponse({ candidates: [{ content: { parts: [{ inlineData: {
          mimeType: 'image/png', data: PNG.toString('base64')
        } }] } }] });
      }
      throw new Error(`Unexpected route: ${value}`);
    };

    const result = await generateMedia('image', {
      providerId: 'image-1',
      operationId: '11111111-1111-4111-8111-111111111111',
      endUserId: 'u_0123456789abcdef0123',
      prompt: 'test image',
      size: '1K',
      aspectRatio: '16:9'
    });
    assert.deepEqual(result, PNG);
    assert.equal(calls[0].url.includes('api.quickrouter.ai'), true);
  }).finally(() => { globalThis.fetch = previousFetch; });
});

test('AI Reiter Nano Banana 2 references use a public relay and documented URL encoding', async () => {
  const previousFetch = globalThis.fetch;
  await withEnvironment({
    AIREITER_API_KEY: 'aireiter-key',
    AIREITER_TRAFFIC_PERCENT: '100',
    AI_GATEWAY_PUBLIC_URL: 'https://gateway.example.com'
  }, async () => {
    let submittedParams;
    globalThis.fetch = async (url, options = {}) => {
      const value = String(url);
      if (value.endsWith('/api/openapi/submit')) {
        const body = JSON.parse(options.body);
        submittedParams = body.params;
        assert.equal(Array.isArray(body.params.image_url), true);
        assert.equal(body.params.image_url.length, 1);
        assert.equal(body.params.image_url[0].startsWith('data:'), false);
        const relayUrl = new URL(body.params.image_url[0]);
        assert.equal(relayUrl.origin, 'https://gateway.example.com');
        const relay = getAi302RelayAsset(relayUrl.pathname.split('/').at(-1));
        assert.deepEqual(relay.buffer, VALID_PNG);
        assert.equal(relay.mime, 'image/png');
        return jsonResponse({ statusCode: 200, data: { status: 'pending' } });
      }
      if (value.endsWith('/api/openapi/query')) {
        return jsonResponse({ statusCode: 200, data: {
          status: 'completed', output: [{ url: 'https://assets.example.com/result.png' }]
        } });
      }
      if (value === 'https://assets.example.com/result.png') {
        return new Response(VALID_PNG, { status: 200, headers: { 'Content-Type': 'image/png' } });
      }
      throw new Error(`Unexpected route: ${value}`);
    };

    const result = await generateMedia('image', {
      providerId: 'image-2',
      operationId: '22222222-2222-4222-8222-222222222222',
      endUserId: 'u_0123456789abcdef0123',
      prompt: 'edit this image',
      urls: [VALID_PNG_DATA_URL],
      size: '2K',
      aspectRatio: '1:1'
    });
    assert.deepEqual(result, VALID_PNG);
    assert.equal(Array.isArray(submittedParams.image_url), true);
    assert.equal(submittedParams.aspect_ratio, '1:1');
    assert.equal(submittedParams.resolution, '2K');
  }).finally(() => { globalThis.fetch = previousFetch; });
});

test('AI Reiter GPT Image 2 sends resolution with aspect ratio and size by itself', async () => {
  const previousFetch = globalThis.fetch;
  await withEnvironment({
    AIREITER_API_KEY: 'aireiter-key',
    AI302_KEY: 'legacy-key'
  }, async () => {
    const submissions = [];
    globalThis.fetch = async (url, options = {}) => {
      const value = String(url);
      if (value.endsWith('/api/openapi/submit')) {
        submissions.push(JSON.parse(options.body));
        return jsonResponse({ statusCode: 200, data: { status: 'pending' } });
      }
      if (value.endsWith('/api/openapi/query')) {
        return jsonResponse({ statusCode: 200, data: {
          status: 'completed', output: [{ url: VALID_PNG_DATA_URL }]
        } });
      }
      throw new Error(`Unexpected route: ${value}`);
    };

    await generateMedia('image', {
      providerId: 'image-6',
      operationId: '47474747-4747-4474-8474-474747474747',
      prompt: 'documented ratio',
      size: 'auto',
      aspectRatio: '16:9'
    });
    assert.equal(submissions[0].model, 'gpt_image_2');
    assert.equal(submissions[0].params.aspect_ratio, '16:9');
    assert.equal(submissions[0].params.resolution, '2K');
    assert.equal(submissions[0].params.size, undefined);
  }).finally(() => { globalThis.fetch = previousFetch; });
});

test('AI Reiter accepts numeric completion status and nested result URLs', async () => {
  const previousFetch = globalThis.fetch;
  await withEnvironment({ AIREITER_API_KEY: 'aireiter-key' }, async () => {
    let queryCount = 0;
    globalThis.fetch = async (url) => {
      const value = String(url);
      if (value.endsWith('/api/openapi/submit')) {
        return jsonResponse({ statusCode: 200, data: { status: 0 } });
      }
      if (value.endsWith('/api/openapi/query')) {
        queryCount += 1;
        return jsonResponse({ statusCode: 200, data: queryCount === 1
          ? { status: 1 }
          : { status: 2, result: { response: { download_url: VALID_PNG_DATA_URL } } } });
      }
      throw new Error(`Unexpected route: ${value}`);
    };

    const result = await generateMedia('image', {
      providerId: 'image-2',
      operationId: '48484848-4848-4484-8484-484848484848',
      prompt: 'numeric status result',
      size: '1K',
      aspectRatio: '1:1'
    });
    assert.deepEqual(result, VALID_PNG);
    assert.equal(queryCount, 2);
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
        assert.equal(body.params.aspect_ratio, undefined);
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
    assert.equal(task.providerId, 'video-1');
    assert.match(task.taskId, /^u_0123456789abcdef0123_[a-f0-9]{32}$/);
    assert.deepEqual(await pollVideoTask(task.providerId, task.taskId), {
      status: 'succeeded', resultUrl: 'https://assets.example.com/result.mp4'
    });
    assert.equal(calls.some((call) => call.url.includes('api.minimaxi.com')), false);
  }).finally(() => { globalThis.fetch = previousFetch; });
});

test('100 percent AI Reiter traffic is absolute even without an operation ID', async () => {
  const previousFetch = globalThis.fetch;
  await withEnvironment({
    AIREITER_API_KEY: 'aireiter-key',
    AIREITER_TRAFFIC_PERCENT: '100',
    AIREITER_TRAFFIC_JSON: undefined,
    MINIMAX_API_KEY: 'legacy-key'
  }, async () => {
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
      const value = String(url);
      calls.push(value);
      if (value.endsWith('/api/openapi/submit')) {
        const body = JSON.parse(options.body);
        assert.equal(body.model, 'minimax_h3');
        return jsonResponse({ statusCode: 200, data: { status: 'pending' } });
      }
      throw new Error(`Unexpected route: ${value}`);
    };

    const task = await createVideoTask({
      providerId: 'video-1',
      prompt: 'test video',
      resolution: '768P',
      duration: 5,
      aspectRatio: '16:9',
      videoMode: 'first-frame',
      urls: ['https://assets.example.com/first.png'],
      referenceMediaTypes: ['image']
    });
    assert.equal(task.providerId, 'video-1');
    assert.deepEqual(calls, ['https://aireiter.com/api/openapi/submit']);
  }).finally(() => { globalThis.fetch = previousFetch; });
});

test('AI Reiter MiniMax H3 rejects unsupported frame media before submission', async () => {
  const previousFetch = globalThis.fetch;
  await withEnvironment({
    AIREITER_API_KEY: 'aireiter-key',
    AIREITER_TRAFFIC_PERCENT: '100',
    MINIMAX_API_KEY: 'legacy-key'
  }, async () => {
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      throw new Error('No upstream request should be sent.');
    };
    await assert.rejects(createVideoTask({
      providerId: 'video-1',
      operationId: '23232323-2323-4232-8232-232323232323',
      prompt: 'test video',
      resolution: '2K',
      duration: 5,
      aspectRatio: '16:9',
      videoMode: 'first-frame',
      urls: ['https://assets.example.com/reference.mp4'],
      referenceMediaTypes: ['video']
    }), { code: 'invalid-reference-media' });
    assert.deepEqual(calls, []);
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

test('Agent corrects a stale provider when the requested model belongs to another route', async () => {
  const previousFetch = globalThis.fetch;
  await withEnvironment({
    AIREITER_API_KEY: 'aireiter-key',
    AIREITER_TRAFFIC_PERCENT: '0',
    AI302_KEY: 'legacy-key'
  }, async () => {
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
      const value = String(url);
      calls.push({ url: value, body: JSON.parse(options.body) });
      if (value.includes('aireiter.com')) {
        assert.equal(calls[0].body.model, 'gpt-5.2');
        return jsonResponse({ choices: [{ message: { role: 'assistant', content: 'corrected' } }] });
      }
      throw new Error('Stale provider must not be called: ' + value);
    };
    assert.deepEqual(await chat({
      providerId: 'chat-1',
      model: 'gpt-5.6-luna',
      operationId: '36363636-3636-4363-8363-363636363636',
      endUserId: 'u_0123456789abcdef0123',
      messages: [{ role: 'user', content: 'hello' }]
    }), { text: 'corrected', usage: null });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://aireiter.com/api/v1/chat/completions');
  }).finally(() => { globalThis.fetch = previousFetch; });
});

test('Luna uses AI Reiter and its documented upstream model alias', async () => {
  const previousFetch = globalThis.fetch;
  await withEnvironment({
    AIREITER_API_KEY: 'aireiter-key',
    AIREITER_TRAFFIC_PERCENT: '0',
    QUICKROUTER_API_KEY: 'legacy-key'
  }, async () => {
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
      const value = String(url);
      const body = JSON.parse(options.body);
      calls.push({ url: value, model: body.model });
      if (value.includes('aireiter.com')) {
        assert.equal(body.model, 'gpt-5.2');
        return jsonResponse({ choices: [{ message: { role: 'assistant', content: 'Luna is ready.' } }] });
      }
      throw new Error(`Unexpected route: ${value}`);
    };

    assert.deepEqual(await chat({
      providerId: 'chat-2',
      model: 'gpt-5.6-luna',
      operationId: '34343434-3434-4343-8343-343434343434',
      endUserId: 'u_0123456789abcdef0123',
      messages: [{ role: 'user', content: 'hello' }]
    }), { text: 'Luna is ready.', usage: null });
    assert.deepEqual(calls.map((call) => call.model), ['gpt-5.2']);
    assert.equal(calls[0].url.includes('aireiter.com'), true);
  }).finally(() => { globalThis.fetch = previousFetch; });
});

test('Nano Banana Pro remains QuickRouter primary and deterministic', async () => {
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
    assert.equal([...routes.values()].filter((route) => route === 'existing').length, 40);
    assert.equal([...routes.values()].filter((route) => route === 'aireiter').length, 0);

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
    assert.deepEqual(calls, [
      'https://aireiter.com/api/openapi/submit',
      'https://aireiter.com/api/openapi/query'
    ]);
  }).finally(() => { globalThis.fetch = previousFetch; });
});

test('an interrupted AI Reiter submission resumes from its deterministic task ID', async () => {
  const previousFetch = globalThis.fetch;
  await withEnvironment({
    AIREITER_API_KEY: 'aireiter-key',
    MINIMAX_API_KEY: 'legacy-key'
  }, async () => {
    const calls = [];
    globalThis.fetch = async (url) => {
      const value = String(url);
      calls.push(value);
      if (value.endsWith('/api/openapi/submit')) throw new TypeError('socket closed');
      if (value.endsWith('/api/openapi/query')) {
        return jsonResponse({ statusCode: 200, data: { status: 'pending' } });
      }
      throw new Error(`Unexpected route: ${value}`);
    };
    const task = await createVideoTask({
      providerId: 'video-1',
      operationId: '45454545-4545-4454-8454-454545454545',
      endUserId: 'u_0123456789abcdef0123',
      prompt: 'recover this video',
      resolution: '768P',
      duration: 5,
      aspectRatio: 'adaptive',
      videoMode: 'first-frame',
      urls: ['https://assets.example.com/first.png'],
      referenceMediaTypes: ['image']
    });
    assert.equal(task.providerId, 'video-1');
    assert.match(task.taskId, /^u_0123456789abcdef0123_[a-f0-9]{32}$/);
    assert.deepEqual(calls, [
      'https://aireiter.com/api/openapi/submit',
      'https://aireiter.com/api/openapi/query'
    ]);
  }).finally(() => { globalThis.fetch = previousFetch; });
});

test('a proven AI Reiter rejection uses Nano Banana 2 legacy fallback', async () => {
  const previousFetch = globalThis.fetch;
  await withEnvironment({
    AIREITER_API_KEY: 'aireiter-key',
    AI302_KEY: 'legacy-key'
  }, async () => {
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
      const value = String(url);
      calls.push(value);
      if (value.endsWith('/api/openapi/submit')) {
        return jsonResponse({ statusCode: 429, message: 'busy' });
      }
      if (value.includes('api.302.ai')) {
        return jsonResponse({ data: { url: VALID_PNG_DATA_URL } });
      }
      throw new Error(`Unexpected route: ${value}`);
    };
    assert.deepEqual(await generateMedia('image', {
      providerId: 'image-2',
      operationId: '46464646-4646-4464-8464-464646464646',
      prompt: 'fallback image',
      size: '1K',
      aspectRatio: '1:1'
    }), VALID_PNG);
    assert.equal(calls[0], 'https://aireiter.com/api/openapi/submit');
    assert.equal(calls[1].includes('api.302.ai'), true);
  }).finally(() => { globalThis.fetch = previousFetch; });
});

test('legacy traffic controls cannot demote QuickRouter and ChaserPro remains hidden', async () => {
  const previousFetch = globalThis.fetch;
  await withEnvironment({
    AIREITER_API_KEY: 'aireiter-key',
    AIREITER_TRAFFIC_PERCENT: '0',
    QUICKROUTER_API_KEY: 'legacy-key',
    AI302_KEY: 'legacy-302-key'
  }, async () => {
    const calls = [];
    globalThis.fetch = async (url) => {
      const value = String(url);
      calls.push(value);
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
    assert.equal(chaser.hidden, true);
    assert.equal(chaser.name, 'Chaser Pro');
    assert.equal(chaser.endpoint, 'https://api.302.ai/doubao/images/generations');
  }).finally(() => { globalThis.fetch = previousFetch; });
});
