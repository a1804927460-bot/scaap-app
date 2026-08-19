'use strict';

const assert = require('assert');
const { parseFfmpegMediaDuration, parseFfmpegVideoMetadata } = require('../lib/media-metadata');
const {
  seedanceReferenceProfile,
  validateSeedanceReferenceDuration,
  validateSeedanceReferenceTotals
} = require('../lib/seedance-reference-validation');

const landscape = parseFfmpegVideoMetadata(`
  Duration: 00:00:06.04, start: 0.000000, bitrate: 6012 kb/s
  Stream #0:0: Video: h264 (High), yuv420p(progressive), 1920x1080 [SAR 1:1 DAR 16:9], 30 fps
`);
assert.deepStrictEqual(landscape, {
  sourceWidth: 1920,
  sourceHeight: 1080,
  hasAudio: false,
  sourceDuration: 6.04
});

const rotated = parseFfmpegVideoMetadata(`
  Duration: 00:01:02.50, start: 0.000000, bitrate: 4000 kb/s
  Stream #0:0: Video: hevc, yuv420p, 3840x2160, 30 fps
      Side data:
        displaymatrix: rotation of -90.00 degrees
`);
assert.deepStrictEqual(rotated, {
  sourceWidth: 2160,
  sourceHeight: 3840,
  hasAudio: false,
  sourceDuration: 62.5
});

const anamorphic = parseFfmpegVideoMetadata(`
  Duration: 00:00:05.00, start: 0.000000, bitrate: 2400 kb/s
  Stream #0:0: Video: h264, yuv420p, 720x576 [SAR 16:15 DAR 4:3], 25 fps
`);
assert.deepStrictEqual(anamorphic, {
  sourceWidth: 768,
  sourceHeight: 576,
  hasAudio: false,
  sourceDuration: 5
});

const withAudio = parseFfmpegVideoMetadata(`
  Duration: 00:00:03.00, start: 0.000000, bitrate: 2400 kb/s
  Stream #0:0: Video: h264, yuv420p, 1280x720, 30 fps
  Stream #0:1: Audio: aac, 48000 Hz, stereo, fltp
`);
assert.strictEqual(withAudio.hasAudio, true);

assert.strictEqual(parseFfmpegVideoMetadata('Input file has no video stream'), null);

assert.strictEqual(parseFfmpegMediaDuration(`
  Duration: 00:00:12.75, start: 0.025057, bitrate: 320 kb/s
  Stream #0:0: Audio: mp3, 44100 Hz, stereo, fltp, 320 kb/s
`), 12.75);
assert.strictEqual(parseFfmpegMediaDuration('Duration: N/A, bitrate: N/A'), null);

const seedance20 = seedanceReferenceProfile('video-2');
const seedance25 = seedanceReferenceProfile('video-3');
assert.strictEqual(seedanceReferenceProfile('video-1'), null);
assert.doesNotThrow(() => validateSeedanceReferenceDuration(seedance20, 'video', 15));
assert.throws(
  () => validateSeedanceReferenceDuration(seedance20, 'video', 15.01),
  (error) => error && error.code === 'invalid-reference-video-duration'
);
assert.doesNotThrow(() => validateSeedanceReferenceDuration(seedance25, 'audio', 30));
assert.throws(
  () => validateSeedanceReferenceDuration(seedance25, 'audio', 30.01),
  (error) => error && error.code === 'invalid-reference-audio-duration'
);
assert.throws(
  () => validateSeedanceReferenceDuration(seedance20, 'audio', 0),
  (error) => error && error.code === 'reference-audio-duration-unavailable'
);
assert.throws(
  () => validateSeedanceReferenceTotals(seedance20, { video: [8, 7.01], audio: [] }),
  (error) => error && error.code === 'reference-video-duration-limit'
);
assert.throws(
  () => validateSeedanceReferenceTotals(seedance25, { video: [], audio: [12, 18.01] }),
  (error) => error && error.code === 'reference-audio-duration-limit'
);
assert.doesNotThrow(() => validateSeedanceReferenceTotals(null, { video: [999], audio: [999] }));

process.stdout.write('Media metadata tests passed.\n');
