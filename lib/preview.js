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
const { pathToFileURL } = require('url');
const { TextDecoder } = require('util');

const MIN_TRANSCODED_VIDEO_BYTES = 256;
const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;
const PREVIEW_CACHE_SCHEMA = 1;

const OFFICE_EXTENSIONS = new Set([
  '.doc', '.docx', '.rtf', '.odt',
  '.ppt', '.pptx', '.odp',
  '.xls', '.xlsx', '.ods', '.csv', '.pages', '.numbers', '.key'
]);

const IMAGE_EXTENSIONS = new Set([
  '.png', '.apng', '.jpg', '.jpeg', '.jpe', '.jfif', '.gif', '.webp',
  '.bmp', '.dib', '.svg', '.avif', '.heic', '.heif', '.jxl', '.jp2',
  '.j2k', '.ico', '.icns', '.tga', '.dds', '.tiff', '.tif', '.raw',
  '.dng', '.cr2', '.cr3', '.nef', '.nrw', '.arw', '.sr2', '.raf',
  '.orf', '.rw2', '.pef', '.x3f', '.erf', '.kdc', '.mos', '.hdr',
  '.exr', '.pcx', '.pnm', '.pbm', '.pgm', '.ppm'
]);
const BROWSER_IMAGE_EXTENSIONS = new Set([
  '.png', '.apng', '.jpg', '.jpeg', '.jpe', '.jfif', '.gif', '.webp',
  '.bmp', '.dib', '.svg', '.avif', '.ico'
]);
const PSD_EXTENSIONS = new Set(['.psd', '.psb', '.ai', '.eps']);
const TIFF_EXTENSIONS = new Set(['.tiff', '.tif']);

const TEXT_EXTENSIONS = new Set([
  '.txt', '.text', '.md', '.mdx', '.markdown', '.rst', '.adoc',
  '.json', '.jsonc', '.json5', '.ndjson', '.geojson', '.csv', '.tsv',
  '.log', '.out', '.diff', '.patch', '.ini', '.cfg', '.conf', '.config',
  '.properties', '.env', '.toml', '.yml', '.yaml', '.xml', '.xsd', '.xsl',
  '.html', '.htm', '.css', '.scss', '.sass', '.less', '.svg',
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.vue', '.svelte',
  '.py', '.pyw', '.rb', '.php', '.java', '.kt', '.kts', '.swift', '.go',
  '.rs', '.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.cs', '.fs', '.fsx',
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd', '.sql', '.graphql',
  '.gql', '.lua', '.r', '.dart', '.tex', '.bib', '.srt', '.vtt', '.ass',
  '.gitignore', '.gitattributes', '.editorconfig', '.npmrc', '.yarnrc', '.lock'
]);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.ogv', '.mov', '.m4v', '.mkv', '.avi', '.wmv', '.asf', '.flv', '.f4v', '.mts', '.m2ts', '.ts', '.m2t', '.mpg', '.mpeg', '.mpe', '.3gp', '.3g2', '.vob', '.rm', '.rmvb', '.divx', '.dv', '.mxf', '.y4m', '.prores']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.wave', '.ogg', '.oga', '.opus', '.m4a', '.m4b', '.aac', '.flac', '.aif', '.aiff', '.wma', '.amr', '.ape', '.alac', '.ac3', '.eac3', '.dts', '.caf', '.au', '.ra']);

function isOfficeExt(ext) { return OFFICE_EXTENSIONS.has(ext); }
function isPdfExt(ext) { return ext === '.pdf'; }
function isImageExt(ext) { return IMAGE_EXTENSIONS.has(ext); }
function browserCanDecodeImage(ext) { return BROWSER_IMAGE_EXTENSIONS.has(ext); }
function needsImageConversion(ext) { return isImageExt(ext) && !browserCanDecodeImage(ext); }
function isPsdExt(ext) { return PSD_EXTENSIONS.has(ext); }
function isTiffExt(ext) { return TIFF_EXTENSIONS.has(ext); }
function isRasterConvertExt(ext) { return isPsdExt(ext) || needsImageConversion(ext); }
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
      child = spawn(cmd, args, {
        cwd,
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe']
      });
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

async function sourceFingerprint(filePath) {
  const stat = await fs.promises.stat(filePath);
  return {
    size: stat.size,
    mtimeMs: Math.trunc(stat.mtimeMs)
  };
}

function fingerprintsMatch(left, right) {
  return !!left && !!right && left.size === right.size && left.mtimeMs === right.mtimeMs;
}

async function isFreshCachedOutput(outputPath, metadataPath, filePath, minimumBytes = 1) {
  try {
    const [outputStat, current, saved] = await Promise.all([
      fs.promises.stat(outputPath),
      sourceFingerprint(filePath),
      fs.promises.readFile(metadataPath, 'utf8').then(JSON.parse)
    ]);
    return outputStat.isFile() && outputStat.size >= minimumBytes && saved &&
      saved.schema === PREVIEW_CACHE_SCHEMA && saved.size === current.size && saved.mtimeMs === current.mtimeMs;
  } catch (error) {
    return false;
  }
}

async function markCachedOutput(metadataPath, filePath, expectedFingerprint = null) {
  const fingerprint = await sourceFingerprint(filePath);
  if (expectedFingerprint && !fingerprintsMatch(fingerprint, expectedFingerprint)) {
    const error = new Error('The source file changed while its preview was being generated.');
    error.code = 'preview-source-changed';
    throw error;
  }
  const tempPath = `${metadataPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tempPath, JSON.stringify({ schema: PREVIEW_CACHE_SCHEMA, ...fingerprint }), 'utf8');
  await fs.promises.rm(metadataPath, { force: true });
  await fs.promises.rename(tempPath, metadataPath);
}

async function validatePdfOutput(filePath) {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 32) throw new Error('LibreOffice produced an empty PDF preview.');
    const header = Buffer.alloc(5);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead !== header.length || header.toString('ascii') !== '%PDF-') {
      throw new Error('LibreOffice produced an invalid PDF preview.');
    }
  } finally {
    await handle.close();
  }
}

function decodeTextBuffer(buffer, { allowTruncatedUtf8 = false } = {}) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (!source.length) return { text: '', encoding: 'utf-8' };

  if (source.length >= 3 && source[0] === 0xEF && source[1] === 0xBB && source[2] === 0xBF) {
    const payload = source.subarray(3);
    try {
      return {
        text: new TextDecoder('utf-8', { fatal: true }).decode(payload, { stream: allowTruncatedUtf8 }),
        encoding: 'utf-8'
      };
    } catch (error) {
      return { text: payload.toString('utf8'), encoding: 'utf-8' };
    }
  }
  if (source.length >= 2 && source[0] === 0xFF && source[1] === 0xFE) {
    const payload = source.subarray(2);
    const evenLength = payload.length - (payload.length % 2);
    return { text: payload.subarray(0, evenLength).toString('utf16le'), encoding: 'utf-16le' };
  }
  if (source.length >= 2 && source[0] === 0xFE && source[1] === 0xFF) {
    const payload = source.subarray(2);
    const evenLength = payload.length - (payload.length % 2);
    const swapped = Buffer.from(payload.subarray(0, evenLength));
    swapped.swap16();
    return { text: swapped.toString('utf16le'), encoding: 'utf-16be' };
  }

  const sampleLength = Math.min(source.length, 4096);
  let evenNulls = 0;
  let oddNulls = 0;
  for (let index = 0; index < sampleLength; index += 1) {
    if (source[index] !== 0) continue;
    if (index % 2) oddNulls += 1;
    else evenNulls += 1;
  }
  const pairCount = Math.max(1, Math.floor(sampleLength / 2));
  if (oddNulls / pairCount > 0.3 && evenNulls / pairCount < 0.05) {
    return { text: source.toString('utf16le'), encoding: 'utf-16le' };
  }
  if (evenNulls / pairCount > 0.3 && oddNulls / pairCount < 0.05) {
    const evenLength = source.length - (source.length % 2);
    const swapped = Buffer.from(source.subarray(0, evenLength));
    swapped.swap16();
    return { text: swapped.toString('utf16le'), encoding: 'utf-16be' };
  }

  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(source), encoding: 'utf-8' };
  } catch (error) {}

  // A bounded preview can end in the middle of one UTF-8 code point. Only
  // trim the maximum possible UTF-8 tail, and only accept it when the entire
  // remaining prefix validates. Invalid bytes elsewhere still fall through
  // to the legacy Windows encodings below.
  if (allowTruncatedUtf8) {
    for (let trim = 1; trim <= Math.min(3, source.length); trim += 1) {
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(source.subarray(0, source.length - trim));
        return { text, encoding: 'utf-8' };
      } catch (error) {}
    }
  }

  // Legacy documents created on Chinese, Japanese and Western Windows often
  // have no BOM. Decode with broadly available ICU codecs and choose the
  // result containing the fewest control/replacement characters.
  const candidates = ['gb18030', 'big5', 'shift_jis', 'windows-1252'];
  let best = null;
  for (const encoding of candidates) {
    try {
      const text = new TextDecoder(encoding).decode(source);
      const replacements = (text.match(/\uFFFD/g) || []).length;
      const controls = (text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length;
      const score = replacements * 100 + controls * 10;
      if (!best || score < best.score) best = { text, encoding, score };
    } catch (error) {}
  }
  return best || { text: source.toString('latin1'), encoding: 'windows-1252' };
}

async function readTextPreview(filePath, maximumBytes = MAX_TEXT_PREVIEW_BYTES) {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    const byteCount = Math.min(stat.size, Math.max(1, maximumBytes));
    const buffer = Buffer.alloc(byteCount);
    const { bytesRead } = await handle.read(buffer, 0, byteCount, 0);
    const decoded = decodeTextBuffer(buffer.subarray(0, bytesRead), {
      allowTruncatedUtf8: stat.size > bytesRead
    });
    return {
      content: decoded.text.replace(/^\uFEFF/, ''),
      encoding: decoded.encoding,
      partial: stat.size > bytesRead,
      sizeBytes: stat.size
    };
  } finally {
    await handle.close();
  }
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

  let hasDocxFallback = true;
  try { require.resolve('mammoth'); } catch (error) { hasDocxFallback = false; }

  capabilitiesCache = { hasSoffice, hasImageMagick, hasFfmpeg, hasSharp, hasDocxFallback };
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
  const metadataPath = path.join(cacheDir, 'converted.meta.json');
  if (await isFreshCachedOutput(cachedPdfPath, metadataPath, srcPath, 32)) return cachedPdfPath;

  return enqueue(async () => {
    if (await isFreshCachedOutput(cachedPdfPath, metadataPath, srcPath, 32)) return cachedPdfPath;
    await fs.promises.mkdir(cacheDir, { recursive: true });
    const sourceState = await sourceFingerprint(srcPath);
    await fs.promises.rm(cachedPdfPath, { force: true });
    await fs.promises.rm(metadataPath, { force: true });
    const conversionDir = await fs.promises.mkdtemp(path.join(cacheDir, '.office-preview-'));
    const profileDir = path.join(conversionDir, 'profile');
    const outputDir = path.join(conversionDir, 'output');
    const expectedName = path.basename(srcPath, path.extname(srcPath)) + '.pdf';
    const producedPath = path.join(outputDir, expectedName);
    try {
      await Promise.all([
        fs.promises.mkdir(profileDir, { recursive: true }),
        fs.promises.mkdir(outputDir, { recursive: true })
      ]);
      await run(resolveTool('soffice'), [
        '--headless', '--norestore', '--nolockcheck',
        `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
        '--convert-to', 'pdf', '--outdir', outputDir, srcPath
      ], { timeoutMs: 90_000 });

      if (!fs.existsSync(producedPath)) {
        throw new Error('LibreOffice did not produce the expected PDF output for ' + srcPath);
      }
      await validatePdfOutput(producedPath);
      await fs.promises.rename(producedPath, cachedPdfPath);
      await markCachedOutput(metadataPath, srcPath, sourceState);
      return cachedPdfPath;
    } finally {
      await fs.promises.rm(conversionDir, { recursive: true, force: true }).catch(() => {});
    }
  });
}

/** PSD -> a single flattened PNG, via ImageMagick (no npm-installable
    equivalent with confidence — this is the one tool that still needs a
    real install/bundle). */
async function rasterizePsd(srcPath, cacheDir) {
  const outPath = path.join(cacheDir, 'page-1.png');
  const metadataPath = path.join(cacheDir, 'page-1.meta.json');
  if (await isFreshCachedOutput(outPath, metadataPath, srcPath, 32)) return outPath;

  return enqueue(async () => {
    if (await isFreshCachedOutput(outPath, metadataPath, srcPath, 32)) return outPath;
    await fs.promises.mkdir(cacheDir, { recursive: true });
    const sourceState = await sourceFingerprint(srcPath);
    await fs.promises.rm(outPath, { force: true });
    await fs.promises.rm(metadataPath, { force: true });
    // `[0]` selects the first frame/composite layer; -flatten merges any
    // visible layers into one image.
    await run(resolveTool('convert'), [`${srcPath}[0]`, '-flatten', outPath], { timeoutMs: 30000 });
    if (!fs.existsSync(outPath)) {
      throw new Error('ImageMagick did not produce the expected output for ' + srcPath);
    }
    await markCachedOutput(metadataPath, srcPath, sourceState);
    return outPath;
  });
}

/** TIFF -> PNG, via sharp — a regular npm dependency, no manual install ever needed. */
async function rasterizeTiff(srcPath, cacheDir) {
  const outPath = path.join(cacheDir, 'page-1.png');
  const metadataPath = path.join(cacheDir, 'page-1.meta.json');
  if (await isFreshCachedOutput(outPath, metadataPath, srcPath, 32)) return outPath;

  return enqueue(async () => {
    if (await isFreshCachedOutput(outPath, metadataPath, srcPath, 32)) return outPath;
    await fs.promises.mkdir(cacheDir, { recursive: true });
    const sourceState = await sourceFingerprint(srcPath);
    await fs.promises.rm(outPath, { force: true });
    await fs.promises.rm(metadataPath, { force: true });
    const sharp = require('sharp');
    await sharp(srcPath, { failOn: 'none', sequentialRead: true }).rotate().png().toFile(outPath);
    if (!fs.existsSync(outPath)) {
      throw new Error('sharp did not produce the expected output for ' + srcPath);
    }
    await markCachedOutput(metadataPath, srcPath, sourceState);
    return outPath;
  });
}

/** Converts image formats Chromium cannot decode directly into a cached PNG.
    sharp handles modern camera/raster files first; a bundled ImageMagick is
    used as a second chance for formats outside libvips' codec set. */
async function rasterizeImageToPng(srcPath, cacheDir) {
  const outPath = path.join(cacheDir, 'page-1.png');
  const metadataPath = path.join(cacheDir, 'page-1.meta.json');
  if (await isFreshCachedOutput(outPath, metadataPath, srcPath, 32)) return outPath;

  return enqueue(async () => {
    if (await isFreshCachedOutput(outPath, metadataPath, srcPath, 32)) return outPath;
    await fs.promises.mkdir(cacheDir, { recursive: true });
    const sourceState = await sourceFingerprint(srcPath);
    await fs.promises.rm(outPath, { force: true });
    await fs.promises.rm(metadataPath, { force: true });

    let sharpError = null;
    try {
      const sharp = require('sharp');
      await sharp(srcPath, { failOn: 'none', sequentialRead: true })
        .rotate()
        .png()
        .toFile(outPath);
    } catch (error) {
      sharpError = error;
      await fs.promises.rm(outPath, { force: true });
    }

    if (!fs.existsSync(outPath)) {
      try {
        await run(resolveTool('convert'), [`${srcPath}[0]`, '-auto-orient', outPath], { timeoutMs: 90_000 });
      } catch (convertError) {
        const error = new Error(`Image conversion failed: ${sharpError ? sharpError.message : ''} ${convertError.message}`.trim());
        error.code = 'image-conversion-failed';
        throw error;
      }
    }
    const outputStat = await fs.promises.stat(outPath);
    if (!outputStat.isFile() || outputStat.size < 32) throw new Error('Image converter produced an empty preview');
    await markCachedOutput(metadataPath, srcPath, sourceState);
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
  const metadataPath = path.join(cacheDir, 'transcoded.meta.json');

  if (await isFreshCachedOutput(outputPath, metadataPath, filePath, MIN_TRANSCODED_VIDEO_BYTES)) return outputPath;

  return enqueueOn('video', async () => {
    if (await isFreshCachedOutput(outputPath, metadataPath, filePath, MIN_TRANSCODED_VIDEO_BYTES)) return outputPath;
    await fs.promises.mkdir(cacheDir, { recursive: true });
    const sourceState = await sourceFingerprint(filePath);
    await fs.promises.rm(outputPath, { force: true });
    await fs.promises.rm(tempPath, { force: true });
    await fs.promises.rm(metadataPath, { force: true });

    const ffmpegPath = resolveFfmpeg();
    if (!ffmpegPath) throw new Error('ffmpeg-static did not resolve to a binary');

    await run(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-fflags', '+genpts+discardcorrupt+igndts',
      '-err_detect', 'ignore_err',
      '-i', filePath,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-sn', '-dn', '-map_metadata', '-1', '-map_chapters', '-1',
      '-vf', 'scale=min(3840\\,iw):min(3840\\,ih):force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,format=yuv420p',
      '-fps_mode', 'vfr',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '21', '-profile:v', 'high',
      '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
      '-avoid_negative_ts', 'make_zero',
      '-max_muxing_queue_size', '4096',
      '-video_track_timescale', '90000',
      '-movflags', '+faststart',
      tempPath
    ], { timeoutMs: 30 * 60 * 1000 });

    // FFmpeg only exits successfully after finalizing the MP4. Do not apply a
    // large arbitrary minimum byte size here: short, highly compressible
    // but valid clips can legitimately be much smaller than 32 KiB.
    let outputStat = null;
    try { outputStat = await fs.promises.stat(tempPath); } catch (error) {}
    if (!outputStat || outputStat.size < MIN_TRANSCODED_VIDEO_BYTES) {
      throw new Error('ffmpeg did not produce the expected output for ' + filePath);
    }
    const validation = await validateVideoFile(tempPath);
    if (!validation.ok) throw new Error('ffmpeg produced an unreadable MP4 preview');
    await fs.promises.rename(tempPath, outputPath);
    await markCachedOutput(metadataPath, filePath, sourceState);
    return outputPath;
  });
}

/** Creates a browser-playable AAC/M4A preview for lossless or legacy audio.
    The source file is never changed; this is only a disposable preview cache. */
async function transcodeAudioToWebCompatible(filePath, cacheRootDir, fileId) {
  const cacheDir = path.join(cacheRootDir, fileId);
  const outputPath = path.join(cacheDir, 'transcoded.m4a');
  const tempPath = path.join(cacheDir, 'transcoded.part.m4a');
  const metadataPath = path.join(cacheDir, 'transcoded-audio.meta.json');
  if (await isFreshCachedOutput(outputPath, metadataPath, filePath, 256)) return outputPath;

  return enqueueOn('audio', async () => {
    if (await isFreshCachedOutput(outputPath, metadataPath, filePath, 256)) return outputPath;
    await fs.promises.mkdir(cacheDir, { recursive: true });
    const sourceState = await sourceFingerprint(filePath);
    await fs.promises.rm(outputPath, { force: true });
    await fs.promises.rm(tempPath, { force: true });
    await fs.promises.rm(metadataPath, { force: true });
    const ffmpegPath = resolveFfmpeg();
    if (!ffmpegPath) throw new Error('ffmpeg-static did not resolve to a binary');
    await run(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-fflags', '+genpts+discardcorrupt+igndts', '-i', filePath,
      '-map', '0:a:0', '-vn', '-sn', '-dn', '-map_metadata', '-1',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart',
      tempPath
    ], { timeoutMs: 5 * 60 * 1000 });
    if (!fs.existsSync(tempPath) || fs.statSync(tempPath).size < 256) throw new Error('ffmpeg did not produce audio preview output');
    await fs.promises.rename(tempPath, outputPath);
    await markCachedOutput(metadataPath, filePath, sourceState);
    return outputPath;
  });
}

async function generateAudioWaveform(filePath, cacheRootDir, fileId, barCount = 72) {
  const cacheDir = path.join(cacheRootDir, fileId);
  const cachePath = path.join(cacheDir, `waveform-${barCount}.json`);
  try {
    const cached = JSON.parse(await fs.promises.readFile(cachePath, 'utf8'));
    const current = await sourceFingerprint(filePath);
    if (cached.schema === PREVIEW_CACHE_SCHEMA && Array.isArray(cached.peaks) && cached.peaks.length === barCount && fingerprintsMatch(cached.source, current)) {
      return cached.peaks;
    }
  } catch (err) {}

  return enqueueOn('audio', async () => {
    try {
      const cached = JSON.parse(await fs.promises.readFile(cachePath, 'utf8'));
      const current = await sourceFingerprint(filePath);
      if (cached.schema === PREVIEW_CACHE_SCHEMA && Array.isArray(cached.peaks) && cached.peaks.length === barCount && fingerprintsMatch(cached.source, current)) {
        return cached.peaks;
      }
    } catch (err) {}

    const sourceState = await sourceFingerprint(filePath);
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
    const current = await sourceFingerprint(filePath);
    if (!fingerprintsMatch(current, sourceState)) {
      const error = new Error('The source file changed while its waveform was being generated.');
      error.code = 'preview-source-changed';
      throw error;
    }
    await fs.promises.writeFile(cachePath, JSON.stringify({ schema: PREVIEW_CACHE_SCHEMA, source: current, peaks: normalized }), 'utf8');
    return normalized;
  });
}

module.exports = {
  isOfficeExt,
  isPdfExt,
  isImageExt,
  browserCanDecodeImage,
  needsImageConversion,
  isPsdExt,
  isTiffExt,
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
  rasterizeImageToPng,
  decodeTextBuffer,
  readTextPreview,
  transcodeVideoToWebCompatible,
  transcodeAudioToWebCompatible,
  generateAudioWaveform
};
