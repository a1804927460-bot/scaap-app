'use strict';

const assert = require('assert');
const {
  POINTS_PER_CNY,
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

const publicPricing = publicCreditPricing();
assert.strictEqual(publicPricing.image['image-5'], 8);
assert.strictEqual(publicPricing.video['video-1']['768P'], 10);

process.stdout.write('Credit pricing tests passed.\n');
