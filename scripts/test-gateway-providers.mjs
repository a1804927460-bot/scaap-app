import assert from 'node:assert/strict';

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

const { publicProviderConfig } = await import('../gateway/src/providers.js');
const config = publicProviderConfig();
const ids = config.providers.map((provider) => provider.id);

assert.ok(ids.includes('image-1'));
assert.ok(ids.includes('video-1'));
assert.ok(ids.includes('video-1'));
assert.ok(ids.includes('chat-1'));
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

const publicText = JSON.stringify(config);
assert.equal(publicText.includes('quickrouter-secret'), false);
assert.equal(publicText.includes('relay-two-secret'), false);
assert.equal(publicText.includes('minimax-secret'), false);
assert.equal(publicText.includes('RELAY_2_API_KEY'), false);
assert.equal(publicText.includes('relay.example.com'), false);
assert.equal(publicText.includes('quickrouter.ai'), false);
assert.equal(publicText.includes('minimaxi.com'), false);

process.stdout.write('gateway provider registry tests passed.\n');
