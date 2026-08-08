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
  assert.deepStrictEqual(JSON.parse(backgroundCall.options.body), { imageDataUrl });
  const create3dCall = calls.find((call) => call.url.endsWith('/v1/tools/3d/create'));
  assert.deepStrictEqual(JSON.parse(create3dCall.options.body), {
    providerId: 'hyper3d',
    imageDataUrl,
    prompt: 'Make a model'
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
  assert.match(mainSource, /assertValidGlbBuffer\(buffer\)/);
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
  testButlerDesktopBridgeSurface();
  console.log('security client tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
