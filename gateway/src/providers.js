import { createRequire } from 'node:module';
import {
  deleteAi302RelayAsset,
  parseImageDataUrl,
  storeAi302RelayAsset,
  stripImageMetadata
} from './ai302-tools.js';

const require = createRequire(import.meta.url);
const { detectMediaProtocol, generateMediaBuffer } = require('../../lib/ai-media-provider');
const { requestChat, discoverChatModels } = require('../../lib/ai-chat-provider');
const { PROVIDER_CATALOG_VERSION, providerCatalog } = require('../../lib/provider-catalog');

const QUICKROUTER_BASE_URL = 'https://api.quickrouter.ai';
const DEFAULT_RESULT_ENDPOINT = `${QUICKROUTER_BASE_URL}/v1/videos`;
const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PROVIDER_KEY_ENV = /^[A-Z][A-Z0-9_]{1,80}$/;
const MAX_PROVIDERS = 100;
const ASYNC_VIDEO_PROTOCOLS = new Set([
  'minimax-video-v2',
  'seedance-video-v3',
  'jimeng-video-v30',
  'jimeng-video-v30-pro'
]);
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
      hidden: raw.hidden === true,
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
  const providers = configuredProviders().filter((provider) => !provider.hidden && Boolean(providerApiKey(provider)));
  return {
    catalogVersion: PROVIDER_CATALOG_VERSION,
    providers: providers.map(({ keyEnv, endpoint, resultEndpoint, hidden, ...provider }) => provider)
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

export function providerPromptLimit(kind, id, hasReferences = false) {
  const capabilities = providerCapabilities(kind, id) || {};
  const fallback = kind === 'video' ? 7_000 : 12_000;
  const configured = Number(
    hasReferences && capabilities.referencePromptMaxCharacters !== undefined
      ? capabilities.referencePromptMaxCharacters
      : capabilities.promptMaxCharacters
  );
  return Number.isInteger(configured) && configured > 0
    ? Math.min(32_000, configured)
    : fallback;
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
  const relayTokens = [];
  let requestBody = body;
  if (kind === 'image' && detectMediaProtocol(provider.endpoint).startsWith('ai302-nano-banana-')) {
    try {
      const urls = Array.isArray(body.urls) ? body.urls.slice(0, 14).map((value) => {
        const source = String(value || '').trim();
        if (!/^data:image\//i.test(source)) return source;
        const image = stripImageMetadata(parseImageDataUrl(source, { maxBytes: 24 * 1024 * 1024 }));
        const relay = storeAi302RelayAsset(image);
        relayTokens.push(relay.token);
        return relay.url;
      }) : [];
      requestBody = { ...body, urls };
    } catch (error) {
      relayTokens.forEach((token) => deleteAi302RelayAsset(token));
      throw error;
    }
  }
  try {
    return await generateMediaBuffer(fetch, config, kind, requestBody, signal);
  } finally {
    relayTokens.forEach((token) => deleteAi302RelayAsset(token));
  }
}

const imageStyleCache = new Map();

export async function imageStyles(providerId, signal) {
  const provider = providerFor('image', String(providerId || ''));
  if (!['higgsfield-soul-standard', 'higgsfield-soul'].includes(provider.protocol)) {
    throw Object.assign(new Error('The selected image provider does not expose styles.'), {
      status: 400,
      code: 'image-styles-not-supported'
    });
  }
  const cached = imageStyleCache.get(provider.id);
  if (cached && cached.expiresAt > Date.now()) return cached.styles;
  const endpoint = new URL(provider.endpoint);
  endpoint.pathname = '/higgsfield/v1/text2image/soul-styles';
  endpoint.search = '';
  endpoint.hash = '';
  const payload = await responseJson(await fetch(endpoint, {
    headers: providerHeaders(provider),
    signal: providerSignal(signal, 20_000)
  }), provider.name);
  if (!Array.isArray(payload)) {
    throw Object.assign(new Error('Higgsfield returned an invalid style list.'), {
      status: 502,
      code: 'invalid-provider-response'
    });
  }
  const styles = payload.slice(0, 300).map((entry) => ({
    id: String(entry && (entry.platform_id || entry.id) || '').trim(),
    name: String(entry && entry.name || '').trim().slice(0, 100),
    description: String(entry && entry.description || '').trim().slice(0, 300),
    previewUrl: safeServerEndpoint(entry && entry.preview_url)
  })).filter((entry) => /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(entry.id) && entry.name);
  imageStyleCache.set(provider.id, { styles, expiresAt: Date.now() + 15 * 60_000 });
  return styles;
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

function retryableProviderRequestError(error) {
  const status = Number(error && error.status);
  const name = String(error && error.name || '');
  return error && error.retryable === true
    || status === 408
    || status === 425
    || status === 429
    || status >= 500
    || ['AbortError', 'TimeoutError', 'TypeError'].includes(name);
}

async function providerRequestWithRetry(provider, request, signal, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await responseJson(await request(), provider.name);
    } catch (error) {
      lastError = error;
      if (!retryableProviderRequestError(error) || attempt + 1 >= attempts || (signal && signal.aborted)) throw error;
      const suppliedDelay = Number(error && error.retryAfterMs);
      const delayMs = Number.isFinite(suppliedDelay) && suppliedDelay > 0
        ? Math.min(10_000, suppliedDelay)
        : 750 * (attempt + 1);
      await delayWithSignal(delayMs, signal);
    }
  }
  throw lastError;
}

function providerTaskHeaders(provider, body) {
  const requestId = String(body && body.operationId || '').trim();
  return {
    ...providerHeaders(provider, true),
    ...(requestId ? { 'Idempotency-Key': requestId, 'X-Request-Id': requestId } : {})
  };
}

function providerHeaders(provider, includeJson = false) {
  return {
    Authorization: `Bearer ${provider.apiKey}`,
    ...(includeJson ? { 'Content-Type': 'application/json' } : {})
  };
}

function normalizeVideoTaskStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (['succeeded', 'success', 'completed', 'complete', 'done', 'finished'].includes(status)) return 'succeeded';
  if (['failed', 'failure', 'error'].includes(status)) return 'failed';
  if (['cancelled', 'canceled'].includes(status)) return 'cancelled';
  if (status === 'expired') return 'expired';
  if (['processing', 'running', 'generating', 'in_progress'].includes(status)) return 'running';
  return 'queued';
}

const VIDEO_MODE_IDS = new Set(['text', 'first-frame', 'first-last-frame', 'omni']);

function videoModeDefinition(capabilities, value, referenceCount) {
  const modes = Array.isArray(capabilities.videoModes) ? capabilities.videoModes : [];
  const requested = String(value || '').trim().toLowerCase();
  const fallback = referenceCount > 2
    ? 'omni'
    : referenceCount === 2
      ? 'first-last-frame'
      : referenceCount === 1 ? 'first-frame' : 'text';
  const id = VIDEO_MODE_IDS.has(requested) ? requested : fallback;
  const mode = modes.find((entry) => entry && entry.id === id) || (!modes.length
    ? (() => {
        const configuredMinimum = Math.max(0, Number(capabilities.minReferenceImages) || 0);
        const configuredMaximum = Math.max(configuredMinimum, Number(capabilities.maxReferenceImages) || 0);
        const legacyRoles = Array.isArray(capabilities.referenceRoles)
          ? capabilities.referenceRoles.map(String).filter(Boolean)
          : ['first_frame', 'last_frame'];
        if (id === 'text') {
          return { id, minReferences: configuredMinimum, maxReferences: configuredMinimum ? configuredMaximum : 0 };
        }
        if (id === 'first-frame') {
          return { id, minReferences: 1, maxReferences: 1, roles: legacyRoles.slice(0, 1) };
        }
        if (id === 'first-last-frame') {
          return { id, minReferences: 2, maxReferences: Math.max(2, configuredMaximum), roles: legacyRoles };
        }
        return { id, minReferences: 1, maxReferences: configuredMaximum, roles: ['reference_image'] };
      })()
    : null);
  if (!mode) {
    throw Object.assign(new Error('The selected video generation mode is not supported.'), {
      status: 400,
      code: 'invalid-video-mode'
    });
  }
  return mode;
}

function validatedVideoTaskInput(provider, body) {
  const capabilities = provider.capabilities && typeof provider.capabilities === 'object'
    ? provider.capabilities
    : {};
  const submittedUrls = Array.isArray(body.urls) ? body.urls.filter(Boolean) : [];
  const mode = videoModeDefinition(capabilities, body.videoMode, submittedUrls.length);
  const minReferenceImages = Math.max(0, Math.min(14, Number(mode.minReferences) || 0));
  const maxReferenceImages = Math.max(minReferenceImages, Math.min(14, Number(mode.maxReferences) || 0));
  if (submittedUrls.length > maxReferenceImages) {
    throw Object.assign(new Error(`${provider.name} accepts at most ${maxReferenceImages} reference images.`), {
      status: 400,
      code: 'too-many-references'
    });
  }
  if (submittedUrls.length < minReferenceImages) {
    throw Object.assign(new Error(`${provider.name} requires at least ${minReferenceImages} reference image${minReferenceImages === 1 ? '' : 's'}.`), {
      status: 400,
      code: 'reference-required'
    });
  }
  const urls = submittedUrls.slice(0, maxReferenceImages);
  const referenceMediaTypes = Array.isArray(body.referenceMediaTypes)
    ? body.referenceMediaTypes.slice(0, urls.length).map((value) => String(value || '').trim().toLowerCase())
    : urls.map(() => 'image');
  if (referenceMediaTypes.length !== urls.length) {
    throw Object.assign(new Error('The reference media selection is incomplete.'), {
      status: 400,
      code: 'invalid-reference-media'
    });
  }
  const allowedMediaTypes = new Set(
    Array.isArray(mode.mediaTypes) && mode.mediaTypes.length
      ? mode.mediaTypes.map((value) => String(value || '').trim().toLowerCase())
      : ['image']
  );
  if (referenceMediaTypes.some((mediaType) => !allowedMediaTypes.has(mediaType))) {
    throw Object.assign(new Error(`${provider.name} does not accept reference videos in this mode.`), {
      status: 400,
      code: 'invalid-reference-media'
    });
  }
  const referenceVideoCount = referenceMediaTypes.filter((mediaType) => mediaType === 'video').length;
  const maximumReferenceVideos = Math.max(0, Number(mode.maxReferenceVideos) || 0);
  if (referenceVideoCount > maximumReferenceVideos) {
    throw Object.assign(new Error(`${provider.name} accepts at most ${maximumReferenceVideos} reference videos.`), {
      status: 400,
      code: 'too-many-reference-videos'
    });
  }
  const ratio = String(body.aspectRatio || '');
  const resolution = String(body.resolution || '').toUpperCase();
  const duration = Number(body.duration);
  const validRatios = Array.isArray(mode.ratios) && mode.ratios.length
    ? mode.ratios
    : (mode.id === 'first-frame' || mode.id === 'first-last-frame')
      ? (Array.isArray(capabilities.frameReferenceRatios) ? capabilities.frameReferenceRatios : ['adaptive'])
      : (Array.isArray(capabilities.ratios) ? capabilities.ratios : []);
  if (!validRatios.includes(ratio)) {
    throw Object.assign(new Error(`${provider.name} does not support this aspect ratio for the selected generation mode.`), {
      status: 400,
      code: 'invalid-aspect-ratio'
    });
  }
  const resolutionSource = mode.id !== 'text' && Array.isArray(capabilities.referenceResolutions)
    ? capabilities.referenceResolutions
    : capabilities.resolutions;
  const validResolutions = Array.isArray(resolutionSource)
    ? resolutionSource.map((value) => String(value).toUpperCase())
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
  const configuredRoles = Array.isArray(mode.roles) ? mode.roles.map(String).filter(Boolean) : [];
  const roles = urls.map((_url, index) => configuredRoles[index] || configuredRoles[0] || 'reference_image');
  return { capabilities, duration, mode: mode.id, ratio, referenceMediaTypes, resolution, roles, urls };
}

async function createMiniMaxVideoTask(provider, body, signal) {
  const { duration, ratio, resolution, roles, urls } = validatedVideoTaskInput(provider, body);
  const content = [{ type: 'text', text: String(body.prompt || '').trim() }];
  urls.forEach((url, index) => content.push({
    type: 'image_url',
    image_url: { url: String(url) },
    role: roles[index]
  }));
  const requestBody = JSON.stringify({ model: provider.model || 'MiniMax-H3', content, resolution, duration, ratio, aigc_watermark: false });
  const created = await providerRequestWithRetry(provider, () => fetch(provider.endpoint, {
    method: 'POST', headers: providerTaskHeaders(provider, body), signal: providerSignal(signal), body: requestBody
  }), signal);
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
  const { capabilities, duration, ratio, referenceMediaTypes, resolution, roles, urls } = validatedVideoTaskInput(provider, body);
  const content = [{ type: 'text', text: String(body.prompt || '').trim() }];
  urls.forEach((url, index) => {
    if (referenceMediaTypes[index] === 'video') {
      content.push({ type: 'video_url', video_url: { url: String(url) }, role: 'reference_video' });
      return;
    }
    content.push({ type: 'image_url', image_url: { url: String(url) }, role: roles[index] });
  });
  const requestBody = {
    model: provider.model,
    content,
    generate_audio: capabilities.generateAudio !== false,
    ratio,
    duration,
    resolution: resolution.toLowerCase(),
    watermark: false,
    ...(capabilities.serviceTier ? { service_tier: String(capabilities.serviceTier) } : {})
  };
  const created = await providerRequestWithRetry(provider, () => fetch(provider.endpoint, {
    method: 'POST',
    headers: providerTaskHeaders(provider, body),
    signal: providerSignal(signal),
    body: JSON.stringify(requestBody)
  }), signal);
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

function jimengImagePayloads(urls) {
  const imageUrls = [];
  const binaryData = [];
  for (const rawUrl of urls) {
    const url = String(rawUrl || '').trim();
    if (/^data:image\//i.test(url)) {
      const image = stripImageMetadata(parseImageDataUrl(url, { maxBytes: 24 * 1024 * 1024 }));
      binaryData.push(image.buffer.toString('base64'));
    } else if (/^https:\/\//i.test(url)) {
      imageUrls.push(url);
    } else {
      throw Object.assign(new Error('Jimeng requires HTTPS or local image references.'), {
        status: 400,
        code: 'invalid-reference-image'
      });
    }
  }
  return {
    ...(imageUrls.length ? { image_urls: imageUrls } : {}),
    ...(binaryData.length ? { binary_data_base64: binaryData } : {})
  };
}

function jimengRequestKey(resolution, referenceCount) {
  const highDefinition = resolution === '1080P';
  if (referenceCount >= 2) return highDefinition ? 'jimeng_i2v_first_tail_v30_1080p' : 'jimeng_i2v_first_tail_v30';
  if (referenceCount === 1) return highDefinition ? 'jimeng_i2v_first_v30_1080' : 'jimeng_i2v_first_v30';
  return highDefinition ? 'jimeng_t2v_v30_1080p' : 'jimeng_t2v_v30';
}

async function createJimengVideoTask(provider, body, signal) {
  const { duration, ratio, resolution, urls } = validatedVideoTaskInput(provider, body);
  const pro = provider.protocol === 'jimeng-video-v30-pro';
  const requestBody = {
    prompt: String(body.prompt || '').trim(),
    seed: -1,
    frames: duration * 24 + 1,
    ...(urls.length ? {} : { aspect_ratio: ratio }),
    ...jimengImagePayloads(urls),
    ...(!pro ? { req_key: jimengRequestKey(resolution, urls.length) } : {})
  };
  const created = await responseJson(await fetch(provider.endpoint, {
    method: 'POST',
    headers: providerHeaders(provider, true),
    signal: providerSignal(signal),
    body: JSON.stringify(requestBody)
  }), provider.name);
  if (Number(created.code ?? created.status) !== 10000) {
    throw Object.assign(new Error(safeProviderText(created.message, `${provider.name} rejected the request.`)), {
      status: 502,
      code: 'provider-request-failed',
      upstreamCode: safeProviderText(created.code ?? created.status, '')
    });
  }
  const taskId = String(created.data && created.data.task_id || '').trim();
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
  if (['jimeng-video-v30', 'jimeng-video-v30-pro'].includes(provider.protocol)) {
    return createJimengVideoTask(provider, body, signal);
  }
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

async function pollJimengVideoTask(provider, taskId, signal) {
  const normalizedTaskId = validVideoTaskId(taskId);
  const result = await responseJson(await fetch(provider.resultEndpoint, {
    method: 'POST',
    headers: providerHeaders(provider, true),
    signal: providerSignal(signal),
    body: JSON.stringify({ task_id: normalizedTaskId })
  }), provider.name);
  if (Number(result.code ?? result.status) !== 10000) {
    return {
      status: 'failed',
      errorCode: safeProviderText(result.code ?? result.status, 'provider-request-failed'),
      errorMessage: safeProviderText(result.message, `${provider.name} task query failed.`)
    };
  }
  const data = result.data && typeof result.data === 'object' ? result.data : {};
  const status = normalizeVideoTaskStatus(data.status);
  if (status === 'succeeded') {
    const resultUrl = String(data.video_url || '').trim();
    return resultUrl
      ? { status, resultUrl }
      : {
          status: 'failed',
          errorCode: 'provider-result-missing',
          errorMessage: `${provider.name} completed the task without a downloadable video.`
        };
  }
  if (TERMINAL_VIDEO_FAILURES.has(status)) {
    return {
      status,
      errorCode: safeProviderText(data.error_code || result.code, `provider-${status}`),
      errorMessage: safeProviderText(data.message || result.message, `${provider.name} video generation ${status}.`)
    };
  }
  return { status };
}

export async function pollVideoTask(providerId, taskId, signal) {
  const provider = providerFor('video', String(providerId || ''));
  if (provider.protocol === 'minimax-video-v2') return pollMiniMaxVideoTask(provider, taskId, signal);
  if (provider.protocol === 'seedance-video-v3') return pollSeedanceVideoTask(provider, taskId, signal);
  if (['jimeng-video-v30', 'jimeng-video-v30-pro'].includes(provider.protocol)) {
    return pollJimengVideoTask(provider, taskId, signal);
  }
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
