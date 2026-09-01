'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  PROVIDER_CATALOG_VERSION,
  canonicalProviderCapabilities
} = require('../lib/provider-catalog');
const { upgradeAiDefaults } = require('../lib/store');
const {
  normalizeGatewayCatalog,
  assertGatewayProvider
} = require('../lib/gateway-catalog');

const data = {
  settings: {
    aiMedia: {
      providerDefaultsVersion: PROVIDER_CATALOG_VERSION,
      imageProviders: [{ id: 'image-1', name: 'QuickRouter GPT Image', endpoint: 'https://old.invalid' }],
      activeImageProviderId: 'image-1',
      videoProviders: [{ id: 'video-1', name: 'QuickRouter Sora 2', endpoint: 'https://old.invalid' }],
      activeVideoProviderId: 'video-1',
      chatProviders: [{ id: 'chat-1', name: 'QuickRouter Chat', endpoint: 'https://old.invalid', models: ['old-model'] }],
      activeChatProviderId: 'chat-1',
      chatModel: 'old-model'
    }
  }
};

upgradeAiDefaults(data);
const media = data.settings.aiMedia;
assert.deepEqual(
  media.imageProviders.filter((provider) => provider.name).map((provider) => provider.name),
  [
    'Nano Banana Pro',
    'Chaser Pro',
    'GPT Image 2',
    'Midjourney V8.1',
    'Midjourney V8.2'
  ]
);
const nanoBananaPro = media.imageProviders.find((provider) => provider.id === 'image-1');
assert.ok(nanoBananaPro);
assert.equal(nanoBananaPro.endpoint, 'https://api.quickrouter.ai/v1beta/models/gemini-3-pro-image-preview:generateContent');
assert.equal(nanoBananaPro.protocol, 'gemini-native');
assert.deepEqual(nanoBananaPro.capabilities.sizes, ['1K', '2K', '4K']);
assert.equal(nanoBananaPro.capabilities.ratios.includes('auto'), false);
for (const id of ['image-2', 'image-4', 'image-5', 'image-7', 'image-8', 'image-9', 'image-10', 'image-11', 'image-12', 'image-13', 'image-14', 'image-15', 'image-16']) {
  assert.equal(media.imageProviders.find((provider) => provider.id === id).name, '');
}
const chaserPro = media.imageProviders.find((provider) => provider.id === 'image-3');
assert.equal(chaserPro.model, 'doubao-seedream-5-0-pro-260628');
assert.equal(chaserPro.icon, 'chaser-pro');
assert.equal(require('../lib/provider-catalog').catalogProvider('image-1').keyEnv, 'QUICKROUTER_API_KEY');
assert.equal(require('../lib/provider-catalog').catalogProvider('image-6').keyEnv, 'AI302_KEY');
for (const id of [
  'image-2', 'image-3', 'image-4', 'image-5', 'image-7', 'image-8',
  'image-9', 'image-10', 'image-11', 'image-12', 'image-13', 'image-14', 'image-15', 'image-16'
]) {
  assert.equal(require('../lib/provider-catalog').catalogProvider(id).keyEnv, 'AI302_KEY');
}
for (const id of ['image-17', 'image-18']) {
  const provider = require('../lib/provider-catalog').catalogProvider(id);
  assert.equal(provider.keyEnv, 'LEGNEXT_API_KEY');
  assert.equal(provider.protocol, 'legnext-midjourney');
  assert.equal(provider.capabilities.maxReferenceImages, 0);
  assert.deepEqual(provider.capabilities.sizes, ['1K', '2K']);
  assert.equal(provider.capabilities.ratios.includes('4:1'), true);
}
const gptImage2 = media.imageProviders.find((provider) => provider.id === 'image-6');
assert.ok(gptImage2);
assert.equal(gptImage2.model, 'gpt-image-2');
assert.equal(gptImage2.endpoint, 'https://api.302.ai/v1/images/generations');
assert.deepEqual(gptImage2.capabilities.resolutionPresets, ['1K', '2K', '4K']);
assert.deepEqual(gptImage2.capabilities.sizes, ['1K', '2K', '4K']);
assert.deepEqual(gptImage2.capabilities.qualities, ['low', 'medium', 'high', 'auto']);
assert.equal(gptImage2.capabilities.arbitrarySizes, true);
assert.equal(gptImage2.capabilities.arbitraryRatios, true);
assert.equal(gptImage2.capabilities.minimumAspectRatio, 1 / 3);
assert.equal(gptImage2.capabilities.maximumAspectRatio, 3);
assert.equal(gptImage2.capabilities.sizeMultiple, 16);
assert.equal(gptImage2.capabilities.maxSizeEdge, 3840);
assert.equal(gptImage2.capabilities.maxSizePixels, 8_300_000);
assert.equal(gptImage2.capabilities.promptMaxCharacters, 32000);
assert.equal(gptImage2.capabilities.referencePromptMaxCharacters, 32000);
for (const id of ['image-7', 'image-8']) {
  const hiddenHiggsfield = media.imageProviders.find((provider) => provider.id === id);
  assert.ok(hiddenHiggsfield);
  assert.equal(hiddenHiggsfield.name, '');
  assert.equal(require('../lib/provider-catalog').catalogProvider(id).hidden, true);
}
assert.equal(media.videoProviderName, 'MiniMax H3');
const miniMaxH3 = media.videoProviders.find((provider) => provider.id === 'video-1');
assert.equal(miniMaxH3.endpoint, 'https://api.atlascloud.ai/api/v1/model/generateVideo');
assert.equal(miniMaxH3.resultEndpoint, 'https://api.atlascloud.ai/api/v1/model/prediction');
assert.equal(miniMaxH3.protocol, 'atlas-minimax-h3-video');
assert.equal(require('../lib/provider-catalog').catalogProvider('video-1').keyEnv, 'ATLASCLOUD_API_KEY');
assert.deepEqual(miniMaxH3.capabilities.upstreamRoutes, {
  text: ['atlas-video-minimax-h3-t2v'],
  'first-frame': ['atlas-video-minimax-h3-i2v'],
  'first-last-frame': ['atlas-video-minimax-h3-i2v'],
  omni: ['atlas-video-minimax-h3-ref']
});
assert.deepEqual(
  media.videoProviders.filter((provider) => provider.name).map((provider) => provider.name),
  [
    'MiniMax H3',
    'Seedance 2.0',
    'Seedance 2.5',
    'Kling V3',
    'Kling O3'
  ]
);
const seedance20 = media.videoProviders.find((provider) => provider.id === 'video-2');
const seedance25 = media.videoProviders.find((provider) => provider.id === 'video-3');
assert.equal(seedance20.protocol, 'seedance-video-v3');
assert.equal(seedance25.protocol, 'seedance-video-v3');
assert.deepEqual(seedance20.capabilities.resolutions, ['480P', '720P', '720P-SR', '1080P', '1080P-SR', '1440P-SR', '4K']);
assert.deepEqual(seedance25.capabilities.resolutions, ['480P', '720P', '720P-SR', '720P-ESR', '1080P', '1080P-SR', '1080P-ESR', '1080P-ESR & 60FPS', '1440P-SR', '1440P-ESR', '4K-ESR']);
assert.deepEqual(seedance20.capabilities.durations, [-1, ...Array.from({ length: 12 }, (_value, index) => index + 4)]);
assert.deepEqual(seedance25.capabilities.durations, [-1, ...Array.from({ length: 27 }, (_value, index) => index + 4)]);
assert.deepEqual(seedance20.capabilities.fallbackCapabilities.durations, Array.from({ length: 12 }, (_value, index) => index + 4));
assert.deepEqual(seedance25.capabilities.fallbackCapabilities.durations, Array.from({ length: 27 }, (_value, index) => index + 4));
assert.deepEqual(seedance25.capabilities.textRatios, ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9']);
assert.equal(seedance25.capabilities.supportsResolution, undefined);
assert.equal(seedance25.capabilities.createTimeoutMs, 45_000);
assert.equal(seedance25.capabilities.generateAudio, true);
for (const provider of [seedance20, seedance25]) {
  const expectedModes = provider.id === 'video-3'
    ? ['first-frame', 'first-last-frame', 'omni', 'video-reference', 'video-edit', 'video-extend']
    : ['first-frame', 'first-last-frame', 'omni'];
  assert.deepEqual(provider.capabilities.videoModes.map((mode) => mode.id), expectedModes);
  assert.deepEqual(provider.capabilities.videoModes[1].roles, ['first_frame', 'last_frame']);
  assert.deepEqual(provider.capabilities.videoModes[2].roles, ['reference_image']);
  assert.deepEqual(provider.capabilities.videoModes[2].mediaTypes, ['image', 'video', 'audio']);
  assert.equal(provider.capabilities.frameReferenceEncoding, 'ordered-content');
}
assert.equal(seedance20.capabilities.videoModes[2].maxReferenceVideos, 3);
assert.deepEqual(seedance20.capabilities.videoModes[0].ratios, ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive']);
assert.deepEqual(seedance20.capabilities.fallbackCapabilities.videoModes[0].ratios, ['adaptive']);
assert.equal(seedance25.capabilities.videoModes[2].maxReferenceVideos, 10);
assert.equal(seedance25.capabilities.videoModes[0].ratios.includes('adaptive'), true);
const staleSeedance25Capabilities = { videoModes: [{ id: 'first-frame', minReferences: 1, maxReferences: 1 }] };
assert.deepEqual(
  canonicalProviderCapabilities('video', 'video-3', staleSeedance25Capabilities).videoModes.map((mode) => mode.id),
  ['first-frame', 'first-last-frame', 'omni', 'video-reference', 'video-edit', 'video-extend'],
  'Seedance 2.5 must recover its complete mode matrix from the bundled catalog.'
);
assert.equal(require('../lib/provider-catalog').catalogProvider('video-2').keyEnv, 'AI302_KEY');
assert.equal(require('../lib/provider-catalog').catalogProvider('video-3').keyEnv, 'AI302_KEY');
assert.match(require('../lib/provider-catalog').catalogProvider('video-10').endpoint, /kling-v3\.0-std\/image-to-video$/);
assert.match(require('../lib/provider-catalog').catalogProvider('video-11').endpoint, /kling-v3\.0-pro\/image-to-video$/);
assert.match(require('../lib/provider-catalog').catalogProvider('video-12').endpoint, /kling-video-o3-std\/image-to-video$/);
assert.match(require('../lib/provider-catalog').catalogProvider('video-13').endpoint, /kling-video-o3-pro\/image-to-video$/);
assert.deepEqual(
  require('../lib/provider-catalog').catalogProvider('video-12').capabilities.durations,
  Array.from({ length: 13 }, (_value, index) => index + 3)
);
assert.deepEqual(
  require('../lib/provider-catalog').catalogProvider('video-13').capabilities.durations,
  Array.from({ length: 13 }, (_value, index) => index + 3)
);
for (const id of ['video-10', 'video-11', 'video-12', 'video-13']) {
  const provider = require('../lib/provider-catalog').catalogProvider(id);
  assert.equal(provider.keyEnv, 'AI302_KEY');
  assert.equal(provider.protocol.startsWith('kling-'), true);
}
assert.deepEqual(require('../lib/provider-catalog').catalogProvider('video-10').capabilities.videoModes.map((mode) => mode.id), ['first-frame']);
assert.deepEqual(require('../lib/provider-catalog').catalogProvider('video-12').capabilities.videoModes.map((mode) => mode.id), [
  'first-frame', 'first-last-frame', 'omni', 'video-reference', 'video-edit'
]);
assert.deepEqual(
  require('../lib/provider-catalog').catalogProvider('video-12').capabilities.videoModes[0].ratios,
  ['adaptive', '9:16', '1:1', '16:9']
);
assert.deepEqual(
  require('../lib/provider-catalog').catalogProvider('video-12').capabilities.videoModes.find((mode) => mode.id === 'first-last-frame').ratios,
  ['adaptive', '9:16', '1:1', '16:9']
);
assert.deepEqual(
  require('../lib/provider-catalog').catalogProvider('video-12').capabilities.videoModes.find((mode) => mode.id === 'video-edit').ratios,
  ['adaptive']
);
assert.equal(
  require('../lib/provider-catalog').catalogProvider('video-12').capabilities.videoModes.find((mode) => mode.id === 'omni').maxReferenceImagesWithVideo,
  4
);
assert.equal(
  require('../lib/provider-catalog').catalogProvider('video-13').capabilities.videoModes.find((mode) => mode.id === 'video-edit').maxReferences,
  5
);
assert.equal(
  require('../lib/provider-catalog').catalogProvider('video-13').capabilities.videoModes.find((mode) => mode.id === 'video-edit').maxReferenceImagesWithVideo,
  4
);
assert.equal(
  require('../lib/provider-catalog').catalogProvider('video-13').capabilities.videoModes.find((mode) => mode.id === 'video-reference').hidden,
  true
);
for (const id of ['video-4', 'video-5', 'video-6', 'video-7', 'video-8', 'video-9']) {
  assert.equal(require('../lib/provider-catalog').catalogProvider(id).keyEnv, 'AI302_KEY');
  assert.equal(media.videoProviders.find((provider) => provider.id === id).name, '');
}
assert.equal(media.chatProviderName, 'Messs AI');
assert.equal(media.chatModel, 'gemini-3.7-flash');
const agentChat = media.chatProviders.find((provider) => provider.id === 'chat-1');
assert.equal(agentChat.endpoint, 'https://api.302.ai/v1/chat/completions');
assert.equal(agentChat.protocol, 'openai-chat');
assert.deepEqual(agentChat.models, ['gemini-3.7-flash']);
const advancedChat = media.chatProviders.find((provider) => provider.id === 'chat-2');
assert.ok(advancedChat);
assert.equal(advancedChat.name, 'AI Chat');
assert.equal(advancedChat.endpoint, 'https://api.quickrouter.ai/v1/chat/completions');
assert.deepEqual(advancedChat.models, ['gpt-5.6-luna']);
assert.equal(JSON.stringify(media).includes('QuickRouter'), false);

const outdated = normalizeGatewayCatalog({
  catalogVersion: PROVIDER_CATALOG_VERSION - 1,
  providers: [
    { id: 'image-1', kind: 'image', name: 'QuickRouter GPT Image' },
    { id: 'chat-1', kind: 'chat', name: 'QuickRouter Chat', models: ['old-model'] }
  ]
}, 'https://gateway.example');
assert.equal(outdated.compatible, false);
assert.equal(outdated.providers[0].name, 'Nano Banana Pro');
assert.equal(outdated.providers[1].name, 'Messs AI');
assert.equal(JSON.stringify(outdated).includes('QuickRouter'), false);
// A deployment can briefly run an older catalog while the desktop bundle
// already knows newer providers. Existing server-enabled models must remain
// usable during that window; only models absent from the server are rejected.
assert.equal(assertGatewayProvider(outdated, 'image', 'image-1').name, 'Nano Banana Pro');
assert.throws(
  () => assertGatewayProvider(outdated, 'image', 'image-6'),
  (error) => error && error.code === 'provider-not-configured'
);

const current = normalizeGatewayCatalog({
  catalogVersion: PROVIDER_CATALOG_VERSION,
  providers: [
    { id: 'image-1', kind: 'image', name: 'legacy-name' },
    { id: 'image-2', kind: 'image', name: 'legacy-nano-2' },
    { id: 'image-5', kind: 'image', name: 'legacy-nano-lite' },
    { id: 'image-9', kind: 'image', name: 'legacy-nano' },
    { id: 'image-6', kind: 'image', name: 'legacy-gpt-image-name' },
    { id: 'image-7', kind: 'image', name: 'legacy-higgsfield-standard' },
    { id: 'image-8', kind: 'image', name: 'legacy-higgsfield-soul' },
    { id: 'video-1', kind: 'video', name: 'legacy-video' },
    { id: 'video-2', kind: 'video', name: 'legacy-seedance-2' },
    { id: 'video-3', kind: 'video', name: 'legacy-seedance-2-5' },
    { id: 'chat-1', kind: 'chat', name: 'legacy-chat', models: ['wrong-model'] },
    { id: 'chat-2', kind: 'chat', name: 'legacy-advanced-chat', models: ['wrong-model'] }
  ]
}, 'https://gateway.example');
assert.equal(current.compatible, true);
assert.equal(assertGatewayProvider(current, 'image', 'image-1').name, 'Nano Banana Pro');
assert.equal(assertGatewayProvider(current, 'image', 'image-6').name, 'GPT Image 2');
for (const id of ['image-2', 'image-5', 'image-7', 'image-8', 'image-9']) {
  assert.throws(() => assertGatewayProvider(current, 'image', id), (error) => error && error.code === 'provider-not-configured');
}
assert.equal(assertGatewayProvider(current, 'video', 'video-1').name, 'MiniMax H3');
assert.equal(assertGatewayProvider(current, 'video', 'video-2').name, 'Seedance 2.0');
assert.equal(assertGatewayProvider(current, 'video', 'video-3').name, 'Seedance 2.5');
assert.deepEqual(assertGatewayProvider(current, 'chat', 'chat-1').models, [
  'gemini-3.7-flash'
]);
assert.deepEqual(assertGatewayProvider(current, 'chat', 'chat-2').models, ['gpt-5.6-luna']);
const assistantSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'ai-assistant.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const sidebarSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'sidebar.js'), 'utf8');
assert.match(mainSource, /length: Math\.max\(10, source\.length\)/);
assert.match(mainSource, /\.slice\(0, 100\)/);
assert.match(mainSource, /'Default', 'adaptive', 'original'/);
assert.match(mainSource, /'512x512', '720p', '1080p'/);
assert.match(mainSource, /configuredReferenceMinimum/);
assert.match(sidebarSource, /length: Math\.max\(10, list\.length\)/);
assert.match(assistantSource, /'gpt-5\.6-luna': 'GPT-5\.6 Luna'/);
assert.match(assistantSource, /'gemini-3\.7-flash': 'Gemini 3\.7 Flash'/);
assert.doesNotMatch(assistantSource, /doubao-seed-2-1-pro-260628|deepseek-v4-pro/);
assert.equal(
  require('../lib/provider-catalog').providerCatalog().every((provider) => provider.requiresActivation === false),
  true,
  'Every bundled AI provider must be available without an activation code.'
);

process.stdout.write('Provider catalog migration tests passed.\n');
