import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import {
  deleteAi302RelayAsset,
  getAi302RelayAsset,
  parseImageDataUrl,
  storeAi302RelayAsset,
  stripImageMetadata
} from './ai302-tools.js';
import { normalizeVideoResolution } from './video-resolution.js';
import { AI302_PRIMARY_BASE_URL, getAi302BackupRoutes } from './tool-routes.js';

const require = createRequire(import.meta.url);
const {
  detectMediaProtocol,
  generateMediaBuffer,
  generatedImageDimensions,
  gptImage2Size,
  recoverMediaBuffer,
  validateGeneratedMediaBuffer
} = require('../../lib/ai-media-provider');
const { requestChat, discoverChatModels } = require('../../lib/ai-chat-provider');
const { PROVIDER_CATALOG_VERSION, providerCatalog } = require('../../lib/provider-catalog');
const { sanitizePublicModelLabel } = require('../../lib/public-model-label');

const QUICKROUTER_BASE_URL = 'https://api.quickrouter.ai';
const DEFAULT_RESULT_ENDPOINT = `${QUICKROUTER_BASE_URL}/v1/videos`;
const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PROVIDER_KEY_ENV = /^[A-Z][A-Z0-9_]{1,80}$/;
const MAX_PROVIDERS = 100;
const GPT_IMAGE_2_PROVIDER_ID = 'image-6';
const RETIRED_GPT_IMAGE_2_ROUTE_IDS = new Set([
  'atlas-image-gpt2',
  'legacy-image-gpt2',
  'aireiter-image-gpt2'
]);
const ASYNC_VIDEO_PROTOCOLS = new Set([
  'minimax-video-v2',
  'atlas-minimax-h3-video',
  'seedance-video-v3',
  'atlas-seedance-video',
  'jimeng-video-v30',
  'jimeng-video-v30-pro',
  'kling-v3-image-to-video',
  'kling-o3-omni',
  'aireiter-async'
]);
const TERMINAL_VIDEO_FAILURES = new Set(['failed', 'cancelled', 'expired']);
const ROUTED_TASK_PREFIX = 'messs-route:';
const PUBLIC_CAPABILITY_KEYS = new Set([
  'arbitraryRatios', 'arbitrarySizes', 'bitrateModes', 'counts', 'createTimeoutMs',
  'defaultServiceTier', 'durations', 'enhancePrompt', 'frameReferenceEncoding',
  'frameReferenceRatios', 'generateAudio', 'maxReferenceAudios', 'maxReferenceImageBytes',
  'maxReferenceImages', 'maxReferenceImagesWithVideo', 'maxReferenceVideos', 'maxReferences',
  'maxSizeEdge', 'maxSizePixels', 'maxTotalReferences', 'maximumAspectRatio', 'minimumAspectRatio',
  'mediaTypes', 'minReferenceImages', 'minReferenceVideos', 'minReferences',
  'multiReferenceSizes', 'outputFormats', 'promptMaxCharacters', 'qualities', 'ratios',
  'referenceAudioMimeTypes', 'referenceDataUrlsOnly', 'referenceImageBytes',
  'referenceMimeTypes', 'referencePromptMaxCharacters', 'referenceRatios',
  'referenceResolutions', 'referenceRoles', 'referenceSizes', 'resolutionPresets', 'resolutions',
  'seedMaximum', 'seedMinimum', 'serviceTier', 'serviceTiers', 'sizeMultiple', 'sizes',
  'sizeRatios', 'styles', 'supportsEdit', 'supportsHd', 'supportsResolution', 'supportsSeed',
  'supportsWatermark', 'textRatios', 'tierResolutions', 'videoModes'
]);
const PUBLIC_CAPABILITY_NESTED_KEYS = new Set([
  'id', 'minReferences', 'maxReferences', 'minReferenceImages', 'maxReferenceImages',
  'minReferenceVideos', 'maxReferenceVideos', 'maxReferenceAudios', 'roles', 'mediaTypes',
  'ratios', 'durations', 'hidden'
]);

function sanitizePublicCapabilityValue(value, nested = false) {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizePublicCapabilityValue(entry, true));
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => (nested ? PUBLIC_CAPABILITY_NESTED_KEYS : PUBLIC_CAPABILITY_KEYS).has(key))
    .map(([key, entry]) => [key, sanitizePublicCapabilityValue(entry, true)]));
}

function publicCapabilities(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = sanitizePublicCapabilityValue(value);
  // Service tier names are safe product configuration, but their provider
  // mapping is intentionally never sent to the client.
  if (value.tierResolutions && typeof value.tierResolutions === 'object') {
    result.tierResolutions = Object.fromEntries(Object.entries(value.tierResolutions)
      .filter(([, resolutions]) => Array.isArray(resolutions))
      .map(([tier, resolutions]) => [String(tier).slice(0, 32), resolutions.slice(0, 32).map(String)]));
  }
  if (value.sizeRatios && typeof value.sizeRatios === 'object') {
    result.sizeRatios = Object.fromEntries(Object.entries(value.sizeRatios)
      .filter(([, ratio]) => typeof ratio === 'string' || typeof ratio === 'number')
      .map(([size, ratio]) => [String(size).slice(0, 32), String(ratio).slice(0, 32)]));
  }
  return result;
}

function publicProvider(provider) {
  return {
    id: provider.id,
    kind: provider.kind,
    name: sanitizePublicModelLabel(provider.name, provider.id),
    models: Array.isArray(provider.models)
      ? provider.models.map((model) => sanitizePublicModelLabel(model, 'AI model')).slice(0, 30)
      : [],
    capabilities: publicCapabilities(provider.capabilities)
  };
}

function shouldTryProviderFallback(error) {
  if (!error || error.name === 'AbortError') return false;
  // Once an upstream has returned a task ID or a generated asset, the
  // request may already be billable. Never replay it on another route.
  if (error.taskId || error.providerTaskId || error.providerTaskAccepted === true
      || error.submissionAmbiguous === true) return false;
  // `retryable` also covers polling and downloads. A paid creation may only
  // move to another route when the adapter can prove that no task was accepted.
  return error.safeToFallback === true;
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

function stableRouteAliasId(providerId, routeId) {
  const input = `${providerId}:${routeId}`;
  let hash = 2166136261;
  for (const character of input) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const digest = (hash >>> 0).toString(36).padStart(7, '0');
  return `r-${String(routeId).slice(0, 20)}-${String(providerId).slice(0, 27)}-${digest}`
    .replace(/[^a-z0-9-]/gi, '-').slice(0, 63).toLowerCase();
}

function replaceRouteOrigin(endpoint, routeBaseUrl) {
  try {
    const source = new URL(endpoint);
    const target = new URL(routeBaseUrl);
    source.protocol = target.protocol;
    source.host = target.host;
    source.username = '';
    source.password = '';
    return source.toString();
  } catch (error) {
    return '';
  }
}

function isAi302Endpoint(endpoint) {
  try {
    return new URL(endpoint).origin === AI302_PRIMARY_BASE_URL;
  } catch (error) {
    return false;
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
    const builtin = byId.get(id);
    const lockedGptImage2 = id === GPT_IMAGE_2_PROVIDER_ID && builtin && builtin.kind === 'image';
    const kind = ['chat', 'image', 'video'].includes(raw.kind)
      ? raw.kind
      : (builtin && builtin.kind) || '';
    // GPT Image 2 is intentionally a single AI Reiter route. Do not let an
    // old Railway AI_PROVIDERS_JSON entry replace its endpoint, protocol, or
    // credential and silently create a billable request on another service.
    const endpoint = safeServerEndpoint(lockedGptImage2 ? builtin.endpoint : raw.endpoint || (builtin && builtin.endpoint));
    const keyEnv = String(lockedGptImage2 ? builtin.keyEnv : raw.keyEnv || (builtin && builtin.keyEnv) || '').trim();
    if (!PROVIDER_ID.test(id) || !kind || !endpoint || !PROVIDER_KEY_ENV.test(keyEnv)) continue;
    const models = Array.isArray(raw.models)
      ? raw.models.map(String).map((v) => v.trim()).filter(Boolean).slice(0, 30)
      : (builtin && builtin.models) || [];
    const upstreamModels = raw.upstreamModels && typeof raw.upstreamModels === 'object' && !Array.isArray(raw.upstreamModels)
      ? Object.fromEntries(Object.entries(raw.upstreamModels).slice(0, 30).map(([logical, upstream]) => [
        String(logical).trim().slice(0, 120), String(upstream).trim().slice(0, 120)
      ]).filter(([logical, upstream]) => logical && upstream))
      : (builtin && builtin.upstreamModels) || {};
    byId.set(id, {
      id, kind,
      name: String(raw.name || (builtin && builtin.name) || id).trim().slice(0, 80),
      endpoint,
      resultEndpoint: safeServerEndpoint(lockedGptImage2 ? builtin.resultEndpoint : raw.resultEndpoint || (builtin && builtin.resultEndpoint)) || DEFAULT_RESULT_ENDPOINT,
      models,
      upstreamModels,
      // This is an internal routing hint. It is deliberately removed from
      // publicProviderConfig so the renderer only sees product model labels.
      logicalModel: String(raw.logicalModel || (builtin && builtin.logicalModel) || '').trim().slice(0, 120),
      fallbackProviderIds: [...new Set((builtin
        ? (builtin.fallbackProviderIds || [])
        : (Array.isArray(raw.fallbackProviderIds) ? raw.fallbackProviderIds : []))
        .map((value) => String(value || '').trim().toLowerCase())
        .filter((value) => PROVIDER_ID.test(value)))].slice(0, 20),
      model: String(lockedGptImage2 ? builtin.model : raw.model || (builtin && builtin.model) || '').trim().slice(0, 120),
      protocol: String(lockedGptImage2 ? builtin.protocol : raw.protocol || (builtin && builtin.protocol) || '').trim().slice(0, 40),
      // Capabilities for catalog models are versioned with the application.
      // Deployment overrides may replace endpoints or credentials, but must
      // not revive a stale resolution/mode matrix for a built-in model.
      capabilities: builtin && builtin.capabilities
        ? builtin.capabilities
        : (raw.capabilities && typeof raw.capabilities === 'object' ? raw.capabilities : null),
      // Routing policy is internal metadata. It is intentionally omitted from
      // publicProvider() so the UI only receives product capabilities.
      routingPolicy: String(raw.routingPolicy || (builtin && builtin.routingPolicy) || '').trim().slice(0, 40),
      hidden: raw.hidden === true || Boolean(builtin && builtin.hidden),
      keyEnv
    });
  }
  const originals = [...byId.values()];
  const backupRoutes = getAi302BackupRoutes();
  for (const provider of originals) {
    if (!isAi302Endpoint(provider.endpoint)) continue;
    const aliases = [];
    for (const route of backupRoutes) {
      const aliasId = stableRouteAliasId(provider.id, route.id);
      if (byId.has(aliasId)) continue;
      const endpoint = replaceRouteOrigin(provider.endpoint, route.baseUrl);
      const resultEndpoint = replaceRouteOrigin(provider.resultEndpoint, route.baseUrl);
      if (!endpoint || !resultEndpoint) continue;
      byId.set(aliasId, {
        ...provider,
        id: aliasId,
        endpoint,
        resultEndpoint,
        name: `${provider.name} route`.slice(0, 80),
        hidden: true,
        keyEnv: 'AI302_KEY',
        routeId: route.id,
        routeApiKey: route.apiKey,
        routeAliasOf: provider.id,
        fallbackProviderIds: []
      });
      aliases.push(aliasId);
    }
    if (aliases.length) {
      provider.fallbackProviderIds = [
        ...new Set([...(provider.fallbackProviderIds || []), ...aliases])
      ].slice(0, 20);
      // A logical product route can point at a hidden compatibility provider
      // (for example GPT Image 2 -> legacy 302). Carry that provider's
      // dynamically configured backup routes onto the logical route too, so
      // a rejected primary still has the complete same-family chain.
      for (const parent of originals) {
        if (parent === provider || !Array.isArray(parent.fallbackProviderIds)) continue;
        if (!parent.fallbackProviderIds.includes(provider.id)) continue;
        parent.fallbackProviderIds = [
          ...new Set([...parent.fallbackProviderIds, ...aliases])
        ].slice(0, 20);
      }
    }
  }
  return [...byId.values()];
}

function providerApiKey(provider) {
  if (provider && provider.routeApiKey) return provider.routeApiKey;
  const direct = String(process.env[provider.keyEnv] || '').trim();
  if (direct) return direct;
  // Both spellings have been used by deployed Railway environments. Keep the
  // catalog canonical while accepting the legacy underscored secret so a
  // correctly configured Atlas account is not hidden from the client.
  if (provider.keyEnv === 'ATLASCLOUD_API_KEY') {
    return String(process.env.ATLAS_CLOUD_API_KEY || '').trim();
  }
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
  if (Array.isArray(provider && provider.fallbackProviderIds)) {
    routeIds.push(...provider.fallbackProviderIds);
  }
  return [...new Set(routeIds.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean))];
}

function providerHasUsableRoute(provider, providers = configuredProviders()) {
  const byId = new Map(providers.map((entry) => [entry.id, entry]));
  return providerRouteIds(provider).some((id) => {
    const candidate = byId.get(id);
    return candidate && Boolean(providerApiKey(candidate)) && isCompatibleFallbackRoute(provider, candidate);
  });
}

export function publicProviderConfig() {
  const configured = configuredProviders();
  const providers = configured.filter((provider) => !provider.hidden && providerHasUsableRoute(provider, configured));
  return {
    catalogVersion: PROVIDER_CATALOG_VERSION,
    providers: providers.map(publicProvider)
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
  // GPT Image 2 is a single-provider product. Its old 302 and Atlas entries
  // remain catalogued only for historical task/accounting compatibility and
  // must never become new generation candidates.
  if (provider && provider.id === GPT_IMAGE_2_PROVIDER_ID) return [provider.id];
  const capabilities = provider && provider.capabilities && typeof provider.capabilities === 'object'
    ? provider.capabilities
    : {};
  if (provider.kind === 'image' && Array.isArray(capabilities.upstreamPriority)) {
    return [...new Set([
      ...capabilities.upstreamPriority,
      provider.id,
      ...(provider.fallbackProviderIds || [])
    ])];
  }
  if (provider.kind === 'video') {
    const serviceTier = String(body.serviceTier || capabilities.defaultServiceTier || 'standard').trim().toLowerCase();
    const tierProviderId = capabilities.tierProviderIds && capabilities.tierProviderIds[serviceTier];
    if (tierProviderId) {
      return [...new Set([
        tierProviderId,
        ...(Array.isArray(capabilities.fallbackProviderIds) ? capabilities.fallbackProviderIds : []),
        ...(Array.isArray(provider.fallbackProviderIds) ? provider.fallbackProviderIds : [])
      ])];
    }
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
      else videoMode = 'text';
    }
    // Keep old H3 clients working: an empty frame-mode request is really a
    // text-to-video request, not an image-to-video request missing frames.
    if (capabilities.atlasRouted === true
      && Array.isArray(capabilities.upstreamRoutes && capabilities.upstreamRoutes.text)
      && ['first-frame', 'first-last-frame'].includes(videoMode)
      && (Array.isArray(body.urls) ? body.urls.filter(Boolean).length : 0) === 0
      && (Array.isArray(body.referenceAudioUrls) ? body.referenceAudioUrls.filter(Boolean).length : 0)
        + (Array.isArray(body.referenceAudioUploadIds) ? body.referenceAudioUploadIds.filter(Boolean).length : 0) === 0) {
      videoMode = 'text';
    }
    const route = capabilities.upstreamRoutes && capabilities.upstreamRoutes[videoMode];
    if (Array.isArray(route) && route.length) {
      return [...new Set([
        ...route,
        ...(Array.isArray(capabilities.fallbackProviderIds) ? capabilities.fallbackProviderIds : []),
        ...(Array.isArray(provider.fallbackProviderIds) ? provider.fallbackProviderIds : [])
      ])];
    }
  }
  return [...new Set([provider.id, ...(provider.fallbackProviderIds || [])])];
}

function isAireiterProvider(provider) {
  return provider && (
    provider.protocol === 'aireiter-async'
    || String(provider.id || '').startsWith('aireiter-')
  );
}

function orderMixedRouteIds(routeIds, byId, requested) {
  const unique = [...new Set(routeIds.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean))];
  // These product IDs own their selected primary routes. Do not reorder a
  // hidden compatibility route ahead of the endpoint declared by the model.
  if (requested && requested.kind === 'chat' && requested.hidden === true) return unique;
  const atlas = unique.filter((id) => {
    const provider = byId.get(id);
    return provider && (/^atlas[-_]/i.test(id) || /^atlas[-_]/i.test(String(provider.protocol || '')));
  });
  const aireiter = unique.filter((id) => isAireiterProvider(byId.get(id)));
  const existing = unique.filter((id) => !aireiter.includes(id) && !atlas.includes(id));
  if (requested && requested.routingPolicy === 'atlas-primary') {
    // Seedance is explicitly Atlas-first. Approved fallbacks are attempted
    // only after a proven pre-submission rejection; accepted or ambiguous
    // submissions are never replayed on another route.
    return [...atlas, ...aireiter, ...existing];
  }
  // AI Reiter is the product's fixed primary route. Atlas and other
  // compatible routes remain available as ordered fallbacks after a proven
  // pre-submission rejection; traffic percentages must never demote the
  // primary or make a configured backup disappear.
  return [...aireiter, ...atlas, ...existing];
}

function compactProviderIdentity(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function providerLogicalFamily(provider) {
  const kind = String(provider && provider.kind || '').trim().toLowerCase();
  const explicit = compactProviderIdentity(provider && provider.logicalModel);
  if (explicit) return `${kind}:logical:${explicit}`;

  const source = [
    provider && provider.model,
    provider && provider.name,
    provider && provider.id,
    provider && provider.endpoint
  ].filter(Boolean).join(' ').toLowerCase();

  if (kind === 'video') {
    const seedance = /seedance[^0-9]*([0-9]+)(?:[.-]([0-9]+))?/.exec(source);
    if (seedance) return `video:logical:seedance-${seedance[1]}-${seedance[2] || '0'}`;
    if (/kling[^0-9]*(?:v)?3(?:[.-]0)?/.test(source)) return 'video:logical:kling-v3';
    if (/kling[^0-9]*(?:o)?3/.test(source)) return 'video:logical:kling-o3';
  }

  if (kind === 'image') {
    if (/gpt[^a-z0-9]*image[^a-z0-9]*2/.test(source)) return 'image:logical:gpt-image-2';
    if (/nano[^a-z0-9]*banana[^a-z0-9]*2[^a-z0-9]*lite/.test(source)) return 'image:logical:nano-banana-2-lite';
    if (/nano[^a-z0-9]*banana[^a-z0-9]*2/.test(source)) return 'image:logical:nano-banana-2';
    if (/nano[^a-z0-9]*banana[^a-z0-9]*pro/.test(source)) return 'image:logical:nano-banana-pro';
    if (/seedream[^a-z0-9]*5[^a-z0-9]*0[^a-z0-9]*pro/.test(source)) return 'image:logical:seedream-5-0-pro';
  }

  const protocol = compactProviderIdentity(provider && provider.protocol);
  let pathname = '';
  try { pathname = compactProviderIdentity(new URL(String(provider && provider.endpoint || '')).pathname); } catch {}
  return `${kind}:${protocol}:${pathname}`;
}

function isCompatibleFallbackRoute(requested, candidate) {
  if (!requested || !candidate || requested.kind !== candidate.kind) return false;
  if (requested.id === candidate.id) return true;
  if (candidate.routeAliasOf === requested.id) return true;
  const requestedProtocol = compactProviderIdentity(requested.protocol);
  const candidateProtocol = compactProviderIdentity(candidate.protocol);
  if (requestedProtocol && requestedProtocol === candidateProtocol) return true;
  return providerLogicalFamily(requested) === providerLogicalFamily(candidate);
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
  if (kind === 'image' && (
    RETIRED_GPT_IMAGE_2_ROUTE_IDS.has(requested.id)
    || (requested.logicalModel === 'gpt-image-2' && requested.id !== GPT_IMAGE_2_PROVIDER_ID)
  )) {
    throw Object.assign(new Error('The selected GPT Image 2 route has been retired.'), {
      code: 'provider-route-retired',
      status: 400
    });
  }
  const configured = configuredProviders();
  const byId = new Map(configured.filter((provider) => provider.kind === kind).map((provider) => [provider.id, provider]));
  const candidates = [];
  const routeIds = orderMixedRouteIds(requestRouteIds(requested, body), byId, requested, body);
  for (const routeId of routeIds) {
    const candidate = byId.get(String(routeId || '').trim().toLowerCase());
    if (!candidate || !providerApiKey(candidate) || candidates.some((entry) => entry.id === candidate.id)) continue;
    // A fallback route is an implementation detail, not permission to swap
    // products. Require an explicit same-family relationship so a missing
    // route cannot silently turn (for example) one image model into another.
    if (!isCompatibleFallbackRoute(requested, candidate)) continue;
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

async function generateAtlasGptImage(provider, body, signal, hooks = {}) {
  const relayTokens = [];
  try {
    const acceptedTask = body && body._acceptedTask && typeof body._acceptedTask === 'object'
      ? body._acceptedTask : null;
    const urls = acceptedTask ? [] : Array.isArray(body.urls) ? body.urls.slice(0, 10).map((value) => {
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
    if (acceptedTask && acceptedTask.mediaUrl) {
      const mediaUrl = String(acceptedTask.mediaUrl).trim();
      const buffer = validateAtlasGptImageOutput(
        await downloadGeneratedImage(mediaUrl, signal),
        body
      );
      if (typeof hooks.onReady === 'function') {
        await hooks.onReady({ providerId: provider.id, taskId: acceptedTask.taskId || '', mediaUrl, buffer });
      }
      return buffer;
    }
    let taskId = String(acceptedTask && (acceptedTask.taskId || acceptedTask.providerTaskId) || '').trim();
    let pollUrl = String(acceptedTask && acceptedTask.pollUrl || '').trim();
    if (!taskId) {
      const created = await responseJson(await fetch(provider.endpoint, {
        method: 'POST',
        headers: providerTaskHeaders(provider, body),
        signal: providerSignal(signal, 45_000),
        body: JSON.stringify(requestBody)
      }), provider.name);
      taskId = providerVideoTaskId(created);
      if (!taskId || taskId.length > 256) {
        throw Object.assign(new Error(`${provider.name} did not return a valid prediction ID.`), {
          status: 502,
          code: 'provider-invalid-response',
          retryable: false,
          submissionAmbiguous: true
        });
      }
      pollUrl = `${provider.resultEndpoint.replace(/\/$/, '')}/${encodeURIComponent(taskId)}`;
      if (typeof hooks.onAccepted === 'function') {
        await hooks.onAccepted({ providerId: provider.id, taskId, pollUrl });
      }
    }
    try {
      const deadline = Date.now() + 20 * 60_000;
      while (Date.now() < deadline) {
        let result;
        try {
          result = await responseJson(await fetch(
            pollUrl || `${provider.resultEndpoint}/${encodeURIComponent(taskId)}`,
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
            status: 502, code: 'provider-result-missing', providerTaskTerminalFailure: true
          });
          const buffer = validateAtlasGptImageOutput(
            await downloadGeneratedImage(outputUrl, signal),
            body
          );
          if (typeof hooks.onReady === 'function') {
            await hooks.onReady({ providerId: provider.id, taskId, mediaUrl: outputUrl, buffer });
          }
          return buffer;
        }
        if (TERMINAL_VIDEO_FAILURES.has(status)) {
          throw Object.assign(new Error(safeProviderText(
            nestedVideoTaskValue(result, ['error', 'message', 'msg']),
            `${provider.name} image generation ${status}.`
          )), { status: 502, code: `provider-${status}`, providerTaskTerminalFailure: true });
        }
        await delayWithSignal(2_000, signal);
      }
      throw Object.assign(new Error(`${provider.name} image generation timed out.`), {
        status: 504, code: 'provider-timeout'
      });
    } catch (error) {
      if (!error.taskId) error.taskId = taskId;
      error.providerTaskAccepted = true;
      throw error;
    }
  } finally {
    relayTokens.forEach((token) => deleteAi302RelayAsset(token));
  }
}

function aireiterLocalRejection(message, code = 'provider-option-not-supported') {
  return Object.assign(new Error(message), {
    status: 400,
    code,
    safeToFallback: true,
    preSubmissionFailure: true
  });
}

function aireiterTaskIdentity(body = {}) {
  const endUserId = /^u_[a-f0-9]{16,64}$/i.test(String(body.endUserId || '').trim())
    ? String(body.endUserId).trim().toLowerCase()
    : 'u_gateway';
  const operationIdentity = String(body.operationId || '').trim() || JSON.stringify({
    providerId: body.providerId,
    prompt: body.prompt,
    size: body.size,
    resolution: body.resolution,
    aspectRatio: body.aspectRatio,
    duration: body.duration,
    urls: Array.isArray(body.urls) ? body.urls.map((value) => createHash('sha256').update(String(value)).digest('hex').slice(0, 12)) : []
  });
  const digest = createHash('sha256').update(operationIdentity).digest('hex').slice(0, 32);
  return `${endUserId}_${digest}`.slice(0, 64);
}

function aireiterPayloadCode(payload) {
  const value = Number(payload && (
    payload.statusCode
    ?? payload.code
    ?? (payload.error && payload.error.code)
    ?? (payload.data && payload.data.code)
  ));
  return Number.isFinite(value) ? value : 200;
}

function aireiterOutputUrl(payload) {
  const visit = (value, seen = new Set(), depth = 0) => {
    if (value === null || value === undefined || depth > 8) return '';
    if (typeof value === 'string') {
      const source = value.trim();
      if (/^data:(?:image|video)\//i.test(source) || /^https:\/\/\S+$/i.test(source)) return source;
      if (/^[\[{]/.test(source)) {
        try { return visit(JSON.parse(source), seen, depth + 1); } catch (error) { return ''; }
      }
      return '';
    }
    if (typeof value !== 'object' || seen.has(value)) return '';
    seen.add(value);
    if (Array.isArray(value)) {
      for (const entry of value) {
        const found = visit(entry, seen, depth + 1);
        if (found) return found;
      }
      return '';
    }
    for (const key of ['url', 'output_url', 'download_url', 'result_url', 'file_url', 'video_url', 'image_url', 'uri']) {
      const found = visit(value[key], seen, depth + 1);
      if (found) return found;
    }
    for (const key of ['data', 'result', 'response', 'output', 'outputs', 'task', 'content']) {
      const found = visit(value[key], seen, depth + 1);
      if (found) return found;
    }
    return '';
  };
  return visit(payload);
}

function aireiterTaskStatus(payload) {
  const raw = nestedVideoTaskValue(payload, [
    'task_status', 'taskStatus', 'task_state', 'taskState', 'status', 'state'
  ]);
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) {
    if (numeric === 2) return 'succeeded';
    if (numeric === 3 || numeric === 4) return 'failed';
    if (numeric === 1) return 'running';
    return 'queued';
  }
  return normalizeVideoTaskStatus(raw);
}

function markAireiterSubmitError(error) {
  const status = Number(error && error.status);
  if ([400, 401, 402, 404, 425, 429, 433].includes(status)) {
    error.safeToFallback = true;
    error.preSubmissionFailure = true;
    error.submissionAmbiguous = false;
  } else if (error.preSubmissionFailure !== true) {
    error.submissionAmbiguous = true;
  }
  return error;
}

async function submitAireiterTask(provider, body, params, signal) {
  const outTaskId = aireiterTaskIdentity(body);
  let payload;
  try {
    payload = await responseJson(await fetch(provider.endpoint, {
      method: 'POST',
      headers: providerTaskHeaders(provider, body),
      signal: providerSignal(signal, 45_000),
      body: JSON.stringify({ model: provider.model, params, out_task_id: outTaskId })
    }), 'Generation service');
  } catch (error) {
    const classified = markAireiterSubmitError(error);
    // The POST may have reached the service even when its response was lost.
    // Probe the same deterministic task ID before allowing any fallback. A
    // successful probe proves that the paid task exists and pins recovery to
    // AI Reiter without submitting it a second time.
    if (classified.submissionAmbiguous === true && !(signal && signal.aborted)) {
      try {
        await queryAireiterTask(provider, outTaskId, signal);
        return outTaskId;
      } catch (probeError) {
        // A failed probe cannot prove that the original POST was not accepted.
        // Preserve the ambiguous state so the durable job can recover later.
      }
    }
    throw classified;
  }
  const code = aireiterPayloadCode(payload);
  if (code !== 200) {
    const error = Object.assign(new Error('The generation request was not accepted.'), {
      status: code >= 400 && code < 600 ? code : 502,
      code: 'provider-request-failed'
    });
    if ([400, 401, 402, 404, 425, 429, 433].includes(code)) {
      error.safeToFallback = true;
      error.preSubmissionFailure = true;
    }
    else error.submissionAmbiguous = true;
    throw error;
  }
  return outTaskId;
}

async function queryAireiterTask(provider, taskId, signal) {
  const payload = await responseJson(await fetch(provider.resultEndpoint, {
    method: 'POST',
    headers: providerHeaders(provider, true),
    signal: providerSignal(signal, 30_000),
    body: JSON.stringify({ out_task_id: validVideoTaskId(taskId) })
  }), 'Generation service');
  const code = aireiterPayloadCode(payload);
  if (code !== 200) {
    throw Object.assign(new Error('The generation task could not be queried.'), {
      status: code >= 400 && code < 600 ? code : 502,
      code: 'provider-task-query-failed',
      taskId,
      providerTaskAccepted: true
    });
  }
  return payload;
}

function aireiterImageParams(provider, body) {
  const prompt = String(body.prompt || '').trim();
  const urls = Array.isArray(body.urls) ? body.urls.map(String).map((value) => value.trim()).filter(Boolean) : [];
  const ratio = String(body.aspectRatio || '').trim();
  const submittedRatio = ratio === 'auto' || /^\d+:\d+$/.test(ratio) ? ratio : '';
  const resolution = String(body.size || body.resolution || '2K').trim().toUpperCase();
  if (['nano_banana_v2', 'nano_banana_v2_plus'].includes(provider.model)) {
    if (urls.length > 8) throw aireiterLocalRejection('This route accepts at most 8 reference images.', 'too-many-references');
    return {
      prompt,
      ...(urls.length ? { image_url: urls } : {}),
      ...(submittedRatio ? { aspect_ratio: submittedRatio } : {}),
      resolution: ['1K', '2K', '4K'].includes(resolution) ? resolution : '2K'
    };
  }
  if (provider.model === 'nano_banana_pro') {
    if (urls.length > 8) throw aireiterLocalRejection('This route accepts at most 8 reference images.', 'too-many-references');
    return {
      prompt,
      // AI Reiter expects reference images as a JSON string array. Keeping
      // the values separate also preserves URL encoding for signed relays.
      ...(urls.length ? { image_url: urls } : {}),
      ...(submittedRatio ? { aspect_ratio: submittedRatio } : {}),
      resolution: ['1K', '2K', '4K'].includes(resolution) ? resolution : '2K'
    };
  }
  if (provider.model === 'gpt_image_2') {
    if (urls.length > 10) throw aireiterLocalRejection('This route accepts at most 10 reference images.', 'too-many-references');
    const customSize = /^\d{2,4}x\d{2,4}$/i.test(String(body.size || '').trim())
      ? gptImage2Size(body)
      : '';
    return {
      prompt,
      ...(urls.length ? { image_url: urls } : {}),
      ...(customSize
        ? { size: customSize }
        : {
            ...(submittedRatio ? { aspect_ratio: submittedRatio } : {}),
            resolution: ['1K', '2K', '4K'].includes(resolution) ? resolution : '2K'
          })
    };
  }
  if (provider.model === 'mj_v8_1') {
    if (urls.length) throw aireiterLocalRejection('This route does not accept reference images.', 'invalid-reference-media');
    const cleanPrompt = prompt.replace(/(?:^|\s)--ar(?:=|\s+)\S+/gi, ' ').replace(/\s{2,}/g, ' ').trim();
    return {
      prompt: /^\d+:\d+$/.test(ratio) ? `${cleanPrompt} --ar ${ratio}` : cleanPrompt,
      speed: 'fast',
      quality: resolution === '2K' ? 'hd' : 'standard'
    };
  }
  throw aireiterLocalRejection('This model is not available on the selected route.');
}

async function generateAireiterImage(provider, body, signal, hooks = {}) {
  const recovered = body && body._acceptedTask;
  const relayTokens = [];
  let requestBody = body;
  try {
    // AI Reiter fetches reference images asynchronously after submission. A
    // desktop data URL is not reachable from that service, so expose local
    // references through an owner-opaque, short-lived gateway relay and keep
    // it alive until the task has produced its result.
    if (!recovered && Array.isArray(body && body.urls)) {
      const urls = body.urls.map((value) => {
        const source = String(value || '').trim();
        if (!/^data:image\//i.test(source)) return source;
        const image = stripImageMetadata(parseImageDataUrl(source, { maxBytes: 30 * 1024 * 1024 }));
        const relay = storeAi302RelayAsset(image, { relayTtlMs: 25 * 60 * 1000 });
        relayTokens.push(relay.token);
        return relay.url;
      });
      requestBody = { ...body, urls };
    }
    const taskId = recovered && recovered.taskId
      ? validVideoTaskId(recovered.taskId)
      : await submitAireiterTask(provider, requestBody, aireiterImageParams(provider, requestBody), signal);
    try {
      if (!recovered && typeof hooks.onAccepted === 'function') {
        await hooks.onAccepted({ providerId: provider.id, taskId, pollUrl: provider.resultEndpoint });
      }
      const startedAt = Date.now();
      while (Date.now() - startedAt < 20 * 60_000) {
        const payload = await queryAireiterTask(provider, taskId, signal);
        const status = aireiterTaskStatus(payload);
        if (status === 'succeeded') {
          const mediaUrl = aireiterOutputUrl(payload);
          if (!mediaUrl) {
            throw Object.assign(new Error('The completed image task did not return a file.'), {
              code: 'provider-result-missing',
              status: 502,
              providerTaskTerminalFailure: true
            });
          }
          const buffer = validateGeneratedMediaBuffer('image', await downloadGeneratedImage(mediaUrl, signal));
          if (typeof hooks.onReady === 'function') {
            await hooks.onReady({ providerId: provider.id, taskId, mediaUrl, buffer });
          }
          return buffer;
        }
        if (TERMINAL_VIDEO_FAILURES.has(status)) {
          throw Object.assign(new Error('The image generation task failed.'), {
            code: `provider-${status}`,
            status: 502,
            providerTaskTerminalFailure: true
          });
        }
        await delayWithSignal(2_000, signal);
      }
      throw Object.assign(new Error('The image generation task timed out.'), {
        code: 'provider-timeout', status: 504
      });
    } catch (error) {
      error.taskId ||= taskId;
      error.providerTaskAccepted = true;
      throw error;
    }
  } finally {
    relayTokens.forEach((token) => deleteAi302RelayAsset(token));
  }
}

async function generateMediaWithProvider(kind, provider, body, signal, hooks = {}) {
  if (kind === 'image' && provider.protocol === 'aireiter-async') {
    return generateAireiterImage(provider, body, signal, hooks);
  }
  if (kind === 'image' && provider.protocol === 'atlas-gpt-image-2') {
    return generateAtlasGptImage(provider, body, signal, hooks);
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
    const task = requestBody && requestBody._acceptedTask;
    const taskHooks = {
      ...hooks,
      onAccepted: typeof hooks.onAccepted === 'function'
        ? (accepted) => hooks.onAccepted({ ...accepted, providerId: provider.id })
        : undefined,
      onReady: typeof hooks.onReady === 'function'
        ? (ready) => hooks.onReady({ ...ready, providerId: provider.id })
        : undefined
    };
    return task
      ? await recoverMediaBuffer(fetch, config, kind, requestBody, task, signal, undefined, taskHooks)
      : await generateMediaBuffer(fetch, config, kind, requestBody, signal, undefined, taskHooks);
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

export async function generateMedia(kind, body, signal, hooks = {}) {
  const providers = providersForRequest(kind, String(body.providerId || ''), body);
  let firstError;
  let lastError;
  for (const provider of providers) {
    try {
      return await generateMediaWithProvider(kind, provider, body, signal, hooks);
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

export async function recoverMedia(kind, body, task, signal, hooks = {}) {
  const taskProviderId = String(task && (task.providerId || task.provider_id) || '').trim().toLowerCase();
  const provider = configuredProviders().find((entry) => entry.kind === kind && entry.id === taskProviderId);
  if (!provider || !providerApiKey(provider)) {
    throw Object.assign(new Error('The accepted image task cannot be recovered on this server.'), {
      code: 'provider-task-recovery-pending',
      status: 503,
      submissionAmbiguous: true,
      providerTaskAccepted: true
    });
  }
  const taskId = String(task.providerTaskId || task.provider_task_id || '').trim();
  const resultUrl = String(task.resultUrl || task.result_url || '').trim();
  // Synchronous providers are recorded with an internal marker when their
  // response contained inline data. There is no provider task to poll in
  // that case, so do not accidentally submit the request again.
  if (/^inline:[0-9a-f-]{36}$/i.test(taskId) && !resultUrl) {
    throw Object.assign(new Error('The accepted image result is still being recovered.'), {
      code: 'provider-task-recovery-pending',
      status: 503,
      submissionAmbiguous: true,
      providerTaskAccepted: true
    });
  }
  return generateMediaWithProvider(kind, { ...provider, apiKey: providerApiKey(provider) }, {
    ...body,
    _acceptedTask: {
      taskId,
      pollUrl: task.pollUrl || task.poll_url,
      mediaUrl: resultUrl
    }
  }, signal, hooks);
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
  try {
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
          code: result.errorCode || 'video-generation-failed',
          providerTaskTerminalFailure: true
        });
      }
      await delayWithSignal(2_000, signal);
    }
    throw Object.assign(new Error('Video generation timed out.'), {
      status: 504,
      code: 'video-generation-timeout'
    });
  } catch (error) {
    // A task identity exists at this point. Never release the user's
    // reservation merely because polling or result delivery lost its reply.
    error.taskId ||= task.taskId;
    error.providerTaskAccepted = true;
    throw error;
  }
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
    const retryable = channelUnavailable || [401, 402, 425, 429].includes(response.status) || response.status >= 500;
    // A fallback is safe only when the HTTP response explicitly proves that
    // the provider rejected the request before creating a billable task.
    const safeToFallback = channelUnavailable || [401, 402, 404, 425, 429].includes(response.status);
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
      safeToFallback,
      retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(120_000, retryAfter * 1000)
        : channelUnavailable ? 500 : 0,
      preSubmissionFailure: safeToFallback,
      submissionAmbiguous: !safeToFallback && response.status >= 500
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
  const endUserId = /^u_[a-f0-9]{16,64}$/i.test(String(body && body.endUserId || '').trim())
    ? String(body.endUserId).trim().toLowerCase()
    : '';
  return {
    ...providerHeaders(provider, true),
    ...(requestId ? { 'Idempotency-Key': requestId, 'X-Request-Id': requestId } : {}),
    ...(endUserId ? { 'X-End-User-Id': endUserId } : {})
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
  return String(nestedVideoTaskValue(payload, [
    'request_id', 'requestId', 'prediction_id', 'predictionId',
    'generation_id', 'generationId', 'task_id', 'taskId', 'id'
  ]) || '').trim();
}

function providerVideoTaskStatus(payload) {
  return normalizeVideoTaskStatus(nestedVideoTaskValue(payload, [
    'task_status', 'taskStatus', 'prediction_status', 'predictionStatus',
    'task_state', 'taskState', 'status', 'state'
  ]));
}

function providerVideoResultUrl(payload) {
  const direct = nestedVideoTaskValue(payload, [
    'video_url', 'videoUrl', 'result_url', 'resultUrl', 'download_url', 'downloadUrl',
    'outputs', 'urls'
  ]);
  // `outputs` is documented as an array and some response envelopes expose
  // `urls` as an object. Do not stringify those containers into
  // "[object Object]"; let the recursive URL extractor inspect them.
  const directUrl = typeof direct === 'string' || typeof direct === 'number'
    ? String(direct).trim()
    : '';
  return (directUrl || deepVideoResultUrl(payload)).trim();
}

function deepVideoResultUrl(value, seen = new Set(), depth = 0, acceptPlainHttps = false) {
  if (!value || depth > 10 || seen.has(value)) return '';
  if (typeof value === 'string') {
    const candidate = value.trim();
    if (!/^https:\/\/\S+$/i.test(candidate)) return '';
    return acceptPlainHttps || /(?:\.mp4(?:\?|$)|\.mov(?:\?|$)|\.webm(?:\?|$)|video|download)/i.test(candidate)
      ? candidate : '';
  }
  if (typeof value !== 'object') return '';
  seen.add(value);
  const preferredKeys = [
    'video_url', 'videoUrl', 'result_url', 'resultUrl', 'download_url', 'downloadUrl',
    'outputs', 'urls', 'video', 'uri', 'url'
  ];
  for (const key of preferredKeys) {
    const found = deepVideoResultUrl(value[key], seen, depth + 1,
      key === 'outputs' || key === 'video' || key === 'video_url' || key === 'videoUrl'
        || key === 'result_url' || key === 'resultUrl' || key === 'download_url'
        || key === 'downloadUrl' || acceptPlainHttps);
    if (found) return found;
  }
  for (const child of Object.values(value)) {
    const found = deepVideoResultUrl(child, seen, depth + 1, acceptPlainHttps);
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
  const resolution = normalizeVideoResolution(body.resolution || body.size, provider.id, provider.model);
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

async function createAtlasMiniMaxH3VideoTask(provider, body, signal) {
  const input = atlasVideoTaskInput(provider, body);
  const {
    capabilities, isI2v, urls, mediaTypes, audioUrls, mode,
    resolution, duration, ratio, outputFormat
  } = input;
  const atlasKind = String(capabilities.atlasKind || 'text-to-video').trim().toLowerCase();
  const prompt = atlasKind === 'reference-to-video'
    ? seedanceReferencePrompt(body.prompt, mode, mediaTypes, audioUrls.length)
    : String(body.prompt || '').trim();
  const common = {
    model: provider.model,
    prompt,
    duration,
    resolution: atlasResolution(resolution, provider.model),
    ratio
  };
  const uploadedUrls = [];
  for (let index = 0; index < urls.length; index += 1) {
    uploadedUrls.push(await atlasMediaReference(
      provider,
      urls[index],
      mediaTypes[index] || 'image',
      signal,
      { inlineImageData: isI2v }
    ));
  }
  const uploadedAudioUrls = [];
  for (const url of audioUrls) uploadedAudioUrls.push(await atlasMediaReference(provider, url, 'audio', signal));
  const requestBody = atlasKind === 'text-to-video'
    ? common
    : isI2v
      ? {
          ...common,
          image: uploadedUrls[0],
          ...(uploadedUrls[1] ? { end_image: uploadedUrls[1] } : {})
        }
      : {
          ...common,
          refers: [
            ...uploadedUrls.map((url, index) => ({ url, type: mediaTypes[index] })),
            ...uploadedAudioUrls.map((url) => ({ url, type: 'audio' }))
          ]
        };
  const created = await responseJson(await fetch(provider.endpoint, {
    method: 'POST',
    headers: providerTaskHeaders(provider, body),
    signal: providerSignal(signal, Number(capabilities.createTimeoutMs) || 45_000),
    body: JSON.stringify(requestBody)
  }), provider.name);
  const taskId = providerVideoTaskId(created);
  if (!taskId || taskId.length > 256) {
    throw Object.assign(new Error(`${provider.name} did not return a valid prediction ID.`), {
      status: 502, code: 'provider-invalid-response', retryable: false
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

function atlasInlineImageData(asset) {
  const mime = String(asset && asset.mime || '').trim().toLowerCase();
  if (!asset || !Buffer.isBuffer(asset.buffer) || !/^image\/(?:png|jpeg|webp)$/.test(mime)) {
    throw Object.assign(new Error('The local reference image is invalid.'), {
      status: 400, code: 'invalid-reference-media', preSubmissionFailure: true
    });
  }
  return `data:${mime};base64,${asset.buffer.toString('base64')}`;
}

async function atlasMediaReference(provider, rawUrl, mediaType, signal, options = {}) {
  const url = String(rawUrl || '').trim();
  const localAsset = atlasLocalMediaAsset(url, mediaType);
  if (!localAsset) return url;
  // H3 image-to-video explicitly accepts Base64 for its first and last frame.
  // Sending the validated image inline removes an unnecessary upload request
  // that could fail before the actual video task was ever submitted.
  if (options.inlineImageData === true && mediaType === 'image') {
    return atlasInlineImageData(localAsset);
  }
  const mime = String(localAsset.mime || '').trim().toLowerCase();
  const form = new FormData();
  form.append('file', new Blob([localAsset.buffer], { type: mime }), `reference.${atlasMediaExtension(mime, mediaType)}`);
  let uploaded;
  try {
    uploaded = await responseJson(await fetch(atlasUploadMediaEndpoint(provider), {
      method: 'POST',
      headers: providerHeaders(provider),
      signal: providerSignal(signal, 180_000),
      body: form
    }), provider.name);
  } catch (error) {
    // No generation request has been made at this point. This distinction is
    // required so a failed upload releases the reservation instead of being
    // treated as an ambiguously accepted provider task.
    error.preSubmissionFailure = true;
    error.submissionAmbiguous = false;
    throw error;
  }
  const uploadedUrl = String(nestedVideoTaskValue(uploaded, [
    'download_url', 'downloadUrl', 'file_url', 'fileUrl',
    'media_url', 'mediaUrl', 'url'
  ]) || '').trim();
  if (!/^https:\/\/\S+$/i.test(uploadedUrl)) {
    throw Object.assign(new Error(`${provider.name} did not return a valid uploaded media URL.`), {
      status: 502,
      code: 'provider-invalid-response',
      retryable: false,
      preSubmissionFailure: true,
      submissionAmbiguous: false
    });
  }
  return uploadedUrl;
}

function atlasResolution(value, model = '') {
  const normalizedValue = String(value || '720P').trim();
  // MiniMax H3's Atlas schema is case-sensitive and documents the values as
  // 768P and 2K. Seedance's Atlas adapter historically uses lowercase values,
  // so keep that transport contract unchanged for the other Atlas models.
  if (/^minimax\/h3\//i.test(String(model || '').trim())) {
    return normalizedValue.toUpperCase();
  }
  const normalized = normalizedValue.toLowerCase();
  return normalized === '4k' ? '4k'
    : normalized.replace(/\s*&\s*/g, ' & ');
}

function atlasVideoTaskInput(provider, body) {
  const capabilities = provider.capabilities && typeof provider.capabilities === 'object'
    ? provider.capabilities
    : {};
  const atlasKind = String(capabilities.atlasKind || '').trim().toLowerCase();
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
  if (atlasKind === 'text-to-video') {
    if (urls.length || audioUrls.length) {
      throw Object.assign(new Error(`${provider.name} text-to-video mode does not accept reference files.`), {
        status: 400, code: 'invalid-reference-media'
      });
    }
    mode = 'text';
    modeDefinition = Array.isArray(capabilities.videoModes)
      ? capabilities.videoModes.find((entry) => entry && entry.id === mode) || {}
      : {};
  } else if (isI2v) {
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
  const resolution = normalizeVideoResolution(body.resolution || body.size, provider.id, provider.model);
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

function aireiterVideoReferences(body) {
  const urls = Array.isArray(body.urls) ? body.urls.map(String).map((value) => value.trim()).filter(Boolean) : [];
  const mediaTypes = Array.isArray(body.referenceMediaTypes)
    ? body.referenceMediaTypes.slice(0, urls.length).map((value) => String(value || 'image').trim().toLowerCase())
    : urls.map(() => 'image');
  const images = [];
  const videos = [];
  urls.forEach((url, index) => {
    const type = mediaTypes[index] === 'video' ? 'video' : 'image';
    const relayed = seedanceRelayMediaUrl(url, type);
    if (type === 'video') videos.push(relayed);
    else images.push(relayed);
  });
  const audios = (Array.isArray(body.referenceAudioUrls) ? body.referenceAudioUrls : [])
    .map(String).map((value) => value.trim()).filter((value) => /^https:\/\//i.test(value));
  return { images, videos, audios };
}

function aireiterVideoParams(provider, body) {
  const prompt = String(body.prompt || '').trim();
  const mode = String(body.videoMode || '').trim().toLowerCase();
  const ratio = String(body.aspectRatio || '').trim();
  const duration = Number(body.duration);
  const resolution = String(body.resolution || body.size || '').trim().toLowerCase();
  const generateAudio = body.generateAudio !== false;
  const { images, videos, audios } = aireiterVideoReferences(body);
  const referenceCount = images.length + videos.length + audios.length;
  const common = {
    prompt,
    video_length: Number.isInteger(duration) ? duration : 5,
    ...(ratio && ratio !== 'adaptive' ? { aspect_ratio: ratio } : {})
  };

  if (provider.model === 'minimax_h3') {
    if (!['first-frame', 'first-last-frame', 'omni'].includes(mode)) {
      throw aireiterLocalRejection(
        'MiniMax H3 requires a first frame, first and last frames, or reference assets.',
        'invalid-video-mode'
      );
    }
    if (!referenceCount) {
      throw aireiterLocalRejection('This video mode requires reference media.', 'reference-required');
    }
    if (mode === 'first-frame' && (images.length !== 1 || videos.length || audios.length)) {
      throw aireiterLocalRejection(
        'MiniMax H3 first-frame mode requires exactly one image reference.',
        'invalid-reference-media'
      );
    }
    if (mode === 'first-last-frame' && (images.length !== 2 || videos.length || audios.length)) {
      throw aireiterLocalRejection(
        'MiniMax H3 first-last-frame mode requires exactly two image references.',
        'invalid-reference-media'
      );
    }
    if (mode === 'omni' && !images.length && !videos.length && !audios.length) {
      throw aireiterLocalRejection('MiniMax H3 reference mode requires at least one reference asset.', 'reference-required');
    }
    if (mode === 'omni' && images.length > 9) {
      throw aireiterLocalRejection('MiniMax H3 accepts at most 9 reference images.', 'too-many-references');
    }
    if (mode === 'omni' && videos.length > 1) {
      throw aireiterLocalRejection('MiniMax H3 accepts at most 1 reference video.', 'too-many-reference-videos');
    }
    if (mode === 'omni' && audios.length > 3) {
      throw aireiterLocalRejection('MiniMax H3 accepts at most 3 reference audio files.', 'too-many-reference-audios');
    }
    return {
      prompt,
      video_length: common.video_length,
      type: mode === 'omni' ? 'all_reference' : 'first_last_frame',
      quality: resolution === '2k' ? '2k' : '768p',
      ...(mode === 'omni' && common.aspect_ratio ? { aspect_ratio: common.aspect_ratio } : {}),
      ...(images.length ? { image_url: images } : {}),
      ...(videos.length ? { video_url: videos } : {}),
      ...(audios.length ? { audio_url: audios } : {})
    };
  }
  if (provider.model === 'seedance2' || provider.model === 'seedance2_5') {
    if (!images.length && !videos.length) throw aireiterLocalRejection('Seedance requires reference media.', 'reference-required');
    if (provider.model === 'seedance2' && audios.length) {
      throw aireiterLocalRejection('This route does not accept reference audio.', 'invalid-reference-media');
    }
    if (['first-frame', 'first-last-frame'].includes(mode) && videos.length) {
      throw aireiterLocalRejection('Frame generation accepts image references only.', 'invalid-reference-media');
    }
    const firstLast = mode === 'first-last-frame';
    return {
      ...common,
      type: firstLast ? 'first_last_frame' : 'all_reference',
      resolution: ['480p', '720p', '1080p'].includes(resolution) ? resolution : '720p',
      ...(images.length ? { image_url: firstLast ? [images[0]] : images } : {}),
      ...(firstLast && images[1] ? { end_image_url: images[1] } : {}),
      ...(videos.length ? { video_url: videos } : {}),
      ...(provider.model === 'seedance2_5' && audios.length ? { audio_url: audios } : {}),
      generate_audio: generateAudio,
      ...(provider.model === 'seedance2_5'
        ? { output_format: ['mp4', 'mov'].includes(String(body.outputFormat || '').toLowerCase()) ? String(body.outputFormat).toLowerCase() : 'mp4' }
        : {})
    };
  }
  if (provider.model === 'kling_3_0') {
    if (images.length !== 1 || videos.length || audios.length) {
      throw aireiterLocalRejection('Kling V3 requires one image reference.', 'invalid-reference-media');
    }
    return {
      ...common,
      image_url: images[0],
      resolution: resolution === '1080p' ? '1080p' : '720p',
      generate_audio: generateAudio
    };
  }
  if (provider.model === 'kling_v3_omni') {
    if (!images.length && !videos.length) throw aireiterLocalRejection('Kling O3 requires reference media.', 'reference-required');
    const firstLast = mode === 'first-last-frame';
    if (firstLast && images.length < 2) {
      throw aireiterLocalRejection('First/last frame mode requires two images.', 'reference-required');
    }
    return {
      ...common,
      type: firstLast ? 'first_last_frame' : 'all_reference',
      resolution: resolution === '1080p' ? '1080p' : '720p',
      ...(images.length ? { image_url: firstLast ? images.slice(0, 2) : images } : {}),
      ...(videos.length ? { video_url: videos } : {}),
      generate_audio: generateAudio
    };
  }
  throw aireiterLocalRejection('This video model is not available on the selected route.');
}

async function createAireiterVideoTask(provider, body, signal) {
  const taskId = await submitAireiterTask(provider, body, aireiterVideoParams(provider, body), signal);
  return { providerId: provider.id, taskId };
}

async function createVideoTaskWithProvider(provider, body, signal) {
  try {
    if (provider.protocol === 'aireiter-async') return await createAireiterVideoTask(provider, body, signal);
    if (provider.protocol === 'minimax-video-v2') return await createMiniMaxVideoTask(provider, body, signal);
    if (provider.protocol === 'atlas-minimax-h3-video') return await createAtlasMiniMaxH3VideoTask(provider, body, signal);
    if (provider.protocol === 'seedance-video-v3') return await createSeedanceVideoTask(provider, body, signal);
    if (provider.protocol === 'atlas-seedance-video') return await createAtlasSeedanceVideoTask(provider, body, signal);
    if (['jimeng-video-v30', 'jimeng-video-v30-pro'].includes(provider.protocol)) {
      return await createJimengVideoTask(provider, body, signal);
    }
    if (provider.protocol === 'kling-v3-image-to-video') return await createKlingV3VideoTask(provider, body, signal);
    if (provider.protocol === 'kling-o3-omni') return await createKlingO3VideoTask(provider, body, signal);
    throw Object.assign(new Error('The selected video provider does not support asynchronous tasks.'), {
      status: 400,
      code: 'async-video-not-supported'
    });
  } catch (error) {
    if (String(error && error.code || '') === 'provider-invalid-response'
        && error.preSubmissionFailure !== true) {
      error.submissionAmbiguous = true;
    }
    if (error.preSubmissionFailure !== true
        && (isTimeoutError(error) || String(error && error.name || '') === 'TypeError')) {
      error.submissionAmbiguous = true;
    }
    throw error;
  }
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

async function pollAtlasMiniMaxH3VideoTask(provider, taskId, signal) {
  const normalizedTaskId = validVideoTaskId(taskId);
  const result = await responseJson(await fetch(
    `${provider.resultEndpoint}/${encodeURIComponent(normalizedTaskId)}`,
    { headers: providerHeaders(provider), signal: providerSignal(signal, 30_000) }
  ), provider.name);
  const status = providerVideoTaskStatus(result);
  if (status === 'succeeded') {
    const resultUrl = providerVideoResultUrl(result);
    const usage = miniMaxVideoUsage(result);
    const moderation = nestedVideoTaskValue(result, ['has_nsfw_contents', 'hasNsfwContents']);
    if (!resultUrl && Array.isArray(moderation) && moderation.some(Boolean)) {
      return {
        status: 'failed',
        errorCode: 'reference-policy-rejected',
        errorMessage: 'The request could not be completed because the content did not pass the safety review.'
      };
    }
    return resultUrl
      ? { status, resultUrl, ...(usage ? { usage } : {}) }
      : { status: 'running' };
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

async function pollAireiterVideoTask(provider, taskId, signal) {
  const payload = await queryAireiterTask(provider, taskId, signal);
  const status = aireiterTaskStatus(payload);
  if (status === 'succeeded') {
    const resultUrl = aireiterOutputUrl(payload);
    return resultUrl
      ? { status, resultUrl }
      : {
          status: 'failed',
          errorCode: 'provider-result-missing',
          errorMessage: 'The completed video task did not return a file.'
        };
  }
  if (TERMINAL_VIDEO_FAILURES.has(status)) {
    return {
      status,
      errorCode: `provider-${status}`,
      errorMessage: 'The video generation task failed.'
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
  const routed = parseRoutedProviderTaskId(String(providerId || ''), taskId);
  const provider = providerFor('video', routed.providerId);
  if (provider.protocol === 'aireiter-async') return pollAireiterVideoTask(provider, routed.taskId, signal);
  if (provider.protocol === 'minimax-video-v2') return pollMiniMaxVideoTask(provider, routed.taskId, signal);
  if (provider.protocol === 'atlas-minimax-h3-video') return pollAtlasMiniMaxH3VideoTask(provider, routed.taskId, signal);
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
  const requestedProviderId = String(body.providerId || '').trim().toLowerCase();
  const requestedModel = String(body.model || '').trim();
  if (requestedModel.toLowerCase() === 'gemini-3.7-flash') {
    throw Object.assign(new Error('This chat model has been retired. Please select an available model.'), {
      code: 'model-retired',
      status: 400
    });
  }
  const configured = configuredProviders().filter((entry) => entry.kind === 'chat');
  const requestedProvider = configured.find((entry) => entry.id === requestedProviderId);
  const modelMatches = (provider, model = requestedModel) => {
    const normalizedModel = String(model || '').trim().toLowerCase();
    // A missing model is an older-client request, not a reason to remove the
    // selected route. Once a logical model is resolved, fallbacks still need
    // to advertise that same model explicitly.
    return provider && (!normalizedModel || provider.models.some((entry) => (
      String(entry).trim().toLowerCase() === normalizedModel
    )));
  };
  // A missing provider ID is an older-client request. Resolve it to the first
  // configured public model, while preserving an explicitly selected model.
  const matchingProvider = configured.find((entry) => (
    !entry.hidden && providerApiKey(entry) && modelMatches(entry)
  )) || configured.find((entry) => providerApiKey(entry) && modelMatches(entry));
  const selected = requestedProvider && requestedModel && !modelMatches(requestedProvider)
    ? matchingProvider || requestedProvider
    : requestedProvider || matchingProvider || configured[0];
  if (!selected) {
    throw Object.assign(new Error('No chat provider is configured.'), { code: 'provider-not-configured' });
  }
  const logicalModel = selected.models.find((entry) => (
    String(entry).trim().toLowerCase() === requestedModel.toLowerCase()
  )) || selected.models[0] || requestedModel;
  const request = {
    prompt: body.prompt,
    messages: body.messages,
    operationId: String(body.operationId || '').trim().slice(0, 160),
    endUserId: String(body.endUserId || '').trim().slice(0, 80)
  };
  const byId = new Map(configured.map((entry) => [entry.id, entry]));
  const candidateIds = orderMixedRouteIds(
    [selected.id, ...(selected.fallbackProviderIds || [])],
    byId,
    selected,
    body
  );
  const candidates = candidateIds
    .map((id) => byId.get(id))
    .filter((entry, index, list) => entry && providerApiKey(entry)
      && (entry.id === selected.id || modelMatches(entry, logicalModel))
      && list.findIndex((candidate) => candidate && candidate.id === entry.id) === index);
  let lastError;
  for (const candidate of candidates) {
    const provider = { ...candidate, apiKey: providerApiKey(candidate) };
    const upstreamModel = provider.upstreamModels && Object.entries(provider.upstreamModels).find(([logical]) => (
      String(logical).trim().toLowerCase() === String(logicalModel).trim().toLowerCase()
    ));
    const model = upstreamModel ? upstreamModel[1] : logicalModel;
    const requestWithModel = (chatModel) => requestChat(fetch, {
      apiKey: provider.apiKey,
      chatEndpoint: provider.endpoint,
      chatProviderName: provider.name,
      chatModel,
      operationId: request.operationId,
      endUserId: request.endUserId,
      returnUsage: true
    }, request, signal);
    try {
      try {
        return await requestWithModel(model || requestedModel);
      } catch (error) {
        const status = Number(error && error.status);
        const message = String(error && error.message || '');
        const modelRejected = [400, 404].includes(status)
          && /model|not found|unsupported|does not exist|invalid/i.test(message);
        // A logical/upstream alias mismatch is an explicit pre-accept rejection.
        if (!modelRejected) throw error;
        if (!logicalModel || String(model).trim() === String(logicalModel).trim()) {
          error.preSubmissionFailure = true;
          error.safeToFallback = true;
          throw error;
        }
        try {
          return await requestWithModel(logicalModel);
        } catch (aliasError) {
          const aliasStatus = Number(aliasError && aliasError.status);
          const aliasMessage = String(aliasError && aliasError.message || '');
          if ([400, 404].includes(aliasStatus)
              && /model|not found|unsupported|does not exist|invalid/i.test(aliasMessage)) {
            aliasError.preSubmissionFailure = true;
            aliasError.safeToFallback = true;
          }
          throw aliasError;
        }
      }
    } catch (error) {
      lastError = error;
      if (signal && signal.aborted || !shouldTryProviderFallback(error)) throw error;
    }
  }
  throw lastError || Object.assign(new Error('No chat route is available for the selected model.'), {
    code: 'provider-not-configured'
  });
}

export async function models(providerId) {
  const provider = providerFor('chat', String(providerId || ''));
  const result = await discoverChatModels(fetch, provider.endpoint, provider.apiKey);
  return { ...result, providerId: provider.id };
}
