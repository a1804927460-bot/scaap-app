import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const gatewayServerSource = fs.readFileSync(new URL('../gateway/src/server.js', import.meta.url), 'utf8');
const { PROVIDER_CATALOG_VERSION } = require('../lib/provider-catalog');

process.env.Quick_API_KEY = 'quickrouter-secret';
process.env.AI302_KEY = 'ai302-secret';
process.env.MINIMAX_API_KEY = 'minimax-secret';
process.env.LEGNEXT_API_KEY = 'legnext-secret';
process.env.AI_GATEWAY_PUBLIC_URL = 'https://gateway.test';
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
  providerPromptLimit,
  publicProviderConfig
} = await import('../gateway/src/providers.js');
const config = publicProviderConfig();
const ids = config.providers.map((provider) => provider.id);

assert.equal(config.catalogVersion, PROVIDER_CATALOG_VERSION);

assert.ok(ids.includes('image-1'));
assert.ok(ids.includes('video-1'));
assert.ok(ids.includes('video-2'));
assert.ok(ids.includes('video-3'));
assert.ok(ids.includes('chat-1'));
assert.ok(ids.includes('chat-2'));
assert.ok(ids.includes('relay-2-image'));
assert.ok(ids.includes('relay-2-chat'));
assert.deepEqual(
  config.providers.find((provider) => provider.id === 'relay-2-chat').models,
  ['model-a', 'model-b']
);
assert.equal(config.providers.find((provider) => provider.id === 'image-1').name, 'Nano Banana Pro');
assert.equal(config.providers.find((provider) => provider.id === 'image-1').protocol, 'gemini-native');
assert.equal(config.providers.find((provider) => provider.id === 'image-3').name, 'Seedream 5.0');
assert.equal(config.providers.find((provider) => provider.id === 'image-3').model, 'doubao-seedream-5-0-260128');
assert.equal(config.providers.find((provider) => provider.id === 'image-4').name, 'Midjourney Turbo');
for (const [id, model] of [['image-17', '8.1'], ['image-18', '8.2']]) {
  const provider = config.providers.find((entry) => entry.id === id);
  assert.equal(provider.name, `Midjourney V${model}`);
  assert.equal(provider.model, model);
  assert.equal(provider.protocol, 'legnext-midjourney');
  assert.equal(provider.capabilities.maxReferenceImages, 0);
}
for (const id of ['image-2', 'image-5', 'image-7', 'image-9', 'image-11', 'image-12', 'image-13', 'image-14']) {
  assert.equal(ids.includes(id), false);
}
for (const id of ['video-4', 'video-5', 'video-6', 'video-7', 'video-8', 'video-9']) {
  assert.equal(ids.includes(id), false);
}
const gptImage2Provider = config.providers.find((provider) => provider.id === 'image-6');
assert.equal(gptImage2Provider.name, 'GPT Image 2');
assert.equal(gptImage2Provider.model, 'gpt-image-2');
assert.equal(gptImage2Provider.protocol, 'openai-image');
assert.equal(gptImage2Provider.capabilities.sizes.length, 30);
for (const requiredSize of [
  '1024x1024', '2880x2880', '1920x1080', '3840x2160', '1080x1920', '2160x3840',
  '3200x2000', '2000x3200', '3840x1920', '1920x3840', '3200x2400', '2400x3200',
  '3200x2560', '2560x3200', '3780x1620', 'auto'
]) {
  assert.equal(gptImage2Provider.capabilities.sizes.includes(requiredSize), true, `${requiredSize} must be exposed for GPT Image 2.`);
}
assert.deepEqual(gptImage2Provider.capabilities.qualities, ['low', 'medium', 'high', 'auto']);
assert.deepEqual(gptImage2Provider.capabilities.ratios, [
  'auto', '1:1', '16:9', '9:16', '16:10', '10:16', '2:1', '1:2',
  '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9', '9:21', '3:1',
  '1:3', '4:1', '1:4', '7:5', '5:7', '8:5', '5:8'
]);
assert.equal(gptImage2Provider.capabilities.arbitrarySizes, true);
assert.equal(gptImage2Provider.capabilities.arbitraryRatios, true);
assert.equal(gptImage2Provider.capabilities.maxSizeEdge, 3840);
assert.equal(gptImage2Provider.capabilities.maxSizePixels, 8_300_000);
for (const size of gptImage2Provider.capabilities.sizes.filter((value) => value !== 'auto')) {
  const [width, height] = size.split('x').map(Number);
  const [ratioWidth, ratioHeight] = gptImage2Provider.capabilities.sizeRatios[size].split(':').map(Number);
  assert.ok(width <= 3840 && height <= 3840, `${size} exceeds the GPT Image 2 edge limit.`);
  assert.ok(width * height <= 8_300_000, `${size} exceeds the GPT Image 2 pixel limit.`);
  assert.ok(Math.abs((width / height) - (ratioWidth / ratioHeight)) < 1e-9, `${size} has an incorrect ratio mapping.`);
}
assert.equal(gptImage2Provider.capabilities.promptMaxCharacters, 1000);
assert.equal(gptImage2Provider.capabilities.referencePromptMaxCharacters, 32000);
assert.deepEqual(gptImage2Provider.capabilities.referenceMimeTypes, ['image/png', 'image/jpeg', 'image/webp']);
assert.equal(gptImage2Provider.capabilities.maxReferenceImageBytes, (25 * 1024 * 1024) - 1);
assert.equal(providerPromptLimit('image', 'image-6', false), 1000);
assert.equal(providerPromptLimit('image', 'image-6', true), 32000);
assert.equal(providerPromptLimit('image', 'image-1', false), 12000);
assert.equal(providerPromptLimit('video', 'video-1', false), 7000);
assert.match(
  gatewayServerSource,
  /const sizeRatios = capabilities\.sizeRatios[\s\S]*?mappedRatio !== requestedRatio[\s\S]*?invalid-size-ratio/,
  'Gateway must reject contradictory mapped image sizes and ratios.'
);
assert.match(
  gatewayServerSource,
  /arbitrarySizes[\s\S]*?maxSizeEdge[\s\S]*?maxSizePixels[\s\S]*?imageDimensionsWithinCapabilities\(requestedSize, capabilities\)/,
  'Gateway must allow bounded arbitrary GPT Image 2 dimensions.'
);
assert.match(
  gatewayServerSource,
  /const configuredSizes = urls\.length > 1[\s\S]*?capabilities\.multiReferenceSizes[\s\S]*?capabilities\.referenceSizes[\s\S]*?capabilities\.resolutionPresets[\s\S]*?new Set\(configuredSizes\.map\(normalizeImageSize\)\)/,
  'Gateway must accept provider resolution presets such as GPT Image 2 1K, 2K, and 4K.'
);
assert.deepEqual(
  config.providers.find((provider) => provider.id === 'video-1').capabilities.resolutions,
  ['768P', '2K']
);
assert.equal(config.providers.find((provider) => provider.id === 'video-1').name, 'MiniMax H3');
assert.equal(config.providers.find((provider) => provider.id === 'video-1').model, 'MiniMax-H3');
const seedance20Provider = config.providers.find((provider) => provider.id === 'video-2');
const seedance25Provider = config.providers.find((provider) => provider.id === 'video-3');
assert.equal(seedance20Provider.name, 'Seedance 2.0');
assert.equal(seedance20Provider.model, 'doubao-seedance-2-0-260128');
assert.equal(seedance20Provider.protocol, 'seedance-video-v3');
assert.deepEqual(seedance20Provider.capabilities.resolutions, ['480P', '720P']);
assert.deepEqual(seedance20Provider.capabilities.durations, Array.from({ length: 12 }, (_value, index) => index + 4));
assert.equal(seedance20Provider.capabilities.maxReferenceImages, 9);
assert.deepEqual(seedance20Provider.capabilities.videoModes.map((mode) => mode.id), [
  'text', 'first-frame', 'first-last-frame', 'omni'
]);
assert.deepEqual(seedance20Provider.capabilities.videoModes[2].roles, ['first_frame', 'last_frame']);
assert.deepEqual(seedance20Provider.capabilities.videoModes[3].roles, ['reference_image']);
assert.deepEqual(seedance20Provider.capabilities.videoModes[3].mediaTypes, ['image', 'video']);
assert.equal(seedance20Provider.capabilities.videoModes[3].maxReferenceVideos, 3);
assert.equal(seedance25Provider.name, 'Seedance 2.5');
assert.equal(seedance25Provider.model, 'doubao-seedance-2-5-260628');
assert.equal(seedance25Provider.protocol, 'seedance-video-v3');
assert.deepEqual(seedance25Provider.capabilities.resolutions, ['480P', '720P']);
assert.deepEqual(seedance25Provider.capabilities.durations, Array.from({ length: 27 }, (_value, index) => index + 4));
assert.deepEqual(seedance25Provider.capabilities.textRatios, ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9']);
assert.equal(seedance25Provider.capabilities.supportsResolution, false);
assert.equal(seedance25Provider.capabilities.createTimeoutMs, 45_000);
assert.equal(Object.hasOwn(seedance25Provider.capabilities, 'generateAudio'), false);
assert.equal(seedance20Provider.capabilities.frameReferenceEncoding, 'ordered-content');
assert.equal(seedance25Provider.capabilities.frameReferenceEncoding, 'ordered-content');
assert.equal(seedance25Provider.capabilities.maxReferenceImages, 9);
assert.equal(seedance25Provider.capabilities.videoModes[3].maxReferenceVideos, 6);
assert.equal(Object.hasOwn(seedance25Provider.capabilities.videoModes[1], 'ratios'), false);
assert.equal(Object.hasOwn(seedance25Provider.capabilities.videoModes[2], 'ratios'), false);
const providerOverridesBeforeStaleSeedance = process.env.AI_PROVIDERS_JSON;
process.env.AI_PROVIDERS_JSON = JSON.stringify([{
  id: 'video-3',
  kind: 'video',
  name: 'Seedance 2.5 deployment override',
  endpoint: 'https://api.302.ai/volcengine/api/v3/contents/generations/tasks',
  resultEndpoint: 'https://api.302.ai/volcengine/api/v3/contents/generations/tasks',
  model: 'doubao-seedance-2-5-260628',
  protocol: 'seedance-video-v3',
  keyEnv: 'AI302_KEY',
  capabilities: { resolutions: ['480P'] }
}]);
assert.deepEqual(
  publicProviderConfig().providers.find((provider) => provider.id === 'video-3').capabilities.resolutions,
  ['480P', '720P'],
  'Stale deployment overrides must not remove built-in Seedance resolutions.'
);
process.env.AI_PROVIDERS_JSON = providerOverridesBeforeStaleSeedance;
assert.equal(config.providers.find((provider) => provider.id === 'chat-1').name, 'Messs AI');
assert.deepEqual(config.providers.find((provider) => provider.id === 'chat-1').models, [
  'gemini-3.7-flash'
]);
assert.equal(config.providers.find((provider) => provider.id === 'chat-1').protocol, 'openai-chat');
assert.equal(config.providers.find((provider) => provider.id === 'chat-2').name, 'AI Chat');
assert.equal(config.providers.find((provider) => provider.id === 'chat-2').protocol, 'openai-chat');
assert.deepEqual(config.providers.find((provider) => provider.id === 'chat-2').models, [
  'gpt-5.6-luna',
  'doubao-seed-2-1-pro-260628',
  'deepseek-v4-pro'
]);

const publicText = JSON.stringify(config);
assert.equal(publicText.includes('quickrouter-secret'), false);
assert.equal(publicText.includes('ai302-secret'), false);
assert.equal(publicText.includes('legnext-secret'), false);
assert.equal(publicText.includes('relay-two-secret'), false);
assert.equal(publicText.includes('minimax-secret'), false);
assert.equal(publicText.includes('RELAY_2_API_KEY'), false);
assert.equal(publicText.includes('AI302_KEY'), false);
assert.equal(publicText.includes('relay.example.com'), false);
assert.equal(publicText.includes('quickrouter.ai'), false);
assert.equal(publicText.includes('minimaxi.com'), false);
assert.equal(publicText.includes('api.302.ai'), false);
assert.equal(publicText.includes('legnext.ai'), false);

const configuredAi302Key = process.env.AI302_KEY;
delete process.env.AI302_KEY;
const withoutAi302 = publicProviderConfig();
assert.equal(withoutAi302.providers.some((provider) => provider.id === 'image-1'), true);
assert.equal(withoutAi302.providers.some((provider) => provider.id === 'image-2'), false);
assert.equal(withoutAi302.providers.some((provider) => provider.id === 'image-5'), false);
assert.equal(withoutAi302.providers.some((provider) => provider.id === 'image-9'), false);
for (const id of ['image-3', 'image-4', 'image-6', 'image-7', 'image-8', 'image-10', 'image-11', 'image-12', 'image-13', 'image-14', 'image-15', 'image-16']) {
  assert.equal(withoutAi302.providers.some((provider) => provider.id === id), false);
}
assert.equal(withoutAi302.providers.some((provider) => provider.id === 'video-2'), false);
assert.equal(withoutAi302.providers.some((provider) => provider.id === 'video-3'), false);
for (const id of ['video-4', 'video-5', 'video-6', 'video-7', 'video-8', 'video-9']) {
  assert.equal(withoutAi302.providers.some((provider) => provider.id === id), false);
}
process.env.AI302_KEY = configuredAi302Key;
assert.equal(withoutAi302.providers.some((provider) => provider.id === 'image-17'), true);
assert.equal(withoutAi302.providers.some((provider) => provider.id === 'image-18'), true);

const configuredLegnextKey = process.env.LEGNEXT_API_KEY;
delete process.env.LEGNEXT_API_KEY;
const withoutLegnext = publicProviderConfig();
assert.equal(withoutLegnext.providers.some((provider) => provider.id === 'image-17'), false);
assert.equal(withoutLegnext.providers.some((provider) => provider.id === 'image-18'), false);
process.env.LEGNEXT_API_KEY = configuredLegnextKey;

const configuredQuickRouterKey = process.env.Quick_API_KEY;
delete process.env.Quick_API_KEY;
const withoutQuickRouter = publicProviderConfig();
assert.equal(withoutQuickRouter.providers.some((provider) => provider.id === 'image-1'), false);
assert.equal(withoutQuickRouter.providers.some((provider) => provider.id === 'image-6'), true);
assert.equal(withoutQuickRouter.providers.some((provider) => provider.id === 'image-3'), true);
process.env.Quick_API_KEY = configuredQuickRouterKey;

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

const nano2kPng = pngHeader(2048, 1536);

const nanoCalls = [];
globalThis.fetch = async (url, options = {}) => {
  nanoCalls.push({ url: String(url), options });
  return jsonResponse({
    candidates: [{
      content: {
        role: 'model',
        parts: [{ inlineData: { mimeType: 'image/png', data: nano2kPng.toString('base64') } }]
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
assert.deepEqual(nanoImage, nano2kPng);
assert.equal(
  nanoCalls[0].url,
  'https://api.quickrouter.ai/v1beta/models/gemini-3-pro-image-preview:generateContent'
);
assert.equal(nanoCalls[0].options.headers.Authorization, 'Bearer quickrouter-secret');
const nanoBody = JSON.parse(nanoCalls[0].options.body);
assert.deepEqual(nanoBody, {
  contents: [{
    role: 'user',
    parts: [{ text: 'editorial portrait' }]
  }],
  generationConfig: {
    responseModalities: ['TEXT', 'IMAGE'],
    imageConfig: { aspectRatio: '3:4', imageSize: '2K' }
  }
});

const relayReference = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
await generateMedia('image', {
  providerId: 'image-2',
  prompt: 'restyle this reference',
  size: '2K',
  aspectRatio: '1:1',
  urls: [relayReference]
});
assert.equal(nanoCalls[1].url, 'https://api.302.ai/ws/api/v3/google/nano-banana-2/edit');
const relayedBody = JSON.parse(nanoCalls[1].options.body);
assert.equal(relayedBody.images.length, 1);
assert.match(relayedBody.images[0], /^https:\/\/gateway\.test\/v1\/tools\/assets\/[A-Za-z0-9_-]{43}$/);
const relayToken = relayedBody.images[0].split('/').pop();
const { getAi302RelayAsset } = await import('../gateway/src/ai302-tools.js');
assert.throws(() => getAi302RelayAsset(relayToken), (error) => error && error.code === 'tool-asset-not-found');

globalThis.fetch = async () => jsonResponse({
  candidates: [{
    content: {
      role: 'model',
      parts: [{ inlineData: { mimeType: 'image/png', data: pngHeader(4096, 2304).toString('base64') } }]
    }
  }]
});
assert.deepEqual(await generateMedia('image', {
  providerId: 'image-1',
  prompt: 'must remain 4K',
  size: '4K',
  aspectRatio: '1:1',
  urls: []
}), pngHeader(4096, 2304));

globalThis.fetch = async () => jsonResponse({
  candidates: [{
    content: {
      role: 'model',
      parts: [{ inlineData: { mimeType: 'image/png', data: pngHeader(1376, 768).toString('base64') } }]
    }
  }]
});
await assert.rejects(
  generateMedia('image', {
    providerId: 'image-1',
    prompt: 'reject fake 4K',
    size: '4K',
    aspectRatio: '16:9',
    urls: []
  }),
  (error) => error && error.code === 'image-resolution-mismatch' && error.actualWidth === 1376
);

const gptImageCalls = [];
const providerOverridesBeforeWrapped = process.env.AI_PROVIDERS_JSON;
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
assert.equal(gptImageCalls[0].url, 'https://api.302.ai/v1/images/generations');
assert.equal(gptImageCalls[0].options.headers.Authorization, 'Bearer ai302-secret');
assert.deepEqual(JSON.parse(gptImageCalls[0].options.body), {
  model: 'gpt-image-2',
  prompt: 'minimal product photograph',
  n: 1,
  size: '1536x1024',
  quality: 'high',
  output_format: 'png'
});

await generateMedia('image', {
  providerId: 'image-6',
  prompt: 'make the background blue',
  size: '1024x1536',
  quality: 'medium',
  aspectRatio: '2:3',
  urls: ['data:image/webp;base64,UklGRg==']
});
assert.equal(gptImageCalls[1].url, 'https://api.302.ai/v1/images/edits');
assert.ok(gptImageCalls[1].options.body instanceof FormData);
assert.equal(gptImageCalls[1].options.body.get('model'), 'gpt-image-2');
assert.equal(gptImageCalls[1].options.body.get('size'), '1024x1536');
assert.equal(gptImageCalls[1].options.body.get('quality'), 'medium');
assert.equal(gptImageCalls[1].options.body.get('output_format'), 'png');
assert.equal(gptImageCalls[1].options.body.get('image').type, 'image/webp');
assert.equal(gptImageCalls[1].options.headers['Content-Type'], undefined);

await generateMedia('image', {
  providerId: 'image-6',
  prompt: 'wide architectural concept',
  size: '2000x1000',
  quality: 'low',
  aspectRatio: '2:1',
  urls: []
});
assert.equal(JSON.parse(gptImageCalls[2].options.body).size, '2000x1000');
assert.equal(JSON.parse(gptImageCalls[2].options.body).quality, 'low');

const chatCalls = [];
globalThis.fetch = async (url, options = {}) => {
  chatCalls.push({ url: String(url), options });
  return jsonResponse({ choices: [{ message: { role: 'assistant', content: 'Gateway chat reply' } }] });
};
const chatReply = await chat({
  providerId: 'chat-1',
  model: 'gemini-3.7-flash',
  prompt: 'Hello',
  messages: [{ role: 'user', content: 'Hello' }]
});
assert.equal(chatReply, 'Gateway chat reply');
assert.equal(
  chatCalls[0].url,
  'https://api.302.ai/v1/chat/completions'
);
assert.equal(chatCalls[0].options.headers.Authorization, 'Bearer ai302-secret');
assert.deepEqual(JSON.parse(chatCalls[0].options.body), {
  model: 'gemini-3.7-flash',
  messages: [{ role: 'user', content: 'Hello' }],
  stream: false
});

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
  videoMode: 'first-last-frame',
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

const seedanceCalls = [];
globalThis.fetch = async (url, options = {}) => {
  const value = String(url);
  seedanceCalls.push({ url: value, options });
  if (value === 'https://api.302.ai/volcengine/api/v3/contents/generations/tasks'
      && options.method === 'POST') {
    const body = JSON.parse(options.body);
    return jsonResponse({
      id: body.model === 'doubao-seedance-2-0-260128'
        ? 'seedance-20-task'
        : 'seedance-25-task'
    });
  }
  if (value.endsWith('/seedance-20-task')) {
    return jsonResponse({
      id: 'seedance-20-task',
      status: 'succeeded',
      content: { video_url: 'https://cdn.example/seedance-20.mp4' }
    });
  }
  if (value.endsWith('/seedance-25-task')) {
    return jsonResponse({ id: 'seedance-25-task', status: 'running' });
  }
  throw new Error(`Unexpected Seedance URL: ${value}`);
};

const createdSeedance20 = await createVideoTask({
  providerId: 'video-2',
  prompt: 'a precise product turntable shot',
  resolution: '720P',
  duration: 8,
  aspectRatio: '16:9',
  videoMode: 'omni',
  urls: ['https://cdn.example/front.png', 'https://cdn.example/side.png']
});
assert.deepEqual(createdSeedance20, { providerId: 'video-2', taskId: 'seedance-20-task' });
assert.deepEqual(JSON.parse(seedanceCalls[0].options.body), {
  model: 'doubao-seedance-2-0-260128',
  content: [
    { type: 'text', text: 'a precise product turntable shot' },
    { type: 'image_url', image_url: { url: 'https://cdn.example/front.png' }, role: 'reference_image' },
    { type: 'image_url', image_url: { url: 'https://cdn.example/side.png' }, role: 'reference_image' }
  ],
  generate_audio: true,
  ratio: '16:9',
  duration: 8,
  resolution: '720p',
  watermark: false
});

const createdSeedanceVideoReference = await createVideoTask({
  providerId: 'video-2',
  prompt: 'match the reference movement',
  resolution: '720P',
  duration: 6,
  aspectRatio: '16:9',
  videoMode: 'omni',
  urls: ['https://cdn.example/movement.mp4'],
  referenceMediaTypes: ['video']
});
assert.deepEqual(createdSeedanceVideoReference, { providerId: 'video-2', taskId: 'seedance-20-task' });
assert.deepEqual(JSON.parse(seedanceCalls[1].options.body).content, [
  { type: 'text', text: 'match the reference movement' },
  { type: 'video_url', video_url: { url: 'https://cdn.example/movement.mp4' }, role: 'reference_video' }
]);
await assert.rejects(
  createVideoTask({
    providerId: 'video-2',
    prompt: 'incomplete reference metadata',
    resolution: '720P',
    duration: 6,
    aspectRatio: '16:9',
    videoMode: 'omni',
    urls: ['https://cdn.example/movement.mp4'],
    referenceMediaTypes: []
  }),
  (error) => error && error.code === 'invalid-reference-media'
);
assert.equal(seedanceCalls[0].options.headers.Authorization, 'Bearer ai302-secret');
assert.deepEqual(await pollVideoTask('video-2', 'seedance-20-task'), {
  status: 'succeeded',
  resultUrl: 'https://cdn.example/seedance-20.mp4'
});

const createdSeedance25 = await createVideoTask({
  providerId: 'video-3',
  prompt: 'cinematic city at dawn',
  resolution: '720P',
  duration: 4,
  aspectRatio: 'adaptive',
  videoMode: 'text',
  urls: []
});
assert.deepEqual(createdSeedance25, { providerId: 'video-3', taskId: 'seedance-25-task' });
const seedance25CreateCall = seedanceCalls.find((call) => {
  try { return JSON.parse(call.options.body).model === 'doubao-seedance-2-5-260628'; } catch (error) { return false; }
});
assert.ok(seedance25CreateCall);
assert.deepEqual(JSON.parse(seedance25CreateCall.options.body), {
  model: 'doubao-seedance-2-5-260628',
  content: [{ type: 'text', text: 'cinematic city at dawn' }],
  ratio: '16:9',
  duration: 4,
  watermark: false
});
assert.deepEqual(await pollVideoTask('video-3', 'seedance-25-task'), { status: 'running' });

await createVideoTask({
  providerId: 'video-3',
  prompt: 'transition smoothly from the first frame to the last frame',
  resolution: '720P',
  duration: 8,
  aspectRatio: 'adaptive',
  videoMode: 'first-last-frame',
  urls: ['https://cdn.example/first.png', 'https://cdn.example/last.png'],
  referenceMediaTypes: ['image', 'image']
});
const seedance25FrameBody = seedanceCalls
  .map((call) => {
    try { return JSON.parse(call.options.body); } catch (error) { return null; }
  })
  .find((body) => body && body.content && body.content[0] && body.content[0].text.startsWith('transition smoothly'));
assert.deepEqual(seedance25FrameBody.content, [
  { type: 'text', text: 'transition smoothly from the first frame to the last frame' },
  { type: 'image_url', image_url: { url: 'https://cdn.example/first.png' } },
  { type: 'image_url', image_url: { url: 'https://cdn.example/last.png' } }
]);
assert.equal(Object.hasOwn(seedance25FrameBody, 'generate_audio'), false);
assert.equal(Object.hasOwn(seedance25FrameBody, 'resolution'), false);

globalThis.fetch = async () => {
  throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
};
await assert.rejects(
  createVideoTask({
    providerId: 'video-3',
    operationId: '11111111-2222-4333-8444-777777777777',
    prompt: 'normalize a provider submission timeout',
    resolution: '720P',
    duration: 5,
    aspectRatio: '16:9',
    videoMode: 'text',
    urls: []
  }),
  (error) => error
    && error.code === 'provider-timeout'
    && error.status === 504
    && error.retryable === false
);

for (const providerId of ['video-1', 'video-2', 'video-3']) {
  let createAttempts = 0;
  globalThis.fetch = async () => {
    createAttempts += 1;
    return {
      ok: false,
      status: 503,
      headers: { get: () => null },
      text: async () => JSON.stringify({ error: { message: 'Temporary provider network error.' } })
    };
  };
  const operationId = `11111111-2222-4333-8444-${providerId.replace('video-', '').padStart(12, '0')}`;
  await assert.rejects(
    createVideoTask({
      providerId,
      operationId,
      prompt: 'do not replay a paid request after an ambiguous provider failure',
      resolution: providerId === 'video-1' ? '768P' : '480P',
      duration: 4,
      aspectRatio: providerId === 'video-1' ? '16:9' : 'adaptive',
      urls: []
    }),
    (error) => error && error.code === 'provider-temporarily-unavailable'
  );
  assert.equal(createAttempts, 1, `${providerId} paid creation must be submitted only once`);
}

let channelConfigurationAttempts = 0;
globalThis.fetch = async () => {
  channelConfigurationAttempts += 1;
  if (channelConfigurationAttempts === 1) {
    return {
      ok: false,
      status: 502,
      headers: { get: () => null },
      text: async () => JSON.stringify({
        error: {
          message: 'model=seedance-2-5-260628 : Network error when getting channel configuration. AI id: private-task-id'
        }
      })
    };
  }
  return jsonResponse({ id: 'seedance-channel-retry-task' });
};
assert.deepEqual(await createVideoTask({
  providerId: 'video-3',
  operationId: '11111111-2222-4333-8444-999999999999',
  prompt: 'retry only a pre-dispatch channel lookup failure',
  resolution: '720P',
  duration: 5,
  aspectRatio: '16:9',
  videoMode: 'text',
  urls: []
}), { providerId: 'video-3', taskId: 'seedance-channel-retry-task' });
assert.equal(channelConfigurationAttempts, 2);

globalThis.fetch = async (url, options = {}) => {
  const value = String(url);
  if (value.endsWith('/wrapped-create') && options.method === 'POST') {
    return jsonResponse({ response: { data: { task: { id: 'wrapped-seedance-task' } } } });
  }
  if (value.endsWith('/wrapped-seedance-task')) {
    return jsonResponse({
      payload: {
        task: {
          taskStatus: 'completed',
          output: { videoUrl: 'https://cdn.example/wrapped-seedance.mp4' }
        }
      }
    });
  }
  throw new Error(`Unexpected wrapped Seedance URL: ${value}`);
};
process.env.AI_PROVIDERS_JSON = JSON.stringify([{
  id: 'video-wrapped-seedance',
  kind: 'video',
  name: 'Wrapped Seedance',
  endpoint: 'https://api.302.ai/wrapped-create',
  resultEndpoint: 'https://api.302.ai/wrapped-create',
  keyEnv: 'AI302_KEY',
  model: 'doubao-seedance-2-5-260628',
  protocol: 'seedance-video-v3',
  capabilities: seedance25Provider.capabilities
}]);
assert.deepEqual(await createVideoTask({
  providerId: 'video-wrapped-seedance',
  prompt: 'wrapped response',
  resolution: '480P',
  duration: 4,
  aspectRatio: 'adaptive',
  urls: []
}), { providerId: 'video-wrapped-seedance', taskId: 'wrapped-seedance-task' });
assert.deepEqual(await pollVideoTask('video-wrapped-seedance', 'wrapped-seedance-task'), {
  status: 'succeeded',
  resultUrl: 'https://cdn.example/wrapped-seedance.mp4'
});
globalThis.fetch = async () => jsonResponse({ data: { state: 'completed', output: {} } });
assert.deepEqual(await pollVideoTask('video-wrapped-seedance', 'wrapped-seedance-task'), { status: 'running' });
process.env.AI_PROVIDERS_JSON = providerOverridesBeforeWrapped;

await assert.rejects(
  createVideoTask({
    providerId: 'video-2',
    prompt: 'unsupported resolution',
    resolution: '8K',
    duration: 5,
    aspectRatio: '16:9',
    videoMode: 'text',
    urls: []
  }),
  (error) => error && error.code === 'invalid-resolution'
);
await assert.rejects(
  createVideoTask({
    providerId: 'video-2',
    prompt: 'too many references',
    resolution: '720P',
    duration: 5,
    aspectRatio: '16:9',
    urls: Array.from({ length: 10 }, (_value, index) => `https://cdn.example/reference-${index}.png`)
  }),
  (error) => error && error.code === 'too-many-references'
);

for (const upstreamStatus of ['failed', 'expired']) {
  globalThis.fetch = async () => jsonResponse({
    id: `seedance-${upstreamStatus}`,
    status: upstreamStatus,
    error: { code: `seedance-${upstreamStatus}`, message: `Task ${upstreamStatus}.` }
  });
  const result = await pollVideoTask('video-2', `seedance-${upstreamStatus}`);
  assert.equal(result.status, upstreamStatus);
  assert.equal(result.errorCode, `seedance-${upstreamStatus}`);
  assert.equal(result.errorMessage, `Task ${upstreamStatus}.`);
}

globalThis.fetch = async () => jsonResponse({
  id: 'seedance-channel-terminal',
  status: 'failed',
  error: {
    code: 'upstream-internal',
    message: 'model=seedance-2-5-260628 : Network error when getting channel configuration. AI id: private-task-id'
  }
});
assert.deepEqual(await pollVideoTask('video-3', 'seedance-channel-terminal'), {
  status: 'failed',
  errorCode: 'provider-channel-unavailable',
  errorMessage: 'The video provider channel was temporarily unavailable. No points were charged.'
});

globalThis.fetch = async () => ({
  ok: false,
  status: 429,
  headers: { get: (name) => name.toLowerCase() === 'retry-after' ? '11' : null },
  text: async () => JSON.stringify({ error: { code: 'rate_limit_exceeded', message: 'Try later.' } })
});
await assert.rejects(
  pollVideoTask('video-3', 'seedance-rate-limited'),
  (error) => error
    && error.code === 'provider-rate-limited'
    && error.retryable === true
    && error.retryAfterMs === 11_000
    && error.upstreamCode === 'rate_limit_exceeded'
);

for (const providerId of ['video-2', 'video-3']) {
  await assert.rejects(
    generateMedia('video', {
      providerId,
      prompt: 'legacy synchronous path',
      resolution: '720P',
      duration: 4,
      aspectRatio: '16:9',
      urls: []
    }),
    (error) => error && error.code === 'async-video-required'
  );
}

const legacySeedanceCalls = [];
globalThis.fetch = async (url, options = {}) => {
  const value = String(url);
  legacySeedanceCalls.push({ url: value, options });
  if (value === 'https://api.302.ai/doubao/doubao-seedance' && options.method === 'POST') {
    return jsonResponse({ id: 'seedance-15-task' });
  }
  if (value.endsWith('/seedance-15-task')) {
    return jsonResponse({
      id: 'seedance-15-task',
      status: 'done',
      content: { video_url: 'https://cdn.example/seedance-15.mp4' }
    });
  }
  throw new Error(`Unexpected legacy Seedance URL: ${value}`);
};
assert.deepEqual(await createVideoTask({
  providerId: 'video-5',
  prompt: 'transition between the product frames',
  resolution: '720P',
  duration: 2,
  aspectRatio: 'adaptive',
  urls: ['https://cdn.example/first.png', 'https://cdn.example/last.png']
}), { providerId: 'video-5', taskId: 'seedance-15-task' });
assert.deepEqual(JSON.parse(legacySeedanceCalls[0].options.body), {
  model: 'doubao-seedance-1-5-pro-251215',
  content: [
    { type: 'text', text: 'transition between the product frames' },
    { type: 'image_url', image_url: { url: 'https://cdn.example/first.png' }, role: 'first_frame' },
    { type: 'image_url', image_url: { url: 'https://cdn.example/last.png' }, role: 'last_frame' }
  ],
  generate_audio: true,
  ratio: 'adaptive',
  duration: 2,
  resolution: '720p',
  watermark: false,
  service_tier: 'default'
});
assert.deepEqual(await pollVideoTask('video-5', 'seedance-15-task'), {
  status: 'succeeded',
  resultUrl: 'https://cdn.example/seedance-15.mp4'
});
await assert.rejects(
  createVideoTask({
    providerId: 'video-6',
    prompt: 'reference image at an unsupported resolution',
    resolution: '1080P',
    duration: 2,
    aspectRatio: 'adaptive',
    urls: ['https://cdn.example/first.png']
  }),
  (error) => error && error.code === 'invalid-resolution'
);
await assert.rejects(
  createVideoTask({
    providerId: 'video-7',
    prompt: 'missing required first frame',
    resolution: '720P',
    duration: 2,
    aspectRatio: '16:9',
    urls: []
  }),
  (error) => error && error.code === 'reference-required'
);

const jimengCalls = [];
globalThis.fetch = async (url, options = {}) => {
  const value = String(url);
  jimengCalls.push({ url: value, options });
  if (value.endsWith('/jimengv30') || value.endsWith('/jimeng_ti2v_v30_pro')) {
    return jsonResponse({ code: 10000, data: { task_id: value.endsWith('/jimengv30') ? 'jimeng-30-task' : 'jimeng-pro-task' } });
  }
  if (value.endsWith('/jimengv30_result')) {
    return jsonResponse({ code: 10000, data: { status: 'done', video_url: 'https://cdn.example/jimeng-30.mp4' } });
  }
  if (value.endsWith('/jimeng_ti2v_v30_pro_result')) {
    return jsonResponse({ code: 10000, data: { status: 'processing' } });
  }
  throw new Error(`Unexpected Jimeng URL: ${value}`);
};
assert.deepEqual(await createVideoTask({
  providerId: 'video-8',
  prompt: 'wide cinematic landscape',
  resolution: '1080P',
  duration: 5,
  aspectRatio: '21:9',
  urls: []
}), { providerId: 'video-8', taskId: 'jimeng-30-task' });
assert.deepEqual(JSON.parse(jimengCalls[0].options.body), {
  prompt: 'wide cinematic landscape',
  seed: -1,
  frames: 121,
  aspect_ratio: '21:9',
  req_key: 'jimeng_t2v_v30_1080p'
});
assert.deepEqual(await pollVideoTask('video-8', 'jimeng-30-task'), {
  status: 'succeeded',
  resultUrl: 'https://cdn.example/jimeng-30.mp4'
});
assert.equal(jimengCalls[1].options.method, 'POST');
assert.deepEqual(JSON.parse(jimengCalls[1].options.body), { task_id: 'jimeng-30-task' });

assert.deepEqual(await createVideoTask({
  providerId: 'video-9',
  prompt: 'animate this portrait',
  resolution: '1080P',
  duration: 5,
  aspectRatio: 'adaptive',
  urls: ['https://cdn.example/portrait.png']
}), { providerId: 'video-9', taskId: 'jimeng-pro-task' });
const jimengProBody = JSON.parse(jimengCalls[2].options.body);
assert.deepEqual(jimengProBody, {
  prompt: 'animate this portrait',
  seed: -1,
  frames: 121,
  image_urls: ['https://cdn.example/portrait.png']
});
assert.equal(Object.hasOwn(jimengProBody, 'req_key'), false);
assert.deepEqual(await pollVideoTask('video-9', 'jimeng-pro-task'), { status: 'running' });

const klingCalls = [];
globalThis.fetch = async (url, options = {}) => {
  const value = String(url);
  klingCalls.push({ url: value, options });
  if (value.endsWith('/kling-v3.0-std/image-to-video')) {
    return jsonResponse({ id: 'kling-v3-task', status: 'created' });
  }
  if (value.endsWith('/predictions/kling-v3-task/result')) {
    return jsonResponse({ status: 'succeeded', outputs: [{ url: 'https://cdn.example/kling-v3.mp4' }] });
  }
  if (value.endsWith('/kling-video-o3-pro/reference-to-video')) {
    return jsonResponse({ data: { id: 'kling-o3-task', status: 'created' } });
  }
  if (value.endsWith('/kling-video-o3-std/reference-to-video')) {
    return jsonResponse({ data: { id: 'kling-o3-first-last-task', status: 'created' } });
  }
  if (value.endsWith('/kling-video-o3-std/video-edit')) {
    return jsonResponse({ data: { id: 'kling-o3-edit-task', status: 'created' } });
  }
  if (value.endsWith('/kling-video-o3-pro/video-edit')) {
    return jsonResponse({ data: { id: 'kling-o3-pro-edit-task', status: 'created' } });
  }
  if (value.endsWith('/predictions/kling-o3-task/result')) {
    return jsonResponse({ data: { status: 'succeeded', outputs: [{ url: 'https://cdn.example/kling-o3.mp4' }] } });
  }
  if (value.endsWith('/predictions/kling-o3-edit-task/result')) {
    return jsonResponse({ data: { status: 'succeeded', outputs: [{ url: 'https://cdn.example/kling-o3-edit.mp4' }] } });
  }
  if (value.endsWith('/predictions/kling-o3-first-last-task/result')) {
    return jsonResponse({ data: { status: 'succeeded', outputs: [{ url: 'https://cdn.example/kling-o3-first-last.mp4' }] } });
  }
  if (value.endsWith('/predictions/kling-o3-pro-edit-task/result')) {
    return jsonResponse({ data: { status: 'succeeded', outputs: [{ url: 'https://cdn.example/kling-o3-pro-edit.mp4' }] } });
  }
  throw new Error(`Unexpected Kling URL: ${value}`);
};
assert.deepEqual(await createVideoTask({
  providerId: 'video-10',
  prompt: 'animate the product shot',
  resolution: '720P',
  duration: 5,
  aspectRatio: 'adaptive',
  videoMode: 'first-frame',
  urls: ['https://cdn.example/product.png'],
  referenceMediaTypes: ['image']
}), { providerId: 'video-10', taskId: 'kling-v3-task' });
assert.deepEqual(JSON.parse(klingCalls[0].options.body), {
  cfg_scale: 0.5,
  duration: 5,
  image: 'https://cdn.example/product.png',
  prompt: 'animate the product shot',
  sound: true
});
assert.deepEqual(await pollVideoTask('video-10', 'kling-v3-task'), {
  status: 'succeeded',
  resultUrl: 'https://cdn.example/kling-v3.mp4'
});
assert.deepEqual(await createVideoTask({
  providerId: 'video-13',
  prompt: 'use the video motion as a guide',
  resolution: '1080P',
  duration: 5,
  aspectRatio: '16:9',
  videoMode: 'video-reference',
  urls: ['https://cdn.example/source.mp4'],
  referenceMediaTypes: ['video']
}), { providerId: 'video-13', taskId: 'kling-o3-task' });
assert.equal(klingCalls[2].url, 'https://api.302.ai/ws/api/v3/kwaivgi/kling-video-o3-pro/reference-to-video');
assert.deepEqual(JSON.parse(klingCalls[2].options.body), {
  aspect_ratio: '16:9',
  duration: 5,
  video: 'https://cdn.example/source.mp4',
  prompt: 'use the video motion as a guide',
  keep_original_sound: true,
  sound: true
});
assert.deepEqual(await pollVideoTask('video-13', 'kling-o3-task'), {
  status: 'succeeded',
  resultUrl: 'https://cdn.example/kling-o3.mp4'
});
assert.deepEqual(await createVideoTask({
  providerId: 'video-12',
  prompt: 'change the scene to night',
  resolution: '720P',
  duration: 10,
  aspectRatio: 'adaptive',
  videoMode: 'video-edit',
  urls: ['https://cdn.example/source.mp4'],
  referenceMediaTypes: ['video']
}), { providerId: 'video-12', taskId: 'kling-o3-edit-task' });
assert.equal(klingCalls[4].url, 'https://api.302.ai/ws/api/v3/kwaivgi/kling-video-o3-std/video-edit');
assert.deepEqual(JSON.parse(klingCalls[4].options.body), {
  keep_original_sound: true,
  prompt: 'change the scene to night',
  video: 'https://cdn.example/source.mp4'
});
assert.deepEqual(await pollVideoTask('video-12', 'kling-o3-edit-task'), {
  status: 'succeeded',
  resultUrl: 'https://cdn.example/kling-o3-edit.mp4'
});
assert.deepEqual(await createVideoTask({
  providerId: 'video-12',
  prompt: 'walk from the first image into the second image',
  resolution: '720P',
  duration: 7,
  aspectRatio: '9:16',
  videoMode: 'first-last-frame',
  urls: ['https://cdn.example/first.png', 'https://cdn.example/last.png'],
  referenceMediaTypes: ['image', 'image']
}), { providerId: 'video-12', taskId: 'kling-o3-first-last-task' });
assert.equal(klingCalls.at(-1).url, 'https://api.302.ai/ws/api/v3/kwaivgi/kling-video-o3-std/reference-to-video');
assert.deepEqual(JSON.parse(klingCalls.at(-1).options.body), {
  aspect_ratio: '9:16',
  duration: 7,
  images: ['https://cdn.example/first.png', 'https://cdn.example/last.png'],
  prompt: 'walk from the first image into the second image',
  sound: true
});
assert.deepEqual(await pollVideoTask('video-12', 'kling-o3-first-last-task'), {
  status: 'succeeded',
  resultUrl: 'https://cdn.example/kling-o3-first-last.mp4'
});
const proEditImages = [
  'https://cdn.example/ref-1.png',
  'https://cdn.example/ref-2.png',
  'https://cdn.example/ref-3.png',
  'https://cdn.example/ref-4.png'
];
assert.deepEqual(await createVideoTask({
  providerId: 'video-13',
  prompt: 'change the clothing using the reference images',
  resolution: '1080P',
  duration: 8,
  aspectRatio: 'adaptive',
  videoMode: 'video-edit',
  urls: ['https://cdn.example/source.mp4', ...proEditImages],
  referenceMediaTypes: ['video', 'image', 'image', 'image', 'image'],
  keepOriginalSound: false
}), { providerId: 'video-13', taskId: 'kling-o3-pro-edit-task' });
assert.equal(klingCalls.at(-1).url, 'https://api.302.ai/ws/api/v3/kwaivgi/kling-video-o3-pro/video-edit');
assert.deepEqual(JSON.parse(klingCalls.at(-1).options.body), {
  images: proEditImages,
  keep_original_sound: false,
  prompt: 'change the clothing using the reference images',
  video: 'https://cdn.example/source.mp4'
});
await assert.rejects(() => createVideoTask({
  providerId: 'video-13',
  prompt: 'too many references',
  resolution: '1080P',
  duration: 8,
  aspectRatio: 'adaptive',
  videoMode: 'video-edit',
  urls: ['https://cdn.example/source.mp4', ...proEditImages, 'https://cdn.example/ref-5.png'],
  referenceMediaTypes: ['video', 'image', 'image', 'image', 'image', 'image']
}), (error) => error && error.code === 'too-many-references');
assert.deepEqual(await pollVideoTask('video-13', 'kling-o3-pro-edit-task'), {
  status: 'succeeded',
  resultUrl: 'https://cdn.example/kling-o3-pro-edit.mp4'
});

process.stdout.write('gateway provider registry tests passed.\n');
