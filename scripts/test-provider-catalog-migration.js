'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { PROVIDER_CATALOG_VERSION } = require('../lib/provider-catalog');
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
    'Nanobanana Pro SE',
    'Seedream 5.0 Lite',
    'Midjourney',
    'Nano banana2',
    'GPT Image 2',
    'Higgsfield Soul Standard',
    'Higgsfield Soul'
  ]
);
const nanoBananaPro = media.imageProviders.find((provider) => provider.id === 'image-1');
assert.ok(nanoBananaPro);
assert.equal(nanoBananaPro.endpoint, 'https://api.302.ai/google/v1/models/gemini-3-pro-image-preview');
assert.deepEqual(nanoBananaPro.capabilities.sizes, ['Default']);
assert.equal(require('../lib/provider-catalog').catalogProvider('image-1').keyEnv, 'AI302_KEY');
const gptImage2 = media.imageProviders.find((provider) => provider.id === 'image-6');
assert.ok(gptImage2);
assert.equal(gptImage2.model, 'gpt-image-2');
assert.deepEqual(gptImage2.capabilities.sizes, ['1024x1024', '1536x1024', '1024x1536', 'auto']);
assert.deepEqual(gptImage2.capabilities.qualities, ['low', 'medium', 'high', 'auto']);
for (const id of ['image-7', 'image-8']) {
  const higgsfield = media.imageProviders.find((provider) => provider.id === id);
  assert.ok(higgsfield);
  assert.equal(require('../lib/provider-catalog').catalogProvider(id).keyEnv, 'AI302_KEY');
  assert.deepEqual(higgsfield.capabilities.sizes, ['720p', '1080p']);
  assert.deepEqual(higgsfield.capabilities.counts, [1, 4]);
  assert.equal(higgsfield.capabilities.maxReferenceImages, 0);
}
assert.equal(media.videoProviderName, 'MiniMax H3');
assert.deepEqual(
  media.videoProviders.filter((provider) => provider.name).map((provider) => provider.name),
  ['MiniMax H3', 'Seedance 2.0', 'Seedance 2.5']
);
const seedance20 = media.videoProviders.find((provider) => provider.id === 'video-2');
const seedance25 = media.videoProviders.find((provider) => provider.id === 'video-3');
assert.equal(seedance20.protocol, 'seedance-video-v3');
assert.equal(seedance25.protocol, 'seedance-video-v3');
assert.deepEqual(seedance20.capabilities.resolutions, ['480P', '720P']);
assert.deepEqual(seedance25.capabilities.resolutions, ['480P', '720P']);
assert.equal(require('../lib/provider-catalog').catalogProvider('video-2').keyEnv, 'AI302_KEY');
assert.equal(require('../lib/provider-catalog').catalogProvider('video-3').keyEnv, 'AI302_KEY');
assert.equal(media.chatProviderName, 'Messs AI');
assert.equal(media.chatModel, 'gemini-3.1-flash-lite');
const advancedChat = media.chatProviders.find((provider) => provider.id === 'chat-2');
assert.ok(advancedChat);
assert.equal(advancedChat.name, 'AI Chat');
assert.equal(advancedChat.endpoint, 'https://api.quickrouter.ai/v1/chat/completions');
assert.deepEqual(advancedChat.models, [
  'gpt-5.6-luna',
  'doubao-seed-2-1-pro-260628',
  'deepseek-v4-pro'
]);
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
assert.throws(
  () => assertGatewayProvider(outdated, 'image', 'image-1'),
  (error) => error && error.code === 'gateway-catalog-outdated'
);

const current = normalizeGatewayCatalog({
  catalogVersion: PROVIDER_CATALOG_VERSION,
  providers: [
    { id: 'image-1', kind: 'image', name: 'legacy-name' },
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
assert.equal(assertGatewayProvider(current, 'image', 'image-7').name, 'Higgsfield Soul Standard');
assert.equal(assertGatewayProvider(current, 'image', 'image-8').name, 'Higgsfield Soul');
assert.equal(assertGatewayProvider(current, 'video', 'video-1').name, 'MiniMax H3');
assert.equal(assertGatewayProvider(current, 'video', 'video-2').name, 'Seedance 2.0');
assert.equal(assertGatewayProvider(current, 'video', 'video-3').name, 'Seedance 2.5');
assert.deepEqual(assertGatewayProvider(current, 'chat', 'chat-1').models, [
  'gemini-3.1-flash-lite',
  'gemini-3.6-flash'
]);
assert.deepEqual(assertGatewayProvider(current, 'chat', 'chat-2').models, [
  'gpt-5.6-luna',
  'doubao-seed-2-1-pro-260628',
  'deepseek-v4-pro'
]);
const assistantSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'ai-assistant.js'), 'utf8');
assert.match(assistantSource, /'gpt-5\.6-luna': 'GPT-5\.6Luna'/);
assert.match(assistantSource, /'doubao-seed-2-1-pro-260628': 'Doubao2\.1pro'/);
assert.match(assistantSource, /'deepseek-v4-pro': 'DeepSeek-V4-Pro'/);
assert.equal(
  require('../lib/provider-catalog').providerCatalog().every((provider) => provider.requiresActivation === false),
  true,
  'Every bundled AI provider must be available without an activation code.'
);

process.stdout.write('Provider catalog migration tests passed.\n');
