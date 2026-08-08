import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PROVIDER_CATALOG_VERSION } = require('../lib/provider-catalog');

process.env.Quick_API_KEY = 'quickrouter-secret';
process.env.MINIMAX_API_KEY = 'minimax-secret';
process.env.RELAY_2_API_KEY = 'relay-two-secret';
process.env.AI_PROVIDERS_JSON = JSON.stringify([
  {
    id: 'relay-2-image',
    kind: 'image',
    name: 'Relay 2 Image',
    endpoint: 'https://relay.example.com/v1/images/generations?model=gpt-image-1',
    keyEnv: 'RELAY_2_API_KEY'
  },
  {
    id: 'relay-2-chat',
    kind: 'chat',
    name: 'Relay 2 Chat',
    endpoint: 'https://relay.example.com/v1',
    models: ['model-a', 'model-b'],
    keyEnv: 'RELAY_2_API_KEY'
  }
]);

const {
  chat,
  createVideoTask,
  generateMedia,
  pollVideoTask,
  publicProviderConfig
} = await import('../gateway/src/providers.js');
const config = publicProviderConfig();
const ids = config.providers.map((provider) => provider.id);

assert.equal(config.catalogVersion, PROVIDER_CATALOG_VERSION);

assert.ok(ids.includes('image-1'));
assert.ok(ids.includes('video-1'));
assert.ok(ids.includes('video-1'));
assert.ok(ids.includes('chat-1'));
assert.ok(ids.includes('chat-2'));
assert.ok(ids.includes('relay-2-image'));
assert.ok(ids.includes('relay-2-chat'));
assert.deepEqual(
  config.providers.find((provider) => provider.id === 'relay-2-chat').models,
  ['model-a', 'model-b']
);
assert.equal(config.providers.find((provider) => provider.id === 'image-1').name, 'Nano Banana Pro');
assert.equal(config.providers.find((provider) => provider.id === 'image-2').name, 'Nanobanana Pro SE');
assert.equal(config.providers.find((provider) => provider.id === 'image-3').name, 'Seedream 5.0 Lite');
assert.equal(config.providers.find((provider) => provider.id === 'image-3').model, 'doubao-seedream-5-0-260128');
assert.equal(config.providers.find((provider) => provider.id === 'image-4').name, 'Midjourney');
assert.equal(config.providers.find((provider) => provider.id === 'image-5').name, 'Nano banana2');
assert.equal(config.providers.find((provider) => provider.id === 'image-5').protocol, 'gemini-image');
const gptImage2Provider = config.providers.find((provider) => provider.id === 'image-6');
assert.equal(gptImage2Provider.name, 'GPT Image 2');
assert.equal(gptImage2Provider.model, 'gpt-image-2');
assert.equal(gptImage2Provider.protocol, 'openai-image');
assert.deepEqual(gptImage2Provider.capabilities.sizes, ['1024x1024', '1536x1024', '1024x1536', 'auto']);
assert.deepEqual(gptImage2Provider.capabilities.qualities, ['low', 'medium', 'high', 'auto']);
assert.deepEqual(gptImage2Provider.capabilities.referenceMimeTypes, ['image/png', 'image/jpeg', 'image/webp']);
assert.equal(gptImage2Provider.capabilities.maxReferenceImageBytes, (25 * 1024 * 1024) - 1);
assert.deepEqual(
  config.providers.find((provider) => provider.id === 'video-1').capabilities.resolutions,
  ['768P', '2K']
);
assert.equal(config.providers.find((provider) => provider.id === 'video-1').name, 'MiniMax H3');
assert.equal(config.providers.find((provider) => provider.id === 'video-1').model, 'MiniMax-H3');
assert.equal(config.providers.find((provider) => provider.id === 'chat-1').name, 'Messs AI');
assert.deepEqual(config.providers.find((provider) => provider.id === 'chat-1').models, [
  'gemini-3.1-flash-lite',
  'gemini-3.6-flash'
]);
assert.equal(config.providers.find((provider) => provider.id === 'chat-2').name, 'AI Chat');
assert.equal(config.providers.find((provider) => provider.id === 'chat-2').protocol, 'openai-chat');
assert.deepEqual(config.providers.find((provider) => provider.id === 'chat-2').models, [
  'gpt-5.6-luna',
  'doubao-seed-2-1-pro-260628',
  'deepseek-v4-pro'
]);

const publicText = JSON.stringify(config);
assert.equal(publicText.includes('quickrouter-secret'), false);
assert.equal(publicText.includes('relay-two-secret'), false);
assert.equal(publicText.includes('minimax-secret'), false);
assert.equal(publicText.includes('RELAY_2_API_KEY'), false);
assert.equal(publicText.includes('relay.example.com'), false);
assert.equal(publicText.includes('quickrouter.ai'), false);
assert.equal(publicText.includes('minimaxi.com'), false);
assert.equal(publicText.includes('api.302.ai'), false);

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload)
  };
}

const nanoCalls = [];
globalThis.fetch = async (url, options = {}) => {
  nanoCalls.push({ url: String(url), options });
  return jsonResponse({
    candidates: [{
      content: {
        role: 'model',
        parts: [{ inlineData: { mimeType: 'image/png', data: 'iVBORw==' } }]
      }
    }]
  });
};
const nanoImage = await generateMedia('image', {
  providerId: 'image-1',
  prompt: 'editorial portrait',
  size: '2K',
  aspectRatio: '3:4',
  urls: []
});
assert.deepEqual(nanoImage, Buffer.from('iVBORw==', 'base64'));
assert.equal(
  nanoCalls[0].url,
  'https://api.quickrouter.ai/v1beta/models/gemini-3-pro-image:generateContent'
);
assert.equal(nanoCalls[0].options.headers.Authorization, 'Bearer quickrouter-secret');
const nanoBody = JSON.parse(nanoCalls[0].options.body);
assert.deepEqual(nanoBody.generationConfig.imageConfig, { aspectRatio: '3:4', clarity: '2K' });

const gptImageCalls = [];
globalThis.fetch = async (url, options = {}) => {
  gptImageCalls.push({ url: String(url), options });
  return jsonResponse({ data: [{ b64_json: 'iVBORw==' }] });
};
const gptImage = await generateMedia('image', {
  providerId: 'image-6',
  prompt: 'minimal product photograph',
  size: '1536x1024',
  quality: 'high',
  aspectRatio: '3:2',
  urls: []
});
assert.deepEqual(gptImage, Buffer.from('iVBORw==', 'base64'));
assert.equal(gptImageCalls[0].url, 'https://api.quickrouter.ai/v1/images/generations');
assert.equal(gptImageCalls[0].options.headers.Authorization, 'Bearer quickrouter-secret');
assert.deepEqual(JSON.parse(gptImageCalls[0].options.body), {
  model: 'gpt-image-2',
  prompt: 'minimal product photograph',
  n: 1,
  size: '1536x1024',
  quality: 'high'
});

await generateMedia('image', {
  providerId: 'image-6',
  prompt: 'make the background blue',
  size: '1024x1536',
  quality: 'medium',
  aspectRatio: '2:3',
  urls: ['data:image/webp;base64,UklGRg==']
});
assert.equal(gptImageCalls[1].url, 'https://api.quickrouter.ai/v1/images/edits');
assert.ok(gptImageCalls[1].options.body instanceof FormData);
assert.equal(gptImageCalls[1].options.body.get('model'), 'gpt-image-2');
assert.equal(gptImageCalls[1].options.body.get('size'), '1024x1536');
assert.equal(gptImageCalls[1].options.body.get('quality'), 'medium');
assert.equal(gptImageCalls[1].options.body.get('image').type, 'image/webp');
assert.equal(gptImageCalls[1].options.headers['Content-Type'], undefined);

const chatCalls = [];
globalThis.fetch = async (url, options = {}) => {
  chatCalls.push({ url: String(url), options });
  return jsonResponse({
    candidates: [{ content: { role: 'model', parts: [{ text: 'Gateway chat reply' }] } }]
  });
};
const chatReply = await chat({
  providerId: 'chat-1',
  model: 'gemini-3.6-flash',
  prompt: 'Hello',
  messages: [{ role: 'user', content: 'Hello' }]
});
assert.equal(chatReply, 'Gateway chat reply');
assert.equal(
  chatCalls[0].url,
  'https://api.quickrouter.ai/v1beta/models/gemini-3.6-flash:generateContent'
);
assert.equal(JSON.parse(chatCalls[0].options.body).contents[0].parts[0].text, 'Hello');

const advancedChatCalls = [];
globalThis.fetch = async (url, options = {}) => {
  advancedChatCalls.push({ url: String(url), options });
  return jsonResponse({ choices: [{ message: { role: 'assistant', content: 'Advanced chat reply' } }] });
};
for (const model of ['gpt-5.6-luna', 'doubao-seed-2-1-pro-260628', 'deepseek-v4-pro']) {
  const reply = await chat({
    providerId: 'chat-2',
    model,
    prompt: `Hello ${model}`,
    messages: [{ role: 'user', content: `Hello ${model}` }]
  });
  assert.equal(reply, 'Advanced chat reply');
}
assert.equal(advancedChatCalls.length, 3);
advancedChatCalls.forEach((call, index) => {
  assert.equal(call.url, 'https://api.quickrouter.ai/v1/chat/completions');
  assert.equal(call.options.headers.Authorization, 'Bearer quickrouter-secret');
  const body = JSON.parse(call.options.body);
  assert.equal(body.model, ['gpt-5.6-luna', 'doubao-seed-2-1-pro-260628', 'deepseek-v4-pro'][index]);
  assert.equal(body.stream, false);
});

const miniMaxCalls = [];
globalThis.fetch = async (url, options = {}) => {
  const value = String(url);
  miniMaxCalls.push({ url: value, options });
  if (value === 'https://api.minimaxi.com/v2/video_generation') {
    return jsonResponse({ task_id: 'h3-task-1' });
  }
  if (value === 'https://api.minimaxi.com/v2/query/video_generation/h3-task-1') {
    return jsonResponse({
      task: {
        id: 'h3-task-1',
        status: 'succeeded',
        content: { url: 'https://cdn.example/h3.mp4' }
      }
    });
  }
  throw new Error(`Unexpected MiniMax URL: ${value}`);
};
const createdVideo = await createVideoTask({
  providerId: 'video-1',
  prompt: 'slow cinematic orbit',
  resolution: '2K',
  duration: 5,
  aspectRatio: '16:9',
  urls: []
});
assert.deepEqual(createdVideo, { providerId: 'video-1', taskId: 'h3-task-1' });
assert.deepEqual(await pollVideoTask('video-1', createdVideo.taskId), {
  status: 'succeeded',
  resultUrl: 'https://cdn.example/h3.mp4'
});
const miniMaxBody = JSON.parse(miniMaxCalls[0].options.body);
assert.deepEqual(miniMaxBody, {
  model: 'MiniMax-H3',
  content: [{ type: 'text', text: 'slow cinematic orbit' }],
  resolution: '2K',
  duration: 5,
  ratio: '16:9',
  aigc_watermark: false
});
assert.equal(miniMaxCalls[0].options.headers.Authorization, 'Bearer minimax-secret');

await createVideoTask({
  providerId: 'video-1',
  prompt: 'animate between these frames',
  resolution: '768P',
  duration: 4,
  aspectRatio: 'adaptive',
  urls: ['https://cdn.example/first.png', 'https://cdn.example/last.png']
});
const frameRequest = miniMaxCalls
  .map((call) => {
    try { return { ...call, body: JSON.parse(call.options.body) }; } catch (error) { return null; }
  })
  .filter(Boolean)
  .find((call) => call.body && call.body.content && call.body.content.length === 3);
assert.ok(frameRequest);
assert.equal(frameRequest.body.ratio, 'adaptive');
assert.deepEqual(frameRequest.body.content.slice(1), [
  { type: 'image_url', image_url: { url: 'https://cdn.example/first.png' }, role: 'first_frame' },
  { type: 'image_url', image_url: { url: 'https://cdn.example/last.png' }, role: 'last_frame' }
]);

await assert.rejects(
  createVideoTask({
    providerId: 'video-1',
    prompt: 'invalid frame ratio',
    resolution: '768P',
    duration: 4,
    aspectRatio: '16:9',
    urls: ['https://cdn.example/first.png']
  }),
  (error) => error && error.code === 'invalid-aspect-ratio'
);

globalThis.fetch = async () => ({
  ok: false,
  status: 429,
  headers: { get: (name) => name.toLowerCase() === 'retry-after' ? '7' : null },
  text: async () => JSON.stringify({ error: { code: '1008', message: 'Please slow down.' } })
});
await assert.rejects(
  pollVideoTask('video-1', 'h3-task-rate-limited'),
  (error) => error
    && error.code === 'provider-rate-limited'
    && error.retryable === true
    && error.retryAfterMs === 7000
    && error.upstreamCode === '1008'
);

await assert.rejects(
  generateMedia('video', {
    providerId: 'video-1',
    prompt: 'legacy synchronous path',
    resolution: '768P',
    duration: 4,
    aspectRatio: '16:9',
    urls: []
  }),
  (error) => error && error.code === 'async-video-required'
);

process.stdout.write('gateway provider registry tests passed.\n');
