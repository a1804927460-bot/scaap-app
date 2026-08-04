'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const sharp = require('sharp');
const {
  isThumbnailableExt,
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

async function main() {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'messs-thumbnails-'));
  const cache = path.join(root, 'cache');
  try {
    assert.strictEqual(isThumbnailableExt('.psd'), true);
    assert.strictEqual(isThumbnailableExt('.unknown'), true);
    const packedBinary = path.join(root, 'resources', 'app.asar', 'node_modules', 'ffmpeg-static', 'ffmpeg.exe');
    assert.ok(resolveFfmpegBinary(packedBinary).includes(`${path.sep}app.asar.unpacked${path.sep}`));

    const imagePath = path.join(root, 'image.png');
    await sharp({
      create: { width: 900, height: 600, channels: 3, background: '#3b82f6' }
    }).png().toFile(imagePath);
    await assertJpeg(await getOrCreateThumbnail(imagePath, 'image', cache, '.png'));

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
