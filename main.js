'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, Menu, Tray, Notification, clipboard, safeStorage, desktopCapturer, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const dns = require('dns');
const nodeNet = require('net');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const { autoUpdater } = require('electron-updater');

const { Store } = require('./lib/store');
const { createMembershipService } = require('./lib/membership-service');
const achievements = require('./lib/achievements');
const preview = require('./lib/preview');
const thumbnails = require('./lib/thumbnails');
const { getDefaultLibraryRoot } = require('./lib/storage-paths');
const { buildCfHDrop, parseCfHDrop } = require('./lib/clipboard-files');
const {
  extractClipboardImageSources,
  clipboardSourceToLocalPath,
  normalizeClipboardRemoteUrl,
  isPrivateNetworkAddress
} = require('./lib/clipboard-images');
const {
  DEFAULT_IMAGE_ENDPOINT,
  DEFAULT_VIDEO_ENDPOINT,
  DEFAULT_RESULT_ENDPOINT,
  normalizeConfig: normalizeAiMediaConfig,
  generateMediaBuffer
} = require('./lib/ai-media-provider');
const { requestChat, discoverChatModels } = require('./lib/ai-chat-provider');
const { PROVIDER_CATALOG_VERSION, providerCatalog } = require('./lib/provider-catalog');
const { loadRuntimeConfig } = require('./lib/runtime-config');
const { SupabaseAuth, createPkcePair } = require('./lib/supabase-auth');
const { AiGatewayClient, assertValidGlbBuffer } = require('./lib/ai-gateway-client');
const { normalizeGatewayCatalog, assertGatewayProvider } = require('./lib/gateway-catalog');
const { assertSafeLocalFile, assertPromptHasNoSecrets, sanitizeAiRequest } = require('./lib/privacy-guard');
const { activate: activateApp, getActivationStatus } = require('./lib/activation');
const { quoteMediaCredits, publicCreditPricing } = require('./lib/credit-pricing');
const { launchAdobeMedia } = require('./lib/adobe-launcher');
const { ChatService } = require('./lib/chat-service');
const { probeVideoMetadata, shutdownProcesses: shutdownMediaMetadataProcesses } = require('./lib/media-metadata');
const { authenticatedUserId, profileAvatarPath } = require('./lib/profile-avatar');
const { normalizeLanguage, translate: translateLanguage } = require('./lib/i18n');
const { createLocalFileResponse } = require('./lib/local-file-response');

const DEFAULT_CATALOG_IMAGE = providerCatalog('image')[0];
const DEFAULT_CATALOG_VIDEO = providerCatalog('video')[0];
const DEFAULT_CATALOG_CHAT = providerCatalog('chat')[0];
const AI_IMAGE_SIZES = new Set([
  '1K', '2K', '4K', 'Default', 'adaptive', 'original',
  '1024x1024', '1536x1024', '1024x1536', 'auto',
  '512x512', '720p', '1080p'
]);
const AI_IMAGE_QUALITIES = new Set(['low', 'medium', 'high', 'auto']);
const AI_IMAGE_RATIOS = new Set([
  'auto', '1:1', '16:9', '9:16', '4:3', '3:4',
  '3:2', '2:3', '5:4', '4:5', '21:9',
  '16:10', '10:16', '2:1', '1:2'
]);
const MINIMAX_TEXT_VIDEO_RATIOS = new Set(['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']);
const MINIMAX_VIDEO_RESOLUTIONS = new Set(['768P', '2K']);
const AI_VIDEO_CAMERA_PRESETS = Object.freeze({
  camera: Object.freeze({
    'arri-alexa-65': 'ARRI Alexa 65 large-format digital cinema camera',
    'arri-alexa-mini-lf': 'ARRI Alexa Mini LF digital cinema camera',
    'sony-venice-2': 'Sony VENICE 2 full-frame cinema camera',
    'red-v-raptor-xl': 'RED V-RAPTOR XL cinema camera',
    'blackmagic-ursa-12k': 'Blackmagic URSA Mini Pro 12K cinema camera'
  }),
  lens: Object.freeze({
    'cooke-panchro': 'Cooke Panchro/i Classic prime lens, gentle vintage falloff',
    'arri-signature-prime': 'ARRI Signature Prime lens, clean large-format rendering',
    'zeiss-supreme-prime': 'ZEISS Supreme Prime lens, controlled contrast and smooth bokeh',
    'leica-summilux-c': 'Leica Summilux-C cinema lens, natural contrast and dimensional rendering',
    'angenieux-optimo': 'Angenieux Optimo cinema zoom lens, refined cinematic rendering'
  }),
  focalLength: Object.freeze({
    '24mm': '24mm wide-angle focal length',
    '35mm': '35mm focal length',
    '50mm': '50mm normal focal length',
    '85mm': '85mm portrait focal length',
    '125mm': '125mm telephoto focal length',
    '200mm': '200mm long telephoto focal length'
  }),
  aperture: Object.freeze({
    'f1.4': 'f/1.4 aperture, very shallow depth of field',
    f2: 'f/2 aperture, shallow depth of field',
    'f2.8': 'f/2.8 aperture, cinematic subject separation',
    f4: 'f/4 aperture, balanced depth of field',
    'f5.6': 'f/5.6 aperture, deep controlled focus'
  }),
  motion: Object.freeze({
    static: 'locked-off static camera',
    'pan-up': 'smooth camera pan up',
    'pan-down': 'smooth camera pan down',
    'pan-left': 'smooth camera pan left',
    'pan-right': 'smooth camera pan right',
    'tilt-up': 'smooth camera tilt up',
    'tilt-down': 'smooth camera tilt down',
    'tilt-left': 'smooth camera tilt left',
    'tilt-right': 'smooth camera tilt right',
    'zoom-in': 'controlled optical zoom in',
    'zoom-out': 'controlled optical zoom out',
    'roll-clockwise': 'subtle clockwise camera roll',
    'roll-anticlockwise': 'subtle anticlockwise camera roll'
  })
});
const AI_VIDEO_CAMERA_DEFAULTS = Object.freeze({
  enabled: false,
  camera: 'arri-alexa-65',
  lens: 'cooke-panchro',
  focalLength: '125mm',
  aperture: 'f1.4',
  motion: 'static'
});
const PUBLIC_RELEASE = Object.freeze({
  provider: 'github',
  owner: 'a1804927460-bot',
  repo: 'messs-releases'
});
const WINDOW_BACKGROUND_COLORS = Object.freeze({
  dark: '#080A0D',
  light: '#FFFFFF'
});

function normalizeTheme(theme) {
  return theme === 'light' ? 'light' : 'dark';
}

function currentLanguage() {
  return normalizeLanguage(store && store.data && store.data.settings && store.data.settings.language);
}

function localizedMessage(en, zh, ko) {
  const language = currentLanguage();
  if (language === 'zh') return zh;
  return translateLanguage(language, en, ko);
}

function setWindowBackgroundColor(theme) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setBackgroundColor(WINDOW_BACKGROUND_COLORS[normalizeTheme(theme)]);
}

function revealMainWindow() {
  if ((!mainWindow || mainWindow.isDestroyed()) && app.isReady() && store) createWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

const qaRemoteDebugPort = String(process.env.MESSS_QA_REMOTE_DEBUG_PORT || '').trim();
if (/^\d{4,5}$/.test(qaRemoteDebugPort)) {
  app.commandLine.appendSwitch('remote-debugging-port', qaRemoteDebugPort);
}

if (process.env.MESSS_DISABLE_GPU === '1') {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  app.commandLine.appendSwitch('in-process-gpu');
}

if (process.env.MESSS_USER_DATA_DIR && path.isAbsolute(process.env.MESSS_USER_DATA_DIR)) {
  app.setPath('userData', path.resolve(process.env.MESSS_USER_DATA_DIR));
}

let sharp;
try { sharp = require('sharp'); } catch (err) { sharp = null; }

// Removes the default File/Edit/View/... menu bar everywhere (Windows/Linux's
// per-window menu bar and macOS's global app menu) so only Messs.'s own UI shows.
Menu.setApplicationMenu(null);

protocol.registerSchemesAsPrivileged([
  { scheme: 'messs-file', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: 'messs-preview', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: 'messs-thumb', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: 'messs-transcode', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

let mainWindow;
let tray;
let isQuitting = false;
const activeNotifications = new Set();
let store;
let membershipService;
let runtimeConfig;
let supabaseAuth;
let chatService;
let aiGateway;
let gatewayCatalogCache = null;
let gatewayAccountCache = null;
let gatewayAccountCacheExpiresAt = 0;
let gatewayAccountSyncPromise = null;
let gatewayAccountSyncGeneration = 0;
let gatewayAccountRetryAfter = 0;
let usageTickInterval;
let previewCacheDir;
let previewTmpDir;
let thumbCacheDir;
let updateCheckInterval;
let updateInstallStarted = false;
let googleOAuthPromise;
let updaterState = {
  enabled: true,
  status: 'idle',
  currentVersion: app.getVersion(),
  availableVersion: null,
  progress: null,
  message: null
};
const transientAiAttachments = new Map();
const butlerImageTasks = new Map();
const butlerImageDownloads = new Map();
const butler3dTasks = new Map();
const butler3dDownloads = new Map();
const butlerVideoTasks = new Map();
const butlerVideoDownloads = new Map();
const MAX_BUTLER_IMAGE_BYTES = Math.floor(7.5 * 1024 * 1024);
const MAX_BUTLER_VIDEO_BYTES = 48 * 1024 * 1024;
const MAX_BUTLER_VIDEO_OUTPUT_BYTES = 256 * 1024 * 1024;
const MAX_BUTLER_PREVIEW_BYTES = 16 * 1024 * 1024;
const MAX_MODEL_PREVIEW_BYTES = 256 * 1024 * 1024;
const MAX_CLIPBOARD_IMAGE_BYTES = 64 * 1024 * 1024;
const MAX_CLIPBOARD_PNG_BYTES = 160 * 1024 * 1024;
const MODEL_FILE_EXTENSIONS = new Set(['.glb', '.fbx', '.obj']);
const MODEL_PREVIEW_CACHE_VERSION = 'pbr-v3';
const MODEL_PREVIEW_MARKER_FILENAME = `model-preview.${MODEL_PREVIEW_CACHE_VERSION}`;
const BUTLER_IMAGE_TOOL_IDS = new Set([
  'qwen-image-edit-plus',
  'qwen-image-layered',
  'super-upscale-v2',
  'erase',
  'topaz-image-sharpen',
  'topaz-image-sharpen-gen',
  'topaz-image-enhance',
  'topaz-image-enhance-gen',
  'topaz-image-denoise',
  'topaz-image-restore',
  'topaz-image-lighting'
]);
const BUTLER_IMAGE_TOOL_CREDITS = Object.freeze({
  'qwen-image-edit-plus': 2,
  'qwen-image-layered': 1,
  'super-upscale-v2': 2,
  erase: 1
});
const BUTLER_VIDEO_TOOL_ID = 'topaz-video-upscale';
const BUTLER_VIDEO_MIME_BY_EXTENSION = Object.freeze({
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska'
});

function writeStartupDiagnostic(stage, detail = '') {
  const diagnosticPath = String(process.env.MESSS_DIAGNOSTIC_LOG || '').trim();
  if (!diagnosticPath || !path.isAbsolute(diagnosticPath)) return;
  try {
    fs.appendFileSync(diagnosticPath, `${stage}${detail ? `: ${detail}` : ''}\n`, 'utf8');
  } catch (error) {}
}

writeStartupDiagnostic('main-loaded');

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
  return PUBLIC_RELEASE;
}

function notifyUpdateDownloaded(info) {
  setUpdaterState({
    status: 'downloaded',
    availableVersion: info && info.version || null,
    progress: 100,
    message: null
  });
  if (mainWindow) {
    mainWindow.webContents.send('updater:downloaded', { version: info.version });
  }
}

function publicUpdaterState() {
  return { ...updaterState, packaged: app.isPackaged };
}

function setUpdaterState(patch) {
  updaterState = { ...updaterState, ...patch };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater:status', publicUpdaterState());
  }
  return publicUpdaterState();
}

async function checkForUpdates(manual = false) {
  if (!app.isPackaged) return setUpdaterState({ status: 'development', message: null });
  if (!manual && !updaterState.enabled) return publicUpdaterState();
  setUpdaterState({ status: 'checking', progress: null, message: null });
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    console.error('checkForUpdates failed:', err.message);
    setUpdaterState({ status: 'error', message: String(err.message || 'Update check failed.') });
  }
  return publicUpdaterState();
}

function checkForUpdatesQuietly() {
  // Update checks fail for plenty of benign reasons (offline, no release
  // published yet, unsigned mac build, rate limits) 锟?never surface these
  // as user-facing errors, just log for our own debugging.
  return checkForUpdates(false);
}

function setupAutoUpdater() {
  updaterState.enabled = store.data.settings.autoUpdateEnabled !== false;
  autoUpdater.autoDownload = updaterState.enabled;
  // A per-machine NSIS update needs elevation. Installing silently during an
  // ordinary quit can leave the app closed with no feedback when UAC is
  // cancelled or the installer cannot start, so installation is explicit.
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.autoRunAppAfterInstall = true;
  const publishInfo = getPublishInfo();
  if (publishInfo) {
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: publishInfo.owner,
      repo: publishInfo.repo,
      private: false
    });
  }

  autoUpdater.on('checking-for-update', () => setUpdaterState({ status: 'checking', message: null }));
  autoUpdater.on('update-available', (info) => setUpdaterState({
    status: updaterState.enabled ? 'downloading' : 'available',
    availableVersion: info && info.version || null,
    progress: 0,
    message: null
  }));
  autoUpdater.on('update-not-available', () => setUpdaterState({
    status: 'up-to-date', availableVersion: null, progress: null, message: null
  }));
  autoUpdater.on('download-progress', (progress) => setUpdaterState({
    status: 'downloading',
    progress: Math.max(0, Math.min(100, Number(progress && progress.percent) || 0)),
    message: null
  }));
  autoUpdater.on('update-downloaded', notifyUpdateDownloaded);
  autoUpdater.on('error', (err) => {
    console.error('Auto-update error:', err == null ? err : err.message);
    setUpdaterState({ status: 'error', message: String(err && err.message || 'Update failed.') });
  });

  if (!app.isPackaged) {
    setUpdaterState({ status: 'development' });
    return;
  }
  if (updaterState.enabled) checkForUpdatesQuietly();
  updateCheckInterval = setInterval(checkForUpdatesQuietly, 4 * 60 * 60 * 1000);
}

function oauthResponseHtml(success, message) {
  const title = success ? 'Messs login complete' : 'Messs login failed';
  const safeMessage = String(message || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${title}</title><style>body{font:16px system-ui;background:#111318;color:#f5f6f8;display:grid;place-items:center;min-height:100vh;margin:0}.box{max-width:480px;padding:32px;text-align:center}h1{font-size:22px}p{color:#a8adb7;line-height:1.6}</style></head><body><div class="box"><h1>${title}</h1><p>${safeMessage}</p></div></body></html>`;
}

function signInWithGoogle() {
  if (googleOAuthPromise) return googleOAuthPromise;
  googleOAuthPromise = new Promise((resolve, reject) => {
    const { verifier, challenge } = createPkcePair();
    const callbackNonce = crypto.randomBytes(24).toString('base64url');
    let settled = false;
    let timeout;
    const finish = (error, session) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      server.close();
      googleOAuthPromise = null;
      if (error) reject(error); else resolve(session);
    };
    const server = http.createServer(async (request, response) => {
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      try {
        const requestUrl = new URL(request.url, 'http://127.0.0.1');
        if (request.method !== 'GET' || requestUrl.pathname !== `/oauth/callback/${callbackNonce}`) {
          response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          response.end('Not found');
          return;
        }
        const oauthError = requestUrl.searchParams.get('error_description') || requestUrl.searchParams.get('error');
        const code = requestUrl.searchParams.get('code');
        if (oauthError || !code) throw new Error(oauthError || 'Google did not return an authorization code.');
        const session = await supabaseAuth.exchangeOAuthCode(code, verifier);
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(oauthResponseHtml(true, 'You can close this window and return to Messs.'));
        finish(null, session);
      } catch (error) {
        response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(oauthResponseHtml(false, error.message));
        finish(error);
      }
    });
    server.on('error', (error) => finish(error));
    server.listen(0, '127.0.0.1', async () => {
      try {
        const address = server.address();
        const redirectTo = `http://127.0.0.1:${address.port}/oauth/callback/${callbackNonce}`;
        const authorizeUrl = supabaseAuth.getOAuthAuthorizeUrl('google', redirectTo, challenge);
        await shell.openExternal(authorizeUrl);
      } catch (error) {
        finish(error);
      }
    });
    timeout = setTimeout(() => {
      const error = new Error('Google login timed out. Please try again.');
      error.code = 'oauth-timeout';
      finish(error);
    }, 5 * 60 * 1000);
  });
  return googleOAuthPromise;
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
  const initialTheme = normalizeTheme(store && store.data && store.data.settings && store.data.settings.theme);
  const initialLanguage = currentLanguage();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    icon: app.isPackaged ? process.execPath : path.join(__dirname, 'build-resources', 'icon.png'),
    // Match Chromium's first paint to the persisted theme so Windows never
    // exposes a differently colored native surface during startup.
    backgroundColor: WINDOW_BACKGROUND_COLORS[initialTheme],
    frame: false, // We draw our own top bar (see src/index.html #app-titlebar) so it
                   // always matches the app's theme instead of the OS's default chrome.
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // Do not expose a half-localized, non-interactive renderer. The renderer
  // signals as soon as its controls are bound; the timeout is only a fallback.
  mainWindow.webContents.once('did-fail-load', revealMainWindow);
  mainWindow.webContents.once('did-finish-load', () => setTimeout(revealMainWindow, 8_000));
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'), {
    query: { theme: initialTheme, language: initialLanguage }
  });
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
  mainWindow.on('close', (event) => {
    if (isQuitting || updateInstallStarted) return;
    event.preventDefault();
    mainWindow.hide();
  });

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
    sourceDuration: Number.isFinite(Number(f.sourceDuration)) ? Number(f.sourceDuration) : null,
    mediaMetadataVersion: Number(f.mediaMetadataVersion) || null,
    videoPreviewReady: f.videoPreviewReady === true,
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
      quality: f.aiGeneration.quality || null,
      resolution: f.aiGeneration.resolution || null,
      duration: f.aiGeneration.duration,
      requestedDuration: f.aiGeneration.requestedDuration || null,
      videoMode: f.aiGeneration.videoMode || null,
      cameraControl: f.aiGeneration.kind === 'video'
        ? normalizeVideoCameraControl(f.aiGeneration.cameraControl)
        : null,
      referenceFileIds: Array.isArray(f.aiGeneration.referenceFileIds)
        ? [...f.aiGeneration.referenceFileIds]
        : [],
      referenceMediaTypes: Array.isArray(f.aiGeneration.referenceMediaTypes)
        ? [...f.aiGeneration.referenceMediaTypes]
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
    thumbUrl: 'messs-thumb://' + f.id,
    ...(MODEL_FILE_EXTENSIONS.has(ext) ? { modelPreviewUrl: `messs-preview://${f.id}/model` } : {})
  };
}

async function installDownloadedUpdate() {
  if (updateInstallStarted) return { ok: true, installing: true };
  if (updaterState.status !== 'downloaded') return { ok: false, reason: 'not-downloaded' };

  updateInstallStarted = true;
  isQuitting = true;
  setUpdaterState({ status: 'installing', progress: 100, message: null });
  if (updateCheckInterval) clearInterval(updateCheckInterval);
  if (usageTickInterval) clearInterval(usageTickInterval);
  preview.shutdownProcesses();
  thumbnails.shutdownProcesses();
  shutdownMediaMetadataProcesses();
  if (store) store.flushSync();

  if (chatService) {
    await Promise.race([
      chatService.close().catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 1_500))
    ]);
  }

  // Keep the assisted installer visible so elevation or installer failures
  // cannot look like the app simply uninstalled itself. With a non-silent
  // install electron-updater uses autoRunAppAfterInstall to restart Messs.
  autoUpdater.quitAndInstall(false, false);
  return { ok: true, installing: true };
}

async function readSourceMediaMetadata(filePath, ext) {
  const normalizedExt = String(ext || '').toLowerCase();
  if (preview.isVideoExt(normalizedExt)) {
    return probeVideoMetadata(filePath);
  }
  if (sharp && preview.isImageExt(normalizedExt)) {
    try {
      const metadata = await sharp(filePath, { failOn: 'none' }).metadata();
      const autoWidth = Number(metadata.autoOrient && metadata.autoOrient.width);
      const autoHeight = Number(metadata.autoOrient && metadata.autoOrient.height);
      let width = autoWidth > 0 ? autoWidth : Number(metadata.width);
      let height = autoHeight > 0 ? autoHeight : Number(metadata.height);
      if (!(autoWidth > 0 && autoHeight > 0) && [5, 6, 7, 8].includes(Number(metadata.orientation))) {
        [width, height] = [height, width];
      }
      if (!(width > 0 && height > 0)) return null;
      return { sourceWidth: width, sourceHeight: height };
    } catch (err) {
      return null;
    }
  }
  return null;
}

async function hydrateMissingMediaMetadata() {
  const candidates = store.data.files.filter((file) => {
    const ext = String(file.ext || path.extname(file.name)).toLowerCase();
    const isVideo = preview.isVideoExt(ext);
    const isImage = preview.isImageExt(ext);
    const missingDimensions = !(Number(file.sourceWidth) > 0 && Number(file.sourceHeight) > 0);
    // Earlier releases only probed still images. Re-probe video records once
    // so old requested-ratio cards are corrected to the actual display size.
    return (missingDimensions || (isVideo && file.mediaMetadataVersion !== 1)) &&
      (isImage || isVideo) && file.storedPath;
  });
  if (!candidates.length) return;

  let cursor = 0;
  const worker = async () => {
    while (cursor < candidates.length) {
      const file = candidates[cursor++];
      const dimensions = await readSourceMediaMetadata(
        file.storedPath,
        file.ext || path.extname(file.name)
      );
      if (dimensions) Object.assign(file, dimensions);
      if (dimensions && preview.isVideoExt(String(file.ext || path.extname(file.name)).toLowerCase())) {
        file.mediaMetadataVersion = 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, candidates.length) }, worker));
  store.scheduleSave();
}

const MIME_BY_EXTENSION = {
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown',
  '.json': 'application/json', '.csv': 'text/csv', '.zip': 'application/zip',
  '.7z': 'application/x-7z-compressed', '.rar': 'application/vnd.rar',
  '.tar': 'application/x-tar', '.gz': 'application/gzip',
  '.glb': 'model/gltf-binary', '.fbx': 'model/vnd.autodesk.fbx', '.obj': 'model/obj'
};
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  isQuitting = true;
  app.quit();
} else {
  app.on('second-instance', revealMainWindow);
}

function trayIconPath() {
  const packaged = path.join(__dirname, 'src', 'assets', 'logo-mark.png');
  const development = path.join(__dirname, 'build-resources', 'icon.png');
  return app.isPackaged && fs.existsSync(packaged) ? packaged : development;
}

function updateTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: localizedMessage('Show Messs', '显示 Messs', 'Messs 열기'), click: revealMainWindow },
    { type: 'separator' },
    {
      label: localizedMessage('Quit Messs', '退出 Messs', 'Messs 종료'),
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]));
}

function createTray() {
  if (tray && !tray.isDestroyed()) return tray;
  tray = new Tray(trayIconPath());
  tray.setToolTip('Messs');
  tray.on('click', revealMainWindow);
  updateTrayMenu();
  return tray;
}

function chatNotificationText(detail) {
  if (detail.kind === 'image') return localizedMessage('[Image]', '[图片]', '[이미지]');
  if (detail.kind === 'file') {
    return detail.fileName
      ? localizedMessage(`File: ${detail.fileName}`, `文件：${detail.fileName}`, `파일: ${detail.fileName}`)
      : localizedMessage('[File]', '[文件]', '[파일]');
  }
  const body = String(detail.body || '').replace(/\s+/g, ' ').trim();
  return body.length > 120 ? `${body.slice(0, 117)}...` : body;
}

function showIncomingChatNotification(payload) {
  const detail = payload && payload.detail || {};
  if (!detail.incoming || !Notification.isSupported()) return;
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()
    && !mainWindow.isMinimized() && mainWindow.isFocused()) return;
  const conversations = payload.state && payload.state.conversations || [];
  const conversation = conversations.find((item) => item.id === detail.conversationId);
  const sender = conversation && conversation.other && conversation.other.displayName
    || localizedMessage('New message', '新消息', '새 메시지');
  const notification = new Notification({
    title: sender,
    body: chatNotificationText(detail),
    icon: trayIconPath(),
    silent: false
  });
  activeNotifications.add(notification);
  const release = () => activeNotifications.delete(notification);
  notification.once('close', release);
  notification.once('failed', release);
  notification.on('click', () => {
    release();
    revealMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('chat:openConversation', detail.conversationId);
    }
  });
  notification.show();
}
const ARCHIVE_EXTENSIONS = new Set(['.zip', '.7z', '.rar', '.tar', '.gz', '.bz2', '.xz', '.zst', '.iso', '.dmg', '.img']);

function classifyArchiveFile(name) {
  const ext = path.extname(name).toLowerCase();
  const mimeType = MIME_BY_EXTENSION[ext]
    || (preview.isImageExt(ext) ? `image/${ext.slice(1)}` : preview.isVideoExt(ext) ? `video/${ext.slice(1)}` : preview.isAudioExt(ext) ? `audio/${ext.slice(1)}` : 'application/octet-stream');
  const archiveKind = ARCHIVE_EXTENSIONS.has(ext) ? 'archive'
    : preview.isImageExt(ext) ? 'image' : preview.isVideoExt(ext) ? 'video'
      : preview.isAudioExt(ext) ? 'audio' : preview.isTextExt(ext) ? 'text'
        : preview.isPreviewableDocument(ext) ? 'document'
          : MODEL_FILE_EXTENSIONS.has(ext) ? 'model' : 'file';
  return { mimeType, archiveKind };
}

function localMediaMimeType(filePath, fallback = 'application/octet-stream') {
  const ext = path.extname(filePath).toLowerCase();
  return BUTLER_VIDEO_MIME_BY_EXTENSION[ext] || ({
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.flac': 'audio/flac',
    '.ogg': 'audio/ogg',
    '.opus': 'audio/opus'
  })[ext] || fallback;
}

function localFileProtocolResponse(request, filePath, mimeType) {
  return createLocalFileResponse(request, filePath, mimeType || localMediaMimeType(filePath));
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
    const decodedResult = preview.decodeTextBuffer(content);
    const decoded = decodedResult.text;
    const replacementRatio = decoded.length ? (decoded.match(/\uFFFD/g) || []).length / decoded.length : 0;
    const controlRatio = decoded.length
      ? (decoded.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length / decoded.length
      : 0;
    const looksLikeText = nullBytes === 0 && replacementRatio < 0.03 && controlRatio < 0.02;
    if (looksLikeText) {
      return {
        type: 'text', content: decoded, encoding: decodedResult.encoding,
        name: file.name, partial: stat.size > bytesRead
      };
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

async function readArchivedModelData(fileId) {
  const normalizedId = String(fileId || '').trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(normalizedId)) {
    const error = new Error('The selected 3D model could not be found.');
    error.code = 'file-not-found';
    throw error;
  }
  const file = store.getFile(normalizedId);
  const extension = String(file && (file.ext || path.extname(file.name)) || '').trim().toLowerCase();
  if (!file || !file.storedPath || !MODEL_FILE_EXTENSIONS.has(extension)) {
    const error = new Error('Only GLB, FBX, and OBJ models can be previewed.');
    error.code = file ? 'unsupported-model-format' : 'file-not-found';
    throw error;
  }

  let archivedPath;
  let archivedStat;
  try {
    const [libraryRoot, sourcePath, sourceStat] = await Promise.all([
      fs.promises.realpath(store.libraryDir),
      fs.promises.realpath(file.storedPath),
      fs.promises.lstat(file.storedPath)
    ]);
    const relative = path.relative(libraryRoot, sourcePath);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || !relative ||
        relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
      const error = new Error('Only archived library models can be previewed.');
      error.code = 'privacy-blocked';
      throw error;
    }
    if (sourceStat.size <= 0 || sourceStat.size > MAX_MODEL_PREVIEW_BYTES) {
      const error = new Error('This 3D model is too large to preview safely.');
      error.code = 'model-too-large';
      throw error;
    }
    archivedPath = sourcePath;
    archivedStat = sourceStat;
  } catch (cause) {
    if (cause && ['privacy-blocked', 'model-too-large'].includes(cause.code)) throw cause;
    const error = new Error('The archived 3D model could not be read.');
    error.code = 'file-not-found';
    throw error;
  }

  const buffer = await fs.promises.readFile(archivedPath);
  const currentStat = await fs.promises.lstat(archivedPath);
  if (!currentStat.isFile() || currentStat.isSymbolicLink() ||
      currentStat.size !== archivedStat.size || buffer.length !== archivedStat.size) {
    const error = new Error('The 3D model changed while it was being loaded.');
    error.code = 'model-changed';
    throw error;
  }
  return {
    format: extension.slice(1),
    name: file.name,
    data: buffer
  };
}

async function saveArchivedModelPreview(fileId, dataUrl) {
  if (!sharp) {
    const error = new Error('3D thumbnail rendering is unavailable.');
    error.code = 'model-preview-unavailable';
    throw error;
  }
  const normalizedId = String(fileId || '').trim();
  const file = /^[A-Za-z0-9_-]{1,128}$/.test(normalizedId) ? store.getFile(normalizedId) : null;
  const extension = String(file && (file.ext || path.extname(file.name)) || '').trim().toLowerCase();
  if (!file || !MODEL_FILE_EXTENSIONS.has(extension)) {
    const error = new Error('The selected 3D model could not be found.');
    error.code = 'file-not-found';
    throw error;
  }
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(dataUrl || ''));
  if (!match || match[1].length > 12 * 1024 * 1024) {
    const error = new Error('The 3D thumbnail is invalid.');
    error.code = 'invalid-model-preview';
    throw error;
  }
  const source = Buffer.from(match[1], 'base64');
  if (!source.length || source.length > 8 * 1024 * 1024) {
    const error = new Error('The 3D thumbnail is too large.');
    error.code = 'invalid-model-preview';
    throw error;
  }
  const cacheDir = path.join(previewCacheDir, normalizedId);
  const outputPath = path.join(cacheDir, 'model-preview.png');
  const pbrMarkerPath = path.join(cacheDir, MODEL_PREVIEW_MARKER_FILENAME);
  const temporaryPath = path.join(cacheDir, `.model-preview-${crypto.randomUUID()}.tmp.png`);
  await fs.promises.mkdir(cacheDir, { recursive: true });
  try {
    await sharp(source, { failOn: 'error', limitInputPixels: 8 * 1024 * 1024 })
      .resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(temporaryPath);
    await fs.promises.rename(temporaryPath, outputPath);
    await fs.promises.writeFile(pbrMarkerPath, `${MODEL_PREVIEW_CACHE_VERSION}\n`, { encoding: 'utf8', mode: 0o600 });
  } finally {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
  }
  return `messs-preview://${normalizedId}/model?v=${Date.now()}`;
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
  const sourceDimensions = await readSourceMediaMetadata(storedPath, ext);
  const record = {
    id,
    name,
    originalPath,
    storedPath,
    importedAt: new Date().toISOString(),
    sourceFolder,
    sizeBytes: stat.size,
    ...sourceDimensions,
    ...(sourceDimensions && preview.isVideoExt(String(ext).toLowerCase()) ? { mediaMetadataVersion: 1 } : {}),
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
  const source = Buffer.isBuffer(input) ? input : String(input || '');
  if ((Buffer.isBuffer(source) && !source.length) || (!Buffer.isBuffer(source) && !source)) {
    const error = new Error('The image is empty.');
    error.code = 'invalid-attachment';
    throw error;
  }
  // Local files are passed to sharp by path so even very large originals are
  // decoded as a stream instead of being copied wholesale into Node memory.
  // The generated attachment is bounded by dimensions, not source file size.
  const pipeline = sharp(source, {
    failOn: 'error',
    limitInputPixels: 512 * 1024 * 1024,
    sequentialRead: true
  })
    .rotate();
  const targets = [
    { edge: 2048, quality: 84 },
    { edge: 1792, quality: 72 },
    { edge: 1536, quality: 62 },
    { edge: 1280, quality: 54 },
    { edge: 1024, quality: 48 },
    { edge: 768, quality: 42 }
  ];
  let buffer = null;
  for (const target of targets) {
    buffer = await pipeline.clone()
      .resize({ width: target.edge, height: target.edge, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: target.quality, effort: 3 })
      .toBuffer();
    // Fourteen references still remain below the transport's 20 MB ceiling.
    if (buffer.length <= 1_250_000) break;
  }
  return `data:image/webp;base64,${buffer.toString('base64')}`;
}

async function fileToSafeAiDataUrl(id) {
  const file = store.getFile(String(id || ''));
  if (!file || !file.storedPath) return null;
  assertSafeLocalFile(file);
  const ext = String(file.ext || path.extname(file.name)).toLowerCase();
  if (!preview.isImageExt(ext)) return null;
  return sanitizeImageForAi(file.storedPath);
}

function orientedImageDimensions(metadata) {
  let width = Number(metadata && metadata.width) || 0;
  let height = Number(metadata && metadata.height) || 0;
  if ([5, 6, 7, 8].includes(Number(metadata && metadata.orientation))) {
    [width, height] = [height, width];
  }
  return { width, height };
}

async function sanitizeImageForButler(input, options = {}) {
  if (!sharp) {
    const error = new Error('Secure image sanitization is unavailable in this build.');
    error.code = 'privacy-sanitizer-unavailable';
    throw error;
  }
  const source = Buffer.isBuffer(input) ? input : String(input || '');
  if ((Buffer.isBuffer(source) && !source.length) || (!Buffer.isBuffer(source) && !source)) {
    const error = new Error('The image is empty.');
    error.code = 'invalid-butler-image';
    throw error;
  }

  const sharpOptions = {
    failOn: 'error',
    limitInputPixels: 512 * 1024 * 1024,
    sequentialRead: true
  };
  let metadata;
  try {
    metadata = await sharp(source, sharpOptions).metadata();
  } catch (cause) {
    const error = new Error('The selected file is not a valid image.');
    error.code = 'invalid-butler-image';
    throw error;
  }
  const dimensions = orientedImageDimensions(metadata);
  if (!(dimensions.width > 0 && dimensions.height > 0)) {
    const error = new Error('The selected image dimensions are invalid.');
    error.code = 'invalid-butler-image';
    throw error;
  }

  let scale = Math.min(1, 5000 / Math.max(dimensions.width, dimensions.height));
  if (options.requireModelDimensions && Math.min(dimensions.width, dimensions.height) * scale < 128) {
    scale = 128 / Math.min(dimensions.width, dimensions.height);
    if (Math.max(dimensions.width, dimensions.height) * scale > 5000) {
      const error = new Error('The image aspect ratio is outside the supported 3D range.');
      error.code = 'unsupported-image-dimensions';
      throw error;
    }
  }

  const baseWidth = Math.max(1, Math.round(dimensions.width * scale));
  const baseHeight = Math.max(1, Math.round(dimensions.height * scale));
  const attempts = [
    { ratio: 1, quality: 94 },
    { ratio: 1, quality: 84 },
    { ratio: 1, quality: 72 },
    { ratio: 0.82, quality: 82 },
    { ratio: 0.66, quality: 76 },
    { ratio: 0.5, quality: 70 },
    { ratio: 0.38, quality: 62 }
  ];
  const pipeline = sharp(source, sharpOptions).rotate().flatten({ background: '#ffffff' });
  for (const attempt of attempts) {
    const width = Math.max(1, Math.round(baseWidth * attempt.ratio));
    const height = Math.max(1, Math.round(baseHeight * attempt.ratio));
    if (options.requireModelDimensions && Math.min(width, height) < 128) continue;
    const buffer = await pipeline.clone()
      .resize({ width, height, fit: 'fill' })
      .jpeg({ quality: attempt.quality, chromaSubsampling: '4:4:4', mozjpeg: true })
      .toBuffer();
    if (buffer.length <= MAX_BUTLER_IMAGE_BYTES) {
      return `data:image/jpeg;base64,${buffer.toString('base64')}`;
    }
  }
  const error = new Error('The sanitized image still exceeds the Butler upload size limit.');
  error.code = 'butler-image-too-large';
  throw error;
}

async function butlerSourceImage(fileId, options = {}) {
  const normalizedId = String(fileId || '').trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(normalizedId)) {
    const error = new Error('The selected image could not be found.');
    error.code = 'file-not-found';
    throw error;
  }
  const file = store.getFile(normalizedId);
  if (!file || !file.storedPath) {
    const error = new Error('The selected image could not be found.');
    error.code = 'file-not-found';
    throw error;
  }
  let archivedPath;
  try {
    const [libraryRoot, sourcePath, sourceStat] = await Promise.all([
      fs.promises.realpath(store.libraryDir),
      fs.promises.realpath(file.storedPath),
      fs.promises.lstat(file.storedPath)
    ]);
    const relative = path.relative(libraryRoot, sourcePath);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || !relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
      const error = new Error('Only archived library images can be sent to Butler.');
      error.code = 'privacy-blocked';
      throw error;
    }
    archivedPath = sourcePath;
  } catch (cause) {
    if (cause && cause.code === 'privacy-blocked') throw cause;
    const error = new Error('The archived image could not be read safely.');
    error.code = 'file-not-found';
    throw error;
  }
  assertSafeLocalFile(file);
  const ext = String(file.ext || path.extname(file.name)).toLowerCase();
  if (!preview.isImageExt(ext)) {
    const error = new Error('Butler requires an image file.');
    error.code = 'unsupported-file-type';
    throw error;
  }
  return {
    file,
    imageDataUrl: await sanitizeImageForButler(archivedPath, options)
  };
}

function validateButlerVideoBuffer(buffer, mimeType) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12 || buffer.length > MAX_BUTLER_VIDEO_OUTPUT_BYTES) {
    const error = new Error('The selected video is invalid or exceeds the supported size.');
    error.code = buffer && buffer.length > MAX_BUTLER_VIDEO_OUTPUT_BYTES ? 'media-too-large' : 'invalid-butler-video';
    throw error;
  }
  const isIsoMedia = buffer.toString('ascii', 4, 8) === 'ftyp';
  const isEbml = buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3;
  const expectsEbml = mimeType === 'video/webm' || mimeType === 'video/x-matroska';
  if ((!isIsoMedia && !isEbml) || (expectsEbml && !isEbml) || (!expectsEbml && !isIsoMedia)) {
    const error = new Error('The selected video container is not supported.');
    error.code = 'invalid-butler-video';
    throw error;
  }
  return true;
}

function evenVideoDimension(value) {
  return Math.max(128, Math.round(Number(value) / 2) * 2);
}

function normalizeButlerVideoOptions(metadata, requested = {}) {
  const sourceWidth = Math.round(Number(metadata && metadata.sourceWidth));
  const sourceHeight = Math.round(Number(metadata && metadata.sourceHeight));
  if (!(sourceWidth > 0 && sourceHeight > 0) || sourceWidth > 7680 || sourceHeight > 7680 || sourceWidth * sourceHeight > 33_177_600) {
    const error = new Error('The source video dimensions are outside the supported range.');
    error.code = 'unsupported-video-dimensions';
    throw error;
  }
  const input = requested && typeof requested === 'object' && !Array.isArray(requested) ? requested : {};
  const requestedOutput = input.output && typeof input.output === 'object' && !Array.isArray(input.output)
    ? input.output
    : {};
  const requestedResolution = requestedOutput.resolution && typeof requestedOutput.resolution === 'object'
    ? requestedOutput.resolution
    : {};
  const portrait = sourceHeight > sourceWidth;
  const defaultBounds = portrait ? { width: 2160, height: 3840 } : { width: 3840, height: 2160 };
  const boundWidth = Math.max(128, Math.min(7680, Math.round(Number(requestedResolution.width) || defaultBounds.width)));
  const boundHeight = Math.max(128, Math.min(7680, Math.round(Number(requestedResolution.height) || defaultBounds.height)));
  let scale = Math.max(1, Math.min(boundWidth / sourceWidth, boundHeight / sourceHeight));
  scale = Math.max(scale, 128 / sourceWidth, 128 / sourceHeight);
  const width = evenVideoDimension(sourceWidth * scale);
  const height = evenVideoDimension(sourceHeight * scale);
  if (width > 7680 || height > 7680 || width * height > 33_177_600) {
    const error = new Error('The requested video output exceeds the 8K safety limit.');
    error.code = 'unsupported-video-dimensions';
    throw error;
  }
  const frameRate = Math.max(1, Math.min(240, Math.round(Number(requestedOutput.frameRate) || 30)));
  const videoEncoder = [
    'AV1', 'FFV1', 'H264', 'H265', 'ProRes', 'QuickTime Animation', 'QuickTime R210', 'QuickTime V210', 'VP9'
  ].includes(String(requestedOutput.videoEncoder || '').trim())
    ? String(requestedOutput.videoEncoder).trim()
    : 'H264';
  const requestedFilters = Array.isArray(input.filters) ? input.filters.slice(0, 2) : [];
  const allowedFilterModels = new Set([
    'aaa-9', 'ahq-12', 'alq-13', 'alqs-2', 'amq-13', 'amqs-2', 'ddv-3',
    'dtd-4', 'dtds-2', 'dtv-4', 'dtvs-2', 'gcg-5', 'ghq-5', 'iris-2',
    'iris-3', 'nxf-1', 'nyx-3', 'prob-4', 'rhea-1', 'rxl-1', 'thd-3',
    'thf-4', 'thm-2'
  ]);
  const filters = (requestedFilters.length ? requestedFilters : [{ model: 'prob-4' }]).map((filter) => {
    const source = filter && typeof filter === 'object' && !Array.isArray(filter) ? filter : {};
    const model = String(source.model || 'prob-4').trim().toLowerCase();
    if (!allowedFilterModels.has(model)) {
      const error = new Error('The selected Topaz enhancement model is not supported.');
      error.code = 'invalid-video-tool-options';
      throw error;
    }
    const normalized = { model };
    if (['Progressive', 'Interlaced', 'ProgressiveInterlaced'].includes(source.videoType)) normalized.videoType = source.videoType;
    if (['Auto', 'Manual', 'Relative'].includes(source.auto)) normalized.auto = source.auto;
    if (['TopFirst', 'BottomFirst', 'Auto'].includes(source.fieldOrder)) normalized.fieldOrder = source.fieldOrder;
    if (['None', 'Normal', 'Strong'].includes(source.focusFixLevel)) normalized.focusFixLevel = source.focusFixLevel;
    const ranges = {
      compression: [-1, 1], details: [-1, 1], prenoise: [0, 0.1], noise: [-1, 1],
      halo: [-1, 1], preblur: [-1, 1], blur: [-1, 1], grain: [0, 0.1],
      grainSize: [0, 5], recoverOriginalDetailValue: [0, 1], slowmo: [1, 16],
      fps: [15, 240], duplicateThreshold: [0.001, 0.1]
    };
    Object.entries(ranges).forEach(([key, [minimum, maximum]]) => {
      if (source[key] === undefined || source[key] === null || source[key] === '') return;
      const value = Number(source[key]);
      if (Number.isFinite(value)) normalized[key] = Math.max(minimum, Math.min(maximum, value));
    });
    if (source.duplicate !== undefined) normalized.duplicate = source.duplicate === true;
    return normalized;
  });
  const audioCodec = ['AAC', 'AC3', 'PCM'].includes(String(requestedOutput.audioCodec || '').toUpperCase())
    ? String(requestedOutput.audioCodec).toUpperCase()
    : 'AAC';
  let audioTransfer = ['Copy', 'Convert', 'None'].includes(String(requestedOutput.audioTransfer || ''))
    ? String(requestedOutput.audioTransfer)
    : 'Copy';
  if (metadata && metadata.hasAudio === false) audioTransfer = 'None';
  const dynamicCompressionLevel = ['Low', 'Mid', 'High'].includes(String(requestedOutput.dynamicCompressionLevel || ''))
    ? String(requestedOutput.dynamicCompressionLevel)
    : 'High';
  const container = ['mp4', 'mov', 'mkv'].includes(String(requestedOutput.container || '').toLowerCase())
    ? String(requestedOutput.container).toLowerCase()
    : 'mp4';
  const compatibleContainer = ['ProRes', 'QuickTime Animation', 'QuickTime R210', 'QuickTime V210'].includes(videoEncoder)
    ? 'mov'
    : ['VP9', 'FFV1'].includes(videoEncoder) ? 'mkv' : container;
  return {
    modelId: BUTLER_VIDEO_TOOL_ID,
    filters,
    output: {
      resolution: { width, height },
      frameRate,
      audioCodec,
      audioTransfer,
      videoEncoder,
      ...(['H264', 'H265'].includes(videoEncoder) ? {
        videoProfile: String(requestedOutput.videoProfile || (videoEncoder === 'H264' ? 'High' : 'Main')).trim().slice(0, 64)
      } : {}),
      dynamicCompressionLevel,
      cropToFit: requestedOutput.cropToFit === true,
      container: compatibleContainer
    },
    sourceDuration: Math.max(0, Math.min(21_600, Number(metadata && metadata.sourceDuration) || 0))
  };
}

async function butlerSourceVideo(fileId, requestedOptions = {}) {
  const normalizedId = String(fileId || '').trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(normalizedId)) {
    const error = new Error('The selected video could not be found.');
    error.code = 'file-not-found';
    throw error;
  }
  const file = store.getFile(normalizedId);
  if (!file || !file.storedPath) {
    const error = new Error('The selected video could not be found.');
    error.code = 'file-not-found';
    throw error;
  }
  let archivedPath;
  let archivedStat;
  try {
    const [libraryRoot, sourcePath, sourceStat] = await Promise.all([
      fs.promises.realpath(store.libraryDir),
      fs.promises.realpath(file.storedPath),
      fs.promises.lstat(file.storedPath)
    ]);
    const relative = path.relative(libraryRoot, sourcePath);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || !relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
      const error = new Error('Only archived library videos can be sent to Butler.');
      error.code = 'privacy-blocked';
      throw error;
    }
    if (sourceStat.size <= 0 || sourceStat.size > MAX_BUTLER_VIDEO_BYTES) {
      const error = new Error('The selected video exceeds the Butler upload size limit.');
      error.code = 'butler-video-too-large';
      throw error;
    }
    archivedPath = sourcePath;
    archivedStat = sourceStat;
  } catch (cause) {
    if (cause && ['privacy-blocked', 'butler-video-too-large'].includes(cause.code)) throw cause;
    const error = new Error('The archived video could not be read safely.');
    error.code = 'file-not-found';
    throw error;
  }
  assertSafeLocalFile(file);
  const extension = String(file.ext || path.extname(file.name)).toLowerCase();
  const mimeType = BUTLER_VIDEO_MIME_BY_EXTENSION[extension];
  if (!mimeType) {
    const error = new Error('Butler video enhancement requires MP4, MOV, WebM, or Matroska video.');
    error.code = 'unsupported-video-type';
    throw error;
  }
  const buffer = await fs.promises.readFile(archivedPath);
  const currentStat = await fs.promises.lstat(archivedPath);
  if (!currentStat.isFile() || currentStat.isSymbolicLink() || currentStat.size !== archivedStat.size || buffer.length !== archivedStat.size) {
    const error = new Error('The archived video changed while it was being prepared.');
    error.code = 'invalid-butler-video';
    throw error;
  }
  validateButlerVideoBuffer(buffer, mimeType);
  const probed = await probeVideoMetadata(archivedPath);
  const metadata = {
    sourceWidth: Number(probed && probed.sourceWidth) || Number(file.sourceWidth) || 0,
    sourceHeight: Number(probed && probed.sourceHeight) || Number(file.sourceHeight) || 0,
    sourceDuration: Number(probed && probed.sourceDuration) || Number(file.sourceDuration) || 0,
    hasAudio: probed && typeof probed.hasAudio === 'boolean' ? probed.hasAudio : null
  };
  const toolOptions = normalizeButlerVideoOptions(metadata, requestedOptions);
  return {
    file,
    metadata,
    toolOptions: { ...toolOptions, sourceMime: mimeType },
    videoBuffer: buffer
  };
}

function normalizeButlerPreviewUrl(value) {
  try {
    const url = new URL(String(value || ''));
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || url.hash) return '';
    const is302File = host === 'file.302.ai' || host.endsWith('.file.302.ai');
    const isTencentCos = host.endsWith('.cos.myqcloud.com')
      || /\.cos\.[a-z0-9-]+\.myqcloud\.com$/.test(host)
      || host.endsWith('.tencentcos.cn')
      || /\.cos\.[a-z0-9-]+\.tencentcos\.cn$/.test(host);
    return is302File || isTencentCos ? url.toString() : '';
  } catch (error) {
    return '';
  }
}

async function readBoundedFetchBuffer(response, maximumBytes) {
  const declaredLength = Number(response.headers && response.headers.get && response.headers.get('content-length')) || 0;
  if (declaredLength > maximumBytes) throw new Error('preview-too-large');
  if (!response.body || typeof response.body[Symbol.asyncIterator] !== 'function') {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maximumBytes) throw new Error('preview-too-large');
    return buffer;
  }
  const chunks = [];
  let received = 0;
  for await (const chunk of response.body) {
    const part = Buffer.from(chunk);
    received += part.length;
    if (received > maximumBytes) {
      try { await response.body.cancel(); } catch (error) {}
      throw new Error('preview-too-large');
    }
    chunks.push(part);
  }
  return Buffer.concat(chunks, received);
}

function clipboardImageError(message, code = 'clipboard-image-unavailable') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function clipboardDataImageBuffer(value) {
  const source = String(value || '').trim();
  if (!source || source.length > Math.ceil(MAX_CLIPBOARD_IMAGE_BYTES * 4 / 3) + 4096) return null;
  const match = /^data:image\/[a-z0-9.+-]+(?:;charset=[^;,]+)?(;base64)?,([\s\S]+)$/i.exec(source);
  if (!match) return null;
  let buffer;
  try {
    if (match[1]) {
      const encoded = match[2].replace(/\s+/g, '');
      buffer = Buffer.from(encoded, 'base64');
      if (!encoded || buffer.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) return null;
    } else {
      buffer = Buffer.from(decodeURIComponent(match[2]), 'utf8');
    }
  } catch (error) {
    return null;
  }
  return buffer.length > 0 && buffer.length <= MAX_CLIPBOARD_IMAGE_BYTES ? buffer : null;
}

async function canonicalClipboardPng(input) {
  if (!sharp) throw clipboardImageError('Image decoding is unavailable in this build.', 'clipboard-decoder-unavailable');
  const source = Buffer.isBuffer(input) ? input : String(input || '');
  if ((Buffer.isBuffer(source) && (!source.length || source.length > MAX_CLIPBOARD_IMAGE_BYTES)) || !source) {
    throw clipboardImageError('The clipboard image is empty or too large.', 'clipboard-image-too-large');
  }
  try {
    const pipeline = sharp(source, {
      failOn: 'error',
      limitInputPixels: 256 * 1024 * 1024,
      sequentialRead: true,
      pages: 1
    }).rotate();
    const metadata = await pipeline.metadata();
    const dimensions = orientedImageDimensions(metadata);
    if (!(dimensions.width > 0 && dimensions.height > 0)) throw new Error('invalid-dimensions');
    const png = await pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
    if (!png.length || png.length > MAX_CLIPBOARD_PNG_BYTES) {
      throw clipboardImageError('The clipboard image is too large to import.', 'clipboard-image-too-large');
    }
    return { png, dimensions };
  } catch (cause) {
    if (cause && cause.code && String(cause.code).startsWith('clipboard-')) throw cause;
    throw clipboardImageError('The copied content could not be decoded as an image.', 'invalid-clipboard-image');
  }
}

async function resolvePublicClipboardHost(hostname) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '');
  const literalFamily = nodeNet.isIP(host);
  const records = literalFamily
    ? [{ address: host, family: literalFamily }]
    : await dns.promises.lookup(host, { all: true, verbatim: true });
  if (!records.length || records.some((record) => isPrivateNetworkAddress(record.address))) {
    throw clipboardImageError('Private network image addresses cannot be imported.', 'unsafe-clipboard-url');
  }
  return records[0];
}

async function requestRemoteClipboardImage(urlValue) {
  const url = new URL(urlValue);
  const resolved = await resolvePublicClipboardHost(url.hostname);
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: 'GET',
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.5',
        'Accept-Encoding': 'identity',
        'User-Agent': 'Messs Clipboard Image Import'
      },
      lookup(_hostname, _options, callback) {
        callback(null, resolved.address, resolved.family);
      }
    }, (response) => {
      response.on('error', reject);
      const status = Number(response.statusCode) || 0;
      const location = Array.isArray(response.headers.location)
        ? response.headers.location[0]
        : response.headers.location;
      if ([301, 302, 303, 307, 308].includes(status)) {
        response.resume();
        resolve({ status, location: location || '', contentType: '', buffer: null });
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        reject(clipboardImageError(`The copied image could not be downloaded (HTTP ${status}).`, 'clipboard-download-failed'));
        return;
      }
      const contentType = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (contentType && !contentType.startsWith('image/') && contentType !== 'application/octet-stream') {
        response.resume();
        reject(clipboardImageError('The copied URL did not return an image.', 'invalid-clipboard-image'));
        return;
      }
      const declaredLength = Number(response.headers['content-length']) || 0;
      if (declaredLength > MAX_CLIPBOARD_IMAGE_BYTES) {
        response.resume();
        reject(clipboardImageError('The copied image is too large to import.', 'clipboard-image-too-large'));
        return;
      }
      const chunks = [];
      let received = 0;
      response.on('data', (chunk) => {
        received += chunk.length;
        if (received > MAX_CLIPBOARD_IMAGE_BYTES) {
          request.destroy(clipboardImageError('The copied image is too large to import.', 'clipboard-image-too-large'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({
        status,
        location: '',
        contentType,
        buffer: Buffer.concat(chunks, received)
      }));
    });
    request.setTimeout(25_000, () => {
      request.destroy(clipboardImageError('The copied image download timed out.', 'clipboard-download-timeout'));
    });
    request.on('error', reject);
    request.end();
  });
}

async function downloadClipboardImage(initialUrl) {
  let currentUrl = normalizeClipboardRemoteUrl(initialUrl);
  if (!currentUrl) throw clipboardImageError('Only public HTTPS image URLs can be imported.', 'unsafe-clipboard-url');
  for (let redirects = 0; redirects <= 4; redirects += 1) {
    const response = await requestRemoteClipboardImage(currentUrl);
    if (response.location) {
      if (redirects === 4) throw clipboardImageError('The copied image redirected too many times.', 'clipboard-download-failed');
      currentUrl = normalizeClipboardRemoteUrl(new URL(response.location, currentUrl).toString());
      if (!currentUrl) throw clipboardImageError('The copied image redirected to an unsafe address.', 'unsafe-clipboard-url');
      continue;
    }
    return response.buffer;
  }
  throw clipboardImageError('The copied image could not be downloaded.', 'clipboard-download-failed');
}

async function importClipboardPng(png, request, dimensions) {
  const tempDir = path.join(app.getPath('temp'), 'messs-clipboard');
  const tempPath = path.join(tempDir, `${crypto.randomUUID()}.png`);
  await fs.promises.mkdir(tempDir, { recursive: true });
  await fs.promises.writeFile(tempPath, png);
  try {
    const folderId = request.folderId && request.folderId !== 'default' ? String(request.folderId) : null;
    const canvasId = String(request.canvasId || '').trim() || null;
    const unlockedKeys = new Set();
    const record = await importOneFile(tempPath, folderId, unlockedKeys, achievements.todayStr(), canvasId);
    if (!record) return { ok: false, reason: 'invalid-image' };
    if (dimensions && dimensions.width > 0) record.sourceWidth = dimensions.width;
    if (dimensions && dimensions.height > 0) record.sourceHeight = dimensions.height;
    record.originalPath = 'Clipboard';
    record.sourceFolder = 'Clipboard';
    store.scheduleSave();
    if (unlockedKeys.size > 0) notifyAchievements();
    return { ok: true, file: fileToPayload(record) };
  } finally {
    await fs.promises.rm(tempPath, { force: true }).catch(() => {});
  }
}

async function downloadButlerPreview(previewUrl) {
  let currentUrl = normalizeButlerPreviewUrl(previewUrl);
  if (!currentUrl) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  if (typeof timer.unref === 'function') timer.unref();
  try {
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      const response = await appFetch(currentUrl, {
        method: 'GET',
        headers: { Accept: 'image/png,image/jpeg,image/webp' },
        redirect: 'manual',
        signal: controller.signal
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirects === 3) return null;
        const location = response.headers && response.headers.get && response.headers.get('location');
        currentUrl = location ? normalizeButlerPreviewUrl(new URL(location, currentUrl).toString()) : '';
        if (!currentUrl) return null;
        continue;
      }
      if (!response.ok) return null;
      return readBoundedFetchBuffer(response, MAX_BUTLER_PREVIEW_BYTES);
    }
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timer);
  }
  return null;
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
    if (host.includes('quickrouter')) return 'AI Service';
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
  return Array.from({ length: Math.max(10, source.length) }, (_, index) => {
    const saved = source[index] || {};
    const endpoint = normalizeProviderEndpoint(
      saved.endpoint || (index === 0 ? fallbackEndpoint || DEFAULT_IMAGE_ENDPOINT : '')
    );
    return {
      id: `image-${index + 1}`,
      name: String(saved.name || (index === 0 ? DEFAULT_CATALOG_IMAGE.name : endpoint ? deriveProviderName(endpoint) : '')).trim().slice(0, 40),
      endpoint,
      model: String(saved.model || '').trim().slice(0, 120),
      protocol: String(saved.protocol || '').trim().slice(0, 40),
      capabilities: saved.capabilities && typeof saved.capabilities === 'object' ? saved.capabilities : null
    };
  });
}

function normalizeVideoProviders(value, fallbackEndpoint, fallbackName) {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length: Math.max(10, source.length) }, (_, index) => {
    const saved = source[index] || {};
    const endpoint = normalizeProviderEndpoint(
      saved.endpoint || (index === 0 ? fallbackEndpoint || DEFAULT_VIDEO_ENDPOINT : '')
    );
    return {
      id: `video-${index + 1}`,
      name: String(saved.name || (index === 0 ? fallbackName || DEFAULT_CATALOG_VIDEO.name : endpoint ? deriveProviderName(endpoint) : '')).trim().slice(0, 40),
      endpoint,
      model: String(saved.model || '').trim().slice(0, 120),
      protocol: String(saved.protocol || '').trim().slice(0, 40),
      capabilities: saved.capabilities && typeof saved.capabilities === 'object' ? saved.capabilities : null,
      resultEndpoint: normalizeProviderEndpoint(saved.resultEndpoint)
    };
  });
}

async function resolveAiVideoReferences(request) {
  const fileIds = Array.isArray(request && request.referenceFileIds)
    ? request.referenceFileIds.slice(0, 14)
    : [];
  const requestedTypes = Array.isArray(request && request.referenceMediaTypes)
    ? request.referenceMediaTypes.slice(0, fileIds.length).map((value) => String(value || '').toLowerCase())
    : [];
  const urls = [];
  const mediaTypes = [];
  const uploadIds = [];
  for (let index = 0; index < fileIds.length; index += 1) {
    const file = store.getFile(String(fileIds[index] || ''));
    if (!file) continue;
    const ext = String(file.ext || path.extname(file.name)).toLowerCase();
    const mediaType = requestedTypes[index] === 'video' || preview.isVideoExt(ext) ? 'video' : 'image';
    if (mediaType === 'video') {
      const source = await butlerSourceVideo(file.id);
      const upload = await aiGateway.uploadReferenceVideo(source.videoBuffer, source.toolOptions.sourceMime);
      uploadIds.push(upload.uploadId);
      mediaTypes.push('video');
      continue;
    }
    const dataUrl = await fileToSafeAiDataUrl(file.id);
    if (!dataUrl) continue;
    urls.push(dataUrl);
    mediaTypes.push('image');
  }
  return { urls, mediaTypes, uploadIds };
}

function normalizedVideoModes(capabilities = {}) {
  const configured = Array.isArray(capabilities.videoModes)
    ? capabilities.videoModes.filter((entry) => entry && typeof entry === 'object' && entry.id)
    : [];
  if (configured.length) return configured;
  const configuredMinimum = Math.max(0, Number(capabilities.minReferenceImages) || 0);
  const configuredMaximum = Number(capabilities.maxReferenceImages);
  const maximumReferences = Number.isInteger(configuredMaximum) && configuredMaximum >= 0
    ? Math.min(14, configuredMaximum)
    : 2;
  return [
    ...(configuredMinimum === 0 ? [{ id: 'text', minReferences: 0, maxReferences: 0 }] : []),
    ...(maximumReferences >= 1 ? [{ id: 'first-frame', minReferences: 1, maxReferences: 1 }] : []),
    ...(maximumReferences >= 2 ? [{ id: 'first-last-frame', minReferences: 2, maxReferences: 2 }] : [])
  ];
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
    name: String(legacy.name || (legacyEndpoint ? deriveProviderName(legacyEndpoint) : DEFAULT_CATALOG_CHAT.name)).trim().slice(0, 40) || DEFAULT_CATALOG_CHAT.name,
    endpoint: legacyEndpoint,
    models: normalizeChatModels(legacy.model, DEFAULT_CATALOG_CHAT.models[0])
  };
  const effectiveSource = !hasConfiguredSource && legacyEndpoint ? [legacyProvider] : source;
  return Array.from({ length: Math.max(10, effectiveSource.length) }, (_, index) => {
    const saved = effectiveSource[index] || {};
    const endpoint = normalizeProviderEndpoint(saved.endpoint);
    return {
      id: `chat-${index + 1}`,
      name: String(saved.name || (endpoint ? deriveProviderName(endpoint) : '')).trim().slice(0, 40),
      endpoint,
      models: normalizeChatModels(saved.models || saved.model, index === 0 ? DEFAULT_CATALOG_CHAT.models[0] : ''),
      protocol: String(saved.protocol || '').trim().slice(0, 40)
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
    videoProviderName: activeVideoProvider.name || DEFAULT_CATALOG_VIDEO.name,
    chatProviders,
    activeChatProviderId,
    chatProviderName: activeChatProvider.name || String(saved.chatProviderName || 'Messs AI').trim().slice(0, 40) || 'Messs AI',
    chatEndpoint: activeChatProvider.endpoint,
    chatModel: activeChatProvider.models[0] || DEFAULT_CATALOG_CHAT.models[0]
  };
}

function applyAiProviderVisibility(config) {
  const visible = (providers) => (Array.isArray(providers) ? providers : [])
    .map((provider) => ({ ...provider, available: true }));
  const imageProviders = visible(config.imageProviders);
  const videoProviders = visible(config.videoProviders);
  const chatProviders = visible(config.chatProviders);
  return {
    ...config,
    providerVisibilityEnforced: true,
    modelAccessRestricted: false,
    imageProviders,
    videoProviders,
    chatProviders,
    activeImageProviderId: imageProviders.some((provider) => provider.id === config.activeImageProviderId)
      ? config.activeImageProviderId
      : (imageProviders[0] ? imageProviders[0].id : null),
    activeVideoProviderId: videoProviders.some((provider) => provider.id === config.activeVideoProviderId)
      ? config.activeVideoProviderId
      : (videoProviders[0] ? videoProviders[0].id : null),
    activeChatProviderId: chatProviders.some((provider) => provider.id === config.activeChatProviderId)
      ? config.activeChatProviderId
      : (chatProviders[0] ? chatProviders[0].id : null),
    imageEndpoint: imageProviders.length ? config.imageEndpoint : '',
    chatEndpoint: chatProviders.length ? config.chatEndpoint : '',
    chatModel: chatProviders.length ? config.chatModel : ''
  };
}

function hasAuthenticatedGatewaySession() {
  const session = supabaseAuth && supabaseAuth.getPublicSession();
  return Boolean(runtimeConfig && runtimeConfig.gatewayConfigured && session && session.authenticated && session.user);
}

function activationStatusForRenderer() {
  const local = getActivationStatus(store.data.settings);
  const session = supabaseAuth && supabaseAuth.getPublicSession();
  const cloudAuthoritative = Boolean(
    hasAuthenticatedGatewaySession() && gatewayAccountCache && session && session.user &&
    gatewayAccountCache.userId === session.user.id
  );
  const cloudUnlocked = cloudAuthoritative ? gatewayAccountCache.overseasUnlocked === true : null;
  const gatewayMode = Boolean(runtimeConfig && runtimeConfig.gatewayConfigured);
  return {
    ...local,
    activated: gatewayMode ? Boolean(cloudAuthoritative && cloudUnlocked) : local.activated,
    localActivated: local.activated,
    cloudAuthoritative,
    cloudSyncRequired: cloudAuthoritative && local.activated && !cloudUnlocked
  };
}

function applyGatewayAccount(account) {
  if (!account || typeof account !== 'object') {
    const error = new Error('The gateway returned an invalid credit account.');
    error.code = 'credit-service-failed';
    throw error;
  }
  const session = supabaseAuth.getPublicSession();
  const previousAccount = gatewayAccountCache;
  const balance = Math.max(0, Number(account.balance) || 0);
  const reserved = Math.max(0, Math.min(balance, Number(account.reserved) || 0));
  gatewayAccountCache = {
    userId: session.user && session.user.id || null,
    balance,
    reserved,
    overseasUnlocked: account.overseasUnlocked === true || account.overseas_unlocked === true,
    membershipTier: String(account.membershipTier || account.membership_tier || 'free').slice(0, 40) || 'free',
    updatedAt: account.updatedAt || account.updated_at || new Date().toISOString()
  };
  gatewayAccountCacheExpiresAt = Date.now() + 45_000;
  gatewayAccountRetryAfter = 0;
  if (!previousAccount || previousAccount.userId !== gatewayAccountCache.userId || previousAccount.overseasUnlocked !== gatewayAccountCache.overseasUnlocked) {
    gatewayCatalogCache = null;
  }
  const membership = membershipService.applyServerSnapshot({
    account: {
      id: session.user && session.user.id || null,
      status: 'authenticated',
      email: session.user && session.user.email || null,
      displayName: session.user && (session.user.displayName || session.user.display_name) || null
    },
    plan: {
      id: gatewayAccountCache.membershipTier,
      name: gatewayAccountCache.membershipTier === 'free' ? 'Free' : gatewayAccountCache.membershipTier,
      tier: gatewayAccountCache.membershipTier
    },
    credits: {
      balance,
      reserved,
      currency: 'points',
      isAuthoritative: true,
      updatedAt: gatewayAccountCache.updatedAt
    },
    sync: {
      status: 'synced',
      revision: `${balance}:${reserved}:${gatewayAccountCache.updatedAt}`
    }
  });
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('membership:updated', membership);
    mainWindow.webContents.send('activation:updated', activationStatusForRenderer());
  }
  return membership;
}

function startGatewayAccountSync() {
  if (gatewayAccountSyncPromise) return gatewayAccountSyncPromise;
  const session = supabaseAuth.getPublicSession();
  const expectedUserId = session && session.user && session.user.id;
  const generation = gatewayAccountSyncGeneration;
  let trackedPromise;
  trackedPromise = aiGateway.getAccount()
    .then((payload) => {
      const liveSession = supabaseAuth.getPublicSession();
      if (generation !== gatewayAccountSyncGeneration || !liveSession.authenticated || !liveSession.user || liveSession.user.id !== expectedUserId) {
        return membershipService.getSnapshot();
      }
      return applyGatewayAccount(payload && payload.account ? payload.account : payload);
    })
    .finally(() => {
      if (gatewayAccountSyncPromise === trackedPromise) gatewayAccountSyncPromise = null;
    });
  gatewayAccountSyncPromise = trackedPromise;
  return trackedPromise;
}

async function syncGatewayAccount(options = {}) {
  if (!hasAuthenticatedGatewaySession() || !aiGateway) return membershipService.getSnapshot();
  const force = options.force === true;
  const session = supabaseAuth.getPublicSession();
  const hasCache = Boolean(gatewayAccountCache && gatewayAccountCache.userId === (session.user && session.user.id));
  if (!force && !hasCache && gatewayAccountRetryAfter > Date.now()) {
    return membershipService.getSnapshot();
  }
  if (!force && hasCache) {
    if (gatewayAccountCacheExpiresAt <= Date.now() && !gatewayAccountSyncPromise) {
      startGatewayAccountSync();
      // Stale-while-revalidate: opening the AI panel should never wait up to
      // the network timeout merely to refresh a balance that is already shown.
      gatewayAccountSyncPromise.catch(() => {});
    }
    return membershipService.getSnapshot();
  }
  try {
    return await startGatewayAccountSync();
  } catch (error) {
    gatewayAccountRetryAfter = Date.now() + 15_000;
    if (options.throwOnError) throw error;
    return membershipService.getSnapshot();
  }
}

function clearGatewayAccount() {
  gatewayAccountSyncGeneration += 1;
  gatewayAccountCache = null;
  gatewayAccountCacheExpiresAt = 0;
  gatewayAccountRetryAfter = 0;
  gatewayAccountSyncPromise = null;
  if (!membershipService || !runtimeConfig || !runtimeConfig.gatewayConfigured) return;
  membershipService.applyServerSnapshot({
    account: { id: null, status: 'guest', email: null, displayName: null },
    plan: { id: 'free', name: 'Free', tier: 'free' },
    credits: { balance: 0, reserved: 0, currency: 'points', isAuthoritative: true, updatedAt: new Date().toISOString() },
    sync: { status: 'stale', revision: null }
  });
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
  if (gatewayMode && cloudSession.authenticated) await syncGatewayAccount({ background: true });
  const result = {
    ...publicConfig,
    creditPricing: publicCreditPricing(),
    membership: membershipService ? membershipService.getSnapshot() : null,
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
  if (!gatewayMode || !cloudSession.authenticated) return applyAiProviderVisibility(result);
  try {
    const remote = await getVerifiedGatewayCatalog(false);
    const providers = remote.providers;
    const gatewayEndpoint = runtimeConfig.aiGatewayUrl;
    const cloudProviders = (kind) => providers
      .filter((provider) => provider && provider.kind === kind)
      .slice(0, 100)
      .map((provider) => ({
        id: provider.id,
        name: provider.name,
        endpoint: gatewayEndpoint,
        models: provider.models,
        capabilities: provider.capabilities,
        protocol: provider.protocol,
        hasOwnApiKey: false,
        hasApiKey: true,
        cloudManaged: true
      }));
    const imageProviders = cloudProviders('image');
    const videoProviders = cloudProviders('video');
    const chatProviders = cloudProviders('chat');
    return applyAiProviderVisibility({
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
    });
  } catch (error) {
    return applyAiProviderVisibility(result);
  }
}

async function getVerifiedGatewayCatalog(force = false) {
  const now = Date.now();
  const session = supabaseAuth && supabaseAuth.getPublicSession();
  const scope = String(session && session.user && session.user.id || 'guest');
  if (!force && gatewayCatalogCache && gatewayCatalogCache.scope === scope && gatewayCatalogCache.expiresAt > now) {
    return gatewayCatalogCache.value;
  }
  const remote = await aiGateway.getConfig();
  const value = normalizeGatewayCatalog(remote, runtimeConfig.aiGatewayUrl);
  gatewayCatalogCache = { value, scope, expiresAt: now + 60_000 };
  if (!value.compatible) assertGatewayProvider(value, 'image', 'image-1');
  return value;
}

async function requireGatewayProvider(kind, providerId) {
  const catalog = await getVerifiedGatewayCatalog();
  return assertGatewayProvider(catalog, kind, providerId);
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
  const timeout = setTimeout(() => controller.abort(), kind === 'video' ? 22 * 60 * 1000 : 20 * 60 * 1000);
  try {
    if (assertAiTransportReady() === 'gateway') {
      await requireGatewayProvider(kind, kind === 'video' ? options.videoProviderId : options.imageProviderId);
      return await aiGateway.generateMedia(kind, {
        prompt,
        providerId: kind === 'video' ? options.videoProviderId : options.imageProviderId,
        size: options.size,
        quality: options.quality,
        resolution: options.resolution,
        aspectRatio: options.aspectRatio,
        sourceWidth: options.sourceWidth,
        sourceHeight: options.sourceHeight,
        duration: options.duration,
        videoMode: options.videoMode,
        referenceMediaTypes: options.referenceMediaTypes,
        referenceVideoUploadIds: options.referenceVideoUploadIds,
        enhancePrompt: options.enhancePrompt,
        seed: options.seed,
        styleId: options.styleId,
        styleStrength: options.styleStrength,
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
        config.imageModel = selected.model || '';
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
      const timeoutError = new Error(localizedMessage(
        'AI generation timed out. Please try again.',
        'AI 生成等待超时，请稍后重试。',
        'AI 생성 시간이 초과되었습니다. 다시 시도하세요.'
      ));
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
      await requireGatewayProvider('chat', providerId);
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
      const timeoutError = new Error(localizedMessage(
        'AI chat timed out. Please try again.',
        'AI 对话等待超时，请稍后重试。',
        'AI 채팅 시간이 초과되었습니다. 다시 시도하세요.'
      ));
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
  const code = String(error && error.code || '').trim().toLowerCase();
  if (code === 'provider-auth-failed' || /invalid token(?:\s|\(|$)/i.test(raw)) {
    return localizedMessage(
      'The AI service credential has expired. Please try again later or contact the administrator.',
      'AI 服务凭证已失效，请稍后重试或联系管理员。',
      'AI 서비스 인증 정보가 만료되었습니다. 잠시 후 다시 시도하거나 관리자에게 문의하세요.'
    );
  }
  if (['invalid-session', 'auth-required'].includes(code)) {
    return localizedMessage(
      'Your sign-in session has expired. Please sign in again.',
      '登录状态已失效，请重新登录。',
      '로그인 세션이 만료되었습니다. 다시 로그인하세요.'
    );
  }
  if (error && error.code === 'image-resolution-mismatch') {
    const requested = String(error.requestedResolution || '').trim().toUpperCase();
    const width = Math.round(Number(error.actualWidth) || 0);
    const height = Math.round(Number(error.actualHeight) || 0);
    return localizedMessage(
      `${requested || 'The requested resolution'} was requested, but the provider returned ${width} x ${height}. The low-resolution result was rejected and your points were refunded. Please retry.`,
      `请求了 ${requested || '高清'}，但服务商实际返回 ${width} x ${height}。低分辨率结果已拒收，本次积分已退还，请重试。`,
      `${requested || '고해상도'} 요청에 대해 제공자가 ${width} x ${height} 이미지를 반환했습니다. 저해상도 결과는 거부되었고 포인트는 환불되었습니다. 다시 시도해 주세요.`
    );
  }
  if (error && error.code === 'image-resolution-unverified') {
    return localizedMessage(
      'The provider result dimensions could not be verified. The result was rejected and your points were refunded. Please retry.',
      '无法验证服务商返回图片的真实分辨率，结果已拒收，本次积分已退还，请重试。',
      '제공자 결과의 실제 해상도를 확인할 수 없습니다. 결과는 거부되었고 포인트는 환불되었습니다. 다시 시도해 주세요.'
    );
  }
  if (/upstream\s+load\s+is\s+saturated|current\s+group.*saturated|group\s+upstream.*saturated/i.test(raw)) {
    return localizedMessage(
      'The AI upstream is busy right now. Please try again shortly.',
      '当前 AI 上游繁忙，请稍后重试。',
      'AI upstream is busy right now. Please try again shortly.'
    );
  }
  if (/no available channel for model|no channel available|model.*not.*available/i.test(raw)) {
    const model = String(context.model || '').trim();
    return model
      ? localizedMessage(
        `No channel is available for “${model}”. Save the API connection in Settings, refresh the model list, and choose again.`,
        `当前中转站没有可用于“${model}”的通道。请在设置中保存接口，让软件自动读取可用模型后重新选择。`,
        `“${model}”에 사용할 수 있는 채널이 없습니다. 설정에서 API 연결을 저장하고 모델 목록을 새로 고친 뒤 다시 선택하세요.`
      )
      : localizedMessage(
        'No model channel is currently available. Save the API connection in Settings, refresh the model list, and choose again.',
        '当前中转站没有可用的模型通道。请在设置中保存接口，让软件自动读取可用模型后重新选择。',
        '현재 사용할 수 있는 모델 채널이 없습니다. 설정에서 API 연결을 저장하고 모델 목록을 새로 고친 뒤 다시 선택하세요.'
      );
  }
  if (/\b(?:401|403)\b|invalid api key|unauthorized|authentication/i.test(raw)) {
    return localizedMessage(
      'The API key is invalid, expired, or lacks access to this model. Check the key for this connection.',
      'API Key 无效、已过期或没有当前模型权限，请检查接口对应的密钥。',
      'API 키가 올바르지 않거나 만료되었거나 이 모델에 대한 권한이 없습니다. 이 연결의 키를 확인하세요.'
    );
  }
  if (/\b404\b|not found/i.test(raw)) {
    return localizedMessage(
      'The API endpoint was not found. Enter an API Base URL or full request URL; the app will complete standard paths automatically.',
      '接口地址未找到。请填写 API Base URL 或完整请求 URL，软件会自动补全标准路径。',
      'API 엔드포인트를 찾을 수 없습니다. API Base URL 또는 전체 요청 URL을 입력하면 앱이 표준 경로를 자동으로 완성합니다.'
    );
  }
  if (/returned a webpage|网页而不是 json/i.test(raw)) {
    return localizedMessage(
      'This address is a website page, not an API. Enter the Base URL or request URL from the provider console.',
      '当前地址是网站页面，不是 API。请填写控制台提供的 Base URL 或请求 URL。',
      '이 주소는 API가 아니라 웹사이트 페이지입니다. 공급자 콘솔의 Base URL 또는 요청 URL을 입력하세요.'
    );
  }
  const taskId = error && error.taskId ? localizedMessage(
    ` (Task ID: ${error.taskId})`,
    `（任务 ID：${error.taskId}）`,
    ` (작업 ID: ${error.taskId})`
  ) : '';
  const message = raw || (context.kind === 'chat'
    ? localizedMessage('AI chat failed. Please try again.', 'AI 对话失败，请稍后重试。', 'AI 채팅에 실패했습니다. 다시 시도하세요.')
    : localizedMessage('AI generation failed. Please try again.', 'AI 生成失败，请稍后重试。', 'AI 생성에 실패했습니다. 다시 시도하세요.'));
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

function makeButlerOutputName(sourceFile, operation, extension) {
  const sourceExt = path.extname(String(sourceFile && sourceFile.name || ''));
  const cleanBase = path.basename(String(sourceFile && sourceFile.name || ''), sourceExt)
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64) || 'Image';
  const suffix = ({
    'remove-background': 'Background Removed',
    'image-edit': 'Edited',
    'image-layer': 'Layer',
    'image-upscale': 'Upscaled',
    'image-erase': 'Erased',
    'generate-3d': '3D'
  })[operation] || 'Processed';
  const existingNames = new Set(store.data.files.map((file) => file.name));
  let name = `${cleanBase} - ${suffix}.${extension}`;
  let number = 2;
  while (existingNames.has(name)) {
    name = `${cleanBase} - ${suffix} (${number}).${extension}`;
    number += 1;
  }
  return name;
}

async function sanitizeButlerImagePng(buffer, { requireTransparency = false } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24 || buffer.length > 64 * 1024 * 1024 ||
      !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    const error = new Error('The image service returned an invalid PNG image.');
    error.code = buffer && buffer.length > 64 * 1024 * 1024 ? 'media-too-large' : 'invalid-background-image';
    throw error;
  }
  if (!sharp) {
    const error = new Error('Secure image validation is unavailable in this build.');
    error.code = 'privacy-sanitizer-unavailable';
    throw error;
  }
  try {
    const pipeline = sharp(buffer, {
      failOn: 'error',
      limitInputPixels: 512 * 1024 * 1024,
      sequentialRead: true
    });
    const metadata = await pipeline.metadata();
    if (metadata.format !== 'png' || !(metadata.width > 0 && metadata.height > 0) ||
        (requireTransparency && !metadata.hasAlpha)) {
      throw new Error(requireTransparency ? 'missing-alpha' : 'invalid-png');
    }
    const canonical = await pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
    if (canonical.length > 64 * 1024 * 1024) {
      const sizeError = new Error('The background removal result exceeds the download size limit.');
      sizeError.code = 'media-too-large';
      throw sizeError;
    }
    return canonical;
  } catch (cause) {
    if (cause && cause.code === 'media-too-large') throw cause;
    const error = new Error(requireTransparency
      ? 'The background service returned an invalid transparent PNG image.'
      : 'The image service returned an invalid PNG image.');
    error.code = 'invalid-background-image';
    throw error;
  }
}

async function sanitizeButlerBackgroundPng(buffer) {
  return sanitizeButlerImagePng(buffer, { requireTransparency: true });
}

async function sanitizeButlerMaskDataUrl(value) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/i.exec(String(value || ''));
  if (!match || !match[1] || match[1].length % 4 !== 0) {
    const error = new Error('Draw an erase mask before starting.');
    error.code = 'invalid-image-mask';
    throw error;
  }
  const buffer = Buffer.from(match[1], 'base64');
  if (!buffer.length || buffer.length > MAX_BUTLER_IMAGE_BYTES || buffer.toString('base64') !== match[1]) {
    const error = new Error('The erase mask is invalid or too large.');
    error.code = 'invalid-image-mask';
    throw error;
  }
  if (!sharp) {
    const error = new Error('Secure image validation is unavailable in this build.');
    error.code = 'privacy-sanitizer-unavailable';
    throw error;
  }
  try {
    const pipeline = sharp(buffer, {
      failOn: 'error',
      limitInputPixels: 25_000_000,
      sequentialRead: true
    });
    const metadata = await pipeline.metadata();
    if (metadata.format !== 'png' || !(metadata.width > 0 && metadata.height > 0) ||
        metadata.width > 5000 || metadata.height > 5000) {
      throw new Error('invalid-mask');
    }
    const canonical = await pipeline
      .removeAlpha()
      .greyscale()
      .threshold(1)
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();
    if (!canonical.length || canonical.length > MAX_BUTLER_IMAGE_BYTES) throw new Error('invalid-mask');
    return {
      dataUrl: `data:image/png;base64,${canonical.toString('base64')}`,
      width: metadata.width,
      height: metadata.height
    };
  } catch (cause) {
    const error = new Error('The erase mask could not be validated.');
    error.code = 'invalid-image-mask';
    throw error;
  }
}

async function addButlerOutputFile(buffer, sourceFile, operation, operationDetails = {}) {
  const isModel = operation === 'generate-3d';
  if (isModel) assertValidGlbBuffer(buffer);
  const extension = isModel ? 'glb' : 'png';
  const id = crypto.randomUUID();
  const name = makeButlerOutputName(sourceFile, operation, extension);
  const canvas = store.data.canvases.find((entry) => entry.id === sourceFile.canvasId) || store.data.canvases[0];
  const archiveDir = canvasStorageDir(canvas);
  await fs.promises.mkdir(archiveDir, { recursive: true });
  const storedPath = path.join(archiveDir, `${id}.${extension}`);
  let record = null;
  try {
    await fs.promises.writeFile(storedPath, buffer, { mode: 0o600, flag: 'wx' });
    const stat = await fs.promises.stat(storedPath);
    const sourceDimensions = isModel ? null : await readSourceMediaMetadata(storedPath, '.png');
    record = {
      id,
      name,
      originalPath: `Butler ${operation}`,
      storedPath,
      importedAt: new Date().toISOString(),
      sourceFolder: 'Butler',
      sizeBytes: stat.size,
      ...sourceDimensions,
      ...(isModel
        ? { mimeType: 'model/gltf-binary', archiveKind: 'model' }
        : classifyArchiveFile(name)),
      fingerprint: await makeFileFingerprint(storedPath, stat),
      butlerOperation: {
        kind: operation,
        sourceFileId: sourceFile.id,
        ...(operationDetails.modelId ? { modelId: operationDetails.modelId } : {}),
        ...(Number.isFinite(Number(operationDetails.credits))
          ? { credits: Number(operationDetails.credits) }
          : {}),
        createdAt: new Date().toISOString()
      },
      folderId: sourceFile.folderId || null,
      canvasId: canvas ? canvas.id : null
    };
    store.addFile(record);
    await store.mirrorFileToCustomPathAsync(record);
    store.scheduleSave();
    return record;
  } catch (error) {
    if (record) store.removeFileById(record.id);
    await fs.promises.rm(storedPath, { force: true }).catch(() => {});
    throw error;
  }
}

function makeButlerVideoOutputName(sourceFile, extension) {
  const sourceExt = path.extname(String(sourceFile && sourceFile.name || ''));
  const cleanBase = path.basename(String(sourceFile && sourceFile.name || ''), sourceExt)
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64) || 'Video';
  const existingNames = new Set(store.data.files.map((file) => file.name));
  let name = `${cleanBase} - Enhanced.${extension}`;
  let number = 2;
  while (existingNames.has(name)) {
    name = `${cleanBase} - Enhanced (${number}).${extension}`;
    number += 1;
  }
  return name;
}

async function addButlerVideoOutputFile(buffer, sourceFile, operationDetails = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length > MAX_BUTLER_VIDEO_OUTPUT_BYTES) {
    const error = new Error('The enhanced video exceeds the safe download size.');
    error.code = 'media-too-large';
    throw error;
  }
  const extension = detectGeneratedVideoExtension(buffer);
  const mimeType = extension === 'mov' ? 'video/quicktime' : extension === 'webm' ? 'video/webm' : 'video/mp4';
  validateButlerVideoBuffer(buffer, mimeType);
  const id = crypto.randomUUID();
  const name = makeButlerVideoOutputName(sourceFile, extension);
  const canvas = store.data.canvases.find((entry) => entry.id === sourceFile.canvasId) || store.data.canvases[0];
  const archiveDir = canvasStorageDir(canvas);
  await fs.promises.mkdir(archiveDir, { recursive: true });
  const storedPath = path.join(archiveDir, `${id}.${extension}`);
  let record = null;
  try {
    await fs.promises.writeFile(storedPath, buffer, { mode: 0o600, flag: 'wx' });
    const stat = await fs.promises.stat(storedPath);
    const sourceMetadata = await readSourceMediaMetadata(storedPath, `.${extension}`);
    record = {
      id,
      name,
      originalPath: 'Butler video-upscale',
      storedPath,
      importedAt: new Date().toISOString(),
      sourceFolder: 'Butler',
      sizeBytes: stat.size,
      ...sourceMetadata,
      ...(sourceMetadata ? { mediaMetadataVersion: 1 } : {}),
      ...classifyArchiveFile(name),
      fingerprint: await makeFileFingerprint(storedPath, stat),
      butlerOperation: {
        kind: 'video-upscale',
        modelId: BUTLER_VIDEO_TOOL_ID,
        sourceFileId: sourceFile.id || null,
        output: operationDetails.output || null,
        credits: Number.isFinite(Number(operationDetails.credits)) ? Number(operationDetails.credits) : null,
        providerCost: Number.isFinite(Number(operationDetails.providerCost)) ? Number(operationDetails.providerCost) : null,
        createdAt: new Date().toISOString()
      },
      folderId: sourceFile.folderId || null,
      canvasId: canvas ? canvas.id : null
    };
    store.addFile(record);
    await store.mirrorFileToCustomPathAsync(record);
    store.scheduleSave();
    return record;
  } catch (error) {
    if (record) store.removeFileById(record.id);
    await fs.promises.rm(storedPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function writeButlerModelPreview(fileId, sourceFile, previewUrl) {
  if (!sharp || !sourceFile || !sourceFile.storedPath) return false;
  const cacheDir = path.join(previewCacheDir, fileId);
  const outputPath = path.join(cacheDir, 'model-preview.png');
  const temporaryPath = path.join(cacheDir, `.model-preview-${crypto.randomUUID()}.tmp.png`);
  await fs.promises.mkdir(cacheDir, { recursive: true });
  const remoteBuffer = await downloadButlerPreview(previewUrl);
  const candidates = remoteBuffer ? [remoteBuffer, sourceFile.storedPath] : [sourceFile.storedPath];
  try {
    for (const candidate of candidates) {
      try {
        await sharp(candidate, {
          failOn: 'error',
          limitInputPixels: 512 * 1024 * 1024,
          sequentialRead: true
        })
          .rotate()
          .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
          .png({ compressionLevel: 9, adaptiveFiltering: true })
          .toFile(temporaryPath);
        await fs.promises.rename(temporaryPath, outputPath);
        return true;
      } catch (error) {
        await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
      }
    }
  } finally {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
  }
  return false;
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
  const temporaryPath = path.join(archiveDir, `.${id}.${extension}.${crypto.randomUUID()}.part`);
  try {
    const handle = await fs.promises.open(temporaryPath, 'wx', 0o600);
    try {
      await handle.writeFile(buffer);
      await handle.sync();
    } finally {
      await handle.close();
    }
    const writtenStat = await fs.promises.stat(temporaryPath);
    if (!writtenStat.isFile() || writtenStat.size !== buffer.length) {
      const error = new Error('The generated media archive was not written completely.');
      error.code = 'generated-media-write-incomplete';
      throw error;
    }
    await fs.promises.rename(temporaryPath, storedPath);
  } catch (error) {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }

  let videoPreviewReady = false;
  let videoPreviewError = null;
  if (mediaKind === 'video') {
    try {
      const validation = await preview.validateVideoFile(storedPath);
      if (!validation.ok) {
        const error = new Error('The generated video could not be decoded after download.');
        error.code = 'generated-video-invalid';
        throw error;
      }
      await preview.transcodeVideoToWebCompatible(storedPath, previewCacheDir, id);
      videoPreviewReady = true;
    } catch (error) {
      await fs.promises.rm(path.join(previewCacheDir, id), { recursive: true, force: true }).catch(() => {});
      videoPreviewError = String(error && error.code || 'video-preview-preparation-failed').slice(0, 80);
      console.warn('Generated video was archived, but its initial preview could not be prepared:', videoPreviewError);
    }
  }
  const sourceDimensions = await readSourceMediaMetadata(storedPath, `.${extension}`);
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
    ...(mediaKind === 'video' && sourceDimensions ? { mediaMetadataVersion: 1 } : {}),
    ...(mediaKind === 'video' ? { videoPreviewReady, ...(videoPreviewError ? { videoPreviewError } : {}) } : {}),
    ...classifyArchiveFile(name),
    aiGeneration: {
      kind: mediaKind,
      prompt: String(prompt || '').trim().slice(0, 12000),
      modelName: String(request.modelName || 'AI model').trim().slice(0, 160) || 'AI model',
      providerId: providerId.slice(0, 80) || null,
      aspectRatio: String(request.aspectRatio || 'auto').trim().slice(0, 32) || 'auto',
      size: String(request.size || 'auto').trim().slice(0, 32) || 'auto',
      quality: mediaKind === 'image'
        ? String(request.quality || 'auto').trim().toLowerCase().slice(0, 16)
        : null,
      styleId: mediaKind === 'image' ? String(request.styleId || '').trim().slice(0, 64) || null : null,
      styleStrength: mediaKind === 'image' ? Math.max(0, Math.min(1, Number(request.styleStrength ?? 1))) : null,
      enhancePrompt: mediaKind === 'image' ? request.enhancePrompt !== false : null,
      seed: mediaKind === 'image' && Number.isInteger(Number(request.seed)) ? Number(request.seed) : null,
      resolution: mediaKind === 'video'
        ? String(request.resolution || request.size || 'auto').trim().slice(0, 32)
        : null,
      duration: mediaKind === 'video'
        ? (Number(sourceDimensions && sourceDimensions.sourceDuration) > 0
          ? Number(sourceDimensions.sourceDuration)
          : Math.max(1, Number(request.duration) || 6))
        : null,
      requestedDuration: mediaKind === 'video' ? Math.max(1, Number(request.duration) || 6) : null,
      videoMode: mediaKind === 'video' ? String(request.videoMode || 'text').trim().slice(0, 32) : null,
      cameraControl: mediaKind === 'video' ? normalizeVideoCameraControl(request.cameraControl) : null,
      referenceFileIds,
      referenceMediaTypes: mediaKind === 'video' && Array.isArray(request.referenceMediaTypes)
        ? request.referenceMediaTypes.map((value) => String(value || '').toLowerCase()).slice(0, referenceFileIds.length)
        : referenceFileIds.map(() => 'image'),
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
    aspectRatio: sourceRatio
      ? `${Math.round(record.sourceWidth)}:${Math.round(record.sourceHeight)}`
      : (placement.aspectRatio || request.aspectRatio || 'auto'),
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

function readProfileAvatarDataUrl() {
  const session = supabaseAuth && supabaseAuth.getPublicSession();
  const avatarPath = profileAvatarPath(store.dir, session);
  if (!avatarPath || !fs.existsSync(avatarPath)) return null;
  try {
    const resolved = path.resolve(avatarPath);
    const accountsRoot = path.resolve(store.dir, 'profile', 'accounts');
    const relative = path.relative(accountsRoot, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return `data:image/webp;base64,${fs.readFileSync(resolved).toString('base64')}`;
  } catch (error) {
    return null;
  }
}

function invalidAiMediaOption(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeVideoCameraControl(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const select = (field) => {
    const requested = String(source[field] || '').trim();
    return Object.hasOwn(AI_VIDEO_CAMERA_PRESETS[field], requested)
      ? requested
      : AI_VIDEO_CAMERA_DEFAULTS[field];
  };
  return {
    enabled: source.enabled === true,
    camera: select('camera'),
    lens: select('lens'),
    focalLength: select('focalLength'),
    aperture: select('aperture'),
    motion: select('motion')
  };
}

function videoPromptWithCameraControl(prompt, value) {
  const original = String(prompt || '').trim();
  const cameraControl = normalizeVideoCameraControl(value);
  if (!cameraControl.enabled) return original;
  const suffix = `Camera specification: ${[
    AI_VIDEO_CAMERA_PRESETS.camera[cameraControl.camera],
    AI_VIDEO_CAMERA_PRESETS.lens[cameraControl.lens],
    AI_VIDEO_CAMERA_PRESETS.focalLength[cameraControl.focalLength],
    AI_VIDEO_CAMERA_PRESETS.aperture[cameraControl.aperture],
    AI_VIDEO_CAMERA_PRESETS.motion[cameraControl.motion]
  ].join('; ')}.`;
  const maximumPromptLength = 7000;
  const sourceLimit = Math.max(0, maximumPromptLength - suffix.length - 2);
  return `${original.slice(0, sourceLimit)}\n\n${suffix}`.trim();
}

function imageDimensionsWithinCapabilities(size, capabilities = {}) {
  if (capabilities.arbitrarySizes !== true) return false;
  const match = /^([1-9]\d{0,3})x([1-9]\d{0,3})$/i.exec(String(size || '').trim());
  if (!match) return false;
  const width = Number(match[1]);
  const height = Number(match[2]);
  const maxEdge = Math.max(1, Math.min(3840, Number(capabilities.maxSizeEdge) || 3840));
  const maxPixels = Math.max(1, Math.min(8_300_000, Number(capabilities.maxSizePixels) || 8_300_000));
  return width <= maxEdge && height <= maxEdge && width * height <= maxPixels;
}

function normalizeAiMediaGenerationRequest(request, kind) {
  const normalized = { ...request };
  if (kind === 'image') {
    const size = String(request.size || '').trim();
    const aspectRatio = String(request.aspectRatio || '').trim();
    const quality = String(request.quality || 'auto').trim().toLowerCase();
    if (!AI_IMAGE_SIZES.has(size) && !/^([1-9]\d{0,3})x([1-9]\d{0,3})$/i.test(size)) {
      throw invalidAiMediaOption('invalid-size', 'The selected image resolution is not supported.');
    }
    if (!AI_IMAGE_RATIOS.has(aspectRatio)) {
      throw invalidAiMediaOption('invalid-aspect-ratio', 'The selected image aspect ratio is not supported.');
    }
    if (!AI_IMAGE_QUALITIES.has(quality)) {
      throw invalidAiMediaOption('invalid-quality', 'The selected image quality is not supported.');
    }
    const imageConfig = getAiMediaConfig();
    const providerId = String(request.imageProviderId || imageConfig.activeImageProviderId || 'image-1').trim().toLowerCase();
    const provider = imageConfig.imageProviders.find((entry) => entry.id === providerId)
      || providerCatalog('image').find((entry) => entry.id === providerId)
      || null;
    const capabilities = provider && provider.capabilities && typeof provider.capabilities === 'object'
      ? provider.capabilities
      : {};
    const referenceCount = Array.isArray(request.urls) ? request.urls.length : 0;
    const configuredReferenceLimit = Number(capabilities.maxReferenceImages);
    const maxReferenceImages = Number.isInteger(configuredReferenceLimit) && configuredReferenceLimit >= 0
      ? Math.min(14, configuredReferenceLimit)
      : 14;
    const configuredReferenceMinimum = Number(capabilities.minReferenceImages);
    const minReferenceImages = Number.isInteger(configuredReferenceMinimum) && configuredReferenceMinimum > 0
      ? Math.min(14, configuredReferenceMinimum)
      : 0;
    if (referenceCount < minReferenceImages) {
      throw invalidAiMediaOption('reference-required', `The selected image model requires at least ${minReferenceImages} reference image${minReferenceImages === 1 ? '' : 's'}.`);
    }
    if (referenceCount > maxReferenceImages) {
      throw invalidAiMediaOption('too-many-references', `The selected image model supports at most ${maxReferenceImages} reference image${maxReferenceImages === 1 ? '' : 's'}.`);
    }
    const configuredSizes = referenceCount > 1 && Array.isArray(capabilities.multiReferenceSizes)
      ? capabilities.multiReferenceSizes
      : referenceCount > 0 && Array.isArray(capabilities.referenceSizes)
        ? capabilities.referenceSizes
      : Array.isArray(capabilities.resolutionPresets) && capabilities.resolutionPresets.length
        ? capabilities.resolutionPresets
      : capabilities.sizes || [];
    const supportedSizes = new Set(
      configuredSizes
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    );
    if (!supportedSizes.size && !AI_IMAGE_SIZES.has(size)) {
      throw invalidAiMediaOption('invalid-size', 'The selected image resolution is not supported.');
    }
    if (supportedSizes.size && !supportedSizes.has(size) && !imageDimensionsWithinCapabilities(size, capabilities)) {
      throw invalidAiMediaOption('invalid-size', 'The selected image model does not support this resolution with the current references.');
    }
    const supportedRatios = new Set(
      (referenceCount > 0 && Array.isArray(capabilities.referenceRatios)
        ? capabilities.referenceRatios
        : Array.isArray(capabilities.ratios) ? capabilities.ratios : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    );
    if (supportedRatios.size && !supportedRatios.has(aspectRatio)) {
      throw invalidAiMediaOption('invalid-aspect-ratio', 'The selected image model does not support this aspect ratio.');
    }
    const sizeRatios = capabilities.sizeRatios;
    const mappedRatio = sizeRatios && typeof sizeRatios === 'object' && !Array.isArray(sizeRatios)
      ? String(sizeRatios[size] || '').trim()
      : '';
    if (mappedRatio && mappedRatio !== aspectRatio) {
      throw invalidAiMediaOption('invalid-size-ratio', 'The selected image resolution does not match the aspect ratio.');
    }
    normalized.imageProviderId = providerId;
    normalized.size = size;
    normalized.quality = quality;
    normalized.aspectRatio = aspectRatio;
    normalized.enhancePrompt = request.enhancePrompt !== false;
    const seed = Math.round(Number(request.seed));
    normalized.seed = Number.isInteger(seed) && seed >= 1 && seed <= 1_000_000 ? seed : null;
    const styleId = String(request.styleId || '').trim();
    normalized.styleId = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(styleId) ? styleId : null;
    normalized.styleStrength = Math.max(0, Math.min(1, Number(request.styleStrength ?? 1)));
    return normalized;
  }

  const videoConfig = getAiMediaConfig();
  const providerId = String(request.videoProviderId || videoConfig.activeVideoProviderId || 'video-1').trim().toLowerCase();
  const provider = videoConfig.videoProviders.find((entry) => entry.id === providerId)
    || providerCatalog('video').find((entry) => entry.id === providerId)
    || null;
  if (!provider) {
    throw invalidAiMediaOption('provider-not-allowed', 'The selected video model is not available.');
  }
  const capabilities = provider.capabilities && typeof provider.capabilities === 'object'
    ? provider.capabilities
    : {};
  const supportedResolutions = new Set(
    (Array.isArray(capabilities.resolutions) && capabilities.resolutions.length
      ? capabilities.resolutions
      : [...MINIMAX_VIDEO_RESOLUTIONS])
      .map((value) => String(value || '').trim().toUpperCase())
      .filter(Boolean)
  );
  const supportedDurations = new Set(
    (Array.isArray(capabilities.durations) && capabilities.durations.length
      ? capabilities.durations
      : Array.from({ length: 12 }, (_value, index) => index + 4))
      .map(Number)
      .filter(Number.isInteger)
  );
  const textRatios = new Set(
    (Array.isArray(capabilities.ratios) && capabilities.ratios.length
      ? capabilities.ratios
      : [...MINIMAX_TEXT_VIDEO_RATIOS])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  );
  const frameRatios = new Set(
    (Array.isArray(capabilities.frameReferenceRatios) && capabilities.frameReferenceRatios.length
      ? capabilities.frameReferenceRatios
      : ['adaptive'])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  );
  const resolution = String(request.resolution || '').trim().toUpperCase();
  const duration = Number(request.duration);
  const aspectRatio = String(request.aspectRatio || '').trim();
  const referenceMediaTypes = Array.isArray(request.referenceMediaTypes)
    ? request.referenceMediaTypes.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean)
    : [];
  const referenceCount = referenceMediaTypes.length || (Array.isArray(request.urls) ? request.urls.length : 0);
  const requestedVideoMode = String(request.videoMode || '').trim().toLowerCase();
  const fallbackVideoMode = referenceCount > 2
    ? 'omni'
    : referenceCount === 2
      ? 'first-last-frame'
      : referenceCount === 1 ? 'first-frame' : 'text';
  const videoMode = requestedVideoMode || fallbackVideoMode;
  const videoModes = normalizedVideoModes(capabilities);
  const selectedVideoMode = videoModes.find((entry) => entry && entry.id === videoMode) || null;
  if (!selectedVideoMode) {
    throw invalidAiMediaOption('invalid-video-mode', `${String(provider.name || 'The selected video model')} does not support this generation mode.`);
  }
  const allowedReferenceMediaTypes = new Set(
    Array.isArray(selectedVideoMode.mediaTypes) && selectedVideoMode.mediaTypes.length
      ? selectedVideoMode.mediaTypes.map((value) => String(value || '').trim().toLowerCase())
      : ['image']
  );
  if (referenceMediaTypes.some((mediaType) => !allowedReferenceMediaTypes.has(mediaType))) {
    throw invalidAiMediaOption('invalid-reference-media', `${String(provider.name || 'The selected video model')} does not accept reference videos in this mode.`);
  }
  const referenceVideoCount = referenceMediaTypes.filter((mediaType) => mediaType === 'video').length;
  const maximumReferenceVideos = Math.max(0, Number(selectedVideoMode.maxReferenceVideos) || 0);
  if (referenceVideoCount > maximumReferenceVideos) {
    throw invalidAiMediaOption('too-many-reference-videos', `${String(provider.name || 'The selected video model')} supports at most ${maximumReferenceVideos} reference videos.`);
  }
  const hasFrameReference = videoMode === 'first-frame' || videoMode === 'first-last-frame';
  const configuredReferenceLimit = Number(capabilities.maxReferenceImages);
  const modeReferenceLimit = Number(selectedVideoMode.maxReferences);
  const referenceLimit = Number.isInteger(modeReferenceLimit) && modeReferenceLimit >= 0
    ? Math.min(14, modeReferenceLimit)
    : Number.isInteger(configuredReferenceLimit) && configuredReferenceLimit >= 0
      ? Math.min(14, configuredReferenceLimit)
      : 2;
  const providerName = String(provider.name || 'The selected video model').trim();
  const configuredReferenceMinimum = Number(selectedVideoMode.minReferences);
  const referenceMinimum = Number.isInteger(configuredReferenceMinimum) && configuredReferenceMinimum > 0
    ? Math.min(referenceLimit, configuredReferenceMinimum)
    : 0;
  if (referenceCount < referenceMinimum) {
    throw invalidAiMediaOption('reference-required', `${providerName} requires at least ${referenceMinimum} reference image${referenceMinimum === 1 ? '' : 's'}.`);
  }
  if (referenceCount > referenceLimit) {
    throw invalidAiMediaOption('too-many-references', `${providerName} supports at most ${referenceLimit} reference images.`);
  }
  if (!supportedResolutions.has(resolution)) {
    throw invalidAiMediaOption('invalid-resolution', `${providerName} does not support the selected resolution.`);
  }
  if (!Number.isInteger(duration) || !supportedDurations.has(duration)) {
    throw invalidAiMediaOption('invalid-duration', `${providerName} does not support the selected duration.`);
  }
  const modeRatios = new Set(
    (Array.isArray(selectedVideoMode.ratios) ? selectedVideoMode.ratios : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  );
  const supportedRatios = modeRatios.size ? modeRatios : hasFrameReference ? frameRatios : textRatios;
  if (!supportedRatios.has(aspectRatio)) {
    throw invalidAiMediaOption(
      'invalid-aspect-ratio',
      `${providerName} does not support the selected aspect ratio${hasFrameReference ? ' with reference images' : ''}.`
    );
  }
  normalized.videoProviderId = providerId;
  normalized.size = resolution;
  normalized.resolution = resolution;
  normalized.duration = duration;
  normalized.aspectRatio = aspectRatio;
  normalized.videoMode = videoMode;
  normalized.cameraControl = normalizeVideoCameraControl(request.cameraControl);
  normalized.referenceMediaTypes = referenceMediaTypes;
  normalized.referenceVideoUploadIds = Array.isArray(request.referenceVideoUploadIds)
    ? request.referenceVideoUploadIds.map(String).filter(Boolean).slice(0, 3)
    : [];
  return normalized;
}

async function chooseProfileAvatar() {
  const session = supabaseAuth && supabaseAuth.getPublicSession();
  const accountUserId = authenticatedUserId(session);
  const avatarPath = profileAvatarPath(store.dir, session);
  if (!accountUserId || !avatarPath) return { ok: false, reason: 'auth-required' };
  if (!sharp) return { ok: false, reason: 'image-tools-unavailable' };
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose profile image',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'avif', 'heic', 'heif'] }]
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, reason: 'cancelled' };
  if (authenticatedUserId(supabaseAuth.getPublicSession()) !== accountUserId) {
    return { ok: false, reason: 'account-changed' };
  }
  const profileDir = path.dirname(avatarPath);
  const temporaryPath = path.join(profileDir, `avatar-${crypto.randomUUID()}.tmp.webp`);
  await fs.promises.mkdir(profileDir, { recursive: true });
  try {
    await sharp(result.filePaths[0], { failOn: 'none' })
      .rotate()
      .resize(256, 256, { fit: 'cover', position: 'attention' })
      .webp({ quality: 88 })
      .toFile(temporaryPath);
    if (authenticatedUserId(supabaseAuth.getPublicSession()) !== accountUserId) {
      return { ok: false, reason: 'account-changed' };
    }
    if (authenticatedUserId(supabaseAuth.getPublicSession()) !== accountUserId) {
      return { ok: false, reason: 'account-changed' };
    }
    await fs.promises.rename(temporaryPath, avatarPath);
    return { ok: true, dataUrl: readProfileAvatarDataUrl() };
  } finally {
    await fs.promises.unlink(temporaryPath).catch(() => {});
  }
}

const BUTLER_3D_PROVIDERS = new Set(['hunyuan3d', 'hyper3d', 'tripo3d']);

function normalizeButlerImageTool(value) {
  const modelId = String(value || '').trim().toLowerCase();
  if (!BUTLER_IMAGE_TOOL_IDS.has(modelId)) {
    const error = new Error('The selected image tool is not supported.');
    error.code = 'invalid-image-tool';
    throw error;
  }
  return modelId;
}

function normalizeButlerImageOptions(modelId, requested = {}) {
  const source = requested && typeof requested === 'object' && !Array.isArray(requested) ? requested : {};
  const finiteOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  if (modelId === 'qwen-image-edit-plus') {
    const prompt = String(source.prompt || '').trim();
    if (!prompt || Array.from(prompt).length > 1200) {
      const error = new Error('Enter an image-edit prompt up to 1200 characters.');
      error.code = 'invalid-prompt';
      throw error;
    }
    assertPromptHasNoSecrets(prompt);
    const width = Math.max(256, Math.min(2048, Math.round(Number(source.width) || 1024)));
    const height = Math.max(256, Math.min(2048, Math.round(Number(source.height) || 768)));
    if (width * height > 4_194_304) {
      const error = new Error('The requested image-edit size is too large.');
      error.code = 'invalid-image-tool-options';
      throw error;
    }
    const seed = source.seed === '' || source.seed === undefined
      ? undefined
      : Math.max(0, Math.min(2_147_483_647, Math.round(finiteOr(source.seed, 0))));
    return {
      prompt,
      width,
      height,
      numInferenceSteps: Math.max(1, Math.min(50, Math.round(Number(source.numInferenceSteps) || 30))),
      guidanceScale: Math.max(0, Math.min(20, finiteOr(source.guidanceScale, 4))),
      negativePrompt: String(source.negativePrompt ?? 'blurry, ugly').trim().slice(0, 2000),
      ...(seed !== undefined ? { seed } : {})
    };
  }
  if (modelId === 'qwen-image-layered') {
    const prompt = String(source.prompt || '').trim();
    if (Array.from(prompt).length > 800) {
      const error = new Error('The layer prompt is too long.');
      error.code = 'invalid-prompt';
      throw error;
    }
    if (prompt) assertPromptHasNoSecrets(prompt);
    return {
      prompt,
      numLayers: Math.max(2, Math.min(8, Math.round(Number(source.numLayers) || 4))),
      enableSafetyChecker: source.enableSafetyChecker !== false
    };
  }
  if (modelId === 'super-upscale-v2') {
    return {
      scale: Math.max(2, Math.min(4, Math.round(Number(source.scale) || 3))),
      creativity: Math.max(0, Math.min(1, finiteOr(source.creativity, 0.2))),
      detail: Math.max(0, Math.min(10, finiteOr(source.detail, 2))),
      shapePreservation: Math.max(0, Math.min(1, finiteOr(source.shapePreservation, 0.1))),
      promptSuffix: String(source.promptSuffix ?? 'high quality, highly detailed, high resolution, sharp').trim().slice(0, 1000),
      negativePrompt: String(source.negativePrompt ?? 'blurry, low resolution, low quality, pixelated, compression artifacts').trim().slice(0, 2000),
      guidanceScale: Math.max(0, Math.min(20, finiteOr(source.guidanceScale, 7.5))),
      numInferenceSteps: Math.max(1, Math.min(50, Math.round(Number(source.numInferenceSteps) || 20))),
      overrideSizeLimits: source.overrideSizeLimits === true
    };
  }
  if (modelId.startsWith('topaz-image-')) {
    const options = {
      faceEnhancement: source.faceEnhancement !== false,
      faceEnhancementCreativity: Math.max(0, Math.min(1, finiteOr(source.faceEnhancementCreativity, 0))),
      faceEnhancementStrength: Math.max(0, Math.min(1, finiteOr(source.faceEnhancementStrength, 0.8)))
    };
    if (modelId === 'topaz-image-enhance' || modelId === 'topaz-image-enhance-gen') {
      const outputWidth = Math.max(128, Math.min(8192, Math.round(Number(source.outputWidth) || 1920)));
      const outputHeight = Math.max(128, Math.min(8192, Math.round(Number(source.outputHeight) || 1080)));
      if (outputWidth * outputHeight > 33_554_432) {
        const error = new Error('The requested Topaz output is too large.');
        error.code = 'invalid-image-tool-options';
        throw error;
      }
      options.outputWidth = outputWidth;
      options.outputHeight = outputHeight;
      options.cropToFill = source.cropToFill === true;
    }
    return options;
  }
  return {
    maskDataUrl: source.maskDataUrl,
    maskWidth: Math.max(1, Math.min(5000, Math.round(Number(source.maskWidth) || 1))),
    maskHeight: Math.max(1, Math.min(5000, Math.round(Number(source.maskHeight) || 1)))
  };
}

function normalizeButlerBackgroundOptions(requested = {}) {
  const source = requested && typeof requested === 'object' && !Array.isArray(requested) ? requested : {};
  const size = ['preview', 'medium', 'hd', 'full'].includes(String(source.size || '').toLowerCase())
    ? String(source.size).toLowerCase()
    : 'full';
  return { size, crop: source.crop === true, despill: source.despill !== false };
}

function normalizeButler3dOptions(providerId, requested = {}) {
  const source = requested && typeof requested === 'object' && !Array.isArray(requested) ? requested : {};
  const enumValue = (value, fallback, allowed) => allowed.includes(String(value || '')) ? String(value) : fallback;
  if (providerId === 'hunyuan3d') {
    const model = enumValue(source.model, '3.0', ['3.0', '3.1']);
    let generateType = enumValue(source.generateType, 'Normal', ['Normal', 'LowPoly', 'Geometry', 'Sketch']);
    if (model === '3.1' && generateType === 'LowPoly') generateType = 'Normal';
    const minimumFaces = generateType === 'LowPoly' ? 3_000 : 10_000;
    return {
      model,
      generateType,
      faceCount: Math.max(minimumFaces, Math.min(1_500_000, Math.round(Number(source.faceCount) || 500_000))),
      enablePbr: generateType !== 'Geometry' && source.enablePbr === true,
      ...(generateType === 'LowPoly'
        ? { polygonType: enumValue(source.polygonType, 'triangle', ['triangle', 'quadrilateral']) }
        : {})
    };
  }
  if (providerId === 'hyper3d') {
    const seed = source.seed === '' || source.seed === undefined ? undefined : Math.max(0, Math.min(2_147_483_647, Math.round(Number(source.seed) || 0)));
    return {
      quality: enumValue(source.quality, 'medium', ['high', 'medium', 'low', 'extra-low']),
      material: enumValue(source.material, 'PBR', ['PBR', 'Shaded']),
      tier: enumValue(source.tier, 'Regular', ['Regular', 'Sketch']),
      useHyper: source.useHyper === true,
      tPose: source.tPose === true,
      ...(seed !== undefined ? { seed } : {})
    };
  }
  const modelVersion = enumValue(source.modelVersion, 'v3.1-20260211', [
    'P1-20260311', 'Turbo-v1.0-20250506', 'v3.1-20260211', 'v3.0-20250812', 'v2.5-20250123'
  ]);
  const supportsGeometryQuality = /^v3\.[01]-/.test(modelVersion);
  const texture = source.texture !== false;
  const modelSeed = source.modelSeed === '' || source.modelSeed === undefined
    ? undefined
    : Math.max(0, Math.min(2_147_483_647, Math.round(Number(source.modelSeed) || 0)));
  const textureSeed = source.textureSeed === '' || source.textureSeed === undefined
    ? undefined
    : Math.max(0, Math.min(2_147_483_647, Math.round(Number(source.textureSeed) || 0)));
  return {
    modelVersion,
    enableImageAutofix: source.enableImageAutofix !== false,
    texture,
    pbr: texture && source.pbr !== false,
    textureAlignment: enumValue(source.textureAlignment, 'original_image', ['original_image', 'geometry']),
    textureQuality: enumValue(source.textureQuality, 'standard', ['standard', 'detailed', 'extreme']),
    orientation: enumValue(source.orientation, 'align_image', ['default', 'align_image']),
    autoSize: source.autoSize !== false,
    quad: source.quad === true,
    smartLowPoly: source.smartLowPoly === true,
    generateParts: source.generateParts === true,
    exportUv: source.exportUv !== false,
    ...(supportsGeometryQuality
      ? { geometryQuality: enumValue(source.geometryQuality, 'standard', ['standard', 'detailed']) }
      : {}),
    ...(source.faceLimit ? { faceLimit: Math.max(1_000, Math.min(500_000, Math.round(Number(source.faceLimit)))) } : {}),
    ...(modelSeed !== undefined ? { modelSeed } : {}),
    ...(texture && textureSeed !== undefined ? { textureSeed } : {})
  };
}

function normalizeButlerImageStatus(payload) {
  const raw = String(payload && payload.status || '').trim().toLowerCase().replace(/[ -]+/g, '_');
  const status = ['done', 'completed', 'complete', 'success', 'ready'].includes(raw)
    ? 'succeeded'
    : ['running', 'in_progress', 'generating'].includes(raw)
      ? 'processing'
      : raw;
  if (!['queued', 'processing', 'succeeded', 'failed'].includes(status)) {
    const error = new Error('The image gateway returned an invalid task status.');
    error.code = 'invalid-gateway-response';
    throw error;
  }
  const numeric = (key) => Number.isFinite(Number(payload && payload[key])) ? Number(payload[key]) : undefined;
  const resultCount = status === 'succeeded'
    ? Math.max(1, Math.min(8, Math.round(Number(payload && payload.resultCount) || 1)))
    : 0;
  return {
    status,
    resultCount,
    progress: Math.max(0, Math.min(100, Math.round(Number(payload && payload.progress) || (status === 'succeeded' ? 100 : 0)))),
    retryAfterMs: ['succeeded', 'failed'].includes(status)
      ? 0
      : Math.max(1_500, Math.min(30_000, Number(payload && payload.retryAfterMs) || 5_000)),
    ...(numeric('credits') !== undefined ? { credits: numeric('credits') } : {}),
    ...(numeric('providerCost') !== undefined ? { providerCost: numeric('providerCost') } : {}),
    ...(numeric('creditsCharged') !== undefined ? { creditsCharged: numeric('creditsCharged') } : {}),
    ...(numeric('creditsReleased') !== undefined ? { creditsReleased: numeric('creditsReleased') } : {}),
    ...(numeric('availableCredits') !== undefined ? { availableCredits: numeric('availableCredits') } : {}),
    ...(status === 'failed'
      ? { message: String(payload && payload.errorMessage || 'Image processing failed.') }
      : {})
  };
}

function rememberButlerImageTask(taskToken, patch = {}) {
  const previous = butlerImageTasks.get(taskToken) || {};
  butlerImageTasks.delete(taskToken);
  butlerImageTasks.set(taskToken, { ...previous, ...patch, updatedAt: Date.now() });
  while (butlerImageTasks.size > 256) {
    butlerImageTasks.delete(butlerImageTasks.keys().next().value);
  }
  return butlerImageTasks.get(taskToken);
}

function normalizeButler3dProvider(value) {
  const providerId = String(value || 'hunyuan3d').trim().toLowerCase();
  if (!BUTLER_3D_PROVIDERS.has(providerId)) {
    const error = new Error('The selected 3D provider is not supported.');
    error.code = 'invalid-3d-provider';
    throw error;
  }
  return providerId;
}

function normalizeButlerTaskToken(value) {
  const taskToken = String(value || '').trim();
  if (!/^[A-Za-z0-9._~-]{16,2048}$/.test(taskToken)) {
    const error = new Error('The 3D task token is invalid.');
    error.code = 'invalid-task-token';
    throw error;
  }
  return taskToken;
}

function normalizeButler3dStatus(payload) {
  const raw = String(payload && payload.status || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const status = [
    'accepted', 'created', 'in_queue', 'not_started', 'pending', 'pending_queue',
    'queued', 'queueing', 'submitted', 'waiting', 'waiting_to_run'
  ].includes(raw)
    ? 'queued'
    : ['creating', 'executing', 'generating', 'in_progress', 'preparing', 'processing', 'run', 'running'].includes(raw)
      ? 'processing'
      : ['complete', 'completed', 'done', 'finished', 'ready', 'success', 'succeeded'].includes(raw)
        ? 'succeeded'
        : ['aborted', 'cancelled', 'canceled', 'error', 'expired', 'fail', 'failed', 'rejected'].includes(raw)
          ? 'failed'
          : raw;
  if (!['queued', 'processing', 'succeeded', 'failed'].includes(status)) {
    const error = new Error('The 3D gateway returned an invalid task status.');
    error.code = 'invalid-gateway-response';
    throw error;
  }
  const retryAfterMs = ['succeeded', 'failed'].includes(status)
    ? 0
    : Math.max(1_500, Math.min(30_000, Number(payload && payload.retryAfterMs) || 5_000));
  const previewUrl = normalizeButlerPreviewUrl(
    payload && (payload.previewUrl || payload.previewImageUrl)
  );
  return {
    status,
    retryAfterMs,
    ...(previewUrl ? { previewUrl } : {}),
    ...(status === 'failed' ? { message: 'The 3D generation task failed.' } : {})
  };
}

function rememberButler3dTask(taskToken, patch = {}) {
  const previous = butler3dTasks.get(taskToken) || {};
  butler3dTasks.delete(taskToken);
  butler3dTasks.set(taskToken, { ...previous, ...patch, updatedAt: Date.now() });
  while (butler3dTasks.size > 128) {
    butler3dTasks.delete(butler3dTasks.keys().next().value);
  }
  return butler3dTasks.get(taskToken);
}

function normalizeButlerVideoModel(value) {
  const modelId = String(value || BUTLER_VIDEO_TOOL_ID).trim().toLowerCase();
  if (modelId !== BUTLER_VIDEO_TOOL_ID) {
    const error = new Error('The selected video tool is not supported.');
    error.code = 'invalid-video-tool';
    throw error;
  }
  return modelId;
}

function normalizeButlerVideoTaskToken(value) {
  const taskToken = String(value || '').trim();
  if (!/^[A-Za-z0-9._~-]{16,4096}$/.test(taskToken)) {
    const error = new Error('The video enhancement task is invalid.');
    error.code = 'invalid-task-token';
    throw error;
  }
  return taskToken;
}

function normalizeButlerVideoStatus(payload) {
  const raw = String(payload && payload.status || '').trim().toLowerCase().replace(/[ -]+/g, '_');
  const status = ['done', 'completed', 'complete', 'success'].includes(raw)
    ? 'succeeded'
    : ['running', 'in_progress', 'encoding', 'enhancing'].includes(raw)
      ? 'processing'
      : raw;
  if (!['queued', 'processing', 'succeeded', 'failed'].includes(status)) {
    const error = new Error('The video gateway returned an invalid task status.');
    error.code = 'invalid-gateway-response';
    throw error;
  }
  const retryAfterMs = ['succeeded', 'failed'].includes(status)
    ? 0
    : Math.max(1_500, Math.min(30_000, Number(payload && payload.retryAfterMs) || 5_000));
  const progress = Math.max(0, Math.min(100, Math.round(Number(payload && payload.progress) || (status === 'succeeded' ? 100 : 0))));
  const numeric = (key) => Number.isFinite(Number(payload && payload[key])) ? Number(payload[key]) : undefined;
  return {
    status,
    progress,
    retryAfterMs,
    ...(numeric('credits') !== undefined ? { credits: numeric('credits') } : {}),
    ...(numeric('providerCost') !== undefined ? { providerCost: numeric('providerCost') } : {}),
    ...(numeric('creditsCharged') !== undefined ? { creditsCharged: numeric('creditsCharged') } : {}),
    ...(numeric('creditsReleased') !== undefined ? { creditsReleased: numeric('creditsReleased') } : {}),
    ...(numeric('availableCredits') !== undefined ? { availableCredits: numeric('availableCredits') } : {}),
    ...(status === 'failed' ? { message: String(payload && payload.errorMessage || 'Video enhancement failed.') } : {})
  };
}

function rememberButlerVideoTask(taskToken, patch = {}) {
  const previous = butlerVideoTasks.get(taskToken) || {};
  butlerVideoTasks.delete(taskToken);
  butlerVideoTasks.set(taskToken, { ...previous, ...patch, updatedAt: Date.now() });
  while (butlerVideoTasks.size > 128) {
    butlerVideoTasks.delete(butlerVideoTasks.keys().next().value);
  }
  return butlerVideoTasks.get(taskToken);
}

function butlerFailure(error, fallbackMessage) {
  const rawCode = String(error && error.code || 'butler-request-failed');
  const reason = /^[a-z0-9-]{1,80}$/.test(rawCode) ? rawCode : 'butler-request-failed';
  const knownMessages = {
    'auth-required': 'Sign in to use Butler.',
    'gateway-not-configured': 'Butler is not configured in this build.',
    'gateway-timeout': 'Butler timed out. Please try again.',
    'file-not-found': 'The selected image could not be found.',
    'privacy-blocked': 'Only archived library images can be sent to Butler.',
    'unsupported-file-type': 'Butler requires an image file.',
    'unsupported-image-dimensions': 'The image proportions are outside the supported 3D range.',
    'butler-image-too-large': 'The image could not be reduced to the supported upload size.',
    'invalid-butler-image': 'The selected image could not be prepared safely.',
    'invalid-image-mask': 'Draw a valid erase mask before starting.',
    'invalid-image-tool': 'The selected image tool is not supported.',
    'invalid-image-tool-options': 'One or more image-tool settings are not supported.',
    'invalid-background-options': 'The selected background-removal settings are not supported.',
    'image-tool-task-not-found': 'The image task was not found or has expired.',
    'image-tool-task-not-ready': 'The processed image is not ready yet.',
    'image-tool-failed': 'Image processing failed.',
    'invalid-3d-provider': 'The selected 3D provider is not supported.',
    'invalid-three-d-options': 'One or more 3D settings are not supported by this model.',
    'invalid-task-token': 'The 3D task is invalid.',
    'invalid-glb': 'The 3D provider returned an invalid model file.',
    'invalid-background-image': 'The background service returned an invalid image.',
    'unsupported-video-type': 'Video enhancement supports MP4, MOV, WebM, and Matroska files.',
    'unsupported-video-dimensions': 'The video dimensions are outside the supported range.',
    'butler-video-too-large': 'The video exceeds the Butler upload size limit.',
    'invalid-butler-video': 'The selected video could not be prepared safely.',
    'invalid-video-tool': 'The selected video tool is not supported.',
    'invalid-video-upscale-options': 'One or more video enhancement settings are not supported.',
    'video-tool-task-not-found': 'The video enhancement task was not found or has expired.',
    'video-tool-task-not-ready': 'The enhanced video is not ready yet.',
    'video-upscale-failed': 'Video enhancement failed.',
    'video-upscale-request-rejected': 'Topaz rejected this video or output combination. Try Proteus 4 with H.264 or H.265.',
    'video-upload-not-found': 'The video upload expired. Please start the enhancement again.',
    'video-upload-incomplete': 'The video upload was interrupted. Please try again.',
    'invalid-video-upload-chunk': 'Part of the video upload was rejected. Please try again.',
    'video-upload-chunk-conflict': 'The video upload retry did not match the original data. Please start again.',
    'insufficient-credits': 'There are not enough points for this Butler request.',
    'account-suspended': 'This account cannot start paid AI tasks.',
    'credit-service-not-configured': 'The points service is not configured on the server.',
    'credit-schema-missing': 'The points service is being upgraded. Please try again shortly.',
    'credit-service-failed': 'The points balance could not be checked. Please try again.',
    'provider-auth-failed': 'The video provider rejected the server credential. Ask the administrator to update it.',
    'ai302-unauthorized': 'The 302 gateway credential is invalid. Ask the administrator to update it.',
    'ai302-balance-exhausted': 'The 302 account balance is insufficient.',
    'ai302-rate-limited': 'The 302 service is busy. Please try again shortly.',
    'ai302-timeout': 'The 302 service did not finish in time. This request was not submitted again automatically.',
    'ai302-unavailable': 'The 302 service is temporarily unavailable. Please try again later.',
    'ai302-upstream-error': 'The 302 service rejected this request.',
    'ai302-invalid-response': 'The 302 video service returned an unsupported response. Please try again.',
    'ai302-not-configured': 'The 302 video service is not configured on the server.',
    'tool-disabled': 'Video enhancement is not enabled on the server.',
    'tool-public-url-not-configured': 'The gateway public URL is required for this tool.',
    'tool-asset-capacity-exceeded': 'The video upload relay is busy. Please try again shortly.',
    'body-too-large': 'The video exceeds the gateway upload size limit.',
    'invalid-gateway-response': 'The secure AI gateway returned an invalid response.',
    'gateway-request-failed': 'The secure AI gateway could not start this request.',
    'media-too-large': 'The generated result exceeds the safe download size.',
    'rate-limited': 'Too many Butler requests. Please wait and try again.'
  };
  const httpStatus = Number(error && error.status);
  return {
    ok: false,
    reason,
    message: knownMessages[reason] || fallbackMessage,
    ...(Number.isInteger(httpStatus) && httpStatus >= 400 && httpStatus <= 599 ? { httpStatus } : {})
  };
}

function registerIpcHandlers() {
  ipcMain.on('window:readyForInteraction', (event) => {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return;
    revealMainWindow();
  });

  ipcMain.on('window:syncThemeSurface', (event, theme) => {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return;
    setWindowBackgroundColor(theme);
  });

  ipcMain.handle('app:getInitialState', async () => {
    pruneMissingFiles();
    // Disk probes and cloud refreshes are maintenance, not prerequisites for
    // clicking the canvas. Defer them until after the interactive first paint.
    setTimeout(() => {
      syncGatewayAccount({ background: true }).catch((error) => {
        console.warn('Deferred gateway account sync failed:', error && error.message || error);
      });
    }, 400);
    setTimeout(() => {
      hydrateMissingMediaMetadata().catch((error) => {
        console.warn('Deferred media metadata hydration failed:', error && error.message || error);
      });
    }, 4_000);
    return {
      theme: store.data.settings.theme,
      language: currentLanguage(),
      autoUpdateEnabled: store.data.settings.autoUpdateEnabled !== false,
      activation: activationStatusForRenderer(),
      viewMode: store.data.settings.viewMode,
      sidebarCollapsed: store.data.settings.sidebarCollapsed,
      defaultFolderName: store.data.settings.defaultFolderName,
      profileDisplayName: store.data.settings.profileDisplayName || '',
      profileSignature: store.data.settings.profileSignature || '',
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
    store.data.settings.theme = normalizeTheme(theme);
    setWindowBackgroundColor(store.data.settings.theme);
    store.scheduleSave();
    return store.data.settings.theme;
  });

  ipcMain.handle('activation:getStatus', async () => {
    await syncGatewayAccount();
    return activationStatusForRenderer();
  });

  ipcMain.handle('activation:activate', async (_evt, code) => {
    if (runtimeConfig && runtimeConfig.gatewayConfigured) {
      const normalizedCode = String(code || '').trim();
      if (!normalizedCode || normalizedCode.length > 256) {
        return { ok: false, reason: 'invalid-redemption-code', message: 'Enter a valid redemption code.' };
      }
      if (!hasAuthenticatedGatewaySession()) {
        return {
          ok: false,
          reason: 'sign-in-required',
          message: 'Sign in to your Messs account before redeeming this code.'
        };
      }
      try {
        // In production the server owns the redemption catalogue. Do not run
        // the bundled beta-code allowlist first: future recharge/member codes
        // must work without requiring an old desktop client update.
        const cloudResult = await aiGateway.redeemCode(normalizedCode);
        const redemption = cloudResult && cloudResult.redemption || {};
        const membership = applyGatewayAccount(cloudResult && cloudResult.account || redemption.account);
        store.data.settings.activation = {
          schemaVersion: 2,
          verifiedHash: null,
          grantId: 'cloud-redemption',
          activatedAt: new Date().toISOString(),
          cloudRedeemed: true
        };
        store.scheduleSave();
        gatewayCatalogCache = null;
        // Force the next catalogue request to see the newly unlocked account;
        // applyGatewayAccount already made the balance/activation UI current.
        const status = activationStatusForRenderer();
        return {
          ok: true,
          ...status,
          creditsAdded: Math.max(0, Number(redemption.creditsAdded) || 0),
          redemptionReason: redemption.reason === 'already-redeemed' ? 'already-redeemed' : null,
          membership
        };
      } catch (error) {
        return {
          ok: false,
          reason: error && error.code || 'redemption-service-failed',
          message: error && error.message || 'Could not redeem the code.'
        };
      }
    }

    // Direct/local development keeps the deterministic bundled allowlist.
    const candidateSettings = {
      activation: store.data.settings.activation && { ...store.data.settings.activation }
    };
    const result = activateApp(candidateSettings, code);
    if (!result.ok) return result;
    const redemption = result.grant ? membershipService.redeemGrant(result.grant) : null;
    store.data.settings.activation = candidateSettings.activation;
    store.scheduleSave();
    return {
      ...result,
      ...activationStatusForRenderer(),
      grant: undefined,
      creditsAdded: redemption ? redemption.creditsAdded : 0,
      redemptionReason: redemption && !redemption.ok ? redemption.reason : null,
      membership: membershipService.getSnapshot()
    };
  });

  ipcMain.handle('ai:exportChat', async (_evt, value = {}) => {
    const title = String(value.title || 'Conversation').trim().slice(0, 80) || 'Conversation';
    const messages = Array.isArray(value.messages)
      ? value.messages.slice(0, 100).map((message) => ({
        role: message && message.role === 'assistant' ? 'assistant' : 'user',
        content: String(message && message.content || '').slice(0, 20000)
      }))
      : [];
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export conversation',
      defaultPath: `${canvasFolderName(title)}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    const markdown = [
      `# ${title}`,
      '',
      ...messages.flatMap((message) => [
        `## ${message.role === 'assistant' ? 'Messs AI' : 'You'}`,
        '',
        message.content,
        ''
      ])
    ].join('\n');
    await fs.promises.writeFile(result.filePath, markdown, 'utf8');
    return { ok: true, filePath: result.filePath };
  });

  ipcMain.handle('settings:setLanguage', (_evt, language) => {
    store.data.settings.language = normalizeLanguage(language);
    store.scheduleSave();
    updateTrayMenu();
    return store.data.settings.language;
  });

  ipcMain.handle('profile:setDisplayName', (_evt, value) => {
    const name = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!name) return { ok: false, reason: 'empty-name' };
    store.data.settings.profileDisplayName = name;
    store.scheduleSave();
    return { ok: true, value: name };
  });

  ipcMain.handle('profile:setSignature', (_evt, value) => {
    const signature = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    store.data.settings.profileSignature = signature;
    store.scheduleSave();
    return { ok: true, value: signature };
  });

  ipcMain.handle('auth:getSession', () => supabaseAuth.getPublicSession());

  ipcMain.handle('auth:signIn', async (_evt, credentials = {}) => {
    const session = await supabaseAuth.signIn(credentials.email, credentials.password);
    if (session && session.authenticated) {
      clearGatewayAccount();
      gatewayCatalogCache = null;
      await chatService.initialize();
      await syncGatewayAccount({ force: true });
    }
    return session;
  });

  ipcMain.handle('auth:signUp', async (_evt, credentials = {}) => {
    const session = await supabaseAuth.signUp(credentials.email, credentials.password);
    if (session && session.authenticated) {
      clearGatewayAccount();
      gatewayCatalogCache = null;
      await chatService.initialize();
      await syncGatewayAccount({ force: true });
    }
    return session;
  });

  ipcMain.handle('auth:signInWithGoogle', async () => {
    const session = await signInWithGoogle();
    if (session && session.authenticated) {
      clearGatewayAccount();
      gatewayCatalogCache = null;
      await chatService.initialize();
      await syncGatewayAccount({ force: true });
    }
    return session;
  });

  ipcMain.handle('auth:signOut', async () => {
    const session = await supabaseAuth.signOut();
    if (chatService) await chatService.signOut();
    clearGatewayAccount();
    gatewayCatalogCache = null;
    return session;
  });

  ipcMain.handle('chat:initialize', () => chatService.initialize());

  ipcMain.handle('chat:sync', () => chatService.sync());

  ipcMain.handle('chat:searchUser', (_evt, query) => chatService.searchUser(query));

  ipcMain.handle('chat:sendFriendRequest', (_evt, targetId) => chatService.sendFriendRequest(targetId));

  ipcMain.handle('chat:respondFriendRequest', (_evt, requestId, action) => {
    return chatService.respondFriendRequest(requestId, action);
  });

  ipcMain.handle('chat:startConversation', (_evt, friendId) => chatService.startConversation(friendId));

  ipcMain.handle('chat:getHistory', (_evt, conversationId, options = {}) => {
    return chatService.getHistory(conversationId, options);
  });

  ipcMain.handle('chat:loadOlderRemote', (_evt, conversationId, options = {}) => {
    return chatService.loadOlderRemote(conversationId, options);
  });

  ipcMain.handle('chat:sendText', (_evt, conversationId, body) => {
    return chatService.sendText(conversationId, body);
  });

  ipcMain.handle('chat:sendImage', async (_evt, conversationId) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Send an image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'tif', 'tiff', 'bmp'] }]
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, reason: 'cancelled' };
    try { return await chatService.sendImage(conversationId, result.filePaths[0]); }
    catch (error) { return { ok: false, reason: error.code || 'image-send-failed', message: error.message }; }
  });

  ipcMain.handle('chat:retryMessage', (_evt, clientId) => chatService.retryMessage(clientId));

  ipcMain.handle('chat:recallMessage', (_evt, clientId) => chatService.recallMessage(clientId));

  ipcMain.handle('chat:getImageDataUrl', (_evt, clientId) => chatService.getImageDataUrl(clientId));

  ipcMain.handle('membership:getSnapshot', async () => {
    await syncGatewayAccount();
    return membershipService.getSnapshot();
  });

  ipcMain.handle('chat:sendFile', async (_evt, conversationId) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Send a file',
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, reason: 'cancelled' };
    try { return await chatService.sendFile(conversationId, result.filePaths[0]); }
    catch (error) { return { ok: false, reason: error.code || 'file-send-failed', message: error.message }; }
  });

  ipcMain.handle('chat:sendScreenshot', async (_evt, conversationId) => {
    let temporaryPath = null;
    try {
      const primary = screen.getPrimaryDisplay();
      const scale = Number(primary.scaleFactor) || 1;
      const size = {
        width: Math.max(1, Math.round(primary.size.width * scale)),
        height: Math.max(1, Math.round(primary.size.height * scale))
      };
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
      const source = sources.find((item) => String(item.display_id) === String(primary.id)) || sources[0];
      if (!source || source.thumbnail.isEmpty()) return { ok: false, reason: 'capture-failed', message: 'Unable to capture the screen.' };
      const directory = path.join(app.getPath('temp'), 'messs-chat-captures');
      temporaryPath = path.join(directory, `screenshot-${Date.now()}-${crypto.randomUUID()}.png`);
      await fs.promises.mkdir(directory, { recursive: true });
      await fs.promises.writeFile(temporaryPath, source.thumbnail.toPNG());
      return await chatService.sendImage(conversationId, temporaryPath);
    } catch (error) {
      return { ok: false, reason: error.code || 'capture-failed', message: error.message };
    } finally {
      if (temporaryPath) await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
    }
  });

  ipcMain.handle('chat:openFile', async (_evt, clientId) => {
    const result = await chatService.getFileLocalPath(clientId);
    if (!result.ok) return result;
    const errorMessage = await shell.openPath(result.path);
    return errorMessage ? { ok: false, reason: 'open-failed', message: errorMessage } : { ok: true };
  });

  ipcMain.handle('membership:getUsageSummary', async (_evt, range = '7d') => {
    const session = supabaseAuth.getPublicSession();
    if (!session || !session.authenticated || !session.user) {
      return { authenticated: false, summary: null };
    }
    const summary = await aiGateway.getUsageSummary(range);
    return {
      authenticated: true,
      user: {
        id: session.user.id,
        email: session.user.email || null,
        displayName: session.user.displayName || session.user.display_name || null
      },
      summary
    };
  });

  ipcMain.handle('membership:checkFeature', (_evt, feature) => {
    return membershipService.checkFeature(String(feature || '').trim());
  });

  ipcMain.handle('membership:quoteMedia', (_evt, request = {}) => quoteMediaCredits(request));

  ipcMain.handle('profile:getAvatar', () => readProfileAvatarDataUrl());

  ipcMain.handle('profile:chooseAvatar', () => chooseProfileAvatar());

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
  ipcMain.handle('ai:getImageStyles', async (_evt, providerId) => {
    if (!runtimeConfig.gatewayConfigured) return { providerId, styles: [] };
    await requireGatewayProvider('image', providerId);
    return aiGateway.getImageStyles(providerId);
  });

  ipcMain.handle('settings:discoverAiModels', async (_evt, request = {}) => {
    if (runtimeConfig.gatewayConfigured) {
      try {
        await requireGatewayProvider('chat', String(request.providerId || 'chat-1'));
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
        message: err && err.message ? err.message : localizedMessage(
          'Could not load the model list automatically.',
          '无法自动读取模型列表。',
          '모델 목록을 자동으로 불러오지 못했습니다.'
        ),
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
      providerDefaultsVersion: PROVIDER_CATALOG_VERSION,
      imageEndpoint: normalized.imageEndpoint,
      imageProviders,
      activeImageProviderId,
      videoEndpoint: normalized.videoEndpoint,
      videoProviderName: activeVideoProvider.name || DEFAULT_CATALOG_VIDEO.name,
      videoProviders,
      activeVideoProviderId,
      chatProviders,
      activeChatProviderId,
      chatProviderName: activeChatProvider.name || 'Messs AI',
      chatEndpoint: activeChatProvider.endpoint,
      chatModel: activeChatProvider.models[0] || DEFAULT_CATALOG_CHAT.models[0],
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

  ipcMain.handle('clipboard:importImage', async (_evt, request = {}) => {
    const nativeFilePaths = process.platform === 'win32'
      ? parseCfHDrop(clipboard.readBuffer('CF_HDROP'))
      : [];
    const sources = extractClipboardImageSources({
      html: String(request.html || '') || clipboard.readHTML(),
      text: String(request.text || '') || clipboard.readText()
    });
    const localPaths = [...nativeFilePaths, ...sources.map(clipboardSourceToLocalPath).filter(Boolean)];
    const copiedImagePath = localPaths.find((filePath) => {
      try {
        return preview.isImageExt(path.extname(filePath).toLowerCase()) && fs.statSync(filePath).isFile();
      } catch (error) {
        return false;
      }
    });
    const folderId = request.folderId && request.folderId !== 'default'
      ? String(request.folderId)
      : null;
    const canvasId = String(request.canvasId || '').trim() || null;
    if (copiedImagePath) {
      const unlockedKeys = new Set();
      const record = await importOneFile(
        copiedImagePath,
        folderId,
        unlockedKeys,
        achievements.todayStr(),
        canvasId
      );
      if (!record) return { ok: false, reason: 'invalid-image' };
      record.originalPath = 'Clipboard';
      record.sourceFolder = 'Clipboard';
      store.scheduleSave();
      if (unlockedKeys.size > 0) notifyAchievements();
      return { ok: true, file: fileToPayload(record) };
    }

    const requestBuffer = clipboardDataImageBuffer(request.dataUrl);
    if (requestBuffer) {
      const canonical = await canonicalClipboardPng(requestBuffer);
      return importClipboardPng(canonical.png, request, canonical.dimensions);
    }

    const nativeImage = clipboard.readImage();
    if (nativeImage && !nativeImage.isEmpty()) {
      const nativePng = nativeImage.toPNG();
      if (nativePng && nativePng.length) {
        const dimensions = nativeImage.getSize();
        const canonical = await canonicalClipboardPng(nativePng);
        return importClipboardPng(canonical.png, request, dimensions.width > 0 && dimensions.height > 0
          ? dimensions
          : canonical.dimensions);
      }
    }

    let sourceError = null;
    for (const source of sources) {
      try {
        const dataBuffer = clipboardDataImageBuffer(source);
        if (dataBuffer) {
          const canonical = await canonicalClipboardPng(dataBuffer);
          return importClipboardPng(canonical.png, request, canonical.dimensions);
        }
        const remoteUrl = normalizeClipboardRemoteUrl(source);
        if (!remoteUrl) continue;
        const remoteBuffer = await downloadClipboardImage(remoteUrl);
        const canonical = await canonicalClipboardPng(remoteBuffer);
        return importClipboardPng(canonical.png, request, canonical.dimensions);
      } catch (error) {
        sourceError = error;
      }
    }

    if (sourceError) throw sourceError;
    return { ok: false, reason: 'empty' };
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

  ipcMain.handle('butler:removeBackground', async (_evt, fileId, requestedOptions = {}) => {
    try {
      if (!aiGateway || !aiGateway.isConfigured()) {
        const error = new Error('Butler is not configured.');
        error.code = 'gateway-not-configured';
        throw error;
      }
      const options = normalizeButlerBackgroundOptions(requestedOptions);
      const source = await butlerSourceImage(fileId);
      const responseBuffer = await aiGateway.removeBackground(source.imageDataUrl, options);
      const pngBuffer = await sanitizeButlerBackgroundPng(responseBuffer);
      const record = await addButlerOutputFile(pngBuffer, source.file, 'remove-background');
      return { ok: true, file: fileToPayload(record) };
    } catch (error) {
      const failure = butlerFailure(error, 'Background removal failed. Please try again.');
      console.error('Butler background removal failed:', failure.reason);
      return failure;
    }
  });

  ipcMain.handle('butler:image-edit', async (_evt, fileId, requestedOptions = {}) => {
    try {
      if (!aiGateway || !aiGateway.isConfigured()) {
        const error = new Error('Butler is not configured.');
        error.code = 'gateway-not-configured';
        throw error;
      }
      const modelId = 'qwen-image-edit-plus';
      const options = normalizeButlerImageOptions(modelId, requestedOptions);
      const source = await butlerSourceImage(fileId);
      const payload = await aiGateway.editImage(source.imageDataUrl, options);
      const taskToken = normalizeButlerTaskToken(payload && payload.taskToken);
      const status = normalizeButlerImageStatus(payload || { status: 'queued' });
      rememberButlerImageTask(taskToken, {
        sourceFileId: source.file.id,
        modelId,
        operation: 'image-edit',
        resultCount: status.resultCount,
        credits: status.credits !== undefined ? status.credits : BUTLER_IMAGE_TOOL_CREDITS[modelId],
        status: status.status
      });
      return { ok: true, taskToken, ...status };
    } catch (error) {
      const failure = butlerFailure(error, 'The image edit task could not be started.');
      console.error('Butler image edit failed:', failure.reason);
      return failure;
    }
  });

  ipcMain.handle('butler:image-layer', async (_evt, fileId, requestedOptions = {}) => {
    try {
      if (!aiGateway || !aiGateway.isConfigured()) {
        const error = new Error('Butler is not configured.');
        error.code = 'gateway-not-configured';
        throw error;
      }
      const modelId = 'qwen-image-layered';
      const options = normalizeButlerImageOptions(modelId, requestedOptions);
      const source = await butlerSourceImage(fileId);
      const payload = await aiGateway.layerImage(source.imageDataUrl, options);
      const taskToken = normalizeButlerTaskToken(payload && payload.taskToken);
      const status = normalizeButlerImageStatus(payload || { status: 'queued' });
      rememberButlerImageTask(taskToken, {
        sourceFileId: source.file.id,
        modelId,
        operation: 'image-layer',
        resultCount: status.resultCount,
        credits: status.credits !== undefined ? status.credits : BUTLER_IMAGE_TOOL_CREDITS[modelId],
        status: status.status
      });
      return { ok: true, taskToken, ...status };
    } catch (error) {
      const failure = butlerFailure(error, 'The image layer task could not be started.');
      console.error('Butler image layer failed:', failure.reason);
      return failure;
    }
  });

  ipcMain.handle('butler:image-tool-run', async (_evt, fileId, requestedModelId, requestedOptions = {}) => {
    try {
      if (!aiGateway || !aiGateway.isConfigured()) {
        const error = new Error('Butler is not configured.');
        error.code = 'gateway-not-configured';
        throw error;
      }
      const modelId = normalizeButlerImageTool(requestedModelId);
      if (!modelId.startsWith('topaz-image-')) {
        const error = new Error('The selected asynchronous image tool is not supported.');
        error.code = 'invalid-image-tool';
        throw error;
      }
      const options = normalizeButlerImageOptions(modelId, requestedOptions);
      const source = await butlerSourceImage(fileId);
      const payload = await aiGateway.runImageTool(source.imageDataUrl, modelId, options);
      const taskToken = normalizeButlerTaskToken(payload && payload.taskToken);
      const status = normalizeButlerImageStatus(payload || { status: 'queued' });
      rememberButlerImageTask(taskToken, {
        sourceFileId: source.file.id,
        modelId,
        operation: modelId,
        resultCount: status.resultCount,
        credits: status.credits,
        providerCost: status.providerCost,
        status: status.status
      });
      return { ok: true, taskToken, ...status };
    } catch (error) {
      const failure = butlerFailure(error, 'The Topaz image task could not be started.');
      console.error('Butler Topaz image task failed:', failure.reason);
      return failure;
    }
  });

  ipcMain.handle('butler:image-upscale', async (_evt, fileId, requestedOptions = {}) => {
    try {
      if (!aiGateway || !aiGateway.isConfigured()) {
        const error = new Error('Butler is not configured.');
        error.code = 'gateway-not-configured';
        throw error;
      }
      const modelId = 'super-upscale-v2';
      const options = normalizeButlerImageOptions(modelId, requestedOptions);
      const source = await butlerSourceImage(fileId);
      const responseBuffer = await aiGateway.upscaleImage(source.imageDataUrl, options);
      const pngBuffer = await sanitizeButlerImagePng(responseBuffer);
      const record = await addButlerOutputFile(pngBuffer, source.file, 'image-upscale', {
        modelId,
        credits: BUTLER_IMAGE_TOOL_CREDITS[modelId]
      });
      if (runtimeConfig.gatewayConfigured) await syncGatewayAccount({ force: true });
      return { ok: true, file: fileToPayload(record) };
    } catch (error) {
      const failure = butlerFailure(error, 'The image could not be upscaled.');
      console.error('Butler image upscale failed:', failure.reason);
      return failure;
    }
  });

  ipcMain.handle('butler:image-erase', async (_evt, fileId, requestedOptions = {}) => {
    try {
      if (!aiGateway || !aiGateway.isConfigured()) {
        const error = new Error('Butler is not configured.');
        error.code = 'gateway-not-configured';
        throw error;
      }
      const modelId = 'erase';
      const options = normalizeButlerImageOptions(modelId, requestedOptions);
      const [source, mask] = await Promise.all([
        butlerSourceImage(fileId),
        sanitizeButlerMaskDataUrl(options.maskDataUrl)
      ]);
      const responseBuffer = await aiGateway.eraseObject(source.imageDataUrl, mask.dataUrl, {
        maskWidth: mask.width,
        maskHeight: mask.height
      });
      const pngBuffer = await sanitizeButlerImagePng(responseBuffer);
      const record = await addButlerOutputFile(pngBuffer, source.file, 'image-erase', {
        modelId,
        credits: BUTLER_IMAGE_TOOL_CREDITS[modelId]
      });
      if (runtimeConfig.gatewayConfigured) await syncGatewayAccount({ force: true });
      return { ok: true, file: fileToPayload(record) };
    } catch (error) {
      const failure = butlerFailure(error, 'The selected object could not be erased.');
      console.error('Butler object erase failed:', failure.reason);
      return failure;
    }
  });

  ipcMain.handle('butler:image-tool-status', async (_evt, rawTaskToken, requestedModelId) => {
    try {
      if (!aiGateway || !aiGateway.isConfigured()) {
        const error = new Error('Butler is not configured.');
        error.code = 'gateway-not-configured';
        throw error;
      }
      const taskToken = normalizeButlerTaskToken(rawTaskToken);
      const modelId = normalizeButlerImageTool(requestedModelId);
      const existing = butlerImageTasks.get(taskToken) || {};
      if (existing.modelId && existing.modelId !== modelId) {
        const error = new Error('The image task model does not match.');
        error.code = 'invalid-image-tool';
        throw error;
      }
      const payload = await aiGateway.getImageToolStatus(taskToken, modelId);
      const status = normalizeButlerImageStatus(payload);
      rememberButlerImageTask(taskToken, {
        modelId,
        status: status.status,
        resultCount: status.resultCount || existing.resultCount,
        credits: status.credits !== undefined ? status.credits : existing.credits,
        providerCost: status.providerCost !== undefined ? status.providerCost : existing.providerCost,
        creditsCharged: status.creditsCharged !== undefined ? status.creditsCharged : existing.creditsCharged
      });
      if (['succeeded', 'failed'].includes(status.status) && runtimeConfig.gatewayConfigured) {
        await syncGatewayAccount({ force: true });
      }
      return { ok: true, ...status };
    } catch (error) {
      const failure = butlerFailure(error, 'The image task status could not be checked.');
      console.error('Butler image task status failed:', failure.reason);
      return failure;
    }
  });

  ipcMain.handle('butler:image-tool-download', async (_evt, rawTaskToken, requestedModelId) => {
    let taskToken;
    try {
      if (!aiGateway || !aiGateway.isConfigured()) {
        const error = new Error('Butler is not configured.');
        error.code = 'gateway-not-configured';
        throw error;
      }
      taskToken = normalizeButlerTaskToken(rawTaskToken);
      const modelId = normalizeButlerImageTool(requestedModelId);
      const task = butlerImageTasks.get(taskToken) || {};
      if (task.modelId && task.modelId !== modelId) {
        const error = new Error('The image task model does not match.');
        error.code = 'invalid-image-tool';
        throw error;
      }
      const existingFiles = Array.isArray(task.downloadedFileIds)
        ? task.downloadedFileIds.map((id) => store.getFile(id)).filter(Boolean)
        : [];
      if (existingFiles.length) {
        return { ok: true, files: existingFiles.map(fileToPayload) };
      }
      if (butlerImageDownloads.has(taskToken)) return await butlerImageDownloads.get(taskToken);

      const download = (async () => {
        const resultCount = Math.max(1, Math.min(8, Math.round(Number(task.resultCount) || 1)));
        const buffers = await aiGateway.downloadImageToolResult(taskToken, modelId, resultCount);
        const currentTask = butlerImageTasks.get(taskToken) || task;
        const sourceFile = store.getFile(currentTask.sourceFileId) || {
          id: null,
          name: 'Processed image',
          folderId: null,
          canvasId: store.data.canvases[0] && store.data.canvases[0].id
        };
        const operation = currentTask.operation || (modelId === 'qwen-image-layered' ? 'image-layer' : 'image-edit');
        const records = [];
        for (const buffer of buffers) {
          const pngBuffer = await sanitizeButlerImagePng(buffer);
          records.push(await addButlerOutputFile(pngBuffer, sourceFile, operation, {
            modelId,
            credits: currentTask.creditsCharged !== undefined ? currentTask.creditsCharged : currentTask.credits
          }));
        }
        rememberButlerImageTask(taskToken, {
          ...currentTask,
          modelId,
          downloadedFileIds: records.map((record) => record.id),
          status: 'succeeded'
        });
        if (runtimeConfig.gatewayConfigured) await syncGatewayAccount({ force: true });
        return { ok: true, files: records.map(fileToPayload) };
      })();
      butlerImageDownloads.set(taskToken, download);
      try {
        return await download;
      } finally {
        butlerImageDownloads.delete(taskToken);
      }
    } catch (error) {
      const failure = butlerFailure(error, 'The processed image could not be downloaded.');
      console.error('Butler image download failed:', failure.reason);
      return failure;
    }
  });

  ipcMain.handle('butler:create3d', async (_evt, fileId, requestedProviderId, requestedOptions = {}) => {
    try {
      if (!aiGateway || !aiGateway.isConfigured()) {
        const error = new Error('Butler is not configured.');
        error.code = 'gateway-not-configured';
        throw error;
      }
      const providerId = normalizeButler3dProvider(requestedProviderId);
      const options = normalizeButler3dOptions(providerId, requestedOptions);
      const source = await butlerSourceImage(fileId, { requireModelDimensions: true });
      const fallbackPrompt = 'Create a detailed 3D model matching the reference image.';
      const storedPrompt = String(source.file.aiGeneration && source.file.aiGeneration.prompt || '').trim();
      const prompt = storedPrompt ? storedPrompt.slice(0, 1024) : fallbackPrompt;
      assertPromptHasNoSecrets(prompt);
      const requestedPrompt = String(requestedOptions && requestedOptions.prompt || '').trim();
      const effectivePrompt = requestedPrompt || prompt;
      assertPromptHasNoSecrets(effectivePrompt);
      const payload = await aiGateway.create3d(providerId, source.imageDataUrl, effectivePrompt, options);
      const taskToken = normalizeButlerTaskToken(payload && payload.taskToken);
      const status = normalizeButler3dStatus({ status: 'queued', ...(payload || {}) });
      rememberButler3dTask(taskToken, {
        sourceFileId: source.file.id,
        providerId,
        previewUrl: status.previewUrl || '',
        credits: status.credits
      });
      return { ok: true, taskToken, ...status };
    } catch (error) {
      const failure = butlerFailure(error, 'The 3D generation task could not be started.');
      console.error('Butler 3D task creation failed:', failure.reason);
      return failure;
    }
  });

  ipcMain.handle('butler:get3dStatus', async (_evt, rawTaskToken, requestedProviderId) => {
    try {
      if (!aiGateway || !aiGateway.isConfigured()) {
        const error = new Error('Butler is not configured.');
        error.code = 'gateway-not-configured';
        throw error;
      }
      const taskToken = normalizeButlerTaskToken(rawTaskToken);
      const existing = butler3dTasks.get(taskToken) || null;
      if (requestedProviderId !== undefined && requestedProviderId !== null && String(requestedProviderId).trim()) {
        const providerId = normalizeButler3dProvider(requestedProviderId);
        if (existing && existing.providerId && existing.providerId !== providerId) {
          const error = new Error('The 3D task provider does not match.');
          error.code = 'invalid-3d-provider';
          throw error;
        }
      }
      const payload = await aiGateway.get3dStatus(taskToken);
      const status = normalizeButler3dStatus(payload);
      rememberButler3dTask(taskToken, {
        ...(status.previewUrl ? { previewUrl: status.previewUrl } : {}),
        status: status.status,
        credits: status.credits !== undefined ? status.credits : existing && existing.credits,
        creditsCharged: status.creditsCharged !== undefined ? status.creditsCharged : existing && existing.creditsCharged
      });
      return { ok: true, ...status };
    } catch (error) {
      const failure = butlerFailure(error, 'The 3D task status could not be checked.');
      console.error('Butler 3D status failed:', failure.reason);
      return failure;
    }
  });

  ipcMain.handle('butler:download3d', async (_evt, rawTaskToken, requestedProviderId) => {
    let taskToken;
    try {
      if (!aiGateway || !aiGateway.isConfigured()) {
        const error = new Error('Butler is not configured.');
        error.code = 'gateway-not-configured';
        throw error;
      }
      taskToken = normalizeButlerTaskToken(rawTaskToken);
      const task = butler3dTasks.get(taskToken) || {};
      if (requestedProviderId !== undefined && requestedProviderId !== null && String(requestedProviderId).trim()) {
        const providerId = normalizeButler3dProvider(requestedProviderId);
        if (task.providerId && task.providerId !== providerId) {
          const error = new Error('The 3D task provider does not match.');
          error.code = 'invalid-3d-provider';
          throw error;
        }
      }
      if (task.downloadedFileId) {
        const existingFile = store.getFile(task.downloadedFileId);
        if (existingFile) return { ok: true, file: fileToPayload(existingFile) };
      }
      if (butler3dDownloads.has(taskToken)) return await butler3dDownloads.get(taskToken);

      const download = (async () => {
        const buffer = await aiGateway.download3d(taskToken);
        assertValidGlbBuffer(buffer);
        const currentTask = butler3dTasks.get(taskToken) || task;
        const sourceFile = store.getFile(currentTask.sourceFileId) || {
          id: null,
          name: 'Generated model',
          folderId: null,
          canvasId: store.data.canvases[0] && store.data.canvases[0].id
        };
        const record = await addButlerOutputFile(buffer, sourceFile, 'generate-3d', {
          modelId: currentTask.providerId,
          credits: currentTask.creditsCharged !== undefined ? currentTask.creditsCharged : currentTask.credits
        });
        rememberButler3dTask(taskToken, {
          ...currentTask,
          downloadedFileId: record.id,
          status: 'succeeded'
        });
        return { ok: true, file: fileToPayload(record) };
      })();
      butler3dDownloads.set(taskToken, download);
      try {
        return await download;
      } finally {
        butler3dDownloads.delete(taskToken);
      }
    } catch (error) {
      const failure = butlerFailure(error, 'The 3D model could not be downloaded.');
      console.error('Butler 3D download failed:', failure.reason);
      return failure;
    }
  });

  ipcMain.handle('butler:upscaleVideo', async (evt, fileId, requestedOptions = {}) => {
    try {
      if (!aiGateway || !aiGateway.isConfigured()) {
        const error = new Error('Butler is not configured.');
        error.code = 'gateway-not-configured';
        throw error;
      }
      const source = await butlerSourceVideo(fileId, requestedOptions);
      const payload = await aiGateway.upscaleVideo(source.videoBuffer, {
        ...source.toolOptions,
        onProgress: (progress) => {
          if (!evt.sender.isDestroyed()) evt.sender.send('butler:videoProgress', {
            fileId: source.file.id,
            ...progress
          });
        }
      });
      const taskToken = normalizeButlerVideoTaskToken(payload && payload.taskToken);
      const status = normalizeButlerVideoStatus(payload || { status: 'queued' });
      rememberButlerVideoTask(taskToken, {
        sourceFileId: source.file.id,
        modelId: BUTLER_VIDEO_TOOL_ID,
        output: source.toolOptions.output,
        credits: status.credits,
        providerCost: status.providerCost,
        status: status.status
      });
      return { ok: true, taskToken, ...status };
    } catch (error) {
      const failure = butlerFailure(error, 'The video enhancement task could not be started.');
      console.error('Butler video enhancement creation failed:', failure.reason);
      return failure;
    }
  });

  ipcMain.handle('butler:getVideoToolStatus', async (_evt, rawTaskToken, requestedModelId) => {
    try {
      if (!aiGateway || !aiGateway.isConfigured()) {
        const error = new Error('Butler is not configured.');
        error.code = 'gateway-not-configured';
        throw error;
      }
      const taskToken = normalizeButlerVideoTaskToken(rawTaskToken);
      const modelId = normalizeButlerVideoModel(requestedModelId);
      const existing = butlerVideoTasks.get(taskToken) || {};
      if (existing.modelId && existing.modelId !== modelId) {
        const error = new Error('The video task model does not match.');
        error.code = 'invalid-video-tool';
        throw error;
      }
      const payload = await aiGateway.getVideoToolStatus(taskToken, modelId);
      const status = normalizeButlerVideoStatus(payload);
      rememberButlerVideoTask(taskToken, {
        modelId,
        status: status.status,
        credits: status.credits !== undefined ? status.credits : existing.credits,
        creditsCharged: status.creditsCharged !== undefined ? status.creditsCharged : existing.creditsCharged,
        providerCost: status.providerCost !== undefined ? status.providerCost : existing.providerCost
      });
      if (['succeeded', 'failed'].includes(status.status) && runtimeConfig.gatewayConfigured) {
        await syncGatewayAccount({ force: true });
      }
      return { ok: true, ...status };
    } catch (error) {
      const failure = butlerFailure(error, 'The video enhancement status could not be checked.');
      console.error('Butler video enhancement status failed:', failure.reason);
      return failure;
    }
  });

  ipcMain.handle('butler:downloadVideoToolResult', async (_evt, rawTaskToken, requestedModelId) => {
    let taskToken;
    try {
      if (!aiGateway || !aiGateway.isConfigured()) {
        const error = new Error('Butler is not configured.');
        error.code = 'gateway-not-configured';
        throw error;
      }
      taskToken = normalizeButlerVideoTaskToken(rawTaskToken);
      const modelId = normalizeButlerVideoModel(requestedModelId);
      const task = butlerVideoTasks.get(taskToken) || {};
      if (task.modelId && task.modelId !== modelId) {
        const error = new Error('The video task model does not match.');
        error.code = 'invalid-video-tool';
        throw error;
      }
      if (task.downloadedFileId) {
        const existingFile = store.getFile(task.downloadedFileId);
        if (existingFile) return { ok: true, file: fileToPayload(existingFile) };
      }
      if (butlerVideoDownloads.has(taskToken)) return await butlerVideoDownloads.get(taskToken);

      const download = (async () => {
        const buffer = await aiGateway.downloadVideoToolResult(taskToken, modelId);
        const currentTask = butlerVideoTasks.get(taskToken) || task;
        const sourceFile = store.getFile(currentTask.sourceFileId) || {
          id: null,
          name: 'Enhanced video',
          folderId: null,
          canvasId: store.data.canvases[0] && store.data.canvases[0].id
        };
        const record = await addButlerVideoOutputFile(buffer, sourceFile, {
          output: currentTask.output || null,
          credits: currentTask.creditsCharged !== undefined ? currentTask.creditsCharged : currentTask.credits,
          providerCost: currentTask.providerCost
        });
        rememberButlerVideoTask(taskToken, {
          ...currentTask,
          modelId,
          downloadedFileId: record.id,
          status: 'succeeded'
        });
        if (runtimeConfig.gatewayConfigured) await syncGatewayAccount({ force: true });
        return { ok: true, file: fileToPayload(record) };
      })();
      butlerVideoDownloads.set(taskToken, download);
      try {
        return await download;
      } finally {
        butlerVideoDownloads.delete(taskToken);
      }
    } catch (error) {
      const failure = butlerFailure(error, 'The enhanced video could not be downloaded.');
      console.error('Butler video enhancement download failed:', failure.reason);
      return failure;
    }
  });

  ipcMain.handle('ai:generateMedia', async (_evt, request = {}) => {
    let safeRequest;
    try {
      const videoReferences = request.kind === 'video'
        ? await resolveAiVideoReferences(request)
        : null;
      const urls = videoReferences
        ? videoReferences.urls
        : await resolveAiReferenceUrls(request, 'referenceFileIds');
      safeRequest = sanitizeAiRequest({
        ...request,
        urls,
        referenceMediaTypes: videoReferences ? videoReferences.mediaTypes : request.referenceMediaTypes,
        referenceVideoUploadIds: videoReferences ? videoReferences.uploadIds : []
      }, { limit: 14 });
    } catch (err) {
      return { ok: false, reason: err.code || 'privacy-blocked', message: err.message };
    }
    request = safeRequest;
    const prompt = String(request.prompt || '').trim();
    if (!prompt) {
      return {
        ok: false,
        reason: 'empty-prompt',
        message: localizedMessage('Enter a generation prompt.', '请输入生成提示词。', '생성 프롬프트를 입력하세요.')
      };
    }

    const kind = request.kind === 'video' ? 'video' : 'image';
    try {
      request = normalizeAiMediaGenerationRequest(request, kind);
    } catch (error) {
      return {
        ok: false,
        reason: error.code || 'invalid-media-options',
        message: error.message
      };
    }
    const providerPrompt = kind === 'video'
      ? videoPromptWithCameraControl(prompt, request.cameraControl)
      : prompt;
    const count = kind === 'image' ? Math.max(1, Math.min(4, Number(request.count) || 1)) : 1;
    const creditQuote = quoteMediaCredits({
      kind,
      imageProviderId: request.imageProviderId,
      videoProviderId: request.videoProviderId,
      count,
      quality: request.quality,
      size: request.size,
      resolution: request.resolution,
      duration: request.duration
    });
    const usage = membershipService.beginUsage(`ai.${kind}`, {
      estimatedCredits: creditQuote.totalCredits,
      metadata: {
        kind,
        requestedCount: count,
        providerId: kind === 'video' ? request.videoProviderId : request.imageProviderId,
        modelName: request.modelName || null,
        aspectRatio: request.aspectRatio || null,
        size: request.size || null,
        quality: kind === 'image' ? request.quality || 'auto' : null,
        resolution: kind === 'video' ? request.resolution || null : null,
        duration: kind === 'video' ? Number(request.duration) || null : null,
        referenceCount: Array.isArray(request.referenceMediaTypes) && request.referenceMediaTypes.length
          ? request.referenceMediaTypes.length
          : Array.isArray(request.urls) ? request.urls.length : 0,
        quotedCredits: creditQuote.totalCredits,
        unitCredits: creditQuote.unitCredits
      }
    });
    if (!usage.ok) {
      if (usage.reason === 'insufficient-credits') {
        return {
          ok: false,
          reason: 'insufficient-credits',
          requiredCredits: usage.requiredCredits,
          availableCredits: usage.availableCredits,
          membership: membershipService.getSnapshot(),
          message: localizedMessage(
            `Not enough points. This request needs ${usage.requiredCredits}; ${usage.availableCredits} are available.`,
            `积分不足：本次需要 ${usage.requiredCredits} 积分，当前可用 ${usage.availableCredits} 积分。`,
            `포인트가 부족합니다. 이 요청에는 ${usage.requiredCredits}포인트가 필요하며 현재 ${usage.availableCredits}포인트를 사용할 수 있습니다.`
          )
        };
      }
      return {
        ok: false,
        reason: usage.reason || 'not-entitled',
        message: localizedMessage(
          'This AI feature is not included in the current plan.',
          '当前会员方案不包含此 AI 功能。',
          '현재 요금제에는 이 AI 기능이 포함되어 있지 않습니다.'
        )
      };
    }

    try {
      const tasks = Array.from({ length: count }, () => generateAiMediaBuffer(kind, providerPrompt, {
        size: request.size,
        quality: request.quality,
        resolution: request.resolution,
        aspectRatio: request.aspectRatio,
        sourceWidth: request.sourceWidth,
        sourceHeight: request.sourceHeight,
        duration: request.duration,
        videoMode: request.videoMode,
        referenceMediaTypes: request.referenceMediaTypes,
        referenceVideoUploadIds: request.referenceVideoUploadIds,
        enhancePrompt: request.enhancePrompt,
        seed: request.seed,
        styleId: request.styleId,
        styleStrength: request.styleStrength,
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
        const boardItem = request.placeOnBoard === false
          ? null
          : addGeneratedMediaBoardItem(
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
      const creditsCharged = kind === 'image'
        ? creditQuote.unitCredits * files.length
        : creditQuote.totalCredits;
      membershipService.finishUsage(usage.usageId, {
        status: failures.length ? 'partial' : 'succeeded',
        resultUnits: files.length,
        failedUnits: failures.length,
        settledCredits: creditsCharged
      });
      if (runtimeConfig.gatewayConfigured) await syncGatewayAccount({ force: true });
      store.scheduleSave();
      return {
        ok: true,
        file: files[0],
        files,
        boardItems,
        failedCount: failures.length,
        unlocked: [...unlockedKeys],
        estimatedCredits: creditQuote.totalCredits,
        creditsCharged,
        pricing: {
          providerId: creditQuote.providerId,
          unitCredits: creditQuote.unitCredits,
          count: kind === 'image' ? files.length : 1,
          ...(creditQuote.resolution ? { resolution: creditQuote.resolution } : {}),
          ...(creditQuote.quality ? { quality: creditQuote.quality } : {}),
          ...(creditQuote.duration ? { duration: creditQuote.duration } : {})
        },
        membership: membershipService.getSnapshot()
      };
    } catch (err) {
      membershipService.finishUsage(usage.usageId, {
        status: 'failed',
        resultUnits: 0,
        failedUnits: count,
        failureCode: err && err.code ? err.code : 'generation-failed'
      });
      if (runtimeConfig.gatewayConfigured) await syncGatewayAccount({ force: true });
      console.error('AI media generation failed:', err && err.message ? err.message : err);
      return {
        ok: false,
        reason: err && err.code ? err.code : 'generation-failed',
        message: conciseAiErrorMessage(err, { kind: request.kind }),
        membership: membershipService.getSnapshot()
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
    if (!prompt) return {
      ok: false,
      reason: 'empty-prompt',
      message: localizedMessage('Enter a message.', '请输入消息。', '메시지를 입력하세요.')
    };
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
        message: localizedMessage(
          'AI chat is not included in the current plan.',
          '当前会员方案不包含 AI 对话。',
          '현재 요금제에는 AI 채팅이 포함되어 있지 않습니다.'
        )
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
      f.videoPreviewReady = true;
      delete f.videoPreviewError;
      store.scheduleSave();
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
    if (MODEL_FILE_EXTENSIONS.has(ext)) {
      return { type: 'model', format: ext.slice(1), name: f.name };
    }
    if (preview.isImageExt(ext) && preview.browserCanDecodeImage(ext)) {
      return { type: 'image', url: 'messs-file://' + f.id, name: f.name };
    }
    if (preview.isVideoExt(ext)) {
      const compatiblePreview = await preview.findWebCompatibleVideoPreview(
        f.storedPath,
        previewCacheDir,
        f.id
      ).catch(() => null);
      if (compatiblePreview) {
        return {
          type: 'video',
          url: `messs-transcode://${f.id}`,
          name: f.name,
          transcoded: true
        };
      }
      // Imported web containers still open directly first. If Chromium
      // rejects their codec, both canvas and fullscreen request the same
      // deduplicated, disk-cached FFmpeg fallback.
      return { type: 'video', url: 'messs-file://' + f.id, name: f.name };
    }
    if (preview.isAudioExt(ext)) {
      return { type: 'audio', url: 'messs-file://' + f.id, name: f.name };
    }
    if (preview.isTextExt(ext)) {
      try {
        const textPreview = await preview.readTextPreview(f.storedPath);
        return { type: 'text', name: f.name, ...textPreview };
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

    // Office documents: the packaged/system LibreOffice conversion preserves
    // pagination and layout. DOCX has a safe in-process fallback so a user can
    // still read Word documents in development or when LibreOffice is absent.
    if (preview.isOfficeExt(ext)) {
      if (caps.hasSoffice) {
        try {
          const cacheDir = path.join(previewCacheDir, f.id);
          const pdfPath = await preview.convertOfficeToPdfCached(f.storedPath, cacheDir, previewTmpDir);
          return { type: 'pdf-js', path: pdfPath, name: f.name };
        } catch (err) {
          console.error('Office->PDF conversion failed for', f.name, err);
        }
      }
      if (ext === '.docx' && caps.hasDocxFallback) {
        try {
          const docxEditor = require('./lib/docx-editor');
          const html = await docxEditor.docxToHtml(f.storedPath);
          return { type: 'document-html', html, name: f.name, fallback: true };
        } catch (err) {
          console.error('DOCX fallback preview failed for', f.name, err);
        }
      }
      // A binary inspector is still useful for unsupported office containers,
      // and gives the user a real preview instead of a dead-end blank panel.
      try {
        const fallback = buildUnknownFilePreview(f);
        return { ...fallback, officeFallback: true };
      } catch (err) {
        return { type: 'unsupported', reason: caps.hasSoffice ? 'render-failed' : 'missing-tools', ext, name: f.name, missingTools: ['LibreOffice'] };
      }
    }

    // PSD / TIFF: rasterized to a single PNG by ImageMagick / sharp respectively.
    if (preview.isPsdExt(ext) && !caps.hasImageMagick) {
      return { type: 'unsupported', reason: 'missing-tools', ext, name: f.name, missingTools: ['ImageMagick'] };
    }
    if (preview.needsImageConversion(ext) && !caps.hasSharp && !caps.hasImageMagick) {
      return { type: 'unsupported', reason: 'missing-tools', ext, name: f.name, missingTools: ['ImageMagick'] };
    }
    try {
      const cacheDir = path.join(previewCacheDir, f.id);
      if (preview.isPsdExt(ext)) await preview.rasterizePsd(f.storedPath, cacheDir);
      else if (preview.isTiffExt(ext)) await preview.rasterizeTiff(f.storedPath, cacheDir);
      else await preview.rasterizeImageToPng(f.storedPath, cacheDir);
      return { type: 'pages', totalPages: 1, pageUrls: [`messs-preview://${f.id}/1`], name: f.name };
    } catch (err) {
      console.error('Preview render failed for', f.name, err);
      return { type: 'unsupported', reason: 'render-failed', ext, name: f.name };
    }
  });

  ipcMain.handle('files:readModelData', async (_evt, id) => {
    try {
      return { ok: true, ...(await readArchivedModelData(id)) };
    } catch (error) {
      console.error('3D model preview read failed:', error && error.code ? error.code : error);
      return {
        ok: false,
        reason: error && error.code ? error.code : 'model-read-failed',
        message: error && error.message ? error.message : 'The 3D model could not be read.'
      };
    }
  });

  ipcMain.handle('files:saveModelPreview', async (_evt, id, dataUrl) => {
    try {
      return { ok: true, url: await saveArchivedModelPreview(id, dataUrl) };
    } catch (error) {
      console.error('3D model thumbnail save failed:', error && error.code ? error.code : error);
      return {
        ok: false,
        reason: error && error.code ? error.code : 'model-preview-save-failed',
        message: error && error.message ? error.message : 'The 3D thumbnail could not be saved.'
      };
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

  ipcMain.handle('shell:sendToCreativeApp', async (_evt, id, target) => {
    const f = store.getFile(id);
    const language = currentLanguage();
    const normalizedTarget = target === 'photoshop' || target === 'after-effects' ? target : null;
    const targetName = normalizedTarget === 'after-effects' ? 'After Effects' : 'Photoshop';
    if (!normalizedTarget) {
      return {
        ok: false,
        reason: 'invalid-target',
        message: localizedMessage('This Adobe application is not supported.', '不支持这个 Adobe 应用。', '이 Adobe 앱은 지원되지 않습니다.')
      };
    }
    if (!f) {
      return {
        ok: false,
        reason: 'file-not-found',
        message: localizedMessage('The media file could not be found.', '找不到要发送的文件。', '보낼 미디어 파일을 찾을 수 없습니다.')
      };
    }
    const ext = path.extname(f.name || f.storedPath || '').toLowerCase();
    const supported = normalizedTarget === 'photoshop'
      ? preview.isImageExt(ext)
      : preview.isImageExt(ext) || preview.isVideoExt(ext);
    if (!supported) {
      return {
        ok: false,
        reason: 'unsupported-file-type',
        message: localizedMessage(
          `This file type cannot be sent to ${targetName}.`,
          `这个文件格式不能发送到 ${targetName}。`,
          `이 파일 형식은 ${targetName}(으)로 보낼 수 없습니다.`
        )
      };
    }
    try {
      // Always pass the archived local file, never the renderer's messs-file://
      // URL. spawn receives the executable and path as separate arguments, so
      // spaces and Chinese characters do not need shell quoting.
      return await launchAdobeMedia(normalizedTarget, f.storedPath, { language });
    } catch (error) {
      return {
        ok: false,
        reason: 'launch-failed',
        message: localizedMessage(
          `Could not start ${targetName}: ${error.message}`,
          `无法启动 ${targetName}：${error.message}`,
          `${targetName}을(를) 시작하지 못했습니다: ${error.message}`
        )
      };
    }
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
      name: name && name.trim() ? name.trim() : localizedMessage('New Folder', '新建文件夹', '새 폴더'),
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

  ipcMain.handle('updater:installNow', async () => {
    try {
      return await installDownloadedUpdate();
    } catch (err) {
      updateInstallStarted = false;
      console.error('quitAndInstall failed:', err.message);
      return { ok: false, reason: 'install-failed' };
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
  writeStartupDiagnostic('ready');
  store = createStoreWithFallback();
  writeStartupDiagnostic('store-ready');
  membershipService = createMembershipService(store);
  runtimeConfig = loadRuntimeConfig(__dirname, { packaged: app.isPackaged });
  writeStartupDiagnostic('runtime-ready');
  supabaseAuth = new SupabaseAuth({
    fetchImpl: appFetch,
    safeStorage,
    sessionPath: path.join(store.dir, 'cloud-session.bin'),
    supabaseUrl: runtimeConfig.supabaseUrl,
    publishableKey: runtimeConfig.supabasePublishableKey
  });
  chatService = new ChatService({
    supabaseUrl: runtimeConfig.supabaseUrl,
    publishableKey: runtimeConfig.supabasePublishableKey,
    getAccessToken: () => supabaseAuth.getAccessToken(),
    getPublicSession: () => supabaseAuth.getPublicSession(),
    fetchImpl: appFetch,
    sharp,
    // Chat is part of the actual default library selected by Store fallback.
    // It intentionally does not follow the optional custom mirror location.
    localRoot: path.join(store.dir, 'chat'),
    onEvent: (payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('chat:event', payload);
      showIncomingChatNotification(payload);
    }
  });
  createTray();

  ipcMain.handle('updater:getState', () => publicUpdaterState());

  ipcMain.handle('updater:checkNow', () => checkForUpdates(true));

  ipcMain.handle('updater:setAutoUpdateEnabled', (_event, enabled) => {
    const next = enabled !== false;
    store.data.settings.autoUpdateEnabled = next;
    store.scheduleSave();
    updaterState.enabled = next;
    autoUpdater.autoDownload = next;
    autoUpdater.autoInstallOnAppQuit = false;
    const state = setUpdaterState({ status: next ? 'idle' : 'disabled', message: null });
    if (next && app.isPackaged) checkForUpdates(false);
    return state;
  });
  aiGateway = new AiGatewayClient({
    fetchImpl: appFetch,
    baseUrl: runtimeConfig.aiGatewayUrl,
    getAccessToken: () => supabaseAuth.getAccessToken(),
    refreshAccessToken: () => supabaseAuth.refresh()
  });
  if (app.isPackaged && runtimeConfig.gatewayConfigured) clearAllAiApiKeys();
  ensureCanvasState();
  writeStartupDiagnostic('canvas-state-ready');
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
      return localFileProtocolResponse(
        request,
        f.storedPath,
        localMediaMimeType(f.storedPath, f.mimeType || classifyArchiveFile(f.name).mimeType)
      );
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
    let parsedUrl;
    try { parsedUrl = new URL(request.url); } catch (error) {
      return new Response('Bad request', { status: 400 });
    }
    const fileId = parsedUrl.hostname;
    const pageStr = parsedUrl.pathname.replace(/^\//, '').split('/')[0];
    if (pageStr === 'model') {
      const file = store.getFile(fileId);
      if (!file || !/^[A-Za-z0-9_-]{1,128}$/.test(String(file.id || '')) || !MODEL_FILE_EXTENSIONS.has(path.extname(file.name).toLowerCase())) {
        return new Response('Not found', { status: 404 });
      }
      const modelPreviewPath = path.join(previewCacheDir, file.id, 'model-preview.png');
      const pbrMarkerPath = path.join(previewCacheDir, file.id, MODEL_PREVIEW_MARKER_FILENAME);
      if (!fs.existsSync(modelPreviewPath) || !fs.existsSync(pbrMarkerPath)) {
        return new Response('Not found', { status: 404 });
      }
      try {
        return net.fetch(pathToFileURL(modelPreviewPath).toString());
      } catch (err) {
        return new Response('Read error', { status: 500 });
      }
    }
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
      return localFileProtocolResponse(
        request,
        mediaPath,
        variant === 'audio' ? 'audio/mp4' : 'video/mp4'
      );
    } catch (err) {
      return new Response('Read error', { status: 500 });
    }
  });

  registerIpcHandlers();
  writeStartupDiagnostic('ipc-ready');
  createWindow();
  writeStartupDiagnostic('window-created');
  // A restored Messs account should start local-history attachment and cloud
  // reconciliation without waiting for the user to open the Chat section.
  if (supabaseAuth.getPublicSession().authenticated) {
    chatService.initialize().catch((error) => {
      console.warn('Chat startup initialization failed:', error && error.message || error);
    });
  }
  startSession();
  runDailyDesktopChecks();
  setTimeout(setupAutoUpdater, 3000); // give the window time to paint first.

  // Re-check desktop-dependent achievements roughly every hour the app stays open,
  // so a long-running session still catches a day rollover.
  setInterval(runDailyDesktopChecks, 60 * 60 * 1000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else revealMainWindow();
  });
}).catch((error) => {
  const message = error && error.stack ? error.stack : String(error || 'Unknown startup error');
  console.error('Application startup failed:', message);
  writeStartupDiagnostic('startup-failed', message);
  app.exit(1);
});

app.on('window-all-closed', () => {
  if (isQuitting && process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  preview.shutdownProcesses();
  thumbnails.shutdownProcesses();
  shutdownMediaMetadataProcesses();
  if (store) store.flushSync();
  if (chatService) chatService.flushLocal();
});

setInterval(() => {
  const now = Date.now();
  for (const [token, record] of transientAiAttachments) {
    if (record.expiresAt <= now) transientAiAttachments.delete(token);
  }
}, 5 * 60_000).unref();
