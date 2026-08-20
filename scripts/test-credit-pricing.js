'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const {
  POINTS_PER_CNY,
  CREDIT_PRICING_VERSION,
  PROFIT_PER_REQUEST_CNY,
  PROFIT_PER_REQUEST_CREDITS,
  USD_TO_CNY,
  MINIMUM_VIDEO_CREDITS,
  IMAGE_QUALITY_PRICES,
  IMAGE_QUALITY_RESOLUTION_PRICES,
  IMAGE_RESOLUTION_PRICES,
  VIDEO_RATES,
  conservativeMediaCreditQuote,
  quoteMediaCredits,
  retailCreditsFromUpstreamCny,
  publicCreditPricing
} = require('../lib/credit-pricing');

assert.strictEqual(POINTS_PER_CNY, 10);
assert.strictEqual(CREDIT_PRICING_VERSION, '202608200002');
assert.strictEqual(PROFIT_PER_REQUEST_CNY, 1.4);
assert.strictEqual(PROFIT_PER_REQUEST_CREDITS, 14);
assert.strictEqual(USD_TO_CNY, 7.3);
assert.strictEqual(MINIMUM_VIDEO_CREDITS, 30);
assert.strictEqual(retailCreditsFromUpstreamCny(1.5), 29, 'CNY 1.5 upstream cost must retail for CNY 2.9.');
assert.strictEqual(retailCreditsFromUpstreamCny(0), 14, 'Every paid request must include the CNY 1.4 fixed profit.');
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
  unitCredits: 22,
  totalCredits: 44
});

assert.strictEqual(quoteMediaCredits({
  kind: 'image',
  imageProviderId: 'image-4',
  count: 99
}).totalCredits, 64, 'Image count must be capped at four.');

const localBatchQuote = quoteMediaCredits({
  kind: 'image', imageProviderId: 'image-2', count: 4, size: '2K'
});
assert.deepStrictEqual(
  conservativeMediaCreditQuote(localBatchQuote, {
    kind: 'image', providerId: 'image-2', unitCredits: 18, totalCredits: 18, count: 4
  }, { count: 4 }),
  {
    ...localBatchQuote,
    unitCredits: 20,
    totalCredits: 80
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
  1012,
  'A stale 151-point Seedance quote must never lower the current six-second estimate.'
);
const localVideoQuote = quoteMediaCredits({
  kind: 'video', videoProviderId: 'video-10', resolution: '720P', duration: 10
});
assert.ok(
  conservativeMediaCreditQuote(localVideoQuote, {
    kind: 'video', providerId: 'video-11', unitCredits: 24.6, totalCredits: 24.6, duration: 10
  }).totalCredits >= 260,
  'A malformed remote video total must still include the complete duration and fixed margin.'
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
  unitCredits: 30,
  totalCredits: 60
});
assert.strictEqual(quoteMediaCredits({
  kind: 'image',
  imageProviderId: 'image-6',
  quality: 'invalid'
}).totalCredits, 19, 'Unknown GPT Image 2 quality must use the automatic-quality price.');

assert.strictEqual(quoteMediaCredits({
  kind: 'image', imageProviderId: 'image-7', resolution: '720p', count: 4
}).totalCredits, 64);
assert.strictEqual(quoteMediaCredits({
  kind: 'image', imageProviderId: 'image-8', size: '1080p', count: 4
}).totalCredits, 72);
assert.strictEqual(quoteMediaCredits({
  kind: 'image', imageProviderId: 'image-1', size: '4K'
}).totalCredits, 28);
assert.strictEqual(quoteMediaCredits({
  kind: 'image', imageProviderId: 'image-2', size: '1K'
}).totalCredits, 18);
assert.strictEqual(quoteMediaCredits({
  kind: 'image', imageProviderId: 'image-9'
}).totalCredits, 17);
assert.strictEqual(quoteMediaCredits({
  kind: 'image', imageProviderId: 'image-17'
}).totalCredits, 16);
assert.strictEqual(quoteMediaCredits({
  kind: 'image', imageProviderId: 'image-18', size: '2K'
}).totalCredits, 24);

const imageResolutionMatrix = {
  'image-1': { '1K': 22, '2K': 22, '4K': 28 },
  'image-2': { '1K': 18, '2K': 20, '4K': 22 }
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
  unitCredits: 8,
  fixedCredits: 14,
  minimumCredits: 30,
  totalCredits: 62
});

assert.strictEqual(quoteMediaCredits({
  kind: 'video',
  resolution: '768P',
  duration: undefined
}).totalCredits, 44, 'Invalid duration must use the six-second default.');

assert.strictEqual(quoteMediaCredits({
  kind: 'video',
  resolution: '768P',
  duration: 0
}).totalCredits, 34, 'Video billing must enforce the four-second minimum.');

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
  unitCredits: 8.268929,
  fixedCredits: 14,
  minimumCredits: 30,
  totalCredits: 56
});

assert.strictEqual(quoteMediaCredits({
  kind: 'video',
  videoProviderId: 'video-3',
  resolution: '720P',
  duration: 5
}).totalCredits, 125);

assert.deepStrictEqual(
  {
    duration: quoteMediaCredits({
      kind: 'video', videoProviderId: 'video-2', resolution: '720P', duration: -1
    }).duration,
    totalCredits: quoteMediaCredits({
      kind: 'video', videoProviderId: 'video-2', resolution: '720P', duration: -1
    }).totalCredits
  },
  { duration: 15, totalCredits: 281 },
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
  { duration: 30, totalCredits: 677 },
  'Seedance 2.5 automatic duration must reserve its full 30-second maximum.'
);

assert.strictEqual(quoteMediaCredits({
  kind: 'video',
  videoProviderId: 'video-2',
  resolution: 'unsupported',
  duration: 6
}).totalCredits, 121, 'Unknown Seedance resolutions must use that provider\'s default 720P rate.');

assert.strictEqual(
  quoteMediaCredits({ kind: 'video', videoProviderId: 'video-3', resolution: '480P', duration: 30 }).totalCredits,
  323,
  'Seedance 2.5 must support 30 seconds and add the fixed profit only once.'
);

assert.strictEqual(
  quoteMediaCredits({ kind: 'video', videoProviderId: 'video-3', resolution: '720P', duration: 10 }).totalCredits,
  235,
  'Seedance 2.5 720P must use the verified Atlas primary-route cost.'
);
assert.strictEqual(
  quoteMediaCredits({ kind: 'video', videoProviderId: 'video-3', resolution: '4K-ESR', duration: 10 }).totalCredits,
  1677,
  'Seedance 2.5 4K-ESR must use the 22.780 PTC per ten-second upstream quote.'
);
assert.strictEqual(
  quoteMediaCredits({ kind: 'video', videoProviderId: 'video-3', resolution: '4K-ESR', duration: 6 }).totalCredits,
  1012,
  'Seedance 2.5 4K-ESR at the default six seconds must not use the retired 151-point quote.'
);
assert.strictEqual(
  quoteMediaCredits({ kind: 'video', videoProviderId: 'video-2', resolution: '720P', duration: 10 }).totalCredits,
  192,
  'Seedance 2.0 must use the verified Atlas primary-route cost.'
);
assert.strictEqual(
  quoteMediaCredits({ kind: 'video', videoProviderId: 'video-4', resolution: '720P', duration: 10 }).totalCredits,
  138,
  'Seedance 2.0 Fast must use its documented 6.516 PTC/M-token multiplier.'
);

assert.deepStrictEqual(
  quoteMediaCredits({
    kind: 'video', videoProviderId: 'video-10', resolution: '1080P', duration: 10
  }),
  {
    kind: 'video', providerId: 'video-11', resolution: '1080P', duration: 10,
    units: 10, unit: 'second', unitCredits: 24.6, fixedCredits: 14,
    minimumCredits: 30, totalCredits: 260
  },
  'Kling V3 1080P must quote and reserve against the Pro route.'
);
assert.strictEqual(
  quoteMediaCredits({
    kind: 'video', videoProviderId: 'video-12', serviceTier: 'pro', resolution: '1080P', duration: 15
  }).totalCredits,
  409,
  'Kling O3 Pro must never be quoted at the Standard route price.'
);
assert.strictEqual(
  quoteMediaCredits({
    kind: 'video', videoProviderId: 'video-12', serviceTier: 'standard', resolution: '720P', duration: 15
  }).totalCredits,
  343,
  'Kling O3 Standard must retain its own route price.'
);

const publicPricing = publicCreditPricing();
assert.strictEqual(publicPricing.pricingVersion, CREDIT_PRICING_VERSION);
assert.strictEqual(publicPricing.pointsPerCny, 10);
assert.strictEqual(publicPricing.profitPerRequestCny, 1.4);
assert.strictEqual(publicPricing.minimumVideoCredits, 30);
assert.strictEqual(publicPricing.image['image-5'], 16);
assert.strictEqual(publicPricing.image['image-9'], 17);
assert.strictEqual(publicPricing.image['image-6'], 20);
assert.deepStrictEqual(publicPricing.imageQuality['image-6'], IMAGE_QUALITY_PRICES['image-6']);
assert.deepStrictEqual(publicPricing.imageQualityResolution['image-6'], IMAGE_QUALITY_RESOLUTION_PRICES['image-6']);
assert.deepStrictEqual(publicPricing.imageResolution['image-7'], IMAGE_RESOLUTION_PRICES['image-7']);
assert.deepStrictEqual(publicPricing.imageResolution['image-8'], IMAGE_RESOLUTION_PRICES['image-8']);
assert.deepStrictEqual(publicPricing.imageResolution['image-1'], IMAGE_RESOLUTION_PRICES['image-1']);
assert.deepStrictEqual(publicPricing.imageResolution['image-2'], IMAGE_RESOLUTION_PRICES['image-2']);
assert.strictEqual(publicPricing.video['video-1']['768P'], 5);
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
        duration: (capabilities.durations || [6])[0], serviceTier
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
  /kind === 'chat'[\s\S]*?renderAssistantCreditEstimate\(0\)/,
  'Chat must remain free and hide the media-credit quote.'
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
assert.match(unifiedPricingMigration, /greatest\(30,[\s\S]*?normalized_duration/);
assert.match(seedancePtcMigration, /302 PTC is USD/i);
assert.match(seedancePtcMigration, /0\.2592 \* \(7\.884 \/ 10\)/);
assert.match(seedancePtcMigration, /0\.2592 \* \(6\.516 \/ 10\)/);
assert.match(seedancePtcMigration, /quote_seedance_retail_credits/);
assert.match(rebuiltPricingMigration, /USD 1 = CNY 7\.3/);
assert.match(rebuiltPricingMigration, /when '4K-ESR' then 166\.294/);
assert.match(rebuiltPricingMigration, /normalized_quality \|\| ':' \|\| normalized_image_resolution/);
assert.match(rebuiltPricingMigration, /p_provider_cost::numeric \* 7\.3/);
assert.doesNotMatch(unifiedPricingMigration, /Chaser0713|staff15/);
assert.strictEqual((redemptionMigration.match(/, 666, false, 1, null, true\)/g) || []).length, 3);
assert.strictEqual((redemptionMigration.match(/'[0-9a-f]{64}'/g) || []).length, 3);
assert.doesNotMatch(redemptionMigration, /MESSS-666-/);
assert.match(
  mainSource,
  /const creditsCharged = kind === 'image'[\s\S]*?creditQuote\.unitCredits \* primaryCount[\s\S]*?settledCredits: creditsCharged[\s\S]*?estimatedCredits: reservationQuote\.totalCredits,[\s\S]*?creditsCharged,[\s\S]*?pricing:/,
  'Successful generation must return the estimate, normalized pricing and the charge for successful outputs only.'
);
assert.match(
  assistantSource,
  /appendAssistantMedia\(files, submittedKind, response\.creditsCharged\)[\s\S]*?Actual charge:[\s\S]*?实际扣除/,
  'The assistant must show the settled charge returned by the main process.'
);
assert.match(
  boardSource,
  /const settledCharge = res\.creditsCharged[\s\S]*?Actual charge:[\s\S]*?实际扣除/,
  'The canvas must show the settled charge returned by the main process.'
);

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

  Object.entries(pricing.video).forEach(([providerId, rates]) => {
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
  });

  for (const [providerId, proProviderId] of [['video-10', 'video-11'], ['video-12', 'video-13']]) {
    const resolution = Object.keys(pricing.video[proProviderId])[0];
    const request = { kind: 'video', videoProviderId: providerId, serviceTier: 'pro', resolution, duration: 10 };
    const desktop = quoteMediaCredits(request);
    const gateway = quoteUsage('video', { ...request, providerId });
    assert.strictEqual(desktop.providerId, proProviderId);
    assert.strictEqual(gateway.providerId, proProviderId);
    assert.strictEqual(desktop.totalCredits, gateway.credits);
  }
}

assertGatewayPricingParity()
  .then(() => process.stdout.write('Credit pricing tests passed.\n'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
