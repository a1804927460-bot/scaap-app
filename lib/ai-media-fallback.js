'use strict';

// Automatic image fallback is intentionally explicit.  A model is upgraded
// only to a known, more capable sibling so a transient provider outage does
// not silently change the user's requested media type or resolution.
const IMAGE_FALLBACK_PROVIDER_IDS = Object.freeze({
  'image-2': Object.freeze(['image-1']),
  'image-3': Object.freeze(['image-10', 'image-1']),
  'image-4': Object.freeze(['image-3', 'image-10', 'image-1']),
  'image-5': Object.freeze(['image-2', 'image-1']),
  // GPT Image 2 already has its provider-preserving Atlas -> 302 route in
  // the gateway. Do not let the desktop layer switch this request to
  // QuickRouter or another image model after that route has been exhausted.
  'image-6': Object.freeze([]),
  'image-7': Object.freeze(['image-8', 'image-1']),
  'image-8': Object.freeze(['image-1']),
  'image-9': Object.freeze(['image-1']),
  'image-10': Object.freeze(['image-1']),
  'image-11': Object.freeze(['image-10', 'image-1']),
  'image-12': Object.freeze(['image-3', 'image-10', 'image-1']),
  'image-13': Object.freeze(['image-3', 'image-1']),
  'image-14': Object.freeze(['image-3', 'image-1']),
  'image-15': Object.freeze(['image-10', 'image-1']),
  'image-16': Object.freeze(['image-3', 'image-1'])
});

const NON_RETRYABLE_CODES = new Set([
  'abort-error',
  'auth-required',
  'content-policy-violation',
  'empty-prompt',
  'gateway-not-configured',
  'insufficient-credits',
  'invalid-ai-options',
  'invalid-aspect-ratio',
  'invalid-media-options',
  'invalid-reference-media',
  'invalid-resolution',
  'invalid-session',
  'not-entitled',
  'privacy-blocked',
  'provider-auth-failed',
  'provider-not-allowed',
  'provider-not-configured',
  'provider-secret-missing',
  'reference-required',
  'too-many-references',
  'unsupported-media-type'
]);

function normalizedId(value) {
  return String(value || '').trim().toLowerCase();
}

function imageFallbackProviderIds(providerId) {
  return (IMAGE_FALLBACK_PROVIDER_IDS[normalizedId(providerId)] || []).slice();
}

function isRetryableMediaError(error) {
  if (!error) return false;
  if (error.name === 'AbortError') return false;
  const code = normalizedId(error.code);
  if (NON_RETRYABLE_CODES.has(code) || code.startsWith('invalid-')) return false;
  if (code.includes('auth') || code.includes('credential') || code.includes('secret')) return false;
  if (code.includes('credit') || code.includes('quota') || code.includes('permission')) return false;
  if (error.retryable === true) return true;
  const status = Number(error.status);
  if ([408, 425, 429, 500, 502, 503, 504].includes(status) || status >= 500) return true;
  if (['gateway-timeout', 'provider-rate-limited', 'provider-temporarily-unavailable',
    'provider-download-failed', 'ai302-unavailable', 'ai302-upstream-error',
    'timeout', 'network-error', 'fetch-failed'].includes(code)) return true;
  const message = String(error.message || '').toLowerCase();
  return /(?:fetch failed|network error|econnreset|etimedout|socket hang up|temporarily unavailable|upstream .*busy|service unavailable)/i.test(message);
}

function valuesSet(value) {
  return new Set(Array.isArray(value) ? value.map((entry) => normalizedId(entry)) : []);
}

function supportsImageRequest(provider, request = {}) {
  if (!provider || normalizedId(provider.kind || 'image') !== 'image') return false;
  const capabilities = provider.capabilities && typeof provider.capabilities === 'object'
    ? provider.capabilities
    : null;
  // Custom providers may not publish capabilities.  Let the provider perform
  // its own validation rather than making fallback unavailable by default.
  if (!capabilities) return true;

  const urls = Array.isArray(request.urls) ? request.urls : [];
  const references = Math.max(
    urls.length,
    Array.isArray(request.referenceFileIds) ? request.referenceFileIds.length : 0
  );
  const maximumReferences = Number(capabilities.maxReferenceImages);
  if (Number.isInteger(maximumReferences) && maximumReferences >= 0 && references > maximumReferences) return false;
  const minimumReferences = Number(capabilities.minReferenceImages);
  if (Number.isInteger(minimumReferences) && minimumReferences > 0 && references < minimumReferences) return false;

  const count = Math.max(1, Math.min(4, Number(request.count) || 1));
  const counts = valuesSet(capabilities.counts);
  if (counts.size && !counts.has(String(count))) return false;

  const size = normalizedId(request.size || request.resolution);
  const sizeValues = references > 1 && Array.isArray(capabilities.multiReferenceSizes)
    ? capabilities.multiReferenceSizes
    : references > 0 && Array.isArray(capabilities.referenceSizes)
      ? capabilities.referenceSizes
      : Array.isArray(capabilities.resolutionPresets) && capabilities.resolutionPresets.length
        ? capabilities.resolutionPresets
        : capabilities.sizes;
  const supportedSizes = valuesSet(sizeValues);
  if (size && supportedSizes.size && !supportedSizes.has(size) && capabilities.arbitrarySizes !== true) return false;

  const ratio = normalizedId(request.aspectRatio);
  const ratioValues = references > 0 && Array.isArray(capabilities.referenceRatios)
    ? capabilities.referenceRatios
    : capabilities.ratios;
  const supportedRatios = valuesSet(ratioValues);
  if (ratio && ratio !== 'auto' && supportedRatios.size && !supportedRatios.has(ratio) && capabilities.arbitraryRatios !== true) return false;

  const quality = normalizedId(request.quality);
  const qualities = valuesSet(capabilities.qualities);
  if (quality && qualities.size && !qualities.has(quality)) return false;
  return true;
}

module.exports = {
  IMAGE_FALLBACK_PROVIDER_IDS,
  imageFallbackProviderIds,
  isRetryableMediaError,
  supportsImageRequest
};
