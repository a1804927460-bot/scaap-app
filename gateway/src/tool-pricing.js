// 302 bills one PTC as one USD. The settlement rate is deliberately rounded
// above the 2026-08-17 spot rate (6.748651) so FX movement cannot undercharge.
export const USD_TO_CNY = 6.8;
export const TOPAZ_PROVIDER_PTC_PER_POINT = USD_TO_CNY;
export const APP_CREDITS_PER_CNY = 10;
export const PROFIT_PER_REQUEST_CNY = 1.4;
export const INTERNAL_COST_MULTIPLIER = 1.15;
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
  'background-remove': 48,      // 0.50 PTC
  'seededit-v3': 18,            // 0.05 PTC + CNY 1.4
  'kling-image-expand': 17,     // 0.04 PTC + CNY 1.4
  cleanup: 48,                  // 0.50 PTC
  'generative-upscale': 69,     // 0.80 PTC + CNY 1.4
  // Retain old IDs for in-flight jobs created by an older desktop build.
  'qwen-image-edit-plus': 2,
  'qwen-image-layered': 1,
  'super-upscale-v2': 2,
  erase: 1,
  hunyuan3d: 22,
  hyper3d: 28,
  tripo3d: 24
});

const BUTLER_FIXED_UPSTREAM_CREDITS = Object.freeze({
  'background-remove': 34,
  'seededit-v3': 3.4,
  'kling-image-expand': 2.72,
  cleanup: 34,
  'generative-upscale': 54.4,
  hunyuan3d: 8,
  hyper3d: 14,
  tripo3d: 10
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

export function quoteInternalCreditsFromCny(upstreamCostCny) {
  const normalizedCost = Number(upstreamCostCny);
  if (!Number.isFinite(normalizedCost) || normalizedCost < 0) {
    throw Object.assign(new Error('The upstream CNY cost is invalid.'), {
      code: 'invalid-provider-cost',
      status: 502
    });
  }
  return Math.ceil(normalizedCost * APP_CREDITS_PER_CNY * INTERNAL_COST_MULTIPLIER);
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
    (normalizedCost * TOPAZ_PROVIDER_PTC_PER_POINT + PROFIT_PER_REQUEST_CNY) * APP_CREDITS_PER_CNY
  );
}

export function quoteInternalTopazRetailCredits(providerCost) {
  const normalizedCost = Number(providerCost);
  if (!Number.isInteger(normalizedCost) || normalizedCost < 0 || normalizedCost > 1_000_000) {
    throw Object.assign(new Error('The Topaz provider cost is invalid.'), {
      code: 'invalid-provider-cost',
      status: 502
    });
  }
  return quoteInternalCreditsFromCny(normalizedCost * TOPAZ_PROVIDER_PTC_PER_POINT);
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

// This quote is used only after usage.js has resolved the authenticated
// account tier through the service-role-only get_ai_pricing_tier RPC.
export function quoteInternalButlerRetailCredits(providerId, providerCost = null) {
  const normalizedProvider = String(providerId || '').trim().toLowerCase();
  if (TOPAZ_DYNAMIC_PROVIDERS.has(normalizedProvider)) {
    return quoteInternalTopazRetailCredits(providerCost);
  }
  const upstreamCredits = BUTLER_FIXED_UPSTREAM_CREDITS[normalizedProvider];
  if (!Number.isFinite(upstreamCredits)) return quoteButlerRetailCredits(normalizedProvider, providerCost);
  return Math.ceil(upstreamCredits * INTERNAL_COST_MULTIPLIER);
}
