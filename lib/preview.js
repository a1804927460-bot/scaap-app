'use strict';
/**
 * Resolves how to get a previewable result for any file Messs. can show
 * something real for, beyond plain images/video/audio/text (those are
 * handled directly in main.js — no conversion needed at all).
 *
 * What needs an external tool, and what doesn't anymore:
 *   - PDF            — nothing. Rendered directly in the renderer via
 *                       pdfjs-dist (see preload.js renderPdfPage). No
 *                       external binary involved at all.
 *   - Office docs    — soffice (LibreOffice) converts to a temporary PDF,
 *                       which is then rendered the exact same way as a
 *                       direct PDF (by pdfjs-dist in the renderer). Poppler
 *                       is gone entirely — it's no longer needed for either
 *                       direct PDFs or office-converted ones.
 *   - TIFF           — sharp (pure npm package, prebuilt binaries fetched
 *                       automatically per-platform during `npm install` —
 *                       no manual download, no bundling step).
 *   - PSD            — ImageMagick. This is the one format that still needs
 *                       a real external install/bundle — there's no
 *                       npm-installable equivalent with confidence, since
 *                       PSD's layered format needs genuine image-editing
 *                       logic to flatten correctly.
 *   - Exotic video    — ffmpeg-static (pure npm package, same deal as sharp:
 *     codecs            automatic per-platform binary, zero manual steps).
 *                       Only invoked reactively when the browser's native
 *                       <video> can't play a file directly.
 *
 * So out of the four tools earlier versions asked you to manually download,
 * only ImageMagick remains as a real "please install or bundle this"
 * ask — Poppler's role is gone, and FFmpeg/sharp now arrive automatically
 * via npm install, same as every other dependency.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const MIN_TRANSCODED_VIDEO_BYTES = 256;

const OFFICE_EXTENSIONS = new Set([
  '.doc', '.docx', '.rtf', '.odt',
  '.ppt', '.pptx', '.odp',
  '.xls', '.xlsx', '.ods', '.csv', '.pages', '.numbers', '.key'
]);

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.jpe', '.jfif', '.gif', '.webp', '.bmp', '.dib', '.svg', '.avif', '.heic', '.heif', '.jxl', '.jp2', '.j2k', '.ico', '.icns', '.tga', '.dds']);
const PSD_EXTENSIONS = new Set(['.psd', '.psb', '.ai', '.eps']);
const TIFF_EXTENSIONS = new Set(['.tiff', '.tif', '.raw', '.dng', '.cr2', '.nef', '.arw']);

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.json', '.csv', '.log', '.js', '.css', '.html', '.xml', '.yml', '.yaml', '.ini', '.env', '.sql']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.ogv', '.mov', '.m4v', '.mkv', '.avi', '.wmv', '.asf', '.flv', '.f4v', '.mts', '.m2ts', '.ts', '.m2t', '.mpg', '.mpeg', '.mpe', '.3gp', '.3g2', '.vob', '.rm', '.rmvb', '.divx', '.dv', '.mxf', '.y4m', '.prores']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.wave', '.ogg', '.oga', '.opus', '.m4a', '.m4b', '.aac', '.flac', '.aif', '.aiff', '.wma', '.amr', '.ape', '.alac', '.ac3', '.eac3', '.dts', '.caf', '.au', '.ra']);

function isOfficeExt(ext) { return OFFICE_EXTENSIONS.has(ext); }
function isPdfExt(ext) { return ext === '.pdf'; }
function isImageExt(ext) { return IMAGE_EXTENSIONS.has(ext); }
function isPsdExt(ext) { return PSD_EXTENSIONS.has(ext); }
function isTiffExt(ext) { return TIFF_EXTENSIONS.has(ext); }
function isRasterConvertExt(ext) { return isPsdExt(ext) || isTiffExt(ext); }
function isTextExt(ext) { return TEXT_EXTENSIONS.has(ext); }
function isVideoExt(ext) { return VIDEO_EXTENSIONS.has(ext); }
function isAudioExt(ext) { return AUDIO_EXTENSIONS.has(ext); }
function needsVideoTranscode(ext) {
  // Chromium handles these web containers reliably. The rest (especially MOV
  // camera exports and professional codecs) get a stable cached MP4 first.
  return isVideoExt(ext) && !new Set(['.mp4', '.webm', '.ogv', '.m4v']).has(ext);
}
/** Anything that ends up shown via pdfjs-dist, either directly or after an office->pdf conversion. */
function isPdfJsRenderable(ext) { return isPdfExt(ext) || isOfficeExt(ext); }
function isPreviewableDocument(ext) { return isPdfJsRenderable(ext) || isRasterConvertExt(ext); }

/* ===================== Bundled-tool resolution (LibreOffice, ImageMagick only) ===================== */

// Set by main.js at startup to process.resourcesPath in packaged builds,
// or the project root in dev — see configureToolsRoot().
let toolsRoot = null;
function configureToolsRoot(root) {
  toolsRoot = root;
  resolvedToolCache.clear();
}

const TOOL_EXE_NAMES = {
  soffice: ['soffice.exe', 'soffice'],
  convert: ['magick.exe', 'magick']
};
const TOOL_DIR_NAMES = {
  soffice: ['libreoffice', 'soffice'],
  convert: ['imagemagick', 'convert']
};

const resolvedToolCache = new Map();

/** Recursively searches a folder (a few levels deep) for any of the given executable names. */
function findExecutableUnder(dir, exeNames, depth = 6) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return null;
  }
  for (const entry of entries) {
    if (entry.isFile() && exeNames.includes(entry.name)) {
      return path.join(dir, entry.name);
    }
  }
  if (depth <= 0) return null;
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const found = findExecutableUnder(path.join(dir, entry.name), exeNames, depth - 1);
      if (found) return found;
    }
  }
  return null;
}

function findStandardWindowsInstall(toolKey, exeNames) {
  if (process.platform !== 'win32') return null;
  const programFiles = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean);
  if (toolKey === 'soffice') {
    for (const root of programFiles) {
      const candidate = path.join(root, 'LibreOffice', 'program', 'soffice.exe');
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  if (toolKey === 'convert') {
    for (const root of programFiles) {
      let directories = [];
      try { directories = fs.readdirSync(root, { withFileTypes: true }); } catch (err) {}
      for (const entry of directories) {
        if (!entry.isDirectory() || !entry.name.toLowerCase().startsWith('imagemagick-')) continue;
        const candidate = path.join(root, entry.name, 'magick.exe');
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

/**
 * Resolves the command to invoke for soffice/ImageMagick: a bundled copy
 * under resources/tools/<toolKey>/ if present, otherwise just the bare
 * command name (relying on the system PATH).
 */
function resolveTool(toolKey) {
  if (resolvedToolCache.has(toolKey)) return resolvedToolCache.get(toolKey);

  const exeNames = TOOL_EXE_NAMES[toolKey] || [toolKey];
  let resolved = process.platform === 'win32' ? exeNames[0] : exeNames[exeNames.length - 1];

  if (toolsRoot) {
    const directoryNames = TOOL_DIR_NAMES[toolKey] || [toolKey];
    for (const directoryName of directoryNames) {
      const bundledDir = path.join(toolsRoot, 'tools', directoryName);
      const found = findExecutableUnder(bundledDir, exeNames);
      if (found) { resolved = found; break; }
    }
  }
  if (!path.isAbsolute(resolved)) resolved = findStandardWindowsInstall(toolKey, exeNames) || resolved;

  resolvedToolCache.set(toolKey, resolved);
  return resolved;
}

/** ffmpeg-static resolves automatically to a real binary npm fetched for the
    current platform during install — no bundled-tools lookup needed at all. */
function resolveFfmpeg() {
  try {
    const resolved = require('ffmpeg-static');
    const unpacked = resolved && resolved.replace(
      `${path.sep}app.asar${path.sep}`,
      `${path.sep}app.asar.unpacked${path.sep}`
    );
    if (unpacked !== resolved && fs.existsSync(unpacked)) return unpacked;
    return resolved && fs.existsSync(resolved) ? resolved : null;
  } catch (err) {
    return null;
  }
}

/* ===================== Process execution ===================== */

function run(cmd, args, { timeoutMs = 30000, cwd } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd });
    } catch (err) {
      reject(err);
      return;
    }
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    if (child.stderr) child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}: ${stderr.slice(0, 500)}`));
    });
  });
}

function runCapture(cmd, args, { timeoutMs = 30000, maxBytes = 64 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true });
    } catch (err) {
      reject(err);
      return;
    }
    const chunks = [];
    let totalBytes = 0;
    let stderr = '';
    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err); else resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        child.kill('SIGKILL');
        finish(new Error('Captured media data exceeded the safety limit'));
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (err) => finish(err));
    child.on('close', (code) => {
      if (code === 0) finish(null, Buffer.concat(chunks));
      else finish(new Error(`${cmd} exited with code ${code}: ${stderr.slice(0, 500)}`));
    });
  });
}

function checkToolAvailable(toolKey, versionArgs) {
  return run(resolveTool(toolKey), versionArgs, { timeoutMs: 8000 }).then(() => true).catch(() => false);
}

let capabilitiesCache = null;
const mediaValidationCache = new Map();
async function getCapabilities(forceRefresh = false) {
  if (capabilitiesCache && !forceRefresh) return capabilitiesCache;
  const [hasSoffice, hasImageMagick] = await Promise.all([
    checkToolAvailable('soffice', ['--version']),
    checkToolAvailable('convert', ['-version'])
  ]);
  // sharp and ffmpeg-static are regular npm dependencies — if `npm install`
  // succeeded at all, they're there. No detection needed, but we still
  // confirm the binary path resolves to something real.
  const ffmpegPath = resolveFfmpeg();
  const hasFfmpeg = !!(ffmpegPath && fs.existsSync(ffmpegPath));
  let hasSharp = true;
  try { require('sharp'); } catch (err) { hasSharp = false; }

  capabilitiesCache = { hasSoffice, hasImageMagick, hasFfmpeg, hasSharp };
  return capabilitiesCache;
}

async function validateVideoFile(filePath) {
  const ffmpegPath = resolveFfmpeg();
  if (!ffmpegPath) return { ok: false, reason: 'missing-ffmpeg' };
  let stat;
  try { stat = await fs.promises.stat(filePath); } catch (err) { return { ok: false, reason: 'not-found' }; }
  const cacheKey = `${filePath}:${stat.size}:${Math.trunc(stat.mtimeMs)}`;
  if (mediaValidationCache.has(cacheKey)) return mediaValidationCache.get(cacheKey);
  try {
    await run(ffmpegPath, [
      '-v', 'error', '-i', filePath, '-map', '0:v:0', '-frames:v', '1', '-an', '-f', 'null', '-'
    ], { timeoutMs: 30000 });
    const result = { ok: true };
    mediaValidationCache.set(cacheKey, result);
    return result;
  } catch (err) {
    const result = { ok: false, reason: 'decode-failed', message: err.message };
    mediaValidationCache.set(cacheKey, result);
    return result;
  }
}

// Keep each heavy media family serial internally so LibreOffice/FFmpeg jobs
// do not fight with siblings, while unrelated audio, video and document work
// can still make progress independently.
const taskQueues = {
  document: Promise.resolve(),
  video: Promise.resolve(),
  audio: Promise.resolve()
};
function enqueueOn(queueName, task) {
  const queue = taskQueues[queueName] || taskQueues.document;
  const result = queue.then(task, task);
  taskQueues[queueName] = result.then(() => {}, () => {});
  return result;
}
function enqueue(task) { return enqueueOn('document', task); }

/** Office document -> PDF, cached. The resulting PDF is rendered by
    pdfjs-dist in the renderer exactly like a direct PDF — see
    files:getPreview in main.js, which points the renderer at this path. */
async function convertOfficeToPdfCached(srcPath, cacheDir, tmpRootDir) {
  const cachedPdfPath = path.join(cacheDir, 'converted.pdf');
  if (fs.existsSync(cachedPdfPath)) return cachedPdfPath;

  return enqueue(async () => {
    if (fs.existsSync(cachedPdfPath)) return cachedPdfPath;
    await fs.promises.mkdir(cacheDir, { recursive: true });

    const profileDir = path.join(tmpRootDir, 'soffice-profile');
    await fs.promises.mkdir(profileDir, { recursive: true });

    await run(resolveTool('soffice'), [
      '--headless', '--norestore', '--nolockcheck',
      `-env:UserInstallation=file://${profileDir}`,
      '--convert-to', 'pdf', '--outdir', cacheDir, srcPath
    ], { timeoutMs: 45000 });

    const expectedName = path.basename(srcPath, path.extname(srcPath)) + '.pdf';
    const producedPath = path.join(cacheDir, expectedName);
    if (!fs.existsSync(producedPath)) {
      throw new Error('LibreOffice did not produce the expected PDF output for ' + srcPath);
    }
    if (producedPath !== cachedPdfPath) {
      await fs.promises.rename(producedPath, cachedPdfPath);
    }
    return cachedPdfPath;
  });
}

/** PSD -> a single flattened PNG, via ImageMagick (no npm-installable
    equivalent with confidence — this is the one tool that still needs a
    real install/bundle). */
async function rasterizePsd(srcPath, cacheDir) {
  const outPath = path.join(cacheDir, 'page-1.png');
  if (fs.existsSync(outPath)) return outPath;

  return enqueue(async () => {
    if (fs.existsSync(outPath)) return outPath;
    await fs.promises.mkdir(cacheDir, { recursive: true });
    // `[0]` selects the first frame/composite layer; -flatten merges any
    // visible layers into one image.
    await run(resolveTool('convert'), [`${srcPath}[0]`, '-flatten', outPath], { timeoutMs: 30000 });
    if (!fs.existsSync(outPath)) {
      throw new Error('ImageMagick did not produce the expected output for ' + srcPath);
    }
    return outPath;
  });
}

/** TIFF -> PNG, via sharp — a regular npm dependency, no manual install ever needed. */
async function rasterizeTiff(srcPath, cacheDir) {
  const outPath = path.join(cacheDir, 'page-1.png');
  if (fs.existsSync(outPath)) return outPath;

  return enqueue(async () => {
    if (fs.existsSync(outPath)) return outPath;
    await fs.promises.mkdir(cacheDir, { recursive: true });
    const sharp = require('sharp');
    await sharp(srcPath).png().toFile(outPath);
    if (!fs.existsSync(outPath)) {
      throw new Error('sharp did not produce the expected output for ' + srcPath);
    }
    return outPath;
  });
}

/**
 * Transcodes a video to a universally browser-playable H.264/AAC MP4 using
 * ffmpeg-static (automatic per-platform binary, no manual install). Only
 * called reactively — when the browser's native <video> element fails to
 * play a file directly — so common formats never pay this cost at all.
 * Cached on disk per file, same pattern as the other caches here.
 */
async function transcodeVideoToWebCompatible(filePath, cacheRootDir, fileId) {
  const cacheDir = path.join(cacheRootDir, fileId);
  const outputPath = path.join(cacheDir, 'transcoded.mp4');
  const tempPath = path.join(cacheDir, 'transcoded.part.mp4');
  const hasCompleteOutput = (candidate) => {
    try {
      return fs.statSync(candidate).size >= MIN_TRANSCODED_VIDEO_BYTES;
    } catch (err) {
      return false;
    }
  };

  if (hasCompleteOutput(outputPath)) return outputPath;
  if (fs.existsSync(outputPath)) fs.rmSync(outputPath, { force: true });

  return enqueueOn('video', async () => {
    if (hasCompleteOutput(outputPath)) return outputPath;
    await fs.promises.mkdir(cacheDir, { recursive: true });
    await fs.promises.rm(tempPath, { force: true });

    const ffmpegPath = resolveFfmpeg();
    if (!ffmpegPath) throw new Error('ffmpeg-static did not resolve to a binary');

    await run(ffmpegPath, [
      '-y',
      '-fflags', '+genpts+discardcorrupt',
      '-i', filePath,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '160k',
      '-movflags', '+faststart',
      tempPath
    ], { timeoutMs: 5 * 60 * 1000 }); // generous timeout — transcoding can take a while for long/large videos

    // FFmpeg only exits successfully after finalizing the MP4. Do not apply a
    // large arbitrary minimum byte size here: short, highly compressible
    // but valid clips can legitimately be much smaller than 32 KiB.
    if (!hasCompleteOutput(tempPath)) {
      throw new Error('ffmpeg did not produce the expected output for ' + filePath);
    }
    await fs.promises.rename(tempPath, outputPath);
    return outputPath;
  });
}

/** Creates a browser-playable AAC/M4A preview for lossless or legacy audio.
    The source file is never changed; this is only a disposable preview cache. */
async function transcodeAudioToWebCompatible(filePath, cacheRootDir, fileId) {
  const cacheDir = path.join(cacheRootDir, fileId);
  const outputPath = path.join(cacheDir, 'transcoded.m4a');
  const tempPath = path.join(cacheDir, 'transcoded.part.m4a');
  if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 8192) return outputPath;
  if (fs.existsSync(outputPath)) fs.rmSync(outputPath, { force: true });

  return enqueueOn('audio', async () => {
    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 8192) return outputPath;
    await fs.promises.mkdir(cacheDir, { recursive: true });
    await fs.promises.rm(tempPath, { force: true });
    const ffmpegPath = resolveFfmpeg();
    if (!ffmpegPath) throw new Error('ffmpeg-static did not resolve to a binary');
    await run(ffmpegPath, [
      '-y', '-i', filePath, '-vn', '-c:a', 'aac', '-b:a', '192k', tempPath
    ], { timeoutMs: 5 * 60 * 1000 });
    if (!fs.existsSync(tempPath) || fs.statSync(tempPath).size <= 8192) throw new Error('ffmpeg did not produce audio preview output');
    await fs.promises.rename(tempPath, outputPath);
    return outputPath;
  });
}

async function generateAudioWaveform(filePath, cacheRootDir, fileId, barCount = 72) {
  const cacheDir = path.join(cacheRootDir, fileId);
  const cachePath = path.join(cacheDir, `waveform-${barCount}.json`);
  try {
    const cached = JSON.parse(await fs.promises.readFile(cachePath, 'utf8'));
    if (Array.isArray(cached.peaks) && cached.peaks.length === barCount) return cached.peaks;
  } catch (err) {}

  return enqueueOn('audio', async () => {
    try {
      const cached = JSON.parse(await fs.promises.readFile(cachePath, 'utf8'));
      if (Array.isArray(cached.peaks) && cached.peaks.length === barCount) return cached.peaks;
    } catch (err) {}

    const ffmpegPath = resolveFfmpeg();
    if (!ffmpegPath) throw new Error('ffmpeg-static did not resolve to a binary');
    await fs.promises.mkdir(cacheDir, { recursive: true });
    const pcm = await runCapture(ffmpegPath, [
      '-v', 'error', '-i', filePath, '-vn', '-ac', '1', '-ar', '1200', '-f', 's16le', 'pipe:1'
    ], { timeoutMs: 5 * 60 * 1000 });
    const sampleCount = Math.floor(pcm.length / 2);
    if (!sampleCount) throw new Error('No audio samples were decoded');
    const peaks = [];
    for (let bar = 0; bar < barCount; bar += 1) {
      const start = Math.floor(bar * sampleCount / barCount);
      const end = Math.max(start + 1, Math.floor((bar + 1) * sampleCount / barCount));
      let sumSquares = 0;
      let peak = 0;
      for (let index = start; index < end; index += 1) {
        const value = Math.abs(pcm.readInt16LE(index * 2)) / 32768;
        sumSquares += value * value;
        peak = Math.max(peak, value);
      }
      const rms = Math.sqrt(sumSquares / Math.max(1, end - start));
      peaks.push(Math.max(0.04, Math.min(1, rms * 2.8 + peak * 0.18)));
    }
    const maxPeak = Math.max(...peaks, 0.01);
    const normalized = peaks.map((value) => Number(Math.max(0.08, value / maxPeak).toFixed(4)));
    await fs.promises.writeFile(cachePath, JSON.stringify({ peaks: normalized }), 'utf8');
    return normalized;
  });
}

module.exports = {
  isOfficeExt,
  isPdfExt,
  isImageExt,
  isPsdExt,
  isTextExt,
  isVideoExt,
  isAudioExt,
  needsVideoTranscode,
  isPreviewableDocument,
  configureToolsRoot,
  getCapabilities,
  validateVideoFile,
  convertOfficeToPdfCached,
  rasterizePsd,
  rasterizeTiff,
  transcodeVideoToWebCompatible,
  transcodeAudioToWebCompatible,
  generateAudioWaveform
};
