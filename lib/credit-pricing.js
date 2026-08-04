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
  'image-5': 8   // Nano banana2
});

const VIDEO_RATES = Object.freeze({
  'video-1': Object.freeze({
    '768P': 10,
    '2K': 16
  })
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
    const resolution = String(request.resolution || '768P').toUpperCase() === '2K' ? '2K' : '768P';
    const duration = boundedInteger(request.duration, 6, 4, 15);
    const rate = VIDEO_RATES[providerId] && VIDEO_RATES[providerId][resolution];
    const perSecond = Number.isFinite(rate) ? rate : VIDEO_RATES['video-1'][resolution];
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
  const perImage = Number.isFinite(IMAGE_PRICES[providerId]) ? IMAGE_PRICES[providerId] : IMAGE_PRICES['image-1'];
  return {
    kind,
    providerId,
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
    video: Object.fromEntries(Object.entries(VIDEO_RATES).map(([id, rates]) => [id, { ...rates }]))
  };
}

module.exports = {
  POINTS_PER_CNY,
  IMAGE_PRICES,
  VIDEO_RATES,
  quoteMediaCredits,
  publicCreditPricing
};
