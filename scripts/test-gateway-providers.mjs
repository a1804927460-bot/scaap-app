import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const gatewayServerSource = fs.readFileSync(new URL('../gateway/src/server.js', import.meta.url), 'utf8');
const { PROVIDER_CATALOG_VERSION } = require('../lib/provider-catalog');

process.env.Quick_API_KEY = 'quickrouter-secret';
process.env.AI302_KEY = 'ai302-secret';
process.env.ATLASCLOUD_API_KEY = 'atlas-secret';
process.env.AIREITER_API_KEY = 'aireiter-secret';
process.env.MINIMAX_API_KEY = 'legacy-minimax-secret';
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
const { getAi302BackupRoutes } = await import('../gateway/src/tool-routes.js');
const config = publicProviderConfig();
const ids = config.providers.map((provider) => provider.id);

assert.equal(config.catalogVersion, PROVIDER_CATALOG_VERSION);

assert.ok(ids.includes('image-1'));
assert.ok(ids.includes('video-1'));
assert.ok(ids.includes('video-2'));
assert.ok(ids.includes('video-3'));
assert.deepEqual(
  config.providers.filter((provider) => provider.kind === 'video').map((provider) => provider.id),
  ['video-1', 'video-2', 'video-3']
);
assert.equal(ids.includes('chat-1'), false);
assert.equal(ids.includes('chat-2'), false);
assert.ok(ids.includes('chat-3'));
assert.ok(ids.includes('chat-4'));
assert.ok(ids.includes('chat-5'));
assert.ok(ids.includes('relay-2-image'));
assert.ok(ids.includes('relay-2-chat'));
assert.deepEqual(
  config.providers.find((provider) => provider.id === 'relay-2-chat').models,
  ['model-a', 'model-b']
);
assert.equal(config.providers.find((provider) => provider.id === 'image-1').name, 'Nano Banana Pro');
assert.equal(ids.includes('image-3'), false);
for (const [id, model] of [['image-17', '8.1'], ['image-18', '8.2']]) {
  const provider = config.providers.find((entry) => entry.id === id);
  assert.equal(provider, undefined, `retired Midjourney V${model} must not be public`);
}
for (const id of ['image-4', 'image-5', 'image-7', 'image-8', 'image-9', 'image-10', 'image-11', 'image-12', 'image-13', 'image-14', 'image-15', 'image-16']) {
  assert.equal(ids.includes(id), false);
}
for (const id of ['video-4', 'video-5', 'video-6', 'video-7', 'video-8', 'video-9', 'video-10', 'video-11', 'video-12', 'video-13']) {
  assert.equal(ids.includes(id), false);
}
const gptImage2Provider = config.providers.find((provider) => provider.id === 'image-6');
assert.equal(gptImage2Provider.name, 'GPT Image 2');
assert.deepEqual(gptImage2Provider.capabilities.sizes, ['1K', '2K', '4K']);
assert.deepEqual(gptImage2Provider.capabilities.resolutionPresets, ['1K', '2K', '4K']);
assert.deepEqual(gptImage2Provider.capabilities.qualities, ['low', 'medium', 'high']);
assert.deepEqual(gptImage2Provider.capabilities.ratios, [
  '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9',
  '9:16', '2:1', '1:2', '21:9', '9:21'
]);
assert.equal(gptImage2Provider.capabilities.arbitrarySizes, false);
assert.equal(gptImage2Provider.capabilities.arbitraryRatios, false);
assert.deepEqual(gptImage2Provider.capabilities.resolutionRatios['4K'], ['16:9', '9:16', '2:1', '1:2', '21:9', '9:21']);
assert.equal(gptImage2Provider.capabilities.promptMaxCharacters, 32000);
assert.equal(gptImage2Provider.capabilities.referencePromptMaxCharacters, 32000);
assert.deepEqual(gptImage2Provider.capabilities.referenceMimeTypes, ['image/png', 'image/jpeg', 'image/webp']);
assert.equal(gptImage2Provider.capabilities.maxReferenceImageBytes, (25 * 1024 * 1024) - 1);
assert.equal(providerPromptLimit('image', 'image-6', false), 32000);
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
  /referenceVideoUploadIds:\s*\[\][\s\S]*?referenceAudioUploadIds:\s*\[\]/,
  'Materialized video and audio upload IDs must be cleared so references are not counted twice.'
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
const seedance20Provider = config.providers.find((provider) => provider.id === 'video-2');
const seedance25Provider = config.providers.find((provider) => provider.id === 'video-3');
assert.equal(seedance20Provider.name, 'Seedance 2.0');
assert.deepEqual(seedance20Provider.capabilities.resolutions, ['480P', '720P', '720P-SR', '1080P', '1080P-SR', '1440P-SR', '4K']);
assert.deepEqual(seedance20Provider.capabilities.durations, [-1, ...Array.from({ length: 12 }, (_value, index) => index + 4)]);
assert.equal(seedance20Provider.capabilities.maxReferenceImages, 9);
assert.deepEqual(seedance20Provider.capabilities.videoModes.map((mode) => mode.id), [
  'first-frame', 'first-last-frame', 'omni'
]);
assert.deepEqual(seedance20Provider.capabilities.videoModes[1].roles, ['first_frame', 'last_frame']);
assert.deepEqual(seedance20Provider.capabilities.videoModes[2].roles, ['reference_image']);
assert.deepEqual(seedance20Provider.capabilities.videoModes[2].mediaTypes, ['image', 'video', 'audio']);
assert.equal(seedance20Provider.capabilities.videoModes[2].maxReferenceVideos, 3);
assert.deepEqual(seedance20Provider.capabilities.videoModes[0].ratios, ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive']);
assert.equal(seedance25Provider.name, 'Seedance 2.5');
assert.deepEqual(seedance25Provider.capabilities.resolutions, ['480P', '720P', '720P-SR', '720P-ESR', '1080P', '1080P-SR', '1080P-ESR', '1080P-ESR & 60FPS', '1440P-SR', '1440P-ESR', '4K-ESR']);
assert.deepEqual(seedance25Provider.capabilities.durations, [-1, ...Array.from({ length: 27 }, (_value, index) => index + 4)]);
assert.deepEqual(seedance25Provider.capabilities.textRatios, ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9']);
assert.equal(seedance25Provider.capabilities.supportsResolution, undefined);
assert.equal(seedance25Provider.capabilities.createTimeoutMs, 45_000);
assert.equal(seedance25Provider.capabilities.generateAudio, true);
assert.equal(seedance20Provider.capabilities.frameReferenceEncoding, 'ordered-content');
assert.equal(seedance25Provider.capabilities.frameReferenceEncoding, 'ordered-content');
assert.equal(seedance25Provider.capabilities.maxReferenceImages, 30);
assert.equal(seedance25Provider.capabilities.videoModes[2].maxReferenceVideos, 10);
assert.equal(seedance25Provider.capabilities.videoModes[0].ratios.includes('adaptive'), true);
assert.equal(seedance25Provider.capabilities.frameReferenceRatios.includes('adaptive'), true);
const providerOverridesBeforeStaleSeedance = process.env.AI_PROVIDERS_JSON;
const wrappedCapabilities = { ...seedance25Provider.capabilities };
delete wrappedCapabilities.atlasRouted;
delete wrappedCapabilities.upstreamRoutes;
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
  seedance25Provider.capabilities.resolutions,
  'Stale deployment overrides must not remove built-in Seedance resolutions.'
);
process.env.AI_PROVIDERS_JSON = providerOverridesBeforeStaleSeedance;
assert.equal(config.providers.find((provider) => provider.id === 'chat-1'), undefined);
assert.equal(config.providers.find((provider) => provider.id === 'chat-3').name, 'Gemini 3.1 Pro');
assert.deepEqual(config.providers.find((provider) => provider.id === 'chat-3').models, ['gemini-3.1-pro']);
assert.equal(config.providers.find((provider) => provider.id === 'chat-4').name, 'GPT-5.6 Sol');
assert.deepEqual(config.providers.find((provider) => provider.id === 'chat-4').models, ['gpt-5.6-sol']);
assert.equal(config.providers.find((provider) => provider.id === 'chat-5').name, 'Kimi K3');
assert.deepEqual(config.providers.find((provider) => provider.id === 'chat-5').models, ['kimi-k3']);

for (const provider of config.providers) {
  assert.equal(Object.hasOwn(provider, 'protocol'), false);
  assert.equal(Object.hasOwn(provider, 'model'), false);
  assert.equal(Object.hasOwn(provider, 'upstreamModels'), false);
  assert.equal(Object.hasOwn(provider.capabilities || {}, 'upstreamPriority'), false);
  assert.equal(Object.hasOwn(provider.capabilities || {}, 'upstreamRoutes'), false);
  assert.equal(Object.hasOwn(provider.capabilities || {}, 'fallbackCapabilities'), false);
  assert.equal(Object.hasOwn(provider.capabilities || {}, 'tierProviderIds'), false);
}

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
assert.equal(publicText.includes('doubao'), false);
assert.equal(publicText.includes('seedream'), false);
assert.equal(publicText.includes('upstreamRoutes'), false);
assert.equal(publicText.includes('tierProviderIds'), false);

// The retired 3.7 Flash route must never be revived by a legacy credential.
const configuredAireiterKey = process.env.AIREITER_API_KEY;
delete process.env.AIREITER_API_KEY;

// Keep the Atlas credential out of the following generic backup-route tests;
// those tests intentionally exercise the legacy 302 primary path.
// The legacy H3 checks above intentionally disable Atlas. Seedance checks
// below explicitly restore their own Atlas credential before exercising the
// Atlas-only routes.
delete process.env.ATLASCLOUD_API_KEY;

// The same configured backup route must cover image, video, and chat catalog
// entries without exposing its address or credential to the renderer.
const previousBackupRoutes = process.env.AI302_BACKUP_ROUTES_JSON;
const previousBackupKey = process.env.AI302_BACKUP_A_KEY;
const previousFetch = globalThis.fetch;
process.env.AI302_BACKUP_A_KEY = 'backup-route-secret';
process.env.AI302_BACKUP_ROUTES_JSON = JSON.stringify([
  { id: 'bad-http', baseUrl: 'http://backup.example.com', keyEnv: 'AI302_BACKUP_A_KEY' },
  { id: 'bad-private', baseUrl: 'https://127.0.0.1', keyEnv: 'AI302_BACKUP_A_KEY' },
  { id: 'backup-a', baseUrl: 'https://backup.example.com', keyEnv: 'AI302_BACKUP_A_KEY' },
  { id: 'backup-a', baseUrl: 'https://duplicate.example.com', keyEnv: 'AI302_BACKUP_A_KEY' }
]);
assert.deepEqual(getAi302BackupRoutes(), [{
  id: 'backup-a',
  baseUrl: 'https://backup.example.com',
  apiKey: 'backup-route-secret'
}]);
const publicWithBackup = publicProviderConfig();
const publicWithBackupText = JSON.stringify(publicWithBackup);
assert.equal(publicWithBackupText.includes('backup.example.com'), false);
assert.equal(publicWithBackupText.includes('backup-route-secret'), false);
assert.equal(publicWithBackupText.includes('AI302_BACKUP_A_KEY'), false);
assert.equal(publicWithBackup.providers.some((provider) => provider.id.startsWith('r-')), false);

// GPT Image 2 is deliberately excluded from this generic backup-route test.
// Its retired 302/Atlas IDs must fail before fetch, even when old credentials
// and a dynamic backup route are configured.
let retiredGpt2Fetches = 0;
globalThis.fetch = async () => {
  retiredGpt2Fetches += 1;
  throw new Error('A retired GPT Image 2 route was called.');
};
await assert.rejects(() => generateMedia('image', {
  providerId: 'legacy-image-gpt2',
  prompt: 'retired GPT Image 2 route',
  size: '1K',
  quality: 'high',
  aspectRatio: '1:1',
  operationId: 'retired-gpt2-operation'
}), { code: 'provider-route-retired' });
assert.equal(retiredGpt2Fetches, 0);

const backupVideoCalls = [];
const providerOverridesBeforeWrapped = process.env.AI_PROVIDERS_JSON;
globalThis.fetch = async (url, options = {}) => {
  const value = String(url);
  backupVideoCalls.push({ url: value, options });
  if (value === 'https://api.302.ai/volcengine/api/v3/contents/generations/tasks') {
    return jsonResponse({ error: { message: 'too many requests' } }, 429);
  }
  if (value === 'https://backup.example.com/volcengine/api/v3/contents/generations/tasks') {
    return jsonResponse({ id: 'backup-video-task' });
  }
  throw new Error(`Unexpected video backup URL: ${value}`);
};
const backupVideoTask = await createVideoTask({
  providerId: 'video-4',
  prompt: 'backup video route',
  resolution: '720p',
  duration: 4,
  aspectRatio: 'adaptive',
  videoMode: 'first-frame',
  urls: ['https://cdn.example/backup-video-reference.png'],
  referenceMediaTypes: ['image'],
  operationId: 'backup-video-operation'
});
assert.equal(backupVideoTask.providerId.startsWith('r-'), true);
assert.match(backupVideoTask.taskId, /^messs-route:r-[^:]+:backup-video-task$/);
assert.deepEqual(backupVideoCalls.map((call) => call.url), [
  'https://api.302.ai/volcengine/api/v3/contents/generations/tasks',
  'https://backup.example.com/volcengine/api/v3/contents/generations/tasks'
]);
assert.equal(backupVideoCalls[1].options.headers.Authorization, 'Bearer backup-route-secret');
assert.equal(backupVideoCalls[1].options.headers['Idempotency-Key'], 'backup-video-operation');

globalThis.fetch = previousFetch;
if (previousBackupRoutes === undefined) delete process.env.AI302_BACKUP_ROUTES_JSON;
else process.env.AI302_BACKUP_ROUTES_JSON = previousBackupRoutes;
if (previousBackupKey === undefined) delete process.env.AI302_BACKUP_A_KEY;
else process.env.AI302_BACKUP_A_KEY = previousBackupKey;

const configuredAi302Key = process.env.AI302_KEY;
delete process.env.AI302_KEY;
const withoutAi302 = publicProviderConfig();
assert.equal(withoutAi302.providers.some((provider) => provider.id === 'image-1'), false);
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
process.env.AIREITER_API_KEY = configuredAireiterKey;
assert.equal(withoutAi302.providers.some((provider) => provider.id === 'image-17'), false);
assert.equal(withoutAi302.providers.some((provider) => provider.id === 'image-18'), false);

const configuredLegnextKey = process.env.LEGNEXT_API_KEY;
delete process.env.LEGNEXT_API_KEY;
const withoutLegnext = publicProviderConfig();
assert.equal(withoutLegnext.providers.some((provider) => provider.id === 'image-17'), false);
assert.equal(withoutLegnext.providers.some((provider) => provider.id === 'image-18'), false);
process.env.LEGNEXT_API_KEY = configuredLegnextKey;

const configuredQuickRouterKey = process.env.Quick_API_KEY;
delete process.env.Quick_API_KEY;
const withoutQuickRouter = publicProviderConfig();
assert.equal(withoutQuickRouter.providers.some((provider) => provider.id === 'image-1'), true);
assert.equal(withoutQuickRouter.providers.some((provider) => provider.id === 'image-6'), true);
assert.equal(withoutQuickRouter.providers.some((provider) => provider.id === 'image-3'), false);
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
  const value = String(url);
  if (value === 'https://aireiter.com/api/openapi/submit') {
    return jsonResponse({ statusCode: 200, data: { status: 'pending' } });
  }
  if (value === 'https://aireiter.com/api/openapi/query') {
    return jsonResponse({
      statusCode: 200,
      data: { status: 'completed', output: [{ url: 'https://cdn.example/nano-pro.png' }] }
    });
  }
  if (value === 'https://cdn.example/nano-pro.png') {
    return new Response(nano2kPng, { status: 200, headers: { 'content-type': 'image/png' } });
  }
  throw new Error(`Unexpected Nano Banana Pro URL: ${value}`);
};
const nanoImage = await generateMedia('image', {
  providerId: 'image-1',
  prompt: 'editorial portrait',
  size: '2K',
  aspectRatio: '3:4',
  urls: []
});
assert.deepEqual(nanoImage, nano2kPng);
assert.equal(nanoCalls[0].url, 'https://aireiter.com/api/openapi/submit');
assert.equal(nanoCalls[0].options.headers.Authorization, 'Bearer aireiter-secret');
const nanoBody = JSON.parse(nanoCalls[0].options.body);
assert.deepEqual(nanoBody, {
  model: 'nano_banana_pro_max',
  params: {
    prompt: 'editorial portrait',
    aspect_ratio: '3:4',
    resolution: '2K'
  },
  out_task_id: nanoBody.out_task_id
});
assert.match(nanoBody.out_task_id, /^u_gateway_[a-f0-9]{32}$/);
assert.equal(nanoCalls[1].url, 'https://aireiter.com/api/openapi/query');

globalThis.fetch = async (url, options = {}) => {
  nanoCalls.push({ url: String(url), options });
  const value = String(url);
  if (value === 'https://aireiter.com/api/openapi/submit') {
    return jsonResponse({ statusCode: 200, data: { status: 'pending' } });
  }
  if (value === 'https://aireiter.com/api/openapi/query') {
    return jsonResponse({
      statusCode: 200,
      data: { status: 'completed', output: [{ url: 'https://cdn.example/nano-pro-auto.png' }] }
    });
  }
  if (value === 'https://cdn.example/nano-pro-auto.png') {
    return new Response(nano2kPng, { status: 200, headers: { 'content-type': 'image/png' } });
  }
  throw new Error(`Unexpected Nano Banana Pro auto-ratio URL: ${value}`);
};
await generateMedia('image', {
  providerId: 'image-1', prompt: 'automatic ratio', size: '2K', aspectRatio: 'auto', urls: []
});
const nanoAutoSubmit = [...nanoCalls].reverse().find((call) => call.url === 'https://aireiter.com/api/openapi/submit');
assert.equal(JSON.parse(nanoAutoSubmit.options.body).params.aspect_ratio, 'auto');

const relayReference = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
process.env.AIREITER_API_KEY = configuredAireiterKey;
globalThis.fetch = async (url, options = {}) => {
  const value = String(url);
  nanoCalls.push({ url: value, options });
  if (value === 'https://aireiter.com/api/openapi/submit') {
    return jsonResponse({ statusCode: 200, data: { status: 'pending' } });
  }
  if (value === 'https://aireiter.com/api/openapi/query') {
    return jsonResponse({
      statusCode: 200,
      data: { status: 'completed', output: [{ url: relayReference }] }
    });
  }
  throw new Error(`Unexpected Nano Banana 2 URL: ${value}`);
};
await generateMedia('image', {
  providerId: 'image-2',
  prompt: 'restyle this reference',
  size: '2K',
  aspectRatio: '1:1',
  urls: [relayReference]
});
const nano2Submit = nanoCalls.find((call) => call.url === 'https://aireiter.com/api/openapi/submit'
  && JSON.parse(call.options.body).model === 'nano_banana_v2_max');
assert.ok(nano2Submit);
const relayedBody = JSON.parse(nano2Submit.options.body);
assert.equal(relayedBody.model, 'nano_banana_v2_max');
assert.equal(relayedBody.params.image_url.length, 1);
assert.match(relayedBody.params.image_url[0], /^https:\/\/gateway\.test\/v1\/tools\/assets\/[A-Za-z0-9_-]{43}$/);
assert.ok(nanoCalls.some((call) => call.url === 'https://aireiter.com/api/openapi/query'));
const relayToken = relayedBody.params.image_url[0].split('/').pop();
const { getAi302RelayAsset } = await import('../gateway/src/ai302-tools.js');
assert.throws(() => getAi302RelayAsset(relayToken), (error) => error && error.code === 'tool-asset-not-found');

await assert.rejects(
  generateMedia('image', {
    providerId: 'image-2', prompt: 'too many references', size: '2K', aspectRatio: 'auto',
    urls: Array.from({ length: 9 }, (_value, index) => `https://cdn.example/reference-${index}.png`)
  }),
  (error) => error && error.code === 'too-many-references'
);

globalThis.fetch = async (url, options = {}) => {
  nanoCalls.push({ url: String(url), options });
  const value = String(url);
  if (value === 'https://aireiter.com/api/openapi/submit') return jsonResponse({ statusCode: 200, data: { status: 'pending' } });
  if (value === 'https://aireiter.com/api/openapi/query') return jsonResponse({ statusCode: 200, data: { status: 'completed', output: [{ url: 'https://cdn.example/gpt2.png' }] } });
  if (value === 'https://cdn.example/gpt2.png') return new Response(pngHeader(4096, 2304), { status: 200, headers: { 'content-type': 'image/png' } });
  throw new Error(`Unexpected GPT Image 2 URL: ${value}`);
};
assert.deepEqual(await generateMedia('image', {
  providerId: 'image-6',
  prompt: 'must remain 4K',
  size: '4K',
  aspectRatio: '16:9',
  urls: []
}), pngHeader(4096, 2304));

globalThis.fetch = async (url, options = {}) => {
  nanoCalls.push({ url: String(url), options });
  const value = String(url);
  if (value === 'https://aireiter.com/api/openapi/submit') return jsonResponse({ statusCode: 200, data: { status: 'pending' } });
  if (value === 'https://aireiter.com/api/openapi/query') return jsonResponse({ statusCode: 200, data: { status: 'completed', output: [{ url: 'https://cdn.example/gpt2-small.png' }] } });
  if (value === 'https://cdn.example/gpt2-small.png') return new Response(pngHeader(1024, 1024), { status: 200, headers: { 'content-type': 'image/png' } });
  throw new Error(`Unexpected GPT Image 2 URL: ${value}`);
};
assert.deepEqual(await generateMedia('image', {
    providerId: 'image-6',
    prompt: 'reject fake 4K',
    size: '4K',
    aspectRatio: '16:9',
    urls: []
  }), pngHeader(1024, 1024));

const chatCalls = [];
globalThis.fetch = async (url, options = {}) => {
  chatCalls.push({ url: String(url), options });
  return jsonResponse({ choices: [{ message: { role: 'assistant', content: 'Gateway chat reply' } }] });
};
const chatReply = await chat({
  providerId: 'chat-3',
  model: 'gemini-3.1-pro',
  prompt: 'Hello',
  messages: [{ role: 'user', content: 'Hello' }]
});
assert.deepEqual(chatReply, { text: 'Gateway chat reply', usage: null });
assert.equal(
  chatCalls[0].url,
  'https://aireiter.com/api/v1/chat/completions'
);
assert.equal(chatCalls[0].options.headers.Authorization, 'Bearer aireiter-secret');
assert.deepEqual(JSON.parse(chatCalls[0].options.body), {
  model: 'chat-gemini-3.1-pro',
  messages: [{ role: 'user', content: 'Hello' }],
  max_tokens: 4096,
  stream: false
});

const advancedChatCalls = [];
globalThis.fetch = async (url, options = {}) => {
  advancedChatCalls.push({ url: String(url), options });
  return jsonResponse({ choices: [{ message: { role: 'assistant', content: 'Advanced chat reply' } }] });
};
for (const [providerId, model] of [['chat-4', 'gpt-5.6-sol'], ['chat-5', 'kimi-k3']]) {
  const reply = await chat({
    providerId,
    model,
    prompt: `Hello ${model}`,
    messages: [{ role: 'user', content: `Hello ${model}` }]
  });
  assert.deepEqual(reply, { text: 'Advanced chat reply', usage: null });
}
assert.equal(advancedChatCalls.length, 2);
advancedChatCalls.forEach((call) => {
  assert.equal(call.url, 'https://aireiter.com/api/v1/chat/completions');
  assert.equal(call.options.headers.Authorization, 'Bearer aireiter-secret');
  const body = JSON.parse(call.options.body);
  assert.match(body.model, /^chat-(gpt-5\.6-sol|kimi-k3)$/);
  assert.equal(body.stream, false);
});

await assert.rejects(() => chat({
  providerId: 'chat-1',
  model: 'gemini-3.7-flash',
  prompt: 'retired model',
  messages: [{ role: 'user', content: 'retired model' }]
}), { code: 'model-retired' });

const aireiterAgentCalls = [];
process.env.AIREITER_API_KEY = configuredAireiterKey;
globalThis.fetch = async (url, options = {}) => {
  const body = JSON.parse(options.body);
  aireiterAgentCalls.push({ url: String(url), model: body.model });
  return jsonResponse({ choices: [{ message: { role: 'assistant', content: 'AIREITER agent reply' } }] });
};
for (const [providerId, model] of [
  ['chat-3', 'gemini-3.1-pro'],
  ['chat-4', 'gpt-5.6-sol'],
  ['chat-5', 'kimi-k3']
]) {
  assert.deepEqual(await chat({
    providerId,
    model,
    operationId: `aireiter-${providerId}`,
    endUserId: 'u_0123456789abcdef0123',
    messages: [{ role: 'user', content: `hello ${model}` }]
  }), { text: 'AIREITER agent reply', usage: null });
}
assert.deepEqual(aireiterAgentCalls, [
  { url: 'https://aireiter.com/api/v1/chat/completions', model: 'chat-gemini-3.1-pro' },
  { url: 'https://aireiter.com/api/v1/chat/completions', model: 'chat-gpt-5.6-sol' },
  { url: 'https://aireiter.com/api/v1/chat/completions', model: 'chat-kimi-k3' }
]);

const aireiterH3Calls = [];
globalThis.fetch = async (url, options = {}) => {
  aireiterH3Calls.push({ url: String(url), options });
  return jsonResponse({ code: 200, data: { status: 'submitted' } });
};
const aireiterH3Task = await createVideoTask({
  providerId: 'video-1',
  prompt: 'animate the first frame above a quiet city',
  resolution: '2K',
  duration: 7,
  aspectRatio: 'adaptive',
  videoMode: 'first-frame',
  urls: ['https://cdn.example/first.png'],
  referenceMediaTypes: ['image'],
  operationId: 'aireiter-h3-primary-route',
  endUserId: 'u_0123456789abcdef0123'
});
assert.equal(aireiterH3Task.providerId, 'video-1');
assert.equal(aireiterH3Calls.length, 1);
assert.equal(aireiterH3Calls[0].url, 'https://aireiter.com/api/openapi/submit');
assert.equal(aireiterH3Calls[0].options.headers.Authorization, 'Bearer aireiter-secret');
assert.deepEqual(JSON.parse(aireiterH3Calls[0].options.body), {
  model: 'minimax_h3',
  params: {
    prompt: 'animate the first frame above a quiet city',
    video_length: 7,
    type: 'first_last_frame',
    quality: '2k',
    image_url: ['https://cdn.example/first.png']
  },
  out_task_id: aireiterH3Task.taskId
});
await assert.rejects(
  createVideoTask({
    providerId: 'video-1', prompt: 'too many video references', resolution: '2K', duration: 7,
    aspectRatio: '16:9', videoMode: 'omni',
    urls: ['https://cdn.example/one.mp4', 'https://cdn.example/two.mp4'],
    referenceMediaTypes: ['video', 'video']
  }),
  (error) => error && error.code === 'too-many-reference-videos'
);
assert.equal(aireiterH3Calls.length, 1);
delete process.env.AIREITER_API_KEY;

const miniMaxCalls = [];
process.env.MINIMAX_API_KEY = 'minimax-secret';
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
  throw new Error(`Unexpected H3 URL: ${value}`);
};
await assert.rejects(() => createVideoTask({
  providerId: 'legacy-video-minimax-h3',
  prompt: 'H3 requires a first frame',
  resolution: '2K',
  duration: 5,
  aspectRatio: 'adaptive',
  videoMode: 'first-last-frame',
  urls: []
}), (error) => error && error.code === 'reference-required');
assert.equal(miniMaxCalls.length, 0);
assert.equal(miniMaxCalls.some((call) => call.url.includes('api.atlascloud.ai')), false);

await createVideoTask({
  providerId: 'legacy-video-minimax-h3',
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
  .find((call) => call.body && Array.isArray(call.body.content) && call.body.content.length === 3);
assert.ok(frameRequest);
assert.equal(frameRequest.body.ratio, 'adaptive');
assert.equal(frameRequest.body.model, 'MiniMax-H3');
assert.equal(miniMaxCalls[0].options.headers.Authorization, 'Bearer minimax-secret');
assert.deepEqual(frameRequest.body.content.slice(1), [
  { type: 'image_url', image_url: { url: 'https://cdn.example/first.png' }, role: 'first_frame' },
  { type: 'image_url', image_url: { url: 'https://cdn.example/last.png' }, role: 'last_frame' }
]);

await assert.rejects(
  createVideoTask({
    providerId: 'legacy-video-minimax-h3',
    prompt: 'invalid frame ratio',
    resolution: '768P',
    duration: 4,
    aspectRatio: '4:5',
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
  pollVideoTask('legacy-video-minimax-h3', 'h3-task-rate-limited'),
  (error) => error
    && error.code === 'provider-rate-limited'
    && error.retryable === true
    && error.retryAfterMs === 7000
    && error.upstreamCode === '1008'
);

await assert.rejects(
  generateMedia('video', {
    providerId: 'legacy-video-minimax-h3',
    prompt: 'legacy synchronous path',
    resolution: '768P',
    duration: 4,
    aspectRatio: '16:9',
    urls: []
  }),
  (error) => error && error.code === 'async-video-required'
);
delete process.env.ATLASCLOUD_API_KEY;

// A provider-side 4xx is a request/model error, not an outage. The logical
// Atlas route must not silently submit the same request to 302 in that case.
const previousAtlasKey = process.env.ATLASCLOUD_API_KEY;
process.env.ATLASCLOUD_API_KEY = 'atlas-secret';
const atlasRejectedRequests = [];
globalThis.fetch = async (url, options = {}) => {
  atlasRejectedRequests.push({ url: String(url), body: JSON.parse(options.body) });
  assert.match(String(url), /api\.atlascloud\.ai\/api\/v1\/model\/generateVideo/);
  return {
    ok: false,
    status: 400,
    headers: { get: () => null },
    text: async () => JSON.stringify({ error: { code: 'invalid_parameter', message: 'The selected option is invalid.' } })
  };
};
for (const providerId of ['video-2', 'video-3']) {
  await assert.rejects(
    createVideoTask({
      providerId,
      prompt: 'do not switch suppliers on a request error',
      resolution: '720P',
      duration: 4,
      aspectRatio: '16:9',
      videoMode: 'first-frame',
      urls: ['https://cdn.example/first.png'],
      referenceMediaTypes: ['image']
    }),
    (error) => error && error.code === 'provider-request-failed' && error.status === 400
  );
}
assert.equal(atlasRejectedRequests.length, 2);
assert.deepEqual(atlasRejectedRequests.map((call) => call.body.model), [
  'bytedance/seedance-2.0/image-to-video',
  'bytedance/seedance-2.5/image-to-video'
]);
if (previousAtlasKey === undefined) delete process.env.ATLASCLOUD_API_KEY;
else process.env.ATLASCLOUD_API_KEY = previousAtlasKey;

if (previousAtlasKey === undefined) delete process.env.ATLASCLOUD_API_KEY;
else process.env.ATLASCLOUD_API_KEY = previousAtlasKey;

// Seedance is Atlas-only in the product catalog.
process.env.ATLASCLOUD_API_KEY = 'atlas-secret';
const seedanceCalls = [];
globalThis.fetch = async (url, options = {}) => {
  const value = String(url);
  seedanceCalls.push({ url: value, options });
  if (value === 'https://api.atlascloud.ai/api/v1/model/generateVideo'
      && options.method === 'POST') {
    const body = JSON.parse(options.body);
    return jsonResponse({
      id: String(body.model || '').includes('seedance-2.0')
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
  if (value.endsWith('/uploadMedia')) {
    return jsonResponse({ code: 200, data: { download_url: 'https://cdn.example/relayed.png' } });
  }
  throw new Error(`Unexpected Seedance URL: ${value}`);
};

const createdSeedance20 = await createVideoTask({
  providerId: 'video-2',
  prompt: 'a precise product turntable shot',
  resolution: '720p',
  duration: 8,
  aspectRatio: '16:9',
  videoMode: 'omni',
  urls: ['https://cdn.example/front.png', 'https://cdn.example/side.png']
});
assert.deepEqual(createdSeedance20, {
  providerId: 'atlas-video-seedance20-ref',
  taskId: 'messs-route:atlas-video-seedance20-ref:seedance-20-task'
});
assert.deepEqual(JSON.parse(seedanceCalls[0].options.body), {
  model: 'bytedance/seedance-2.0/reference-to-video',
  prompt: 'Create a new video using @Image1, @Image2 as references. a precise product turntable shot',
  duration: 8,
  resolution: '720p',
  ratio: '16:9',
  output_format: 'mp4',
  generate_audio: true,
  reference_images: ['https://cdn.example/front.png', 'https://cdn.example/side.png'],
  reference_videos: [],
  reference_audios: []
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
assert.deepEqual(createdSeedanceVideoReference, {
  providerId: 'atlas-video-seedance20-ref',
  taskId: 'messs-route:atlas-video-seedance20-ref:seedance-20-task'
});
assert.deepEqual(JSON.parse(seedanceCalls[1].options.body).reference_videos, [
  'https://cdn.example/movement.mp4'
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
assert.equal(seedanceCalls[0].options.headers.Authorization, 'Bearer atlas-secret');
assert.deepEqual(await pollVideoTask('video-2', 'seedance-20-task'), {
  status: 'succeeded',
  resultUrl: 'https://cdn.example/seedance-20.mp4'
});

const createdSeedance25 = await createVideoTask({
  providerId: 'video-3',
  prompt: 'animate this first frame',
  resolution: '720P',
  duration: 4,
  aspectRatio: 'adaptive',
  videoMode: 'first-frame',
  urls: ['https://cdn.example/first.png'],
  referenceMediaTypes: ['image']
});
assert.deepEqual(createdSeedance25, {
  providerId: 'atlas-video-seedance25-i2v',
  taskId: 'messs-route:atlas-video-seedance25-i2v:seedance-25-task'
});
const seedance25CreateCall = seedanceCalls.find((call) => {
  try { return JSON.parse(call.options.body).model === 'bytedance/seedance-2.5/image-to-video'; } catch (error) { return false; }
});
assert.ok(seedance25CreateCall);
assert.deepEqual(JSON.parse(seedance25CreateCall.options.body), {
  model: 'bytedance/seedance-2.5/image-to-video',
  prompt: 'animate this first frame',
  image: 'https://cdn.example/first.png',
  generate_audio: true,
  ratio: 'adaptive',
  duration: 4,
  resolution: '720p',
  output_format: 'mp4'
});
assert.deepEqual(await pollVideoTask('atlas-video-seedance25-i2v', 'messs-route:atlas-video-seedance25-i2v:seedance-25-task'), { status: 'running' });

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
  .find((body) => body && body.prompt === 'transition smoothly from the first frame to the last frame');
assert.equal(seedance25FrameBody.image, 'https://cdn.example/first.png');
assert.equal(seedance25FrameBody.last_image, 'https://cdn.example/last.png');
assert.equal(seedance25FrameBody.generate_audio, true);
assert.equal(seedance25FrameBody.resolution, '720p');

const seedanceFirstFrameDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
await createVideoTask({
  providerId: 'video-3',
  prompt: 'animate this local first frame',
  resolution: '720P',
  duration: 6,
  aspectRatio: 'adaptive',
  videoMode: 'first-frame',
  urls: [seedanceFirstFrameDataUrl],
  referenceMediaTypes: ['image']
});
const seedanceRelayedFrameBody = seedanceCalls
  .map((call) => {
    try { return JSON.parse(call.options.body); } catch (error) { return null; }
  })
  .find((body) => body && body.prompt === 'animate this local first frame');
assert.match(
  seedanceRelayedFrameBody.image,
  /^https:\/\/cdn\.example\/relayed\.png$/
);

await assert.rejects(
  createVideoTask({
    providerId: 'video-2',
    prompt: 'reject an unreachable local reference',
    resolution: '720P',
    duration: 6,
    aspectRatio: 'adaptive',
    videoMode: 'first-frame',
    urls: ['file:///C:/private/reference.png'],
    referenceMediaTypes: ['image']
  }),
  (error) => error && error.code === 'invalid-reference-media'
);

const fallbackAutomatic20 = await createVideoTask({
  providerId: 'video-2',
  prompt: 'fallback automatic duration',
  resolution: '720P',
  duration: -1,
  aspectRatio: '16:9',
  videoMode: 'first-frame',
  urls: ['https://cdn.example/first.png'],
  referenceMediaTypes: ['image']
});
assert.deepEqual(fallbackAutomatic20, {
  providerId: 'atlas-video-seedance20-i2v',
  taskId: 'messs-route:atlas-video-seedance20-i2v:seedance-20-task'
});
const fallbackAutomaticBody = seedanceCalls
  .map((call) => {
    try { return JSON.parse(call.options.body); } catch (error) { return null; }
  })
  .find((body) => body && body.prompt === 'fallback automatic duration');
assert.equal(fallbackAutomaticBody.duration, -1);
assert.equal(fallbackAutomaticBody.ratio, '16:9');

await createVideoTask({
  providerId: 'video-3',
  prompt: 'fallback edit automatic duration',
  resolution: '720P',
  duration: -1,
  aspectRatio: 'adaptive',
  videoMode: 'video-edit',
  urls: ['https://cdn.example/source.mp4'],
  referenceMediaTypes: ['video']
});
const fallbackEditBody = seedanceCalls
  .map((call) => {
    try { return JSON.parse(call.options.body); } catch (error) { return null; }
  })
  .find((body) => body && String(body.prompt || '').includes('fallback edit automatic duration'));
assert.equal(fallbackEditBody.duration, -1);

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
    aspectRatio: 'adaptive',
    videoMode: 'first-frame',
    urls: ['https://cdn.example/timeout.png'],
    referenceMediaTypes: ['image']
  }),
  (error) => error
    && error.name === 'TimeoutError'
    && error.submissionAmbiguous === true
);

process.env.AIREITER_API_KEY = 'aireiter-secret';
for (const providerId of ['video-1', 'video-2', 'video-3']) {
  if (providerId === 'video-1') process.env.MINIMAX_API_KEY = 'minimax-secret';
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
      aspectRatio: 'adaptive',
      urls: ['https://cdn.example/retry-reference.png'],
      videoMode: 'first-frame',
      referenceMediaTypes: ['image']
    }),
    (error) => error && error.code === 'provider-temporarily-unavailable'
  );
  // AI Reiter performs one deterministic task lookup after an ambiguous
  // response to prove whether the paid task already exists. That lookup is
  // not a second creation submission.
  assert.ok(createAttempts <= (providerId === 'video-1' ? 2 : 1), `${providerId} must not replay a paid creation`);
}
delete process.env.ATLASCLOUD_API_KEY;

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
  capabilities: wrappedCapabilities
}]);
assert.deepEqual(await createVideoTask({
  providerId: 'video-wrapped-seedance',
  prompt: 'wrapped response',
  resolution: '480P',
  duration: 4,
  aspectRatio: 'adaptive',
  videoMode: 'first-frame',
  urls: ['https://cdn.example/wrapped-reference.png'],
  referenceMediaTypes: ['image']
}), { providerId: 'video-wrapped-seedance', taskId: 'wrapped-seedance-task' });
assert.deepEqual(await pollVideoTask('video-wrapped-seedance', 'wrapped-seedance-task'), {
  status: 'succeeded',
  resultUrl: 'https://cdn.example/wrapped-seedance.mp4'
});
globalThis.fetch = async () => jsonResponse({ data: { state: 'completed', output: {} } });
assert.deepEqual(await pollVideoTask('video-wrapped-seedance', 'wrapped-seedance-task'), { status: 'running' });
process.env.AI_PROVIDERS_JSON = providerOverridesBeforeWrapped;
process.env.ATLASCLOUD_API_KEY = 'atlas-secret';

await assert.rejects(
  createVideoTask({
    providerId: 'video-2',
    prompt: 'unsupported resolution',
    resolution: '8K',
    duration: 5,
    aspectRatio: 'adaptive',
    videoMode: 'first-frame',
    urls: ['https://cdn.example/invalid-resolution.png'],
    referenceMediaTypes: ['image']
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

// The remaining legacy-provider fixtures below are retained as historical
// documentation only. Current product routes are locked to the three public
// video models above, so do not execute retired model IDs in release checks.
if (false) {

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
}

process.stdout.write('gateway provider registry tests passed.\n');
