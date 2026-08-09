'use strict';

// Retail points are intentionally kept separate from provider endpoints. One
// 10 points represent CNY 1 at the future recharge boundary. The current
// retail table is approximately 2x the observed upstream cost so provider
// price movement, failed retries, storage and support remain covered.
const POINTS_PER_CNY = 10;

const IMAGE_PRICES = Object.freeze({
  'image-1': 16, // Nano Banana Pro
  'image-2': 12, // Nano Banana 2, 2K default
  'image-3': 5,  // Seedream 5.0
  'image-4': 4,  // Midjourney imagine
  'image-5': 4,  // Nano Banana 2 Lite
  'image-6': 12, // GPT Image 2, automatic quality
  'image-7': 4,  // Higgsfield Soul Standard, 720p
  'image-8': 4,  // Higgsfield Soul, 720p
  'image-9': 6,  // Nano Banana
  'image-10': 8, // Seedream 5.0 Pro, 2K
  'image-11': 5, // Seedream 4.5, 2K
  'image-12': 4, // Seedream 4.0, 1K
  'image-13': 3, // Seedream 3.0
  'image-14': 4, // SeedEdit 3.0
  'image-15': 5, // Kling Image 2, 1K
  'image-16': 3  // Jimeng Drawing, 512px
});

const IMAGE_QUALITY_PRICES = Object.freeze({
  'image-6': Object.freeze({ low: 3, medium: 8, high: 28, auto: 12 })
});

const IMAGE_RESOLUTION_PRICES = Object.freeze({
  'image-1': Object.freeze({ '1k': 16, '2k': 16, '4k': 28 }),
  'image-2': Object.freeze({ '1k': 8, '2k': 12, '4k': 16 }),
  'image-3': Object.freeze({ '2k': 5, '4k': 8 }),
  'image-7': Object.freeze({ '720p': 4, '1080p': 8 }),
  'image-8': Object.freeze({ '720p': 4, '1080p': 8 }),
  'image-10': Object.freeze({ '2k': 8, '4k': 14 }),
  'image-11': Object.freeze({ '2k': 5, '4k': 8 }),
  'image-12': Object.freeze({ '1k': 4, '2k': 5, '4k': 8 }),
  'image-15': Object.freeze({ '1k': 5, '2k': 8 }),
  'image-16': Object.freeze({ '512x512': 3, '1024x1024': 4 })
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
  }),
  'video-4': Object.freeze({ '480P': 3, '720P': 5 }),
  'video-5': Object.freeze({ '480P': 4, '720P': 6 }),
  'video-6': Object.freeze({ '480P': 4, '720P': 6, '1080P': 8 }),
  'video-7': Object.freeze({ '480P': 3, '720P': 5 }),
  'video-8': Object.freeze({ '720P': 1, '1080P': 2 }),
  'video-9': Object.freeze({ '1080P': 4 })
});

const VIDEO_DEFAULT_RESOLUTIONS = Object.freeze({
  'video-1': '768P',
  'video-2': '720P',
  'video-3': '720P',
  'video-4': '720P',
  'video-5': '720P',
  'video-6': '1080P',
  'video-7': '720P',
  'video-8': '720P',
  'video-9': '1080P'
});

const VIDEO_DURATION_LIMITS = Object.freeze({
  'video-1': Object.freeze({ minimum: 4, maximum: 15 }),
  'video-2': Object.freeze({ minimum: 4, maximum: 15 }),
  'video-3': Object.freeze({ minimum: 4, maximum: 15 }),
  'video-4': Object.freeze({ minimum: 4, maximum: 15 }),
  'video-5': Object.freeze({ minimum: 2, maximum: 12 }),
  'video-6': Object.freeze({ minimum: 2, maximum: 12 }),
  'video-7': Object.freeze({ minimum: 2, maximum: 12 }),
  'video-8': Object.freeze({ minimum: 5, maximum: 10 }),
  'video-9': Object.freeze({ minimum: 5, maximum: 10 })
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
    const durationLimits = VIDEO_DURATION_LIMITS[providerId] || VIDEO_DURATION_LIMITS['video-1'];
    const duration = boundedInteger(request.duration, 6, durationLimits.minimum, durationLimits.maximum);
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
  const resolutionRates = IMAGE_RESOLUTION_PRICES[providerId];
  const requestedQuality = String(request.quality || 'auto').trim().toLowerCase();
  const quality = qualityRates && Object.hasOwn(qualityRates, requestedQuality) ? requestedQuality : 'auto';
  const defaultResolution = resolutionRates
    ? (Object.hasOwn(resolutionRates, '2k') ? '2k' : Object.keys(resolutionRates)[0])
    : '720p';
  const requestedResolution = String(request.resolution || request.size || defaultResolution).trim().toLowerCase();
  const resolution = resolutionRates && Object.hasOwn(resolutionRates, requestedResolution)
    ? requestedResolution
    : defaultResolution;
  const perImage = qualityRates
    ? qualityRates[quality]
    : resolutionRates
      ? resolutionRates[resolution]
    : (Number.isFinite(IMAGE_PRICES[providerId]) ? IMAGE_PRICES[providerId] : IMAGE_PRICES['image-1']);
  return {
    kind,
    providerId,
    ...(qualityRates ? { quality } : {}),
    ...(resolutionRates ? { resolution } : {}),
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
    imageResolution: Object.fromEntries(Object.entries(IMAGE_RESOLUTION_PRICES).map(([id, rates]) => [id, { ...rates }])),
    video: Object.fromEntries(Object.entries(VIDEO_RATES).map(([id, rates]) => [id, { ...rates }]))
  };
}

module.exports = {
  POINTS_PER_CNY,
  IMAGE_PRICES,
  IMAGE_QUALITY_PRICES,
  IMAGE_RESOLUTION_PRICES,
  VIDEO_RATES,
  VIDEO_DEFAULT_RESOLUTIONS,
  VIDEO_DURATION_LIMITS,
  quoteMediaCredits,
  publicCreditPricing
};
