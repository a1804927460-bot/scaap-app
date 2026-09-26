'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { operatingCostCny } = require('../lib/operating-costs');
const {
  POINTS_PER_CNY,
  CREDIT_PRICING_VERSION,
  RETAIL_GROSS_MARGIN_PERCENT,
  RETAIL_MARKUP_PERCENT,
  RETAIL_MULTIPLIER,
  PROFIT_PER_REQUEST_CNY,
  PROFIT_PER_REQUEST_CREDITS,
  USD_TO_CNY,
  MINIMUM_VIDEO_CREDITS,
  IMAGE_QUALITY_PRICES,
  IMAGE_QUALITY_RESOLUTION_PRICES,
  IMAGE_RESOLUTION_PRICES,
  VIDEO_RATES,
  IMAGE_OPERATING_COST_RETAIL_CREDITS,
  VIDEO_OPERATING_COST_RETAIL_CREDITS,
  conservativeMediaCreditQuote,
  quoteMediaCredits,
  retailCreditsFromUpstreamCny,
  publicCreditPricing
} = require('../lib/credit-pricing');

assert.strictEqual(POINTS_PER_CNY, 1000 / 70);
assert.strictEqual(CREDIT_PRICING_VERSION, '202609270001');
assert.strictEqual(RETAIL_GROSS_MARGIN_PERCENT, 30);
assert.ok(Math.abs(RETAIL_MARKUP_PERCENT - (RETAIL_MULTIPLIER * 100 - 100)) < 1e-12);
assert.strictEqual(RETAIL_MULTIPLIER, 1 / 0.619);
assert.strictEqual(PROFIT_PER_REQUEST_CNY, 0);
assert.strictEqual(PROFIT_PER_REQUEST_CREDITS, 0);
assert.strictEqual(USD_TO_CNY, 7.3);
assert.strictEqual(MINIMUM_VIDEO_CREDITS, 0);
assert.strictEqual(retailCreditsFromUpstreamCny(1.5), 39, 'CNY upstream cost must include the 10% estimate buffer and preserve a 30% margin after payment costs.');
assert.strictEqual(retailCreditsFromUpstreamCny(0), 0, 'A zero-cost operation must not receive a fixed charge.');
assert.throws(() => retailCreditsFromUpstreamCny(-0.01), TypeError);

assert.deepStrictEqual(quoteMediaCredits({
  kind: 'image',
  imageProviderId: 'image-1',
  count: 2
}), {
  kind: 'image',
  providerId: 'image-1',
  resolution: '2k',
  count: 2,
  units: 2,
  unit: 'image',
  unitCredits: 10,
  totalCredits: 20
});

assert.strictEqual(quoteMediaCredits({
  kind: 'image',
  imageProviderId: 'image-4',
  count: 99
}).totalCredits, 24, 'Image count must be capped at four.');

const localBatchQuote = quoteMediaCredits({
  kind: 'image', imageProviderId: 'image-2', count: 4, size: '2K'
});
assert.deepStrictEqual(
  conservativeMediaCreditQuote(localBatchQuote, {
    kind: 'image', providerId: 'image-2', unitCredits: 18, totalCredits: 18, count: 4
  }, { count: 4 }),
  {
    ...localBatchQuote,
    unitCredits: 18,
    totalCredits: 72
  },
  'A stale gateway quote must never lower the bundled four-image estimate.'
);
assert.deepStrictEqual(
  conservativeMediaCreditQuote(localBatchQuote, {
    kind: 'image', providerId: 'image-2', unitCredits: 25, totalCredits: 25, count: 4
  }, { count: 4 }),
  {
    ...localBatchQuote,
    unitCredits: 25,
    totalCredits: 100
  },
  'A malformed remote batch total must be raised to remote unit price times count.'
);
const currentVideoQuote = quoteMediaCredits({
  kind: 'video', videoProviderId: 'video-3', resolution: '4K-ESR', duration: 6
});
assert.equal(
  conservativeMediaCreditQuote(currentVideoQuote, {
    providerId: 'video-3', unitCredits: 22.78, totalCredits: 151, duration: 6
  }).totalCredits,
  4291,
  'A stale 151-point Seedance quote must never lower the current six-second estimate.'
);
const localVideoQuote = quoteMediaCredits({
  kind: 'video', videoProviderId: 'video-10', resolution: '720P', duration: 10
});
assert.ok(
  conservativeMediaCreditQuote(localVideoQuote, {
    kind: 'video', providerId: 'video-11', unitCredits: 24.6, totalCredits: 24.6, duration: 10
  }).totalCredits >= 246,
  'A malformed remote video total must still include the complete duration.'
);

assert.deepStrictEqual(quoteMediaCredits({
  kind: 'image',
  imageProviderId: 'image-6',
  quality: 'high',
  count: 2
}), {
  kind: 'image',
  providerId: 'image-6',
  quality: 'high',
  resolution: '1k',
  count: 2,
  units: 2,
  unit: 'image',
  unitCredits: 62,
  totalCredits: 124
});
assert.strictEqual(quoteMediaCredits({
  kind: 'image',
  imageProviderId: 'image-6',
  quality: 'invalid'
}).totalCredits, 18, 'Unknown GPT Image 2 quality must use the medium-quality price.');

assert.strictEqual(quoteMediaCredits({
  kind: 'image', imageProviderId: 'image-7', resolution: '720p', count: 4
}).totalCredits, 24);
assert.strictEqual(quoteMediaCredits({
  kind: 'image', imageProviderId: 'image-8', size: '1080p', count: 4
}).totalCredits, 44);
assert.strictEqual(quoteMediaCredits({
  kind: 'image', imageProviderId: 'image-1', size: '4K'
}).totalCredits, 12);
assert.strictEqual(quoteMediaCredits({
  kind: 'image', imageProviderId: 'image-2', size: '1K'
}).totalCredits, 6);
assert.strictEqual(quoteMediaCredits({
  kind: 'image', imageProviderId: 'image-9'
}).totalCredits, 8);
assert.strictEqual(quoteMediaCredits({
  kind: 'image', imageProviderId: 'image-17'
}).totalCredits, 16);
assert.strictEqual(quoteMediaCredits({
  kind: 'image', imageProviderId: 'image-18', size: '2K'
}).totalCredits, 23);

const imageResolutionMatrix = {
  'image-1': { '1K': 10, '2K': 10, '4K': 12 },
  'image-2': { '1K': 6, '2K': 6, '4K': 7 },
  'image-3': { '2K': 8, '4K': 14 }
};
Object.entries(imageResolutionMatrix).forEach(([imageProviderId, resolutions]) => {
  Object.entries(resolutions).forEach(([size, expectedCredits]) => {
    assert.strictEqual(
      quoteMediaCredits({ kind: 'image', imageProviderId, size }).totalCredits,
      expectedCredits,
      `${imageProviderId} ${size} must use its exact resolution price.`
    );
  });
});
Object.entries(IMAGE_QUALITY_RESOLUTION_PRICES['image-6']).forEach(([quality, resolutions]) => {
  Object.entries(resolutions).forEach(([size, expectedCredits]) => {
    assert.strictEqual(
      quoteMediaCredits({ kind: 'image', imageProviderId: 'image-6', quality, size }).totalCredits,
      expectedCredits,
      `GPT Image 2 ${quality} ${size} must use its exact provider price.`
    );
  });
});
assert.deepStrictEqual(
  ['1K', '2K', '4K'].map((size) => quoteMediaCredits({ kind: 'image', imageProviderId: 'image-19', size }).totalCredits),
  [5, 5, 7],
  'GPT Image 2.5 must use resolution-only prices with the same protected 30% margin.'
);

assert.deepStrictEqual(quoteMediaCredits({
  kind: 'video',
  videoProviderId: 'video-1',
  resolution: '2K',
  duration: 6
}), {
  kind: 'video',
  providerId: 'video-1',
  resolution: '2K',
  duration: 6,
  units: 6,
  unit: 'second',
  unitCredits: 34,
  fixedCredits: 0,
  minimumCredits: 0,
  totalCredits: 210
});

assert.strictEqual(quoteMediaCredits({
  kind: 'video',
  resolution: '768P',
  duration: undefined
}).totalCredits, 132, 'Invalid duration must use the six-second default.');

assert.strictEqual(quoteMediaCredits({
  kind: 'video',
  resolution: '768P',
  duration: 0
}).totalCredits, 90, 'Video billing must enforce the four-second minimum.');

assert.strictEqual(quoteMediaCredits({
  kind: 'video', videoProviderId: 'video-1', resolution: '768P', duration: 6,
  referenceMediaTypes: ['video']
}).totalCredits, 445, 'A MiniMax reference video must reserve the documented 15-second input maximum.');

assert.strictEqual(quoteMediaCredits({
  kind: 'video', videoProviderId: 'video-1', resolution: '2K', duration: 6,
  referenceMediaTypes: Array(9).fill('image')
}).totalCredits, 251, 'MiniMax must reserve the documented image charge after the first five.');

assert.deepStrictEqual(quoteMediaCredits({
  kind: 'video',
  videoProviderId: 'video-2',
  resolution: '480P',
  duration: 5
}), {
  kind: 'video',
  providerId: 'video-2',
  resolution: '480P',
  duration: 5,
  units: 5,
  unit: 'second',
  unitCredits: 21,
  fixedCredits: 0,
  minimumCredits: 0,
  totalCredits: 112
});

assert.strictEqual(quoteMediaCredits({
  kind: 'video',
  videoProviderId: 'video-3',
  resolution: '720P',
  duration: 5
}).totalCredits, 288);

assert.deepStrictEqual(
  {
    duration: quoteMediaCredits({
      kind: 'video', videoProviderId: 'video-2', resolution: '720P', duration: -1
    }).duration,
    totalCredits: quoteMediaCredits({
      kind: 'video', videoProviderId: 'video-2', resolution: '720P', duration: -1
    }).totalCredits
  },
  { duration: 15, totalCredits: 684 },
  'Seedance 2.0 automatic duration must reserve its full 15-second maximum.'
);

assert.deepStrictEqual(
  {
    duration: quoteMediaCredits({
      kind: 'video', videoProviderId: 'video-3', resolution: '720P', duration: -1
    }).duration,
    totalCredits: quoteMediaCredits({
      kind: 'video', videoProviderId: 'video-3', resolution: '720P', duration: -1
    }).totalCredits
  },
  { duration: 30, totalCredits: 1691 },
  'Seedance 2.5 automatic duration must reserve its full 30-second maximum.'
);

assert.strictEqual(quoteMediaCredits({
  kind: 'video',
  videoProviderId: 'video-2',
  resolution: 'unsupported',
  duration: 6
}).totalCredits, 278, 'Unknown Seedance resolutions must use that provider\'s default 720P rate.');

assert.strictEqual(
  quoteMediaCredits({ kind: 'video', videoProviderId: 'video-3', resolution: '480P', duration: 30 }).totalCredits,
  789,
  'Seedance 2.5 must support 30 seconds and apply the proportional markup once.'
);

assert.strictEqual(
  quoteMediaCredits({ kind: 'video', videoProviderId: 'video-3', resolution: '720P', duration: 10 }).totalCredits,
  568,
  'Seedance 2.5 720P must use the verified Atlas primary-route cost.'
);
assert.strictEqual(
  quoteMediaCredits({ kind: 'video', videoProviderId: 'video-3', resolution: '1440P-SR', duration: 6 }).totalCredits,
  791,
  'Seedance 2.5 1440P-SR at six seconds must not reuse a stale 720P five-second quote.'
);
assert.strictEqual(
  quoteMediaCredits({ kind: 'video', videoProviderId: 'video-3', resolution: '4K-ESR', duration: 10 }).totalCredits,
  4291,
  'Seedance 2.5 4K-ESR must use the observed 23.11727243 PTC per ten-second upstream quote.'
);
assert.strictEqual(
  quoteMediaCredits({ kind: 'video', videoProviderId: 'video-3', resolution: '4K-ESR', duration: 6 }).totalCredits,
  4291,
  'Seedance 2.5 4K-ESR at the default six seconds must not use the retired 151-point quote.'
);
assert.strictEqual(
  quoteMediaCredits({ kind: 'video', videoProviderId: 'video-2', resolution: '720P', duration: 10 }).totalCredits,
  458,
  'Seedance 2.0 must use the verified Atlas primary-route cost.'
);
assert.strictEqual(
  quoteMediaCredits({ kind: 'video', videoProviderId: 'video-4', resolution: '720P', duration: 10 }).totalCredits,
  320,
  'Seedance 2.0 Fast must use its documented 6.516 PTC/M-token multiplier.'
);

assert.deepStrictEqual(
  quoteMediaCredits({
    kind: 'video', videoProviderId: 'video-10', resolution: '1080P', duration: 10
  }),
  {
    kind: 'video', providerId: 'video-11', resolution: '1080P', duration: 10,
    units: 10, unit: 'second', unitCredits: 63, fixedCredits: 0,
    minimumCredits: 0, totalCredits: 631
  },
  'Kling V3 1080P must quote and reserve against the Pro route.'
);
assert.strictEqual(
  quoteMediaCredits({
    kind: 'video', videoProviderId: 'video-12', serviceTier: 'pro', resolution: '1080P', duration: 15
  }).totalCredits,
  1008,
  'Kling O3 Pro must never be quoted at the Standard route price.'
);
assert.strictEqual(
  quoteMediaCredits({
    kind: 'video', videoProviderId: 'video-12', serviceTier: 'standard', resolution: '720P', duration: 15
  }).totalCredits,
  841,
  'Kling O3 Standard must retain its own route price.'
);

const publicPricing = publicCreditPricing();
assert.strictEqual(publicPricing.pricingVersion, CREDIT_PRICING_VERSION);
assert.strictEqual(publicPricing.pointsPerCny, 1000 / 70);
assert.strictEqual(publicPricing.grossMarginPercent, 30);
assert.ok(Math.abs(publicPricing.retailMarkupPercent - (RETAIL_MULTIPLIER * 100 - 100)) < 1e-12);
assert.strictEqual(publicPricing.retailMultiplier, 1 / 0.619);
assert.strictEqual(publicPricing.upstreamCostSafetyPercent, 10);
assert.strictEqual(publicPricing.chat, null, 'Chat is usage-priced, never a fixed free request');
assert.strictEqual(publicPricing.profitPerRequestCny, 0);
assert.strictEqual(publicPricing.minimumVideoCredits, 0);
assert.strictEqual(IMAGE_OPERATING_COST_RETAIL_CREDITS, 1);
assert.strictEqual(VIDEO_OPERATING_COST_RETAIL_CREDITS, 7);
assert.strictEqual(publicPricing.operatingCostPricingVersion, '202609090001');
assert.ok(Math.abs(publicPricing.operatingCosts.image.total - 0.013) < 1e-12);
assert.strictEqual(publicPricing.operatingCosts.video.total, 0.25);
assert.strictEqual(publicPricing.image['image-5'], 6);
assert.strictEqual(publicPricing.image['image-9'], 8);
assert.strictEqual(publicPricing.image['image-3'], 8);
assert.strictEqual(publicPricing.image['image-6'], 18);
assert.deepStrictEqual(publicPricing.imageQuality['image-6'], IMAGE_QUALITY_PRICES['image-6']);
assert.deepStrictEqual(publicPricing.imageQualityResolution['image-6'], IMAGE_QUALITY_RESOLUTION_PRICES['image-6']);
assert.deepStrictEqual(publicPricing.imageResolution['image-7'], IMAGE_RESOLUTION_PRICES['image-7']);
assert.deepStrictEqual(publicPricing.imageResolution['image-8'], IMAGE_RESOLUTION_PRICES['image-8']);
assert.deepStrictEqual(publicPricing.imageResolution['image-1'], IMAGE_RESOLUTION_PRICES['image-1']);
assert.deepStrictEqual(publicPricing.imageResolution['image-2'], IMAGE_RESOLUTION_PRICES['image-2']);
assert.strictEqual(publicPricing.video['video-1']['768P'], 21);
assert.strictEqual(publicPricing.video['video-1']['2K'], 34);
assert.deepStrictEqual(publicPricing.video['video-2'], VIDEO_RATES['video-2']);
assert.deepStrictEqual(publicPricing.video['video-3'], VIDEO_RATES['video-3']);

const providerCatalog = require('../config/provider-catalog.json');
providerCatalog.providers.filter((provider) => provider.hidden !== true && ['image', 'video'].includes(provider.kind))
  .forEach((provider) => {
    const capabilities = provider.capabilities || {};
    if (provider.kind === 'image') {
      const sizes = capabilities.resolutionPresets || capabilities.sizes || [''];
      sizes.forEach((size) => {
        assert.ok(
          quoteMediaCredits({ kind: 'image', imageProviderId: provider.id, size }).totalCredits > 0,
          `${provider.id} ${size} must have a positive retail quote.`
        );
      });
      return;
    }
    (capabilities.resolutions || []).forEach((resolution) => {
      const serviceTier = Object.entries(capabilities.tierResolutions || {})
        .find(([, resolutions]) => Array.isArray(resolutions)
          && resolutions.some((value) => String(value).toUpperCase() === String(resolution).toUpperCase()))?.[0];
      const quote = quoteMediaCredits({
        kind: 'video', videoProviderId: provider.id, resolution,
        duration: (capabilities.variantOptions?.[serviceTier]?.durations || capabilities.durations || [6])[0], serviceTier
      });
      assert.strictEqual(
        quote.resolution,
        String(resolution).toUpperCase(),
        `${provider.id} ${resolution} must have an exact rate instead of silently falling back to another resolution.`
      );
      assert.ok(quote.totalCredits >= MINIMUM_VIDEO_CREDITS);
    });
  });

const boardSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'board-canvas.js'), 'utf8');
const assistantSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'ai-assistant.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
const runtimeSource = fs.readFileSync(path.join(__dirname, '..', 'config', 'provider-catalog.json'), 'utf8');
const unifiedPricingMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '202608180001_unified_credit_pricing.sql'), 'utf8');
const seedancePtcMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '202608180003_seedance_ptc_credit_pricing.sql'), 'utf8');
const rebuiltPricingMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '202608200002_rebuild_credit_pricing.sql'), 'utf8');
const proportionalPricingMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '202608200003_percentage_markup_credit_pricing.sql'), 'utf8');
const approvedPricingMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '202608220002_approved_retail_pricing.sql'), 'utf8');
const settledUsageReportMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '202608220007_reprice_settled_usage_reporting.sql'), 'utf8');
const authoritativeUsageReportMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '202608230002_authoritative_settled_usage_reporting.sql'), 'utf8');
const unifiedMediaMarginMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '202609050002_unified_media_margin.sql'), 'utf8');
const mediaMargin30Migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '202609270001_media_margin30_pricing.sql'), 'utf8');
const falToolPricingMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '202609270002_fal_tool_pricing_isolation.sql'), 'utf8');
const legnextMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '202608180005_legnext_midjourney_credits.sql'), 'utf8');
const redemptionMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '202608180002_three_666_credit_codes.sql'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
const boardStyles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles', 'main.css'), 'utf8');
assert.match(
  boardSource,
  /class="ai-credit-estimate"[\s\S]*?function updateCreditEstimate\(\)[\s\S]*?quoteMediaCredits[\s\S]*?totalCredits/,
  'The generation composer must display the authoritative media-credit quote.'
);
assert.match(
  boardSource,
  /kind,[\s\S]*?providerId: provider\.id,[\s\S]*?count: kind === 'image' \? count[\s\S]*?resolution: size,[\s\S]*?duration: kind === 'video' \? duration/,
  'Credit quotes must use the selected model, image count, video resolution and duration.'
);
assert.match(
  boardStyles,
  /\.ai-credit-estimate\s*\{[\s\S]*?white-space:\s*nowrap;/,
  'The composer credit estimate must remain legible beside the submit button.'
);
assert.match(
  indexHtml,
  /id="ai-assistant-credit-estimate"[\s\S]*?id="ai-assistant-submit"/,
  'The assistant must show its media quote next to the generation action.'
);
assert.match(
  assistantSource,
  /function updateAssistantCreditEstimate\(\)[\s\S]*?quoteMediaCredits[\s\S]*?imageProviderId:[\s\S]*?videoProviderId:[\s\S]*?count:[\s\S]*?resolution:[\s\S]*?duration:/,
  'The assistant quote must react to the selected model, count, video resolution and duration.'
);
assert.match(
  assistantSource,
  /function updateAssistantCreditEstimate\(\)[\s\S]*?size: kind === 'image' \? document\.getElementById\('ai-assistant-size'\)\.value/,
  'The assistant quote must include the selected image resolution.'
);
assert.match(
  assistantSource,
  /kind === 'chat'[\s\S]*?renderAssistantCreditEstimate\(0\)[\s\S]*?return;/,
  'Chat/Agent must clear the media quote and remain free.'
);
assert.match(
  mainSource,
  /const creditQuote = await quoteMediaCreditsForAccount\(\{[\s\S]*?size: request\.size,[\s\S]*?resolution: request\.resolution/,
  'Main-process settlement must use the account-authorized quote for the selected image size.'
);
assert.match(legnextMigration, /reserve_legnext_credits/);
assert.match(legnextMigration, /image-17/);
assert.match(legnextMigration, /image-18/);
assert.doesNotMatch(mainSource, /Chaser0713|49c8f3fd5b5b39253cf33a3bbcd14a270c8fbada802b1248408bdf7ccac98415/);
assert.doesNotMatch(preloadSource, /Chaser0713|staff15|pricing_tier/);
assert.doesNotMatch(runtimeSource, /Chaser0713|staff15|pricing_tier/);
assert.match(unifiedPricingMigration, /pricing_tier = 'standard'/);
assert.match(seedancePtcMigration, /302 PTC is USD/i);
assert.match(seedancePtcMigration, /0\.2592 \* \(7\.884 \/ 10\)/);
assert.match(seedancePtcMigration, /0\.2592 \* \(6\.516 \/ 10\)/);
assert.match(seedancePtcMigration, /quote_seedance_retail_credits/);
assert.match(rebuiltPricingMigration, /USD 1 = CNY 7\.3/);
assert.match(rebuiltPricingMigration, /when '4K-ESR' then 166\.294/);
assert.match(rebuiltPricingMigration, /normalized_quality \|\| ':' \|\| normalized_image_resolution/);
assert.match(rebuiltPricingMigration, /p_provider_cost::numeric \* 7\.3/);
assert.match(proportionalPricingMigration, /upstream cost plus 20%/i);
assert.match(proportionalPricingMigration, /23\.11727243/);
assert.match(proportionalPricingMigration, /quote_retail_credits_from_upstream_points/);
assert.match(proportionalPricingMigration, /p_provider_cost::numeric \* 0\.01 \* 7\.3 \* 10 \* 1\.20/);
assert.doesNotMatch(proportionalPricingMigration, /greatest\(30|\+\s*14/);
assert.match(approvedPricingMigration, /when '4k' then 40[\s\S]*?else 20/i);
assert.match(approvedPricingMigration, /when '2k' then 40 else 12/i);
assert.match(approvedPricingMigration, /when '2K' then 20 else 15/i);
assert.match(approvedPricingMigration, /else 22\.1160654 end/i);
assert.match(settledUsageReportMigration, /current_policy_ai_usage_credits/i);
assert.match(settledUsageReportMigration, /historicalCreditsCharged/i);
assert.match(settledUsageReportMigration, /greatest\(\s*0, coalesce\(usage_row\.credits_charged, 0\), coalesce\(/i);
assert.match(settledUsageReportMigration, /quote_retail_credits_from_upstream_points/i);
assert.match(settledUsageReportMigration, /quote_video_retail_credits_from_upstream_points/i);
assert.match(authoritativeUsageReportMigration, /immutable ai_usage\.credits_charged value/i);
assert.match(authoritativeUsageReportMigration, /create or replace function public\.authoritative_ai_usage_summary/i);
assert.match(authoritativeUsageReportMigration, /greatest\(0, coalesce\(usage_row\.credits_charged, 0\)\)/i);
assert.match(authoritativeUsageReportMigration, /get_canvas_ai_usage_summary_legacy_repriced/i);
assert.doesNotMatch(authoritativeUsageReportMigration, /current_policy_ai_usage_credits/i);
assert.match(unifiedMediaMarginMigration, /\* \(10\.0 \/ 7\.0\) \* 1\.10 \/ 0\.80/);
assert.match(unifiedMediaMarginMigration, /when '1k' then 0\.14 \* 7\.3 \* 10\.0/);
assert.match(unifiedMediaMarginMigration, /when '1k' then 0\.048 \* 7\.3 \* 10\.0/);
assert.match(mediaMargin30Migration, /target a 30% gross/i);
assert.match(falToolPricingMigration, /quote_fal_tool_retail_credits_from_cny\(upstream_usd \* 7\.3 \+ 0\.013\)/);
assert.match(falToolPricingMigration, /1\.10 \/ 0\.75/);
assert.doesNotMatch(falToolPricingMigration, /quote_media_retail_credits_from_cny\(upstream_usd/);
const { quoteFalTool } = require('../lib/fal-pricing');
for (const [providerId, options, upstreamUsd] of [
  ['background-remove', {}, 0.001],
  ['clipdrop-uncrop', { width: 1024 }, 0.20],
  ['clipdrop-uncrop', { width: 4096 }, 0.35],
  ['clipdrop-upscale', { megapixels: 12 }, 0.08]
]) {
  const databaseQuote = Math.ceil((upstreamUsd * USD_TO_CNY + 0.013) * POINTS_PER_CNY * 1.10 / 0.75);
  assert.strictEqual(quoteFalTool(providerId, options).credits, databaseQuote, `${providerId} tool reservation must match gateway pricing.`);
}
assert.match(mediaMargin30Migration, /1\.10 \/ 0\.619/);
assert.match(mediaMargin30Migration, /image-19/);
assert.match(mediaMargin30Migration, /aireiter-image-gpt25-flare/);
assert.match(mediaMargin30Migration, /aireiter-image-gpt25-sunburst/);
assert.doesNotMatch(
  mediaMargin30Migration,
  /\b(?:update|delete\s+from|truncate)\s+(?:table\s+)?(?:public\.)?(?:ai_usage|profiles|credit_ledger|credit_reservations)\b/i,
  'A pricing-policy migration must not rewrite balances or historical usage.'
);
assert.doesNotMatch(
  unifiedMediaMarginMigration,
  /0\.(?:14|048|24|072|48|108) \* 7\.3 \* \(1000\.0 \/ 70\.0\)/,
  'AI Reiter USD image prices must enter the legacy-point quote helper exactly once.'
);
assert.match(unifiedMediaMarginMigration, /quote_image_operating_cost_upstream_points\(\)[\s\S]*?0\.013 \* 10\.0/);
assert.match(unifiedMediaMarginMigration, /quote_video_operating_cost_upstream_points\(\)[\s\S]*?0\.250 \* 10\.0/);
assert.doesNotMatch(
  unifiedMediaMarginMigration,
  /quote_(?:image|video)_operating_cost_upstream_points\(\)[\s\S]{0,120}?1000\.0 \/ 70\.0/,
  'Operating costs must be converted to legacy upstream points before the single denomination conversion.'
);
assert.doesNotMatch(unifiedPricingMigration, /Chaser0713|staff15/);
assert.strictEqual((redemptionMigration.match(/, 666, false, 1, null, true\)/g) || []).length, 3);
assert.strictEqual((redemptionMigration.match(/'[0-9a-f]{64}'/g) || []).length, 3);
assert.doesNotMatch(redemptionMigration, /MESSS-666-/);
assert.match(
  mainSource,
  /const isPendingDelivery = !!aiDeliveryToken[\s\S]*?const resultCharge = isPendingDelivery[\s\S]*?deliveryGroup\.settledCredits \+= resultCharge/,
  'Successful outputs must defer settlement until the opaque delivery token is confirmed.'
);
assert.match(
  mainSource,
  /estimatedCredits: kind === 'video'[\s\S]*?authoritativeVideoEstimate[\s\S]*?pricing:/,
  'Successful generation must return the retail estimate and normalized pricing.'
);
assert.match(
  assistantSource,
  /function appendAssistantMedia\(files, kind, sessionId = AiAssistant.activeSessionId\)[\s\S]*?body\.textContent = completionText;/,
  'The assistant must show completion without exposing the settled charge.'
);
assert.doesNotMatch(assistantSource, /Actual charge:|实际扣除/);
assert.match(
  boardSource,
  /await confirmAiMediaDeliveries\(files\)/,
  'The canvas must confirm delivery only after the persisted board placement.'
);
assert.doesNotMatch(boardSource, /Actual charge:|实际扣除/);

async function assertGatewayPricingParity() {
  const { quoteUsage } = await import(pathToFileURL(path.join(__dirname, '..', 'gateway', 'src', 'usage.js')).href);
  const pricing = publicCreditPricing();

  Object.keys(pricing.image).forEach((providerId) => {
    const qualityRates = pricing.imageQuality[providerId];
    const resolutionRates = pricing.imageResolution[providerId];
    const variants = qualityRates
      ? Object.keys(qualityRates).map((quality) => ({ quality }))
      : resolutionRates
        ? Object.keys(resolutionRates).map((size) => ({ size }))
        : [{}];
    variants.forEach((variant) => {
      const desktop = quoteMediaCredits({ kind: 'image', imageProviderId: providerId, ...variant });
      const gateway = quoteUsage('image', { providerId, ...variant });
      assert.strictEqual(
        desktop.totalCredits,
        gateway.credits,
        `Desktop and gateway image pricing must match for ${providerId} ${JSON.stringify(variant)}.`
      );
    });
  });

  for (const providerId of ['video-1', 'video-2', 'video-3']) {
    const rates = pricing.video[providerId];
    assert.ok(rates, `Public video pricing must include ${providerId}.`);
    Object.keys(rates).forEach((resolution) => {
      const request = { kind: 'video', videoProviderId: providerId, resolution, duration: 6 };
      const desktop = quoteMediaCredits(request);
      const gateway = quoteUsage('video', { providerId, resolution, duration: 6 });
      assert.strictEqual(
        desktop.totalCredits,
        gateway.credits,
        `Desktop and gateway video pricing must match for ${providerId} ${resolution}.`
      );
    });
  }

  for (const providerId of ['video-4', 'video-10', 'video-12']) {
    assert.throws(
      () => quoteUsage('video', { providerId, resolution: '720P', duration: 6 }),
      (error) => error && error.code === 'provider-not-allowed'
    );
  }
}

function assertCostProtection() {
  const imageCases = [
    ['image-1', { size: '1K' }, 0.05 * USD_TO_CNY],
    ['image-1', { size: '2K' }, 0.05 * USD_TO_CNY],
    ['image-1', { size: '4K' }, 0.06 * USD_TO_CNY],
    ['image-2', { size: '1K' }, 0.03 * USD_TO_CNY],
    ['image-2', { size: '2K' }, 0.03 * USD_TO_CNY],
    ['image-2', { size: '4K' }, 0.035 * USD_TO_CNY]
  ];
  for (const [providerId, options, upstreamCny] of imageCases) {
    const quote = quoteMediaCredits({ kind: 'image', imageProviderId: providerId, ...options }).totalCredits;
    const protectedCost = retailCreditsFromUpstreamCny(upstreamCny + operatingCostCny('image'));
    assert.ok(quote >= protectedCost, `${providerId} image quote must cover upstream cost and operations.`);
  }
  for (const [quality, rates] of Object.entries({
    low: { '1K': 0.022, '2K': 0.029, '4K': 0.036 },
    medium: { '1K': 0.092, '2K': 0.100, '4K': 0.170 },
    high: { '1K': 0.330, '2K': 0.350, '4K': 0.620 }
  })) {
    for (const [size, upstreamUsd] of Object.entries(rates)) {
      const quote = quoteMediaCredits({ kind: 'image', imageProviderId: 'image-6', quality, size }).totalCredits;
      const protectedCost = retailCreditsFromUpstreamCny(upstreamUsd * USD_TO_CNY + operatingCostCny('image'));
      assert.ok(quote >= protectedCost, `GPT Image 2 ${quality} ${size} must cover upstream cost and operations.`);
    }
  }

  for (const providerId of ['video-1', 'video-2', 'video-3']) {
    for (const [resolution, upstreamRateCredits] of Object.entries(VIDEO_RATES[providerId])) {
      const duration = 6;
      const upstreamRateCny = providerId === 'video-1'
        ? (resolution === '2K' ? 0.1825 : 0.1125) * USD_TO_CNY
        : upstreamRateCredits / POINTS_PER_CNY;
      const minimumCny = providerId === 'video-3' && resolution === '4K-ESR'
        ? 23.11727243 * USD_TO_CNY
        : 0;
      const upstreamCny = Math.max(upstreamRateCny * duration, minimumCny);
      const quote = quoteMediaCredits({ kind: 'video', videoProviderId: providerId, resolution, duration }).totalCredits;
      const protectedCost = retailCreditsFromUpstreamCny(upstreamCny + operatingCostCny('video'));
      assert.ok(quote >= protectedCost, `${providerId} ${resolution} video quote must cover upstream cost and operations.`);
    }
  }
}

assertGatewayPricingParity()
  .then(() => { assertCostProtection(); process.stdout.write('Credit pricing tests passed.\n'); })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
