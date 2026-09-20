import { setTimeout as delay } from 'node:timers/promises';

const origin = 'https://queue.fal.run';
export const falImageRoutes = [
  { providerId:'image-1', id:'fal-backup-nano-pro', model:'nano-banana-pro', protocol:'fal-nano-queue' },
  { providerId:'image-2', id:'fal-backup-nano-2', model:'nano-banana-2', protocol:'fal-image-queue' },
  { providerId:'image-6', id:'fal-backup-gpt-image-2', model:'gpt-image-2', protocol:'fal-image-queue' },
  { providerId:'image-19', id:'fal-backup-gpt-image-25-flare', model:'openai/gpt-image-2.5/flare', logicalModel:'gpt-image-2.5', protocol:'fal-image-queue' },
  { providerId:'image-19', id:'fal-backup-gpt-image-25-sun', model:'openai/gpt-image-2.5/sunburst', logicalModel:'gpt-image-2.5', protocol:'fal-image-queue' }
];
// Exact AIReiter official size table, not an approximate ratio conversion.
const gptSizes = {
  '1:1': [[1024,1024],[2048,2048]],
  '3:2': [[1536,1024],[2048,1360]], '2:3': [[1024,1536],[1360,2048]],
  '4:3': [[1024,768],[2048,1536]], '3:4': [[768,1024],[1536,2048]],
  '5:4': [[1280,1024],[2560,2048]], '4:5': [[1024,1280],[2048,2560]],
  '16:9': [[1536,864],[2048,1152],[3840,2160]], '9:16': [[864,1536],[1152,2048],[2160,3840]],
  '2:1': [[2048,1024],[2688,1344],[3840,1920]], '1:2': [[1024,2048],[1344,2688],[1920,3840]],
  '21:9': [[2016,864],[2688,1152],[3840,1648]], '9:21': [[864,2016],[1152,2688],[1648,3840]]
};
function incompatibleRequest() {
  return Object.assign(new Error('This request is not compatible with the backup image route.'), { code:'invalid-reference-media', status:400 });
}
export function falImageInput(provider, body) {
  const route = falImageRoutes.find(route => route.id === provider.id);
  if (!route) throw incompatibleRequest();
  if (route.model !== 'gpt-image-2' && !route.model.startsWith('openai/gpt-image-2.5/')) return falNanoInput(body);
  const prompt = String(body.prompt || '').trim();
  const urls = Array.isArray(body.urls) ? body.urls : [];
  const resolution = String(body.size || body.resolution || '2K').trim().toUpperCase();
  const ratio = String(body.aspectRatio || '1:1').trim();
  const dimensions = gptSizes[ratio === 'auto' ? '1:1' : ratio]?.[['1K','2K','4K'].indexOf(resolution)];
  const quality = String(body.quality || 'medium').trim().toLowerCase();
  if (!dimensions || !['low','medium','high'].includes(quality) || urls.length > 9
      || prompt.length < 2 || prompt.length > 32000 || Number(body.numImages || body.count || 1) !== 1
      || (body.outputFormat && !['png','jpeg','webp'].includes(body.outputFormat))) throw incompatibleRequest();
  return { prompt, image_size:{width:dimensions[0],height:dimensions[1]}, quality,
    num_images:1, output_format:body.outputFormat || 'png', sync_mode:false,
    ...(body.background ? { background:body.background } : {}),
    ...(urls.length ? {image_urls:urls} : {}) };
}
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
export async function generateFalImage(provider, body, signal, hooks, deps) {
  const input = falImageInput(provider, body);
  let model = falImageRoutes.find(route => route.id === provider.id).model;
  const isGpt25 = model.startsWith('openai/gpt-image-2.5/');
  if (isGpt25 && body.variant) {
    model = `openai/gpt-image-2.5/${String(body.variant || '').trim().toLowerCase() === 'sunburst' ? 'sunburst' : 'flare'}`;
  }
  const modelPath = `/${model.includes('/') ? model : `fal-ai/${model}`}`;
  const endpoint = `${origin}${modelPath}${input.image_urls ? '/edit' : isGpt25 ? '/text-to-image' : ''}`;
  const resultPaths = [modelPath, `${modelPath}/edit`, ...(isGpt25 ? [`${modelPath}/text-to-image`, '/openai/gpt-image-2.5'] : [])];
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
          && resultPaths.map(path => `${path}/requests/${taskId}`).includes(url.pathname)) taskUrl = url.href;
      }
      await hooks.onAccepted?.({ providerId:provider.id, taskId, pollUrl:`${taskUrl}/status` });
    } else if (body._acceptedTask.pollUrl) {
      const url = new URL(body._acceptedTask.pollUrl);
      if (url.origin !== origin || url.username || url.password || url.search || url.hash
        || !resultPaths.map(path => `${path}/requests/${taskId}/status`).includes(url.pathname)) throw new Error('Invalid stored image task endpoint.');
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

export const generateFalNano = generateFalImage;
