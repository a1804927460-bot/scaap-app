'use strict';
/**
 * Generates and caches small thumbnails for image files.
 *
 * Why this exists: every thumbnail in the sidebar file list, the folder
 * grid, and (previously) the board canvas was an <img> pointing straight at
 * messs-file://<id>, which serves the *original* file — full resolution,
 * full file size, no resizing of any kind. A 13MB, 4000x6000 photo used as
 * a 32px sidebar icon was being fully read off disk and decoded by Chromium
 * at full resolution just to be squashed down to a few dozen CSS pixels.
 * With a handful of files this is invisible; with a library of thousands,
 * rendering (or even just scrolling) a list of that many full-resolution
 * decodes is the single biggest cause of the app bogging down.
 *
 * Lists use 400px thumbnails. The canvas can request bounded 768/1536/3072px
 * detail variants without decoding every visible original. Each variant
 * is cached to disk; alpha-capable formats retain a PNG alpha channel.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.jpe', '.jfif', '.gif', '.webp', '.bmp', '.dib',
  '.avif', '.heic', '.heif', '.tif', '.tiff', '.jp2', '.j2k', '.ico', '.tga'
]);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.wmv', '.mts', '.m2ts', '.mpg', '.mpeg', '.3gp', '.ts', '.mxf']);
// Deliberately excludes .svg — vector, already cheap to render at any size,
// and rasterizing it would only make things worse.

const THUMB_MAX_EDGE = 400; // generous enough for the folder grid's largest thumb size
const THUMB_QUALITY = 72;
const THUMB_EDGES = [400, 768, 1536, 3072];
function thumbnailEdge(value) {
  return THUMB_EDGES.includes(Number(value)) ? Number(value) : THUMB_MAX_EDGE;
}

// JPEG has no alpha channel. Keep a lossless PNG thumbnail for formats that
// may contain transparency so a transparent asset never flashes with a black
// matte while the full-resolution image is loading.
const ALPHA_CAPABLE_IMAGE_EXTENSIONS = new Set([
  '.png', '.webp', '.gif', '.avif', '.heic', '.heif', '.tif', '.tiff',
  '.bmp', '.dib', '.ico', '.tga'
]);

function thumbnailExtension(ext) {
  return ALPHA_CAPABLE_IMAGE_EXTENSIONS.has(String(ext || '').toLowerCase())
    ? '.png'
    : '.jpg';
}

function isThumbnailableExt(ext) {
  return typeof ext === 'string';
}

function resolveFfmpegBinary(binary) {
  return binary && binary.replace(
    `${path.sep}app.asar${path.sep}`,
    `${path.sep}app.asar.unpacked${path.sep}`
  );
}

const MAX_FFMPEG_THUMBNAILS = 2;
const ffmpegJobs = [];
let activeFfmpegJobs = 0;
let thumbnailShutdown = false;
const activeThumbnailProcesses = new Set();

function runFfmpegNow(args) {
  if (thumbnailShutdown) return Promise.reject(new Error('Thumbnail generation is shutting down.'));
  let binary;
  try { binary = require('ffmpeg-static'); } catch (err) { return Promise.reject(err); }
  binary = resolveFfmpegBinary(binary);
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true });
    activeThumbnailProcesses.add(child);
    const release = () => activeThumbnailProcesses.delete(child);
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => { release(); reject(error); });
    child.on('close', (code) => {
      release();
      code === 0 ? resolve() : reject(new Error(stderr.slice(-400)));
    });
  });
}

function pumpFfmpegJobs() {
  while (!thumbnailShutdown && activeFfmpegJobs < MAX_FFMPEG_THUMBNAILS && ffmpegJobs.length) {
    const job = ffmpegJobs.shift();
    activeFfmpegJobs += 1;
    runFfmpegNow(job.args)
      .then(job.resolve, job.reject)
      .finally(() => {
        activeFfmpegJobs -= 1;
        pumpFfmpegJobs();
      });
  }
}

function shutdownProcesses() {
  thumbnailShutdown = true;
  const error = new Error('Thumbnail generation stopped for application update.');
  while (ffmpegJobs.length) ffmpegJobs.shift().reject(error);
  for (const child of activeThumbnailProcesses) {
    try { child.kill('SIGKILL'); } catch (killError) {}
  }
  activeThumbnailProcesses.clear();
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    ffmpegJobs.push({ args, resolve, reject });
    pumpFfmpegJobs();
  });
}

let hasSharp = true;
try { require('sharp'); } catch (err) { hasSharp = false; }
const pendingThumbnails = new Map();

async function generateThumbnail(sourcePath, outPath, cacheDir, ext, edge = THUMB_MAX_EDGE) {
  await fs.promises.mkdir(cacheDir, { recursive: true });
  const outputExtension = path.extname(outPath).toLowerCase();
  const tmpPath = `${outPath}.tmp${outputExtension}`;
  await fs.promises.rm(tmpPath, { force: true });

  const normalizedExt = (ext || '').toLowerCase();
  const sharp = hasSharp ? require('sharp') : null;
  const makeFallback = async () => {
    if (!sharp) return null;
    const label = (normalizedExt.replace(/^\./, '') || 'FILE').toUpperCase().slice(0, 8);
    const fileName = path.basename(sourcePath).replace(/[&<>"']/g, '').slice(0, 36);
    const svg = Buffer.from(`<svg width="400" height="300" xmlns="http://www.w3.org/2000/svg"><rect width="400" height="300" fill="#e6e8eb"/><rect x="132" y="62" width="136" height="150" rx="10" fill="#f7f8f9" stroke="#c8cdd3"/><path d="M228 62v42h40" fill="#dde2e7"/><text x="200" y="150" text-anchor="middle" font-family="Arial,sans-serif" font-size="27" font-weight="700" fill="#6d747d">${label}</text><text x="200" y="248" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" fill="#7f8790">${fileName}</text></svg>`);
    const fallback = sharp(svg);
    if (outputExtension === '.png') {
      await fallback.png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(tmpPath);
    } else {
      await fallback.jpeg({ quality: THUMB_QUALITY }).toFile(tmpPath);
    }
    return tmpPath;
  };

  if (VIDEO_EXTENSIONS.has(normalizedExt)) {
    const argsFor = (timestamp) => ['-y', '-ss', timestamp, '-i', sourcePath, '-frames:v', '1', '-vf', `scale=w='min(iw,${edge})':h='min(ih,${edge})':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos`, '-q:v', edge > 400 ? '2' : '4', tmpPath];
    try {
      await runFfmpeg(argsFor('0.5'));
      if (!fs.existsSync(tmpPath)) throw new Error('No frame at preview timestamp.');
    } catch (error) {
      await fs.promises.rm(tmpPath, { force: true });
      try { await runFfmpeg(argsFor('0')); } catch (retryError) { await makeFallback(); }
    }
  } else if (IMAGE_EXTENSIONS.has(normalizedExt) && sharp) {
    try {
      await sharp(sourcePath, { failOn: 'none' })
        .rotate()
        .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
        // Convert the pixels, then embed sRGB. Copying a Display P3 tag onto
        // resized thumbnail pixels would make the thumbnail visibly incorrect.
        .withIccProfile('srgb')
        [outputExtension === '.png' ? 'png' : 'jpeg'](
          outputExtension === '.png'
            ? { compressionLevel: edge > 400 ? 6 : 9, adaptiveFiltering: true }
            : { quality: edge > 400 ? 90 : THUMB_QUALITY }
        )
        .toFile(tmpPath);
    } catch (error) {
      await fs.promises.rm(tmpPath, { force: true });
      await makeFallback();
    }
  } else {
    await makeFallback();
  }

  if (!fs.existsSync(tmpPath)) return null;

  await fs.promises.rename(tmpPath, outPath);
  return outPath;
}

/**
 * Returns the path to a cached thumbnail for `sourcePath`, generating it
 * first if it doesn't exist yet. Returns null if thumbnailing isn't
 * possible (unsupported format, sharp missing, or generation failed) — the
 * caller should fall back to serving the original file in that case so a
 * thumbnail being unavailable never means the image just doesn't show.
 */
async function getOrCreateThumbnail(sourcePath, fileId, cacheDir, ext, requestedEdge) {
  if (!isThumbnailableExt(ext)) return null;
  const edge = thumbnailEdge(requestedEdge);
  const cacheId = edge === THUMB_MAX_EDGE ? fileId : `${fileId}-${edge}`;

  const outPath = path.join(cacheDir, cacheId + thumbnailExtension(ext));
  const legacyPath = path.join(cacheDir, cacheId + (path.extname(outPath).toLowerCase() === '.png' ? '.jpg' : '.png'));
  try {
    if (fs.existsSync(outPath)) return outPath;
  } catch (err) {
    // fall through to (re)generate
  }

  if (pendingThumbnails.has(outPath)) return pendingThumbnails.get(outPath);

  const pending = generateThumbnail(sourcePath, outPath, cacheDir, ext, edge);
  pendingThumbnails.set(outPath, pending);
  try {
    const generated = await pending;
    // Remove a thumbnail from the other encoding left by an earlier build.
    if (generated) await fs.promises.rm(legacyPath, { force: true }).catch(() => {});
    return generated;
  } catch (err) {
    console.error('Thumbnail generation failed for', sourcePath, err.message);
    return null;
  } finally {
    pendingThumbnails.delete(outPath);
  }
}

function deleteThumbnail(fileId, cacheDir) {
  for (const edge of THUMB_EDGES) {
    const cacheId = edge === THUMB_MAX_EDGE ? fileId : `${fileId}-${edge}`;
    for (const extension of ['.jpg', '.png']) {
      try {
        fs.unlinkSync(path.join(cacheDir, cacheId + extension));
      } catch (err) {
        /* never existed or already gone — fine */
      }
    }
  }
}

module.exports = {
  isThumbnailableExt,
  thumbnailExtension,
  thumbnailEdge,
  resolveFfmpegBinary,
  getOrCreateThumbnail,
  deleteThumbnail,
  shutdownProcesses
};
