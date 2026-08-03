'use strict';

const assert = require('assert');
const {
  DEFAULT_IMAGE_ENDPOINT,
  DEFAULT_VIDEO_ENDPOINT,
  normalizeConfig,
  detectMediaProtocol,
  deriveKlingModel,
  resolveQuickRouterKlingEndpoint,
  resolveQuickRouterUnifiedVideoEndpoint,
  resolveOpenAiImagesEndpoint,
  resolveOpenAiChatMediaEndpoint,
  resolveOpenAiVideosEndpoint,
  buildGeminiImageBody,
  resolveGeminiMediaEndpoint,
  buildRequestBody,
  buildQuickRouterUnifiedVideoBody,
  buildOpenAiChatImageBody,
  buildOpenAiVideoBody,
  buildOpenAiVideoForm,
  extractMediaUrls,
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
    'https://api.quickrouter.ai/v1beta/models/gemini-3-pro-image-preview:generateContent'
  );
}

async function testQuickRouterNativeGeminiImageFlow() {
  const calls = [];
  const pngBase64 = 'iVBORw==';
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

  assert.deepStrictEqual(buffer, Buffer.from(pngBase64, 'base64'));
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(
    calls[0].url,
    'https://api.quickrouter.ai/v1beta/models/gemini-3-pro-image-preview:generateContent'
  );
  assert.deepStrictEqual(JSON.parse(calls[0].options.body).generationConfig.imageConfig, {
    aspectRatio: '16:9',
    clarity: '4K'
  });
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
    model: 'gpt-image-1',
    prompt: 'restyle this image',
    n: 1,
    size: '1024x1024'
  });
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
  testGeminiImageBody();
  await testQuickRouterNativeGeminiImageFlow();
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
