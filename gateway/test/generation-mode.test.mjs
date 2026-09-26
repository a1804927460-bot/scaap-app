import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {quoteUsage, reserveUsage} from '../src/usage.js';
import {providerCapabilities} from '../src/providers.js';
import pricing from '../../lib/credit-pricing.js';
import klingOptions from '../../lib/kling-options.js';
import videoResolution from '../../lib/video-resolution.js';

test('desktop media transport preserves the selected mode through options and gateway payload', async () => {
  const source = fs.readFileSync(new URL('../../main.js', import.meta.url), 'utf8');
  const optionStart = source.indexOf('function aiMediaGenerationOptions(');
  const optionEnd = source.indexOf('\nasync function resolveImageFallback', optionStart);
  const options = vm.runInNewContext(`(${source.slice(optionStart,optionEnd).trim()})`);
  const start = source.indexOf('async function generateAiMediaBuffer(');
  const calls = [];
  const generate = vm.runInNewContext(`(${source.slice(start,optionStart).trim()})`, {
    AbortController, setTimeout, clearTimeout,
    assertAiTransportReady: () => 'gateway', requireGatewayProvider: async () => {},
    aiGateway: {generateMedia: async (kind,body) => {calls.push(body); return {ok:true};}}
  });
  for (const kind of ['image','video']) for (const performanceMode of ['normal','performance']) {
    const mapped = options({kind,performanceMode}, kind === 'video' ? 'video-14' : 'image-1');
    await generate(kind,'test prompt',mapped);
    assert.equal(calls.at(-1).performanceMode,performanceMode);
  }
});

test('legacy Kling resolution and reference ratio normalize before model validation', () => {
  const source = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const start = source.indexOf('function validateBody(');
  const end = source.indexOf('\nasync function readBuffer', start);
  const validate = vm.runInNewContext(`(${source.slice(start,end).trim()})`, {
    PUBLIC_VIDEO_PROVIDER_IDS: new Set(['video-14']), providerCapabilities,
    providerPromptLimit: () => 2500, secretPatterns: [], klingOptions,
    normalizeVideoResolution: videoResolution.normalizeVideoResolution,
    normalizeImageSize: value => String(value || '1K').toUpperCase(),
    invalidOption: (code,message) => Object.assign(new Error(message),{code,status:400}),
    defaultVideoResolutions: new Set(), defaultVideoRatios: new Set(),
    base64DecodedBytes: value => Buffer.from(value, 'base64').length
  });
  const request = {providerId:'video-14', prompt:'Slow camera motion', urls:['https://example.com/frame.png'],
    resolution:'1080P', duration:5, aspectRatio:'43:24', videoMode:'first-frame', performanceMode:'performance'};
  const normalized = validate(request, 'video');
  assert.equal(normalized.serviceTier, 'pro');
  assert.equal(normalized.aspectRatio, 'adaptive');
  assert.equal(normalized.performanceMode, 'performance');
  assert.throws(() => validate({...request, serviceTier:'standard'}, 'video'), /resolution/);
});

test('desktop and gateway quote both modes consistently for counts and Kling variants', () => {
  for (const performanceMode of ['normal','performance']) {
    for (const providerId of ['image-1','image-2','image-6']) for (const count of [1,2,3,4]) {
      const request = {kind:'image',providerId,count,size:'2K',performanceMode};
      const local = pricing.quoteMediaCredits(request), remote = quoteUsage('image',request);
      assert.equal(remote.credits, local.totalCredits);
      assert.equal(local.totalCredits, local.unitCredits * count);
    }
    for (const [serviceTier,variant] of Object.entries(klingOptions.KLING_VARIANTS)) {
      for (const resolution of Object.keys(variant.rates)) {
        const request = {kind:'video',providerId:'video-14',serviceTier,resolution,duration:5,performanceMode};
        assert.equal(quoteUsage('video',request).credits,pricing.quoteMediaCredits(request).totalCredits);
      }
    }
  }
});

test('performance image reservation uses mode-aware SQL and never falls back to normal on missing schema', async () => {
  const old = process.env.SUPABASE_SECRET_KEY;
  process.env.SUPABASE_SECRET_KEY = 'test-only';
  try {
    const calls = [];
    await assert.rejects(reserveUsage('00000000-0000-4000-8000-000000000001','image',
      '00000000-0000-4000-8000-000000000002', {providerId:'image-1',size:'2K',count:2,performanceMode:'performance'},
      async (url,init) => {calls.push({url,body:JSON.parse(init.body)}); return Response.json({code:'PGRST202'},{status:404});}),
      error => error.code === 'credit-schema-missing');
    assert.equal(calls.length,1);
    assert.ok(calls[0].url.endsWith('/reserve_ai_mode_media_credits'));
    assert.equal(calls[0].body.p_performance_mode,'performance');
    assert.equal(calls[0].body.p_expected_credits,32);
  } finally {
    if (old === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = old;
  }
});
