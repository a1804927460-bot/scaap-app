import test from 'node:test';
import assert from 'node:assert/strict';
import { runDurableFalImageTool } from '../src/durable-fal-image-tools.js';
import { hashImageRequest } from '../src/image-jobs.js';
const request = { userId: 'user', requestId: 'request', model: 'feynobg', imageDataUrl: 'test', options: {} };
const hash = hashImageRequest({ model: request.model, imageDataUrl: request.imageDataUrl, options: {} });
test('new FAL claim never treats the database pending placeholder as a provider task', async () => {
  const events = [];
  await runDurableFalImageTool(request, {
    getImageJob: async () => null,
    claimImageJob: async () => ({ status: 'starting', reason: 'claimed', providerTaskId: 'pending:request' }),
    runFalImageTool: async (_model, _image, _options, deps) => {
      assert.equal(deps.existingTaskId, undefined);
      await deps.onAccepted({ taskId: 'accepted', pollUrl: 'https://queue.fal.run/task/status' });
      events.push('result'); return Buffer.from('png');
    },
    recordImageProviderTask: async data => { assert.equal(data.providerTaskId, 'accepted'); events.push('accepted'); },
    storeImageResult: async () => { events.push('store'); return 'storage://result'; },
    recordImageProviderResult: async () => { events.push('record'); }
  });
  assert.deepEqual(events, ['accepted', 'result', 'store', 'record']);
});
test('FAL retry after process loss resumes accepted task and stores bytes before returning', async () => {
  const events = [];
  const result = await runDurableFalImageTool(request, {
    getImageJob: async () => ({ requestHash: hash, providerId: 'background-remove', status: 'submitted', providerTaskId: 'accepted-id' }),
    runFalImageTool: async (_model, _image, _options, deps) => {
      assert.equal(deps.existingTaskId, 'accepted-id'); events.push('resume'); return Buffer.from('png');
    },
    storeImageResult: async () => { events.push('store'); return 'storage://result'; },
    recordImageProviderResult: async () => { events.push('record'); }
  });
  assert.equal(result.toString(), 'png');
  assert.deepEqual(events, ['resume', 'store', 'record']);
});
test('completed FAL retry reads stored output without submitting', async () => {
  assert.equal((await runDurableFalImageTool(request, {
    getImageJob: async () => ({ requestHash: hash, providerId: 'background-remove', status: 'ready', resultUrl: 'storage://result' }),
    readStoredImageResult: async () => Buffer.from('saved'),
    runFalImageTool: async () => assert.fail('must not submit')
  })).toString(), 'saved');
});
test('concurrent FAL claim does not submit twice', async () => {
  await assert.rejects(runDurableFalImageTool(request, {
    getImageJob: async () => null,
    claimImageJob: async () => ({ status: 'starting', reason: 'already-started' }),
    runFalImageTool: async () => assert.fail('must not submit')
  }), { code: 'provider-task-recovery-pending', providerTaskAccepted: true });
});
test('FAL storage outage preserves the accepted task reservation', async () => {
  await assert.rejects(runDurableFalImageTool(request, {
    getImageJob: async () => ({ requestHash: hash, providerId: 'background-remove', status: 'submitted', providerTaskId: 'accepted-id' }),
    runFalImageTool: async () => Buffer.from('png'),
    storeImageResult: async () => { throw new Error('storage unavailable'); },
    failImageJob: async () => assert.fail('must not fail accepted task')
  }), { providerTaskAccepted: true });
});
