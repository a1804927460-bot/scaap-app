'use strict';
/**
 * Lightweight JSON-file data store with atomic writes.
 * No native/database dependencies, so it works offline with zero install issues.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { makeDefaultMembershipState } = require('./membership-service');
const { PROVIDER_CATALOG_VERSION, providerCatalog } = require('./provider-catalog');

const DEFAULT_CHAT_PROVIDER_ID = 'chat-3';
const DEFAULT_CHAT_MODEL = 'gemini-3.1-pro';

function desktopCatalogProviders(kind) {
  const configured = providerCatalog(kind);
  return Array.from({ length: Math.max(10, configured.length) }, (_, index) => {
    const provider = configured[index];
    if (!provider) return { id: `${kind}-${index + 1}`, name: '', endpoint: '', ...(kind === 'chat' ? { models: [] } : {}) };
    if (provider.hidden === true) {
      return { id: provider.id, name: '', endpoint: '', ...(kind === 'chat' ? { models: [] } : {}) };
    }
    const { keyEnv, kind: ignoredKind, hidden: ignoredHidden, ...publicProvider } = provider;
    return publicProvider;
  });
}

function reconcileCatalogProviders(kind, savedProviders) {
  const catalogProviders = desktopCatalogProviders(kind);
  const configuredCount = providerCatalog(kind).length;
  const saved = Array.isArray(savedProviders) ? savedProviders : [];
  return catalogProviders.map((provider, index) => {
    // Built-in provider slots are application-owned. Always refresh their
    // display name, endpoint, protocol, model and capabilities from the
    // catalog so an older data.json cannot put retired models back into the
    // UI after an application update.
    if (index < configuredCount) return provider;

    // Slots after the built-in catalog remain available for private/custom
    // providers. Preserve them across catalog upgrades.
    const custom = saved.find((entry) => entry && entry.id === provider.id) || saved[index];
    return custom && typeof custom === 'object'
      ? { ...provider, ...custom, id: provider.id }
      : provider;
  });
}

function availableProviderId(providers, requestedId, fallbackId) {
  const requested = String(requestedId || '').trim();
  const selected = providers.find((provider) => (
    provider && provider.id === requested && provider.name && provider.endpoint
  ));
  if (selected) return selected.id;
  const fallback = providers.find((provider) => provider && provider.name && provider.endpoint);
  return fallback ? fallback.id : fallbackId;
}

function defaultData() {
  return {
    files: [],            // { id, name, originalPath, storedPath, importedAt, sourceFolder, sizeBytes, folderId }
    folders: [],           // { id, name, createdAt, parentId } — parentId is null for top-level folders
    deletions: [],         // log of permanently-deleted files (for duplicate-detection / achievement 3)
    boardItems: [],        // { id, fileId, canvasId, x, y, zIndex }
    // Append-only local accounting history. Entries are not removed when an
    // output file or board item is deleted, so canvas totals survive updates.
    canvasUsageLedger: [],
    canvasProjects: [ // { id, name, scope: 'personal' | 'team', createdAt }
      { id: 'project-1', name: 'General', scope: 'personal', createdAt: Date.now() }
    ],
    canvases: [
      { id: 'canvas-1', projectId: 'project-1', name: 'Untitled', createdAt: Date.now(), updatedAt: Date.now() }
    ],
    usage: {
      totalSeconds: 0,
      firstRunAt: null,
      lastRunAt: null,
      sessionStartedAt: null,
      importDays: []        // ["2026-06-29", ...] distinct calendar days a file was imported
    },
    // Canvas Agent conversations are local-first and intentionally kept out
    // of the cloud chat tables. The main process owns this field so an app
    // update or renderer reload cannot discard the conversation history.
    canvasAgentHistory: [],
    aiAssistantHistory: [],
    // Opaque Butler task metadata is kept locally so a renderer reload or a
    // desktop update can resume polling without submitting a paid task twice.
    butlerTasks: [],
    butlerDeliveries: [],
    // Generated media stays pending until the renderer confirms that its
    // file and canvas item were persisted successfully.
    aiMediaDeliveries: [],
    aiMediaDeliveryGroups: [],
    desktopWatch: {
      lastDesktopFileCount: null,
      lastCheckedDay: null,
      clutterStreakDays: 0,
      lastTextDocSeenAt: null
    },
    achievements: {
      first_import: { unlocked: false, unlockedAt: null },
      deep_search: { unlocked: false, unlockedAt: null },
      final_version: { unlocked: false, unlockedAt: null },
      lost_folder: { unlocked: false, unlockedAt: null },
      no_clutter_month: { unlocked: false, unlockedAt: null },
      minimalist: { unlocked: false, unlockedAt: null }
    },
    membership: makeDefaultMembershipState(),
    settings: {
      theme: 'light',
      language: 'ko',
      textSize: 'medium',
      colorProfile: 'auto',
      autoUpdateEnabled: true,
      activation: {
        schemaVersion: 2,
        verifiedHash: null,
        grantId: null,
        activatedAt: null
      },
      profileAvatarPath: null,
      profileDisplayName: '',
      profileSignature: '',
      libraryRootPath: null,
      customLibraryPath: null,  // when set, every imported file is also mirrored here
      sidebarCollapsed: false,
      aiMedia: {
        providerDefaultsVersion: PROVIDER_CATALOG_VERSION,
        imageEndpoint: providerCatalog('image')[0].endpoint,
        imageProviders: desktopCatalogProviders('image'),
        activeImageProviderId: 'image-1',
        videoEndpoint: providerCatalog('video')[0].endpoint,
        videoProviderName: providerCatalog('video')[0].name,
        videoProviders: desktopCatalogProviders('video'),
        activeVideoProviderId: 'video-1',
        chatProviderName: providerCatalog('chat').find((provider) => provider.hidden !== true)?.name || 'Gemini 3.1 Pro',
        chatEndpoint: providerCatalog('chat').find((provider) => provider.hidden !== true)?.endpoint || '',
        chatModel: providerCatalog('chat').find((provider) => provider.hidden !== true)?.models?.[0] || DEFAULT_CHAT_MODEL,
        chatProviders: desktopCatalogProviders('chat'),
        activeChatProviderId: DEFAULT_CHAT_PROVIDER_ID,
        resultEndpoint: 'https://api.quickrouter.ai/v1/videos',
        imageSize: '1K',
        imageAspectRatio: 'auto',
        videoAspectRatio: '16:9',
        videoDuration: 6
      },
      viewMode: 'grid',          // 'grid' | 'list' — how folder contents are browsed
      defaultFolderName: 'Library'  // the always-present, undeletable folder that newly
                                  // imported (unfiled) files live in — folderId: null
    }
  };
}

function upgradeAiDefaults(data) {
  const media = data && data.settings && data.settings.aiMedia;
  if (!media) return data;
  const previousCatalogVersion = Number(media.providerDefaultsVersion) || 0;
  const images = reconcileCatalogProviders('image', media.imageProviders);
  const videos = reconcileCatalogProviders('video', media.videoProviders);
  const chats = reconcileCatalogProviders('chat', media.chatProviders);
  media.imageProviders = images;
  media.activeImageProviderId = availableProviderId(images,
    previousCatalogVersion < PROVIDER_CATALOG_VERSION ? 'image-1' : media.activeImageProviderId,
    'image-1');
  const activeImage = images.find((provider) => provider.id === media.activeImageProviderId) || images[0];
  media.imageEndpoint = activeImage.endpoint;
  media.videoProviders = videos;
  media.activeVideoProviderId = availableProviderId(videos,
    previousCatalogVersion < PROVIDER_CATALOG_VERSION ? 'video-1' : media.activeVideoProviderId,
    'video-1');
  const activeVideo = videos.find((provider) => provider.id === media.activeVideoProviderId) || videos[0];
  media.videoEndpoint = activeVideo.endpoint;
  media.videoProviderName = activeVideo.name;
  media.chatProviders = chats;
  media.activeChatProviderId = availableProviderId(chats, media.activeChatProviderId, DEFAULT_CHAT_PROVIDER_ID);
  const activeChat = chats.find((provider) => provider.id === media.activeChatProviderId) || chats[0];
  media.chatProviderName = activeChat.name;
  media.chatEndpoint = activeChat.endpoint;
  media.chatModel = Array.isArray(activeChat.models) && activeChat.models.includes(media.chatModel)
    ? media.chatModel
    : activeChat.models[0];
  media.resultEndpoint = 'https://api.quickrouter.ai/v1/videos';
  media.providerDefaultsVersion = PROVIDER_CATALOG_VERSION;
  return data;
}

class Store {
  constructor(libraryRootDir) {
    this.dir = libraryRootDir;
    this.dataPath = path.join(this.dir, 'data.json');
    this.libraryDir = path.join(this.dir, 'library');
    this._ensureDirs();
    this.data = this._load();
    this.fileIndex = new Map();
    this.reindexFiles();
    this._saveTimer = null;
    this._savePending = false;
    this._saveVersion = Number(this._loadedStoreRevision) || 0;
    this._saveEpoch = 0;
    this._saveQueue = Promise.resolve();
    this._saveRetryDelay = 250;
  }

  _ensureDirs() {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.mkdirSync(this.libraryDir, { recursive: true });
  }

  _load() {
    const candidates = [];
    const readCandidate = (filePath) => {
      try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) return;
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const revision = Number(parsed && parsed._storeRevision) || 0;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          delete parsed._storeRevision;
        }
        candidates.push({
          data: deepMerge(defaultData(), upgradeAiDefaults(parsed)),
          revision,
          mtimeMs: Number(stat.mtimeMs) || 0,
          filePath
        });
      } catch (err) {
        // A partially written snapshot is ignored. The previous valid file
        // remains the source of truth until a complete snapshot is available.
      }
    };

    readCandidate(this.dataPath);
    try {
      const baseName = path.basename(this.dataPath);
      const temporaryNames = fs.readdirSync(this.dir, { withFileTypes: true })
        .filter((entry) => entry.isFile()
          && (entry.name === `${baseName}.tmp`
            || (entry.name.startsWith(`${baseName}.`) && entry.name.endsWith('.tmp'))))
        .map((entry) => path.join(this.dir, entry.name));
      temporaryNames.forEach(readCandidate);
    } catch (err) {
      // The directory is created before loading, but a failed recovery scan
      // must never prevent the app from opening the library.
    }

    if (!candidates.length) return defaultData();
    const hasRevision = candidates.some((candidate) => candidate.revision > 0);
    candidates.sort((a, b) => hasRevision
      ? (b.revision - a.revision) || (b.mtimeMs - a.mtimeMs)
      : b.mtimeMs - a.mtimeMs);
    // A process crash can leave a fully written temporary snapshot behind.
    // Prefer it only when it is newer than the formal data file; stale files
    // must never roll a library back to an older state.
    this._loadedStoreRevision = candidates[0].revision;
    return candidates[0].data;
  }

  /**
   * O(1) file lookups by id. With a few hundred files, `store.data.files
   * .find(...)` everywhere was unnoticeable — with several thousand, doing
   * that on every thumbnail request (each protocol request is its own
   * linear scan) turns "render the file list" into an O(n²) operation and
   * is one of the bigger contributors to the app bogging down once a
   * library gets large. The index is kept alongside the plain array (which
   * still exists for ordering/iteration/JSON-serialization) rather than
   * replacing it, so existing array-based code keeps working unchanged.
   */
  reindexFiles() {
    this.fileIndex.clear();
    for (const f of this.data.files) this.fileIndex.set(f.id, f);
  }

  getFile(id) {
    return this.fileIndex.get(id) || null;
  }

  addFile(record) {
    this.data.files.push(record);
    this.fileIndex.set(record.id, record);
  }

  /** Removes and returns the file record, or null if it wasn't found. */
  removeFileById(id) {
    const idx = this.data.files.findIndex((x) => x.id === id);
    if (idx === -1) return null;
    const [f] = this.data.files.splice(idx, 1);
    this.fileIndex.delete(id);
    return f;
  }

  save() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    this._savePending = false;
    this._saveVersion += 1;
    this._saveEpoch += 1;
    this._writeSnapshotSync(this._snapshotJson(this._saveVersion));
  }

  _temporarySnapshotPath() {
    return `${this.dataPath}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`;
  }

  _snapshotJson(version) {
    return JSON.stringify({ ...this.data, _storeRevision: version }, null, 2);
  }

  _writeSnapshotSync(json) {
    const tmpPath = this._temporarySnapshotPath();
    let handle;
    try {
      handle = fs.openSync(tmpPath, 'wx', 0o600);
      fs.writeFileSync(handle, json, 'utf-8');
      fs.fsyncSync(handle);
      fs.closeSync(handle);
      handle = null;
      fs.renameSync(tmpPath, this.dataPath);
    } finally {
      if (handle !== undefined && handle !== null) {
        try { fs.closeSync(handle); } catch (err) {}
      }
      try { fs.rmSync(tmpPath, { force: true }); } catch (err) {}
    }
  }

  async _writeSnapshot(json, version, epoch) {
    const tmpPath = this._temporarySnapshotPath();
    let handle = null;
    try {
      handle = await fs.promises.open(tmpPath, 'wx', 0o600);
      await handle.writeFile(json, 'utf-8');
      await handle.sync();
      await handle.close();
      handle = null;

      // The final rename is intentionally synchronous. It is tiny, and this
      // prevents flushSync() from interleaving between the freshness check and
      // the replacement of data.json while an async write is in flight.
      if (epoch !== this._saveEpoch || version !== this._saveVersion) return false;
      fs.renameSync(tmpPath, this.dataPath);
      this._saveRetryDelay = 250;
      return true;
    } finally {
      if (handle) await handle.close().catch(() => {});
      await fs.promises.rm(tmpPath, { force: true }).catch(() => {});
    }
  }

  _scheduleSaveRetry() {
    if (this._saveTimer) return;
    const delay = this._saveRetryDelay;
    this._saveRetryDelay = Math.min(10_000, Math.max(250, delay * 2));
    this._saveTimer = setTimeout(() => {
      this._flush().catch(() => {});
    }, delay);
    this._saveTimer.unref?.();
  }

  /**
   * Most call sites don't need the write to have landed on disk before
   * they return — they just need it to happen *soon* and not block
   * anything in the meantime. Doing a synchronous `JSON.stringify` +
   * `writeFileSync` of the *entire* library on every single action (every
   * drag, every rename, every board-item nudge) is fine for a few hundred
   * files but becomes a real, repeated main-process stall once the library
   * (and therefore data.json) grows — Electron's main process is
   * single-threaded, and a sync write there blocks every pending IPC call
   * from the renderer until it finishes, which is felt as the whole UI
   * freezing for a beat.
   *
   * scheduleSave() coalesces bursts of calls (e.g. dragging a board item
   * fires upsert on every step) into one write ~250ms after the last one,
   * and performs that write with the async fs API so it never blocks the
   * event loop. Call save() directly only where a write must be guaranteed
   * to have happened before continuing (e.g. right before the app quits).
   */
  scheduleSave() {
    this._savePending = true;
    this._saveVersion += 1;
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._flush().catch(() => {});
    }, 250);
    this._saveTimer.unref?.();
  }

  async _flush() {
    this._saveTimer = null;
    if (!this._savePending) return;
    this._savePending = false;
    const version = this._saveVersion;
    const epoch = ++this._saveEpoch;
    const json = this._snapshotJson(version);
    const writePromise = this._saveQueue.then(() => this._writeSnapshot(json, version, epoch));
    this._saveQueue = writePromise.catch((err) => {
      this._savePending = true;
      console.error('Failed to save store:', err.message);
      this._scheduleSaveRetry();
    });
    return writePromise;
  }

  /** Waits until every mutation queued before this call has reached disk. */
  async flush() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    for (;;) {
      if (this._savePending) await this._flush();
      await this._saveQueue;
      if (this._saveTimer) {
        clearTimeout(this._saveTimer);
        this._saveTimer = null;
      }
      if (!this._savePending) return;
    }
  }

  /** Forces any pending debounced save to happen immediately and
      synchronously — used right before the app quits, when there's no more
      event loop left for an async write to complete on. */
  flushSync() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    // There may already be an async write in the queue even when the pending
    // flag is clear. Always write the current snapshot before shutdown so an
    // in-flight older snapshot cannot be the last state on disk.
    this._savePending = false;
    this._saveVersion += 1;
    this._saveEpoch += 1;
    this._writeSnapshotSync(this._snapshotJson(this._saveVersion));
  }

  /** Folder where mirrored copies live when a custom library path is set, or null. */
  getMirrorLibraryDir() {
    const custom = this.data.settings.customLibraryPath;
    return custom ? path.join(custom, 'library') : null;
  }

  /** Copies one already-imported file's stored copy into the mirror location, if one is set. */
  mirrorFileToCustomPath(fileRecord) {
    const mirrorDir = this.getMirrorLibraryDir();
    if (!mirrorDir) return;
    try {
      const relative = path.relative(this.libraryDir, fileRecord.storedPath);
      const dest = path.join(mirrorDir, relative);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(fileRecord.storedPath, dest);
    } catch (err) {
      console.error('Failed to mirror file to custom library path:', err.message);
    }
  }

  async mirrorFileToCustomPathAsync(fileRecord) {
    const mirrorDir = this.getMirrorLibraryDir();
    if (!mirrorDir) return;
    try {
      const relative = path.relative(this.libraryDir, fileRecord.storedPath);
      const dest = path.join(mirrorDir, relative);
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });
      await fs.promises.copyFile(fileRecord.storedPath, dest);
    } catch (err) {
      console.error('Failed to mirror file to custom library path:', err.message);
    }
  }

  /**
   * Switches on (or updates) a second save location. Per spec, switching to a
   * custom location does not replace the default C:\MesssLibrary — every file
   * ends up saved in both places. Existing files are copied over immediately;
   * new imports get mirrored automatically from then on (see mirrorFileToCustomPath).
   */
  async setCustomLibraryPath(newPath) {
    this.data.settings.customLibraryPath = newPath || null;
    this.save();
    if (newPath) {
      for (const f of this.data.files) {
        await this.mirrorFileToCustomPathAsync(f);
      }
    }
  }

  /**
   * Moves the complete local store into a user-selected folder. The caller is
   * responsible for persisting the startup pointer after the copy verifies.
   * The old folder is intentionally retained as a backup until the next
   * successful launch.
   */
  async moveLibraryTo(newRoot) {
    const target = path.resolve(String(newRoot || '').trim());
    const source = path.resolve(this.dir);
    const samePath = process.platform === 'win32'
      ? target.toLowerCase() === source.toLowerCase()
      : target === source;
    if (!target || !path.isAbsolute(target)) {
      throw Object.assign(new Error('Choose a valid storage location.'), { code: 'storage-path-invalid' });
    }
    if (samePath) return source;
    const relativeTarget = path.relative(source, target);
    const relativeSource = path.relative(target, source);
    if (!relativeTarget || (!relativeTarget.startsWith(`..${path.sep}`) && relativeTarget !== '..' && !path.isAbsolute(relativeTarget))
      || (!relativeSource.startsWith(`..${path.sep}`) && relativeSource !== '..' && !path.isAbsolute(relativeSource))) {
      throw Object.assign(new Error('The new storage location cannot be inside the current library.'), {
        code: 'storage-path-nested'
      });
    }
    await fs.promises.mkdir(target, { recursive: true });
    if ((await fs.promises.readdir(target)).length) {
      throw Object.assign(new Error('Choose an empty folder so the existing library can be moved safely.'), {
        code: 'storage-path-not-empty'
      });
    }
    await this.flush();
    let targetDataPath;
    let targetLibraryDir;
    try {
      const entries = await fs.promises.readdir(source, { withFileTypes: true });
      for (const entry of entries) {
        const from = path.join(source, entry.name);
        const to = path.join(target, entry.name);
        if (entry.isDirectory()) await fs.promises.cp(from, to, { recursive: true, errorOnExist: true });
        else if (entry.isFile()) await fs.promises.copyFile(from, to);
        else throw Object.assign(new Error('The storage location contains an unsupported link.'), { code: 'storage-link-not-supported' });
      }
      targetDataPath = path.join(target, 'data.json');
      targetLibraryDir = path.join(target, 'library');
      const targetLibraryStat = await fs.promises.stat(targetLibraryDir).catch(() => null);
      if (!fs.existsSync(targetDataPath) || !targetLibraryStat || !targetLibraryStat.isDirectory()) {
        throw Object.assign(new Error('The library could not be copied completely.'), { code: 'storage-copy-incomplete' });
      }
    } catch (error) {
      await fs.promises.rm(target, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
    const relocate = (value) => {
      const absolute = String(value || '').trim();
      if (!absolute || !path.isAbsolute(absolute)) return value;
      const relative = path.relative(source, absolute);
      const inside = relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
      return inside ? path.join(target, relative) : value;
    };
    for (const file of this.data.files) file.storedPath = relocate(file.storedPath);
    this.data.settings.profileAvatarPath = relocate(this.data.settings.profileAvatarPath);
    this.data.settings.libraryRootPath = target;
    this.dir = target;
    this.dataPath = targetDataPath;
    this.libraryDir = targetLibraryDir;
    this.data.settings.customLibraryPath = null;
    this.save();
    return target;
  }
}

function deepMerge(base, override) {
  if (Array.isArray(base)) return Array.isArray(override) ? override : base;
  if (typeof base === 'object' && base !== null) {
    const out = {
      ...base,
      ...(typeof override === 'object' && override !== null ? override : {})
    };
    if (typeof override === 'object' && override !== null) {
      for (const key of Object.keys(base)) {
        out[key] = deepMerge(base[key], override[key]);
      }
    }
    return out;
  }
  return override === undefined ? base : override;
}

module.exports = {
  Store,
  desktopCatalogProviders,
  reconcileCatalogProviders,
  upgradeAiDefaults
};
