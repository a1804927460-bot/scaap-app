export const TOPAZ_PROVIDER_PTC_PER_POINT = 0.15;
export const APP_CREDITS_PER_CNY = 10;
export const TOPAZ_RETAIL_MARKUP = 2;
export const TOPAZ_RETAIL_CREDIT_MULTIPLIER =
  TOPAZ_PROVIDER_PTC_PER_POINT * APP_CREDITS_PER_CNY * TOPAZ_RETAIL_MARKUP;

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
