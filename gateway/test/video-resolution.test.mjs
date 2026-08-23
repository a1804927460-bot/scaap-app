import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeVideoResolution } from '../src/video-resolution.js';
import { quoteUsage } from '../src/usage.js';

test('normalizes the legacy Seedance 2.5 2K alias', () => {
  assert.equal(normalizeVideoResolution('2K', 'video-3'), '1440P-ESR');
  assert.equal(normalizeVideoResolution('2K', 'video-1'), '2K');
  assert.equal(normalizeVideoResolution('8K', 'video-3'), '8K');
});

test('quotes the legacy alias at the canonical Seedance 2.5 tier', () => {
  assert.deepEqual(
    quoteUsage('video', { providerId: 'video-3', resolution: '2K', duration: 5 }),
    quoteUsage('video', { providerId: 'video-3', resolution: '1440P-ESR', duration: 5 })
  );
});
