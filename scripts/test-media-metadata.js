'use strict';

const assert = require('assert');
const { parseFfmpegVideoMetadata } = require('../lib/media-metadata');

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

process.stdout.write('Media metadata tests passed.\n');
