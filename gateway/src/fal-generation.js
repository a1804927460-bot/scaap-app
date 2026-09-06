import { setTimeout as delay } from 'node:timers/promises';

const origin = 'https://queue.fal.run';
const ratios = new Set(['auto','21:9','16:9','3:2','4:3','5:4','1:1','4:5','3:4','2:3','9:16']);
export function falNanoInput(body) {
  const urls = Array.isArray(body.urls) ? body.urls : [];
  const prompt = String(body.prompt || '').trim();
  const ratio = String(body.aspectRatio || body.ratio || 'auto');
  const resolution = String(body.size || body.resolution || '2K').toUpperCase();
  if (prompt.length < 3 || prompt.length > 50000 || urls.length > 8 || !ratios.has(ratio)
      || !['1K','2K','4K'].includes(resolution) || Number(body.numImages || body.count || 1) !== 1
      || (body.outputFormat && !['png','jpeg','webp'].includes(body.outputFormat))) {
    throw Object.assign(new Error('This request is not compatible with the backup image route.'), { code:'invalid-reference-media', status:400 });
  }
  return { prompt, resolution, aspect_ratio:ratio, num_images:1, output_format:body.outputFormat || 'png',
    sync_mode:false, limit_generations:true, ...(urls.length ? { image_urls:urls } : {}) };
}

// The persisted task identity is the recovery boundary. No POST retry is made
// after transport ambiguity, acceptance, polling, or result-storage failures.
export async function generateFalNano(provider, body, signal, hooks, deps) {
  const input = falNanoInput(body);
  const endpoint = `${origin}/fal-ai/nano-banana-pro${input.image_urls ? '/edit' : ''}`;
  const fetchImpl = deps.fetchImpl || fetch, sleep = deps.sleep || delay;
  let taskId = body._acceptedTask?.taskId || '', submitted = false, accepted = Boolean(taskId);
  let taskUrl = `${endpoint}/requests/${encodeURIComponent(taskId)}`;
  const request = async (url, method = 'GET', payload) => {
    const response = await fetchImpl(url, { method, redirect:'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
      headers: { Authorization:`Key ${provider.apiKey}`, 'Content-Type':'application/json' },
      ...(payload ? { body:JSON.stringify(payload) } : {}) });
    if (!response.ok) throw Object.assign(new Error('Image upstream request failed.'), {
      code:'provider-request-failed', status:502,
      safeToFallback:method === 'POST' && [401,402,404,429].includes(response.status),
      rejected:method === 'POST' && [400,401,402,403,404,422,429].includes(response.status),
      providerTaskTerminalFailure:accepted && response.status === 422
    });
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 1024 * 1024) throw new Error('Image upstream response exceeds limit.');
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  };
  try {
    if (!taskId) {
      submitted = true;
      const task = await request(endpoint,'POST',input);
      accepted = true;
      taskId = task.request_id;
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(taskId || '')) throw new Error('Missing image task identity.');
      taskUrl = `${endpoint}/requests/${taskId}`;
      // FAL may return the parent model path for edit requests. Allow only
      // this model and this exact task ID, never arbitrary credentialed URLs.
      if (task.response_url) {
        const url = new URL(task.response_url);
        if (url.origin === origin && !url.username && !url.password && !url.search && !url.hash
          && [`/fal-ai/nano-banana-pro/requests/${taskId}`, `/fal-ai/nano-banana-pro/edit/requests/${taskId}`].includes(url.pathname)) taskUrl = url.href;
      }
      await hooks.onAccepted?.({ providerId:provider.id, taskId, pollUrl:`${taskUrl}/status` });
    } else if (body._acceptedTask.pollUrl) {
      const url = new URL(body._acceptedTask.pollUrl);
      if (url.origin !== origin || url.username || url.password || url.search || url.hash
        || ![`/fal-ai/nano-banana-pro/requests/${taskId}/status`, `/fal-ai/nano-banana-pro/edit/requests/${taskId}/status`].includes(url.pathname)) throw new Error('Invalid stored image task endpoint.');
      taskUrl = url.href.slice(0,-7);
    }
    const deadline = Date.now() + 20 * 60_000;
    while (Date.now() < deadline) {
      const state = await request(`${taskUrl}/status`);
      if (state.status === 'COMPLETED') {
        const result = await request(taskUrl);
        const mediaUrl = result.images?.[0]?.url;
        if (!mediaUrl || result.images.length !== 1) throw new Error('Unexpected image result count.');
        const buffer = await deps.download(mediaUrl,signal);
        await hooks.onReady?.({ providerId:provider.id, taskId, mediaUrl, buffer });
        return buffer;
      }
      if (!['IN_QUEUE','IN_PROGRESS'].includes(state.status)) throw new Error('Unexpected image task status.');
      await sleep(1500,undefined,{signal});
    }
    throw Object.assign(new Error('Image task is still processing.'),{code:'provider-timeout',status:504});
  } catch(error) {
    if (accepted) { error.providerTaskAccepted=true; error.taskId=taskId; error.safeToFallback=false; }
    else if (submitted && !error.rejected) error.submissionAmbiguous=true;
    throw error;
  }
}
