// 302 bills one PTC as one USD. The settlement rate is deliberately rounded
// above the observed settlement rate so FX movement cannot undercharge.
export const USD_TO_CNY = 7.3;
export const TOPAZ_PROVIDER_PTC_PER_POINT = USD_TO_CNY;
export const APP_CREDITS_PER_CNY = 10;
export const PROFIT_PER_REQUEST_CNY = 1.4;
export const TOPAZ_RETAIL_MARKUP = null;
export const TOPAZ_RETAIL_CREDIT_MULTIPLIER = TOPAZ_PROVIDER_PTC_PER_POINT * APP_CREDITS_PER_CNY;
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

export const BUTLER_FIXED_RETAIL_CREDITS = Object.freeze({
  'background-remove': 51,      // 0.50 PTC + CNY 1.4
  'seededit-v3': 18,            // 0.05 PTC + CNY 1.4
  'kling-image-expand': 51,     // Clipdrop Uncrop, 0.50 PTC + CNY 1.4
  cleanup: 51,                  // 0.50 PTC + CNY 1.4
  'generative-upscale': 73,     // 0.80 PTC + CNY 1.4
  // Retain old IDs for in-flight jobs, but never omit the retail margin.
  'qwen-image-edit-plus': 16,
  'qwen-image-layered': 16,
  'super-upscale-v2': 16,
  erase: 16,
  hunyuan3d: 22,
  hyper3d: 28,
  tripo3d: 24
});

export function quoteRetailCreditsFromCny(upstreamCostCny) {
  const normalizedCost = Number(upstreamCostCny);
  if (!Number.isFinite(normalizedCost) || normalizedCost < 0) {
    throw Object.assign(new Error('The upstream CNY cost is invalid.'), {
      code: 'invalid-provider-cost',
      status: 502
    });
  }
  return Math.ceil((normalizedCost + PROFIT_PER_REQUEST_CNY) * APP_CREDITS_PER_CNY);
}

export function quoteTopazRetailCredits(providerCost) {
  const normalizedCost = Number(providerCost);
  if (!Number.isInteger(normalizedCost) || normalizedCost < 0 || normalizedCost > 1_000_000) {
    throw Object.assign(new Error('The Topaz provider cost is invalid.'), {
      code: 'invalid-provider-cost',
      status: 502
    });
  }
  return Math.ceil(
    normalizedCost * TOPAZ_RETAIL_CREDIT_MULTIPLIER
      + PROFIT_PER_REQUEST_CNY * APP_CREDITS_PER_CNY
  );
}

export function quoteButlerRetailCredits(providerId, providerCost = null) {
  const normalizedProvider = String(providerId || '').trim().toLowerCase();
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
