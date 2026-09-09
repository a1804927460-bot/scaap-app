import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { moderateGenerationPrompt, requiresPromptModeration } from '../src/moderation.js';
import { publicGatewayError } from '../src/public-errors.js';

const env = { CREEM_API_KEY: 'creem_test_fixture_live', CREEM_MODERATION_ENV: 'sandbox' };
const response = (decision) => new Response(JSON.stringify({
  id: 'mod_fixture', object: 'moderation_result', decision, usage: { units: 1 }, future: true
}));

test('moderation sends all user text and no media or account identifiers', async () => {
  const result = await moderateGenerationPrompt({ prompt: 'scene', options: { promptSuffix: 'detail' }, urls: ['secret-media'] }, {
    env, userId: 'private@example.com', requestId: 'job-1',
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://test-api.creem.io/v1/moderation/prompt');
      assert.equal(options.headers['x-api-key'], env.CREEM_API_KEY);
      const body = JSON.parse(options.body);
      assert.equal(body.prompt, 'scene\ndetail');
      assert.match(body.external_id, /^[a-f0-9]{64}$/);
      assert.equal(options.body.includes('private@example.com'), false);
      assert.equal(options.body.includes('secret-media'), false);
      return response('allow');
    }
  });
  assert.equal(result.units, 1);
});

test('deny blocks while flagged ordinary prompts remain eligible for provider review', async () => {
  await assert.rejects(moderateGenerationPrompt({ prompt: 'test' }, {
    env, fetchImpl: async () => response('deny')
  }), (error) => publicGatewayError(error).code === 'prompt-rejected' && error.status === 400);

  for (const prompt of ['a man in a studio portrait', 'a woman walking through a city']) {
    const result = await moderateGenerationPrompt({ prompt }, {
      env, fetchImpl: async () => response('flag')
    });
    assert.equal(result.decision, 'flag');
  }
});

test('network, HTTP, malformed and unknown decisions fail closed', async () => {
  for (const fetchImpl of [
    async () => { throw new DOMException('timeout', 'TimeoutError'); },
    async () => new Response('unavailable', { status: 503 }),
    async () => new Response('invalid json'),
    async () => response('unknown')
  ]) {
    await assert.rejects(moderateGenerationPrompt({ prompt: 'test' }, { env, fetchImpl }),
      (error) => publicGatewayError(error).code === 'moderation-unavailable' && error.status === 503);
  }
});

test('missing keys and production test keys cannot bypass screening', async () => {
  for (const invalidEnv of [{}, { ...env, NODE_ENV: 'production' }, { ...env, CREEM_MODERATION_ENV: 'production' }]) {
    await assert.rejects(moderateGenerationPrompt({ prompt: 'test' }, {
      env: invalidEnv, fetchImpl: async () => { assert.fail('must not send'); }
    }), { code: 'moderation-unavailable' });
  }
});

test('generation is screened before billing while retrieval and chat stay available', () => {
  for (const pathname of ['/v1/media/image', '/v1/media/video', '/v1/media/video/tasks/create', '/v1/tools/image/edit']) {
    assert.equal(requiresPromptModeration('POST', pathname), true);
  }
  for (const pathname of ['/v1/chat', '/v1/media/video/tasks/status', '/v1/media/video/tasks/download', '/v1/media/video/tasks/confirm']) {
    assert.equal(requiresPromptModeration('POST', pathname), false);
  }
  const source = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const handler = source.slice(source.indexOf('async function handle('));
  assert.ok(handler.indexOf('await moderateGenerationPrompt(') < handler.indexOf('await reserveFixedTool('));
  assert.ok(handler.indexOf('await moderateGenerationPrompt(') < handler.indexOf('await startVideoJob('));
  assert.ok(handler.indexOf('await moderateGenerationPrompt(') < handler.indexOf('await reserveUsage('));
});
