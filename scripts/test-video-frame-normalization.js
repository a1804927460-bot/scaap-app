'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const {
  DEFAULT_BACKGROUND,
  imageDataUrlDimensions,
  normalizeFirstLastFrameDataUrls
} = require('../lib/ai-frame-reference');

async function solidDataUrl(width, height, color) {
  const buffer = await sharp({
    create: { width, height, channels: 3, background: color }
  }).png().toBuffer();
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

async function decodedPixel(dataUrl, x, y) {
  const buffer = Buffer.from(String(dataUrl).split(',')[1], 'base64');
  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * info.channels;
  return Array.from(data.subarray(offset, offset + 3));
}

function assertRgbNear(actual, expected, message) {
  assert.strictEqual(actual.length, expected.length, message);
  actual.forEach((value, index) => {
    assert.ok(Math.abs(value - expected[index]) <= 3, `${message} Channel ${index} was ${value}, expected ${expected[index]}.`);
  });
}

async function assertCanvas(firstSize, lastSize, paddingPoint) {
  const first = await solidDataUrl(firstSize.width, firstSize.height, { r: 220, g: 24, b: 30 });
  const last = await solidDataUrl(lastSize.width, lastSize.height, { r: 20, g: 80, b: 220 });
  const result = await normalizeFirstLastFrameDataUrls([first, last]);
  assert.strictEqual(result.adjusted, true);
  assert.deepStrictEqual(await imageDataUrlDimensions(result.dataUrls[0]), firstSize);
  assert.deepStrictEqual(await imageDataUrlDimensions(result.dataUrls[1]), firstSize);
  assertRgbNear(
    await decodedPixel(result.dataUrls[1], Math.floor(firstSize.width / 2), Math.floor(firstSize.height / 2)),
    [20, 80, 220],
    'The fitted frame must preserve the source content color at its center.'
  );
  assertRgbNear(
    await decodedPixel(result.dataUrls[1], paddingPoint.x, paddingPoint.y),
    [DEFAULT_BACKGROUND.r, DEFAULT_BACKGROUND.g, DEFAULT_BACKGROUND.b],
    'Unused canvas space must be padded instead of stretching the source image.'
  );
}

(async () => {
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(
    mainSource,
    /isMiniMaxH3[\s\S]*?requestedMode === 'first-last-frame'[\s\S]*?normalizeFirstLastFrameDataUrls\(urls\)/,
    'The desktop bridge must normalize MiniMax H3 first/last frames before gateway submission.'
  );

  await assertCanvas(
    { width: 160, height: 90 },
    { width: 90, height: 160 },
    { x: 2, y: 45 }
  );
  await assertCanvas(
    { width: 90, height: 160 },
    { width: 160, height: 90 },
    { x: 45, y: 2 }
  );

  const first = await solidDataUrl(160, 90, { r: 220, g: 24, b: 30 });
  const sameCanvas = await solidDataUrl(160, 90, { r: 20, g: 80, b: 220 });
  const unchanged = await normalizeFirstLastFrameDataUrls([first, sameCanvas]);
  assert.strictEqual(unchanged.adjusted, false);
  assert.strictEqual(unchanged.dataUrls[1], sameCanvas);

  const largerSameRatio = await solidDataUrl(320, 180, { r: 20, g: 80, b: 220 });
  const resized = await normalizeFirstLastFrameDataUrls([first, largerSameRatio]);
  assert.strictEqual(resized.adjusted, true);
  assert.deepStrictEqual(await imageDataUrlDimensions(resized.dataUrls[1]), { width: 160, height: 90 });
  assertRgbNear(await decodedPixel(resized.dataUrls[1], 2, 2), [20, 80, 220], 'Same-ratio resizing must not add padding.');

  process.stdout.write('Video frame normalization tests passed.\n');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
