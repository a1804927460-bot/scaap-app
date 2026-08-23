'use strict';

const assert = require('node:assert/strict');
const { normalizeVideoResolution } = require('../lib/video-resolution');

assert.equal(normalizeVideoResolution('2K', 'video-3'), '1440P-ESR');
assert.equal(normalizeVideoResolution('2k', 'custom', 'seedance-2.5'), '1440P-ESR');
assert.equal(normalizeVideoResolution('2K', 'video-1'), '2K');
assert.equal(normalizeVideoResolution('8K', 'video-3'), '8K');
assert.equal(normalizeVideoResolution('', 'video-3'), '');

console.log('video resolution compatibility tests passed');
