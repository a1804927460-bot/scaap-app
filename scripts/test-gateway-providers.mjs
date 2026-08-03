import assert from 'node:assert/strict';

process.env.Quick_API_KEY = 'quickrouter-secret';
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
assert.ok(ids.includes('chat-1'));
assert.ok(ids.includes('relay-2-image'));
assert.ok(ids.includes('relay-2-chat'));
assert.deepEqual(
  config.providers.find((provider) => provider.id === 'relay-2-chat').models,
  ['model-a', 'model-b']
);

const publicText = JSON.stringify(config);
assert.equal(publicText.includes('quickrouter-secret'), false);
assert.equal(publicText.includes('relay-two-secret'), false);
assert.equal(publicText.includes('RELAY_2_API_KEY'), false);
assert.equal(publicText.includes('relay.example.com'), false);

process.stdout.write('gateway provider registry tests passed.\n');
