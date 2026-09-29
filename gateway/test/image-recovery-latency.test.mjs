import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { readStoredImageResult } from '../src/image-result-storage.js';
import { readStoredVideoResult } from '../src/video-result-storage.js';

test('async task recovery does not wait on unrelated storage probes', async () => {
  const source = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const body = source.split('async function recoverStoredImageResult(')[1].split('\nasync function loadImageJob')[0];
  let reads = 0;
  const context = vm.createContext({
    isStoredImageResult: ref => ref.startsWith('storage://'),
    readStoredImageResult: async () => { reads++; return Buffer.from('saved'); }
  });
  vm.runInContext('async function recoverStoredImageResult(' + body, context);
  for (const status of ['submitted', 'ready']) {
    assert.equal(await context.recoverStoredImageResult('user', 'request', {
      status, providerTaskId: 'existing-paid-task', resultUrl: ''
    }), null);
  }
  assert.equal(reads, 0);
  assert.equal(String(await context.recoverStoredImageResult('user', 'request', {
    status: 'ready', providerTaskId: 'existing-paid-task', resultUrl: 'storage://saved'
  })), 'saved');
  assert.equal(reads, 1);
});

test('Supabase missing-object 400 permits recovery; authorization errors do not', async t => {
  const old = process.env.SUPABASE_SECRET_KEY;
  process.env.SUPABASE_SECRET_KEY = 'test-only';
  t.after(() => { if (old === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = old; });
  const user = '11111111-1111-4111-8111-111111111111';
  const request = '22222222-2222-4222-8222-222222222222';
  const ref = 'storage://messs-ai-image-results/' + user + '/' + request + '.png';
  await assert.rejects(readStoredImageResult(user, request, ref, async () =>
    new Response(JSON.stringify({ code: 'NoSuchKey' }), { status: 400 })),
    { code: 'image-result-storage-missing' });
  await assert.rejects(readStoredImageResult(user, request, ref, async () =>
    new Response(JSON.stringify({ code: 'AccessDenied' }), { status: 400 })),
    { code: 'image-result-storage-unavailable' });
  const videoRef = 'storage://messs-ai-video-results/' + user + '/' + request + '.mp4';
  await assert.rejects(readStoredVideoResult(user, request, videoRef, async () =>
    new Response(JSON.stringify({ code: 'NoSuchKey' }), { status: 400 })),
    { code: 'video-result-storage-missing' });
  await assert.rejects(readStoredVideoResult(user, request, videoRef, async () =>
    new Response(JSON.stringify({ code: 'AccessDenied' }), { status: 400 })),
    { code: 'video-result-storage-unavailable' });
});
