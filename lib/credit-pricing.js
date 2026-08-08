'use strict';

// Retail points are intentionally kept separate from provider endpoints. One
// 10 points represent CNY 1 at the future recharge boundary. The current
// retail table is approximately 2x the observed upstream cost so provider
// price movement, failed retries, storage and support remain covered.
const POINTS_PER_CNY = 10;

const IMAGE_PRICES = Object.freeze({
  'image-1': 16, // Nano Banana Pro
  'image-2': 7,  // Nanobanana Pro SE
  'image-3': 5,  // Seedream 5.0 Lite
  'image-4': 4,  // Midjourney imagine
  'image-5': 8,  // Nano banana2
  'image-6': 12  // GPT Image 2, automatic quality
});

const IMAGE_QUALITY_PRICES = Object.freeze({
  'image-6': Object.freeze({ low: 3, medium: 8, high: 28, auto: 12 })
});

const VIDEO_RATES = Object.freeze({
  'video-1': Object.freeze({
    '768P': 10,
    '2K': 16
  }),
  'video-2': Object.freeze({
    '480P': 3,
    '720P': 5
  }),
  'video-3': Object.freeze({
    '480P': 4,
    '720P': 6
  })
});

const VIDEO_DEFAULT_RESOLUTIONS = Object.freeze({
  'video-1': '768P',
  'video-2': '720P',
  'video-3': '720P'
});

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function quoteMediaCredits(request = {}) {
  const kind = request.kind === 'video' ? 'video' : 'image';
  if (kind === 'video') {
    const providerId = String(request.providerId || request.videoProviderId || 'video-1').trim() || 'video-1';
    const rates = VIDEO_RATES[providerId] || VIDEO_RATES['video-1'];
    const requestedResolution = String(request.resolution || '').trim().toUpperCase();
    const defaultResolution = VIDEO_DEFAULT_RESOLUTIONS[providerId] || '768P';
    const resolution = Object.hasOwn(rates, requestedResolution) ? requestedResolution : defaultResolution;
    const duration = boundedInteger(request.duration, 6, 4, 15);
    const perSecond = rates[resolution];
    return {
      kind,
      providerId,
      resolution,
      duration,
      units: duration,
      unit: 'second',
      unitCredits: perSecond,
      totalCredits: perSecond * duration
    };
  }

  const providerId = String(request.providerId || request.imageProviderId || 'image-1').trim() || 'image-1';
  const count = boundedInteger(request.count, 1, 1, 4);
  const qualityRates = IMAGE_QUALITY_PRICES[providerId];
  const requestedQuality = String(request.quality || 'auto').trim().toLowerCase();
  const quality = qualityRates && Object.hasOwn(qualityRates, requestedQuality) ? requestedQuality : 'auto';
  const perImage = qualityRates
    ? qualityRates[quality]
    : (Number.isFinite(IMAGE_PRICES[providerId]) ? IMAGE_PRICES[providerId] : IMAGE_PRICES['image-1']);
  return {
    kind,
    providerId,
    ...(qualityRates ? { quality } : {}),
    count,
    units: count,
    unit: 'image',
    unitCredits: perImage,
    totalCredits: perImage * count
  };
}

function publicCreditPricing() {
  return {
    currency: 'points',
    pointsPerCny: POINTS_PER_CNY,
    image: { ...IMAGE_PRICES },
    imageQuality: Object.fromEntries(Object.entries(IMAGE_QUALITY_PRICES).map(([id, rates]) => [id, { ...rates }])),
    video: Object.fromEntries(Object.entries(VIDEO_RATES).map(([id, rates]) => [id, { ...rates }]))
  };
}

module.exports = {
  POINTS_PER_CNY,
  IMAGE_PRICES,
  IMAGE_QUALITY_PRICES,
  VIDEO_RATES,
  VIDEO_DEFAULT_RESOLUTIONS,
  quoteMediaCredits,
  publicCreditPricing
};
