'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SupabaseAuth } = require('../lib/supabase-auth');
const { AiGatewayClient, assertValidGlbBuffer } = require('../lib/ai-gateway-client');
const { normalizeHttpsUrl } = require('../lib/runtime-config');

function fakeJwt(payload) {
  return `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
}

function makeGlb() {
  const jsonText = JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{}] });
  const padding = (4 - (Buffer.byteLength(jsonText) % 4)) % 4;
  const json = Buffer.from(jsonText + ' '.repeat(padding), 'utf8');
  const glb = Buffer.alloc(20 + json.length);
  glb.write('glTF', 0, 'ascii');
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(json.length, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  json.copy(glb, 20);
  return glb;
}

async function testSupabaseSessionStorage() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'messs-auth-'));
  const sessionPath = path.join(tempDir, 'session.bin');
  const accessToken = fakeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/logout')) return new Response('{}', { status: 200 });
    return new Response(JSON.stringify({
      access_token: accessToken,
      refresh_token: 'refresh-private',
      expires_in: 3600,
      user: { id: 'user-1', email: 'user@example.com' }
    }), { status: 200 });
  };
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value).map((byte) => byte ^ 0x5a),
    decryptString: (value) => Buffer.from(value).map((byte) => byte ^ 0x5a).toString('utf8')
  };
  const auth = new SupabaseAuth({
    fetchImpl,
    safeStorage,
    sessionPath,
    supabaseUrl: 'https://trmbhcniijedpmohkbzx.supabase.co',
    publishableKey: 'sb_publishable_test'
  });
  const session = await auth.signIn('user@example.com', 'password123');
  assert.strictEqual(session.authenticated, true);
  assert.strictEqual(session.user.email, 'user@example.com');
  assert.strictEqual(session.accessToken, undefined);
  assert.ok(!fs.readFileSync(sessionPath).toString('utf8').includes('refresh-private'));
  assert.strictEqual(await auth.getAccessToken(), accessToken);
  assert.strictEqual(calls[0].options.headers.apikey, 'sb_publishable_test');
  await auth.signOut();
  assert.strictEqual(fs.existsSync(sessionPath), false);
  fs.rmSync(tempDir, { recursive: true, force: true });
}

async function testGatewayClient() {
  const calls = [];
  const video = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);
  const backgroundPng = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
  const glb = makeGlb();
  const taskToken = '3d_task_token_abcdefghijklmnopqrstuvwxyz';
  const client = new AiGatewayClient({
    baseUrl: 'https://gateway.example.com/',
    getAccessToken: async () => 'user-jwt',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/v1/chat')) return new Response(JSON.stringify({ text: 'hello' }), { status: 200 });
      if (url.endsWith('/v1/account')) return new Response(JSON.stringify({ account: { balance: 100, overseasUnlocked: true } }), { status: 200 });
      if (url.endsWith('/v1/account/redeem')) return new Response(JSON.stringify({ redemption: { ok: true, creditsAdded: 100 } }), { status: 200 });
      if (url.endsWith('/v1/media/video/tasks/create')) return new Response(JSON.stringify({ status: 'succeeded' }), { status: 202 });
      if (url.endsWith('/v1/media/video/tasks/download')) return new Response(JSON.stringify({ url: 'https://cdn.example/video.mp4' }), { status: 200 });
      if (url.endsWith('/v1/tools/background/remove')) return new Response(backgroundPng, { status: 200 });
      if (url.endsWith('/v1/tools/3d/create')) return new Response(JSON.stringify({ taskToken, status: 'queued', retryAfterMs: 5000 }), { status: 202 });
      if (url.endsWith('/v1/tools/3d/status')) return new Response(JSON.stringify({ status: 'processing', retryAfterMs: 4000 }), { status: 200 });
      if (url.endsWith('/v1/tools/3d/download')) return new Response(glb, { status: 200, headers: { 'Content-Length': String(glb.length) } });
      if (url === 'https://cdn.example/video.mp4') return new Response(video, { status: 200, headers: { 'Content-Length': String(video.length) } });
      return new Response(Buffer.from([1, 2, 3]), { status: 200 });
    }
  });
  assert.strictEqual(await client.chat({ prompt: 'hi' }), 'hello');
  assert.deepStrictEqual(await client.generateMedia('image', { prompt: 'hi' }), Buffer.from([1, 2, 3]));
  assert.deepStrictEqual(await client.generateMedia('video', { prompt: 'move' }), video);
  const imageDataUrl = 'data:image/jpeg;base64,/9j/2Q==';
  assert.deepStrictEqual(await client.removeBackground(imageDataUrl), backgroundPng);
  assert.strictEqual((await client.create3d('hyper3d', imageDataUrl, 'Make a model')).taskToken, taskToken);
  assert.strictEqual((await client.get3dStatus(taskToken)).status, 'processing');
  assert.deepStrictEqual(await client.download3d(taskToken), glb);
  assert.strictEqual((await client.getAccount()).account.balance, 100);
  assert.strictEqual((await client.redeemCode('synthetic-test-code')).redemption.creditsAdded, 100);
  assert.strictEqual(calls[0].options.headers.Authorization, 'Bearer user-jwt');
  assert.strictEqual(calls[0].url, 'https://gateway.example.com/v1/chat');
  const redemptionCall = calls.find((call) => call.url.endsWith('/v1/account/redeem'));
  assert.deepStrictEqual(JSON.parse(redemptionCall.options.body), { code: 'synthetic-test-code' });
  const videoCreateCall = calls.find((call) => call.url.endsWith('/v1/media/video/tasks/create'));
  const videoCreateBody = JSON.parse(videoCreateCall.options.body);
  assert.match(videoCreateBody.operationId, /^[0-9a-f-]{36}$/i);
  assert.match(videoCreateBody.taskToken, /^[A-Za-z0-9_-]{43}$/);
  const cdnCall = calls.find((call) => call.url === 'https://cdn.example/video.mp4');
  assert.strictEqual(cdnCall.options.headers.Authorization, undefined);
  const backgroundCall = calls.find((call) => call.url.endsWith('/v1/tools/background/remove'));
  assert.deepStrictEqual(JSON.parse(backgroundCall.options.body), { imageDataUrl, options: {} });
  const create3dCall = calls.find((call) => call.url.endsWith('/v1/tools/3d/create'));
  assert.deepStrictEqual(JSON.parse(create3dCall.options.body), {
    providerId: 'hyper3d',
    imageDataUrl,
    prompt: 'Make a model',
    options: {}
  });
  const status3dCall = calls.find((call) => call.url.endsWith('/v1/tools/3d/status'));
  assert.deepStrictEqual(JSON.parse(status3dCall.options.body), { taskToken });
  const download3dCall = calls.find((call) => call.url.endsWith('/v1/tools/3d/download'));
  assert.deepStrictEqual(JSON.parse(download3dCall.options.body), { taskToken });
  [backgroundCall, create3dCall, status3dCall, download3dCall].forEach((call) => {
    assert.strictEqual(call.options.headers.Authorization, 'Bearer user-jwt');
    assert.strictEqual(JSON.stringify(call).includes('302-secret'), false);
  });
  assert.throws(() => client.create3d('untrusted-provider', imageDataUrl, 'model'), /provider is invalid/i);

  assert.strictEqual(assertValidGlbBuffer(glb), glb);
  const wrongMagic = Buffer.from(glb);
  wrongMagic.write('NOPE', 0, 'ascii');
  assert.throws(() => assertValidGlbBuffer(wrongMagic), (error) => error.code === 'invalid-glb');
  const wrongLength = Buffer.from(glb);
  wrongLength.writeUInt32LE(glb.length + 4, 8);
  assert.throws(() => assertValidGlbBuffer(wrongLength), (error) => error.code === 'invalid-glb');
  const wrongVersion = Buffer.from(glb);
  wrongVersion.write('1.0', wrongVersion.indexOf('2.0'), 'ascii');
  assert.throws(() => assertValidGlbBuffer(wrongVersion), (error) => error.code === 'invalid-glb');
  assert.throws(() => assertValidGlbBuffer(glb, 16), (error) => error.code === 'media-too-large');

  const oversizedClient = new AiGatewayClient({
    baseUrl: 'https://gateway.example.com',
    getAccessToken: async () => 'user-jwt',
    fetchImpl: async () => new Response(Buffer.alloc(0), {
      status: 200,
      headers: { 'Content-Length': String(64 * 1024 * 1024 + 1) }
    })
  });
  await assert.rejects(
    () => oversizedClient.removeBackground(imageDataUrl),
    (error) => error.code === 'media-too-large'
  );
}

async function testGatewaySessionRecovery() {
  let gatewayCalls = 0;
  let refreshCalls = 0;
  const authorization = [];
  const client = new AiGatewayClient({
    baseUrl: 'https://gateway.example.com',
    getAccessToken: async () => 'stale-user-jwt',
    refreshAccessToken: async () => {
      refreshCalls += 1;
      return 'fresh-user-jwt';
    },
    fetchImpl: async (_url, options) => {
      gatewayCalls += 1;
      authorization.push(options.headers.Authorization);
      if (gatewayCalls === 1) {
        return new Response(JSON.stringify({
          code: 'invalid-session',
          message: 'A valid Supabase session is required.'
        }), { status: 401 });
      }
      return new Response(JSON.stringify({ text: 'recovered' }), { status: 200 });
    }
  });
  assert.strictEqual(await client.chat({ prompt: 'retry once' }), 'recovered');
  assert.strictEqual(gatewayCalls, 2);
  assert.strictEqual(refreshCalls, 1);
  assert.deepStrictEqual(authorization, ['Bearer stale-user-jwt', 'Bearer fresh-user-jwt']);

  let rejectedCalls = 0;
  let rejectedRefreshCalls = 0;
  const rejectedClient = new AiGatewayClient({
    baseUrl: 'https://gateway.example.com',
    getAccessToken: async () => 'stale-user-jwt',
    refreshAccessToken: async () => {
      rejectedRefreshCalls += 1;
      return 'still-rejected-user-jwt';
    },
    fetchImpl: async () => {
      rejectedCalls += 1;
      return new Response(JSON.stringify({ code: 'invalid-session' }), { status: 401 });
    }
  });
  await assert.rejects(
    () => rejectedClient.chat({ prompt: 'do not loop' }),
    (error) => error.code === 'invalid-session'
  );
  assert.strictEqual(rejectedCalls, 2);
  assert.strictEqual(rejectedRefreshCalls, 1);

  let providerRefreshCalls = 0;
  const providerFailureClient = new AiGatewayClient({
    baseUrl: 'https://gateway.example.com',
    getAccessToken: async () => 'valid-user-jwt',
    refreshAccessToken: async () => {
      providerRefreshCalls += 1;
      return 'unneeded-user-jwt';
    },
    fetchImpl: async () => new Response(JSON.stringify({
      code: 'provider-auth-failed',
      message: 'The selected AI provider rejected its server credential.'
    }), { status: 502 })
  });
  await assert.rejects(
    () => providerFailureClient.chat({ prompt: 'provider key expired' }),
    (error) => error.code === 'provider-auth-failed' && error.status === 502
  );
  assert.strictEqual(providerRefreshCalls, 0);
}

async function testGatewayReadRecoveryAndTransportErrors() {
  let configCalls = 0;
  const client = new AiGatewayClient({
    baseUrl: 'https://gateway.example.com',
    getAccessToken: async () => 'user-jwt',
    fetchImpl: async (url) => {
      configCalls += 1;
      if (url.endsWith('/v1/config') && configCalls === 1) return new Response(null, { status: 503 });
      return new Response(JSON.stringify({ catalogVersion: 34, providers: [] }), { status: 200 });
    }
  });
  const config = await client.getConfig();
  assert.strictEqual(config.catalogVersion, 34);
  assert.strictEqual(configCalls, 2, 'Read-only gateway config calls should recover from a transient 503.');

  let transportCalls = 0;
  const transportRecoveryClient = new AiGatewayClient({
    baseUrl: 'https://gateway.example.com',
    getAccessToken: async () => 'user-jwt',
    fetchImpl: async () => {
      transportCalls += 1;
      if (transportCalls === 1) throw new TypeError('fetch failed');
      return new Response(JSON.stringify({ catalogVersion: 34, providers: [] }), { status: 200 });
    }
  });
  const recoveredConfig = await transportRecoveryClient.getConfig();
  assert.strictEqual(recoveredConfig.catalogVersion, 34);
  assert.strictEqual(transportCalls, 2, 'Read-only gateway config calls should recover from a transient transport failure.');

  const transportClient = new AiGatewayClient({
    baseUrl: 'https://gateway.example.com',
    getAccessToken: async () => 'user-jwt',
    fetchImpl: async () => { throw new TypeError('fetch failed'); }
  });
  await assert.rejects(
    () => transportClient.getConfig(),
    (error) => error && error.name === 'TypeError' && error.code === 'gateway-request-failed' && error.status === 503
  );
}

async function testPaidImageCreationIsNotReplayed() {
  let calls = 0;
  const client = new AiGatewayClient({
    baseUrl: 'https://gateway.example.com',
    getAccessToken: async () => 'user-jwt',
    fetchImpl: async () => {
      calls += 1;
      throw new TypeError('The response was lost after submission.');
    }
  });
  await assert.rejects(
    () => client.generateMedia('image', { prompt: 'one paid submission' }),
    (error) => error && error.name === 'TypeError'
  );
  assert.strictEqual(calls, 1, 'Paid image creation must not be replayed after an ambiguous network failure.');
}

async function testChunkedTopazUpload() {
  const chunkSize = 2 * 1024 * 1024;
  const video = Buffer.alloc(chunkSize + 12, 0x19);
  video.writeUInt32BE(24, 0);
  video.write('ftyp', 4, 'ascii');
  const calls = [];
  let retriedChunk = false;
  const client = new AiGatewayClient({
    baseUrl: 'https://gateway.example.com',
    getAccessToken: async () => 'user-jwt',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/v1/tools/video/uploads')) {
        return new Response(JSON.stringify({
          uploadId: 'u'.repeat(43), chunkSize, totalBytes: video.length
        }), { status: 201 });
      }
      if (url.endsWith(`/${'u'.repeat(43)}/0`) && !retriedChunk) {
        retriedChunk = true;
        throw new TypeError('temporary network failure');
      }
      if (url.includes(`/v1/tools/video/uploads/${'u'.repeat(43)}/`)) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.endsWith('/v1/tools/video/upscale')) {
        return new Response(JSON.stringify({ taskToken: 'v'.repeat(43), status: 'queued' }), { status: 202 });
      }
      throw new Error(`unexpected request ${url}`);
    }
  });
  const result = await client.upscaleVideo(video, {
    modelId: 'topaz-video-upscale',
    sourceMime: 'video/mp4',
    output: { resolution: { width: 1920, height: 1080 } }
  });
  assert.strictEqual(result.status, 'queued');
  const chunkCalls = calls.filter((call) => call.url.includes('/v1/tools/video/uploads/') && call.options.method === 'PUT');
  assert.strictEqual(chunkCalls.length, 3);
  assert.strictEqual(chunkCalls.filter((call) => call.url.endsWith('/0')).length, 2);
  assert.strictEqual(chunkCalls.filter((call) => call.url.endsWith('/1')).length, 1);
  assert.strictEqual(chunkCalls[0].options.headers['Content-Type'], 'application/octet-stream');
  assert.ok(Buffer.isBuffer(chunkCalls[0].options.body));
  const submit = calls.find((call) => call.url.endsWith('/v1/tools/video/upscale'));
  const submitBody = JSON.parse(submit.options.body);
  assert.deepStrictEqual(submitBody, {
    modelId: 'topaz-video-upscale',
    uploadId: 'u'.repeat(43),
    options: {
      modelId: 'topaz-video-upscale',
      output: { resolution: { width: 1920, height: 1080 } }
    }
  });
  assert.strictEqual(JSON.stringify(submitBody).includes('data:video'), false);
}

async function testVideoCreateRetriesTransientGatewayFailure() {
  const calls = [];
  const video = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);
  let createAttempts = 0;
  const client = new AiGatewayClient({
    baseUrl: 'https://gateway.example.com',
    getAccessToken: async () => 'user-jwt',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/v1/media/video/tasks/create')) {
        createAttempts += 1;
        if (createAttempts === 1) return new Response(null, { status: 502 });
        return new Response(JSON.stringify({ status: 'succeeded' }), { status: 202 });
      }
      if (url.endsWith('/v1/media/video/tasks/download')) {
        return new Response(JSON.stringify({ url: 'https://cdn.example/retried-video.mp4' }), { status: 200 });
      }
      if (url === 'https://cdn.example/retried-video.mp4') {
        return new Response(video, { status: 200, headers: { 'Content-Length': String(video.length) } });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }
  });
  assert.deepStrictEqual(await client.generateMedia('video', { prompt: 'retry gateway edge failure' }), video);
  const createCalls = calls.filter((call) => call.url.endsWith('/v1/media/video/tasks/create'));
  assert.strictEqual(createCalls.length, 2);
  assert.strictEqual(createCalls[0].options.headers['X-Idempotency-Key'], createCalls[1].options.headers['X-Idempotency-Key']);
  assert.strictEqual(createCalls[0].options.body, createCalls[1].options.body);
}

function testButlerDesktopBridgeSurface() {
  const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const clientSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'ai-gateway-client.js'), 'utf8');
  assert.match(preloadSource, /butler:\s*Object\.freeze\(\{/);
  ['removeBackground', 'create3d', 'get3dStatus', 'download3d'].forEach((method) => {
    assert.match(preloadSource, new RegExp(`${method}:`));
  });
  ['butler:removeBackground', 'butler:create3d', 'butler:get3dStatus', 'butler:download3d'].forEach((channel) => {
    assert.match(mainSource, new RegExp(channel));
  });
  assert.match(mainSource, /sanitizeImageForButler/);
  assert.match(clientSource, /\/v1\/tools\/video\/uploads[\s\S]*rawBody:\s*chunk[\s\S]*uploadId/);
  assert.match(mainSource, /assertValidGlbBuffer\(buffer\)/);
  assert.match(mainSource, /'pending_queue'[\s\S]*?'waiting_to_run'[\s\S]*?\? 'queued'/,
    'The desktop bridge must keep provider queue aliases in a non-terminal state.');
  assert.match(mainSource, /modelPreviewUrl:\s*`messs-preview:\/\/\$\{f\.id\}\/model`/);
  assert.match(mainSource, /pageStr === 'model'/);
  assert.strictEqual(/BearerKey|AI302_KEY|AI_302_API_KEY/.test(`${preloadSource}\n${mainSource}\n${clientSource}`), false);
}

async function testOfflineRefreshKeepsLocalIdentity() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'messs-auth-offline-'));
  const accessToken = fakeJwt({ exp: Math.floor(Date.now() / 1000) + 1 });
  let signedIn = false;
  const auth = new SupabaseAuth({
    fetchImpl: async () => {
      if (!signedIn) {
        signedIn = true;
        return new Response(JSON.stringify({
          access_token: accessToken,
          refresh_token: 'refresh-private',
          expires_in: 1,
          user: { id: 'user-offline', email: 'offline@example.com' }
        }), { status: 200 });
      }
      throw new TypeError('fetch failed');
    },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(value),
      decryptString: (value) => Buffer.from(value).toString('utf8')
    },
    sessionPath: path.join(tempDir, 'session.bin'),
    supabaseUrl: 'https://trmbhcniijedpmohkbzx.supabase.co',
    publishableKey: 'sb_publishable_test'
  });
  await auth.signIn('offline@example.com', 'password123');
  await assert.rejects(() => auth.getAccessToken(), /fetch failed/);
  assert.strictEqual(auth.getPublicSession().authenticated, true);
  assert.strictEqual(auth.getPublicSession().user.email, 'offline@example.com');
  fs.rmSync(tempDir, { recursive: true, force: true });
}

(async () => {
  assert.strictEqual(normalizeHttpsUrl('http://example.com'), '');
  assert.strictEqual(normalizeHttpsUrl('https://example.com/path/'), 'https://example.com/path');
  await testSupabaseSessionStorage();
  await testOfflineRefreshKeepsLocalIdentity();
  await testGatewayClient();
  await testVideoCreateRetriesTransientGatewayFailure();
  await testChunkedTopazUpload();
  await testGatewaySessionRecovery();
  await testGatewayReadRecoveryAndTransportErrors();
  await testPaidImageCreationIsNotReplayed();
  testButlerDesktopBridgeSurface();
  console.log('security client tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
