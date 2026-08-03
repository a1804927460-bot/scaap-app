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
  ext = (ext || '').toLowerCase();
  return IMAGE_EXTENSIONS.has(ext) || VIDEO_EXTENSIONS.has(ext);
}

const MAX_FFMPEG_THUMBNAILS = 2;
const ffmpegJobs = [];
let activeFfmpegJobs = 0;

function runFfmpegNow(args) {
  let binary;
  try { binary = require('ffmpeg-static'); } catch (err) { return Promise.reject(err); }
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(stderr.slice(-400))));
  });
}

function pumpFfmpegJobs() {
  while (activeFfmpegJobs < MAX_FFMPEG_THUMBNAILS && ffmpegJobs.length) {
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

  if (VIDEO_EXTENSIONS.has((ext || '').toLowerCase())) {
    await runFfmpeg(['-y', '-ss', '0.5', '-i', sourcePath, '-frames:v', '1', '-vf', `scale=${THUMB_MAX_EDGE}:-2:force_original_aspect_ratio=decrease`, '-q:v', '4', tmpPath]);
  } else {
    if (!hasSharp) return null;
    const sharp = require('sharp');
    await sharp(sourcePath, { failOn: 'none' })
      .rotate()
      .resize({ width: THUMB_MAX_EDGE, height: THUMB_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: THUMB_QUALITY })
      .toFile(tmpPath);
  }

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

module.exports = { isThumbnailableExt, getOrCreateThumbnail, deleteThumbnail };
