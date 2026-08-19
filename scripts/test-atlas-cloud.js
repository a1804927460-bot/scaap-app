'use strict';

const assert = require('assert');

process.env.ATLASCLOUD_API_KEY = 'atlas-test-key';
delete process.env.AI302_KEY;

function pngHeader(width, height) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

(async () => {
  const providers = await import('../gateway/src/providers.js');
  const config = providers.publicProviderConfig();
  const ids = config.providers.map((provider) => provider.id);
  for (const id of ['image-6', 'video-2', 'video-3']) {
    assert.ok(ids.includes(id), `${id} must be exposed when ATLASCLOUD_API_KEY is configured`);
  }
  for (const id of [
    'atlas-image-gpt2', 'atlas-video-seedance20-i2v', 'atlas-video-seedance20-ref',
    'atlas-video-seedance25-i2v', 'atlas-video-seedance25-ref'
  ]) assert.equal(ids.includes(id), false, `${id} is an internal route and must remain hidden`);

  const originalFetch = global.fetch;
  const requests = [];
  let atlasImage = pngHeader(1920, 1072);
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
      return new Response(atlasImage, { status: 200, headers: { 'content-type': 'image/png' } });
    }
    throw new Error(`Unexpected Atlas test request: ${endpoint}`);
  };

  try {
    const image = await providers.generateMedia('image', {
      providerId: 'image-6', prompt: 'test image', size: '1920x1080',
      quality: 'high', outputFormat: 'png', urls: []
    });
    assert.deepEqual(image, atlasImage);

    atlasImage = pngHeader(1024, 1024);
    const automaticQualityImage = await providers.generateMedia('image', {
      providerId: 'image-6', prompt: 'automatic quality', size: '1K',
      aspectRatio: '1:1', quality: 'auto', outputFormat: 'png', urls: []
    });
    assert.deepEqual(automaticQualityImage, atlasImage);

    atlasImage = Buffer.from('not-an-image');
    await assert.rejects(
      providers.generateMedia('image', {
        providerId: 'image-6', prompt: 'reject damaged result', size: '1K',
        aspectRatio: '1:1', quality: 'medium', outputFormat: 'png', urls: []
      }),
      (error) => error && error.code === 'invalid-media'
    );

    atlasImage = pngHeader(1024, 576);
    await assert.rejects(
      providers.generateMedia('image', {
        providerId: 'image-6', prompt: 'reject fake 4K', size: '4K',
        aspectRatio: '16:9', quality: 'high', outputFormat: 'png', urls: []
      }),
      (error) => error && error.code === 'image-resolution-mismatch'
        && error.actualWidth === 1024 && error.actualHeight === 576
    );

    atlasImage = pngHeader(3840, 3840);
    await assert.rejects(
      providers.generateMedia('image', {
        providerId: 'image-6', prompt: 'reject wrong crop', size: '4K',
        aspectRatio: '16:9', quality: 'high', outputFormat: 'png', urls: []
      }),
      (error) => error && error.code === 'image-resolution-mismatch'
    );

    atlasImage = pngHeader(2880, 2880);
    assert.deepEqual(await providers.generateMedia('image', {
      providerId: 'image-6', prompt: 'valid square 4K', size: '4K',
      aspectRatio: '1:1', quality: 'high', outputFormat: 'png', urls: []
    }), atlasImage);

    const firstLast = await providers.createVideoTask({
      providerId: 'video-3', prompt: 'first and last frame',
      urls: ['https://cdn.example.com/first.png', 'https://cdn.example.com/last.png'],
      referenceMediaTypes: ['image', 'image'], videoMode: 'first-last-frame',
      resolution: '1080P-ESR', aspectRatio: 'adaptive', duration: 30,
      generateAudio: false, outputFormat: 'mp4'
    });
    assert.match(firstLast.taskId, /^messs-route:atlas-video-seedance25-i2v:atlas-video-request$/);

    const extended = await providers.createVideoTask({
      providerId: 'video-3', prompt: 'extend this clip',
      urls: ['https://cdn.example.com/source.mp4'], referenceMediaTypes: ['video'],
      videoMode: 'video-extend', resolution: '720P', aspectRatio: 'adaptive',
      duration: 10, generateAudio: true, outputFormat: 'mov'
    });
    assert.match(extended.taskId, /^messs-route:atlas-video-seedance25-ref:atlas-video-request$/);

    const inferredVideoReference = await providers.createVideoTask({
      providerId: 'video-3', prompt: 'infer a reference-video route',
      urls: ['https://cdn.example.com/reference.mp4'], referenceMediaTypes: ['video'],
      resolution: '720P', aspectRatio: 'adaptive', duration: 8,
      generateAudio: true, outputFormat: 'mp4'
    });
    assert.match(inferredVideoReference.taskId, /^messs-route:atlas-video-seedance25-ref:atlas-video-request$/);

    await assert.rejects(
      providers.createVideoTask({
        providerId: 'video-3', prompt: 'invalid edit duration',
        urls: ['https://cdn.example.com/source.mp4'], referenceMediaTypes: ['video'],
        videoMode: 'video-edit', resolution: '720P', aspectRatio: 'adaptive',
        duration: 10, generateAudio: true, outputFormat: 'mp4'
      }),
      (error) => error && error.code === 'invalid-duration'
    );

    const validEdit = await providers.createVideoTask({
      providerId: 'video-3', prompt: 'valid automatic-duration edit',
      urls: ['https://cdn.example.com/source.mp4'], referenceMediaTypes: ['video'],
      videoMode: 'video-edit', resolution: '720P', aspectRatio: 'adaptive',
      duration: -1, generateAudio: true, outputFormat: 'mp4'
    });
    assert.match(validEdit.taskId, /^messs-route:atlas-video-seedance25-ref:atlas-video-request$/);

    await providers.createVideoTask({
      providerId: 'video-2', prompt: 'image and audio reference',
      urls: ['https://cdn.example.com/source.png'], referenceMediaTypes: ['image'],
      referenceAudioUrls: ['https://cdn.example.com/source.mp3'], videoMode: 'omni',
      resolution: '1080P', aspectRatio: '16:9', duration: 6,
      seed: 123, bitrateMode: 'high', watermark: true, outputFormat: 'mp4'
    });
    await providers.createVideoTask({
      providerId: 'video-2', prompt: 'explicit image-to-video ratio',
      urls: ['https://cdn.example.com/source.png'], referenceMediaTypes: ['image'],
      videoMode: 'first-frame', resolution: '720P', aspectRatio: '9:16', duration: -1,
      generateAudio: true, outputFormat: 'mp4'
    });
    await providers.createVideoTask({
      providerId: 'video-3', prompt: 'audio only reference',
      urls: [], referenceMediaTypes: [], referenceAudioUrls: ['https://cdn.example.com/source.mp3'],
      videoMode: 'omni', resolution: '720P', aspectRatio: 'adaptive', duration: 6,
      outputFormat: 'mp4'
    });

    const imageRequest = requests.find((entry) => entry.endpoint.endsWith('/generateImage'));
    assert.equal(imageRequest.body.model, 'openai/gpt-image-2/text-to-image');
    assert.equal(imageRequest.body.size, '1920x1072');
    assert.equal(imageRequest.body.output_format, 'png');
    const automaticQualityRequest = requests.find((entry) => entry.endpoint.endsWith('/generateImage') && entry.body.prompt === 'automatic quality');
    assert.equal(automaticQualityRequest.body.quality, 'medium');
    const frameRequest = requests.find((entry) => entry.endpoint.endsWith('/generateVideo') && entry.body.last_image);
    assert.equal(frameRequest.body.model, 'bytedance/seedance-2.5/image-to-video');
    assert.equal(frameRequest.body.generate_audio, false);
    assert.equal(frameRequest.body.resolution, '1080p-esr');
    assert.equal(frameRequest.body.duration, 30);
    const extendRequest = requests.find((entry) => entry.endpoint.endsWith('/generateVideo') && entry.body.omni_reference_task_type === 'extend');
    assert.equal(extendRequest.body.model, 'bytedance/seedance-2.5/reference-to-video');
    assert.equal(extendRequest.body.duration, 10);
    assert.equal(extendRequest.body.output_format, 'mov');
    const inferredReferenceRequest = requests.find((entry) => entry.body.reference_videos && entry.body.reference_videos.includes('https://cdn.example.com/reference.mp4'));
    assert.equal(inferredReferenceRequest.body.model, 'bytedance/seedance-2.5/reference-to-video');
    assert.equal(inferredReferenceRequest.body.omni_reference_task_type, 'reference');
    const editRequest = requests.find((entry) => entry.body.omni_reference_task_type === 'edit');
    assert.equal(editRequest.body.duration, -1);
    const seedance20ReferenceRequest = requests.find((entry) => entry.body.model === 'bytedance/seedance-2.0/reference-to-video');
    assert.equal(seedance20ReferenceRequest.body.reference_audios.length, 1);
    assert.equal(seedance20ReferenceRequest.body.seed, 123);
    assert.equal(seedance20ReferenceRequest.body.bitrate_mode, 'high');
    assert.equal(seedance20ReferenceRequest.body.watermark, true);
    const seedance20I2vRequest = requests.find((entry) => entry.body.model === 'bytedance/seedance-2.0/image-to-video' && entry.body.image);
    assert.equal(seedance20I2vRequest.body.ratio, '9:16');
    assert.equal(seedance20I2vRequest.body.duration, -1);
    const audioOnlyRequest = requests.find((entry) => entry.body.model === 'bytedance/seedance-2.5/reference-to-video' && entry.body.reference_audios && entry.body.reference_audios.length > 0);
    assert.equal(audioOnlyRequest.body.reference_images.length, 0);
    assert.equal(audioOnlyRequest.body.reference_audios.length, 1);

    const polled = await providers.pollVideoTask('video-3', extended.taskId);
    assert.equal(polled.status, 'succeeded');
    assert.equal(polled.resultUrl, 'https://cdn.atlascloud.ai/video.mp4');

    // A high-resolution Seedance request is valid for Atlas but outside the
    // 302 fallback matrix. It must not be sent to 302 or be mislabeled as a
    // fallback capability error when Atlas is temporarily unavailable.
    process.env.AI302_KEY = 'atlas-fallback-test-key';
    const fallbackCalls = [];
    const generationFetch = global.fetch;
    global.fetch = async (url, options = {}) => {
      const endpoint = String(url);
      fallbackCalls.push(endpoint);
      if (endpoint.endsWith('/generateVideo')) {
        return new Response(JSON.stringify({ error: { message: 'Atlas temporarily unavailable.' } }), { status: 503 });
      }
      throw new Error(`Unexpected fallback request: ${endpoint}`);
    };
    await assert.rejects(
      providers.createVideoTask({
        providerId: 'video-3', prompt: 'do not downgrade 4K',
        urls: ['https://cdn.example.com/frame.png'], referenceMediaTypes: ['image'],
        videoMode: 'first-frame', resolution: '4K-ESR', aspectRatio: 'adaptive', duration: 8,
        outputFormat: 'mp4'
      }),
      (error) => error && error.code === 'provider-temporarily-unavailable'
    );
    assert.equal(fallbackCalls.some((endpoint) => endpoint.includes('api.302.ai')), false);
    // The same guard must hold when Atlas has no key at all: the logical
    // provider's 4K capability must never be treated as 302's capability.
    delete process.env.ATLASCLOUD_API_KEY;
    fallbackCalls.length = 0;
    await assert.rejects(
      providers.createVideoTask({
        providerId: 'video-3', prompt: 'do not downgrade without Atlas key',
        urls: ['https://cdn.example.com/frame.png'], referenceMediaTypes: ['image'],
        videoMode: 'first-frame', resolution: '4K-ESR', aspectRatio: 'adaptive', duration: 8,
        outputFormat: 'mp4'
      }),
      (error) => error && error.code === 'invalid-resolution'
    );
    assert.equal(fallbackCalls.some((endpoint) => endpoint.includes('api.302.ai')), false);
    process.env.ATLASCLOUD_API_KEY = 'atlas-test-key';
    global.fetch = generationFetch;
    delete process.env.AI302_KEY;
  } finally {
    global.fetch = originalFetch;
  }
  console.log('Atlas Cloud provider tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
