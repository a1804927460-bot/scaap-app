import test from 'node:test';
import assert from 'node:assert/strict';
import { readStoredVideoResult } from '../src/video-result-storage.js';

const user = '11111111-1111-4111-8111-111111111111';
const job = '22222222-2222-4222-8222-222222222222';
const reference = `storage://messs-ai-video-results/${user}/${job}.mp4`;

test('stored video streaming returns the original verified bytes', async () => {
  const previous = process.env.SUPABASE_SECRET_KEY;
  process.env.SUPABASE_SECRET_KEY = 'fixture';
  try {
    const bytes = Buffer.from('000000186674797069736f6d0000000069736f6d6d703432', 'hex');
    const result = await readStoredVideoResult(user, job, reference, async () => new Response(bytes));
    assert.deepEqual(result.buffer, bytes);
  } finally {
    if (previous === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = previous;
  }
});

test('an interrupted stored video stream is recoverable and never yields partial bytes', async () => {
  const previous = process.env.SUPABASE_SECRET_KEY;
  process.env.SUPABASE_SECRET_KEY = 'fixture';
  try {
    await assert.rejects(readStoredVideoResult(user, job, reference, async () => new Response(new ReadableStream({
      start(controller) { controller.error(new Error('connection reset')); }
    }))), { code: 'video-result-storage-unavailable', status: 503 });
  } finally {
    if (previous === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = previous;
  }
});
