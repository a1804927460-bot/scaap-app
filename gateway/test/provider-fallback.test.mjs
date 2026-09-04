import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoTask, generateMedia, publicProviderConfig } from '../src/providers.js';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

test('locked built-in media routes ignore deployment-supplied fallback overrides', async () => {
  const previousProviders = process.env.AI_PROVIDERS_JSON;
  const previousQuickRouterKey = process.env.QUICKROUTER_API_KEY;
  const previousAireiterKey = process.env.AIREITER_API_KEY;
  const previousAi302Key = process.env.AI302_KEY;
  const previousAtlasKey = process.env.ATLASCLOUD_API_KEY;
  const previousMinimaxKey = process.env.MINIMAX_API_KEY;
  const previousImageBackupKey = process.env.IMAGE_BACKUP_KEY;
  const previousVideoBackupKey = process.env.VIDEO_BACKUP_KEY;
  const previousFetch = globalThis.fetch;

  process.env.QUICKROUTER_API_KEY = 'primary-key';
  process.env.AIREITER_API_KEY = 'primary-aireiter-key';
  process.env.AI302_KEY = 'primary-302-key';
  process.env.ATLASCLOUD_API_KEY = 'primary-atlas-key';
  process.env.MINIMAX_API_KEY = 'primary-minimax-key';
  process.env.IMAGE_BACKUP_KEY = 'image-backup-key';
  process.env.VIDEO_BACKUP_KEY = 'video-backup-key';
  process.env.AI_PROVIDERS_JSON = JSON.stringify([
    { id: 'image-1', fallbackProviderIds: ['image-1-backup'] },
    {
      id: 'image-1-backup',
      kind: 'image',
      name: 'Image backup',
      endpoint: 'https://backup.example.com/v1beta/models/gemini-3-pro-image-preview:generateContent',
      keyEnv: 'IMAGE_BACKUP_KEY',
      protocol: 'gemini-native',
      logicalModel: 'nano-banana-pro',
      hidden: true
    },
    { id: 'video-1', fallbackProviderIds: ['video-1-backup'] },
    {
      id: 'video-1-backup',
      kind: 'video',
      name: 'Video backup',
      logicalModel: 'minimax-h3',
      endpoint: 'https://backup.example.com/v2/video_generation',
      resultEndpoint: 'https://backup.example.com/v2/query/video_generation',
      keyEnv: 'VIDEO_BACKUP_KEY',
      protocol: 'minimax-video-v2',
      capabilities: {
        resolutions: ['768P', '2K'],
        durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        ratios: ['adaptive'],
        frameReferenceRatios: ['adaptive'],
        videoModes: [{ id: 'first-frame', minReferences: 1, maxReferences: 1 }]
      },
      hidden: true
    },
    { id: 'chat-1', fallbackProviderIds: ['chat-1-backup'] }
  ]);

  try {
    const publicConfig = publicProviderConfig();
    const publicText = JSON.stringify(publicConfig);
    assert.equal(publicText.includes('backup.example.com'), false);
    assert.equal(publicText.includes('IMAGE_BACKUP_KEY'), false);
    assert.equal(publicConfig.providers.some((provider) => provider.id.endsWith('-backup')), false);

    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
      const value = String(url);
      calls.push({ url: value, options });
      if (value === 'https://aireiter.com/api/openapi/submit') {
        return jsonResponse({ statusCode: 429, message: 'busy' }, 429);
      }
      if (value === 'https://backup.example.com/v1beta/models/gemini-3-pro-image-preview:generateContent') {
        return jsonResponse({ candidates: [{ content: { parts: [{ inlineData: {
          mimeType: 'image/png', data: PNG.toString('base64')
        } }] } }] });
      }
      throw new Error(`Unexpected image route: ${value}`);
    };
    await assert.rejects(generateMedia('image', {
      providerId: 'image-1',
      prompt: 'locked image route',
      size: '1K',
      aspectRatio: '1:1',
      operationId: 'locked-image'
    }), (error) => error && error.code === 'provider-rate-limited');
    assert.deepEqual(calls.map((call) => call.url), [
      'https://aireiter.com/api/openapi/submit'
    ]);

    calls.length = 0;
    globalThis.fetch = async (url, options = {}) => {
      const value = String(url);
      calls.push({ url: value, options });
      if (value === 'https://aireiter.com/api/openapi/submit') {
        return jsonResponse({ base_resp: { status_code: 429, status_msg: 'busy' } }, 429);
      }
      if (value === 'https://backup.example.com/v2/video_generation') return jsonResponse({ task_id: 'backup-video-task' });
      throw new Error(`Unexpected video route: ${value}`);
    };
    await assert.rejects(createVideoTask({
      providerId: 'video-1',
      prompt: 'locked video route',
      resolution: '768P',
      duration: 4,
      aspectRatio: 'adaptive',
      videoMode: 'first-frame',
      urls: ['https://example.com/first-frame.png'],
      referenceMediaTypes: ['image']
    }), (error) => error && error.code === 'provider-rate-limited');
    assert.deepEqual(calls.map((call) => call.url), ['https://aireiter.com/api/openapi/submit']);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousProviders === undefined) delete process.env.AI_PROVIDERS_JSON;
    else process.env.AI_PROVIDERS_JSON = previousProviders;
    if (previousQuickRouterKey === undefined) delete process.env.QUICKROUTER_API_KEY;
    else process.env.QUICKROUTER_API_KEY = previousQuickRouterKey;
    if (previousAireiterKey === undefined) delete process.env.AIREITER_API_KEY;
    else process.env.AIREITER_API_KEY = previousAireiterKey;
    if (previousAi302Key === undefined) delete process.env.AI302_KEY;
    else process.env.AI302_KEY = previousAi302Key;
    if (previousAtlasKey === undefined) delete process.env.ATLASCLOUD_API_KEY;
    else process.env.ATLASCLOUD_API_KEY = previousAtlasKey;
    if (previousMinimaxKey === undefined) delete process.env.MINIMAX_API_KEY;
    else process.env.MINIMAX_API_KEY = previousMinimaxKey;
    if (previousImageBackupKey === undefined) delete process.env.IMAGE_BACKUP_KEY;
    else process.env.IMAGE_BACKUP_KEY = previousImageBackupKey;
    if (previousVideoBackupKey === undefined) delete process.env.VIDEO_BACKUP_KEY;
    else process.env.VIDEO_BACKUP_KEY = previousVideoBackupKey;
  }
});
