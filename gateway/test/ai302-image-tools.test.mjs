import assert from 'node:assert/strict';
import test from 'node:test';
import zlib from 'node:zlib';
import fs from 'node:fs';
import {
  cleanupImageObjects,
  downloadAi302ImageResult,
  eraseImageObjects,
  generativeUpscaleImage,
  pollTopazImageTool,
  pollQwenImageEdit,
  pollQwenImageLayered,
  submitTopazImageTool,
  submitQwenImageEdit,
  submitQwenImageLayered,
  superUpscaleImage,
  uncropImage
} from '../src/ai302-image-tools.js';
import { getAi302RelayAsset, validatePng } from '../src/ai302-tools.js';

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBytes = Buffer.from(type, 'ascii');
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  typeBytes.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return result;
}

function rgbaPng({ metadata = false } = {}) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  const chunks = [
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header)
  ];
  if (metadata) chunks.push(pngChunk('tEXt', Buffer.from('Location\0private-metadata', 'latin1')));
  chunks.push(pngChunk('IDAT', zlib.deflateSync(Buffer.from([0, 255, 0, 0, 0]))));
  chunks.push(pngChunk('IEND'));
  return Buffer.concat(chunks);
}

function imageDataUrl(buffer, mime = 'image/png') {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}

function relayToken(urlValue) {
  return new URL(urlValue).pathname.split('/').at(-1);
}

test('Qwen Image Edit Plus submits sanitized relay images and polls with an owner-bound opaque token', async () => {
  const source = rgbaPng({ metadata: true });
  let createBody;
  const created = await submitQwenImageEdit({
    imageDataUrls: [imageDataUrl(source)],
    prompt: 'Turn the jacket red',
    toolOptions: { width: 1024, height: 768, numInferenceSteps: 24, guidanceScale: 3.5 },
    userId: 'edit-owner'
  }, {
    apiKey: 'server-only-302-key',
    taskSecret: 'independent-image-token-secret',
    publicBaseUrl: 'https://gateway.example.com',
    now: 1_800_000_000_000,
    fetchImpl: async (url, options) => {
      assert.equal(String(url), 'https://api.302.ai/302/submit/qwen-image-edit-plus');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Bearer server-only-302-key');
      createBody = JSON.parse(options.body);
      return jsonResponse({
        request_id: 'private-edit-request-id',
        status: 'IN_QUEUE',
        queue_position: 0
      });
    }
  });

  assert.equal(created.taskToken.includes('private-edit-request-id'), false);
  assert.deepEqual(
    { status: created.status, retryAfterMs: created.retryAfterMs, urls: created.urls },
    { status: 'queued', retryAfterMs: 5000, urls: [] }
  );
  assert.deepEqual(createBody, {
    prompt: 'Turn the jacket red',
    image_urls: [createBody.image_urls[0]],
    image_size: { width: 1024, height: 768 },
    num_inference_steps: 24,
    guidance_scale: 3.5,
    output_format: 'png',
    negative_prompt: 'blurry, ugly'
  });
  assert.match(createBody.image_urls[0], /^https:\/\/gateway\.example\.com\/v1\/tools\/assets\/[A-Za-z0-9_-]{43}$/);
  const relayed = getAi302RelayAsset(relayToken(createBody.image_urls[0]), { now: 1_800_000_001_000 });
  assert.equal(relayed.buffer.includes(Buffer.from('private-metadata')), false);
  assert.equal(relayed.mime, 'image/png');

  const pending = await pollQwenImageEdit({ taskToken: created.taskToken, userId: 'edit-owner' }, {
    apiKey: 'server-only-302-key',
    taskSecret: 'independent-image-token-secret',
    now: 1_800_000_005_000,
    fetchImpl: async (url, options) => {
      assert.equal(String(url), 'https://api.302.ai/302/submit/qwen-image-edit-plus?request_id=private-edit-request-id');
      assert.equal(options.method, 'GET');
      assert.equal(options.headers.Authorization, 'Bearer server-only-302-key');
      return jsonResponse({ status: 'PROCESSING' });
    }
  });
  assert.deepEqual(pending, { status: 'processing', retryAfterMs: 5000, urls: [] });

  const complete = await pollQwenImageEdit({ taskToken: created.taskToken, userId: 'edit-owner' }, {
    apiKey: 'server-only-302-key',
    taskSecret: 'independent-image-token-secret',
    now: 1_800_000_010_000,
    fetchImpl: async () => jsonResponse({
      images: [{ url: 'https://file.302.ai/gpt/imgs/result.png', content_type: 'image/png' }]
    })
  });
  assert.deepEqual(complete, {
    status: 'succeeded',
    retryAfterMs: 0,
    urls: ['https://file.302.ai/gpt/imgs/result.png']
  });

  await assert.rejects(
    () => pollQwenImageEdit({ taskToken: created.taskToken, userId: 'different-owner' }, {
      apiKey: 'server-only-302-key',
      taskSecret: 'independent-image-token-secret',
      now: 1_800_000_010_000,
      fetchImpl: async () => { throw new Error('must not fetch'); }
    }),
    { code: 'image-tool-task-not-found', status: 404 }
  );
});

test('Qwen Image Layered submits one relay and accepts only allowlisted result URLs', async () => {
  const source = rgbaPng();
  let submitBody;
  const created = await submitQwenImageLayered({
    imageDataUrl: imageDataUrl(source),
    prompt: 'Separate foreground, subject, shadow, and background',
    numLayers: 4,
    userId: 'layer-owner'
  }, {
    apiKey: 'layer-key',
    taskSecret: 'layer-task-secret',
    publicBaseUrl: 'https://gateway.example.com',
    now: 1_800_000_000_000,
    fetchImpl: async (url, options) => {
      assert.equal(String(url), 'https://api.302.ai/302/submit/qwen-image-layered');
      submitBody = JSON.parse(options.body);
      return jsonResponse({ request_id: 'private-layer-request-id', status: 'IN_QUEUE' });
    }
  });
  assert.deepEqual(submitBody, {
    image_url: submitBody.image_url,
    prompt: 'Separate foreground, subject, shadow, and background',
    num_layers: 4,
    enable_safety_checker: true,
    output_format: 'png'
  });
  assert.match(submitBody.image_url, /^https:\/\/gateway\.example\.com\/v1\/tools\/assets\//);

  const complete = await pollQwenImageLayered({ taskToken: created.taskToken, userId: 'layer-owner' }, {
    apiKey: 'layer-key',
    taskSecret: 'layer-task-secret',
    now: 1_800_000_002_000,
    fetchImpl: async (url) => {
      assert.equal(String(url), 'https://api.302.ai/302/submit/qwen-image-layered?request_id=private-layer-request-id');
      return jsonResponse({
        images: [
          { url: 'https://file.302.ai/layers/base.png' },
          { url: 'https://v3b.fal.media/files/layer-1.png' }
        ]
      });
    }
  });
  assert.deepEqual(complete, {
    status: 'succeeded',
    retryAfterMs: 0,
    urls: [
      'https://file.302.ai/layers/base.png',
      'https://v3b.fal.media/files/layer-1.png'
    ]
  });

  await assert.rejects(
    () => pollQwenImageLayered({ taskToken: created.taskToken, userId: 'layer-owner' }, {
      apiKey: 'layer-key',
      taskSecret: 'layer-task-secret',
      now: 1_800_000_003_000,
      fetchImpl: async () => jsonResponse({ images: [{ url: 'https://file.302.ai.evil.test/result.png' }] })
    }),
    { code: 'unsafe-tool-result-url', status: 502 }
  );
});

test('Super Upscale V2 is synchronous, bounded, and releases its temporary relay', async () => {
  const source = rgbaPng();
  let body;
  const result = await superUpscaleImage({
    imageDataUrl: imageDataUrl(source),
    toolOptions: { scale: 3, creativity: 0.25, detail: 2, shapePreservation: 0.15 }
  }, {
    apiKey: 'upscale-key',
    publicBaseUrl: 'https://gateway.example.com',
    now: 1_800_000_000_000,
    fetchImpl: async (url, options) => {
      assert.equal(String(url), 'https://api.302.ai/302/submit/super-upscale-v2');
      assert.equal(options.headers.Authorization, 'Bearer upscale-key');
      body = JSON.parse(options.body);
      return jsonResponse({ image: { url: 'https://file.302.ai/upscale/result.png' } });
    }
  });
  assert.deepEqual(result, {
    status: 'succeeded', retryAfterMs: 0, urls: ['https://file.302.ai/upscale/result.png']
  });
  assert.deepEqual(body, {
    model_type: 'SDXL',
    scale: 3,
    creativity: 0.25,
    detail: 2,
    shape_preservation: 0.15,
    prompt_suffix: 'high quality, highly detailed, high resolution, sharp',
    negative_prompt: 'blurry, low resolution, bad, ugly, low quality, pixelated, interpolated, compression artifacts, noisy, grainy',
    guidance_scale: 7.5,
    num_inference_steps: 20,
    override_size_limits: false,
    image_url: body.image_url
  });
  assert.throws(
    () => getAi302RelayAsset(relayToken(body.image_url), { now: 1_800_000_001_000 }),
    { code: 'tool-asset-not-found' }
  );

  await assert.rejects(
    () => superUpscaleImage({
      imageDataUrl: imageDataUrl(source), toolOptions: { scale: 12 }
    }, {
      apiKey: 'upscale-key', publicBaseUrl: 'https://gateway.example.com',
      fetchImpl: async () => { throw new Error('must not fetch'); }
    }),
    { code: 'invalid-image-tool-options', status: 400 }
  );
});

test('image tools report a rejected 302 key without exposing it', async () => {
  await assert.rejects(
    () => superUpscaleImage({ imageDataUrl: imageDataUrl(rgbaPng()) }, {
      apiKey: 'rejected-image-key',
      publicBaseUrl: 'https://gateway.example.com',
      fetchImpl: async () => new Response(null, { status: 401 })
    }),
    (error) => error && error.code === 'ai302-unauthorized'
      && error.status === 503
      && !String(error.message).includes('rejected-image-key')
  );
});

test('image tools distinguish a provider timeout from a transport outage', async () => {
  await assert.rejects(
    () => superUpscaleImage({ imageDataUrl: imageDataUrl(rgbaPng()) }, {
      apiKey: 'timeout-image-key',
      publicBaseUrl: 'https://gateway.example.com',
      signal: AbortSignal.abort(new DOMException('timed out', 'TimeoutError')),
      fetchImpl: async (_url, options) => { throw options.signal.reason; }
    }),
    { code: 'ai302-timeout', status: 504 }
  );
});

test('image tools accept wrapped 302 task and synchronous result payloads', async () => {
  const source = rgbaPng();
  const created = await submitQwenImageEdit({
    imageDataUrl: imageDataUrl(source),
    prompt: 'Make the product blue',
    userId: 'wrapped-image-owner'
  }, {
    apiKey: 'wrapped-image-key',
    taskSecret: 'wrapped-image-secret',
    publicBaseUrl: 'https://gateway.example.com',
    now: 1_800_000_000_000,
    fetchImpl: async () => jsonResponse({ data: { requestId: 'wrapped-image-job', status: 'IN_QUEUE' } })
  });
  const completed = await pollQwenImageEdit({
    taskToken: created.taskToken,
    userId: 'wrapped-image-owner'
  }, {
    apiKey: 'wrapped-image-key',
    taskSecret: 'wrapped-image-secret',
    now: 1_800_000_001_000,
    fetchImpl: async () => jsonResponse({
      response: { images: [{ url: 'https://file.302.ai/wrapped/edit.png' }] }
    })
  });
  assert.deepEqual(completed, {
    status: 'succeeded',
    retryAfterMs: 0,
    urls: ['https://file.302.ai/wrapped/edit.png']
  });

  const upscaled = await superUpscaleImage({ imageDataUrl: imageDataUrl(source) }, {
    apiKey: 'wrapped-image-key',
    publicBaseUrl: 'https://gateway.example.com',
    now: 1_800_000_000_000,
    fetchImpl: async () => jsonResponse({
      data: { result: { image: { url: 'https://file.302.ai/wrapped/upscaled.png' } } }
    })
  });
  assert.deepEqual(upscaled, {
    status: 'succeeded',
    retryAfterMs: 0,
    urls: ['https://file.302.ai/wrapped/upscaled.png']
  });
});

test('Topaz image tools use documented endpoints, real provider credits, polling, and settlement', async () => {
  const source = rgbaPng({ metadata: true });
  const processId = '11111111-2222-4333-8444-555555555555';
  let createBody;
  const created = await submitTopazImageTool({
    modelId: 'topaz-image-enhance',
    imageDataUrl: imageDataUrl(source),
    toolOptions: { outputWidth: 2048, outputHeight: 1536, cropToFill: true },
    userId: 'topaz-image-owner'
  }, {
    apiKey: 'topaz-image-key',
    taskSecret: 'topaz-image-task-secret',
    publicBaseUrl: 'https://gateway.example.com',
    accountingRequestId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    now: 1_800_000_000_000,
    fetchImpl: async (url, options) => {
      assert.equal(String(url), 'https://api.302.ai/topazlabs/image/v1/enhance/async');
      assert.equal(options.headers.Authorization, 'Bearer topaz-image-key');
      createBody = JSON.parse(options.body);
      return jsonResponse({ process_id: processId, credits: 2 });
    },
    reserveCredits: async (request) => {
      assert.deepEqual(request, {
        requestId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        providerId: 'topaz-image-enhance',
        providerCost: 2
      });
      return { ok: true, credits: 6, availableCredits: 94 };
    }
  });
  assert.equal(createBody.model, 'Standard V2');
  assert.equal(createBody.output_format, 'png');
  assert.equal(createBody.output_width, 2048);
  assert.equal(createBody.output_height, 1536);
  assert.equal(createBody.crop_to_fill, true);
  assert.match(createBody.image, /^https:\/\/gateway\.example\.com\/v1\/tools\/assets\//);
  assert.equal(created.providerCost, 2);
  assert.equal(created.credits, 6);
  assert.equal(created.taskToken.includes(processId), false);

  const calls = [];
  const completed = await pollTopazImageTool({
    taskToken: created.taskToken,
    userId: 'topaz-image-owner'
  }, {
    apiKey: 'topaz-image-key',
    taskSecret: 'topaz-image-task-secret',
    now: 1_800_000_005_000,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).includes('/status/')) {
        return jsonResponse({ status: 'completed', progress: 100, credits: 2 });
      }
      return jsonResponse({ download_url: 'https://file.302.ai/topaz/enhanced.png' });
    },
    touchCredits: async ({ requestId }) => ({ ok: requestId === 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }),
    settleCredits: async ({ requestId, status }) => ({
      ok: requestId === 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' && status === 'succeeded',
      creditsCharged: 6
    })
  });
  assert.equal(calls[0].url, `https://api.302.ai/topazlabs/image/v1/status/${processId}`);
  assert.equal(calls[1].url, `https://api.302.ai/topazlabs/image/v1/download/${processId}`);
  assert.deepEqual(completed, {
    status: 'succeeded',
    progress: 100,
    retryAfterMs: 0,
    urls: ['https://file.302.ai/topaz/enhanced.png'],
    providerCost: 2,
    creditsCharged: 6
  });
});

test('Topaz generative sharpen and enhance use their distinct documented endpoints', async () => {
  const source = imageDataUrl(rgbaPng());
  const cases = [
    {
      modelId: 'topaz-image-sharpen-gen',
      path: '/topazlabs/image/v1/sharpen-gen/async',
      model: 'Super Focus V2',
      requestId: '11111111-aaaa-4bbb-8ccc-111111111111'
    },
    {
      modelId: 'topaz-image-enhance-gen',
      path: '/topazlabs/image/v1/enhance-gen/async',
      model: 'Redefine',
      requestId: '22222222-aaaa-4bbb-8ccc-222222222222'
    }
  ];
  for (const entry of cases) {
    let body;
    const created = await submitTopazImageTool({
      modelId: entry.modelId,
      imageDataUrl: source,
      toolOptions: entry.modelId.endsWith('enhance-gen')
        ? { outputWidth: 1600, outputHeight: 1200 }
        : {},
      userId: `owner-${entry.modelId}`
    }, {
      apiKey: 'topaz-generative-key',
      taskSecret: 'topaz-generative-secret',
      publicBaseUrl: 'https://gateway.example.com',
      accountingRequestId: entry.requestId,
      now: 1_800_000_000_000,
      fetchImpl: async (url, options) => {
        assert.equal(String(url), `https://api.302.ai${entry.path}`);
        body = JSON.parse(options.body);
        return jsonResponse({ process_id: entry.requestId, credits: 1 });
      },
      reserveCredits: async ({ providerId, providerCost }) => {
        assert.equal(providerId, entry.modelId);
        assert.equal(providerCost, 1);
        return { ok: true, credits: 3, availableCredits: 97 };
      }
    });
    assert.equal(body.model, entry.model);
    assert.equal(created.providerCost, 1);
    assert.equal(created.credits, 3);
    if (entry.modelId.endsWith('enhance-gen')) {
      assert.equal(body.output_width, 1600);
      assert.equal(body.output_height, 1200);
    }
  }
});

test('all seven Topaz image tools use their documented endpoint and default model', async () => {
  const source = imageDataUrl(rgbaPng());
  const cases = [
    ['topaz-image-sharpen', '/topazlabs/image/v1/sharpen/async', 'Standard'],
    ['topaz-image-sharpen-gen', '/topazlabs/image/v1/sharpen-gen/async', 'Super Focus V2'],
    ['topaz-image-enhance', '/topazlabs/image/v1/enhance/async', 'Standard V2'],
    ['topaz-image-enhance-gen', '/topazlabs/image/v1/enhance-gen/async', 'Redefine'],
    ['topaz-image-denoise', '/topazlabs/image/v1/denoise/async', 'Normal'],
    ['topaz-image-restore', '/topazlabs/image/v1/restore-gen/async', 'Dust-Scratch'],
    ['topaz-image-lighting', '/topazlabs/image/v1/lighting/async', 'Adjust']
  ];
  for (let index = 0; index < cases.length; index += 1) {
    const [modelId, endpoint, model] = cases[index];
    const processId = `1000000${index}-0000-4000-8000-00000000000${index}`;
    let requestBody;
    const created = await submitTopazImageTool({
      modelId,
      imageDataUrl: source,
      userId: `topaz-matrix-owner-${index}`
    }, {
      apiKey: 'topaz-matrix-key',
      taskSecret: 'topaz-matrix-secret',
      publicBaseUrl: 'https://gateway.example.com',
      now: 1_800_000_000_000,
      fetchImpl: async (url, options) => {
        assert.equal(String(url), `https://api.302.ai${endpoint}`);
        requestBody = JSON.parse(options.body);
        return jsonResponse({ process_id: processId, credits: 1 });
      },
      reserveCredits: async ({ providerId, providerCost }) => ({
        ok: providerId === modelId && providerCost === 1,
        credits: 3,
        availableCredits: 97
      })
    });
    assert.equal(requestBody.model, model);
    assert.match(requestBody.image, /^https:\/\/gateway\.example\.com\/v1\/tools\/assets\//);
    assert.equal(created.providerCost, 1);
  }
});

test('Topaz image tools unwrap aliases and keep polling until a download URL exists', async () => {
  const processId = '33333333-4444-4555-8666-777777777777';
  const created = await submitTopazImageTool({
    modelId: 'topaz-image-restore',
    imageDataUrl: imageDataUrl(rgbaPng()),
    userId: 'topaz-wrapped-owner'
  }, {
    apiKey: 'topaz-wrapped-key',
    taskSecret: 'topaz-wrapped-secret',
    publicBaseUrl: 'https://gateway.example.com',
    now: 1_800_000_000_000,
    fetchImpl: async () => jsonResponse({ data: { result: { processId, providerCost: 2 } } }),
    reserveCredits: async ({ providerCost }) => ({ ok: providerCost === 2, credits: 6 })
  });

  let call = 0;
  const waiting = await pollTopazImageTool({
    taskToken: created.taskToken,
    userId: 'topaz-wrapped-owner'
  }, {
    apiKey: 'topaz-wrapped-key',
    taskSecret: 'topaz-wrapped-secret',
    now: 1_800_000_002_000,
    fetchImpl: async () => {
      call += 1;
      return call === 1
        ? jsonResponse({ response: { data: { taskStatus: 'complete', progressPercent: 100, provider_cost: 2 } } })
        : jsonResponse({ data: { result: {} } });
    },
    touchCredits: async () => ({ ok: true }),
    settleCredits: async () => { throw new Error('A result without a URL must not settle.'); }
  });
  assert.deepEqual(waiting, {
    status: 'processing',
    progress: 100,
    retryAfterMs: 5000,
    urls: [],
    providerCost: 2
  });

  call = 0;
  const completed = await pollTopazImageTool({
    taskToken: created.taskToken,
    userId: 'topaz-wrapped-owner'
  }, {
    apiKey: 'topaz-wrapped-key',
    taskSecret: 'topaz-wrapped-secret',
    now: 1_800_000_004_000,
    fetchImpl: async () => {
      call += 1;
      return call === 1
        ? jsonResponse({ payload: { state: 'completed', percentage: 100, cost: 2 } })
        : jsonResponse({ data: { result: { downloadUrl: 'https://file.302.ai/topaz/wrapped.png' } } });
    },
    touchCredits: async () => ({ ok: true }),
    settleCredits: async ({ status }) => ({ ok: status === 'succeeded', creditsCharged: 6 })
  });
  assert.deepEqual(completed, {
    status: 'succeeded',
    progress: 100,
    retryAfterMs: 0,
    urls: ['https://file.302.ai/topaz/wrapped.png'],
    providerCost: 2,
    creditsCharged: 6
  });
});

test('Topaz image failure settles as released credits', async () => {
  const processId = '66666666-7777-4888-8999-aaaaaaaaaaaa';
  const created = await submitTopazImageTool({
    modelId: 'topaz-image-denoise',
    imageDataUrl: imageDataUrl(rgbaPng()),
    userId: 'topaz-failed-owner'
  }, {
    apiKey: 'topaz-failed-key',
    taskSecret: 'topaz-failed-secret',
    publicBaseUrl: 'https://gateway.example.com',
    now: 1_800_000_000_000,
    fetchImpl: async () => jsonResponse({ process_id: processId, credits: 1 }),
    reserveCredits: async () => ({ ok: true, credits: 3, availableCredits: 97 })
  });
  const failed = await pollTopazImageTool({
    taskToken: created.taskToken,
    userId: 'topaz-failed-owner'
  }, {
    apiKey: 'topaz-failed-key',
    taskSecret: 'topaz-failed-secret',
    now: 1_800_000_003_000,
    fetchImpl: async () => jsonResponse({ status: 'failed', progress: 40, credits: 1 }),
    touchCredits: async () => ({ ok: true }),
    settleCredits: async ({ status }) => ({ ok: status === 'failed', creditsReleased: 3 })
  });
  assert.deepEqual(failed, {
    status: 'failed',
    progress: 40,
    retryAfterMs: 0,
    urls: [],
    providerCost: 1,
    creditsReleased: 3
  });
});

test('Erase sends sanitized multipart image and mask files and returns one safe URL', async () => {
  const source = rgbaPng({ metadata: true });
  const mask = rgbaPng({ metadata: true });
  let form;
  const result = await eraseImageObjects({
    imageDataUrl: imageDataUrl(source),
    maskImageDataUrl: imageDataUrl(mask)
  }, {
    apiKey: 'erase-key',
    fetchImpl: async (url, options) => {
      assert.equal(String(url), 'https://api.302.ai/302/submit/erase');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Bearer erase-key');
      assert.equal(options.headers.Accept, 'image/*');
      assert.equal(options.headers['Content-Type'], undefined);
      form = options.body;
      return jsonResponse({ image: { url: 'https://file.302.ai/erase/result.png' } });
    }
  });
  assert.deepEqual(result, {
    status: 'succeeded', retryAfterMs: 0, urls: ['https://file.302.ai/erase/result.png']
  });
  const imageFile = form.get('image_url');
  const maskFile = form.get('mask_image_url');
  assert.equal(imageFile.name, 'image.png');
  assert.equal(maskFile.name, 'mask.png');
  assert.equal(Buffer.from(await imageFile.arrayBuffer()).includes(Buffer.from('private-metadata')), false);
  assert.equal(Buffer.from(await maskFile.arrayBuffer()).includes(Buffer.from('private-metadata')), false);
});

test('Clipdrop Uncrop sends exact centered pixel extensions and returns the raster result', async () => {
  const output = rgbaPng();
  let form;
  const result = await uncropImage({
    imageDataUrl: imageDataUrl(rgbaPng({ metadata: true })),
    toolOptions: { left: 512, right: 513, up: 256, down: 257, seed: 713 }
  }, {
    apiKey: 'uncrop-key',
    fetchImpl: async (url, options) => {
      assert.equal(String(url), 'https://api.302.ai/clipdrop/uncrop/v1');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Bearer uncrop-key');
      form = options.body;
      return new Response(output, { status: 200, headers: { 'Content-Type': 'image/png' } });
    }
  });
  assert.deepEqual(result, output);
  assert.equal(form.get('image_file') instanceof Blob, true);
  assert.equal(form.get('extend_left'), '512');
  assert.equal(form.get('extend_right'), '513');
  assert.equal(form.get('extend_up'), '256');
  assert.equal(form.get('extend_down'), '257');
  assert.equal(form.get('seed'), '713');
  await assert.rejects(
    uncropImage({ imageDataUrl: imageDataUrl(rgbaPng()), toolOptions: { left: 2001 } }, { apiKey: 'uncrop-key' }),
    { code: 'invalid-image-tool-options', status: 400 }
  );
});

test('quality-first synchronous image tools use the documented 302 multipart endpoints', async () => {
  const output = rgbaPng();
  const source = imageDataUrl(rgbaPng());
  const mask = imageDataUrl(rgbaPng());
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), form: options.body });
    return new Response(output, { status: 200, headers: { 'Content-Type': 'image/png' } });
  };
  assert.deepEqual(await generativeUpscaleImage({ imageDataUrl: source }, { apiKey: 'quality-key', fetchImpl }), output);
  assert.deepEqual(await cleanupImageObjects({ imageDataUrl: source, maskImageDataUrl: mask }, { apiKey: 'quality-key', fetchImpl }), output);
  assert.deepEqual(calls.map((entry) => entry.url), [
    'https://api.302.ai/recraft/v1/images/generativeUpscale',
    'https://api.302.ai/clipdrop/cleanup/v1'
  ]);
  assert.equal(calls[0].form.get('file') instanceof Blob, true);
  assert.equal(calls[1].form.get('image_file') instanceof Blob, true);
  assert.equal(calls[1].form.get('mask_file') instanceof Blob, true);
});

test('result downloads follow only allowlisted redirects, omit the 302 key, and validate PNG bytes', async () => {
  const output = rgbaPng();
  const calls = [];
  const downloaded = await downloadAi302ImageResult('https://file.302.ai/result/start.png', {
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (calls.length === 1) {
        return new Response(null, {
          status: 302,
          headers: { Location: 'https://v3b.fal.media/files/final.png' }
        });
      }
      return new Response(output, { status: 200, headers: { 'Content-Type': 'image/png' } });
    }
  });
  assert.deepEqual(downloaded, output);
  assert.equal(validatePng(downloaded), true);
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(calls[1].options.headers.Authorization, undefined);
  assert.equal(calls[1].url, 'https://v3b.fal.media/files/final.png');

  await assert.rejects(
    () => downloadAi302ImageResult('https://file.302.ai/result/start.png', {
      fetchImpl: async () => new Response(null, {
        status: 302,
        headers: { Location: 'http://127.0.0.1/private.png' }
      })
    }),
    { code: 'unsafe-tool-result-url', status: 502 }
  );
});

test('gateway wires every image tool route through durable credits and opaque result downloads', () => {
  const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.match(
    server,
    /url\.pathname === '\/v1\/tools\/image\/edit'[\s\S]*?modelId !== 'seededit-v3'[\s\S]*?reserveFixedTool\(user\.id, modelId, requestId\)[\s\S]*?submitSeedEditImage[\s\S]*?accountingRequestId: usage\.requestId/
  );
  assert.match(
    server,
    /url\.pathname === '\/v1\/tools\/image\/expand'[\s\S]*?modelId !== 'kling-image-expand'[\s\S]*?reserveFixedTool\(user\.id, modelId, requestId\)[\s\S]*?uncropImage[\s\S]*?settleToolUsage\(user\.id, usage\.requestId, 'succeeded'/
  );
  assert.match(
    server,
    /url\.pathname === '\/v1\/tools\/image\/layer'[\s\S]*?runIdempotentImageOperation\(user\.id, requestId[\s\S]*?reserveFixedTool\(user\.id, modelId, requestId\)[\s\S]*?submitQwenImageLayered[\s\S]*?accountingRequestId: usage\.requestId/
  );
  assert.match(
    server,
    /url\.pathname === '\/v1\/tools\/image\/status'[\s\S]*?touchToolUsage[\s\S]*?settleToolUsage[\s\S]*?resultCount/
  );
  assert.match(
    server,
    /url\.pathname === '\/v1\/tools\/image\/download'[\s\S]*?result\.status !== 'succeeded'[\s\S]*?downloadAi302ImageResult/
  );
  assert.match(
    server,
    /url\.pathname === '\/v1\/tools\/image\/upscale'[\s\S]*?modelId !== 'generative-upscale'[\s\S]*?reserveFixedTool[\s\S]*?generativeUpscaleImage[\s\S]*?settleToolUsage\(user\.id, usage\.requestId, 'succeeded'/
  );
  assert.match(
    server,
    /url\.pathname === '\/v1\/tools\/image\/erase'[\s\S]*?modelId !== 'cleanup'[\s\S]*?reserveFixedTool[\s\S]*?cleanupImageObjects[\s\S]*?settleToolUsage\(user\.id, usage\.requestId, 'succeeded'/
  );
  assert.doesNotMatch(
    server,
    /url\.pathname === '\/v1\/tools\/image\/status'[\s\S]*?urls:\s*result\.urls/
  );
});
