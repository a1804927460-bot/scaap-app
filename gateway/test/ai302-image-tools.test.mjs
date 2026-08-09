import assert from 'node:assert/strict';
import test from 'node:test';
import zlib from 'node:zlib';
import fs from 'node:fs';
import {
  downloadAi302ImageResult,
  eraseImageObjects,
  pollQwenImageEdit,
  pollQwenImageLayered,
  submitQwenImageEdit,
  submitQwenImageLayered,
  superUpscaleImage
} from '../src/ai302-image-tools.js';
import { getAi302RelayAsset, validatePng } from '../src/ai302-tools.js';

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBytes = Buffer.from(type, 'ascii');
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  typeBytes.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return result;
}

function rgbaPng({ metadata = false } = {}) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  const chunks = [
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header)
  ];
  if (metadata) chunks.push(pngChunk('tEXt', Buffer.from('Location\0private-metadata', 'latin1')));
  chunks.push(pngChunk('IDAT', zlib.deflateSync(Buffer.from([0, 255, 0, 0, 0]))));
  chunks.push(pngChunk('IEND'));
  return Buffer.concat(chunks);
}

function imageDataUrl(buffer, mime = 'image/png') {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}

function relayToken(urlValue) {
  return new URL(urlValue).pathname.split('/').at(-1);
}

test('Qwen Image Edit Plus submits sanitized relay images and polls with an owner-bound opaque token', async () => {
  const source = rgbaPng({ metadata: true });
  let createBody;
  const created = await submitQwenImageEdit({
    imageDataUrls: [imageDataUrl(source)],
    prompt: 'Turn the jacket red',
    toolOptions: { width: 1024, height: 768, numInferenceSteps: 24, guidanceScale: 3.5 },
    userId: 'edit-owner'
  }, {
    apiKey: 'server-only-302-key',
    taskSecret: 'independent-image-token-secret',
    publicBaseUrl: 'https://gateway.example.com',
    now: 1_800_000_000_000,
    fetchImpl: async (url, options) => {
      assert.equal(String(url), 'https://api.302.ai/302/submit/qwen-image-edit-plus');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Bearer server-only-302-key');
      createBody = JSON.parse(options.body);
      return jsonResponse({
        request_id: 'private-edit-request-id',
        status: 'IN_QUEUE',
        queue_position: 0
      });
    }
  });

  assert.equal(created.taskToken.includes('private-edit-request-id'), false);
  assert.deepEqual(
    { status: created.status, retryAfterMs: created.retryAfterMs, urls: created.urls },
    { status: 'queued', retryAfterMs: 5000, urls: [] }
  );
  assert.deepEqual(createBody, {
    prompt: 'Turn the jacket red',
    image_urls: [createBody.image_urls[0]],
    image_size: { width: 1024, height: 768 },
    num_inference_steps: 24,
    guidance_scale: 3.5,
    output_format: 'png',
    negative_prompt: 'blurry, ugly'
  });
  assert.match(createBody.image_urls[0], /^https:\/\/gateway\.example\.com\/v1\/tools\/assets\/[A-Za-z0-9_-]{43}$/);
  const relayed = getAi302RelayAsset(relayToken(createBody.image_urls[0]), { now: 1_800_000_001_000 });
  assert.equal(relayed.buffer.includes(Buffer.from('private-metadata')), false);
  assert.equal(relayed.mime, 'image/png');

  const pending = await pollQwenImageEdit({ taskToken: created.taskToken, userId: 'edit-owner' }, {
    apiKey: 'server-only-302-key',
    taskSecret: 'independent-image-token-secret',
    now: 1_800_000_005_000,
    fetchImpl: async (url, options) => {
      assert.equal(String(url), 'https://api.302.ai/302/submit/qwen-image-edit-plus?request_id=private-edit-request-id');
      assert.equal(options.method, 'GET');
      assert.equal(options.headers.Authorization, 'Bearer server-only-302-key');
      return jsonResponse({ status: 'PROCESSING' });
    }
  });
  assert.deepEqual(pending, { status: 'processing', retryAfterMs: 5000, urls: [] });

  const complete = await pollQwenImageEdit({ taskToken: created.taskToken, userId: 'edit-owner' }, {
    apiKey: 'server-only-302-key',
    taskSecret: 'independent-image-token-secret',
    now: 1_800_000_010_000,
    fetchImpl: async () => jsonResponse({
      images: [{ url: 'https://file.302.ai/gpt/imgs/result.png', content_type: 'image/png' }]
    })
  });
  assert.deepEqual(complete, {
    status: 'succeeded',
    retryAfterMs: 0,
    urls: ['https://file.302.ai/gpt/imgs/result.png']
  });

  await assert.rejects(
    () => pollQwenImageEdit({ taskToken: created.taskToken, userId: 'different-owner' }, {
      apiKey: 'server-only-302-key',
      taskSecret: 'independent-image-token-secret',
      now: 1_800_000_010_000,
      fetchImpl: async () => { throw new Error('must not fetch'); }
    }),
    { code: 'image-tool-task-not-found', status: 404 }
  );
});

test('Qwen Image Layered submits one relay and accepts only allowlisted result URLs', async () => {
  const source = rgbaPng();
  let submitBody;
  const created = await submitQwenImageLayered({
    imageDataUrl: imageDataUrl(source),
    prompt: 'Separate foreground, subject, shadow, and background',
    numLayers: 4,
    userId: 'layer-owner'
  }, {
    apiKey: 'layer-key',
    taskSecret: 'layer-task-secret',
    publicBaseUrl: 'https://gateway.example.com',
    now: 1_800_000_000_000,
    fetchImpl: async (url, options) => {
      assert.equal(String(url), 'https://api.302.ai/302/submit/qwen-image-layered');
      submitBody = JSON.parse(options.body);
      return jsonResponse({ request_id: 'private-layer-request-id', status: 'IN_QUEUE' });
    }
  });
  assert.deepEqual(submitBody, {
    image_url: submitBody.image_url,
    prompt: 'Separate foreground, subject, shadow, and background',
    num_layers: 4,
    enable_safety_checker: true,
    output_format: 'png'
  });
  assert.match(submitBody.image_url, /^https:\/\/gateway\.example\.com\/v1\/tools\/assets\//);

  const complete = await pollQwenImageLayered({ taskToken: created.taskToken, userId: 'layer-owner' }, {
    apiKey: 'layer-key',
    taskSecret: 'layer-task-secret',
    now: 1_800_000_002_000,
    fetchImpl: async (url) => {
      assert.equal(String(url), 'https://api.302.ai/302/submit/qwen-image-layered?request_id=private-layer-request-id');
      return jsonResponse({
        images: [
          { url: 'https://file.302.ai/layers/base.png' },
          { url: 'https://v3b.fal.media/files/layer-1.png' }
        ]
      });
    }
  });
  assert.deepEqual(complete, {
    status: 'succeeded',
    retryAfterMs: 0,
    urls: [
      'https://file.302.ai/layers/base.png',
      'https://v3b.fal.media/files/layer-1.png'
    ]
  });

  await assert.rejects(
    () => pollQwenImageLayered({ taskToken: created.taskToken, userId: 'layer-owner' }, {
      apiKey: 'layer-key',
      taskSecret: 'layer-task-secret',
      now: 1_800_000_003_000,
      fetchImpl: async () => jsonResponse({ images: [{ url: 'https://file.302.ai.evil.test/result.png' }] })
    }),
    { code: 'unsafe-tool-result-url', status: 502 }
  );
});

test('Super Upscale V2 is synchronous, bounded, and releases its temporary relay', async () => {
  const source = rgbaPng();
  let body;
  const result = await superUpscaleImage({
    imageDataUrl: imageDataUrl(source),
    toolOptions: { scale: 3, creativity: 0.25, detail: 2, shapePreservation: 0.15 }
  }, {
    apiKey: 'upscale-key',
    publicBaseUrl: 'https://gateway.example.com',
    now: 1_800_000_000_000,
    fetchImpl: async (url, options) => {
      assert.equal(String(url), 'https://api.302.ai/302/submit/super-upscale-v2');
      assert.equal(options.headers.Authorization, 'Bearer upscale-key');
      body = JSON.parse(options.body);
      return jsonResponse({ image: { url: 'https://file.302.ai/upscale/result.png' } });
    }
  });
  assert.deepEqual(result, {
    status: 'succeeded', retryAfterMs: 0, urls: ['https://file.302.ai/upscale/result.png']
  });
  assert.deepEqual(body, {
    model_type: 'SDXL',
    scale: 3,
    creativity: 0.25,
    detail: 2,
    shape_preservation: 0.15,
    prompt_suffix: 'high quality, highly detailed, high resolution, sharp',
    negative_prompt: 'blurry, low resolution, bad, ugly, low quality, pixelated, interpolated, compression artifacts, noisy, grainy',
    guidance_scale: 7.5,
    num_inference_steps: 20,
    override_size_limits: false,
    image_url: body.image_url
  });
  assert.throws(
    () => getAi302RelayAsset(relayToken(body.image_url), { now: 1_800_000_001_000 }),
    { code: 'tool-asset-not-found' }
  );

  await assert.rejects(
    () => superUpscaleImage({
      imageDataUrl: imageDataUrl(source), toolOptions: { scale: 12 }
    }, {
      apiKey: 'upscale-key', publicBaseUrl: 'https://gateway.example.com',
      fetchImpl: async () => { throw new Error('must not fetch'); }
    }),
    { code: 'invalid-image-tool-options', status: 400 }
  );
});

test('Erase sends sanitized multipart image and mask files and returns one safe URL', async () => {
  const source = rgbaPng({ metadata: true });
  const mask = rgbaPng({ metadata: true });
  let form;
  const result = await eraseImageObjects({
    imageDataUrl: imageDataUrl(source),
    maskImageDataUrl: imageDataUrl(mask)
  }, {
    apiKey: 'erase-key',
    fetchImpl: async (url, options) => {
      assert.equal(String(url), 'https://api.302.ai/302/submit/erase');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Bearer erase-key');
      assert.equal(options.headers.Accept, 'image/*');
      assert.equal(options.headers['Content-Type'], undefined);
      form = options.body;
      return jsonResponse({ image: { url: 'https://file.302.ai/erase/result.png' } });
    }
  });
  assert.deepEqual(result, {
    status: 'succeeded', retryAfterMs: 0, urls: ['https://file.302.ai/erase/result.png']
  });
  const imageFile = form.get('image_url');
  const maskFile = form.get('mask_image_url');
  assert.equal(imageFile.name, 'image.png');
  assert.equal(maskFile.name, 'mask.png');
  assert.equal(Buffer.from(await imageFile.arrayBuffer()).includes(Buffer.from('private-metadata')), false);
  assert.equal(Buffer.from(await maskFile.arrayBuffer()).includes(Buffer.from('private-metadata')), false);
});

test('result downloads follow only allowlisted redirects, omit the 302 key, and validate PNG bytes', async () => {
  const output = rgbaPng();
  const calls = [];
  const downloaded = await downloadAi302ImageResult('https://file.302.ai/result/start.png', {
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (calls.length === 1) {
        return new Response(null, {
          status: 302,
          headers: { Location: 'https://v3b.fal.media/files/final.png' }
        });
      }
      return new Response(output, { status: 200, headers: { 'Content-Type': 'image/png' } });
    }
  });
  assert.deepEqual(downloaded, output);
  assert.equal(validatePng(downloaded), true);
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(calls[1].options.headers.Authorization, undefined);
  assert.equal(calls[1].url, 'https://v3b.fal.media/files/final.png');

  await assert.rejects(
    () => downloadAi302ImageResult('https://file.302.ai/result/start.png', {
      fetchImpl: async () => new Response(null, {
        status: 302,
        headers: { Location: 'http://127.0.0.1/private.png' }
      })
    }),
    { code: 'unsafe-tool-result-url', status: 502 }
  );
});

test('gateway wires every image tool route through durable credits and opaque result downloads', () => {
  const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.match(
    server,
    /url\.pathname === '\/v1\/tools\/image\/edit'[\s\S]*?runIdempotentImageOperation\(user\.id, requestId[\s\S]*?reserveFixedTool\(user\.id, modelId, requestId\)[\s\S]*?submitQwenImageEdit[\s\S]*?accountingRequestId: usage\.requestId/
  );
  assert.match(
    server,
    /url\.pathname === '\/v1\/tools\/image\/layer'[\s\S]*?runIdempotentImageOperation\(user\.id, requestId[\s\S]*?reserveFixedTool\(user\.id, modelId, requestId\)[\s\S]*?submitQwenImageLayered[\s\S]*?accountingRequestId: usage\.requestId/
  );
  assert.match(
    server,
    /url\.pathname === '\/v1\/tools\/image\/status'[\s\S]*?touchToolUsage[\s\S]*?settleToolUsage[\s\S]*?resultCount/
  );
  assert.match(
    server,
    /url\.pathname === '\/v1\/tools\/image\/download'[\s\S]*?result\.status !== 'succeeded'[\s\S]*?downloadAi302ImageResult/
  );
  assert.match(
    server,
    /url\.pathname === '\/v1\/tools\/image\/upscale'[\s\S]*?reserveFixedTool[\s\S]*?superUpscaleImage[\s\S]*?settleToolUsage\(user\.id, usage\.requestId, 'succeeded'/
  );
  assert.match(
    server,
    /url\.pathname === '\/v1\/tools\/image\/erase'[\s\S]*?reserveFixedTool[\s\S]*?eraseImageObjects[\s\S]*?settleToolUsage\(user\.id, usage\.requestId, 'succeeded'/
  );
  assert.doesNotMatch(
    server,
    /url\.pathname === '\/v1\/tools\/image\/status'[\s\S]*?urls:\s*result\.urls/
  );
});
