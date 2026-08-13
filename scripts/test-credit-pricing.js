'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const {
  POINTS_PER_CNY,
  IMAGE_QUALITY_PRICES,
  IMAGE_RESOLUTION_PRICES,
  VIDEO_RATES,
  quoteMediaCredits,
  publicCreditPricing
} = require('../lib/credit-pricing');

assert.strictEqual(POINTS_PER_CNY, 10);

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
  unitCredits: 16,
  totalCredits: 32
});

assert.strictEqual(quoteMediaCredits({
  kind: 'image',
  imageProviderId: 'image-4',
  count: 99
}).totalCredits, 16, 'Image count must be capped at four.');

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
}).totalCredits, 12, 'Unknown GPT Image 2 quality must use the automatic-quality price.');

assert.strictEqual(quoteMediaCredits({
  kind: 'image', imageProviderId: 'image-7', resolution: '720p', count: 4
}).totalCredits, 16);
assert.strictEqual(quoteMediaCredits({
  kind: 'image', imageProviderId: 'image-8', size: '1080p', count: 4
}).totalCredits, 32);
assert.strictEqual(quoteMediaCredits({
  kind: 'image', imageProviderId: 'image-1', size: '4K'
}).totalCredits, 28);
assert.strictEqual(quoteMediaCredits({
  kind: 'image', imageProviderId: 'image-2', size: '1K'
}).totalCredits, 8);
assert.strictEqual(quoteMediaCredits({
  kind: 'image', imageProviderId: 'image-9'
}).totalCredits, 6);

const imageResolutionMatrix = {
  'image-1': { '1K': 16, '2K': 16, '4K': 28 },
  'image-2': { '1K': 8, '2K': 12, '4K': 16 }
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
Object.entries({ low: 3, medium: 8, high: 28, auto: 12 }).forEach(([quality, expectedCredits]) => {
  assert.strictEqual(
    quoteMediaCredits({ kind: 'image', imageProviderId: 'image-6', quality }).totalCredits,
    expectedCredits,
    `GPT Image 2 ${quality} must use its exact quality price.`
  );
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
  unitCredits: 16,
  totalCredits: 96
});

assert.strictEqual(quoteMediaCredits({
  kind: 'video',
  resolution: '768P',
  duration: undefined
}).totalCredits, 60, 'Invalid duration must use the six-second default.');

assert.strictEqual(quoteMediaCredits({
  kind: 'video',
  resolution: '768P',
  duration: 0
}).totalCredits, 40, 'Video billing must enforce the four-second minimum.');

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
  unitCredits: 3,
  totalCredits: 15
});

assert.strictEqual(quoteMediaCredits({
  kind: 'video',
  videoProviderId: 'video-3',
  resolution: '720P',
  duration: 5
}).totalCredits, 30);

assert.strictEqual(quoteMediaCredits({
  kind: 'video',
  videoProviderId: 'video-2',
  resolution: 'unsupported',
  duration: 6
}).totalCredits, 30, 'Unknown Seedance resolutions must use that provider\'s default 720P rate.');

const publicPricing = publicCreditPricing();
assert.strictEqual(publicPricing.image['image-5'], 4);
assert.strictEqual(publicPricing.image['image-9'], 6);
assert.strictEqual(publicPricing.image['image-6'], 12);
assert.deepStrictEqual(publicPricing.imageQuality['image-6'], IMAGE_QUALITY_PRICES['image-6']);
assert.deepStrictEqual(publicPricing.imageResolution['image-7'], IMAGE_RESOLUTION_PRICES['image-7']);
assert.deepStrictEqual(publicPricing.imageResolution['image-8'], IMAGE_RESOLUTION_PRICES['image-8']);
assert.deepStrictEqual(publicPricing.imageResolution['image-1'], IMAGE_RESOLUTION_PRICES['image-1']);
assert.deepStrictEqual(publicPricing.imageResolution['image-2'], IMAGE_RESOLUTION_PRICES['image-2']);
assert.strictEqual(publicPricing.video['video-1']['768P'], 10);
assert.deepStrictEqual(publicPricing.video['video-2'], VIDEO_RATES['video-2']);
assert.deepStrictEqual(publicPricing.video['video-3'], VIDEO_RATES['video-3']);

const boardSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'board-canvas.js'), 'utf8');
const assistantSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'ai-assistant.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
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
  /const creditQuote = quoteMediaCredits\(\{[\s\S]*?size: request\.size,[\s\S]*?resolution: request\.resolution/,
  'Main-process settlement must quote the selected image size instead of falling back to the default resolution.'
);
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
