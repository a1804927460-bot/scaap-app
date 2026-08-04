'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SupabaseAuth } = require('../lib/supabase-auth');
const { AiGatewayClient } = require('../lib/ai-gateway-client');
const { normalizeHttpsUrl } = require('../lib/runtime-config');

function fakeJwt(payload) {
  return `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
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
  const client = new AiGatewayClient({
    baseUrl: 'https://gateway.example.com/',
    getAccessToken: async () => 'user-jwt',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/v1/chat')) return new Response(JSON.stringify({ text: 'hello' }), { status: 200 });
      if (url.endsWith('/v1/account')) return new Response(JSON.stringify({ account: { balance: 100, overseasUnlocked: true } }), { status: 200 });
      if (url.endsWith('/v1/account/redeem')) return new Response(JSON.stringify({ redemption: { ok: true, creditsAdded: 100 } }), { status: 200 });
      return new Response(Buffer.from([1, 2, 3]), { status: 200 });
    }
  });
  assert.strictEqual(await client.chat({ prompt: 'hi' }), 'hello');
  assert.deepStrictEqual(await client.generateMedia('image', { prompt: 'hi' }), Buffer.from([1, 2, 3]));
  assert.strictEqual((await client.getAccount()).account.balance, 100);
  assert.strictEqual((await client.redeemCode('synthetic-test-code')).redemption.creditsAdded, 100);
  assert.strictEqual(calls[0].options.headers.Authorization, 'Bearer user-jwt');
  assert.strictEqual(calls[0].url, 'https://gateway.example.com/v1/chat');
  const redemptionCall = calls.find((call) => call.url.endsWith('/v1/account/redeem'));
  assert.deepStrictEqual(JSON.parse(redemptionCall.options.body), { code: 'synthetic-test-code' });
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
  console.log('security client tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
