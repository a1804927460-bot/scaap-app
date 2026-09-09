import { runFalImageTool } from './fal-image-tools.js';
import { getImageJob, claimImageJob, hashImageRequest, recordImageProviderTask, recordImageProviderResult, failImageJob } from './image-jobs.js';
import { readStoredImageResult, storeImageResult } from './image-result-storage.js';

function pending() {
  return Object.assign(new Error('The accepted image task is awaiting recovery.'), {
    code: 'provider-task-recovery-pending', status: 503, providerTaskAccepted: true
  });
}

export async function runDurableFalImageTool({ userId, requestId, model, imageDataUrl, options = {} }, deps = {}) {
  const api = { getImageJob, claimImageJob, recordImageProviderTask, recordImageProviderResult,
    failImageJob, readStoredImageResult, storeImageResult, runFalImageTool, ...deps };
  const providerId = model === 'feynobg' ? 'background-remove' : model === 'topaz/upscale/image' ? 'clipdrop-upscale' : 'clipdrop-uncrop';
  const requestHash = hashImageRequest({ model, imageDataUrl, options });
  let job;
  try { job = await api.getImageJob(userId, requestId); }
  catch { throw pending(); }
  if (job && (job.requestHash !== requestHash || job.providerId !== providerId)) {
    throw Object.assign(new Error('Request identifier conflict.'), { code: 'request-id-conflict', status: 409, providerTaskAccepted: true });
  }
  if (!job) {
    // The database claim elects one submitter, including across gateway replicas.
    try {
      job = await api.claimImageJob({ userId, requestId, requestHash, providerId,
        deadlineAt: new Date(Date.now() + 25 * 60_000).toISOString() });
    } catch {
      // A timed-out claim may have committed. Do not release or resubmit it.
      throw pending();
    }
  }
  if (job.status === 'failed') throw Object.assign(new Error('Image task failed.'), { code: 'provider-request-failed', status: 502 });
  if (job.resultUrl?.startsWith('storage://')) {
    try { return await api.readStoredImageResult(userId, requestId, job.resultUrl); }
    catch (error) { error.providerTaskAccepted = true; throw error; }
  }
  const taskId = job.status === 'submitted' ? job.providerTaskId : '';
  if (!taskId && job.reason !== 'claimed') throw pending();
  let accepted = Boolean(taskId);
  try {
    const output = await api.runFalImageTool(model, imageDataUrl, options, {
      existingTaskId: taskId || undefined,
      onAccepted: async ({ taskId, pollUrl }) => {
        accepted = true;
        await api.recordImageProviderTask({ userId, requestId, requestHash, providerId, providerTaskId: taskId, pollUrl });
      }
    });
    accepted = true;
    const reference = await api.storeImageResult(userId, requestId, output);
    await api.recordImageProviderResult(userId, requestId, reference);
    return output;
  } catch (error) {
    if (accepted || error.providerTaskAccepted || error.submissionAmbiguous) {
      error.providerTaskAccepted = true;
    } else {
      try { await api.failImageJob(userId, requestId, error); }
      catch { throw pending(); }
    }
    throw error;
  }
}
