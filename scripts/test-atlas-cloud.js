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

function glbFixture() {
  const json = Buffer.from('{"asset":{"version":"2.0"}}');
  const paddedLength = Math.ceil(json.length / 4) * 4;
  const buffer = Buffer.alloc(12 + 8 + paddedLength, 0x20);
  buffer.write('glTF', 0, 'ascii');
  buffer.writeUInt32LE(2, 4);
  buffer.writeUInt32LE(buffer.length, 8);
  buffer.writeUInt32LE(paddedLength, 12);
  buffer.writeUInt32LE(0x4e4f534a, 16);
  json.copy(buffer, 20);
  return buffer;
}

(async () => {
  const providers = await import('../gateway/src/providers.js');
  const relayAssets = await import('../gateway/src/ai302-tools.js');
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
  let uploadedMediaCount = 0;
  let atlasThreeDTaskCount = 0;
  const atlasGlb = glbFixture();
  global.fetch = async (url, options = {}) => {
    const endpoint = String(url);
    if (endpoint.endsWith('/uploadMedia')) {
      assert.ok(options.body instanceof FormData, 'Atlas media uploads must use multipart form data');
      const file = options.body.get('file');
      assert.ok(file instanceof Blob, 'Atlas media uploads must include a file blob');
      uploadedMediaCount += 1;
      const upload = {
        endpoint,
        name: file.name,
        type: file.type,
        size: file.size,
        url: `https://atlas-img.example.com/uploaded-${uploadedMediaCount}.png`
      };
      requests.push(upload);
      return new Response(JSON.stringify({ code: 200, data: { download_url: upload.url } }), { status: 200 });
    }
    if (endpoint.endsWith('/generateImage')) {
      const body = JSON.parse(options.body);
      requests.push({ endpoint, body });
      if (/image-to-3d$/i.test(String(body.model || ''))) {
        atlasThreeDTaskCount += 1;
        return new Response(JSON.stringify({ request_id: `atlas-3d-request-${atlasThreeDTaskCount}` }), { status: 200 });
      }
      return new Response(JSON.stringify({ request_id: 'atlas-image-request' }), { status: 200 });
    }
    if (endpoint.endsWith('/generateVideo')) {
      requests.push({ endpoint, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({ id: 'atlas-video-request', status: 'created' }), { status: 200 });
    }
    if (endpoint.includes('/prediction/atlas-image-request') || endpoint.includes('/prediction?id=atlas-image-request')) {
      return new Response(JSON.stringify({ data: { status: 'completed', outputs: [{ url: 'https://cdn.atlascloud.ai/image.png' }] } }), { status: 200 });
    }
    if (endpoint.includes('/prediction/atlas-video-request') || endpoint.includes('/prediction?id=atlas-video-request')) {
      return new Response(JSON.stringify({ data: { id: 'atlas-video-request', status: 'completed', outputs: ['https://cdn.atlascloud.ai/video.mp4'] } }), { status: 200 });
    }
    if (/\/prediction\/atlas-3d-request-\d+$/i.test(endpoint)) {
      return new Response(JSON.stringify({
        data: {
          status: 'completed',
          output: {
            files: [
              { type: 'GLB', url: 'https://storage.atlascloud.ai/models/result.glb' },
              { type: 'PNG', url: 'https://storage.atlascloud.ai/models/preview.png' }
            ]
          }
        }
      }), { status: 200 });
    }
    if (endpoint === 'https://cdn.atlascloud.ai/image.png') {
      return new Response(atlasImage, { status: 200, headers: { 'content-type': 'image/png' } });
    }
    if (endpoint === 'https://storage.atlascloud.ai/models/result.glb') {
      return new Response(atlasGlb, { status: 200, headers: { 'content-type': 'model/gltf-binary' } });
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

    // GPT Image 2 keeps the same logical provider when Atlas rejects a
    // rotated credential; the configured 302 route may safely complete it.
    process.env.AI302_KEY = 'gpt-image-fallback-test-key';
    const fallbackImage = pngHeader(1024, 1024);
    const imageFallbackCalls = [];
    const atlasFetch = global.fetch;
    global.fetch = async (url, options = {}) => {
      const endpoint = String(url);
      imageFallbackCalls.push(endpoint);
      if (endpoint.endsWith('/generateImage')) {
        return new Response(JSON.stringify({ message: 'Atlas credential rejected.' }), { status: 401 });
      }
      if (endpoint === 'https://api.302.ai/v1/images/generations') {
        return new Response(JSON.stringify({
          data: [{ b64_json: fallbackImage.toString('base64') }]
        }), { status: 200 });
      }
      throw new Error(`Unexpected GPT Image 2 fallback request: ${endpoint}`);
    };
    assert.deepEqual(await providers.generateMedia('image', {
      providerId: 'image-6', prompt: 'use the same GPT Image 2 route', size: '1K',
      aspectRatio: '1:1', quality: 'medium', outputFormat: 'png', urls: []
    }), fallbackImage);
    assert.equal(imageFallbackCalls.some((endpoint) => endpoint.endsWith('/generateImage')), true);
    assert.equal(imageFallbackCalls.includes('https://api.302.ai/v1/images/generations'), true);
    delete process.env.AI302_KEY;
    global.fetch = atlasFetch;

    const localReference = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const h3CallCount = requests.length;
    await assert.rejects(() => providers.createVideoTask({
      providerId: 'video-1', prompt: 'H3 requires a first frame',
      resolution: '768P', aspectRatio: 'adaptive', duration: 6, videoMode: 'first-last-frame',
      urls: [], outputFormat: 'mp4'
    }), (error) => error && error.code === 'reference-required');
    assert.equal(requests.length, h3CallCount);
    const h3FirstFrame = await providers.createVideoTask({
      providerId: 'video-1', prompt: 'H3 first frame generation',
      resolution: '2K', aspectRatio: 'adaptive', duration: 6, videoMode: 'first-frame',
      urls: [localReference], referenceMediaTypes: ['image'], outputFormat: 'mp4'
    });
    assert.match(h3FirstFrame.taskId, /^messs-route:atlas-video-minimax-h3-i2v:atlas-video-request$/);
    const h3FirstLast = await providers.createVideoTask({
      providerId: 'video-1', prompt: 'H3 first and last frame generation',
      resolution: '768P', aspectRatio: 'adaptive', duration: 6, videoMode: 'first-last-frame',
      urls: ['https://cdn.example.com/h3-first.png', 'https://cdn.example.com/h3-last.png'],
      referenceMediaTypes: ['image', 'image'], outputFormat: 'mp4'
    });
    assert.match(h3FirstLast.taskId, /^messs-route:atlas-video-minimax-h3-i2v:atlas-video-request$/);
    const h3Reference = await providers.createVideoTask({
      providerId: 'video-1', prompt: 'H3 reference generation',
      resolution: '768P', aspectRatio: 'adaptive', duration: 6, videoMode: 'omni',
      urls: ['https://cdn.example.com/h3-reference.png'], referenceMediaTypes: ['image'],
      outputFormat: 'mp4'
    });
    assert.match(h3Reference.taskId, /^messs-route:atlas-video-minimax-h3-ref:atlas-video-request$/);
    assert.equal((await providers.pollVideoTask('video-1', h3FirstFrame.taskId)).status, 'succeeded');

    for (const providerId of ['hunyuan3d', 'hyper3d', 'tripo3d']) {
      const task = await relayAssets.createThreeDTask({
        providerId,
        imageDataUrl: localReference,
        prompt: 'Atlas 3D model',
        userId: `atlas-${providerId}-owner`
      }, { now: 1_800_000_000_000 });
      assert.equal(task.status, 'queued');
      const status = await relayAssets.getThreeDStatus({
        taskToken: task.taskToken,
        userId: `atlas-${providerId}-owner`
      }, { now: 1_800_000_001_000 });
      assert.equal(status.status, 'succeeded');
      assert.equal(status.previewImageUrl, 'https://storage.atlascloud.ai/models/preview.png');
      const model = await relayAssets.downloadThreeDModel({
        taskToken: task.taskToken,
        userId: `atlas-${providerId}-owner`
      }, { now: 1_800_000_002_000 });
      assert.deepEqual(model, atlasGlb);
    }

    const screenshotFirstFrame = await providers.createVideoTask({
      providerId: 'video-3', prompt: 'subtle natural portrait motion',
      urls: [localReference], referenceMediaTypes: ['image'], videoMode: 'first-frame',
      resolution: '1080P', aspectRatio: 'adaptive', duration: 6,
      generateAudio: true, outputFormat: 'mp4'
    });
    assert.match(screenshotFirstFrame.taskId, /^messs-route:atlas-video-seedance25-i2v:atlas-video-request$/);

    const screenshotOmni = await providers.createVideoTask({
      providerId: 'video-3', prompt: 'cinematic portrait with controlled camera motion',
      urls: [localReference], referenceMediaTypes: ['image'], videoMode: 'omni',
      resolution: '1080P', aspectRatio: '3:4', duration: 6,
      generateAudio: true, outputFormat: 'mp4'
    });
    assert.match(screenshotOmni.taskId, /^messs-route:atlas-video-seedance25-ref:atlas-video-request$/);

    process.env.AI_GATEWAY_PUBLIC_URL = 'https://gateway.example.com';
    const localVideo = relayAssets.storeAi302RelayAsset({
      buffer: Buffer.from('0000000000000000'), mime: 'video/mp4', extension: 'mp4'
    });
    const localAudio = relayAssets.storeAi302RelayAsset({
      buffer: Buffer.from('0000000000000000'), mime: 'audio/mpeg', extension: 'mp3'
    });
    const localMultimodal = await providers.createVideoTask({
      providerId: 'video-3', prompt: 'use local video and audio references',
      urls: [localVideo.url], referenceMediaTypes: ['video'], referenceAudioUrls: [localAudio.url],
      videoMode: 'omni', resolution: '720P', aspectRatio: 'adaptive', duration: 6,
      generateAudio: true, outputFormat: 'mp4'
    });
    assert.match(localMultimodal.taskId, /^messs-route:atlas-video-seedance25-ref:atlas-video-request$/);

    const firstLast = await providers.createVideoTask({
      providerId: 'video-3', prompt: 'first and last frame',
      urls: ['https://cdn.example.com/first.png', 'https://cdn.example.com/last.png'],
      referenceMediaTypes: ['image', 'image'], videoMode: 'first-last-frame',
      // A source image may carry an explicit 16:9 ratio in older generation
      // metadata. Seedance 2.5 I2V must normalize it to adaptive upstream.
      resolution: '1080P-ESR', aspectRatio: '16:9', duration: 30,
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
    await providers.createVideoTask({
      providerId: 'video-3', prompt: 'full reference follows a 16:9 source',
      urls: ['https://cdn.example.com/source.png'], referenceMediaTypes: ['image'],
      videoMode: 'omni', resolution: '1080P-ESR & 60FPS', aspectRatio: 'adaptive', duration: 6,
      outputFormat: 'mp4'
    });

    const imageRequest = requests.find((entry) => entry.endpoint.endsWith('/generateImage'));
    assert.equal(imageRequest.body.model, 'openai/gpt-image-2/text-to-image');
    assert.equal(imageRequest.body.size, '1920x1072');
    assert.equal(imageRequest.body.output_format, 'png');
    const automaticQualityRequest = requests.find((entry) => entry.endpoint.endsWith('/generateImage') && entry.body.prompt === 'automatic quality');
    assert.equal(automaticQualityRequest.body.quality, 'medium');
    const frameRequest = requests.find((entry) => entry.endpoint.endsWith('/generateVideo')
      && entry.body.model === 'bytedance/seedance-2.5/image-to-video' && entry.body.last_image);
    assert.equal(frameRequest.body.model, 'bytedance/seedance-2.5/image-to-video');
    assert.equal(frameRequest.body.generate_audio, false);
    assert.equal(frameRequest.body.resolution, '1080p-esr');
    assert.equal(frameRequest.body.duration, 30);
    assert.equal(frameRequest.body.ratio, 'adaptive');
    const extendRequest = requests.find((entry) => entry.endpoint.endsWith('/generateVideo') && entry.body.omni_reference_task_type === 'extend');
    assert.equal(extendRequest.body.model, 'bytedance/seedance-2.5/reference-to-video');
    assert.equal(extendRequest.body.duration, 10);
    assert.equal(extendRequest.body.output_format, 'mov');
    const inferredReferenceRequest = requests.find((entry) => entry.body && entry.body.reference_videos && entry.body.reference_videos.includes('https://cdn.example.com/reference.mp4'));
    assert.equal(inferredReferenceRequest.body.model, 'bytedance/seedance-2.5/reference-to-video');
    assert.equal(inferredReferenceRequest.body.omni_reference_task_type, 'auto');
    assert.equal(Object.hasOwn(inferredReferenceRequest.body, 'watermark'), false);
    assert.equal(Object.hasOwn(inferredReferenceRequest.body, 'return_last_frame'), false);
    const editRequest = requests.find((entry) => entry.body && entry.body.omni_reference_task_type === 'edit');
    assert.equal(editRequest.body.duration, -1);
    const seedance20ReferenceRequest = requests.find((entry) => entry.body && entry.body.model === 'bytedance/seedance-2.0/reference-to-video');
    assert.equal(seedance20ReferenceRequest.body.reference_audios.length, 1);
    assert.equal(seedance20ReferenceRequest.body.seed, 123);
    assert.equal(seedance20ReferenceRequest.body.bitrate_mode, 'high');
    assert.equal(seedance20ReferenceRequest.body.watermark, true);
    const seedance20I2vRequest = requests.find((entry) => entry.body && entry.body.model === 'bytedance/seedance-2.0/image-to-video' && entry.body.image);
    assert.equal(seedance20I2vRequest.body.ratio, '9:16');
    assert.equal(seedance20I2vRequest.body.duration, -1);
    const audioOnlyRequest = requests.find((entry) => entry.body && entry.body.model === 'bytedance/seedance-2.5/reference-to-video' && entry.body.reference_audios && entry.body.reference_audios.length > 0);
    const fullReferenceRequest = requests.find((entry) => entry.body
      && typeof entry.body.prompt === 'string'
      && entry.body.prompt.includes('full reference follows a 16:9 source'));
    const h3ImageRequest = requests.find((entry) => entry.body && entry.body.model === 'minimax/h3/image-to-video' && entry.body.image);
    const h3FirstLastRequest = requests.find((entry) => entry.body && entry.body.model === 'minimax/h3/image-to-video' && entry.body.end_image);
    const h3ReferenceRequest = requests.find((entry) => entry.body && entry.body.model === 'minimax/h3/reference-to-video');
    assert.match(h3ImageRequest.body.image, /^data:image\/png;base64,/);
    assert.equal(h3FirstLastRequest.body.end_image, 'https://cdn.example.com/h3-last.png');
    assert.equal(h3FirstLastRequest.body.last_image, undefined);
    assert.equal(h3FirstLastRequest.body.ratio, 'adaptive');
    assert.deepEqual(h3ReferenceRequest.body.refers, [
      { url: 'https://cdn.example.com/h3-reference.png', type: 'image' }
    ]);
    assert.equal(h3ReferenceRequest.body.output_format, undefined);
    assert.equal(h3ReferenceRequest.body.generate_audio, undefined);
    assert.equal(fullReferenceRequest.body.model, 'bytedance/seedance-2.5/reference-to-video');
    assert.equal(fullReferenceRequest.body.ratio, 'adaptive');
    assert.equal(fullReferenceRequest.body.resolution, '1080p-esr & 60fps');
    assert.equal(audioOnlyRequest.body.reference_images.length, 0);
    assert.equal(audioOnlyRequest.body.reference_audios.length, 1);

    const mediaUploads = requests.filter((entry) => entry.endpoint.endsWith('/uploadMedia')).slice(-4);
    assert.equal(mediaUploads.length, 4);
    assert.deepEqual(mediaUploads.map((entry) => entry.name), [
      'reference.png', 'reference.png', 'reference.mp4', 'reference.mp3'
    ]);
    assert.deepEqual(mediaUploads.map((entry) => entry.type), [
      'image/png', 'image/png', 'video/mp4', 'audio/mpeg'
    ]);
    assert.ok(mediaUploads.every((entry) => entry.size > 0));
    const screenshotFirstFrameRequest = requests.find((entry) => entry.body && entry.body.prompt === 'subtle natural portrait motion');
    assert.equal(screenshotFirstFrameRequest.body.image, mediaUploads[0].url);
    assert.equal(screenshotFirstFrameRequest.body.resolution, '1080p');
    assert.equal(screenshotFirstFrameRequest.body.duration, 6);
    assert.equal(screenshotFirstFrameRequest.body.ratio, 'adaptive');
    const screenshotOmniRequest = requests.find((entry) => entry.body
      && typeof entry.body.prompt === 'string'
      && entry.body.prompt.includes('cinematic portrait with controlled camera motion'));
    assert.deepEqual(screenshotOmniRequest.body.reference_images, [mediaUploads[1].url]);
    assert.equal(screenshotOmniRequest.body.resolution, '1080p');
    assert.equal(screenshotOmniRequest.body.duration, 6);
    assert.equal(screenshotOmniRequest.body.ratio, '3:4');
    assert.equal(screenshotOmniRequest.body.omni_reference_task_type, 'auto');
    const localMultimodalRequest = requests.find((entry) => entry.body
      && typeof entry.body.prompt === 'string'
      && entry.body.prompt.includes('use local video and audio references'));
    assert.deepEqual(localMultimodalRequest.body.reference_videos, [mediaUploads[2].url]);
    assert.deepEqual(localMultimodalRequest.body.reference_audios, [mediaUploads[3].url]);

    // Atlas installations using the older Volcengine spelling may reject the
    // generic task type. A rejected request has no task id, so the adapter may
    // safely retry once with that alias.
    const aliasRequests = [];
    const previousAliasFetch = global.fetch;
    global.fetch = async (url, options = {}) => {
      const endpoint = String(url);
      if (!endpoint.endsWith('/generateVideo')) throw new Error(`Unexpected alias test request: ${endpoint}`);
      const body = JSON.parse(options.body);
      aliasRequests.push(body);
      if (body.omni_reference_task_type === 'auto') {
        return new Response(JSON.stringify({ message: 'unsupported task type' }), { status: 400 });
      }
      return new Response(JSON.stringify({ request_id: 'atlas-alias-request' }), { status: 200 });
    };
    const aliasTask = await providers.createVideoTask({
      providerId: 'video-3', prompt: 'compatibility alias',
      urls: ['https://cdn.example.com/alias.mp4'], referenceMediaTypes: ['video'],
      videoMode: 'omni', resolution: '720P', aspectRatio: 'adaptive', duration: 8,
      outputFormat: 'mp4'
    });
    global.fetch = previousAliasFetch;
    assert.match(aliasTask.taskId, /^messs-route:atlas-video-seedance25-ref:atlas-alias-request$/);
    assert.deepEqual(aliasRequests.map((body) => body.omni_reference_task_type), ['auto', 'reference']);

    const previousValidationFetch = global.fetch;
    global.fetch = async (url) => {
      const endpoint = String(url);
      if (!endpoint.endsWith('/generateVideo')) throw new Error(`Unexpected validation test request: ${endpoint}`);
      return new Response(JSON.stringify({
        error: {
          detail: [{ loc: ['body', 'resolution'], msg: 'resolution must be one of the supported native values' }],
          message: 'reference URL https://private.example.com/input.png was rejected'
        }
      }), { status: 400 });
    };
    await assert.rejects(
      providers.createVideoTask({
        providerId: 'video-3', prompt: 'preserve provider validation detail',
        urls: ['https://cdn.example.com/frame.png'], referenceMediaTypes: ['image'],
        videoMode: 'first-frame', resolution: '1080P', aspectRatio: 'adaptive', duration: 6,
        outputFormat: 'mp4'
      }),
      (error) => error && error.code === 'provider-request-failed'
        && /resolution must be one of the supported native values/.test(error.message)
        && !/private\.example\.com/.test(error.message)
    );
    global.fetch = previousValidationFetch;

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
    delete process.env.AI_GATEWAY_PUBLIC_URL;
  }
  console.log('Atlas Cloud provider tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
