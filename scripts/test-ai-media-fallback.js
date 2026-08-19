'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  imageFallbackProviderIds,
  isRetryableMediaError,
  supportsImageRequest
} = require('../lib/ai-media-fallback');

assert.deepEqual(imageFallbackProviderIds('image-3'), ['image-10', 'image-1']);
assert.deepEqual(imageFallbackProviderIds('image-6'), []);
assert.deepEqual(imageFallbackProviderIds('image-1'), []);

assert.equal(isRetryableMediaError(Object.assign(new Error('upstream busy'), {
  code: 'provider-temporarily-unavailable', status: 502
})), true);
assert.equal(isRetryableMediaError(Object.assign(new Error('bad prompt'), {
  code: 'provider-request-failed', status: 400
})), false);
assert.equal(isRetryableMediaError(Object.assign(new Error('not enough points'), {
  code: 'insufficient-credits', status: 402
})), false);
assert.equal(isRetryableMediaError(Object.assign(new Error('invalid token'), {
  code: 'provider-auth-failed', status: 401
})), false);
assert.equal(isRetryableMediaError(new TypeError('fetch failed')), true);
assert.equal(isRetryableMediaError(Object.assign(new Error('provider returned a low-resolution image'), {
  code: 'image-resolution-mismatch', status: 502
})), true);
assert.equal(isRetryableMediaError(Object.assign(new Error('provider returned an unverifiable image'), {
  code: 'image-resolution-unverified', status: 502
})), true);

const compatible = {
  id: 'image-10',
  kind: 'image',
  name: 'Seedream 5.0 Pro',
  endpoint: 'https://gateway.invalid/image-10',
  capabilities: {
    sizes: ['2K', '4K'],
    ratios: ['1:1', '16:9'],
    maxReferenceImages: 10
  }
};
assert.equal(supportsImageRequest(compatible, {
  size: '2K', aspectRatio: '16:9', urls: ['data:image/png;base64,AA==']
}), true);
assert.equal(supportsImageRequest(compatible, {
  size: '1K', aspectRatio: '16:9', urls: ['data:image/png;base64,AA==']
}), false);
assert.equal(supportsImageRequest(compatible, {
  size: '2K', aspectRatio: '21:9', urls: []
}), false);

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
assert.match(mainSource, /generateAiMediaWithFallback/);
assert.match(mainSource, /estimatedCredits:\s*reservationQuote\.totalCredits/);
assert.match(mainSource, /fallbackProviderId/);

console.log('AI media fallback tests passed.');
