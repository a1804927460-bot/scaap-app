import { createRequire } from 'node:module';
import {
  deleteAi302RelayAsset,
  getAi302RelayAsset,
  parseImageDataUrl,
  storeAi302RelayAsset,
  stripImageMetadata
} from './ai302-tools.js';

const require = createRequire(import.meta.url);
const {
  detectMediaProtocol,
  generateMediaBuffer,
  generatedImageDimensions,
  gptImage2Size,
  validateGeneratedMediaBuffer
} = require('../../lib/ai-media-provider');
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
  'atlas-seedance-video',
  'jimeng-video-v30',
  'jimeng-video-v30-pro',
  'kling-v3-image-to-video',
  'kling-o3-omni'
]);
const TERMINAL_VIDEO_FAILURES = new Set(['failed', 'cancelled', 'expired']);
const ROUTED_TASK_PREFIX = 'messs-route:';

function shouldTryProviderFallback(error) {
  if (!error || error.name === 'AbortError') return false;
  if (error.retryable === true) return true;
  const code = String(error.code || '').trim().toLowerCase();
  if (['provider-invalid-response', 'provider-result-missing', 'provider-download-failed'].includes(code)) return true;
  const status = Number(error.status);
  return [408, 425, 429].includes(status) || status >= 500;
}

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
    const builtin = byId.get(id);
    byId.set(id, {
      id, kind,
      name: String(raw.name || id).trim().slice(0, 80),
      endpoint,
      resultEndpoint: safeServerEndpoint(raw.resultEndpoint) || DEFAULT_RESULT_ENDPOINT,
      models: Array.isArray(raw.models) ? raw.models.map(String).map((v) => v.trim()).filter(Boolean).slice(0, 30) : [],
      upstreamModels: raw.upstreamModels && typeof raw.upstreamModels === 'object' && !Array.isArray(raw.upstreamModels)
        ? Object.fromEntries(Object.entries(raw.upstreamModels).slice(0, 30).map(([logical, upstream]) => [
          String(logical).trim().slice(0, 120), String(upstream).trim().slice(0, 120)
        ]).filter(([logical, upstream]) => logical && upstream))
        : {},
      model: String(raw.model || '').trim().slice(0, 120),
      protocol: String(raw.protocol || '').trim().slice(0, 40),
      // Capabilities for catalog models are versioned with the application.
      // Deployment overrides may replace endpoints or credentials, but must
      // not revive a stale resolution/mode matrix for a built-in model.
      capabilities: builtin && builtin.capabilities
        ? builtin.capabilities
        : (raw.capabilities && typeof raw.capabilities === 'object' ? raw.capabilities : null),
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

function providerRouteIds(provider) {
  const capabilities = provider && provider.capabilities && typeof provider.capabilities === 'object'
    ? provider.capabilities
    : {};
  const routeIds = [provider && provider.id];
  if (Array.isArray(capabilities.upstreamPriority)) routeIds.push(...capabilities.upstreamPriority);
  if (capabilities.upstreamRoutes && typeof capabilities.upstreamRoutes === 'object') {
    Object.values(capabilities.upstreamRoutes).forEach((route) => {
      if (Array.isArray(route)) routeIds.push(...route);
    });
  }
  if (capabilities.tierProviderIds && typeof capabilities.tierProviderIds === 'object') {
    routeIds.push(...Object.values(capabilities.tierProviderIds));
  }
  return [...new Set(routeIds.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean))];
}

function providerHasUsableRoute(provider, providers = configuredProviders()) {
  const byId = new Map(providers.map((entry) => [entry.id, entry]));
  return providerRouteIds(provider).some((id) => {
    const candidate = byId.get(id);
    return candidate && Boolean(providerApiKey(candidate));
  });
}

export function publicProviderConfig() {
  const configured = configuredProviders();
  const providers = configured.filter((provider) => !provider.hidden && providerHasUsableRoute(provider, configured));
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

function requestRouteIds(provider, body = {}) {
  const capabilities = provider && provider.capabilities && typeof provider.capabilities === 'object'
    ? provider.capabilities
    : {};
  if (provider.kind === 'image' && Array.isArray(capabilities.upstreamPriority)) {
    return capabilities.upstreamPriority;
  }
  if (provider.kind === 'video') {
    const serviceTier = String(body.serviceTier || capabilities.defaultServiceTier || 'standard').trim().toLowerCase();
    const tierProviderId = capabilities.tierProviderIds && capabilities.tierProviderIds[serviceTier];
    if (tierProviderId) return [tierProviderId];
    // Older clients may omit videoMode. Infer the same mode used by the
    // validators so logical Seedance requests still try Atlas first.
    let videoMode = String(body.videoMode || '').trim().toLowerCase();
    if (!videoMode && capabilities.atlasRouted === true) {
      const mediaTypes = Array.isArray(body.referenceMediaTypes)
        ? body.referenceMediaTypes.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean)
        : [];
      const audioCount = (Array.isArray(body.referenceAudioUrls) ? body.referenceAudioUrls.length : 0)
        + (Array.isArray(body.referenceAudioUploadIds) ? body.referenceAudioUploadIds.length : 0);
      const urlCount = Array.isArray(body.urls) ? body.urls.filter(Boolean).length : mediaTypes.length;
      if (mediaTypes.includes('video') || audioCount > 0 || urlCount > 2) videoMode = 'omni';
      else if (urlCount === 2) videoMode = 'first-last-frame';
      else if (urlCount === 1) videoMode = 'first-frame';
    }
    const route = capabilities.upstreamRoutes && capabilities.upstreamRoutes[videoMode];
    if (Array.isArray(route) && route.length) return route;
  }
  return [provider.id];
}

function routedCandidateForRequest(requested, candidate) {
  const requestedCapabilities = requested && requested.capabilities && typeof requested.capabilities === 'object'
    ? requested.capabilities
    : {};
  if (requested.kind !== 'video' || requestedCapabilities.atlasRouted !== true
      || candidate.id !== requested.id) return candidate;
  const fallback = requestedCapabilities.fallbackCapabilities;
  if (!fallback || typeof fallback !== 'object') return candidate;

  // Keep the fallback candidate in the list and apply its narrower matrix.
  // The validator can adapt compatible Atlas-only framing options, while
  // genuinely unsupported resolutions or reference modes still fail before
  // a paid 302 request is made.
  return {
    ...candidate,
    capabilities: { ...candidate.capabilities, ...fallback },
    _routedFallback: true
  };
}

function providersForRequest(kind, id, body = {}) {
  const requested = configuredProvider(kind, id);
  if (!requested) {
    throw Object.assign(new Error(`No ${kind} provider is configured.`), { code: 'provider-not-configured' });
  }
  const configured = configuredProviders();
  const byId = new Map(configured.filter((provider) => provider.kind === kind).map((provider) => [provider.id, provider]));
  const candidates = [];
  const routeIds = requestRouteIds(requested, body);
  for (const routeId of routeIds) {
    const candidate = byId.get(String(routeId || '').trim().toLowerCase());
    if (!candidate || !providerApiKey(candidate) || candidates.some((entry) => entry.id === candidate.id)) continue;
    const routed = routedCandidateForRequest(requested, candidate);
    if (!routed) continue;
    candidates.push({ ...routed, apiKey: providerApiKey(candidate) });
  }
  if (!candidates.length) {
    throw Object.assign(new Error('No configured upstream is available for the selected model.'), {
      code: 'provider-secret-missing'
    });
  }
  return candidates;
}

function routedProviderTaskId(requestedProviderId, actualProviderId, taskId) {
  if (requestedProviderId === actualProviderId) return taskId;
  return `${ROUTED_TASK_PREFIX}${actualProviderId}:${taskId}`;
}

function parseRoutedProviderTaskId(providerId, taskId) {
  const value = String(taskId || '');
  if (!value.startsWith(ROUTED_TASK_PREFIX)) return { providerId, taskId: value };
  const separator = value.indexOf(':', ROUTED_TASK_PREFIX.length);
  if (separator < 0) return { providerId, taskId: value };
  const routedProviderId = value.slice(ROUTED_TASK_PREFIX.length, separator);
  const routedTaskId = value.slice(separator + 1);
  if (!PROVIDER_ID.test(routedProviderId) || !routedTaskId) return { providerId, taskId: value };
  return { providerId: routedProviderId, taskId: routedTaskId };
}

function deepAtlasOutputUrl(value, seen = new Set(), depth = 0) {
  if (depth > 8 || value === null || value === undefined) return '';
  if (typeof value === 'string') {
    const candidate = value.trim();
    if (/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i.test(candidate)) return candidate;
    if (/^https:\/\/\S+$/i.test(candidate)) {
      let atlasHost = false;
      try {
        const hostname = new URL(candidate).hostname.toLowerCase();
        atlasHost = hostname === 'atlascloud.ai' || hostname.endsWith('.atlascloud.ai');
      } catch {}
      if (atlasHost || /(?:\.png|\.jpe?g|\.webp)(?:\?|$)|image|download/i.test(candidate)) return candidate;
    }
    return '';
  }
  if (typeof value !== 'object' || seen.has(value)) return '';
  seen.add(value);
  for (const key of ['b64_json', 'base64', 'image_base64', 'output_base64']) {
    const encoded = typeof value[key] === 'string' ? value[key].trim() : '';
    if (encoded.length >= 32 && /^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
      return `data:image/png;base64,${encoded}`;
    }
  }
  for (const key of ['outputs', 'image_url', 'imageUrl', 'result_url', 'resultUrl', 'download_url', 'downloadUrl', 'url', 'output']) {
    const found = deepAtlasOutputUrl(value[key], seen, depth + 1);
    if (found) return found;
  }
  for (const child of Object.values(value)) {
    const found = deepAtlasOutputUrl(child, seen, depth + 1);
    if (found) return found;
  }
  return '';
}

async function downloadGeneratedImage(url, signal, maxBytes = 64 * 1024 * 1024) {
  if (/^data:image\//i.test(url)) {
    return parseImageDataUrl(url, { maxBytes }).buffer;
  }
  const safeUrl = safeServerEndpoint(url);
  if (!safeUrl) throw Object.assign(new Error('The image provider returned an unsafe image URL.'), {
    status: 502, code: 'unsafe-media-url'
  });
  const response = await fetch(safeUrl, { signal: providerSignal(signal, 120_000) });
  if (!response.ok) throw Object.assign(new Error(`Could not download the generated image (HTTP ${response.status}).`), {
    status: response.status, code: 'provider-download-failed'
  });
  const advertisedBytes = Number(response.headers.get('content-length')) || 0;
  if (advertisedBytes > maxBytes) throw Object.assign(new Error('The generated image is too large.'), {
    status: 413, code: 'media-too-large'
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes) throw Object.assign(new Error('The generated image is too large.'), {
    status: 413, code: 'media-too-large'
  });
  return buffer;
}

function validateAtlasGptImageOutput(buffer, body) {
  const validated = validateGeneratedMediaBuffer('image', buffer);
  const expected = gptImage2Size(body);
  const expectedMatch = /^(\d+)x(\d+)$/i.exec(String(expected || ''));
  if (!expectedMatch) return validated;
  const dimensions = generatedImageDimensions(validated);
  if (!dimensions) {
    throw Object.assign(new Error('Atlas Cloud returned an image whose dimensions could not be verified.'), {
      status: 502,
      code: 'image-resolution-unverified'
    });
  }
  const expectedWidth = Number(expectedMatch[1]);
  const expectedHeight = Number(expectedMatch[2]);
  const expectedRatio = expectedWidth / expectedHeight;
  const actualRatio = dimensions.width / dimensions.height;
  const ratioDifference = Math.abs(Math.log(actualRatio / expectedRatio));
  // Providers can round either edge by a small encoder-dependent amount. Keep
  // a 10% tolerance for that rounding, but validate both edges and the ratio so
  // a 4K request cannot silently become a lower tier or a differently cropped
  // image. This also accepts GPT Image 2's valid 2880x2880 square 4K output.
  if (
    dimensions.width < Math.floor(expectedWidth * 0.9)
    || dimensions.height < Math.floor(expectedHeight * 0.9)
    || ratioDifference > Math.log(1.1)
  ) {
    throw Object.assign(new Error(
      `Atlas Cloud returned ${dimensions.width}x${dimensions.height} for a requested ${expectedWidth}x${expectedHeight} image.`
    ), {
      status: 502,
      code: 'image-resolution-mismatch',
      requestedWidth: expectedWidth,
      requestedHeight: expectedHeight,
      actualWidth: dimensions.width,
      actualHeight: dimensions.height
    });
  }
  return validated;
}

async function generateAtlasGptImage(provider, body, signal) {
  const relayTokens = [];
  try {
    const urls = Array.isArray(body.urls) ? body.urls.slice(0, 10).map((value) => {
      const source = String(value || '').trim();
      if (!/^data:image\//i.test(source)) return source;
      const image = stripImageMetadata(parseImageDataUrl(source, { maxBytes: 30 * 1024 * 1024 }));
      const relay = storeAi302RelayAsset(image, { relayTtlMs: 20 * 60 * 1000 });
      relayTokens.push(relay.token);
      return relay.url;
    }) : [];
    const outputFormat = String(body.outputFormat || 'jpeg').trim().toLowerCase();
    const requestBody = {
      model: urls.length ? 'openai/gpt-image-2/edit' : 'openai/gpt-image-2/text-to-image',
      prompt: String(body.prompt || '').trim(),
      size: gptImage2Size(body),
      quality: ['low', 'medium', 'high'].includes(String(body.quality || '').toLowerCase())
        ? String(body.quality).toLowerCase() : 'medium',
      output_format: ['jpeg', 'png'].includes(outputFormat) ? outputFormat : 'jpeg',
      ...(urls.length ? { images: urls } : {}),
      enable_sync_mode: false,
      enable_base64_output: false
    };
    const created = await responseJson(await fetch(provider.endpoint, {
      method: 'POST',
      headers: providerTaskHeaders(provider, body),
      signal: providerSignal(signal, 45_000),
      body: JSON.stringify(requestBody)
    }), provider.name);
    const taskId = providerVideoTaskId(created);
    if (!taskId || taskId.length > 256) {
      throw Object.assign(new Error(`${provider.name} did not return a valid prediction ID.`), {
        status: 502, code: 'provider-invalid-response', retryable: false
      });
    }
    const deadline = Date.now() + 20 * 60_000;
    while (Date.now() < deadline) {
      let result;
      try {
        result = await responseJson(await fetch(
          `${provider.resultEndpoint}/${encodeURIComponent(taskId)}`,
          { headers: providerHeaders(provider), signal: providerSignal(signal, 30_000) }
        ), provider.name);
      } catch (error) {
        if (Number(error && error.status) !== 404) throw error;
        const fallbackEndpoint = String(provider.resultEndpoint).replace(/\/prediction$/i, '/result');
        result = await responseJson(await fetch(
          `${fallbackEndpoint}/${encodeURIComponent(taskId)}`,
          { headers: providerHeaders(provider), signal: providerSignal(signal, 30_000) }
        ), provider.name);
      }
      const status = providerVideoTaskStatus(result);
      if (status === 'succeeded') {
        const outputUrl = deepAtlasOutputUrl(result);
        if (!outputUrl) throw Object.assign(new Error(`${provider.name} completed without an image output.`), {
          status: 502, code: 'provider-result-missing'
        });
        return validateAtlasGptImageOutput(
          await downloadGeneratedImage(outputUrl, signal),
          body
        );
      }
      if (TERMINAL_VIDEO_FAILURES.has(status)) {
        throw Object.assign(new Error(safeProviderText(
          nestedVideoTaskValue(result, ['error', 'message', 'msg']),
          `${provider.name} image generation ${status}.`
        )), { status: 502, code: `provider-${status}` });
      }
      await delayWithSignal(2_000, signal);
    }
    throw Object.assign(new Error(`${provider.name} image generation timed out.`), {
      status: 504, code: 'provider-timeout'
    });
  } finally {
    relayTokens.forEach((token) => deleteAi302RelayAsset(token));
  }
}

async function generateMediaWithProvider(kind, provider, body, signal) {
  if (kind === 'image' && provider.protocol === 'atlas-gpt-image-2') {
    return generateAtlasGptImage(provider, body, signal);
  }
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

const FALLBACK_CAPABILITY_ERRORS = new Set([
  'invalid-resolution',
  'invalid-size',
  'invalid-quality',
  'invalid-aspect-ratio',
  'invalid-size-ratio',
  'invalid-duration',
  'invalid-video-mode',
  'invalid-reference-media',
  'invalid-reference-format',
  'invalid-output-format',
  'too-many-references',
  'too-many-reference-videos',
  'too-many-reference-audios',
  'reference-required',
  'reference-video-required'
]);

function preferredFallbackError(firstError, lastError) {
  if (!firstError) return lastError;
  if (!lastError) return firstError;
  // If the primary route failed upstream and a narrower fallback only rejects
  // the same request's capabilities, report the primary outage. This keeps a
  // transient Atlas failure from being misreported as a user option error.
  if (!FALLBACK_CAPABILITY_ERRORS.has(String(lastError.code || '').trim().toLowerCase())
      || FALLBACK_CAPABILITY_ERRORS.has(String(firstError.code || '').trim().toLowerCase())) {
    return lastError;
  }
  return firstError;
}

export async function generateMedia(kind, body, signal) {
  const providers = providersForRequest(kind, String(body.providerId || ''), body);
  let firstError;
  let lastError;
  for (const provider of providers) {
    try {
      return await generateMediaWithProvider(kind, provider, body, signal);
    } catch (error) {
      if (!firstError) firstError = error;
      lastError = error;
      if (signal && signal.aborted) throw error;
      if (!shouldTryProviderFallback(error)) {
        // A narrower secondary route may reject a capability that the primary
        // route supports. Keep the primary outage as the actionable error
        // instead of overwriting it with the fallback's local matrix error.
        if (error !== firstError && FALLBACK_CAPABILITY_ERRORS.has(String(error.code || '').trim().toLowerCase())) break;
        throw error;
      }
    }
  }
  throw preferredFallbackError(firstError, lastError);
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
      return validateGeneratedMediaBuffer('video', video);
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
    const rawMessage = providerResponseErrorMessage(payload)
      || `${providerName} request failed (HTTP ${response.status}).`;
    const channelUnavailable = providerChannelConfigurationUnavailable(rawMessage);
    const referencePolicyRejected = /\bInputImageSensitiveContentDetected\b|input image may be related to copyright restrictions/i
      .test(`${upstreamCode} ${rawMessage}`);
    const retryAfter = Number(response.headers && response.headers.get && response.headers.get('retry-after'));
    const retryable = channelUnavailable || response.status === 429 || response.status >= 500;
    throw Object.assign(new Error(referencePolicyRejected
      ? 'The reference image may contain copyrighted or restricted content. Choose another reference image.'
      : channelUnavailable
        ? 'The video provider channel is temporarily unavailable.'
        : safeProviderText(rawMessage, `${providerName} request failed.`)), {
      status: response.status,
      code: referencePolicyRejected
        ? 'reference-policy-rejected'
        : channelUnavailable
          ? 'provider-channel-unavailable'
          : response.status === 429 ? 'provider-rate-limited' : (retryable ? 'provider-temporarily-unavailable' : 'provider-request-failed'),
      upstreamCode: safeProviderText(upstreamCode, ''),
      retryable,
      retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(120_000, retryAfter * 1000)
        : channelUnavailable ? 500 : 0
    });
  }
  return payload;
}

function safeProviderText(value, fallback) {
  const text = String(value || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
  return text || fallback;
}

function providerResponseErrorMessage(payload) {
  const messages = [];
  const add = (value) => {
    if (typeof value === 'string' || typeof value === 'number') {
      const sanitized = String(value)
        .replace(/data:[^;,\s]+;base64,[A-Za-z0-9+/=]+/gi, '[data-url]')
        .replace(/https:\/\/\S+/gi, '[url]')
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 500);
      if (sanitized && !messages.includes(sanitized)) messages.push(sanitized);
    }
  };
  const visit = (value, depth = 0, seen = new Set()) => {
    if (value === null || value === undefined || depth > 5) return;
    if (typeof value !== 'object') return add(value);
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.slice(0, 8).forEach((entry) => visit(entry, depth + 1, seen));
      return;
    }
    const preferred = ['message', 'msg', 'detail', 'reason', 'error', 'errors', 'status_msg'];
    for (const key of preferred) {
      if (Object.hasOwn(value, key)) visit(value[key], depth + 1, seen);
    }
    for (const key of ['base_resp', 'data', 'response']) {
      if (Object.hasOwn(value, key)) visit(value[key], depth + 1, seen);
    }
  };
  visit(payload);
  return messages.join('; ').slice(0, 900);
}

function providerChannelConfigurationUnavailable(value) {
  const message = String(value || '');
  return /channel\s+configuration/i.test(message)
    && /(?:network|temporar|unavailable|timeout|failed|error)/i.test(message);
}

function providerSignal(signal, timeoutMs = 25_000) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

function isTimeoutError(error) {
  return String(error && error.name || '') === 'TimeoutError'
    || Number(error && error.code) === 23
    || String(error && error.code || '').toUpperCase() === 'ETIMEDOUT';
}

function providerTimeoutError(provider) {
  return Object.assign(new Error(`${provider.name} task submission timed out.`), {
    status: 504,
    code: 'provider-timeout',
    retryable: false
  });
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
  if (['expired', 'timeout', 'timed_out', 'timed-out'].includes(status)) return 'expired';
  if (['processing', 'running', 'generating', 'in_progress'].includes(status)) return 'running';
  return 'queued';
}

const VIDEO_TASK_WRAPPER_KEYS = [
  'data', 'result', 'response', 'payload', 'output', 'task', 'content', 'video'
];

function nestedVideoTaskValue(value, keys, seen = new Set(), depth = 0) {
  if (!value || typeof value !== 'object' || seen.has(value) || depth > 7) return undefined;
  seen.add(value);
  for (const key of keys) {
    if (value[key] !== undefined && value[key] !== null && String(value[key]).trim()) return value[key];
  }
  for (const key of VIDEO_TASK_WRAPPER_KEYS) {
    const nested = nestedVideoTaskValue(value[key], keys, seen, depth + 1);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function nestedVideoTaskObject(value, keys, seen = new Set(), depth = 0) {
  if (!value || typeof value !== 'object' || seen.has(value) || depth > 7) return null;
  seen.add(value);
  for (const key of keys) {
    if (value[key] && typeof value[key] === 'object') return value[key];
  }
  for (const key of VIDEO_TASK_WRAPPER_KEYS) {
    const nested = nestedVideoTaskObject(value[key], keys, seen, depth + 1);
    if (nested) return nested;
  }
  return null;
}

function providerVideoTaskId(payload) {
  return String(nestedVideoTaskValue(payload, ['request_id', 'requestId', 'task_id', 'taskId', 'id']) || '').trim();
}

function providerVideoTaskStatus(payload) {
  return normalizeVideoTaskStatus(nestedVideoTaskValue(payload, [
    'task_status', 'taskStatus', 'status', 'state'
  ]));
}

function providerVideoResultUrl(payload) {
  return String(nestedVideoTaskValue(payload, [
    'video_url', 'videoUrl', 'result_url', 'resultUrl', 'download_url', 'downloadUrl'
  ]) || deepVideoResultUrl(payload) || '').trim();
}

function deepVideoResultUrl(value, seen = new Set(), depth = 0) {
  if (!value || depth > 10 || seen.has(value)) return '';
  if (typeof value === 'string') {
    const candidate = value.trim();
    if (!/^https:\/\/\S+$/i.test(candidate)) return '';
    let atlasHost = false;
    try {
      const hostname = new URL(candidate).hostname.toLowerCase();
      atlasHost = hostname === 'atlascloud.ai' || hostname.endsWith('.atlascloud.ai');
    } catch {}
    return atlasHost || /(?:\.mp4(?:\?|$)|\.mov(?:\?|$)|\.webm(?:\?|$)|video|download)/i.test(candidate)
      ? candidate : '';
  }
  if (typeof value !== 'object') return '';
  seen.add(value);
  const preferredKeys = [
    'video_url', 'videoUrl', 'result_url', 'resultUrl', 'download_url', 'downloadUrl',
    'video', 'uri', 'url'
  ];
  for (const key of preferredKeys) {
    const found = deepVideoResultUrl(value[key], seen, depth + 1);
    if (found) return found;
  }
  for (const child of Object.values(value)) {
    const found = deepVideoResultUrl(child, seen, depth + 1);
    if (found) return found;
  }
  return '';
}

function providerVideoTaskError(payload, fallbackCode, fallbackMessage) {
  const errorPayload = nestedVideoTaskObject(payload, ['error', 'failure']) || payload;
  const rawMessage = nestedVideoTaskValue(errorPayload, [
    'error_message', 'errorMessage', 'failure_reason', 'failureReason', 'message', 'msg', 'error'
  ]);
  if (providerChannelConfigurationUnavailable(rawMessage)) {
    return {
      errorCode: 'provider-channel-unavailable',
      errorMessage: 'The video provider channel was temporarily unavailable. No points were charged.'
    };
  }
  return {
    errorCode: safeProviderText(nestedVideoTaskValue(errorPayload, [
      'error_code', 'errorCode', 'code'
    ]), fallbackCode),
    errorMessage: safeProviderText(rawMessage, fallbackMessage)
  };
}

const VIDEO_MODE_IDS = new Set([
  'text', 'first-frame', 'first-last-frame', 'omni', 'video-reference', 'video-edit', 'video-extend'
]);

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
  const mediaTypesForMode = Array.isArray(body.referenceMediaTypes)
    ? body.referenceMediaTypes.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean)
    : [];
  const audioCountForMode = (Array.isArray(body.referenceAudioUrls) ? body.referenceAudioUrls.length : 0)
    + (Array.isArray(body.referenceAudioUploadIds) ? body.referenceAudioUploadIds.length : 0);
  const inferredMode = String(body.videoMode || '').trim().toLowerCase()
    || (capabilities.atlasRouted === true && (mediaTypesForMode.includes('video') || audioCountForMode > 0)
      ? 'omni' : '');
  const mode = videoModeDefinition(capabilities, inferredMode, submittedUrls.length);
  const referenceLimit = Math.max(0, Math.min(30, Number(capabilities.maxTotalReferences) || Number(mode.maxReferences) || 0));
  if (referenceLimit && submittedUrls.length + audioCountForMode > referenceLimit) {
    throw Object.assign(new Error(`${provider.name} accepts at most ${referenceLimit} reference files.`), {
      status: 400,
      code: 'too-many-references'
    });
  }
  const minReferenceImages = Math.max(0, Math.min(referenceLimit, Number(mode.minReferences) || 0));
  const maxReferenceImages = Math.max(minReferenceImages, Math.min(referenceLimit, Number(mode.maxReferences) || referenceLimit));
  if (submittedUrls.length > maxReferenceImages) {
    throw Object.assign(new Error(`${provider.name} accepts at most ${maxReferenceImages} reference images.`), {
      status: 400,
      code: 'too-many-references'
    });
  }
  if (submittedUrls.length + audioCountForMode < minReferenceImages) {
    throw Object.assign(new Error(`${provider.name} requires at least ${minReferenceImages} reference file${minReferenceImages === 1 ? '' : 's'}.`), {
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
  if (audioCountForMode > 0 && !allowedMediaTypes.has('audio')) {
    throw Object.assign(new Error(`${provider.name} does not accept reference audio in this mode.`), {
      status: 400,
      code: 'invalid-reference-media'
    });
  }
  const maximumReferenceAudios = Number(mode.maxReferenceAudios ?? capabilities.maxReferenceAudios);
  if (Number.isFinite(maximumReferenceAudios) && maximumReferenceAudios >= 0
      && audioCountForMode > maximumReferenceAudios) {
    throw Object.assign(new Error(`${provider.name} accepts at most ${maximumReferenceAudios} reference audio files.`), {
      status: 400,
      code: 'too-many-reference-audios'
    });
  }
  const referenceVideoCount = referenceMediaTypes.filter((mediaType) => mediaType === 'video').length;
  const referenceImageCount = referenceMediaTypes.filter((mediaType) => mediaType === 'image').length;
  const maximumReferenceImages = Math.max(0, Number(mode.maxReferenceImages ?? capabilities.maxReferenceImages) || 0);
  if (maximumReferenceImages && referenceImageCount > maximumReferenceImages) {
    throw Object.assign(new Error(`${provider.name} accepts at most ${maximumReferenceImages} reference images.`), {
      status: 400,
      code: 'too-many-references'
    });
  }
  const maximumReferenceVideos = Math.max(0, Number(mode.maxReferenceVideos ?? capabilities.maxReferenceVideos) || 0);
  const minimumReferenceVideos = Math.max(0, Number(mode.minReferenceVideos) || 0);
  if (referenceVideoCount < minimumReferenceVideos) {
    throw Object.assign(new Error(`${provider.name} requires at least ${minimumReferenceVideos} reference video${minimumReferenceVideos === 1 ? '' : 's'}.`), {
      status: 400,
      code: 'reference-video-required'
    });
  }
  if (referenceVideoCount > maximumReferenceVideos) {
    throw Object.assign(new Error(`${provider.name} accepts at most ${maximumReferenceVideos} reference videos.`), {
      status: 400,
      code: 'too-many-reference-videos'
    });
  }
  if (referenceVideoCount > 0) {
    const maximumImagesWithVideo = Number(mode.maxReferenceImagesWithVideo);
    if (Number.isInteger(maximumImagesWithVideo) && maximumImagesWithVideo >= 0
      && referenceImageCount > maximumImagesWithVideo) {
      throw Object.assign(new Error(`${provider.name} accepts at most ${maximumImagesWithVideo} reference images with a reference video.`), {
        status: 400,
        code: 'too-many-references'
      });
    }
  }
  let ratio = String(body.aspectRatio || '');
  // 302 documents Seedance 2.5's adaptive ratio for image/reference
  // generation only. Normalize stale text-mode clients to the documented
  // text-to-video default instead of sending a request the upstream router
  // cannot match to a channel.
  const textRatios = Array.isArray(capabilities.textRatios)
    ? capabilities.textRatios.map((value) => String(value))
    : [];
  if (mode.id === 'text' && textRatios.length && ratio === 'adaptive' && textRatios.includes('16:9')) {
    ratio = '16:9';
  }
  const resolution = String(body.resolution || '').toUpperCase();
  const duration = Number(body.duration);
  const configuredRatios = mode.id === 'text' && Array.isArray(capabilities.textRatios)
    ? capabilities.textRatios
    : capabilities.ratios;
  const validRatios = Array.isArray(mode.ratios) && mode.ratios.length
    ? mode.ratios
    : (mode.id === 'first-frame' || mode.id === 'first-last-frame')
      ? (Array.isArray(capabilities.frameReferenceRatios) ? capabilities.frameReferenceRatios : ['adaptive'])
      : (Array.isArray(configuredRatios) ? configuredRatios : []);
  // Atlas exposes explicit first/last-frame ratios for Seedance 2.0, while
  // the 302 fallback accepts only adaptive framing. Preserve the user's
  // request when Atlas is available, but make the fallback route compatible
  // before it reaches a paid upstream call.
  if (provider._routedFallback === true
      && ['first-frame', 'first-last-frame'].includes(mode.id)
      && ratio !== 'adaptive'
      && validRatios.includes('adaptive')) {
    ratio = 'adaptive';
  }
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
  const durationSource = Array.isArray(mode.durations) && mode.durations.length
    ? mode.durations
    : capabilities.durations;
  const validDurations = Array.isArray(durationSource)
    ? durationSource.map(Number).filter(Number.isInteger)
    : [];
  const fallbackFixedDurations = Array.isArray(capabilities.durations)
    ? capabilities.durations.map(Number).filter((value) => Number.isInteger(value) && value > 0)
    : [];
  const fallbackAutomaticDuration = provider._routedFallback === true
    && duration === -1
    && fallbackFixedDurations.length > 0;
  if (!Number.isInteger(duration)
      || (!fallbackAutomaticDuration
        && (validDurations.length ? !validDurations.includes(duration) : duration < 4 || duration > 15))) {
    throw Object.assign(new Error(`${provider.name} does not support this duration.`), {
      status: 400,
      code: 'invalid-duration'
    });
  }
  const configuredRoles = Array.isArray(mode.roles) ? mode.roles.map(String).filter(Boolean) : [];
  const roles = urls.map((_url, index) => configuredRoles[index] || configuredRoles[0] || 'reference_image');
  return {
    capabilities,
    duration,
    mode: mode.id,
    modeDefinition: mode,
    ratio,
    referenceMediaTypes,
    resolution,
    roles,
    urls,
    fallbackAutomaticDuration
  };
}

async function createMiniMaxVideoTask(provider, body, signal) {
  const { duration, ratio, referenceMediaTypes, resolution, roles, urls } = validatedVideoTaskInput(provider, body);
  const content = [{ type: 'text', text: String(body.prompt || '').trim() }];
  urls.forEach((url, index) => {
    const mediaType = referenceMediaTypes[index] === 'video' ? 'video' : 'image';
    const type = mediaType + '_url';
    content.push({
      type,
      [type]: { url: String(url) },
      role: roles[index] && roles[index] !== 'reference_image'
        ? roles[index]
        : 'reference_' + mediaType
    });
  });
  for (const url of Array.isArray(body.referenceAudioUrls) ? body.referenceAudioUrls : []) {
    content.push({
      type: 'audio_url',
      audio_url: { url: String(url) },
      role: 'reference_audio'
    });
  }
  const requestBody = JSON.stringify({ model: provider.model || 'MiniMax-H3', content, resolution, duration, ratio, aigc_watermark: false });
  const created = await responseJson(await fetch(provider.endpoint, {
    method: 'POST', headers: providerTaskHeaders(provider, body), signal: providerSignal(signal), body: requestBody
  }), provider.name);
  const taskId = providerVideoTaskId(created);
  if (!taskId || taskId.length > 256) {
    throw Object.assign(new Error(`${provider.name} did not return a valid task ID.`), {
      status: 502,
      code: 'provider-invalid-response',
      retryable: false
    });
  }
  return { providerId: provider.id, taskId };
}

function seedanceRelayMediaUrl(rawUrl, mediaType) {
  const url = String(rawUrl || '').trim();
  if (mediaType === 'image' && /^data:image\//i.test(url)) {
    const image = stripImageMetadata(parseImageDataUrl(url, { maxBytes: 24 * 1024 * 1024 }));
    return storeAi302RelayAsset(image, { relayTtlMs: 2 * 60 * 60 * 1000 }).url;
  }
  if (/^https:\/\//i.test(url)) return url;
  throw Object.assign(new Error('Seedance requires HTTPS image or video references.'), {
    status: 400,
    code: 'invalid-reference-media'
  });
}

function seedanceReferencePrompt(prompt, mode, mediaTypes = [], audioCount = 0) {
  const text = String(prompt || '').trim();
  const normalizedMode = String(mode || '').trim().toLowerCase();
  // Image-to-video sends first/last frames in dedicated fields. Adding @
  // tokens there would change the prompt semantics on both upstreams.
  if (['first-frame', 'first-last-frame'].includes(normalizedMode)) return text;

  const counters = { image: 0, video: 0, audio: 0 };
  const tokens = [];
  for (const rawType of Array.isArray(mediaTypes) ? mediaTypes : []) {
    const type = String(rawType || '').trim().toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(counters, type)) continue;
    counters[type] += 1;
    tokens.push(`@${type[0].toUpperCase()}${type.slice(1)}${counters[type]}`);
  }
  for (let index = 0; index < Math.max(0, Number(audioCount) || 0); index += 1) {
    counters.audio += 1;
    tokens.push(`@Audio${counters.audio}`);
  }
  if (!tokens.length) return text;

  const existing = new Set(
    [...text.matchAll(/@(Image|Video|Audio)(\d+)/gi)]
      .map((match) => `@${match[1][0].toUpperCase()}${match[1].slice(1).toLowerCase()}${match[2]}`)
  );
  const missing = tokens.filter((token) => !existing.has(token));
  if (!missing.length) return text;

  let directive;
  if (normalizedMode === 'video-edit') {
    directive = `Edit ${tokens.find((token) => token.startsWith('@Video')) || '@Video1'} according to this request.`;
  } else if (normalizedMode === 'video-extend') {
    directive = `Extend ${tokens.find((token) => token.startsWith('@Video')) || '@Video1'} according to this request.`;
  } else {
    directive = `Create a new video using ${missing.join(', ')} as references.`;
  }
  return [directive, text].filter(Boolean).join(' ');
}

async function createSeedanceVideoTask(provider, body, signal) {
  const {
    capabilities,
    duration,
    mode,
    ratio,
    referenceMediaTypes,
    resolution,
    roles,
    urls,
    fallbackAutomaticDuration
  } = validatedVideoTaskInput(provider, body);
  const submittedDuration = fallbackAutomaticDuration
    ? Math.max(...(Array.isArray(capabilities.durations)
      ? capabilities.durations.map(Number).filter((value) => Number.isInteger(value) && value > 0)
      : [15]))
    : duration;
  const prompt = seedanceReferencePrompt(body.prompt, mode, referenceMediaTypes, 0);
  const content = [{ type: 'text', text: prompt }];
  urls.forEach((url, index) => {
    const relayUrl = seedanceRelayMediaUrl(url, referenceMediaTypes[index]);
    if (referenceMediaTypes[index] === 'video') {
      content.push({ type: 'video_url', video_url: { url: relayUrl }, role: 'reference_video' });
      return;
    }
    content.push({
      type: 'image_url',
      image_url: { url: relayUrl },
      role: roles[index]
    });
  });
  const requestBody = {
    model: provider.model,
    content,
    ...(capabilities.generateAudio === true || capabilities.generateAudio === false
      ? { generate_audio: capabilities.generateAudio === true && body.generateAudio !== false }
      : {}),
    ratio,
    duration: submittedDuration,
    // The 302 Seedance contents endpoint derives quality from the selected
    // model and rejects a `resolution` field. Atlas has its own request
    // builder and sends the documented resolution field there.
    ...(
      capabilities.supportsResolution === true
        || (capabilities.supportsResolution === undefined
          && !/(?:seedance|doubao[-_ ]?seedance)[-_ ]?2[-_. ]?5(?:[-_ ]|$)/.test(String(provider.model || '').toLowerCase()))
        ? { resolution: resolution.toLowerCase() }
        : {}
    ),
    watermark: false,
    ...(capabilities.serviceTier ? { service_tier: String(capabilities.serviceTier) } : {})
  };
  let created;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      created = await responseJson(await fetch(provider.endpoint, {
        method: 'POST',
        headers: providerTaskHeaders(provider, body),
        signal: providerSignal(signal, Number(capabilities.createTimeoutMs) || 25_000),
        body: JSON.stringify(requestBody)
      }), provider.name);
      break;
    } catch (error) {
      if (isTimeoutError(error)) throw providerTimeoutError(provider);
      if (error && error.code === 'provider-channel-unavailable' && attempt < 2) {
        await delayWithSignal(250 * (2 ** attempt), signal);
        continue;
      }
      throw error;
    }
  }
  const taskId = providerVideoTaskId(created);
  if (!taskId || taskId.length > 256) {
    throw Object.assign(new Error(`${provider.name} did not return a valid task ID.`), {
      status: 502,
      code: 'provider-invalid-response',
      retryable: false
    });
  }
  return { providerId: provider.id, taskId };
}

function atlasLocalMediaAsset(rawUrl, mediaType = 'image') {
  const url = String(rawUrl || '').trim();
  if (mediaType === 'image' && /^data:image\//i.test(url)) {
    return stripImageMetadata(parseImageDataUrl(url, { maxBytes: 30 * 1024 * 1024 }));
  }
  if (/^https:\/\//i.test(url)) {
    let parsed;
    let publicOrigin = '';
    try {
      parsed = new URL(url);
      const configured = String(process.env.AI_GATEWAY_PUBLIC_URL || '').trim();
      const railwayDomain = String(process.env.RAILWAY_PUBLIC_DOMAIN || '').trim();
      publicOrigin = configured || (railwayDomain ? `https://${railwayDomain}` : '');
      const match = /^\/v1\/tools\/assets\/([A-Za-z0-9_-]{43})(?:\.[a-z0-9]{2,8})?$/.exec(parsed.pathname);
      if (publicOrigin && parsed.origin === new URL(publicOrigin).origin && match) {
        return getAi302RelayAsset(match[1]);
      }
    } catch (error) {}
    return null;
  }
  throw Object.assign(new Error(`Atlas Cloud requires HTTPS ${mediaType} references or sanitized data URLs.`), {
    status: 400,
    code: 'invalid-reference-media'
  });
}

function atlasMediaExtension(mime, mediaType) {
  const normalized = String(mime || '').trim().toLowerCase();
  if (normalized === 'image/jpeg') return 'jpg';
  if (normalized === 'audio/mpeg' || normalized === 'audio/mp3') return 'mp3';
  if (normalized === 'audio/wav' || normalized === 'audio/x-wav') return 'wav';
  if (normalized === 'video/quicktime') return 'mov';
  const subtype = normalized.split('/')[1];
  return /^[a-z0-9]{2,8}$/.test(subtype || '') ? subtype : mediaType === 'image' ? 'png' : mediaType === 'audio' ? 'mp3' : 'mp4';
}

function atlasUploadMediaEndpoint(provider) {
  const endpoint = new URL(provider.endpoint);
  endpoint.pathname = '/api/v1/model/uploadMedia';
  endpoint.search = '';
  endpoint.hash = '';
  return endpoint;
}

async function atlasMediaReference(provider, rawUrl, mediaType, signal) {
  const url = String(rawUrl || '').trim();
  const localAsset = atlasLocalMediaAsset(url, mediaType);
  if (!localAsset) return url;
  const mime = String(localAsset.mime || '').trim().toLowerCase();
  const form = new FormData();
  form.append('file', new Blob([localAsset.buffer], { type: mime }), `reference.${atlasMediaExtension(mime, mediaType)}`);
  const uploaded = await responseJson(await fetch(atlasUploadMediaEndpoint(provider), {
    method: 'POST',
    headers: providerHeaders(provider),
    signal: providerSignal(signal, 180_000),
    body: form
  }), provider.name);
  const uploadedUrl = String(nestedVideoTaskValue(uploaded, ['download_url', 'downloadUrl', 'url']) || '').trim();
  if (!/^https:\/\/\S+$/i.test(uploadedUrl)) {
    throw Object.assign(new Error(`${provider.name} did not return a valid uploaded media URL.`), {
      status: 502, code: 'provider-invalid-response', retryable: false
    });
  }
  return uploadedUrl;
}

function atlasResolution(value) {
  const normalized = String(value || '720P').trim().toLowerCase();
  return normalized === '4k' ? '4k'
    : normalized.replace(/\s*&\s*/g, ' & ');
}

function atlasVideoTaskInput(provider, body) {
  const capabilities = provider.capabilities && typeof provider.capabilities === 'object'
    ? provider.capabilities
    : {};
  const isI2v = String(capabilities.atlasKind || '') === 'image-to-video';
  const urls = Array.isArray(body.urls) ? body.urls.filter(Boolean) : [];
  const mediaTypes = Array.isArray(body.referenceMediaTypes)
    ? body.referenceMediaTypes.slice(0, 50).map((value) => String(value || '').trim().toLowerCase())
    : urls.map(() => 'image');
  const audioUrls = Array.isArray(body.referenceAudioUrls)
    ? body.referenceAudioUrls.filter(Boolean).slice(0, 50)
    : [];
  if (mediaTypes.length !== urls.length || mediaTypes.some((type) => !['image', 'video'].includes(type))) {
    throw Object.assign(new Error('Atlas Cloud reference media selection is incomplete.'), {
      status: 400, code: 'invalid-reference-media'
    });
  }
  const videoCount = mediaTypes.filter((type) => type === 'video').length;
  let mode = String(body.videoMode || '').trim().toLowerCase();
  let modeDefinition = {};
  if (isI2v) {
    if (!urls.length || urls.length > 2 || audioUrls.length || mediaTypes.some((type) => type !== 'image')) {
      throw Object.assign(new Error(`${provider.name} requires one first-frame image and an optional last-frame image.`), {
        status: 400, code: 'reference-required'
      });
    }
    mode = urls.length === 2 ? 'first-last-frame' : 'first-frame';
    modeDefinition = Array.isArray(capabilities.videoModes)
      ? capabilities.videoModes.find((entry) => entry && entry.id === mode) || {}
      : {};
  } else {
    if (!mode) mode = 'omni';
    if (!['omni', 'video-reference', 'video-edit', 'video-extend'].includes(mode)) {
      throw Object.assign(new Error(`${provider.name} does not support this reference mode.`), {
        status: 400, code: 'invalid-video-mode'
      });
    }
    modeDefinition = Array.isArray(capabilities.videoModes)
      ? capabilities.videoModes.find((entry) => entry && entry.id === mode) || {}
      : {};
    const maxImages = Math.max(0, Number(modeDefinition.maxReferenceImages ?? capabilities.maxReferenceImages) || 30);
    const maxVideos = Math.max(0, Number(modeDefinition.maxReferenceVideos ?? capabilities.maxReferenceVideos) || 10);
    const minVideos = Math.max(0, Number(modeDefinition.minReferenceVideos) || 0);
    const maxAudios = Math.max(0, Number(modeDefinition.maxReferenceAudios ?? capabilities.maxReferenceAudios) || 0);
    const maxTotal = Math.max(1, Number(modeDefinition.maxReferences ?? capabilities.maxTotalReferences) || maxImages + maxVideos + maxAudios);
    const imageCount = mediaTypes.filter((type) => type === 'image').length;
    if (urls.length + audioUrls.length > maxTotal || imageCount > maxImages
        || videoCount < minVideos || videoCount > maxVideos || audioUrls.length > maxAudios) {
      throw Object.assign(new Error(`${provider.name} received too many reference files.`), {
        status: 400, code: 'too-many-references'
      });
    }
    if (!urls.length && !audioUrls.length) {
      throw Object.assign(new Error(`${provider.name} requires at least one reference asset.`), {
        status: 400, code: 'reference-required'
      });
    }
    if (mode === 'video-edit' && videoCount !== 1) {
      throw Object.assign(new Error(`${provider.name} video editing requires exactly one reference video.`), {
        status: 400, code: 'invalid-video-mode'
      });
    }
    if (mode === 'video-extend' && (videoCount !== 1 || urls.length !== 1 || audioUrls.length)) {
      throw Object.assign(new Error(`${provider.name} video extension requires exactly one reference video.`), {
        status: 400, code: 'invalid-video-mode'
      });
    }
    if (String(provider.model).includes('2.0') && !urls.length) {
      throw Object.assign(new Error(`${provider.name} requires an image or video reference in addition to audio.`), {
        status: 400, code: 'reference-required'
      });
    }
  }
  const resolution = String(body.resolution || '').trim().toUpperCase();
  const validResolutions = new Set((Array.isArray(capabilities.resolutions) ? capabilities.resolutions : [])
    .map((value) => String(value).toUpperCase()));
  if (!validResolutions.has(resolution)) {
    throw Object.assign(new Error(`${provider.name} does not support this resolution.`), {
      status: 400, code: 'invalid-resolution'
    });
  }
  const duration = Number(body.duration);
  const durationSource = Array.isArray(modeDefinition.durations) && modeDefinition.durations.length
    ? modeDefinition.durations
    : capabilities.durations;
  const durations = Array.isArray(durationSource) ? durationSource.map(Number) : [];
  if (!Number.isInteger(duration) || !durations.includes(duration)) {
    throw Object.assign(new Error(`${provider.name} does not support this duration.`), {
      status: 400, code: 'invalid-duration'
    });
  }
  let ratio = String(body.aspectRatio || '').trim();
  const validRatios = Array.isArray(capabilities.ratios) ? capabilities.ratios.map(String) : [];
  // Seedance 2.0 image-to-video accepts explicit ratios as well as adaptive;
  // Seedance 2.5 image-to-video is documented as adaptive-only. Keep the
  // distinction here so the frontend can expose the real matrix and Atlas
  // receives the selected ratio when the upstream supports it.
  if (isI2v && String(provider.model || '').includes('2.5')) ratio = 'adaptive';
  if (mode === 'video-edit' && String(provider.model).includes('2.5')) {
    ratio = 'adaptive';
    if (duration !== -1) {
      throw Object.assign(new Error('Seedance 2.5 video editing requires duration -1.'), {
        status: 400, code: 'invalid-duration'
      });
    }
  }
  if (mode === 'video-extend' && String(provider.model).includes('2.5')) ratio = 'adaptive';
  if (!validRatios.includes(ratio)) {
    throw Object.assign(new Error(`${provider.name} does not support this aspect ratio.`), {
      status: 400, code: 'invalid-aspect-ratio'
    });
  }
  const outputFormat = String(body.outputFormat || 'mp4').trim().toLowerCase();
  if (!['mp4', 'mov'].includes(outputFormat)) {
    throw Object.assign(new Error(`${provider.name} does not support this output format.`), {
      status: 400, code: 'invalid-output-format'
    });
  }
  if (audioUrls.length > Number(capabilities.maxReferenceAudios || 0)) {
    throw Object.assign(new Error(`${provider.name} received too many reference audio files.`), { status: 400, code: 'too-many-reference-audios' });
  }
  if (String(provider.model).includes('2.0') && audioUrls.length && !urls.length) {
    throw Object.assign(new Error(`${provider.name} requires an image or video reference in addition to audio.`), { status: 400, code: 'reference-required' });
  }
  return { capabilities, isI2v, urls, mediaTypes, audioUrls, mode, resolution, duration, ratio, outputFormat };
}

async function createAtlasSeedanceVideoTask(provider, body, signal) {
  const input = atlasVideoTaskInput(provider, body);
  const { capabilities, isI2v, urls, mediaTypes, audioUrls, mode, resolution, duration, ratio, outputFormat } = input;
  const prompt = isI2v
    ? String(body.prompt || '').trim()
    : seedanceReferencePrompt(body.prompt, mode, mediaTypes, audioUrls.length);
  const common = {
    model: provider.model,
    prompt,
    duration,
    resolution: atlasResolution(resolution),
    ratio,
    output_format: outputFormat,
    generate_audio: body.generateAudio !== false,
    ...(capabilities.supportsSeed && Number.isInteger(Number(body.seed)) ? { seed: Number(body.seed) } : {}),
    ...(Array.isArray(capabilities.bitrateModes) && capabilities.bitrateModes.includes(String(body.bitrateMode || '').toLowerCase())
      ? { bitrate_mode: String(body.bitrateMode).toLowerCase() } : {}),
    // Optional Atlas flags are omitted unless explicitly enabled. The 2.5
    // reference endpoint rejects false-valued fields that belong to other
    // generation modes.
    ...(body.watermark === true && capabilities.supportsWatermark === true ? { watermark: true } : {}),
    ...(body.returnLastFrame === true ? { return_last_frame: true } : {})
  };
  const uploadedUrls = [];
  for (let index = 0; index < urls.length; index += 1) {
    uploadedUrls.push(await atlasMediaReference(provider, urls[index], mediaTypes[index] || 'image', signal));
  }
  const uploadedAudioUrls = [];
  for (const url of audioUrls) uploadedAudioUrls.push(await atlasMediaReference(provider, url, 'audio', signal));
  const requestBody = isI2v
    ? {
        ...common,
        image: uploadedUrls[0],
        ...(uploadedUrls[1] ? { last_image: uploadedUrls[1] } : {})
      }
    : {
        ...common,
        reference_images: uploadedUrls
          .map((url, index) => mediaTypes[index] === 'image' ? url : null)
          .filter(Boolean),
        reference_videos: uploadedUrls
          .map((url, index) => mediaTypes[index] === 'video' ? url : null)
          .filter(Boolean),
        reference_audios: uploadedAudioUrls,
        ...(mode === 'video-edit' ? { omni_reference_task_type: 'edit' }
          : mode === 'video-extend' ? { omni_reference_task_type: 'extend' }
            : String(provider.model).includes('2.5') && ['omni', 'video-reference'].includes(mode)
              ? { omni_reference_task_type: 'auto' } : {})
      };
  const requestOptions = (payload) => ({
    method: 'POST',
    headers: providerTaskHeaders(provider, body),
    signal: providerSignal(signal, Number(capabilities.createTimeoutMs) || 45_000),
    body: JSON.stringify(payload)
  });
  let created;
  try {
    created = await responseJson(await fetch(provider.endpoint, requestOptions(requestBody)), provider.name);
  } catch (error) {
    // Some Atlas deployments still expose the Volcengine spelling for the
    // generic 2.5 reference task. A 400 means no task was accepted, so this
    // compatibility retry cannot create a second billable task.
    const canRetryReferenceAlias = !isI2v
      && String(provider.model || '').includes('2.5')
      && ['omni', 'video-reference'].includes(mode)
      && requestBody.omni_reference_task_type === 'auto'
      && Number(error && error.status) === 400
      && String(error && error.code || '') === 'provider-request-failed';
    if (!canRetryReferenceAlias) throw error;
    created = await responseJson(await fetch(provider.endpoint, requestOptions({
      ...requestBody,
      omni_reference_task_type: 'reference'
    })), provider.name);
  }
  const taskId = providerVideoTaskId(created);
  if (!taskId || taskId.length > 256) {
    throw Object.assign(new Error(`${provider.name} did not return a valid prediction ID.`), {
      status: 502, code: 'provider-invalid-response', retryable: false
    });
  }
  return { providerId: provider.id, taskId };
}

function klingRelayMediaUrl(rawUrl) {
  const url = String(rawUrl || '').trim();
  if (/^data:image\//i.test(url)) {
    const image = stripImageMetadata(parseImageDataUrl(url, { maxBytes: 24 * 1024 * 1024 }));
    return storeAi302RelayAsset(image, { relayTtlMs: 2 * 60 * 60 * 1000 }).url;
  }
  if (/^https:\/\//i.test(url)) return url;
  throw Object.assign(new Error('Kling requires HTTPS image or video references.'), {
    status: 400,
    code: 'invalid-reference-media'
  });
}

function klingReferenceUrls(urls) {
  return urls.map((url) => klingRelayMediaUrl(url));
}

async function createKlingV3VideoTask(provider, body, signal) {
  const { duration, referenceMediaTypes, urls } = validatedVideoTaskInput(provider, body);
  if (urls.length !== 1 || referenceMediaTypes[0] !== 'image') {
    throw Object.assign(new Error(`${provider.name} requires exactly one reference image.`), {
      status: 400,
      code: 'reference-required'
    });
  }
  const requestBody = {
    cfg_scale: 0.5,
    duration,
    image: klingRelayMediaUrl(urls[0]),
    prompt: String(body.prompt || '').trim(),
    // V3 documents sound as the audio switch. It is enabled consistently
    // with the existing video providers; the pricing table uses sound-on.
    sound: provider.capabilities && provider.capabilities.generateAudio === true
  };
  const created = await responseJson(await fetch(provider.endpoint, {
    method: 'POST',
    headers: providerTaskHeaders(provider, body),
    signal: providerSignal(signal),
    body: JSON.stringify(requestBody)
  }), provider.name);
  const taskId = providerVideoTaskId(created);
  if (!taskId || taskId.length > 256) {
    throw Object.assign(new Error(`${provider.name} did not return a valid task ID.`), {
      status: 502,
      code: 'provider-invalid-response',
      retryable: false
    });
  }
  return { providerId: provider.id, taskId };
}

function klingO3Endpoint(provider, operation) {
  const endpoint = new URL(provider.endpoint);
  const operationName = String(operation || '').trim().toLowerCase();
  if (!['image-to-video', 'reference-to-video', 'video-edit'].includes(operationName)) {
    throw Object.assign(new Error('The Kling O3 operation is invalid.'), { status: 400, code: 'invalid-video-mode' });
  }
  endpoint.pathname = endpoint.pathname.replace(
    /\/(?:image-to-video|reference-to-video|video-edit|text-to-video)$/i,
    `/${operationName}`
  );
  return endpoint.toString();
}

function klingO3AspectRatio(body) {
  const requested = String(body.aspectRatio || '').trim();
  if (['16:9', '9:16', '1:1'].includes(requested)) return requested;
  const width = Number(body.sourceWidth);
  const height = Number(body.sourceHeight);
  if (width > 0 && height > 0) {
    const ratio = width / height;
    return ['16:9', '9:16', '1:1'].reduce((nearest, candidate) => {
      const [candidateWidth, candidateHeight] = candidate.split(':').map(Number);
      const distance = Math.abs(ratio - candidateWidth / candidateHeight);
      return distance < nearest.distance ? { candidate, distance } : nearest;
    }, { candidate: '16:9', distance: Number.POSITIVE_INFINITY }).candidate;
  }
  return '16:9';
}

async function createKlingO3VideoTask(provider, body, signal) {
  const { capabilities, duration, mode, referenceMediaTypes, urls } = validatedVideoTaskInput(provider, body);
  const mediaUrls = klingReferenceUrls(urls);
  const images = mediaUrls.filter((_url, index) => referenceMediaTypes[index] === 'image');
  const videos = mediaUrls.filter((_url, index) => referenceMediaTypes[index] === 'video');
  const isEdit = mode === 'video-edit';
  const isImageToVideo = mode === 'first-frame' && images.length === 1 && videos.length === 0;
  const operation = isEdit ? 'video-edit' : isImageToVideo ? 'image-to-video' : 'reference-to-video';

  if (mode === 'first-last-frame' && (images.length !== 2 || videos.length)) {
    throw Object.assign(new Error(`${provider.name} requires two reference images for first/last frame generation.`), {
      status: 400,
      code: 'invalid-reference-media'
    });
  }
  if (isEdit && videos.length !== 1) {
    throw Object.assign(new Error(`${provider.name} requires one reference video for video editing.`), {
      status: 400,
      code: 'reference-required'
    });
  }
  if (!isEdit && videos.length > 1) {
    throw Object.assign(new Error(`${provider.name} accepts at most one reference video.`), {
      status: 400,
      code: 'too-many-reference-videos'
    });
  }
  if (videos.length && images.length > 4) {
    throw Object.assign(new Error(`${provider.name} accepts at most four reference images with a reference video.`), {
      status: 400,
      code: 'too-many-references'
    });
  }

  let requestBody;
  if (isImageToVideo) {
    // The O3 image-to-video endpoint derives the output ratio from the image;
    // it accepts only the documented image/prompt/duration/sound fields.
    requestBody = {
      duration,
      image: images[0],
      prompt: String(body.prompt || '').trim(),
      sound: capabilities.generateAudio !== false
    };
  } else if (isEdit) {
    requestBody = {
      ...(images.length ? { images } : {}),
      keep_original_sound: body.keepOriginalSound !== false,
      prompt: String(body.prompt || '').trim(),
      video: videos[0]
    };
  } else {
    requestBody = {
      aspect_ratio: klingO3AspectRatio(body),
      duration,
      ...(images.length ? { images } : {}),
      ...(videos.length ? { video: videos[0], keep_original_sound: body.keepOriginalSound !== false } : {}),
      prompt: String(body.prompt || '').trim(),
      sound: capabilities.generateAudio !== false
    };
  }

  const created = await responseJson(await fetch(klingO3Endpoint(provider, operation), {
    method: 'POST',
    headers: providerTaskHeaders(provider, body),
    signal: providerSignal(signal),
    body: JSON.stringify(requestBody)
  }), provider.name);
  const taskId = providerVideoTaskId(created);
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

async function createVideoTaskWithProvider(provider, body, signal) {
  if (provider.protocol === 'minimax-video-v2') return createMiniMaxVideoTask(provider, body, signal);
  if (provider.protocol === 'seedance-video-v3') return createSeedanceVideoTask(provider, body, signal);
  if (provider.protocol === 'atlas-seedance-video') return createAtlasSeedanceVideoTask(provider, body, signal);
  if (['jimeng-video-v30', 'jimeng-video-v30-pro'].includes(provider.protocol)) {
    return createJimengVideoTask(provider, body, signal);
  }
  if (provider.protocol === 'kling-v3-image-to-video') return createKlingV3VideoTask(provider, body, signal);
  if (provider.protocol === 'kling-o3-omni') return createKlingO3VideoTask(provider, body, signal);
  throw Object.assign(new Error('The selected video provider does not support asynchronous tasks.'), {
    status: 400,
    code: 'async-video-not-supported'
  });
}

export async function createVideoTask(body, signal) {
  const requestedProviderId = String(body.providerId || '').trim().toLowerCase();
  const providers = providersForRequest('video', requestedProviderId, body);
  let firstError;
  let lastError;
  for (const provider of providers) {
    try {
      const created = await createVideoTaskWithProvider(provider, body, signal);
      return {
        ...created,
        taskId: routedProviderTaskId(requestedProviderId, created.providerId, created.taskId)
      };
    } catch (error) {
      if (!firstError) firstError = error;
      lastError = error;
      if (signal && signal.aborted) throw error;
      if (!shouldTryProviderFallback(error)) {
        if (error !== firstError && FALLBACK_CAPABILITY_ERRORS.has(String(error.code || '').trim().toLowerCase())) break;
        throw error;
      }
    }
  }
  throw preferredFallbackError(firstError, lastError);
}

function validVideoTaskId(taskId) {
  const normalizedTaskId = String(taskId || '').trim();
  if (!normalizedTaskId || normalizedTaskId.length > 256) {
    throw Object.assign(new Error('The video task identifier is invalid.'), { status: 400, code: 'invalid-video-task' });
  }
  return normalizedTaskId;
}

function miniMaxVideoUsage(payload) {
  const source = nestedVideoTaskObject(payload, ['usage']);
  if (!source) return null;
  const value = (...keys) => {
    for (const key of keys) {
      const parsed = Number(source[key]);
      if (Number.isFinite(parsed) && parsed >= 0) return Math.max(0, Math.round(parsed));
    }
    return null;
  };
  const usage = {
    totalSeconds: value('total_seconds', 'totalSeconds'),
    inputSeconds: value('input_seconds', 'inputSeconds'),
    outputSeconds: value('output_seconds', 'outputSeconds'),
    inputImageCount: value('input_image_count', 'inputImageCount')
  };
  return Object.values(usage).some((entry) => entry !== null) ? usage : null;
}
async function pollMiniMaxVideoTask(provider, taskId, signal) {
  const normalizedTaskId = validVideoTaskId(taskId);
  const result = await responseJson(await fetch(
    `${provider.resultEndpoint}/${encodeURIComponent(normalizedTaskId)}`,
    { headers: providerHeaders(provider), signal: providerSignal(signal) }
  ), provider.name);
  const status = providerVideoTaskStatus(result);
  if (status === 'succeeded') {
    const resultUrl = providerVideoResultUrl(result);
    if (!resultUrl) {
      return { status: 'running' };
    }
    return { status, resultUrl, usage: miniMaxVideoUsage(result) };
  }
  if (TERMINAL_VIDEO_FAILURES.has(status)) {
    return {
      status,
      ...providerVideoTaskError(result, `provider-${status}`, `${provider.name} video generation ${status}.`)
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
  const status = providerVideoTaskStatus(result);
  if (status === 'succeeded') {
    const resultUrl = providerVideoResultUrl(result);
    if (!resultUrl) {
      return { status: 'running' };
    }
    return { status, resultUrl };
  }
  if (TERMINAL_VIDEO_FAILURES.has(status)) {
    return {
      status,
      ...providerVideoTaskError(result, `provider-${status}`, `${provider.name} video generation ${status}.`)
    };
  }
  return { status };
}

async function pollAtlasSeedanceVideoTask(provider, taskId, signal) {
  const normalizedTaskId = validVideoTaskId(taskId);
  const result = await responseJson(await fetch(
    `${provider.resultEndpoint}/${encodeURIComponent(normalizedTaskId)}`,
    { headers: providerHeaders(provider), signal: providerSignal(signal, 30_000) }
  ), provider.name);
  const status = providerVideoTaskStatus(result);
  if (status === 'succeeded') {
    const resultUrl = providerVideoResultUrl(result);
    return resultUrl ? { status, resultUrl } : { status: 'running' };
  }
  if (TERMINAL_VIDEO_FAILURES.has(status)) {
    return {
      status,
      ...providerVideoTaskError(result, `provider-${status}`, `${provider.name} video generation ${status}.`)
    };
  }
  return { status };
}

async function pollKlingV3VideoTask(provider, taskId, signal) {
  const normalizedTaskId = validVideoTaskId(taskId);
  const result = await responseJson(await fetch(
    `${provider.resultEndpoint}/${encodeURIComponent(normalizedTaskId)}/result`,
    { headers: providerHeaders(provider), signal: providerSignal(signal) }
  ), provider.name);
  const status = providerVideoTaskStatus(result);
  if (status === 'succeeded') {
    const resultUrl = providerVideoResultUrl(result);
    return resultUrl ? { status, resultUrl } : { status: 'running' };
  }
  if (TERMINAL_VIDEO_FAILURES.has(status)) {
    return { status, ...providerVideoTaskError(result, `provider-${status}`, `${provider.name} video generation ${status}.`) };
  }
  return { status };
}

async function pollKlingO3VideoTask(provider, taskId, signal) {
  const normalizedTaskId = validVideoTaskId(taskId);
  const result = await responseJson(await fetch(
    `${provider.resultEndpoint}/${encodeURIComponent(normalizedTaskId)}/result`,
    { headers: providerHeaders(provider), signal: providerSignal(signal) }
  ), provider.name);
  const status = providerVideoTaskStatus(result);
  if (status === 'succeeded') {
    const resultUrl = providerVideoResultUrl(result);
    return resultUrl
      ? { status, resultUrl }
      : { status: 'running' };
  }
  if (TERMINAL_VIDEO_FAILURES.has(status)) {
    return { status, ...providerVideoTaskError(result, `provider-${status}`, `${provider.name} video generation ${status}.`) };
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
  const routed = parseRoutedProviderTaskId(String(providerId || ''), taskId);
  const provider = providerFor('video', routed.providerId);
  if (provider.protocol === 'minimax-video-v2') return pollMiniMaxVideoTask(provider, routed.taskId, signal);
  if (provider.protocol === 'seedance-video-v3') return pollSeedanceVideoTask(provider, routed.taskId, signal);
  if (provider.protocol === 'atlas-seedance-video') return pollAtlasSeedanceVideoTask(provider, routed.taskId, signal);
  if (['jimeng-video-v30', 'jimeng-video-v30-pro'].includes(provider.protocol)) {
    return pollJimengVideoTask(provider, routed.taskId, signal);
  }
  if (provider.protocol === 'kling-v3-image-to-video') return pollKlingV3VideoTask(provider, routed.taskId, signal);
  if (provider.protocol === 'kling-o3-omni') return pollKlingO3VideoTask(provider, routed.taskId, signal);
  throw Object.assign(new Error('The selected video provider does not support task polling.'), {
    status: 400,
    code: 'async-video-not-supported'
  });
}

export async function chat(body, signal) {
  const provider = providerFor('chat', String(body.providerId || ''));
  const requestedModel = String(body.model || '').trim();
  const logicalModel = provider.models.includes(requestedModel) ? requestedModel : provider.models[0];
  const model = provider.upstreamModels && provider.upstreamModels[logicalModel]
    ? provider.upstreamModels[logicalModel]
    : logicalModel;
  return requestChat(fetch, {
    apiKey: provider.apiKey,
    chatEndpoint: provider.endpoint,
    chatProviderName: provider.name,
    chatModel: model || requestedModel,
    returnUsage: true
  }, { prompt: body.prompt, messages: body.messages }, signal);
}

export async function models(providerId) {
  const provider = providerFor('chat', String(providerId || ''));
  const result = await discoverChatModels(fetch, provider.endpoint, provider.apiKey);
  return { ...result, providerId: provider.id };
}
