'use strict';

// Retail points are intentionally kept separate from provider endpoints.
// 10 points represent CNY 1. Retail is the verified upstream cost plus a
// 30% margin after a 10% estimate buffer, rounded up so a request cannot
// undercharge. The successful reservation is the final charge.
const POINTS_PER_CNY = 10;
const RETAIL_MARKUP_PERCENT = 30;
const RETAIL_MULTIPLIER = 1 + RETAIL_MARKUP_PERCENT / 100;
const UPSTREAM_COST_SAFETY_PERCENT = 10;
const UPSTREAM_COST_SAFETY_MULTIPLIER = 1 + UPSTREAM_COST_SAFETY_PERCENT / 100;
// Kept as zero-valued compatibility exports for older desktop bundles. New
// callers must use the proportional markup constants above.
const PROFIT_PER_REQUEST_CNY = 0;
const PROFIT_PER_REQUEST_CREDITS = 0;
// Bump this whenever a retail table or its settlement formula changes. The
// desktop client uses it to reject quotes from a rolling gateway deployment
// that still serves an older table.
const CREDIT_PRICING_VERSION = '202608210004';
const MINIMUM_VIDEO_CREDITS = 0;
// 302 and Atlas quote in USD (302 calls the same unit PTC). Use a protective
// settlement FX rate so a generation cannot become a loss between quote and
// settlement. One app point is CNY 0.1.
const USD_TO_CNY = 7.3;
const PTC_TO_CREDITS = USD_TO_CNY * POINTS_PER_CNY;
// Chat providers do not expose a dependable preflight quote. Reserve a full
// USD of upstream spend for each bounded 4096-token request, then keep the
// reservation on success. This is intentionally a fail-closed ceiling.
const CHAT_UPSTREAM_PTC_RESERVE = 1;
const CHAT_CREDITS = Math.ceil(
  CHAT_UPSTREAM_PTC_RESERVE * PTC_TO_CREDITS
    * UPSTREAM_COST_SAFETY_MULTIPLIER * RETAIL_MULTIPLIER
);

// The verified 302 Seedance 2.5 quote is 2.592 PTC for a ten-second 720P
// output (0.2592 PTC/sec). 4K-ESR is a separate enhancement charge quoted
// per complete job, not per second. Keep that distinction explicit so
// high-resolution jobs cannot be underquoted.
const SEEDANCE_720P_PTC_PER_SECOND = 0.2592;
const SEEDANCE_480P_PTC_PER_SECOND = SEEDANCE_720P_PTC_PER_SECOND * 0.5;
// Atlas/302 billing currently reports 23.11727243 PTC for a ten-second
// Seedance 2.5 4K-ESR job. Keep the exact provider quote instead of the older
// 22.780 estimate, then apply the same guarded retail formula as every job.
const SEEDANCE_25_4K_ESR_PTC_PER_JOB = 23.11727243;
const SEEDANCE_25_4K_ESR_PTC_PER_SECOND = SEEDANCE_25_4K_ESR_PTC_PER_JOB / 10;
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
  return Math.ceil(cost * UPSTREAM_COST_SAFETY_MULTIPLIER * RETAIL_MULTIPLIER * POINTS_PER_CNY);
}

function retailCreditsFromUpstreamPoints(upstreamPoints) {
  const cost = Number(upstreamPoints);
  if (!Number.isFinite(cost) || cost < 0) {
    throw new TypeError('Upstream cost must be a non-negative point amount.');
  }
  return Math.ceil(cost * UPSTREAM_COST_SAFETY_MULTIPLIER * RETAIL_MULTIPLIER);
}

function retailRateTable(upstreamRates) {
  return Object.freeze(Object.fromEntries(Object.entries(upstreamRates).map(([key, value]) => [
    key, retailCreditsFromUpstreamPoints(value)
  ])));
}

function retailNestedRateTable(upstreamRates) {
  return Object.freeze(Object.fromEntries(Object.entries(upstreamRates).map(([key, rates]) => [
    key, retailRateTable(rates)
  ])));
}

// Static provider costs are app-point equivalents after the upstream unit has
// been converted. CNY providers multiply by 10 directly; USD/PTC providers
// multiply by the protected 7.3 CNY/USD rate first.
const IMAGE_UPSTREAM_CREDITS = Object.freeze({
  'atlas-image-gpt2': 1,
  'atlas-image-gpt2-edit': 1,
  'image-1': 0.14 * PTC_TO_CREDITS, 'image-2': 6, 'image-3': 0.043 * PTC_TO_CREDITS, 'image-4': 2,
  'image-5': 2, 'image-6': 1, 'image-7': 2, 'image-8': 2,
  'image-9': 3, 'image-10': 4, 'image-11': 3, 'image-12': 2,
  'image-13': 2, 'image-14': 2, 'image-15': 3, 'image-16': 2,
  'image-17': 0.08 * PTC_TO_CREDITS, 'image-18': 0.08 * PTC_TO_CREDITS
});
const IMAGE_PRICES_BASE = retailRateTable(IMAGE_UPSTREAM_CREDITS);

// GPT Image 2 output pricing is token based. These are conservative retail
// ceilings calculated from the official output-token formula. A separate 25
// point reserve covers the maximum prompt and ten uncached reference images.
const GPT_IMAGE_2_MAX_INPUT_RETAIL_CREDITS = 25;
const GPT_IMAGE_2_OUTPUT_RETAIL_CREDITS = Object.freeze({
  low: Object.freeze({ '1k': 1, '2k': 2, '4k': 3 }),
  medium: Object.freeze({ '1k': 6, '2k': 12, '4k': 19 }),
  high: Object.freeze({ '1k': 22, '2k': 45, '4k': 75 }),
  // The provider can choose the expensive tier for auto, so reserve high.
  auto: Object.freeze({ '1k': 22, '2k': 45, '4k': 75 })
});
const GPT_IMAGE_2_RETAIL_CREDITS = Object.freeze(Object.fromEntries(
  Object.entries(GPT_IMAGE_2_OUTPUT_RETAIL_CREDITS).map(([quality, rates]) => [
    quality,
    Object.freeze(Object.fromEntries(Object.entries(rates).map(([resolution, credits]) => [
      resolution, credits + GPT_IMAGE_2_MAX_INPUT_RETAIL_CREDITS
    ])))
  ])
));

const IMAGE_QUALITY_UPSTREAM_CREDITS = Object.freeze({
  'image-6': Object.freeze({ low: 1, medium: 5, high: 16, auto: 5 }),
  'atlas-image-gpt2': Object.freeze({ low: 1, medium: 5, high: 16, auto: 5 }),
  'atlas-image-gpt2-edit': Object.freeze({ low: 2, medium: 6, high: 17, auto: 6 })
});
const IMAGE_QUALITY_PRICES = Object.freeze({
  'image-6': Object.freeze(Object.fromEntries(Object.entries(GPT_IMAGE_2_RETAIL_CREDITS).map(([quality, rates]) => [quality, rates['1k']]))),
  'atlas-image-gpt2': Object.freeze(Object.fromEntries(Object.entries(GPT_IMAGE_2_RETAIL_CREDITS).map(([quality, rates]) => [quality, rates['1k']]))),
  'atlas-image-gpt2-edit': Object.freeze(Object.fromEntries(Object.entries(GPT_IMAGE_2_RETAIL_CREDITS).map(([quality, rates]) => [quality, rates['1k']]))),
});

const IMAGE_QUALITY_RESOLUTION_UPSTREAM_CREDITS = Object.freeze({
  'image-6': Object.freeze({
    low: Object.freeze({ '1k': 1, '2k': 2, '4k': 2 }),
    medium: Object.freeze({ '1k': 5, '2k': 9, '4k': 8 }),
    high: Object.freeze({ '1k': 16, '2k': 32, '4k': 30 }),
    auto: Object.freeze({ '1k': 5, '2k': 9, '4k': 8 })
  }),
  'atlas-image-gpt2': Object.freeze({
    low: Object.freeze({ '1k': 1, '2k': 2, '4k': 2 }),
    medium: Object.freeze({ '1k': 5, '2k': 9, '4k': 8 }),
    high: Object.freeze({ '1k': 16, '2k': 32, '4k': 30 }),
    auto: Object.freeze({ '1k': 5, '2k': 9, '4k': 8 })
  }),
  'atlas-image-gpt2-edit': Object.freeze({
    low: Object.freeze({ '1k': 2, '2k': 3, '4k': 3 }),
    medium: Object.freeze({ '1k': 6, '2k': 10, '4k': 9 }),
    high: Object.freeze({ '1k': 17, '2k': 33, '4k': 31 }),
    auto: Object.freeze({ '1k': 6, '2k': 10, '4k': 9 })
  })
});
const IMAGE_QUALITY_RESOLUTION_PRICES = Object.freeze({
  'image-6': GPT_IMAGE_2_RETAIL_CREDITS,
  'atlas-image-gpt2': GPT_IMAGE_2_RETAIL_CREDITS,
  'atlas-image-gpt2-edit': GPT_IMAGE_2_RETAIL_CREDITS
});

const IMAGE_RESOLUTION_UPSTREAM_CREDITS = Object.freeze({
  'image-1': Object.freeze({
    '1k': 0.14 * PTC_TO_CREDITS,
    '2k': 0.14 * PTC_TO_CREDITS,
    '4k': 0.24 * PTC_TO_CREDITS
  }),
  'image-2': Object.freeze({ '1k': 4, '2k': 6, '4k': 8 }),
  'image-3': Object.freeze({ '2k': 0.043 * PTC_TO_CREDITS, '4k': 0.043 * PTC_TO_CREDITS }),
  'image-7': Object.freeze({ '720p': 2, '1080p': 4 }),
  'image-8': Object.freeze({ '720p': 2, '1080p': 4 }),
  'image-10': Object.freeze({ '2k': 4, '4k': 7 }),
  'image-11': Object.freeze({ '2k': 3, '4k': 4 }),
  'image-12': Object.freeze({ '1k': 2, '2k': 3, '4k': 4 }),
  'image-15': Object.freeze({ '1k': 3, '2k': 4 }),
  'image-16': Object.freeze({ '512x512': 2, '1024x1024': 2 }),
  // Legnext bills USD 0.08 for a standard generation. Reserve the older 4x HD
  // ceiling for 2K so a provider-side HD multiplier cannot create a loss.
  'image-17': Object.freeze({ '1k': 0.08 * PTC_TO_CREDITS, '2k': 0.32 * PTC_TO_CREDITS }),
  'image-18': Object.freeze({ '1k': 0.08 * PTC_TO_CREDITS, '2k': 0.32 * PTC_TO_CREDITS })
});
const IMAGE_RESOLUTION_PRICES = retailNestedRateTable(IMAGE_RESOLUTION_UPSTREAM_CREDITS);

const IMAGE_PRICES = Object.freeze({
  ...IMAGE_PRICES_BASE,
  'image-6': GPT_IMAGE_2_RETAIL_CREDITS.auto['1k'],
  'atlas-image-gpt2': GPT_IMAGE_2_RETAIL_CREDITS.auto['1k'],
  'atlas-image-gpt2-edit': GPT_IMAGE_2_RETAIL_CREDITS.auto['1k']
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

const VIDEO_MINIMUM_UPSTREAM_CREDITS = Object.freeze({
  'atlas-video-seedance25-i2v': Object.freeze({
    '4K-ESR': SEEDANCE_25_4K_ESR_PTC_PER_JOB * PTC_TO_CREDITS
  }),
  'atlas-video-seedance25-ref': Object.freeze({
    '4K-ESR': SEEDANCE_25_4K_ESR_PTC_PER_JOB * PTC_TO_CREDITS
  }),
  'video-3': Object.freeze({
    '4K-ESR': SEEDANCE_25_4K_ESR_PTC_PER_JOB * PTC_TO_CREDITS
  })
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
    const upstreamCredits = Math.max(
      perSecond * duration,
      Number(VIDEO_MINIMUM_UPSTREAM_CREDITS[providerId]?.[resolution]) || 0
    );
    const guardedMultiplier = UPSTREAM_COST_SAFETY_MULTIPLIER * RETAIL_MULTIPLIER;
    const unitCredits = providerId === 'video-1'
      ? Math.ceil(perSecond * guardedMultiplier)
      : (upstreamCredits / duration) * guardedMultiplier;
    const referenceMediaTypes = Array.isArray(request.referenceMediaTypes)
      ? request.referenceMediaTypes.map((value) => String(value || '').trim().toLowerCase())
      : [];
    const referenceImageCount = referenceMediaTypes.filter((value) => value === 'image').length;
    const inputVideoReserveCredits = providerId === 'video-1' && referenceMediaTypes.includes('video')
      ? unitCredits * 15
      : 0;
    const extraImageCredits = providerId === 'video-1'
      ? Math.max(0, referenceImageCount - 5) * Math.ceil(2 * guardedMultiplier)
      : 0;
    const baseCredits = providerId === 'video-1'
      ? unitCredits * duration
      : Math.ceil(upstreamCredits * guardedMultiplier);
    return {
      kind,
      providerId,
      resolution,
      duration,
      units: duration,
      unit: 'second',
      unitCredits,
      fixedCredits: inputVideoReserveCredits + extraImageCredits,
      minimumCredits: MINIMUM_VIDEO_CREDITS,
      totalCredits: Math.max(
        MINIMUM_VIDEO_CREDITS,
        baseCredits + inputVideoReserveCredits + extraImageCredits
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
  const minimumCredits = local.kind === 'video'
    ? Math.max(0, Number(local.minimumCredits) || 0, Number(remote.minimumCredits) || 0)
    : 0;
  return {
    ...remote,
    ...local,
    unitCredits,
    totalCredits: Math.max(
      localTotalCredits,
      remoteTotalCredits,
      unitCredits * count,
      local.kind === 'video' ? Math.max(minimumCredits, Math.ceil(unitCredits * duration)) : 0
    )
  };
}

function publicCreditPricing() {
  return {
    pricingVersion: CREDIT_PRICING_VERSION,
    currency: 'points',
    pointsPerCny: POINTS_PER_CNY,
    retailMarkupPercent: RETAIL_MARKUP_PERCENT,
    retailMultiplier: RETAIL_MULTIPLIER,
    upstreamCostSafetyPercent: UPSTREAM_COST_SAFETY_PERCENT,
    chat: CHAT_CREDITS,
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
  RETAIL_MARKUP_PERCENT,
  RETAIL_MULTIPLIER,
  UPSTREAM_COST_SAFETY_PERCENT,
  UPSTREAM_COST_SAFETY_MULTIPLIER,
  PROFIT_PER_REQUEST_CNY,
  PROFIT_PER_REQUEST_CREDITS,
  USD_TO_CNY,
  PTC_TO_CREDITS,
  CHAT_UPSTREAM_PTC_RESERVE,
  CHAT_CREDITS,
  GPT_IMAGE_2_MAX_INPUT_RETAIL_CREDITS,
  GPT_IMAGE_2_OUTPUT_RETAIL_CREDITS,
  SEEDANCE_PTC_PER_SECOND,
  MINIMUM_VIDEO_CREDITS,
  retailCreditsFromUpstreamCny,
  retailCreditsFromUpstreamPoints,
  IMAGE_UPSTREAM_CREDITS,
  IMAGE_PRICES,
  IMAGE_QUALITY_UPSTREAM_CREDITS,
  IMAGE_QUALITY_PRICES,
  IMAGE_QUALITY_RESOLUTION_UPSTREAM_CREDITS,
  IMAGE_QUALITY_RESOLUTION_PRICES,
  IMAGE_RESOLUTION_UPSTREAM_CREDITS,
  IMAGE_RESOLUTION_PRICES,
  IMAGE_DEFAULT_RESOLUTIONS,
  VIDEO_RATES,
  VIDEO_MINIMUM_UPSTREAM_CREDITS,
  VIDEO_DEFAULT_RESOLUTIONS,
  VIDEO_DURATION_LIMITS,
  VIDEO_SERVICE_TIER_PROVIDERS,
  videoBillingProviderId,
  quoteMediaCredits,
  conservativeMediaCreditQuote,
  publicCreditPricing
};
