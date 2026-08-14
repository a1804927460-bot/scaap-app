import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import zlib from 'node:zlib';
import {
  createThreeDTask,
  createVideoUploadSession,
  createVideoUpscaleTask,
  downloadThreeDModel,
  downloadVideoUpscaleResult,
  appendVideoUploadChunk,
  consumeVideoUpload,
  getAi302RelayAsset,
  getThreeDStatus,
  getVideoUpscaleStatus,
  normalizeThreeDOptions,
  normalizeVideoUpscaleOptions,
  parseImageDataUrl,
  parseVideoDataUrl,
  removeBackground,
  stripImageMetadata,
  validateAssetUrl,
  validateGlb,
  validatePng,
  validateVideo
} from '../src/ai302-tools.js';
import {
  TOPAZ_RETAIL_CREDIT_MULTIPLIER,
  quoteTopazRetailCredits
} from '../src/tool-pricing.js';

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

function glbFixture() {
  const rawJson = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{}] }), 'utf8');
  const jsonLength = Math.ceil(rawJson.length / 4) * 4;
  const json = Buffer.alloc(jsonLength, 0x20);
  rawJson.copy(json);
  const result = Buffer.alloc(12 + 8 + json.length);
  result.write('glTF', 0, 'ascii');
  result.writeUInt32LE(2, 4);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(json.length, 12);
  result.writeUInt32LE(0x4e4f534a, 16);
  json.copy(result, 20);
  return result;
}

function mp4Fixture() {
  const result = Buffer.alloc(24);
  result.writeUInt32BE(result.length, 0);
  result.write('ftyp', 4, 'ascii');
  result.write('isom', 8, 'ascii');
  result.writeUInt32BE(0x200, 12);
  result.write('isomiso2', 16, 'ascii');
  return result;
}

function videoDataUrl(buffer, mime = 'video/mp4') {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

test('image data URLs are strict and metadata is removed without corrupting PNG data', () => {
  const original = rgbaPng({ metadata: true });
  const parsed = parseImageDataUrl(imageDataUrl(original));
  const sanitized = stripImageMetadata(parsed);
  assert.equal(sanitized.buffer.includes(Buffer.from('private-metadata')), false);
  assert.equal(sanitized.buffer.includes(Buffer.from('tEXt')), false);
  assert.equal(validatePng(sanitized.buffer, { requireTransparency: true }), true);
  assert.throws(
    () => parseImageDataUrl(imageDataUrl(original, 'image/jpeg')),
    (error) => error && error.code === 'invalid-image-data' && error.status === 400
  );
  assert.throws(
    () => parseImageDataUrl(imageDataUrl(original), { maxBytes: 16 }),
    (error) => error && error.code === 'image-too-large' && error.status === 413
  );
});

test('background removal uses fixed upstream options and accepts a direct transparent PNG', async () => {
  const input = rgbaPng();
  const output = rgbaPng();
  const calls = [];
  const fetchMock = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(output, { status: 200, headers: { 'Content-Type': 'image/png' } });
  };
  const result = await removeBackground({ imageDataUrl: imageDataUrl(input) }, {
    apiKey: 'Bearer test-302-key',
    fetchImpl: fetchMock
  });
  assert.deepEqual(result, output);
  assert.equal(calls[0].url, 'https://api.302.ai/photoroom/v1/segment?response_format=original');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-302-key');
  assert.equal(calls[0].options.body.get('format'), 'png');
  assert.equal(calls[0].options.body.get('channels'), 'rgba');
  assert.equal(calls[0].options.body.get('size'), 'full');
  assert.equal(calls.length, 1);
  assert.equal(JSON.stringify(result).includes('test-302-key'), false);
});

test('302 authorization failures are explicit and background options follow the documented form', async () => {
  let submittedForm;
  await assert.rejects(
    () => removeBackground({
      imageDataUrl: imageDataUrl(rgbaPng()),
      toolOptions: { size: 'hd', crop: true, despill: false }
    }, {
      apiKey: 'rejected-key',
      fetchImpl: async (_url, options) => {
        submittedForm = options.body;
        return new Response(null, { status: 401 });
      }
    }),
    { code: 'ai302-unauthorized', status: 503 }
  );
  assert.equal(submittedForm.get('size'), 'hd');
  assert.equal(submittedForm.get('crop'), 'true');
  assert.equal(submittedForm.get('despill'), 'false');
});

test('background removal distinguishes a provider timeout from a transport outage', async () => {
  await assert.rejects(
    () => removeBackground({ imageDataUrl: imageDataUrl(rgbaPng()) }, {
      apiKey: 'timeout-background-key',
      signal: AbortSignal.abort(new DOMException('timed out', 'TimeoutError')),
      fetchImpl: async (_url, options) => { throw options.signal.reason; }
    }),
    { code: 'ai302-timeout', status: 504 }
  );
});

test('provider-specific 3D options reject unsupported combinations before submission', () => {
  assert.throws(
    () => normalizeThreeDOptions('hunyuan3d', { model: '3.1', generateType: 'LowPoly' }),
    { code: 'invalid-three-d-options', status: 400 }
  );
  assert.throws(
    () => normalizeThreeDOptions('hyper3d', { quality: 'ultra' }),
    { code: 'invalid-three-d-options', status: 400 }
  );
  assert.throws(
    () => normalizeThreeDOptions('tripo3d', { modelVersion: 'unknown-version' }),
    { code: 'invalid-three-d-options', status: 400 }
  );
});

test('asset URLs reject non-provider hosts, credentials, ports, fragments, and IP literals', () => {
  assert.equal(validateAssetUrl('https://file.302.ai/model.glb').hostname, 'file.302.ai');
  assert.equal(validateAssetUrl('https://bucket.cos.ap-guangzhou.myqcloud.com/model.glb').hostname, 'bucket.cos.ap-guangzhou.myqcloud.com');
  assert.equal(
    validateAssetUrl('https://hunyuan-prod-1258344699.cos.ap-guangzhou.tencentcos.cn/model.glb').hostname,
    'hunyuan-prod-1258344699.cos.ap-guangzhou.tencentcos.cn'
  );
  assert.equal(
    validateAssetUrl('https://tripo-data.rg1.data.tripo3d.com/task/model.glb?Policy=signed').hostname,
    'tripo-data.rg1.data.tripo3d.com'
  );
  for (const value of [
    'http://file.302.ai/model.glb',
    'https://file.302.ai.evil.test/model.glb',
    'https://user:pass@file.302.ai/model.glb',
    'https://file.302.ai:8443/model.glb',
    'https://127.0.0.1/model.glb',
    'https://[::1]/model.glb',
    'https://file.302.ai/model.glb#fragment'
  ]) {
    assert.throws(() => validateAssetUrl(value), { code: 'unsafe-tool-result-url' });
  }
});

test('HUNYUAN3D task tokens hide the job, bind the user and provider, and normalize status', async () => {
  const input = rgbaPng({ metadata: true });
  let createBody;
  const createFetch = async (url, options) => {
    assert.equal(String(url), 'https://api.302.ai/tencent/hunyuan3d/pro-job');
    createBody = JSON.parse(options.body);
    return jsonResponse({ data: { Response: { JobId: 'private-hunyuan-job-id', RequestId: 'request-id' } } });
  };
  const created = await createThreeDTask({
    providerId: 'hunyuan3d',
    imageDataUrl: imageDataUrl(input),
    prompt: 'not sent with image mode',
    userId: 'user-one'
  }, {
    apiKey: 'test-key',
    taskSecret: 'independent-task-secret',
    fetchImpl: createFetch,
    now: 1_800_000_000_000
  });
  assert.deepEqual({ status: created.status, retryAfterMs: created.retryAfterMs }, { status: 'queued', retryAfterMs: 5000 });
  assert.equal(created.taskToken.includes('private-hunyuan-job-id'), false);
  assert.deepEqual(Object.keys(createBody).sort(), ['EnablePBR', 'GenerateType', 'ImageBase64', 'Model']);
  assert.equal(createBody.Model, '3.0');
  assert.equal(createBody.GenerateType, 'Normal');
  assert.equal(createBody.EnablePBR, false);
  assert.equal(Buffer.from(createBody.ImageBase64, 'base64').includes(Buffer.from('private-metadata')), false);

  const status = await getThreeDStatus({ taskToken: created.taskToken, userId: 'user-one' }, {
    apiKey: 'test-key',
    taskSecret: 'independent-task-secret',
    now: 1_800_000_001_000,
    fetchImpl: async (url) => {
      assert.equal(String(url), 'https://api.302.ai/tencent/hunyuan3d/pro-job/private-hunyuan-job-id');
      return jsonResponse({ result: { Response: { Status: 'RUN' } } });
    }
  });
  assert.deepEqual(status, { status: 'processing', retryAfterMs: 5000 });
  const pendingWithoutStatus = await getThreeDStatus({ taskToken: created.taskToken, userId: 'user-one' }, {
    apiKey: 'test-key',
    taskSecret: 'independent-task-secret',
    now: 1_800_000_001_500,
    fetchImpl: async () => jsonResponse({ Response: { RequestId: 'request-id', ErrorCode: '', ErrorMessage: '' } })
  });
  assert.deepEqual(pendingWithoutStatus, { status: 'queued', retryAfterMs: 5000 });
  for (const upstreamStatus of ['PENDING_QUEUE', 'WAITING_TO_RUN', 'NOT_STARTED', 'SUBMITTED']) {
    let settled = false;
    const queued = await getThreeDStatus({ taskToken: created.taskToken, userId: 'user-one' }, {
      apiKey: 'test-key',
      taskSecret: 'independent-task-secret',
      now: 1_800_000_001_600,
      fetchImpl: async () => jsonResponse({ Response: { Status: upstreamStatus } }),
      settleCredits: async () => {
        settled = true;
        return { ok: true };
      }
    });
    assert.deepEqual(queued, { status: 'queued', retryAfterMs: 5000 });
    assert.equal(settled, false, `${upstreamStatus} must remain queued without settling credits`);
  }
  const creating = await getThreeDStatus({ taskToken: created.taskToken, userId: 'user-one' }, {
    apiKey: 'test-key',
    taskSecret: 'independent-task-secret',
    now: 1_800_000_001_650,
    fetchImpl: async () => jsonResponse({ Response: { Status: 'CREATING' } })
  });
  assert.deepEqual(creating, { status: 'processing', retryAfterMs: 5000 });
  const failed = await getThreeDStatus({ taskToken: created.taskToken, userId: 'user-one' }, {
    apiKey: 'test-key',
    taskSecret: 'independent-task-secret',
    now: 1_800_000_001_700,
    fetchImpl: async () => jsonResponse({ Response: { Status: 'ERROR', ErrorCode: 'UPSTREAM_BUSY' } })
  });
  assert.deepEqual(failed, {
    status: 'failed', retryAfterMs: 0,
    errorCode: 'three-d-generation-failed', errorMessage: '3D generation failed.'
  });
  await assert.rejects(
    () => getThreeDStatus({ taskToken: created.taskToken, userId: 'user-two' }, {
      apiKey: 'test-key',
      taskSecret: 'independent-task-secret',
      now: 1_800_000_001_000,
      fetchImpl: async () => { throw new Error('must not fetch'); }
    }),
    (error) => error && error.code === 'three-d-task-not-found' && error.status === 404
  );
});

test('Hyper3D receives a short-lived metadata-free image relay and uses the documented contract', async () => {
  const input = rgbaPng({ metadata: true });
  let requestBody;
  const created = await createThreeDTask({
    providerId: 'hyper3d',
    imageDataUrl: imageDataUrl(input),
    prompt: 'A precise product model',
    toolOptions: { quality: 'high', material: 'Shaded', tier: 'Sketch', useHyper: true, tPose: true, seed: 42 },
    userId: 'user-hyper'
  }, {
    apiKey: 'test-key',
    taskSecret: 'independent-task-secret',
    publicBaseUrl: 'https://gateway.example.com',
    now: 1_800_000_000_000,
    fetchImpl: async (url, options) => {
      assert.equal(String(url), 'https://api.302.ai/302/submit/hyper3d-rodin');
      requestBody = JSON.parse(options.body);
      return jsonResponse({ data: { requestId: 'private-hyper-job-id', status: 'IN_QUEUE', queue_position: 2 } });
    }
  });
  assert.equal(created.status, 'queued');
  assert.equal(created.taskToken.includes('private-hyper-job-id'), false);
  assert.deepEqual({
    prompt: requestBody.prompt,
    condition_mode: requestBody.condition_mode,
    geometry_file_format: requestBody.geometry_file_format,
    material: requestBody.material,
    quality: requestBody.quality,
    tier: requestBody.tier,
    use_hyper: requestBody.use_hyper,
    TAPose: requestBody.TAPose
  }, {
    prompt: 'A precise product model',
    condition_mode: 'concat',
    geometry_file_format: 'glb',
    material: 'Shaded',
    quality: 'high',
    tier: 'Sketch',
    use_hyper: true,
    TAPose: true
  });
  assert.equal(requestBody.seed, 42);
  const relayUrl = new URL(requestBody.input_image_urls[0]);
  assert.equal(relayUrl.origin, 'https://gateway.example.com');
  const relayToken = relayUrl.pathname.split('/').at(-1);
  const relay = getAi302RelayAsset(relayToken, { now: 1_800_000_001_000 });
  assert.equal(relay.mime, 'image/png');
  assert.equal(relay.buffer.includes(Buffer.from('private-metadata')), false);
  assert.throws(
    () => getAi302RelayAsset(relayToken, { now: 1_800_000_901_000 }),
    { code: 'tool-asset-not-found' }
  );

  const status = await getThreeDStatus({ taskToken: created.taskToken, userId: 'user-hyper' }, {
    apiKey: 'test-key',
    taskSecret: 'independent-task-secret',
    now: 1_800_000_002_000,
    fetchImpl: async (url) => {
      assert.equal(String(url), 'https://api.302.ai/302/submit/hyper3d-rodin?request_id=private-hyper-job-id');
      return jsonResponse({ response: { status: 'PROCESSING' } });
    }
  });
  assert.deepEqual(status, { status: 'processing', retryAfterMs: 5000 });
  const queuedWithoutStatus = await getThreeDStatus({ taskToken: created.taskToken, userId: 'user-hyper' }, {
    apiKey: 'test-key',
    taskSecret: 'independent-task-secret',
    now: 1_800_000_002_500,
    fetchImpl: async () => jsonResponse({ data: { request_id: 'private-hyper-job-id', queue_position: 1, progress: 0 } })
  });
  assert.deepEqual(queuedWithoutStatus, { status: 'queued', retryAfterMs: 5000 });
  const processingWithoutStatus = await getThreeDStatus({ taskToken: created.taskToken, userId: 'user-hyper' }, {
    apiKey: 'test-key',
    taskSecret: 'independent-task-secret',
    now: 1_800_000_002_700,
    fetchImpl: async () => jsonResponse({ code: 0, data: { progress: 34 } })
  });
  assert.deepEqual(processingWithoutStatus, { status: 'processing', retryAfterMs: 5000 });
  const wrappedHttpStyleCode = await getThreeDStatus({ taskToken: created.taskToken, userId: 'user-hyper' }, {
    apiKey: 'test-key',
    taskSecret: 'independent-task-secret',
    now: 1_800_000_002_800,
    fetchImpl: async () => jsonResponse({ code: 200, data: { status: 'IN_QUEUE', queue_position: 2 } })
  });
  assert.deepEqual(wrappedHttpStyleCode, { status: 'queued', retryAfterMs: 5000 });
  const failedWithoutHttpError = await getThreeDStatus({ taskToken: created.taskToken, userId: 'user-hyper' }, {
    apiKey: 'test-key',
    taskSecret: 'independent-task-secret',
    now: 1_800_000_002_900,
    fetchImpl: async () => jsonResponse({ code: 4001, message: 'job failed' })
  });
  assert.deepEqual(failedWithoutHttpError, {
    status: 'failed', retryAfterMs: 0,
    errorCode: 'three-d-generation-failed', errorMessage: '3D generation failed.'
  });
});

test('Tripo3D uploads the image, creates a PBR task, polls, settles credits, and downloads GLB', async () => {
  const input = rgbaPng({ metadata: true });
  const output = glbFixture();
  const calls = [];
  const accountingRequestId = '00000000-0000-4000-8000-000000000077';
  const created = await createThreeDTask({
    providerId: 'tripo3d',
    imageDataUrl: imageDataUrl(input),
    prompt: 'Reference product model',
    userId: 'tripo-owner'
  }, {
    apiKey: 'test-key',
    taskSecret: 'tripo-task-secret',
    accountingRequestId,
    credits: 10,
    now: 1_800_000_000_000,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (calls.length === 1) return jsonResponse({ code: 0, data: { image_token: 'private-image-token' } });
      return jsonResponse({ code: 0, data: { task_id: 'private-tripo-task' } });
    }
  });
  assert.equal(calls[0].url, 'https://api.302.ai/tripo3d/v2/openapi/upload');
  const uploaded = calls[0].options.body.get('file');
  assert.equal(uploaded.type, 'image/png');
  assert.equal(Buffer.from(await uploaded.arrayBuffer()).includes(Buffer.from('private-metadata')), false);
  assert.equal(calls[1].url, 'https://api.302.ai/tripo3d/v2/openapi/task');
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    type: 'image_to_model',
    model_version: 'v3.1-20260211',
    file: { type: 'png', file_token: 'private-image-token' },
    enable_image_autofix: true,
    texture: true,
    pbr: true,
    texture_alignment: 'original_image',
    texture_quality: 'standard',
    geometry_quality: 'standard',
    orientation: 'align_image',
    auto_size: true,
    quad: false,
    smart_low_poly: false,
    generate_parts: false,
    export_uv: true
  });
  assert.equal(created.credits, 10);
  assert.equal(created.taskToken.includes('private-tripo-task'), false);

  let touched = 0;
  const processing = await getThreeDStatus({ taskToken: created.taskToken, userId: 'tripo-owner' }, {
    apiKey: 'test-key', taskSecret: 'tripo-task-secret', now: 1_800_000_001_000,
    touchCredits: async ({ requestId }) => {
      assert.equal(requestId, accountingRequestId);
      touched += 1;
      return { ok: true };
    },
    settleCredits: async () => { throw new Error('processing tasks must not settle'); },
    fetchImpl: async (url) => {
      assert.equal(String(url), 'https://api.302.ai/tripo3d/v2/openapi/task/private-tripo-task');
      return jsonResponse({ code: 0, data: { task_id: 'private-tripo-task', status: 'running', progress: 42 } });
    }
  });
  assert.deepEqual(processing, { status: 'processing', retryAfterMs: 5000, credits: 10 });

  let released;
  const failed = await getThreeDStatus({ taskToken: created.taskToken, userId: 'tripo-owner' }, {
    apiKey: 'test-key', taskSecret: 'tripo-task-secret', now: 1_800_000_001_500,
    touchCredits: async () => ({ ok: true }),
    settleCredits: async (value) => {
      released = value;
      return { ok: true, status: 'failed', creditsReleased: 10 };
    },
    fetchImpl: async () => jsonResponse({ code: 2010, message: 'task failed' })
  });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.creditsReleased, 10);
  assert.deepEqual(released, { requestId: accountingRequestId, status: 'failed', durationMs: 1000 });

  let settled;
  let downloadCall = 0;
  const downloaded = await downloadThreeDModel({ taskToken: created.taskToken, userId: 'tripo-owner' }, {
    apiKey: 'test-key', taskSecret: 'tripo-task-secret', now: 1_800_000_002_000,
    touchCredits: async () => ({ ok: true }),
    settleCredits: async (value) => {
      settled = value;
      return { ok: true, status: 'succeeded', creditsCharged: 10 };
    },
    fetchImpl: async (url, options) => {
      downloadCall += 1;
      if (downloadCall === 1) {
        return jsonResponse({
          code: 0,
          data: {
            task_id: 'private-tripo-task', status: 'success',
            thumbnail: 'https://tripo-data.rg1.data.tripo3d.com/task/preview.webp?Policy=signed',
            result: { pbr_model: { type: 'glb', url: 'https://tripo-data.rg1.data.tripo3d.com/task/model.glb?Policy=signed' } }
          }
        });
      }
      assert.equal(String(url), 'https://tripo-data.rg1.data.tripo3d.com/task/model.glb?Policy=signed');
      assert.equal(options.headers.Authorization, undefined);
      return new Response(output, { status: 200, headers: { 'Content-Type': 'model/gltf-binary' } });
    }
  });
  assert.equal(touched, 1);
  assert.deepEqual(settled, { requestId: accountingRequestId, status: 'succeeded', durationMs: 2000 });
  assert.deepEqual(downloaded, output);
});

test('3D accounting is validated before any paid upstream request', async () => {
  let upstreamCalls = 0;
  await assert.rejects(
    () => createThreeDTask({
      providerId: 'tripo3d',
      imageDataUrl: imageDataUrl(rgbaPng()),
      userId: 'invalid-accounting-owner'
    }, {
      apiKey: 'test-key',
      taskSecret: 'tripo-task-secret',
      accountingRequestId: 'not-a-request-id',
      credits: 10,
      fetchImpl: async () => {
        upstreamCalls += 1;
        throw new Error('must not submit a paid request');
      }
    }),
    { code: 'credit-service-failed' }
  );
  await assert.rejects(
    () => createThreeDTask({
      providerId: 'tripo3d',
      imageDataUrl: imageDataUrl(rgbaPng()),
      userId: 'invalid-accounting-owner'
    }, {
      apiKey: 'test-key',
      taskSecret: 'tripo-task-secret',
      accountingRequestId: '00000000-0000-4000-8000-000000000077',
      credits: null,
      fetchImpl: async () => {
        upstreamCalls += 1;
        throw new Error('must not submit a paid request');
      }
    }),
    { code: 'credit-service-failed' }
  );
  assert.equal(upstreamCalls, 0);
});

test('3D providers download only validated GLB bytes and never return upstream URLs', async () => {
  const input = rgbaPng();
  const glb = glbFixture();
  const create = await createThreeDTask({
    providerId: 'hyper3d', imageDataUrl: imageDataUrl(input), prompt: 'Reference model', userId: 'user-download'
  }, {
    apiKey: 'test-key', taskSecret: 'task-secret', publicBaseUrl: 'https://gateway.example.com', now: 1_800_000_000_000,
    fetchImpl: async () => jsonResponse({ request_id: 'download-job', status: 'IN_QUEUE' })
  });
  let call = 0;
  const result = await downloadThreeDModel({ taskToken: create.taskToken, userId: 'user-download' }, {
    apiKey: 'test-key', taskSecret: 'task-secret', now: 1_800_000_001_000,
    fetchImpl: async (url, options) => {
      call += 1;
      if (call === 1) {
        assert.match(String(url), /request_id=download-job$/);
        return jsonResponse({ model_mesh: { url: 'https://file.302.ai/models/result.glb' }, textures: [] });
      }
      assert.equal(String(url), 'https://file.302.ai/models/result.glb');
      assert.equal(options.headers.Authorization, undefined);
      return new Response(glb, { status: 200, headers: { 'Content-Type': 'application/octet-stream' } });
    }
  });
  assert.deepEqual(result, glb);
  assert.equal(validateGlb(result), true);
  const corrupt = Buffer.from(glb);
  corrupt.writeUInt32LE(glb.length + 4, 8);
  assert.throws(() => validateGlb(corrupt), { code: 'invalid-glb-result' });
});

test('Topaz video creation uses the documented relay contract and server-only retail pricing', async () => {
  const input = mp4Fixture();
  let upstreamBody;
  let reservation;
  const created = await createVideoUpscaleTask({
    videoDataUrl: videoDataUrl(input),
    toolOptions: {
      filters: [{ model: 'prob-4' }],
      output: {
        resolution: { width: 3840, height: 2160 },
        frameRate: 30,
        audioCodec: 'AAC',
        audioTransfer: 'Copy',
        videoEncoder: 'H264',
        videoProfile: 'Main',
        dynamicCompressionLevel: 'High',
        container: 'mp4'
      },
      sourceDuration: 12.2
    },
    userId: 'video-user-one'
  }, {
    apiKey: 'server-only-302-key',
    taskSecret: 'independent-video-token-secret',
    publicBaseUrl: 'https://gateway.example.com',
    now: 1_800_000_000_000,
    fetchImpl: async (url, options) => {
      assert.equal(String(url), 'https://api.302.ai/topazlabs/video/upload');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Bearer server-only-302-key');
      upstreamBody = JSON.parse(options.body);
      return jsonResponse({ cost: 21, requestId: 'private-topaz-request-id' });
    },
    reserveCredits: async (value) => {
      reservation = value;
      return { ok: true, reason: 'reserved', availableCredits: 937 };
    }
  });

  assert.equal(TOPAZ_RETAIL_CREDIT_MULTIPLIER, 3);
  assert.equal(quoteTopazRetailCredits(21), 63);
  assert.equal(created.providerCost, 21);
  assert.equal(created.credits, 63);
  assert.equal(created.availableCredits, 937);
  assert.equal(created.taskToken.includes('private-topaz-request-id'), false);
  assert.equal(created.taskToken.includes(reservation.requestId), false);
  assert.match(reservation.requestId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(reservation, {
    userId: 'video-user-one',
    requestId: reservation.requestId,
    providerId: 'topaz-video-upscale',
    credits: 63,
    providerCost: 21,
    resolution: '3840x2160',
    duration: 13
  });
  assert.deepEqual(upstreamBody.filters, [{ model: 'prob-4' }]);
  assert.deepEqual(upstreamBody.output, {
    resolution: { width: 3840, height: 2160 },
    frameRate: 30,
    audioCodec: 'AAC',
    audioTransfer: 'Copy',
    videoEncoder: 'H264',
    videoProfile: 'Main',
    dynamicCompressionLevel: 'High',
    cropToFit: false,
    container: 'mp4'
  });
  const relayUrl = new URL(upstreamBody.file);
  assert.equal(relayUrl.origin, 'https://gateway.example.com');
  assert.match(relayUrl.pathname, /\.[a-z0-9]+$/);
  const relay = getAi302RelayAsset(relayUrl.pathname.split('/').at(-1).split('.')[0], { now: 1_800_000_001_000 });
  assert.equal(relay.mime, 'video/mp4');
  assert.deepEqual(relay.buffer, input);

  let touched;
  let settled;
  const status = await getVideoUpscaleStatus({
    taskToken: created.taskToken,
    userId: 'video-user-one'
  }, {
    apiKey: 'server-only-302-key',
    taskSecret: 'independent-video-token-secret',
    now: 1_800_000_009_000,
    touchCredits: async (value) => {
      touched = value;
      return { ok: true, reason: 'touched' };
    },
    settleCredits: async (value) => {
      settled = value;
      return { ok: true, status: 'succeeded', creditsCharged: 63 };
    },
    fetchImpl: async (url, options) => {
      assert.equal(String(url), 'https://api.302.ai/topazlabs/video/private-topaz-request-id/status');
      assert.equal(options.method, 'GET');
      assert.equal(options.headers.Authorization, 'Bearer server-only-302-key');
      return jsonResponse({
        status: 'complete',
        progress: 100,
        download: { url: 'https://file.302.ai/video/result.mp4', expiresAt: 1_900_000_000_000 }
      });
    }
  });
  assert.deepEqual(touched, { requestId: reservation.requestId, userId: 'video-user-one' });
  assert.deepEqual(settled, { requestId: reservation.requestId, status: 'succeeded', durationMs: 9000 });
  assert.deepEqual(status, {
    status: 'succeeded',
    progress: 100,
    retryAfterMs: 0,
    credits: 63,
    providerCost: 21,
    creditsCharged: 63
  });

  await assert.rejects(
    () => getVideoUpscaleStatus({ taskToken: created.taskToken, userId: 'video-user-two' }, {
      apiKey: 'server-only-302-key',
      taskSecret: 'independent-video-token-secret',
      now: 1_800_000_009_000,
      fetchImpl: async () => { throw new Error('must not fetch'); }
    }),
    (error) => error && error.code === 'video-tool-task-not-found' && error.status === 404
  );
});

test('Topaz result download validates the provider URL and returns only video bytes', async () => {
  const input = mp4Fixture();
  const output = mp4Fixture();
  const created = await createVideoUpscaleTask({
    videoDataUrl: videoDataUrl(input),
    toolOptions: { output: { resolution: { width: 1920, height: 1080 } } },
    userId: 'video-download-user'
  }, {
    apiKey: 'server-only-302-key',
    taskSecret: 'video-download-secret',
    publicBaseUrl: 'https://gateway.example.com',
    now: 1_800_000_000_000,
    fetchImpl: async () => jsonResponse({ cost: 4, requestId: 'download-topaz-request' }),
    reserveCredits: async ({ credits, providerCost }) => ({
      ok: credits === 12 && providerCost === 4,
      reason: 'reserved'
    })
  });
  let call = 0;
  const result = await downloadVideoUpscaleResult({
    taskToken: created.taskToken,
    userId: 'video-download-user'
  }, {
    apiKey: 'server-only-302-key',
    taskSecret: 'video-download-secret',
    now: 1_800_000_002_000,
    touchCredits: async () => ({ ok: true }),
    settleCredits: async () => ({ ok: true, status: 'succeeded', creditsCharged: 12 }),
    fetchImpl: async (url, options) => {
      call += 1;
      if (call === 1) {
        assert.equal(String(url), 'https://api.302.ai/topazlabs/video/download-topaz-request/status');
        assert.equal(options.headers.Authorization, 'Bearer server-only-302-key');
        return jsonResponse({
          status: 'complete', progress: 100,
          download: { url: 'https://file.302.ai/video/enhanced.mp4' }
        });
      }
      assert.equal(String(url), 'https://file.302.ai/video/enhanced.mp4');
      assert.equal(options.headers.Authorization, undefined);
      return new Response(output, { status: 200, headers: { 'Content-Type': 'video/mp4' } });
    }
  });
  assert.deepEqual(result, output);
  assert.equal(validateVideo(result), true);

  await assert.rejects(
    () => downloadVideoUpscaleResult({ taskToken: created.taskToken, userId: 'video-download-user' }, {
      apiKey: 'server-only-302-key',
      taskSecret: 'video-download-secret',
      now: 1_800_000_003_000,
      touchCredits: async () => ({ ok: true }),
      settleCredits: async () => ({ ok: true, status: 'succeeded' }),
      fetchImpl: async () => jsonResponse({
        status: 'complete', progress: 100,
        download: { url: 'http://127.0.0.1/private-video' }
      })
    }),
    { code: 'unsafe-tool-result-url' }
  );
});

test('Topaz chunk uploads are owner-bound, retry-safe, and consumed only when complete', () => {
  const first = Buffer.alloc(4 * 1024 * 1024, 0x11);
  mp4Fixture().copy(first, 0);
  const second = Buffer.alloc(12, 0x33);
  const totalBytes = first.length + second.length;
  const created = createVideoUploadSession({
    userId: 'video-chunk-owner',
    size: totalBytes,
    mime: 'video/mp4'
  }, { now: 1_800_100_000_000 });
  assert.equal(created.chunkSize, first.length);
  assert.throws(
    () => appendVideoUploadChunk({
      uploadId: created.uploadId, userId: 'another-owner', index: 0, chunk: first
    }, { now: 1_800_100_001_000 }),
    { code: 'video-upload-not-found' }
  );
  appendVideoUploadChunk({
    uploadId: created.uploadId, userId: 'video-chunk-owner', index: 1, chunk: second
  }, { now: 1_800_100_001_000 });
  assert.throws(
    () => consumeVideoUpload({ uploadId: created.uploadId, userId: 'video-chunk-owner' }, { now: 1_800_100_002_000 }),
    { code: 'video-upload-incomplete' }
  );
  const accepted = appendVideoUploadChunk({
    uploadId: created.uploadId, userId: 'video-chunk-owner', index: 0, chunk: first
  }, { now: 1_800_100_003_000 });
  assert.equal(accepted.receivedBytes, totalBytes);
  const retried = appendVideoUploadChunk({
    uploadId: created.uploadId, userId: 'video-chunk-owner', index: 0, chunk: first
  }, { now: 1_800_100_004_000 });
  assert.equal(retried.receivedBytes, totalBytes);
  assert.throws(
    () => appendVideoUploadChunk({
      uploadId: created.uploadId,
      userId: 'video-chunk-owner',
      index: 0,
      chunk: Buffer.alloc(first.length, 0x22)
    }, { now: 1_800_100_005_000 }),
    { code: 'video-upload-chunk-conflict' }
  );
  const video = consumeVideoUpload({
    uploadId: created.uploadId, userId: 'video-chunk-owner'
  }, { now: 1_800_100_006_000 });
  assert.equal(video.mime, 'video/mp4');
  assert.equal(video.extension, 'mp4');
  assert.deepEqual(video.buffer, Buffer.concat([first, second]));
  assert.throws(
    () => consumeVideoUpload({ uploadId: created.uploadId, userId: 'video-chunk-owner' }, { now: 1_800_100_007_000 }),
    { code: 'video-upload-not-found' }
  );
});

test('Topaz creation unwraps generic 302 status envelopes and accepts task field aliases', async () => {
  const created = await createVideoUpscaleTask({
    videoDataUrl: videoDataUrl(mp4Fixture()),
    toolOptions: { output: { resolution: { width: 1920, height: 1080 } } },
    userId: 'wrapped-video-owner'
  }, {
    apiKey: 'server-only-302-key',
    taskSecret: 'wrapped-video-secret',
    publicBaseUrl: 'https://gateway.example.com',
    now: 1_800_000_000_000,
    fetchImpl: async () => jsonResponse({
      status: 200,
      message: 'success',
      data: { task_id: 'wrapped-topaz-task', provider_cost: 9 }
    }),
    reserveCredits: async ({ credits, providerCost }) => ({
      ok: credits === 27 && providerCost === 9,
      availableCredits: 73
    })
  });
  assert.equal(created.status, 'queued');
  assert.equal(created.providerCost, 9);
  assert.equal(created.credits, 27);
  assert.equal(created.availableCredits, 73);
});

test('Topaz accepts wrapped 302 responses and derives progress from processing jobs', async () => {
  const input = mp4Fixture();
  const output = mp4Fixture();
  const created = await createVideoUpscaleTask({
    videoDataUrl: videoDataUrl(input),
    toolOptions: { output: { resolution: { width: 1920, height: 1080 } } },
    userId: 'wrapped-topaz-user'
  }, {
    apiKey: 'server-only-302-key',
    taskSecret: 'wrapped-topaz-secret',
    publicBaseUrl: 'https://gateway.example.com',
    now: 1_800_000_000_000,
    fetchImpl: async () => jsonResponse({
      data: { cost: '7', request_id: 'wrapped-topaz-request' }
    }),
    reserveCredits: async ({ credits, providerCost }) => ({
      ok: credits === 21 && providerCost === 7,
      reason: 'reserved'
    })
  });

  const status = await getVideoUpscaleStatus({
    taskToken: created.taskToken,
    userId: 'wrapped-topaz-user'
  }, {
    apiKey: 'server-only-302-key',
    taskSecret: 'wrapped-topaz-secret',
    now: 1_800_000_002_000,
    touchCredits: async () => ({ ok: true }),
    settleCredits: async () => { throw new Error('processing tasks must not settle'); },
    fetchImpl: async () => jsonResponse({
      data: {
        processingJobs: [{ status: 'enhancing', progress: 46 }]
      }
    })
  });
  assert.deepEqual(status, {
    status: 'processing',
    progress: 46,
    retryAfterMs: 5_000,
    credits: 21,
    providerCost: 7
  });

  let call = 0;
  const downloaded = await downloadVideoUpscaleResult({
    taskToken: created.taskToken,
    userId: 'wrapped-topaz-user'
  }, {
    apiKey: 'server-only-302-key',
    taskSecret: 'wrapped-topaz-secret',
    now: 1_800_000_004_000,
    touchCredits: async () => ({ ok: true }),
    settleCredits: async () => ({ ok: true, status: 'succeeded', creditsCharged: 21 }),
    fetchImpl: async (url, options) => {
      call += 1;
      if (call === 1) {
        return jsonResponse({
          response: {
            status: 'complete',
            result: { url: 'https://file.302.ai/video/wrapped-result.mov' }
          }
        });
      }
      assert.equal(String(url), 'https://file.302.ai/video/wrapped-result.mov');
      assert.match(options.headers.Accept, /video\/\*/);
      return new Response(output, { status: 200, headers: { 'Content-Type': 'video/quicktime' } });
    }
  });
  assert.deepEqual(downloaded, output);
});

test('Topaz video inputs and output options fail closed', () => {
  const input = mp4Fixture();
  assert.deepEqual(parseVideoDataUrl(videoDataUrl(input)).buffer, input);
  assert.throws(() => parseVideoDataUrl(videoDataUrl(input, 'video/avi')), { code: 'invalid-video-data' });
  assert.throws(
    () => normalizeVideoUpscaleOptions({ output: { resolution: { width: 7680, height: 7680 } } }),
    { code: 'invalid-video-upscale-options' }
  );
  assert.throws(
    () => normalizeVideoUpscaleOptions({ filters: [{ model: 'untrusted-filter' }] }),
    { code: 'invalid-video-upscale-options' }
  );
  assert.throws(
    () => normalizeVideoUpscaleOptions({ filters: [{ model: 'aion-1' }] }),
    { code: 'invalid-video-upscale-options' }
  );
  assert.deepEqual(
    normalizeVideoUpscaleOptions({ output: { videoEncoder: 'ProRes', container: 'mp4' } }).output,
    {
      resolution: { width: 1920, height: 1080 },
      frameRate: 30,
      audioCodec: 'AAC',
      audioTransfer: 'Copy',
      videoEncoder: 'ProRes',
      dynamicCompressionLevel: 'High',
      cropToFit: false,
      container: 'mov'
    }
  );
  assert.throws(() => quoteTopazRetailCredits(1.5), { code: 'invalid-provider-cost' });
});

test('Topaz documents a creation rejection instead of returning a generic start failure', async () => {
  await assert.rejects(
    () => createVideoUpscaleTask({
      videoDataUrl: videoDataUrl(mp4Fixture()),
      toolOptions: { output: { resolution: { width: 1920, height: 1080 } } },
      userId: 'video-rejected-owner'
    }, {
      apiKey: 'server-only-302-key',
      taskSecret: 'video-rejected-secret',
      publicBaseUrl: 'https://gateway.example.com',
      fetchImpl: async () => jsonResponse({ message: 'source format rejected' }, 422)
    }),
    (error) => error && error.code === 'video-upscale-request-rejected' && error.status === 422
  );
});

test('unsafe background-result redirects and missing public relay configuration fail closed', async () => {
  await assert.rejects(
    () => removeBackground({ imageDataUrl: imageDataUrl(rgbaPng()) }, {
      apiKey: 'test-key',
      fetchImpl: async (url) => String(url).startsWith('https://api.302.ai/')
        ? jsonResponse({ url: 'https://file.302.ai/result.png' })
        : new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/private' } })
    }),
    { code: 'unsafe-tool-result-url' }
  );

  const previousPublicUrl = process.env.AI_GATEWAY_PUBLIC_URL;
  const previousRailwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
  delete process.env.AI_GATEWAY_PUBLIC_URL;
  delete process.env.RAILWAY_PUBLIC_DOMAIN;
  try {
    await assert.rejects(
      () => createThreeDTask({
        providerId: 'hyper3d', imageDataUrl: imageDataUrl(rgbaPng()), prompt: 'model', userId: 'user'
      }, { apiKey: 'test-key', taskSecret: 'task-secret', fetchImpl: async () => jsonResponse({}) }),
      { code: 'tool-public-url-not-configured' }
    );
  } finally {
    if (previousPublicUrl === undefined) delete process.env.AI_GATEWAY_PUBLIC_URL;
    else process.env.AI_GATEWAY_PUBLIC_URL = previousPublicUrl;
    if (previousRailwayDomain === undefined) delete process.env.RAILWAY_PUBLIC_DOMAIN;
    else process.env.RAILWAY_PUBLIC_DOMAIN = previousRailwayDomain;
  }
});

test('background removal accepts a wrapped 302 result without exposing the provider URL', async () => {
  const output = rgbaPng();
  let call = 0;
  const result = await removeBackground({ imageDataUrl: imageDataUrl(rgbaPng()) }, {
    apiKey: 'test-key',
    fetchImpl: async (url, options) => {
      call += 1;
      if (call === 1) {
        assert.equal(options.headers.Authorization, 'Bearer test-key');
        return jsonResponse({ data: { result: { url: 'https://file.302.ai/results/wrapped.png' } } });
      }
      assert.equal(String(url), 'https://file.302.ai/results/wrapped.png');
      assert.equal(options.headers.Authorization, undefined);
      return new Response(output, { status: 200, headers: { 'Content-Type': 'image/png' } });
    }
  });
  assert.deepEqual(result, output);
});

test('server enables paid 302 routes with the shared key unless a route is explicitly disabled', () => {
  const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const environment = fs.readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  const assertGuardBefore = (route, guard, action) => {
    const routeAt = server.indexOf(`url.pathname === '${route}'`);
    const guardAt = server.indexOf(guard, routeAt);
    const actionAt = server.indexOf(action, routeAt);
    assert.ok(routeAt >= 0, `${route} must exist`);
    assert.ok(guardAt > routeAt && guardAt < actionAt, `${route} must fail closed before ${action}`);
  };
  assert.match(server, /\/v1\/tools\/background\/remove/);
  assert.match(server, /\/v1\/tools\/image\/edit/);
  assert.match(server, /\/v1\/tools\/image\/layer/);
  assert.match(server, /\/v1\/tools\/image\/status/);
  assert.match(server, /\/v1\/tools\/image\/download/);
  assert.match(server, /\/v1\/tools\/image\/upscale/);
  assert.match(server, /\/v1\/tools\/image\/erase/);
  assert.match(server, /\/v1\/tools\/3d\/create/);
  assert.match(server, /\/v1\/tools\/3d\/status/);
  assert.match(server, /\/v1\/tools\/3d\/download/);
  assert.match(server, /\/v1\/tools\/video\/upscale/);
  assert.match(
    server,
    /url\.pathname === '\/v1\/tools\/video\/upscale'[\s\S]*?getUsageAccount\(user\.id\)[\s\S]*?availableCredits <= 0[\s\S]*?createVideoUpscaleTask/,
    'A zero-balance account must be rejected before the paid Topaz request is created.'
  );
  assert.match(server, /\/v1\/tools\/video\/status/);
  assert.match(server, /\/v1\/tools\/video\/download/);
  assert.match(server, /\['GET', 'HEAD'\]\.includes\(request\.method\)[\s\S]*?\/v1\/tools\/assets\//);
  assert.match(server, /'Accept-Ranges': 'bytes'/);
  assert.match(server, /'Content-Range': `bytes \$\{start\}-\$\{end\}\/\$\{total\}`/);
  assert.match(server, /ENABLE_302_BACKGROUND_REMOVE/);
  assert.match(server, /ENABLE_302_IMAGE_TOOLS/);
  assert.match(server, /ENABLE_302_HUNYUAN3D/);
  assert.match(server, /ENABLE_302_HYPER3D/);
  assert.match(server, /ENABLE_302_TRIPO3D/);
  assert.match(server, /ENABLE_302_TOPAZ/);
  assert.match(server, /if \(configured === 'false'\) return false;/);
  assert.match(server, /if \(configured === 'true'\) return true;/);
  assert.match(server, /process\.env\.AI302_KEY \|\| process\.env\.AI_302_API_KEY/);
  assertGuardBefore('/v1/tools/background/remove', 'ai302Enabled(AI302_FLAGS.background)', 'removeBackground');
  assertGuardBefore('/v1/tools/image/edit', 'ai302Enabled(AI302_FLAGS.image)', 'submitQwenImageEdit');
  assertGuardBefore('/v1/tools/image/layer', 'ai302Enabled(AI302_FLAGS.image)', 'submitQwenImageLayered');
  assertGuardBefore('/v1/tools/image/status', 'ai302Enabled(imageToolFlag(modelId))', 'imageToolPoller');
  assertGuardBefore('/v1/tools/image/download', 'ai302Enabled(imageToolFlag(modelId))', 'imageToolPoller');
  assertGuardBefore('/v1/tools/image/upscale', 'ai302Enabled(AI302_FLAGS.image)', 'superUpscaleImage');
  assertGuardBefore('/v1/tools/image/erase', 'ai302Enabled(AI302_FLAGS.image)', 'eraseImageObjects');
  assertGuardBefore('/v1/tools/3d/create', 'ai302Enabled(flag)', 'createThreeDTask');
  assert.match(
    server,
    /url\.pathname === '\/v1\/tools\/3d\/create'[\s\S]*?reserveFixedTool\(user\.id, providerId, requestId\)[\s\S]*?createThreeDTask/,
    '3D credits must be reserved before any paid upstream request is submitted.'
  );
  assertGuardBefore('/v1/tools/3d/status', 'ai302Enabled(AI302_FLAGS.hunyuan3d)', 'getThreeDStatus');
  assertGuardBefore('/v1/tools/3d/download', 'ai302Enabled(AI302_FLAGS.hunyuan3d)', 'downloadThreeDModel');
  assertGuardBefore('/v1/tools/video/upscale', 'ai302Enabled(AI302_FLAGS.topaz)', 'createVideoUpscaleTask');
  assertGuardBefore('/v1/tools/video/status', 'ai302Enabled(AI302_FLAGS.topaz)', 'getVideoUpscaleStatus');
  assertGuardBefore('/v1/tools/video/download', 'ai302Enabled(AI302_FLAGS.topaz)', 'downloadVideoUpscaleResult');
  for (const flag of [
    'ENABLE_302_BACKGROUND_REMOVE',
    'ENABLE_302_IMAGE_TOOLS',
    'ENABLE_302_HUNYUAN3D',
    'ENABLE_302_HYPER3D',
    'ENABLE_302_TRIPO3D',
    'ENABLE_302_TOPAZ'
  ]) {
    assert.match(environment, new RegExp(`^${flag}=true$`, 'm'));
  }
  assert.doesNotMatch(server, /\/v1\/tools\/hunyuan3d\//);
  assert.match(server, /url\.pathname\.startsWith\('\/v1\/tools\/assets\/'\)[\s\S]*?const user = await authenticate\(request\)/);
  assert.doesNotMatch(server, /BearerKey/);
});
