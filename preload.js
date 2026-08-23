'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');
const fs = require('fs');
const path = require('path');

/**
 * PDF rendering, done right here in the preload script rather than in the
 * page itself. Why: pdfjs-dist's build is an ES module, and loading ES
 * modules via a plain <script type="module"> tag fails under Electron's
 * file:// page loading (the browser's module loader applies the same CORS
 * rules it would on the open web, which file:// doesn't satisfy). A preload
 * script sidesteps that completely �?it uses Node's own module resolution
 * (a real dynamic `import()` against an absolute disk path, no network-style
 * fetch involved) while still running in the renderer's context, so
 * `document`/`canvas` are available for the actual rendering.
 *
 * Version note: pdfjs-dist is pinned to 4.10.38 in package.json rather than
 * floating to latest �?newer releases (5.x) use very recent JS engine
 * features that can change compatibility requirements. 4.10.38 was tested and
 * confirmed to parse and report page counts/dimensions correctly; full
 * canvas rendering inside an actual Electron preload context is the one
 * piece that couldn't be verified in the sandbox this was built in (no
 * real Electron runtime available there) �?worth an early test pass once
 * you've got this running for real.
 */
/**
 * Locates pdfjs-dist's files on real disk. In dev this is just the normal
 * node_modules path; in a packaged build, pdfjs-dist is unpacked out of the
 * asar archive (see package.json asarUnpack) since dynamic `import()` of an
 * ES module is a different code path than Node's asar-aware `require()`,
 * and unlike require(), it isn't confirmed to transparently redirect reads
 * into app.asar.unpacked �?so this resolves the real path explicitly
 * instead of assuming that redirection applies.
 */
function resolvePdfjsDir() {
  const devPath = path.join(__dirname, 'node_modules', 'pdfjs-dist');
  const unpackedPath = path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules', 'pdfjs-dist');
  if (fs.existsSync(unpackedPath)) return unpackedPath;

  if (fs.existsSync(devPath)) return devPath;

  return devPath; // fall back to the dev path; the import will fail loudly if neither exists
}

let pdfjsLibPromise = null;
function loadPdfjs() {
  if (!pdfjsLibPromise) {
    const pdfjsDir = resolvePdfjsDir();
    const pdfjsPath = path.join(pdfjsDir, 'legacy', 'build', 'pdf.mjs');
    pdfjsLibPromise = import(pdfjsPath).then((lib) => {
      // GlobalWorkerOptions.workerSrc must point at a real, existing file �?      // pdfjs-dist's internal checks throw "No workerSrc specified" if it's
      // empty, even when every call also passes disableWorker (verified by
      // testing both ways in a real browser context). Pointing it at the
      // real worker script while ALSO passing disableWorker:true per
      // getDocument() call (see getPdfDocument below) was confirmed to make
      // PDF.js skip actually spawning that worker and run synchronously on
      // this thread instead �?sidestepping whatever was failing about
      // Worker creation from inside a preload script under file://.
      const workerPath = path.join(pdfjsDir, 'legacy', 'build', 'pdf.worker.mjs');
      lib.GlobalWorkerOptions.workerSrc = workerPath;
      return lib;
    });
  }
  return pdfjsLibPromise;
}

// Cache a small number of parsed PDFs, but bind each entry to the actual file
// state. Office previews reuse the same converted.pdf path, so a path-only
// cache would otherwise keep showing the document from before the last save.
const MAX_CACHED_PDF_DOCUMENTS = 8;
const pdfDocCache = new Map();
function pdfFileSignature(pdfPath) {
  const stat = fs.statSync(pdfPath, { bigint: true });
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}`;
}

function disposeCachedPdf(entry) {
  if (!entry || !entry.promise) return;
  entry.disposeRequested = true;
  if (entry.activeRenders > 0 || entry.disposed) return;
  entry.disposed = true;
  void entry.promise.then((doc) => {
    if (doc && typeof doc.destroy === 'function') return doc.destroy();
    return null;
  }).catch(() => {});
}

function releaseCachedPdf(entry) {
  if (!entry || entry.activeRenders <= 0) return;
  entry.activeRenders -= 1;
  if (entry.activeRenders === 0 && entry.disposeRequested) disposeCachedPdf(entry);
}

async function getPdfDocument(pdfPath) {
  const signature = pdfFileSignature(pdfPath);
  const cached = pdfDocCache.get(pdfPath);
  let entry = cached;
  if (cached && cached.signature === signature) {
    pdfDocCache.delete(pdfPath);
    pdfDocCache.set(pdfPath, cached);
  } else {
    if (cached) {
      pdfDocCache.delete(pdfPath);
      disposeCachedPdf(cached);
    }

    entry = {
      signature,
      activeRenders: 0,
      disposeRequested: false,
      disposed: false,
      promise: loadPdfjs().then((pdfjsLib) => {
        const data = new Uint8Array(fs.readFileSync(pdfPath));
        return pdfjsLib.getDocument({ data, disableWorker: true }).promise;
      })
    };
    pdfDocCache.set(pdfPath, entry);
    while (pdfDocCache.size > MAX_CACHED_PDF_DOCUMENTS) {
      const oldestPath = pdfDocCache.keys().next().value;
      const oldest = pdfDocCache.get(oldestPath);
      pdfDocCache.delete(oldestPath);
      disposeCachedPdf(oldest);
    }
  }
  entry.activeRenders += 1;
  try {
    return { pdf: await entry.promise, entry };
  } catch (error) {
    releaseCachedPdf(entry);
    if (pdfDocCache.get(pdfPath) === entry) pdfDocCache.delete(pdfPath);
    throw error;
  }
}

async function renderPdfPage(pdfPath, pageNumber, scale) {
  const lease = await getPdfDocument(pdfPath);
  try {
    const { pdf } = lease;
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: scale || 1.5 });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext('2d');
    await page.render({ canvasContext: context, viewport }).promise;

    return {
      dataUrl: canvas.toDataURL('image/png'),
      totalPages: pdf.numPages,
      width: viewport.width,
      height: viewport.height
    };
  } finally {
    releaseCachedPdf(lease.entry);
  }
}

contextBridge.exposeInMainWorld('messsAPI', {
  getInitialState: () => ipcRenderer.invoke('app:getInitialState'),
  getActivationStatus: () => ipcRenderer.invoke('activation:getStatus'),
  activateApp: (code) => ipcRenderer.invoke('activation:activate', code),
  syncThemeSurface: (theme) => ipcRenderer.send('window:syncThemeSurface', theme),
  readyForInteraction: () => ipcRenderer.send('window:readyForInteraction'),
  setTheme: (theme) => ipcRenderer.invoke('settings:setTheme', theme),
  setLanguage: (language) => ipcRenderer.invoke('settings:setLanguage', language),
  setTextSize: (size) => ipcRenderer.invoke('settings:setTextSize', size),
  setColorProfile: (profile) => ipcRenderer.invoke('settings:setColorProfile', profile),
  restartForColorProfile: () => ipcRenderer.invoke('settings:restartForColorProfile'),
  getMembershipSnapshot: () => ipcRenderer.invoke('membership:getSnapshot'),
  getUsageSummary: (range) => ipcRenderer.invoke('membership:getUsageSummary', range),
  checkMembershipFeature: (feature) => ipcRenderer.invoke('membership:checkFeature', feature),
  quoteMediaCredits: (request) => ipcRenderer.invoke('membership:quoteMedia', request),
  onMembershipUpdated: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('membership:updated', listener);
    return () => ipcRenderer.removeListener('membership:updated', listener);
  },
  onActivationUpdated: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('activation:updated', listener);
    return () => ipcRenderer.removeListener('activation:updated', listener);
  },
  getProfileAvatar: () => ipcRenderer.invoke('profile:getAvatar'),
  chooseProfileAvatar: () => ipcRenderer.invoke('profile:chooseAvatar'),
  setProfileDisplayName: (value) => ipcRenderer.invoke('profile:setDisplayName', value),
  setProfileSignature: (value) => ipcRenderer.invoke('profile:setSignature', value),
  getCloudSession: () => ipcRenderer.invoke('auth:getSession'),
  signInCloud: (credentials) => ipcRenderer.invoke('auth:signIn', credentials),
  signUpCloud: (credentials) => ipcRenderer.invoke('auth:signUp', credentials),
  signInCloudWithGoogle: () => ipcRenderer.invoke('auth:signInWithGoogle'),
  signOutCloud: () => ipcRenderer.invoke('auth:signOut'),

  initializeChat: () => ipcRenderer.invoke('chat:initialize'),
  syncChat: () => ipcRenderer.invoke('chat:sync'),
  searchChatUser: (query) => ipcRenderer.invoke('chat:searchUser', query),
  sendChatFriendRequest: (targetId) => ipcRenderer.invoke('chat:sendFriendRequest', targetId),
  respondChatFriendRequest: (requestId, action) => ipcRenderer.invoke('chat:respondFriendRequest', requestId, action),
  startChatConversation: (friendId) => ipcRenderer.invoke('chat:startConversation', friendId),
  createChatGroup: (name, memberIds) => ipcRenderer.invoke('chat:createGroup', name, memberIds),
  addChatGroupMembers: (conversationId, memberIds) => ipcRenderer.invoke('chat:addGroupMembers', conversationId, memberIds),
  getChatHistory: (conversationId, options) => ipcRenderer.invoke('chat:getHistory', conversationId, options),
  loadOlderChatHistory: (conversationId, options) => ipcRenderer.invoke('chat:loadOlderRemote', conversationId, options),
  sendChatText: (conversationId, body) => ipcRenderer.invoke('chat:sendText', conversationId, body),
  sendChatImage: (conversationId) => ipcRenderer.invoke('chat:sendImage', conversationId),
  sendChatFile: (conversationId) => ipcRenderer.invoke('chat:sendFile', conversationId),
  pickChatImageDrafts: () => ipcRenderer.invoke('chat:pickImageDraft'),
  pickChatFileDrafts: () => ipcRenderer.invoke('chat:pickFileDraft'),
  createChatBoardAttachmentDrafts: (fileIds) => ipcRenderer.invoke('chat:createBoardAttachmentDrafts', fileIds),
  readChatClipboardDrafts: () => ipcRenderer.invoke('chat:readClipboardDrafts'),
  captureChatScreenshotDraft: () => ipcRenderer.invoke('chat:captureScreenshotDraft'),
  discardChatAttachmentDraft: (token) => ipcRenderer.invoke('chat:discardAttachmentDraft', token),
  sendChatAttachmentDraft: (conversationId, token) => ipcRenderer.invoke('chat:sendAttachmentDraft', conversationId, token),
  openChatFile: (clientId) => ipcRenderer.invoke('chat:openFile', clientId),
  retryChatMessage: (clientId) => ipcRenderer.invoke('chat:retryMessage', clientId),
  recallChatMessage: (clientId) => ipcRenderer.invoke('chat:recallMessage', clientId),
  getChatImageDataUrl: (clientId) => ipcRenderer.invoke('chat:getImageDataUrl', clientId),
  onChatEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('chat:event', listener);
    return () => ipcRenderer.removeListener('chat:event', listener);
  },
  onOpenChatConversation: (callback) => {
    const listener = (_event, conversationId) => callback(conversationId);
    ipcRenderer.on('chat:openConversation', listener);
    return () => ipcRenderer.removeListener('chat:openConversation', listener);
  },

  getLibraryPaths: () => ipcRenderer.invoke('settings:getLibraryPaths'),
  pickCustomLibraryPath: () => ipcRenderer.invoke('settings:pickCustomLibraryPath'),
  clearCustomLibraryPath: () => ipcRenderer.invoke('settings:clearCustomLibraryPath'),
  setViewMode: (mode) => ipcRenderer.invoke('settings:setViewMode', mode),
  setSidebarCollapsed: (collapsed) => ipcRenderer.invoke('settings:setSidebarCollapsed', collapsed),
  getPreviewToolStatus: (forceRefresh) => ipcRenderer.invoke('settings:getPreviewToolStatus', forceRefresh),
  getAiMediaConfig: () => ipcRenderer.invoke('settings:getAiMediaConfig'),
  getAiImageStyles: (providerId) => ipcRenderer.invoke('ai:getImageStyles', providerId),
  setAiMediaConfig: (config) => ipcRenderer.invoke('settings:setAiMediaConfig', config),
  discoverAiModels: (request) => ipcRenderer.invoke('settings:discoverAiModels', request),
  saveCanvasState: (state) => ipcRenderer.invoke('canvas:saveState', state),
  getCanvasCreditUsage: (canvasId) => ipcRenderer.invoke('canvas:getCreditUsage', canvasId),
  exportCanvas: (canvasId) => ipcRenderer.invoke('canvas:export', canvasId),
  importCanvas: (projectId) => ipcRenderer.invoke('canvas:import', projectId),
  deleteCanvas: (canvasId) => ipcRenderer.invoke('canvas:delete', canvasId),

  renderPdfPage: (pdfPath, pageNumber, scale) => renderPdfPage(pdfPath, pageNumber, scale),

  pickFiles: () => ipcRenderer.invoke('dialog:pickFiles'),
  importFiles: (filePaths, folderId, canvasId) => ipcRenderer.invoke('files:import', filePaths, folderId, canvasId),
  pickAndPrepareAiAttachments: (folderId, canvasId) => ipcRenderer.invoke('files:pickAndPrepareAiAttachments', folderId, canvasId),
  beginDroppedFileImport: (metadata, folderId, canvasId) => ipcRenderer.invoke('files:beginDroppedImport', metadata, folderId, canvasId),
  appendDroppedFileImport: (uploadId, chunk) => ipcRenderer.invoke('files:appendDroppedImport', uploadId, chunk),
  finishDroppedFileImport: (uploadId) => ipcRenderer.invoke('files:finishDroppedImport', uploadId),
  abortDroppedFileImport: (uploadId) => ipcRenderer.invoke('files:abortDroppedImport', uploadId),
  generateAiMedia: (request) => ipcRenderer.invoke('ai:generateMedia', request),
  chatWithAi: (request) => ipcRenderer.invoke('ai:chat', request),
  saveGeneratedAiFile: (token) => ipcRenderer.invoke('ai:saveGeneratedFile', token),
  exportAiChat: (session) => ipcRenderer.invoke('ai:exportChat', session),
  getCanvasAgentHistory: () => ipcRenderer.invoke('canvas-agent:getHistory'),
  saveCanvasAgentHistory: (sessions) => ipcRenderer.invoke('canvas-agent:saveHistory', sessions),
  getAiAssistantHistory: () => ipcRenderer.invoke('ai-assistant:getHistory'),
  saveAiAssistantHistory: (sessions) => ipcRenderer.invoke('ai-assistant:saveHistory', sessions),
  workshop: Object.freeze({
    list: () => ipcRenderer.invoke('workshop:list'),
    publish: (fileId, metadata) => ipcRenderer.invoke('workshop:publish', fileId, metadata),
    incrementClick: (postId) => ipcRenderer.invoke('workshop:incrementClick', postId),
    toggleLike: (postId) => ipcRenderer.invoke('workshop:toggleLike', postId),
    importMedia: (postId, folderId, canvasId) => ipcRenderer.invoke('workshop:importMedia', postId, folderId, canvasId),
    delete: (postId) => ipcRenderer.invoke('workshop:delete', postId)
  }),
  butler: Object.freeze({
    confirmDelivery: (deliveryToken) => ipcRenderer.invoke('butler:confirmDelivery', deliveryToken),
    releaseDelivery: (deliveryToken) => ipcRenderer.invoke('butler:releaseDelivery', deliveryToken),
    removeBackground: (fileId, options) => ipcRenderer.invoke('butler:removeBackground', fileId, options),
    editImage: (fileId, options) => ipcRenderer.invoke('butler:image-edit', fileId, options),
    expandImage: (fileId, options) => ipcRenderer.invoke('butler:image-expand', fileId, options),
    upscaleImage: (fileId) => ipcRenderer.invoke('butler:image-upscale', fileId),
    layerImage: (fileId, options) => ipcRenderer.invoke('butler:image-layer', fileId, options),
    eraseObject: (fileId, options) => ipcRenderer.invoke('butler:image-erase', fileId, options),
    runImageTool: (fileId, modelId, options) => ipcRenderer.invoke('butler:image-tool-run', fileId, modelId, options),
    getImageToolStatus: (taskToken, modelId) => ipcRenderer.invoke('butler:image-tool-status', taskToken, modelId),
    downloadImageToolResult: (taskToken, modelId) => ipcRenderer.invoke('butler:image-tool-download', taskToken, modelId),
    create3d: (fileId, providerId, options) => ipcRenderer.invoke('butler:create3d', fileId, providerId, options),
    get3dStatus: (taskToken, providerId) => ipcRenderer.invoke('butler:get3dStatus', taskToken, providerId),
    download3d: (taskToken, providerId) => ipcRenderer.invoke('butler:download3d', taskToken, providerId),
    upscaleVideo: (fileId, options) => ipcRenderer.invoke('butler:upscaleVideo', fileId, options),
    onVideoProgress: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('butler:videoProgress', listener);
      return () => ipcRenderer.removeListener('butler:videoProgress', listener);
    },
    getVideoToolStatus: (taskToken, modelId) => ipcRenderer.invoke('butler:getVideoToolStatus', taskToken, modelId),
    downloadVideoToolResult: (taskToken, modelId) => ipcRenderer.invoke('butler:downloadVideoToolResult', taskToken, modelId)
  }),
  preparePastedAiImage: (request) => ipcRenderer.invoke('ai:preparePastedImage', request),
  importClipboardImage: (request) => ipcRenderer.invoke('clipboard:importImage', request),
  getPreview: (id) => ipcRenderer.invoke('files:getPreview', id),
  readModelData: (id) => ipcRenderer.invoke('files:readModelData', id),
  saveModelPreview: (id, dataUrl) => ipcRenderer.invoke('files:saveModelPreview', id, dataUrl),
  readFileAsDataUrl: (id) => ipcRenderer.invoke('files:readDataUrl', id),
  prepareAiAttachment: (id) => ipcRenderer.invoke('files:prepareAiAttachment', id),
  transcodeVideo: (id) => ipcRenderer.invoke('files:transcodeVideo', id),
  transcodeAudio: (id) => ipcRenderer.invoke('files:transcodeAudio', id),
  getAudioWaveform: (id, barCount) => ipcRenderer.invoke('files:getAudioWaveform', id, barCount),
  searchFiles: (query) => ipcRenderer.invoke('files:search', query),
  deleteFilePermanently: (id) => ipcRenderer.invoke('files:deletePermanently', id),
  moveFileToTrash: (id) => ipcRenderer.invoke('files:moveToTrash', id),
  duplicateFile: (id, targetFolderId) => ipcRenderer.invoke('files:duplicate', id, targetFolderId),
  renameFile: (id, newName) => ipcRenderer.invoke('files:rename', id, newName),
  exportFile: (id) => ipcRenderer.invoke('files:export', id),
  saveTextFile: (id, content) => ipcRenderer.invoke('files:saveText', id, content),
  saveDocxFile: (id, html) => ipcRenderer.invoke('files:saveDocx', id, html),
  readTextFile: (id) => ipcRenderer.invoke('files:readText', id),
  readDocxAsHtml: (id) => ipcRenderer.invoke('files:readDocxHtml', id),

  revealFile: (id) => ipcRenderer.invoke('shell:revealFile', id),
  openFileExternally: (id) => ipcRenderer.invoke('shell:openExternal', id),
  openInFileManager: (id) => ipcRenderer.invoke('shell:openInFileManager', id),
  openWithOtherApp: (id) => ipcRenderer.invoke('shell:openWithOtherApp', id),
  sendToCreativeApp: (id, target) => ipcRenderer.invoke('shell:sendToCreativeApp', id, target),
  sendToWeChatFileHelper: (id) => ipcRenderer.invoke('shell:sendToWeChatFileHelper', id),
  copyFileToClipboard: (id) => ipcRenderer.invoke('clipboard:copyFile', id),
  copyBoardMediaToClipboard: (fileIds) => ipcRenderer.invoke('clipboard:copyBoardMedia', fileIds),
  copyFilePath: (id) => ipcRenderer.invoke('clipboard:copyPath', id),

  createFolder: (name, parentId) => ipcRenderer.invoke('folders:create', name, parentId),
  renameFolder: (id, newName) => ipcRenderer.invoke('folders:rename', id, newName),
  deleteFolder: (id) => ipcRenderer.invoke('folders:delete', id),
  moveFileToFolder: (fileId, folderId) => ipcRenderer.invoke('folders:moveFile', fileId, folderId),
  moveFolderInto: (folderId, destFolderId) => ipcRenderer.invoke('folders:moveInto', folderId, destFolderId),
  revealFolder: (folderId) => ipcRenderer.invoke('folders:reveal', folderId),
  importDirectory: (dirPath, parentFolderId, canvasId) => ipcRenderer.invoke('folders:importDirectory', dirPath, parentFolderId, canvasId),
  pickFolderToImport: (canvasId) => ipcRenderer.invoke('dialog:pickFolderToImport', canvasId),
  onImportProgress: (callback) => {
    ipcRenderer.on('import:progress', (_evt, payload) => callback(payload));
  },

  checkUnsavedWork: () => ipcRenderer.invoke('app:checkUnsavedWork'),

  upsertBoardItem: (item) => ipcRenderer.invoke('board:upsertItem', item),
  upsertBoardItems: (items) => ipcRenderer.invoke('board:upsertItems', items),
  removeBoardItem: (itemId) => ipcRenderer.invoke('board:removeItem', itemId),

  installUpdateNow: () => ipcRenderer.invoke('updater:installNow'),
  getUpdateState: () => ipcRenderer.invoke('updater:getState'),
  checkForUpdatesNow: () => ipcRenderer.invoke('updater:checkNow'),
  setAutoUpdateEnabled: (enabled) => ipcRenderer.invoke('updater:setAutoUpdateEnabled', enabled),
  openReleasesPage: () => ipcRenderer.invoke('updater:openReleasesPage'),
  onUpdateStatus: (callback) => {
    ipcRenderer.on('updater:status', (_evt, payload) => callback(payload));
  },
  onUpdateDownloaded: (callback) => {
    ipcRenderer.on('updater:downloaded', (_evt, payload) => callback(payload));
  },

  // Resolve a real absolute path from a File object obtained via drag-and-drop.
  getPathForFile: (file) => webUtils.getPathForFile(file),

  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggleMaximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isWindowMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onWindowMaximizedChanged: (callback) => {
    ipcRenderer.on('window:maximizedChanged', (_evt, isMaximized) => callback(isMaximized));
  },

  onAchievementsUpdated: (callback) => {
    ipcRenderer.on('achievements:updated', (_evt, payload) => callback(payload));
  }
});
