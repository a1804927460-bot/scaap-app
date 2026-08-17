'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const {
  POINTS_PER_CNY,
  PROFIT_PER_REQUEST_CNY,
  PROFIT_PER_REQUEST_CREDITS,
  IMAGE_QUALITY_PRICES,
  IMAGE_RESOLUTION_PRICES,
  VIDEO_RATES,
  quoteMediaCredits,
  retailCreditsFromUpstreamCny,
  publicCreditPricing
} = require('../lib/credit-pricing');

assert.strictEqual(POINTS_PER_CNY, 10);
assert.strictEqual(PROFIT_PER_REQUEST_CNY, 1.4);
assert.strictEqual(PROFIT_PER_REQUEST_CREDITS, 14);
assert.strictEqual(retailCreditsFromUpstreamCny(1.5), 29, 'CNY 1.5 upstream cost must retail for CNY 2.9.');
assert.strictEqual(Math.ceil(1.5 * POINTS_PER_CNY * 1.15), 18, 'Staff price must be upstream cost plus 15%, without the public fixed profit.');
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

assert.deepStrictEqual(quoteMediaCredits({
  kind: 'image',
  imageProviderId: 'image-6',
  quality: 'high',
  count: 2
}), {
  kind: 'image',
  providerId: 'image-6',
  quality: 'high',
  count: 2,
  units: 2,
  unit: 'image',
  unitCredits: 28,
  totalCredits: 56
});
assert.strictEqual(quoteMediaCredits({
  kind: 'image',
  imageProviderId: 'image-6',
  quality: 'invalid'
}).totalCredits, 20, 'Unknown GPT Image 2 quality must use the automatic-quality price.');

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
Object.entries({ low: 16, medium: 18, high: 28, auto: 20 }).forEach(([quality, expectedCredits]) => {
  assert.strictEqual(
    quoteMediaCredits({ kind: 'image', imageProviderId: 'image-6', quality }).totalCredits,
    expectedCredits,
    `GPT Image 2 ${quality} must use its exact quality price.`
  );
});
assert.strictEqual(
  quoteMediaCredits({ kind: 'image', imageProviderId: 'image-6', quality: 'medium', size: '3840x2160' }).totalCredits,
  quoteMediaCredits({ kind: 'image', imageProviderId: 'image-6', quality: 'medium', size: '1024x1024' }).totalCredits,
  'GPT Image 2 pricing must depend on quality, not the selected dimensions.'
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
  unitCredits: 8,
  fixedCredits: 14,
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
  unitCredits: 1.5,
  fixedCredits: 14,
  totalCredits: 22
});

assert.strictEqual(quoteMediaCredits({
  kind: 'video',
  videoProviderId: 'video-3',
  resolution: '720P',
  duration: 5
}).totalCredits, 29);

assert.strictEqual(quoteMediaCredits({
  kind: 'video',
  videoProviderId: 'video-2',
  resolution: 'unsupported',
  duration: 6
}).totalCredits, 29, 'Unknown Seedance resolutions must use that provider\'s default 720P rate.');

assert.strictEqual(
  quoteMediaCredits({ kind: 'video', videoProviderId: 'video-3', resolution: '480P', duration: 30 }).totalCredits,
  74,
  'Seedance 2.5 must support 30 seconds and add the fixed profit only once.'
);

const publicPricing = publicCreditPricing();
assert.strictEqual(publicPricing.pointsPerCny, 10);
assert.strictEqual(publicPricing.profitPerRequestCny, 1.4);
assert.strictEqual(publicPricing.image['image-5'], 16);
assert.strictEqual(publicPricing.image['image-9'], 17);
assert.strictEqual(publicPricing.image['image-6'], 20);
assert.deepStrictEqual(publicPricing.imageQuality['image-6'], IMAGE_QUALITY_PRICES['image-6']);
assert.deepStrictEqual(publicPricing.imageResolution['image-7'], IMAGE_RESOLUTION_PRICES['image-7']);
assert.deepStrictEqual(publicPricing.imageResolution['image-8'], IMAGE_RESOLUTION_PRICES['image-8']);
assert.deepStrictEqual(publicPricing.imageResolution['image-1'], IMAGE_RESOLUTION_PRICES['image-1']);
assert.deepStrictEqual(publicPricing.imageResolution['image-2'], IMAGE_RESOLUTION_PRICES['image-2']);
assert.strictEqual(publicPricing.video['video-1']['768P'], 5);
assert.deepStrictEqual(publicPricing.video['video-2'], VIDEO_RATES['video-2']);
assert.deepStrictEqual(publicPricing.video['video-3'], VIDEO_RATES['video-3']);

const boardSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'board-canvas.js'), 'utf8');
const assistantSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'ai-assistant.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
const runtimeSource = fs.readFileSync(path.join(__dirname, '..', 'config', 'provider-catalog.json'), 'utf8');
const staffMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '202608170001_cost_plus_fixed_profit_credits.sql'), 'utf8');
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
assert.doesNotMatch(mainSource, /Chaser0713|49c8f3fd5b5b39253cf33a3bbcd14a270c8fbada802b1248408bdf7ccac98415/);
assert.doesNotMatch(preloadSource, /Chaser0713|staff15|pricing_tier/);
assert.doesNotMatch(runtimeSource, /Chaser0713|staff15|pricing_tier/);
assert.match(staffMigration, /49c8f3fd5b5b39253cf33a3bbcd14a270c8fbada802b1248408bdf7ccac98415/);
assert.doesNotMatch(staffMigration, /Chaser0713/);
assert.match(
  mainSource,
  /const creditsCharged = kind === 'image'[\s\S]*?creditQuote\.unitCredits \* files\.length[\s\S]*?settledCredits: creditsCharged[\s\S]*?estimatedCredits: creditQuote\.totalCredits,[\s\S]*?creditsCharged,[\s\S]*?pricing:/,
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
}

assertGatewayPricingParity()
  .then(() => process.stdout.write('Credit pricing tests passed.\n'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
