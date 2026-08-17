'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const sharp = require('sharp');
const {
  isThumbnailableExt,
  thumbnailExtension,
  resolveFfmpegBinary,
  getOrCreateThumbnail
} = require('../lib/thumbnails');

async function assertJpeg(filePath) {
  const buffer = await fs.promises.readFile(filePath);
  assert.strictEqual(buffer[0], 0xff);
  assert.strictEqual(buffer[1], 0xd8);
  const metadata = await sharp(buffer).metadata();
  assert.ok(metadata.width <= 400);
  assert.ok(metadata.height <= 400);
  return metadata;
}

async function assertTransparentPng(filePath) {
  assert.strictEqual(path.extname(filePath), '.png');
  const buffer = await fs.promises.readFile(filePath);
  assert.deepStrictEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const metadata = await sharp(buffer).metadata();
  assert.strictEqual(metadata.format, 'png');
  assert.strictEqual(metadata.hasAlpha, true);
  assert.ok(metadata.width <= 400);
  assert.ok(metadata.height <= 400);
  const corner = await sharp(buffer).ensureAlpha().raw().toBuffer();
  assert.strictEqual(corner[3], 0, 'The transparent corner must stay transparent.');
  return metadata;
}

async function main() {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'messs-thumbnails-'));
  const cache = path.join(root, 'cache');
  try {
    assert.strictEqual(isThumbnailableExt('.psd'), true);
    assert.strictEqual(isThumbnailableExt('.unknown'), true);
    assert.strictEqual(thumbnailExtension('.png'), '.png');
    assert.strictEqual(thumbnailExtension('.webp'), '.png');
    assert.strictEqual(thumbnailExtension('.jpg'), '.jpg');
    assert.strictEqual(thumbnailExtension('.mp4'), '.jpg');
    const packedBinary = path.join(root, 'resources', 'app.asar', 'node_modules', 'ffmpeg-static', 'ffmpeg.exe');
    assert.ok(resolveFfmpegBinary(packedBinary).includes(`${path.sep}app.asar.unpacked${path.sep}`));

    const imagePath = path.join(root, 'image.png');
    await sharp({
      create: { width: 900, height: 600, channels: 3, background: '#3b82f6' }
    }).png().toFile(imagePath);
    const imageThumb = await getOrCreateThumbnail(imagePath, 'image', cache, '.png');
    assert.strictEqual(path.extname(imageThumb), '.png');

    const transparentPath = path.join(root, 'transparent.png');
    await sharp({
      create: { width: 900, height: 600, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    }).composite([{ input: Buffer.from('<svg width="900" height="600"><circle cx="450" cy="300" r="220" fill="#f43f5e"/></svg>') }])
      .png()
      .toFile(transparentPath);
    await assertTransparentPng(
      await getOrCreateThumbnail(transparentPath, 'transparent', cache, '.png')
    );

    // A wide-gamut source must be converted to sRGB for the cached JPEG, not
    // merely relabelled. Compare the embedded profile against Sharp's known
    // sRGB profile to guard the thumbnail path against P3 color drift.
    const p3ImagePath = path.join(root, 'image-p3.png');
    await sharp({
      create: { width: 900, height: 600, channels: 3, background: { r: 0, g: 255, b: 0 } }
    }).withIccProfile('p3').png().toFile(p3ImagePath);
    const p3ThumbPath = await getOrCreateThumbnail(p3ImagePath, 'image-p3', cache, '.png');
    const p3ThumbMetadata = await sharp(p3ThumbPath).metadata();
    assert.strictEqual(path.extname(p3ThumbPath), '.png');
    assert.ok(p3ThumbMetadata.width <= 400);
    assert.ok(p3ThumbMetadata.height <= 400);
    const expectedSrgbBuffer = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#000000' }
    }).withIccProfile('srgb').jpeg().toBuffer();
    const expectedSrgb = await sharp(expectedSrgbBuffer).metadata();
    assert.ok(Buffer.isBuffer(p3ThumbMetadata.icc), 'Thumbnails must embed an ICC profile.');
    assert.deepStrictEqual(p3ThumbMetadata.icc, expectedSrgb.icc, 'P3 thumbnails must be encoded in sRGB.');

    const genericPath = path.join(root, 'archive.xyz');
    await fs.promises.writeFile(genericPath, 'generic file preview');
    const genericMetadata = await assertJpeg(
      await getOrCreateThumbnail(genericPath, 'generic', cache, '.xyz')
    );
    assert.deepStrictEqual([genericMetadata.width, genericMetadata.height], [400, 300]);

    const videoPath = path.join(root, 'video.mp4');
    const ffmpeg = require('ffmpeg-static');
    const created = spawnSync(ffmpeg, [
      '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:d=1', '-pix_fmt', 'yuv420p', videoPath
    ], { windowsHide: true, encoding: 'utf8' });
    assert.strictEqual(created.status, 0, created.stderr);
    await assertJpeg(await getOrCreateThumbnail(videoPath, 'video', cache, '.mp4'));
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
  process.stdout.write('Thumbnail tests passed.\n');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
