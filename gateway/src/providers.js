import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { generateMediaBuffer } = require('../../lib/ai-media-provider');
const { requestChat, discoverChatModels } = require('../../lib/ai-chat-provider');
const { PROVIDER_CATALOG_VERSION, providerCatalog } = require('../../lib/provider-catalog');

const QUICKROUTER_BASE_URL = 'https://api.quickrouter.ai';
const DEFAULT_RESULT_ENDPOINT = `${QUICKROUTER_BASE_URL}/v1/videos`;
const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PROVIDER_KEY_ENV = /^[A-Z][A-Z0-9_]{1,80}$/;
const MAX_PROVIDERS = 100;
const ASYNC_VIDEO_PROTOCOLS = new Set(['minimax-video-v2', 'seedance-video-v3']);
const TERMINAL_VIDEO_FAILURES = new Set(['failed', 'cancelled', 'expired']);

function safeServerEndpoint(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local') || host === '0.0.0.0' || host === '::1') return '';
    if (/^(?:10|127|169\.254|192\.168)\./.test(host)) return '';
    const private172 = /^172\.(\d{1,3})\./.exec(host);
    if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return '';
    return url.toString();
  } catch (error) {
    return '';
  }
}

function builtinProviders() {
  return providerCatalog().map((provider) => ({
    ...provider,
    resultEndpoint: provider.resultEndpoint || DEFAULT_RESULT_ENDPOINT
  }));
}

function configuredProviders() {
  let extra = [];
  try {
    const parsed = JSON.parse(process.env.AI_PROVIDERS_JSON || '[]');
    if (Array.isArray(parsed)) extra = parsed;
  } catch (error) {
    throw new Error('AI_PROVIDERS_JSON is not valid JSON.');
  }
  const byId = new Map();
  for (const raw of [...builtinProviders(), ...extra].slice(0, MAX_PROVIDERS)) {
    const id = String(raw.id || '').trim().toLowerCase();
    const kind = ['chat', 'image', 'video'].includes(raw.kind) ? raw.kind : '';
    const endpoint = safeServerEndpoint(raw.endpoint);
    const keyEnv = String(raw.keyEnv || '').trim();
    if (!PROVIDER_ID.test(id) || !kind || !endpoint || !PROVIDER_KEY_ENV.test(keyEnv)) continue;
    byId.set(id, {
      id, kind,
      name: String(raw.name || id).trim().slice(0, 80),
      endpoint,
      resultEndpoint: safeServerEndpoint(raw.resultEndpoint) || DEFAULT_RESULT_ENDPOINT,
      models: Array.isArray(raw.models) ? raw.models.map(String).map((v) => v.trim()).filter(Boolean).slice(0, 30) : [],
      model: String(raw.model || '').trim().slice(0, 120),
      protocol: String(raw.protocol || '').trim().slice(0, 40),
      capabilities: raw.capabilities && typeof raw.capabilities === 'object' ? raw.capabilities : null,
      keyEnv
    });
  }
  return [...byId.values()];
}

function providerApiKey(provider) {
  const direct = String(process.env[provider.keyEnv] || '').trim();
  if (direct) return direct;
  if (provider.keyEnv === 'QUICKROUTER_API_KEY') {
    return String(process.env.QUICK_API_KEY || process.env.Quick_API_KEY || '').trim();
  }
  return '';
}

export function publicProviderConfig() {
  const providers = configuredProviders().filter((provider) => Boolean(providerApiKey(provider)));
  return {
    catalogVersion: PROVIDER_CATALOG_VERSION,
    providers: providers.map(({ keyEnv, endpoint, resultEndpoint, ...provider }) => provider)
  };
}

export const catalogVersion = PROVIDER_CATALOG_VERSION;

function configuredProvider(kind, id) {
  const candidates = configuredProviders().filter((provider) => provider.kind === kind);
  const requestedId = String(id || '').trim().toLowerCase();
  return requestedId
    ? candidates.find((provider) => provider.id === requestedId)
    : candidates[0];
}

export function providerCapabilities(kind, id) {
  const selected = configuredProvider(kind, id);
  return selected && selected.capabilities && typeof selected.capabilities === 'object'
    ? selected.capabilities
    : null;
}

function providerFor(kind, id) {
  const selected = configuredProvider(kind, id);
  if (!selected) throw Object.assign(new Error(`No ${kind} provider is configured.`), { code: 'provider-not-configured' });
  const apiKey = providerApiKey(selected);
  if (!apiKey) throw Object.assign(new Error(`The server secret ${selected.keyEnv} is missing.`), { code: 'provider-secret-missing' });
  return { ...selected, apiKey };
}

export async function generateMedia(kind, body, signal) {
  const provider = providerFor(kind, String(body.providerId || ''));
  if (kind === 'video' && ASYNC_VIDEO_PROTOCOLS.has(provider.protocol)) {
    throw Object.assign(new Error('The selected video provider must use the asynchronous task API.'), {
      status: 409,
      code: 'async-video-required'
    });
  }
  const config = {
    apiKey: provider.apiKey,
    resultEndpoint: provider.resultEndpoint,
    imageEndpoint: kind === 'image' ? provider.endpoint : undefined,
    imageModel: kind === 'image' ? provider.model : undefined,
    videoEndpoint: kind === 'video' ? provider.endpoint : undefined,
    maxDownloadBytes: kind === 'video' ? 256 * 1024 * 1024 : 64 * 1024 * 1024,
    timeoutMs: 20 * 60_000,
    pollIntervalMs: 2_000
  };
  return generateMediaBuffer(fetch, config, kind, body, signal);
}

function delayWithSignal(ms, signal) {
  if (signal && signal.aborted) return Promise.reject(signal.reason || new Error('Aborted'));
  return new Promise((resolve, reject) => {
    const finish = () => {
      if (signal) signal.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(signal.reason || new Error('Aborted'));
    };
    if (signal) signal.addEventListener('abort', abort, { once: true });
  });
}

export async function generateLegacyVideo(body, signal) {
  const task = await createVideoTask(body, signal);
  const deadline = Date.now() + 20 * 60_000;
  while (Date.now() < deadline) {
    const result = await pollVideoTask(task.providerId, task.taskId, signal);
    if (result.status === 'succeeded') {
      const resultUrl = safeServerEndpoint(result.resultUrl);
      if (!resultUrl) {
        throw Object.assign(new Error('The video provider returned an unsafe video URL.'), {
          status: 502,
          code: 'unsafe-media-url'
        });
      }
      const download = await fetch(resultUrl, { signal: providerSignal(signal, 120_000) });
      if (!download.ok) {
        throw Object.assign(new Error(`Could not download the generated video (HTTP ${download.status}).`), {
          status: download.status,
          code: 'provider-download-failed'
        });
      }
      const advertisedBytes = Number(download.headers.get('content-length')) || 0;
      if (advertisedBytes > 256 * 1024 * 1024) {
        throw Object.assign(new Error('The generated video is too large.'), { status: 413, code: 'media-too-large' });
      }
      const video = Buffer.from(await download.arrayBuffer());
      if (video.length > 256 * 1024 * 1024) {
        throw Object.assign(new Error('The generated video is too large.'), { status: 413, code: 'media-too-large' });
      }
      return video;
    }
    if (TERMINAL_VIDEO_FAILURES.has(result.status)) {
      throw Object.assign(new Error(result.errorMessage || 'Video generation failed.'), {
        status: 502,
        code: result.errorCode || 'video-generation-failed'
      });
    }
    await delayWithSignal(2_000, signal);
  }
  throw Object.assign(new Error('Video generation timed out.'), {
    status: 504,
    code: 'video-generation-timeout'
  });
}

async function responseJson(response, providerName = 'Video provider') {
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch (error) {}
  if (!response.ok) {
    const upstreamCode = String(
      payload && payload.error && payload.error.code
      || payload && payload.base_resp && payload.base_resp.status_code
      || payload && payload.code
      || ''
    ).trim();
    const rawMessage = String(
      payload && payload.error && payload.error.message
      || payload && payload.base_resp && payload.base_resp.status_msg
      || payload && payload.message
      || `${providerName} request failed (HTTP ${response.status}).`
    );
    const retryAfter = Number(response.headers && response.headers.get && response.headers.get('retry-after'));
    const retryable = response.status === 429 || response.status >= 500;
    throw Object.assign(new Error(safeProviderText(rawMessage, `${providerName} request failed.`)), {
      status: response.status,
      code: response.status === 429 ? 'provider-rate-limited' : (retryable ? 'provider-temporarily-unavailable' : 'provider-request-failed'),
      upstreamCode: safeProviderText(upstreamCode, ''),
      retryable,
      retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(120_000, retryAfter * 1000) : 0
    });
  }
  return payload;
}

function safeProviderText(value, fallback) {
  const text = String(value || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
  return text || fallback;
}

function providerSignal(signal, timeoutMs = 25_000) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

function providerHeaders(provider, includeJson = false) {
  return {
    Authorization: `Bearer ${provider.apiKey}`,
    ...(includeJson ? { 'Content-Type': 'application/json' } : {})
  };
}

function normalizeVideoTaskStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (['succeeded', 'success', 'completed', 'complete'].includes(status)) return 'succeeded';
  if (['failed', 'failure', 'error'].includes(status)) return 'failed';
  if (['cancelled', 'canceled'].includes(status)) return 'cancelled';
  if (status === 'expired') return 'expired';
  if (['processing', 'running', 'generating'].includes(status)) return 'running';
  return 'queued';
}

function validatedVideoTaskInput(provider, body) {
  const capabilities = provider.capabilities && typeof provider.capabilities === 'object'
    ? provider.capabilities
    : {};
  const submittedUrls = Array.isArray(body.urls) ? body.urls.filter(Boolean) : [];
  const configuredLimit = Number(capabilities.maxReferenceImages);
  const maxReferenceImages = Number.isInteger(configuredLimit) && configuredLimit >= 0
    ? Math.min(14, configuredLimit)
    : 2;
  if (submittedUrls.length > maxReferenceImages) {
    throw Object.assign(new Error(`${provider.name} accepts at most ${maxReferenceImages} reference images.`), {
      status: 400,
      code: 'too-many-references'
    });
  }
  const urls = submittedUrls.slice(0, maxReferenceImages);
  const ratio = String(body.aspectRatio || '');
  const resolution = String(body.resolution || '').toUpperCase();
  const duration = Number(body.duration);
  const validRatios = urls.length
    ? (Array.isArray(capabilities.frameReferenceRatios) ? capabilities.frameReferenceRatios : ['adaptive'])
    : (Array.isArray(capabilities.ratios) ? capabilities.ratios : []);
  if (!validRatios.includes(ratio)) {
    throw Object.assign(new Error(`${provider.name} does not support this aspect ratio for the selected generation mode.`), {
      status: 400,
      code: 'invalid-aspect-ratio'
    });
  }
  const validResolutions = Array.isArray(capabilities.resolutions)
    ? capabilities.resolutions.map((value) => String(value).toUpperCase())
    : [];
  if (!validResolutions.includes(resolution)) {
    throw Object.assign(new Error(`${provider.name} does not support this resolution.`), {
      status: 400,
      code: 'invalid-resolution'
    });
  }
  const validDurations = Array.isArray(capabilities.durations)
    ? capabilities.durations.map(Number).filter(Number.isInteger)
    : [];
  if (!Number.isInteger(duration) || (validDurations.length ? !validDurations.includes(duration) : duration < 4 || duration > 15)) {
    throw Object.assign(new Error(`${provider.name} does not support this duration.`), {
      status: 400,
      code: 'invalid-duration'
    });
  }
  return { capabilities, duration, ratio, resolution, urls };
}

async function createMiniMaxVideoTask(provider, body, signal) {
  const { duration, ratio, resolution, urls } = validatedVideoTaskInput(provider, body);
  const content = [{ type: 'text', text: String(body.prompt || '').trim() }];
  urls.forEach((url, index) => content.push({
    type: 'image_url',
    image_url: { url: String(url) },
    role: index === 0 ? 'first_frame' : 'last_frame'
  }));
  const headers = providerHeaders(provider, true);
  const created = await responseJson(await fetch(provider.endpoint, {
    method: 'POST', headers, signal: providerSignal(signal),
    body: JSON.stringify({ model: provider.model || 'MiniMax-H3', content, resolution, duration, ratio, aigc_watermark: false })
  }), provider.name);
  const taskId = String(created.task_id || '');
  if (!taskId || taskId.length > 256) {
    throw Object.assign(new Error(`${provider.name} did not return a valid task ID.`), {
      status: 502,
      code: 'provider-invalid-response',
      retryable: false
    });
  }
  return { providerId: provider.id, taskId };
}

async function createSeedanceVideoTask(provider, body, signal) {
  const { capabilities, duration, ratio, resolution, urls } = validatedVideoTaskInput(provider, body);
  const content = [{ type: 'text', text: String(body.prompt || '').trim() }];
  urls.forEach((url) => content.push({
    type: 'image_url',
    image_url: { url: String(url) },
    role: String(capabilities.referenceRole || 'reference_image')
  }));
  const created = await responseJson(await fetch(provider.endpoint, {
    method: 'POST',
    headers: providerHeaders(provider, true),
    signal: providerSignal(signal),
    body: JSON.stringify({
      model: provider.model,
      content,
      generate_audio: capabilities.generateAudio !== false,
      ratio,
      duration,
      resolution: resolution.toLowerCase(),
      watermark: false
    })
  }), provider.name);
  const taskId = String(created.id || '').trim();
  if (!taskId || taskId.length > 256) {
    throw Object.assign(new Error(`${provider.name} did not return a valid task ID.`), {
      status: 502,
      code: 'provider-invalid-response',
      retryable: false
    });
  }
  return { providerId: provider.id, taskId };
}

export async function createVideoTask(body, signal) {
  const provider = providerFor('video', String(body.providerId || ''));
  if (provider.protocol === 'minimax-video-v2') return createMiniMaxVideoTask(provider, body, signal);
  if (provider.protocol === 'seedance-video-v3') return createSeedanceVideoTask(provider, body, signal);
  throw Object.assign(new Error('The selected video provider does not support asynchronous tasks.'), {
    status: 400,
    code: 'async-video-not-supported'
  });
}

function validVideoTaskId(taskId) {
  const normalizedTaskId = String(taskId || '').trim();
  if (!normalizedTaskId || normalizedTaskId.length > 256) {
    throw Object.assign(new Error('The video task identifier is invalid.'), { status: 400, code: 'invalid-video-task' });
  }
  return normalizedTaskId;
}

async function pollMiniMaxVideoTask(provider, taskId, signal) {
  const normalizedTaskId = validVideoTaskId(taskId);
  const result = await responseJson(await fetch(
    `${provider.resultEndpoint}/${encodeURIComponent(normalizedTaskId)}`,
    { headers: providerHeaders(provider), signal: providerSignal(signal) }
  ), provider.name);
  const task = result && result.task || {};
  const status = normalizeVideoTaskStatus(task.status);
  if (status === 'succeeded') {
    const resultUrl = String(task.content && task.content.url || '').trim();
    if (!resultUrl) {
      return {
        status: 'failed',
        errorCode: 'provider-result-missing',
        errorMessage: 'MiniMax completed the task without a downloadable video.'
      };
    }
    return { status, resultUrl };
  }
  if (TERMINAL_VIDEO_FAILURES.has(status)) {
    const taskError = task.error && typeof task.error === 'object' ? task.error : {};
    return {
      status,
      errorCode: safeProviderText(taskError.code, `provider-${status}`),
      errorMessage: safeProviderText(taskError.message, `${provider.name} video generation ${status}.`)
    };
  }
  return { status };
}

async function pollSeedanceVideoTask(provider, taskId, signal) {
  const normalizedTaskId = validVideoTaskId(taskId);
  const result = await responseJson(await fetch(
    `${provider.resultEndpoint}/${encodeURIComponent(normalizedTaskId)}`,
    { headers: providerHeaders(provider), signal: providerSignal(signal) }
  ), provider.name);
  const status = normalizeVideoTaskStatus(result && result.status);
  if (status === 'succeeded') {
    const content = result && result.content && typeof result.content === 'object' ? result.content : {};
    const resultUrl = String(content.video_url || content.url || '').trim();
    if (!resultUrl) {
      return {
        status: 'failed',
        errorCode: 'provider-result-missing',
        errorMessage: `${provider.name} completed the task without a downloadable video.`
      };
    }
    return { status, resultUrl };
  }
  if (TERMINAL_VIDEO_FAILURES.has(status)) {
    const taskError = result && result.error && typeof result.error === 'object' ? result.error : {};
    return {
      status,
      errorCode: safeProviderText(taskError.code || result && result.code, `provider-${status}`),
      errorMessage: safeProviderText(taskError.message || result && result.message, `${provider.name} video generation ${status}.`)
    };
  }
  return { status };
}

export async function pollVideoTask(providerId, taskId, signal) {
  const provider = providerFor('video', String(providerId || ''));
  if (provider.protocol === 'minimax-video-v2') return pollMiniMaxVideoTask(provider, taskId, signal);
  if (provider.protocol === 'seedance-video-v3') return pollSeedanceVideoTask(provider, taskId, signal);
  throw Object.assign(new Error('The selected video provider does not support task polling.'), {
    status: 400,
    code: 'async-video-not-supported'
  });
}

export async function chat(body, signal) {
  const provider = providerFor('chat', String(body.providerId || ''));
  const requestedModel = String(body.model || '').trim();
  const model = provider.models.includes(requestedModel) ? requestedModel : provider.models[0];
  return requestChat(fetch, {
    apiKey: provider.apiKey,
    chatEndpoint: provider.endpoint,
    chatProviderName: provider.name,
    chatModel: model || requestedModel
  }, { prompt: body.prompt, messages: body.messages }, signal);
}

export async function models(providerId) {
  const provider = providerFor('chat', String(providerId || ''));
  const result = await discoverChatModels(fetch, provider.endpoint, provider.apiKey);
  return { ...result, providerId: provider.id };
}
