import test from 'node:test';
import assert from 'node:assert/strict';
import { generateFalImage } from '../src/fal-generation.js';

for (const variant of ['flare', 'sunburst']) for (const quality of ['low', 'medium', 'high']) for (const edit of [false, true]) {
  test(`GPT 2.5 ${variant} ${quality} ${edit ? 'edit' : 'generation'} preserves quality and polls returned parent queue`, async () => {
    const calls = [];
    let accepted;
    await generateFalImage({ id: 'fal-backup-gpt-image-25-flare', apiKey: 'test' }, {
      prompt: 'a red cube', size: '1K', aspectRatio: '1:1', variant, quality,
      ...(edit ? { urls: ['https://example.com/ref.png'] } : {})
    }, null, { onAccepted: value => { accepted = value; } }, {
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        if (options.method === 'POST') return Response.json({ request_id: 'task-123', response_url: 'https://queue.fal.run/openai/gpt-image-2.5/requests/task-123' });
        if (url.endsWith('/status')) return Response.json({ status: 'COMPLETED' });
        return Response.json({ images: [{ url: 'https://example.com/result.png' }] });
      },
      download: async () => Buffer.from('test')
    });
    assert.equal(calls[0].url, `https://queue.fal.run/openai/gpt-image-2.5/${variant}/${edit ? 'edit' : 'text-to-image'}`);
    assert.equal(JSON.parse(calls[0].options.body).quality, quality);
    assert.equal(accepted.pollUrl, 'https://queue.fal.run/openai/gpt-image-2.5/requests/task-123/status');
    assert.equal(calls.filter(call => call.options.method === 'POST').length, 1);
  });
}
