'use strict';

const assert = require('assert');

process.env.ATLASCLOUD_API_KEY = 'atlas-test-key';

(async () => {
  const providers = await import('../gateway/src/providers.js');
  const config = providers.publicProviderConfig();
  const ids = config.providers.map((provider) => provider.id);
  for (const id of [
    'atlas-image-gpt2',
    'atlas-video-seedance20-i2v',
    'atlas-video-seedance20-ref',
    'atlas-video-seedance25-i2v',
    'atlas-video-seedance25-ref'
  ]) assert.ok(ids.includes(id), `${id} must be exposed when ATLASCLOUD_API_KEY is configured`);

  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options = {}) => {
    const endpoint = String(url);
    if (endpoint.endsWith('/generateImage')) {
      requests.push({ endpoint, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({ request_id: 'atlas-image-request' }), { status: 200 });
    }
    if (endpoint.endsWith('/generateVideo')) {
      requests.push({ endpoint, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({ request_id: 'atlas-video-request' }), { status: 200 });
    }
    if (endpoint.includes('/prediction/atlas-image-request') || endpoint.includes('/prediction?id=atlas-image-request')) {
      return new Response(JSON.stringify({ data: { status: 'completed', outputs: [{ url: 'https://cdn.atlascloud.ai/image.png' }] } }), { status: 200 });
    }
    if (endpoint.includes('/prediction/atlas-video-request') || endpoint.includes('/prediction?id=atlas-video-request')) {
      return new Response(JSON.stringify({ data: { status: 'completed', video_url: 'https://cdn.atlascloud.ai/video.mp4' } }), { status: 200 });
    }
    if (endpoint === 'https://cdn.atlascloud.ai/image.png') {
      return new Response(Buffer.from('atlas-image'), { status: 200, headers: { 'content-type': 'image/png' } });
    }
    throw new Error(`Unexpected Atlas test request: ${endpoint}`);
  };

  try {
    const image = await providers.generateMedia('image', {
      providerId: 'atlas-image-gpt2', prompt: 'test image', size: '1920x1080',
      quality: 'high', outputFormat: 'png', urls: []
    });
    assert.equal(image.toString(), 'atlas-image');

    const firstLast = await providers.createVideoTask({
      providerId: 'atlas-video-seedance25-i2v', prompt: 'first and last frame',
      urls: ['https://cdn.example.com/first.png', 'https://cdn.example.com/last.png'],
      referenceMediaTypes: ['image', 'image'], videoMode: 'first-last-frame',
      resolution: '1080P-ESR', aspectRatio: 'adaptive', duration: 30,
      generateAudio: false, outputFormat: 'mp4'
    });
    assert.equal(firstLast.taskId, 'atlas-video-request');

    const extended = await providers.createVideoTask({
      providerId: 'atlas-video-seedance25-ref', prompt: 'extend this clip',
      urls: ['https://cdn.example.com/source.mp4'], referenceMediaTypes: ['video'],
      videoMode: 'video-extend', resolution: '720P', aspectRatio: 'adaptive',
      duration: -1, generateAudio: true, outputFormat: 'mov'
    });
    assert.equal(extended.taskId, 'atlas-video-request');

    await providers.createVideoTask({
      providerId: 'atlas-video-seedance20-ref', prompt: 'image and audio reference',
      urls: ['https://cdn.example.com/source.png'], referenceMediaTypes: ['image'],
      referenceAudioUrls: ['https://cdn.example.com/source.mp3'], videoMode: 'omni',
      resolution: '1080P', aspectRatio: '16:9', duration: 6,
      seed: 123, bitrateMode: 'high', watermark: true, outputFormat: 'mp4'
    });
    await providers.createVideoTask({
      providerId: 'atlas-video-seedance25-ref', prompt: 'audio only reference',
      urls: [], referenceMediaTypes: [], referenceAudioUrls: ['https://cdn.example.com/source.mp3'],
      videoMode: 'omni', resolution: '720P', aspectRatio: 'adaptive', duration: 6,
      outputFormat: 'mp4'
    });

    const imageRequest = requests.find((entry) => entry.endpoint.endsWith('/generateImage'));
    assert.equal(imageRequest.body.model, 'openai/gpt-image-2/text-to-image');
    assert.equal(imageRequest.body.size, '1920x1080');
    assert.equal(imageRequest.body.output_format, 'png');
    const frameRequest = requests.find((entry) => entry.endpoint.endsWith('/generateVideo') && entry.body.last_image);
    assert.equal(frameRequest.body.model, 'bytedance/seedance-2.5/image-to-video');
    assert.equal(frameRequest.body.generate_audio, false);
    assert.equal(frameRequest.body.resolution, '1080p-esr');
    assert.equal(frameRequest.body.duration, 30);
    const extendRequest = requests.find((entry) => entry.endpoint.endsWith('/generateVideo') && entry.body.omni_reference_task_type === 'extend');
    assert.equal(extendRequest.body.model, 'bytedance/seedance-2.5/reference-to-video');
    assert.equal(extendRequest.body.duration, -1);
    assert.equal(extendRequest.body.output_format, 'mov');
    const seedance20ReferenceRequest = requests.find((entry) => entry.body.model === 'bytedance/seedance-2.0/reference-to-video');
    assert.equal(seedance20ReferenceRequest.body.reference_audios.length, 1);
    assert.equal(seedance20ReferenceRequest.body.seed, 123);
    assert.equal(seedance20ReferenceRequest.body.bitrate_mode, 'high');
    assert.equal(seedance20ReferenceRequest.body.watermark, true);
    const audioOnlyRequest = requests.find((entry) => entry.body.model === 'bytedance/seedance-2.5/reference-to-video' && entry.body.reference_audios && entry.body.reference_audios.length > 0);
    assert.equal(audioOnlyRequest.body.reference_images.length, 0);
    assert.equal(audioOnlyRequest.body.reference_audios.length, 1);

    const polled = await providers.pollVideoTask('atlas-video-seedance25-ref', 'atlas-video-request');
    assert.equal(polled.status, 'succeeded');
    assert.equal(polled.resultUrl, 'https://cdn.atlascloud.ai/video.mp4');
  } finally {
    global.fetch = originalFetch;
  }
  console.log('Atlas Cloud provider tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
