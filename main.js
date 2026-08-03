'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, Menu, clipboard, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const { autoUpdater } = require('electron-updater');

const { Store } = require('./lib/store');
const { createMembershipService } = require('./lib/membership-service');
const achievements = require('./lib/achievements');
const preview = require('./lib/preview');
const thumbnails = require('./lib/thumbnails');
const { getDefaultLibraryRoot } = require('./lib/storage-paths');
const { buildCfHDrop } = require('./lib/clipboard-files');
const {
  DEFAULT_IMAGE_ENDPOINT,
  DEFAULT_VIDEO_ENDPOINT,
  DEFAULT_RESULT_ENDPOINT,
  normalizeConfig: normalizeAiMediaConfig,
  generateMediaBuffer
} = require('./lib/ai-media-provider');
const { requestChat, discoverChatModels } = require('./lib/ai-chat-provider');
const { loadRuntimeConfig } = require('./lib/runtime-config');
const { SupabaseAuth } = require('./lib/supabase-auth');
const { AiGatewayClient } = require('./lib/ai-gateway-client');
const { assertSafeLocalFile, sanitizeAiRequest } = require('./lib/privacy-guard');

if (process.env.MESSS_DISABLE_GPU === '1') {
  app.disableHardwareAcceleration();
}

let sharp;
try { sharp = require('sharp'); } catch (err) { sharp = null; }

// Removes the default File/Edit/View/... menu bar everywhere (Windows/Linux's
// per-window menu bar and macOS's global app menu) so only Messs.'s own UI shows.
Menu.setApplicationMenu(null);

protocol.registerSchemesAsPrivileged([
  { scheme: 'messs-file', privileges: { standard: false, secure: true, supportFetchAPI: true, stream: true } },
  { scheme: 'messs-preview', privileges: { standard: false, secure: true, supportFetchAPI: true, stream: true } },
  { scheme: 'messs-thumb', privileges: { standard: false, secure: true, supportFetchAPI: true, stream: true } },
  { scheme: 'messs-transcode', privileges: { standard: false, secure: true, supportFetchAPI: true, stream: true } }
]);

let mainWindow;
let store;
let membershipService;
let runtimeConfig;
let supabaseAuth;
let aiGateway;
let usageTickInterval;
let previewCacheDir;
let previewTmpDir;
let thumbCacheDir;
const transientAiAttachments = new Map();

function createStoreWithFallback() {
  const candidates = [
    getDefaultLibraryRoot(),
    path.join(app.getPath('documents'), 'MesssLibrary'),
    path.join(app.getPath('userData'), 'MesssLibrary')
  ];
  const attempted = new Set();
  let firstError = null;

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (attempted.has(key)) continue;
    attempted.add(key);

    try {
      const candidateStore = new Store(resolved);
      const probePath = path.join(resolved, `.messs-write-probe-${process.pid}-${crypto.randomUUID()}`);
      const handle = fs.openSync(probePath, 'wx', 0o600);
      fs.closeSync(handle);
      fs.rmSync(probePath, { force: true });
      return candidateStore;
    } catch (err) {
      if (!firstError) firstError = err;
      console.error(`Could not open library at ${resolved}: ${err.message}`);
    }
  }

  throw firstError || new Error('No writable library location is available.');
}

function canvasFolderName(name) {
  const cleaned = String(name || 'Untitled')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  return cleaned || 'Untitled';
}

function canvasStorageDir(canvas) {
  return path.join(store.libraryDir, canvasFolderName(canvas && canvas.name));
}

function ensureCanvasState() {
  if (!Array.isArray(store.data.canvasProjects) || !store.data.canvasProjects.length) {
    store.data.canvasProjects = [{ id: 'project-1', name: 'General', createdAt: Date.now() }];
  }
  if (!Array.isArray(store.data.canvases) || !store.data.canvases.length) {
    store.data.canvases = [{
      id: 'canvas-1',
      projectId: store.data.canvasProjects[0].id,
      name: 'Untitled',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }];
  }
  const validCanvasIds = new Set(store.data.canvases.map((canvas) => canvas.id));
  const fallbackCanvasId = store.data.canvases[0].id;
  const fileCanvasIds = new Map();
  store.data.boardItems.forEach((item) => {
    if (!validCanvasIds.has(item.canvasId)) item.canvasId = fallbackCanvasId;
    if (item.fileId) fileCanvasIds.set(item.fileId, item.canvasId);
  });
  store.data.files.forEach((file) => {
    if (!validCanvasIds.has(file.canvasId)) file.canvasId = fileCanvasIds.get(file.id) || fallbackCanvasId;
  });
  // A generation placeholder is a renderer-only transient state. Older
  // builds persisted it, which made every later launch show a fake
  // "generating" card even though no request was running.
  const stalePlaceholders = store.data.boardItems.filter((item) => item && item.isAiPlaceholder);
  if (stalePlaceholders.length) {
    store.data.boardItems = store.data.boardItems.filter((item) => !item.isAiPlaceholder);
  }
  store.data.canvases.forEach((canvas) => {
    fs.mkdirSync(canvasStorageDir(canvas), { recursive: true });
  });

  // Move legacy board files into the default canvas archive without touching
  // files that are not associated with a canvas.
  store.data.files.forEach((file) => {
    const canvas = store.data.canvases.find((entry) => entry.id === file.canvasId);
    if (!file || !canvas || !file.storedPath || !fs.existsSync(file.storedPath)) return;
    const targetDir = canvasStorageDir(canvas);
    const targetPath = path.join(targetDir, path.basename(file.storedPath));
    if (path.resolve(file.storedPath) === path.resolve(targetPath)) return;
    try {
      if (!fs.existsSync(targetPath)) fs.renameSync(file.storedPath, targetPath);
      file.storedPath = targetPath;
    } catch (err) {
      console.error('Could not move canvas archive file:', err.message);
    }
  });
  store.scheduleSave();
}

function moveCanvasArchive(oldCanvas, nextCanvas) {
  const oldDir = canvasStorageDir(oldCanvas);
  const nextDir = canvasStorageDir(nextCanvas);
  if (path.resolve(oldDir) === path.resolve(nextDir)) return;
  fs.mkdirSync(path.dirname(nextDir), { recursive: true });
  if (fs.existsSync(oldDir)) {
    fs.mkdirSync(nextDir, { recursive: true });
    for (const entry of fs.readdirSync(oldDir)) {
      const from = path.join(oldDir, entry);
      const to = path.join(nextDir, entry);
      if (!fs.existsSync(to)) fs.renameSync(from, to);
    }
    try { fs.rmdirSync(oldDir); } catch (err) {}
  } else {
    fs.mkdirSync(nextDir, { recursive: true });
  }
  store.data.files.forEach((file) => {
    if (file.canvasId !== nextCanvas.id || !file.storedPath) return;
    file.storedPath = path.join(nextDir, path.basename(file.storedPath));
  });
}

async function moveFilePreservingData(sourcePath, targetPath) {
  if (!sourcePath || !fs.existsSync(sourcePath)) return targetPath;
  if (path.resolve(sourcePath) === path.resolve(targetPath)) return targetPath;
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await fs.promises.rename(sourcePath, targetPath);
  } catch (err) {
    if (err && err.code !== 'EXDEV') throw err;
    await fs.promises.copyFile(sourcePath, targetPath);
    await fs.promises.unlink(sourcePath);
  }
  return targetPath;
}

function getPublishInfo() {
  try {
    const pkg = require('./package.json');
    const pub = Array.isArray(pkg.build && pkg.build.publish) ? pkg.build.publish[0] : null;
    if (pub && pub.provider === 'github') return pub;
  } catch (err) {
  }
  if (runtimeConfig && runtimeConfig.githubOwner && runtimeConfig.githubRepo) {
    return { provider: 'github', owner: runtimeConfig.githubOwner, repo: runtimeConfig.githubRepo };
  }
  return null;
}

function notifyUpdateDownloaded(info) {
  if (mainWindow) {
    mainWindow.webContents.send('updater:downloaded', { version: info.version });
  }
}

function checkForUpdatesQuietly() {
  // Update checks fail for plenty of benign reasons (offline, no release
  // published yet, unsigned mac build, rate limits) 锟?never surface these
  // as user-facing errors, just log for our own debugging.
  autoUpdater.checkForUpdates().catch((err) => {
    console.error('checkForUpdates failed:', err.message);
  });
}

function setupAutoUpdater() {
  if (!app.isPackaged) return; // No published feed to check against in dev.

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', notifyUpdateDownloaded);
  autoUpdater.on('error', (err) => {
    console.error('Auto-update error:', err == null ? err : err.message);
  });

  checkForUpdatesQuietly();
  setInterval(checkForUpdatesQuietly, 4 * 60 * 60 * 1000); // also re-check every 4 hours.
}

function getDesktopDir() {
  // Works for both English and localized Windows/macOS installs in the common case;
  // falls back gracefully if the folder doesn't exist.
  const candidate = path.join(os.homedir(), 'Desktop');
  return fs.existsSync(candidate) ? candidate : null;
}

function listDesktopFilenames() {
  const dir = getDesktopDir();
  if (!dir) return [];
  try {
    return fs.readdirSync(dir);
  } catch (err) {
    return [];
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: '#080A0D',
    frame: false, // We draw our own top bar (see src/index.html #app-titlebar) so it
                   // always matches the app's theme instead of the OS's default chrome.
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.setMenu(null);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault();
  });
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

  mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximizedChanged', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximizedChanged', false));

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

function startSession() {
  const now = new Date().toISOString();
  if (!store.data.usage.firstRunAt) store.data.usage.firstRunAt = now;
  store.data.usage.lastRunAt = now;
  store.data.usage.sessionStartedAt = now;
  store.scheduleSave();

  // Tick every second while the app is running; only counted while window is focused.
  usageTickInterval = setInterval(() => {
    if (mainWindow && mainWindow.isFocused() && !mainWindow.isMinimized()) {
      store.data.usage.totalSeconds += 1;
      store.scheduleSave();
    }
  }, 1000);
}

function runDailyDesktopChecks() {
  const filenames = listDesktopFilenames();
  const unlockedClutter = achievements.checkNoClutterMonth(store, filenames);
  const unlockedMinimalist = achievements.checkMinimalist(store, filenames.length);
  if (unlockedClutter || unlockedMinimalist) {
    store.scheduleSave();
    notifyAchievements();
  }
}

function notifyAchievements() {
  if (mainWindow) {
    mainWindow.webContents.send('achievements:updated', getAchievementsPayload());
  }
}

function getAchievementsPayload() {
  return achievements.DEFINITIONS.map((def) => ({
    ...def,
    unlocked: store.data.achievements[def.key].unlocked,
    unlockedAt: store.data.achievements[def.key].unlockedAt
  }));
}

/**
 * Removes file records whose actual copy on disk (in the library folder)
 * has gone missing 锟?e.g. someone manually deleted it from
 * C:\MesssLibrary\library\ outside of Messs. itself. Runs once at startup
 * rather than on every render, since stat-ing every file on each state
 * fetch would be wasteful; new deletions made through the app's own UI are
 * already reflected immediately without needing this.
 */
function pruneMissingFiles() {
  const before = store.data.files.length;
  store.data.files = store.data.files.filter((f) => {
    try {
      return fs.existsSync(f.storedPath);
    } catch (err) {
      return true; // err on the side of keeping the record if the check itself fails
    }
  });
  if (store.data.files.length !== before) {
    const survivingIds = new Set(store.data.files.map((f) => f.id));
    store.data.boardItems = store.data.boardItems.filter((b) => survivingIds.has(b.fileId) || b.isNote || b.isDoodle);
    store.reindexFiles();
    store.scheduleSave();
  }
}

function fileToPayload(f) {
  const ext = path.extname(f.name).toLowerCase();
  return {
    id: f.id,
    name: f.name,
    importedAt: f.importedAt,
    sourceFolder: f.sourceFolder,
    canvasId: f.canvasId || null,
    sizeBytes: f.sizeBytes,
    sourceWidth: f.sourceWidth || null,
    sourceHeight: f.sourceHeight || null,
    mimeType: f.mimeType || 'application/octet-stream',
    archiveKind: f.archiveKind || 'file',
    fingerprint: f.fingerprint || null,
    aiGeneration: f.aiGeneration ? {
      kind: f.aiGeneration.kind,
      prompt: f.aiGeneration.prompt,
      modelName: f.aiGeneration.modelName,
      providerId: f.aiGeneration.providerId,
      aspectRatio: f.aiGeneration.aspectRatio,
      size: f.aiGeneration.size,
      duration: f.aiGeneration.duration,
      referenceFileIds: Array.isArray(f.aiGeneration.referenceFileIds)
        ? [...f.aiGeneration.referenceFileIds]
        : [],
      referenceCount: Number(f.aiGeneration.referenceCount) || 0,
      createdAt: f.aiGeneration.createdAt
    } : null,
    folderId: f.folderId || null,
    ext,
    url: 'messs-file://' + f.id,
    // Small cached thumbnail for list/grid display 锟?only meaningful for
    // images (thumbnails.isThumbnailableExt gates that on the main-process
    // side too), but it's harmless to always include the URL since the
    // renderer only ever uses it where it already checks isImageExt.
    thumbUrl: 'messs-thumb://' + f.id
  };
}

async function readSourceImageDimensions(filePath, ext) {
  const normalizedExt = String(ext || '').toLowerCase();
  if (!sharp || !preview.isImageExt(normalizedExt)) return null;
  try {
    const metadata = await sharp(filePath, { failOn: 'none' }).metadata();
    if (!Number.isFinite(metadata.width) || !Number.isFinite(metadata.height)) return null;
    return {
      sourceWidth: metadata.width,
      sourceHeight: metadata.height
    };
  } catch (err) {
    return null;
  }
}

async function hydrateMissingImageDimensions() {
  const candidates = store.data.files.filter((file) =>
    !file.sourceWidth &&
    !file.sourceHeight &&
    preview.isImageExt(String(file.ext || path.extname(file.name)).toLowerCase()) &&
    file.storedPath
  );
  if (!candidates.length) return;

  let cursor = 0;
  const worker = async () => {
    while (cursor < candidates.length) {
      const file = candidates[cursor++];
      const dimensions = await readSourceImageDimensions(
        file.storedPath,
        file.ext || path.extname(file.name)
      );
      if (dimensions) Object.assign(file, dimensions);
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, candidates.length) }, worker));
  store.scheduleSave();
}

const MIME_BY_EXTENSION = {
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown',
  '.json': 'application/json', '.csv': 'text/csv', '.zip': 'application/zip',
  '.7z': 'application/x-7z-compressed', '.rar': 'application/vnd.rar',
  '.tar': 'application/x-tar', '.gz': 'application/gzip'
};
const ARCHIVE_EXTENSIONS = new Set(['.zip', '.7z', '.rar', '.tar', '.gz', '.bz2', '.xz', '.zst', '.iso', '.dmg', '.img']);

function classifyArchiveFile(name) {
  const ext = path.extname(name).toLowerCase();
  const mimeType = MIME_BY_EXTENSION[ext]
    || (preview.isImageExt(ext) ? `image/${ext.slice(1)}` : preview.isVideoExt(ext) ? `video/${ext.slice(1)}` : preview.isAudioExt(ext) ? `audio/${ext.slice(1)}` : 'application/octet-stream');
  const archiveKind = ARCHIVE_EXTENSIONS.has(ext) ? 'archive'
    : preview.isImageExt(ext) ? 'image' : preview.isVideoExt(ext) ? 'video'
      : preview.isAudioExt(ext) ? 'audio' : preview.isTextExt(ext) ? 'text'
        : preview.isPreviewableDocument(ext) ? 'document' : 'file';
  return { mimeType, archiveKind };
}

function formatBinaryRows(buffer, bytesPerRow = 16) {
  const rows = [];
  for (let offset = 0; offset < buffer.length; offset += bytesPerRow) {
    const chunk = buffer.subarray(offset, offset + bytesPerRow);
    rows.push({
      offset: offset.toString(16).toUpperCase().padStart(8, '0'),
      hex: Array.from(chunk, (byte) => byte.toString(16).toUpperCase().padStart(2, '0')).join(' '),
      ascii: Array.from(chunk, (byte) => (byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.')).join('')
    });
  }
  return rows;
}

function detectBinaryKind(buffer, ext) {
  const hex = buffer.subarray(0, 16).toString('hex').toUpperCase();
  const ascii = buffer.subarray(0, 16).toString('ascii');
  if (ascii.startsWith('%PDF-')) return 'PDF document';
  if (hex.startsWith('504B0304') || hex.startsWith('504B0506') || hex.startsWith('504B0708')) return 'ZIP archive / packaged document';
  if (hex.startsWith('526172211A0700')) return 'RAR archive';
  if (hex.startsWith('377ABCAF271C')) return '7-Zip archive';
  if (hex.startsWith('1F8B08')) return 'GZIP archive';
  if (hex.startsWith('89504E470D0A1A0A')) return 'PNG image';
  if (hex.startsWith('FFD8FF')) return 'JPEG image';
  if (ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a')) return 'GIF image';
  if (ascii.startsWith('RIFF') && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'WebP image';
  if (ascii.startsWith('RIFF') && buffer.subarray(8, 12).toString('ascii') === 'WAVE') return 'WAV audio';
  if (ascii.startsWith('ID3') || hex.startsWith('FFF3') || hex.startsWith('FFFB')) return 'MP3 audio';
  if (ascii.startsWith('OggS')) return 'Ogg media';
  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') return 'ISO media container';
  if (hex.startsWith('4D5A')) return 'Windows executable';
  if (hex.startsWith('7F454C46')) return 'ELF executable';
  if (hex.startsWith('0061736D')) return 'WebAssembly binary';
  if (ascii.startsWith('SQLite format 3')) return 'SQLite database';
  return ext ? `${ext.slice(1).toUpperCase()} binary data` : 'Binary data';
}

function buildUnknownFilePreview(file) {
  const fd = fs.openSync(file.storedPath, 'r');
  try {
    const stat = fs.fstatSync(fd);
    const sample = Buffer.alloc(Math.min(stat.size, 8192));
    const bytesRead = fs.readSync(fd, sample, 0, sample.length, 0);
    const content = sample.subarray(0, bytesRead);
    const nullBytes = content.reduce((count, byte) => count + (byte === 0 ? 1 : 0), 0);
    const decoded = content.toString('utf8');
    const replacementRatio = decoded.length ? (decoded.match(/\uFFFD/g) || []).length / decoded.length : 0;
    const looksLikeText = nullBytes === 0 && replacementRatio < 0.01;
    if (looksLikeText) {
      return { type: 'text', content: decoded, name: file.name, partial: stat.size > bytesRead };
    }
    const ext = path.extname(file.name).toLowerCase();
    return {
      type: 'binary',
      name: file.name,
      ext,
      kind: detectBinaryKind(content, ext),
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      signature: content.subarray(0, 12).toString('hex').toUpperCase().match(/.{1,2}/g)?.join(' ') || '--',
      rows: formatBinaryRows(content.subarray(0, 512))
    };
  } finally {
    fs.closeSync(fd);
  }
}

async function makeFileFingerprint(filePath, stat) {
  // A compact integrity marker lets the archive spot accidental replacement
  // without reading multi-gigabyte media fully during every import.
  const hash = crypto.createHash('sha256');
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const chunkSize = Math.min(stat.size, 1024 * 1024);
    const head = Buffer.alloc(chunkSize);
    if (chunkSize) await handle.read(head, 0, chunkSize, 0);
    hash.update(head);
    if (stat.size > chunkSize) {
      const tail = Buffer.alloc(chunkSize);
      await handle.read(tail, 0, chunkSize, Math.max(0, stat.size - chunkSize));
      hash.update(tail);
    }
    hash.update(String(stat.size));
    hash.update(String(Math.trunc(stat.mtimeMs)));
    return hash.digest('hex');
  } finally { await handle.close(); }
}

/** Imports one real file on disk into the library. Returns the new file
    record, or null if it's not actually a file (e.g. a broken symlink). */
async function importOneFile(originalPath, folderId, unlockedKeys, today, canvasId) {
  const stat = await fs.promises.stat(originalPath);
  if (!stat.isFile()) return null;

  const id = crypto.randomUUID();
  const name = path.basename(originalPath);
  const ext = path.extname(name);
  const canvas = store.data.canvases.find((entry) => entry.id === canvasId) || store.data.canvases[0];
  const archiveDir = canvasStorageDir(canvas);
  await fs.promises.mkdir(archiveDir, { recursive: true });
  const storedPath = path.join(archiveDir, id + ext);
  const sourceFingerprint = await makeFileFingerprint(originalPath, stat);
  try {
    await fs.promises.copyFile(originalPath, storedPath);
    const copiedStat = await fs.promises.stat(storedPath);
    const copiedFingerprint = await makeFileFingerprint(storedPath, copiedStat);
    if (copiedStat.size !== stat.size || copiedFingerprint !== sourceFingerprint) {
      throw new Error('Archived copy integrity verification failed');
    }
  } catch (err) {
    try { await fs.promises.rm(storedPath, { force: true }); } catch (cleanupErr) {}
    throw err;
  }

  const sourceFolder = path.basename(path.dirname(originalPath));
  const classification = classifyArchiveFile(name);
  const sourceDimensions = await readSourceImageDimensions(storedPath, ext);
  const record = {
    id,
    name,
    originalPath,
    storedPath,
    importedAt: new Date().toISOString(),
    sourceFolder,
    sizeBytes: stat.size,
    ...sourceDimensions,
    ...classification,
    fingerprint: sourceFingerprint,
    folderId: folderId || null,
    canvasId: canvas ? canvas.id : null
  };
  store.addFile(record);
  await store.mirrorFileToCustomPathAsync(record);
  if (!store.data.usage.importDays.includes(today)) {
    store.data.usage.importDays.push(today);
  }

  if (achievements.checkFirstImport(store)) unlockedKeys.add('first_import');
  if (achievements.checkLostFolder(store, record)) unlockedKeys.add('lost_folder');

  return record;
}

function appFetch(url, options) {
  if (typeof fetch === 'function') return fetch(url, options);
  return net.fetch(url, options);
}

async function sanitizeImageForAi(input) {
  if (!sharp) {
    const error = new Error('Secure image sanitization is unavailable in this build.');
    error.code = 'privacy-sanitizer-unavailable';
    throw error;
  }
  const source = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (!source.length || source.length > 20 * 1024 * 1024) {
    const error = new Error('The image is empty or exceeds the 20 MB attachment limit.');
    error.code = 'attachment-too-large';
    throw error;
  }
  const buffer = await sharp(source, { failOn: 'error', limitInputPixels: 64 * 1024 * 1024 })
    .rotate()
    .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 84, effort: 3 })
    .toBuffer();
  return `data:image/webp;base64,${buffer.toString('base64')}`;
}

async function fileToSafeAiDataUrl(id) {
  const file = store.getFile(String(id || ''));
  if (!file || !file.storedPath) return null;
  assertSafeLocalFile(file);
  const ext = String(file.ext || path.extname(file.name)).toLowerCase();
  if (!preview.isImageExt(ext)) return null;
  return sanitizeImageForAi(await fs.promises.readFile(file.storedPath));
}

async function resolveAiReferenceUrls(request, fileIdField) {
  const fileIds = Array.isArray(request && request[fileIdField]) ? request[fileIdField] : [];
  const tokens = Array.isArray(request && request.attachmentTokens) ? request.attachmentTokens : [];
  const remoteUrls = Array.isArray(request && request.urls)
    ? request.urls.map(String).filter((value) => /^https:\/\//i.test(value)).slice(0, 4)
    : [];
  const localUrls = (await Promise.all(fileIds.slice(0, 14).map(fileToSafeAiDataUrl))).filter(Boolean);
  const tokenUrls = tokens.slice(0, 4).map((token) => {
    const record = transientAiAttachments.get(String(token || ''));
    if (!record || record.expiresAt <= Date.now()) return null;
    return record.dataUrl;
  }).filter(Boolean);
  return [...localUrls, ...tokenUrls, ...remoteUrls].slice(0, 14);
}

function getAiSecretPath() {
  return path.join(store.dir, 'ai-media-secret.json');
}

function decodeAiSecretRecord(record) {
  if (!record || !record.value) return '';
  try {
    if (record.encrypted && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(record.value, 'base64'));
    }
    if (!record.encrypted) {
      return Buffer.from(record.value, 'base64').toString('utf-8');
    }
  } catch (err) {}
  return '';
}

function encodeAiSecretRecord(value) {
  const encrypted = safeStorage.isEncryptionAvailable();
  const buffer = encrypted ? safeStorage.encryptString(value) : Buffer.from(value, 'utf-8');
  return { encrypted, value: buffer.toString('base64') };
}

function readSavedAiApiKeys() {
  try {
    const payload = JSON.parse(fs.readFileSync(getAiSecretPath(), 'utf-8'));
    if (payload && payload.secrets && typeof payload.secrets === 'object') {
      return Object.fromEntries(
        Object.entries(payload.secrets)
          .map(([id, record]) => [id, decodeAiSecretRecord(record)])
          .filter(([, value]) => value)
      );
    }
    const legacyValue = decodeAiSecretRecord(payload);
    return legacyValue ? { default: legacyValue } : {};
  } catch (err) {}
  return {};
}

function getEnvironmentAiApiKey() {
  return process.env.MESSS_AI_API_KEY || process.env.QUICKROUTER_API_KEY || process.env.QUICK_API_KEY || '';
}

function getSavedAiApiKey(secretId = 'default') {
  const secrets = readSavedAiApiKeys();
  return secrets[secretId] || secrets.default || getEnvironmentAiApiKey();
}

function writeSavedAiApiKeys(secrets) {
  const secretPath = getAiSecretPath();
  const entries = Object.entries(secrets).filter(([, value]) => String(value || '').trim());
  if (!entries.length) {
    try { fs.rmSync(secretPath, { force: true }); } catch (err) {}
    return;
  }
  const tmpPath = secretPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify({
    version: 2,
    secrets: Object.fromEntries(entries.map(([id, value]) => [
      id,
      encodeAiSecretRecord(String(value).trim())
    ]))
  }), 'utf-8');
  fs.renameSync(tmpPath, secretPath);
}

function saveAiApiKey(apiKey, secretId = 'default') {
  const secrets = readSavedAiApiKeys();
  const value = String(apiKey || '').trim();
  if (value) secrets[secretId] = value;
  else delete secrets[secretId];
  writeSavedAiApiKeys(secrets);
}

function clearAllAiApiKeys() {
  try { fs.rmSync(getAiSecretPath(), { force: true }); } catch (err) {}
}

function normalizeProviderEndpoint(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
  } catch (err) {
    return '';
  }
}

function deriveProviderName(endpoint) {
  try {
    const host = new URL(String(endpoint || '').trim()).hostname.toLowerCase();
    if (host.includes('quickrouter')) return 'QuickRouter';
    if (host.includes('openai')) return 'OpenAI';
    if (host.includes('anthropic')) return 'Claude';
    if (host.includes('generativelanguage') || host.includes('googleapis')) return 'Gemini';
    return host.replace(/^api\./, '').split('.')[0]
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase())
      .slice(0, 40) || 'API';
  } catch (err) {
    return 'API';
  }
}

function normalizeImageProviders(value, fallbackEndpoint) {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length: 10 }, (_, index) => {
    const saved = source[index] || {};
    const endpoint = normalizeProviderEndpoint(
      saved.endpoint || (index === 0 ? fallbackEndpoint || DEFAULT_IMAGE_ENDPOINT : '')
    );
    return {
      id: `image-${index + 1}`,
      name: String(saved.name || (index === 0 ? 'QuickRouter GPT Image' : endpoint ? deriveProviderName(endpoint) : '')).trim().slice(0, 40),
      endpoint
    };
  });
}

function normalizeVideoProviders(value, fallbackEndpoint, fallbackName) {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length: 10 }, (_, index) => {
    const saved = source[index] || {};
    const endpoint = normalizeProviderEndpoint(
      saved.endpoint || (index === 0 ? fallbackEndpoint || DEFAULT_VIDEO_ENDPOINT : '')
    );
    return {
      id: `video-${index + 1}`,
      name: String(saved.name || (index === 0 ? fallbackName || 'QuickRouter Sora 2' : endpoint ? deriveProviderName(endpoint) : '')).trim().slice(0, 40),
      endpoint
    };
  });
}

function normalizeChatModels(value, fallbackModel) {
  const source = Array.isArray(value)
    ? value
    : String(value || '').split(/[\n,]+/);
  const models = source
    .map((model) => String(model || '').trim())
    .filter(Boolean)
    .filter((model, index, list) => list.indexOf(model) === index)
    .slice(0, 20);
  if (models.length) return models;
  const fallback = String(fallbackModel || '').trim();
  return fallback ? [fallback] : [];
}

function normalizeChatProviders(value, legacy = {}) {
  const source = Array.isArray(value) ? value : [];
  const hasConfiguredSource = source.some((provider) =>
    provider && String(provider.endpoint || '').trim()
  );
  const legacyEndpoint = normalizeProviderEndpoint(legacy.endpoint);
  const legacyProvider = {
    id: 'chat-1',
    name: String(legacy.name || (legacyEndpoint ? deriveProviderName(legacyEndpoint) : 'OpenAI Compatible')).trim().slice(0, 40) || 'OpenAI Compatible',
    endpoint: legacyEndpoint,
    models: normalizeChatModels(legacy.model, 'gpt-4o-mini')
  };
  const effectiveSource = !hasConfiguredSource && legacyEndpoint ? [legacyProvider] : source;
  return Array.from({ length: 10 }, (_, index) => {
    const saved = effectiveSource[index] || {};
    const endpoint = normalizeProviderEndpoint(saved.endpoint);
    return {
      id: `chat-${index + 1}`,
      name: String(saved.name || (endpoint ? deriveProviderName(endpoint) : '')).trim().slice(0, 40),
      endpoint,
      models: normalizeChatModels(saved.models || saved.model, index === 0 ? 'gpt-4o-mini' : '')
    };
  });
}

function getAiMediaConfig() {
  const saved = store.data.settings.aiMedia || {};
  const imageProviders = normalizeImageProviders(saved.imageProviders, saved.imageEndpoint);
  const configuredProviders = imageProviders.filter((provider) => provider.name && provider.endpoint);
  const activeImageProviderId = configuredProviders.some((provider) => provider.id === saved.activeImageProviderId)
    ? saved.activeImageProviderId
    : (configuredProviders[0] ? configuredProviders[0].id : 'image-1');
  const activeProvider = imageProviders.find((provider) => provider.id === activeImageProviderId) || imageProviders[0];
  const videoProviders = normalizeVideoProviders(
    saved.videoProviders,
    saved.videoEndpoint,
    saved.videoProviderName
  );
  const configuredVideoProviders = videoProviders.filter((provider) => provider.name && provider.endpoint);
  const activeVideoProviderId = configuredVideoProviders.some((provider) => provider.id === saved.activeVideoProviderId)
    ? saved.activeVideoProviderId
    : (configuredVideoProviders[0] ? configuredVideoProviders[0].id : 'video-1');
  const activeVideoProvider = videoProviders.find((provider) => provider.id === activeVideoProviderId) || videoProviders[0];
  const chatProviders = normalizeChatProviders(saved.chatProviders, {
    name: saved.chatProviderName,
    endpoint: saved.chatEndpoint,
    model: saved.chatModel
  });
  const configuredChatProviders = chatProviders.filter((provider) =>
    provider.name && provider.endpoint && provider.models.length
  );
  const activeChatProviderId = configuredChatProviders.some((provider) => provider.id === saved.activeChatProviderId)
    ? saved.activeChatProviderId
    : (configuredChatProviders[0] ? configuredChatProviders[0].id : 'chat-1');
  const activeChatProvider = chatProviders.find((provider) => provider.id === activeChatProviderId) || chatProviders[0];
  const normalized = normalizeAiMediaConfig({
    imageEndpoint: activeProvider.endpoint || DEFAULT_IMAGE_ENDPOINT,
    videoEndpoint: activeVideoProvider.endpoint || DEFAULT_VIDEO_ENDPOINT,
    resultEndpoint: saved.resultEndpoint || DEFAULT_RESULT_ENDPOINT,
    imageSize: saved.imageSize,
    imageAspectRatio: saved.imageAspectRatio,
    videoAspectRatio: saved.videoAspectRatio,
    videoDuration: saved.videoDuration,
    apiKey: getSavedAiApiKey(activeImageProviderId)
  });
  return {
    ...normalized,
    imageProviders,
    activeImageProviderId,
    videoProviders,
    activeVideoProviderId,
    videoProviderName: activeVideoProvider.name || 'QuickRouter Sora 2',
    chatProviders,
    activeChatProviderId,
    chatProviderName: activeChatProvider.name || String(saved.chatProviderName || 'Messs AI').trim().slice(0, 40) || 'Messs AI',
    chatEndpoint: activeChatProvider.endpoint,
    chatModel: activeChatProvider.models[0] || 'gpt-4o-mini'
  };
}

async function getPublicAiMediaConfig() {
  const config = getAiMediaConfig();
  const { apiKey, ...publicConfig } = config;
  const savedKeys = readSavedAiApiKeys();
  const fallbackKey = savedKeys.default || getEnvironmentAiApiKey();
  const hasOwnKey = (id) => !!savedKeys[id];
  const hasUsableKey = (id) => !!(savedKeys[id] || fallbackKey);
  const gatewayMode = Boolean(runtimeConfig && runtimeConfig.gatewayConfigured);
  const cloudSession = supabaseAuth ? supabaseAuth.getPublicSession() : { configured: false, authenticated: false, user: null };
  const result = {
    ...publicConfig,
    gatewayMode,
    cloudConfigured: gatewayMode,
    directAiAllowed: Boolean(runtimeConfig && runtimeConfig.allowDirectAi),
    cloudSession,
    imageProviders: publicConfig.imageProviders.map((provider) => ({
      ...provider,
      hasOwnApiKey: hasOwnKey(provider.id),
      hasApiKey: gatewayMode || hasUsableKey(provider.id)
    })),
    videoProviders: publicConfig.videoProviders.map((provider) => ({
      ...provider,
      hasOwnApiKey: hasOwnKey(provider.id),
      hasApiKey: gatewayMode || hasUsableKey(provider.id)
    })),
    chatProviders: publicConfig.chatProviders.map((provider) => ({
      ...provider,
      hasOwnApiKey: hasOwnKey(provider.id) || (provider.id === 'chat-1' && hasOwnKey('chat')),
      hasApiKey: gatewayMode || hasUsableKey(provider.id) || (provider.id === 'chat-1' && !!(savedKeys.chat || fallbackKey))
    })),
    hasOwnChatApiKey: hasOwnKey('chat'),
    hasChatApiKey: gatewayMode || hasUsableKey('chat'),
    hasApiKey: gatewayMode || !!fallbackKey
  };
  if (!gatewayMode || !cloudSession.authenticated) return result;
  try {
    const remote = await aiGateway.getConfig();
    const providers = Array.isArray(remote && remote.providers) ? remote.providers : [];
    const gatewayEndpoint = runtimeConfig.aiGatewayUrl;
    const cloudProviders = (kind) => providers
      .filter((provider) => provider && provider.kind === kind)
      .slice(0, 10)
      .map((provider) => ({
        id: String(provider.id || '').slice(0, 64),
        name: String(provider.name || provider.id || '').slice(0, 80),
        endpoint: gatewayEndpoint,
        models: Array.isArray(provider.models) ? provider.models.slice(0, 30) : [],
        hasOwnApiKey: false,
        hasApiKey: true,
        cloudManaged: true
      }));
    const imageProviders = cloudProviders('image');
    const videoProviders = cloudProviders('video');
    const chatProviders = cloudProviders('chat');
    return {
      ...result,
      ...(imageProviders.length ? {
        imageProviders,
        activeImageProviderId: imageProviders.some((provider) => provider.id === result.activeImageProviderId)
          ? result.activeImageProviderId
          : imageProviders[0].id
      } : {}),
      ...(videoProviders.length ? {
        videoProviders,
        activeVideoProviderId: videoProviders.some((provider) => provider.id === result.activeVideoProviderId)
          ? result.activeVideoProviderId
          : videoProviders[0].id,
        videoProviderName: videoProviders[0].name
      } : {}),
      ...(chatProviders.length ? {
        chatProviders,
        activeChatProviderId: chatProviders.some((provider) => provider.id === result.activeChatProviderId)
          ? result.activeChatProviderId
          : chatProviders[0].id,
        chatProviderName: chatProviders[0].name,
        chatEndpoint: gatewayEndpoint,
        chatModel: chatProviders[0].models[0] || result.chatModel
      } : {})
    };
  } catch (error) {
    return result;
  }
}

function assertAiTransportReady() {
  if (runtimeConfig && runtimeConfig.gatewayConfigured) return 'gateway';
  if (runtimeConfig && runtimeConfig.allowDirectAi) return 'direct';
  const error = new Error(app.isPackaged
    ? 'This build has no secure AI gateway configured. Configure Railway and rebuild before release.'
    : 'Secure AI is not configured. Set MESSS_AI_GATEWAY_URL and the Supabase publishable key, or set MESSS_ALLOW_DIRECT_AI=1 for local development only.');
  error.code = 'gateway-not-configured';
  throw error;
}

async function generateAiMediaBuffer(kind, prompt, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20 * 60 * 1000);
  try {
    if (assertAiTransportReady() === 'gateway') {
      return await aiGateway.generateMedia(kind, {
        prompt,
        providerId: kind === 'video' ? options.videoProviderId : options.imageProviderId,
        size: options.size,
        aspectRatio: options.aspectRatio,
        sourceWidth: options.sourceWidth,
        sourceHeight: options.sourceHeight,
        duration: options.duration,
        urls: options.urls
      }, controller.signal);
    }
    const config = getAiMediaConfig();
    if (kind !== 'video' && options.imageProviderId) {
      const selected = config.imageProviders.find((provider) =>
        provider.id === options.imageProviderId && provider.name && provider.endpoint
      );
      if (selected) {
        config.imageEndpoint = selected.endpoint;
        config.apiKey = getSavedAiApiKey(selected.id);
      }
    }
    if (kind === 'video' && options.videoProviderId) {
      const selected = config.videoProviders.find((provider) =>
        provider.id === options.videoProviderId && provider.name && provider.endpoint
      );
      if (selected) {
        config.videoEndpoint = selected.endpoint;
        config.apiKey = getSavedAiApiKey(selected.id);
      }
    } else if (kind === 'video') {
      config.apiKey = getSavedAiApiKey(config.activeVideoProviderId);
    }
    return await generateMediaBuffer(
      appFetch,
      config,
      kind === 'video' ? 'video' : 'image',
      { prompt, ...options },
      controller.signal
    );
  } catch (err) {
    if (err && err.name === 'AbortError') {
      const timeoutError = new Error('AI 生成等待超时，请稍后重试。');
      timeoutError.code = 'timeout';
      throw timeoutError;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function generateAiChatReply(prompt, messages, providerId, model) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10 * 60 * 1000);
  try {
    if (assertAiTransportReady() === 'gateway') {
      return await aiGateway.chat({
        prompt,
        messages,
        providerId,
        model
      }, controller.signal);
    }
    const config = getAiMediaConfig();
    const selected = config.chatProviders.find((provider) =>
      provider.id === providerId && provider.name && provider.endpoint
    ) || config.chatProviders.find((provider) =>
      provider.id === config.activeChatProviderId && provider.name && provider.endpoint
    );
    if (selected) {
      config.chatEndpoint = selected.endpoint;
      config.chatProviderName = selected.name;
      config.chatModel = selected.models.includes(String(model || '').trim())
        ? String(model).trim()
        : selected.models[0];
      const savedKeys = readSavedAiApiKeys();
      config.apiKey = savedKeys[selected.id] ||
        (selected.id === 'chat-1' ? savedKeys.chat : '') ||
        savedKeys.default ||
        getEnvironmentAiApiKey();
    } else {
      config.apiKey = getSavedAiApiKey('chat');
    }
    return await requestChat(appFetch, config, { prompt, messages }, controller.signal);
  } catch (err) {
    if (err && err.name === 'AbortError') {
      const timeoutError = new Error('AI 对话等待超时，请稍后重试。');
      timeoutError.code = 'timeout';
      throw timeoutError;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function conciseAiErrorMessage(error, context = {}) {
  const raw = String(error && error.message || '').replace(/\s+/g, ' ').trim();
  if (/no available channel for model|no channel available|model.*not.*available/i.test(raw)) {
    const model = String(context.model || '').trim();
    return model
      ? `当前中转站没有可用于“${model}”的通道。请在设置中保存接口，让软件自动读取可用模型后重新选择。`
      : '当前中转站没有可用的模型通道。请在设置中保存接口，让软件自动读取可用模型后重新选择。';
  }
  if (/\b(?:401|403)\b|invalid api key|unauthorized|authentication/i.test(raw)) {
    return 'API Key 无效、已过期或没有当前模型权限，请检查接口对应的密钥。';
  }
  if (/\b404\b|not found/i.test(raw)) {
    return '接口地址未找到。请填写 API Base URL 或完整请求 URL，软件会自动补全标准路径。';
  }
  if (/returned a webpage|网页而不是 json/i.test(raw)) {
    return '当前地址是网站页面，不是 API。请填写控制台提供的 Base URL 或请求 URL。';
  }
  const taskId = error && error.taskId ? `（任务 ID：${error.taskId}）` : '';
  const message = raw || (context.kind === 'chat' ? 'AI 对话失败，请稍后重试。' : 'AI 生成失败，请稍后重试。');
  return `${message.slice(0, 360)}${taskId}`;
}

function makeGeneratedMediaName(prompt, kind, extension) {
  const clean = (prompt || '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 42);
  const base = clean ? `AI - ${clean}` : (kind === 'video' ? 'AI video' : 'AI image');
  const existingNames = new Set(store.data.files.map((x) => x.name));
  let name = `${base}.${extension}`;
  let n = 2;
  while (existingNames.has(name)) {
    name = `${base} (${n}).${extension}`;
    n += 1;
  }
  return name;
}

function detectGeneratedImageExtension(buffer) {
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 12) === 'ftypavif') {
    return 'avif';
  }
  if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'GIF8') {
    return 'gif';
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'webp';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpg';
  }
  return 'png';
}

function detectGeneratedVideoExtension(buffer) {
  if (buffer.length >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return 'webm';
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {
    return buffer.toString('ascii', 8, 12).trim() === 'qt' ? 'mov' : 'mp4';
  }
  return 'mp4';
}

async function addGeneratedMediaFile(buffer, prompt, folderId, kind, canvasId, request = {}) {
  const id = crypto.randomUUID();
  const mediaKind = kind === 'video' ? 'video' : 'image';
  const extension = mediaKind === 'video'
    ? detectGeneratedVideoExtension(buffer)
    : detectGeneratedImageExtension(buffer);
  const name = makeGeneratedMediaName(prompt, mediaKind, extension);
  const canvas = store.data.canvases.find((entry) => entry.id === canvasId) || store.data.canvases[0];
  const archiveDir = canvasStorageDir(canvas);
  await fs.promises.mkdir(archiveDir, { recursive: true });
  const storedPath = path.join(archiveDir, `${id}.${extension}`);
  await fs.promises.writeFile(storedPath, buffer);
  const sourceDimensions = await readSourceImageDimensions(storedPath, `.${extension}`);
  const referenceFileIds = Array.isArray(request.referenceFileIds)
    ? request.referenceFileIds
      .map((value) => String(value || '').trim())
      .filter((value, index, list) => value && list.indexOf(value) === index)
      .filter((value) => !!store.getFile(value))
      .slice(0, 14)
    : [];
  const referenceCount = Math.max(
    referenceFileIds.length,
    Array.isArray(request.urls) ? Math.min(14, request.urls.length) : 0
  );
  const providerId = mediaKind === 'video'
    ? String(request.videoProviderId || '').trim()
    : String(request.imageProviderId || '').trim();

  const record = {
    id,
    name,
    originalPath: `AI ${mediaKind} generation`,
    storedPath,
    importedAt: new Date().toISOString(),
    sourceFolder: 'AI Generated',
    sizeBytes: buffer.length,
    ...sourceDimensions,
    aiGeneration: {
      kind: mediaKind,
      prompt: String(prompt || '').trim().slice(0, 12000),
      modelName: String(request.modelName || 'AI model').trim().slice(0, 160) || 'AI model',
      providerId: providerId.slice(0, 80) || null,
      aspectRatio: String(request.aspectRatio || 'auto').trim().slice(0, 32) || 'auto',
      size: String(request.size || 'auto').trim().slice(0, 32) || 'auto',
      duration: mediaKind === 'video' ? Math.max(1, Number(request.duration) || 6) : null,
      referenceFileIds,
      referenceCount,
      createdAt: new Date().toISOString()
    },
    folderId: folderId || null,
    canvasId: canvas ? canvas.id : null
  };

  store.addFile(record);
  await store.mirrorFileToCustomPathAsync(record);

  const unlockedKeys = new Set();
  const today = achievements.todayStr();
  if (!store.data.usage.importDays.includes(today)) {
    store.data.usage.importDays.push(today);
  }
  if (achievements.checkFirstImport(store)) unlockedKeys.add('first_import');

  store.scheduleSave();
  if (unlockedKeys.size > 0) notifyAchievements();

  return { record, unlocked: Array.from(unlockedKeys) };
}

function addGeneratedMediaBoardItem(record, request, placement, index) {
  if (!placement || !record) return null;
  const requestedCanvasId = String(placement.canvasId || request.canvasId || record.canvasId || '');
  const canvas = store.data.canvases.find((entry) => entry.id === requestedCanvasId) || store.data.canvases[0];
  if (!canvas) return null;

  const numberOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const width = Math.max(80, Math.min(4096, numberOr(placement.width, 300)));
  const sourceRatio = record.sourceWidth && record.sourceHeight
    ? record.sourceWidth / record.sourceHeight
    : null;
  const ratioMatch = String(placement.aspectRatio || request.aspectRatio || '').match(
    /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/
  );
  const requestedRatio = ratioMatch
    ? Number(ratioMatch[1]) / Math.max(0.0001, Number(ratioMatch[2]))
    : null;
  const ratio = sourceRatio || requestedRatio || (width / Math.max(1, numberOr(placement.height, 220)));
  const id = String(placement.id || '').trim().slice(0, 120) || `b_${crypto.randomUUID()}`;
  const item = {
    id,
    fileId: record.id,
    canvasId: canvas.id,
    x: Math.round(numberOr(placement.x, index * 324)),
    y: Math.round(numberOr(placement.y, 0)),
    width: Math.round(width),
    height: Math.max(1, Math.round(width / ratio)),
    aspectRatio: placement.aspectRatio || request.aspectRatio || 'auto',
    zIndex: Math.round(numberOr(placement.zIndex, store.data.boardItems.length + index + 1)),
    selected: index === 0
  };
  const existingIndex = store.data.boardItems.findIndex((entry) => entry.id === item.id);
  if (existingIndex === -1) store.data.boardItems.push(item);
  else store.data.boardItems[existingIndex] = item;
  return item;
}

/** Quick recursive count of how many files (not folders) live under a
    directory, used to drive the import progress bar before the real
    (slower, copying) pass begins. */
async function countFilesRecursive(dirPath) {
  let count = 0;
  let entries;
  try {
    entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  } catch (err) {
    return 0;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      count += await countFilesRecursive(path.join(dirPath, entry.name));
    } else if (entry.isFile()) {
      count += 1;
    }
  }
  return count;
}

/**
 * Recursively imports a real OS directory: creates a matching Messs folder
 * (nested under parentFolderId if given), imports every file directly
 * inside it into that folder, and recurses into subdirectories so they
 * become nested sub-folders 锟?this is the "second-level menu" behaviour.
 * Collects every folder created and every file imported (at any depth) into
 * the given accumulator arrays, so the caller can hand the renderer a
 * complete picture in one round trip. `onProgress(doneCount)` is called
 * after every file so the renderer can show a progress bar for big imports.
 */
async function importDirectoryRecursive(dirPath, parentFolderId, unlockedKeys, today, createdFolders, importedFiles, progress, canvasId) {
  const folder = {
    id: crypto.randomUUID(),
    name: path.basename(dirPath),
    createdAt: new Date().toISOString(),
    parentId: parentFolderId || null,
    isImported: true // distinguishes "a real OS folder dragged/imported in" from folders the
                      // user builds themselves with the "+" button 锟?see folders.js: imported
                      // folders show up as items in the file list, not in the top folder-list.
  };
  store.data.folders.push(folder);
  createdFolders.push(folder);

  let entries;
  try {
    entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  } catch (err) {
    console.error('Could not read directory', dirPath, err.message);
    return folder;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await importDirectoryRecursive(fullPath, folder.id, unlockedKeys, today, createdFolders, importedFiles, progress, canvasId);
    } else if (entry.isFile()) {
      try {
        const record = await importOneFile(fullPath, folder.id, unlockedKeys, today, canvasId);
        if (record) importedFiles.push(record);
      } catch (err) {
        console.error('Failed to import', fullPath, err.message);
      }
      if (progress) progress.done += 1;
      if (progress && progress.onProgress) progress.onProgress(progress.done, progress.total);
    }
  }

  return folder;
}

/** Shared by both the "import folder" dialog and a real OS-folder drag-drop. */
async function importDirectoryPathAndNotify(dirPath, parentFolderId, canvasId) {
  const unlockedKeys = new Set();
  const today = achievements.todayStr();
  const createdFolders = [];
  const importedFiles = [];

  const total = await countFilesRecursive(dirPath);
  const progress = {
    done: 0,
    total,
    onProgress: (done, totalCount) => {
      if (mainWindow) {
        mainWindow.webContents.send('import:progress', { done, total: totalCount });
      }
    }
  };

  if (mainWindow) mainWindow.webContents.send('import:progress', { done: 0, total });
  const topFolder = await importDirectoryRecursive(dirPath, parentFolderId, unlockedKeys, today, createdFolders, importedFiles, progress, canvasId);
  store.scheduleSave();
  if (unlockedKeys.size > 0) notifyAchievements();
  if (mainWindow) mainWindow.webContents.send('import:progress', { done: total, total, finished: true });

  return {
    topFolder,
    folders: createdFolders,
    files: importedFiles.map(fileToPayload)
  };
}

function registerIpcHandlers() {
  ipcMain.handle('app:getInitialState', async () => {
    pruneMissingFiles();
    await hydrateMissingImageDimensions();
    return {
      theme: store.data.settings.theme,
      language: store.data.settings.language === 'zh' ? 'zh' : 'en',
      viewMode: store.data.settings.viewMode,
      sidebarCollapsed: store.data.settings.sidebarCollapsed,
      defaultFolderName: store.data.settings.defaultFolderName,
      files: store.data.files.map(fileToPayload),
      folders: store.data.folders,
      boardItems: store.data.boardItems,
      canvasProjects: store.data.canvasProjects,
      canvases: store.data.canvases,
      usage: store.data.usage,
      achievements: getAchievementsPayload()
    };
  });

  ipcMain.handle('settings:setTheme', (_evt, theme) => {
    store.data.settings.theme = theme === 'light' ? 'light' : 'dark';
    store.scheduleSave();
    return store.data.settings.theme;
  });

  ipcMain.handle('settings:setLanguage', (_evt, language) => {
    store.data.settings.language = language === 'zh' ? 'zh' : 'en';
    store.scheduleSave();
    return store.data.settings.language;
  });

  ipcMain.handle('auth:getSession', () => supabaseAuth.getPublicSession());

  ipcMain.handle('auth:signIn', async (_evt, credentials = {}) => {
    return supabaseAuth.signIn(credentials.email, credentials.password);
  });

  ipcMain.handle('auth:signUp', async (_evt, credentials = {}) => {
    return supabaseAuth.signUp(credentials.email, credentials.password);
  });

  ipcMain.handle('auth:signOut', () => supabaseAuth.signOut());

  ipcMain.handle('membership:getSnapshot', () => membershipService.getSnapshot());

  ipcMain.handle('membership:checkFeature', (_evt, feature) => {
    return membershipService.checkFeature(String(feature || '').trim());
  });

  ipcMain.handle('settings:getLibraryPaths', () => {
    return {
      defaultPath: store.dir,
      customPath: store.data.settings.customLibraryPath
    };
  });

  ipcMain.handle('settings:pickCustomLibraryPath', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    const chosen = result.filePaths[0];
    await store.setCustomLibraryPath(chosen);
    return chosen;
  });

  ipcMain.handle('settings:clearCustomLibraryPath', async () => {
    await store.setCustomLibraryPath(null);
    return true;
  });

  ipcMain.handle('settings:setViewMode', (_evt, mode) => {
    store.data.settings.viewMode = mode === 'list' ? 'list' : 'grid';
    store.scheduleSave();
    return store.data.settings.viewMode;
  });

  ipcMain.handle('settings:setSidebarCollapsed', (_evt, collapsed) => {
    store.data.settings.sidebarCollapsed = !!collapsed;
    store.scheduleSave();
    return store.data.settings.sidebarCollapsed;
  });

  ipcMain.handle('settings:getAiMediaConfig', () => getPublicAiMediaConfig());

  ipcMain.handle('settings:discoverAiModels', async (_evt, request = {}) => {
    if (runtimeConfig.gatewayConfigured) {
      try {
        return { ok: true, ...(await aiGateway.discoverModels(String(request.providerId || 'chat-1'))) };
      } catch (err) {
        return { ok: false, reason: err.code || 'model-discovery-failed', message: err.message, models: [] };
      }
    }
    if (!runtimeConfig.allowDirectAi) return { ok: false, reason: 'gateway-not-configured', models: [] };
    const endpoint = String(request.endpoint || '').trim();
    if (!endpoint) return { ok: false, reason: 'missing-endpoint', models: [] };
    const apiKey = String(request.apiKey || '').trim() ||
      getSavedAiApiKey(String(request.providerId || 'chat').trim() || 'chat');
    if (!apiKey) return { ok: false, reason: 'missing-api-key', models: [] };
    try {
      const result = await discoverChatModels(appFetch, endpoint, apiKey);
      return { ok: true, ...result };
    } catch (err) {
      return {
        ok: false,
        reason: err && err.code ? err.code : 'model-discovery-failed',
        message: err && err.message ? err.message : '无法自动读取模型列表。',
        models: []
      };
    }
  });

  ipcMain.handle('settings:setAiMediaConfig', (_evt, next = {}) => {
    const imageProviders = normalizeImageProviders(next.imageProviders, next.imageEndpoint);
    const configuredProviders = imageProviders.filter((provider) => provider.name && provider.endpoint);
    const activeImageProviderId = configuredProviders.some((provider) => provider.id === next.activeImageProviderId)
      ? next.activeImageProviderId
      : (configuredProviders[0] ? configuredProviders[0].id : 'image-1');
    const activeProvider = imageProviders.find((provider) => provider.id === activeImageProviderId) || imageProviders[0];
    const videoProviders = normalizeVideoProviders(next.videoProviders, next.videoEndpoint, next.videoProviderName);
    const configuredVideoProviders = videoProviders.filter((provider) => provider.name && provider.endpoint);
    const activeVideoProviderId = configuredVideoProviders.some((provider) => provider.id === next.activeVideoProviderId)
      ? next.activeVideoProviderId
      : (configuredVideoProviders[0] ? configuredVideoProviders[0].id : 'video-1');
    const activeVideoProvider = videoProviders.find((provider) => provider.id === activeVideoProviderId) || videoProviders[0];
    const chatProviders = normalizeChatProviders(next.chatProviders, {
      name: next.chatProviderName,
      endpoint: next.chatEndpoint,
      model: next.chatModel
    });
    const configuredChatProviders = chatProviders.filter((provider) =>
      provider.name && provider.endpoint && provider.models.length
    );
    const activeChatProviderId = configuredChatProviders.some((provider) => provider.id === next.activeChatProviderId)
      ? next.activeChatProviderId
      : (configuredChatProviders[0] ? configuredChatProviders[0].id : 'chat-1');
    const activeChatProvider = chatProviders.find((provider) => provider.id === activeChatProviderId) || chatProviders[0];
    const normalized = normalizeAiMediaConfig({
      imageEndpoint: activeProvider.endpoint || DEFAULT_IMAGE_ENDPOINT,
      videoEndpoint: activeVideoProvider.endpoint || next.videoEndpoint,
      resultEndpoint: next.resultEndpoint,
      imageSize: next.imageSize,
      imageAspectRatio: next.imageAspectRatio,
      videoAspectRatio: next.videoAspectRatio,
      videoDuration: next.videoDuration
    });
    store.data.settings.aiMedia = {
      providerDefaultsVersion: 2,
      imageEndpoint: normalized.imageEndpoint,
      imageProviders,
      activeImageProviderId,
      videoEndpoint: normalized.videoEndpoint,
      videoProviderName: activeVideoProvider.name || 'QuickRouter Sora 2',
      videoProviders,
      activeVideoProviderId,
      chatProviders,
      activeChatProviderId,
      chatProviderName: activeChatProvider.name || 'Messs AI',
      chatEndpoint: activeChatProvider.endpoint,
      chatModel: activeChatProvider.models[0] || 'gpt-4o-mini',
      resultEndpoint: normalized.resultEndpoint,
      imageSize: normalized.imageSize,
      imageAspectRatio: normalized.imageAspectRatio,
      videoAspectRatio: normalized.videoAspectRatio,
      videoDuration: normalized.videoDuration
    };
    if (runtimeConfig.gatewayConfigured) {
      clearAllAiApiKeys();
    } else if (next.clearAllApiKeys) {
      clearAllAiApiKeys();
    } else {
      if (next.clearApiKey) saveAiApiKey('', 'default');
      else if (String(next.apiKey || '').trim()) saveAiApiKey(next.apiKey, 'default');

      if (next.clearChatApiKey) saveAiApiKey('', 'chat');
      else if (String(next.chatApiKey || '').trim()) saveAiApiKey(next.chatApiKey, 'chat');

      const saveProviderKeys = (submittedProviders, normalizedProviders) => {
        const submitted = Array.isArray(submittedProviders) ? submittedProviders : [];
        normalizedProviders.forEach((provider, index) => {
          const source = submitted[index] || {};
          if (source.clearApiKey) saveAiApiKey('', provider.id);
          else if (String(source.apiKey || '').trim()) saveAiApiKey(source.apiKey, provider.id);
        });
      };
      saveProviderKeys(next.imageProviders, imageProviders);
      saveProviderKeys(next.videoProviders, videoProviders);
      saveProviderKeys(next.chatProviders, chatProviders);
    }
    store.scheduleSave();
    return getPublicAiMediaConfig();
  });

  ipcMain.handle('settings:getPreviewToolStatus', async (_evt, forceRefresh) => {
    return preview.getCapabilities(!!forceRefresh);
  });

  ipcMain.handle('window:minimize', () => {
    if (mainWindow) mainWindow.minimize();
    return true;
  });

  ipcMain.handle('window:toggleMaximize', () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return mainWindow.isMaximized();
  });

  ipcMain.handle('window:close', () => {
    if (mainWindow) mainWindow.close();
    return true;
  });

  ipcMain.handle('window:isMaximized', () => {
    return mainWindow ? mainWindow.isMaximized() : false;
  });

  ipcMain.handle('dialog:pickFiles', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections']
    });
    if (result.canceled) return [];
    return result.filePaths;
  });

  ipcMain.handle('ai:preparePastedImage', async (_evt, request = {}) => {
    const match = /^data:image\/(?:png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/i.exec(String(request.dataUrl || ''));
    if (!match) throw Object.assign(new Error('The pasted image format is not supported.'), { code: 'invalid-attachment' });
    const dataUrl = await sanitizeImageForAi(Buffer.from(match[1], 'base64'));
    const token = crypto.randomUUID();
    transientAiAttachments.set(token, { dataUrl, expiresAt: Date.now() + 30 * 60_000 });
    return { token, dataUrl, name: String(request.name || 'Pasted image').slice(0, 160) };
  });

  ipcMain.handle('dialog:pickFolderToImport', async (_evt, canvasId) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return importDirectoryPathAndNotify(result.filePaths[0], null, canvasId);
  });

  ipcMain.handle('folders:importDirectory', (_evt, dirPath, parentFolderId, canvasId) => {
    return importDirectoryPathAndNotify(dirPath, parentFolderId || null, canvasId);
  });

  ipcMain.handle('files:import', async (_evt, filePaths, folderId, canvasId) => {
    const importedNow = [];
    const unlockedKeys = new Set();
    const today = achievements.todayStr();

    for (const originalPath of filePaths) {
      try {
        const record = await importOneFile(originalPath, folderId, unlockedKeys, today, canvasId);
        if (record) importedNow.push(fileToPayload(record));
      } catch (err) {
        console.error('Failed to import', originalPath, err);
      }
    }

    store.scheduleSave();
    if (unlockedKeys.size > 0) notifyAchievements();

    return { imported: importedNow, unlocked: Array.from(unlockedKeys) };
  });

  ipcMain.handle('ai:generateMedia', async (_evt, request = {}) => {
    let safeRequest;
    try {
      const urls = await resolveAiReferenceUrls(request, 'referenceFileIds');
      safeRequest = sanitizeAiRequest({ ...request, urls }, { limit: 14 });
    } catch (err) {
      return { ok: false, reason: err.code || 'privacy-blocked', message: err.message };
    }
    request = safeRequest;
    const prompt = String(request.prompt || '').trim();
    if (!prompt) {
      return { ok: false, reason: 'empty-prompt', message: '请输入生成提示词。' };
    }

    const kind = request.kind === 'video' ? 'video' : 'image';
    const count = kind === 'image' ? Math.max(1, Math.min(4, Number(request.count) || 1)) : 1;
    const usage = membershipService.beginUsage(`ai.${kind}`, {
      metadata: {
        kind,
        requestedCount: count,
        providerId: kind === 'video' ? request.videoProviderId : request.imageProviderId,
        modelName: request.modelName || null,
        aspectRatio: request.aspectRatio || null,
        size: request.size || null,
        duration: kind === 'video' ? Number(request.duration) || null : null,
        referenceCount: Array.isArray(request.urls) ? request.urls.length : 0
      }
    });
    if (!usage.ok) {
      return {
        ok: false,
        reason: usage.reason || 'not-entitled',
        message: store.data.settings.language === 'zh'
          ? '当前会员方案不包含此 AI 功能。'
          : 'This AI feature is not included in the current plan.'
      };
    }

    try {
      const tasks = Array.from({ length: count }, () => generateAiMediaBuffer(kind, prompt, {
        size: request.size,
        aspectRatio: request.aspectRatio,
        sourceWidth: request.sourceWidth,
        sourceHeight: request.sourceHeight,
        duration: request.duration,
        urls: request.urls,
        imageProviderId: request.imageProviderId,
        videoProviderId: request.videoProviderId
      }));
      const settled = await Promise.allSettled(tasks);
      const files = [];
      const boardItems = [];
      const unlockedKeys = new Set();
      for (let index = 0; index < settled.length; index += 1) {
        const result = settled[index];
        if (result.status !== 'fulfilled') continue;
        const added = await addGeneratedMediaFile(
          result.value,
          prompt,
          request.folderId,
          kind,
          request.canvasId,
          request
        );
        files.push(fileToPayload(added.record));
        const boardItem = addGeneratedMediaBoardItem(
          added.record,
          request,
          Array.isArray(request.placements) ? request.placements[index] : null,
          index
        );
        if (boardItem) boardItems.push(boardItem);
        added.unlocked.forEach((key) => unlockedKeys.add(key));
      }
      const failures = settled.filter((result) => result.status === 'rejected');
      if (!files.length) throw failures[0].reason;
      membershipService.finishUsage(usage.usageId, {
        status: failures.length ? 'partial' : 'succeeded',
        resultUnits: files.length,
        failedUnits: failures.length
      });
      store.scheduleSave();
      return {
        ok: true,
        file: files[0],
        files,
        boardItems,
        failedCount: failures.length,
        unlocked: [...unlockedKeys]
      };
    } catch (err) {
      membershipService.finishUsage(usage.usageId, {
        status: 'failed',
        resultUnits: 0,
        failedUnits: count,
        failureCode: err && err.code ? err.code : 'generation-failed'
      });
      console.error('AI media generation failed:', err && err.message ? err.message : err);
      return {
        ok: false,
        reason: err && err.code ? err.code : 'generation-failed',
        message: conciseAiErrorMessage(err, { kind: request.kind })
      };
    }
  });

  ipcMain.handle('ai:chat', async (_evt, request = {}) => {
    let safeRequest;
    try {
      const urls = await resolveAiReferenceUrls(request, 'attachmentFileIds');
      const messages = Array.isArray(request.messages)
        ? request.messages.map((message) => ({ ...message, images: [] }))
        : [];
      const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user');
      if (lastUserMessage && urls.length) lastUserMessage.images = urls;
      safeRequest = sanitizeAiRequest({ ...request, messages, urls: [] }, { limit: 4 });
    } catch (err) {
      return { ok: false, reason: err.code || 'privacy-blocked', message: err.message };
    }
    request = safeRequest;
    const prompt = String(request.prompt || '').trim();
    if (!prompt) return { ok: false, reason: 'empty-prompt', message: '请输入消息。' };
    const usage = membershipService.beginUsage('ai.chat', {
      metadata: {
        providerId: String(request.chatProviderId || '').trim() || null,
        modelName: String(request.chatModel || '').trim() || null,
        messageCount: Array.isArray(request.messages) ? request.messages.length : 0
      }
    });
    if (!usage.ok) {
      return {
        ok: false,
        reason: usage.reason || 'not-entitled',
        message: store.data.settings.language === 'zh'
          ? '当前会员方案不包含 AI 对话。'
          : 'AI chat is not included in the current plan.'
      };
    }

    try {
      const text = await generateAiChatReply(
        prompt,
        request.messages,
        String(request.chatProviderId || '').trim(),
        String(request.chatModel || '').trim()
      );
      membershipService.finishUsage(usage.usageId, {
        status: 'succeeded',
        resultUnits: 1,
        metadata: { responseCharacters: String(text || '').length }
      });
      return { ok: true, text };
    } catch (err) {
      membershipService.finishUsage(usage.usageId, {
        status: 'failed',
        resultUnits: 0,
        failureCode: err && err.code ? err.code : 'chat-failed'
      });
      console.error('AI chat failed:', err && err.message ? err.message : err);
      return {
        ok: false,
        reason: err && err.code ? err.code : 'chat-failed',
        message: conciseAiErrorMessage(err, { kind: 'chat', model: request.chatModel })
      };
    }
  });

  ipcMain.handle('files:transcodeVideo', async (_evt, id) => {
    const f = store.getFile(id);
    if (!f) return { ok: false, reason: 'not-found' };

    const caps = await preview.getCapabilities();
    if (!caps.hasFfmpeg) {
      return { ok: false, reason: 'missing-tools', missingTools: ['FFmpeg'] };
    }

    try {
      await preview.transcodeVideoToWebCompatible(f.storedPath, previewCacheDir, f.id);
      return { ok: true, url: `messs-transcode://${f.id}` };
    } catch (err) {
      console.error('Video transcode failed for', f.name, err.message);
      return { ok: false, reason: 'render-failed' };
    }
  });

  ipcMain.handle('files:transcodeAudio', async (_evt, id) => {
    const f = store.getFile(id);
    if (!f) return { ok: false, reason: 'not-found' };
    const caps = await preview.getCapabilities();
    if (!caps.hasFfmpeg) return { ok: false, reason: 'missing-tools', missingTools: ['FFmpeg'] };
    try {
      await preview.transcodeAudioToWebCompatible(f.storedPath, previewCacheDir, f.id);
      return { ok: true, url: `messs-transcode://${f.id}/audio` };
    } catch (err) {
      console.error('Audio transcode failed for', f.name, err.message);
      return { ok: false, reason: 'render-failed' };
    }
  });

  ipcMain.handle('files:getAudioWaveform', async (_evt, id, barCount) => {
    const f = store.getFile(id);
    if (!f) return { ok: false, reason: 'not-found' };
    const count = Math.max(32, Math.min(128, Number(barCount) || 72));
    try {
      const peaks = await preview.generateAudioWaveform(f.storedPath, previewCacheDir, f.id, count);
      return { ok: true, peaks };
    } catch (err) {
      console.error('Audio waveform generation failed for', f.name, err.message);
      return { ok: false, reason: 'decode-failed' };
    }
  });

  ipcMain.handle('files:getPreview', async (_evt, id) => {
    const f = store.getFile(id);
    if (!f) return { type: 'unsupported', reason: 'not-found' };

    const ext = path.extname(f.name).toLowerCase();
    if (preview.isImageExt(ext)) {
      return { type: 'image', url: 'messs-file://' + f.id, name: f.name };
    }
    if (preview.isVideoExt(ext)) {
      const validation = await preview.validateVideoFile(f.storedPath);
      if (!validation.ok || preview.needsVideoTranscode(ext)) {
        const caps = await preview.getCapabilities();
        if (!caps.hasFfmpeg) return { type: 'unsupported', reason: 'missing-tools', ext, name: f.name, missingTools: ['FFmpeg'] };
        try {
          await preview.transcodeVideoToWebCompatible(f.storedPath, previewCacheDir, f.id);
          return { type: 'video', url: `messs-transcode://${f.id}`, name: f.name, transcoded: true, repairedPreview: !validation.ok };
        } catch (err) {
          console.error('Video preview conversion failed for', f.name, err.message);
          return { type: 'unsupported', reason: 'render-failed', ext, name: f.name };
        }
      }
      return { type: 'video', url: 'messs-file://' + f.id, name: f.name };
    }
    if (preview.isAudioExt(ext)) {
      return { type: 'audio', url: 'messs-file://' + f.id, name: f.name };
    }
    if (preview.isTextExt(ext)) {
      try {
        const content = fs.readFileSync(f.storedPath, 'utf-8');
        return { type: 'text', content, name: f.name };
      } catch (err) {
        return { type: 'unsupported', reason: 'render-failed', ext, name: f.name };
      }
    }

    if (!preview.isPreviewableDocument(ext)) {
      try {
        return buildUnknownFilePreview(f);
      } catch (err) {
        console.error('Universal preview failed for', f.name, err.message);
        return { type: 'unsupported', reason: 'render-failed', ext, name: f.name };
      }
    }

    const caps = await preview.getCapabilities();

    // Direct PDF: rendered by pdfjs-dist in the renderer (see preload.js) 锟?    // no external tool needed at all, just hand back the real file path.
    if (preview.isPdfExt(ext)) {
      return { type: 'pdf-js', path: f.storedPath, name: f.name };
    }

    // Office documents: soffice converts to a (cached) PDF, which then goes
    // through the exact same pdfjs-dist rendering path as a direct PDF.
    if (preview.isOfficeExt(ext)) {
      if (!caps.hasSoffice) {
        return { type: 'unsupported', reason: 'missing-tools', ext, name: f.name, missingTools: ['LibreOffice'] };
      }
      try {
        const cacheDir = path.join(previewCacheDir, f.id);
        const pdfPath = await preview.convertOfficeToPdfCached(f.storedPath, cacheDir, previewTmpDir);
        return { type: 'pdf-js', path: pdfPath, name: f.name };
      } catch (err) {
        console.error('Office->PDF conversion failed for', f.name, err);
        return { type: 'unsupported', reason: 'render-failed', ext, name: f.name };
      }
    }

    // PSD / TIFF: rasterized to a single PNG by ImageMagick / sharp respectively.
    if (preview.isPsdExt(ext) && !caps.hasImageMagick) {
      return { type: 'unsupported', reason: 'missing-tools', ext, name: f.name, missingTools: ['ImageMagick'] };
    }
    try {
      const cacheDir = path.join(previewCacheDir, f.id);
      if (preview.isPsdExt(ext)) await preview.rasterizePsd(f.storedPath, cacheDir);
      else await preview.rasterizeTiff(f.storedPath, cacheDir);
      return { type: 'pages', totalPages: 1, pageUrls: [`messs-preview://${f.id}/1`], name: f.name };
    } catch (err) {
      console.error('Preview render failed for', f.name, err);
      return { type: 'unsupported', reason: 'render-failed', ext, name: f.name };
    }
  });

  ipcMain.handle('files:readDataUrl', async (_evt, id) => {
    return fileToSafeAiDataUrl(id);
  });

  ipcMain.handle('shell:openExternal', (_evt, id) => {
    const f = store.getFile(id);
    if (!f) return false;
    shell.openPath(f.storedPath);
    return true;
  });

  ipcMain.handle('files:search', (_evt, query) => {
    const q = (query || '').trim().toLowerCase();
    const matches = !q
      ? store.data.files
      : store.data.files.filter((f) => f.name.toLowerCase().includes(q));

    let unlockedKey = null;
    if (q && matches.length > 0) {
      // Use the oldest match to evaluate the "find something from a week ago" achievement.
      const oldest = matches.reduce((a, b) =>
        new Date(a.importedAt) < new Date(b.importedAt) ? a : b
      );
      if (achievements.checkDeepSearch(store, oldest)) unlockedKey = 'deep_search';
    }

    if (unlockedKey) {
      store.scheduleSave();
      notifyAchievements();
    }

    return matches.map(fileToPayload);
  });

  ipcMain.handle('files:deletePermanently', (_evt, id) => {
    const f = store.removeFileById(id);
    if (!f) return { ok: false };
    try {
      fs.unlinkSync(f.storedPath);
    } catch (err) {
      /* already gone, ignore */
    }
    fs.promises.rm(path.join(previewCacheDir, f.id), { recursive: true, force: true }).catch(() => {});
    thumbnails.deleteThumbnail(f.id, thumbCacheDir);
    store.data.deletions.push({ id: f.id, name: f.name, importedAt: f.importedAt });
    store.data.boardItems = store.data.boardItems.filter((b) => b.fileId !== id);

    const unlocked = achievements.checkFinalVersion(store, f);
    store.scheduleSave();
    if (unlocked) notifyAchievements();

    return { ok: true, unlocked: unlocked ? 'final_version' : null };
  });

  ipcMain.handle('canvas:saveState', (_evt, payload = {}) => {
    const previous = new Map((Array.isArray(store.data.canvases) ? store.data.canvases : []).map((canvas) => [canvas.id, canvas]));
    const projects = Array.isArray(payload.projects) && payload.projects.length
      ? payload.projects
      : store.data.canvasProjects;
    const canvases = Array.isArray(payload.canvases) && payload.canvases.length
      ? payload.canvases
      : store.data.canvases;
    store.data.canvasProjects = projects.map((project, index) => ({
      id: String(project.id || `project-${index + 1}`),
      name: String(project.name || 'General').trim().slice(0, 80) || 'General',
      createdAt: project.createdAt || new Date().toISOString()
    }));
    store.data.canvases = canvases.map((canvas, index) => ({
      id: String(canvas.id || `canvas-${index + 1}`),
      projectId: String(canvas.projectId || store.data.canvasProjects[0].id),
      name: String(canvas.name || 'Untitled').trim().slice(0, 80) || 'Untitled',
      createdAt: canvas.createdAt || new Date().toISOString(),
      updatedAt: canvas.updatedAt || canvas.createdAt || new Date().toISOString(),
      lastOpenedAt: canvas.lastOpenedAt || null
    }));
    store.data.canvases.forEach((canvas) => {
      const old = previous.get(canvas.id);
      if (old && old.name !== canvas.name) moveCanvasArchive(old, canvas);
      else fs.mkdirSync(canvasStorageDir(canvas), { recursive: true });
    });
    const validCanvasIds = new Set(store.data.canvases.map((canvas) => canvas.id));
    const fallbackCanvasId = store.data.canvases[0].id;
    store.data.boardItems.forEach((item) => {
      if (!validCanvasIds.has(item.canvasId)) item.canvasId = fallbackCanvasId;
    });
    store.scheduleSave();
    return {
      projects: store.data.canvasProjects,
      canvases: store.data.canvases
    };
  });

  ipcMain.handle('canvas:export', async (_evt, canvasId) => {
    const canvas = store.data.canvases.find((entry) => entry.id === canvasId);
    if (!canvas) return { ok: false, reason: 'not-found' };
    const project = store.data.canvasProjects.find((entry) => entry.id === canvas.projectId) || null;
    const boardItems = store.data.boardItems.filter((item) => item.canvasId === canvas.id);
    const fileIds = new Set(boardItems.map((item) => item.fileId).filter(Boolean));
    const files = store.data.files
      .filter((file) => fileIds.has(file.id))
      .map((file) => ({
        id: file.id,
        name: file.name,
        storedPath: file.storedPath,
        originalPath: file.originalPath || null,
        importedAt: file.importedAt,
        sizeBytes: file.sizeBytes,
        sourceWidth: file.sourceWidth || null,
        sourceHeight: file.sourceHeight || null,
        mimeType: file.mimeType || null,
        fingerprint: file.fingerprint || null,
        folderId: file.folderId || null
      }));
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export canvas',
      defaultPath: `${canvasFolderName(canvas.name)}.messs-canvas.json`,
      filters: [{ name: 'Messs Canvas', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    const payload = {
      format: 'messs-canvas',
      version: 1,
      exportedAt: new Date().toISOString(),
      project,
      canvas,
      boardItems,
      files
    };
    await fs.promises.writeFile(result.filePath, JSON.stringify(payload, null, 2), 'utf8');
    return { ok: true, filePath: result.filePath };
  });

  ipcMain.handle('canvas:delete', async (_evt, canvasId) => {
    const canvas = store.data.canvases.find((entry) => entry.id === canvasId);
    if (!canvas) return { ok: false, reason: 'not-found' };
    if (store.data.canvases.length <= 1) return { ok: false, reason: 'last-canvas' };

    const fallback = store.data.canvases.find((entry) => entry.id !== canvas.id);
    const fallbackDir = canvasStorageDir(fallback);
    await fs.promises.mkdir(fallbackDir, { recursive: true });
    const movedFiles = store.data.files.filter((file) => file.canvasId === canvas.id);
    for (const file of movedFiles) {
      if (file.storedPath) {
        const targetPath = path.join(fallbackDir, path.basename(file.storedPath));
        file.storedPath = await moveFilePreservingData(file.storedPath, targetPath);
      }
      file.canvasId = fallback.id;
    }

    store.data.boardItems = store.data.boardItems.filter((item) => item.canvasId !== canvas.id);
    store.data.canvases = store.data.canvases.filter((entry) => entry.id !== canvas.id);
    try {
      await fs.promises.rmdir(canvasStorageDir(canvas));
    } catch (err) {
      // Unknown files in the folder are preserved.
    }
    store.scheduleSave();
    return {
      ok: true,
      fallbackCanvasId: fallback.id,
      projects: store.data.canvasProjects,
      canvases: store.data.canvases
    };
  });

  ipcMain.handle('board:upsertItem', (_evt, item) => {
    if (item && !item.canvasId) item.canvasId = store.data.canvases[0] && store.data.canvases[0].id;
    const idx = store.data.boardItems.findIndex((b) => b.id === item.id);
    if (idx === -1) store.data.boardItems.push(item);
    else store.data.boardItems[idx] = item;
    store.scheduleSave();
    return true;
  });

  ipcMain.handle('board:upsertItems', (_evt, items) => {
    if (!Array.isArray(items) || !items.length) return true;
    const indexById = new Map(store.data.boardItems.map((item, index) => [item.id, index]));
    for (const item of items) {
      if (!item || !item.id) continue;
      if (!item.canvasId) item.canvasId = store.data.canvases[0] && store.data.canvases[0].id;
      const index = indexById.get(item.id);
      if (index === undefined) {
        indexById.set(item.id, store.data.boardItems.length);
        store.data.boardItems.push(item);
      } else {
        store.data.boardItems[index] = item;
      }
    }
    store.scheduleSave();
    return true;
  });

  ipcMain.handle('board:removeItem', (_evt, itemId) => {
    store.data.boardItems = store.data.boardItems.filter((b) => b.id !== itemId);
    store.scheduleSave();
    return true;
  });

  ipcMain.handle('shell:revealFile', (_evt, id) => {
    const f = store.getFile(id);
    if (f) shell.showItemInFolder(f.storedPath);
    return true;
  });

  ipcMain.handle('shell:openInFileManager', (_evt, id) => {
    const f = store.getFile(id);
    if (f) shell.openPath(path.dirname(f.storedPath));
    return true;
  });

  ipcMain.handle('shell:openWithOtherApp', (_evt, id) => {
    const f = store.getFile(id);
    if (!f) return false;
    if (process.platform === 'win32') {
      // Windows has no Electron-level API for the "Open with" picker; this is
      // the standard way to invoke the same dialog Explorer itself shows.
      spawn('rundll32.exe', ['shell32.dll,OpenAs_RunDLL', f.storedPath], { detached: true });
    } else {
      // No exact equivalent on mac/Linux 锟?fall back to revealing the file so
      // the user can right-click it themselves and choose "Open With".
      shell.showItemInFolder(f.storedPath);
    }
    return true;
  });

  ipcMain.handle('clipboard:copyFile', (_evt, id) => {
    const f = store.getFile(id);
    if (!f) return false;
    if (process.platform === 'win32') {
      clipboard.writeBuffer('CF_HDROP', buildCfHDrop([f.storedPath]));
    } else {
      // Cross-platform fallback: at least put the path on the clipboard as text.
      clipboard.writeText(f.storedPath);
    }
    return true;
  });

  ipcMain.handle('clipboard:copyPath', (_evt, id) => {
    const f = store.getFile(id);
    if (!f) return false;
    clipboard.writeText(f.storedPath);
    return true;
  });

  ipcMain.handle('files:duplicate', (_evt, id, targetFolderId) => {
    const f = store.getFile(id);
    if (!f) return { ok: false };

    const ext = path.extname(f.name);
    const base = path.basename(f.name, ext);
    let copyName = `${base} copy${ext}`;
    let n = 2;
    const existingNames = new Set(store.data.files.map((x) => x.name));
    while (existingNames.has(copyName)) {
      copyName = `${base} copy ${n}${ext}`;
      n += 1;
    }

    const newId = crypto.randomUUID();
    const newStoredPath = path.join(path.dirname(f.storedPath), newId + ext);
    try {
      fs.copyFileSync(f.storedPath, newStoredPath);
    } catch (err) {
      return { ok: false };
    }

    const record = {
      id: newId,
      name: copyName,
      originalPath: f.originalPath,
      storedPath: newStoredPath,
      importedAt: new Date().toISOString(),
      sourceFolder: f.sourceFolder,
      sizeBytes: f.sizeBytes,
      sourceWidth: f.sourceWidth || null,
      sourceHeight: f.sourceHeight || null,
      canvasId: f.canvasId || null,
      folderId: targetFolderId !== undefined
        ? (targetFolderId && targetFolderId !== 'default' ? targetFolderId : null)
        : (f.folderId || null)
    };
    store.addFile(record);
    store.mirrorFileToCustomPath(record);
    store.scheduleSave();

    return { ok: true, file: fileToPayload(record) };
  });

  ipcMain.handle('files:moveToTrash', async (_evt, id) => {
    const f = store.removeFileById(id);
    if (!f) return { ok: false };
    try {
      await shell.trashItem(f.storedPath);
    } catch (err) {
      console.error('moveToTrash failed:', err.message);
    }
    fs.promises.rm(path.join(previewCacheDir, f.id), { recursive: true, force: true }).catch(() => {});
    thumbnails.deleteThumbnail(f.id, thumbCacheDir);
    store.data.boardItems = store.data.boardItems.filter((b) => b.fileId !== id);
    store.scheduleSave();
    return { ok: true };
  });

  ipcMain.handle('files:rename', (_evt, id, newName) => {
    const f = store.getFile(id);
    if (!f || !newName || !newName.trim()) return { ok: false };
    f.name = newName.trim();
    store.scheduleSave();
    return { ok: true, file: fileToPayload(f) };
  });

  ipcMain.handle('files:export', async (_evt, id) => {
    const f = store.getFile(id);
    if (!f) return { ok: false };
    const result = await dialog.showSaveDialog(mainWindow, { defaultPath: f.name });
    if (result.canceled || !result.filePath) return { ok: false };
    try {
      fs.copyFileSync(f.storedPath, result.filePath);
      return { ok: true, path: result.filePath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('files:readText', (_evt, id) => {
    const f = store.getFile(id);
    if (!f) return null;
    try {
      return fs.readFileSync(f.storedPath, 'utf-8');
    } catch (err) {
      return null;
    }
  });

  ipcMain.handle('files:saveText', (_evt, id, content) => {
    const f = store.getFile(id);
    if (!f) return { ok: false };
    try {
      fs.writeFileSync(f.storedPath, content, 'utf-8');
      store.mirrorFileToCustomPath(f);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('files:readDocxHtml', async (_evt, id) => {
    const f = store.getFile(id);
    if (!f) return { ok: false };
    try {
      const docxEditor = require('./lib/docx-editor');
      const html = await docxEditor.docxToHtml(f.storedPath);
      return { ok: true, html };
    } catch (err) {
      console.error('readDocxHtml failed:', err.message);
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('files:saveDocx', async (_evt, id, html) => {
    const f = store.getFile(id);
    if (!f) return { ok: false };
    try {
      const docxEditor = require('./lib/docx-editor');
      await docxEditor.htmlToDocx(html, f.storedPath);
      store.mirrorFileToCustomPath(f);
      return { ok: true };
    } catch (err) {
      console.error('saveDocx failed:', err.message);
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('folders:create', (_evt, name, parentId) => {
    const folder = {
      id: crypto.randomUUID(),
      name: name && name.trim() ? name.trim() : (store.data.settings.language === 'zh' ? '新建文件夹' : 'New Folder'),
      createdAt: new Date().toISOString(),
      parentId: parentId || null
    };
    store.data.folders.push(folder);
    store.scheduleSave();
    return folder;
  });

  ipcMain.handle('folders:rename', (_evt, id, newName) => {
    if (!newName || !newName.trim()) return { ok: false };
    if (id === 'default') {
      store.data.settings.defaultFolderName = newName.trim();
      store.scheduleSave();
      return { ok: true, folder: { id: 'default', name: store.data.settings.defaultFolderName } };
    }
    const folder = store.data.folders.find((x) => x.id === id);
    if (!folder) return { ok: false };
    folder.name = newName.trim();
    store.scheduleSave();
    return { ok: true, folder };
  });

  ipcMain.handle('folders:delete', (_evt, id) => {
    if (id === 'default') return false; // The default folder can be renamed but never deleted.
    store.data.folders = store.data.folders.filter((x) => x.id !== id);
    // Files inside the deleted folder become unfiled, not deleted.
    store.data.files.forEach((f) => { if (f.folderId === id) f.folderId = null; });
    store.scheduleSave();
    return true;
  });

  ipcMain.handle('folders:moveFile', (_evt, fileId, folderId) => {
    const f = store.getFile(fileId);
    if (!f) return false;
    f.folderId = (!folderId || folderId === 'default') ? null : folderId;
    store.scheduleSave();
    return true;
  });

  ipcMain.handle('folders:moveInto', (_evt, folderId, destFolderId) => {
    const folder = store.data.folders.find((x) => x.id === folderId);
    if (!folder) return false;
    // A folder can never become its own ancestor.
    let cursor = destFolderId;
    while (cursor) {
      if (cursor === folderId) return false;
      const parent = store.data.folders.find((x) => x.id === cursor);
      cursor = parent ? parent.parentId : null;
    }
    folder.parentId = (!destFolderId || destFolderId === 'default') ? null : destFolderId;
    store.scheduleSave();
    return true;
  });

  ipcMain.handle('folders:reveal', (_evt, folderId) => {
    const sample = store.data.files.find((f) => f.folderId === folderId);
    if (sample) {
      shell.showItemInFolder(sample.storedPath);
    } else {
      shell.openPath(store.libraryDir);
    }
    return true;
  });

  ipcMain.handle('app:checkUnsavedWork', () => {
    // Editors flush every keystroke-debounced save through files:saveText /
    // files:saveDocx, and the JSON index is written synchronously on every
    // mutation 锟?so by the time this is called there is nothing left
    // in-flight on the main-process side. This still gives the renderer one
    // confirmed round-trip to wait on before navigating away.
    store.scheduleSave();
    return { ok: true };
  });

  ipcMain.handle('updater:installNow', () => {
    try {
      autoUpdater.quitAndInstall();
      return { ok: true };
    } catch (err) {
      console.error('quitAndInstall failed:', err.message);
      return { ok: false };
    }
  });

  ipcMain.handle('updater:openReleasesPage', () => {
    const pub = getPublishInfo();
    if (!pub) return false;
    shell.openExternal(`https://github.com/${pub.owner}/${pub.repo}/releases/latest`);
    return true;
  });
}

app.whenReady().then(() => {
  store = createStoreWithFallback();
  membershipService = createMembershipService(store);
  runtimeConfig = loadRuntimeConfig(__dirname, { packaged: app.isPackaged });
  supabaseAuth = new SupabaseAuth({
    fetchImpl: appFetch,
    safeStorage,
    sessionPath: path.join(store.dir, 'cloud-session.bin'),
    supabaseUrl: runtimeConfig.supabaseUrl,
    publishableKey: runtimeConfig.supabasePublishableKey
  });
  aiGateway = new AiGatewayClient({
    fetchImpl: appFetch,
    baseUrl: runtimeConfig.aiGatewayUrl,
    getAccessToken: () => supabaseAuth.getAccessToken()
  });
  if (app.isPackaged && runtimeConfig.gatewayConfigured) clearAllAiApiKeys();
  ensureCanvasState();
  previewCacheDir = path.join(app.getPath('userData'), 'previewCache');
  previewTmpDir = path.join(app.getPath('temp'), 'messs-preview-tmp');
  thumbCacheDir = path.join(app.getPath('userData'), 'thumbCache');

  // In a packaged build, bundled copies of LibreOffice/Poppler/ImageMagick
  // (if present) live under <resources>/tools/. In dev they'd live under
  // the project root's build-resources/tools/ instead. Either way, if no
  // bundled copy is found, preview.js transparently falls back to the
  // system PATH 锟?see lib/preview.js "Bundled-tool resolution".
  preview.configureToolsRoot(app.isPackaged ? process.resourcesPath : path.join(__dirname, 'build-resources'));

  protocol.handle('messs-file', (request) => {
    const id = request.url.replace('messs-file://', '').replace(/\/$/, '');
    const f = store.getFile(id);
    if (!f) return new Response('Not found', { status: 404 });
    try {
      return net.fetch(pathToFileURL(f.storedPath).toString());
    } catch (err) {
      return new Response('Read error', { status: 500 });
    }
  });

  // Small, cached thumbnail instead of the full original 锟?see
  // lib/thumbnails.js for why this matters once a library has many files.
  // Falls back to serving the original file whenever a thumbnail can't be
  // made (non-image, sharp missing, generation error), so a missing
  // thumbnail never means a missing image.
  protocol.handle('messs-thumb', async (request) => {
    const id = request.url.replace('messs-thumb://', '').replace(/\/$/, '');
    const f = store.getFile(id);
    if (!f) return new Response('Not found', { status: 404 });
    const ext = path.extname(f.name).toLowerCase();
    try {
      const thumbPath = await thumbnails.getOrCreateThumbnail(f.storedPath, f.id, thumbCacheDir, ext);
      const servePath = thumbPath || f.storedPath;
      return net.fetch(pathToFileURL(servePath).toString());
    } catch (err) {
      return new Response('Read error', { status: 500 });
    }
  });

  protocol.handle('messs-preview', (request) => {
    // URL shape: messs-preview://<fileId>/<pageNumber> 锟?serves whichever of
    // page-<n>.png / page-<n>.jpg exists (PSD/TIFF produce .png via
    // ImageMagick/sharp; nothing produces .jpg anymore now that Poppler is
    // gone, but both are checked for safety / forward-compatibility).
    const rest = request.url.replace('messs-preview://', '');
    const [fileId, pageStr] = rest.split('/');
    const pageNumber = parseInt(pageStr, 10);
    if (!fileId || !pageNumber || pageNumber < 1) {
      return new Response('Bad request', { status: 400 });
    }
    const candidates = ['png', 'jpg'].map((ext) => path.join(previewCacheDir, fileId, `page-${pageNumber}.${ext}`));
    const imagePath = candidates.find((p) => fs.existsSync(p));
    if (!imagePath) return new Response('Not found', { status: 404 });
    try {
      return net.fetch(pathToFileURL(imagePath).toString());
    } catch (err) {
      return new Response('Read error', { status: 500 });
    }
  });

  protocol.handle('messs-transcode', (request) => {
    // URL shape: messs-transcode://<fileId> 锟?serves the cached, already
    // web-compatible MP4 produced by transcodeVideoToWebCompatible.
    const rest = request.url.replace('messs-transcode://', '').replace(/\/$/, '');
    const [fileId, variant] = rest.split('/');
    const mediaPath = path.join(previewCacheDir, fileId, variant === 'audio' ? 'transcoded.m4a' : 'transcoded.mp4');
    if (!fs.existsSync(mediaPath)) return new Response('Not found', { status: 404 });
    try {
      return net.fetch(pathToFileURL(mediaPath).toString());
    } catch (err) {
      return new Response('Read error', { status: 500 });
    }
  });

  registerIpcHandlers();
  createWindow();
  startSession();
  runDailyDesktopChecks();
  setTimeout(setupAutoUpdater, 3000); // give the window time to paint first.

  // Re-check desktop-dependent achievements roughly every hour the app stays open,
  // so a long-running session still catches a day rollover.
  setInterval(runDailyDesktopChecks, 60 * 60 * 1000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (usageTickInterval) clearInterval(usageTickInterval);
  if (store) store.flushSync();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (store) store.flushSync();
});

setInterval(() => {
  const now = Date.now();
  for (const [token, record] of transientAiAttachments) {
    if (record.expiresAt <= now) transientAiAttachments.delete(token);
  }
}, 5 * 60_000).unref();
