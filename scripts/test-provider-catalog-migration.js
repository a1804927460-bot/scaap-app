'use strict';

const assert = require('assert');
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
  ['Nano Banana Pro', 'Nanobanana Pro SE', 'Seedream 5.0 Lite', 'Midjourney', 'Nano banana2']
);
assert.equal(media.videoProviderName, 'MiniMax H3');
assert.equal(media.chatProviderName, 'Messs AI');
assert.equal(media.chatModel, 'gemini-3.1-flash-lite');
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
    { id: 'video-1', kind: 'video', name: 'legacy-video' },
    { id: 'chat-1', kind: 'chat', name: 'legacy-chat', models: ['wrong-model'] }
  ]
}, 'https://gateway.example');
assert.equal(current.compatible, true);
assert.equal(assertGatewayProvider(current, 'image', 'image-1').name, 'Nano Banana Pro');
assert.equal(assertGatewayProvider(current, 'video', 'video-1').name, 'MiniMax H3');
assert.deepEqual(assertGatewayProvider(current, 'chat', 'chat-1').models, [
  'gemini-3.1-flash-lite',
  'gemini-3.6-flash'
]);

process.stdout.write('Provider catalog migration tests passed.\n');
