export const TOPAZ_PROVIDER_PTC_PER_POINT = 0.15;
export const APP_CREDITS_PER_CNY = 10;
export const TOPAZ_RETAIL_MARKUP = 2;
export const TOPAZ_RETAIL_CREDIT_MULTIPLIER =
  TOPAZ_PROVIDER_PTC_PER_POINT * APP_CREDITS_PER_CNY * TOPAZ_RETAIL_MARKUP;

export const BUTLER_FIXED_RETAIL_CREDITS = Object.freeze({
  'background-remove': 1,
  'qwen-image-edit-plus': 2,
  'qwen-image-layered': 1,
  'super-upscale-v2': 2,
  erase: 1,
  hunyuan3d: 8,
  hyper3d: 14
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
  if (normalizedProvider === 'topaz-video-upscale') {
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
