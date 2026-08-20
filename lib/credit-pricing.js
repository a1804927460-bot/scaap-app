'use strict';

// Retail points are intentionally kept separate from provider endpoints.
// 10 points represent CNY 1. Every table below is the current observed
// upstream cost plus CNY 1.4 profit, rounded up to a whole point so rounding
// can never turn a request into a loss. Video adds the profit once per job,
// after resolution x duration has produced the complete upstream cost.
const POINTS_PER_CNY = 10;
const PROFIT_PER_REQUEST_CNY = 1.4;
const PROFIT_PER_REQUEST_CREDITS = PROFIT_PER_REQUEST_CNY * POINTS_PER_CNY;
// Bump this whenever a retail table or its settlement formula changes. The
// desktop client uses it to reject quotes from a rolling gateway deployment
// that still serves an older table.
const CREDIT_PRICING_VERSION = '202608200002';
const MINIMUM_VIDEO_CREDITS = 30;
// 302 and Atlas quote in USD (302 calls the same unit PTC). Use a protective
// settlement FX rate so a generation cannot become a loss between quote and
// settlement. One app point is CNY 0.1.
const USD_TO_CNY = 7.3;
const PTC_TO_CREDITS = USD_TO_CNY * POINTS_PER_CNY;

// The verified 302 Seedance 2.5 quote is 2.592 PTC for a ten-second 720P
// output (0.2592 PTC/sec). 4K-ESR is a separate enhancement charge: 22.780
// PTC per ten-second output, not 22.780 points/sec. Keep that distinction
// explicit so high-resolution jobs cannot be underquoted.
const SEEDANCE_720P_PTC_PER_SECOND = 0.2592;
const SEEDANCE_480P_PTC_PER_SECOND = SEEDANCE_720P_PTC_PER_SECOND * 0.5;
const SEEDANCE_25_4K_ESR_PTC_PER_SECOND = 22.780 / 10;
const SEEDANCE_PTC_PER_SECOND = Object.freeze({
  'video-2': Object.freeze({
    '480P': SEEDANCE_480P_PTC_PER_SECOND * (7.884 / 10),
    '720P': SEEDANCE_720P_PTC_PER_SECOND * (7.884 / 10)
  }),
  'video-3': Object.freeze({
    '480P': SEEDANCE_480P_PTC_PER_SECOND,
    '720P': SEEDANCE_720P_PTC_PER_SECOND
  }),
  'video-4': Object.freeze({
    '480P': SEEDANCE_480P_PTC_PER_SECOND * (6.516 / 10),
    '720P': SEEDANCE_720P_PTC_PER_SECOND * (6.516 / 10)
  })
});

const SEEDANCE_VIDEO_RATES = Object.freeze(Object.fromEntries(
  Object.entries(SEEDANCE_PTC_PER_SECOND).map(([providerId, rates]) => [
    providerId,
    Object.freeze(Object.fromEntries(
      Object.entries(rates).map(([resolution, ptcPerSecond]) => [
        resolution,
        Number((ptcPerSecond * PTC_TO_CREDITS).toFixed(9))
      ])
    ))
  ])
));

function retailCreditsFromUpstreamCny(upstreamCostCny) {
  const cost = Number(upstreamCostCny);
  if (!Number.isFinite(cost) || cost < 0) {
    throw new TypeError('Upstream cost must be a non-negative CNY amount.');
  }
  return Math.ceil((cost + PROFIT_PER_REQUEST_CNY) * POINTS_PER_CNY);
}

const IMAGE_PRICES = Object.freeze({
  'atlas-image-gpt2': 15,
  'atlas-image-gpt2-edit': 15,
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
  'image-16': 16, // Jimeng Drawing, 512px
  'image-17': 16, // Legnext Midjourney V8.1, standard
  'image-18': 16  // Legnext Midjourney V8.2, standard
});

const IMAGE_QUALITY_PRICES = Object.freeze({
  'image-6': Object.freeze({ low: 15, medium: 19, high: 30, auto: 19 }),
  'atlas-image-gpt2': Object.freeze({ low: 15, medium: 19, high: 30, auto: 19 }),
  'atlas-image-gpt2-edit': Object.freeze({ low: 16, medium: 20, high: 31, auto: 20 })
});

const IMAGE_QUALITY_RESOLUTION_PRICES = Object.freeze({
  'image-6': Object.freeze({
    low: Object.freeze({ '1k': 15, '2k': 16, '4k': 16 }),
    medium: Object.freeze({ '1k': 19, '2k': 23, '4k': 22 }),
    high: Object.freeze({ '1k': 30, '2k': 46, '4k': 44 }),
    auto: Object.freeze({ '1k': 19, '2k': 23, '4k': 22 })
  }),
  'atlas-image-gpt2': Object.freeze({
    low: Object.freeze({ '1k': 15, '2k': 16, '4k': 16 }),
    medium: Object.freeze({ '1k': 19, '2k': 23, '4k': 22 }),
    high: Object.freeze({ '1k': 30, '2k': 46, '4k': 44 }),
    auto: Object.freeze({ '1k': 19, '2k': 23, '4k': 22 })
  }),
  'atlas-image-gpt2-edit': Object.freeze({
    low: Object.freeze({ '1k': 16, '2k': 17, '4k': 17 }),
    medium: Object.freeze({ '1k': 20, '2k': 24, '4k': 23 }),
    high: Object.freeze({ '1k': 31, '2k': 47, '4k': 45 }),
    auto: Object.freeze({ '1k': 20, '2k': 24, '4k': 23 })
  })
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
  'image-16': Object.freeze({ '512x512': 16, '1024x1024': 16 }),
  // Legnext documents native 2K HD at 1.5x its standard cost. The app's
  // retail table keeps the same Midjourney baseline and rounds HD upward.
  'image-17': Object.freeze({ '1k': 16, '2k': 24 }),
  'image-18': Object.freeze({ '1k': 16, '2k': 24 })
});

const IMAGE_DEFAULT_RESOLUTIONS = Object.freeze({
  'image-17': '1k',
  'image-18': '1k'
});

const VIDEO_RATES = Object.freeze({
  'atlas-video-seedance20-i2v': Object.freeze({
    '480P': 8.268929, '720P': 17.7828, '720P-SR': 14.88408, '1080P': 40.0113,
    '1080P-SR': 32.00904, '1440P-SR': 56.90496, '4K': 91.225764
  }),
  'atlas-video-seedance20-ref': Object.freeze({
    '480P': 8.268929, '720P': 17.7828, '720P-SR': 14.88408, '1080P': 40.0113,
    '1080P-SR': 32.00904, '1440P-SR': 56.90496, '4K': 91.225764
  }),
  'atlas-video-seedance25-i2v': Object.freeze({
    '480P': 10.269725, '720P': 22.085603, '720P-SR': 16.123462, '720P-ESR': 18.485498,
    '1080P': 43.469408, '1080P-SR': 29.815561, '1080P-ESR': 33.128398,
    '1080P-ESR & 60FPS': 36.441248, '1440P-SR': 51.454793, '1440P-ESR': 55.876573,
    '4K-ESR': Number((SEEDANCE_25_4K_ESR_PTC_PER_SECOND * PTC_TO_CREDITS).toFixed(9))
  }),
  'atlas-video-seedance25-ref': Object.freeze({
    '480P': 10.269725, '720P': 22.085603, '720P-SR': 16.123462, '720P-ESR': 18.485498,
    '1080P': 43.469408, '1080P-SR': 29.815561, '1080P-ESR': 33.128398,
    '1080P-ESR & 60FPS': 36.441248, '1440P-SR': 51.454793, '1440P-ESR': 55.876573,
    '4K-ESR': Number((SEEDANCE_25_4K_ESR_PTC_PER_SECOND * PTC_TO_CREDITS).toFixed(9))
  }),
  'video-1': Object.freeze({
    '768P': 5,
    '2K': 8
  }),
  // Logical Seedance providers are billed against the most expensive
  // available route for each resolution. 480P/720P use the USD-denominated
  // 302 fallback when it is higher; Atlas-only higher tiers use the Atlas
  // catalog price. This keeps an Atlas failure from turning into a loss.
  'video-2': Object.freeze({
    '480P': 8.268929, '720P': 17.7828, '720P-SR': 14.88408, '1080P': 40.0113,
    '1080P-SR': 32.00904, '1440P-SR': 56.90496, '4K': 91.225764
  }),
  'video-3': Object.freeze({
    '480P': 10.269725, '720P': 22.085603, '720P-SR': 16.123462, '720P-ESR': 18.485498,
    '1080P': 43.469408, '1080P-SR': 29.815561, '1080P-ESR': 33.128398,
    '1080P-ESR & 60FPS': 36.441248, '1440P-SR': 51.454793,
    '1440P-ESR': 55.876573,
    '4K-ESR': Number((SEEDANCE_25_4K_ESR_PTC_PER_SECOND * PTC_TO_CREDITS).toFixed(9))
  }),
  'video-4': SEEDANCE_VIDEO_RATES['video-4'],
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
  'atlas-video-seedance20-i2v': '720P',
  'atlas-video-seedance20-ref': '720P',
  'atlas-video-seedance25-i2v': '720P',
  'atlas-video-seedance25-ref': '720P',
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
  'atlas-video-seedance20-i2v': Object.freeze({ minimum: 4, maximum: 15 }),
  'atlas-video-seedance20-ref': Object.freeze({ minimum: 4, maximum: 15 }),
  'atlas-video-seedance25-i2v': Object.freeze({ minimum: 4, maximum: 30 }),
  'atlas-video-seedance25-ref': Object.freeze({ minimum: 4, maximum: 30 }),
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

const VIDEO_SERVICE_TIER_PROVIDERS = Object.freeze({
  'video-10': Object.freeze({ standard: 'video-10', pro: 'video-11' }),
  'video-12': Object.freeze({ standard: 'video-12', pro: 'video-13' })
});

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function videoBillingProviderId(providerId, request = {}) {
  const normalizedProviderId = String(providerId || '').trim().toLowerCase();
  const tierProviders = VIDEO_SERVICE_TIER_PROVIDERS[normalizedProviderId];
  if (!tierProviders) return normalizedProviderId;

  const requestedTier = String(request.serviceTier || '').trim().toLowerCase();
  if (Object.hasOwn(tierProviders, requestedTier)) return tierProviders[requestedTier];

  const requestedResolution = String(request.resolution || '').trim().toUpperCase();
  const resolutionProvider = Object.values(tierProviders).find((candidateId) => (
    Object.hasOwn(VIDEO_RATES[candidateId] || {}, requestedResolution)
  ));
  return resolutionProvider || tierProviders.standard;
}

function quoteMediaCredits(request = {}) {
  const kind = request.kind === 'video' ? 'video' : 'image';
  if (kind === 'video') {
    const requestedProviderId = String(request.providerId || request.videoProviderId || 'video-1').trim() || 'video-1';
    const providerId = videoBillingProviderId(requestedProviderId, request);
    const rates = VIDEO_RATES[providerId] || VIDEO_RATES['video-1'];
    const requestedResolution = String(request.resolution || '').trim().toUpperCase();
    const defaultResolution = VIDEO_DEFAULT_RESOLUTIONS[providerId] || '768P';
    const resolution = Object.hasOwn(rates, requestedResolution) ? requestedResolution : defaultResolution;
    const durationLimits = VIDEO_DURATION_LIMITS[providerId] || VIDEO_DURATION_LIMITS['video-1'];
    const duration = Number(request.duration) === -1
      ? durationLimits.maximum
      : boundedInteger(request.duration, 6, durationLimits.minimum, durationLimits.maximum);
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
  const qualityResolutionRates = IMAGE_QUALITY_RESOLUTION_PRICES[providerId];
  const resolutionRates = IMAGE_RESOLUTION_PRICES[providerId];
  const requestedQuality = String(request.quality || 'auto').trim().toLowerCase();
  const quality = qualityRates && Object.hasOwn(qualityRates, requestedQuality) ? requestedQuality : 'auto';
  const defaultResolution = qualityResolutionRates
    ? '1k'
    : resolutionRates
    ? (IMAGE_DEFAULT_RESOLUTIONS[providerId] || (Object.hasOwn(resolutionRates, '2k') ? '2k' : Object.keys(resolutionRates)[0]))
    : '720p';
  const requestedResolution = String(request.resolution || request.size || defaultResolution).trim().toLowerCase();
  const selectedQualityRates = qualityResolutionRates && qualityResolutionRates[quality];
  const resolution = selectedQualityRates && Object.hasOwn(selectedQualityRates, requestedResolution)
    ? requestedResolution
    : qualityResolutionRates
      ? defaultResolution
      : resolutionRates && Object.hasOwn(resolutionRates, requestedResolution)
    ? requestedResolution
    : defaultResolution;
  const perImage = qualityRates
    ? (selectedQualityRates ? selectedQualityRates[resolution] : qualityRates[quality])
    : resolutionRates
      ? resolutionRates[resolution]
    : (Number.isFinite(IMAGE_PRICES[providerId]) ? IMAGE_PRICES[providerId] : IMAGE_PRICES['image-1']);
  return {
    kind,
    providerId,
    ...(qualityRates ? { quality } : {}),
    ...((qualityResolutionRates || resolutionRates) ? { resolution } : {}),
    count,
    units: count,
    unit: 'image',
    unitCredits: perImage,
    totalCredits: perImage * count
  };
}

function conservativeMediaCreditQuote(localQuote, remoteQuote, request = {}) {
  const local = localQuote && typeof localQuote === 'object' ? localQuote : {};
  const remote = remoteQuote && typeof remoteQuote === 'object' ? remoteQuote : {};
  const localTotalCredits = Math.max(0, Math.ceil(Number(local.totalCredits) || 0));
  const localUnitCredits = Math.max(0, Number(local.unitCredits) || 0);
  const remoteTotalCredits = Math.max(0, Math.ceil(Number(remote.totalCredits) || 0));
  const remoteUnitCredits = Math.max(0, Number(remote.unitCredits) || 0);
  if (!remoteTotalCredits || !remoteUnitCredits) return localQuote;

  const unitCredits = Math.max(localUnitCredits, remoteUnitCredits);
  const count = local.kind === 'image'
    ? boundedInteger(local.count ?? remote.count ?? request.count, 1, 1, 4)
    : 1;
  const duration = local.kind === 'video'
    ? boundedInteger(
      local.duration ?? remote.duration ?? request.duration,
      6,
      1,
      30
    )
    : 0;
  const fixedCredits = local.kind === 'video'
    ? Math.max(14, Number(local.fixedCredits) || 0, Number(remote.fixedCredits) || 0)
    : 0;
  const minimumCredits = local.kind === 'video'
    ? Math.max(30, Number(local.minimumCredits) || 0, Number(remote.minimumCredits) || 0)
    : 0;
  return {
    ...remote,
    ...local,
    unitCredits,
    totalCredits: Math.max(
      localTotalCredits,
      remoteTotalCredits,
      unitCredits * count,
      local.kind === 'video' ? Math.max(minimumCredits, Math.ceil(unitCredits * duration + fixedCredits)) : 0
    )
  };
}

function publicCreditPricing() {
  return {
    pricingVersion: CREDIT_PRICING_VERSION,
    currency: 'points',
    pointsPerCny: POINTS_PER_CNY,
    profitPerRequestCny: PROFIT_PER_REQUEST_CNY,
    minimumVideoCredits: MINIMUM_VIDEO_CREDITS,
    image: { ...IMAGE_PRICES },
    imageQuality: Object.fromEntries(Object.entries(IMAGE_QUALITY_PRICES).map(([id, rates]) => [id, { ...rates }])),
    imageQualityResolution: Object.fromEntries(Object.entries(IMAGE_QUALITY_RESOLUTION_PRICES).map(([id, qualities]) => [
      id,
      Object.fromEntries(Object.entries(qualities).map(([quality, rates]) => [quality, { ...rates }]))
    ])),
    imageResolution: Object.fromEntries(Object.entries(IMAGE_RESOLUTION_PRICES).map(([id, rates]) => [id, { ...rates }])),
    video: Object.fromEntries(Object.entries(VIDEO_RATES).map(([id, rates]) => [id, { ...rates }]))
  };
}

module.exports = {
  CREDIT_PRICING_VERSION,
  POINTS_PER_CNY,
  PROFIT_PER_REQUEST_CNY,
  PROFIT_PER_REQUEST_CREDITS,
  USD_TO_CNY,
  PTC_TO_CREDITS,
  SEEDANCE_PTC_PER_SECOND,
  MINIMUM_VIDEO_CREDITS,
  retailCreditsFromUpstreamCny,
  IMAGE_PRICES,
  IMAGE_QUALITY_PRICES,
  IMAGE_QUALITY_RESOLUTION_PRICES,
  IMAGE_RESOLUTION_PRICES,
  IMAGE_DEFAULT_RESOLUTIONS,
  VIDEO_RATES,
  VIDEO_DEFAULT_RESOLUTIONS,
  VIDEO_DURATION_LIMITS,
  VIDEO_SERVICE_TIER_PROVIDERS,
  videoBillingProviderId,
  quoteMediaCredits,
  conservativeMediaCreditQuote,
  publicCreditPricing
};
