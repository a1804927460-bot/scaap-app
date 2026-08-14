'use strict';

const assert = require('assert');
const { catalogProvider } = require('../lib/provider-catalog');
const {
  DEFAULT_IMAGE_ENDPOINT,
  DEFAULT_VIDEO_ENDPOINT,
  normalizeConfig,
  detectMediaProtocol,
  deriveKlingModel,
  resolveAi302KlingImageEndpoint,
  resolveQuickRouterKlingEndpoint,
  resolveQuickRouterUnifiedVideoEndpoint,
  resolveOpenAiImagesEndpoint,
  resolveOpenAiImageEditsEndpoint,
  resolveOpenAiChatMediaEndpoint,
  resolveOpenAiVideosEndpoint,
  buildGeminiImageBody,
  resolveGeminiMediaEndpoint,
  buildRequestBody,
  buildOpenAiImageBody,
  buildOpenAiImageEditForm,
  buildQuickRouterUnifiedVideoBody,
  buildOpenAiChatImageBody,
  buildOpenAiVideoBody,
  buildOpenAiVideoForm,
  buildHiggsfieldSoulStandardBody,
  buildHiggsfieldSoulBody,
  extractMediaUrls,
  generatedImageDimensions,
  validateGeneratedImageResolution,
  validateGeneratedMediaBuffer,
  generateMediaBuffer,
  pollMediaTask
} = require('../lib/ai-media-provider');

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload)
  };
}

function pngHeader(width, height) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

async function testImageFlow() {
  const calls = [];
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const responses = [
    jsonResponse({ code: 200, msg: '成功', data: { id: 'image_test' } }),
    jsonResponse({ code: 200, data: { status: 1 } }),
    jsonResponse({ code: 200, data: { status: 2, result: '{"url":"https://cdn.test/result.png"}' } }),
    { ok: true, status: 200, arrayBuffer: async () => png }
  ];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    return responses.shift();
  };
  const buffer = await generateMediaBuffer(fetchImpl, {
    apiKey: 'secret',
    pollIntervalMs: 800,
    timeoutMs: 10000
  }, 'image', {
    prompt: 'blue glass city',
    size: '4K',
    aspectRatio: '21:9',
    urls: ['https://cdn.test/reference.jpg']
  }, null, async () => {});

  assert.deepStrictEqual(buffer, png);
  assert.strictEqual(calls.length, 4);
  assert.ok(calls[0].url.startsWith(DEFAULT_IMAGE_ENDPOINT));
  assert.strictEqual(calls[0].options.headers.Authorization, 'secret');
  assert.deepStrictEqual(JSON.parse(calls[0].options.body), {
    prompt: 'blue glass city',
    size: '4K',
    aspectRatio: '21:9',
    urls: ['https://cdn.test/reference.jpg']
  });
  assert.ok(calls[1].url.includes('id=image_test'));
}

async function testQuickRouterDefaultImageFlow() {
  const calls = [];
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const responses = [
    jsonResponse({ data: [{ url: 'https://cdn.test/result.png' }] }),
    { ok: true, status: 200, arrayBuffer: async () => png }
  ];
  const buffer = await generateMediaBuffer(async (url, options = {}) => {
    calls.push({ url, options });
    return responses.shift();
  }, {
    apiKey: 'secret',
    imageEndpoint: 'https://api.quickrouter.ai/v1/images/generations',
    pollIntervalMs: 800,
    timeoutMs: 10000
  }, 'image', {
    prompt: 'blue glass city',
    size: '4K',
    aspectRatio: '21:9'
  }, null, async () => {});

  assert.deepStrictEqual(buffer, png);
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[0].url, 'https://api.quickrouter.ai/v1/images/generations');
  assert.strictEqual(calls[0].options.headers.Authorization, 'Bearer secret');
  assert.deepStrictEqual(JSON.parse(calls[0].options.body), {
    model: 'gpt-image-1',
    prompt: 'blue glass city',
    n: 1,
    size: '1536x1024'
  });
  assert.strictEqual(calls[1].url, 'https://cdn.test/result.png');
}

function testVideoBody() {
  const config = normalizeConfig({});
  const body = buildRequestBody('video', {
    prompt: 'slow camera orbit',
    duration: 15,
    aspectRatio: '9:16',
    urls: ['https://cdn.test/frame.jpg', 'file:///not-public.jpg']
  }, config);
  assert.deepStrictEqual(body, {
    model: 'sora-2',
    prompt: 'slow camera orbit',
    seconds: '12',
    size: '720x1280'
  });
  assert.strictEqual(config.videoEndpoint, DEFAULT_VIDEO_ENDPOINT);
}

async function testQuickRouterKlingFlow() {
  const calls = [];
  const mp4 = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);
  const responses = [
    jsonResponse({ task_id: 'kling_task', task_status: 'submitted' }),
    jsonResponse({
      task_id: 'kling_task',
      task_status: 'succeed',
      task_result: { videos: [{ url: 'https://cdn.test/result.mp4' }] }
    }),
    { ok: true, status: 200, arrayBuffer: async () => mp4 }
  ];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    return responses.shift();
  };
  const config = normalizeConfig({
    apiKey: 'secret',
    videoEndpoint: 'https://api.quickrouter.ai/kling/image-to-video/kling-3.0-turbo',
    pollIntervalMs: 800,
    timeoutMs: 10000
  });
  const buffer = await generateMediaBuffer(fetchImpl, config, 'video', {
    prompt: 'slow camera orbit',
    duration: 6,
    aspectRatio: '9:16',
    urls: ['https://cdn.test/frame.jpg']
  }, null, async () => {});

  assert.deepStrictEqual(buffer, mp4);
  assert.strictEqual(detectMediaProtocol(config.videoEndpoint), 'quickrouter-kling');
  assert.strictEqual(deriveKlingModel(config.videoEndpoint), 'kling-v3');
  assert.strictEqual(
    resolveQuickRouterKlingEndpoint(config.videoEndpoint, true),
    'https://api.quickrouter.ai/kling/v1/videos/image2video'
  );
  assert.strictEqual(calls[0].url, 'https://api.quickrouter.ai/kling/v1/videos/image2video');
  assert.strictEqual(calls[0].options.headers.Authorization, 'Bearer secret');
  assert.deepStrictEqual(JSON.parse(calls[0].options.body), {
    model_name: 'kling-v3',
    prompt: 'slow camera orbit',
    mode: 'std',
    duration: '5',
    image: 'https://cdn.test/frame.jpg'
  });
  assert.strictEqual(
    calls[1].url,
    'https://api.quickrouter.ai/kling/v1/videos/image2video/kling_task'
  );
  assert.strictEqual(calls[1].options.headers.Authorization, 'Bearer secret');
}

function testQuickRouterTextBody() {
  const config = normalizeConfig({
    videoEndpoint: 'https://api.quickrouter.ai/kling/text-to-video/kling-3.0-turbo'
  });
  assert.deepStrictEqual(buildRequestBody('video', {
    prompt: 'A slow camera orbit',
    duration: 10,
    aspectRatio: '16:9',
    urls: []
  }, config, config.videoEndpoint), {
    model_name: 'kling-v3',
    prompt: 'A slow camera orbit',
    mode: 'high',
    duration: '10',
    multi_shot: 'false',
    aspect_ratio: '16:9'
  });
}

async function testQuickRouterFailureMessage() {
  await assert.rejects(
    () => pollMediaTask(
      async () => jsonResponse({
        task_id: 'failed_task',
        task_status: 'failed',
        task_status_msg: 'content safety review failed'
      }),
      normalizeConfig({
        apiKey: 'secret',
        videoEndpoint: 'https://api.quickrouter.ai/kling/image-to-video/kling-3.0-turbo',
        pollIntervalMs: 800,
        timeoutMs: 10000
      }),
      'failed_task',
      null,
      async () => {},
      {
        kind: 'video',
        request: { urls: ['https://cdn.test/frame.jpg'] },
        endpoint: 'https://api.quickrouter.ai/kling/image-to-video/kling-3.0-turbo'
      }
    ),
    (error) => error && error.code === 'generation-failed' && /content safety/.test(error.message)
  );
}

async function testOpenAiImageFlow() {
  const calls = [];
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (options.method === 'POST') {
      return jsonResponse({
        data: [{ b64_json: 'iVBORw==' }]
      });
    }
    return { ok: true, status: 200, arrayBuffer: async () => png };
  };
  const config = normalizeConfig({
    apiKey: 'secret',
    imageEndpoint: 'https://relay.example.com/v1/images/generations'
  });
  const buffer = await generateMediaBuffer(fetchImpl, config, 'image', {
    prompt: 'blue glass city',
    size: '4K',
    aspectRatio: '16:9',
    count: 1
  });

  assert.deepStrictEqual(buffer, png);
  assert.strictEqual(
    resolveOpenAiImagesEndpoint('https://relay.example.com/v1'),
    'https://relay.example.com/v1/images/generations'
  );
  assert.strictEqual(
    resolveOpenAiImagesEndpoint('https://relay.example.com/v1/images/edits'),
    'https://relay.example.com/v1/images/generations'
  );
  assert.strictEqual(
    resolveOpenAiVideosEndpoint('https://relay.example.com/v1'),
    'https://relay.example.com/v1/videos'
  );
  assert.strictEqual(detectMediaProtocol('https://relay.example.com/v1'), 'openai-compatible');
  assert.strictEqual(detectMediaProtocol('https://api.quickrouter.ai/v1beta'), 'gemini-native');
  assert.strictEqual(detectMediaProtocol('https://another-relay.example/v1beta'), 'gemini-native');
  assert.strictEqual(
    detectMediaProtocol('https://another-relay.example/v1/video/create'),
    'quickrouter-unified-video'
  );
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].options.headers.Authorization, 'Bearer secret');
  assert.deepStrictEqual(JSON.parse(calls[0].options.body), {
    model: 'gpt-image-1',
    prompt: 'blue glass city',
    n: 1,
    size: '1536x1024'
  });
}

async function testGptImage2FlowAndReferenceLimits() {
  const provider = catalogProvider('image-6');
  assert.ok(provider);
  assert.strictEqual(provider.name, 'GPT Image 2');
  assert.strictEqual(provider.model, 'gpt-image-2');
  assert.strictEqual(provider.endpoint, 'https://api.302.ai/v1/images/generations');
  assert.deepStrictEqual(provider.capabilities.qualities, ['low', 'medium', 'high', 'auto']);

  const config = normalizeConfig({
    apiKey: 'server-only-secret',
    imageEndpoint: provider.endpoint,
    imageModel: provider.model
  });
  assert.deepStrictEqual(buildOpenAiImageBody({
    prompt: 'clean product photograph',
    size: '1536x1024',
    quality: 'high'
  }, config), {
    model: 'gpt-image-2',
    prompt: 'clean product photograph',
    n: 1,
    size: '1536x1024',
    quality: 'high'
  });
  assert.strictEqual(
    resolveOpenAiImageEditsEndpoint(provider.endpoint),
    'https://api.302.ai/v1/images/edits'
  );

  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    return jsonResponse({ data: [{ b64_json: 'iVBORw==' }] });
  };
  const generated = await generateMediaBuffer(fetchImpl, config, 'image', {
    prompt: 'clean product photograph',
    size: '1024x1024',
    quality: 'low',
    aspectRatio: '1:1',
    urls: []
  });
  const edited = await generateMediaBuffer(fetchImpl, config, 'image', {
    prompt: 'turn the package blue',
    size: '1024x1536',
    quality: 'medium',
    aspectRatio: '2:3',
    urls: ['data:image/png;base64,iVBORw==']
  });
  assert.deepStrictEqual(generated, Buffer.from('iVBORw==', 'base64'));
  assert.deepStrictEqual(edited, Buffer.from('iVBORw==', 'base64'));
  assert.strictEqual(calls[0].url, 'https://api.302.ai/v1/images/generations');
  assert.strictEqual(calls[0].options.headers.Authorization, 'Bearer server-only-secret');
  assert.deepStrictEqual(JSON.parse(calls[0].options.body), {
    model: 'gpt-image-2',
    prompt: 'clean product photograph',
    n: 1,
    size: '1024x1024',
    quality: 'low'
  });
  assert.strictEqual(calls[1].url, 'https://api.302.ai/v1/images/edits');
  assert.strictEqual(calls[1].options.headers.Authorization, 'Bearer server-only-secret');
  assert.strictEqual(calls[1].options.headers['Content-Type'], undefined);
  assert.ok(calls[1].options.body instanceof FormData);
  assert.strictEqual(calls[1].options.body.get('model'), 'gpt-image-2');
  assert.strictEqual(calls[1].options.body.get('size'), '1024x1536');
  assert.strictEqual(calls[1].options.body.get('quality'), 'medium');
  assert.strictEqual(calls[1].options.body.getAll('image').length, 1);
  assert.strictEqual(calls[1].options.body.get('image').type, 'image/png');

  assert.throws(
    () => buildOpenAiImageEditForm({
      prompt: 'unsupported reference',
      urls: ['data:image/gif;base64,R0lGODlh']
    }, config),
    (error) => error && error.code === 'invalid-reference-image' && error.status === 400
  );
  assert.throws(
    () => buildOpenAiImageEditForm({
      prompt: 'remote reference',
      urls: ['https://cdn.test/reference.png']
    }, config),
    (error) => error && error.code === 'invalid-reference-image' && error.status === 400
  );
  const exactLimit = Buffer.alloc(25 * 1024 * 1024).toString('base64');
  assert.throws(
    () => buildOpenAiImageEditForm({
      prompt: 'oversized reference',
      urls: [`data:image/png;base64,${exactLimit}`]
    }, config),
    (error) => error && error.code === 'reference-image-too-large' && error.status === 413
  );
}

function testGeminiImageBody() {
  const body = buildGeminiImageBody({
    prompt: 'restyle this image',
    urls: ['data:image/png;base64,iVBORw0KGgo='],
    size: '4K',
    aspectRatio: '16:9'
  });
  assert.deepStrictEqual(body.contents[0].parts[0], { text: 'restyle this image' });
  assert.strictEqual(body.contents[0].parts[1].inlineData.mimeType, 'image/png');
  assert.deepStrictEqual(body.generationConfig.responseModalities, ['TEXT', 'IMAGE']);
  assert.deepStrictEqual(body.generationConfig.imageConfig, {
    aspectRatio: '16:9',
    imageSize: '4K'
  });
  assert.strictEqual(
    resolveGeminiMediaEndpoint('https://generativelanguage.googleapis.com/v1beta'),
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent'
  );
  assert.strictEqual(
    resolveGeminiMediaEndpoint(
      'https://api.quickrouter.ai/v1beta/models/gemini-3-pro-image:generateContent'
    ),
    'https://api.quickrouter.ai/v1beta/models/gemini-3-pro-image:generateContent'
  );
}

async function testQuickRouterNativeGeminiImageFlow() {
  const calls = [];
  const pngBuffer = pngHeader(4096, 2304);
  const pngBase64 = pngBuffer.toString('base64');
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    return jsonResponse({
      candidates: [{
        content: {
          role: 'model',
          parts: [
            { text: 'Generated image' },
            { inlineData: { mimeType: 'image/png', data: pngBase64 } }
          ]
        },
        finishReason: 'STOP'
      }],
      modelVersion: 'gemini-3-pro-image-preview'
    });
  };
  const config = normalizeConfig({
    apiKey: 'secret',
    imageEndpoint: 'https://api.quickrouter.ai/v1beta/models/gemini-3-pro-image:generateContent'
  });
  const buffer = await generateMediaBuffer(fetchImpl, config, 'image', {
    prompt: 'blue glass city',
    size: '4K',
    aspectRatio: '16:9'
  });

  assert.deepStrictEqual(buffer, pngBuffer);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(
    calls[0].url,
    'https://api.quickrouter.ai/v1beta/models/gemini-3-pro-image:generateContent'
  );
  assert.deepStrictEqual(JSON.parse(calls[0].options.body).generationConfig.imageConfig, {
    aspectRatio: '16:9',
    imageSize: '4K'
  });
}

async function test302NanoBananaFlows() {
  const cases = [
    {
      id: 'image-2', name: 'Nano Banana 2', suffix: 'nano-banana-2/edit', size: '2K',
      urls: ['https://gateway.test/reference.png'],
      expectedBody: {
        aspect_ratio: '16:9', resolution: '2k', enable_base64_output: false,
        enable_sync_mode: false, images: ['https://gateway.test/reference.png'], prompt: 'cinematic scene'
      }
    },
    {
      id: 'image-5', name: 'Nano Banana 2 Lite', suffix: 'nano-banana-2-lite/text-to-image', size: 'Default',
      expectedBody: {
        size: '16:9', enable_base64_output: false, enable_sync_mode: false, prompt: 'cinematic scene'
      }
    }
  ];
  for (const entry of cases) {
    const provider = catalogProvider(entry.id);
    assert.ok(provider);
    assert.strictEqual(provider.name, entry.name);
    assert.strictEqual(provider.protocol, 'ai302-nano-banana-v3');
    assert.strictEqual(provider.keyEnv, 'AI302_KEY');
    assert.strictEqual(detectMediaProtocol(provider.endpoint), 'ai302-nano-banana-v3');
    const calls = [];
    const png = entry.size === '4K'
      ? pngHeader(4096, 2304)
      : (entry.size === '2K' ? pngHeader(2048, 2048) : pngHeader(1024, 576));
    const responses = [
      jsonResponse({
        code: 200,
        data: {
          id: `${entry.id}-task`,
          outputs: [],
          urls: { get: `https://api.302.ai/ws/api/v3/predictions/${entry.id}-task/result` },
          status: 'created'
        }
      }),
      jsonResponse({
        code: 200,
        data: {
          id: `${entry.id}-task`,
          outputs: [],
          urls: { get: `https://api.302.ai/ws/api/v3/predictions/${entry.id}-task/result` },
          status: 'processing'
        }
      }),
      jsonResponse({ code: 200, data: { id: `${entry.id}-task`, outputs: [`https://cdn.test/${entry.id}.png`], status: 'completed' } }),
      { ok: true, status: 200, arrayBuffer: async () => png }
    ];
    const buffer = await generateMediaBuffer(async (url, options = {}) => {
      calls.push({ url: String(url), options });
      return responses.shift();
    }, normalizeConfig({ apiKey: 'server-only-302-key', imageEndpoint: provider.endpoint, pollIntervalMs: 800 }), 'image', {
      prompt: 'cinematic scene', size: entry.size, aspectRatio: '16:9', urls: entry.urls || []
    }, null, async () => {});
    assert.deepStrictEqual(buffer, png);
    assert.strictEqual(calls[0].url, `https://api.302.ai/ws/api/v3/google/${entry.suffix}`);
    assert.strictEqual(calls[0].options.headers.Authorization, 'Bearer server-only-302-key');
    assert.deepStrictEqual(JSON.parse(calls[0].options.body), entry.expectedBody);
    assert.strictEqual(calls[1].url, `https://api.302.ai/ws/api/v3/predictions/${entry.id}-task/result`);
    assert.strictEqual(calls[1].options.headers.Authorization, 'Bearer server-only-302-key');
    assert.strictEqual(calls[3].url, `https://cdn.test/${entry.id}.png`);
    assert.strictEqual(calls[3].options.headers, undefined);
  }

  const nano = catalogProvider('image-9');
  assert.strictEqual(nano.name, 'Nano Banana');
  assert.strictEqual(detectMediaProtocol(nano.endpoint), 'ai302-nano-banana-legacy');
  const calls = [];
  const responses = [
    jsonResponse({ request_id: 'nano-task', status: 'IN_QUEUE' }),
    jsonResponse({ id: 'nano-task', status: 'IN_PROGRESS', output: '' }),
    jsonResponse({ id: 'nano-task', status: 'COMPLETED', output: 'https://cdn.test/nano.png' }),
    { ok: true, status: 200, arrayBuffer: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]) }
  ];
  await generateMediaBuffer(async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return responses.shift();
  }, normalizeConfig({ apiKey: 'server-only-302-key', imageEndpoint: nano.endpoint, pollIntervalMs: 800 }), 'image', {
    prompt: 'restyle', size: 'Default', aspectRatio: '3:4', urls: ['https://gateway.test/reference.png']
  }, null, async () => {});
  assert.strictEqual(calls[0].url, 'https://api.302.ai/302/submit/gemini-2.5-flash-image-edit-async');
  assert.deepStrictEqual(JSON.parse(calls[0].options.body), {
    prompt: 'restyle', image_urls: ['https://gateway.test/reference.png']
  });
  assert.strictEqual(calls[1].url, 'https://api.302.ai/302/submit/gemini-2.5-flash-image-async?request_id=nano-task');

  assert.deepStrictEqual(generatedImageDimensions(pngHeader(4096, 2304)), { width: 4096, height: 2304 });
  assert.throws(
    () => validateGeneratedImageResolution(pngHeader(1024, 1024), '4K'),
    (error) => error && error.code === 'image-resolution-mismatch' && error.actualWidth === 1024
  );
  assert.doesNotThrow(() => validateGeneratedImageResolution(pngHeader(4096, 2304), '4K'));
  assert.throws(
    () => buildRequestBody('image', {
      prompt: 'unsupported resolution', size: '0.5K', aspectRatio: '1:1', urls: []
    }, normalizeConfig({ apiKey: 'server-only-302-key', imageEndpoint: catalogProvider('image-2').endpoint }), catalogProvider('image-2').endpoint),
    (error) => error && error.code === 'invalid-size'
  );
}

async function testHiggsfieldFlows() {
  const styleId = '8f09a1aa-5b34-4bd4-9a9f-6c26fc84f888';
  assert.deepStrictEqual(buildHiggsfieldSoulStandardBody({
    prompt: 'editorial portrait', size: '1080p', aspectRatio: '16:9',
    seed: 42, styleId, styleStrength: 0.65, enhancePrompt: false
  }), {
    prompt: 'editorial portrait',
    aspect_ratio: '16:9',
    resolution: '1080p',
    batch_size: 1,
    enhance_prompt: false,
    style_strength: 0.65,
    seed: 42,
    style_id: styleId
  });
  assert.deepStrictEqual(buildHiggsfieldSoulBody({
    prompt: 'studio product', size: '720p', aspectRatio: '2:3',
    seed: 7, styleId, styleStrength: 0.4
  }), {
    params: {
      quality: '720p',
      prompt: 'studio product',
      enhance_prompt: true,
      width_and_height: '1120x1680',
      batch_size: 1,
      style_strength: 0.4,
      seed: 7,
      style_id: styleId
    }
  });

  for (const endpoint of [
    'https://api.302.ai/higgsfield/soul/standard',
    'https://api.302.ai/higgsfield/v1/text2image/soul'
  ]) {
    const calls = [];
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const responses = [
      jsonResponse({ job_set_id: 'hf-job-set-1' }),
      jsonResponse({ jobs: [{ status: 'processing' }] }),
      jsonResponse({ jobs: [{ status: 'completed', results: { raw: { url: 'https://cdn.test/higgsfield.png' } } }] }),
      { ok: true, status: 200, arrayBuffer: async () => png }
    ];
    const buffer = await generateMediaBuffer(async (url, options = {}) => {
      calls.push({ url: String(url), options });
      return responses.shift();
    }, normalizeConfig({ apiKey: 'server-only-302-key', imageEndpoint: endpoint, pollIntervalMs: 1, timeoutMs: 1000 }), 'image', {
      prompt: 'studio product', size: '1080p', aspectRatio: '16:9', styleId
    }, null, async () => {});
    assert.deepStrictEqual(buffer, png);
    assert.strictEqual(calls[0].options.headers.Authorization, 'Bearer server-only-302-key');
    assert.strictEqual(calls[1].url, 'https://api.302.ai/higgsfield/v1/job-sets/hf-job-set-1');
    assert.strictEqual(calls[3].url, 'https://cdn.test/higgsfield.png');
  }

  await assert.rejects(
    () => pollMediaTask(async () => jsonResponse({
      jobs: [{ status: 'completed', results: { raw: {} } }]
    }), normalizeConfig({ apiKey: 'secret', imageEndpoint: 'https://api.302.ai/higgsfield/soul/standard', pollIntervalMs: 1, timeoutMs: 100 }), 'hf-empty', null, async () => {}, {
      kind: 'image', protocol: 'higgsfield-soul-standard', pollUrl: 'https://api.302.ai/higgsfield/v1/job-sets/hf-empty'
    }),
    (error) => error && error.code === 'empty-media'
  );
  await assert.rejects(
    () => pollMediaTask(async () => jsonResponse({ jobs: [{ status: 'failed', error: 'provider rejected request' }] }),
      normalizeConfig({ apiKey: 'secret', imageEndpoint: 'https://api.302.ai/higgsfield/soul/standard', pollIntervalMs: 1, timeoutMs: 100 }),
      'hf-failed', null, async () => {}, {
        kind: 'image', protocol: 'higgsfield-soul-standard', pollUrl: 'https://api.302.ai/higgsfield/v1/job-sets/hf-failed'
      }),
    (error) => error && error.code === 'generation-failed'
  );
}

function testOpenAiVideoRequest() {
  const config = normalizeConfig({
    videoEndpoint: 'https://api.quickrouter.ai/v1/videos?model=sora-2-pro'
  });
  assert.deepStrictEqual(buildOpenAiVideoBody({
    prompt: 'slow orbit',
    duration: 6,
    aspectRatio: '16:9'
  }, config), {
    model: 'sora-2-pro',
    prompt: 'slow orbit',
    seconds: '8',
    size: '1792x1024'
  });
  const form = buildOpenAiVideoForm({
    prompt: 'animate this frame',
    duration: 6,
    aspectRatio: '9:16',
    urls: ['data:image/png;base64,iVBORw0KGgo=']
  }, config);
  assert.ok(form instanceof FormData);
  assert.strictEqual(form.get('model'), 'sora-2-pro');
  assert.strictEqual(form.get('seconds'), '8');
  assert.strictEqual(form.get('size'), '1024x1792');
  assert.ok(form.get('input_reference') instanceof Blob);
}

function testChatCompatibleImageRequest() {
  const config = normalizeConfig({
    imageEndpoint: 'https://api.quickrouter.ai/v1/chat/completions?model=gemini-2.5-flash-image'
  });
  assert.strictEqual(
    detectMediaProtocol(config.imageEndpoint),
    'openai-chat-media'
  );
  assert.strictEqual(
    resolveOpenAiChatMediaEndpoint(config.imageEndpoint),
    'https://api.quickrouter.ai/v1/chat/completions'
  );
  assert.deepStrictEqual(buildOpenAiChatImageBody({
    prompt: 'restyle this',
    urls: ['data:image/png;base64,iVBORw0KGgo=']
  }, config), {
    model: 'gemini-2.5-flash-image',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'restyle this' },
        {
          type: 'image_url',
          image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' }
        }
      ]
    }],
    stream: false
  });
}

async function testQuickRouterUnifiedVideoFlow() {
  const calls = [];
  const mp4 = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);
  const responses = [
    jsonResponse({ id: 'veo3.1-fast:task-1', status: 'pending' }),
    jsonResponse({
      id: 'veo3.1-fast:task-1',
      detail: {
        images: [{ url: 'https://cdn.test/reference.png' }],
        status: 'completed',
        video_url: 'https://cdn.test/generated.mp4'
      },
      status: 'completed'
    }),
    { ok: true, status: 200, arrayBuffer: async () => mp4 }
  ];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    return responses.shift();
  };
  const config = normalizeConfig({
    apiKey: 'secret',
    videoEndpoint: 'https://api.quickrouter.ai/v1/video/create?model=veo3.1-fast',
    pollIntervalMs: 800,
    timeoutMs: 10000
  });
  assert.strictEqual(detectMediaProtocol(config.videoEndpoint), 'quickrouter-unified-video');
  assert.strictEqual(
    resolveQuickRouterUnifiedVideoEndpoint(config.videoEndpoint, 'query', 'veo3.1-fast:task-1'),
    'https://api.quickrouter.ai/v1/video/query?id=veo3.1-fast%3Atask-1'
  );
  assert.deepStrictEqual(buildQuickRouterUnifiedVideoBody({
    prompt: 'animate this',
    aspectRatio: '9:16',
    urls: ['https://cdn.test/reference.png']
  }, config), {
    model: 'veo3.1-fast',
    prompt: 'animate this',
    images: ['https://cdn.test/reference.png'],
    aspect_ratio: '9:16',
    enhance_prompt: true,
    enable_upsample: true
  });

  const buffer = await generateMediaBuffer(fetchImpl, config, 'video', {
    prompt: 'animate this',
    aspectRatio: '9:16',
    urls: ['https://cdn.test/reference.png']
  }, null, async () => {});
  assert.deepStrictEqual(buffer, mp4);
  assert.strictEqual(calls[0].url, 'https://api.quickrouter.ai/v1/video/create');
  assert.strictEqual(
    calls[1].url,
    'https://api.quickrouter.ai/v1/video/query?id=veo3.1-fast%3Atask-1'
  );
  assert.strictEqual(calls[2].url, 'https://cdn.test/generated.mp4');
}

function testDefaultImageBody() {
  const config = normalizeConfig({});
  const dataUrl = 'data:image/webp;base64,UklGRg==';
  const body = buildRequestBody('image', {
    prompt: 'restyle this image',
    size: '2K',
    aspectRatio: '1:1',
    urls: [dataUrl, 'file:///not-allowed.webp']
  }, config);
  assert.deepStrictEqual(body, {
    aspect_ratio: '1:1',
    resolution: '2k',
    enable_base64_output: false,
    enable_sync_mode: false,
    images: [dataUrl],
    prompt: 'restyle this image'
  });
}

function testSeedreamSizeAndRatioMapping() {
  const config = normalizeConfig({
    imageEndpoint: 'https://api.quickrouter.ai/v1/images/generations',
    imageModel: 'doubao-seedream-5-0-260128'
  });
  assert.deepStrictEqual(buildOpenAiImageBody({
    prompt: 'wide editorial scene',
    size: '2K',
    aspectRatio: '16:9',
    urls: []
  }, config), {
    model: 'doubao-seedream-5-0-260128',
    prompt: 'wide editorial scene',
    size: '2K',
    sequential_image_generation: 'disabled',
    response_format: 'url',
    watermark: false
  });
  const editBody = buildOpenAiImageBody({
    prompt: 'restyle the portrait',
    size: '4K',
    aspectRatio: '9:16',
    urls: ['https://cdn.test/reference.png']
  }, config);
  assert.strictEqual(editBody.size, '4K');
  assert.strictEqual(editBody.image, 'https://cdn.test/reference.png');
  assert.strictEqual(
    buildOpenAiImageEditForm({ urls: ['data:image/png;base64,iVBORw=='] }, config),
    null
  );
}

function test302ImageModelBodies() {
  const reference = 'data:image/png;base64,iVBORw==';
  const seedEdit = catalogProvider('image-14');
  assert.deepStrictEqual(buildRequestBody('image', {
    prompt: 'replace the background',
    size: 'adaptive',
    aspectRatio: 'auto',
    urls: [reference]
  }, normalizeConfig({ imageEndpoint: seedEdit.endpoint, imageModel: seedEdit.model }), seedEdit.endpoint), {
    model: 'doubao-seededit-3-0-i2i-250628',
    prompt: 'replace the background',
    image: reference,
    size: 'adaptive',
    response_format: 'url',
    watermark: false
  });

  const kling = catalogProvider('image-15');
  assert.deepStrictEqual(buildRequestBody('image', {
    prompt: 'studio product photo',
    size: '2K',
    aspectRatio: '3:2',
    urls: ['https://cdn.test/product.png']
  }, normalizeConfig({ imageEndpoint: kling.endpoint, imageModel: kling.model }), kling.endpoint), {
    model_name: 'kling-v2',
    prompt: 'studio product photo',
    image: 'https://cdn.test/product.png',
    n: 1,
    aspect_ratio: '3:2',
    resolution: '2k'
  });

  const multiEndpoint = resolveAi302KlingImageEndpoint(kling.endpoint, 2);
  assert.strictEqual(
    multiEndpoint,
    'https://api.302.ai/klingai/v1/images/multi-image2image'
  );
  assert.strictEqual(detectMediaProtocol(multiEndpoint), 'ai302-kling-image');
  assert.deepStrictEqual(buildRequestBody('image', {
    prompt: 'combine the two products',
    size: '1K',
    aspectRatio: '21:9',
    urls: ['https://cdn.test/product-a.png', 'https://cdn.test/product-b.png']
  }, normalizeConfig({ imageEndpoint: kling.endpoint, imageModel: kling.model }), multiEndpoint), {
    model_name: 'kling-v2',
    promot: 'combine the two products',
    subject_image_list: [
      { subject_image: 'https://cdn.test/product-a.png' },
      { subject_image: 'https://cdn.test/product-b.png' }
    ],
    n: 1,
    aspect_ratio: '21:9'
  });

  const jimeng = catalogProvider('image-16');
  const jimengBody = buildRequestBody('image', {
    prompt: 'paper cut illustration',
    size: '512x512',
    aspectRatio: '1:1',
    seed: 42,
    urls: []
  }, normalizeConfig({ imageEndpoint: jimeng.endpoint, imageModel: jimeng.model }), jimeng.endpoint);
  assert.equal(jimengBody.model_version, 'general_v3.0');
  assert.equal(jimengBody.width, 512);
  assert.equal(jimengBody.height, 512);
  assert.equal(jimengBody.seed, 42);
  assert.equal(jimengBody.use_sr, false);
}

async function test302KlingMultiImageFlow() {
  const provider = catalogProvider('image-15');
  const calls = [];
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb]);
  const responses = [
    jsonResponse({ code: 0, message: 'SUCCEED', data: { task_id: 'kling-multi-task', task_status: 'submitted' } }),
    jsonResponse({
      code: 0,
      data: {
        task_id: 'kling-multi-task',
        task_status: 'succeed',
        task_result: { images: [{ url: 'https://cdn.test/kling-multi.jpg' }] }
      }
    }),
    { ok: true, status: 200, arrayBuffer: async () => jpeg }
  ];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    return responses.shift();
  };
  const buffer = await generateMediaBuffer(fetchImpl, {
    apiKey: '302-secret',
    imageEndpoint: provider.endpoint,
    imageModel: provider.model,
    pollIntervalMs: 800,
    timeoutMs: 10000
  }, 'image', {
    prompt: 'combine two products',
    size: '1K',
    aspectRatio: '21:9',
    urls: ['https://cdn.test/a.png', 'https://cdn.test/b.png']
  }, null, async () => {});

  assert.deepStrictEqual(buffer, jpeg);
  assert.strictEqual(calls[0].url, 'https://api.302.ai/klingai/v1/images/multi-image2image');
  assert.deepStrictEqual(JSON.parse(calls[0].options.body), {
    model_name: 'kling-v2',
    promot: 'combine two products',
    subject_image_list: [
      { subject_image: 'https://cdn.test/a.png' },
      { subject_image: 'https://cdn.test/b.png' }
    ],
    n: 1,
    aspect_ratio: '21:9'
  });
  assert.strictEqual(
    calls[1].url,
    'https://api.302.ai/klingai/v1/images/multi-image2image/kling-multi-task'
  );
  assert.strictEqual(calls[2].url, 'https://cdn.test/kling-multi.jpg');
}

async function testMidjourneyFlow() {
  const provider = catalogProvider('image-4');
  const calls = [];
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb]);
  const responses = [
    jsonResponse({ code: 1, description: 'success', result: 'mj-task-1' }),
    jsonResponse({ id: 'mj-task-1', status: 'SUCCESS', imageUrl: 'https://cdn.test/midjourney.jpg' }),
    { ok: true, status: 200, arrayBuffer: async () => jpeg }
  ];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    return responses.shift();
  };
  const config = normalizeConfig({
    apiKey: 'secret',
    imageEndpoint: provider.endpoint,
    pollIntervalMs: 800,
    timeoutMs: 10000
  });
  const buffer = await generateMediaBuffer(fetchImpl, config, 'image', {
    prompt: 'editorial portrait',
    aspectRatio: '3:2',
    urls: ['data:image/png;base64,iVBORw0KGgo=']
  }, null, async () => {});

  assert.deepStrictEqual(buffer, jpeg);
  assert.strictEqual(detectMediaProtocol(config.imageEndpoint), 'midjourney-imagine');
  assert.strictEqual(calls[0].url, 'https://api.302.ai/mj-turbo/submit/imagine');
  assert.deepStrictEqual(JSON.parse(calls[0].options.body), {
    botType: 'MID_JOURNEY',
    prompt: 'editorial portrait --ar 3:2',
    base64Array: ['iVBORw0KGgo='],
    notifyHook: '',
    state: ''
  });
  assert.strictEqual(calls[0].options.headers['mj-api-secret'], 'secret');
  assert.strictEqual(calls[0].options.headers.Authorization, undefined);
  assert.strictEqual(calls[1].url, 'https://api.302.ai/mj-turbo/task/mj-task-1/fetch');
  assert.strictEqual(calls[1].options.headers['mj-api-secret'], 'secret');
  assert.strictEqual(calls[1].options.headers.Authorization, undefined);
  assert.strictEqual(calls[2].url, 'https://cdn.test/midjourney.jpg');
}

function testNestedResultExtraction() {
  const urls = extractMediaUrls({
    data: {
      status: 2,
      message: JSON.stringify({
        outputs: [{ video: 'https://cdn.test/movie.mp4' }]
      })
    }
  });
  assert.deepStrictEqual(urls, ['https://cdn.test/movie.mp4']);
}

function testCorruptMediaIsRejected() {
  assert.throws(
    () => validateGeneratedMediaBuffer('video', Buffer.from('{"error":"not a video"}')),
    (err) => err && err.code === 'invalid-media'
  );
}

async function main() {
  await testQuickRouterDefaultImageFlow();
  testVideoBody();
  await testQuickRouterKlingFlow();
  testQuickRouterTextBody();
  await testQuickRouterFailureMessage();
  await testOpenAiImageFlow();
  await testGptImage2FlowAndReferenceLimits();
  testSeedreamSizeAndRatioMapping();
  test302ImageModelBodies();
  await test302KlingMultiImageFlow();
  testGeminiImageBody();
  await testQuickRouterNativeGeminiImageFlow();
  await test302NanoBananaFlows();
  await testHiggsfieldFlows();
  await testMidjourneyFlow();
  testOpenAiVideoRequest();
  testChatCompatibleImageRequest();
  await testQuickRouterUnifiedVideoFlow();
  testDefaultImageBody();
  testNestedResultExtraction();
  testCorruptMediaIsRejected();
  process.stdout.write('AI media provider tests passed.\n');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
