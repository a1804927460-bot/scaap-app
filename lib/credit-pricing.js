'use strict';

// Retail points are intentionally kept separate from provider endpoints.
// 10 points represent CNY 1. Every table below is the current observed
// upstream cost plus CNY 1.4 profit, rounded up to a whole point so rounding
// can never turn a request into a loss. Video adds the profit once per job,
// after resolution x duration has produced the complete upstream cost.
const POINTS_PER_CNY = 10;
const PROFIT_PER_REQUEST_CNY = 1.4;
const PROFIT_PER_REQUEST_CREDITS = PROFIT_PER_REQUEST_CNY * POINTS_PER_CNY;
const MINIMUM_VIDEO_CREDITS = 30;

function retailCreditsFromUpstreamCny(upstreamCostCny) {
  const cost = Number(upstreamCostCny);
  if (!Number.isFinite(cost) || cost < 0) {
    throw new TypeError('Upstream cost must be a non-negative CNY amount.');
  }
  return Math.ceil((cost + PROFIT_PER_REQUEST_CNY) * POINTS_PER_CNY);
}

const IMAGE_PRICES = Object.freeze({
  'image-1': 22, // Nano Banana Pro
  'image-2': 20, // Nano Banana 2, 2K default
  'image-3': 17, // Seedream 5.0
  'image-4': 16, // Midjourney imagine
  'image-5': 16, // Nano Banana 2 Lite
  'image-6': 20, // GPT Image 2, automatic quality
  'image-7': 16, // Higgsfield Soul Standard, 720p
  'image-8': 16, // Higgsfield Soul, 720p
  'image-9': 17, // Nano Banana
  'image-10': 18, // Seedream 5.0 Pro, 2K
  'image-11': 17, // Seedream 4.5, 2K
  'image-12': 16, // Seedream 4.0, 1K
  'image-13': 16, // Seedream 3.0
  'image-14': 16, // SeedEdit 3.0
  'image-15': 17, // Kling Image 2, 1K
  'image-16': 16  // Jimeng Drawing, 512px
});

const IMAGE_QUALITY_PRICES = Object.freeze({
  'image-6': Object.freeze({ low: 16, medium: 18, high: 28, auto: 20 })
});

const IMAGE_RESOLUTION_PRICES = Object.freeze({
  'image-1': Object.freeze({ '1k': 22, '2k': 22, '4k': 28 }),
  'image-2': Object.freeze({ '1k': 18, '2k': 20, '4k': 22 }),
  'image-3': Object.freeze({ '2k': 17, '4k': 18 }),
  'image-7': Object.freeze({ '720p': 16, '1080p': 18 }),
  'image-8': Object.freeze({ '720p': 16, '1080p': 18 }),
  'image-10': Object.freeze({ '2k': 18, '4k': 21 }),
  'image-11': Object.freeze({ '2k': 17, '4k': 18 }),
  'image-12': Object.freeze({ '1k': 16, '2k': 17, '4k': 18 }),
  'image-15': Object.freeze({ '1k': 17, '2k': 18 }),
  'image-16': Object.freeze({ '512x512': 16, '1024x1024': 16 })
});

const VIDEO_RATES = Object.freeze({
  'video-1': Object.freeze({
    '768P': 5,
    '2K': 8
  }),
  'video-2': Object.freeze({
    '480P': 1.5,
    '720P': 2.5
  }),
  'video-3': Object.freeze({
    '480P': 2,
    '720P': 3
  }),
  'video-4': Object.freeze({ '480P': 1.5, '720P': 2.5 }),
  'video-5': Object.freeze({ '480P': 2, '720P': 3 }),
  'video-6': Object.freeze({ '480P': 2, '720P': 3, '1080P': 4 }),
  'video-7': Object.freeze({ '480P': 1.5, '720P': 2.5 }),
  'video-8': Object.freeze({ '720P': 0.5, '1080P': 1 }),
  'video-9': Object.freeze({ '1080P': 2 }),
  // Kling prices are documented in USD/PTC per second. These rates use a
  // conservative USD/CNY conversion of 7.3 and round upward before the
  // fixed retail profit is added, so audio-enabled requests cannot undercharge.
  'video-10': Object.freeze({ '720P': 18.4 }),
  'video-11': Object.freeze({ '1080P': 24.6 }),
  // O3 uses separate 302 endpoints for image-to-video, reference-to-video,
  // and video-edit. The rates below use the highest documented sound-on /
  // reference-video rate for each tier so every supported mode is covered.
  'video-12': Object.freeze({ '720P': 21.9 }),
  'video-13': Object.freeze({ '1080P': 26.3 })
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
  'video-9': '1080P',
  'video-10': '720P',
  'video-11': '1080P',
  'video-12': '720P',
  'video-13': '1080P'
});

const VIDEO_DURATION_LIMITS = Object.freeze({
  'video-1': Object.freeze({ minimum: 4, maximum: 15 }),
  'video-2': Object.freeze({ minimum: 4, maximum: 15 }),
  'video-3': Object.freeze({ minimum: 4, maximum: 30 }),
  'video-4': Object.freeze({ minimum: 4, maximum: 15 }),
  'video-5': Object.freeze({ minimum: 2, maximum: 12 }),
  'video-6': Object.freeze({ minimum: 2, maximum: 12 }),
  'video-7': Object.freeze({ minimum: 2, maximum: 12 }),
  'video-8': Object.freeze({ minimum: 5, maximum: 10 }),
  'video-9': Object.freeze({ minimum: 5, maximum: 10 }),
  'video-10': Object.freeze({ minimum: 3, maximum: 15 }),
  'video-11': Object.freeze({ minimum: 3, maximum: 15 }),
  'video-12': Object.freeze({ minimum: 3, maximum: 15 }),
  'video-13': Object.freeze({ minimum: 3, maximum: 15 })
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
      fixedCredits: PROFIT_PER_REQUEST_CREDITS,
      minimumCredits: MINIMUM_VIDEO_CREDITS,
      totalCredits: Math.max(
        MINIMUM_VIDEO_CREDITS,
        Math.ceil(perSecond * duration + PROFIT_PER_REQUEST_CREDITS)
      )
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
    profitPerRequestCny: PROFIT_PER_REQUEST_CNY,
    minimumVideoCredits: MINIMUM_VIDEO_CREDITS,
    image: { ...IMAGE_PRICES },
    imageQuality: Object.fromEntries(Object.entries(IMAGE_QUALITY_PRICES).map(([id, rates]) => [id, { ...rates }])),
    imageResolution: Object.fromEntries(Object.entries(IMAGE_RESOLUTION_PRICES).map(([id, rates]) => [id, { ...rates }])),
    video: Object.fromEntries(Object.entries(VIDEO_RATES).map(([id, rates]) => [id, { ...rates }]))
  };
}

module.exports = {
  POINTS_PER_CNY,
  PROFIT_PER_REQUEST_CNY,
  PROFIT_PER_REQUEST_CREDITS,
  MINIMUM_VIDEO_CREDITS,
  retailCreditsFromUpstreamCny,
  IMAGE_PRICES,
  IMAGE_QUALITY_PRICES,
  IMAGE_RESOLUTION_PRICES,
  VIDEO_RATES,
  VIDEO_DEFAULT_RESOLUTIONS,
  VIDEO_DURATION_LIMITS,
  quoteMediaCredits,
  publicCreditPricing
};
