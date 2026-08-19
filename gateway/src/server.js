import http from 'node:http';
import crypto from 'node:crypto';
import { authenticate } from './auth.js';
import { publicGatewayError } from './public-errors.js';
import {
  appendVideoUploadChunk,
  appendAudioUploadChunk,
  consumeVideoUpload,
  consumeAudioUpload,
  createVideoUploadSession,
  createAudioUploadSession,
  createThreeDTask,
  createVideoUpscaleTask,
  downloadThreeDModel,
  downloadVideoUpscaleResult,
  getAi302RelayAsset,
  getThreeDStatus,
  getVideoUpscaleStatus,
  removeBackground,
  storeAi302RelayAsset
} from './ai302-tools.js';
import {
  cleanupImageObjects,
  downloadAi302ImageResult,
  eraseImageObjects,
  generativeUpscaleImage,
  pollKlingImageExpand,
  pollSeedEditImage,
  pollTopazImageTool,
  pollQwenImageEdit,
  pollQwenImageLayered,
  submitKlingImageExpand,
  submitSeedEditImage,
  submitTopazImageTool,
  submitQwenImageEdit,
  submitQwenImageLayered,
  superUpscaleImage,
  uncropImage
} from './ai302-image-tools.js';
import {
  catalogVersion,
  chat,
  createVideoTask,
  generateLegacyVideo,
  generateMedia,
  imageStyles,
  models,
  pollVideoTask,
  providerCapabilities,
  providerPromptLimit,
  publicProviderConfig
} from './providers.js';
import {
  getCanvasUsage,
  getUsageAccount,
  getUsageSummary,
  redeemUsageCode,
  reserveUsage,
  reserveToolUsage,
  settleToolUsage,
  touchToolUsage,
  settleUsage,
  tagUsageCanvas,
  quoteUsageForUser
} from './usage.js';
import {
  attachVideoTask,
  finalizeVideoJob,
  getVideoDownload,
  getVideoJob,
  startVideoJob,
  startVideoJobWorker
} from './video-jobs.js';

const port = Math.max(1, Number(process.env.PORT) || 3000);
const maxBodyBytes = 70 * 1024 * 1024;
const rateBuckets = new Map();
const imageOperationCache = new Map();
const referenceVideoRelays = new Map();
const referenceAudioRelays = new Map();
const TOPAZ_IMAGE_TOOL_IDS = new Set([
  'topaz-image-sharpen',
  'topaz-image-sharpen-gen',
  'topaz-image-enhance',
  'topaz-image-enhance-gen',
  'topaz-image-denoise',
  'topaz-image-restore',
  'topaz-image-lighting'
]);
const TOPAZ_IMAGE_MAX_RETAIL_CREDITS = 422;
const allowedOrigins = new Set(String(process.env.ALLOWED_ORIGINS || '').split(',').map((v) => v.trim()).filter(Boolean));
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\b(?:ghp|github_pat|glpat|xox[baprs])-[_A-Za-z0-9-]{16,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b(?:postgres|postgresql|mysql):\/\/[^\s:/]+:[^\s@]+@/i,
  /\bservice_role\b/i
];
const imageSizes = new Set(['1K', '2K', '4K', 'original']);
const imageRatios = new Set([
  'auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3',
  '5:4', '4:5', '21:9', '16:10', '10:16', '2:1', '1:2', '9:21',
  '3:1', '1:3', '4:1', '1:4', '7:5', '5:7', '8:5', '5:8'
]);
const defaultVideoRatios = new Set(['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']);
const defaultVideoResolutions = new Set(['768P', '2K']);

// Paid 302 tools are staged independently from the desktop release. Missing
// or malformed flags must never expose a paid upstream route.
const AI302_FLAGS = Object.freeze({
  background: 'ENABLE_302_BACKGROUND_REMOVE',
  image: 'ENABLE_302_IMAGE_TOOLS',
  hunyuan3d: 'ENABLE_302_HUNYUAN3D',
  hyper3d: 'ENABLE_302_HYPER3D',
  tripo3d: 'ENABLE_302_TRIPO3D',
  topaz: 'ENABLE_302_TOPAZ'
});

function ai302Enabled(flag) {
  const configured = String(process.env[flag] || '').trim().toLowerCase();
  if (configured === 'false') return false;
  if (configured === 'true') return true;
  return Boolean(String(process.env.AI302_KEY || process.env.AI_302_API_KEY || '').trim());
}

function disabledTool(response) {
  return send(response, 503, {
    code: 'tool-disabled',
    message: 'This Butler tool is not enabled on the server.'
  });
}

function invalidOption(code, message) {
  return Object.assign(new Error(message), { status: 400, code });
}

function imageDimensionsWithinCapabilities(size, capabilities = {}) {
  if (capabilities.arbitrarySizes !== true) return false;
  const match = /^([1-9]\d{0,3})x([1-9]\d{0,3})$/i.exec(String(size || '').trim());
  if (!match) return false;
  const width = Number(match[1]);
  const height = Number(match[2]);
  const maxEdge = Math.max(1, Math.min(3840, Number(capabilities.maxSizeEdge) || 3840));
  const maxPixels = Math.max(1, Math.min(8_300_000, Number(capabilities.maxSizePixels) || 8_300_000));
  return width % 16 === 0 && height % 16 === 0
    && width <= maxEdge && height <= maxEdge && width * height <= maxPixels;
}

function normalizeImageSize(value) {
  const text = String(value || '').trim();
  if (/^(?:1|2|4)k$/i.test(text)) return text.toUpperCase();
  if (/^(?:default|adaptive|original|auto)$/i.test(text)) {
    const lower = text.toLowerCase();
    return lower === 'default' ? 'Default' : lower;
  }
  const match = /^(\d{1,4})\s*[x×]\s*(\d{1,4})$/i.exec(text);
  return match ? `${Number(match[1])}x${Number(match[2])}` : text;
}

function imageResolutionPresetForPixels(value, supportedSizes) {
  const match = /^(\d{1,5})x(\d{1,5})$/i.exec(String(value || '').trim());
  if (!match) return '';
  const longestEdge = Math.max(Number(match[1]), Number(match[2]));
  const preferred = longestEdge >= 3072 ? '4K' : longestEdge >= 1536 ? '2K' : '1K';
  if (supportedSizes.has(preferred)) return preferred;
  const ranked = [...supportedSizes]
    .filter((entry) => /^(?:1|2|4)K$/.test(entry))
    .sort((left, right) => Number(left[0]) - Number(right[0]));
  if (!ranked.length) return '';
  return ranked.reduce((nearest, candidate) => (
    Math.abs(Number(candidate[0]) - Number(preferred[0])) < Math.abs(Number(nearest[0]) - Number(preferred[0]))
      ? candidate
      : nearest
  ));
}

function supportsImageAspectRatio(value, capabilities = {}) {
  const normalized = String(value || '').trim();
  if (normalized === 'auto') return imageRatios.has('auto') || capabilities.arbitraryRatios === true;
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(normalized);
  if (!match) return imageRatios.has(normalized);
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false;
  const ratio = width / height;
  const minimum = Number(capabilities.minimumAspectRatio);
  const maximum = Number(capabilities.maximumAspectRatio);
  if (Number.isFinite(minimum) && ratio < minimum) return false;
  if (Number.isFinite(maximum) && ratio > maximum) return false;
  if (capabilities.arbitraryRatios !== true) return imageRatios.has(normalized);
  return ratio >= 1 / 16 && ratio <= 16;
}

function base64DecodedBytes(value) {
  const payload = String(value || '');
  if (!payload) return 0;
  const padding = payload.endsWith('==') ? 2 : (payload.endsWith('=') ? 1 : 0);
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

function send(response, status, payload, headers = {}) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload));
  response.writeHead(status, {
    'Content-Type': Buffer.isBuffer(payload) ? 'application/octet-stream' : 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    ...headers
  });
  response.end(body);
}

function materializeReferenceVideo(uploadId, userId) {
  const key = `${String(userId || '')}:${String(uploadId || '')}`;
  const cached = referenceVideoRelays.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  const asset = consumeVideoUpload({ uploadId, userId });
  const relay = storeAi302RelayAsset(asset, { relayTtlMs: 2 * 60 * 60 * 1000 });
  referenceVideoRelays.set(key, { url: relay.url, expiresAt: Date.now() + 2 * 60 * 60 * 1000 });
  return relay.url;
}

function materializeReferenceAudio(uploadId, userId) {
  const key = `${String(userId || '')}:${String(uploadId || '')}`;
  const cached = referenceAudioRelays.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  const asset = consumeAudioUpload({ uploadId, userId });
  const relay = storeAi302RelayAsset(asset, { relayTtlMs: 2 * 60 * 60 * 1000 });
  referenceAudioRelays.set(key, { url: relay.url, expiresAt: Date.now() + 2 * 60 * 60 * 1000 });
  return relay.url;
}

function materializeVideoReferences(body, userId) {
  const mediaTypes = Array.isArray(body.referenceMediaTypes)
    ? body.referenceMediaTypes.slice(0, 50).map((value) => String(value || '').trim().toLowerCase())
    : [];
  const imageUrls = Array.isArray(body.urls) ? [...body.urls] : [];
  const uploadIds = Array.isArray(body.referenceVideoUploadIds) ? [...body.referenceVideoUploadIds] : [];
  const audioUploadIds = Array.isArray(body.referenceAudioUploadIds) ? [...body.referenceAudioUploadIds] : [];
  if (!mediaTypes.length && !Array.isArray(body.referenceAudioUploadIds)) return body;
  const invalidReferenceInput = () => Object.assign(
    new Error('The reference media selection is incomplete or invalid.'),
    { status: 400, code: 'invalid-reference-media' }
  );
  if (mediaTypes.some((mediaType) => !['image', 'video'].includes(mediaType))) {
    throw invalidReferenceInput();
  }
  const imageCount = mediaTypes.filter((mediaType) => mediaType === 'image').length;
  const videoCount = mediaTypes.length - imageCount;
  if (imageUrls.length !== imageCount || uploadIds.length !== videoCount) {
    throw invalidReferenceInput();
  }
  const createdRelayKeys = [];
  const urls = mediaTypes.map((mediaType) => {
    if (mediaType !== 'video') return imageUrls.shift();
    const uploadId = String(uploadIds.shift() || '');
    const key = `${String(userId || '')}:${uploadId}`;
    const url = materializeReferenceVideo(uploadId, userId);
    createdRelayKeys.push(key);
    return url;
  });
  const referenceAudioUrls = [
    ...(Array.isArray(body.referenceAudioUrls)
      ? body.referenceAudioUrls.filter((value) => /^https:\/\//i.test(String(value || ''))).slice(0, 10)
      : []),
    ...audioUploadIds.map((uploadId) => materializeReferenceAudio(String(uploadId || ''), userId))
  ];
  return {
    ...body,
    urls,
    referenceMediaTypes: mediaTypes,
    referenceVideoRelayKeys: createdRelayKeys,
    referenceAudioUrls,
    // The upload IDs have now been consumed into owner-bound relay URLs. Do
    // not retain them or validation/accounting will count each audio twice.
    referenceVideoUploadIds: [],
    referenceAudioUploadIds: []
  };
}

function sendRelayAsset(request, response, asset) {
  const total = asset.buffer.length;
  const rangeHeader = String(request.headers.range || '').trim();
  let start = 0;
  let end = total - 1;
  let status = 200;
  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    if (!match || (!match[1] && !match[2])) {
      response.writeHead(416, { 'Content-Range': `bytes */${total}`, 'Content-Length': '0' });
      return response.end();
    }
    if (!match[1]) {
      const suffixLength = Number(match[2]);
      if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
        response.writeHead(416, { 'Content-Range': `bytes */${total}`, 'Content-Length': '0' });
        return response.end();
      }
      start = Math.max(0, total - suffixLength);
    } else {
      start = Number(match[1]);
      end = match[2] ? Number(match[2]) : end;
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= total || end < start) {
      response.writeHead(416, { 'Content-Range': `bytes */${total}`, 'Content-Length': '0' });
      return response.end();
    }
    end = Math.min(end, total - 1);
    status = 206;
  }
  const length = end - start + 1;
  response.writeHead(status, {
    'Content-Type': asset.mime,
    'Content-Length': length,
    'Content-Disposition': `inline; filename="input.${asset.extension || 'bin'}"`,
    'Accept-Ranges': 'bytes',
    ...(status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${total}` } : {}),
    'Cache-Control': 'private, no-store',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY'
  });
  if (request.method === 'HEAD') return response.end();
  return response.end(asset.buffer.subarray(start, end + 1));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw Object.assign(new Error('Request body is too large.'), { status: 413, code: 'body-too-large' });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch (error) { throw Object.assign(new Error('Request body must be valid JSON.'), { status: 400, code: 'invalid-json' }); }
}

function rateAllowed(userId, ip, bucketName = 'default', maximum = null) {
  const key = `${userId}:${ip}:${bucketName}`;
  const now = Date.now();
  const current = rateBuckets.get(key);
  if (!current || current.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  current.count += 1;
  return current.count <= Math.max(1, Number(maximum) || Number(process.env.REQUESTS_PER_MINUTE) || 30);
}

function validateBody(body, kind) {
  const prompt = String(body.prompt || '').trim();
  const providerId = String(body.providerId || '').trim().toLowerCase().slice(0, 64);
  const capabilities = providerCapabilities(kind, providerId) || {};
  const isAtlasVideo = kind === 'video'
    && (String(capabilities.atlasKind || '').length > 0 || capabilities.atlasRouted === true);
  const isSeedance25 = kind === 'video'
    && (providerId === 'video-3' || /seedance-2[.-]5/i.test(String(capabilities.model || body.model || '')));
  const maxPromptLength = providerPromptLimit(
    kind,
    providerId,
    Array.isArray(body.urls) && body.urls.length > 0
  );
  if (!prompt || prompt.length > maxPromptLength) {
    throw Object.assign(new Error(`Prompt must contain 1 to ${maxPromptLength} characters.`), { status: 400, code: 'invalid-prompt' });
  }
  if (secretPatterns.some((pattern) => pattern.test(prompt))) {
    throw Object.assign(new Error('The request appears to contain a private credential.'), { status: 400, code: 'privacy-blocked' });
  }
  const messages = kind === 'chat' && Array.isArray(body.messages)
    ? body.messages.slice(-40).map((m) => ({
        role: ['assistant', 'system'].includes(m.role) ? m.role : 'user',
        content: String(m.content || '').slice(0, 24_000),
        images: Array.isArray(m.images) ? m.images.slice(0, 4).filter((url) => /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(String(url))) : []
      }))
    : [];
  if (messages.some((message) => secretPatterns.some((pattern) => pattern.test(message.content)))) {
    throw Object.assign(new Error('The conversation appears to contain a private credential.'), { status: 400, code: 'privacy-blocked' });
  }
  const configuredReferenceLimit = Number(capabilities.maxReferenceImages);
  const atlasReferenceCap = isAtlasVideo && isSeedance25 ? 50 : 30;
  let maxReferenceImages = Number.isInteger(configuredReferenceLimit) && configuredReferenceLimit >= 0
    ? Math.min(isAtlasVideo ? atlasReferenceCap : 14, configuredReferenceLimit)
    : (isAtlasVideo ? atlasReferenceCap : 14);
  const configuredReferenceMinimum = Number(capabilities.minReferenceImages);
  let minReferenceImages = Number.isInteger(configuredReferenceMinimum) && configuredReferenceMinimum > 0
    ? Math.min(maxReferenceImages, configuredReferenceMinimum)
    : 0;
  const requestedVideoMode = String(body.videoMode || '').trim().toLowerCase();
  let videoMode = '';
  let selectedVideoMode = null;
  const submittedUrlCount = Array.isArray(body.urls) ? body.urls.length : 0;
  const submittedMediaTypes = Array.isArray(body.referenceMediaTypes)
    ? body.referenceMediaTypes.map((value) => String(value || '').trim().toLowerCase())
    : [];
  const submittedAudioReferenceCount = (Array.isArray(body.referenceAudioUrls)
    ? body.referenceAudioUrls.length : 0)
    + (Array.isArray(body.referenceAudioUploadIds) ? body.referenceAudioUploadIds.length : 0);
  const routedReferenceModes = new Set(['omni', 'video-reference', 'video-edit', 'video-extend']);
  const isAtlasReferenceProvider = isAtlasVideo && (
    String(capabilities.atlasKind || '') === 'reference-to-video'
    || (capabilities.atlasRouted === true && (
      routedReferenceModes.has(requestedVideoMode)
      || submittedMediaTypes.includes('video')
      || submittedAudioReferenceCount > 0
    ))
  );
  if (kind === 'video' && Array.isArray(capabilities.videoModes)) {
    const fallbackReferenceCount = submittedUrlCount;
    const availableMode = (...ids) => ids.find((id) => capabilities.videoModes.some((entry) => entry && entry.id === id)) || '';
    const fallbackMode = submittedMediaTypes.includes('video') || submittedAudioReferenceCount > 0
      ? availableMode('omni', 'video-reference', 'video-edit', 'video-extend')
      : fallbackReferenceCount > 2
        ? availableMode('omni', 'video-reference')
        : fallbackReferenceCount === 2
          ? availableMode('first-last-frame', 'omni')
          : fallbackReferenceCount === 1
            ? availableMode('first-frame', 'omni')
            : availableMode('text');
    videoMode = requestedVideoMode || fallbackMode;
    selectedVideoMode = capabilities.videoModes.find((entry) => entry && entry.id === videoMode) || null;
    if (!selectedVideoMode) {
      throw invalidOption('invalid-video-mode', 'The selected video generation mode is not supported.');
    }
    minReferenceImages = Math.max(0, Math.min(isAtlasVideo ? atlasReferenceCap : 14, Number(selectedVideoMode.minReferences) || 0));
    maxReferenceImages = Math.max(minReferenceImages, Math.min(isAtlasVideo ? atlasReferenceCap : 14, Number(selectedVideoMode.maxReferences) || 0));
  }
  const submittedReferenceCount = submittedUrlCount
    + (isAtlasReferenceProvider ? submittedAudioReferenceCount : 0);
  if (submittedReferenceCount < minReferenceImages) {
    throw invalidOption('reference-required', `The selected model requires at least ${minReferenceImages} reference image${minReferenceImages === 1 ? '' : 's'}.`);
  }
  if (submittedReferenceCount > maxReferenceImages) {
    throw invalidOption('too-many-references', `The selected model accepts at most ${maxReferenceImages} reference images.`);
  }
  const urls = Array.isArray(body.urls) ? body.urls.slice(0, maxReferenceImages) : [];
  const referenceMediaTypes = Array.isArray(body.referenceMediaTypes)
    ? body.referenceMediaTypes.slice(0, urls.length).map((value) => String(value || '').trim().toLowerCase())
    : urls.map(() => 'image');
  const allowedReferenceMediaTypes = new Set(
    selectedVideoMode && Array.isArray(selectedVideoMode.mediaTypes) && selectedVideoMode.mediaTypes.length
      ? selectedVideoMode.mediaTypes.map((value) => String(value || '').trim().toLowerCase())
      : ['image']
  );
  if (referenceMediaTypes.some((mediaType) => !allowedReferenceMediaTypes.has(mediaType))) {
    throw invalidOption('invalid-reference-media', 'The selected video mode does not accept reference videos.');
  }
  if (submittedAudioReferenceCount > 0 && !allowedReferenceMediaTypes.has('audio')) {
    throw invalidOption('invalid-reference-media', 'The selected video mode does not accept reference audio.');
  }
  const referenceVideoCount = referenceMediaTypes.filter((mediaType) => mediaType === 'video').length;
  const referenceImageCount = referenceMediaTypes.filter((mediaType) => mediaType === 'image').length;
  const maximumReferenceVideos = Math.max(0, Number(selectedVideoMode && selectedVideoMode.maxReferenceVideos) || 0);
  if (referenceVideoCount > maximumReferenceVideos) {
    throw invalidOption('too-many-reference-videos', `The selected model accepts at most ${maximumReferenceVideos} reference videos.`);
  }
  if (referenceVideoCount > 0) {
    const maximumImagesWithVideo = Number(selectedVideoMode && selectedVideoMode.maxReferenceImagesWithVideo);
    const referenceImageCount = referenceMediaTypes.filter((mediaType) => mediaType === 'image').length;
    if (Number.isInteger(maximumImagesWithVideo) && maximumImagesWithVideo >= 0
      && referenceImageCount > maximumImagesWithVideo) {
      throw invalidOption(
        'too-many-references',
        `The selected model accepts at most ${maximumImagesWithVideo} reference images with a reference video.`
      );
    }
  }
  if (isAtlasVideo) {
    const maximumReferenceImages = Math.max(0, Number(capabilities.maxReferenceImages) || 0);
    const maximumTotalReferences = Math.max(0, Number(capabilities.maxTotalReferences) || maxReferenceImages);
    if (maximumReferenceImages && referenceImageCount > maximumReferenceImages) {
      throw invalidOption('too-many-references', `The selected model accepts at most ${maximumReferenceImages} reference images.`);
    }
    if (maximumTotalReferences && submittedReferenceCount > maximumTotalReferences) {
      throw invalidOption('too-many-references', `The selected model accepts at most ${maximumTotalReferences} reference files.`);
    }
    if (isAtlasReferenceProvider && !isSeedance25
      && submittedAudioReferenceCount > 0 && submittedUrlCount === 0) {
      throw invalidOption('reference-required', 'Seedance 2.0 requires at least one image or video when using reference audio.');
    }
  }
  const allowedReferenceMimeTypes = new Set(
    Array.isArray(capabilities.referenceMimeTypes)
      ? capabilities.referenceMimeTypes.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean)
      : []
  );
  const maxReferenceImageBytes = Math.max(0, Number(capabilities.maxReferenceImageBytes) || 0);
  let encodedBytes = 0;
  for (const value of urls) {
    const url = String(value || '');
    const dataImage = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(url);
    if (dataImage) {
      const mimeType = dataImage[1].toLowerCase();
      if (allowedReferenceMimeTypes.size && !allowedReferenceMimeTypes.has(mimeType)) {
        throw invalidOption('invalid-reference-format', 'The selected model accepts PNG, JPEG, or WebP reference images.');
      }
      const imageBytes = base64DecodedBytes(dataImage[2]);
      if (maxReferenceImageBytes && imageBytes > maxReferenceImageBytes) {
        throw Object.assign(new Error('Each reference image must be smaller than 25 MB.'), {
          status: 413,
          code: 'reference-image-too-large'
        });
      }
      encodedBytes += imageBytes;
    } else if (!/^https:\/\//i.test(url)) {
      throw Object.assign(new Error('Reference images must be sanitized data URLs or HTTPS URLs.'), { status: 400, code: 'unsafe-reference' });
    } else if (capabilities.referenceDataUrlsOnly === true) {
      throw invalidOption('invalid-reference-format', 'The selected model requires sanitized PNG, JPEG, or WebP reference images.');
    }
  }
  if (encodedBytes > 50 * 1024 * 1024) throw Object.assign(new Error('Reference images exceed the upstream request limit.'), { status: 413, code: 'attachments-too-large' });
  let requestedSize = normalizeImageSize(body.size);
  const requestedResolution = String(body.resolution || '').trim().toUpperCase();
  let requestedRatio = String(body.aspectRatio || '').trim();
  let requestedQuality = String(body.quality || 'auto').trim().toLowerCase();
  const configuredServiceTiers = Array.isArray(capabilities.serviceTiers)
    ? capabilities.serviceTiers.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean)
    : [];
  const inferredServiceTier = !body.serviceTier && capabilities.tierResolutions
    ? configuredServiceTiers.find((tier) => Array.isArray(capabilities.tierResolutions[tier])
      && capabilities.tierResolutions[tier].some((value) => String(value || '').trim().toUpperCase() === requestedResolution))
    : '';
  const requestedServiceTier = String(
    body.serviceTier || inferredServiceTier || capabilities.defaultServiceTier || configuredServiceTiers[0] || ''
  ).trim().toLowerCase();
  if (configuredServiceTiers.length && !configuredServiceTiers.includes(requestedServiceTier)) {
    throw invalidOption('invalid-service-tier', 'The selected model version is not supported.');
  }
  const requestedDuration = Number(body.duration);
  const requestedOutputFormat = String(body.outputFormat || (kind === 'video' ? 'mp4' : 'jpeg')).trim().toLowerCase();
  const requestedGenerateAudio = body.generateAudio !== false;
  const requestedReturnLastFrame = body.returnLastFrame === true;
  const requestedAudioUrls = Array.isArray(body.referenceAudioUrls)
    ? body.referenceAudioUrls.slice(0, isAtlasVideo ? 10 : 0).map((value) => String(value || '').trim())
    : [];
  if (isAtlasVideo) {
    const maxAudios = Math.max(0, Number(capabilities.maxReferenceAudios) || 0);
    if (requestedAudioUrls.length > maxAudios) {
      throw invalidOption('too-many-reference-audios', 'The selected video model accepts fewer reference audio files.');
    }
    if (requestedAudioUrls.some((value) => !/^https:\/\//i.test(value))) {
      throw invalidOption('invalid-reference-audio', 'Reference audio must be an HTTPS URL.');
    }
  }
  const requestedAudioUploadIds = Array.isArray(body.referenceAudioUploadIds)
    ? body.referenceAudioUploadIds.map((value) => String(value || '').trim()).filter(Boolean).slice(0, isAtlasVideo ? 10 : 0)
    : [];
  const requestedBitrateMode = String(body.bitrateMode || '').trim().toLowerCase();
  const requestedWatermark = body.watermark === true;
  const requestedSeed = Math.round(Number(body.seed));
  const requestedStyleId = String(body.styleId || '').trim();
  const requestedStyleStrength = Math.max(0, Math.min(1, Number(body.styleStrength ?? 1)));
  if (kind === 'image') {
    const configuredSizes = urls.length > 1 && Array.isArray(capabilities.multiReferenceSizes)
      ? capabilities.multiReferenceSizes
      : urls.length > 0 && Array.isArray(capabilities.referenceSizes)
        ? capabilities.referenceSizes
        : Array.isArray(capabilities.resolutionPresets) && capabilities.resolutionPresets.length
          ? capabilities.resolutionPresets
          : capabilities.sizes;
    const allowedSizes = Array.isArray(configuredSizes) && configuredSizes.length
      ? new Set(configuredSizes.map(normalizeImageSize))
      : imageSizes;
    const configuredRatios = urls.length && Array.isArray(capabilities.referenceRatios)
      ? capabilities.referenceRatios
      : capabilities.ratios;
    const allowedRatios = Array.isArray(configuredRatios) && configuredRatios.length
      ? new Set(configuredRatios.map(String))
      : imageRatios;
    const allowedQualities = Array.isArray(capabilities.qualities) && capabilities.qualities.length
      ? new Set(capabilities.qualities.map((value) => String(value).toLowerCase()))
      : null;
    if (allowedQualities && !allowedQualities.has(requestedQuality)) {
      // Direct Atlas catalog entries intentionally expose only the tiers the
      // upstream documents. Treat the shared auto default as medium when that
      // is the available automatic-quality equivalent.
      if (requestedQuality === 'auto' && allowedQualities.has('medium')) requestedQuality = 'medium';
      else throw invalidOption('invalid-quality', 'The selected image quality is not supported.');
    }
    if (!allowedSizes.has(requestedSize) && !imageDimensionsWithinCapabilities(requestedSize, capabilities)) {
      requestedSize = imageResolutionPresetForPixels(requestedSize, allowedSizes) || requestedSize;
    }
    if (!allowedSizes.has(requestedSize) && !imageDimensionsWithinCapabilities(requestedSize, capabilities)) {
      throw invalidOption('invalid-size', 'The selected image resolution is not supported.');
    }
    if (!allowedRatios.has(requestedRatio) && !supportsImageAspectRatio(requestedRatio, capabilities)) {
      throw invalidOption(
        'invalid-aspect-ratio',
        urls.length
          ? 'The selected image model does not support this aspect ratio with reference images.'
          : 'The selected image aspect ratio is not supported.'
      );
    }
    const sizeRatios = capabilities.sizeRatios;
    const mappedRatio = sizeRatios && typeof sizeRatios === 'object' && !Array.isArray(sizeRatios)
      ? String(sizeRatios[requestedSize] || '').trim()
      : '';
    if (mappedRatio && mappedRatio !== requestedRatio) {
      throw invalidOption('invalid-size-ratio', 'The selected image resolution does not match the aspect ratio.');
    }
  }
  if (kind === 'video') {
    if (isAtlasVideo && !['mp4', 'mov'].includes(requestedOutputFormat)) {
      throw invalidOption('invalid-output-format', 'The selected video model supports MP4 or MOV output.');
    }
    const tierResolutions = capabilities.tierResolutions && requestedServiceTier
      && Array.isArray(capabilities.tierResolutions[requestedServiceTier])
      ? capabilities.tierResolutions[requestedServiceTier]
      : null;
    const configuredResolutions = tierResolutions
      || (urls.length && Array.isArray(capabilities.referenceResolutions)
        ? capabilities.referenceResolutions
        : capabilities.resolutions);
    const allowedResolutions = Array.isArray(configuredResolutions) && configuredResolutions.length
      ? new Set(configuredResolutions.map((value) => String(value).toUpperCase()))
      : defaultVideoResolutions;
    if (!allowedResolutions.has(requestedResolution)) {
      throw invalidOption('invalid-resolution', 'The selected video model does not support this resolution.');
    }
    const durationSource = selectedVideoMode && Array.isArray(selectedVideoMode.durations)
      && selectedVideoMode.durations.length
      ? selectedVideoMode.durations
      : capabilities.durations;
    const allowedDurations = Array.isArray(durationSource) && durationSource.length
      ? new Set(durationSource.map(Number).filter(Number.isInteger))
      : null;
    if (!Number.isInteger(requestedDuration)
      || (allowedDurations ? !allowedDurations.has(requestedDuration) : requestedDuration < 4 || requestedDuration > 15)) {
      throw invalidOption('invalid-duration', 'The selected video model does not support this duration.');
    }
    const configuredTextRatios = Array.isArray(capabilities.textRatios) && capabilities.textRatios.length
      ? capabilities.textRatios
      : capabilities.ratios;
    const textRatios = Array.isArray(configuredTextRatios) && configuredTextRatios.length
      ? new Set(configuredTextRatios.map(String))
      : defaultVideoRatios;
    if (videoMode === 'text' && textRatios.has('16:9') && requestedRatio === 'adaptive') {
      requestedRatio = '16:9';
    }
    const referenceRatios = Array.isArray(capabilities.frameReferenceRatios) && capabilities.frameReferenceRatios.length
      ? new Set(capabilities.frameReferenceRatios.map(String))
      : textRatios;
    const modeRatios = selectedVideoMode && Array.isArray(selectedVideoMode.ratios) && selectedVideoMode.ratios.length
      ? new Set(selectedVideoMode.ratios.map(String))
      : null;
    const frameMode = videoMode === 'first-frame' || videoMode === 'first-last-frame';
    const allowedRatios = modeRatios || (frameMode ? referenceRatios : textRatios);
    if (!allowedRatios.has(requestedRatio)) {
      throw invalidOption(
        'invalid-aspect-ratio',
        urls.length
          ? 'The selected video model does not support this aspect ratio with reference images.'
          : 'The selected video model does not support this aspect ratio.'
      );
    }
    if (isAtlasVideo && videoMode === 'video-edit' && isSeedance25 && requestedDuration !== -1) {
      throw invalidOption('invalid-duration', 'Seedance 2.5 video editing requires automatic duration (-1).');
    }
    if (isAtlasVideo && capabilities.supportsSeed === true && Number.isInteger(requestedSeed)) {
      const seedMinimum = Number.isFinite(Number(capabilities.seedMinimum)) ? Number(capabilities.seedMinimum) : -1;
      const seedMaximum = Number.isFinite(Number(capabilities.seedMaximum)) ? Number(capabilities.seedMaximum) : 4_294_967_295;
      if (requestedSeed < seedMinimum || requestedSeed > seedMaximum) throw invalidOption('invalid-seed', 'The selected video seed is outside the supported range.');
    }
    if (isAtlasVideo && requestedBitrateMode) {
      const modes = new Set(Array.isArray(capabilities.bitrateModes) ? capabilities.bitrateModes.map((value) => String(value).toLowerCase()) : []);
      if (!modes.has(requestedBitrateMode)) throw invalidOption('invalid-bitrate-mode', 'The selected video bitrate mode is not supported.');
    }
  }
  return {
    prompt,
    providerId,
    canvasId: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(String(body.canvasId || '').trim())
      ? String(body.canvasId).trim()
      : null,
    model: String(body.model || '').slice(0, 160),
    messages,
    urls,
    referenceMediaTypes,
    size: kind === 'image' ? requestedSize : '1K',
    quality: kind === 'image' ? requestedQuality : null,
    resolution: kind === 'video' ? requestedResolution : '768P',
    aspectRatio: kind === 'chat' ? 'auto' : requestedRatio,
    duration: kind === 'video' ? requestedDuration : Math.max(1, Math.min(30, Number(body.duration) || 6)),
    videoMode: kind === 'video' ? videoMode : null,
    sourceWidth: Math.max(0, Math.min(16384, Number(body.sourceWidth) || 0)),
    sourceHeight: Math.max(0, Math.min(16384, Number(body.sourceHeight) || 0)),
    enhancePrompt: body.enhancePrompt !== false,
    seed: kind === 'video'
      ? (isAtlasVideo && capabilities.supportsSeed === true && Number.isInteger(requestedSeed) ? requestedSeed : null)
      : (Number.isInteger(requestedSeed) && requestedSeed >= 1 && requestedSeed <= 1_000_000 ? requestedSeed : null),
    styleId: /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(requestedStyleId) ? requestedStyleId : null,
    styleStrength: requestedStyleStrength,
    ...(kind === 'video' ? {
      outputFormat: requestedOutputFormat,
      generateAudio: requestedGenerateAudio,
      returnLastFrame: requestedReturnLastFrame,
      referenceAudioUrls: requestedAudioUrls
      ,referenceAudioUploadIds: requestedAudioUploadIds
      ,bitrateMode: requestedBitrateMode || null
      ,watermark: requestedWatermark
      ,serviceTier: requestedServiceTier || null
    } : {})
  };
}

async function readBuffer(request, maximumBytes) {
  const declaredLength = Number(request.headers['content-length']) || 0;
  if (declaredLength > maximumBytes) {
    throw Object.assign(new Error('Request body is too large.'), { status: 413, code: 'body-too-large' });
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBytes) {
      throw Object.assign(new Error('Request body is too large.'), { status: 413, code: 'body-too-large' });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

function deniedReservation(response, reservation) {
  const reason = String(reservation && reservation.reason || 'credit-service-failed');
  const responses = {
    'insufficient-credits': [402, 'There are not enough credits for this generation.'],
    'account-suspended': [403, 'This AI account is suspended.'],
    'provider-not-allowed': [400, 'The selected AI provider is not allowed.'],
    'pricing-mismatch': [409, 'AI pricing changed. Refresh the app and try again.'],
    'request-id-conflict': [409, 'The request identifier conflicts with an earlier request.'],
    'quota-exceeded': [402, 'The legacy daily AI quota has been reached.']
  };
  const [status, message] = responses[reason] || [503, 'The AI credit check could not be completed.'];
  return send(response, status, {
    code: reason,
    message,
    requiredCredits: Number(reservation && reservation.credits) || 0,
    availableCredits: Math.max(0, Number(reservation && (reservation.availableCredits ?? reservation.available_credits)) || 0)
  });
}

function availableAccountCredits(account) {
  if (!account || typeof account !== 'object' || Array.isArray(account)) return null;
  const direct = Number(account.availableCredits ?? account.available_credits);
  if (Number.isFinite(direct)) return Math.max(0, direct);
  const balance = Number(account.balance);
  const reserved = Number(account.reserved);
  return Number.isFinite(balance) && Number.isFinite(reserved) ? Math.max(0, balance - reserved) : null;
}

async function reserveFixedTool(userId, providerId, requestId) {
  const startedAt = Date.now();
  const reservation = await reserveToolUsage(userId, requestId, { providerId });
  if (!reservation || reservation.ok !== true) {
    const reason = String(reservation && reservation.reason || 'credit-service-failed');
    const statuses = {
      'insufficient-credits': 402,
      'account-suspended': 403,
      'provider-not-allowed': 400,
      'pricing-mismatch': 409,
      'request-id-conflict': 409
    };
    const error = new Error(reason);
    error.code = reason;
    error.status = statuses[reason] || 503;
    error.requiredCredits = Number(reservation && reservation.credits) || 0;
    error.availableCredits = Math.max(0, Number(reservation && (reservation.availableCredits ?? reservation.available_credits)) || 0);
    throw error;
  }
  return { requestId, startedAt, reservation };
}

async function releaseFailedToolReservation(userId, usage) {
  if (!usage) return;
  try {
    await settleToolUsage(userId, usage.requestId, 'failed', Date.now() - usage.startedAt);
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'tool-credit-release-failed',
      code: String(error && error.code || 'credit-settlement-failed'),
      status: Number(error && error.status) || 503
    }));
  }
}

function imageToolPoller(providerId) {
  if (providerId === 'seededit-v3') return pollSeedEditImage;
  if (providerId === 'kling-image-expand') return pollKlingImageExpand;
  if (providerId === 'qwen-image-edit-plus') return pollQwenImageEdit;
  if (providerId === 'qwen-image-layered') return pollQwenImageLayered;
  if (TOPAZ_IMAGE_TOOL_IDS.has(providerId)) return pollTopazImageTool;
  throw invalidOption('invalid-image-tool', 'The selected image tool is not supported.');
}

function imageToolFlag(providerId) {
  return TOPAZ_IMAGE_TOOL_IDS.has(providerId) ? AI302_FLAGS.topaz : AI302_FLAGS.image;
}

function validUuid(value) {
  return /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(String(value || '').trim());
}

function validTaskToken(value) {
  return /^[A-Za-z0-9_-]{32,128}$/.test(String(value || '').trim());
}

function runIdempotentImageOperation(userId, operationId, factory) {
  const now = Date.now();
  for (const [key, entry] of imageOperationCache) {
    if (entry.expiresAt <= now) imageOperationCache.delete(key);
  }
  const cacheKey = `${userId}:${operationId}`;
  const existing = imageOperationCache.get(cacheKey);
  if (existing) return existing.promise;
  const entry = {
    expiresAt: now + 30 * 60_000,
    promise: Promise.resolve().then(factory)
  };
  imageOperationCache.set(cacheKey, entry);
  while (imageOperationCache.size > 200) imageOperationCache.delete(imageOperationCache.keys().next().value);
  return entry.promise;
}

function publicDownloadUrl(value) {
  try {
    const url = new URL(String(value || ''));
    const host = url.hostname.toLowerCase();
    const bareHost = host.replace(/^\[|\]$/g, '');
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    if (bareHost.includes(':')) return '';
    if (bareHost === 'localhost' || bareHost.endsWith('.local') || bareHost === '0.0.0.0') return '';
    if (/^(?:10|127|169\.254|192\.168)\./.test(bareHost)) return '';
    const private172 = /^172\.(\d{1,3})\./.exec(bareHost);
    if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return '';
    return url.toString();
  } catch (error) {
    return '';
  }
}

function publicVideoJob(job) {
  const rawStatus = String(job && job.status || '').toLowerCase();
  const status = rawStatus === 'starting'
    ? 'creating'
    : rawStatus === 'submitted'
      ? 'queued'
      : rawStatus === 'polling'
        ? 'running'
        : rawStatus;
  return {
    requestId: String(job && job.requestId || ''),
    status,
    retryAfterMs: ['creating', 'queued', 'running'].includes(status) ? 5_000 : 0,
    creditsReserved: Math.max(0, Number(job && (job.credits ?? job.creditsReserved)) || 0),
    ...(job && job.errorCode ? { errorCode: String(job.errorCode) } : {}),
    ...(job && job.errorMessage ? { errorMessage: String(job.errorMessage) } : {})
  };
}

async function attachVideoTaskWithRetry(requestId, providerTaskId) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const attached = await attachVideoTask(requestId, providerTaskId);
      if (attached && attached.ok === true) return attached;
      throw Object.assign(new Error('The provider task could not be persisted.'), {
        code: String(attached && attached.reason || 'video-task-attach-failed'),
        status: 503
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function handle(request, response) {
  const suppliedOperationId = String(request.headers['x-idempotency-key'] || '').trim();
  const requestId = validUuid(suppliedOperationId) ? suppliedOperationId : crypto.randomUUID();
  response.setHeader('X-Request-Id', requestId);
  const url = new URL(request.url, 'http://gateway.local');
  if (request.method === 'GET' && url.pathname === '/healthz') {
    return send(response, 200, { ok: true, catalogVersion, asyncVideo: true });
  }
  // Hyper3D needs a short-lived, capability-token-protected image relay. The
  // relay contains no user identity or upstream credential, so it is the only
  // public Butler endpoint; all task routes below still require Supabase auth.
  if (['GET', 'HEAD'].includes(request.method) && url.pathname.startsWith('/v1/tools/assets/')) {
    const match = /^\/v1\/tools\/assets\/([A-Za-z0-9_-]{43})(?:\.[a-z0-9]{2,8})?$/.exec(url.pathname);
    if (!match) return send(response, 404, { code: 'tool-asset-not-found', message: 'Temporary image not found.' });
    try {
      const asset = getAi302RelayAsset(match[1]);
      return sendRelayAsset(request, response, asset);
    } catch (error) {
      return send(response, 404, { code: 'tool-asset-not-found', message: 'Temporary image not found.' });
    }
  }
  const origin = String(request.headers.origin || '');
  if (origin && !allowedOrigins.has(origin)) return send(response, 403, { code: 'origin-denied', message: 'Browser origin is not allowed.' });

  const user = await authenticate(request);
  if (!user) return send(response, 401, { code: 'invalid-session', message: 'A valid Supabase session is required.' });
  const ip = String(request.headers['x-forwarded-for'] || request.socket.remoteAddress || '').split(',')[0].trim();
  const isVideoStatus = request.method === 'POST' && url.pathname === '/v1/media/video/tasks/status';
  const isThreeDStatus = request.method === 'POST' && url.pathname === '/v1/tools/3d/status';
  const isVideoToolStatus = request.method === 'POST' && url.pathname === '/v1/tools/video/status';
  const isVideoToolUpload = request.method === 'PUT' && /^\/v1\/tools\/video\/uploads\/[A-Za-z0-9_-]{43}\/\d{1,4}$/.test(url.pathname);
  const isReferenceVideoUpload = request.method === 'PUT'
    && /^\/v1\/media\/video\/reference-uploads\/[A-Za-z0-9_-]{43}\/\d{1,4}$/.test(url.pathname);
  const isReferenceAudioUpload = request.method === 'PUT'
    && /^\/v1\/media\/audio\/reference-uploads\/[A-Za-z0-9_-]{43}\/\d{1,4}$/.test(url.pathname);
  const isChunkedVideoUpload = isVideoToolUpload || isReferenceVideoUpload || isReferenceAudioUpload;
  const statusBucket = isChunkedVideoUpload ? 'video-upload'
    : isVideoStatus ? 'video-status'
    : isThreeDStatus ? 'three-d-status'
      : isVideoToolStatus ? 'video-tool-status' : 'default';
  const statusMaximum = isChunkedVideoUpload
    ? 240
    : isVideoStatus || isThreeDStatus || isVideoToolStatus ? 180 : null;
  if (!rateAllowed(user.id, ip, statusBucket, statusMaximum)) {
    return send(response, 429, { code: 'rate-limited', message: 'Too many requests. Please wait before trying again.' }, { 'Retry-After': statusMaximum ? '10' : '60' });
  }

  if (request.method === 'GET' && url.pathname === '/v1/account') {
    return send(response, 200, { account: await getUsageAccount(user.id) });
  }
  if (request.method === 'GET' && url.pathname === '/v1/usage/summary') {
    const from = String(url.searchParams.get('from') || '').trim();
    const to = String(url.searchParams.get('to') || '').trim();
    const timeZoneOffset = Number(url.searchParams.get('tzOffset'));
    const range = from || to
      ? { from, to, timeZoneOffset }
      : String(url.searchParams.get('range') || '7d').trim().toLowerCase();
    return send(response, 200, { summary: await getUsageSummary(user.id, range) });
  }
  if (request.method === 'GET' && url.pathname === '/v1/usage/canvas') {
    const canvasId = String(url.searchParams.get('canvasId') || '').trim();
    return send(response, 200, { usage: await getCanvasUsage(user.id, canvasId) });
  }
  if (request.method === 'POST' && url.pathname === '/v1/account/redeem') {
    const redemptionBody = await readJson(request);
    const result = await redeemUsageCode(user.id, redemptionBody.code);
    if (result.ok !== true) {
      const reason = String(result.reason || 'invalid-redemption-code');
      const status = reason === 'code-exhausted' ? 409 : 400;
      return send(response, status, { code: reason, message: reason === 'code-exhausted' ? 'This redemption code has already been used.' : 'The redemption code is invalid.' });
    }
    return send(response, 200, { redemption: result, account: result.account || null });
  }
  if (request.method === 'GET' && url.pathname === '/v1/config') {
    return send(response, 200, publicProviderConfig());
  }
  if (request.method === 'GET' && url.pathname === '/v1/models') {
    const requestedProviderId = String(url.searchParams.get('providerId') || 'chat-1').trim().toLowerCase();
    return send(response, 200, await models(requestedProviderId));
  }
  if (request.method === 'POST' && url.pathname === '/v1/media/video/reference-uploads') {
    const body = await readJson(request);
    return send(response, 201, createVideoUploadSession({
      userId: user.id,
      size: body && body.size,
      mime: body && body.mime
    }));
  }
  if (request.method === 'POST' && url.pathname === '/v1/media/audio/reference-uploads') {
    const body = await readJson(request);
    return send(response, 201, createAudioUploadSession({ userId: user.id, size: body && body.size, mime: body && body.mime }));
  }
  const referenceAudioChunkMatch = /^\/v1\/media\/audio\/reference-uploads\/([A-Za-z0-9_-]{43})\/(\d{1,4})$/.exec(url.pathname);
  if (request.method === 'PUT' && referenceAudioChunkMatch) {
    const chunk = await readBuffer(request, 4 * 1024 * 1024);
    return send(response, 200, appendAudioUploadChunk({ uploadId: referenceAudioChunkMatch[1], index: Number(referenceAudioChunkMatch[2]), chunk, userId: user.id }));
  }
  const referenceVideoChunkMatch = /^\/v1\/media\/video\/reference-uploads\/([A-Za-z0-9_-]{43})\/(\d{1,4})$/.exec(url.pathname);
  if (request.method === 'PUT' && referenceVideoChunkMatch) {
    const chunk = await readBuffer(request, 4 * 1024 * 1024);
    return send(response, 200, appendVideoUploadChunk({
      uploadId: referenceVideoChunkMatch[1],
      index: Number(referenceVideoChunkMatch[2]),
      chunk,
      userId: user.id
    }));
  }
  if (request.method === 'POST' && url.pathname === '/v1/tools/video/uploads') {
    if (!ai302Enabled(AI302_FLAGS.topaz)) return disabledTool(response);
    const body = await readJson(request);
    return send(response, 201, createVideoUploadSession({
      userId: user.id,
      size: body && body.size,
      mime: body && body.mime
    }));
  }
  const videoChunkMatch = /^\/v1\/tools\/video\/uploads\/([A-Za-z0-9_-]{43})\/(\d{1,4})$/.exec(url.pathname);
  if (request.method === 'PUT' && videoChunkMatch) {
    if (!ai302Enabled(AI302_FLAGS.topaz)) return disabledTool(response);
    const chunk = await readBuffer(request, 4 * 1024 * 1024);
    return send(response, 200, appendVideoUploadChunk({
      uploadId: videoChunkMatch[1],
      index: Number(videoChunkMatch[2]),
      chunk,
      userId: user.id
    }));
  }
  if (request.method === 'GET' && url.pathname === '/v1/media/image/styles') {
    const providerId = String(url.searchParams.get('providerId') || '').trim().toLowerCase();
    return send(response, 200, { providerId, styles: await imageStyles(providerId) });
  }

  if (request.method === 'POST' && url.pathname === '/v1/tools/background/remove') {
    if (!ai302Enabled(AI302_FLAGS.background)) return disabledTool(response);
    const body = await readJson(request);
    const png = await runIdempotentImageOperation(user.id, requestId, async () => {
      const usage = await reserveFixedTool(user.id, 'background-remove', requestId);
      try {
        const result = await removeBackground({
          imageDataUrl: body && body.imageDataUrl,
          toolOptions: body && body.options
        });
        await settleToolUsage(user.id, usage.requestId, 'succeeded', Date.now() - usage.startedAt);
        return result;
      } catch (error) {
        await releaseFailedToolReservation(user.id, usage);
        throw error;
      }
    });
    return send(response, 200, png, {
      'Content-Type': 'image/png',
      'Content-Disposition': 'attachment; filename="background-removed.png"'
    });
  }

  if (request.method === 'POST' && url.pathname === '/v1/tools/image/edit') {
    if (!ai302Enabled(AI302_FLAGS.image)) return disabledTool(response);
    const body = await readJson(request);
    const modelId = String(body && body.modelId || '').trim().toLowerCase();
    if (modelId !== 'seededit-v3') {
      throw invalidOption('invalid-image-tool', 'The selected image tool is not supported.');
    }
    const task = await runIdempotentImageOperation(user.id, requestId, async () => {
      const usage = await reserveFixedTool(user.id, modelId, requestId);
      try {
        const created = await submitSeedEditImage({
          imageDataUrl: body && body.imageDataUrl,
          prompt: body && body.options && body.options.prompt,
          toolOptions: body && body.options,
          userId: user.id
        }, { accountingRequestId: usage.requestId });
        return {
          ...created,
          credits: usage.reservation.credits,
          availableCredits: usage.reservation.availableCredits ?? usage.reservation.available_credits
        };
      } catch (error) {
        await releaseFailedToolReservation(user.id, usage);
        throw error;
      }
    });
    return send(response, 202, task);
  }

  if (request.method === 'POST' && url.pathname === '/v1/tools/image/expand') {
    if (!ai302Enabled(AI302_FLAGS.image)) return disabledTool(response);
    const body = await readJson(request);
    const modelId = String(body && body.modelId || '').trim().toLowerCase();
    if (modelId !== 'kling-image-expand') {
      throw invalidOption('invalid-image-tool', 'The selected image tool is not supported.');
    }
    const png = await runIdempotentImageOperation(user.id, requestId, async () => {
      const usage = await reserveFixedTool(user.id, modelId, requestId);
      try {
        const output = await uncropImage({
          imageDataUrl: body && body.imageDataUrl,
          toolOptions: body && body.options
        });
        await settleToolUsage(user.id, usage.requestId, 'succeeded', Date.now() - usage.startedAt);
        return output;
      } catch (error) {
        await releaseFailedToolReservation(user.id, usage);
        throw error;
      }
    });
    return send(response, 200, png, {
      'Content-Type': 'image/png',
      'Content-Disposition': 'attachment; filename="expanded.png"'
    });
  }

  if (request.method === 'POST' && url.pathname === '/v1/tools/image/layer') {
    if (!ai302Enabled(AI302_FLAGS.image)) return disabledTool(response);
    const body = await readJson(request);
    const modelId = String(body && body.modelId || '').trim().toLowerCase();
    if (modelId !== 'qwen-image-layered') {
      throw invalidOption('invalid-image-tool', 'The selected image tool is not supported.');
    }
    const task = await runIdempotentImageOperation(user.id, requestId, async () => {
      const usage = await reserveFixedTool(user.id, modelId, requestId);
      try {
        const created = await submitQwenImageLayered({
          imageDataUrl: body && body.imageDataUrl,
          prompt: body && body.options && body.options.prompt,
          numLayers: body && body.options && body.options.numLayers,
          toolOptions: body && body.options,
          userId: user.id
        }, { accountingRequestId: usage.requestId });
        return {
          ...created,
          credits: usage.reservation.credits,
          availableCredits: usage.reservation.availableCredits ?? usage.reservation.available_credits
        };
      } catch (error) {
        await releaseFailedToolReservation(user.id, usage);
        throw error;
      }
    });
    return send(response, 202, task);
  }

  if (request.method === 'POST' && url.pathname === '/v1/tools/image/topaz') {
    if (!ai302Enabled(AI302_FLAGS.topaz)) return disabledTool(response);
    const body = await readJson(request);
    const modelId = String(body && body.modelId || '').trim().toLowerCase();
    if (!TOPAZ_IMAGE_TOOL_IDS.has(modelId)) {
      throw invalidOption('invalid-image-tool', 'The selected Topaz image tool is not supported.');
    }
    const account = await getUsageAccount(user.id);
    const availableCredits = availableAccountCredits(account);
    if (availableCredits !== null && availableCredits < TOPAZ_IMAGE_MAX_RETAIL_CREDITS) {
      return deniedReservation(response, {
        reason: 'insufficient-credits',
        credits: TOPAZ_IMAGE_MAX_RETAIL_CREDITS,
        availableCredits
      });
    }
    const task = await runIdempotentImageOperation(user.id, requestId, () => submitTopazImageTool({
      modelId,
      imageDataUrl: body && body.imageDataUrl,
      toolOptions: body && body.options,
      userId: user.id
    }, {
      reserveCredits: ({ requestId: accountingRequestId, providerId, providerCost }) => reserveToolUsage(
        user.id,
        accountingRequestId,
        { providerId, providerCost }
      )
    }));
    return send(response, 202, task);
  }

  if (request.method === 'POST' && url.pathname === '/v1/tools/image/status') {
    const body = await readJson(request);
    const modelId = String(body && body.modelId || '').trim().toLowerCase();
    if (!ai302Enabled(imageToolFlag(modelId))) return disabledTool(response);
    const poll = imageToolPoller(modelId);
    const result = await poll({
      taskToken: body && body.taskToken,
      userId: user.id
    }, {
      touchCredits: ({ requestId }) => touchToolUsage(user.id, requestId),
      settleCredits: ({ requestId, status, durationMs }) => settleToolUsage(
        user.id,
        requestId,
        status,
        durationMs
      )
    });
    return send(response, 200, {
      status: result.status,
      ...(result.progress !== undefined ? { progress: result.progress } : {}),
      retryAfterMs: result.retryAfterMs,
      resultCount: Array.isArray(result.urls) ? result.urls.length : 0,
      ...(result.providerCost !== undefined ? { providerCost: result.providerCost } : {}),
      ...(result.creditsCharged !== undefined ? { creditsCharged: result.creditsCharged } : {}),
      ...(result.creditsReleased !== undefined ? { creditsReleased: result.creditsReleased } : {})
    });
  }

  if (request.method === 'POST' && url.pathname === '/v1/tools/image/download') {
    const body = await readJson(request);
    const modelId = String(body && body.modelId || '').trim().toLowerCase();
    if (!ai302Enabled(imageToolFlag(modelId))) return disabledTool(response);
    const index = Number(body && body.index);
    if (!Number.isInteger(index) || index < 0 || index >= 8) {
      throw invalidOption('invalid-image-result-index', 'The selected image result is invalid.');
    }
    const poll = imageToolPoller(modelId);
    const result = await poll({
      taskToken: body && body.taskToken,
      userId: user.id
    }, {
      touchCredits: ({ requestId }) => touchToolUsage(user.id, requestId),
      settleCredits: ({ requestId, status, durationMs }) => settleToolUsage(
        user.id,
        requestId,
        status,
        durationMs
      )
    });
    if (result.status !== 'succeeded') {
      const error = new Error('The processed image is not ready yet.');
      error.code = 'image-tool-task-not-ready';
      error.status = 409;
      throw error;
    }
    if (!Array.isArray(result.urls) || index >= result.urls.length) {
      throw invalidOption('invalid-image-result-index', 'The selected image result is invalid.');
    }
    const png = await downloadAi302ImageResult(result.urls[index]);
    return send(response, 200, png, {
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="${modelId}-${index + 1}.png"`
    });
  }

  if (request.method === 'POST' && url.pathname === '/v1/tools/image/upscale') {
    if (!ai302Enabled(AI302_FLAGS.image)) return disabledTool(response);
    const body = await readJson(request);
    const modelId = String(body && body.modelId || '').trim().toLowerCase();
    if (modelId !== 'generative-upscale') {
      throw invalidOption('invalid-image-tool', 'The selected image tool is not supported.');
    }
    const png = await runIdempotentImageOperation(user.id, requestId, async () => {
      const usage = await reserveFixedTool(user.id, modelId, requestId);
      try {
        const output = await generativeUpscaleImage({ imageDataUrl: body && body.imageDataUrl });
        await settleToolUsage(user.id, usage.requestId, 'succeeded', Date.now() - usage.startedAt);
        return output;
      } catch (error) {
        await releaseFailedToolReservation(user.id, usage);
        throw error;
      }
    });
    return send(response, 200, png, {
      'Content-Type': 'image/png',
      'Content-Disposition': 'attachment; filename="generative-upscaled.png"'
    });
  }

  if (request.method === 'POST' && url.pathname === '/v1/tools/image/erase') {
    if (!ai302Enabled(AI302_FLAGS.image)) return disabledTool(response);
    const body = await readJson(request);
    const modelId = String(body && body.modelId || '').trim().toLowerCase();
    if (modelId !== 'cleanup') {
      throw invalidOption('invalid-image-tool', 'The selected image tool is not supported.');
    }
    const png = await runIdempotentImageOperation(user.id, requestId, async () => {
      const usage = await reserveFixedTool(user.id, modelId, requestId);
      try {
        const output = await cleanupImageObjects({ imageDataUrl: body && body.imageDataUrl, maskImageDataUrl: body && body.maskDataUrl });
        await settleToolUsage(user.id, usage.requestId, 'succeeded', Date.now() - usage.startedAt);
        return output;
      } catch (error) {
        await releaseFailedToolReservation(user.id, usage);
        throw error;
      }
    });
    return send(response, 200, png, {
      'Content-Type': 'image/png',
      'Content-Disposition': 'attachment; filename="erased.png"'
    });
  }

  if (request.method === 'POST' && url.pathname === '/v1/tools/3d/create') {
    const body = await readJson(request);
    const providerId = String(body && body.providerId || '').trim().toLowerCase();
    const flag = AI302_FLAGS[providerId];
    if (!flag || !ai302Enabled(flag)) return disabledTool(response);
    const task = await runIdempotentImageOperation(user.id, requestId, async () => {
      const usage = await reserveFixedTool(user.id, providerId, requestId);
      try {
        const created = await createThreeDTask({
          providerId,
          imageDataUrl: body && body.imageDataUrl,
          prompt: body && body.prompt,
          toolOptions: body && body.options,
          userId: user.id
        }, {
          accountingRequestId: usage.requestId,
          credits: usage.reservation.credits
        });
        return {
          ...created,
          availableCredits: usage.reservation.availableCredits ?? usage.reservation.available_credits
        };
      } catch (error) {
        await releaseFailedToolReservation(user.id, usage);
        throw error;
      }
    });
    return send(response, 202, task);
  }

  if (request.method === 'POST' && url.pathname === '/v1/tools/3d/status') {
    if (!ai302Enabled(AI302_FLAGS.hunyuan3d) && !ai302Enabled(AI302_FLAGS.hyper3d) && !ai302Enabled(AI302_FLAGS.tripo3d)) return disabledTool(response);
    const body = await readJson(request);
    return send(response, 200, await getThreeDStatus({
      taskToken: body && body.taskToken,
      userId: user.id
    }, {
      touchCredits: ({ requestId: accountingRequestId }) => touchToolUsage(user.id, accountingRequestId),
      settleCredits: ({ requestId: accountingRequestId, status, durationMs }) => settleToolUsage(
        user.id, accountingRequestId, status, durationMs
      )
    }));
  }

  if (request.method === 'POST' && url.pathname === '/v1/tools/3d/download') {
    if (!ai302Enabled(AI302_FLAGS.hunyuan3d) && !ai302Enabled(AI302_FLAGS.hyper3d) && !ai302Enabled(AI302_FLAGS.tripo3d)) return disabledTool(response);
    const body = await readJson(request);
    const glb = await downloadThreeDModel({
      taskToken: body && body.taskToken,
      userId: user.id
    }, {
      touchCredits: ({ requestId: accountingRequestId }) => touchToolUsage(user.id, accountingRequestId),
      settleCredits: ({ requestId: accountingRequestId, status, durationMs }) => settleToolUsage(
        user.id, accountingRequestId, status, durationMs
      )
    });
    return send(response, 200, glb, {
      'Content-Type': 'model/gltf-binary',
      'Content-Disposition': 'attachment; filename="model.glb"'
    });
  }

  if (request.method === 'POST' && url.pathname === '/v1/tools/video/upscale') {
    if (!ai302Enabled(AI302_FLAGS.topaz)) return disabledTool(response);
    const body = await readJson(request);
    const modelId = String(body && body.modelId || 'topaz-video-upscale').trim().toLowerCase();
    if (modelId !== 'topaz-video-upscale') {
      throw invalidOption('invalid-video-tool', 'The selected video tool is not supported.');
    }
    const account = await getUsageAccount(user.id);
    const availableCredits = availableAccountCredits(account);
    if (availableCredits !== null && availableCredits <= 0) {
      return deniedReservation(response, {
        reason: 'insufficient-credits',
        credits: 1,
        availableCredits
      });
    }
    const task = await runIdempotentImageOperation(user.id, requestId, async () => {
      const uploadId = String(body && body.uploadId || '').trim();
      const videoAsset = uploadId ? consumeVideoUpload({ uploadId, userId: user.id }) : null;
      return createVideoUpscaleTask({
        videoDataUrl: body && body.videoDataUrl,
        videoAsset,
        toolOptions: body && body.options,
        userId: user.id
      }, {
        reserveCredits: ({ requestId: accountingRequestId, providerId, credits, providerCost, resolution, duration }) => reserveToolUsage(
          user.id, accountingRequestId, { providerId, credits, providerCost, resolution, duration }
        )
      });
    });
    return send(response, 202, task);
  }

  if (request.method === 'POST' && url.pathname === '/v1/tools/video/status') {
    if (!ai302Enabled(AI302_FLAGS.topaz)) return disabledTool(response);
    const body = await readJson(request);
    return send(response, 200, await getVideoUpscaleStatus({
      taskToken: body && body.taskToken,
      userId: user.id
    }, {
      touchCredits: ({ requestId }) => touchToolUsage(user.id, requestId),
      settleCredits: ({ requestId, status, durationMs }) => settleToolUsage(
        user.id,
        requestId,
        status,
        durationMs
      )
    }));
  }

  if (request.method === 'POST' && url.pathname === '/v1/tools/video/download') {
    if (!ai302Enabled(AI302_FLAGS.topaz)) return disabledTool(response);
    const body = await readJson(request);
    const video = await downloadVideoUpscaleResult({
      taskToken: body && body.taskToken,
      userId: user.id
    }, {
      touchCredits: ({ requestId }) => touchToolUsage(user.id, requestId),
      settleCredits: ({ requestId, status, durationMs }) => settleToolUsage(
        user.id,
        requestId,
        status,
        durationMs
      )
    });
    return send(response, 200, video, {
      'Content-Type': 'video/mp4',
      'Content-Disposition': 'attachment; filename="enhanced-video.mp4"'
    });
  }

  if (request.method === 'POST' && url.pathname === '/v1/media/video/tasks/create') {
    let rawBody = await readJson(request);
    const operationId = String(rawBody.operationId || '').trim();
    const taskToken = String(rawBody.taskToken || '').trim();
    if (!validUuid(operationId) || !validTaskToken(taskToken)) {
      return send(response, 400, { code: 'invalid-video-operation', message: 'The video task identity is invalid.' });
    }
    rawBody = materializeVideoReferences(rawBody, user.id);
    const body = validateBody(rawBody, 'video');
    const job = await startVideoJob({ userId: user.id, operationId, taskToken, body });
    if (job.ok !== true) return deniedReservation(response, job);
    if (body.canvasId) await tagUsageCanvas(user.id, operationId, body.canvasId);
    if (!job.created) return send(response, 202, publicVideoJob(job));

    const startedAt = Date.now();
    try {
      const providerTask = await createVideoTask({ ...body, operationId });
      await attachVideoTaskWithRetry(operationId, providerTask.taskId);
      return send(response, 202, {
        requestId: operationId,
        status: 'queued',
        retryAfterMs: 5_000,
        creditsReserved: Math.max(0, Number(job.credits) || 0)
      });
    } catch (error) {
      try {
        await finalizeVideoJob({
          requestId: operationId,
          status: 'failed',
          error,
          durationMs: Date.now() - startedAt
        });
      } catch (finalizationError) {
        console.error(JSON.stringify({
          level: 'error',
          requestId: operationId,
          code: String(finalizationError.code || 'video-job-finalization-failed'),
          status: Number(finalizationError.status) || 503
        }));
      }
      throw error;
    }
  }

  if (request.method === 'POST' && url.pathname === '/v1/media/video/tasks/status') {
    const body = await readJson(request);
    if (!validTaskToken(body.taskToken)) {
      return send(response, 404, { code: 'video-task-not-found', message: 'Video task not found.' });
    }
    const job = await getVideoJob(user.id, body.taskToken);
    if (!job || job.ok !== true) {
      return send(response, 404, { code: 'video-task-not-found', message: 'Video task not found.' });
    }
    return send(response, 200, publicVideoJob(job));
  }

  if (request.method === 'POST' && url.pathname === '/v1/media/video/tasks/download') {
    const body = await readJson(request);
    if (!validTaskToken(body.taskToken)) {
      return send(response, 404, { code: 'video-task-not-found', message: 'Video task not found.' });
    }
    const result = await getVideoDownload(user.id, body.taskToken);
    if (!result || result.ok !== true) {
      const notFound = result && result.reason === 'not-found';
      return send(response, notFound ? 404 : 409, {
        code: notFound ? 'video-task-not-found' : 'video-task-not-ready',
        message: notFound ? 'Video task not found.' : 'The video is not ready to download.'
      });
    }
    let downloadUrl = publicDownloadUrl(result.url);
    if (result.providerId && result.providerTaskId) {
      try {
        const refreshed = await pollVideoTask(result.providerId, result.providerTaskId);
        if (refreshed.status === 'succeeded' && publicDownloadUrl(refreshed.resultUrl)) {
          downloadUrl = publicDownloadUrl(refreshed.resultUrl);
        }
      } catch (error) {
        // The stored URL can still be used when a refresh request is temporarily unavailable.
      }
    }
    if (!downloadUrl) {
      return send(response, 502, { code: 'unsafe-media-url', message: 'The video provider returned an invalid download address.' });
    }
    return send(response, 200, { url: downloadUrl });
  }

  if (request.method === 'POST' && url.pathname === '/v1/usage/quote') {
    const raw = await readJson(request);
    const kind = String(raw && raw.kind || '').trim().toLowerCase() === 'video' ? 'video' : 'image';
    const providerId = String(
      raw && (raw.providerId || (kind === 'video' ? raw.videoProviderId : raw.imageProviderId)) || ''
    ).trim();
    const count = kind === 'image'
      ? Math.max(1, Math.min(4, Math.round(Number(raw && raw.count) || 1)))
      : 1;
    const quote = await quoteUsageForUser(user.id, kind, {
      ...raw,
      providerId,
      duration: raw && raw.duration,
      resolution: raw && raw.resolution,
      quality: raw && raw.quality
    });
    const unitCredits = kind === 'video'
      ? Math.max(0, Number(quote.unitCredits) || 0)
      : Math.max(0, Math.ceil(Number(quote.credits) || 0));
    const totalCredits = kind === 'video'
      ? Math.max(0, Math.ceil(Number(quote.credits) || 0))
      : unitCredits * count;
    return send(response, 200, {
      kind: quote.kind,
      providerId: quote.providerId,
      resolution: quote.resolution,
      duration: quote.duration,
      unitCredits,
      totalCredits,
      count
    });
  }

  let kind;
  if (request.method === 'POST' && url.pathname === '/v1/chat') kind = 'chat';
  if (request.method === 'POST' && url.pathname === '/v1/media/image') kind = 'image';
  if (request.method === 'POST' && url.pathname === '/v1/media/video') kind = 'video';
  if (!kind) return send(response, 404, { code: 'not-found', message: 'Route not found.' });

  const body = validateBody(await readJson(request), kind);
  if (kind === 'image') {
    const media = await runIdempotentImageOperation(user.id, requestId, async () => {
      const reservation = await reserveUsage(user.id, kind, requestId, body);
      if (!reservation.ok) {
        const error = new Error(String(reservation.reason || 'The image request was not accepted.'));
        error.code = String(reservation.reason || 'credit-service-failed');
        error.status = error.code === 'insufficient-credits' ? 402 : 400;
        throw error;
      }
      if (body.canvasId) await tagUsageCanvas(user.id, requestId, body.canvasId);
      const startedAt = Date.now();
      try {
        const result = await generateMedia(
          kind,
          { ...body, operationId: requestId },
          AbortSignal.timeout(20 * 60_000)
        );
        await settleUsage(requestId, 'succeeded', Date.now() - startedAt);
        return result;
      } catch (error) {
        try { await settleUsage(requestId, 'failed', Date.now() - startedAt); } catch (settlementError) {}
        throw error;
      }
    });
    return send(response, 200, media, { 'Content-Type': 'application/octet-stream' });
  }
  const reservation = await reserveUsage(user.id, kind, requestId, body);
  if (!reservation.ok) return deniedReservation(response, reservation);
  if (body.canvasId) await tagUsageCanvas(user.id, requestId, body.canvasId);
  const startedAt = Date.now();
  const controller = new AbortController();
  request.once('aborted', () => controller.abort());
  response.once('close', () => {
    if (!response.writableEnded) controller.abort();
  });
  try {
    if (kind === 'chat') {
      const text = await chat(body, controller.signal);
      await settleUsage(requestId, 'succeeded', Date.now() - startedAt);
      return send(response, 200, { text });
    }
    const media = kind === 'video'
      ? await generateLegacyVideo(body, controller.signal)
      : await generateMedia(kind, body, controller.signal);
    await settleUsage(requestId, 'succeeded', Date.now() - startedAt);
    return send(response, 200, media, {
      'Content-Type': kind === 'video' ? 'video/mp4' : 'application/octet-stream'
    });
  } catch (error) {
    try {
      await settleUsage(requestId, 'failed', Date.now() - startedAt);
    } catch (settlementError) {
      // Preserve the upstream failure for the client. The reservation remains
      // locked (not spent) and reserve_ai_credits will release it after the
      // stale-reservation window if the settlement service is unavailable.
      console.error(JSON.stringify({
        level: 'error',
        requestId,
        code: String(settlementError.code || 'credit-settlement-failed'),
        status: Number(settlementError.status) || 503
      }));
    }
    throw error;
  }
}

const server = http.createServer((request, response) => {
  handle(request, response).catch((error) => {
    const publicError = publicGatewayError(error);
    const { status, code } = publicError;
    const safeMessages = {
      'quota-not-configured': 'AI quota service is not configured.',
      'quota-service-failed': 'AI quota check is temporarily unavailable.',
      'credit-service-not-configured': 'AI credit enforcement is not configured.',
      'credit-schema-missing': 'AI credit enforcement has not been installed.',
      'credit-service-failed': 'AI credit validation is temporarily unavailable.',
      'credit-settlement-failed': 'AI credit settlement is temporarily unavailable.',
      'credit-settlement-conflict': 'This AI request was already settled with a different result.',
      'redemption-service-failed': 'Code redemption is temporarily unavailable.',
      'provider-not-configured': 'The selected AI model is not configured on the server.',
      'provider-secret-missing': 'The selected AI model is missing its server credential.',
      'provider-auth-failed': 'The selected AI provider rejected its server credential.',
      'provider-timeout': 'The selected AI provider timed out while accepting the task. No points were charged; please retry shortly.',
      'provider-channel-unavailable': 'The video provider channel is temporarily unavailable. No points were charged; please retry shortly.',
      'provider-temporarily-unavailable': 'The selected AI provider is temporarily unavailable. Please retry shortly.',
      'video-job-service-not-configured': 'Background video generation is not configured.',
      'video-job-schema-missing': 'Background video generation is being upgraded. Please try again shortly.',
      'video-job-service-failed': 'Background video generation is temporarily unavailable.',
      'video-job-finalization-failed': 'The video task could not be completed safely.',
      'ai302-not-configured': 'The 302 tool gateway is not configured.',
      'ai302-unavailable': 'The 302 tool service is temporarily unavailable.',
      'ai302-upstream-error': 'The 302 tool service rejected the request.',
      'ai302-invalid-response': 'The 302 tool service returned an invalid response.',
      'unsafe-tool-result-url': 'The tool provider returned an unsafe download address.',
      'tool-download-failed': 'The tool result could not be downloaded.',
      'tool-result-too-large': 'The tool result exceeds the supported size.',
      'invalid-video-result': 'The enhanced video result is invalid.',
      'video-upscale-failed': 'Video enhancement failed.',
      'video-upscale-request-rejected': 'Topaz rejected the source video or output settings. Choose a compatible model and format.',
      'video-upload-not-found': 'The video upload expired. Start the enhancement again.',
      'video-upload-incomplete': 'The video upload is incomplete. Start the enhancement again.',
      'invalid-video-upload-chunk': 'A video upload chunk is invalid.',
      'video-upload-chunk-conflict': 'A retried video upload chunk did not match.',
      'video-tool-task-not-ready': 'The enhanced video is not ready yet.',
      'video-tool-task-not-found': 'The video enhancement task was not found.',
      'insufficient-credits': 'Not enough points are available for this request.',
      'invalid-png-result': 'The background-removal result is invalid.',
      'invalid-glb-result': 'The 3D result is invalid.',
      'three-d-result-invalid': 'The completed 3D task did not contain a GLB model.',
      'tool-public-url-not-configured': 'The public gateway URL is not configured.',
      'tool-asset-capacity-exceeded': 'The temporary tool relay is at capacity.',
      'tool-disabled': 'This Butler tool is not enabled on the server.',
      'tool-asset-not-found': 'Temporary tool asset not found.',
      'invalid-image-tool': 'The selected image tool is not supported.',
      'invalid-image-tool-options': 'The selected image tool options are invalid.',
      'invalid-image-result-index': 'The selected image result is invalid.',
      'invalid-mask-image': 'The object-removal mask is invalid.',
      'image-tool-task-not-found': 'The image task was not found.',
      'image-tool-task-not-ready': 'The processed image is not ready yet.',
      'three-d-task-not-found': 'The 3D task was not found.',
      'three-d-task-not-ready': 'The 3D model is not ready to download.',
      'three-d-generation-failed': '3D generation failed.'
    };
    // Do not log prompts, attachments, authorization headers, or upstream bodies.
    const upstreamStatus = Number(error.upstreamStatus);
    console.error(JSON.stringify({
      level: 'error',
      requestId: response.getHeader('X-Request-Id'),
      path: new URL(request.url, 'http://gateway.local').pathname,
      code,
      status,
      ...(Number.isInteger(upstreamStatus) ? { upstreamStatus } : {})
    }));
    if (!response.headersSent) send(response, status, {
      code,
      message: safeMessages[code] || (status >= 500 ? 'The AI gateway could not complete this request.' : publicError.message)
    });
  });
});

const videoWorker = String(process.env.SUPABASE_SECRET_KEY || '').trim()
  ? startVideoJobWorker({
      pollVideoTask: (job) => pollVideoTask(job.providerId, job.providerTaskId),
      onError: (error) => console.error(JSON.stringify({
        level: 'error',
        event: error && error.code === 'video-job-schema-missing'
          ? 'video-worker-disabled'
          : 'video-worker-cycle-failed',
        code: String(error && error.code || 'video-job-worker-failed'),
        status: Number(error && error.status) || 503
      }))
    })
  : { stop() {} };

server.once('close', () => videoWorker.stop());

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) {
    if (bucket.resetAt <= now) rateBuckets.delete(key);
  }
}, 5 * 60_000).unref();

server.listen(port, '0.0.0.0', () => {
  console.log(JSON.stringify({ level: 'info', event: 'gateway-ready', port }));
});
