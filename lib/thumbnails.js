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
 * This generates a real, small (long edge capped at THUMB_MAX_EDGE) JPEG
 * once per file, on first request, and caches it to disk — every request
 * after that is just serving a small file directly, no re-encoding.
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

async function generateThumbnail(sourcePath, outPath, cacheDir, ext) {
  await fs.promises.mkdir(cacheDir, { recursive: true });
  const tmpPath = outPath + '.tmp.jpg';
  await fs.promises.rm(tmpPath, { force: true });

  const normalizedExt = (ext || '').toLowerCase();
  const sharp = hasSharp ? require('sharp') : null;
  const makeFallback = async () => {
    if (!sharp) return null;
    const label = (normalizedExt.replace(/^\./, '') || 'FILE').toUpperCase().slice(0, 8);
    const fileName = path.basename(sourcePath).replace(/[&<>"']/g, '').slice(0, 36);
    const svg = Buffer.from(`<svg width="400" height="300" xmlns="http://www.w3.org/2000/svg"><rect width="400" height="300" fill="#e6e8eb"/><rect x="132" y="62" width="136" height="150" rx="10" fill="#f7f8f9" stroke="#c8cdd3"/><path d="M228 62v42h40" fill="#dde2e7"/><text x="200" y="150" text-anchor="middle" font-family="Arial,sans-serif" font-size="27" font-weight="700" fill="#6d747d">${label}</text><text x="200" y="248" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" fill="#7f8790">${fileName}</text></svg>`);
    await sharp(svg).jpeg({ quality: THUMB_QUALITY }).toFile(tmpPath);
    return tmpPath;
  };

  if (VIDEO_EXTENSIONS.has(normalizedExt)) {
    const argsFor = (timestamp) => ['-y', '-ss', timestamp, '-i', sourcePath, '-frames:v', '1', '-vf', `scale=${THUMB_MAX_EDGE}:-2:force_original_aspect_ratio=decrease`, '-q:v', '4', tmpPath];
    try {
      await runFfmpeg(argsFor('0.5'));
    } catch (error) {
      await fs.promises.rm(tmpPath, { force: true });
      try { await runFfmpeg(argsFor('0')); } catch (retryError) { await makeFallback(); }
    }
  } else if (IMAGE_EXTENSIONS.has(normalizedExt) && sharp) {
    try {
      await sharp(sourcePath, { failOn: 'none' })
        .rotate()
        .resize({ width: THUMB_MAX_EDGE, height: THUMB_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: THUMB_QUALITY })
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
async function getOrCreateThumbnail(sourcePath, fileId, cacheDir, ext) {
  if (!isThumbnailableExt(ext)) return null;

  const outPath = path.join(cacheDir, fileId + '.jpg');
  try {
    if (fs.existsSync(outPath)) return outPath;
  } catch (err) {
    // fall through to (re)generate
  }

  if (pendingThumbnails.has(outPath)) return pendingThumbnails.get(outPath);

  const pending = generateThumbnail(sourcePath, outPath, cacheDir, ext);
  pendingThumbnails.set(outPath, pending);
  try {
    return await pending;
  } catch (err) {
    console.error('Thumbnail generation failed for', sourcePath, err.message);
    return null;
  } finally {
    pendingThumbnails.delete(outPath);
  }
}

function deleteThumbnail(fileId, cacheDir) {
  try {
    fs.unlinkSync(path.join(cacheDir, fileId + '.jpg'));
  } catch (err) {
    /* never existed or already gone — fine */
  }
}

module.exports = {
  isThumbnailableExt,
  resolveFfmpegBinary,
  getOrCreateThumbnail,
  deleteThumbnail,
  shutdownProcesses
};
