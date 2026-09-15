'use strict';
const {quoteMediaCredits, USD_TO_CNY, POINTS_PER_CNY, UPSTREAM_COST_SAFETY_MULTIPLIER} = require('./credit-pricing');
const {operatingCostCny} = require('./operating-costs');
// Exact public per-image costs verified 2026-09-09. Missing dimensions are
// intentionally unsupported, never silently replaced by another resolution.
const COSTS = Object.freeze({
  nano_banana_pro: { '1K':0.05, '2K':0.05, '4K':0.06 },
  nano_banana_v2: { '1K':0.03, '2K':0.03, '4K':0.035 },
  'fal-backup-nano-pro': { '1K':0.15, '2K':0.15, '4K':0.30 },
  'fal-backup-nano-2': { '1K':0.08, '2K':0.12, '4K':0.16 }
  , 'fal-backup-gpt-image-25-flare': { '1K':0.020, '2K':0.025, '4K':0.035 }
  , 'fal-backup-gpt-image-25-sun': { '1K':0.020, '2K':0.025, '4K':0.035 }
  , 'image-19': { '1K':0.020, '2K':0.025, '4K':0.035 }
});
function selectEconomyImageRoutes(requested, candidates, body, priceProfiles = COSTS) {
  if (!['image-1','image-2','image-19'].includes(requested.id)) return candidates;
  const size = String(body.size || body.resolution || '2K').trim().toUpperCase();
  const ratio = String(body.aspectRatio || body.ratio || 'auto').trim();
  const references = Array.isArray(body.urls) ? body.urls.length : 0;
  const retail = quoteMediaCredits({kind:'image',providerId:requested.id,size,count:1,performanceMode:body.performanceMode}).totalCredits / POINTS_PER_CNY;
  // 10% minimum margin after payment fees, operating allowance and risk buffer.
  const maxCostCny = retail * (1 - 0.081 - 0.10) / UPSTREAM_COST_SAFETY_MULTIPLIER - operatingCostCny('image');
  return candidates.map(route => {
    // A shared transport protocol is not proof that two models are equivalent.
    if (route.logicalModel !== requested.logicalModel) return null;
    let host;
    try { host = new URL(route.endpoint).hostname; } catch { return null; }
    const quick=route.id.startsWith('quickrouter-nano-');
    if (quick ? host !== 'api.quickrouter.ai' || route.quickRouterVerified !== true : route.id.startsWith('fal-backup-') ? host !== 'queue.fal.run' : host !== 'aireiter.com') return null;
    const table = quick ? (references ? route.quickRouterEditCosts : route.quickRouterCosts) : priceProfiles[route.id] || priceProfiles[route.model] || priceProfiles[requested.id];
    const cost = table?.[size];
    if (!Number.isFinite(cost) || references > (route.capabilities?.maxReferenceImages ?? 8)) return null;
    if (route.capabilities?.sizes && !route.capabilities.sizes.some(value => String(value).toUpperCase() === size)) return null;
    if (route.capabilities?.ratios && !route.capabilities.ratios.includes(ratio)) return null;
    if (body.outputFormat && route.capabilities?.outputFormats && !route.capabilities.outputFormats.includes(body.outputFormat)) return null;
    if (references && route.capabilities?.supportsEdit === false) return null;
    if (cost * USD_TO_CNY > maxCostCny + 1e-9) return null;
    return {route,cost};
  }).filter(Boolean).sort((a,b) => body.performanceMode === 'performance' ? 0 : a.cost-b.cost).map(item=>item.route);
}
module.exports = {selectEconomyImageRoutes};
