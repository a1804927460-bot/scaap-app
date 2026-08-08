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
  if (kind === 'video' && provider.protocol === 'minimax-video-v2') {
    throw Object.assign(new Error('MiniMax video generation must use the asynchronous task API.'), {
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
        throw Object.assign(new Error('MiniMax returned an unsafe video URL.'), {
          status: 502,
          code: 'unsafe-media-url'
        });
      }
      const download = await fetch(resultUrl, { signal: miniMaxSignal(signal, 120_000) });
      if (!download.ok) {
        throw Object.assign(new Error(`Could not download MiniMax video (HTTP ${download.status}).`), {
          status: download.status,
          code: 'provider-download-failed'
        });
      }
      const advertisedBytes = Number(download.headers.get('content-length')) || 0;
      if (advertisedBytes > 256 * 1024 * 1024) {
        throw Object.assign(new Error('MiniMax video is too large.'), { status: 413, code: 'media-too-large' });
      }
      const video = Buffer.from(await download.arrayBuffer());
      if (video.length > 256 * 1024 * 1024) {
        throw Object.assign(new Error('MiniMax video is too large.'), { status: 413, code: 'media-too-large' });
      }
      return video;
    }
    if (['failed', 'cancelled'].includes(result.status)) {
      throw Object.assign(new Error(result.errorMessage || 'MiniMax video generation failed.'), {
        status: 502,
        code: result.errorCode || 'video-generation-failed'
      });
    }
    await delayWithSignal(2_000, signal);
  }
  throw Object.assign(new Error('MiniMax video generation timed out.'), {
    status: 504,
    code: 'video-generation-timeout'
  });
}

async function responseJson(response) {
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch (error) {}
  if (!response.ok) {
    const upstreamCode = String(
      payload && payload.error && payload.error.code
      || payload && payload.base_resp && payload.base_resp.status_code
      || ''
    ).trim();
    const rawMessage = String(
      payload && payload.error && payload.error.message
      || payload && payload.base_resp && payload.base_resp.status_msg
      || payload && payload.message
      || `MiniMax request failed (HTTP ${response.status}).`
    );
    const retryAfter = Number(response.headers && response.headers.get && response.headers.get('retry-after'));
    const retryable = response.status === 429 || response.status >= 500;
    throw Object.assign(new Error(safeMiniMaxText(rawMessage, 'MiniMax request failed.')), {
      status: response.status,
      code: response.status === 429 ? 'provider-rate-limited' : (retryable ? 'provider-temporarily-unavailable' : 'provider-request-failed'),
      upstreamCode: safeMiniMaxText(upstreamCode, ''),
      retryable,
      retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(120_000, retryAfter * 1000) : 0
    });
  }
  return payload;
}

function safeMiniMaxText(value, fallback) {
  const text = String(value || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
  return text || fallback;
}

function miniMaxSignal(signal, timeoutMs = 25_000) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

function miniMaxHeaders(provider, includeJson = false) {
  return {
    Authorization: `Bearer ${provider.apiKey}`,
    ...(includeJson ? { 'Content-Type': 'application/json' } : {})
  };
}

function normalizeMiniMaxTaskStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (['succeeded', 'success', 'completed', 'complete'].includes(status)) return 'succeeded';
  if (['failed', 'failure', 'error'].includes(status)) return 'failed';
  if (['cancelled', 'canceled'].includes(status)) return 'cancelled';
  if (['processing', 'running', 'generating'].includes(status)) return 'running';
  return 'queued';
}

export async function createVideoTask(body, signal) {
  const provider = providerFor('video', String(body.providerId || ''));
  if (provider.protocol !== 'minimax-video-v2') {
    throw Object.assign(new Error('The selected video provider does not support asynchronous tasks.'), {
      status: 400,
      code: 'async-video-not-supported'
    });
  }
  const urls = Array.isArray(body.urls) ? body.urls.filter(Boolean).slice(0, 2) : [];
  const capabilities = provider.capabilities && typeof provider.capabilities === 'object'
    ? provider.capabilities
    : {};
  const ratio = String(body.aspectRatio || '');
  const resolution = String(body.resolution || '').toUpperCase();
  const duration = Number(body.duration);
  const validRatios = urls.length
    ? (Array.isArray(capabilities.frameReferenceRatios) ? capabilities.frameReferenceRatios : ['adaptive'])
    : (Array.isArray(capabilities.ratios) ? capabilities.ratios : []);
  if (!validRatios.includes(ratio)) {
    throw Object.assign(new Error('The MiniMax H3 aspect ratio is invalid for this generation mode.'), { status: 400, code: 'invalid-aspect-ratio' });
  }
  if (!Array.isArray(capabilities.resolutions) || !capabilities.resolutions.includes(resolution)) {
    throw Object.assign(new Error('MiniMax H3 resolution must be 768P or 2K.'), { status: 400, code: 'invalid-resolution' });
  }
  if (!Number.isInteger(duration) || duration < 4 || duration > 15) {
    throw Object.assign(new Error('MiniMax H3 duration must be a whole number from 4 to 15 seconds.'), { status: 400, code: 'invalid-duration' });
  }
  const content = [{ type: 'text', text: String(body.prompt || '').trim() }];
  urls.forEach((url, index) => content.push({
    type: 'image_url',
    image_url: { url: String(url) },
    role: index === 0 ? 'first_frame' : 'last_frame'
  }));
  const headers = miniMaxHeaders(provider, true);
  const created = await responseJson(await fetch(provider.endpoint, {
    method: 'POST', headers, signal: miniMaxSignal(signal),
    body: JSON.stringify({ model: provider.model || 'MiniMax-H3', content, resolution, duration, ratio, aigc_watermark: false })
  }));
  const taskId = String(created.task_id || '');
  if (!taskId || taskId.length > 256) {
    throw Object.assign(new Error('MiniMax did not return a valid task ID.'), {
      status: 502,
      code: 'provider-invalid-response',
      retryable: false
    });
  }
  return { providerId: provider.id, taskId };
}

export async function pollVideoTask(providerId, taskId, signal) {
  const provider = providerFor('video', String(providerId || ''));
  if (provider.protocol !== 'minimax-video-v2') {
    throw Object.assign(new Error('The selected video provider does not support task polling.'), {
      status: 400,
      code: 'async-video-not-supported'
    });
  }
  const normalizedTaskId = String(taskId || '').trim();
  if (!normalizedTaskId || normalizedTaskId.length > 256) {
    throw Object.assign(new Error('The video task identifier is invalid.'), { status: 400, code: 'invalid-video-task' });
  }
  const result = await responseJson(await fetch(
    `${provider.resultEndpoint}/${encodeURIComponent(normalizedTaskId)}`,
    { headers: miniMaxHeaders(provider), signal: miniMaxSignal(signal) }
  ));
  const task = result && result.task || {};
  const status = normalizeMiniMaxTaskStatus(task.status);
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
  if (status === 'failed' || status === 'cancelled') {
    const taskError = task.error && typeof task.error === 'object' ? task.error : {};
    return {
      status,
      errorCode: safeMiniMaxText(taskError.code, `provider-${status}`),
      errorMessage: safeMiniMaxText(taskError.message, `MiniMax video generation ${status}.`)
    };
  }
  return { status };
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
