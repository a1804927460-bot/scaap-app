// 302 bills one PTC as one USD. The settlement rate is deliberately rounded
// above the observed settlement rate so FX movement cannot undercharge.
export const USD_TO_CNY = 7.3;
// Topaz returns its billed provider cost directly in PTC (USD).
export const TOPAZ_PROVIDER_PTC_PER_POINT = 1;
export const APP_CREDITS_PER_CNY = 10;
export const RETAIL_MARKUP_PERCENT = 20;
export const RETAIL_MULTIPLIER = 1 + RETAIL_MARKUP_PERCENT / 100;
export const PROFIT_PER_REQUEST_CNY = 0;
export const TOPAZ_RETAIL_MARKUP = RETAIL_MARKUP_PERCENT / 100;
export const TOPAZ_RETAIL_CREDIT_MULTIPLIER = TOPAZ_PROVIDER_PTC_PER_POINT
  * USD_TO_CNY * APP_CREDITS_PER_CNY * RETAIL_MULTIPLIER;
export const TOPAZ_DYNAMIC_PROVIDERS = Object.freeze(new Set([
  'topaz-video-upscale',
  'topaz-image-sharpen',
  'topaz-image-sharpen-gen',
  'topaz-image-enhance',
  'topaz-image-enhance-gen',
  'topaz-image-denoise',
  'topaz-image-restore',
  'topaz-image-lighting'
]));

// Butler image/video actions are included in the product experience at no
// credit cost. Keep this list explicit so a newly added paid provider cannot
// accidentally become free by omission.
export const FREE_BUTLER_PROVIDERS = Object.freeze(new Set([
  'background-remove', 'seededit-v3', 'clipdrop-uncrop', 'kling-image-expand',
  'cleanup', 'clipdrop-upscale', 'generative-upscale',
  'qwen-image-edit-plus', 'qwen-image-layered', 'super-upscale-v2', 'erase',
  'topaz-video-upscale',
  'topaz-image-sharpen', 'topaz-image-sharpen-gen', 'topaz-image-enhance',
  'topaz-image-enhance-gen', 'topaz-image-denoise', 'topaz-image-restore',
  'topaz-image-lighting'
]));

export const BUTLER_FIXED_PROVIDER_PTC = Object.freeze({
  'background-remove': 0.50,
  'seededit-v3': 0.05,
  'clipdrop-uncrop': 0.50,
  'kling-image-expand': 0.50,
  cleanup: 0.50,
  'clipdrop-upscale': 0.50,
  'generative-upscale': 0.80
});

// These legacy/3D providers are quoted as protective whole app-point upstream
// costs. Keeping costs separate makes every retail value use the same formula.
export const BUTLER_FIXED_UPSTREAM_CREDITS = Object.freeze({
  'qwen-image-edit-plus': 2,
  'qwen-image-layered': 2,
  'super-upscale-v2': 2,
  erase: 2
});

export function quoteThreeDProviderCostPtcCents(providerId, options = {}) {
  const provider = String(providerId || '').trim().toLowerCase();
  const source = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
  if (provider === 'hunyuan3d') {
    const type = String(source.generateType || 'Normal');
    let cents = type === 'Geometry' ? 30 : (type === 'LowPoly' || type === 'Sketch' ? 50 : 40);
    if (source.enablePbr === true && type !== 'Geometry') cents += 20;
    const faceCount = Number(source.faceCount);
    if (Number.isFinite(faceCount) && faceCount > 0 && faceCount !== 500000) cents += 20;
    return cents;
  }
  if (provider === 'hyper3d') return 70;
  if (provider === 'tripo3d') {
    if (source.texture === false) return 30;
    return String(source.textureQuality || 'standard').toLowerCase() === 'standard' ? 45 : 60;
  }
  throw Object.assign(new Error('The 3D provider is invalid.'), { code: 'provider-not-allowed', status: 400 });
}

export function quoteThreeDRetailCredits(providerId, options = {}) {
  return quoteRetailCreditsFromPtc(quoteThreeDProviderCostPtcCents(providerId, options) / 100);
}

export function quoteRetailCreditsFromCny(upstreamCostCny) {
  const normalizedCost = Number(upstreamCostCny);
  if (!Number.isFinite(normalizedCost) || normalizedCost < 0) {
    throw Object.assign(new Error('The upstream CNY cost is invalid.'), {
      code: 'invalid-provider-cost',
      status: 502
    });
  }
  return Math.ceil(normalizedCost * RETAIL_MULTIPLIER * APP_CREDITS_PER_CNY);
}

export function quoteRetailCreditsFromPtc(upstreamCostPtc) {
  const normalizedCost = Number(upstreamCostPtc);
  if (!Number.isFinite(normalizedCost) || normalizedCost < 0) {
    throw Object.assign(new Error('The upstream PTC cost is invalid.'), {
      code: 'invalid-provider-cost',
      status: 502
    });
  }
  return Math.ceil(normalizedCost * USD_TO_CNY * APP_CREDITS_PER_CNY * RETAIL_MULTIPLIER);
}

export const BUTLER_FIXED_RETAIL_CREDITS = Object.freeze({
  ...Object.fromEntries(Object.entries(BUTLER_FIXED_PROVIDER_PTC).map(([providerId, cost]) => [
    providerId, FREE_BUTLER_PROVIDERS.has(providerId) ? 0 : quoteRetailCreditsFromPtc(cost)
  ])),
  ...Object.fromEntries(Object.entries(BUTLER_FIXED_UPSTREAM_CREDITS).map(([providerId, cost]) => [
    providerId, FREE_BUTLER_PROVIDERS.has(providerId) || cost === 0 ? 0 : Math.ceil(cost * RETAIL_MULTIPLIER)
  ]))
});

export function quoteTopazRetailCredits(providerCost) {
  const normalizedCost = Number(providerCost);
  if (!Number.isInteger(normalizedCost) || normalizedCost < 0 || normalizedCost > 1_000_000) {
    throw Object.assign(new Error('The Topaz provider cost is invalid.'), {
      code: 'invalid-provider-cost',
      status: 502
    });
  }
  return Math.ceil(normalizedCost * TOPAZ_RETAIL_CREDIT_MULTIPLIER);
}

export function quoteButlerRetailCredits(providerId, providerCost = null) {
  const normalizedProvider = String(providerId || '').trim().toLowerCase();
  if (FREE_BUTLER_PROVIDERS.has(normalizedProvider)) return 0;
  if (TOPAZ_DYNAMIC_PROVIDERS.has(normalizedProvider)) {
    return quoteTopazRetailCredits(providerCost);
  }
  if (!Object.hasOwn(BUTLER_FIXED_RETAIL_CREDITS, normalizedProvider)) {
    throw Object.assign(new Error('The Butler provider is not allowed.'), {
      code: 'provider-not-allowed',
      status: 400
    });
  }
  return BUTLER_FIXED_RETAIL_CREDITS[normalizedProvider];
}
