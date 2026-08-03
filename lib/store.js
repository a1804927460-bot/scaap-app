'use strict';
/**
 * Lightweight JSON-file data store with atomic writes.
 * No native/database dependencies, so it works offline with zero install issues.
 */
const fs = require('fs');
const path = require('path');
const { makeDefaultMembershipState } = require('./membership-service');

function defaultData() {
  return {
    files: [],            // { id, name, originalPath, storedPath, importedAt, sourceFolder, sizeBytes, folderId }
    folders: [],           // { id, name, createdAt, parentId } — parentId is null for top-level folders
    deletions: [],         // log of permanently-deleted files (for duplicate-detection / achievement 3)
    boardItems: [],        // { id, fileId, canvasId, x, y, zIndex }
    canvasProjects: [
      { id: 'project-1', name: 'General', createdAt: Date.now() }
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
      theme: 'dark',
      language: 'en',
      customLibraryPath: null,  // when set, every imported file is also mirrored here
      sidebarCollapsed: false,
      aiMedia: {
        providerDefaultsVersion: 2,
        imageEndpoint: 'https://api.quickrouter.ai/v1/images/generations?model=gpt-image-1',
        imageProviders: Array.from({ length: 10 }, (_, index) => ({
          id: `image-${index + 1}`,
          name: index === 0 ? 'QuickRouter GPT Image' : '',
          endpoint: index === 0 ? 'https://api.quickrouter.ai/v1/images/generations?model=gpt-image-1' : ''
        })),
        activeImageProviderId: 'image-1',
        videoEndpoint: 'https://api.quickrouter.ai/v1/videos?model=sora-2',
        videoProviderName: 'QuickRouter Sora 2',
        videoProviders: Array.from({ length: 10 }, (_, index) => ({
          id: `video-${index + 1}`,
          name: index === 0 ? 'QuickRouter Sora 2' : '',
          endpoint: index === 0 ? 'https://api.quickrouter.ai/v1/videos?model=sora-2' : ''
        })),
        activeVideoProviderId: 'video-1',
        chatProviderName: 'Messs AI',
        chatEndpoint: 'https://api.quickrouter.ai/v1',
        chatModel: 'gpt-4o-mini',
        chatProviders: Array.from({ length: 10 }, (_, index) => ({
          id: `chat-${index + 1}`,
          name: index === 0 ? 'QuickRouter' : '',
          endpoint: index === 0 ? 'https://api.quickrouter.ai/v1' : '',
          models: index === 0 ? ['gemini-2.5-pro', 'gemini-2.5-flash'] : []
        })),
        activeChatProviderId: 'chat-1',
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
  if (Number(media.providerDefaultsVersion) >= 2) return data;
  const firstImage = Array.isArray(media.imageProviders) ? media.imageProviders[0] : null;
  if (firstImage) {
    firstImage.name = 'QuickRouter GPT Image';
    firstImage.endpoint = 'https://api.quickrouter.ai/v1/images/generations?model=gpt-image-1';
    media.imageEndpoint = firstImage.endpoint;
  }
  const firstVideo = Array.isArray(media.videoProviders) ? media.videoProviders[0] : null;
  if (firstVideo) {
    firstVideo.name = 'QuickRouter Sora 2';
    firstVideo.endpoint = 'https://api.quickrouter.ai/v1/videos?model=sora-2';
    media.videoEndpoint = firstVideo.endpoint;
    media.videoProviderName = firstVideo.name;
  }
  const firstChat = Array.isArray(media.chatProviders) ? media.chatProviders[0] : null;
  if (firstChat) {
    firstChat.name = 'QuickRouter Chat';
    firstChat.endpoint = 'https://api.quickrouter.ai/v1';
    media.chatEndpoint = firstChat.endpoint;
  }
  media.resultEndpoint = 'https://api.quickrouter.ai/v1/videos';
  media.providerDefaultsVersion = 2;
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
  }

  _ensureDirs() {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.mkdirSync(this.libraryDir, { recursive: true });
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.dataPath, 'utf-8');
      const parsed = JSON.parse(raw);
      // Merge with defaults so new fields introduced in later versions don't crash old data files.
      return deepMerge(defaultData(), upgradeAiDefaults(parsed));
    } catch (err) {
      return defaultData();
    }
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
    const tmpPath = this.dataPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, this.dataPath);
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
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => this._flush(), 250);
  }

  async _flush() {
    this._saveTimer = null;
    if (!this._savePending) return;
    this._savePending = false;
    const tmpPath = this.dataPath + '.tmp';
    const json = JSON.stringify(this.data, null, 2);
    try {
      await fs.promises.writeFile(tmpPath, json, 'utf-8');
      await fs.promises.rename(tmpPath, this.dataPath);
    } catch (err) {
      console.error('Failed to save store:', err.message);
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
    if (!this._savePending) return;
    this._savePending = false;
    this.save();
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

module.exports = { Store };
