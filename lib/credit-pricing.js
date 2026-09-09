'use strict';
const {klingSelection} = require('./kling-options');

const { normalizeVideoResolution } = require('./video-resolution');
const {
  OPERATING_COST_PRICING_VERSION,
  operatingCostCny,
  publicOperatingCosts
} = require('./operating-costs');

// Retail points are intentionally kept separate from provider endpoints.
// 1000 points represent CNY 70. Prices include a 10% upstream-cost buffer,
// then preserve a 16.9% gross margin after an 8.1% payment-fee allowance for both image and video work. Every
// result is rounded up so a request cannot undercharge.
const POINTS_PER_CNY = 1000 / 70;
const LEGACY_POINTS_PER_CNY = 10;
const POINT_DENOMINATION_SCALE = POINTS_PER_CNY / LEGACY_POINTS_PER_CNY;
const IMAGE_GROSS_MARGIN_PERCENT = 16.9;
const VIDEO_GROSS_MARGIN_PERCENT = 16.9;
// Keep these compatibility names aligned with image pricing for existing
// callers that do not distinguish a media kind.
const RETAIL_GROSS_MARGIN_PERCENT = IMAGE_GROSS_MARGIN_PERCENT;
const RETAIL_MULTIPLIER = 1 / (1 - RETAIL_GROSS_MARGIN_PERCENT / 100 - 0.081);
const RETAIL_MARKUP_PERCENT = (RETAIL_MULTIPLIER - 1) * 100;
const VIDEO_RETAIL_MULTIPLIER = 1 / (1 - VIDEO_GROSS_MARGIN_PERCENT / 100 - 0.081);
const UPSTREAM_COST_SAFETY_PERCENT = 10;
const UPSTREAM_COST_SAFETY_MULTIPLIER = 1 + UPSTREAM_COST_SAFETY_PERCENT / 100;
// Kept as zero-valued compatibility exports for older desktop bundles. New
// callers must use the proportional markup constants above.
const PROFIT_PER_REQUEST_CNY = 0;
const PROFIT_PER_REQUEST_CREDITS = 0;
// Bump this whenever a retail table or its settlement formula changes. The
// desktop client uses it to reject quotes from a rolling gateway deployment
// that still serves an older table.
const CREDIT_PRICING_VERSION = '202609090008';
const MINIMUM_VIDEO_CREDITS = 0;
// 302 and Atlas quote in USD (302 calls the same unit PTC). Use a protective
// settlement FX rate so a generation cannot become a loss between quote and
// settlement. One app point is CNY 0.07.
const USD_TO_CNY = 7.3;
const PTC_TO_CREDITS = USD_TO_CNY * POINTS_PER_CNY;
const IMAGE_OPERATING_COST_UPSTREAM_CREDITS = operatingCostCny('image') * POINTS_PER_CNY;
const VIDEO_OPERATING_COST_UPSTREAM_CREDITS = operatingCostCny('video') * POINTS_PER_CNY;
// Token-priced chat has no fixed per-request quote. Null must not mean free.
const CHAT_UPSTREAM_PTC_RESERVE = 0;
const CHAT_CREDITS = null;

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
// Observed Atlas charge for a five-second Seedance 2.5 720P job.
const SEEDANCE_25_720P_USD_PER_SECOND = 1.514799 / 5;
const SEEDANCE_25_720P_UPSTREAM_CREDITS = SEEDANCE_25_720P_USD_PER_SECOND * PTC_TO_CREDITS;
// AI Reiter's published MiniMax H3 route is the primary fallback for the
// public H3 model. Quote its USD/second rates so switching routes cannot turn
// a successful job into a loss.
const MINIMAX_H3_UPSTREAM_CREDITS_PER_SECOND = Object.freeze({
  '768P': 0.1125 * USD_TO_CNY * POINTS_PER_CNY,
  '2K': 0.1825 * USD_TO_CNY * POINTS_PER_CNY
});
const MINIMAX_H3_RETAIL_CREDITS_PER_SECOND = Object.freeze(Object.fromEntries(
  Object.entries(MINIMAX_H3_UPSTREAM_CREDITS_PER_SECOND).map(([resolution, cost]) => [
    resolution,
    retailVideoCreditsFromUpstreamPoints(cost)
  ])
));
const MINIMAX_H3_EXTRA_IMAGE_UPSTREAM_CREDITS = 0.055 * USD_TO_CNY * POINTS_PER_CNY;
const MINIMAX_H3_EXTRA_IMAGE_RETAIL_CREDITS = retailVideoCreditsFromUpstreamPoints(
  MINIMAX_H3_EXTRA_IMAGE_UPSTREAM_CREDITS
);
const MINIMAX_H3_REFERENCE_VIDEO_INPUT_SECONDS = 15;
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

// Atlas prices below are upstream costs in the legacy point denomination.
// Keep this raw table separate from VIDEO_RATES: VIDEO_RATES is public retail
// data and must never be fed back into a retail calculation.
const ATLAS_SEEDANCE_20_UPSTREAM_CREDITS = Object.freeze(Object.fromEntries([
  ['480P', 8.268929], ['720P', 17.7828], ['720P-SR', 14.88408],
  ['1080P', 40.0113], ['1080P-SR', 32.00904], ['1440P-SR', 56.90496],
  ['4K', 91.225764]
].map(([resolution, points]) => [resolution, points * POINT_DENOMINATION_SCALE])));

const ATLAS_SEEDANCE_25_UPSTREAM_CREDITS = Object.freeze({
  '480P': 10.269725 * POINT_DENOMINATION_SCALE,
  // Atlas' verified 720P quote is 1.514799 PTC for five seconds.
  '720P': SEEDANCE_25_720P_UPSTREAM_CREDITS,
  '720P-SR': 16.123462 * POINT_DENOMINATION_SCALE,
  '720P-ESR': 18.485498 * POINT_DENOMINATION_SCALE,
  '1080P': 43.469408 * POINT_DENOMINATION_SCALE,
  '1080P-SR': 29.815561 * POINT_DENOMINATION_SCALE,
  '1080P-ESR': 33.128398 * POINT_DENOMINATION_SCALE,
  '1080P-ESR & 60FPS': 36.441248 * POINT_DENOMINATION_SCALE,
  '1440P-SR': 51.454793 * POINT_DENOMINATION_SCALE,
  '1440P-ESR': 55.876573 * POINT_DENOMINATION_SCALE,
  '4K-ESR': SEEDANCE_25_4K_ESR_PTC_PER_SECOND * PTC_TO_CREDITS
});

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

function retailVideoCreditsFromUpstreamCny(upstreamCostCny) {
  const cost = Number(upstreamCostCny);
  if (!Number.isFinite(cost) || cost < 0) {
    throw new TypeError('Upstream cost must be a non-negative CNY amount.');
  }
  return Math.ceil(cost * UPSTREAM_COST_SAFETY_MULTIPLIER * VIDEO_RETAIL_MULTIPLIER * POINTS_PER_CNY);
}

function retailVideoCreditsFromUpstreamPoints(upstreamPoints) {
  const cost = Number(upstreamPoints);
  if (!Number.isFinite(cost) || cost < 0) {
    throw new TypeError('Upstream cost must be a non-negative point amount.');
  }
  return Math.ceil(cost * UPSTREAM_COST_SAFETY_MULTIPLIER * VIDEO_RETAIL_MULTIPLIER);
}

const IMAGE_OPERATING_COST_RETAIL_CREDITS = retailCreditsFromUpstreamPoints(
  IMAGE_OPERATING_COST_UPSTREAM_CREDITS
);
const VIDEO_OPERATING_COST_RETAIL_CREDITS = retailVideoCreditsFromUpstreamPoints(
  VIDEO_OPERATING_COST_UPSTREAM_CREDITS
);

function retailRateTable(upstreamRates) {
  return Object.freeze(Object.fromEntries(Object.entries(upstreamRates).map(([key, value]) => [
    key, retailCreditsFromUpstreamPoints(Number(value) + IMAGE_OPERATING_COST_UPSTREAM_CREDITS)
  ])));
}

function retailNestedRateTable(upstreamRates) {
  return Object.freeze(Object.fromEntries(Object.entries(upstreamRates).map(([key, rates]) => [
    key, retailRateTable(rates)
  ])));
}

function legacyPointRateTable(rates) {
  return Object.freeze(Object.fromEntries(Object.entries(rates).map(([key, value]) => [
    key, value * POINT_DENOMINATION_SCALE
  ])));
}

// Static provider costs are app-point equivalents after the upstream unit has
// been converted. CNY providers multiply by 10 directly; USD/PTC providers
// multiply by the protected 7.3 CNY/USD rate first.
const IMAGE_UPSTREAM_CREDITS = Object.freeze({
  'atlas-image-gpt2': 0.12 * PTC_TO_CREDITS,
  'atlas-image-gpt2-edit': 0.12 * PTC_TO_CREDITS,
  'image-1': 0.05 * PTC_TO_CREDITS, 'image-2': 0.03 * PTC_TO_CREDITS,
  'image-3': 0.28 * POINTS_PER_CNY, 'image-4': 2 * POINT_DENOMINATION_SCALE,
  'image-5': 2 * POINT_DENOMINATION_SCALE, 'image-6': 0.10 * PTC_TO_CREDITS,
  'image-7': 2 * POINT_DENOMINATION_SCALE, 'image-8': 2 * POINT_DENOMINATION_SCALE,
  'image-9': 3 * POINT_DENOMINATION_SCALE, 'image-10': 4 * POINT_DENOMINATION_SCALE,
  'image-11': 3 * POINT_DENOMINATION_SCALE, 'image-12': 2 * POINT_DENOMINATION_SCALE,
  'image-13': 2 * POINT_DENOMINATION_SCALE, 'image-14': 2 * POINT_DENOMINATION_SCALE,
  'image-15': 3 * POINT_DENOMINATION_SCALE, 'image-16': 2 * POINT_DENOMINATION_SCALE,
  'image-17': 0.08 * PTC_TO_CREDITS, 'image-18': 0.08 * PTC_TO_CREDITS
});
const IMAGE_PRICES_BASE = retailRateTable(IMAGE_UPSTREAM_CREDITS);

// GPT Image 2 output cost varies materially by quality and resolution. The
// public image-6 slot can also become an edit request, so it reserves the
// higher edit ceiling (one legacy upstream point above generation) for every
// tier. This avoids undercharging when references are attached after quote.
const GPT_IMAGE_2_GENERATE_UPSTREAM_POINTS = Object.freeze({
  low: Object.freeze({ '1k': 0.022, '2k': 0.029, '4k': 0.036 }),
  medium: Object.freeze({ '1k': 0.092, '2k': 0.10, '4k': 0.17 }),
  high: Object.freeze({ '1k': 0.33, '2k': 0.35, '4k': 0.62 }),
});
const GPT_IMAGE_2_EDIT_UPSTREAM_POINTS = Object.freeze({
  low: Object.freeze({ '1k': 0.022, '2k': 0.029, '4k': 0.036 }),
  medium: Object.freeze({ '1k': 0.092, '2k': 0.10, '4k': 0.17 }),
  high: Object.freeze({ '1k': 0.33, '2k': 0.35, '4k': 0.62 }),
});
const scaleGptImage2Upstream = (matrix) => Object.freeze(Object.fromEntries(
  Object.entries(matrix).map(([quality, rates]) => [quality, Object.freeze(Object.fromEntries(
    Object.entries(rates).map(([resolution, usd]) => [resolution, usd * PTC_TO_CREDITS])
  ))])
));
const GPT_IMAGE_2_GENERATE_UPSTREAM_CREDITS = scaleGptImage2Upstream(GPT_IMAGE_2_GENERATE_UPSTREAM_POINTS);
const GPT_IMAGE_2_EDIT_UPSTREAM_CREDITS = scaleGptImage2Upstream(GPT_IMAGE_2_EDIT_UPSTREAM_POINTS);
const GPT_IMAGE_2_GENERATE_RETAIL_CREDITS = retailNestedRateTable(GPT_IMAGE_2_GENERATE_UPSTREAM_CREDITS);
const GPT_IMAGE_2_EDIT_RETAIL_CREDITS = retailNestedRateTable(GPT_IMAGE_2_EDIT_UPSTREAM_CREDITS);
const GPT_IMAGE_2_RETAIL_CREDITS = GPT_IMAGE_2_GENERATE_RETAIL_CREDITS;
const GPT_IMAGE_2_MAX_INPUT_RETAIL_CREDITS = 0;
const GPT_IMAGE_2_OUTPUT_RETAIL_CREDITS = GPT_IMAGE_2_RETAIL_CREDITS;
// AIReiter bills both GPT Image 2.5 variants by resolution only:
// 2 / 2.5 / 3.5 upstream credits where 100 credits equal USD 1.
const GPT_IMAGE_25_UPSTREAM_CREDITS = Object.freeze({
  '1k': 0.020 * PTC_TO_CREDITS,
  '2k': 0.025 * PTC_TO_CREDITS,
  '4k': 0.035 * PTC_TO_CREDITS
});
// Integer prices keep net margin after the 8.1% payment allowance between
// 15% and 23% while covering the provider and CNY 0.013 operating allocation.
const GPT_IMAGE_25_RETAIL_CREDITS = Object.freeze({ '1k': 3, '2k': 4, '4k': 5 });

const IMAGE_QUALITY_UPSTREAM_CREDITS = Object.freeze({
  'image-6': Object.freeze(Object.fromEntries(Object.entries(GPT_IMAGE_2_GENERATE_UPSTREAM_CREDITS).map(([quality, rates]) => [quality, rates['1k']]))),
  'atlas-image-gpt2': Object.freeze(Object.fromEntries(Object.entries(GPT_IMAGE_2_GENERATE_UPSTREAM_CREDITS).map(([quality, rates]) => [quality, rates['1k']]))),
  'atlas-image-gpt2-edit': Object.freeze(Object.fromEntries(Object.entries(GPT_IMAGE_2_EDIT_UPSTREAM_CREDITS).map(([quality, rates]) => [quality, rates['1k']]))),
});
const IMAGE_QUALITY_PRICES = Object.freeze({
  'image-6': Object.freeze(Object.fromEntries(Object.entries(GPT_IMAGE_2_RETAIL_CREDITS).map(([quality, rates]) => [quality, rates['1k']]))),
  'atlas-image-gpt2': Object.freeze(Object.fromEntries(Object.entries(GPT_IMAGE_2_GENERATE_RETAIL_CREDITS).map(([quality, rates]) => [quality, rates['1k']]))),
  'atlas-image-gpt2-edit': Object.freeze(Object.fromEntries(Object.entries(GPT_IMAGE_2_EDIT_RETAIL_CREDITS).map(([quality, rates]) => [quality, rates['1k']]))),
});

const IMAGE_QUALITY_RESOLUTION_UPSTREAM_CREDITS = Object.freeze({
  'image-6': GPT_IMAGE_2_GENERATE_UPSTREAM_CREDITS,
  'atlas-image-gpt2': GPT_IMAGE_2_GENERATE_UPSTREAM_CREDITS,
  'atlas-image-gpt2-edit': GPT_IMAGE_2_EDIT_UPSTREAM_CREDITS
});
const IMAGE_QUALITY_RESOLUTION_PRICES = Object.freeze({
  'image-6': GPT_IMAGE_2_GENERATE_RETAIL_CREDITS,
  'atlas-image-gpt2': GPT_IMAGE_2_GENERATE_RETAIL_CREDITS,
  'atlas-image-gpt2-edit': GPT_IMAGE_2_EDIT_RETAIL_CREDITS
});

const IMAGE_RESOLUTION_UPSTREAM_CREDITS = Object.freeze({
  'image-19': GPT_IMAGE_25_UPSTREAM_CREDITS,
  'image-1': Object.freeze({
    '1k': 0.05 * PTC_TO_CREDITS,
    '2k': 0.05 * PTC_TO_CREDITS,
    '4k': 0.06 * PTC_TO_CREDITS
  }),
  // AI Reiter Nano Banana 2 Max: USD 0.077 / 0.1155 / 0.154.
  'image-2': Object.freeze({
    '1k': 0.03 * PTC_TO_CREDITS,
    '2k': 0.03 * PTC_TO_CREDITS,
    '4k': 0.035 * PTC_TO_CREDITS
  }),
  'image-3': Object.freeze({ '2k': 0.28 * POINTS_PER_CNY, '4k': 0.50 * POINTS_PER_CNY }),
  'image-7': legacyPointRateTable({ '720p': 2, '1080p': 4 }),
  'image-8': legacyPointRateTable({ '720p': 2, '1080p': 4 }),
  'image-10': legacyPointRateTable({ '2k': 4, '4k': 7 }),
  'image-11': legacyPointRateTable({ '2k': 3, '4k': 4 }),
  'image-12': legacyPointRateTable({ '1k': 2, '2k': 3, '4k': 4 }),
  'image-15': legacyPointRateTable({ '1k': 3, '2k': 4 }),
  'image-16': legacyPointRateTable({ '512x512': 2, '1024x1024': 2 }),
  // Legnext V8.2: 80 credits standard / 120 HD, USD 1 per 1,000 credits.
  // Verified official parameter matrix 2026-09-09; retain legacy V8.1 pricing.
  'image-17': Object.freeze({ '1k': 0.08 * PTC_TO_CREDITS, '2k': 0.32 * PTC_TO_CREDITS }),
  'image-18': Object.freeze({ '1k': 0.08 * PTC_TO_CREDITS, '2k': 0.12 * PTC_TO_CREDITS })
});
const IMAGE_RESOLUTION_PRICES = Object.freeze({
  ...retailNestedRateTable(IMAGE_RESOLUTION_UPSTREAM_CREDITS),
  'image-19': GPT_IMAGE_25_RETAIL_CREDITS
});

const IMAGE_PRICES = Object.freeze({
  ...IMAGE_PRICES_BASE,
  'image-1': IMAGE_RESOLUTION_PRICES['image-1']['2k'],
  'image-3': IMAGE_RESOLUTION_PRICES['image-3']['2k'],
  'image-6': GPT_IMAGE_2_RETAIL_CREDITS.medium['1k'],
  'image-19': GPT_IMAGE_25_RETAIL_CREDITS['2k'],
  'atlas-image-gpt2': GPT_IMAGE_2_GENERATE_RETAIL_CREDITS.medium['1k'],
  'atlas-image-gpt2-edit': GPT_IMAGE_2_EDIT_RETAIL_CREDITS.medium['1k'],
  'image-17': IMAGE_RESOLUTION_PRICES['image-17']['1k'],
  'image-18': IMAGE_RESOLUTION_PRICES['image-18']['1k']
});

const IMAGE_DEFAULT_RESOLUTIONS = Object.freeze({
  'image-17': '1k',
  'image-18': '1k'
});

const VIDEO_RATES = Object.freeze({
  'atlas-video-seedance20-i2v': legacyPointRateTable({
    '480P': 8.268929, '720P': 17.7828, '720P-SR': 14.88408, '1080P': 40.0113,
    '1080P-SR': 32.00904, '1440P-SR': 56.90496, '4K': 91.225764
  }),
  'atlas-video-seedance20-ref': legacyPointRateTable({
    '480P': 8.268929, '720P': 17.7828, '720P-SR': 14.88408, '1080P': 40.0113,
    '1080P-SR': 32.00904, '1440P-SR': 56.90496, '4K': 91.225764
  }),
  'atlas-video-seedance25-i2v': Object.freeze({
    '480P': 10.269725 * POINT_DENOMINATION_SCALE, '720P': SEEDANCE_25_720P_UPSTREAM_CREDITS,
    '720P-SR': 16.123462 * POINT_DENOMINATION_SCALE, '720P-ESR': 18.485498 * POINT_DENOMINATION_SCALE,
    '1080P': 43.469408 * POINT_DENOMINATION_SCALE, '1080P-SR': 29.815561 * POINT_DENOMINATION_SCALE,
    '1080P-ESR': 33.128398 * POINT_DENOMINATION_SCALE,
    '1080P-ESR & 60FPS': 36.441248 * POINT_DENOMINATION_SCALE,
    '1440P-SR': 51.454793 * POINT_DENOMINATION_SCALE, '1440P-ESR': 55.876573 * POINT_DENOMINATION_SCALE,
    '4K-ESR': Number((SEEDANCE_25_4K_ESR_PTC_PER_SECOND * PTC_TO_CREDITS).toFixed(9))
  }),
  'atlas-video-seedance25-ref': Object.freeze({
    '480P': 10.269725 * POINT_DENOMINATION_SCALE, '720P': SEEDANCE_25_720P_UPSTREAM_CREDITS,
    '720P-SR': 16.123462 * POINT_DENOMINATION_SCALE, '720P-ESR': 18.485498 * POINT_DENOMINATION_SCALE,
    '1080P': 43.469408 * POINT_DENOMINATION_SCALE, '1080P-SR': 29.815561 * POINT_DENOMINATION_SCALE,
    '1080P-ESR': 33.128398 * POINT_DENOMINATION_SCALE,
    '1080P-ESR & 60FPS': 36.441248 * POINT_DENOMINATION_SCALE,
    '1440P-SR': 51.454793 * POINT_DENOMINATION_SCALE, '1440P-ESR': 55.876573 * POINT_DENOMINATION_SCALE,
    '4K-ESR': Number((SEEDANCE_25_4K_ESR_PTC_PER_SECOND * PTC_TO_CREDITS).toFixed(9))
  }),
  // MiniMax reports CNY 0.50 per billed second at 768P and CNY 0.80 at 2K.
  // Reference input seconds and images beyond the first five are reserved
  // separately below, then authoritative provider usage can only top this up.
  'video-1': MINIMAX_H3_RETAIL_CREDITS_PER_SECOND,
  // Logical Seedance providers are billed against the most expensive
  // available route for each resolution. 480P/720P use the USD-denominated
  // 302 fallback when it is higher; Atlas-only higher tiers use the Atlas
  // catalog price. This keeps an Atlas failure from turning into a loss.
  'video-2': legacyPointRateTable({
    '480P': 8.268929, '720P': 17.7828, '720P-SR': 14.88408, '1080P': 40.0113,
    '1080P-SR': 32.00904, '1440P-SR': 56.90496, '4K': 91.225764
  }),
  'video-3': Object.freeze({
    '480P': 10.269725 * POINT_DENOMINATION_SCALE, '720P': SEEDANCE_25_720P_UPSTREAM_CREDITS,
    '720P-SR': 16.123462 * POINT_DENOMINATION_SCALE, '720P-ESR': 18.485498 * POINT_DENOMINATION_SCALE,
    '1080P': 43.469408 * POINT_DENOMINATION_SCALE, '1080P-SR': 29.815561 * POINT_DENOMINATION_SCALE,
    '1080P-ESR': 33.128398 * POINT_DENOMINATION_SCALE,
    '1080P-ESR & 60FPS': 36.441248 * POINT_DENOMINATION_SCALE,
    '1440P-SR': 51.454793 * POINT_DENOMINATION_SCALE,
    '1440P-ESR': 55.876573 * POINT_DENOMINATION_SCALE,
    '4K-ESR': Number((SEEDANCE_25_4K_ESR_PTC_PER_SECOND * PTC_TO_CREDITS).toFixed(9))
  }),
  'video-4': SEEDANCE_VIDEO_RATES['video-4'],
  'video-5': legacyPointRateTable({ '480P': 2, '720P': 3 }),
  'video-6': legacyPointRateTable({ '480P': 2, '720P': 3, '1080P': 4 }),
  'video-7': legacyPointRateTable({ '480P': 1.5, '720P': 2.5 }),
  'video-8': legacyPointRateTable({ '720P': 0.5, '1080P': 1 }),
  'video-9': legacyPointRateTable({ '1080P': 2 }),
  // Kling prices are documented in USD/PTC per second. These rates use a
  // conservative USD/CNY conversion of 7.3 and round upward before the
  // fixed retail profit is added, so audio-enabled requests cannot undercharge.
  'video-10': legacyPointRateTable({ '720P': 18.4 }),
  'video-11': legacyPointRateTable({ '1080P': 24.6 }),
  // O3 uses separate 302 endpoints for image-to-video, reference-to-video,
  // and video-edit. The rates below use the highest documented sound-on /
  // reference-video rate for each tier so every supported mode is covered.
  'video-12': legacyPointRateTable({ '720P': 21.9 }),
  'video-13': legacyPointRateTable({ '1080P': 26.3 })
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

// All values below are upstream credits before the 10% protection buffer and
// the 15% gross-margin calculation. Keeping this table separate prevents a
// retail rate from being multiplied a second time during request quoting.
const VIDEO_UPSTREAM_RATES = Object.freeze({
  'video-1': MINIMAX_H3_UPSTREAM_CREDITS_PER_SECOND,
  'video-2': ATLAS_SEEDANCE_20_UPSTREAM_CREDITS,
  'video-3': ATLAS_SEEDANCE_25_UPSTREAM_CREDITS,
  // Keep historical desktop-only routes cost-protected as well. They are
  // rejected by the gateway allow-list, but must never fall back to H3 when
  // an old canvas record asks for a quote.
  'video-4': VIDEO_RATES['video-4'],
  'video-5': VIDEO_RATES['video-5'],
  'video-6': VIDEO_RATES['video-6'],
  'video-7': VIDEO_RATES['video-7'],
  'video-8': VIDEO_RATES['video-8'],
  'video-9': VIDEO_RATES['video-9'],
  'video-10': VIDEO_RATES['video-10'],
  'video-11': VIDEO_RATES['video-11'],
  'video-12': VIDEO_RATES['video-12'],
  'video-13': VIDEO_RATES['video-13']
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

  const requestedResolution = normalizeVideoResolution(
    request.resolution || request.size,
    normalizedProviderId,
    request.model
  );
  const resolutionProvider = Object.values(tierProviders).find((candidateId) => (
    Object.hasOwn(VIDEO_RATES[candidateId] || {}, requestedResolution)
  ));
  return resolutionProvider || tierProviders.standard;
}

function quoteMediaCredits(request = {}) {
  if (String(request.kind || '').trim().toLowerCase() === 'chat') {
    return {
      kind: 'chat',
      providerId: String(request.providerId || request.chatProviderId || 'chat-3').trim() || 'chat-3',
      units: 1,
      unit: 'request',
      metering: 'tokens',
      unitCredits: CHAT_CREDITS,
      totalCredits: CHAT_CREDITS
    };
  }
  const kind = request.kind === 'video' ? 'video' : 'image';
  if (kind === 'video') {
    const requestedProviderId = String(request.providerId || request.videoProviderId || 'video-1').trim() || 'video-1';
    if (requestedProviderId === 'video-14') {
      const k = klingSelection(request);
      return {kind:'video',providerId:k.billingId,resolution:k.resolution,duration:k.duration,
        units:k.duration,unit:'second',unitCredits:retailVideoCreditsFromUpstreamCny(k.usdPerSecond * USD_TO_CNY),
        fixedCredits:0,minimumCredits:MINIMUM_VIDEO_CREDITS,
        totalCredits:Math.max(MINIMUM_VIDEO_CREDITS,Math.ceil((k.usdPerSecond*k.duration*USD_TO_CNY*POINTS_PER_CNY+VIDEO_OPERATING_COST_UPSTREAM_CREDITS)*UPSTREAM_COST_SAFETY_MULTIPLIER*VIDEO_RETAIL_MULTIPLIER))};
    }
    const providerId = videoBillingProviderId(requestedProviderId, request);
    const rates = VIDEO_RATES[providerId] || VIDEO_RATES['video-1'];
    const upstreamRates = VIDEO_UPSTREAM_RATES[providerId] || VIDEO_UPSTREAM_RATES['video-1'];
    const requestedResolution = normalizeVideoResolution(
      request.resolution || request.size,
      requestedProviderId,
      request.model
    );
    const defaultResolution = VIDEO_DEFAULT_RESOLUTIONS[providerId] || '768P';
    const resolution = Object.hasOwn(rates, requestedResolution) ? requestedResolution : defaultResolution;
    const durationLimits = VIDEO_DURATION_LIMITS[providerId] || VIDEO_DURATION_LIMITS['video-1'];
    const duration = Number(request.duration) === -1
      ? durationLimits.maximum
      : boundedInteger(request.duration, 6, durationLimits.minimum, durationLimits.maximum);
    const perSecond = upstreamRates[resolution] || upstreamRates[Object.keys(upstreamRates)[0]];
    const modelUpstreamCredits = Math.max(
      perSecond * duration,
      Number(VIDEO_MINIMUM_UPSTREAM_CREDITS[providerId]?.[resolution]) || 0
    );
    const upstreamCredits = modelUpstreamCredits + VIDEO_OPERATING_COST_UPSTREAM_CREDITS;
    const guardedMultiplier = UPSTREAM_COST_SAFETY_MULTIPLIER * VIDEO_RETAIL_MULTIPLIER;
    const referenceMediaTypes = Array.isArray(request.referenceMediaTypes)
      ? request.referenceMediaTypes.map((value) => String(value || '').trim().toLowerCase())
      : [];
    const referenceImageCount = referenceMediaTypes.filter((value) => value === 'image').length;
    const inputVideoSeconds = providerId === 'video-1' && referenceMediaTypes.includes('video')
      ? MINIMAX_H3_REFERENCE_VIDEO_INPUT_SECONDS
      : 0;
    const extraImageUpstreamCredits = providerId === 'video-1'
      ? Math.max(0, referenceImageCount - 5) * MINIMAX_H3_EXTRA_IMAGE_UPSTREAM_CREDITS
      : 0;
    const completeUpstreamCredits = providerId === 'video-1'
      ? perSecond * (duration + inputVideoSeconds) + extraImageUpstreamCredits + VIDEO_OPERATING_COST_UPSTREAM_CREDITS
      : upstreamCredits;
    const baseCredits = Math.ceil(completeUpstreamCredits * guardedMultiplier);
    const unitCredits = retailVideoCreditsFromUpstreamPoints(perSecond);
    return {
      kind,
      providerId,
      resolution,
      duration,
      units: duration,
      unit: 'second',
      unitCredits,
      fixedCredits: 0,
      minimumCredits: MINIMUM_VIDEO_CREDITS,
      totalCredits: Math.max(
        MINIMUM_VIDEO_CREDITS,
        baseCredits
      )
    };
  }

  const providerId = String(request.providerId || request.imageProviderId || 'image-1').trim() || 'image-1';
  const count = boundedInteger(request.count, 1, 1, 4);
  const qualityRates = IMAGE_QUALITY_PRICES[providerId];
  const qualityResolutionRates = IMAGE_QUALITY_RESOLUTION_PRICES[providerId];
  const resolutionRates = IMAGE_RESOLUTION_PRICES[providerId];
  const requestedQuality = String(request.quality || '').trim().toLowerCase();
  const defaultQuality = providerId === 'image-6' && qualityRates ? 'medium' : 'auto';
  const quality = qualityRates && Object.hasOwn(qualityRates, requestedQuality) ? requestedQuality : defaultQuality;
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
    grossMarginPercent: RETAIL_GROSS_MARGIN_PERCENT,
    imageGrossMarginPercent: IMAGE_GROSS_MARGIN_PERCENT,
    videoGrossMarginPercent: VIDEO_GROSS_MARGIN_PERCENT,
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
    video: Object.fromEntries(Object.entries(VIDEO_RATES).map(([id, rates]) => [id, { ...rates }])),
    operatingCosts: publicOperatingCosts(),
    operatingCostPricingVersion: OPERATING_COST_PRICING_VERSION,
    imageOperatingCostCredits: IMAGE_OPERATING_COST_RETAIL_CREDITS,
    videoOperatingCostCredits: VIDEO_OPERATING_COST_RETAIL_CREDITS
  };
}

module.exports = {
  CREDIT_PRICING_VERSION,
  POINTS_PER_CNY,
  IMAGE_GROSS_MARGIN_PERCENT,
  VIDEO_GROSS_MARGIN_PERCENT,
  RETAIL_GROSS_MARGIN_PERCENT,
  RETAIL_MARKUP_PERCENT,
  RETAIL_MULTIPLIER,
  VIDEO_RETAIL_MULTIPLIER,
  UPSTREAM_COST_SAFETY_PERCENT,
  UPSTREAM_COST_SAFETY_MULTIPLIER,
  PROFIT_PER_REQUEST_CNY,
  PROFIT_PER_REQUEST_CREDITS,
  USD_TO_CNY,
  OPERATING_COST_PRICING_VERSION,
  IMAGE_OPERATING_COST_UPSTREAM_CREDITS,
  VIDEO_OPERATING_COST_UPSTREAM_CREDITS,
  IMAGE_OPERATING_COST_RETAIL_CREDITS,
  VIDEO_OPERATING_COST_RETAIL_CREDITS,
  PTC_TO_CREDITS,
  CHAT_UPSTREAM_PTC_RESERVE,
  CHAT_CREDITS,
  GPT_IMAGE_2_MAX_INPUT_RETAIL_CREDITS,
  GPT_IMAGE_2_OUTPUT_RETAIL_CREDITS,
  SEEDANCE_PTC_PER_SECOND,
  MINIMUM_VIDEO_CREDITS,
  retailCreditsFromUpstreamCny,
  retailCreditsFromUpstreamPoints,
  retailVideoCreditsFromUpstreamCny,
  retailVideoCreditsFromUpstreamPoints,
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
  VIDEO_UPSTREAM_RATES,
  videoBillingProviderId,
  quoteMediaCredits,
  conservativeMediaCreditQuote,
  publicCreditPricing
};
