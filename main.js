'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, Menu, Tray, Notification, clipboard, safeStorage, desktopCapturer, screen, nativeImage } = require('electron');
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
let ElectronScreenshots = null;
try {
  const screenshotsModule = require('electron-screenshots');
  ElectronScreenshots = screenshotsModule.default || screenshotsModule;
} catch (error) {
  console.warn('The native screenshot tool is unavailable:', error && error.message || error);
}

const { Store } = require('./lib/store');
const {
  normalizeColorProfile,
  chromiumColorProfile,
  colorProfileBootstrapPath,
  readColorProfileBootstrap,
  writeColorProfileBootstrap,
  writeColorProfileBootstrapSync
} = require('./lib/color-management');
const { createMembershipService } = require('./lib/membership-service');
const achievements = require('./lib/achievements');
const preview = require('./lib/preview');
const thumbnails = require('./lib/thumbnails');
const {
  configuredLibraryRoot,
  getDefaultLibraryRoot,
  saveConfiguredLibraryRoot
} = require('./lib/storage-paths');
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
const {
  AI_ARTIFACT_INSTRUCTION,
  attachmentKind,
  attachmentMetadata,
  normalizeAttachmentName,
  parseAiArtifacts,
  prepareTextAttachment
} = require('./lib/ai-attachments');
const {
  PROVIDER_CATALOG_VERSION,
  providerCatalog,
  canonicalProviderCapabilities
} = require('./lib/provider-catalog');
const { loadRuntimeConfig } = require('./lib/runtime-config');
const { SupabaseAuth, createPkcePair } = require('./lib/supabase-auth');
const { AiGatewayClient, assertValidGlbBuffer } = require('./lib/ai-gateway-client');
const { normalizeGatewayCatalog, assertGatewayProvider } = require('./lib/gateway-catalog');
const { sanitizePublicAiError, sanitizePublicModelLabel } = require('./lib/public-model-label');
const { assertSafeLocalFile, assertPromptHasNoSecrets, sanitizeAiRequest } = require('./lib/privacy-guard');
const { activate: activateApp, getActivationStatus } = require('./lib/activation');
const {
  CREDIT_PRICING_VERSION,
  CHAT_CREDITS,
  USD_TO_CNY,
  conservativeMediaCreditQuote,
  quoteMediaCredits,
  publicCreditPricing,
  retailCreditsFromUpstreamCny
} = require('./lib/credit-pricing');
const {
  imageFallbackProviderIds,
  isRetryableMediaError,
  supportsImageRequest
} = require('./lib/ai-media-fallback');
const { launchAdobeMedia } = require('./lib/adobe-launcher');
const { ChatService } = require('./lib/chat-service');
const { probeMediaDuration, probeVideoMetadata, shutdownProcesses: shutdownMediaMetadataProcesses } = require('./lib/media-metadata');
const {
  MAX_SEEDANCE_REFERENCE_AUDIO_BYTES,
  seedanceReferenceProfile,
  validateSeedanceReferenceDuration,
  validateSeedanceReferenceTotals
} = require('./lib/seedance-reference-validation');
const { authenticatedUserId, profileAvatarPath } = require('./lib/profile-avatar');
const { normalizeLanguage, translate: translateLanguage } = require('./lib/i18n');
const { createLocalFileResponse } = require('./lib/local-file-response');
const { normalizeVideoResolution } = require('./lib/video-resolution');
const { normalizeFirstLastFrameDataUrls } = require('./lib/ai-frame-reference');

const DEFAULT_CATALOG_IMAGE = providerCatalog('image')[0];
const DEFAULT_CATALOG_VIDEO = providerCatalog('video')[0];
const DEFAULT_CATALOG_CHAT = providerCatalog('chat').find((provider) => provider.hidden !== true) || providerCatalog('chat')[0];
const DEFAULT_CHAT_PROVIDER_ID = DEFAULT_CATALOG_CHAT.id || 'chat-3';
const DEFAULT_CHAT_MODEL = DEFAULT_CATALOG_CHAT.models?.[0] || 'gemini-3.1-pro';
const AI_IMAGE_SIZES = new Set([
  '1K', '2K', '4K', 'Default', 'adaptive', 'original',
  '1024x1024', '1536x1024', '1024x1536', 'auto',
  '512x512', '720p', '1080p'
]);
const AI_IMAGE_QUALITIES = new Set(['low', 'medium', 'high', 'auto']);
const AI_IMAGE_RATIOS = new Set([
  'auto', '1:1', '16:9', '9:16', '4:3', '3:4',
  '3:2', '2:3', '5:4', '4:5', '21:9',
  '16:10', '10:16', '2:1', '1:2', '9:21', '3:1', '1:3',
  '4:1', '1:4', '7:5', '5:7', '8:5', '5:8'
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
  return theme === 'dark' ? 'dark' : 'light';
}

const TEXT_SIZE_LEVELS = Object.freeze(['extra-small', 'small', 'medium', 'large', 'extra-large']);

function normalizeTextSize(size) {
  const normalized = String(size || '').trim().toLowerCase();
  return TEXT_SIZE_LEVELS.includes(normalized) ? normalized : 'medium';
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

// Chromium's output color profile is a browser-process startup choice. Keep
// a tiny bootstrap setting beside userData so it can be applied before ready.
const colorProfileBootstrapFile = colorProfileBootstrapPath(app.getPath('userData'));
const startupColorProfileBootstrap = readColorProfileBootstrap(colorProfileBootstrapFile);
const startupColorProfile = startupColorProfileBootstrap.profile;
const forcedChromiumColorProfile = chromiumColorProfile(startupColorProfile);
if (forcedChromiumColorProfile) {
  app.commandLine.appendSwitch('force-color-profile', forcedChromiumColorProfile);
}

function currentColorManagementState() {
  const profile = normalizeColorProfile(store && store.data && store.data.settings && store.data.settings.colorProfile);
  return {
    profile,
    activeProfile: startupColorProfile,
    restartRequired: profile !== startupColorProfile
  };
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
  { scheme: 'messs-transcode', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: 'messs-chat-file', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

let mainWindow;
const detachedCanvasWindows = new Map();
const canvasDetachDragWatches = new Map();
let tray;
let isQuitting = false;
const activeNotifications = new Set();
let store;
let membershipService;
let runtimeConfig;
let supabaseAuth;
let chatService;
let chatScreenshotTool;
let chatScreenshotInFlight = null;
const CHAT_SCREENSHOT_START_TIMEOUT_MS = 12_000;
const CHAT_SCREENSHOT_THEME_PATH = path.join(__dirname, 'src', 'assets', 'screenshot-theme.css');
const chatScreenshotPresentationViews = new WeakSet();
const CHAT_SCREENSHOT_POLISH_SCRIPT = `(() => {
  if (window.__messsScreenshotPolishInstalled) return true;
  window.__messsScreenshotPolishInstalled = true;
  const formatSize = () => {
    const label = document.querySelector('.screenshots-canvas-size');
    if (!label) return;
    const match = label.textContent.match(/(-?\\d+(?:\\.\\d+)?)\\s*[×x]\\s*(-?\\d+(?:\\.\\d+)?)/);
    if (!match) return;
    const width = Math.max(1, Math.round(Number(match[1])));
    const height = Math.max(1, Math.round(Number(match[2])));
    const next = width + ' × ' + height;
    if (label.textContent !== next) label.textContent = next;
  };
  const observer = new MutationObserver(formatSize);
  observer.observe(document.body, { childList: true, characterData: true, subtree: true });
  formatSize();
  return true;
})()`;
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
let updateCheckPromise = null;
let updateInstallFallbackTimer = null;
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
const chatAttachmentDrafts = new Map();
const CHAT_DRAFT_TTL_MS = 30 * 60 * 1000;
const droppedFileImports = new Map();
const DROPPED_FILE_CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_DROPPED_FILE_BYTES = 128 * 1024 * 1024 * 1024;
const DROPPED_FILE_IMPORT_TTL_MS = 30 * 60 * 1000;
const transientAiOutputFiles = new Map();
const butlerImageTasks = new Map();
const butlerImageDownloads = new Map();
const butler3dTasks = new Map();
const butler3dDownloads = new Map();
const butlerVideoTasks = new Map();
const butlerVideoDownloads = new Map();
const butlerDeliveries = new Map();
const aiMediaDeliveries = new Map();
const aiMediaDeliveryGroups = new Map();
const BUTLER_TASK_PERSIST_LIMIT = 256;
const BUTLER_DELIVERY_PERSIST_LIMIT = 128;
const AI_MEDIA_DELIVERY_PERSIST_LIMIT = 128;
const AI_MEDIA_DELIVERY_GROUP_PERSIST_LIMIT = 128;
const AI_MEDIA_DELIVERY_TTL_MS = 30 * 60 * 1000;

function persistAiMediaDeliveryGroup(group) {
  if (!store || !store.data || !group || !group.groupId) return;
  const groups = Array.isArray(store.data.aiMediaDeliveryGroups)
    ? store.data.aiMediaDeliveryGroups : [];
  const safe = {
    groupId: String(group.groupId).slice(0, 160),
    usageId: String(group.usageId || '').slice(0, 160),
    pendingTokens: Array.isArray(group.pendingTokens)
      ? group.pendingTokens.map((token) => String(token).slice(0, 256)).slice(-16) : [],
    settledTokens: Array.isArray(group.settledTokens)
      ? group.settledTokens.map((token) => String(token).slice(0, 256)).slice(-16) : [],
    resultUnits: Math.max(0, Math.round(Number(group.resultUnits) || 0)),
    failedUnits: Math.max(0, Math.round(Number(group.failedUnits) || 0)),
    settledCredits: Math.max(0, Math.round(Number(group.settledCredits) || 0)),
    updatedAt: Date.now()
  };
  const index = groups.findIndex((item) => item && item.groupId === safe.groupId);
  if (index === -1) groups.push(safe);
  else groups[index] = safe;
  store.data.aiMediaDeliveryGroups = groups.slice(-AI_MEDIA_DELIVERY_GROUP_PERSIST_LIMIT);
  store.scheduleSave();
}

function removeAiMediaDeliveryGroup(groupId) {
  if (!store || !store.data) return;
  const normalized = String(groupId || '');
  store.data.aiMediaDeliveryGroups = (Array.isArray(store.data.aiMediaDeliveryGroups)
    ? store.data.aiMediaDeliveryGroups : []).filter((group) => group && group.groupId !== normalized);
  store.scheduleSave();
}

function persistAiMediaDelivery(entry) {
  if (!store || !store.data || !entry || !entry.token) return;
  const deliveries = Array.isArray(store.data.aiMediaDeliveries) ? store.data.aiMediaDeliveries : [];
  const safe = {
    token: String(entry.token).slice(0, 256),
    kind: entry.kind === 'video' ? 'video' : 'image',
    requestId: String(entry.requestId || '').slice(0, 128),
    taskToken: String(entry.taskToken || '').slice(0, 512),
    durationMs: Math.max(0, Math.round(Number(entry.durationMs) || 0)),
    estimatedCredits: entry.estimatedCredits === null
      ? null : Math.max(0, Number(entry.estimatedCredits) || 0),
    recordIds: Array.isArray(entry.recordIds)
      ? entry.recordIds.map((id) => String(id).slice(0, 128)).slice(0, 8) : [],
    boardItemIds: Array.isArray(entry.boardItemIds)
      ? entry.boardItemIds.map((id) => String(id).slice(0, 128)).slice(0, 8) : [],
    requiresBoardItem: entry.requiresBoardItem !== false,
    usageId: String(entry.usageId || '').slice(0, 160),
    groupId: String(entry.groupId || '').slice(0, 160),
    status: entry.status === 'confirmed' || entry.status === 'released' ? entry.status : 'pending',
    createdAt: Number(entry.createdAt) || Date.now(),
    result: entry.result && typeof entry.result === 'object' ? entry.result : null
  };
  const index = deliveries.findIndex((item) => item && item.token === safe.token);
  if (index === -1) deliveries.push(safe);
  else deliveries[index] = safe;
  store.data.aiMediaDeliveries = deliveries.slice(-AI_MEDIA_DELIVERY_PERSIST_LIMIT);
  store.scheduleSave();
}

async function flushStoreDurably() {
  if (!store) return;
  if (typeof store.flush === 'function') {
    await store.flush();
    return;
  }
  // Keep compatibility with test doubles and older embedded stores while the
  // production Store uses the asynchronous durable flush above.
  if (typeof store.save === 'function') store.save();
}

function generatedMediaDeliveryRequest(kind, generated) {
  const buffer = generated && generated.buffer;
  if (!buffer || buffer.deliveryPending !== true) return null;
  if (kind === 'video') {
    const taskToken = String(buffer.deliveryTaskToken || '').trim();
    return taskToken ? { taskToken } : null;
  }
  const requestId = String(buffer.deliveryRequestId || generated.accountingRequestId || '').trim().toLowerCase();
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(requestId)) return null;
  return {
    requestId,
    durationMs: Math.max(0, Math.round(Number(buffer.deliveryDurationMs) || 0))
  };
}

function registerAiMediaDelivery(kind, generated, records, boardItems, usageGroup, requiresBoardItem) {
  const request = generatedMediaDeliveryRequest(kind, generated);
  if (!request) return null;
  const token = `ad_${crypto.randomBytes(24).toString('base64url')}`;
  const entry = {
    token,
    kind,
    ...request,
    estimatedCredits: Number.isFinite(Number(generated.buffer && generated.buffer.estimatedCredits))
      ? Math.max(0, Number(generated.buffer.estimatedCredits)) : null,
    recordIds: records.map((record) => record.id),
    boardItemIds: (Array.isArray(boardItems) ? boardItems : []).map((item) => item && item.id).filter(Boolean),
    requiresBoardItem: requiresBoardItem !== false,
    usageId: usageGroup.usageId,
    groupId: usageGroup.groupId,
    status: 'pending',
    createdAt: Date.now(),
    timer: null,
    inFlight: null,
    result: null
  };
  aiMediaDeliveries.set(token, entry);
  usageGroup.pendingTokens.push(token);
  persistAiMediaDelivery(entry);
  persistAiMediaDeliveryGroup(usageGroup);
  scheduleAiMediaDeliveryRecovery(token);
  return token;
}

function aiMediaDeliveryHasCanvasItem(entry) {
  if (!store || !store.data || !entry) return false;
  const ids = new Set((entry.recordIds || []).map(String).filter(Boolean));
  if (!ids.size) return false;
  const records = [...ids].map((id) => store.getFile(id)).filter(Boolean);
  if (records.length !== ids.size) return false;
  const filesExist = records.every((file) => {
    try {
      const stat = fs.statSync(file.storedPath);
      const expectedBytes = Number(file.sizeBytes);
      return stat.isFile() && stat.size > 0
        && (!Number.isFinite(expectedBytes) || expectedBytes <= 0 || stat.size === expectedBytes);
    } catch (error) {
      return false;
    }
  });
  if (!filesExist) return false;
  if (entry.requiresBoardItem !== true) return true;
  const boardItemIds = new Set((entry.boardItemIds || []).map(String).filter(Boolean));
  return records.every((file) => (store.data.boardItems || []).some((item) => (
    item && item.isAiPlaceholder !== true
      && String(item.fileId || '') === String(file.id)
      && (!file.canvasId || String(item.canvasId || '') === String(file.canvasId))
      && (!boardItemIds.size || boardItemIds.has(String(item.id)))
  )));
}

async function aiMediaDeliveryIsDurable(entry) {
  if (!store || !store.data || !entry) return false;
  const ids = new Set((entry.recordIds || []).map(String).filter(Boolean));
  if (!ids.size) return false;
  const records = [...ids].map((id) => store.getFile(id));
  if (records.some((file) => !file)) return false;
  const stats = await Promise.all(records.map((file) => fs.promises.stat(file.storedPath).catch(() => null)));
  if (stats.some((stat, index) => {
    if (!stat || !stat.isFile() || stat.size <= 0) return true;
    const expectedBytes = Number(records[index].sizeBytes);
    return Number.isFinite(expectedBytes) && expectedBytes > 0 && stat.size !== expectedBytes;
  })) return false;
  const boardItemIds = new Set((entry.boardItemIds || []).map(String).filter(Boolean));
  return entry.requiresBoardItem !== true || records.every((file) => (store.data.boardItems || []).some((item) => (
    item && item.isAiPlaceholder !== true
      && String(item.fileId || '') === String(file.id)
      && (!file.canvasId || String(item.canvasId || '') === String(file.canvasId))
      && (!boardItemIds.size || boardItemIds.has(String(item.id)))
  )));
}

function scheduleAiMediaDeliveryRecovery(token, delayMs = AI_MEDIA_DELIVERY_TTL_MS) {
  const entry = aiMediaDeliveries.get(token);
  if (!entry || entry.status !== 'pending') return;
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(async () => {
    const current = aiMediaDeliveries.get(token);
    if (!current || current.status !== 'pending') return;
    try {
      // A persisted canvas item is proof that the result survived a renderer
      // restart. Otherwise release the reservation and remove the orphan.
      await settleAiMediaDeliveryToken(token, aiMediaDeliveryHasCanvasItem(current));
    } catch (error) {
      console.error('Could not recover a pending AI media delivery:', error && error.code || error);
      scheduleAiMediaDeliveryRecovery(token, 15 * 1000);
    }
  }, Math.max(1_000, Number(delayMs) || AI_MEDIA_DELIVERY_TTL_MS));
  entry.timer.unref?.();
}

function restoreAiMediaDeliveries() {
  const deliveries = Array.isArray(store && store.data && store.data.aiMediaDeliveries)
    ? store.data.aiMediaDeliveries : [];
  for (const delivery of deliveries) {
    if (!delivery || !delivery.token || delivery.status !== 'pending') continue;
    if (delivery.kind === 'video' && !delivery.taskToken || delivery.kind !== 'video' && !delivery.requestId) continue;
    aiMediaDeliveries.set(delivery.token, { ...delivery, timer: null, inFlight: null });
    scheduleAiMediaDeliveryRecovery(
      delivery.token,
      Math.max(1_000, AI_MEDIA_DELIVERY_TTL_MS - Math.max(0, Date.now() - Number(delivery.createdAt || Date.now())))
    );
  }
}

function restoreAiMediaDeliveryGroups() {
  const groups = Array.isArray(store && store.data && store.data.aiMediaDeliveryGroups)
    ? store.data.aiMediaDeliveryGroups : [];
  for (const group of groups) {
    if (!group || !group.groupId || !group.usageId) continue;
    aiMediaDeliveryGroups.set(group.groupId, {
      groupId: String(group.groupId),
      usageId: String(group.usageId),
      pendingTokens: Array.isArray(group.pendingTokens) ? group.pendingTokens.map(String) : [],
      settledTokens: Array.isArray(group.settledTokens) ? group.settledTokens.map(String) : [],
      resultUnits: Math.max(0, Math.round(Number(group.resultUnits) || 0)),
      failedUnits: Math.max(0, Math.round(Number(group.failedUnits) || 0)),
      settledCredits: Math.max(0, Math.round(Number(group.settledCredits) || 0))
    });
  }
}

function reconcileRestoredAiMediaDeliveryGroups() {
  const persistedDeliveries = Array.isArray(store && store.data && store.data.aiMediaDeliveries)
    ? store.data.aiMediaDeliveries : [];
  for (const group of aiMediaDeliveryGroups.values()) {
    const groupDeliveries = persistedDeliveries.filter((entry) => entry && entry.groupId === group.groupId);
    const settled = new Set(group.settledTokens || []);
    for (const entry of groupDeliveries) {
      if (!entry || entry.status === 'pending' || settled.has(entry.token)) continue;
      settled.add(entry.token);
      if (entry.status === 'confirmed') {
        group.resultUnits += Array.isArray(entry.recordIds) ? entry.recordIds.length : 0;
        group.settledCredits += Math.max(0, Number(entry.result && entry.result.settlement && entry.result.settlement.creditsCharged) || 0);
      } else if (entry.status === 'released') {
        group.failedUnits += Array.isArray(entry.recordIds) ? entry.recordIds.length : 0;
      }
    }
    group.settledTokens = [...settled];
    group.pendingTokens = group.pendingTokens.filter((token) => (
      persistedDeliveries.some((entry) => entry && entry.token === token && entry.status === 'pending')
    ));
    if (group.pendingTokens.length) persistAiMediaDeliveryGroup(group);
    else {
      membershipService.finishUsage(group.usageId, {
        status: group.failedUnits ? 'partial' : 'succeeded',
        resultUnits: group.resultUnits,
        failedUnits: group.failedUnits,
        settledCredits: group.settledCredits
      });
      aiMediaDeliveryGroups.delete(group.groupId);
      removeAiMediaDeliveryGroup(group.groupId);
    }
  }
}

function persistButlerTask(kind, taskToken, entry) {
  if (!store || !store.data || !taskToken || !entry) return;
  const tasks = Array.isArray(store.data.butlerTasks) ? store.data.butlerTasks : [];
  const safe = {
    kind: String(kind || '').slice(0, 20),
    taskToken: String(taskToken).slice(0, 4096),
    ...entry,
    updatedAt: Number(entry.updatedAt) || Date.now()
  };
  const index = tasks.findIndex((item) => item && item.kind === safe.kind && item.taskToken === safe.taskToken);
  if (index === -1) tasks.push(safe);
  else tasks[index] = safe;
  tasks.sort((a, b) => (Number(a.updatedAt) || 0) - (Number(b.updatedAt) || 0));
  store.data.butlerTasks = tasks.slice(-BUTLER_TASK_PERSIST_LIMIT);
  store.scheduleSave();
}

function persistedButlerTask(kind, taskToken) {
  const tasks = store && store.data && Array.isArray(store.data.butlerTasks) ? store.data.butlerTasks : [];
  return tasks.find((item) => item && item.kind === kind && item.taskToken === taskToken) || null;
}

function persistedButlerTasksForRenderer() {
  const tasks = store && store.data && Array.isArray(store.data.butlerTasks) ? store.data.butlerTasks : [];
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const placedFileIds = new Set((store && store.data && Array.isArray(store.data.boardItems)
    ? store.data.boardItems : [])
    .map((item) => String(item && item.fileId || '').trim())
    .filter(Boolean));
  const outputIds = (task) => [
    task && task.downloadedFileId,
    ...(Array.isArray(task && task.downloadedFileIds) ? task.downloadedFileIds : [])
  ].map((id) => String(id || '').trim()).filter(Boolean);
  return tasks
    .filter((task) => {
      if (!task || Number(task.updatedAt) < cutoff) return false;
      const outputs = outputIds(task);
      return !outputs.length || outputs.some((id) => !placedFileIds.has(id));
    })
    .slice(-128)
    .map((task) => ({ ...task }));
}

function persistButlerDelivery(entry) {
  if (!store || !store.data || !entry || !entry.token) return;
  const deliveries = Array.isArray(store.data.butlerDeliveries) ? store.data.butlerDeliveries : [];
  const safe = {
    token: String(entry.token).slice(0, 256),
    requestId: String(entry.requestId || '').slice(0, 128),
    durationMs: Math.max(0, Math.round(Number(entry.durationMs) || 0)),
    estimatedCredits: entry.estimatedCredits === null ? null : Math.max(0, Number(entry.estimatedCredits) || 0),
    recordIds: Array.isArray(entry.recordIds) ? entry.recordIds.map((id) => String(id).slice(0, 128)).slice(0, 16) : [],
    status: entry.status === 'confirmed' || entry.status === 'released' ? entry.status : 'pending',
    confirmRequested: entry.confirmRequested === true,
    createdAt: Number(entry.createdAt) || Date.now(),
    result: entry.result && typeof entry.result === 'object' ? entry.result : null
  };
  const index = deliveries.findIndex((item) => item && item.token === safe.token);
  if (index === -1) deliveries.push(safe);
  else deliveries[index] = safe;
  store.data.butlerDeliveries = deliveries.slice(-BUTLER_DELIVERY_PERSIST_LIMIT);
  store.scheduleSave();
}

function removePersistedButlerDelivery(token) {
  if (!store || !store.data || !Array.isArray(store.data.butlerDeliveries)) return;
  store.data.butlerDeliveries = store.data.butlerDeliveries.filter((item) => item && item.token !== token);
  store.scheduleSave();
}

function restoreButlerState() {
  const tasks = Array.isArray(store && store.data && store.data.butlerTasks) ? store.data.butlerTasks : [];
  for (const task of tasks) {
    if (!task || !task.taskToken || !task.kind) continue;
    if (task.kind === 'image') butlerImageTasks.set(task.taskToken, { ...task });
    else if (task.kind === '3d') butler3dTasks.set(task.taskToken, { ...task });
    else if (task.kind === 'video') butlerVideoTasks.set(task.taskToken, { ...task });
  }
  const deliveries = Array.isArray(store && store.data && store.data.butlerDeliveries) ? store.data.butlerDeliveries : [];
  for (const delivery of deliveries) {
    if (!delivery || !delivery.token || !delivery.requestId || delivery.status !== 'pending') continue;
    butlerDeliveries.set(delivery.token, { ...delivery, timer: null, inFlight: null });
    scheduleButlerDeliveryRecovery(delivery.token, Math.max(1_000, BUTLER_DELIVERY_TTL_MS - Math.max(0, Date.now() - Number(delivery.createdAt || Date.now()))));
  }
}
const BUTLER_DELIVERY_TTL_MS = 30 * 60 * 1000;
const MAX_BUTLER_IMAGE_BYTES = Math.floor(7.5 * 1024 * 1024);
const MAX_BUTLER_VIDEO_BYTES = 48 * 1024 * 1024;
const MAX_BUTLER_VIDEO_OUTPUT_BYTES = 256 * 1024 * 1024;
const MAX_AI_REFERENCE_VIDEO_SOURCE_BYTES = 256 * 1024 * 1024;
const MAX_AI_REFERENCE_AUDIO_SOURCE_BYTES = MAX_SEEDANCE_REFERENCE_AUDIO_BYTES;
const MAX_BUTLER_PREVIEW_BYTES = 16 * 1024 * 1024;
const MAX_MODEL_PREVIEW_BYTES = 256 * 1024 * 1024;
const MAX_CLIPBOARD_IMAGE_BYTES = 64 * 1024 * 1024;
const MAX_CLIPBOARD_PNG_BYTES = 160 * 1024 * 1024;
const MODEL_FILE_EXTENSIONS = new Set(['.glb', '.fbx', '.obj']);
const MODEL_PREVIEW_CACHE_VERSION = 'pbr-v3';
const MODEL_PREVIEW_MARKER_FILENAME = `model-preview.${MODEL_PREVIEW_CACHE_VERSION}`;
const BUTLER_IMAGE_TOOL_IDS = new Set([
  'seededit-v3',
  'kling-image-expand',
  'clipdrop-uncrop',
  'cleanup',
  'clipdrop-upscale',
  'generative-upscale',
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
function butlerRetailCreditsFromPtc(ptc) {
  return retailCreditsFromUpstreamCny(Math.max(0, Number(ptc) || 0) * USD_TO_CNY);
}

const BUTLER_IMAGE_TOOL_CREDITS = Object.freeze({
  'background-remove': butlerRetailCreditsFromPtc(0.50),
  'seededit-v3': butlerRetailCreditsFromPtc(0.05),
  'kling-image-expand': butlerRetailCreditsFromPtc(0.50),
  'clipdrop-uncrop': butlerRetailCreditsFromPtc(0.50),
  cleanup: butlerRetailCreditsFromPtc(0.50),
  'clipdrop-upscale': butlerRetailCreditsFromPtc(0.50),
  'generative-upscale': butlerRetailCreditsFromPtc(0.80),
  'qwen-image-edit-plus': butlerRetailCreditsFromPtc(0.10),
  'qwen-image-layered': butlerRetailCreditsFromPtc(0.05),
  'super-upscale-v2': butlerRetailCreditsFromPtc(0.10),
  erase: butlerRetailCreditsFromPtc(0.50)
});

function butlerThreeDPricingOptions(providerId, options = {}) {
  const source = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
  if (providerId === 'hunyuan3d') {
    return {
      generateType: ['Normal', 'LowPoly', 'Geometry', 'Sketch'].includes(source.generateType)
        ? source.generateType : 'Normal',
      enablePbr: source.enablePbr === true,
      faceCount: Number.isFinite(Number(source.faceCount)) ? Number(source.faceCount) : 500000
    };
  }
  if (providerId === 'tripo3d') {
    return {
      texture: source.texture !== false,
      textureQuality: ['standard', 'detailed', 'extreme'].includes(source.textureQuality)
        ? source.textureQuality : 'standard'
    };
  }
  return {};
}

function butlerThreeDRetailCredits(providerId, options = {}) {
  const pricingOptions = butlerThreeDPricingOptions(providerId, options);
  if (providerId === 'hunyuan3d') {
    const type = pricingOptions.generateType;
    let ptc = type === 'Geometry' ? 0.30 : (type === 'LowPoly' || type === 'Sketch' ? 0.50 : 0.40);
    if (pricingOptions.enablePbr && type !== 'Geometry') ptc += 0.20;
    if (pricingOptions.faceCount > 0 && pricingOptions.faceCount !== 500000) ptc += 0.20;
    return butlerRetailCreditsFromPtc(ptc);
  }
  if (providerId === 'hyper3d') return butlerRetailCreditsFromPtc(0.70);
  if (providerId === 'tripo3d') {
    if (!pricingOptions.texture) return butlerRetailCreditsFromPtc(0.30);
    return butlerRetailCreditsFromPtc(pricingOptions.textureQuality === 'standard' ? 0.45 : 0.60);
  }
  return null;
}

const BUTLER_THREE_D_CREDITS = Object.freeze({
  hunyuan3d: butlerThreeDRetailCredits('hunyuan3d'),
  hyper3d: butlerThreeDRetailCredits('hyper3d'),
  tripo3d: butlerThreeDRetailCredits('tripo3d')
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
  const configured = process.env.MESSS_LIBRARY_ROOT
    ? null
    : configuredLibraryRoot(app.getPath('userData'));
  const candidates = [
    configured,
    getDefaultLibraryRoot(),
    path.join(app.getPath('documents'), 'MesssLibrary'),
    path.join(app.getPath('userData'), 'MesssLibrary')
  ].filter(Boolean);
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

async function relocateLibraryStore(selectedPath) {
  const target = path.resolve(String(selectedPath || '').trim());
  const current = path.resolve(store.dir);
  const samePath = process.platform === 'win32'
    ? target.toLowerCase() === current.toLowerCase()
    : target === current;
  if (samePath) return { ok: true, path: current, restarted: false };
  const movedPath = await store.moveLibraryTo(target);
  saveConfiguredLibraryRoot(app.getPath('userData'), movedPath);
  setImmediate(() => {
    app.relaunch();
    app.exit(0);
  });
  return { ok: true, path: movedPath, restarted: true };
}

const CANVAS_PACKAGE_MAGIC = Buffer.from('MESSS-CANVAS-PKG', 'ascii');
const CANVAS_PACKAGE_VERSION = 1;
const CANVAS_PACKAGE_HEADER_BYTES = CANVAS_PACKAGE_MAGIC.length + 8;
const MAX_CANVAS_PACKAGE_BYTES = 8 * 1024 * 1024 * 1024;
const MAX_CANVAS_PACKAGE_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_CANVAS_PACKAGE_FILES = 10000;

function canvasPackageError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function canvasPackageJsonClone(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    throw canvasPackageError('invalid-canvas-state', 'The canvas contains data that cannot be packaged safely.');
  }
}

async function writeCanvasPackageBytes(handle, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    const result = await handle.write(buffer, offset, buffer.length - offset, null);
    if (!result || !result.bytesWritten) throw canvasPackageError('package-write-failed', 'The .Messs package could not be written completely.');
    offset += result.bytesWritten;
  }
}

async function readCanvasPackageBytes(handle, length, position) {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const result = await handle.read(buffer, offset, length - offset, position + offset);
    if (!result || !result.bytesRead) throw canvasPackageError('truncated-package', 'The .Messs package ended before all data was read.');
    offset += result.bytesRead;
  }
  return buffer;
}

async function hashArchivedFile(filePath, stat) {
  const handle = await fs.promises.open(filePath, 'r');
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.alloc(1024 * 1024);
  let position = 0;
  try {
    while (position < stat.size) {
      const result = await handle.read(buffer, 0, Math.min(buffer.length, stat.size - position), position);
      if (!result || !result.bytesRead) throw canvasPackageError('source-read-failed', 'A canvas file could not be read completely.');
      hash.update(buffer.subarray(0, result.bytesRead));
      position += result.bytesRead;
    }
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}

async function assertCanvasPackageSource(file) {
  if (!file || !file.storedPath) throw canvasPackageError('missing-canvas-file', `The canvas file "${file && file.name || 'Unknown'}" is no longer available.`);
  let libraryRoot;
  let sourcePath;
  let sourceStat;
  try {
    [libraryRoot, sourcePath, sourceStat] = await Promise.all([
      fs.promises.realpath(store.libraryDir),
      fs.promises.realpath(file.storedPath),
      fs.promises.lstat(file.storedPath)
    ]);
  } catch (error) {
    throw canvasPackageError('missing-canvas-file', `The canvas file "${file.name || 'Unknown'}" is no longer available.`);
  }
  const relative = path.relative(libraryRoot, sourcePath);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || !relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw canvasPackageError('unsafe-canvas-file', `The canvas file "${file.name || 'Unknown'}" is outside the Messs library.`);
  }
  if (!Number.isSafeInteger(sourceStat.size) || sourceStat.size < 0) {
    throw canvasPackageError('invalid-canvas-file', `The canvas file "${file.name || 'Unknown'}" has an invalid size.`);
  }
  return { sourcePath, sourceStat };
}

function canvasPackageMetadata(file) {
  const metadata = canvasPackageJsonClone(file);
  delete metadata.id;
  delete metadata.storedPath;
  delete metadata.originalPath;
  delete metadata.url;
  delete metadata.thumbUrl;
  delete metadata.modelPreviewUrl;
  delete metadata.canvasId;
  delete metadata.folderId;
  return metadata;
}

async function prepareCanvasPackageExport(canvas) {
  const boardItems = store.data.boardItems
    .filter((item) => item && item.canvasId === canvas.id)
    .map((item) => canvasPackageJsonClone(item));
  const fileIds = new Set();
  boardItems.forEach((item) => {
    if (!item.fileId) return;
    fileIds.add(String(item.fileId));
  });
  const allFiles = store.data.files.filter((file) => file && (file.canvasId === canvas.id || fileIds.has(String(file.id))));
  const filesById = new Map(allFiles.map((file) => [String(file.id), file]));
  const missingReferenced = [...fileIds].filter((id) => !filesById.has(id));
  if (missingReferenced.length) {
    throw canvasPackageError('missing-canvas-file', 'The canvas contains a file record that is no longer available.');
  }

  const sources = [];
  let totalBytes = 0;
  for (const file of allFiles) {
    const { sourcePath, sourceStat } = await assertCanvasPackageSource(file);
    totalBytes += sourceStat.size;
    if (totalBytes > MAX_CANVAS_PACKAGE_BYTES) {
      throw canvasPackageError('package-too-large', 'This canvas is too large to export as one .Messs file.');
    }
    sources.push({
      sourceId: String(file.id),
      name: path.basename(String(file.name || 'Untitled')),
      metadata: canvasPackageMetadata(file),
      sourcePath,
      sizeBytes: sourceStat.size,
      sha256: await hashArchivedFile(sourcePath, sourceStat)
    });
  }
  const manifest = {
    format: 'messs-canvas-package',
    version: CANVAS_PACKAGE_VERSION,
    exportedAt: new Date().toISOString(),
    project: canvasPackageJsonClone(store.data.canvasProjects.find((entry) => entry.id === canvas.projectId) || null),
    canvas: canvasPackageJsonClone(canvas),
    boardItems,
    files: sources.map((source) => ({
      id: source.sourceId,
      name: source.name,
      metadata: source.metadata,
      sizeBytes: source.sizeBytes,
      sha256: source.sha256
    }))
  };
  return { manifest, sources, totalBytes };
}

function canvasPackageHeader(manifest) {
  const manifestBuffer = Buffer.from(JSON.stringify(manifest), 'utf8');
  if (manifestBuffer.length > MAX_CANVAS_PACKAGE_MANIFEST_BYTES) {
    throw canvasPackageError('manifest-too-large', 'The canvas metadata is too large to export safely.');
  }
  const header = Buffer.alloc(CANVAS_PACKAGE_HEADER_BYTES);
  CANVAS_PACKAGE_MAGIC.copy(header, 0);
  header.writeUInt32LE(CANVAS_PACKAGE_VERSION, CANVAS_PACKAGE_MAGIC.length);
  header.writeUInt32LE(manifestBuffer.length, CANVAS_PACKAGE_MAGIC.length + 4);
  return { header, manifestBuffer };
}

async function replaceCanvasPackageAtomically(temporaryPath, targetPath) {
  const backupPath = `${targetPath}.backup-${crypto.randomUUID()}`;
  let movedExisting = false;
  try {
    if (fs.existsSync(targetPath)) {
      await fs.promises.rename(targetPath, backupPath);
      movedExisting = true;
    }
    await fs.promises.rename(temporaryPath, targetPath);
    if (movedExisting) await fs.promises.rm(backupPath, { force: true });
  } catch (error) {
    if (movedExisting && !fs.existsSync(targetPath) && fs.existsSync(backupPath)) {
      await fs.promises.rename(backupPath, targetPath).catch(() => {});
    }
    throw error;
  } finally {
    await fs.promises.rm(backupPath, { force: true }).catch(() => {});
  }
}

async function copyFileAtomically(sourcePath, targetPath) {
  const temporaryPath = `${targetPath}.tmp-${crypto.randomUUID()}`;
  let handle = null;
  try {
    await fs.promises.copyFile(sourcePath, temporaryPath, fs.constants.COPYFILE_EXCL);
    handle = await fs.promises.open(temporaryPath, 'r+');
    await handle.sync();
    await handle.close();
    handle = null;
    await replaceCanvasPackageAtomically(temporaryPath, targetPath);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function writeCanvasPackage(targetPath, prepared) {
  const { header, manifestBuffer } = canvasPackageHeader(prepared.manifest);
  const temporaryPath = `${targetPath}.tmp-${crypto.randomUUID()}`;
  let output = null;
  try {
    output = await fs.promises.open(temporaryPath, 'wx', 0o600);
    await writeCanvasPackageBytes(output, header);
    await writeCanvasPackageBytes(output, manifestBuffer);
    const buffer = Buffer.alloc(1024 * 1024);
    for (const source of prepared.sources) {
      const input = await fs.promises.open(source.sourcePath, 'r');
      const hash = crypto.createHash('sha256');
      let position = 0;
      try {
        while (position < source.sizeBytes) {
          const result = await input.read(buffer, 0, Math.min(buffer.length, source.sizeBytes - position), position);
          if (!result || !result.bytesRead) throw canvasPackageError('source-read-failed', `The canvas file "${source.name}" changed while exporting.`);
          const chunk = buffer.subarray(0, result.bytesRead);
          hash.update(chunk);
          await writeCanvasPackageBytes(output, chunk);
          position += result.bytesRead;
        }
      } finally {
        await input.close();
      }
      const finalStat = await fs.promises.stat(source.sourcePath);
      if (position !== source.sizeBytes || finalStat.size !== source.sizeBytes || hash.digest('hex') !== source.sha256) {
        throw canvasPackageError('source-changed', `The canvas file "${source.name}" changed while exporting. Please try again.`);
      }
    }
    await output.sync();
    await output.close();
    output = null;
    await replaceCanvasPackageAtomically(temporaryPath, targetPath);
  } catch (error) {
    if (output) await output.close().catch(() => {});
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function readCanvasPackageManifest(packagePath) {
  const stat = await fs.promises.stat(packagePath);
  if (!stat.isFile() || stat.size > MAX_CANVAS_PACKAGE_BYTES) {
    throw canvasPackageError('package-too-large', 'This .Messs package is too large or is not a file.');
  }
  if (stat.size < CANVAS_PACKAGE_HEADER_BYTES) throw canvasPackageError('invalid-package', 'This is not a valid .Messs canvas package.');
  const handle = await fs.promises.open(packagePath, 'r');
  try {
    const header = await readCanvasPackageBytes(handle, CANVAS_PACKAGE_HEADER_BYTES, 0);
    if (!header.subarray(0, CANVAS_PACKAGE_MAGIC.length).equals(CANVAS_PACKAGE_MAGIC)) {
      throw canvasPackageError('invalid-package', 'This is not a valid .Messs canvas package.');
    }
    const version = header.readUInt32LE(CANVAS_PACKAGE_MAGIC.length);
    const manifestLength = header.readUInt32LE(CANVAS_PACKAGE_MAGIC.length + 4);
    if (version !== CANVAS_PACKAGE_VERSION || manifestLength <= 0 || manifestLength > MAX_CANVAS_PACKAGE_MANIFEST_BYTES) {
      throw canvasPackageError('unsupported-package', 'This .Messs package was created by an unsupported version of Messs.');
    }
    const manifestBuffer = await readCanvasPackageBytes(handle, manifestLength, CANVAS_PACKAGE_HEADER_BYTES);
    let manifest;
    try {
      manifest = JSON.parse(manifestBuffer.toString('utf8'));
    } catch (error) {
      throw canvasPackageError('invalid-package', 'The .Messs package metadata is damaged.');
    }
    if (!manifest || manifest.format !== 'messs-canvas-package' || manifest.version !== CANVAS_PACKAGE_VERSION ||
        !manifest.canvas || typeof manifest.canvas !== 'object' || !Array.isArray(manifest.boardItems) || !Array.isArray(manifest.files)) {
      throw canvasPackageError('invalid-package', 'The .Messs package metadata is incomplete.');
    }
    if (manifest.files.length > MAX_CANVAS_PACKAGE_FILES) throw canvasPackageError('package-too-many-files', 'This .Messs package contains too many files.');
    const ids = new Set();
    let payloadBytes = 0;
    manifest.files.forEach((entry) => {
      const id = String(entry && entry.id || '');
      const name = String(entry && entry.name || '');
      const sizeBytes = Number(entry && entry.sizeBytes);
      if (!id || id.length > 128 || ids.has(id) || !name || path.basename(name) !== name || name.includes('\0') ||
          !Number.isSafeInteger(sizeBytes) || sizeBytes < 0 || !/^[a-f0-9]{64}$/i.test(String(entry.sha256 || '')) ||
          !entry.metadata || typeof entry.metadata !== 'object' || Array.isArray(entry.metadata)) {
        throw canvasPackageError('invalid-package', 'The .Messs package contains an invalid file entry.');
      }
      ids.add(id);
      payloadBytes += sizeBytes;
      if (payloadBytes > MAX_CANVAS_PACKAGE_BYTES) throw canvasPackageError('package-too-large', 'This .Messs package is too large.');
    });
    const payloadOffset = CANVAS_PACKAGE_HEADER_BYTES + manifestLength;
    if (payloadOffset + payloadBytes !== stat.size) {
      throw canvasPackageError('truncated-package', 'The .Messs package does not contain exactly the files listed in its metadata.');
    }
    return { manifest, payloadOffset, stat };
  } finally {
    await handle.close();
  }
}

function uniqueImportedCanvasName(value) {
  const base = canvasFolderName(value || 'Imported canvas');
  let name = base;
  let index = 2;
  while (store.data.canvases.some((canvas) => String(canvas.name).toLowerCase() === name.toLowerCase()) ||
         fs.existsSync(canvasStorageDir({ name }))) {
    name = `${base} (${index++})`;
  }
  return name;
}

async function extractCanvasPackageFile(handle, packagePath, position, entry, targetPath) {
  const output = await fs.promises.open(targetPath, 'wx', 0o600);
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.alloc(1024 * 1024);
  let readTotal = 0;
  try {
    while (readTotal < entry.sizeBytes) {
      const result = await handle.read(buffer, 0, Math.min(buffer.length, entry.sizeBytes - readTotal), position + readTotal);
      if (!result || !result.bytesRead) throw canvasPackageError('truncated-package', `The .Messs package is missing data for "${entry.name}".`);
      hash.update(buffer.subarray(0, result.bytesRead));
      await writeCanvasPackageBytes(output, buffer.subarray(0, result.bytesRead));
      readTotal += result.bytesRead;
    }
    await output.sync();
  } finally {
    await output.close();
  }
  const sha256 = hash.digest('hex');
  if (readTotal !== entry.sizeBytes || sha256.toLowerCase() !== String(entry.sha256).toLowerCase()) {
    await fs.promises.rm(targetPath, { force: true }).catch(() => {});
    throw canvasPackageError('file-integrity-failed', `The file "${entry.name}" failed its integrity check.`);
  }
  return { packagePath, sha256 };
}

function remapImportedFileMetadata(metadata, fileIdMap) {
  const next = canvasPackageJsonClone(metadata || {});
  delete next.id;
  delete next.storedPath;
  delete next.originalPath;
  delete next.url;
  delete next.thumbUrl;
  delete next.modelPreviewUrl;
  delete next.canvasId;
  delete next.folderId;
  if (next.aiGeneration && Array.isArray(next.aiGeneration.referenceFileIds)) {
    next.aiGeneration.referenceFileIds = next.aiGeneration.referenceFileIds.map((id) => fileIdMap.get(String(id))).filter(Boolean);
  }
  if (next.butlerOperation && next.butlerOperation.sourceFileId) {
    next.butlerOperation.sourceFileId = fileIdMap.get(String(next.butlerOperation.sourceFileId)) || null;
  }
  return next;
}

async function importCanvasPackage(packagePath, targetProjectId) {
  const parsed = await readCanvasPackageManifest(packagePath);
  const targetProject = store.data.canvasProjects.find((entry) => entry.id === String(targetProjectId || '')) || store.data.canvasProjects[0];
  if (!targetProject) throw canvasPackageError('missing-folder', 'Create a folder before importing a canvas.');
  const fileIdMap = new Map();
  const stagingDir = path.join(store.libraryDir, `.messs-import-${crypto.randomUUID()}`);
  const extracted = [];
  const movedPaths = [];
  let archiveDir = null;
  let packageHandle = null;
  let committedCanvasId = null;
  const committedFileIds = [];
  const committedItemIds = [];
  try {
    await fs.promises.mkdir(stagingDir, { recursive: true, mode: 0o700 });
    packageHandle = await fs.promises.open(packagePath, 'r');
    let position = parsed.payloadOffset;
    for (const entry of parsed.manifest.files) {
      const newId = crypto.randomUUID();
      const ext = path.extname(entry.name);
      const stagedPath = path.join(stagingDir, `${newId}${ext}`);
      await extractCanvasPackageFile(packageHandle, packagePath, position, entry, stagedPath);
      extracted.push({ entry, newId, stagedPath });
      fileIdMap.set(String(entry.id), newId);
      position += entry.sizeBytes;
    }
    await packageHandle.close();
    packageHandle = null;
    if (position !== parsed.stat.size) throw canvasPackageError('truncated-package', 'The .Messs package contains unexpected trailing data.');

    const now = new Date().toISOString();
    const canvas = {
      id: crypto.randomUUID(),
      projectId: targetProject.id,
      name: uniqueImportedCanvasName(parsed.manifest.canvas.name),
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: null,
      pinned: parsed.manifest.canvas.pinned === true
    };
    archiveDir = canvasStorageDir(canvas);
    if (fs.existsSync(archiveDir)) throw canvasPackageError('canvas-name-conflict', 'A safe archive location for the imported canvas could not be created.');
    await fs.promises.mkdir(archiveDir, { recursive: true });

    const files = [];
    for (const item of extracted) {
      const destinationPath = path.join(archiveDir, `${item.newId}${path.extname(item.entry.name)}`);
      await fs.promises.rename(item.stagedPath, destinationPath);
      movedPaths.push(destinationPath);
      const stat = await fs.promises.stat(destinationPath);
      const metadata = remapImportedFileMetadata(item.entry.metadata, fileIdMap);
      files.push({
        ...metadata,
        id: item.newId,
        name: item.entry.name,
        originalPath: `Messs package: ${path.basename(packagePath)}`,
        storedPath: destinationPath,
        importedAt: now,
        sizeBytes: stat.size,
        canvasId: canvas.id,
        folderId: null,
        fingerprint: await makeFileFingerprint(destinationPath, stat)
      });
    }
    const boardItemIdMap = new Map(parsed.manifest.boardItems.map((item) => [
      String(item && item.id || ''),
      crypto.randomUUID()
    ]));
    const boardItems = parsed.manifest.boardItems.map((item) => {
      const next = canvasPackageJsonClone(item);
      next.id = boardItemIdMap.get(String(item && item.id || '')) || crypto.randomUUID();
      next.canvasId = canvas.id;
      if (next.fileId) {
        const mappedId = fileIdMap.get(String(next.fileId));
        if (!mappedId) throw canvasPackageError('invalid-package', `The canvas layout references a file that is not in the package.`);
        next.fileId = mappedId;
      }
      if (next.partitionId) {
        const mappedPartitionId = boardItemIdMap.get(String(next.partitionId));
        if (!mappedPartitionId) throw canvasPackageError('invalid-package', 'The canvas layout references a partition that is not in the package.');
        next.partitionId = mappedPartitionId;
      }
      return next;
    });

    const unlockedKeys = new Set();
    for (const file of files) {
      store.addFile(file);
      committedFileIds.push(file.id);
    }
    store.data.canvases.push(canvas);
    committedCanvasId = canvas.id;
    store.data.boardItems.push(...boardItems);
    committedItemIds.push(...boardItems.map((item) => item.id));
    if (!store.data.usage.importDays.includes(achievements.todayStr())) store.data.usage.importDays.push(achievements.todayStr());
    files.forEach((file) => {
      if (achievements.checkFirstImport(store)) unlockedKeys.add('first_import');
      if (achievements.checkLostFolder(store, file)) unlockedKeys.add('lost_folder');
      void store.mirrorFileToCustomPathAsync(file).catch((error) => {
        console.error('Could not mirror imported canvas file:', error && error.message || error);
      });
    });
    store.scheduleSave();
    if (unlockedKeys.size > 0) notifyAchievements();
    return {
      ok: true,
      canvas,
      files: files.map(fileToPayload),
      boardItems,
      projects: store.data.canvasProjects,
      canvases: store.data.canvases
    };
  } catch (error) {
    if (packageHandle) await packageHandle.close().catch(() => {});
    if (committedItemIds.length) {
      store.data.boardItems = store.data.boardItems.filter((item) => !committedItemIds.includes(item.id));
    }
    if (committedCanvasId) {
      store.data.canvases = store.data.canvases.filter((entry) => entry.id !== committedCanvasId);
    }
    committedFileIds.forEach((id) => store.removeFileById(id));
    for (const file of store.data.files.filter((entry) => movedPaths.includes(entry.storedPath))) store.removeFileById(file.id);
    await Promise.all(movedPaths.map((filePath) => fs.promises.rm(filePath, { force: true }).catch(() => {})));
    if (archiveDir) await fs.promises.rm(archiveDir, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function ensureCanvasPackagePath(filePath) {
  const normalized = String(filePath || '').trim();
  if (!normalized.toLowerCase().endsWith('.messs')) return `${normalized}.Messs`;
  return `${normalized.slice(0, -'.messs'.length)}.Messs`;
}

function canvasFolderName(name) {
  const cleaned = String(name || 'Untitled')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  return cleaned || 'Untitled';
}

function normalizeCanvasProjectScope(value) {
  return String(value || '').trim().toLowerCase() === 'team' ? 'team' : 'personal';
}

function persistentBoardItem(item, fallbackCanvasId = null) {
  if (!item || typeof item !== 'object' || !item.id) return null;
  const normalized = {
    ...item,
    canvasId: item.canvasId || fallbackCanvasId || undefined
  };
  // Selection belongs to one renderer window. Persisting or broadcasting it
  // makes a later drag/resize unexpectedly act on hundreds of stale items.
  delete normalized.selected;
  return normalized;
}

function canvasStorageDir(canvas) {
  return path.join(store.libraryDir, canvasFolderName(canvas && canvas.name));
}

function ensureCanvasState() {
  if (!Array.isArray(store.data.canvasProjects) || !store.data.canvasProjects.length) {
    store.data.canvasProjects = [{ id: 'project-1', name: 'General', scope: 'personal', createdAt: Date.now() }];
  }
  store.data.canvasProjects = store.data.canvasProjects.map((project, index) => ({
    ...project,
    id: String(project && project.id || `project-${index + 1}`),
    name: String(project && project.name || 'General').trim().slice(0, 80) || 'General',
    scope: normalizeCanvasProjectScope(project && project.scope),
    createdAt: project && project.createdAt || Date.now()
  }));
  if (!Array.isArray(store.data.canvases) || !store.data.canvases.length) {
    store.data.canvases = [{
      id: 'canvas-1',
      projectId: store.data.canvasProjects[0].id,
      name: 'Untitled',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }];
  }
  const validProjectIds = new Set(store.data.canvasProjects.map((project) => project.id));
  const fallbackProjectId = store.data.canvasProjects[0].id;
  store.data.canvases.forEach((canvas) => {
    if (!validProjectIds.has(canvas.projectId)) canvas.projectId = fallbackProjectId;
  });
  const validCanvasIds = new Set(store.data.canvases.map((canvas) => canvas.id));
  const fallbackCanvasId = store.data.canvases[0].id;
  const fileCanvasIds = new Map();
  store.data.boardItems.forEach((item) => {
    if (!validCanvasIds.has(item.canvasId)) item.canvasId = fallbackCanvasId;
    delete item.selected;
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
  ensureCanvasUsageLedger();
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
  return { ...updaterState, packaged: app.isPackaged, platform: process.platform };
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
  if (['downloading', 'downloaded', 'installing'].includes(updaterState.status)) return publicUpdaterState();
  if (updateCheckPromise) return updateCheckPromise;
  updateCheckPromise = (async () => {
    setUpdaterState({ status: 'checking', progress: null, message: null });
    let timeoutTimer;
    const timeout = new Promise((_, reject) => {
      timeoutTimer = setTimeout(() => {
        const error = new Error('The update check timed out.');
        error.code = 'updater-timeout';
        reject(error);
      }, 30_000);
      timeoutTimer.unref?.();
    });
    try {
      await Promise.race([autoUpdater.checkForUpdates(), timeout]);
    } catch (err) {
      console.error('checkForUpdates failed:', err.message);
      setUpdaterState({ status: 'error', message: String(err.message || 'Update check failed.') });
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
    }
    return publicUpdaterState();
  })().finally(() => {
    updateCheckPromise = null;
  });
  return updateCheckPromise;
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
  const initialTextSize = normalizeTextSize(store && store.data && store.data.settings && store.data.settings.textSize);
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
    query: { theme: initialTheme, language: initialLanguage, textSize: initialTextSize }
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
    store.data.boardItems = store.data.boardItems.filter((b) => survivingIds.has(b.fileId) || b.isNote || b.isDoodle || b.isMoodboard);
    store.reindexFiles();
    store.scheduleSave();
  }
}

function fileToPayload(f, aiDeliveryToken = null) {
  const ext = path.extname(f.name).toLowerCase();
  return {
    id: f.id,
    name: f.name,
    importedAt: f.importedAt,
    lastDownloadedAt: f.lastDownloadedAt || null,
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
      serviceTier: f.aiGeneration.serviceTier || null,
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
      estimatedCredits: f.aiGeneration.estimatedCredits !== null
        && f.aiGeneration.estimatedCredits !== undefined
        && Number.isFinite(Number(f.aiGeneration.estimatedCredits))
        ? Math.max(0, Number(f.aiGeneration.estimatedCredits))
        : null,
      accountingRequestId: String(f.aiGeneration.accountingRequestId || '').trim() || null,
      createdAt: f.aiGeneration.createdAt
    } : null,
    butlerOperation: f.butlerOperation ? {
      kind: String(f.butlerOperation.kind || '').slice(0, 80),
      modelId: String(f.butlerOperation.modelId || '').slice(0, 100) || null,
      sourceFileId: String(f.butlerOperation.sourceFileId || '').slice(0, 120) || null,
      estimatedCredits: Number.isFinite(Number(f.butlerOperation.estimatedCredits))
        ? Math.max(0, Number(f.butlerOperation.estimatedCredits)) : null,
      accountingRequestId: String(f.butlerOperation.accountingRequestId || '').trim().slice(0, 80) || null,
      pricingVersion: String(f.butlerOperation.pricingVersion || '').slice(0, 32) || null,
      createdAt: f.butlerOperation.createdAt || null
    } : null,
    folderId: f.folderId || null,
    ext,
    url: 'messs-file://' + f.id,
    // Small cached thumbnail for list/grid display 锟?only meaningful for
    // images (thumbnails.isThumbnailableExt gates that on the main-process
    // side too), but it's harmless to always include the URL since the
    // renderer only ever uses it where it already checks isImageExt.
    thumbUrl: 'messs-thumb://' + f.id,
    ...(MODEL_FILE_EXTENSIONS.has(ext) ? { modelPreviewUrl: `messs-preview://${f.id}/model` } : {}),
    ...(aiDeliveryToken ? { aiDeliveryToken: String(aiDeliveryToken).slice(0, 256) } : {})
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

  if (updateInstallFallbackTimer) clearTimeout(updateInstallFallbackTimer);
  updateInstallFallbackTimer = setTimeout(() => {
    updateInstallFallbackTimer = null;
    if (updateInstallStarted) app.quit();
  }, 15_000);
  updateInstallFallbackTimer.unref?.();
  // macOS needs the forced-run-after-install flag so the app does not remain
  // hidden after the ZIP updater finishes. Windows keeps the visible NSIS
  // installer flow and its existing elevation behavior.
  autoUpdater.quitAndInstall(false, process.platform === 'darwin');
  return { ok: true, installing: true };
}

async function readSourceMediaMetadata(filePath, ext) {
  const normalizedExt = String(ext || '').toLowerCase();
  if (preview.isVideoExt(normalizedExt)) {
    // Metadata is optional. A packaged macOS build can be denied access to a
    // temporary codec helper even after the file itself was copied. That
    // must never turn a valid import into a failed import.
    try { return await probeVideoMetadata(filePath, { timeoutMs: 5_000 }); } catch (error) { return null; }
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

function normalizeExternalFilePath(value) {
  let source = String(value || '').trim().normalize('NFC');
  if (!source) return '';
  if (/^file:\/\//i.test(source)) {
    try {
      const parsed = new URL(source);
      if (parsed.protocol !== 'file:') return '';
      let pathname = decodeURIComponent(parsed.pathname || '');
      if (!pathname) return '';
      if (parsed.hostname && parsed.hostname !== 'localhost') pathname = `//${parsed.hostname}${pathname}`;
      else if (/^\/[A-Za-z]:\//.test(pathname)) pathname = pathname.slice(1);
      source = pathname;
    } catch (error) {
      return '';
    }
  }
  return path.normalize(source);
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
  const sender = conversation && (conversation.type === 'group' ? conversation.name : conversation.other && conversation.other.displayName)
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
async function importOneFile(originalPath, folderId, unlockedKeys, today, canvasId, options = {}) {
  const sourcePath = normalizeExternalFilePath(originalPath);
  if (!sourcePath) {
    throw Object.assign(new Error('The selected file path is invalid.'), { code: 'invalid-file-path' });
  }
  const stat = await fs.promises.stat(sourcePath);
  if (!stat.isFile()) return null;

  const id = crypto.randomUUID();
  const name = options.name || path.basename(sourcePath);
  const ext = path.extname(name);
  const canvas = store.data.canvases.find((entry) => entry.id === canvasId) || store.data.canvases[0];
  const archiveDir = canvasStorageDir(canvas);
  await fs.promises.mkdir(archiveDir, { recursive: true });
  const storedPath = path.join(archiveDir, id + ext);
  let record = null;
  let addedToStore = false;
  try {
    const sourceFingerprint = await makeFileFingerprint(sourcePath, stat);
    await fs.promises.copyFile(sourcePath, storedPath);
    const copiedStat = await fs.promises.stat(storedPath);
    const copiedFingerprint = await makeFileFingerprint(storedPath, copiedStat);
    if (copiedStat.size !== stat.size || copiedFingerprint !== sourceFingerprint) {
      throw Object.assign(new Error('Archived copy integrity verification failed'), { code: 'archive-integrity-failed' });
    }
    const sourceFolder = options.sourceFolder || path.basename(path.dirname(sourcePath));
    const classification = classifyArchiveFile(name);
    const sourceDimensions = await readSourceMediaMetadata(storedPath, ext);
    record = {
      id,
      name,
      originalPath: Object.prototype.hasOwnProperty.call(options, 'originalPath')
        ? options.originalPath
        : sourcePath,
      storedPath,
      importedAt: new Date().toISOString(),
      sourceFolder,
      sizeBytes: stat.size,
      ...(sourceDimensions || {}),
      ...(sourceDimensions && preview.isVideoExt(String(ext).toLowerCase()) ? { mediaMetadataVersion: 1 } : {}),
      ...classification,
      fingerprint: sourceFingerprint,
      folderId: folderId || null,
      canvasId: canvas ? canvas.id : null
    };
    store.addFile(record);
    addedToStore = true;
    // Mirroring is a convenience copy. Keep the canonical library record even
    // when an external mirror is unavailable on a protected macOS volume.
    await store.mirrorFileToCustomPathAsync(record);
    if (!store.data.usage.importDays.includes(today)) store.data.usage.importDays.push(today);

    if (achievements.checkFirstImport(store)) unlockedKeys.add('first_import');
    if (achievements.checkLostFolder(store, record)) unlockedKeys.add('lost_folder');
    return record;
  } catch (error) {
    if (addedToStore && record) store.removeFileById(record.id);
    await fs.promises.rm(storedPath, { force: true }).catch(() => {});
    throw error;
  }
}

function fileImportFailure(originalPath, error, stage = 'import') {
  const value = error || {};
  const code = String(value.code || `${stage}-failed`).slice(0, 80);
  let message = String(value.message || 'The selected file could not be imported.').trim();
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    message = 'The selected file is no longer available.';
  } else if (code === 'EACCES' || code === 'EPERM') {
    message = process.platform === 'darwin'
      ? 'macOS denied access to this file. Choose it again from Finder or allow Messs to access Files and Folders in System Settings.'
      : 'Messs could not access this file.';
  } else if (stage === 'prepare') {
    message = 'The file was imported, but it could not be prepared as an AI attachment.';
  } else if (code === 'not-a-file') {
    message = 'The selected path is not a file.';
  } else {
    // Do not send native fs error strings back to the renderer: macOS often
    // includes the complete local path in them.
    message = 'The selected file could not be imported.';
  }
  return {
    name: path.basename(String(originalPath || 'selected file')),
    stage,
    reason: code,
    message: message.slice(0, 400)
  };
}

async function importFilePaths(filePaths, folderId, canvasId, options = {}, ownerWindow = mainWindow) {
  const importedNow = [];
  const unlockedKeys = new Set();
  const failed = [];
  const paths = Array.isArray(filePaths)
    ? [...new Set(filePaths.map(normalizeExternalFilePath).filter(Boolean))]
    : [];
  const today = achievements.todayStr();

  for (const originalPath of paths) {
    try {
      const record = await importOneFile(originalPath, folderId, unlockedKeys, today, canvasId);
      if (record) importedNow.push(fileToPayload(record));
      else failed.push(fileImportFailure(originalPath, Object.assign(new Error('The selected path is not a file.'), { code: 'not-a-file' })));
    } catch (error) {
      console.error('Failed to import selected file:', originalPath, error);
      failed.push(fileImportFailure(originalPath, error));
    }
  }

  store.scheduleSave();
  if (unlockedKeys.size > 0) notifyAchievements();

  // A drag from Finder can expose a valid path before macOS has granted the
  // app a TCC read scope. A native open panel is the reliable recovery path:
  // selecting the file there grants the user-selected read scope, after which
  // the same import succeeds. The drag-byte fallback disables this panel so a
  // normal Finder drop remains non-blocking.
  if (process.platform === 'darwin' && options.recoverAccess !== false &&
      failed.some((entry) => entry && ['EACCES', 'EPERM'].includes(entry.reason))) {
    try {
      const recovery = await dialog.showOpenDialog(ownerWindow && !ownerWindow.isDestroyed() ? ownerWindow : mainWindow, {
        title: 'Allow Messs to import the selected file',
        defaultPath: paths[0],
        properties: ['openFile', 'multiSelections']
      });
      if (!recovery.canceled && Array.isArray(recovery.filePaths) && recovery.filePaths.length) {
        const recovered = await importFilePaths(recovery.filePaths, folderId, canvasId, { recoverAccess: false }, ownerWindow);
        return {
          imported: [...importedNow, ...(recovered.imported || [])],
          unlocked: [...new Set([...unlockedKeys, ...(recovered.unlocked || [])])],
          failed: recovered.failed || []
        };
      }
    } catch (error) {
      console.error('macOS file access recovery failed:', error && error.message || error);
    }
  }
  return { imported: importedNow, unlocked: [...unlockedKeys], failed };
}

function normalizeDroppedFileName(value) {
  const name = String(value || '').normalize('NFC');
  if (!name || name === '.' || name === '..' || name.length > 240) {
    throw new Error('The dropped file name is invalid.');
  }
  if (/[\\/\0-\x1f\x7f]/.test(name)) {
    throw new Error('The dropped file name contains unsafe characters.');
  }
  return name;
}

function droppedFileChunk(value) {
  if (Buffer.isBuffer(value)) return value;
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  // Electron's structured-clone bridge can represent a typed array as a
  // plain object on some macOS/Electron combinations. Accept the common
  // Buffer JSON shape and numeric-array shape without trusting arbitrary data.
  if (value && value.type === 'Buffer' && Array.isArray(value.data)) return Buffer.from(value.data);
  if (Array.isArray(value)) return Buffer.from(value);
  if (value && Array.isArray(value.data)) return Buffer.from(value.data);
  if (value && Number.isSafeInteger(value.length) && value.length >= 0 && value.length <= DROPPED_FILE_CHUNK_BYTES) {
    try { return Buffer.from(Array.from({ length: value.length }, (_item, index) => value[index])); } catch (error) {}
  }
  throw new Error('The dropped file chunk is invalid.');
}

async function disposeDroppedFileImport(session) {
  if (!session) return;
  try { await session.handle.close(); } catch (error) {}
  await fs.promises.rm(session.directory, { recursive: true, force: true }).catch(() => {});
}

function ownedDroppedFileImport(event, uploadId) {
  const session = droppedFileImports.get(String(uploadId || ''));
  if (!session || session.senderId !== event.sender.id) {
    throw new Error('The dropped file import session is no longer available.');
  }
  return session;
}

async function beginDroppedFileImport(event, metadata = {}, folderId, canvasId) {
  const size = Number(metadata.size);
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_DROPPED_FILE_BYTES) {
    throw new Error('The dropped file is too large or has an invalid size.');
  }
  const activeForSender = [...droppedFileImports.values()]
    .filter((session) => session.senderId === event.sender.id).length;
  if (activeForSender >= 8) throw new Error('Too many dropped files are being imported at once.');

  const name = normalizeDroppedFileName(metadata.name);
  const uploadId = crypto.randomUUID();
  const directory = path.join(app.getPath('temp'), 'messs-file-drop', uploadId);
  const temporaryPath = path.join(directory, name);
  let handle;
  try {
    await fs.promises.mkdir(directory, { recursive: true });
    handle = await fs.promises.open(temporaryPath, 'wx', 0o600);
  } catch (error) {
    await fs.promises.rm(directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  droppedFileImports.set(uploadId, {
    uploadId,
    senderId: event.sender.id,
    name,
    size,
    received: 0,
    folderId: folderId || null,
    canvasId: canvasId || null,
    directory,
    temporaryPath,
    handle,
    finalizing: false,
    touchedAt: Date.now()
  });
  return { uploadId, chunkSize: DROPPED_FILE_CHUNK_BYTES };
}

async function appendDroppedFileChunk(event, uploadId, value) {
  const session = ownedDroppedFileImport(event, uploadId);
  if (session.finalizing) throw new Error('The dropped file import is already finishing.');
  const chunk = droppedFileChunk(value);
  if (!chunk.length || chunk.length > DROPPED_FILE_CHUNK_BYTES) {
    throw new Error('The dropped file chunk has an invalid size.');
  }
  if (session.received + chunk.length > session.size) {
    throw new Error('The dropped file contains more data than expected.');
  }
  const result = await session.handle.write(chunk, 0, chunk.length, session.received);
  if (result.bytesWritten !== chunk.length) throw new Error('The dropped file could not be written completely.');
  session.received += result.bytesWritten;
  session.touchedAt = Date.now();
  return { received: session.received };
}

async function finishDroppedFileImport(event, uploadId) {
  const session = ownedDroppedFileImport(event, uploadId);
  if (session.finalizing) throw new Error('The dropped file import is already finishing.');
  session.finalizing = true;
  droppedFileImports.delete(session.uploadId);
  const importedNow = [];
  const unlockedKeys = new Set();
  try {
    if (session.received !== session.size) {
      throw new Error(`The dropped file is incomplete (${session.received}/${session.size} bytes).`);
    }
    await session.handle.sync();
    await session.handle.close();
    const written = await fs.promises.stat(session.temporaryPath);
    if (!written.isFile() || written.size !== session.size) {
      throw new Error('The dropped file failed its size verification.');
    }
    const record = await importOneFile(
      session.temporaryPath,
      session.folderId,
      unlockedKeys,
      achievements.todayStr(),
      session.canvasId,
      { name: session.name, originalPath: null, sourceFolder: 'Finder' }
    );
    if (record) importedNow.push(fileToPayload(record));
    store.scheduleSave();
    if (unlockedKeys.size > 0) notifyAchievements();
    return { imported: importedNow, unlocked: [...unlockedKeys] };
  } finally {
    await disposeDroppedFileImport(session);
  }
}

async function abortDroppedFileImport(event, uploadId) {
  const session = ownedDroppedFileImport(event, uploadId);
  droppedFileImports.delete(session.uploadId);
  await disposeDroppedFileImport(session);
  return { ok: true };
}

function appFetch(url, options) {
  if (typeof fetch === 'function') return fetch(url, options);
  return net.fetch(url, options);
}

const MAX_WORKSHOP_MEDIA_BYTES = 128 * 1024 * 1024;
const WORKSHOP_MEDIA_BUCKET = 'workshop-media';

function workshopCloudError(code, message, status = 503) {
  return Object.assign(new Error(message), { code, status });
}

function assertWorkshopCloudConfigured() {
  if (!runtimeConfig || !runtimeConfig.supabaseUrl || !runtimeConfig.supabasePublishableKey) {
    throw workshopCloudError('cloud-not-configured', 'Workshop cloud storage is not configured in this build.');
  }
  if (!supabaseAuth) throw workshopCloudError('auth-required', 'Sign in to use Workshop cloud sharing.', 401);
}

async function workshopCloudRequest(pathname, options = {}) {
  assertWorkshopCloudConfigured();
  const token = await supabaseAuth.getAccessToken();
  const response = await appFetch(`${String(runtimeConfig.supabaseUrl).replace(/\/$/, '')}${pathname}`, {
    method: options.method || 'GET',
    headers: {
      apikey: runtimeConfig.supabasePublishableKey,
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(options.contentType ? { 'Content-Type': options.contentType } : {}),
      ...(options.headers || {})
    },
    ...(options.body === undefined ? {} : { body: options.body })
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch (error) { payload = text || null; }
  if (!response.ok) {
    const detail = payload && typeof payload === 'object'
      ? payload.message || payload.hint || payload.details || payload.error
      : payload;
    throw workshopCloudError(
      String(payload && payload.code || (response.status === 401 ? 'auth-required' : 'workshop-cloud-failed')),
      String(detail || `Workshop cloud request failed (HTTP ${response.status}).`),
      response.status
    );
  }
  return payload;
}

function workshopSourceFile(fileId) {
  const file = store && store.getFile(String(fileId || ''));
  if (!file || !file.storedPath) throw workshopCloudError('not-found', 'The selected canvas file is no longer available.', 404);
  const ext = String(file.ext || path.extname(file.name)).toLowerCase();
  if (!preview.isImageExt(ext) && !preview.isVideoExt(ext)) {
    throw workshopCloudError('unsupported-media', 'Workshop only accepts images and videos.', 400);
  }
  let libraryRoot;
  let resolvedPath;
  try {
    libraryRoot = fs.realpathSync(store.libraryDir);
    resolvedPath = fs.realpathSync(file.storedPath);
  } catch (error) {
    throw workshopCloudError('not-found', 'The selected canvas file could not be read.', 404);
  }
  const relative = path.relative(libraryRoot, resolvedPath);
  if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw workshopCloudError('unsafe-file', 'The selected file is outside the Messs library.', 400);
  }
  const stat = fs.statSync(resolvedPath);
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_WORKSHOP_MEDIA_BYTES) {
    throw workshopCloudError('media-too-large', 'This image or video is empty or larger than 128 MB.', 413);
  }
  return { file, ext, resolvedPath, stat };
}

function workshopStoragePathSegment(value, fallback = 'media') {
  const cleaned = String(value || fallback)
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 90);
  return cleaned || fallback;
}

function workshopStoragePublicUrl(storagePath) {
  const encoded = String(storagePath || '').split('/').map((part) => encodeURIComponent(part)).join('/');
  return `${String(runtimeConfig.supabaseUrl).replace(/\/$/, '')}/storage/v1/object/public/${WORKSHOP_MEDIA_BUCKET}/${encoded}`;
}

function workshopPostUrl() {
  const url = new URL(`${String(runtimeConfig.supabaseUrl).replace(/\/$/, '')}/rest/v1/workshop_posts`);
  url.searchParams.set('select', 'id,owner_id,title,description,prompt,kind,media_path,media_url,mime_type,source_file_name,tags,clicks,likes,created_at');
  return url;
}

async function listWorkshopPosts() {
  const url = workshopPostUrl();
  url.searchParams.set('order', 'clicks.desc,created_at.desc');
  url.searchParams.set('limit', '200');
  const posts = await workshopCloudRequest(`${url.pathname}${url.search}`, { method: 'GET' });
  return { ok: true, posts: Array.isArray(posts) ? posts : [] };
}

async function publishWorkshopPost(fileId, metadata = {}) {
  const source = workshopSourceFile(fileId);
  const title = String(metadata.title || '').trim().slice(0, 80);
  if (!title) throw workshopCloudError('invalid-title', 'A Workshop title is required.', 400);
  const description = String(metadata.description || '').trim().slice(0, 300);
  const prompt = String(source.file.aiGeneration && source.file.aiGeneration.prompt || '').trim().slice(0, 12000);
  const tags = [...new Set((Array.isArray(metadata.tags) ? metadata.tags : [])
    .map((tag) => String(tag || '').trim().slice(0, 24))
    .filter(Boolean))].slice(0, 12);
  const session = supabaseAuth.getPublicSession();
  const ownerId = session && session.user && session.user.id;
  if (!ownerId) throw workshopCloudError('auth-required', 'Sign in before publishing to Workshop.', 401);
  const kind = preview.isVideoExt(source.ext) ? 'video' : 'image';
  const storagePath = `${ownerId}/${crypto.randomUUID()}-${workshopStoragePathSegment(source.file.name, 'media')}`;
  const mediaBuffer = await fs.promises.readFile(source.resolvedPath);
  try {
    await workshopCloudRequest(`/storage/v1/object/${WORKSHOP_MEDIA_BUCKET}/${storagePath.split('/').map((part) => encodeURIComponent(part)).join('/')}`, {
      method: 'POST',
      contentType: source.file.mimeType || localMediaMimeType(source.resolvedPath),
      headers: { 'x-upsert': 'false' },
      body: mediaBuffer
    });
    const payload = JSON.stringify({
      owner_id: ownerId,
      title,
      description,
      prompt,
      kind,
      media_path: storagePath,
      media_url: workshopStoragePublicUrl(storagePath),
      mime_type: source.file.mimeType || localMediaMimeType(source.resolvedPath),
      source_file_name: String(source.file.name || 'media').slice(0, 240),
      tags
    });
    const url = workshopPostUrl();
    const posts = await workshopCloudRequest(`${url.pathname}${url.search}`, {
      method: 'POST',
      contentType: 'application/json',
      headers: { Prefer: 'return=representation' },
      body: payload
    });
    return { ok: true, post: Array.isArray(posts) ? posts[0] || null : posts };
  } catch (error) {
    // A failed row insert must not leave an orphaned public media object.
    try {
      await workshopCloudRequest(`/storage/v1/object/${WORKSHOP_MEDIA_BUCKET}/${storagePath.split('/').map((part) => encodeURIComponent(part)).join('/')}`, {
        method: 'DELETE'
      });
    } catch (cleanupError) {}
    throw error;
  }
}

async function downloadWorkshopPostMedia(post) {
  const storagePath = String(post && post.media_path || '').trim();
  const ownerId = String(post && post.owner_id || '').trim();
  const parts = storagePath.split('/');
  if (!ownerId || parts.length < 2 || parts[0] !== ownerId || parts.some((part) => !part || part === '.' || part === '..' || /[\x00-\x1f]/.test(part))) {
    throw workshopCloudError('unsafe-media-path', 'The Workshop media path is invalid.', 400);
  }
  const token = await supabaseAuth.getAccessToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await appFetch(`${String(runtimeConfig.supabaseUrl).replace(/\/$/, '')}/storage/v1/object/public/${WORKSHOP_MEDIA_BUCKET}/${parts.map((part) => encodeURIComponent(part)).join('/')}`, {
      method: 'GET',
      headers: {
        apikey: runtimeConfig.supabasePublishableKey,
        Authorization: `Bearer ${token}`,
        Accept: post.kind === 'video' ? 'video/*' : 'image/*'
      },
      signal: controller.signal
    });
    if (!response.ok) {
      throw workshopCloudError('media-download-failed', `The Workshop media could not be downloaded (HTTP ${response.status}).`, response.status);
    }
    const contentLength = Number(response.headers && response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_WORKSHOP_MEDIA_BYTES) {
      throw workshopCloudError('media-too-large', 'This Workshop work is larger than 128 MB.', 413);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_WORKSHOP_MEDIA_BYTES) {
      throw workshopCloudError('media-too-large', 'This Workshop work is empty or larger than 128 MB.', 413);
    }
    return buffer;
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw workshopCloudError('media-download-timeout', 'The Workshop media download timed out.', 504);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function importWorkshopPostMedia(postId, folderId, canvasId) {
  const id = String(postId || '').trim();
  if (!/^[0-9a-f-]{20,80}$/i.test(id)) throw workshopCloudError('invalid-post', 'The Workshop post id is invalid.', 400);
  const lookup = workshopPostUrl();
  lookup.searchParams.set('id', `eq.${id}`);
  lookup.searchParams.set('limit', '1');
  const matches = await workshopCloudRequest(`${lookup.pathname}${lookup.search}`, { method: 'GET' });
  const post = Array.isArray(matches) ? matches[0] : null;
  if (!post) throw workshopCloudError('not-found', 'The Workshop work was not found.', 404);

  const buffer = await downloadWorkshopPostMedia(post);
  let extension = '';
  if (post.kind === 'image') {
    if (!sharp) throw workshopCloudError('image-validation-unavailable', 'Secure image validation is unavailable in this build.', 503);
    let metadata;
    try {
      metadata = await sharp(buffer, { failOn: 'error', limitInputPixels: 512 * 1024 * 1024 }).metadata();
    } catch (error) {
      throw workshopCloudError('invalid-image', 'The Workshop image could not be read.', 400);
    }
    extension = ({ jpeg: 'jpg', png: 'png', webp: 'webp', gif: 'gif', avif: 'avif', heif: 'heic', tiff: 'tiff', bmp: 'bmp' })[metadata.format];
    if (!extension || !(metadata.width > 0 && metadata.height > 0)) {
      throw workshopCloudError('invalid-image', 'The Workshop image format is not supported.', 400);
    }
  } else {
    extension = detectGeneratedVideoExtension(buffer);
    const mimeType = extension === 'webm' ? 'video/webm' : 'video/mp4';
    validateButlerVideoBuffer(buffer, mimeType);
  }

  const idForFile = crypto.randomUUID();
  const canvas = store.data.canvases.find((entry) => entry.id === canvasId) || store.data.canvases[0];
  const archiveDir = canvasStorageDir(canvas);
  const sourceName = path.basename(String(post.source_file_name || post.title || `workshop-${id}`)).replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').trim();
  const baseName = path.basename(sourceName, path.extname(sourceName)).replace(/[. ]+$/g, '').trim() || `workshop-${id.slice(0, 8)}`;
  const name = `${baseName.slice(0, 180)}.${extension}`;
  const storedPath = path.join(archiveDir, `${idForFile}.${extension}`);
  const unlockedKeys = new Set();
  let record = null;
  try {
    await fs.promises.mkdir(archiveDir, { recursive: true });
    await fs.promises.writeFile(storedPath, buffer, { mode: 0o600 });
    const stat = await fs.promises.stat(storedPath);
    const sourceDimensions = await readSourceMediaMetadata(storedPath, `.${extension}`);
    record = {
      id: idForFile,
      name,
      originalPath: `workshop:${id}`,
      importedAt: new Date().toISOString(),
      sourceFolder: 'Workshop',
      sizeBytes: stat.size,
      ...sourceDimensions,
      ...(post.kind === 'video' ? { mediaMetadataVersion: 1 } : {}),
      ...classifyArchiveFile(name),
      fingerprint: await makeFileFingerprint(storedPath, stat),
      folderId: folderId || null,
      canvasId: canvas ? canvas.id : null
    };
    store.addFile(record);
    await store.mirrorFileToCustomPathAsync(record);
    const today = achievements.todayStr();
    if (!store.data.usage.importDays.includes(today)) store.data.usage.importDays.push(today);
    if (achievements.checkFirstImport(store)) unlockedKeys.add('first_import');
    if (achievements.checkLostFolder(store, record)) unlockedKeys.add('lost_folder');
    store.scheduleSave();
    return { ok: true, file: fileToPayload(record), unlocked: Array.from(unlockedKeys) };
  } catch (error) {
    if (record) store.removeFileById(record.id);
    await fs.promises.rm(storedPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function incrementWorkshopClick(postId) {
  const id = String(postId || '').trim();
  if (!/^[0-9a-f-]{20,80}$/i.test(id)) throw workshopCloudError('invalid-post', 'The Workshop post id is invalid.', 400);
  const payload = JSON.stringify({ p_post_id: id });
  const result = await workshopCloudRequest('/rest/v1/rpc/workshop_increment_click', {
    method: 'POST', contentType: 'application/json', body: payload
  });
  return { ok: true, post: Array.isArray(result) ? result[0] || null : result };
}

async function toggleWorkshopLike(postId) {
  const id = String(postId || '').trim();
  if (!/^[0-9a-f-]{20,80}$/i.test(id)) throw workshopCloudError('invalid-post', 'The Workshop post id is invalid.', 400);
  const result = await workshopCloudRequest('/rest/v1/rpc/workshop_toggle_like', {
    method: 'POST', contentType: 'application/json', body: JSON.stringify({ p_post_id: id })
  });
  return { ok: true, ...(result && typeof result === 'object' && !Array.isArray(result) ? result : { result }) };
}

async function deleteWorkshopPost(postId) {
  const id = String(postId || '').trim();
  if (!/^[0-9a-f-]{20,80}$/i.test(id)) throw workshopCloudError('invalid-post', 'The Workshop post id is invalid.', 400);
  assertWorkshopCloudConfigured();
  const session = supabaseAuth.getPublicSession();
  const ownerId = session && session.user && session.user.id;
  if (!ownerId) throw workshopCloudError('auth-required', 'Sign in before deleting a Workshop work.', 401);

  let post = null;
  try {
    // The RPC performs the owner check and deletion in one database
    // transaction. This remains reliable when the table policy was created by
    // an older deployment and the client has not refreshed its schema yet.
    const deleted = await workshopCloudRequest('/rest/v1/rpc/workshop_delete_post', {
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({ p_post_id: id })
    });
    post = Array.isArray(deleted) ? deleted[0] || null : deleted;
  } catch (error) {
    const rpcUnavailable = Number(error && error.status) === 404 || error && error.code === 'PGRST202';
    if (!rpcUnavailable) throw error;
  }

  if (!post) {
    // Compatibility path for databases that predate the owner-bound delete
    // RPC. Both requests remain owner-scoped, so a stale client cannot delete
    // another user's post.
    const lookup = workshopPostUrl();
    lookup.searchParams.set('id', `eq.${id}`);
    lookup.searchParams.set('owner_id', `eq.${ownerId}`);
    lookup.searchParams.set('limit', '1');
    const matches = await workshopCloudRequest(`${lookup.pathname}${lookup.search}`, { method: 'GET' });
    post = Array.isArray(matches) ? matches[0] || null : null;
    if (!post) throw workshopCloudError('not-owner', 'Only the creator can delete this Workshop work.', 403);

    const deletion = workshopPostUrl();
    deletion.searchParams.set('id', `eq.${id}`);
    deletion.searchParams.set('owner_id', `eq.${ownerId}`);
    deletion.searchParams.delete('order');
    deletion.searchParams.delete('limit');
    const deleted = await workshopCloudRequest(`${deletion.pathname}${deletion.search}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=representation' }
    });
    if (Array.isArray(deleted) && !deleted.length) {
      throw workshopCloudError('not-owner', 'Only the creator can delete this Workshop work.', 403);
    }
  }

  if (post && post.media_path) {
    const parts = String(post.media_path).split('/');
    const safeMediaPath = parts.length >= 2
      && parts[0] === String(ownerId)
      && parts.every((part) => part && part !== '.' && part !== '..' && !/[\x00-\x1f]/.test(part));
    if (!safeMediaPath) return { ok: true, postId: id };
    try {
      await workshopCloudRequest(`/storage/v1/object/${WORKSHOP_MEDIA_BUCKET}/${parts.map((part) => encodeURIComponent(part)).join('/')}`, {
        method: 'DELETE'
      });
    } catch (error) {
      // The database row is already gone; the object is no longer discoverable
      // even if storage cleanup is temporarily unavailable.
    }
  }
  return { ok: true, postId: id };
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
  const prepareAiReference = requestedOptions && requestedOptions.aiReference === true;
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
    const maximumSourceBytes = prepareAiReference ? MAX_AI_REFERENCE_VIDEO_SOURCE_BYTES : MAX_BUTLER_VIDEO_BYTES;
    if (sourceStat.size <= 0 || sourceStat.size > maximumSourceBytes) {
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
  let mimeType = BUTLER_VIDEO_MIME_BY_EXTENSION[extension];
  if (!mimeType) {
    const error = new Error('Butler video enhancement requires MP4, MOV, WebM, or Matroska video.');
    error.code = 'unsupported-video-type';
    throw error;
  }
  if (prepareAiReference && (mimeType !== 'video/mp4' || archivedStat.size > MAX_BUTLER_VIDEO_BYTES)) {
    archivedPath = await preview.transcodeVideoForAiReference(archivedPath, previewCacheDir, file.id);
    archivedStat = await fs.promises.lstat(archivedPath);
    mimeType = 'video/mp4';
  }
  if (prepareAiReference && archivedStat.size > MAX_BUTLER_VIDEO_BYTES) {
    const error = new Error('The reference video is still too large after compatibility processing.');
    error.code = 'reference-video-too-large';
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
  const { aiReference: _aiReference, ...videoOptions } = requestedOptions || {};
  const toolOptions = normalizeButlerVideoOptions(metadata, videoOptions);
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

function rendererWindowForEvent(event) {
  const senderWindow = event && event.sender ? BrowserWindow.fromWebContents(event.sender) : null;
  return senderWindow && !senderWindow.isDestroyed() ? senderWindow : mainWindow;
}

function revealRendererWindow(targetWindow) {
  if (!targetWindow || targetWindow.isDestroyed()) return;
  if (targetWindow.isMinimized()) targetWindow.restore();
  if (!targetWindow.isVisible()) targetWindow.show();
  targetWindow.focus();
}

function detachedCanvasWindowBounds(launchPoint = {}) {
  const point = {
    x: Number.isFinite(Number(launchPoint.x)) ? Math.round(Number(launchPoint.x)) : 0,
    y: Number.isFinite(Number(launchPoint.y)) ? Math.round(Number(launchPoint.y)) : 0
  };
  const display = point.x || point.y
    ? screen.getDisplayNearestPoint(point)
    : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const workArea = display.workArea;
  const width = Math.min(1280, Math.max(780, Math.round(workArea.width * 0.72)));
  const height = Math.min(860, Math.max(560, Math.round(workArea.height * 0.76)));
  const centerX = point.x || Math.round(workArea.x + workArea.width / 2);
  const centerY = point.y || Math.round(workArea.y + workArea.height / 2);
  return {
    width,
    height,
    x: Math.max(workArea.x, Math.min(workArea.x + workArea.width - width, Math.round(centerX - width / 2))),
    y: Math.max(workArea.y, Math.min(workArea.y + workArea.height - height, Math.round(centerY - 46)))
  };
}

function createDetachedCanvasWindow(canvasId, launchPoint = {}, sourceWebContents = null) {
  const normalizedCanvasId = String(canvasId || '').trim();
  const canvas = store && store.data.canvases.find((entry) => entry.id === normalizedCanvasId);
  if (!canvas) return { ok: false, reason: 'canvas-not-found' };

  const existing = detachedCanvasWindows.get(normalizedCanvasId);
  if (existing && !existing.isDestroyed()) {
    revealRendererWindow(existing);
    if (sourceWebContents && !sourceWebContents.isDestroyed()) {
      sourceWebContents.send('canvas:detached', { canvasId: normalizedCanvasId, reused: true });
    }
    return { ok: true, reused: true };
  }

  const initialTheme = normalizeTheme(store.data.settings.theme);
  const initialLanguage = currentLanguage();
  const initialTextSize = normalizeTextSize(store.data.settings.textSize);
  const detachedWindow = new BrowserWindow({
    ...detachedCanvasWindowBounds(launchPoint),
    minWidth: 720,
    minHeight: 500,
    show: false,
    icon: app.isPackaged ? process.execPath : path.join(__dirname, 'build-resources', 'icon.png'),
    backgroundColor: WINDOW_BACKGROUND_COLORS[initialTheme],
    frame: false,
    title: `${canvas.name} - Messs.`,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  detachedCanvasWindows.set(normalizedCanvasId, detachedWindow);
  detachedWindow.setMenu(null);
  detachedWindow.loadFile(path.join(__dirname, 'src', 'index.html'), {
    query: {
      theme: initialTheme,
      language: initialLanguage,
      textSize: initialTextSize,
      detachedCanvas: normalizedCanvasId
    }
  });
  detachedWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  detachedWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== detachedWindow.webContents.getURL()) event.preventDefault();
  });
  detachedWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  detachedWindow.webContents.once('did-finish-load', () => setTimeout(() => revealRendererWindow(detachedWindow), 120));
  detachedWindow.on('maximize', () => detachedWindow.webContents.send('window:maximizedChanged', true));
  detachedWindow.on('unmaximize', () => detachedWindow.webContents.send('window:maximizedChanged', false));
  detachedWindow.on('closed', () => {
    if (detachedCanvasWindows.get(normalizedCanvasId) === detachedWindow) {
      detachedCanvasWindows.delete(normalizedCanvasId);
    }
  });
  if (sourceWebContents && !sourceWebContents.isDestroyed()) {
    sourceWebContents.send('canvas:detached', { canvasId: normalizedCanvasId, reused: false });
  }
  return { ok: true, reused: false };
}

function broadcastCanvasItemsChanged(payload, senderWebContents = null) {
  broadcastRendererEvent('canvas:itemsChanged', payload, senderWebContents);
}

function broadcastRendererEvent(channel, payload, senderWebContents = null) {
  for (const targetWindow of BrowserWindow.getAllWindows()) {
    if (targetWindow.isDestroyed() || targetWindow.webContents.isDestroyed()) continue;
    if (senderWebContents && targetWindow.webContents === senderWebContents) continue;
    targetWindow.webContents.send(channel, payload);
  }
}

function stopCanvasDetachDragWatch(webContentsId) {
  const watch = canvasDetachDragWatches.get(webContentsId);
  if (!watch) return;
  clearInterval(watch.interval);
  clearTimeout(watch.timeout);
  canvasDetachDragWatches.delete(webContentsId);
}

function startCanvasDetachDragWatch(event, canvasId) {
  const sourceWindow = rendererWindowForEvent(event);
  if (!sourceWindow || sourceWindow.isDestroyed() || sourceWindow !== mainWindow) return false;
  const normalizedCanvasId = String(canvasId || '').trim();
  if (!store.data.canvases.some((canvas) => canvas.id === normalizedCanvasId)) return false;
  const webContentsId = event.sender.id;
  stopCanvasDetachDragWatch(webContentsId);
  const interval = setInterval(() => {
    if (sourceWindow.isDestroyed()) {
      stopCanvasDetachDragWatch(webContentsId);
      return;
    }
    const cursor = screen.getCursorScreenPoint();
    const bounds = sourceWindow.getBounds();
    const outside = cursor.x < bounds.x - 4
      || cursor.x > bounds.x + bounds.width + 4
      || cursor.y < bounds.y - 4
      || cursor.y > bounds.y + bounds.height + 4;
    if (!outside) return;
    stopCanvasDetachDragWatch(webContentsId);
    createDetachedCanvasWindow(normalizedCanvasId, cursor, sourceWindow.webContents);
  }, 32);
  const timeout = setTimeout(() => stopCanvasDetachDragWatch(webContentsId), 10_000);
  canvasDetachDragWatches.set(webContentsId, { interval, timeout });
  return true;
}

function safeClipboardRead(method, format = '') {
  try {
    if (!clipboard || typeof clipboard[method] !== 'function') return '';
    const value = format ? clipboard[method](format) : clipboard[method]();
    return typeof value === 'string' ? value : '';
  } catch (error) {
    return '';
  }
}

function readClipboardNativeImageBuffer() {
  // Electron's native image bridge is the most reliable path on macOS: some
  // apps publish a valid image UTI but do not expose readable bytes through
  // every UTI variant. Convert it to PNG before trying the raw formats.
  try {
    const image = clipboard.readImage();
    if (image && !image.isEmpty()) {
      const png = image.toPNG();
      if (Buffer.isBuffer(png) && png.length) return png;
    }
  } catch (error) {}

  const formats = new Set();
  try {
    if (typeof clipboard.availableFormats === 'function') {
      clipboard.availableFormats().forEach((format) => formats.add(String(format || '').toLowerCase()));
    }
  } catch (error) {}
  for (const format of [
    'image/png', 'public.png', 'image/jpeg', 'public.jpeg', 'image/webp',
    'public.webp', 'org.webmproject.webp', 'image/tiff', 'public.tiff',
    'image/bmp', 'public.bmp', 'com.microsoft.bmp', 'image/gif',
    'com.compuserve.gif', 'image/heic', 'public.heic', 'public.heif',
    'public.jpeg-2000', 'com.apple.icns'
  ]) {
    if (formats.size && !formats.has(format)) continue;
    try {
      const buffer = clipboard.readBuffer(format);
      if (Buffer.isBuffer(buffer) && buffer.length) return buffer;
    } catch (error) {}
  }
  return null;
}

function readClipboardFileUrlText() {
  const values = [];
  for (const format of ['public.file-url', 'text/uri-list', 'text/uri']) {
    try {
      const buffer = clipboard.readBuffer(format);
      if (Buffer.isBuffer(buffer) && buffer.length) values.push(buffer.toString('utf8'));
    } catch (error) {}
  }
  return values.join('\n');
}

function clipboardSignature() {
  const hash = crypto.createHash('sha256');
  const add = (label, value) => {
    const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value || ''), 'utf8');
    hash.update(`${label}:${buffer.length}:`);
    if (buffer.length <= 128 * 1024) hash.update(buffer);
    else hash.update(Buffer.concat([buffer.subarray(0, 64 * 1024), buffer.subarray(-64 * 1024)]));
    hash.update('\0');
  };
  let formats = [];
  try {
    formats = typeof clipboard.availableFormats === 'function'
      ? [...new Set(clipboard.availableFormats().map((format) => String(format || '').toLowerCase()))].sort()
      : [];
  } catch (error) {}
  add('formats', formats.join('\n'));
  for (const format of formats) {
    try { add(`format:${format}`, clipboard.readBuffer(format)); } catch (error) {}
  }
  add('text', safeClipboardRead('readText'));
  add('html', safeClipboardRead('readHTML'));
  try {
    const image = clipboard.readImage();
    if (image && !image.isEmpty()) add('native-image', image.toPNG());
  } catch (error) {}
  return hash.digest('hex');
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
    const providerId = String(saved.id || `image-${index + 1}`).trim().toLowerCase();
    const endpoint = normalizeProviderEndpoint(
      saved.endpoint || (index === 0 ? fallbackEndpoint || DEFAULT_IMAGE_ENDPOINT : '')
    );
    return {
      // Hidden catalog routes occupy array positions too. Preserve the
      // canonical ID so they cannot shift public products onto another
      // provider's endpoint, pricing, or selected-state cache.
      id: providerId,
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
    const providerId = `video-${index + 1}`;
    const savedCapabilities = saved.capabilities && typeof saved.capabilities === 'object'
      ? saved.capabilities
      : null;
    // The renderer can receive a fresh gateway catalog while the desktop
    // settings still contain an older capability matrix. Keep the logical
    // Seedance slots authoritative locally so newly exposed modes are not
    // rejected before submission.
    const capabilities = canonicalProviderCapabilities('video', providerId, savedCapabilities);
    const endpoint = normalizeProviderEndpoint(
      saved.endpoint || (index === 0 ? fallbackEndpoint || DEFAULT_VIDEO_ENDPOINT : '')
    );
    return {
      id: providerId,
      name: String(saved.name || (index === 0 ? fallbackName || DEFAULT_CATALOG_VIDEO.name : endpoint ? deriveProviderName(endpoint) : '')).trim().slice(0, 40),
      endpoint,
      model: String(saved.model || '').trim().slice(0, 120),
      protocol: String(saved.protocol || '').trim().slice(0, 40),
      capabilities,
      resultEndpoint: normalizeProviderEndpoint(saved.resultEndpoint)
    };
  });
}

async function resolveAiVideoReferences(request) {
  const fileIds = Array.isArray(request && request.referenceFileIds)
    ? request.referenceFileIds.slice(0, 50)
    : [];
  const attachmentTokens = Array.isArray(request && request.attachmentTokens)
    ? request.attachmentTokens.slice(0, 50)
    : [];
  const requestedTypes = Array.isArray(request && request.referenceMediaTypes)
    ? request.referenceMediaTypes.slice(0, fileIds.length).map((value) => String(value || '').toLowerCase())
    : [];
  const urls = [];
  const mediaTypes = [];
  const uploadIds = [];
  const audioUploadIds = [];
  const requestedProviderId = String(request && request.videoProviderId || '').trim().toLowerCase();
  const videoConfig = getAiMediaConfig();
  const requestedProvider = videoConfig.videoProviders.find((entry) => entry.id === requestedProviderId)
    || providerCatalog('video').find((entry) => entry.id === requestedProviderId)
    || null;
  const referenceProfile = seedanceReferenceProfile(
    requestedProviderId,
    requestedProvider && requestedProvider.model
  );
  const referenceDurations = { video: [], audio: [] };
  for (let index = 0; index < fileIds.length; index += 1) {
    const file = store.getFile(String(fileIds[index] || ''));
    if (!file) continue;
    const ext = String(file.ext || path.extname(file.name)).toLowerCase();
    const requestedType = requestedTypes[index];
    const mediaType = requestedType === 'audio' || preview.isAudioExt(ext)
      ? 'audio'
      : requestedType === 'video' || preview.isVideoExt(ext) ? 'video' : 'image';
    if (mediaType === 'audio') {
      assertSafeLocalFile(file);
      const sourcePath = file.storedPath;
      const stat = await fs.promises.lstat(sourcePath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_AI_REFERENCE_AUDIO_SOURCE_BYTES) {
        const error = new Error('The reference audio exceeds the supported upload size.');
        error.code = 'reference-audio-too-large';
        throw error;
      }
      const audioBuffer = await fs.promises.readFile(sourcePath);
      const mime = MIME_BY_EXTENSION[ext];
      if (!/^audio\/(?:wav|mpeg|mp3)$/i.test(String(mime || ''))) {
        const error = new Error('The selected video model only accepts WAV or MP3 reference audio.');
        error.code = 'invalid-reference-audio';
        throw error;
      }
      const audioDuration = Number(await probeMediaDuration(sourcePath)) || Number(file.sourceDuration) || 0;
      validateSeedanceReferenceDuration(referenceProfile, 'audio', audioDuration);
      referenceDurations.audio.push(audioDuration);
      validateSeedanceReferenceTotals(referenceProfile, referenceDurations);
      const upload = await aiGateway.uploadReferenceAudio(audioBuffer, mime);
      audioUploadIds.push(upload.uploadId);
      continue;
    }
    if (mediaType === 'video') {
      const source = await butlerSourceVideo(file.id, { aiReference: true });
      const videoDuration = Number(source.metadata && source.metadata.sourceDuration) || 0;
      validateSeedanceReferenceDuration(referenceProfile, 'video', videoDuration);
      referenceDurations.video.push(videoDuration);
      validateSeedanceReferenceTotals(referenceProfile, referenceDurations);
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
  // Pasted Agent images live in the transient attachment store rather than
  // the persistent file store. They must still become H3/Seedance reference
  // images before the request is sanitized, otherwise the upstream receives
  // a text-only generation request.
  for (const token of attachmentTokens) {
    const record = transientAiAttachments.get(String(token || ''));
    if (!record || record.expiresAt <= Date.now()) continue;
    if (!/^data:image\/(?:png|jpeg|webp);base64,/i.test(String(record.dataUrl || ''))) continue;
    urls.push(record.dataUrl);
    mediaTypes.push('image');
  }
  const requestedMode = String(request && request.videoMode || '').trim().toLowerCase();
  const isMiniMaxH3 = requestedProviderId === 'video-1'
    || String(requestedProvider && requestedProvider.protocol || '').trim().toLowerCase() === 'minimax-video-v2'
    || /^minimax-h3$/i.test(String(requestedProvider && requestedProvider.model || '').trim());
  if (isMiniMaxH3
      && (requestedMode === 'first-last-frame' || (!requestedMode && mediaTypes.length === 2))
      && mediaTypes.length === 2
      && mediaTypes.every((mediaType) => mediaType === 'image')
      && urls.length === 2) {
    const normalizedFrames = await normalizeFirstLastFrameDataUrls(urls);
    urls.splice(0, urls.length, ...normalizedFrames.dataUrls);
  }
  return { urls, mediaTypes, uploadIds, audioUploadIds };
}

const MAX_CANVAS_AGENT_HISTORY_SESSIONS = 100;
const MAX_CANVAS_AGENT_HISTORY_MESSAGES = 100;
const MAX_AI_ASSISTANT_HISTORY_SESSIONS = 60;
const MAX_AI_ASSISTANT_HISTORY_MESSAGES = 100;

function sanitizeCanvasAgentHistory(value) {
  const sessions = Array.isArray(value) ? value : [];
  return sessions.slice(0, MAX_CANVAS_AGENT_HISTORY_SESSIONS).map((session) => {
    const id = String(session && session.id || '').trim().slice(0, 120);
    if (!id) return null;
    const createdAt = String(session.createdAt || new Date().toISOString()).slice(0, 40);
    const updatedAt = String(session.updatedAt || createdAt).slice(0, 40);
    const messages = Array.isArray(session.messages) ? session.messages
      .slice(-MAX_CANVAS_AGENT_HISTORY_MESSAGES)
      .map((message) => {
        const role = message && message.role === 'assistant' ? 'assistant' : 'user';
        const content = String(message && message.content || '').slice(0, 16000);
        const displayContent = String(message && (message.displayContent ?? message.content) || '').slice(0, 12000);
        if (!content && !displayContent) return null;
        return {
          role,
          content,
          displayContent,
          attachmentFileIds: Array.isArray(message && message.attachmentFileIds)
            ? [...new Set(message.attachmentFileIds.map((entry) => String(entry || '').trim()).filter(Boolean))].slice(0, 50)
            : [],
          attachments: Array.isArray(message && message.attachments)
            ? message.attachments.slice(0, 50).map((attachment) => ({
              id: String(attachment && attachment.id || '').slice(0, 120),
              name: String(attachment && attachment.name || '').slice(0, 240),
              mimeType: String(attachment && attachment.mimeType || '').slice(0, 120),
              sizeBytes: Math.max(0, Math.min(64 * 1024 * 1024, Number(attachment && attachment.sizeBytes) || 0)),
              kind: ['image', 'video', 'file'].includes(attachment && attachment.kind) ? attachment.kind : 'file'
            })).filter((attachment) => attachment.id || attachment.name)
            : []
        };
      }).filter(Boolean)
      : [];
    return {
      id,
      title: String(session.title || 'New conversation').trim().slice(0, 120) || 'New conversation',
      canvasId: String(session.canvasId || '').trim().slice(0, 120) || null,
      createdAt,
      updatedAt,
      favorite: session.favorite === true || session.pinned === true,
      messages
    };
  }).filter(Boolean);
}

function sanitizeAiAssistantHistory(value) {
  const sessions = Array.isArray(value) ? value : [];
  return sessions.slice(0, MAX_AI_ASSISTANT_HISTORY_SESSIONS).map((session) => {
    const id = String(session && session.id || '').trim().slice(0, 120);
    if (!id) return null;
    const createdAt = String(session.createdAt || new Date().toISOString()).slice(0, 40);
    const updatedAt = String(session.updatedAt || createdAt).slice(0, 40);
    const messages = Array.isArray(session.messages) ? session.messages
      .slice(-MAX_AI_ASSISTANT_HISTORY_MESSAGES)
      .map((message) => {
        const role = message && message.role === 'assistant' ? 'assistant' : 'user';
        const content = String(message && message.content || '').slice(0, 16000);
        if (!content) return null;
        return {
          role,
          content,
          attachmentFileIds: Array.isArray(message && message.attachmentFileIds)
            ? [...new Set(message.attachmentFileIds.map((entry) => String(entry || '').trim()).filter(Boolean))].slice(0, 50)
            : [],
          attachmentTokens: Array.isArray(message && message.attachmentTokens)
            ? [...new Set(message.attachmentTokens.map((entry) => String(entry || '').trim()).filter(Boolean))].slice(0, 20)
            : [],
          attachments: Array.isArray(message && message.attachments)
            ? message.attachments.slice(0, 50).map((attachment) => ({
              id: String(attachment && attachment.id || '').slice(0, 120),
              name: String(attachment && attachment.name || '').slice(0, 240),
              mimeType: String(attachment && attachment.mimeType || '').slice(0, 120),
              sizeBytes: Math.max(0, Math.min(64 * 1024 * 1024, Number(attachment && attachment.sizeBytes) || 0)),
              kind: ['image', 'video', 'file'].includes(attachment && attachment.kind) ? attachment.kind : 'file'
            })).filter((attachment) => attachment.id || attachment.name)
            : [],
          generatedFiles: Array.isArray(message && message.generatedFiles)
            ? message.generatedFiles.slice(0, 12).map((file) => ({
              token: String(file && file.token || '').slice(0, 240),
              name: String(file && file.name || '').slice(0, 240),
              mimeType: String(file && file.mimeType || '').slice(0, 120),
              sizeBytes: Math.max(0, Math.min(1024 * 1024 * 1024, Number(file && file.sizeBytes) || 0))
            })).filter((file) => file.name || file.token)
            : []
        };
      }).filter(Boolean)
      : [];
    return {
      id,
      title: String(session.title || 'New conversation').trim().slice(0, 120) || 'New conversation',
      createdAt,
      updatedAt,
      favorite: session.favorite === true || session.pinned === true,
      messages
    };
  }).filter(Boolean);
}

function canvasUsageKind(file, operation) {
  if (file && file.aiGeneration) return file.aiGeneration.kind === 'video' ? 'video' : 'image';
  const operationKind = String(operation && operation.kind || '').toLowerCase();
  if (operationKind.includes('3d')) return '3d';
  if (operationKind.includes('video')) return 'video';
  return 'image';
}

function estimatedHistoricalCanvasCredits(file, operation, kind) {
  try {
    if (file && file.aiGeneration) {
      const quote = quoteMediaCredits({
        kind,
        providerId: operation.providerId,
        size: operation.size,
        quality: operation.quality,
        resolution: operation.resolution,
        duration: operation.requestedDuration ?? operation.duration,
        serviceTier: operation.serviceTier,
        count: 1
      });
      return kind === 'image' ? quote.unitCredits : quote.totalCredits;
    }
    const operationKind = String(operation && operation.kind || '').trim().toLowerCase();
    const modelId = String(operation && operation.modelId || (
      operationKind === 'remove-background' ? 'background-remove' : ''
    )).trim().toLowerCase();
    if (kind === '3d' && Object.hasOwn(BUTLER_THREE_D_CREDITS, modelId)) {
      return butlerThreeDRetailCredits(modelId, operation.pricingOptions);
    }
    if (Object.hasOwn(BUTLER_IMAGE_TOOL_CREDITS, modelId)) return BUTLER_IMAGE_TOOL_CREDITS[modelId];
  } catch (error) {}
  return null;
}

function canvasUsageEntryFromFile(file) {
  if (!file || (!file.aiGeneration && !file.butlerOperation)) return null;
  const operation = file.aiGeneration || file.butlerOperation;
  const kind = canvasUsageKind(file, operation);
  const rawChargedCredits = operation && (operation.creditsCharged ?? operation.credits);
  const parsedChargedCredits = Number(rawChargedCredits);
  const recorded = rawChargedCredits !== null && rawChargedCredits !== undefined && rawChargedCredits !== ''
    && Number.isFinite(parsedChargedCredits) && parsedChargedCredits >= 0;
  const rawEstimatedCredits = operation && operation.estimatedCredits;
  const parsedEstimatedCredits = Number(rawEstimatedCredits);
  const hasSavedEstimate = rawEstimatedCredits !== null && rawEstimatedCredits !== undefined
    && rawEstimatedCredits !== '' && Number.isFinite(parsedEstimatedCredits) && parsedEstimatedCredits >= 0;
  // Reprice saved model parameters with the current catalog. The settled
  // charge remains immutable accounting history, but it is not the current
  // price shown in usage totals after a pricing-table update.
  const currentCredits = estimatedHistoricalCanvasCredits(file, operation, kind);
  const hasCurrentQuote = Number.isFinite(Number(currentCredits));
  const savedPricingVersion = String(operation.pricingVersion || '').trim().slice(0, 32);
  const accountingRequestId = String(operation.accountingRequestId || '').trim();
  return {
    id: `file:${String(file.id || '').slice(0, 120)}`,
    canvasId: String(file.canvasId || '').slice(0, 120),
    requestId: accountingRequestId || null,
    sourceFileId: String(file.id || '').slice(0, 120) || null,
    name: String(file.name || '').slice(0, 240),
    kind,
    providerId: String(operation.providerId || operation.modelId || '').slice(0, 100) || null,
    modelName: String(operation.modelName || operation.modelId || 'AI tool').slice(0, 160),
    resolution: String(operation.resolution || operation.size || '').slice(0, 40) || null,
    size: String(operation.size || '').slice(0, 40) || null,
    quality: String(operation.quality || '').slice(0, 20) || null,
    duration: Number.isFinite(Number(operation.requestedDuration ?? operation.duration))
      ? Number(operation.requestedDuration ?? operation.duration)
      : null,
    serviceTier: String(operation.serviceTier || '').slice(0, 20) || null,
    pricingOptions: kind === '3d'
      ? butlerThreeDPricingOptions(String(operation.modelId || ''), operation.pricingOptions)
      : null,
    estimatedCredits: hasCurrentQuote ? Math.max(0, Number(currentCredits))
      : hasSavedEstimate ? Math.max(0, parsedEstimatedCredits)
        : recorded ? Math.max(0, parsedChargedCredits) : null,
    historicalCreditsCharged: recorded ? Math.max(0, parsedChargedCredits) : null,
    creditsCharged: recorded ? Math.max(0, parsedChargedCredits) : null,
    credits: recorded ? Math.max(0, parsedChargedCredits) : null,
    pricingVersion: hasCurrentQuote ? CREDIT_PRICING_VERSION : savedPricingVersion || null,
    estimated: hasCurrentQuote && (
      savedPricingVersion !== CREDIT_PRICING_VERSION
      || !hasSavedEstimate
      || Math.max(0, parsedEstimatedCredits) !== Math.max(0, Number(currentCredits))
    ),
    status: recorded ? 'succeeded' : 'pending',
    createdAt: String(operation.createdAt || file.importedAt || new Date().toISOString()).slice(0, 40)
  };
}

function normalizeCanvasUsageEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const id = String(entry.id || '').trim().slice(0, 160);
  const canvasId = String(entry.canvasId || '').trim().slice(0, 120);
  if (!id || !canvasId) return null;
  const rawChargedCredits = entry.creditsCharged ?? entry.chargedCredits ?? entry.credits;
  const creditsCharged = rawChargedCredits !== null && rawChargedCredits !== undefined
    && rawChargedCredits !== '' && Number.isFinite(Number(rawChargedCredits))
    && Number(rawChargedCredits) >= 0
    ? Math.max(0, Number(rawChargedCredits))
    : null;
  const rawEstimatedCredits = entry.estimatedCredits ?? entry.creditsReserved;
  const estimatedCredits = rawEstimatedCredits !== null && rawEstimatedCredits !== undefined
    && rawEstimatedCredits !== '' && Number.isFinite(Number(rawEstimatedCredits))
    && Number(rawEstimatedCredits) >= 0
    ? Math.max(0, Number(rawEstimatedCredits))
    : null;
  return {
    id,
    canvasId,
    requestId: String(entry.requestId || '').trim().slice(0, 80) || null,
    sourceFileId: String(entry.sourceFileId || '').trim().slice(0, 120) || null,
    name: String(entry.name || '').slice(0, 240),
    kind: ['image', 'video', '3d'].includes(entry.kind) ? entry.kind : 'image',
    providerId: String(entry.providerId || '').trim().slice(0, 100) || null,
    modelName: String(entry.modelName || entry.providerId || 'AI tool').slice(0, 160),
    resolution: String(entry.resolution || '').slice(0, 40) || null,
    size: String(entry.size || '').slice(0, 40) || null,
    quality: String(entry.quality || '').slice(0, 20) || null,
    duration: Number.isFinite(Number(entry.duration)) ? Number(entry.duration) : null,
    serviceTier: String(entry.serviceTier || '').slice(0, 20) || null,
    pricingOptions: entry.kind === '3d'
      ? butlerThreeDPricingOptions(String(entry.providerId || ''), entry.pricingOptions)
      : null,
    estimatedCredits,
    historicalCreditsCharged: Number.isFinite(Number(entry.historicalCreditsCharged))
      && Number(entry.historicalCreditsCharged) >= 0
      ? Math.max(0, Number(entry.historicalCreditsCharged))
      : creditsCharged,
    creditsCharged,
    credits: creditsCharged,
    pricingVersion: String(entry.pricingVersion || '').trim().slice(0, 32) || null,
    estimated: entry.estimated === true,
    status: ['pending', 'succeeded', 'failed'].includes(entry.status) ? entry.status
      : creditsCharged === null ? 'pending' : 'succeeded',
    createdAt: String(entry.createdAt || new Date().toISOString()).slice(0, 40)
  };
}

function backfillCanvasUsageEstimate(entry) {
  if (!entry) return entry;
  if (entry.kind === '3d' && Object.hasOwn(BUTLER_THREE_D_CREDITS, entry.providerId)) {
    const currentCredits = butlerThreeDRetailCredits(entry.providerId, entry.pricingOptions);
    return {
      ...entry,
      estimatedCredits: currentCredits,
      pricingVersion: CREDIT_PRICING_VERSION,
      estimated: entry.pricingVersion !== CREDIT_PRICING_VERSION
        || Number(entry.estimatedCredits) !== currentCredits
    };
  }
  if (!['image', 'video'].includes(entry.kind) || !entry.providerId) return entry;
  if (Object.hasOwn(BUTLER_IMAGE_TOOL_CREDITS, entry.providerId)) {
    const currentCredits = BUTLER_IMAGE_TOOL_CREDITS[entry.providerId];
    return {
      ...entry,
      estimatedCredits: currentCredits,
      pricingVersion: CREDIT_PRICING_VERSION,
      estimated: entry.pricingVersion !== CREDIT_PRICING_VERSION
        || Number(entry.estimatedCredits) !== currentCredits
    };
  }
  try {
    const quote = quoteMediaCredits({
      kind: entry.kind,
      providerId: entry.providerId,
      size: entry.size || entry.resolution,
      resolution: entry.resolution || entry.size,
      quality: entry.quality,
      duration: entry.duration,
      serviceTier: entry.serviceTier,
      count: 1
    });
    const credits = entry.kind === 'image' ? quote.unitCredits : quote.totalCredits;
    if (!Number.isFinite(Number(credits))) return entry;
    return {
      ...entry,
      estimatedCredits: Math.max(0, Number(credits)),
      pricingVersion: CREDIT_PRICING_VERSION,
      estimated: entry.pricingVersion !== CREDIT_PRICING_VERSION
        || Number(entry.estimatedCredits) !== Math.max(0, Number(credits))
    };
  } catch (error) {
    return entry;
  }
}

// Usage reports keep the immutable settled debit as the billed value. The
// active pricing policy is used only for the separate protected estimate, so
// a quote update can never make the UI claim that more points were charged.
function preserveSettledCanvasUsage(entry) {
  if (!entry || entry.status !== 'succeeded') return entry;
  const historical = Number(entry.historicalCreditsCharged ?? entry.creditsCharged ?? entry.credits);
  if (!Number.isFinite(historical) || historical < 0) return entry;
  return {
    ...entry,
    historicalCreditsCharged: Math.max(0, historical),
    creditsCharged: Math.max(0, historical),
    credits: Math.max(0, historical)
  };
}

function ensureCanvasUsageLedger() {
  const entries = Array.isArray(store.data.canvasUsageLedger) ? store.data.canvasUsageLedger : [];
  const normalized = entries.map(normalizeCanvasUsageEntry).filter(Boolean).map(backfillCanvasUsageEstimate);
  const ids = new Set(normalized.map((entry) => entry.id));
  for (const file of store.data.files) {
    const entry = canvasUsageEntryFromFile(file);
    if (!entry) continue;
    const index = normalized.findIndex((candidate) => candidate.id === entry.id);
    if (index === -1) {
      normalized.push(entry);
      ids.add(entry.id);
    } else {
      // File metadata is newer than a previously persisted ledger snapshot.
      normalized[index] = entry;
    }
  }
  store.data.canvasUsageLedger = normalized;
}

function recordCanvasUsageFile(file) {
  const entry = canvasUsageEntryFromFile(file);
  if (!entry) return;
  if (!Array.isArray(store.data.canvasUsageLedger)) store.data.canvasUsageLedger = [];
  const index = store.data.canvasUsageLedger.findIndex((item) => item && item.id === entry.id);
  if (index === -1) store.data.canvasUsageLedger.push(entry);
  else store.data.canvasUsageLedger[index] = entry;
}

async function canvasCreditUsage(canvasId) {
  const id = String(canvasId || '').trim();
  const canvas = store.data.canvases.find((entry) => entry.id === id);
  if (!canvas) return { ok: false, reason: 'canvas-not-found' };
  ensureCanvasUsageLedger();
  const localDetails = store.data.canvasUsageLedger
    .filter((entry) => entry && entry.canvasId === id)
    .map((entry) => ({ ...entry }));
  let cloudDetails = [];
  let cloudAvailable = false;
  if (runtimeConfig.gatewayConfigured && hasAuthenticatedGatewaySession()
      && aiGateway && typeof aiGateway.getCanvasUsage === 'function') {
    try {
      const cloud = await aiGateway.getCanvasUsage(id);
      cloudDetails = Array.isArray(cloud && cloud.details) ? cloud.details : [];
      cloudAvailable = Boolean(cloud);
    } catch (error) {
      // Local history remains useful while the gateway or new schema deploys.
    }
  }
  const detailsByKey = new Map();
  localDetails.forEach((entry) => {
    const key = entry.requestId ? `request:${entry.requestId}` : `local:${entry.id}`;
    detailsByKey.set(key, entry);
  });
  cloudDetails.forEach((entry) => {
    const requestId = String(entry && entry.requestId || '').trim().slice(0, 80);
    if (!requestId) return;
    const key = `request:${requestId}`;
    const local = detailsByKey.get(key) || {};
    const estimatedCredits = Number(entry.estimatedCredits ?? entry.creditsReserved);
    const historicalCreditsCharged = Number(
      entry.historicalCreditsCharged ?? entry.creditsCharged ?? entry.credits
    );
    const hasCloudEstimate = Number.isFinite(estimatedCredits) && estimatedCredits >= 0;
    const hasCloudCharge = Number.isFinite(historicalCreditsCharged) && historicalCreditsCharged >= 0;
    const cloudResolution = String(entry.resolution || '').trim().slice(0, 40);
    const [cloudQuality, cloudImageResolution] = cloudResolution.includes(':')
      ? cloudResolution.toLowerCase().split(':', 2)
      : [null, cloudResolution];
    detailsByKey.set(key, {
      ...local,
      id: local.id || `cloud:${requestId}`,
      canvasId: id,
      requestId,
      name: local.name || String(entry.name || '').slice(0, 240),
      kind: ['image', 'video', '3d'].includes(entry.kind) ? entry.kind : (local.kind || 'image'),
      providerId: String(entry.providerId || local.providerId || '').slice(0, 100) || null,
      modelName: local.modelName || String(entry.modelName || entry.providerId || 'AI model').slice(0, 160),
      resolution: local.resolution || cloudImageResolution || null,
      size: local.size || cloudImageResolution || null,
      quality: local.quality || cloudQuality || null,
      duration: Number.isFinite(Number(entry.duration)) ? Number(entry.duration) : local.duration ?? null,
      estimatedCredits: hasCloudEstimate ? Math.max(0, estimatedCredits)
        : local.estimatedCredits ?? null,
      historicalCreditsCharged: hasCloudCharge ? Math.max(0, historicalCreditsCharged)
        : local.historicalCreditsCharged ?? local.creditsCharged ?? null,
      creditsCharged: hasCloudCharge ? Math.max(0, historicalCreditsCharged)
        : local.creditsCharged ?? null,
      credits: hasCloudCharge ? Math.max(0, historicalCreditsCharged) : local.creditsCharged ?? null,
      pricingVersion: local.pricingVersion || null,
      estimated: local.estimated === true && !hasCloudEstimate,
      status: ['pending', 'succeeded', 'failed'].includes(entry.status)
        ? entry.status : hasCloudCharge ? 'succeeded' : (local.status || 'pending'),
      createdAt: String(entry.createdAt || local.createdAt || '').slice(0, 40)
    });
  });
  const details = [...detailsByKey.values()]
    .map(backfillCanvasUsageEstimate)
    .map(preserveSettledCanvasUsage)
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
  const publicDetails = details.map(({ historicalCreditsCharged, creditsCharged, credits, ...entry }) => entry);
  const recorded = details.filter((entry) => entry.historicalCreditsCharged !== null);
  const currentlyPriced = details.filter((entry) => entry.credits !== null || entry.estimatedCredits !== null);
  const breakdown = ['image', 'video', '3d'].reduce((result, kind) => {
    const entries = details.filter((entry) => entry.kind === kind);
    const known = entries.filter((entry) => entry.historicalCreditsCharged !== null);
    const priced = entries.filter((entry) => entry.credits !== null || entry.estimatedCredits !== null);
    result[kind] = {
      estimatedCredits: entries.reduce((sum, entry) => sum + (Number(entry.estimatedCredits) || 0), 0),
      historicalCreditsCharged: known.reduce((sum, entry) => sum + entry.historicalCreditsCharged, 0),
      creditsCharged: entries.reduce((sum, entry) => sum + (Number(entry.creditsCharged) || 0), 0),
      credits: entries.reduce((sum, entry) => sum + (
        entry.status === 'succeeded' ? (Number(entry.credits) || 0) : (Number(entry.estimatedCredits) || 0)
      ), 0),
      generations: entries.length,
      recorded: known.length,
      unrecorded: entries.length - priced.length
    };
    return result;
  }, {});
  const publicBreakdown = Object.fromEntries(Object.entries(breakdown).map(([kind, entry]) => [kind, {
    estimatedCredits: entry.estimatedCredits,
    generations: entry.generations,
    unrecorded: entry.unrecorded
  }]));
  return {
    ok: true,
    canvas: { id: canvas.id, name: canvas.name },
    totals: {
      estimatedCredits: details.reduce((sum, entry) => sum + (Number(entry.estimatedCredits) || 0), 0),
      generations: details.length,
      recorded: recorded.length,
      unrecorded: details.length - currentlyPriced.length,
      estimated: details.filter((entry) => entry.estimated === true).length
    },
    breakdown: publicBreakdown,
    details: publicDetails,
    cloudAvailable
  };
}

function normalizedVideoModes(capabilities = {}) {
  const configured = Array.isArray(capabilities.videoModes)
    ? capabilities.videoModes.filter((entry) => entry && typeof entry === 'object' && entry.id)
    : [];
  if (configured.length) return configured;
  const configuredMinimum = Math.max(0, Number(capabilities.minReferenceImages) || 0);
  const configuredMaximum = Number(capabilities.maxReferenceImages);
  const maximumReferences = Number.isInteger(configuredMaximum) && configuredMaximum >= 0
    ? Math.min(30, configuredMaximum)
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
  const savedById = new Map(source
    .filter((provider) => provider && /^chat-\d+$/i.test(String(provider.id || '').trim()))
    .map((provider) => [String(provider.id).trim().toLowerCase(), provider]));
  const hasStableIds = savedById.size > 0;
  const legacyEndpoint = normalizeProviderEndpoint(legacy.endpoint);
  const legacyProvider = {
    id: DEFAULT_CHAT_PROVIDER_ID,
    name: String(legacy.name || (legacyEndpoint ? deriveProviderName(legacyEndpoint) : DEFAULT_CATALOG_CHAT.name)).trim().slice(0, 40) || DEFAULT_CATALOG_CHAT.name,
    endpoint: legacyEndpoint,
    models: normalizeChatModels(legacy.model, DEFAULT_CATALOG_CHAT.models[0])
  };
  const effectiveSource = !hasConfiguredSource && legacyEndpoint ? [legacyProvider] : source;
  return Array.from({ length: Math.max(10, effectiveSource.length) }, (_, index) => {
    const id = `chat-${index + 1}`;
    // Hidden catalog routes can occupy earlier positions in older data.json
    // files. Stable chat IDs must win so those routes cannot shift user slots.
    const saved = hasStableIds
      ? (savedById.get(id) || {})
      : (effectiveSource[index] || {});
    const endpoint = normalizeProviderEndpoint(saved.endpoint);
    return {
      id,
      name: String(saved.name || (endpoint ? deriveProviderName(endpoint) : '')).trim().slice(0, 40),
      endpoint,
      models: normalizeChatModels(saved.models || saved.model, index === 0 ? DEFAULT_CATALOG_CHAT.models[0] : ''),
      upstreamModels: saved.upstreamModels && typeof saved.upstreamModels === 'object' && !Array.isArray(saved.upstreamModels)
        ? saved.upstreamModels
        : {},
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
    : (configuredChatProviders[0] ? configuredChatProviders[0].id : DEFAULT_CHAT_PROVIDER_ID);
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
  const readAccountNumber = (keys, required = false) => {
    for (const key of keys) {
      if (!Object.hasOwn(account, key) || account[key] === null || account[key] === undefined || account[key] === '') continue;
      const value = Number(account[key]);
      if (Number.isFinite(value) && value >= 0) return value;
    }
    if (required) {
      const error = new Error('The gateway returned an invalid credit balance.');
      error.code = 'credit-service-failed';
      throw error;
    }
    return undefined;
  };
  // A missing balance is a service failure, never a legitimate zero balance.
  // Validate before replacing the cache so a degraded gateway cannot erase a
  // previously trusted balance in the desktop UI.
  const balance = readAccountNumber(['balance', 'credits', 'points', 'creditBalance'], true);
  const reserved = Math.max(0, Math.min(balance, readAccountNumber(['reserved', 'reservedCredits']) ?? 0));
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
  const publicProvider = (provider) => ({
    ...provider,
    name: sanitizePublicModelLabel(provider && provider.name, '')
  });
  const { apiKey, ...publicConfig } = {
    ...config,
    imageProviders: config.imageProviders.map(publicProvider),
    videoProviders: config.videoProviders.map(publicProvider),
    chatProviders: config.chatProviders.map(publicProvider),
    videoProviderName: sanitizePublicModelLabel(config.videoProviderName, 'AI video'),
    chatProviderName: sanitizePublicModelLabel(config.chatProviderName, 'Messs AI')
  };
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
        name: sanitizePublicModelLabel(provider.name, provider.id),
        endpoint: gatewayEndpoint,
        models: provider.models,
        capabilities: provider.capabilities,
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
  return value;
}

async function requireGatewayProvider(kind, providerId) {
  const catalog = await getVerifiedGatewayCatalog();
  return assertGatewayProvider(catalog, kind, providerId);
}

async function requireGatewayChatProvider(providerId, model) {
  const catalog = await getVerifiedGatewayCatalog();
  const requestedModel = String(model || '').trim().toLowerCase();
  const providers = Array.isArray(catalog && catalog.providers)
    ? catalog.providers.filter((entry) => entry && entry.kind === 'chat')
    : [];
  const exact = providers.find((entry) => entry.id === String(providerId || '').trim());
  const matching = requestedModel
    ? providers.find((entry) => Array.isArray(entry.models)
      && entry.models.some((candidate) => String(candidate).trim().toLowerCase() === requestedModel))
    : null;
  const exactMatchesModel = exact && (!requestedModel || (Array.isArray(exact.models)
    && exact.models.some((candidate) => String(candidate).trim().toLowerCase() === requestedModel)));
  return assertGatewayProvider(catalog, 'chat', exactMatchesModel ? exact.id : matching && matching.id);
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
        serviceTier: options.serviceTier,
        referenceMediaTypes: options.referenceMediaTypes,
        referenceVideoUploadIds: options.referenceVideoUploadIds,
        referenceAudioUrls: options.referenceAudioUrls,
        referenceAudioUploadIds: options.referenceAudioUploadIds,
        outputFormat: options.outputFormat,
        generateAudio: options.generateAudio,
        returnLastFrame: options.returnLastFrame,
        bitrateMode: options.bitrateMode,
        watermark: options.watermark,
        enhancePrompt: options.enhancePrompt,
        seed: options.seed,
        styleId: options.styleId,
        styleStrength: options.styleStrength,
        urls: options.urls,
        canvasId: options.canvasId
      }, controller.signal, options.accountingRequestId);
    }
    const config = getAiMediaConfig();
    if (kind !== 'video' && options.imageProviderId) {
      const selected = config.imageProviders.find((provider) =>
        provider.id === options.imageProviderId && provider.name && provider.endpoint
      );
      if (selected) {
        config.imageEndpoint = selected.endpoint;
        config.imageModel = selected.model || '';
        config.apiKey = getSavedAiApiKey(selected.id) || getSavedAiApiKey('default') || getEnvironmentAiApiKey();
      }
    }
    if (kind === 'video' && options.videoProviderId) {
      const selected = config.videoProviders.find((provider) =>
        provider.id === options.videoProviderId && provider.name && provider.endpoint
      );
      if (selected) {
        config.videoEndpoint = selected.endpoint;
        config.apiKey = getSavedAiApiKey(selected.id) || getSavedAiApiKey('default') || getEnvironmentAiApiKey();
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

function aiMediaGenerationOptions(request, providerId) {
  return {
    size: request.size,
    quality: request.quality,
    resolution: request.resolution,
    aspectRatio: request.aspectRatio,
    sourceWidth: request.sourceWidth,
    sourceHeight: request.sourceHeight,
    duration: request.duration,
    videoMode: request.videoMode,
    serviceTier: request.serviceTier,
    referenceMediaTypes: request.referenceMediaTypes,
    referenceVideoUploadIds: request.referenceVideoUploadIds,
    referenceAudioUrls: request.referenceAudioUrls,
    referenceAudioUploadIds: request.referenceAudioUploadIds,
    outputFormat: request.outputFormat,
    generateAudio: request.generateAudio,
    returnLastFrame: request.returnLastFrame,
    bitrateMode: request.bitrateMode,
    watermark: request.watermark,
    enhancePrompt: request.enhancePrompt,
    seed: request.seed,
    styleId: request.styleId,
    styleStrength: request.styleStrength,
    urls: request.urls,
    canvasId: request.canvasId,
    imageProviderId: request.kind === 'video' ? request.imageProviderId : providerId,
    videoProviderId: request.kind === 'video' ? providerId : request.videoProviderId
  };
}

async function resolveImageFallback(request, primaryQuote) {
  if (request.kind !== 'image') return null;
  const primaryProviderId = String(request.imageProviderId || '').trim().toLowerCase();
  const candidateIds = imageFallbackProviderIds(primaryProviderId);
  if (!candidateIds.length) return null;

  let providers = [];
  try {
    if (runtimeConfig && runtimeConfig.gatewayConfigured && hasAuthenticatedGatewaySession()) {
      const catalog = await getVerifiedGatewayCatalog();
      providers = Array.isArray(catalog && catalog.providers)
        ? catalog.providers.filter((provider) => provider && provider.kind === 'image')
        : [];
    }
  } catch (error) {
    // A catalog outage should not make the original model unusable.
  }
  if (!providers.length) {
    const localConfig = getAiMediaConfig();
    providers = Array.isArray(localConfig.imageProviders) ? localConfig.imageProviders : [];
  }
  const byId = new Map(providers.map((provider) => [String(provider && provider.id || '').trim().toLowerCase(), provider]));
  for (const candidateId of candidateIds) {
    const provider = byId.get(candidateId);
    if (!provider || !provider.name || !provider.endpoint || !supportsImageRequest(provider, request)) continue;
    if (!(runtimeConfig && runtimeConfig.gatewayConfigured)) {
      const key = getSavedAiApiKey(candidateId) || getSavedAiApiKey('default') || getEnvironmentAiApiKey();
      if (!key) continue;
    }
    let quote;
    try {
      quote = await quoteMediaCreditsForAccount({
        kind: 'image',
        imageProviderId: candidateId,
        count: request.count,
        quality: request.quality,
        size: request.size,
        resolution: request.resolution
      });
    } catch (error) {
      continue;
    }
    // Never upgrade to a model that is cheaper than the selected model.  This
    // also protects against stale pricing data in a custom provider config.
    if (!quote || Number(quote.totalCredits) <= Number(primaryQuote && primaryQuote.totalCredits || 0)) continue;
    return { provider, quote };
  }
  return null;
}

async function generateAiMediaWithFallback(kind, prompt, options, fallbackProvider) {
  const primaryProviderId = kind === 'video' ? options.videoProviderId : options.imageProviderId;
  const primaryRequestId = String(options.accountingRequestId || '').trim() || crypto.randomUUID();
  try {
    return {
      buffer: await generateAiMediaBuffer(kind, prompt, { ...options, accountingRequestId: primaryRequestId }),
      providerId: primaryProviderId,
      accountingRequestId: primaryRequestId,
      fallbackUsed: false
    };
  } catch (primaryError) {
    // The secure gateway owns the complete fallback chain under one operation
    // ID and one credit reservation. A second desktop request would be a new
    // paid operation and could duplicate an already accepted generation.
    if (runtimeConfig && runtimeConfig.gatewayConfigured) throw primaryError;
    if (kind !== 'image' || !fallbackProvider || !isRetryableMediaError(primaryError)) throw primaryError;
    const fallbackProviderId = String(fallbackProvider.provider && fallbackProvider.provider.id || '').trim().toLowerCase();
    if (!fallbackProviderId || fallbackProviderId === String(primaryProviderId || '').trim().toLowerCase()) throw primaryError;
    try {
      const fallbackRequestId = crypto.randomUUID();
      return {
        buffer: await generateAiMediaBuffer(kind, prompt, {
          ...options,
          imageProviderId: fallbackProviderId,
          accountingRequestId: fallbackRequestId
        }),
        providerId: fallbackProviderId,
        accountingRequestId: fallbackRequestId,
        fallbackUsed: true,
        fallbackFromProviderId: primaryProviderId,
        fallbackProviderName: String(fallbackProvider.provider.name || fallbackProviderId).trim()
      };
    } catch (fallbackError) {
      // Keep the second error for the user, but retain the first error for
      // diagnostics so a fallback failure can be traced to the original outage.
      fallbackError.primaryError = primaryError;
      throw fallbackError;
    }
  }
}

async function generateAiChatReply(prompt, messages, providerId, model) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10 * 60 * 1000);
  try {
    if (assertAiTransportReady() === 'gateway') {
      const provider = await requireGatewayChatProvider(providerId, model);
      const resolvedModel = String(model || '').trim() || (provider.models && provider.models[0]);
      return await aiGateway.chat({
        prompt,
        messages,
        providerId: provider.id,
        model: resolvedModel
      }, controller.signal);
    }
    const config = getAiMediaConfig();
    const requestedModel = String(model || '').trim().toLowerCase();
    const selected = config.chatProviders.find((provider) =>
      provider.id === providerId && provider.name && provider.endpoint
      && (!requestedModel || provider.models.some((entry) => String(entry).toLowerCase() === requestedModel))
    ) || config.chatProviders.find((provider) =>
      provider.name && provider.endpoint
      && requestedModel && provider.models.some((entry) => String(entry).toLowerCase() === requestedModel)
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

function sanitizeAiErrorText(value) {
  return sanitizePublicAiError(value, 'The AI service could not complete this request.');
}

function conciseAiErrorMessage(error, context = {}) {
  const raw = sanitizeAiErrorText(error && error.message);
  const code = String(error && error.code || '').trim().toLowerCase();
  if (context.gatewayConfigured && (Number(error && error.status) === 404 || code === 'not-found')) {
    return localizedMessage(
      'The secure AI gateway does not have this route available yet. Refresh the model list and retry shortly.',
      '安全 AI 网关暂时没有这个模型或功能，请刷新模型列表后稍后重试。无需填写上游接口地址。',
      'The secure AI gateway does not have this route available yet. Refresh the model list and retry shortly.'
    );
  }
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
  if (code === 'provider-not-configured') {
    return localizedMessage(
      'This AI model is not enabled on the current gateway yet. Refresh the model list or choose another model.',
      '当前网关还没有启用这个 AI 模型，请刷新模型列表或选择其他模型。',
      'This AI model is not enabled on the current gateway yet. Refresh the model list or choose another model.'
    );
  }
  if (code === 'gateway-catalog-outdated') {
    return localizedMessage(
      'The AI gateway is synchronizing its model list. Please retry in a moment.',
      'AI 网关正在同步模型列表，请稍后重试。',
      'The AI gateway is synchronizing its model list. Please retry in a moment.'
    );
  }
  if (['provider-temporarily-unavailable', 'provider-channel-unavailable', 'provider-rate-limited', 'ai302-rate-limited', 'ai302-route-unavailable'].includes(code)) {
    return localizedMessage(
      'The AI service is temporarily busy. No points were charged; please retry shortly.',
      '当前 AI 服务暂时繁忙，本次未扣积分，请稍后重试。',
      'The AI service is temporarily busy. No points were charged; please retry shortly.'
    );
  }
  if (code === 'reference-policy-rejected') {
    return localizedMessage(
      'The reference image may contain copyrighted or restricted content. Choose another reference image. No points were charged.',
      '参考图片可能涉及版权或受限内容，请更换参考图后重试。本次未扣积分。',
      '참조 이미지에 저작권 또는 제한된 콘텐츠가 포함되었을 수 있습니다. 다른 이미지를 선택해 다시 시도하세요. 포인트는 차감되지 않았습니다.'
    );
  }
  if (['ai302-unauthorized', 'ai302-balance-exhausted'].includes(code)) {
    return localizedMessage(
      'The generation service is temporarily unavailable. No points were charged; please try again later.',
      '当前生成服务暂时不可用，本次未扣积分，请稍后重试。',
      'The generation service is temporarily unavailable. No points were charged; please try again later.'
    );
  }
  if (['ai302-upstream-error', 'image-tool-failed', 'three-d-generation-failed', 'video-upscale-failed'].includes(code)) {
    return localizedMessage(
      'The generation request was not accepted. No points were charged; please check the settings and try again.',
      '本次生成请求未被接受，未扣积分。请检查设置后重试。',
      'The generation request was not accepted. No points were charged; please check the settings and try again.'
    );
  }
  if (['provider-timeout', 'gateway-timeout', 'timeout', 'video-generation-timeout'].includes(code)) {
    return localizedMessage(
      'Generation took too long to respond. Points are temporarily held while the task is verified; please retry shortly.',
      '本次生成响应超时，积分暂时保留，系统正在核对任务，请稍后重试。',
      '생성 응답 시간이 초과되었습니다. 작업을 확인하는 동안 포인트가 임시 보류됩니다. 잠시 후 다시 시도하세요.'
    );
  }
  if (code === 'provider-request-failed') {
    return localizedMessage(
      'The generation request was not accepted. No points were charged; check the reference files and settings, then try again.',
      '本次生成请求未被接受，未扣积分。请检查参考素材和参数后重试。',
      '생성 요청이 승인되지 않았습니다. 포인트는 차감되지 않았습니다. 참조 파일과 설정을 확인한 뒤 다시 시도하세요.'
    );
  }
  if (['provider-invalid-response', 'provider-result-missing', 'video-generation-failed', 'video-provider-result-invalid'].includes(code)) {
    return localizedMessage(
      'The AI service returned no usable result. Points are temporarily held while delivery is verified; please retry shortly.',
      'AI 服务没有返回可用结果，积分暂时保留，系统正在核对结果，请稍后重试。',
      'AI 서비스가 사용 가능한 결과를 반환하지 않았습니다. 전달을 확인하는 동안 포인트가 임시 보류됩니다. 잠시 후 다시 시도하세요.'
    );
  }
  if (['provider-download-failed', 'media-download-failed', 'video-download-failed'].includes(code)) {
    return localizedMessage(
      'The result was generated but could not be downloaded safely. Points are temporarily held while delivery is recovered; please retry shortly.',
      '结果可能已经生成，但未能安全下载到软件，积分暂时保留，系统正在恢复结果，请稍后重试。',
      '결과가 생성되었지만 안전하게 다운로드하지 못했습니다. 전달을 복구하는 동안 포인트가 임시 보류됩니다. 잠시 후 다시 시도하세요.'
    );
  }
  if (['provider-task-recovery-pending', 'image-job-record-failed'].includes(code)) {
    return localizedMessage(
      'The generated result is being recovered safely. Points are temporarily held until delivery is confirmed; please retry shortly.',
      '生成结果正在安全恢复中，积分暂时保留，确认结果后才会结算，请稍后重试。',
      '생성 결과를 안전하게 복구하고 있습니다. 전달이 확인될 때까지 포인트가 임시 보류됩니다. 잠시 후 다시 시도하세요.'
    );
  }
  if (code === 'image-job-schema-missing') {
    return localizedMessage(
      'Image recovery is being prepared on the service. Please retry shortly.',
      '图片恢复服务正在准备中，请稍后重试。',
      '이미지 복구 서비스를 준비 중입니다. 잠시 후 다시 시도하세요.'
    );
  }
  if (['invalid-media', 'local-delivery-failed', 'invalid-ai-delivery-confirmation'].includes(code)) {
    return localizedMessage(
      'The generated file could not be verified or added to the canvas. Points are temporarily held while the result is checked.',
      '生成文件无法验证或未能加入画布，积分暂时保留，系统正在核对结果。',
      '생성 파일을 확인하거나 캔버스에 추가하지 못했습니다. 결과를 확인하는 동안 포인트가 임시 보류됩니다.'
    );
  }
  if (['credit-settlement-failed', 'video-job-finalization-failed'].includes(code)) {
    return localizedMessage(
      'The points service is confirming this result. Please keep the app open and retry shortly.',
      '积分服务正在核对本次结果，请保持软件打开并稍后重试。',
      '포인트 서비스가 결과를 확인 중입니다. 앱을 열어 둔 채 잠시 후 다시 시도하세요.'
    );
  }
  if (code === 'gateway-request-failed') {
    return localizedMessage(
      'The AI service could not be reached. Check your network and retry.',
      'AI 服务暂时无法连接，请检查网络后重试。',
      'The AI service could not be reached. Check your network and retry.'
    );
  }
  if (['credit-service-failed', 'credit-schema-missing', 'credit-service-not-configured'].includes(code)) {
    return localizedMessage(
      'The points service is temporarily unavailable. No generation was started; please retry shortly.',
      '积分服务暂时不可用，本次没有开始生成，请稍后重试。',
      'The points service is temporarily unavailable. No generation was started; please retry shortly.'
    );
  }
  if (error && error.code === 'image-resolution-mismatch') {
    const requested = String(error.requestedResolution || '').trim().toUpperCase();
    const width = Math.round(Number(error.actualWidth) || 0);
    const height = Math.round(Number(error.actualHeight) || 0);
    return localizedMessage(
      `${requested || 'The requested resolution'} was requested, but the AI service returned ${width} x ${height}. The low-resolution result was rejected and your points were refunded. Please retry.`,
      `请求了 ${requested || '高清'}，但 AI 服务实际返回 ${width} x ${height}。低分辨率结果已拒收，本次积分已退还，请重试。`,
      `${requested || '고해상도'} 요청에 대해 AI 서비스가 ${width} x ${height} 이미지를 반환했습니다. 저해상도 결과는 거부되었고 포인트는 환불되었습니다. 다시 시도해 주세요.`
    );
  }
  if (error && error.code === 'image-resolution-unverified') {
    return localizedMessage(
      'The AI service result dimensions could not be verified. The result was rejected and your points were refunded. Please retry.',
      '无法验证 AI 服务返回图片的真实分辨率，结果已拒收，本次积分已退还，请重试。',
      'AI 서비스 결과의 실제 해상도를 확인할 수 없습니다. 결과는 거부되었고 포인트는 환불되었습니다. 다시 시도해 주세요.'
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
  const message = raw || (context.kind === 'chat'
    ? localizedMessage('AI chat failed. Please try again.', 'AI 对话失败，请稍后重试。', 'AI 채팅에 실패했습니다. 다시 시도하세요.')
    : localizedMessage('AI generation failed. Please try again.', 'AI 生成失败，请稍后重试。', 'AI 생성에 실패했습니다. 다시 시도하세요.'));
  return message.slice(0, 360);
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
    'image-expand': 'Expanded',
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

function butlerOutputAccounting(buffer, fallbackCredits) {
  const estimated = Number(buffer && buffer.estimatedCredits);
  const charged = Number(buffer && buffer.creditsCharged);
  const fallback = Number(fallbackCredits);
  const estimatedCredits = Number.isFinite(estimated) && estimated >= 0
    ? estimated
    : Number.isFinite(fallback) && fallback >= 0 ? fallback : null;
  if (buffer && buffer.deliveryPending === true) {
    return estimatedCredits === null ? {} : { estimatedCredits };
  }
  const creditsCharged = Number.isFinite(charged) && charged >= 0
    ? charged
    : estimatedCredits;
  return {
    ...(estimatedCredits === null ? {} : { estimatedCredits }),
    ...(creditsCharged === null ? {} : { creditsCharged, credits: creditsCharged })
  };
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
        ...(operationDetails.modelId && operationDetails.pricingOptions
          ? { pricingOptions: butlerThreeDPricingOptions(operationDetails.modelId, operationDetails.pricingOptions) }
          : {}),
        pricingVersion: CREDIT_PRICING_VERSION,
        ...(Number.isFinite(Number(operationDetails.estimatedCredits ?? operationDetails.credits))
          ? { estimatedCredits: Number(operationDetails.estimatedCredits ?? operationDetails.credits) }
          : {}),
        ...(Number.isFinite(Number(operationDetails.creditsCharged ?? operationDetails.credits))
          ? { creditsCharged: Number(operationDetails.creditsCharged ?? operationDetails.credits) }
          : {}),
        ...(Number.isFinite(Number(operationDetails.credits))
          ? { credits: Number(operationDetails.credits) }
          : {}),
        createdAt: new Date().toISOString()
      },
      folderId: sourceFile.folderId || null,
      canvasId: canvas ? canvas.id : null
    };
    store.addFile(record);
    recordCanvasUsageFile(record);
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
        estimatedCredits: Number.isFinite(Number(operationDetails.estimatedCredits ?? operationDetails.credits))
          ? Number(operationDetails.estimatedCredits ?? operationDetails.credits) : null,
        creditsCharged: Number.isFinite(Number(operationDetails.creditsCharged ?? operationDetails.credits))
          ? Number(operationDetails.creditsCharged ?? operationDetails.credits) : null,
        credits: Number.isFinite(Number(operationDetails.credits)) ? Number(operationDetails.credits) : null,
        providerCost: Number.isFinite(Number(operationDetails.providerCost)) ? Number(operationDetails.providerCost) : null,
        createdAt: new Date().toISOString()
      },
      folderId: sourceFile.folderId || null,
      canvasId: canvas ? canvas.id : null
    };
    store.addFile(record);
    recordCanvasUsageFile(record);
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
  const maxArchivedReferences = mediaKind === 'video' ? 30 : 14;
  const referenceFileIds = Array.isArray(request.referenceFileIds)
    ? request.referenceFileIds
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .filter((value) => !!store.getFile(value))
       .slice(0, maxArchivedReferences)
    : [];
  const referenceCount = Math.max(
    referenceFileIds.length,
    Array.isArray(request.urls) ? Math.min(maxArchivedReferences, request.urls.length) : 0
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
      requestedDuration: mediaKind === 'video'
        ? (Number(request.duration) === -1 ? -1 : Math.max(1, Number(request.duration) || 6))
        : null,
      videoMode: mediaKind === 'video' ? String(request.videoMode || 'text').trim().slice(0, 32) : null,
      serviceTier: mediaKind === 'video' ? String(request.serviceTier || '').trim().toLowerCase().slice(0, 24) || null : null,
      cameraControl: mediaKind === 'video' ? normalizeVideoCameraControl(request.cameraControl) : null,
      referenceFileIds,
      referenceMediaTypes: mediaKind === 'video' && Array.isArray(request.referenceMediaTypes)
        ? request.referenceMediaTypes.map((value) => String(value || '').toLowerCase()).slice(0, referenceFileIds.length)
        : referenceFileIds.map(() => 'image'),
      referenceCount,
      estimatedCredits: request.estimatedCredits !== null && request.estimatedCredits !== undefined
        && Number.isFinite(Number(request.estimatedCredits))
        ? Math.max(0, Number(request.estimatedCredits))
        : null,
      creditsCharged: request.creditsCharged !== null && request.creditsCharged !== undefined
        && Number.isFinite(Number(request.creditsCharged))
        ? Math.max(0, Number(request.creditsCharged))
        : (request.credits !== null && request.credits !== undefined
          && Number.isFinite(Number(request.credits))
          ? Math.max(0, Number(request.credits))
          : null),
      credits: request.credits !== null && request.credits !== undefined
        && Number.isFinite(Number(request.credits))
        ? Math.max(0, Number(request.credits))
        : null,
      accountingRequestId: String(request.accountingRequestId || '').trim().slice(0, 80) || null,
      createdAt: new Date().toISOString()
    },
    folderId: folderId || null,
    canvasId: canvas ? canvas.id : null
  };

  store.addFile(record);
  recordCanvasUsageFile(record);
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
  // Provider pixel dimensions describe the file, not its visual size on the
  // board. Keep generated placements compact even if a malformed placement
  // accidentally contains a 2K/4K source width.
  const width = Math.max(80, Math.min(360, numberOr(placement.width, 300)));
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
  const requestedPartitionId = String(placement.partitionId || request.partitionId || '').trim().slice(0, 120);
  const partition = requestedPartitionId
    ? store.data.boardItems.find((entry) => entry && entry.isPartition && entry.id === requestedPartitionId && entry.canvasId === canvas.id)
    : null;
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
    selected: index === 0,
    ...(partition ? { partitionId: partition.id } : {})
  };
  const persistedItem = persistentBoardItem(item, canvas.id);
  const existingIndex = store.data.boardItems.findIndex((entry) => entry.id === item.id);
  if (existingIndex === -1) store.data.boardItems.push(persistedItem);
  else store.data.boardItems[existingIndex] = persistedItem;
  return item;
}

async function rollbackGeneratedMediaFile(record) {
  if (!record || !record.id) return;
  const persistedDelivery = Array.isArray(store.data.aiMediaDeliveries)
    ? store.data.aiMediaDeliveries.find((entry) => (
      entry && Array.isArray(entry.recordIds)
        && entry.recordIds.some((id) => String(id) === String(record.id))
        && entry.status === 'confirmed'
    ))
    : null;
  const activeDelivery = [...aiMediaDeliveries.values()].find((entry) => (
    entry && Array.isArray(entry.recordIds)
      && entry.recordIds.some((id) => String(id) === String(record.id))
      && entry.status === 'confirmed'
  ));
  if (persistedDelivery || activeDelivery) {
    // A confirmed result is already paid for. A late renderer failure or a
    // duplicate cleanup callback must never turn it into a missing file.
    console.warn('Skipped rollback for a confirmed AI media result:', record.id);
    return;
  }
  store.data.boardItems = store.data.boardItems.filter((item) => item.fileId !== record.id);
  if (Array.isArray(store.data.canvasUsageLedger)) {
    const usageEntryId = `file:${record.id}`;
    store.data.canvasUsageLedger = store.data.canvasUsageLedger.filter((entry) => entry && entry.id !== usageEntryId);
  }
  store.removeFileById(record.id);
  await fs.promises.rm(record.storedPath, { force: true }).catch(() => {});
  await fs.promises.rm(path.join(previewCacheDir, record.id), { recursive: true, force: true }).catch(() => {});
  thumbnails.deleteThumbnail(record.id, thumbCacheDir);
  store.scheduleSave();
}

function deliverySettlement(payload) {
  return payload && payload.settlement && typeof payload.settlement === 'object'
    ? payload.settlement
    : payload && typeof payload === 'object' ? payload : null;
}

function butlerDeliveryRequest(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.deliveryPending !== true) return null;
  const requestId = String(buffer.deliveryRequestId || '').trim().toLowerCase();
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(requestId)) return null;
  return {
    requestId,
    durationMs: Math.max(0, Math.round(Number(buffer.deliveryDurationMs) || 0)),
    estimatedCredits: Number.isFinite(Number(buffer.estimatedCredits))
      ? Math.max(0, Number(buffer.estimatedCredits))
      : null
  };
}

async function releaseButlerBufferDeliveries(buffers) {
  if (!aiGateway || typeof aiGateway.releaseMediaDelivery !== 'function') return;
  const requests = new Map();
  for (const buffer of Array.isArray(buffers) ? buffers : []) {
    const delivery = butlerDeliveryRequest(buffer);
    if (!delivery) continue;
    const previous = requests.get(delivery.requestId);
    if (!previous || delivery.durationMs > previous.durationMs) requests.set(delivery.requestId, delivery);
  }
  for (const delivery of requests.values()) {
    try {
      await aiGateway.releaseMediaDelivery(delivery.requestId, delivery.durationMs);
    } catch (error) {
      console.error('Could not release an unsaved Butler reservation:', error && error.code || error);
    }
  }
}

function scheduleButlerDeliveryRecovery(token, delayMs = BUTLER_DELIVERY_TTL_MS) {
  const entry = butlerDeliveries.get(token);
  if (!entry || entry.status !== 'pending') return;
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(async () => {
    const current = butlerDeliveries.get(token);
    if (!current || current.status !== 'pending') return;
    try {
      await settleButlerDeliveryToken(token, current.confirmRequested === true);
    } catch (error) {
      console.error('Could not recover a pending Butler delivery:', error && error.code || error);
      scheduleButlerDeliveryRecovery(token, 5 * 60 * 1000);
    }
  }, delayMs);
  entry.timer.unref?.();
}

async function registerButlerDelivery(buffers, records) {
  const safeBuffers = Array.isArray(buffers) ? buffers.filter(Buffer.isBuffer) : [];
  const safeRecords = Array.isArray(records) ? records.filter((record) => record && record.id) : [];
  const requests = safeBuffers.map(butlerDeliveryRequest).filter(Boolean);
  if (!requests.length) {
    safeRecords.forEach((record, index) => {
      const accounting = butlerOutputAccounting(safeBuffers[index] || safeBuffers[0], null);
      if (!record.butlerOperation || !Object.keys(accounting).length) return;
      Object.assign(record.butlerOperation, accounting);
      recordCanvasUsageFile(record);
    });
    if (safeRecords.length) store.scheduleSave();
    return null;
  }
  const requestIds = [...new Set(requests.map((entry) => entry.requestId))];
  if (requestIds.length !== 1) {
    await Promise.all(safeRecords.map((record) => rollbackGeneratedMediaFile(record)));
    await releaseButlerBufferDeliveries(safeBuffers);
    const error = new Error('The Butler delivery accounting was inconsistent.');
    error.code = 'invalid-delivery-confirmation';
    throw error;
  }
  const requestId = requestIds[0];
  const durationMs = requests.reduce((maximum, entry) => Math.max(maximum, entry.durationMs), 0);
  const estimatedCredits = requests.reduce((maximum, entry) => (
    entry.estimatedCredits === null ? maximum : Math.max(maximum, entry.estimatedCredits)
  ), -1);
  for (const record of safeRecords) {
    if (!record.butlerOperation) continue;
    record.butlerOperation.accountingRequestId = requestId;
    if (estimatedCredits >= 0) record.butlerOperation.estimatedCredits = estimatedCredits;
    delete record.butlerOperation.creditsCharged;
    delete record.butlerOperation.credits;
    recordCanvasUsageFile(record);
  }
  store.scheduleSave();
  const token = `bd_${crypto.randomBytes(24).toString('base64url')}`;
  butlerDeliveries.set(token, {
    token,
    requestId,
    durationMs,
    estimatedCredits: estimatedCredits >= 0 ? estimatedCredits : null,
    recordIds: safeRecords.map((record) => record.id),
    status: 'pending',
    confirmRequested: false,
    createdAt: Date.now(),
    timer: null,
    inFlight: null,
    result: null
  });
  persistButlerDelivery(butlerDeliveries.get(token));
  scheduleButlerDeliveryRecovery(token);
  return token;
}

function butlerFilePayload(record, deliveryToken = null) {
  const payload = fileToPayload(record);
  return deliveryToken ? { ...payload, butlerDeliveryToken: deliveryToken } : payload;
}

async function settleButlerDeliveryToken(rawToken, delivered) {
  const token = String(rawToken || '').trim();
  const entry = butlerDeliveries.get(token);
  if (!entry) {
    const error = new Error('The Butler delivery token is invalid or has expired.');
    error.code = 'invalid-delivery-token';
    throw error;
  }
  const expectedStatus = delivered === true ? 'confirmed' : 'released';
  if (entry.status !== 'pending') {
    if (entry.status === expectedStatus) return entry.result;
    const error = new Error('The Butler delivery was already settled differently.');
    error.code = 'delivery-status-conflict';
    throw error;
  }
  if (delivered === true) entry.confirmRequested = true;
  if (entry.inFlight) return entry.inFlight;
  entry.inFlight = (async () => {
    const settlement = deliverySettlement(delivered === true
      ? await aiGateway.confirmMediaDelivery(entry.requestId, entry.durationMs)
      : await aiGateway.releaseMediaDelivery(entry.requestId, entry.durationMs));
    const expectedGatewayStatus = delivered === true ? 'succeeded' : 'failed';
    if (!settlement || settlement.ok !== true || String(settlement.status || '') !== expectedGatewayStatus) {
      const error = new Error('The Butler delivery charge could not be settled safely.');
      error.code = 'delivery-confirmation-failed';
      throw error;
    }
    const records = entry.recordIds.map((id) => store.getFile(id)).filter(Boolean);
    if (delivered === true) {
      const charged = Number(settlement.creditsCharged);
      for (const record of records) {
        if (!record.butlerOperation) continue;
        record.butlerOperation.accountingRequestId = entry.requestId;
        if (entry.estimatedCredits !== null) record.butlerOperation.estimatedCredits = entry.estimatedCredits;
        if (Number.isFinite(charged) && charged >= 0) {
          record.butlerOperation.creditsCharged = charged;
          record.butlerOperation.credits = charged;
        }
        recordCanvasUsageFile(record);
      }
    } else {
      await Promise.all(records.map((record) => rollbackGeneratedMediaFile(record)));
    }
    store.scheduleSave();
    if (runtimeConfig.gatewayConfigured) await syncGatewayAccount({ force: true });
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    entry.status = expectedStatus;
    entry.result = {
      ok: true,
      status: entry.status,
      settlement,
      files: delivered === true ? records.map(fileToPayload) : [],
      removedFileIds: delivered === true ? [] : [...entry.recordIds]
    };
    persistButlerDelivery(entry);
    const cleanup = setTimeout(() => butlerDeliveries.delete(token), 5 * 60 * 1000);
    cleanup.unref?.();
    return entry.result;
  })();
  try {
    return await entry.inFlight;
  } catch (error) {
    if (entry.status === 'pending') scheduleButlerDeliveryRecovery(token, 15 * 1000);
    throw error;
  } finally {
    entry.inFlight = null;
  }
}

async function confirmGeneratedMediaDelivery(kind, generated) {
  const buffer = generated && generated.buffer;
  if (!buffer || buffer.deliveryPending !== true) return null;
  const settlement = kind === 'video'
    ? deliverySettlement(await aiGateway.confirmVideoDelivery(buffer.deliveryTaskToken, {
      contentType: buffer.deliveryContentType,
      bytes: buffer.length
    }))
    : deliverySettlement(await aiGateway.confirmMediaDelivery(
      buffer.deliveryRequestId || generated.accountingRequestId,
      buffer.deliveryDurationMs
    ));
  if (!settlement || settlement.ok !== true || String(settlement.status || '') !== 'succeeded') {
    const error = new Error('The generated media charge could not be confirmed safely.');
    error.code = 'delivery-confirmation-failed';
    throw error;
  }
  return settlement;
}

async function releaseGeneratedMediaDelivery(kind, generated) {
  const buffer = generated && generated.buffer;
  if (!buffer || buffer.deliveryPending !== true) return;
  try {
    if (kind === 'video') await aiGateway.releaseVideoDelivery(buffer.deliveryTaskToken);
    else await aiGateway.releaseMediaDelivery(
      buffer.deliveryRequestId || generated.accountingRequestId,
      buffer.deliveryDurationMs
    );
  } catch (error) {
    console.error('Could not release undelivered AI media reservation:', error && error.code || error);
  }
}

function settleAiMediaDeliveryGroup(entry, delivered, charged) {
  const group = aiMediaDeliveryGroups.get(entry.groupId);
  if (!group) {
    // Older builds persisted delivery tokens before the aggregate group.
    // Finish the local event conservatively after the gateway has settled it.
    if (membershipService && entry.usageId) {
      membershipService.finishUsage(entry.usageId, {
        status: delivered ? 'succeeded' : 'failed',
        resultUnits: delivered ? entry.recordIds.length : 0,
        failedUnits: delivered ? 0 : entry.recordIds.length,
        settledCredits: delivered ? Math.max(0, Number(charged) || 0) : 0
      });
    }
    return;
  }
  group.pendingTokens = group.pendingTokens.filter((token) => token !== entry.token);
  group.settledTokens = [...new Set([...(group.settledTokens || []), entry.token])];
  if (delivered) {
    group.resultUnits += entry.recordIds.length;
    group.settledCredits += Math.max(0, Number(charged) || 0);
  } else {
    group.failedUnits += entry.recordIds.length;
  }
  persistAiMediaDeliveryGroup(group);
  if (group.pendingTokens.length) return;
  membershipService.finishUsage(group.usageId, {
    status: group.failedUnits ? 'partial' : 'succeeded',
    resultUnits: group.resultUnits,
    failedUnits: group.failedUnits,
    settledCredits: group.settledCredits
  });
  aiMediaDeliveryGroups.delete(entry.groupId);
  removeAiMediaDeliveryGroup(entry.groupId);
  if (runtimeConfig.gatewayConfigured) void syncGatewayAccount({ force: true });
}

async function settleAiMediaDeliveryToken(rawToken, delivered) {
  const token = String(rawToken || '').trim();
  const entry = aiMediaDeliveries.get(token);
  if (!entry) {
    const error = new Error('The AI media delivery token is invalid or has expired.');
    error.code = 'invalid-ai-delivery-token';
    throw error;
  }
  const expectedStatus = delivered === true ? 'confirmed' : 'released';
  if (entry.status !== 'pending') {
    if (entry.status === expectedStatus) {
      // A previous settlement may have completed just before the process lost
      // its response. Retry the local flush only; never call the gateway twice.
      await flushStoreDurably();
      return entry.result;
    }
    const error = new Error('The AI media delivery was already settled differently.');
    error.code = 'ai-delivery-status-conflict';
    throw error;
  }
  if (entry.inFlight) {
    if (entry.settlementIntent === (delivered === true ? 'confirmed' : 'released')) return entry.inFlight;
    const error = new Error('The AI media delivery is already being settled differently.');
    error.code = 'ai-delivery-settlement-in-flight';
    throw error;
  }
  entry.settlementIntent = delivered === true ? 'confirmed' : 'released';
  entry.inFlight = (async () => {
    if (delivered === true) {
      // The gateway must not charge until both the bytes and their canvas
      // placement have survived the local persistence barrier.
      await flushStoreDurably();
      if (!await aiMediaDeliveryIsDurable(entry) || !aiMediaDeliveryHasCanvasItem(entry)) {
        const error = new Error('The generated result has not been persisted to the canvas.');
        error.code = 'ai-delivery-not-placed';
        throw error;
      }
    }
    const records = entry.recordIds.map((id) => store.getFile(id)).filter(Boolean);
    const representative = records[0];
    const settlement = deliverySettlement(delivered === true
      ? entry.kind === 'video'
        ? await aiGateway.confirmVideoDelivery(entry.taskToken, {
          contentType: representative && representative.mimeType,
          bytes: representative && representative.sizeBytes
        })
        : await aiGateway.confirmMediaDelivery(entry.requestId, entry.durationMs)
      : entry.kind === 'video'
        ? await aiGateway.releaseVideoDelivery(entry.taskToken)
        : await aiGateway.releaseMediaDelivery(entry.requestId, entry.durationMs));
    const expectedGatewayStatus = delivered === true ? 'succeeded' : 'failed';
    if (!settlement || settlement.ok !== true || String(settlement.status || '') !== expectedGatewayStatus) {
      const error = new Error('The generated media charge could not be settled safely.');
      error.code = 'ai-delivery-settlement-failed';
      throw error;
    }
    let charged = 0;
    if (delivered === true) {
      charged = Math.max(0, Number(settlement.creditsCharged) || 0);
      for (const record of records) {
        if (!record.aiGeneration) continue;
        record.aiGeneration.creditsCharged = charged;
        record.aiGeneration.credits = charged;
        recordCanvasUsageFile(record);
      }
      store.scheduleSave();
    } else {
      await Promise.all(records.map((record) => rollbackGeneratedMediaFile(record)));
    }
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    entry.status = expectedStatus;
    entry.result = {
      ok: true,
      status: entry.status,
      settlement,
      files: delivered === true ? records.map(fileToPayload) : [],
      removedFileIds: delivered === true ? [] : [...entry.recordIds]
    };
    persistAiMediaDelivery(entry);
    settleAiMediaDeliveryGroup(entry, delivered === true, charged);
    await flushStoreDurably();
    const cleanup = setTimeout(() => aiMediaDeliveries.delete(token), 5 * 60 * 1000);
    cleanup.unref?.();
    return entry.result;
  })();
  try {
    return await entry.inFlight;
  } catch (error) {
    if (entry.status === 'pending') scheduleAiMediaDeliveryRecovery(token, 15 * 1000);
    throw error;
  } finally {
    entry.inFlight = null;
    if (entry.status === 'pending') entry.settlementIntent = null;
  }
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
  const maxPixels = Math.max(1, Math.min(8_294_400, Number(capabilities.maxSizePixels) || 8_294_400));
  return width % 16 === 0 && height % 16 === 0
    && width <= maxEdge && height <= maxEdge && width * height <= maxPixels;
}

async function quoteMediaCreditsForAccount(request = {}) {
  const localQuote = quoteMediaCredits(request);
  if (!hasAuthenticatedGatewaySession() || !aiGateway || !aiGateway.isConfigured()) return localQuote;
  try {
    const remoteQuote = await aiGateway.quoteMediaCredits(request);
    // A quote without a version is from a pre-versioned gateway deployment.
    // Do not let it replace the bundled table: this is what previously let a
    // stale Seedance 2.5 4K-ESR quote (151 points) reach the composer.
    if (String(remoteQuote && remoteQuote.pricingVersion || '').trim() !== CREDIT_PRICING_VERSION) {
      return localQuote;
    }
    // A rolling gateway deployment can briefly expose an older price table.
    // Never show a quote below the bundled table: the server remains the
    // authority for reservation, while this upper bound prevents the desktop
    // estimate from understating a real charge during that window.
    return conservativeMediaCreditQuote(localQuote, remoteQuote, request);
  } catch {
    // A quote outage must not make the local UI unusable; the server remains
    // authoritative when the generation request is submitted.
    return localQuote;
  }
}

async function fileToAiChatAttachment(id) {
  const file = store.getFile(String(id || ''));
  if (!file || !file.storedPath) return null;
  assertSafeLocalFile(file);
  const kind = attachmentKind(file);
  if (kind === 'image') {
    const dataUrl = await fileToSafeAiDataUrl(file.id);
    return dataUrl ? { ...attachmentMetadata(file, kind), dataUrl } : null;
  }
  const ext = String(file.ext || path.extname(file.name)).toLowerCase();
  if (preview.isOfficeExt(ext) && ext !== '.docx') {
    const caps = await preview.getCapabilities();
    if (caps.hasSoffice) {
      try {
        const cacheDir = path.join(previewCacheDir, file.id);
        const pdfPath = await preview.convertOfficeToPdfCached(file.storedPath, cacheDir, previewTmpDir);
        const extracted = await prepareTextAttachment({
          ...file,
          storedPath: pdfPath,
          mimeType: 'application/pdf'
        });
        return { ...extracted, name: file.name, mimeType: file.mimeType, kind: 'document' };
      } catch (error) {
        console.warn('AI office attachment extraction failed:', file.name, error && error.message);
      }
    }
  }
  return prepareTextAttachment(file);
}

async function resolveAiChatMessageAttachments(message, fallbackRequest = null) {
  const fileIds = Array.isArray(message && message.attachmentFileIds)
    ? message.attachmentFileIds
    : fallbackRequest && Array.isArray(fallbackRequest.attachmentFileIds)
      ? fallbackRequest.attachmentFileIds
      : [];
  const tokens = Array.isArray(message && message.attachmentTokens)
    ? message.attachmentTokens
    : fallbackRequest && Array.isArray(fallbackRequest.attachmentTokens)
      ? fallbackRequest.attachmentTokens
      : [];
  const local = await Promise.all(fileIds.slice(0, 8).map(fileToAiChatAttachment));
  const temporary = tokens.slice(0, 8).map((token) => {
    const record = transientAiAttachments.get(String(token || ''));
    if (!record || record.expiresAt <= Date.now()) return null;
    return {
      id: `temporary-${token}`,
      name: record.name || 'Pasted image',
      mimeType: record.mimeType || 'image/webp',
      sizeBytes: record.sizeBytes || 0,
      kind: 'image',
      dataUrl: record.dataUrl
    };
  });
  return [...local, ...temporary].filter(Boolean).slice(0, 8);
}

function publicAiAttachment(attachment) {
  return {
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    kind: attachment.kind,
    readable: attachment.readable === true,
    truncated: attachment.truncated === true,
    ...(attachment.dataUrl ? { dataUrl: attachment.dataUrl } : {})
  };
}

function normalizeImageSize(value) {
  const text = String(value || '').trim();
  if (/^(?:1|2|4)k$/i.test(text)) return text.toUpperCase();
  if (/^(?:default|adaptive|original|auto)$/i.test(text)) {
    const lower = text.toLowerCase();
    return lower === 'default' ? 'Default' : lower;
  }
  const match = /^(\d{1,4})\s*[x×]\s*(\d{1,4})$/i.exec(text);
  return match ? `${Number(match[1])}x${Number(match[2])}` : text;
}

function imageResolutionPresetForPixels(value, supportedSizes) {
  const match = /^(\d{1,5})x(\d{1,5})$/i.exec(String(value || '').trim());
  if (!match) return '';
  const longestEdge = Math.max(Number(match[1]), Number(match[2]));
  const preferred = longestEdge >= 3072 ? '4K' : longestEdge >= 1536 ? '2K' : '1K';
  if (supportedSizes.has(preferred)) return preferred;
  const ranked = [...supportedSizes]
    .filter((entry) => /^(?:1|2|4)K$/.test(entry))
    .sort((left, right) => Number(left[0]) - Number(right[0]));
  if (!ranked.length) return '';
  return ranked.reduce((nearest, candidate) => (
    Math.abs(Number(candidate[0]) - Number(preferred[0])) < Math.abs(Number(nearest[0]) - Number(preferred[0]))
      ? candidate
      : nearest
  ));
}

function supportsImageAspectRatio(value, capabilities = {}) {
  const normalized = String(value || '').trim();
  if (normalized === 'auto') return AI_IMAGE_RATIOS.has('auto') || capabilities.arbitraryRatios === true;
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(normalized);
  if (!match) return AI_IMAGE_RATIOS.has(normalized);
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false;
  const ratio = width / height;
  const minimum = Number(capabilities.minimumAspectRatio);
  const maximum = Number(capabilities.maximumAspectRatio);
  if (Number.isFinite(minimum) && ratio < minimum) return false;
  if (Number.isFinite(maximum) && ratio > maximum) return false;
  if (capabilities.arbitraryRatios !== true) return AI_IMAGE_RATIOS.has(normalized);
  return ratio >= 1 / 16 && ratio <= 16;
}

function normalizeAiMediaGenerationRequest(request, kind) {
  const normalized = { ...request };
  if (kind === 'image') {
    let size = normalizeImageSize(request.size);
    const aspectRatio = String(request.aspectRatio || '').trim();
    let quality = String(request.quality || 'auto').trim().toLowerCase();
    if (!AI_IMAGE_SIZES.has(size) && !/^([1-9]\d{0,3})x([1-9]\d{0,3})$/i.test(size)) {
      throw invalidAiMediaOption('invalid-size', 'The selected image resolution is not supported.');
    }
    if (!supportsImageAspectRatio(aspectRatio, { arbitraryRatios: true })) {
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
        .map(normalizeImageSize)
        .filter(Boolean)
    );
    const configuredQualities = Array.isArray(capabilities.qualities)
      ? capabilities.qualities.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean)
      : [];
    if (configuredQualities.length && !configuredQualities.includes(quality)) {
      // Some routed Atlas catalog entries expose medium/high/low only while
      // the shared desktop default is auto. Use the documented medium tier
      // instead of submitting an option the selected upstream rejects.
      if (quality === 'auto' && configuredQualities.includes('medium')) quality = 'medium';
      else throw invalidAiMediaOption('invalid-quality', 'The selected image model does not support this quality.');
    }
    if (supportedSizes.size && !supportedSizes.has(size) && !imageDimensionsWithinCapabilities(size, capabilities)) {
      const savedSize = normalizeImageSize(imageConfig.imageSize);
      size = imageResolutionPresetForPixels(size, supportedSizes)
        || (supportedSizes.has(savedSize) ? savedSize : size);
    }
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
    if (supportedRatios.size && !supportedRatios.has(aspectRatio) && !supportsImageAspectRatio(aspectRatio, capabilities)) {
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
  const resolution = normalizeVideoResolution(
    request.resolution || request.size,
    providerId,
    provider.model
  );
  const serviceTiers = Array.isArray(capabilities.serviceTiers)
    ? capabilities.serviceTiers.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean)
    : [];
  const inferredServiceTier = !request.serviceTier && capabilities.tierResolutions
    ? serviceTiers.find((tier) => Array.isArray(capabilities.tierResolutions[tier])
      && capabilities.tierResolutions[tier].some((value) => String(value || '').trim().toUpperCase() === resolution))
    : '';
  const requestedServiceTier = String(
    request.serviceTier || inferredServiceTier || capabilities.defaultServiceTier || serviceTiers[0] || ''
  ).trim().toLowerCase();
  if (serviceTiers.length && !serviceTiers.includes(requestedServiceTier)) {
    throw invalidAiMediaOption('invalid-service-tier', 'The selected model version is not supported.');
  }
  const tierResolutions = capabilities.tierResolutions && requestedServiceTier
    && Array.isArray(capabilities.tierResolutions[requestedServiceTier])
    ? capabilities.tierResolutions[requestedServiceTier]
    : null;
  const supportedResolutions = new Set(
    (Array.isArray(tierResolutions) && tierResolutions.length
      ? tierResolutions
      : Array.isArray(capabilities.resolutions) && capabilities.resolutions.length
      ? capabilities.resolutions
      : [...MINIMAX_VIDEO_RESOLUTIONS])
      .map((value) => String(value || '').trim().toUpperCase())
      .filter(Boolean)
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
  const duration = Number(request.duration);
  let aspectRatio = String(request.aspectRatio || '').trim();
  const referenceMediaTypes = Array.isArray(request.referenceMediaTypes)
    ? request.referenceMediaTypes.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean)
    : [];
  const referenceAudioCount = (Array.isArray(request.referenceAudioUploadIds) ? request.referenceAudioUploadIds.length : 0)
    + (Array.isArray(request.referenceAudioUrls) ? request.referenceAudioUrls.length : 0);
  const referenceCount = referenceMediaTypes.length + referenceAudioCount
    || (Array.isArray(request.urls) ? request.urls.length : 0);
  const requestedVideoMode = String(request.videoMode || '').trim().toLowerCase();
  const isAtlasRouted = capabilities.atlasRouted === true;
  const isSeedance25 = providerId === 'video-3' || String(provider.model || '').includes('2.5');
  const isAtlasReferenceProvider = String(capabilities.atlasKind || '') === 'reference-to-video';
  const videoModes = normalizedVideoModes(capabilities);
  const availableMode = (...ids) => ids.find((id) => videoModes.some((entry) => entry.id === id)) || '';
  const fallbackVideoMode = referenceMediaTypes.includes('video') || referenceAudioCount > 0
    ? availableMode('omni', 'video-reference', 'video-edit', 'video-extend')
    : referenceCount > 2
      ? availableMode('omni', 'video-reference')
      : referenceCount === 2
        ? availableMode('first-last-frame', 'omni')
        : referenceCount === 1
          ? availableMode('first-frame', 'omni')
          : availableMode('text');
  const videoMode = requestedVideoMode || fallbackVideoMode;
  const isAtlasReference = isAtlasReferenceProvider
    || (isAtlasRouted && (
      ['omni', 'video-reference', 'video-edit', 'video-extend'].includes(videoMode)
      || referenceMediaTypes.includes('video')
      || referenceAudioCount > 0
    ));
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
  if (referenceAudioCount > 0 && !allowedReferenceMediaTypes.has('audio')) {
    throw invalidAiMediaOption('invalid-reference-media', `${String(provider.name || 'The selected video model')} does not accept reference audio in this mode.`);
  }
  const referenceVideoCount = referenceMediaTypes.filter((mediaType) => mediaType === 'video').length;
  const maximumReferenceVideos = Math.max(0, Number(selectedVideoMode.maxReferenceVideos) || 0);
  const minimumReferenceVideos = Math.max(0, Number(selectedVideoMode.minReferenceVideos) || 0);
  if (referenceVideoCount < minimumReferenceVideos) {
    throw invalidAiMediaOption('reference-video-required', `${String(provider.name || 'The selected video model')} requires at least ${minimumReferenceVideos} reference video${minimumReferenceVideos === 1 ? '' : 's'}.`);
  }
  if (referenceVideoCount > maximumReferenceVideos) {
    throw invalidAiMediaOption('too-many-reference-videos', `${String(provider.name || 'The selected video model')} supports at most ${maximumReferenceVideos} reference videos.`);
  }
  const referenceAudioLimit = Number(selectedVideoMode.maxReferenceAudios ?? capabilities.maxReferenceAudios);
  if (Number.isInteger(referenceAudioLimit) && referenceAudioLimit >= 0 && referenceAudioCount > referenceAudioLimit) {
    throw invalidAiMediaOption('too-many-reference-audios', `${String(provider.name || 'The selected video model')} supports at most ${referenceAudioLimit} reference audio files.`);
  }
  if (referenceVideoCount > 0) {
    const maximumImagesWithVideo = Number(selectedVideoMode.maxReferenceImagesWithVideo);
    const referenceImageCount = referenceMediaTypes.filter((mediaType) => mediaType === 'image').length;
    if (Number.isInteger(maximumImagesWithVideo) && maximumImagesWithVideo >= 0
      && referenceImageCount > maximumImagesWithVideo) {
      throw invalidAiMediaOption(
        'too-many-references',
        `${String(provider.name || 'The selected video model')} supports at most ${maximumImagesWithVideo} reference images with a reference video.`
      );
    }
  }
  const hasFrameReference = videoMode === 'first-frame' || videoMode === 'first-last-frame';
  const configuredReferenceLimit = Number(capabilities.maxReferenceImages);
  const modeReferenceLimit = Number(selectedVideoMode.maxReferences);
  const atlasReferenceLimit = isSeedance25 ? 50 : 12;
  const referenceLimit = Number.isInteger(modeReferenceLimit) && modeReferenceLimit >= 0
    ? Math.min(isAtlasReference ? atlasReferenceLimit : 30, modeReferenceLimit)
    : Number.isInteger(configuredReferenceLimit) && configuredReferenceLimit >= 0
      ? Math.min(isAtlasReference ? atlasReferenceLimit : 30, configuredReferenceLimit)
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
  if (isAtlasReference && !isSeedance25
    && referenceAudioCount > 0 && referenceMediaTypes.length === 0) {
    throw invalidAiMediaOption('reference-required', `${providerName} requires at least one image or video when using reference audio.`);
  }
  const durationSource = selectedVideoMode && Array.isArray(selectedVideoMode.durations) && selectedVideoMode.durations.length
    ? selectedVideoMode.durations
    : Array.isArray(capabilities.durations) && capabilities.durations.length
      ? capabilities.durations
      : Array.from({ length: 12 }, (_value, index) => index + 4);
  const supportedDurations = new Set(durationSource.map(Number).filter(Number.isInteger));
  if (!Number.isInteger(duration) || !supportedDurations.has(duration)) {
    throw invalidAiMediaOption('invalid-duration', `${providerName} does not support the selected duration.`);
  }
  const modeRatios = new Set(
    (Array.isArray(selectedVideoMode.ratios) ? selectedVideoMode.ratios : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  );
  const supportedRatios = modeRatios.size ? modeRatios : hasFrameReference ? frameRatios : textRatios;
  // Image-to-video providers such as Seedance 2.5 and Kling derive their
  // output framing from the submitted reference. Older desktop builds and
  // alternate canvas entry points may still submit that image's explicit
  // ratio (for example 16:9). Normalize it to the provider's documented
  // adaptive value instead of rejecting an otherwise valid reference.
  if (referenceCount > 0 && supportedRatios.size === 1 && supportedRatios.has('adaptive')) {
    aspectRatio = 'adaptive';
  }
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
  normalized.serviceTier = requestedServiceTier || null;
  normalized.cameraControl = normalizeVideoCameraControl(request.cameraControl);
  normalized.referenceMediaTypes = referenceMediaTypes;
  normalized.referenceVideoUploadIds = Array.isArray(request.referenceVideoUploadIds)
    ? request.referenceVideoUploadIds.map(String).filter(Boolean).slice(0, 30)
     : [];
  normalized.referenceAudioUploadIds = Array.isArray(request.referenceAudioUploadIds)
    ? request.referenceAudioUploadIds.map(String).filter(Boolean).slice(0, isSeedance25 ? 10 : 3)
    : [];
  normalized.referenceAudioUrls = Array.isArray(request.referenceAudioUrls)
    ? request.referenceAudioUrls.map(String).filter((value) => /^https:\/\//i.test(value)).slice(0, isSeedance25 ? 10 : 3)
    : [];
  normalized.generateAudio = request.generateAudio !== false;
  normalized.returnLastFrame = request.returnLastFrame === true;
  const supportsSeed = capabilities.supportsSeed === true;
  const requestedSeed = Math.round(Number(request.seed));
  const seedMinimum = Number.isFinite(Number(capabilities.seedMinimum)) ? Number(capabilities.seedMinimum) : -1;
  const seedMaximum = Number.isFinite(Number(capabilities.seedMaximum)) ? Number(capabilities.seedMaximum) : 4_294_967_295;
  normalized.seed = supportsSeed && Number.isInteger(requestedSeed)
    && requestedSeed >= seedMinimum && requestedSeed <= seedMaximum ? requestedSeed : null;
  const bitrateModes = Array.isArray(capabilities.bitrateModes)
    ? new Set(capabilities.bitrateModes.map((value) => String(value || '').trim().toLowerCase())) : null;
  normalized.bitrateMode = bitrateModes && bitrateModes.has(String(request.bitrateMode || '').trim().toLowerCase())
    ? String(request.bitrateMode).trim().toLowerCase() : null;
  normalized.watermark = capabilities.supportsWatermark === true ? request.watermark === true : false;
  normalized.outputFormat = ['mp4', 'mov'].includes(String(request.outputFormat || '').trim().toLowerCase())
    ? String(request.outputFormat).trim().toLowerCase()
    : 'mp4';
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
  if (modelId === 'seededit-v3') {
    const prompt = String(source.prompt || '').trim();
    if (!prompt || Array.from(prompt).length > 1200) {
      const error = new Error('Enter an image-edit prompt up to 1200 characters.');
      error.code = 'invalid-prompt';
      throw error;
    }
    assertPromptHasNoSecrets(prompt);
    const seed = source.seed === '' || source.seed === undefined
      ? undefined
      : Math.max(0, Math.min(2_147_483_647, Math.round(finiteOr(source.seed, 0))));
    return {
      prompt,
      scale: Math.max(1, Math.min(10, finiteOr(source.scale, 5))),
      ...(seed !== undefined ? { seed } : {})
    };
  }
  if (modelId === 'kling-image-expand' || modelId === 'clipdrop-uncrop') {
    const boundedPixels = (value) => Math.max(0, Math.min(2000, Math.round(finiteOr(value, 0))));
    const options = {
      up: boundedPixels(source.up),
      right: boundedPixels(source.right),
      down: boundedPixels(source.down),
      left: boundedPixels(source.left)
    };
    if (![options.up, options.right, options.down, options.left].some((value) => value > 0)) {
      const error = new Error('The expanded image must be larger than the source.');
      error.code = 'invalid-image-tool-options';
      throw error;
    }
    if (source.seed !== '' && source.seed !== undefined && source.seed !== null) {
      options.seed = Math.max(0, Math.min(100_000, Math.round(finiteOr(source.seed, 0))));
    }
    return options;
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
    const prompt = String(source.prompt ?? '').trim();
    if (Array.from(prompt).length > 1024 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(prompt)) {
      const error = new Error('The 3D prompt is invalid.');
      error.code = 'invalid-prompt';
      throw error;
    }
    if (prompt) assertPromptHasNoSecrets(prompt);
    const seed = source.seed === '' || source.seed === undefined ? undefined : Math.max(0, Math.min(2_147_483_647, Math.round(Number(source.seed) || 0)));
    return {
      prompt,
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
      ? {
          message: String(payload && payload.errorMessage || 'Image processing failed.'),
          errorCode: String(payload && payload.errorCode || 'image-tool-failed')
        }
      : {})
  };
}

function rememberButlerImageTask(taskToken, patch = {}) {
  const previous = butlerImageTasks.get(taskToken) || {};
  const next = { ...previous, ...patch, kind: 'image', taskToken, updatedAt: Date.now() };
  butlerImageTasks.delete(taskToken);
  butlerImageTasks.set(taskToken, next);
  persistButlerTask('image', taskToken, next);
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
  const next = { ...previous, ...patch, kind: '3d', taskToken, updatedAt: Date.now() };
  butler3dTasks.delete(taskToken);
  butler3dTasks.set(taskToken, next);
  persistButlerTask('3d', taskToken, next);
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
  const next = { ...previous, ...patch, kind: 'video', taskToken, updatedAt: Date.now() };
  butlerVideoTasks.delete(taskToken);
  butlerVideoTasks.set(taskToken, next);
  persistButlerTask('video', taskToken, next);
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
    'video-upscale-request-rejected': 'The video enhancement service rejected this video or output combination. Try a compatible model and format.',
    'video-upload-not-found': 'The video upload expired. Please start the enhancement again.',
    'video-upload-incomplete': 'The video upload was interrupted. Please try again.',
    'invalid-video-upload-chunk': 'Part of the video upload was rejected. Please try again.',
    'video-upload-chunk-conflict': 'The video upload retry did not match the original data. Please start again.',
    'insufficient-credits': 'There are not enough points for this Butler request.',
    'account-suspended': 'This account cannot start paid AI tasks.',
    'credit-service-not-configured': 'The points service is not configured on the server.',
    'credit-schema-missing': 'The points service is being upgraded. Please try again shortly.',
    'credit-service-failed': 'The points balance could not be checked. Please try again.',
    'invalid-delivery-token': 'The Butler result confirmation expired. Run the tool again.',
    'invalid-delivery-confirmation': 'The Butler result could not be matched to its reserved points.',
    'delivery-confirmation-failed': 'The Butler result charge could not be confirmed safely. Please try again.',
    'delivery-status-conflict': 'This Butler result was already settled differently.',
    'provider-auth-failed': 'The AI service credential was rejected. Ask the administrator to update it.',
    'provider-request-failed': 'The generation request was not accepted. Check the reference files and settings, then try again.',
    'reference-policy-rejected': 'The reference image may contain copyrighted or restricted content. Choose another reference image. No points were charged.',
    'provider-invalid-response': 'The AI service returned an invalid result. Please try again.',
    'ai302-unauthorized': 'The AI service credential is invalid. Ask the administrator to update it.',
    'ai302-balance-exhausted': 'The generation service is temporarily unavailable. No points were charged; please try again later.',
    'ai302-rate-limited': 'Too many users are generating right now. No points were charged; please retry shortly.',
    'ai302-route-unavailable': 'The generation service is temporarily unavailable. No points were charged; please retry shortly.',
    'ai302-timeout': 'The AI service did not finish in time. This request was not submitted again automatically.',
    'ai302-unavailable': 'The AI service is temporarily unavailable. Please try again later.',
    'ai302-upstream-error': 'The generation request was not accepted. No points were charged; please check the settings and try again.',
    'ai302-invalid-response': 'The AI service returned an unsupported response. Please try again.',
    'ai302-not-configured': 'The AI service is not configured on the server.',
    'image-tool-failed': 'Image processing failed. No points were charged; please try again.',
    'three-d-generation-failed': '3D generation failed. No points were charged; please try again.',
    'video-upscale-failed': 'Video enhancement failed. No points were charged; please try again.',
    'tool-disabled': 'This AI tool is temporarily unavailable. Please try again later.',
    'tool-public-url-not-configured': 'The gateway public URL is required for this tool.',
    'tool-asset-capacity-exceeded': 'The video upload relay is busy. Please try again shortly.',
    'body-too-large': 'The video exceeds the gateway upload size limit.',
    'invalid-gateway-response': 'The secure AI gateway returned an invalid response.',
    'gateway-request-failed': 'The secure AI gateway could not start this request.',
    'gateway-error': 'The secure AI gateway returned a server error. Please retry shortly.',
    'gateway-queue-full': 'The AI generation queue is full. Please retry shortly.',
    'gateway-queue-timeout': 'The AI generation queue timed out. Please retry shortly.',
    'media-too-large': 'The generated result exceeds the safe download size.',
    'rate-limited': 'Too many Butler requests. Please wait and try again.'
  };
  const httpStatus = Number(error && error.status);
  const requestId = String(error && error.requestId || '').trim();
  const retryAfterMs = Number(error && error.retryAfterMs);
  const message = knownMessages[reason] || fallbackMessage;
  return {
    ok: false,
    reason,
    message,
    ...(Number.isInteger(httpStatus) && httpStatus >= 400 && httpStatus <= 599 ? { httpStatus } : {}),
    ...(requestId ? { requestId } : {}),
    ...(Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? { retryAfterMs } : {})
  };
}

function chatDraftPublic(draft) {
  return {
    token: draft.token,
    kind: draft.kind,
    mediaType: draft.mediaType || draft.kind,
    name: draft.name,
    mime: draft.mime || 'application/octet-stream',
    size: draft.size || 0,
    previewDataUrl: draft.previewDataUrl || null
  };
}

async function createChatAttachmentDraft(filePath, options = {}) {
  const absolute = path.resolve(String(filePath || ''));
  const stat = await fs.promises.stat(absolute).catch(() => null);
  if (!stat || !stat.isFile()) throw Object.assign(new Error('The selected attachment is unavailable.'), { code: 'file-not-found' });
  const extension = path.extname(absolute).toLowerCase();
  const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.tif', '.tiff', '.bmp', '.svg']);
  const videoExtensions = new Set(['.mp4', '.webm', '.ogv', '.mov', '.m4v', '.mkv', '.avi', '.wmv', '.asf', '.flv', '.f4v', '.mts', '.m2ts', '.ts', '.m2t', '.mpg', '.mpeg', '.mpe', '.3gp', '.3g2', '.vob', '.rm', '.rmvb', '.divx', '.dv', '.mxf', '.y4m', '.prores']);
  const kind = options.forceImage || imageExtensions.has(extension) ? 'image' : 'file';
  const token = crypto.randomUUID();
  let previewDataUrl = null;
  const imageMime = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
    '.gif': 'image/gif', '.avif': 'image/avif', '.tif': 'image/tiff', '.tiff': 'image/tiff',
    '.bmp': 'image/bmp', '.svg': 'image/svg+xml'
  };
  let mime = kind === 'image' ? (imageMime[extension] || 'application/octet-stream') : 'application/octet-stream';
  if (kind === 'image') {
    const source = nativeImage.createFromPath(absolute);
    if (!source.isEmpty()) {
      const size = source.getSize();
      const preview = Math.max(size.width, size.height) > 640 ? source.resize({ width: Math.min(640, size.width), quality: 'good' }) : source;
      previewDataUrl = preview.toDataURL();
    }
  }
  if (videoExtensions.has(extension)) {
    mime = extension === '.webm' ? 'video/webm'
      : (extension === '.ogv' ? 'video/ogg' : (extension === '.mov' ? 'video/quicktime' : 'video/mp4'));
  }
  const draft = {
    token,
    path: absolute,
    kind,
    mediaType: videoExtensions.has(extension) ? 'video' : kind,
    name: String(options.name || path.basename(absolute)).slice(0, 255),
    mime,
    size: stat.size,
    previewDataUrl,
    temporary: options.temporary === true,
    expiresAt: Date.now() + CHAT_DRAFT_TTL_MS
  };
  chatAttachmentDrafts.set(token, draft);
  return chatDraftPublic(draft);
}

async function discardChatAttachmentDraft(token) {
  const draft = chatAttachmentDrafts.get(String(token || ''));
  if (!draft) return false;
  chatAttachmentDrafts.delete(draft.token);
  if (draft.temporary) await fs.promises.rm(draft.path, { force: true }).catch(() => {});
  return true;
}

function cleanupExpiredChatDrafts() {
  const now = Date.now();
  for (const draft of chatAttachmentDrafts.values()) {
    if (draft.expiresAt > now) continue;
    discardChatAttachmentDraft(draft.token).catch(() => {});
  }
}

function screenshotOverlayHtml(dataUrl, channel) {
  const encodedImage = JSON.stringify(dataUrl);
  const encodedChannel = JSON.stringify(channel);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;cursor:crosshair;user-select:none;background:#000}
    #shot{position:fixed;inset:0;width:100%;height:100%;object-fit:fill}#shade{position:fixed;inset:0;background:rgba(0,0,0,.34)}
    #box{position:fixed;border:1px solid #fff;box-shadow:0 0 0 99999px rgba(0,0,0,.34);display:none;pointer-events:none}
    #tip{position:fixed;left:50%;top:18px;transform:translateX(-50%);padding:7px 11px;border-radius:6px;background:rgba(20,22,26,.78);color:#fff;font:12px system-ui}
  </style></head><body><img id="shot"><div id="shade"></div><div id="box"></div><div id="tip">Drag to capture / Esc to cancel</div><script>
    const {ipcRenderer}=require('electron');const channel=${encodedChannel};const img=document.getElementById('shot');img.src=${encodedImage};
    const box=document.getElementById('box'),shade=document.getElementById('shade');let start=null;
    function rect(e){const x=Math.min(start.x,e.clientX),y=Math.min(start.y,e.clientY),w=Math.abs(e.clientX-start.x),h=Math.abs(e.clientY-start.y);return{x,y,width:w,height:h}}
    addEventListener('pointerdown',e=>{start={x:e.clientX,y:e.clientY};box.style.display='block';shade.style.display='none';box.setPointerCapture?.(e.pointerId)});
    addEventListener('pointermove',e=>{if(!start)return;const r=rect(e);Object.assign(box.style,{left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px'})});
    addEventListener('pointerup',e=>{if(!start)return;const r=rect(e);start=null;if(r.width<4||r.height<4){box.style.display='none';shade.style.display='block';return}ipcRenderer.send(channel,{type:'select',rect:r,viewport:{width:innerWidth,height:innerHeight}})});
    addEventListener('keydown',e=>{if(e.key==='Escape')ipcRenderer.send(channel,{type:'cancel'})});
    addEventListener('contextmenu',e=>{e.preventDefault();ipcRenderer.send(channel,{type:'cancel'})});
  </script></body></html>`;
}

async function captureChatScreenshotDraftLegacy() {
  const displays = screen.getAllDisplays();
  const maxWidth = Math.max(...displays.map((display) => Math.round(display.size.width * (Number(display.scaleFactor) || 1))));
  const maxHeight = Math.max(...displays.map((display) => Math.round(display.size.height * (Number(display.scaleFactor) || 1))));
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: maxWidth, height: maxHeight } });
  const captures = displays.map((display) => {
    const source = sources.find((entry) => String(entry.display_id) === String(display.id));
    return source && !source.thumbnail.isEmpty() ? { display, image: source.thumbnail } : null;
  }).filter(Boolean);
  if (!captures.length) return { ok: false, reason: 'capture-failed', message: 'Unable to capture the screen.' };
  const channel = `chat:screenshot-selection:${crypto.randomUUID()}`;
  const overlays = [];
  return new Promise((resolve) => {
    let settled = false;
    const finish = async (payload) => {
      if (settled) return;
      settled = true;
      ipcMain.removeAllListeners(channel);
      overlays.forEach((window) => { if (!window.isDestroyed()) window.destroy(); });
      if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); }
      if (!payload || payload.type !== 'select') return resolve({ ok: false, reason: 'cancelled' });
      try {
        const capture = captures[payload.index];
        const imageSize = capture.image.getSize();
        const viewport = payload.viewport || capture.display.size;
        const rect = payload.rect || {};
        const crop = {
          x: Math.max(0, Math.round(Number(rect.x) * imageSize.width / Math.max(1, Number(viewport.width)))),
          y: Math.max(0, Math.round(Number(rect.y) * imageSize.height / Math.max(1, Number(viewport.height)))),
          width: Math.max(1, Math.round(Number(rect.width) * imageSize.width / Math.max(1, Number(viewport.width)))),
          height: Math.max(1, Math.round(Number(rect.height) * imageSize.height / Math.max(1, Number(viewport.height))))
        };
        crop.width = Math.min(crop.width, imageSize.width - crop.x);
        crop.height = Math.min(crop.height, imageSize.height - crop.y);
        const directory = path.join(app.getPath('temp'), 'messs-chat-captures');
        await fs.promises.mkdir(directory, { recursive: true });
        const temporaryPath = path.join(directory, `screenshot-${Date.now()}-${crypto.randomUUID()}.png`);
        await fs.promises.writeFile(temporaryPath, capture.image.crop(crop).toPNG());
        resolve({ ok: true, draft: await createChatAttachmentDraft(temporaryPath, { temporary: true, forceImage: true, name: 'Screenshot.png' }) });
      } catch (error) {
        resolve({ ok: false, reason: error.code || 'capture-failed', message: error.message });
      }
    };
    ipcMain.on(channel, (event, payload) => {
      const index = overlays.findIndex((window) => !window.isDestroyed() && window.webContents === event.sender);
      finish({ ...(payload || {}), index });
    });
    captures.forEach((capture) => {
      const overlay = new BrowserWindow({
        x: capture.display.bounds.x, y: capture.display.bounds.y,
        width: capture.display.bounds.width, height: capture.display.bounds.height,
        frame: false, transparent: false, resizable: false, movable: false,
        alwaysOnTop: true, skipTaskbar: true, fullscreenable: false,
        webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false }
      });
      overlay.setAlwaysOnTop(true, 'screen-saver');
      overlay.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(screenshotOverlayHtml(capture.image.toDataURL(), channel))}`);
      overlay.on('closed', () => { if (!settled && overlays.every((window) => window.isDestroyed())) finish({ type: 'cancel' }); });
      overlays.push(overlay);
    });
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
    overlays[0].focus();
  });
}

function chatScreenshotLanguage() {
  return {
    magnifier_position_label: localizedMessage('Position', '位置', '위치'),
    operation_ok_title: localizedMessage('Add to chat', '添加到聊天', '채팅에 추가'),
    operation_cancel_title: localizedMessage('Cancel', '取消', '취소'),
    operation_save_title: localizedMessage('Save', '保存', '저장'),
    operation_redo_title: localizedMessage('Redo', '重做', '다시 실행'),
    operation_undo_title: localizedMessage('Undo', '撤销', '실행 취소'),
    operation_mosaic_title: localizedMessage('Mosaic', '马赛克', '모자이크'),
    operation_text_title: localizedMessage('Text', '文字', '텍스트'),
    operation_brush_title: localizedMessage('Brush', '画笔', '브러시'),
    operation_arrow_title: localizedMessage('Arrow', '箭头', '화살표'),
    operation_ellipse_title: localizedMessage('Ellipse', '椭圆', '타원'),
    operation_rectangle_title: localizedMessage('Rectangle', '矩形', '사각형')
  };
}

function installChatScreenshotPresentation(tool) {
  const view = tool && tool.$view;
  if (!view || !view.webContents || chatScreenshotPresentationViews.has(view.webContents)) return;
  chatScreenshotPresentationViews.add(view.webContents);
  let cssPromise = null;
  let applied = false;
  const apply = () => {
    if (applied || cssPromise) return;
    cssPromise = fs.promises.readFile(CHAT_SCREENSHOT_THEME_PATH, 'utf8')
      .then((css) => view.webContents.executeJavaScript(`(() => {
        const style = document.createElement('style');
        style.dataset.messsScreenshotTheme = 'true';
        style.textContent = ${JSON.stringify(css)};
        (document.head || document.documentElement).appendChild(style);
        return true;
      })()`))
      .then(() => view.webContents.executeJavaScript(CHAT_SCREENSHOT_POLISH_SCRIPT))
      .then(() => { applied = true; })
      .catch((error) => {
        cssPromise = null;
        console.warn('The screenshot editor theme could not be applied:', error && error.message || error);
      });
  };
  view.webContents.on('did-finish-load', apply);
  return apply;
}

function getChatScreenshotTool() {
  if (!ElectronScreenshots) return null;
  if (!chatScreenshotTool) {
    try {
      chatScreenshotTool = new ElectronScreenshots({
        singleWindow: true,
        lang: chatScreenshotLanguage(),
        logger: () => {}
      });
      const applyScreenshotPresentation = installChatScreenshotPresentation(chatScreenshotTool);
      chatScreenshotTool.on('windowCreated', (window) => {
        if (!window || window.isDestroyed()) return;
        if (applyScreenshotPresentation) setTimeout(applyScreenshotPresentation, 160);
        window.setAlwaysOnTop(true, 'screen-saver');
      });
    } catch (error) {
      console.warn('The native screenshot tool could not initialize:', error && error.message || error);
      chatScreenshotTool = null;
    }
  }
  return chatScreenshotTool;
}

async function createChatScreenshotDraftFromBuffer(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  if (buffer.length < 32 || buffer.length > 50 * 1024 * 1024) {
    const error = new Error('The captured image is empty or too large.');
    error.code = 'capture-invalid-image';
    throw error;
  }
  const pngSignature = buffer.subarray(0, 8).toString('hex');
  if (pngSignature !== '89504e470d0a1a0a') {
    const error = new Error('The screenshot tool returned an invalid PNG image.');
    error.code = 'capture-invalid-image';
    throw error;
  }
  const directory = path.join(app.getPath('temp'), 'messs-chat-captures');
  await fs.promises.mkdir(directory, { recursive: true });
  const temporaryPath = path.join(directory, `screenshot-${Date.now()}-${crypto.randomUUID()}.png`);
  await fs.promises.writeFile(temporaryPath, buffer);
  try {
    return await createChatAttachmentDraft(temporaryPath, {
      temporary: true,
      forceImage: true,
      name: 'Screenshot.png'
    });
  } catch (error) {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function captureChatScreenshotWithNativeTool() {
  const tool = getChatScreenshotTool();
  if (!tool) return { ok: false, reason: 'capture-backend-unavailable' };
  // Language refresh is best-effort. Waiting for the screenshot BrowserView
  // here would leave the chat button disabled forever if that view cannot load.
  void Promise.resolve().then(() => tool.setLang(chatScreenshotLanguage())).catch(() => {});
  return new Promise((resolve) => {
    let settled = false;
    let startFailureInFlight = false;
    let startTimeout = null;
    const cleanup = () => {
      if (startTimeout) clearTimeout(startTimeout);
      startTimeout = null;
      tool.removeListener('ok', onOk);
      tool.removeListener('cancel', onCancel);
    };
    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const onOk = (_event, buffer) => {
      void createChatScreenshotDraftFromBuffer(buffer)
        .then((draft) => finish({ ok: true, draft }))
        .catch((error) => finish({ ok: false, reason: error.code || 'capture-failed', message: error.message }));
    };
    const onCancel = () => finish({ ok: false, reason: 'cancelled' });
    tool.once('ok', onOk);
    tool.once('cancel', onCancel);
    const failStart = async (error) => {
      if (settled || startFailureInFlight) return;
      startFailureInFlight = true;
      await tool.endCapture().catch(() => {});
      finish({ ok: false, reason: 'capture-backend-failed', message: error.message });
    };
    startTimeout = setTimeout(() => {
      const error = new Error('The native screenshot tool did not start in time.');
      error.code = 'capture-start-timeout';
      void failStart(error);
    }, CHAT_SCREENSHOT_START_TIMEOUT_MS);
    Promise.resolve().then(() => tool.startCapture()).then(() => {
      if (settled) {
        void tool.endCapture().catch(() => {});
        return;
      }
      if (startTimeout) clearTimeout(startTimeout);
      startTimeout = null;
    }).catch(failStart);
  });
}

async function captureChatScreenshotDraft() {
  if (chatScreenshotInFlight) {
    return { ok: false, reason: 'capture-busy', message: 'A screenshot is already in progress.' };
  }
  const operation = (async () => {
    const nativeResult = await captureChatScreenshotWithNativeTool();
    if (nativeResult.ok || nativeResult.reason === 'cancelled') return nativeResult;
    // Keep the Electron desktopCapturer path as a compatibility fallback for
    // systems where the optional native monitor module cannot initialize.
    return captureChatScreenshotDraftLegacy();
  })();
  chatScreenshotInFlight = operation;
  try {
    return await operation;
  } finally {
    if (chatScreenshotInFlight === operation) chatScreenshotInFlight = null;
  }
}

function registerIpcHandlers() {
  ipcMain.on('window:readyForInteraction', (event) => {
    const targetWindow = rendererWindowForEvent(event);
    if (!targetWindow || targetWindow.isDestroyed()) return;
    if (targetWindow === mainWindow) revealMainWindow();
    else revealRendererWindow(targetWindow);
  });

  ipcMain.on('window:syncThemeSurface', (event, theme) => {
    const targetWindow = rendererWindowForEvent(event);
    if (!targetWindow || targetWindow.isDestroyed()) return;
    if (targetWindow === mainWindow) setWindowBackgroundColor(theme);
    else targetWindow.setBackgroundColor(WINDOW_BACKGROUND_COLORS[normalizeTheme(theme)]);
  });

  ipcMain.on('canvas:beginDetachDrag', (event, canvasId) => {
    startCanvasDetachDragWatch(event, canvasId);
  });

  ipcMain.on('canvas:cancelDetachDrag', (event) => {
    stopCanvasDetachDragWatch(event.sender.id);
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
      textSize: normalizeTextSize(store.data.settings.textSize),
      colorManagement: currentColorManagementState(),
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
      butlerTasks: persistedButlerTasksForRenderer(),
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

  ipcMain.handle('settings:setTextSize', (_evt, size) => {
    const normalized = normalizeTextSize(size);
    store.data.settings.textSize = normalized;
    store.scheduleSave();
    return normalized;
  });

  ipcMain.handle('settings:setColorProfile', async (_evt, profile) => {
    const normalized = normalizeColorProfile(profile);
    await writeColorProfileBootstrap(colorProfileBootstrapFile, normalized);
    store.data.settings.colorProfile = normalized;
    store.scheduleSave();
    return currentColorManagementState();
  });

  ipcMain.handle('settings:restartForColorProfile', () => {
    const selectedProfile = normalizeColorProfile(store.data.settings.colorProfile);
    writeColorProfileBootstrapSync(colorProfileBootstrapFile, selectedProfile);
    store.flushSync();
    if (chatService) chatService.flushLocal();
    isQuitting = true;
    app.relaunch();
    setTimeout(() => app.exit(0), 50);
    return { ok: true };
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

  ipcMain.handle('canvas-agent:getHistory', () => ({
    ok: true,
    sessions: sanitizeCanvasAgentHistory(store.data.canvasAgentHistory)
  }));

  ipcMain.handle('canvas-agent:saveHistory', (_evt, sessions) => {
    const normalized = sanitizeCanvasAgentHistory(sessions);
    store.data.canvasAgentHistory = normalized;
    store.scheduleSave();
    return { ok: true, sessions: normalized };
  });

  ipcMain.handle('ai-assistant:getHistory', () => ({
    ok: true,
    sessions: sanitizeAiAssistantHistory(store.data.aiAssistantHistory)
  }));

  ipcMain.handle('ai-assistant:saveHistory', (_evt, sessions) => {
    const normalized = sanitizeAiAssistantHistory(sessions);
    store.data.aiAssistantHistory = normalized;
    store.scheduleSave();
    return { ok: true, sessions: normalized };
  });

  ipcMain.handle('canvas:getCreditUsage', (_evt, canvasId) => canvasCreditUsage(canvasId));

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
      await syncGatewayAccount({ force: true });
    }
    broadcastRendererEvent('auth:sessionChanged', session);
    return session;
  });

  ipcMain.handle('auth:signUp', async (_evt, credentials = {}) => {
    const session = await supabaseAuth.signUp(credentials.email, credentials.password);
    if (session && session.authenticated) {
      clearGatewayAccount();
      gatewayCatalogCache = null;
      await syncGatewayAccount({ force: true });
    }
    broadcastRendererEvent('auth:sessionChanged', session);
    return session;
  });

  ipcMain.handle('auth:signInWithGoogle', async () => {
    const session = await signInWithGoogle();
    if (session && session.authenticated) {
      clearGatewayAccount();
      gatewayCatalogCache = null;
      await syncGatewayAccount({ force: true });
    }
    broadcastRendererEvent('auth:sessionChanged', session);
    return session;
  });

  ipcMain.handle('auth:requestPasswordReset', async (_evt, email) => {
    return supabaseAuth.requestPasswordReset(email);
  });

  ipcMain.handle('auth:signOut', async () => {
    const session = await supabaseAuth.signOut();
    if (chatService) await chatService.signOut();
    clearGatewayAccount();
    gatewayCatalogCache = null;
    broadcastRendererEvent('auth:sessionChanged', session);
    return session;
  });

  ipcMain.handle('workshop:list', async () => {
    try {
      return await listWorkshopPosts();
    } catch (error) {
      return {
        ok: false,
        reason: error && error.code || 'workshop-cloud-unavailable',
        message: error && error.message || 'Workshop cloud sharing is unavailable.'
      };
    }
  });

  ipcMain.handle('workshop:publish', async (_evt, fileId, metadata = {}) => {
    try {
      return await publishWorkshopPost(fileId, metadata);
    } catch (error) {
      return {
        ok: false,
        reason: error && error.code || 'workshop-publish-failed',
        message: error && error.message || 'The Workshop post could not be published.'
      };
    }
  });

  ipcMain.handle('workshop:incrementClick', async (_evt, postId) => {
    try {
      return await incrementWorkshopClick(postId);
    } catch (error) {
      return {
        ok: false,
        reason: error && error.code || 'workshop-click-failed',
        message: error && error.message || 'The Workshop view could not be recorded.'
      };
    }
  });

  ipcMain.handle('workshop:toggleLike', async (_evt, postId) => {
    try {
      return await toggleWorkshopLike(postId);
    } catch (error) {
      return {
        ok: false,
        reason: error && error.code || 'workshop-like-failed',
        message: error && error.message || 'The Workshop like could not be saved.'
      };
    }
  });

  ipcMain.handle('workshop:importMedia', async (_evt, postId, folderId, canvasId) => {
    try {
      return await importWorkshopPostMedia(postId, folderId, canvasId);
    } catch (error) {
      return {
        ok: false,
        reason: error && error.code || 'workshop-import-failed',
        message: error && error.message || 'The Workshop media could not be imported.'
      };
    }
  });

  ipcMain.handle('workshop:delete', async (_evt, postId) => {
    try {
      return await deleteWorkshopPost(postId);
    } catch (error) {
      return {
        ok: false,
        reason: error && error.code || 'workshop-delete-failed',
        message: error && error.message || 'The Workshop work could not be deleted.'
      };
    }
  });

  ipcMain.handle('chat:initialize', () => chatService.initialize());

  ipcMain.handle('chat:sync', () => chatService.sync());

  ipcMain.handle('chat:searchUser', (_evt, query) => chatService.searchUser(query));

  ipcMain.handle('chat:sendFriendRequest', (_evt, targetId) => chatService.sendFriendRequest(targetId));

  ipcMain.handle('chat:respondFriendRequest', (_evt, requestId, action) => {
    return chatService.respondFriendRequest(requestId, action);
  });

  ipcMain.handle('chat:startConversation', (_evt, friendId) => chatService.startConversation(friendId));

  ipcMain.handle('chat:createGroup', (_evt, name, memberIds) => chatService.createGroup(name, memberIds));

  ipcMain.handle('chat:addGroupMembers', (_evt, conversationId, memberIds) => {
    return chatService.addGroupMembers(conversationId, memberIds);
  });

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

  ipcMain.handle('chat:captureScreenshotDraft', () => captureChatScreenshotDraft());

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

  ipcMain.handle('membership:quoteMedia', (_evt, request = {}) => quoteMediaCreditsForAccount(request));

  ipcMain.handle('profile:getAvatar', () => readProfileAvatarDataUrl());

  ipcMain.handle('profile:chooseAvatar', () => chooseProfileAvatar());

  ipcMain.handle('settings:getLibraryPaths', () => {
    const defaultPath = path.resolve(getDefaultLibraryRoot());
    const currentPath = path.resolve(store.dir);
    const samePath = process.platform === 'win32'
      ? currentPath.toLowerCase() === defaultPath.toLowerCase()
      : currentPath === defaultPath;
    return {
      defaultPath,
      currentPath,
      isDefault: samePath,
      customPath: store.data.settings.customLibraryPath
    };
  });

  ipcMain.handle('settings:pickLibraryPath', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: localizedMessage('Choose asset storage location', '选择资产存放位置', '자산 저장 위치'),
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return relocateLibraryStore(result.filePaths[0]);
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
        await requireGatewayProvider('chat', String(request.providerId || DEFAULT_CHAT_PROVIDER_ID));
        return { ok: true, ...(await aiGateway.discoverModels(String(request.providerId || DEFAULT_CHAT_PROVIDER_ID))) };
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
      : (configuredChatProviders[0] ? configuredChatProviders[0].id : DEFAULT_CHAT_PROVIDER_ID);
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

  ipcMain.handle('window:minimize', (event) => {
    const targetWindow = rendererWindowForEvent(event);
    if (targetWindow) targetWindow.minimize();
    return true;
  });

  ipcMain.handle('window:toggleMaximize', (event) => {
    const targetWindow = rendererWindowForEvent(event);
    if (!targetWindow) return false;
    if (targetWindow.isMaximized()) targetWindow.unmaximize();
    else targetWindow.maximize();
    return targetWindow.isMaximized();
  });

  ipcMain.handle('window:close', (event) => {
    const targetWindow = rendererWindowForEvent(event);
    if (targetWindow) targetWindow.close();
    return true;
  });

  ipcMain.handle('window:isMaximized', (event) => {
    const targetWindow = rendererWindowForEvent(event);
    return targetWindow ? targetWindow.isMaximized() : false;
  });

  ipcMain.handle('dialog:pickFiles', async (event) => {
    const result = await dialog.showOpenDialog(rendererWindowForEvent(event), {
      properties: ['openFile', 'multiSelections']
    });
    if (result.canceled) return [];
    return result.filePaths;
  });

  ipcMain.handle('files:pickAndPrepareAiAttachments', async (event, folderId, canvasId) => {
    const ownerWindow = rendererWindowForEvent(event);
    const result = await dialog.showOpenDialog(ownerWindow, {
      title: 'Add files to AI',
      properties: ['openFile', 'multiSelections']
    });
    if (result.canceled) return { canceled: true, imported: [], attachments: [], failed: [] };

    const importedResult = await importFilePaths(
      result.filePaths,
      folderId && folderId !== 'default' ? folderId : null,
      canvasId || null,
      {},
      ownerWindow
    );
    const attachments = [];
    const failed = [...(importedResult.failed || [])];
    for (const file of importedResult.imported || []) {
      try {
        const attachment = await fileToAiChatAttachment(file.id);
        if (attachment) attachments.push(publicAiAttachment(attachment));
        else failed.push(fileImportFailure(file.name, Object.assign(new Error('The attachment could not be read.'), { code: 'attachment-read-failed' }), 'prepare'));
      } catch (error) {
        failed.push(fileImportFailure(file.name, error, 'prepare'));
      }
    }
    return {
      canceled: false,
      imported: importedResult.imported || [],
      attachments,
      unlocked: importedResult.unlocked || [],
      failed
    };
  });

  ipcMain.handle('ai:preparePastedImage', async (_evt, request = {}) => {
    const match = /^data:image\/(?:png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/i.exec(String(request.dataUrl || ''));
    if (!match) throw Object.assign(new Error('The pasted image format is not supported.'), { code: 'invalid-attachment' });
    const dataUrl = await sanitizeImageForAi(Buffer.from(match[1], 'base64'));
    const token = crypto.randomUUID();
    transientAiAttachments.set(token, {
      dataUrl,
      name: String(request.name || 'Pasted image').slice(0, 160),
      mimeType: String(dataUrl.match(/^data:([^;]+)/i)?.[1] || 'image/webp'),
      sizeBytes: Math.ceil(dataUrl.length * 0.75),
      expiresAt: Date.now() + 30 * 60_000
    });
    return { token, dataUrl, name: String(request.name || 'Pasted image').slice(0, 160) };
  });

  ipcMain.handle('chat:pickImageDraft', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Attach images', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'tif', 'tiff', 'bmp'] }]
    });
    if (result.canceled) return { ok: false, reason: 'cancelled' };
    try {
      const drafts = await Promise.all(result.filePaths.slice(0, 10).map((filePath) => createChatAttachmentDraft(filePath, { forceImage: true })));
      return { ok: true, drafts };
    } catch (error) {
      return { ok: false, reason: error.code || 'attachment-failed', message: error.message };
    }
  });

  ipcMain.handle('chat:pickFileDraft', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Attach files', properties: ['openFile', 'multiSelections'] });
    if (result.canceled) return { ok: false, reason: 'cancelled' };
    try {
      const drafts = await Promise.all(result.filePaths.slice(0, 10).map((filePath) => createChatAttachmentDraft(filePath)));
      return { ok: true, drafts };
    } catch (error) {
      return { ok: false, reason: error.code || 'attachment-failed', message: error.message };
    }
  });

  ipcMain.handle('chat:createBoardAttachmentDrafts', async (_evt, fileIds) => {
    cleanupExpiredChatDrafts();
    const ids = [...new Set((Array.isArray(fileIds) ? fileIds : [])
      .map((id) => String(id || '').trim())
      .filter((id) => /^[A-Za-z0-9_-]{1,128}$/.test(id)))].slice(0, 10);
    if (!ids.length) return { ok: false, reason: 'no-media', message: 'Select an image or video on the canvas first.' };
    const drafts = [];
    try {
      for (const id of ids) {
        const file = store.getFile(id);
        const extension = String(file && (file.ext || path.extname(file.name)) || '').toLowerCase();
        const isImage = preview.isImageExt(extension);
        const isVideo = preview.isVideoExt(extension);
        if (!file || !file.storedPath || (!isImage && !isVideo)) continue;
        assertSafeLocalFile(file);
        if (!fs.existsSync(file.storedPath)) continue;
        drafts.push(await createChatAttachmentDraft(file.storedPath, {
          forceImage: isImage,
          name: file.name
        }));
      }
    } catch (error) {
      await Promise.all(drafts.map((draft) => discardChatAttachmentDraft(draft.token).catch(() => false)));
      return { ok: false, reason: error.code || 'attachment-failed', message: error.message };
    }
    if (!drafts.length) return { ok: false, reason: 'no-media', message: 'The selected canvas items are not available as images or videos.' };
    return { ok: true, drafts };
  });

  ipcMain.handle('chat:readClipboardDrafts', async () => {
    cleanupExpiredChatDrafts();
    try {
      const nativePaths = process.platform === 'win32' ? parseCfHDrop(clipboard.readBuffer('CF_HDROP')) : [];
      const validPaths = nativePaths.filter((filePath) => fs.existsSync(filePath)).slice(0, 10);
      if (validPaths.length) {
        return { ok: true, drafts: await Promise.all(validPaths.map((filePath) => createChatAttachmentDraft(filePath))) };
      }
      const image = clipboard.readImage();
      if (image && !image.isEmpty()) {
        const directory = path.join(app.getPath('temp'), 'messs-chat-clipboard');
        await fs.promises.mkdir(directory, { recursive: true });
        const temporaryPath = path.join(directory, `clipboard-${Date.now()}-${crypto.randomUUID()}.png`);
        await fs.promises.writeFile(temporaryPath, image.toPNG());
        const draft = await createChatAttachmentDraft(temporaryPath, { temporary: true, forceImage: true, name: 'Clipboard image.png' });
        return { ok: true, drafts: [draft] };
      }
      return { ok: false, reason: 'clipboard-empty' };
    } catch (error) {
      return { ok: false, reason: error.code || 'clipboard-failed', message: error.message };
    }
  });

  ipcMain.handle('chat:discardAttachmentDraft', (_evt, token) => discardChatAttachmentDraft(token));

  ipcMain.handle('chat:sendAttachmentDraft', async (_evt, conversationId, token) => {
    cleanupExpiredChatDrafts();
    const draft = chatAttachmentDrafts.get(String(token || ''));
    if (!draft) return { ok: false, reason: 'draft-expired', message: 'This attachment is no longer available. Add it again.' };
    try {
      const result = draft.kind === 'image'
        ? await chatService.sendImage(conversationId, draft.path)
        : await chatService.sendFile(conversationId, draft.path);
      if (result && result.ok) await discardChatAttachmentDraft(draft.token);
      return result;
    } catch (error) {
      return { ok: false, reason: error.code || 'attachment-send-failed', message: error.message };
    }
  });

  ipcMain.handle('clipboard:importImage', async (_evt, request = {}) => {
    const nativeFilePaths = process.platform === 'win32'
      ? parseCfHDrop(clipboard.readBuffer('CF_HDROP'))
      : [];
    const nativeClipboardHtml = safeClipboardRead('readHTML');
    const nativeClipboardText = [safeClipboardRead('readText'), readClipboardFileUrlText()]
      .filter(Boolean)
      .join('\n');
    const sources = extractClipboardImageSources({
      html: String(request.html || '') || nativeClipboardHtml,
      text: [String(request.text || ''), nativeClipboardText].filter(Boolean).join('\n')
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

    const nativeBuffer = readClipboardNativeImageBuffer();
    if (nativeBuffer) {
      const canonical = await canonicalClipboardPng(nativeBuffer);
      return importClipboardPng(canonical.png, request, canonical.dimensions);
    }

    try {
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
    } catch (error) {
      // Some macOS clipboard providers expose HTML/PNG without a nativeImage.
      // Continue with the HTML and URL sources below instead of failing paste.
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

  ipcMain.handle('clipboard:signature', () => clipboardSignature());

  ipcMain.handle('dialog:pickFolderToImport', async (event, canvasId) => {
    const result = await dialog.showOpenDialog(rendererWindowForEvent(event), {
      properties: ['openDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return importDirectoryPathAndNotify(result.filePaths[0], null, canvasId);
  });

  ipcMain.handle('folders:importDirectory', (_evt, dirPath, parentFolderId, canvasId) => {
    return importDirectoryPathAndNotify(dirPath, parentFolderId || null, canvasId);
  });

  ipcMain.handle('files:import', async (event, filePaths, folderId, canvasId, options = {}) => {
    return importFilePaths(filePaths, folderId, canvasId, options, rendererWindowForEvent(event));
  });

  ipcMain.handle('files:recoverDroppedImport', async (event, folderId, canvasId) => {
    const ownerWindow = rendererWindowForEvent(event);
    const result = await dialog.showOpenDialog(ownerWindow, {
      title: 'Allow Messs to import the selected file',
      properties: ['openFile', 'multiSelections']
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true, imported: [], unlocked: [], failed: [] };
    return importFilePaths(result.filePaths, folderId, canvasId, { recoverAccess: false }, ownerWindow);
  });

  ipcMain.handle('files:beginDroppedImport', beginDroppedFileImport);
  ipcMain.handle('files:appendDroppedImport', appendDroppedFileChunk);
  ipcMain.handle('files:finishDroppedImport', finishDroppedFileImport);
  ipcMain.handle('files:abortDroppedImport', abortDroppedFileImport);

  ipcMain.handle('butler:confirmDelivery', async (_evt, deliveryToken) => {
    try {
      return await settleButlerDeliveryToken(deliveryToken, true);
    } catch (error) {
      const failure = butlerFailure(error, 'The Butler result could not be charged safely.');
      console.error('Butler delivery confirmation failed:', failure.reason);
      return failure;
    }
  });

  ipcMain.handle('butler:releaseDelivery', async (_evt, deliveryToken) => {
    try {
      return await settleButlerDeliveryToken(deliveryToken, false);
    } catch (error) {
      const failure = butlerFailure(error, 'The unused Butler reservation could not be released safely.');
      console.error('Butler delivery release failed:', failure.reason);
      return failure;
    }
  });

  ipcMain.handle('ai:confirmMediaDelivery', async (_evt, deliveryToken) => {
    try {
      return await settleAiMediaDeliveryToken(deliveryToken, true);
    } catch (error) {
      return {
        ok: false,
        reason: error.code || 'ai-delivery-confirmation-failed',
        message: error.message || 'The generated media could not be confirmed safely.'
      };
    }
  });

  ipcMain.handle('ai:releaseMediaDelivery', async (_evt, deliveryToken) => {
    try {
      return await settleAiMediaDeliveryToken(deliveryToken, false);
    } catch (error) {
      return {
        ok: false,
        reason: error.code || 'ai-delivery-release-failed',
        message: error.message || 'The generated media reservation could not be released safely.'
      };
    }
  });

  ipcMain.handle('butler:removeBackground', async (_evt, fileId, requestedOptions = {}) => {
    let responseBuffer = null;
    let record = null;
    try {
      if (!aiGateway || !aiGateway.isConfigured()) {
        const error = new Error('Butler is not configured.');
        error.code = 'gateway-not-configured';
        throw error;
      }
      const options = normalizeButlerBackgroundOptions(requestedOptions);
      const source = await butlerSourceImage(fileId);
      responseBuffer = await aiGateway.removeBackground(source.imageDataUrl, options);
      const pngBuffer = await sanitizeButlerBackgroundPng(responseBuffer);
      record = await addButlerOutputFile(pngBuffer, source.file, 'remove-background', {
        modelId: 'background-remove',
        ...butlerOutputAccounting(responseBuffer, BUTLER_IMAGE_TOOL_CREDITS['background-remove'])
      });
      const deliveryToken = await registerButlerDelivery([responseBuffer], [record]);
      if (!deliveryToken && runtimeConfig.gatewayConfigured) await syncGatewayAccount({ force: true });
      return { ok: true, file: butlerFilePayload(record, deliveryToken) };
    } catch (error) {
      if (record) await rollbackGeneratedMediaFile(record);
      await releaseButlerBufferDeliveries([responseBuffer]);
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
      const modelId = 'seededit-v3';
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

  ipcMain.handle('butler:image-expand', async (_evt, fileId, requestedOptions = {}) => {
    let responseBuffer = null;
    let record = null;
    try {
      if (!aiGateway || !aiGateway.isConfigured()) {
        const error = new Error('Butler is not configured.');
        error.code = 'gateway-not-configured';
        throw error;
      }
      const modelId = normalizeButlerImageTool(requestedOptions && requestedOptions.modelId || 'clipdrop-uncrop');
      const options = normalizeButlerImageOptions(modelId, requestedOptions);
      const source = await butlerSourceImage(fileId);
      if (modelId === 'kling-image-expand') {
        const payload = await aiGateway.runImageTool(source.imageDataUrl, modelId, options);
        const taskToken = normalizeButlerTaskToken(payload && payload.taskToken);
        const status = normalizeButlerImageStatus(payload || { status: 'queued' });
        rememberButlerImageTask(taskToken, {
          sourceFileId: source.file.id,
          modelId,
          operation: 'image-expand',
          resultCount: status.resultCount,
          credits: status.credits !== undefined ? status.credits : BUTLER_IMAGE_TOOL_CREDITS[modelId],
          status: status.status
        });
        return { ok: true, taskToken, ...status };
      }
      responseBuffer = await aiGateway.expandImage(source.imageDataUrl, options);
      const pngBuffer = await sanitizeButlerImagePng(responseBuffer);
      record = await addButlerOutputFile(pngBuffer, source.file, 'image-expand', {
        modelId,
        ...butlerOutputAccounting(responseBuffer, BUTLER_IMAGE_TOOL_CREDITS[modelId])
      });
      const deliveryToken = await registerButlerDelivery([responseBuffer], [record]);
      if (!deliveryToken && runtimeConfig.gatewayConfigured) await syncGatewayAccount({ force: true });
      return { ok: true, file: butlerFilePayload(record, deliveryToken) };
    } catch (error) {
      if (record) await rollbackGeneratedMediaFile(record);
      await releaseButlerBufferDeliveries([responseBuffer]);
      const failure = butlerFailure(error, 'The image expansion task could not be started.');
      console.error('Butler image expansion failed:', failure.reason);
      return failure;
    }
  });

  ipcMain.handle('butler:image-upscale', async (_evt, fileId) => {
    let responseBuffer = null;
    let record = null;
    try {
      if (!aiGateway || !aiGateway.isConfigured()) {
        const error = new Error('Butler is not configured.');
        error.code = 'gateway-not-configured';
        throw error;
      }
      const modelId = 'clipdrop-upscale';
      const source = await butlerSourceImage(fileId);
      responseBuffer = await aiGateway.upscaleImage(source.imageDataUrl);
      const pngBuffer = await sanitizeButlerImagePng(responseBuffer);
      record = await addButlerOutputFile(pngBuffer, source.file, 'image-upscale', {
        modelId,
        ...butlerOutputAccounting(responseBuffer, BUTLER_IMAGE_TOOL_CREDITS[modelId])
      });
      const deliveryToken = await registerButlerDelivery([responseBuffer], [record]);
      if (!deliveryToken && runtimeConfig.gatewayConfigured) await syncGatewayAccount({ force: true });
      return { ok: true, file: butlerFilePayload(record, deliveryToken) };
    } catch (error) {
      if (record) await rollbackGeneratedMediaFile(record);
      await releaseButlerBufferDeliveries([responseBuffer]);
      const failure = butlerFailure(error, 'Image enhancement failed.');
      console.error('Butler image enhancement failed:', failure.reason);
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
      const failure = butlerFailure(error, 'The image enhancement task could not be started.');
      console.error('Butler Topaz image task failed:', failure.reason);
      return failure;
    }
  });

  ipcMain.handle('butler:image-erase', async (_evt, fileId, requestedOptions = {}) => {
    let responseBuffer = null;
    let record = null;
    try {
      if (!aiGateway || !aiGateway.isConfigured()) {
        const error = new Error('Butler is not configured.');
        error.code = 'gateway-not-configured';
        throw error;
      }
      const modelId = 'cleanup';
      const options = normalizeButlerImageOptions(modelId, requestedOptions);
      const [source, mask] = await Promise.all([
        butlerSourceImage(fileId),
        sanitizeButlerMaskDataUrl(options.maskDataUrl)
      ]);
      responseBuffer = await aiGateway.eraseObject(source.imageDataUrl, mask.dataUrl, {
        maskWidth: mask.width,
        maskHeight: mask.height
      });
      const pngBuffer = await sanitizeButlerImagePng(responseBuffer);
      record = await addButlerOutputFile(pngBuffer, source.file, 'image-erase', {
        modelId,
        ...butlerOutputAccounting(responseBuffer, BUTLER_IMAGE_TOOL_CREDITS[modelId])
      });
      const deliveryToken = await registerButlerDelivery([responseBuffer], [record]);
      if (!deliveryToken && runtimeConfig.gatewayConfigured) await syncGatewayAccount({ force: true });
      return { ok: true, file: butlerFilePayload(record, deliveryToken) };
    } catch (error) {
      await releaseButlerBufferDeliveries([responseBuffer]);
      if (record) await rollbackGeneratedMediaFile(record);
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
      const existing = butlerImageTasks.get(taskToken) || persistedButlerTask('image', taskToken) || {};
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
        return {
          ok: true,
          files: existingFiles.map((record) => butlerFilePayload(record, task.deliveryToken))
        };
      }
      if (butlerImageDownloads.has(taskToken)) return await butlerImageDownloads.get(taskToken);

      const download = (async () => {
        const resultCount = Math.max(1, Math.min(8, Math.round(Number(task.resultCount) || 1)));
        const buffers = await aiGateway.downloadImageToolResult(taskToken, modelId, resultCount);
        const currentTask = butlerImageTasks.get(taskToken) || persistedButlerTask('image', taskToken) || task;
        const sourceFile = store.getFile(currentTask.sourceFileId) || {
          id: null,
          name: 'Processed image',
          folderId: null,
          canvasId: store.data.canvases[0] && store.data.canvases[0].id
        };
        const operation = currentTask.operation
          || (['clipdrop-uncrop', 'kling-image-expand'].includes(modelId)
            ? 'image-expand'
            : modelId === 'qwen-image-layered' ? 'image-layer' : 'image-edit');
        const records = [];
        let deliveryToken = null;
        try {
          for (const buffer of buffers) {
            const pngBuffer = await sanitizeButlerImagePng(buffer);
            records.push(await addButlerOutputFile(pngBuffer, sourceFile, operation, {
              modelId,
              ...butlerOutputAccounting(
                buffer,
                currentTask.creditsCharged !== undefined ? currentTask.creditsCharged : currentTask.credits
              )
            }));
          }
          deliveryToken = await registerButlerDelivery(buffers, records);
        } catch (error) {
          await Promise.all(records.map((record) => rollbackGeneratedMediaFile(record)));
          await releaseButlerBufferDeliveries(buffers);
          throw error;
        }
        rememberButlerImageTask(taskToken, {
          ...currentTask,
          modelId,
          downloadedFileIds: records.map((record) => record.id),
          ...(deliveryToken ? { deliveryToken } : {}),
          status: 'succeeded'
        });
        if (!deliveryToken && runtimeConfig.gatewayConfigured) await syncGatewayAccount({ force: true });
        return {
          ok: true,
          files: records.map((record) => butlerFilePayload(record, deliveryToken))
        };
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
      const sourcePrompt = storedPrompt ? storedPrompt.slice(0, 1024) : fallbackPrompt;
      const effectivePrompt = options.prompt || sourcePrompt;
      assertPromptHasNoSecrets(effectivePrompt);
      const taskOptions = { ...options, prompt: effectivePrompt };
      const payload = await aiGateway.create3d(providerId, source.imageDataUrl, effectivePrompt, taskOptions);
      const taskToken = normalizeButlerTaskToken(payload && payload.taskToken);
      const status = normalizeButler3dStatus({ status: 'queued', ...(payload || {}) });
      rememberButler3dTask(taskToken, {
        sourceFileId: source.file.id,
        providerId,
        options: taskOptions,
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
      const existing = butler3dTasks.get(taskToken) || persistedButlerTask('3d', taskToken) || null;
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
      const task = butler3dTasks.get(taskToken) || persistedButlerTask('3d', taskToken) || {};
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
        if (existingFile) {
          return { ok: true, file: butlerFilePayload(existingFile, task.deliveryToken) };
        }
      }
      if (butler3dDownloads.has(taskToken)) return await butler3dDownloads.get(taskToken);

      const download = (async () => {
        const buffer = await aiGateway.download3d(taskToken);
        assertValidGlbBuffer(buffer);
        const currentTask = butler3dTasks.get(taskToken) || persistedButlerTask('3d', taskToken) || task;
        const sourceFile = store.getFile(currentTask.sourceFileId) || {
          id: null,
          name: 'Generated model',
          folderId: null,
          canvasId: store.data.canvases[0] && store.data.canvases[0].id
        };
        let record = null;
        let deliveryToken = null;
        try {
          record = await addButlerOutputFile(buffer, sourceFile, 'generate-3d', {
            modelId: currentTask.providerId,
            pricingOptions: currentTask.options,
            ...butlerOutputAccounting(
              buffer,
              currentTask.creditsCharged !== undefined ? currentTask.creditsCharged : currentTask.credits
            )
          });
          deliveryToken = await registerButlerDelivery([buffer], [record]);
        } catch (error) {
          if (record) await rollbackGeneratedMediaFile(record);
          await releaseButlerBufferDeliveries([buffer]);
          throw error;
        }
        rememberButler3dTask(taskToken, {
          ...currentTask,
          downloadedFileId: record.id,
          ...(deliveryToken ? { deliveryToken } : {}),
          status: 'succeeded'
        });
        if (!deliveryToken && runtimeConfig.gatewayConfigured) await syncGatewayAccount({ force: true });
        return { ok: true, file: butlerFilePayload(record, deliveryToken) };
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
      const existing = butlerVideoTasks.get(taskToken) || persistedButlerTask('video', taskToken) || {};
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
      const task = butlerVideoTasks.get(taskToken) || persistedButlerTask('video', taskToken) || {};
      if (task.modelId && task.modelId !== modelId) {
        const error = new Error('The video task model does not match.');
        error.code = 'invalid-video-tool';
        throw error;
      }
      if (task.downloadedFileId) {
        const existingFile = store.getFile(task.downloadedFileId);
        if (existingFile) {
          return { ok: true, file: butlerFilePayload(existingFile, task.deliveryToken) };
        }
      }
      if (butlerVideoDownloads.has(taskToken)) return await butlerVideoDownloads.get(taskToken);

      const download = (async () => {
        const buffer = await aiGateway.downloadVideoToolResult(taskToken, modelId);
        const currentTask = butlerVideoTasks.get(taskToken) || persistedButlerTask('video', taskToken) || task;
        const sourceFile = store.getFile(currentTask.sourceFileId) || {
          id: null,
          name: 'Enhanced video',
          folderId: null,
          canvasId: store.data.canvases[0] && store.data.canvases[0].id
        };
        let record = null;
        let deliveryToken = null;
        try {
          record = await addButlerVideoOutputFile(buffer, sourceFile, {
            output: currentTask.output || null,
            ...butlerOutputAccounting(
              buffer,
              currentTask.creditsCharged !== undefined ? currentTask.creditsCharged : currentTask.credits
            ),
            providerCost: currentTask.providerCost
          });
          deliveryToken = await registerButlerDelivery([buffer], [record]);
        } catch (error) {
          if (record) await rollbackGeneratedMediaFile(record);
          await releaseButlerBufferDeliveries([buffer]);
          throw error;
        }
        rememberButlerVideoTask(taskToken, {
          ...currentTask,
          modelId,
          downloadedFileId: record.id,
          ...(deliveryToken ? { deliveryToken } : {}),
          status: 'succeeded'
        });
        if (!deliveryToken && runtimeConfig.gatewayConfigured) await syncGatewayAccount({ force: true });
        return { ok: true, file: butlerFilePayload(record, deliveryToken) };
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
        referenceVideoUploadIds: videoReferences ? videoReferences.uploadIds : [],
        referenceAudioUploadIds: videoReferences ? videoReferences.audioUploadIds : []
      }, request.kind === 'video' ? { limit: 50, maxReferenceBytes: 64 * 1024 * 1024 } : { limit: 14 });
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
    const creditQuote = await quoteMediaCreditsForAccount({
      kind,
      imageProviderId: request.imageProviderId,
      videoProviderId: request.videoProviderId,
      count,
      quality: request.quality,
      size: request.size,
      resolution: request.resolution,
      duration: request.duration,
      serviceTier: request.serviceTier,
      referenceMediaTypes: request.referenceMediaTypes
    });
    const fallbackProvider = kind === 'image'
      ? await resolveImageFallback(request, creditQuote)
      : null;
    const reservationQuote = fallbackProvider && fallbackProvider.quote
      && Number(fallbackProvider.quote.totalCredits) > Number(creditQuote.totalCredits)
      ? fallbackProvider.quote
      : creditQuote;
    const usage = membershipService.beginUsage(`ai.${kind}`, {
      // Reserve the most expensive eligible path up front.  A successful
      // primary request settles at its own quote; a fallback settles at the
      // fallback quote, so neither path can undercharge or double-charge.
      estimatedCredits: reservationQuote.totalCredits,
      metadata: {
        kind,
        requestedCount: count,
        providerId: kind === 'video' ? request.videoProviderId : request.imageProviderId,
        fallbackProviderId: fallbackProvider ? fallbackProvider.provider.id : null,
        modelName: request.modelName || null,
        canvasId: String(request.canvasId || '').trim() || null,
        aspectRatio: request.aspectRatio || null,
        size: request.size || null,
        quality: kind === 'image' ? request.quality || 'auto' : null,
        resolution: kind === 'video' ? request.resolution || null : null,
        duration: kind === 'video' ? Number(request.duration) || null : null,
        referenceCount: Array.isArray(request.referenceMediaTypes) && request.referenceMediaTypes.length
          ? request.referenceMediaTypes.length
          : Array.isArray(request.urls) ? request.urls.length : 0,
        quotedCredits: creditQuote.totalCredits,
        unitCredits: creditQuote.unitCredits,
        reservationCredits: reservationQuote.totalCredits,
        fallbackUnitCredits: fallbackProvider && fallbackProvider.quote
          ? fallbackProvider.quote.unitCredits
          : null
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
      const generationOptions = aiMediaGenerationOptions(request, kind === 'video'
        ? request.videoProviderId
        : request.imageProviderId);
      const tasks = Array.from({ length: count }, () => generateAiMediaWithFallback(
        kind,
        providerPrompt,
        { ...generationOptions, accountingRequestId: crypto.randomUUID() },
        fallbackProvider
      ));
      const settled = await Promise.allSettled(tasks);
      const files = [];
      const boardItems = [];
      const unlockedKeys = new Set();
      let primaryCount = 0;
      let fallbackCount = 0;
      let fallbackProviderName = '';
      let authoritativeVideoEstimate = null;
      let authoritativeVideoCharge = null;
      let creditsCharged = 0;
      const deliveryFailures = [];
      const deliveryGroup = {
        groupId: `ag_${crypto.randomBytes(16).toString('hex')}`,
        usageId: usage.usageId,
        pendingTokens: [],
        settledCredits: 0,
        resultUnits: 0,
        failedUnits: 0
      };
      aiMediaDeliveryGroups.set(deliveryGroup.groupId, deliveryGroup);
      persistAiMediaDeliveryGroup(deliveryGroup);
      for (let index = 0; index < settled.length; index += 1) {
        const result = settled[index];
        if (result.status !== 'fulfilled') continue;
        const generated = result.value;
        const providerEstimate = Number(generated.buffer && generated.buffer.estimatedCredits);
        const providerCharge = Number(generated.buffer && generated.buffer.creditsCharged);
        if (kind === 'video' && Number.isFinite(providerEstimate) && providerEstimate >= 0) {
          authoritativeVideoEstimate = providerEstimate;
        }
        if (kind === 'video' && Number.isFinite(providerCharge) && providerCharge >= 0) {
          authoritativeVideoCharge = providerCharge;
        }
        const quotedResultCredits = generated.fallbackUsed && fallbackProvider && fallbackProvider.quote
          ? fallbackProvider.quote.unitCredits
          : kind === 'image' ? creditQuote.unitCredits : creditQuote.totalCredits;
        const resultRequest = generated.fallbackUsed
          ? {
              ...request,
              imageProviderId: generated.providerId,
              accountingRequestId: generated.accountingRequestId,
              estimatedCredits: kind === 'image' ? reservationQuote.unitCredits : (authoritativeVideoEstimate ?? reservationQuote.totalCredits)
            }
          : {
              ...request,
              accountingRequestId: generated.accountingRequestId,
              estimatedCredits: kind === 'image' ? reservationQuote.unitCredits : (authoritativeVideoEstimate ?? reservationQuote.totalCredits),
            };
        let added = null;
        try {
          added = await addGeneratedMediaFile(
            generated.buffer,
            prompt,
            request.folderId,
            kind,
            request.canvasId,
            resultRequest
          );
          const boardItem = request.placeOnBoard === false
            ? null
            : addGeneratedMediaBoardItem(
              added.record,
              resultRequest,
              Array.isArray(request.placements) ? request.placements[index] : null,
              index
            );
          const aiDeliveryToken = registerAiMediaDelivery(
            kind,
            generated,
            [added.record],
            boardItem ? [boardItem] : [],
            deliveryGroup,
            request.placeOnBoard !== false
          );
          if (generated.buffer && generated.buffer.deliveryPending === true && !aiDeliveryToken) {
            const error = new Error('The generated media delivery token is missing.');
            error.code = 'invalid-ai-delivery-confirmation';
            throw error;
          }
          const isPendingDelivery = !!aiDeliveryToken;
          const resultCharge = isPendingDelivery
            ? 0
            : (Number.isFinite(providerCharge) && providerCharge >= 0 ? providerCharge : quotedResultCredits);
          creditsCharged += resultCharge;
          deliveryGroup.settledCredits += resultCharge;
          if (!isPendingDelivery) deliveryGroup.resultUnits += 1;
          if (kind === 'video' && resultCharge > 0) authoritativeVideoCharge = resultCharge;
          if (added.record.aiGeneration && !isPendingDelivery) {
            added.record.aiGeneration.creditsCharged = resultCharge;
            added.record.aiGeneration.credits = resultCharge;
          }
          if (generated.fallbackUsed) {
            fallbackCount += 1;
            fallbackProviderName = generated.fallbackProviderName || fallbackProviderName;
          } else {
            primaryCount += 1;
          }
          persistAiMediaDeliveryGroup(deliveryGroup);
          files.push(fileToPayload(added.record, aiDeliveryToken));
          if (boardItem) boardItems.push(boardItem);
          added.unlocked.forEach((key) => unlockedKeys.add(key));
        } catch (error) {
          if (added && added.record) await rollbackGeneratedMediaFile(added.record);
          await releaseGeneratedMediaDelivery(kind, generated);
          deliveryFailures.push(error);
        }
      }
      const failures = [
        ...settled.filter((result) => result.status === 'rejected').map((result) => result.reason),
        ...deliveryFailures
      ];
      deliveryGroup.failedUnits = failures.length;
      persistAiMediaDeliveryGroup(deliveryGroup);
      if (!files.length) {
        aiMediaDeliveryGroups.delete(deliveryGroup.groupId);
        removeAiMediaDeliveryGroup(deliveryGroup.groupId);
        throw failures[0] || new Error('AI generation failed.');
      }
      if (!deliveryGroup.pendingTokens.length) {
        membershipService.finishUsage(usage.usageId, {
          status: failures.length ? 'partial' : 'succeeded',
          resultUnits: files.length,
          failedUnits: failures.length,
          settledCredits: creditsCharged
        });
        aiMediaDeliveryGroups.delete(deliveryGroup.groupId);
        removeAiMediaDeliveryGroup(deliveryGroup.groupId);
      }
      if (runtimeConfig.gatewayConfigured) await syncGatewayAccount({ force: true });
      store.scheduleSave();
      // Do not return a successful result until its file record, canvas item,
      // delivery token and membership reservation are on disk together.
      await flushStoreDurably();
      return {
        ok: true,
        file: files[0],
        files,
        boardItems,
        failedCount: failures.length,
        unlocked: [...unlockedKeys],
        estimatedCredits: kind === 'video'
          ? (authoritativeVideoEstimate ?? reservationQuote.totalCredits)
          : reservationQuote.totalCredits,
        ...(fallbackCount > 0 ? {
          fallback: {
            providerId: fallbackProvider.provider.id,
            count: fallbackCount,
            notice: localizedMessage(
              'The selected image model was temporarily unavailable. A compatible retry route was used.',
              '当前生图模型暂时不可用，已使用兼容通道重试。',
              'The selected image model was temporarily unavailable. A compatible retry route was used.'
            )
          }
        } : {}),
        pricing: {
          providerId: fallbackCount === files.length && fallbackProvider
            ? fallbackProvider.quote.providerId
            : creditQuote.providerId,
          unitCredits: fallbackCount === files.length && fallbackProvider
            ? fallbackProvider.quote.unitCredits
            : creditQuote.unitCredits,
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
        message: conciseAiErrorMessage(err, {
          kind: request.kind,
          gatewayConfigured: Boolean(runtimeConfig && runtimeConfig.gatewayConfigured)
        }),
        membership: membershipService.getSnapshot()
      };
    }
  });

  ipcMain.handle('ai:chat', async (_evt, request = {}) => {
    let safeRequest;
    try {
      const sourceMessages = Array.isArray(request.messages) ? request.messages.slice(-40) : [];
      const lastUserIndex = sourceMessages.map((message) => message && message.role).lastIndexOf('user');
      const messages = [];
      for (let index = 0; index < sourceMessages.length; index += 1) {
        const message = sourceMessages[index] || {};
        // Historical thumbnails stay in the local transcript, but only the
        // newest user turn sends binary attachments upstream. Re-sending every
        // earlier image quickly exceeds provider conversation limits.
        const resolved = message.role === 'user' && index === lastUserIndex
          ? await resolveAiChatMessageAttachments(message, request)
          : [];
        messages.push({
          role: message.role,
          content: message.content,
          images: resolved.filter((attachment) => attachment.kind === 'image').map((attachment) => attachment.dataUrl),
          attachments: resolved.filter((attachment) => attachment.kind !== 'image').map((attachment) => ({
            name: attachment.name,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            kind: attachment.kind,
            readable: attachment.readable,
            truncated: attachment.truncated,
            content: attachment.content
          }))
        });
      }
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
      estimatedCredits: 0,
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
      const providerMessages = [
        { role: 'system', content: AI_ARTIFACT_INSTRUCTION, images: [], attachments: [] },
        ...request.messages.slice(-19)
      ];
      const rawText = await generateAiChatReply(
        prompt,
        providerMessages,
        String(request.chatProviderId || '').trim(),
        String(request.chatModel || '').trim()
      );
      const parsed = parseAiArtifacts(rawText);
      const files = parsed.artifacts.map((artifact) => {
        const token = crypto.randomUUID();
        transientAiOutputFiles.set(token, {
          ...artifact,
          expiresAt: Date.now() + 60 * 60_000
        });
        return { token, name: artifact.name, mimeType: artifact.mimeType, sizeBytes: artifact.sizeBytes };
      });
      const text = parsed.text || (files.length ? localizedMessage('File ready.', '文件已生成。', '파일이 준비되었습니다.') : '');
      membershipService.finishUsage(usage.usageId, {
        status: 'succeeded',
        resultUnits: 1,
        settledCredits: CHAT_CREDITS,
        metadata: { responseCharacters: String(text || '').length }
      });
      return { ok: true, text, files };
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
        message: conciseAiErrorMessage(err, {
          kind: 'chat',
          model: request.chatModel,
          gatewayConfigured: Boolean(runtimeConfig && runtimeConfig.gatewayConfigured)
        })
      };
    }
  });

  ipcMain.handle('ai:saveGeneratedFile', async (_evt, rawToken) => {
    const token = String(rawToken || '');
    const record = transientAiOutputFiles.get(token);
    if (!record || record.expiresAt <= Date.now()) {
      return { ok: false, reason: 'expired', message: 'This generated file has expired. Ask AI to create it again.' };
    }
    const defaultName = normalizeAttachmentName(record.name, 'assistant.txt');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save AI file',
      defaultPath: defaultName
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    await fs.promises.writeFile(result.filePath, record.content, 'utf8');
    return { ok: true, filePath: result.filePath };
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

  ipcMain.handle('files:prepareAiAttachment', async (_evt, id) => {
    try {
      const attachment = await fileToAiChatAttachment(id);
      if (!attachment) return { ok: false, reason: 'not-found' };
      return { ok: true, attachment: publicAiAttachment(attachment) };
    } catch (error) {
      return {
        ok: false,
        reason: error && error.code || 'attachment-read-failed',
        message: error && error.message || 'The attachment could not be read.'
      };
    }
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

    return matches
      .slice()
      .sort((left, right) => {
        const leftActivity = new Date(left.lastDownloadedAt || left.importedAt).getTime();
        const rightActivity = new Date(right.lastDownloadedAt || right.importedAt).getTime();
        return (Number.isFinite(rightActivity) ? rightActivity : 0)
          - (Number.isFinite(leftActivity) ? leftActivity : 0);
      })
      .map(fileToPayload);
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

  ipcMain.handle('canvas:saveState', (event, payload = {}) => {
    const previous = new Map((Array.isArray(store.data.canvases) ? store.data.canvases : []).map((canvas) => [canvas.id, canvas]));
    const detachedCanvasId = String(payload.detachedCanvasId || '').trim();
    const projects = detachedCanvasId
      ? store.data.canvasProjects
      : Array.isArray(payload.projects) && payload.projects.length
      ? payload.projects
      : store.data.canvasProjects;
    let canvases = Array.isArray(payload.canvases) && payload.canvases.length
      ? payload.canvases
      : store.data.canvases;
    if (detachedCanvasId) {
      const incoming = canvases.find((canvas) => String(canvas && canvas.id || '') === detachedCanvasId);
      canvases = store.data.canvases.map((canvas) => (
        incoming && canvas.id === detachedCanvasId
          ? { ...canvas, ...incoming, id: canvas.id }
          : canvas
      ));
    }
    store.data.canvasProjects = projects.map((project, index) => ({
      id: String(project.id || `project-${index + 1}`),
      name: String(project.name || 'General').trim().slice(0, 80) || 'General',
      scope: normalizeCanvasProjectScope(project.scope),
      createdAt: project.createdAt || new Date().toISOString()
    }));
    if (!store.data.canvasProjects.length) {
      store.data.canvasProjects = [{
        id: 'project-1',
        name: 'General',
        scope: 'personal',
        createdAt: new Date().toISOString()
      }];
    }
    const validProjectIds = new Set(store.data.canvasProjects.map((project) => project.id));
    const fallbackProjectId = store.data.canvasProjects[0].id;
    store.data.canvases = canvases.map((canvas, index) => ({
      id: String(canvas.id || `canvas-${index + 1}`),
      projectId: validProjectIds.has(String(canvas.projectId || ''))
        ? String(canvas.projectId)
        : fallbackProjectId,
      name: String(canvas.name || 'Untitled').trim().slice(0, 80) || 'Untitled',
      createdAt: canvas.createdAt || new Date().toISOString(),
      updatedAt: canvas.updatedAt || canvas.createdAt || new Date().toISOString(),
      lastOpenedAt: canvas.lastOpenedAt || null,
      pinned: canvas.pinned === true
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
    broadcastRendererEvent('canvas:stateChanged', {
      projects: store.data.canvasProjects,
      canvases: store.data.canvases
    }, event.sender);
    return {
      projects: store.data.canvasProjects,
      canvases: store.data.canvases
    };
  });

  ipcMain.handle('canvas:openDetached', (event, canvasId, launchPoint) => {
    return createDetachedCanvasWindow(canvasId, launchPoint, event.sender);
  });

  ipcMain.handle('canvas:export', async (event, canvasId) => {
    const canvas = store.data.canvases.find((entry) => entry.id === canvasId);
    if (!canvas) return { ok: false, reason: 'not-found' };
    const result = await dialog.showSaveDialog(rendererWindowForEvent(event), {
      title: 'Export canvas',
      defaultPath: `${canvasFolderName(canvas.name)}.Messs`,
      filters: [{ name: 'Messs Canvas Package', extensions: ['Messs'] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    try {
      const prepared = await prepareCanvasPackageExport(canvas);
      const filePath = ensureCanvasPackagePath(result.filePath);
      await writeCanvasPackage(filePath, prepared);
      return { ok: true, filePath, fileCount: prepared.sources.length };
    } catch (error) {
      console.error('Canvas export failed:', error && error.message || error);
      return {
        ok: false,
        reason: error && error.code || 'export-failed',
        message: error && error.message || 'The canvas could not be exported safely.'
      };
    }
  });

  ipcMain.handle('canvas:import', async (event, targetProjectId) => {
    const result = await dialog.showOpenDialog(rendererWindowForEvent(event), {
      title: 'Import .Messs canvas',
      properties: ['openFile'],
      filters: [{ name: 'Messs Canvas Package', extensions: ['Messs'] }]
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
    try {
      return await importCanvasPackage(result.filePaths[0], targetProjectId);
    } catch (error) {
      console.error('Canvas import failed:', error && error.message || error);
      return {
        ok: false,
        reason: error && error.code || 'import-failed',
        message: error && error.message || 'The .Messs canvas could not be imported safely.'
      };
    }
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
    const detachedWindow = detachedCanvasWindows.get(canvas.id);
    if (detachedWindow && !detachedWindow.isDestroyed()) detachedWindow.close();
    broadcastRendererEvent('canvas:stateChanged', {
      projects: store.data.canvasProjects,
      canvases: store.data.canvases,
      deletedCanvasId: canvas.id
    });
    return {
      ok: true,
      fallbackCanvasId: fallback.id,
      projects: store.data.canvasProjects,
      canvases: store.data.canvases
    };
  });

  ipcMain.handle('board:upsertItem', (event, item) => {
    const fallbackCanvasId = store.data.canvases[0] && store.data.canvases[0].id;
    const persistedItem = persistentBoardItem(item, fallbackCanvasId);
    if (!persistedItem) return false;
    const idx = store.data.boardItems.findIndex((b) => b.id === persistedItem.id);
    if (idx === -1) store.data.boardItems.push(persistedItem);
    else store.data.boardItems[idx] = persistedItem;
    store.scheduleSave();
    const file = persistedItem.fileId ? store.getFile(persistedItem.fileId) : null;
    broadcastCanvasItemsChanged({
      canvasId: persistedItem.canvasId,
      upsert: [persistedItem],
      remove: [],
      files: file ? [fileToPayload(file)] : []
    }, event.sender);
    return true;
  });

  ipcMain.handle('board:upsertItems', (event, items) => {
    if (!Array.isArray(items) || !items.length) return true;
    const indexById = new Map(store.data.boardItems.map((item, index) => [item.id, index]));
    const fallbackCanvasId = store.data.canvases[0] && store.data.canvases[0].id;
    const persistedItems = items
      .map((item) => persistentBoardItem(item, fallbackCanvasId))
      .filter(Boolean);
    for (const item of persistedItems) {
      const index = indexById.get(item.id);
      if (index === undefined) {
        indexById.set(item.id, store.data.boardItems.length);
        store.data.boardItems.push(item);
      } else {
        store.data.boardItems[index] = item;
      }
    }
    store.scheduleSave();
    const fileIds = new Set(persistedItems.map((item) => item.fileId).filter(Boolean));
    const files = store.data.files.filter((file) => fileIds.has(file.id)).map(fileToPayload);
    const canvasIds = [...new Set(persistedItems.map((item) => item.canvasId).filter(Boolean))];
    for (const canvasId of canvasIds) {
      broadcastCanvasItemsChanged({
        canvasId,
        upsert: persistedItems.filter((item) => item.canvasId === canvasId),
        remove: [],
        files
      }, event.sender);
    }
    return true;
  });

  ipcMain.handle('board:removeItem', (event, itemId) => {
    const existing = store.data.boardItems.find((item) => item.id === itemId);
    store.data.boardItems = store.data.boardItems.filter((b) => b.id !== itemId);
    store.scheduleSave();
    if (existing) {
      broadcastCanvasItemsChanged({
        canvasId: existing.canvasId,
        upsert: [],
        remove: [itemId],
        files: []
      }, event.sender);
    }
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

  ipcMain.handle('clipboard:copyBoardMedia', (_evt, fileIds) => {
    const paths = [...new Set((Array.isArray(fileIds) ? fileIds : [])
      .map((id) => store.getFile(String(id || '')))
      .filter(Boolean)
      .map((file) => file.storedPath)
      .filter((filePath) => fs.existsSync(filePath)))];
    if (!paths.length) return false;
    if (process.platform === 'win32') clipboard.writeBuffer('CF_HDROP', buildCfHDrop(paths));
    else clipboard.writeText(paths.join('\n'));
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

  ipcMain.handle('files:export', async (event, id) => {
    const f = store.getFile(id);
    if (!f) return { ok: false };
    const result = await dialog.showSaveDialog(rendererWindowForEvent(event), { defaultPath: f.name });
    if (result.canceled || !result.filePath) return { ok: false };
    try {
      await copyFileAtomically(f.storedPath, result.filePath);
      f.lastDownloadedAt = new Date().toISOString();
      store.scheduleSave();
      try {
        await flushStoreDurably();
      } catch (saveError) {
        console.error('Failed to persist file download time:', saveError.message);
      }
      const file = fileToPayload(f);
      broadcastRendererEvent('files:changed', { file });
      return { ok: true, path: result.filePath, file };
    } catch (err) {
      const reason = String(err && err.code || 'file-export-failed');
      return {
        ok: false,
        reason,
        error: ['EACCES', 'EPERM'].includes(reason)
          ? (process.platform === 'darwin'
            ? 'macOS denied access to the selected export location.'
            : 'Messs could not write to the selected export location.')
          : 'The file could not be exported safely.'
      };
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
      isQuitting = false;
      if (updateInstallFallbackTimer) {
        clearTimeout(updateInstallFallbackTimer);
        updateInstallFallbackTimer = null;
      }
      setUpdaterState({ status: 'downloaded', progress: 100, message: String(err && err.message || 'Update installation failed.') });
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
  restoreButlerState();
  restoreAiMediaDeliveryGroups();
  restoreAiMediaDeliveries();
  const savedColorProfile = normalizeColorProfile(store.data.settings.colorProfile);
  if (startupColorProfileBootstrap.valid) {
    // The bootstrap file is the profile Chromium actually started with. Keep
    // the full store mirror aligned if a previous save was interrupted.
    store.data.settings.colorProfile = startupColorProfile;
  } else {
    store.data.settings.colorProfile = savedColorProfile;
    if (savedColorProfile !== 'auto') {
      // Heal a missing/corrupt bootstrap file. This launch remains in Auto;
      // the settings UI will correctly offer a restart to apply the choice.
      writeColorProfileBootstrapSync(colorProfileBootstrapFile, savedColorProfile);
    }
  }
  if (store.data.settings.colorProfile !== savedColorProfile) store.scheduleSave();
  writeStartupDiagnostic('store-ready');
  membershipService = createMembershipService(store);
  reconcileRestoredAiMediaDeliveryGroups();
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

  protocol.handle('messs-chat-file', async (request) => {
    const clientId = request.url.replace('messs-chat-file://', '').replace(/\/$/, '');
    try {
      const result = await chatService.getFileLocalPath(clientId);
      if (!result || !result.ok) return new Response('Not found', { status: 404 });
      return localFileProtocolResponse(request, result.path, localMediaMimeType(result.path));
    } catch (error) {
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
  if (isQuitting) app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  for (const webContentsId of [...canvasDetachDragWatches.keys()]) stopCanvasDetachDragWatch(webContentsId);
  for (const session of droppedFileImports.values()) void disposeDroppedFileImport(session);
  droppedFileImports.clear();
  if (chatScreenshotTool) void chatScreenshotTool.endCapture().catch(() => {});
  for (const draft of [...chatAttachmentDrafts.values()]) discardChatAttachmentDraft(draft.token).catch(() => {});
  preview.shutdownProcesses();
  thumbnails.shutdownProcesses();
  shutdownMediaMetadataProcesses();
  if (store) store.flushSync();
  if (chatService) chatService.flushLocal();
});

setInterval(() => {
  const now = Date.now();
  for (const [uploadId, session] of droppedFileImports) {
    if (session.touchedAt + DROPPED_FILE_IMPORT_TTL_MS <= now) {
      droppedFileImports.delete(uploadId);
      void disposeDroppedFileImport(session);
    }
  }
  for (const [token, record] of transientAiAttachments) {
    if (record.expiresAt <= now) transientAiAttachments.delete(token);
  }
  for (const [token, record] of transientAiOutputFiles) {
    if (record.expiresAt <= now) transientAiOutputFiles.delete(token);
  }
  cleanupExpiredChatDrafts();
}, 5 * 60_000).unref();
