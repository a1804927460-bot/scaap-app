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

const { chat, generateMedia, publicProviderConfig } = await import('../gateway/src/providers.js');
const config = publicProviderConfig();
const ids = config.providers.map((provider) => provider.id);

assert.equal(config.catalogVersion, 9);

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

const miniMaxCalls = [];
const miniMaxVideo = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);
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
  if (value === 'https://cdn.example/h3.mp4') {
    return {
      ok: true,
      status: 200,
      headers: { get: () => String(miniMaxVideo.length) },
      arrayBuffer: async () => miniMaxVideo
    };
  }
  throw new Error(`Unexpected MiniMax URL: ${value}`);
};
const generatedVideo = await generateMedia('video', {
  providerId: 'video-1',
  prompt: 'slow cinematic orbit',
  resolution: '2K',
  duration: 5,
  aspectRatio: '16:9',
  urls: []
});
assert.deepEqual(generatedVideo, miniMaxVideo);
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

process.stdout.write('gateway provider registry tests passed.\n');
