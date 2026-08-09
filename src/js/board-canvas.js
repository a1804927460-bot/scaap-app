'use strict';
/* Infinite board canvas: pan, zoom, drag items in from sidebar/preview, reposition freely. */

const BoardEngine = window.MesssBoardEngine;
const BOARD_ZOOM_MIN = 0.03;
const BOARD_ZOOM_MAX = 32;
const BOARD_MOUNTS_PER_FRAME = 8;
const BOARD_MEDIA_MOUNTS_PER_FRAME = 2;
const BOARD_DOM_ITEM_LIMIT = 320;
const BOARD_DOM_ITEM_EXIT_LIMIT = 240;
const BOARD_DOM_RETAIN_LIMIT = BOARD_DOM_ITEM_LIMIT;
const BOARD_OVERVIEW_ITEM_THRESHOLD = 180;
const BOARD_FULL_IMAGE_LIMIT = 8;
const BOARD_FULL_IMAGE_CACHE_LIMIT = 8;
const BOARD_THUMBNAIL_MAX_EDGE = 400;
const BOARD_FULL_IMAGE_MIN_SCREEN_EDGE = 220;
const BOARD_SELECTED_FULL_IMAGE_MIN_SCREEN_EDGE = 150;
const BOARD_FULL_IMAGE_PREWARM_SCREEN_EDGE = 140;
const BOARD_QUALITY_SETTLE_MS = 90;
const BOARD_VIEW_STORAGE_KEY = 'messs.board.viewport.v2';
const BOARD_OVERVIEW_DPR = 1;
const BOARD_OVERVIEW_IMAGE_LIMIT = 1600;
const BOARD_OVERVIEW_IMAGE_CACHE_LIMIT = 1800;
const BOARD_OVERVIEW_IMAGE_PIXEL_BUDGET = 24_000_000;
const BOARD_OVERVIEW_IMAGE_CONCURRENCY = 16;
const BOARD_OVERVIEW_IMAGE_MAX_EDGE = 192;
const BOARD_WHEEL_MAX_DELTA = 120;
const BOARD_WHEEL_PAN_GAIN = 0.78;
const BOARD_WHEEL_ZOOM_RATE = 0.00125;
const BOARD_MOVE_HISTORY_LIMIT = 100;

const Board = {
  panX: 200,
  panY: 200,
  zoom: 1,
  isPanning: false,
  panStart: null,
  transformFrame: 0,
  transformSettleTimer: 0,
  zoomFrame: 0,
  zoomTarget: null,
  zoomLastTime: 0,
  reconcileFrame: 0,
  mountFrame: 0,
  qualityTimer: 0,
  qualityIdle: 0,
  interactingUntil: 0,
  persistTimer: 0,
  spatialIndex: BoardEngine.createSpatialIndex(400),
  mounted: new Map(),
  mountQueue: new Set(),
  metrics: new Map(),
  filesById: new Map(),
  itemsById: new Map(),
  selectedCount: 0,
  lastMountHash: null,
  lastKeepHash: null,
  lastZoomBucket: null,
  zoomLod: null,
  densityOverview: false,
  lastDragEndedAt: 0,
  lastPanEndedAt: 0,
  visibleIds: new Set(),
  overviewCanvas: null,
  overviewImageCache: new Map(),
  overviewImagePending: new Map(),
  overviewImageQueue: [],
  overviewImageActive: 0,
  overviewImagePixels: 0,
  overviewRedrawFrame: 0,
  overviewImageFailed: new Set(),
  fullImageCache: new Map(),
  fullImagePending: new Map(),
  fullImagePrewarmTimer: 0,
  failedFullImageSources: new Set(),
  resizeObserver: null,
  clipboardPastePromise: null,
  historyPersistPromise: Promise.resolve()
};

const BoardMoveHistory = new Map();

function boardMoveHistoryState(canvasId = activeCanvasId()) {
  if (!BoardMoveHistory.has(canvasId)) {
    BoardMoveHistory.set(canvasId, { undo: [], redo: [] });
  }
  return BoardMoveHistory.get(canvasId);
}

function recordBoardMoveHistory(startPositions) {
  const changes = startPositions.map(({ item, startLeft, startTop }) => ({
    id: item.id,
    before: { x: startLeft, y: startTop },
    after: { x: item.x, y: item.y }
  })).filter((change) => (
    change.before.x !== change.after.x || change.before.y !== change.after.y
  ));
  if (!changes.length) return false;

  const state = boardMoveHistoryState();
  state.undo.push({ changes });
  if (state.undo.length > BOARD_MOVE_HISTORY_LIMIT) state.undo.shift();
  state.redo.length = 0;
  return true;
}

function persistBoardMoveHistory(items, canvasId = activeCanvasId()) {
  Board.historyPersistPromise = Board.historyPersistPromise
    .catch(() => {})
    .then(async () => {
      if (typeof window.messsAPI.upsertBoardItems === 'function') {
        await window.messsAPI.upsertBoardItems(items);
      } else {
        await Promise.all(items.map((item) => window.messsAPI.upsertBoardItem(item)));
      }
      canvasWorkspaceTouch(canvasId);
      await canvasWorkspaceSave();
    });
}

function applyBoardMoveHistory(entry, direction) {
  const changedItems = [];
  entry.changes.forEach((change) => {
    const item = Board.itemsById.get(change.id) || AppState.boardItems.find((candidate) => candidate.id === change.id);
    if (!item) return;
    const position = change[direction];
    item.x = position.x;
    item.y = position.y;
    updateBoardItemIndex(item);
    const element = Board.mounted.get(item.id) || document.querySelector(`.board-item[data-board-id="${item.id}"]`);
    if (element) {
      element.style.left = `${item.x}px`;
      element.style.top = `${item.y}px`;
    }
    changedItems.push(item);
  });
  if (!changedItems.length) return false;
  markBoardInteraction();
  scheduleBoardReconcile();
  persistBoardMoveHistory(changedItems);
  return true;
}

function undoBoardMove() {
  const state = boardMoveHistoryState();
  const entry = state.undo.pop();
  if (!entry) return false;
  if (!applyBoardMoveHistory(entry, 'before')) return false;
  state.redo.push(entry);
  return true;
}

function redoBoardMove() {
  const state = boardMoveHistoryState();
  const entry = state.redo.pop();
  if (!entry) return false;
  if (!applyBoardMoveHistory(entry, 'after')) return false;
  state.undo.push(entry);
  return true;
}

// In-app clipboard for board items (Ctrl+C/V) �?intentionally separate from
// the OS clipboard. Copies the item's data (file reference, position, size,
// or note text) so pasting creates a new independent board item, offset
// slightly so repeated pastes don't stack exactly on top of each other.
const BoardClipboard = { items: [], preferInternal: false };

function pasteBoardClipboard(atX, atY) {
  const offset = 28;
  const newItems = [];
  AppState.boardItems.forEach((item) => { item.selected = false; });

  BoardClipboard.items.forEach((srcItem, i) => {
    const newItem = {
      ...srcItem,
      id: (srcItem.isNote ? 'note_' : 'b_') + Math.random().toString(36).slice(2, 10),
      x: (atX !== undefined ? atX : srcItem.x + offset) + i * 12,
      y: (atY !== undefined ? atY : srcItem.y + offset) + i * 12,
      zIndex: AppState.boardItems.length + i + 1,
      canvasId: activeCanvasId(),
      selected: true
    };
    AppState.boardItems.push(newItem);
    canvasWorkspaceAddItem(newItem);
    newItems.push(newItem);
    window.messsAPI.upsertBoardItem(newItem);
  });

  renderBoard();
  return newItems;
}

// Caches resolved getPreview() results per file so re-rendering the board
// (which happens often �?on drag, add, remove) doesn't refetch every time.
const BoardPreviewCache = new Map();
const BoardPreviewPending = new Map();
const BOARD_PREVIEW_CACHE_LIMIT = 200;

function cacheBoardPreview(fileId, result) {
  if (BoardPreviewCache.has(fileId)) BoardPreviewCache.delete(fileId);
  BoardPreviewCache.set(fileId, result);
  while (BoardPreviewCache.size > BOARD_PREVIEW_CACHE_LIMIT) {
    BoardPreviewCache.delete(BoardPreviewCache.keys().next().value);
  }
}

function boardTransform() {
  return `translate3d(${Board.panX}px, ${Board.panY}px, 0) scale(${Board.zoom})`;
}

function boardZoomBucket() {
  Board.zoomLod = BoardEngine.resolveZoomLod(Board.zoom, Board.zoomLod);
  return Board.zoomLod;
}

function updateInfiniteGrid() {
  const viewport = document.getElementById('board-viewport');
  if (!viewport) return;
  let worldStep = 28;
  while (worldStep * Board.zoom < 14) worldStep *= 5;
  const screenStep = worldStep * Board.zoom;
  const offsetX = ((Board.panX % screenStep) + screenStep) % screenStep;
  const offsetY = ((Board.panY % screenStep) + screenStep) % screenStep;
  viewport.style.setProperty('--board-grid-step', `${screenStep}px`);
  viewport.style.setProperty('--board-grid-x', `${offsetX}px`);
  viewport.style.setProperty('--board-grid-y', `${offsetY}px`);
}

function boardViewportStorageKey(canvasId = activeCanvasId()) {
  return `${BOARD_VIEW_STORAGE_KEY}.${encodeURIComponent(canvasId)}`;
}

function persistBoardViewport(canvasId = activeCanvasId(), view = Board) {
  try {
    localStorage.setItem(boardViewportStorageKey(canvasId), JSON.stringify({
      panX: view.panX,
      panY: view.panY,
      zoom: view.zoom
    }));
  } catch (err) {}
}

function scheduleBoardViewportSave() {
  const panel = document.getElementById('board-panel');
  if (panel && panel.classList.contains('is-canvas-library')) return;
  const canvasId = activeCanvasId();
  const view = { panX: Board.panX, panY: Board.panY, zoom: Board.zoom };
  clearTimeout(Board.persistTimer);
  Board.persistTimer = setTimeout(() => {
    persistBoardViewport(canvasId, view);
  }, 350);
}

function flushBoardViewportSave() {
  clearTimeout(Board.persistTimer);
  Board.persistTimer = 0;
  persistBoardViewport();
}

function restoreBoardViewport(canvasId = activeCanvasId()) {
  try {
    const raw = localStorage.getItem(boardViewportStorageKey(canvasId));
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (!Number.isFinite(saved.panX) || !Number.isFinite(saved.panY) || !Number.isFinite(saved.zoom)) {
      return false;
    }
    Board.panX = saved.panX;
    Board.panY = saved.panY;
    Board.zoom = BoardEngine.clampZoom(saved.zoom, BOARD_ZOOM_MIN, BOARD_ZOOM_MAX);
    return true;
  } catch (err) {
    return false;
  }
}

function activeBoardImage(element) {
  return element.querySelector('.board-image-layer.is-active') ||
    element.querySelector('img[data-full-src]');
}

function cachedBoardFullImage(source) {
  const image = Board.fullImageCache.get(source);
  if (!image || !image.complete || !image.naturalWidth) return null;
  Board.fullImageCache.delete(source);
  Board.fullImageCache.set(source, image);
  return image;
}

function cacheBoardFullImage(source, image) {
  Board.fullImageCache.delete(source);
  Board.fullImageCache.set(source, image);
  while (Board.fullImageCache.size > BOARD_FULL_IMAGE_CACHE_LIMIT) {
    Board.fullImageCache.delete(Board.fullImageCache.keys().next().value);
  }
}

function preloadBoardFullImage(source) {
  if (!source || Board.failedFullImageSources.has(source)) return Promise.resolve(null);
  const cached = cachedBoardFullImage(source);
  if (cached) return Promise.resolve(cached);
  if (Board.fullImagePending.has(source)) return Board.fullImagePending.get(source);

  const image = new Image();
  image.decoding = 'async';
  image.fetchPriority = 'high';
  const request = new Promise((resolve) => {
    image.addEventListener('load', async () => {
      try {
        if (typeof image.decode === 'function') await image.decode();
      } catch (err) {}
      Board.fullImagePending.delete(source);
      if (!image.naturalWidth || !image.naturalHeight) {
        Board.failedFullImageSources.add(source);
        resolve(null);
        return;
      }
      cacheBoardFullImage(source, image);
      resolve(image);
    }, { once: true });
    image.addEventListener('error', () => {
      Board.fullImagePending.delete(source);
      Board.failedFullImageSources.add(source);
      resolve(null);
    }, { once: true });
  });
  Board.fullImagePending.set(source, request);
  image.src = source;
  return request;
}

function mountedFullImageCandidates(zoom, minimumScreenEdge) {
  const candidates = [];
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  for (const [id, element] of Board.mounted) {
    const image = activeBoardImage(element);
    const item = Board.itemsById.get(id);
    if (!image || !item || !Board.visibleIds.has(id)) continue;
    const file = Board.filesById.get(item.fileId);
    const fullSource = image.dataset.fullSrc || '';
    const thumbSource = image.dataset.thumbSrc || '';
    if (!fullSource || fullSource === thumbSource || Board.failedFullImageSources.has(fullSource)) continue;
    const sourceEdge = Math.max(
      Number(file && file.sourceWidth) || 0,
      Number(file && file.sourceHeight) || 0
    );
    if (sourceEdge > 0 && sourceEdge <= BOARD_THUMBNAIL_MAX_EDGE) continue;
    const bounds = boardItemBounds(item);
    const screenEdge = Math.max(bounds.w, bounds.h) * zoom * dpr;
    if (screenEdge < minimumScreenEdge) continue;
    candidates.push({
      id,
      image,
      source: fullSource,
      screenEdge,
      priority: (item.selected ? 1000000 : 0) + screenEdge
    });
  }
  return candidates.sort((a, b) => b.priority - a.priority);
}

function prewarmMountedFullImages(zoom) {
  mountedFullImageCandidates(zoom, BOARD_FULL_IMAGE_PREWARM_SCREEN_EDGE)
    .slice(0, BOARD_FULL_IMAGE_LIMIT)
    .forEach((entry) => { void preloadBoardFullImage(entry.source); });
}

function scheduleBoardFullImagePrewarm(zoom) {
  if (Board.fullImagePrewarmTimer) return;
  Board.fullImagePrewarmTimer = window.setTimeout(() => {
    Board.fullImagePrewarmTimer = 0;
    prewarmMountedFullImages(Number.isFinite(zoom) ? zoom : Board.zoom);
  }, 24);
}

function transitionBoardImageQuality(element, quality) {
  const stack = element.querySelector('.board-image-stack');
  const active = activeBoardImage(element);
  if (!stack || !active || active.dataset.quality === quality) return;
  if (stack.dataset.pendingQuality === quality) return;

  const source = quality === 'full' ? active.dataset.fullSrc : active.dataset.thumbSrc;
  const activeSource = active.dataset.quality === 'full'
    ? active.dataset.fullSrc
    : active.dataset.thumbSrc;
  if (!source) return;
  if (source === activeSource) {
    active.dataset.quality = quality;
    return;
  }
  if (quality === 'full' && Board.failedFullImageSources.has(source)) return;

  stack.querySelectorAll('.board-image-layer.is-pending').forEach((image) => image.remove());
  stack.dataset.pendingQuality = quality;
  const ready = quality === 'full' ? preloadBoardFullImage(source) : Promise.resolve(true);
  void ready.then((decoded) => {
    if (!decoded || !stack.isConnected || stack.dataset.pendingQuality !== quality) {
      if (stack.dataset.pendingQuality === quality) stack.dataset.pendingQuality = '';
      return;
    }
    const next = active.cloneNode(true);
    next.className = 'board-image-layer is-pending';
    next.removeAttribute('src');
    next.dataset.quality = quality;
    next.decoding = 'async';
    next.fetchPriority = quality === 'full' ? 'high' : 'low';
    next.style.opacity = '0';
    let revealed = false;
    const reveal = async () => {
      if (revealed) return;
      revealed = true;
      if (typeof next.decode === 'function') {
        try { await next.decode(); } catch (err) {}
      }
      if (!next.isConnected || stack.dataset.pendingQuality !== quality) return;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      next.style.opacity = '';
      next.classList.remove('is-pending');
      next.classList.add('is-active', 'is-quality-crossfading');
      active.classList.remove('is-active');
      stack.dataset.pendingQuality = '';
      window.setTimeout(() => {
        next.classList.remove('is-quality-crossfading');
        if (active.parentNode === stack) active.remove();
      }, 280);
    };
    next.addEventListener('load', reveal, { once: true });
    next.addEventListener('error', () => {
      if (quality === 'full') Board.failedFullImageSources.add(source);
      if (next.parentNode === stack) next.remove();
      if (stack.dataset.pendingQuality === quality) stack.dataset.pendingQuality = '';
    }, { once: true });
    stack.appendChild(next);
    next.src = source;
    if (next.complete && next.naturalWidth) queueMicrotask(reveal);
  });
}

function loadBoardPreview(fileId) {
  if (BoardPreviewCache.has(fileId)) return Promise.resolve(BoardPreviewCache.get(fileId));
  if (BoardPreviewPending.has(fileId)) return BoardPreviewPending.get(fileId);
  const request = Promise.resolve(window.messsAPI.getPreview(fileId))
    .then((result) => {
      cacheBoardPreview(fileId, result);
      BoardPreviewPending.delete(fileId);
      return result;
    })
    .catch((error) => {
      BoardPreviewPending.delete(fileId);
      throw error;
    });
  BoardPreviewPending.set(fileId, request);
  return request;
}

function scheduleMountedImageQuality(delay = BOARD_QUALITY_SETTLE_MS) {
  clearTimeout(Board.qualityTimer);
  if (Board.qualityIdle && typeof cancelIdleCallback === 'function') {
    cancelIdleCallback(Board.qualityIdle);
  }
  Board.qualityIdle = 0;
  Board.qualityTimer = window.setTimeout(() => {
    Board.qualityTimer = 0;
    const run = () => {
      Board.qualityIdle = 0;
      syncMountedImageQuality();
    };
    if (typeof requestIdleCallback === 'function') {
      Board.qualityIdle = requestIdleCallback(run, { timeout: 220 });
    } else {
      run();
    }
  }, delay);
}

function markBoardInteraction() {
  Board.interactingUntil = Date.now() + BOARD_QUALITY_SETTLE_MS;
  scheduleMountedImageQuality(BOARD_QUALITY_SETTLE_MS);
}

function syncMountedImageQuality() {
  if (Board.isPanning || Board.zoomFrame || Date.now() < Board.interactingUntil) {
    scheduleMountedImageQuality();
    return;
  }
  const detailCandidates = boardZoomBucket() === 'detail'
    ? mountedFullImageCandidates(Board.zoom, BOARD_SELECTED_FULL_IMAGE_MIN_SCREEN_EDGE)
      .filter((entry) => {
        const item = Board.itemsById.get(entry.id);
        return !!item && (item.selected || entry.screenEdge >= BOARD_FULL_IMAGE_MIN_SCREEN_EDGE);
      })
    : [];
  const fullIds = new Set(detailCandidates.slice(0, BOARD_FULL_IMAGE_LIMIT).map((entry) => entry.id));

  for (const [id, element] of Board.mounted) {
    const image = activeBoardImage(element);
    if (!image) continue;
    const quality = fullIds.has(id) ? 'full' : 'thumb';
    // Keep decoded full-resolution layers for the lifetime of the mounted
    // item. Downgrading on zoom-out and upgrading again on zoom-in makes the
    // same image visibly pulse between sharp and soft states.
    if (image.dataset.quality === 'full' && quality === 'thumb') continue;
    if (image.dataset.quality === quality) continue;
    transitionBoardImageQuality(element, quality);
  }
}

function applyBoardTransform() {
  if (Board.transformFrame) return;
  Board.transformFrame = requestAnimationFrame(() => {
    Board.transformFrame = 0;
    const canvas = document.getElementById('board-canvas');
    canvas.classList.add('is-transforming');
    canvas.style.transform = boardTransform();
    canvas.style.setProperty('--board-label-scale', String(Math.min(7, Math.max(1, 1 / Board.zoom))));
    canvas.style.setProperty(
      '--board-selection-width',
      `${Math.min(40, Math.max(0.2, 1.2 / Math.max(Board.zoom, 0.001)))}px`
    );
    document.getElementById('board-zoom-label').textContent = Math.round(Board.zoom * 100) + '%';
    updateInfiniteGrid();
    markBoardInteraction();
    clearTimeout(Board.transformSettleTimer);
    Board.transformSettleTimer = window.setTimeout(() => {
      canvas.classList.remove('is-transforming');
      scheduleMountedImageQuality(0);
    }, BOARD_QUALITY_SETTLE_MS + 30);
    scheduleBoardReconcile();
    scheduleBoardViewportSave();
  });
}

function setBoardZoomTarget(screenPoint, factor) {
  const target = Board.zoomTarget || {
    panX: Board.panX,
    panY: Board.panY,
    zoom: Board.zoom
  };
  Board.zoomTarget = BoardEngine.zoomAtPoint(
    target,
    screenPoint,
    factor,
    { min: BOARD_ZOOM_MIN, max: BOARD_ZOOM_MAX }
  );
  scheduleBoardFullImagePrewarm(Board.zoomTarget.zoom);
  if (!Board.zoomFrame) {
    Board.zoomLastTime = 0;
    Board.zoomFrame = requestAnimationFrame(stepBoardZoom);
  }
}

function resetBoardZoomTo100() {
  const viewport = document.getElementById('board-viewport');
  if (!viewport) return;
  if (Board.zoomFrame) cancelAnimationFrame(Board.zoomFrame);
  Board.zoomFrame = 0;
  Board.zoomTarget = null;
  Board.zoomLastTime = 0;

  const rect = viewport.getBoundingClientRect();
  const currentZoom = Number.isFinite(Board.zoom) && Board.zoom > 0 ? Board.zoom : 1;
  const resetView = BoardEngine.zoomAtPoint(
    { panX: Board.panX, panY: Board.panY, zoom: currentZoom },
    { x: rect.width / 2, y: rect.height / 2 },
    1 / currentZoom,
    { min: 1, max: 1 }
  );
  Board.panX = resetView.panX;
  Board.panY = resetView.panY;
  Board.zoom = 1;
  Board.zoomLod = null;
  applyBoardTransform();
}

function setBoardPanTarget(deltaX, deltaY) {
  const target = Board.zoomTarget || {
    panX: Board.panX,
    panY: Board.panY,
    zoom: Board.zoom
  };
  target.panX -= deltaX * BOARD_WHEEL_PAN_GAIN;
  target.panY -= deltaY * BOARD_WHEEL_PAN_GAIN;
  Board.zoomTarget = target;
  if (!Board.zoomFrame) {
    Board.zoomLastTime = 0;
    Board.zoomFrame = requestAnimationFrame(stepBoardZoom);
  }
}

function stepBoardZoom(now) {
  Board.zoomFrame = 0;
  const target = Board.zoomTarget;
  if (!target) return;
  const elapsed = Board.zoomLastTime ? Math.min(48, now - Board.zoomLastTime) : 16;
  Board.zoomLastTime = now;
  const blend = 1 - Math.exp(-elapsed / 48);
  Board.panX += (target.panX - Board.panX) * blend;
  Board.panY += (target.panY - Board.panY) * blend;
  Board.zoom += (target.zoom - Board.zoom) * blend;
  applyBoardTransform();

  const settled = Math.abs(target.zoom - Board.zoom) < 0.0005 &&
    Math.abs(target.panX - Board.panX) < 0.12 &&
    Math.abs(target.panY - Board.panY) < 0.12;
  if (settled) {
    Object.assign(Board, target);
    Board.zoomTarget = null;
    Board.zoomLastTime = 0;
    applyBoardTransform();
    return;
  }
  Board.zoomFrame = requestAnimationFrame(stepBoardZoom);
}

function clientToBoardCoords(clientX, clientY) {
  const viewport = document.getElementById('board-viewport');
  const rect = viewport.getBoundingClientRect();
  const x = (clientX - rect.left - Board.panX) / Board.zoom;
  const y = (clientY - rect.top - Board.panY) / Board.zoom;
  return { x, y };
}

function fitBoardItemsToViewport(items) {
  const viewport = document.getElementById('board-viewport');
  const rect = viewport.getBoundingClientRect();
  if (!items.length) {
    Board.zoom = 1;
    Board.panX = rect.width / 2;
    Board.panY = rect.height / 2;
    applyBoardTransform();
    return;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const item of items) {
    const bounds = Board.spatialIndex.getBounds(item.id) || boardItemBounds(item);
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.w);
    maxY = Math.max(maxY, bounds.y + bounds.h);
  }
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const padding = 64;
  Board.zoom = BoardEngine.clampZoom(
    Math.min(
      Math.max(1, rect.width - padding * 2) / width,
      Math.max(1, rect.height - padding * 2) / height
    ),
    BOARD_ZOOM_MIN,
    BOARD_ZOOM_MAX
  );
  Board.panX = (rect.width - width * Board.zoom) / 2 - minX * Board.zoom;
  Board.panY = (rect.height - height * Board.zoom) / 2 - minY * Board.zoom;
  applyBoardTransform();
}

function fitBoardToContent() {
  fitBoardItemsToViewport(AppState.boardItems);
}

function locateBoardImages() {
  const filesById = new Map(AppState.files.map((file) => [file.id, file]));
  const images = AppState.boardItems.filter((item) => {
    const file = filesById.get(item.fileId);
    return file && isImageExt(file.ext);
  });
  fitBoardItemsToViewport(images.length ? images : AppState.boardItems);
}

async function addFileToBoard(fileId, x, y) {
  await addFilesToBoard([fileId], x, y);
}

async function addFilesToBoard(fileIds, x, y, options = {}) {
  const ids = [...new Set(fileIds.filter(Boolean))];
  if (!ids.length) return;
  const columns = Math.max(1, Math.ceil(Math.sqrt(ids.length)));
  const changed = [];
  const existingByFileId = new Map(
    AppState.boardItems
      .filter((item) => item.fileId)
      .map((item) => [item.fileId, item])
  );

  for (const [index, fileId] of ids.entries()) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const itemX = Math.round(x - 110 + column * 244);
    const itemY = Math.round(y - 110 + row * 244);
    const exists = existingByFileId.get(fileId);
    const file = Board.filesById.get(fileId) || AppState.files.find((entry) => entry.id === fileId);
    const sourceWidth = Number(file && file.sourceWidth);
    const sourceHeight = Number(file && file.sourceHeight);
    const hasMediaDimensions = !!file && (isImageExt(file.ext) || isVideoExt(file.ext)) &&
      sourceWidth > 0 && sourceHeight > 0;
    let addCopy = false;
    if (exists && options.promptDuplicates && file && (isImageExt(file.ext) || isVideoExt(file.ext))) {
      addCopy = await showConfirmDialog({
        title: isVideoExt(file.ext)
          ? t('Video already on canvas', '视频已在画布中')
          : t('Image already on canvas', '图片已在画布中'),
        message: t(
          `"${file.name}" is already on this canvas. Add a copy?`,
          `“${file.name}”已经在当前画布中，是否添加副本？`
        ),
        confirmLabel: t('Add copy', '添加副本'),
        cancelLabel: t('Cancel', '取消'),
        danger: false
      });
      if (!addCopy) continue;
    }
    if (exists && !addCopy) {
      exists.x = itemX;
      exists.y = itemY;
      if (hasMediaDimensions) {
        exists.width = Number(exists.width) > 0 ? exists.width : 220;
        exists.height = Math.max(1, Math.round(exists.width * sourceHeight / sourceWidth));
      }
      changed.push(exists);
      continue;
    }
    const item = {
      id: 'b_' + Math.random().toString(36).slice(2, 10),
      fileId,
      x: itemX,
      y: itemY,
      width: 220,
      zIndex: AppState.boardItems.length + 1,
      canvasId: activeCanvasId()
    };
    if (hasMediaDimensions) {
      item.height = Math.max(1, Math.round(item.width * sourceHeight / sourceWidth));
    }
    AppState.boardItems.push(item);
    canvasWorkspaceAddItem(item);
    existingByFileId.set(fileId, item);
    changed.push(item);
  }

  if (typeof window.messsAPI.upsertBoardItems === 'function') {
    await window.messsAPI.upsertBoardItems(changed);
  } else {
    await Promise.all(changed.map((item) => window.messsAPI.upsertBoardItem(item)));
  }
  canvasWorkspaceTouch(activeCanvasId());
  await canvasWorkspaceSave();
  renderBoard();
  if (typeof renderCanvasLibrary === 'function') renderCanvasLibrary();
}

function removeBoardItemsForFile(fileId) {
  const removed = AppState.allBoardItems.filter((b) => b.fileId === fileId).map((b) => b.id);
  AppState.boardItems = AppState.boardItems.filter((b) => b.fileId !== fileId);
  canvasWorkspaceRemoveItems(removed);
  BoardPreviewCache.delete(fileId);
  renderBoard();
}

function boardVideoDurationSeconds(file) {
  const sourceDuration = Number(file && file.sourceDuration);
  if (sourceDuration > 0) return sourceDuration;
  const generatedDuration = Number(file && file.aiGeneration && (
    file.aiGeneration.duration || file.aiGeneration.requestedDuration
  ));
  return generatedDuration > 0 ? generatedDuration : 0;
}

function formatBoardVideoDuration(seconds) {
  const rounded = Math.max(0, Math.round(Number(seconds) || 0));
  if (rounded < 60) return `${rounded}s`;
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function createBoardVideoDurationBadge(file) {
  const badge = document.createElement('span');
  badge.className = 'board-video-duration';
  const duration = boardVideoDurationSeconds(file);
  badge.textContent = duration > 0 ? formatBoardVideoDuration(duration) : '--';
  badge.hidden = !(duration > 0);
  return badge;
}

function syncBoardMediaIntrinsicRatio(content, file, item, media) {
  const sourceWidth = Number(file.sourceWidth) || Number(media && (media.naturalWidth || media.videoWidth));
  const sourceHeight = Number(file.sourceHeight) || Number(media && (media.naturalHeight || media.videoHeight));
  if (!(sourceWidth > 0 && sourceHeight > 0)) return;
  if (!(Number(file.sourceWidth) > 0)) file.sourceWidth = sourceWidth;
  if (!(Number(file.sourceHeight) > 0)) file.sourceHeight = sourceHeight;
  const width = Math.max(1, Number(item.width) || 220);
  const expectedHeight = Math.max(1, Math.round(width * sourceHeight / sourceWidth));
  const element = content.closest('.board-item');
  if (element) {
    element.style.aspectRatio = `${sourceWidth} / ${sourceHeight}`;
    element.style.height = `${expectedHeight}px`;
  }
  if (Math.abs((Number(item.height) || 0) - expectedHeight) <= 1) return;
  item.height = expectedHeight;
  updateBoardItemIndex(item);
  if (window.messsAPI && typeof window.messsAPI.upsertBoardItem === 'function') {
    Promise.resolve(window.messsAPI.upsertBoardItem(item)).catch(() => {});
  }
}

function observeBoardMediaIntrinsicRatio(content, file, item, media) {
  const sync = () => syncBoardMediaIntrinsicRatio(content, file, item, media);
  media.addEventListener('load', sync, { once: true });
  media.addEventListener('loadedmetadata', sync, { once: true });
  if ((media.complete && media.naturalWidth) || media.videoWidth) queueMicrotask(sync);
}

/** Fills a board item's content area. Images render immediately (the URL is
    already known); everything else shows a placeholder icon right away,
    then upgrades in place to a real thumbnail/player once getPreview()
    resolves (cached so repeat renders are instant). */
function renderBoardItemContent(content, f, item) {
  if (isImageExt(f.ext)) {
    const thumbSource = resolveImageDisplaySource(f, false);
    const fullSource = resolveImageDisplaySource(f, true);
    const quality = cachedBoardFullImage(fullSource) ? 'full' : 'thumb';
    const initialSource = quality === 'full' ? fullSource : thumbSource;
    const stack = document.createElement('div');
    stack.className = 'board-image-stack';
    stack.dataset.pendingQuality = '';
    const img = document.createElement('img');
    img.className = 'board-image-layer is-active';
    img.src = initialSource;
    img.dataset.fullSrc = fullSource;
    img.dataset.thumbSrc = thumbSource;
    img.dataset.quality = quality;
    img.loading = 'eager';
    img.alt = f.name;
    img.draggable = false;
    img.decoding = 'async';
    img.fetchPriority = quality === 'full' ? 'high' : 'low';
    observeBoardMediaIntrinsicRatio(content, f, item, img);
    stack.appendChild(img);
    content.appendChild(stack);
    return;
  }

  if (isModelFile(f)) {
    const preview = document.createElement('div');
    preview.className = 'board-model-thumbnail';
    const previewSource = String(f.modelPreviewUrl || f.previewUrl || '');
    let previewRequested = false;
    const installPreview = (source) => {
      if (!source || !preview.isConnected && previewRequested) return;
      preview.querySelector('img')?.remove();
      const image = document.createElement('img');
      image.src = source;
      image.alt = f.name;
      image.loading = 'lazy';
      image.decoding = 'async';
      image.draggable = false;
      image.addEventListener('load', () => preview.classList.remove('is-placeholder'), { once: true });
      image.addEventListener('error', () => {
        image.remove();
        preview.classList.add('is-placeholder');
        requestPreview();
      }, { once: true });
      preview.prepend(image);
    };
    const requestPreview = () => {
      if (previewRequested || typeof window.requestBoardModelPreview !== 'function') return;
      previewRequested = true;
      preview.classList.add('is-rendering');
      window.requestBoardModelPreview(f).then((source) => {
        if (source && preview.isConnected) installPreview(source);
      }).catch(() => {}).finally(() => preview.classList.remove('is-rendering'));
    };
    preview.classList.add('is-placeholder');
    if (previewSource) installPreview(previewSource);
    else requestPreview();
    const mark = document.createElement('span');
    mark.className = 'board-model-thumbnail-mark';
    mark.innerHTML = '<svg viewBox="0 0 24 24" width="25" height="25" fill="none" stroke="currentColor" stroke-width="1.45"><path d="m12 2 8 4.5v9L12 20l-8-4.5v-9L12 2Z"></path><path d="m4 6.5 8 4.5 8-4.5M12 11v9"></path></svg><strong>3D</strong>';
    preview.appendChild(mark);
    content.appendChild(preview);
    return;
  }

  if (isVideoExt(f.ext)) {
    const preview = document.createElement('div');
    preview.className = 'board-video-thumbnail';
    const img = document.createElement('img');
    img.src = f.thumbUrl;
    img.loading = 'lazy';
    observeBoardMediaIntrinsicRatio(content, f, item, img);
    img.alt = f.name;
    img.draggable = false;
    preview.append(img, createBoardVideoDurationBadge(f));
    content.appendChild(preview);

    let hovering = false;
    let playerPromise = null;
    content.addEventListener('mouseenter', () => {
      hovering = true;
      if (!playerPromise) {
        playerPromise = loadBoardPreview(f.id).then((result) => {
          if (!content.isConnected || !result || result.type !== 'video') return null;
          const player = buildMiniVideoPlayer(result, f);
          content.replaceChildren(player);
          return player;
        }).catch(() => {
          playerPromise = null;
          return null;
        });
      }
      playerPromise.then((player) => {
        if (hovering && player && typeof player._boardPlayPreview === 'function') {
          player._boardPlayPreview();
        }
      });
    });
    content.addEventListener('mouseleave', () => {
      hovering = false;
      if (!playerPromise) return;
      playerPromise.then((player) => {
        if (player && typeof player._boardStopPreview === 'function') player._boardStopPreview();
      });
    });
    return;
  }

  content.innerHTML = '';
  const placeholder = document.createElement('div');
  placeholder.className = 'board-item-icon';
  placeholder.textContent = fileIconLabel(f.ext);
  content.appendChild(placeholder);

  // Rich documents and playable audio only mount at a useful visual scale.
  // At overview/compact zoom the thumbnail/icon is enough and avoids waking
  // decoders for dozens of tiny cards.
  if (boardZoomBucket() !== 'detail') return;

  loadBoardPreview(f.id).then((result) => {
    // The board may have re-rendered (or this item been removed) by the
    // time this resolves �?only touch the DOM if it's still around.
    if (document.body.contains(content)) {
      applyBoardRichContent(content, f, result);
    }
  }).catch(() => {});
}

function applyBoardRichContent(content, f, result) {
  if (result.type === 'video') {
    content.innerHTML = '';
    content.appendChild(buildMiniVideoPlayer(result, f));
  } else if (result.type === 'audio') {
    content.innerHTML = '';
    content.appendChild(buildMiniAudioPlayer(result, f));
  } else if (result.type === 'pages' && result.pageUrls && result.pageUrls[0]) {
    content.innerHTML = '';
    const img = document.createElement('img');
    img.src = result.pageUrls[0];
    img.alt = f.name;
    img.draggable = false;
    content.appendChild(img);
  } else if (result.type === 'pdf-js') {
    window.messsAPI.renderPdfPage(result.path, 1, 0.5).then(({ dataUrl }) => {
      if (!document.body.contains(content)) return;
      content.innerHTML = '';
      const img = document.createElement('img');
      img.src = dataUrl;
      img.alt = f.name;
      img.draggable = false;
      content.appendChild(img);
    }).catch(() => {});
  } else if (result.type === 'text') {
    content.innerHTML = '';
    const snippet = document.createElement('div');
    snippet.className = 'board-item-text-snippet';
    const text = (result.content || '').slice(0, 220);
    if (text.trim().length > 0) {
      snippet.textContent = text;
    } else {
      snippet.classList.add('is-empty');
      snippet.textContent = t('(This file is empty.)', '（这个文件没有内容）');
    }
    content.appendChild(snippet);
  }
  // Anything else (unsupported) just keeps the generic icon placeholder.
}

function boardItemBounds(item) {
  const measured = Board.metrics.get(item.id);
  const width = Math.max(1, item.width || (measured && measured.w) || 220);
  let height = item.height || (measured && measured.h);
  const file = Board.filesById.get(item.fileId);
  if (file && (isImageExt(file.ext) || isVideoExt(file.ext)) && file.sourceWidth && file.sourceHeight) {
    height = width * file.sourceHeight / file.sourceWidth;
  }
  if (!height && file && isImageExt(file.ext)) height = width;
  if (!height) height = item.isNote ? 140 : 180;
  return {
    x: Number.isFinite(item.x) ? item.x : 0,
    y: Number.isFinite(item.y) ? item.y : 0,
    w: Math.max(1, width),
    h: Math.max(1, height)
  };
}

function restoreLegacyUniformBoardFrames() {
  const filesById = new Map(AppState.files.map((file) => [file.id, file]));
  const changed = [];
  AppState.boardItems.forEach((item) => {
    const file = filesById.get(item.fileId);
    const hadUniformFrame = item.layoutFrame === 'uniform-grid';
    const width = Math.max(1, Number(item.width) || 220);
    const sourceWidth = Number(file && file.sourceWidth);
    const sourceHeight = Number(file && file.sourceHeight);
    const isMedia = file && (isImageExt(file.ext) || isVideoExt(file.ext));
    const hasSourceRatio = isMedia && sourceWidth > 0 && sourceHeight > 0;
    const expectedHeight = hasSourceRatio
      ? Math.max(1, Math.round(width * sourceHeight / sourceWidth))
      : null;
    const needsRatioRepair = expectedHeight !== null && Math.abs((Number(item.height) || 0) - expectedHeight) > 1;
    if (!hadUniformFrame && !needsRatioRepair) return;
    item.width = width;
    if (expectedHeight !== null) item.height = expectedHeight;
    if (hadUniformFrame) delete item.layoutFrame;
    changed.push(item);
  });
  if (!changed.length) return;
  const persistence = typeof window.messsAPI.upsertBoardItems === 'function'
    ? window.messsAPI.upsertBoardItems(changed)
    : Promise.all(changed.map((item) => window.messsAPI.upsertBoardItem(item)));
  Promise.resolve(persistence).catch(() => {});
}

function rebuildBoardSpatialIndex() {
  Board.spatialIndex.clear();
  Board.filesById = new Map(AppState.files.map((file) => [file.id, file]));
  Board.itemsById = new Map(AppState.boardItems.map((item) => [item.id, item]));
  Board.selectedCount = 0;
  for (const item of AppState.boardItems) {
    if (item.selected) Board.selectedCount += 1;
    Board.spatialIndex.set(item.id, boardItemBounds(item));
  }
  Board.lastMountHash = null;
  Board.lastKeepHash = null;
}

function updateBoardItemIndex(item) {
  Board.spatialIndex.set(item.id, boardItemBounds(item));
  Board.lastMountHash = null;
  Board.lastKeepHash = null;
}

function cleanupBoardElement(element) {
  element.querySelectorAll('.mini-audio-player, .mini-video-player').forEach((media) => {
    if (typeof media._boardCleanup === 'function') media._boardCleanup();
  });
}

function destroyMountedBoardItem(id) {
  const element = Board.mounted.get(id);
  if (!element) return;
  cleanupBoardElement(element);
  element.remove();
  Board.mounted.delete(id);
}

function clearMountedBoardItems() {
  Board.mountQueue.clear();
  for (const id of [...Board.mounted.keys()]) destroyMountedBoardItem(id);
}

function boardRenderMetadata(value) {
  if (!value) return '';
  try { return JSON.stringify(value); } catch (error) { return String(value); }
}

function boardItemRenderSignature(item, file) {
  if (item.isAiPlaceholder) return `pending:${item.id}`;
  if (item.isNote) {
    return [
      'note', item.text, item.fontFamily, item.fontSize, item.fontWeight,
      item.color, item.noFill, item.align
    ].join('\u001f');
  }
  if (item.isDoodle) {
    const source = String(item.imageData || '');
    return `doodle:${source.length}:${source.slice(0, 48)}:${source.slice(-48)}`;
  }
  if (!file) return `missing:${item.fileId || ''}`;
  return [
    'file', item.layoutFrame || '', file.id, file.ext, file.name,
    file.url, file.thumbUrl, file.previewUrl, file.modelPreviewUrl,
    file.sourceWidth, file.sourceHeight, file.sourceFolder,
    boardRenderMetadata(file.aiGeneration),
    boardRenderMetadata(file.butlerOperation)
  ].join('\u001f');
}

function syncMountedBoardItemGeometry(element, item) {
  const file = Board.filesById.get(item.fileId);
  const isMedia = file && (isImageExt(file.ext) || isVideoExt(file.ext));
  const width = Math.max(1, Number(item.width) || 220);
  element.style.left = `${Number.isFinite(item.x) ? item.x : 0}px`;
  element.style.top = `${Number.isFinite(item.y) ? item.y : 0}px`;
  element.style.zIndex = String(item.zIndex || 1);
  if (!item.isNote || Number(item.width) > 0) element.style.width = `${width}px`;

  if (isMedia && Number(file.sourceWidth) > 0 && Number(file.sourceHeight) > 0) {
    const height = Math.max(1, Math.round(width * file.sourceHeight / file.sourceWidth));
    element.style.aspectRatio = `${file.sourceWidth} / ${file.sourceHeight}`;
    element.style.height = `${height}px`;
  } else {
    element.style.aspectRatio = '';
    element.style.height = Number(item.height) > 0 ? `${item.height}px` : '';
  }
  element.classList.toggle('is-selected', Boolean(item.selected));
  element.classList.toggle('is-single-selection', Boolean(item.selected) && Board.selectedCount === 1);
}

function reconcileMountedBoardItemsAfterDataChange() {
  for (const [id, element] of [...Board.mounted]) {
    const item = Board.itemsById.get(id);
    const file = item && Board.filesById.get(item.fileId);
    const signature = item && boardItemRenderSignature(item, file);
    if (
      !item ||
      element._boardItemRef !== item ||
      element._boardFileRef !== file ||
      element._boardRenderSignature !== signature
    ) {
      destroyMountedBoardItem(id);
      if (!item) Board.metrics.delete(id);
      continue;
    }
    syncMountedBoardItemGeometry(element, item);
  }
}

function isMountableBoardItem(id) {
  const item = Board.itemsById.get(id);
  if (!item) return false;
  return !!(item.isAiPlaceholder || item.isNote || item.isDoodle || Board.filesById.has(item.fileId));
}

function isBoardElementPaintReady(element) {
  if (!element) return false;
  return [...element.querySelectorAll('.board-image-layer.is-active, .board-video-thumbnail > img, .board-model-thumbnail > img')]
    .every((image) => image.complete);
}

function visibleBoardDomReady() {
  for (const id of Board.visibleIds) {
    if (!isMountableBoardItem(id)) continue;
    if (!isBoardElementPaintReady(Board.mounted.get(id))) return false;
  }
  return true;
}

function syncBoardOverviewFallback(viewportRect) {
  if (!Board.overviewCanvas || Board.lastZoomBucket === 'overview') return;
  if (visibleBoardDomReady()) {
    Board.overviewCanvas.hidden = true;
    return;
  }
  const viewport = document.getElementById('board-viewport');
  const rect = viewportRect || (viewport && viewport.getBoundingClientRect());
  if (rect && rect.width && rect.height) drawBoardOverview(Board.visibleIds, rect);
}

function observeBoardElementPaintReady(element) {
  element.querySelectorAll('img').forEach((image) => {
    if (image.complete) return;
    const settle = () => syncBoardOverviewFallback();
    image.addEventListener('load', settle, { once: true });
    image.addEventListener('error', settle, { once: true });
  });
}

function syncMountedRichContentForLod(previousBucket, nextBucket) {
  if (!previousBucket || previousBucket === nextBucket ||
      previousBucket === 'overview' || nextBucket === 'overview') return;
  for (const [id, element] of Board.mounted) {
    const item = Board.itemsById.get(id);
    const file = item && Board.filesById.get(item.fileId);
    if (!file || isImageExt(file.ext) || isVideoExt(file.ext) || isModelFile(file)) continue;
    const content = element.querySelector('.board-item-content');
    if (!content) continue;
    cleanupBoardElement(element);
    content.replaceChildren();
    renderBoardItemContent(content, file, item);
    observeBoardElementPaintReady(element);
  }
}

function ensureBoardOverviewCanvas() {
  if (Board.overviewCanvas) return Board.overviewCanvas;
  const viewport = document.getElementById('board-viewport');
  const canvas = document.createElement('canvas');
  canvas.className = 'board-overview-canvas';
  canvas.hidden = true;
  viewport.insertBefore(canvas, document.getElementById('board-canvas'));
  Board.overviewCanvas = canvas;
  return canvas;
}

function boardOverviewColor(item) {
  if (item.isDoodle) return '#9b58e9';
  if (item.isNote) return '#d7b94b';
  const file = Board.filesById.get(item.fileId);
  if (!file) return '#7d8798';
  if (isVideoExt(file.ext)) return '#3d8fe8';
  if (isImageExt(file.ext)) return '#47a67c';
  if (isModelFile(file)) return '#9a7bd1';
  if (isAudioExt(file.ext)) return '#d76f55';
  return '#8a91a0';
}

function boardOverviewThumbnailSource(file) {
  if (!file) return '';
  const thumbnail = String(file.thumbUrl || file.modelPreviewUrl || '').trim();
  if (thumbnail) return thumbnail;
  if (isImageExt(file.ext)) return String(file.previewUrl || file.url || '').trim();
  if (isModelFile(file)) return String(file.previewUrl || '').trim();
  return '';
}

function boardOverviewImageRequestKey(fileId, source) {
  return `${fileId}\n${source}`;
}

function closeBoardOverviewDrawable(drawable) {
  if (drawable && typeof drawable.close === 'function') drawable.close();
}

function cachedBoardOverviewImage(file) {
  const source = boardOverviewThumbnailSource(file);
  const cached = file && Board.overviewImageCache.get(file.id);
  if (!cached) return null;
  if (!source || cached.source !== source) {
    closeBoardOverviewDrawable(cached.drawable);
    Board.overviewImagePixels = Math.max(0, Board.overviewImagePixels - (cached.pixels || 0));
    Board.overviewImageCache.delete(file.id);
    return null;
  }
  // Refresh insertion order so a dense viewport does not evict thumbnails
  // that are still visible while the user pans across the board.
  Board.overviewImageCache.delete(file.id);
  Board.overviewImageCache.set(file.id, cached);
  return cached.drawable;
}

async function createBoardOverviewDrawable(image) {
  const sourceWidth = image.naturalWidth;
  const sourceHeight = image.naturalHeight;
  const longestEdge = Math.max(sourceWidth, sourceHeight);
  if (typeof createImageBitmap !== 'function' || longestEdge <= BOARD_OVERVIEW_IMAGE_MAX_EDGE) return image;
  const scale = BOARD_OVERVIEW_IMAGE_MAX_EDGE / longestEdge;
  try {
    return await createImageBitmap(image, 0, 0, sourceWidth, sourceHeight, {
      resizeWidth: Math.max(1, Math.round(sourceWidth * scale)),
      resizeHeight: Math.max(1, Math.round(sourceHeight * scale)),
      resizeQuality: 'high'
    });
  } catch (error) {
    return image;
  }
}

function cacheBoardOverviewImage(fileId, source, drawable) {
  const previous = Board.overviewImageCache.get(fileId);
  if (previous) {
    Board.overviewImagePixels = Math.max(0, Board.overviewImagePixels - (previous.pixels || 0));
    if (previous.drawable !== drawable) closeBoardOverviewDrawable(previous.drawable);
  }
  const pixels = Math.max(1, Number(drawable && drawable.width) || 1) *
    Math.max(1, Number(drawable && drawable.height) || 1);
  Board.overviewImageCache.delete(fileId);
  Board.overviewImageCache.set(fileId, { source, drawable, pixels });
  Board.overviewImagePixels += pixels;
  Board.overviewImageFailed.delete(boardOverviewImageRequestKey(fileId, source));
  while (
    Board.overviewImageCache.size > BOARD_OVERVIEW_IMAGE_CACHE_LIMIT ||
    Board.overviewImagePixels > BOARD_OVERVIEW_IMAGE_PIXEL_BUDGET
  ) {
    const oldestId = Board.overviewImageCache.keys().next().value;
    const oldest = Board.overviewImageCache.get(oldestId);
    Board.overviewImageCache.delete(oldestId);
    Board.overviewImagePixels = Math.max(0, Board.overviewImagePixels - (oldest && oldest.pixels || 0));
    closeBoardOverviewDrawable(oldest && oldest.drawable);
  }
}

function scheduleBoardOverviewRedraw() {
  if (Board.overviewRedrawFrame) return;
  Board.overviewRedrawFrame = requestAnimationFrame(() => {
    Board.overviewRedrawFrame = 0;
    const canvas = Board.overviewCanvas;
    if (!canvas || (canvas.hidden && Board.lastZoomBucket !== 'overview')) return;
    const viewport = document.getElementById('board-viewport');
    const rect = viewport && viewport.getBoundingClientRect();
    if (rect && rect.width && rect.height) drawBoardOverview(Board.visibleIds, rect);
  });
}

function processBoardOverviewImageQueue() {
  while (
    Board.overviewImageActive < BOARD_OVERVIEW_IMAGE_CONCURRENCY &&
    Board.overviewImageQueue.length
  ) {
    const fileId = Board.overviewImageQueue.shift();
    const request = Board.overviewImagePending.get(fileId);
    if (!request || request.started) continue;
    request.started = true;
    Board.overviewImageActive += 1;
    const image = new Image();
    request.image = image;
    image.decoding = 'async';

    const finish = () => {
      if (Board.overviewImagePending.get(fileId) === request) {
        Board.overviewImagePending.delete(fileId);
      }
      Board.overviewImageActive = Math.max(0, Board.overviewImageActive - 1);
      scheduleBoardOverviewRedraw();
      processBoardOverviewImageQueue();
    };
    image.onload = async () => {
      try {
        if (
          image.naturalWidth > 0 && image.naturalHeight > 0 &&
          Board.overviewImagePending.get(fileId) === request
        ) {
          const drawable = await createBoardOverviewDrawable(image);
          if (Board.overviewImagePending.get(fileId) === request) {
            cacheBoardOverviewImage(fileId, request.source, drawable);
          } else {
            closeBoardOverviewDrawable(drawable);
          }
        }
      } finally {
        finish();
      }
    };
    image.onerror = () => {
      Board.overviewImageFailed.add(boardOverviewImageRequestKey(fileId, request.source));
      finish();
    };
    image.src = request.source;
  }
}

function requestBoardOverviewImage(file, deferStart = false) {
  const source = boardOverviewThumbnailSource(file);
  if (!file || !source || cachedBoardOverviewImage(file)) return;
  if (Board.overviewImageFailed.has(boardOverviewImageRequestKey(file.id, source))) return;
  const pending = Board.overviewImagePending.get(file.id);
  if (pending && pending.source === source) {
    if (!pending.started && !Board.overviewImageQueue.includes(file.id)) {
      Board.overviewImageQueue.push(file.id);
    }
    if (!deferStart) processBoardOverviewImageQueue();
    return;
  }
  const request = { file, source, started: false, image: null };
  Board.overviewImagePending.set(file.id, request);
  Board.overviewImageQueue.push(file.id);
  if (!deferStart) processBoardOverviewImageQueue();
}

function prioritizeBoardOverviewImageQueue(files) {
  const prioritized = [];
  const wantedIds = new Set();
  for (const file of files) {
    if (!file || wantedIds.has(file.id)) continue;
    wantedIds.add(file.id);
    prioritized.push(file);
  }

  for (const [fileId, request] of [...Board.overviewImagePending]) {
    if (!request.started && !wantedIds.has(fileId)) Board.overviewImagePending.delete(fileId);
  }
  Board.overviewImageQueue.length = 0;
  prioritized.forEach((file) => requestBoardOverviewImage(file, true));
  processBoardOverviewImageQueue();
}

function drawBoardOverviewImage(ctx, image, x, y, width, height) {
  const imageWidth = Number(image && (image.naturalWidth || image.width));
  const imageHeight = Number(image && (image.naturalHeight || image.height));
  if (!imageWidth || !imageHeight) return false;
  const sourceRatio = imageWidth / imageHeight;
  const targetRatio = width / Math.max(1, height);
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = imageWidth;
  let sourceHeight = imageHeight;
  if (sourceRatio > targetRatio) {
    sourceWidth = imageHeight * targetRatio;
    sourceX = (imageWidth - sourceWidth) / 2;
  } else {
    sourceHeight = imageWidth / targetRatio;
    sourceY = (imageHeight - sourceHeight) / 2;
  }
  ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
  return true;
}

function drawBoardOverview(visibleIds, viewportRect) {
  const canvas = ensureBoardOverviewCanvas();
  const dpr = BOARD_OVERVIEW_DPR;
  const width = Math.max(1, Math.round(viewportRect.width));
  const height = Math.max(1, Math.round(viewportRect.height));
  const pixelWidth = Math.round(width * dpr);
  const pixelHeight = Math.round(height * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  canvas.hidden = false;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.lineWidth = 1;
  const imageCandidates = [...visibleIds]
    .map((id) => {
      const item = Board.itemsById.get(id);
      const bounds = Board.spatialIndex.getBounds(id);
      const file = item && Board.filesById.get(item.fileId);
      return { id, item, bounds, file };
    })
    .filter((entry) => entry.item && entry.bounds && boardOverviewThumbnailSource(entry.file))
    .sort((a, b) => {
      const aArea = a.bounds.w * a.bounds.h;
      const bArea = b.bounds.w * b.bounds.h;
      return (b.item.selected ? 1e9 : bArea) - (a.item.selected ? 1e9 : aArea);
    });
  const prioritizedImages = imageCandidates.slice(0, BOARD_OVERVIEW_IMAGE_LIMIT);
  const imageIds = new Set(prioritizedImages.map((entry) => entry.id));
  prioritizeBoardOverviewImageQueue(prioritizedImages.map((entry) => entry.file));

  for (const id of visibleIds) {
    const item = Board.itemsById.get(id);
    const bounds = Board.spatialIndex.getBounds(id);
    if (!item || !bounds) continue;
    const x = bounds.x * Board.zoom + Board.panX;
    const y = bounds.y * Board.zoom + Board.panY;
    const w = Math.max(2, bounds.w * Board.zoom);
    const h = Math.max(2, bounds.h * Board.zoom);
    ctx.globalAlpha = item.selected ? 1 : 0.82;
    ctx.fillStyle = boardOverviewColor(item);
    ctx.fillRect(x, y, w, h);
    const file = Board.filesById.get(item.fileId);
    if (imageIds.has(id) && file) {
      const image = cachedBoardOverviewImage(file);
      if (image) {
        ctx.globalAlpha = item.selected ? 1 : 0.92;
        drawBoardOverviewImage(ctx, image, x, y, w, h);
      }
    }
    ctx.globalAlpha = item.selected ? 1 : 0.68;
    ctx.strokeStyle = item.selected ? '#f5f7fb' : 'rgba(220, 226, 235, 0.78)';
    ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
  }
  ctx.globalAlpha = 1;
}

function isBoardMediaItem(item) {
  const file = item && Board.filesById.get(item.fileId);
  return !!file && (isVideoExt(file.ext) || isAudioExt(file.ext));
}

function buildAiPlaceholderElement(item) {
  const el = document.createElement('div');
  el.className = 'board-item board-item-ai-pending';
  el.style.left = item.x + 'px';
  el.style.top = item.y + 'px';
  el.style.width = item.width + 'px';
  el.style.height = item.height + 'px';
  el.style.zIndex = item.zIndex || 1;
  el.dataset.boardId = item.id;
  el.innerHTML = '<div class="ai-pending-visual" aria-hidden="true"></div>';
  makeBoardItemDraggable(el, item);
  return el;
}

function buildAiPlaceholderElementLocalized(item) {
  const el = document.createElement('div');
  el.className = 'board-item board-item-ai-pending';
  el.style.left = item.x + 'px';
  el.style.top = item.y + 'px';
  el.style.width = item.width + 'px';
  el.style.height = item.height + 'px';
  el.style.zIndex = item.zIndex || 1;
  el.dataset.boardId = item.id;
  el.innerHTML = '<div class="ai-pending-visual" aria-hidden="true"></div>';
  makeBoardItemDraggable(el, item);
  return el;
}

function createBoardItemElement(item) {
  if (item.isAiPlaceholder) return buildAiPlaceholderElementLocalized(item);
  if (item.isNote) return buildTextNoteEl(item);
  if (item.isDoodle) return buildDoodleItemEl(item);
  const f = Board.filesById.get(item.fileId);
  if (!f) return null;

  const el = document.createElement('div');
  const isImage = isImageExt(f.ext);
  const isVideo = isVideoExt(f.ext);
  const isModel = isModelFile(f);
  const isUniformFrame = item.layoutFrame === 'uniform-grid';
  el.className = 'board-item' +
    (isImage ? ' board-item-image' : '') +
    (isVideo ? ' board-item-video' : '') +
    (isModel ? ' board-item-model' : '') +
    (isUniformFrame ? ' is-uniform-frame' : '') +
    (isImage && typeof isAiComposerReference === 'function' && isAiComposerReference(item.fileId)
      ? ' is-ai-reference' : '') +
    (item.selected ? ' is-selected' : '') +
    (item.selected && Board.selectedCount === 1
      ? ' is-single-selection' : '');
  el.style.left = item.x + 'px';
  el.style.top = item.y + 'px';
  el.style.width = (item.width || 220) + 'px';
  if (!isUniformFrame && (isImage || isVideo) && f.sourceWidth && f.sourceHeight) {
    el.style.aspectRatio = `${f.sourceWidth} / ${f.sourceHeight}`;
  } else if (item.height) {
    el.style.height = `${item.height}px`;
  }
  el.style.zIndex = item.zIndex || 1;
  el.dataset.boardId = item.id;
  const hasMediaDetails = !!(f.aiGeneration || f.sourceFolder === 'AI Generated' || f.butlerOperation);
  el.addEventListener('click', (e) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      e.stopPropagation();
      item.selected = !item.selected;
      syncBoardSelectionClasses();
    } else if (!item.selected) {
      AppState.boardItems.forEach((boardItem) => { boardItem.selected = false; });
      item.selected = true;
      syncBoardSelectionClasses();
    }
    if (
      isImage &&
      Date.now() - Board.lastDragEndedAt > 120 &&
      typeof toggleAiComposerBoardReference === 'function'
    ) {
      toggleAiComposerBoardReference(f, item.fileId);
    }
  });

  const content = document.createElement('div');
  content.className = 'board-item-content';
  el.appendChild(content);
  renderBoardItemContent(content, f, item);
  if (isImage) {
    appendBoardImageToolbar(el, f, item);
    appendBoardEditHint(el);
  } else if (isVideo) {
    const videoToolbar = appendBoardVideoButlerToolbar(el, f, item);
    if (hasMediaDetails) appendGeneratedMediaDetailsControl(el, f, videoToolbar);
  }

  const name = document.createElement('div');
  name.className = 'board-item-name';
  name.textContent = f.name;
  name.hidden = isImage;
  el.appendChild(name);

  if (isEditableExt(f.ext)) {
    el.classList.add('is-editable');
    el.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      openDocumentEditor(f.id);
    });
  } else if (isModel) {
    el.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof openBoardModelViewer === 'function') openBoardModelViewer(f);
    });
  }

  makeBoardItemDraggable(el, item);
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const selectedCount = AppState.boardItems.filter((boardItem) => boardItem.selected).length;
    if (selectedCount >= 2 && item.selected) {
      showBoardMultiContextMenu(e.clientX, e.clientY);
    } else {
      if (!item.selected) {
        AppState.boardItems.forEach((boardItem) => { boardItem.selected = boardItem.id === item.id; });
        syncBoardSelectionClasses();
      }
      showBoardItemContextMenu(item, e.clientX, e.clientY);
    }
  });
  return el;
}

function processBoardMountQueue() {
  Board.mountFrame = 0;
  const canvas = document.getElementById('board-canvas');
  let mountedThisFrame = 0;
  let mountedMediaThisFrame = 0;

  for (const id of [...Board.mountQueue]) {
    if (mountedThisFrame >= BOARD_MOUNTS_PER_FRAME) break;
    const item = Board.itemsById.get(id);
    if (!item) {
      Board.mountQueue.delete(id);
      continue;
    }
    const isMedia = isBoardMediaItem(item);
    if (isMedia && mountedMediaThisFrame >= BOARD_MEDIA_MOUNTS_PER_FRAME) continue;
    Board.mountQueue.delete(id);
    if (Board.mounted.has(id)) continue;

    let element;
    try {
      element = createBoardItemElement(item);
    } catch (err) {
      console.error(`Could not render board item ${id}:`, err);
      continue;
    }
    if (!element) continue;
    const file = Board.filesById.get(item.fileId);
    element._boardItemRef = item;
    element._boardFileRef = file;
    element._boardRenderSignature = boardItemRenderSignature(item, file);
    canvas.appendChild(element);
    Board.mounted.set(id, element);
    observeBoardElementPaintReady(element);
    mountedThisFrame += 1;
    if (isMedia) mountedMediaThisFrame += 1;

    requestAnimationFrame(() => {
      if (Board.mounted.get(id) !== element) return;
      const measured = { w: element.offsetWidth, h: element.offsetHeight };
      const previous = Board.metrics.get(id);
      if (!previous || Math.abs(previous.w - measured.w) > 2 || Math.abs(previous.h - measured.h) > 2) {
        Board.metrics.set(id, measured);
        updateBoardItemIndex(item);
        scheduleBoardReconcile();
      }
    });
  }

  if (Board.mountQueue.size) {
    Board.mountFrame = requestAnimationFrame(processBoardMountQueue);
  }
  syncBoardOverviewFallback();
  scheduleMountedImageQuality();
}

function queueBoardMounts(ids, visibleRect) {
  const ordered = BoardEngine.prioritizeIdsByViewport(
    [...ids].filter((id) => !Board.mounted.has(id)),
    Board.spatialIndex,
    visibleRect,
    BOARD_DOM_ITEM_LIMIT
  );
  ordered.forEach((id) => Board.mountQueue.add(id));
  if (Board.mountQueue.size && !Board.mountFrame) {
    Board.mountFrame = requestAnimationFrame(processBoardMountQueue);
  }
}

function reconcileBoardViewport(force = false) {
  const viewport = document.getElementById('board-viewport');
  if (!viewport) return;
  const rect = viewport.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const regions = BoardEngine.viewportRects(
    Board,
    { w: rect.width, h: rect.height },
    { mountMarginRatio: 0.45, keepMarginRatio: 1 }
  );
  const zoomBucket = boardZoomBucket();
  const densityProbeLimit = Board.densityOverview
    ? BOARD_DOM_ITEM_EXIT_LIMIT + 1
    : BOARD_DOM_ITEM_LIMIT + 1;
  const mountCandidateCount = Board.spatialIndex.count(regions.mount, densityProbeLimit);
  Board.densityOverview = BoardEngine.isOverDomBudget(
    mountCandidateCount,
    Board.densityOverview,
    { enter: BOARD_DOM_ITEM_LIMIT, exit: BOARD_DOM_ITEM_EXIT_LIMIT }
  );
  const useOverview = Board.densityOverview ||
    (zoomBucket === 'overview' && AppState.boardItems.length > BOARD_OVERVIEW_ITEM_THRESHOLD);
  const effectiveBucket = useOverview
    ? 'overview'
    : (zoomBucket === 'overview' ? 'compact' : zoomBucket);
  const viewportClass = document.getElementById('board-viewport');
  viewportClass.classList.toggle('is-board-overview', effectiveBucket === 'overview');
  viewportClass.classList.toggle('is-board-compact', effectiveBucket === 'compact');

  if (effectiveBucket !== Board.lastZoomBucket) {
    const previousBucket = Board.lastZoomBucket;
    Board.lastZoomBucket = effectiveBucket;
    syncMountedRichContentForLod(previousBucket, effectiveBucket);
    force = true;
  }

  if (useOverview) {
    const visibleIds = Board.spatialIndex.query(regions.visible);
    Board.visibleIds = visibleIds;
    // Paint the lightweight representation before removing DOM nodes so a
    // density/zoom LOD transition never exposes a blank frame.
    drawBoardOverview(visibleIds, rect);
    clearMountedBoardItems();
    Board.lastMountHash = null;
    Board.lastKeepHash = null;
    return;
  }

  const mountIds = Board.spatialIndex.queryLimited(regions.mount, BOARD_DOM_ITEM_LIMIT);
  const visibleIds = Board.spatialIndex.query(regions.visible);
  Board.visibleIds = visibleIds;
  const keepCandidates = [];
  for (const id of Board.mounted.keys()) {
    const bounds = Board.spatialIndex.getBounds(id);
    if (!mountIds.has(id) && bounds && BoardEngine.intersects(bounds, regions.keep)) {
      keepCandidates.push(id);
    }
  }
  const retainBudget = Math.max(0, BOARD_DOM_RETAIN_LIMIT - mountIds.size);
  const retainedIds = new Set(BoardEngine.prioritizeIdsByViewport(
    keepCandidates,
    Board.spatialIndex,
    regions.visible,
    retainBudget
  ));
  const mountHash = BoardEngine.hashSet(mountIds);
  const keepHash = BoardEngine.hashSet(retainedIds);
  if (!force && mountHash === Board.lastMountHash && keepHash === Board.lastKeepHash) {
    syncBoardOverviewFallback(rect);
    return;
  }
  Board.lastMountHash = mountHash;
  Board.lastKeepHash = keepHash;
  Board.mountQueue.clear();

  for (const [id, element] of Board.mounted) {
    if (mountIds.has(id)) {
      element.style.visibility = '';
      element.style.pointerEvents = '';
    } else if (retainedIds.has(id)) {
      pauseBoardElementMedia(element);
      element.style.visibility = 'hidden';
      element.style.pointerEvents = 'none';
    } else {
      destroyMountedBoardItem(id);
    }
  }
  queueBoardMounts(mountIds, regions.visible);
  syncBoardOverviewFallback(rect);
}

function scheduleBoardReconcile() {
  if (Board.reconcileFrame) return;
  Board.reconcileFrame = requestAnimationFrame(() => {
    Board.reconcileFrame = 0;
    reconcileBoardViewport();
  });
}

function renderBoard() {
  const empty = document.getElementById('board-empty');
  empty.hidden = AppState.boardItems.length > 0;
  restoreLegacyUniformBoardFrames();
  rebuildBoardSpatialIndex();
  reconcileMountedBoardItemsAfterDataChange();
  reconcileBoardViewport(true);
  if (typeof syncCanvasNodeMode === 'function') syncCanvasNodeMode();
}

function syncBoardSelectionClasses() {
  const selectedIds = new Set(AppState.boardItems.filter((item) => item.selected).map((item) => item.id));
  const hasSingleSelection = selectedIds.size === 1;
  Board.selectedCount = selectedIds.size;
  document.querySelectorAll('#board-canvas .board-item').forEach((element) => {
    const selected = selectedIds.has(element.dataset.boardId);
    element.classList.toggle('is-selected', selected);
    element.classList.toggle('is-single-selection', selected && hasSingleSelection);
  });
  scheduleMountedImageQuality(0);
}

function appendBoardEditHint(element) {
  const hint = document.createElement('button');
  hint.type = 'button';
  hint.className = 'board-edit-hint';
  hint.title = t('Edit with AI', 'AI 编辑');
  hint.setAttribute('aria-label', hint.title);
  hint.innerHTML = `<kbd>Tab</kbd><span>${t('Edit', '编辑')}</span>`;
  ['pointerdown', 'mousedown', 'click'].forEach((eventName) => {
    hint.addEventListener(eventName, (event) => event.stopPropagation());
  });
  hint.addEventListener('click', () => {
    closeBoardQuickGenerate();
    void openAiComposerForSelection('image');
  });
  element.appendChild(hint);
  return hint;
}

function pauseBoardElementMedia(element) {
  if (!element) return;
  element.querySelectorAll('video, audio').forEach((media) => {
    if (!media.paused) media.pause();
  });
}

function pauseAllBoardMedia() {
  Board.mounted.forEach((element) => pauseBoardElementMedia(element));
}

function stopOtherBoardVideos(currentVideo) {
  Board.mounted.forEach((element) => {
    element.querySelectorAll('video').forEach((video) => {
      if (video !== currentVideo && !video.paused) video.pause();
    });
  });
}

function makeBoardItemDraggable(el, item) {
  el.addEventListener('mousedown', (e) => {
    // Middle-button and Alt+left gestures always belong to canvas panning,
    // even when they begin over an image or video.
    if (e.button !== 0 || e.altKey) return;
    // Toolbar controls and native form controls own their pointer gesture;
    // they must never fall through to board-item dragging.
    if (e.target.closest && e.target.closest(
      '.board-image-toolbar, .board-edit-hint, .generated-media-detail-trigger, button, input, textarea, select, a'
    )) return;
    if (e.target.classList.contains('board-resize-handle')) return;
    if (e.target.closest('.mini-audio-player')) return;
    e.stopPropagation();
    pauseBoardElementMedia(el);
    markBoardInteraction();
    el.classList.add('is-dragging');
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    let moved = false;

    // Dragging a grouped item moves every item sharing its groupId together
    // �?that's the whole point of grouping. Each item's own starting
    // position is recorded so the relative layout within the group is
    // preserved while dragging, not just the one item the cursor grabbed.
    // Absent an explicit group, a multi-selection (e.g. after Ctrl+A or a
    // box-select) behaves the same way: dragging any one selected item
    // drags the whole selection together, rather than peeling just that
    // one item away from the rest.
    const selectedMates = AppState.boardItems.filter((b) => b.selected);
    const groupMates = item.groupId
      ? AppState.boardItems.filter((b) => b.groupId === item.groupId)
      : (item.selected && selectedMates.length > 1 ? selectedMates : [item]);
    const groupStartPositions = groupMates.map((b) => ({ item: b, startLeft: b.x, startTop: b.y }));
    const groupEls = new Map();
    for (const groupItem of groupMates) {
      const groupEl = groupItem.id === item.id
        ? el
        : document.querySelector(`.board-item[data-board-id="${groupItem.id}"]`);
      if (groupEl) groupEls.set(groupItem.id, groupEl);
    }

    const moveRunner = createLatestFrameRunner((point) => {
      const dx = (point.clientX - startClientX) / Board.zoom;
      const dy = (point.clientY - startClientY) / Board.zoom;
      groupStartPositions.forEach(({ item: gItem, startLeft, startTop }) => {
        gItem.x = Math.round(startLeft + dx);
        gItem.y = Math.round(startTop + dy);
        const gEl = groupEls.get(gItem.id);
        if (gEl) {
          gEl.style.left = gItem.x + 'px';
          gEl.style.top = gItem.y + 'px';
        }
      });
    });
    function onMove(ev) {
      if (Math.hypot(ev.clientX - startClientX, ev.clientY - startClientY) > 4) moved = true;
      markBoardInteraction();
      moveRunner.push({ clientX: ev.clientX, clientY: ev.clientY });
    }
    function onUp() {
      moveRunner.flush();
      if (moved) {
        Board.lastDragEndedAt = Date.now();
        recordBoardMoveHistory(groupStartPositions);
      }
      markBoardInteraction();
      el.classList.remove('is-dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      groupMates.forEach((gItem) => updateBoardItemIndex(gItem));
      if (moved) persistBoardMoveHistory(groupMates);
      scheduleBoardReconcile();
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  addResizeHandles(el, item);
}

const DEFAULT_BOARD_ITEM_WIDTH = 220;
const MIN_BOARD_ITEM_WIDTH = 90;
const MAX_BOARD_ITEM_WIDTH = 900;

function boardMediaResizeAspect(el, item) {
  const file = item && Board.filesById.get(item.fileId);
  if (!file || (!isImageExt(file.ext) && !isVideoExt(file.ext))) return null;
  const media = el.querySelector('img, video');
  const sourceWidth = Number(file.sourceWidth) || Number(media && (media.naturalWidth || media.videoWidth));
  const sourceHeight = Number(file.sourceHeight) || Number(media && (media.naturalHeight || media.videoHeight));
  if (sourceWidth > 0 && sourceHeight > 0) return sourceHeight / sourceWidth;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect.height / rect.width : null;
}

/** Adds four corner handles while keeping the opposite corner anchored.
    Images and videos always preserve their intrinsic aspect ratio. */
function addResizeHandles(el, item) {
  const corners = [
    { cls: 'corner-se', signX: 1, signY: 1 },
    { cls: 'corner-sw', signX: -1, signY: 1 },
    { cls: 'corner-ne', signX: 1, signY: -1 },
    { cls: 'corner-nw', signX: -1, signY: -1 }
  ];

  for (const { cls, signX, signY } of corners) {
    const handle = document.createElement('div');
    handle.className = 'board-resize-handle ' + cls;
    handle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      pauseBoardElementMedia(el);
      el.classList.add('is-resizing');
      markBoardInteraction();

    const startClientX = e.clientX;
      const startClientY = e.clientY;
      const startWidth = item.width || el.getBoundingClientRect().width / Board.zoom;
      const mediaAspectRatio = boardMediaResizeAspect(el, item);
      const locksMediaAspect = Number.isFinite(mediaAspectRatio) && mediaAspectRatio > 0;
      const startHeight = locksMediaAspect
        ? startWidth * mediaAspectRatio
        : item.height || el.getBoundingClientRect().height / Board.zoom;
      const startLeft = item.x;
      const startTop = item.y;
      const aspectRatio = locksMediaAspect ? mediaAspectRatio : startHeight / startWidth;
      if (locksMediaAspect) {
        item.height = Math.max(1, Math.round(startHeight));
        el.style.aspectRatio = String(1 / aspectRatio);
      }

      const resizeRunner = createLatestFrameRunner((point) => {
        const dx = ((point.clientX - startClientX) / Board.zoom) * signX;
        const dy = ((point.clientY - startClientY) / Board.zoom) * signY;
        const minWidth = item.isDoodle ? 4 : MIN_BOARD_ITEM_WIDTH;
        const minHeight = item.isDoodle ? 4 : 40;
        const widthFromX = startWidth + dx;
        const widthFromY = startWidth + dy / aspectRatio;
        const proportionalWidth = Math.abs(dx) >= Math.abs(dy / aspectRatio) ? widthFromX : widthFromY;
        const freeResize = !locksMediaAspect && point.shiftKey;
        const newWidth = Math.max(minWidth, Math.min(MAX_BOARD_ITEM_WIDTH, freeResize ? widthFromX : proportionalWidth));
        const newHeight = freeResize
          ? Math.max(minHeight, Math.min(MAX_BOARD_ITEM_WIDTH, startHeight + dy))
          : locksMediaAspect
            ? Math.max(1, Math.round(newWidth * aspectRatio))
            : Math.max(minHeight, Math.round(newWidth * aspectRatio));
        item.width = Math.round(newWidth);
        el.style.width = item.width + 'px';
        if (locksMediaAspect || item.isDoodle || freeResize) {
          item.height = Math.round(newHeight);
          el.style.height = item.height + 'px';
        }

        // Anchor the opposite corner: when growing from the left/top edges,
        // shift x/y so the corner being dragged moves while the far corner
        // stays put, rather than the whole box just growing rightward/down.
        const widthDelta = newWidth - startWidth;
        const heightDelta = newHeight - startHeight;
        if (signX < 0) item.x = Math.round(startLeft - widthDelta);
        if (signY < 0) item.y = Math.round(startTop - heightDelta);
        el.style.left = item.x + 'px';
        el.style.top = item.y + 'px';
      });
      function onMove(ev) {
        markBoardInteraction();
        resizeRunner.push({
          clientX: ev.clientX,
          clientY: ev.clientY,
          shiftKey: ev.shiftKey
        });
      }
      function onUp() {
        resizeRunner.flush();
        el.classList.remove('is-resizing');
        markBoardInteraction();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        updateBoardItemIndex(item);
        scheduleBoardReconcile();
        window.messsAPI.upsertBoardItem(item);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    el.appendChild(handle);
  }
}

const ICON_EXPAND = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
const ICON_COMPRESS = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 3v4a2 2 0 0 1-2 2H3"/><path d="M21 9h-4a2 2 0 0 1-2-2V3"/><path d="M3 15h4a2 2 0 0 1 2 2v4"/><path d="M15 21v-4a2 2 0 0 1 2-2h4"/></svg>';

function isBoardFullscreen() {
  return document.getElementById('board-panel').classList.contains('is-fullscreen');
}

function isBoardWorkspaceActive() {
  const section = document.getElementById('section-messs');
  const panel = document.getElementById('board-panel');
  const workspace = document.getElementById('board-workspace-body');
  return !!(
    section && section.classList.contains('is-active') &&
    panel && !panel.classList.contains('is-canvas-library') &&
    workspace && !workspace.hidden
  );
}

function enterBoardFullscreen() {
  document.getElementById('board-panel').classList.add('is-fullscreen');
  document.getElementById('board-fullscreen-icon').outerHTML = ICON_COMPRESS.replace('<svg ', '<svg id="board-fullscreen-icon" ');
  const fullscreenTitle = boardFullscreenToggleTitle();
  document.getElementById('board-fullscreen-toggle').title = fullscreenTitle;
  document.getElementById('board-fullscreen-toggle').setAttribute('aria-label', fullscreenTitle);
  document.getElementById('board-bottom-bar').hidden = false;
  syncBoardBottomZoomLabel();
  if (typeof setCanvasAgentOpen === 'function') setCanvasAgentOpen(true);
}

function exitBoardFullscreen() {
  if (!isBoardFullscreen()) return;
  if (typeof setCanvasAgentOpen === 'function') setCanvasAgentOpen(false);
  document.getElementById('board-panel').classList.remove('is-fullscreen');
  document.getElementById('board-fullscreen-icon').outerHTML = ICON_EXPAND.replace('<svg ', '<svg id="board-fullscreen-icon" ');
  const fullscreenTitle = boardFullscreenToggleTitle();
  document.getElementById('board-fullscreen-toggle').title = fullscreenTitle;
  document.getElementById('board-fullscreen-toggle').setAttribute('aria-label', fullscreenTitle);
  document.getElementById('board-bottom-bar').hidden = false;
}

function toggleBoardFullscreen() {
  if (isBoardFullscreen()) exitBoardFullscreen();
  else enterBoardFullscreen();
}

/** Click-and-drag on empty canvas space draws a selection box; everything
    whose element intersects it when the mouse is released gets selected �?    "鼠标在这个区域全选，只会全选在这里的文�? (only items physically
    inside the drawn box, nothing else). */
function startBoxSelect(e) {
  const viewport = document.getElementById('board-viewport');
  const startX = e.clientX, startY = e.clientY;
  const startWorld = clientToBoardCoords(startX, startY);
  const initialSelected = new Set(
    e.shiftKey
      ? AppState.boardItems.filter((item) => item.selected).map((item) => item.id)
      : []
  );
  let previewIds = new Set(initialSelected);

  const box = document.createElement('div');
  box.className = 'board-select-box';
  viewport.appendChild(box);

  if (!e.shiftKey) {
    AppState.boardItems.forEach((item) => { item.selected = false; });
  }

  function updateBox(ev) {
    const x = Math.min(startX, ev.clientX), y = Math.min(startY, ev.clientY);
    const w = Math.abs(ev.clientX - startX), h = Math.abs(ev.clientY - startY);
    const viewportRect = viewport.getBoundingClientRect();
    box.style.left = (x - viewportRect.left) + 'px';
    box.style.top = (y - viewportRect.top) + 'px';
    box.style.width = w + 'px';
    box.style.height = h + 'px';
    return { left: x, top: y, right: x + w, bottom: y + h };
  }

  const selectRunner = createLatestFrameRunner((point) => {
    const ev = point;
    updateBox(ev);
    const currentWorld = clientToBoardCoords(ev.clientX, ev.clientY);
    const worldRect = {
      x: Math.min(startWorld.x, currentWorld.x),
      y: Math.min(startWorld.y, currentWorld.y),
      w: Math.max(0.001, Math.abs(currentWorld.x - startWorld.x)),
      h: Math.max(0.001, Math.abs(currentWorld.y - startWorld.y))
    };
    const nextIds = Board.spatialIndex.query(worldRect);
    if (e.shiftKey) initialSelected.forEach((id) => nextIds.add(id));

    for (const id of previewIds) {
      if (nextIds.has(id)) continue;
      const item = Board.itemsById.get(id);
      if (item) item.selected = false;
    }
    for (const id of nextIds) {
      const item = Board.itemsById.get(id);
      if (item) item.selected = true;
    }
    previewIds = nextIds;
    syncBoardSelectionClasses();
    scheduleBoardReconcile();
  });
  function onMove(ev) {
    selectRunner.push({ clientX: ev.clientX, clientY: ev.clientY });
  }
  function onUp() {
    selectRunner.flush();
    box.remove();
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    syncBoardSelectionClasses();
    scheduleBoardReconcile();
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function initBoardCanvas() {
  const viewport = document.getElementById('board-viewport');
  restoreBoardViewport();
  ensureBoardOverviewCanvas();
  resetBoardZoomTo100();
  reconcileBoardViewport(true);
  Board.resizeObserver = new ResizeObserver(() => {
    Board.lastMountHash = null;
    Board.lastKeepHash = null;
    scheduleBoardReconcile();
  });
  Board.resizeObserver.observe(viewport);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseAllBoardMedia();
  });
  window.addEventListener('blur', () => {
    BoardClipboard.items = [];
    BoardClipboard.preferInternal = false;
  });

  document.addEventListener('keydown', (e) => {
    // Only act when the board canvas is actually the relevant context �?    // skip while typing in any input/textarea/contenteditable (search box,
    // rename fields, the document editor, etc.).
    const tag = document.activeElement && document.activeElement.tagName;
    const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || (document.activeElement && document.activeElement.isContentEditable);
    if (isEditable || !isBoardWorkspaceActive()) return;

    const shortcutKey = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && shortcutKey === 'z') {
      const handled = e.shiftKey ? redoBoardMove() : undoBoardMove();
      if (handled) e.preventDefault();
    } else if ((e.ctrlKey || e.metaKey) && shortcutKey === 'y') {
      if (redoBoardMove()) e.preventDefault();
    } else if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (!selectedBoardImageItems().length) return;
      e.preventDefault();
      closeBoardQuickGenerate();
      void openAiComposerForSelection('image');
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      AppState.boardItems.forEach((item) => { item.selected = true; });
      syncBoardSelectionClasses();
      scheduleBoardReconcile();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
      const selected = AppState.boardItems.filter((item) => item.selected);
      if (!selected.length) return;
      e.preventDefault();
      BoardClipboard.items = selected.map((item) => ({ ...item }));
      BoardClipboard.preferInternal = true;
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      if (BoardClipboard.preferInternal && BoardClipboard.items.length) {
        pasteBoardClipboard();
      } else {
        pasteExternalImageToBoard().then((pasted) => {
          if (!pasted && BoardClipboard.items.length) {
            pasteBoardClipboard();
          } else if (!pasted) {
            showToast(t('No image found on the clipboard', '剪贴板中没有图片'));
          }
        }).catch((err) => {
          showToast(err && err.message ? err.message : t('Could not paste the image', '无法粘贴图片'));
        });
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      AppState.boardItems.forEach((item) => { item.selected = false; });
      syncBoardSelectionClasses();
      scheduleBoardReconcile();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      const selected = AppState.boardItems.filter((item) => item.selected);
      if (!selected.length) return;
      e.preventDefault();
      selected.forEach((item) => window.messsAPI.removeBoardItem(item.id));
      canvasWorkspaceRemoveItems(selected.map((item) => item.id));
      AppState.boardItems = AppState.boardItems.filter((item) => !item.selected);
      renderBoard();
    } else if (e.key === 'Escape') {
      closeBoardQuickGenerate();
      AppState.boardItems.forEach((item) => { item.selected = false; });
      disarmTextPlacement();
      hideTextToolPanel();
      syncBoardSelectionClasses();
      scheduleBoardReconcile();
    }
  });

  let panPointerId = null;
  let panMoveRunner = null;

  viewport.addEventListener('pointerdown', (e) => {
    const isPanGesture = e.button === 1 || (e.button === 0 && e.altKey);
    if (!isPanGesture) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (Board.zoomFrame) cancelAnimationFrame(Board.zoomFrame);
    Board.zoomFrame = 0;
    Board.zoomTarget = null;
    Board.zoomLastTime = 0;
    Board.isPanning = true;
    panPointerId = e.pointerId;
    markBoardInteraction();
    Board.panStart = { x: e.clientX, y: e.clientY, panX: Board.panX, panY: Board.panY };
    panMoveRunner = createLatestFrameRunner((point) => {
      Board.panX = Board.panStart.panX + (point.clientX - Board.panStart.x);
      Board.panY = Board.panStart.panY + (point.clientY - Board.panStart.y);
      markBoardInteraction();
      applyBoardTransform();
    });
    viewport.classList.add('is-panning');
    if (viewport.setPointerCapture) viewport.setPointerCapture(e.pointerId);
  }, true);

  viewport.addEventListener('mousedown', (e) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) return;
    if (e.target.closest('.board-item')) return;

    // While the doodle/eraser tool is active, all mouse interaction on the
    // canvas belongs to drawing (handled by the doodle canvas's own
    // listeners) �?never start a pan or a box-select underneath a stroke.
    if (isDoodleActive()) return;

    // Text placement mode takes priority over panning/box-select �?a click
    // anywhere on empty canvas while armed creates a new text box right
    // there and immediately opens it for editing + shows the detail panel.
    if (textPlacementArmed && e.button === 0) {
      e.preventDefault();
      disarmTextPlacement();
      const { x, y } = clientToBoardCoords(e.clientX, e.clientY);
      const note = addTextNoteToBoard(x, y);
      // Wait for renderBoard() (triggered inside addTextNoteToBoard) to
      // actually create the element before trying to focus it.
      requestAnimationFrame(() => {
        const contentEl = document.querySelector(`.board-text-note[data-board-id="${note.id}"] .board-text-note-content`);
        if (contentEl) {
          contentEl.focus();
          showTextToolPanel(note, contentEl);
        }
      });
      return;
    }

    // Panning: middle-click drag, or Alt+left-click drag �?per explicit
    // request, plain left-click-drag is no longer the pan gesture (it's
    // box-select now instead, see below), since middle-click and Alt+drag
    // are the more standard "move the canvas" gestures in design tools and
    // don't collide with selecting things.
    // Pan gestures are handled before this selection branch.

    // Plain left-click-drag on empty space now box-selects directly �?no
    // modifier key needed, since panning moved to Alt+drag/middle-click above.
    if (e.button === 0) {
      startBoxSelect(e);
    }
  }, true);
  viewport.addEventListener('pointermove', (e) => {
    if (!Board.isPanning || e.pointerId !== panPointerId || !panMoveRunner) return;
    const coalesced = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const point = coalesced.length ? coalesced[coalesced.length - 1] : e;
    e.preventDefault();
    panMoveRunner.push({ clientX: point.clientX, clientY: point.clientY });
  });

  function finishBoardPan(e) {
    if (!Board.isPanning || (e && e.pointerId !== undefined && e.pointerId !== panPointerId)) return;
    if (panMoveRunner) panMoveRunner.flush();
    const completedPointerId = panPointerId;
    Board.isPanning = false;
    Board.lastPanEndedAt = Date.now();
    Board.panStart = null;
    panPointerId = null;
    panMoveRunner = null;
    markBoardInteraction();
    viewport.classList.remove('is-panning');
    if (completedPointerId !== null && viewport.hasPointerCapture && viewport.hasPointerCapture(completedPointerId)) {
      viewport.releasePointerCapture(completedPointerId);
    }
    scheduleBoardReconcile();
  }
  viewport.addEventListener('pointerup', finishBoardPan);
  viewport.addEventListener('pointercancel', finishBoardPan);
  viewport.addEventListener('lostpointercapture', finishBoardPan);
  viewport.addEventListener('auxclick', (e) => {
    if (e.button === 1) e.preventDefault();
  });
  window.addEventListener('blur', () => finishBoardPan());

  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    markBoardInteraction();
    const modeScale = e.deltaMode === 1
      ? 16
      : (e.deltaMode === 2 ? Math.max(1, viewport.clientHeight) : 1);
    const deltaX = Math.max(-BOARD_WHEEL_MAX_DELTA, Math.min(BOARD_WHEEL_MAX_DELTA, e.deltaX * modeScale));
    const deltaY = Math.max(-BOARD_WHEEL_MAX_DELTA, Math.min(BOARD_WHEEL_MAX_DELTA, e.deltaY * modeScale));
    const horizontalPan = e.shiftKey || Math.abs(deltaX) > Math.abs(deltaY) * 1.2;
    if (horizontalPan && !(e.ctrlKey || e.metaKey)) {
      const horizontalDelta = e.shiftKey && Math.abs(deltaX) < 0.01 ? deltaY : deltaX;
      setBoardPanTarget(horizontalDelta, 0);
      return;
    }
    const rect = viewport.getBoundingClientRect();
    setBoardZoomTarget(
      { x: e.clientX - rect.left, y: e.clientY - rect.top },
      Math.exp(-deltaY * BOARD_WHEEL_ZOOM_RATE)
    );
  }, { passive: false });

  viewport.addEventListener('click', (event) => {
    if (!activeAiComposer() || event.button !== 0) return;
    if (event.target.closest('.board-item')) return;
    if (Date.now() - Board.lastPanEndedAt < 160) return;
    const item = boardImageItemAtClientPoint(event.clientX, event.clientY);
    if (!item) return;
    const file = Board.filesById.get(item.fileId);
    event.preventDefault();
    event.stopPropagation();
    void toggleAiComposerBoardReference(file, item.fileId);
  });

  viewport.addEventListener('paste', (event) => {
    const hasImage = [...(event.clipboardData && event.clipboardData.items || [])]
      .some((item) => item.kind === 'file' && /^image\//i.test(item.type));
    if (!hasImage || BoardClipboard.preferInternal) return;
    event.preventDefault();
    pasteExternalImageToBoard().catch((err) => {
      showToast(err && err.message ? err.message : t('Could not paste the image', '无法粘贴图片'));
    });
  });

  document.getElementById('board-zoom-in').addEventListener('click', () => {
    const rect = viewport.getBoundingClientRect();
    setBoardZoomTarget(
      { x: rect.width / 2, y: rect.height / 2 },
      1.2
    );
  });
  document.getElementById('board-zoom-out').addEventListener('click', () => {
    const rect = viewport.getBoundingClientRect();
    setBoardZoomTarget(
      { x: rect.width / 2, y: rect.height / 2 },
      1 / 1.2
    );
  });
  document.getElementById('board-fit-all').addEventListener('click', locateBoardImages);
  document.getElementById('board-fullscreen-toggle').addEventListener('click', toggleBoardFullscreen);
  initBoardBottomBar();
  initBoardQuickGenerate();
  initDoodleColorPanel();
  initTextToolPanel();

  const dropIndicator = document.getElementById('board-file-drop-indicator');
  let boardDragDepth = 0;
  function clearBoardFileDrop() {
    boardDragDepth = 0;
    viewport.classList.remove('is-file-drag-over');
    if (dropIndicator) dropIndicator.hidden = true;
  }
  function updateBoardFileDrop(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    viewport.classList.add('is-file-drag-over');
    if (!dropIndicator) return;
    const rect = viewport.getBoundingClientRect();
    dropIndicator.style.left = `${event.clientX - rect.left}px`;
    dropIndicator.style.top = `${event.clientY - rect.top}px`;
    dropIndicator.hidden = false;
  }

  viewport.addEventListener('dragenter', (event) => {
    boardDragDepth += 1;
    updateBoardFileDrop(event);
  });
  viewport.addEventListener('dragover', updateBoardFileDrop);
  viewport.addEventListener('dragleave', (event) => {
    if (event.relatedTarget && viewport.contains(event.relatedTarget)) return;
    boardDragDepth = Math.max(0, boardDragDepth - 1);
    if (!boardDragDepth) clearBoardFileDrop();
  });

  viewport.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.board-item')) return; // handled per-item already
    const selectedCount = AppState.boardItems.filter((b) => b.selected).length;
    if (selectedCount >= 2) {
      e.preventDefault();
      showBoardMultiContextMenu(e.clientX, e.clientY);
    }
  });

  viewport.addEventListener('drop', async (e) => {
    e.preventDefault();
    clearBoardFileDrop();
    const internalId = e.dataTransfer.getData('application/x-messs-file-id');
    let internalIds = [];
    try {
      internalIds = JSON.parse(e.dataTransfer.getData('application/x-messs-file-ids') || '[]');
    } catch (err) {
      internalIds = [];
    }
    const { x, y } = clientToBoardCoords(e.clientX, e.clientY);

    if (internalIds.length || internalId) {
      await addFilesToBoard(
        internalIds.length ? internalIds : [internalId],
        x,
        y,
        { promptDuplicates: true }
      );
      return;
    }

    const items = Array.from(e.dataTransfer.items || []);
    const filePaths = [];
    const dirPaths = [];
    for (const item of items) {
      if (item.kind !== 'file') continue;
      const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
      const file = item.getAsFile();
      if (!file) continue;
      let resolvedPath = null;
      try { resolvedPath = window.messsAPI.getPathForFile(file); } catch (err) { resolvedPath = null; }
      if (!resolvedPath) continue;
      if (entry && entry.isDirectory) dirPaths.push(resolvedPath);
      else filePaths.push(resolvedPath);
    }

    if (!filePaths.length && !dirPaths.length) return;

    const targetFolderId = AppState.activeFolderId && AppState.activeFolderId !== 'default'
      ? AppState.activeFolderId : null;

    if (filePaths.length) {
      const { imported } = await window.messsAPI.importFiles(filePaths, targetFolderId, activeCanvasId());
      AppState.files = [...imported, ...AppState.files];
      renderFileList(currentFileListScope());
      await addFilesToBoard(imported.map((file) => file.id), x, y);
      if (imported.length) showToast(t('Imported and added to the board', '已导入并放入整合画布'), '🧩');
    }
    for (const dirPath of dirPaths) {
      const res = await window.messsAPI.importDirectory(dirPath, targetFolderId, activeCanvasId());
      mergeImportedDirectoryResult(res);
      await addFilesToBoard(res.files.map((file) => file.id), x, y);
    }
  });
}

/**
 * A compact, custom video player for board-canvas cards �?replaces the
 * browser's native <video controls>, which had two real problems: it
 * doesn't fill the card without letterboxing (visible black/white bars on
 * the sides when the video's aspect ratio doesn't match the card), and its
 * native control bar is oversized for a small card and doesn't match the
 * app's visual style. object-fit:cover on the <video> itself fixes the
 * letterboxing (the video fills the card, cropping the overflow rather
 * than padding around it). Controls reuse the same precise mouseup/keyup
 * seek-commit pattern as the audio player in preview-canvas.js, since
 * that's what fixed the "imprecise scrubbing" issue there.
 */
/** Same precise-seek pattern as the video player and the main preview
    panel's audio player �?small, fixed-size card for the board canvas. */
function buildMiniAudioPlayer(result, f) {
  const wrap = document.createElement('div');
  wrap.className = 'mini-audio-player';
  wrap.innerHTML = `
    <svg class="mini-audio-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
    <button class="mini-audio-play" aria-label="${t('Play/Pause', '播放/暂停')}">
      <svg class="map-icon-play" viewBox="0 0 24 24" width="10" height="10" fill="currentColor"><polygon points="6 4 20 12 6 20"/></svg>
      <svg class="map-icon-pause" viewBox="0 0 24 24" width="10" height="10" fill="currentColor" hidden><rect x="5" y="4" width="5" height="16"/><rect x="14" y="4" width="5" height="16"/></svg>
    </button>
    <input type="range" class="mini-audio-seek" min="0" max="1000" value="0" step="1" />
    <span class="mini-audio-time">0:00</span>
  `;

  const audioEl = new Audio(result.url);
  const playBtn = wrap.querySelector('.mini-audio-play');
  const iconPlay = wrap.querySelector('.map-icon-play');
  const iconPause = wrap.querySelector('.map-icon-pause');
  const seekEl = wrap.querySelector('.mini-audio-seek');
  const timeLabel = wrap.querySelector('.mini-audio-time');

  let duration = 0;
  let isScrubbing = false;
  const abortController = new AbortController();
  wrap._boardCleanup = () => {
    abortController.abort();
    audioEl.pause();
    audioEl.src = '';
  };

  audioEl.addEventListener('loadedmetadata', () => { if (isFinite(audioEl.duration)) duration = audioEl.duration; });
  audioEl.addEventListener('timeupdate', () => {
    if (isScrubbing || !duration) return;
    seekEl.value = String(Math.round((audioEl.currentTime / duration) * 1000));
    timeLabel.textContent = formatTime(audioEl.currentTime);
  });
  seekEl.addEventListener('input', () => {
    isScrubbing = true;
    if (duration) timeLabel.textContent = formatTime((seekEl.value / 1000) * duration);
  });
  function commitSeek() {
    if (!isScrubbing) return;
    if (duration) audioEl.currentTime = (seekEl.value / 1000) * duration;
  }
  // Bound to document (not seekEl) so a fast drag that carries the cursor
  // outside the slider's bounds before release still gets the mouseup �?  // see the matching fix + explanation in preview-canvas.js's audio player.
  document.addEventListener('mouseup', commitSeek, { signal: abortController.signal });
  seekEl.addEventListener('keyup', commitSeek);
  seekEl.addEventListener('change', commitSeek);
  audioEl.addEventListener('seeked', () => { isScrubbing = false; });

  playBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (audioEl.paused) audioEl.play(); else audioEl.pause();
  });
  audioEl.addEventListener('play', () => { iconPlay.hidden = true; iconPause.hidden = false; });
  audioEl.addEventListener('pause', () => { iconPlay.hidden = false; iconPause.hidden = true; });
  audioEl.addEventListener('ended', () => { iconPlay.hidden = false; iconPause.hidden = true; });

  wrap.addEventListener('mousedown', (e) => e.stopPropagation());

  return wrap;
}

function buildMiniVideoPlayer(result, f) {
  const wrap = document.createElement('div');
  wrap.className = 'mini-video-player';

  const video = document.createElement('video');
  video.src = result.url;
  video.poster = f.thumbUrl || '';
  video.preload = 'auto';
  video.muted = true;
  video.loop = true;
  video.draggable = false;
  video.playsInline = true;
  const durationBadge = createBoardVideoDurationBadge(f);
  wrap.append(video, durationBadge);

  let wantsPreview = false;
  const abortController = new AbortController();
  let playRequest = 0;
  function requestPlayback() {
    const request = ++playRequest;
    const attempt = () => {
      if (!wantsPreview || request !== playRequest || !video.isConnected) return;
      stopOtherBoardVideos(video);
      const promise = video.play();
      if (promise && typeof promise.catch === 'function') {
        promise.catch(() => {
          if (!wantsPreview || request !== playRequest) return;
          if (video.readyState === HTMLMediaElement.HAVE_NOTHING) video.load();
        });
      }
    };
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) attempt();
    else {
      video.addEventListener('loadeddata', attempt, { once: true, signal: abortController.signal });
      video.addEventListener('canplay', attempt, { once: true, signal: abortController.signal });
      video.load();
    }
  }
  wrap._boardPlayPreview = () => {
    wantsPreview = true;
    requestPlayback();
  };
  wrap._boardStopPreview = () => {
    wantsPreview = false;
    playRequest += 1;
    video.pause();
    try { video.currentTime = 0; } catch (error) {}
  };
  wrap._boardCleanup = () => {
    abortController.abort();
    wrap._boardStopPreview();
    video.removeAttribute('src');
    video.load();
  };

  video.addEventListener('loadedmetadata', () => {
    if (!Number.isFinite(video.duration) || video.duration <= 0) return;
    durationBadge.textContent = formatBoardVideoDuration(video.duration);
    durationBadge.hidden = false;
    if (wantsPreview) requestPlayback();
  });

  video.addEventListener('error', async () => {
    if (video.dataset.triedTranscode) return;
    video.dataset.triedTranscode = '1';
    const res = await window.messsAPI.transcodeVideo(f.id);
    if (res.ok) {
      video.src = res.url;
      video.load();
      if (wantsPreview) requestPlayback();
    }
  }, { once: true });

  return wrap;
}

function buildTextNoteEl(item) {
  const el = document.createElement('div');
  el.className = 'board-item board-text-note' + (item.selected ? ' is-selected' : '');
  el.style.left = item.x + 'px';
  el.style.top = item.y + 'px';
  el.style.zIndex = item.zIndex || 1;
  el.dataset.boardId = item.id;

  const content = document.createElement('div');
  content.className = 'board-text-note-content';
  content.contentEditable = 'true';
  content.spellcheck = false;
  content.textContent = item.text;
  content.addEventListener('input', () => {
    item.text = content.textContent;
  });
  content.addEventListener('blur', () => {
    window.messsAPI.upsertBoardItem(item);
  });
  content.addEventListener('mousedown', (e) => e.stopPropagation()); // typing shouldn't start a drag
  el.appendChild(content);
  applyTextNoteStyle(item, content);

  el.addEventListener('click', (e) => {
    if (e.target === content) {
      // Clicking into the text itself opens the detail panel for it,
      // without also toggling board-canvas selection (that would be a
      // confusing double meaning for the same click).
      showTextToolPanel(item, content);
      return;
    }
    if (!(e.ctrlKey || e.metaKey || e.shiftKey)) AppState.boardItems.forEach((b) => { b.selected = false; });
    item.selected = !item.selected;
    if (activeTextNoteId === item.id) hideTextToolPanel();
    syncBoardSelectionClasses();
  });

  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const selectedCount = AppState.boardItems.filter((boardItem) => boardItem.selected).length;
    if (selectedCount >= 2 && item.selected) showBoardMultiContextMenu(e.clientX, e.clientY);
    else showBoardItemContextMenu(item, e.clientX, e.clientY);
  });

  makeBoardItemDraggable(el, item);
  return el;
}

function syncBoardBottomZoomLabel() {
  document.getElementById('board-bottom-zoom-label').textContent = document.getElementById('board-zoom-label').textContent;
}

const SHORTCUTS_TEXT = [
  ['Ctrl/Cmd + A', 'Select all board items', '选择全部画布项目'],
  ['Delete', 'Remove selected items from board', '移除所选画布项目'],
  ['Esc', 'Clear selection or exit drawing', '清除选择或退出绘制'],
  ['Mouse wheel', 'Zoom board', '缩放画布'],
  ['Shift + wheel', 'Pan board', '滚动画布'],
  ['Middle drag', 'Pan board', '平移画布']
];

function boardFullscreenToggleTitle() {
  return isBoardFullscreen()
    ? t('Exit fullscreen', '退出全屏')
    : t('Enter fullscreen canvas', '进入整合画布全屏');
  /* Legacy fallback kept below for compatibility with older bundles. */
  return isBoardFullscreen()
    ? t('Exit fullscreen', '退出全屏')
    : t('Enter fullscreen canvas', '进入整合画布全屏');
}

function boardShortcutsTitle() {
  return t('Shortcuts', '快捷键');
}

function boardAiModeLabel(kind) {
  return kind === 'video' ? t('Video', '视频') : t('Image', '图片');
}

function boardAiModeAriaLabel() {
  return t('Generation type', '生成类型');
}

function boardAiModelAriaLabel() {
  return t('Generation model', '生成模型');
}

function boardAiPromptPlaceholder(kind) {
  return kind === 'video'
    ? t('Describe the video content, camera movement, scene, and sound.', '描述视频内容、镜头运动、场景和声音。')
    : t('Describe the subject, composition, lighting, materials, and color mood.', '描述主体、构图、光线、材质和色彩氛围。');
}

function boardAiReferencePlaceholder(kind) {
  return kind === 'video'
    ? t('Reference image URLs, one per line (optional)', '参考图网址，每行一个（可选）')
    : t('Reference image URLs, one per line, up to 14 (optional)', '参考图网址，每行一个，最多 14 张（可选）');
}

function boardAiSubmitLabel() {
  return t('Start generating', '开始生成');
}

function boardAiSubmittedLabel() {
  return t('Submitted', '已提交');
}

function boardAiGeneratingLabel(elapsed) {
  return t(`Generating... ${elapsed}`, `生成中... ${elapsed}`);
}

function boardAiResolutionHint(size) {
  const px = size === '1K' ? 1024 : size === '2K' ? 2048 : 4096;
  return t(`≈ ${px} px`, `≈ ${px} 像素`);
}

function boardAiCountValue(count) {
  return t(`x${count}`, `×${count}`);
}

function boardAiDurationValue(seconds) {
  return t(`${seconds}s`, `${seconds} 秒`);
}

function renderShortcutsPopover(pop) {
  const shortcuts = [
    ['Ctrl/Cmd + Z', 'Undo last move', '撤回上次移动'],
    ['Ctrl/Cmd + Shift + Z', 'Redo last move', '重做上次移动'],
    ['Ctrl/Cmd + A', 'Select all board items', '选择全部画布项目'],
    ['Delete', 'Remove selected items from board', '移除所选画布项目'],
    ['Esc', 'Clear selection or exit drawing', '清除选择或退出绘制'],
    ['Mouse wheel', 'Zoom board', '缩放画布'],
    ['Shift + wheel', 'Pan board', '滚动画布'],
    ['Middle drag', 'Pan board', '平移画布']
  ];
  pop.innerHTML = '<div class="shortcuts-title">' + t('Shortcuts', '快捷键') + '</div>' + shortcuts.map(([key, en, zh]) =>
    `<div class="shortcuts-row"><span>${escapeHtml(t(en, zh))}</span><kbd>${escapeHtml(key)}</kbd></div>`
  ).join('');
}

function refreshBoardLanguage() {
  const fullscreenTitle = isBoardFullscreen()
    ? t('Exit fullscreen', '退出全屏')
    : t('Enter fullscreen canvas', '进入整合画布全屏');
  ['board-fullscreen-toggle', 'board-bottom-fullscreen-toggle'].forEach((id) => {
    const button = document.getElementById(id);
    if (!button) return;
    button.title = fullscreenTitle;
    button.setAttribute('aria-label', fullscreenTitle);
  });
  const locateButton = document.getElementById('board-fit-all');
  if (locateButton) {
    locateButton.title = t('Locate images', '定位图片');
    locateButton.setAttribute('aria-label', locateButton.title);
  }
  const resetZoomTitle = t('Reset to 100%', '重置为 100%', '100%로 재설정');
  ['board-zoom-label', 'board-bottom-zoom-label'].forEach((id) => {
    const button = document.getElementById(id);
    if (!button) return;
    button.title = resetZoomTitle;
    button.setAttribute('aria-label', resetZoomTitle);
  });

  const composer = document.getElementById('ai-image-popover');
  if (composer && typeof composer._refreshLanguage === 'function') composer._refreshLanguage();
  const shortcuts = document.getElementById('shortcuts-popover');
  if (shortcuts) renderShortcutsPopover(shortcuts);
}

let aiImagePopoverClickCloser = null;
let aiImagePopoverKeyCloser = null;
const aiMediaTasks = new Map();
let aiMediaConfigPromise = null;

function beginAiMediaTask(request) {
  const taskId = `ai-task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  aiMediaTasks.set(taskId, {
    id: taskId,
    kind: request && request.kind === 'video' ? 'video' : 'image',
    startedAt: Date.now()
  });
  return taskId;
}

function finishAiMediaTask(taskId) {
  aiMediaTasks.delete(taskId);
}

function loadAiMediaConfigCached() {
  if (!aiMediaConfigPromise) {
    aiMediaConfigPromise = window.messsAPI.getAiMediaConfig().catch((error) => {
      aiMediaConfigPromise = null;
      throw error;
    });
  }
  return aiMediaConfigPromise;
}

document.addEventListener('messs:ai-config-updated', (event) => {
  aiMediaConfigPromise = event.detail ? Promise.resolve(event.detail) : null;
});

function setAiImageButtonsActive(active) {
  ['board-tool-ai-image', 'board-tool-ai-video'].forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) btn.classList.toggle('is-active', active);
  });
}

function activeAiComposer() {
  const pop = document.getElementById('ai-image-popover');
  return pop && pop.classList.contains('ai-composer') ? pop : null;
}

function isAiComposerReference(fileId) {
  const pop = activeAiComposer();
  return !!(pop && typeof pop._hasBoardReference === 'function' && pop._hasBoardReference(fileId));
}

function syncAiComposerReferenceClasses() {
  document.querySelectorAll('#board-canvas .board-item-image').forEach((element) => {
    const item = Board.itemsById.get(element.dataset.boardId);
    element.classList.toggle('is-ai-reference', !!(item && isAiComposerReference(item.fileId)));
  });
}

function boardImageItemAtClientPoint(clientX, clientY) {
  const viewport = document.getElementById('board-viewport');
  const target = document.elementFromPoint(clientX, clientY);
  if (!viewport || !target || !viewport.contains(target)) return null;
  const point = clientToBoardCoords(clientX, clientY);
  const tolerance = Math.max(0.25, 1 / Math.max(Board.zoom, 0.001));
  const matches = Board.spatialIndex.query({
    x: point.x - tolerance / 2,
    y: point.y - tolerance / 2,
    w: tolerance,
    h: tolerance
  });
  return [...matches]
    .map((id) => Board.itemsById.get(id))
    .filter((item) => {
      const file = item && Board.filesById.get(item.fileId);
      return file && isImageExt(file.ext);
    })
    .sort((a, b) => Number(b.zIndex || 0) - Number(a.zIndex || 0))[0] || null;
}

async function toggleAiComposerBoardReference(file, fileId) {
  const pop = activeAiComposer();
  if (!pop || !file || !isImageExt(file.ext) || typeof pop._toggleBoardReference !== 'function') return;
  try {
    await pop._toggleBoardReference(fileId);
    syncAiComposerReferenceClasses();
  } catch (err) {
    showToast(
      err && err.message ? err.message : t('Could not add the reference image.', '无法添加参考图。'),
      'AI'
    );
  }
}

function closeAiImagePopover() {
  const pop = document.getElementById('ai-image-popover');
  if (pop) {
    if (pop.classList.contains('ai-composer')) {
      pop.classList.add('is-closing');
      setTimeout(() => pop.remove(), 180);
    } else {
      pop.remove();
    }
  }
  document.querySelectorAll('#board-canvas .board-item-image.is-ai-reference').forEach((element) => {
    element.classList.remove('is-ai-reference');
  });
  setAiImageButtonsActive(false);
  if (aiImagePopoverClickCloser) {
    document.removeEventListener('click', aiImagePopoverClickCloser);
    aiImagePopoverClickCloser = null;
  }
  if (aiImagePopoverKeyCloser) {
    document.removeEventListener('keydown', aiImagePopoverKeyCloser);
    aiImagePopoverKeyCloser = null;
  }
}

function boardViewportCenterCoords() {
  const viewport = document.getElementById('board-viewport');
  const rect = viewport.getBoundingClientRect();
  return clientToBoardCoords(rect.left + rect.width / 2, rect.top + rect.height / 2);
}

async function importFilesDirectlyToBoard(paths, placement = boardViewportCenterCoords()) {
  const targetFolderId = AppState.activeFolderId && AppState.activeFolderId !== 'default'
    ? AppState.activeFolderId
    : null;
  const result = await window.messsAPI.importFiles(paths, targetFolderId, activeCanvasId());
  const imported = Array.isArray(result && result.imported) ? result.imported : [];
  if (!imported.length) return imported;

  AppState.files = [...imported, ...AppState.files.filter((file) => (
    !imported.some((next) => next.id === file.id)
  ))];
  renderFileList(currentFileListScope());
  renderFolderGridIfActive();
  await addFilesToBoard(imported.map((file) => file.id), placement.x, placement.y);
  if (result.unlocked && result.unlocked.length) await refreshAchievements();
  showToast(
    t(
      `Imported ${imported.length} file${imported.length === 1 ? '' : 's'} to the canvas`,
      `已导入 ${imported.length} 个文件到画布`
    )
  );
  return imported;
}

async function pasteExternalImageToBoard(placement = boardViewportCenterCoords()) {
  const result = await window.messsAPI.importClipboardImage({
    canvasId: activeCanvasId(),
    folderId: AppState.activeFolderId
  });
  if (!result || !result.ok || !result.file) return false;
  const file = result.file;
  AppState.files = [file, ...AppState.files.filter((entry) => entry.id !== file.id)];
  renderFileList(currentFileListScope());
  renderFolderGridIfActive();
  await addFilesToBoard([file.id], placement.x, placement.y);
  return true;
}

function buildAiImagePopover(aiConfig) {
  const pop = document.createElement('div');
  pop.id = 'ai-image-popover';
  pop.className = 'ai-image-popover' + (isBoardFullscreen() ? '' : ' is-panel-popover');

  const title = document.createElement('div');
  title.className = 'ai-image-title';
  title.innerHTML = '<span>AI 创作</span><small>图片与视频生成</small>';
  pop.appendChild(title);

  const form = document.createElement('form');
  form.className = 'ai-image-form';

  const modeSwitch = document.createElement('div');
  modeSwitch.className = 'ai-media-mode-switch';
  modeSwitch.innerHTML = `
    <button type="button" class="is-active" data-ai-kind="image">图片</button>
    <button type="button" data-ai-kind="video">视频</button>
  `;
  form.appendChild(modeSwitch);

  const textarea = document.createElement('textarea');
  textarea.id = 'ai-image-prompt';
  textarea.className = 'ai-image-prompt';
  textarea.placeholder = '描述主体、构图、镜头、光线、材质和色彩氛围…';
  textarea.rows = 5;
  form.appendChild(textarea);

  const options = document.createElement('div');
  options.className = 'ai-image-options';

  const sizeSelect = document.createElement('select');
  sizeSelect.className = 'ai-image-size';
  [['1K', '1K'], ['2K', '2K'], ['4K', '4K']].forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    sizeSelect.appendChild(option);
  });
  sizeSelect.value = aiConfig.imageSize || '1K';
  options.appendChild(sizeSelect);

  const ratioSelect = document.createElement('select');
  ratioSelect.className = 'ai-image-size';
  const imageRatios = ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'];
  imageRatios.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value === 'auto' ? '自动比例' : value;
    ratioSelect.appendChild(option);
  });
  ratioSelect.value = aiConfig.imageAspectRatio || 'auto';
  options.appendChild(ratioSelect);

  const durationSelect = document.createElement('select');
  durationSelect.className = 'ai-image-size';
  for (let seconds = 6; seconds <= 15; seconds += 1) {
    const option = document.createElement('option');
    option.value = String(seconds);
    option.textContent = `${seconds} 秒`;
    durationSelect.appendChild(option);
  }
  durationSelect.value = String(aiConfig.videoDuration || 6);
  durationSelect.hidden = true;
  options.appendChild(durationSelect);
  form.appendChild(options);

  const actions = document.createElement('div');
  actions.className = 'ai-image-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'ai-image-btn';
  cancelBtn.textContent = '取消';
  cancelBtn.addEventListener('click', closeAiImagePopover);
  actions.appendChild(cancelBtn);

  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'ai-image-btn ai-image-btn-primary';
  submitBtn.textContent = '生成图片';
  actions.appendChild(submitBtn);
  form.appendChild(actions);

  let kind = 'image';
  function updateMode(nextKind) {
    kind = nextKind === 'video' ? 'video' : 'image';
    modeSwitch.querySelectorAll('button').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.aiKind === kind);
    });
    sizeSelect.hidden = kind === 'video';
    durationSelect.hidden = kind !== 'video';
    const ratios = kind === 'video' ? ['16:9', '9:16'] : imageRatios;
    const savedRatio = kind === 'video'
      ? (aiConfig.videoAspectRatio || '16:9')
      : (aiConfig.imageAspectRatio || 'auto');
    ratioSelect.innerHTML = '';
    ratios.forEach((value) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value === 'auto' ? '自动比例' : value;
      ratioSelect.appendChild(option);
    });
    ratioSelect.value = ratios.includes(savedRatio) ? savedRatio : ratios[0];
    textarea.placeholder = kind === 'video'
      ? '描述视频内容、动作、镜头运动、环境和声音…'
      : '描述主体、构图、镜头、光线、材质和色彩氛围…';
    submitBtn.textContent = kind === 'video' ? '生成视频' : '生成图片';
  }
  modeSwitch.addEventListener('click', (event) => {
    const button = event.target.closest('[data-ai-kind]');
    if (button) updateMode(button.dataset.aiKind);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const prompt = textarea.value.trim();
    if (!prompt) {
      showToast('请输入生成提示词', 'AI');
      textarea.focus();
      return;
    }
    await generateAiMediaForBoard({
      kind,
      prompt,
      size: sizeSelect.value,
      aspectRatio: ratioSelect.value,
      duration: durationSelect.value,
      urls: []
    }, submitBtn, cancelBtn, [
      textarea,
      sizeSelect,
      ratioSelect,
      durationSelect,
      ...modeSwitch.querySelectorAll('button')
    ]);
  });

  pop.appendChild(form);
  return pop;
}
async function generateAiMediaForBoard(request, submitBtn, cancelBtn, controls) {
  const taskId = beginAiMediaTask(request);
  submitBtn.disabled = true;
  cancelBtn.disabled = true;
  controls.forEach((control) => { control.disabled = true; });
  const defaultButtonText = request.kind === 'video' ? '生成视频' : '生成图片';
  const startedAt = Date.now();
  submitBtn.textContent = '提交中…';
  const progressTimer = setInterval(() => {
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    submitBtn.textContent = `生成中 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }, 1000);

  try {
    const folderId = AppState.activeFolderId && AppState.activeFolderId !== 'default'
      ? AppState.activeFolderId
      : null;
    const center = boardViewportCenterCoords();
    const res = await window.messsAPI.generateAiMedia({ ...request, folderId, canvasId: activeCanvasId() });

    if (!res || !res.ok) {
      const msg = res && res.reason === 'missing-api-key'
        ? '请先在设置中保存速创 API 密钥。'
        : (res && res.message) || 'AI 生成失败。';
      showToast(msg, 'AI');
      return;
    }

    AppState.files = [res.file, ...AppState.files.filter((f) => f.id !== res.file.id)];
    renderFileList(currentFileListScope());
    renderFolderGridIfActive();
    selectFileForPreview(res.file.id);
    await addFileToBoard(res.file.id, center.x, center.y);

    if (res.unlocked && res.unlocked.length) {
      await refreshAchievements();
    }

    showToast(request.kind === 'video' ? 'AI 视频已加入画布' : 'AI 图片已加入画布', 'AI');
    closeAiImagePopover();
  } catch (err) {
    showToast(err && err.message ? err.message : 'AI 生成失败。', 'AI');
  } finally {
    clearInterval(progressTimer);
    finishAiMediaTask(taskId);
    submitBtn.disabled = false;
    cancelBtn.disabled = false;
    controls.forEach((control) => { control.disabled = false; });
    submitBtn.textContent = defaultButtonText;
  }
}

const AI_IMAGE_RATIOS = ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'];
const DEFAULT_VIDEO_RESOLUTIONS = ['768P', '2K'];
const DEFAULT_VIDEO_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];

function normalizedCapabilityValues(values, fallback = []) {
  const normalize = (source) => [...new Set(
    source.map((entry) => String(entry || '').trim()).filter(Boolean)
  )];
  const configured = Array.isArray(values) ? normalize(values) : [];
  return configured.length ? configured : normalize(fallback);
}

function supportedImageSizes(capabilities = {}, referenceCount = 0) {
  const configured = referenceCount > 1 && Array.isArray(capabilities.multiReferenceSizes)
    ? capabilities.multiReferenceSizes
    : referenceCount > 0 && Array.isArray(capabilities.referenceSizes)
      ? capabilities.referenceSizes
    : capabilities.sizes;
  return normalizedCapabilityValues(configured, ['1K', '2K', '4K']);
}

function supportedImageSize(value, capabilities = {}, referenceCount = 0) {
  const supported = supportedImageSizes(capabilities, referenceCount);
  const requested = String(value || '').trim();
  return supported.includes(requested) ? requested : supported[0];
}

function supportedImageRatios(capabilities = {}, hasReferenceImages = false) {
  return normalizedCapabilityValues(
    hasReferenceImages && Array.isArray(capabilities.referenceRatios)
      ? capabilities.referenceRatios
      : capabilities.ratios,
    AI_IMAGE_RATIOS
  );
}

function supportedImageAspectRatio(value, capabilities = {}, hasReferenceImages = false) {
  const supported = supportedImageRatios(capabilities, hasReferenceImages);
  const requested = String(value || '').trim();
  if (supported.includes(requested)) return requested;
  if (supported.includes('auto')) return 'auto';
  const numeric = BoardEngine.parseAspectRatio(requested, NaN);
  if (Number.isFinite(numeric)) {
    const candidates = supported
      .map((ratio) => ({ ratio, numeric: BoardEngine.parseAspectRatio(ratio, NaN) }))
      .filter((entry) => Number.isFinite(entry.numeric));
    if (candidates.length) {
      return candidates.reduce((nearest, candidate) => (
        Math.abs(candidate.numeric - numeric) < Math.abs(nearest.numeric - numeric) ? candidate : nearest
      )).ratio;
    }
  }
  return supported[0] || '1:1';
}

function supportedVideoResolutions(capabilities = {}) {
  return normalizedCapabilityValues(capabilities.resolutions, DEFAULT_VIDEO_RESOLUTIONS)
    .map((entry) => entry.toUpperCase());
}

function supportedVideoResolution(value, capabilities = {}) {
  const supported = supportedVideoResolutions(capabilities);
  const requested = String(value || '').trim().toUpperCase();
  return supported.includes(requested) ? requested : (supported[0] || '768P');
}

function supportedVideoRatios(capabilities = {}, hasFrameReference = false) {
  return normalizedCapabilityValues(
    hasFrameReference ? capabilities.frameReferenceRatios : capabilities.ratios,
    hasFrameReference ? ['adaptive'] : DEFAULT_VIDEO_RATIOS
  );
}

function supportedVideoAspectRatio(value, capabilities = {}, hasFrameReference = false) {
  const supported = supportedVideoRatios(capabilities, hasFrameReference);
  const requested = String(value || '').trim();
  if (supported.includes(requested)) return requested;
  if (hasFrameReference && supported.includes('adaptive')) return 'adaptive';
  if (supported.includes('16:9')) return '16:9';
  return supported[0] || (hasFrameReference ? 'adaptive' : '16:9');
}

function supportedVideoDurations(capabilities = {}) {
  const values = Array.isArray(capabilities.durations) && capabilities.durations.length
    ? capabilities.durations
    : [6, 8, 10, 15];
  return [...new Set(values.map(Number).filter((value) => Number.isInteger(value) && value > 0))]
    .sort((left, right) => left - right);
}

function supportedVideoDuration(value, capabilities = {}) {
  const supported = supportedVideoDurations(capabilities);
  const requested = Math.round(Number(value));
  if (supported.includes(requested)) return requested;
  if (!Number.isFinite(requested)) return supported[0] || 6;
  return supported.reduce((nearest, candidate) => (
    Math.abs(candidate - requested) < Math.abs(nearest - requested) ? candidate : nearest
  ), supported[0] || 6);
}

function resolutionDisplayHint(value) {
  const normalized = String(value || '').trim().toUpperCase();
  const labels = {
    '480P': '480p',
    '720P': '720p',
    '768P': '768p',
    '1K': '1024 px',
    '2K': '2048 px',
    '4K': '4096 px',
    'ORIGINAL': 'Original'
  };
  return labels[normalized] || normalized;
}

function getConfiguredImageProviders(aiConfig) {
  const providers = Array.isArray(aiConfig.imageProviders)
    ? aiConfig.imageProviders.filter((provider) => provider && provider.available !== false && provider.name && provider.endpoint)
    : [];
  if (providers.length) return providers;
  if (aiConfig.providerVisibilityEnforced) return [];
  return [{
    id: 'image-1',
    name: 'Nano Banana Pro',
    endpoint: aiConfig.imageEndpoint
  }];
}

function getConfiguredVideoProviders(aiConfig) {
  const providers = Array.isArray(aiConfig.videoProviders)
    ? aiConfig.videoProviders.filter((provider) => provider && provider.available !== false && provider.name && provider.endpoint)
    : [];
  if (providers.length) return providers;
  if (aiConfig.providerVisibilityEnforced) return [];
  return [{
    id: 'video-1',
    name: aiConfig.videoProviderName || 'MiniMax H3',
    endpoint: aiConfig.videoEndpoint
  }];
}

function createAiPlaceholders(request) {
  const count = request.kind === 'image' ? Math.max(1, Math.min(4, Number(request.count) || 1)) : 1;
  const size = BoardEngine.fitAspectRatio(request.aspectRatio, 300, 220);
  const targetCanvasId = request.canvasId || activeCanvasId();
  const positions = BoardEngine.gridAroundCenter(count, size, request.placement || boardViewportCenterCoords(), 24);
  const items = positions.map((position, index) => ({
    id: 'ai_pending_' + Math.random().toString(36).slice(2, 10),
    isAiPlaceholder: true,
    kind: request.kind,
    modelName: request.modelName,
    x: position.x,
    y: position.y,
    width: size.width,
    height: size.height,
    aspectRatio: request.aspectRatio,
    zIndex: AppState.boardItems.length + index + 1,
    canvasId: targetCanvasId
  }));
  AppState.boardItems.push(...items);
  items.forEach(canvasWorkspaceAddItem);
  renderBoard();
  return items;
}

async function replaceAiPlaceholders(placeholders, files, request, persistedItems = []) {
  const updates = [];
  const placeholderIds = new Set(placeholders.map((placeholder) => placeholder.id));
  const replacedIds = new Set();
  const persistedById = new Map(
    persistedItems.filter((item) => item && item.id).map((item) => [item.id, item])
  );
  const persistedFileIds = new Set(persistedItems.map((item) => item && item.fileId).filter(Boolean));
  const fallbackFiles = files.filter((file) => !persistedFileIds.has(file.id));
  let fallbackFileIndex = 0;
  placeholders.forEach((placeholder, index) => {
    const itemIndex = AppState.allBoardItems.findIndex((item) => item.id === placeholder.id);
    const persistedItem = persistedById.get(placeholder.id);
    const file = persistedItem
      ? files.find((entry) => entry.id === persistedItem.fileId)
      : fallbackFiles[fallbackFileIndex++];
    if (!file) {
      return;
    }
    const sourceWidth = Number(file.sourceWidth || file.width || 0);
    const sourceHeight = Number(file.sourceHeight || file.height || 0);
    const ratio = sourceWidth && sourceHeight
      ? sourceWidth / sourceHeight
      : BoardEngine.parseAspectRatio(
        request.aspectRatio,
        placeholder.width / Math.max(1, placeholder.height)
      );
    const item = persistedItem || {
      // Keep the placeholder id so the main-process upsert replaces the
      // transient record instead of leaving an orphaned pending card that
      // reappears after the next launch.
      id: placeholder.id,
      fileId: file.id,
      canvasId: placeholder.canvasId || request.canvasId || activeCanvasId(),
      x: placeholder.x,
      y: placeholder.y,
      width: placeholder.width,
      height: Math.max(1, Math.round(placeholder.width / ratio)),
      aspectRatio: request.aspectRatio,
      zIndex: placeholder.zIndex,
      selected: index === 0
    };
    if (sourceWidth > 0 && sourceHeight > 0) {
      item.height = Math.max(1, Math.round(item.width * sourceHeight / sourceWidth));
      item.aspectRatio = `${Math.round(sourceWidth)}:${Math.round(sourceHeight)}`;
    }
    delete item.isAiPlaceholder;
    item.selected = index === 0;
    if (itemIndex < 0) AppState.allBoardItems.push(item);
    else AppState.allBoardItems[itemIndex] = item;
    replacedIds.add(item.id);
    updates.push(item);
  });
  const placedFileIds = new Set(updates.map((item) => item.fileId));
  const missingFiles = files.filter((file) => !placedFileIds.has(file.id));
  if (missingFiles.length) {
    const fallbackSize = BoardEngine.fitAspectRatio(request.aspectRatio, 300, 220);
    const fallbackPositions = BoardEngine.gridAroundCenter(
      missingFiles.length,
      fallbackSize,
      boardViewportCenterCoords(),
      24
    );
    missingFiles.forEach((file, index) => {
      const sourceWidth = Number(file.sourceWidth || file.width || 0);
      const sourceHeight = Number(file.sourceHeight || file.height || 0);
      const sourceRatio = sourceWidth > 0 && sourceHeight > 0
        ? sourceWidth / sourceHeight
        : fallbackSize.width / fallbackSize.height;
      const item = {
        id: 'b_' + Math.random().toString(36).slice(2, 10),
        fileId: file.id,
        canvasId: request.canvasId || activeCanvasId(),
        x: fallbackPositions[index].x,
        y: fallbackPositions[index].y,
        width: fallbackSize.width,
        height: Math.max(1, Math.round(fallbackSize.width / sourceRatio)),
        aspectRatio: sourceWidth > 0 && sourceHeight > 0
          ? `${Math.round(sourceWidth)}:${Math.round(sourceHeight)}`
          : request.aspectRatio,
        zIndex: AppState.allBoardItems.length + index + 1,
        selected: updates.length === 0 && index === 0
      };
      AppState.allBoardItems.push(item);
      updates.push(item);
    });
  }
  AppState.allBoardItems = AppState.allBoardItems.filter((item) =>
    !placeholderIds.has(item.id) || replacedIds.has(item.id)
  );
  AppState.boardItems = AppState.allBoardItems.filter((item) => (item.canvasId || 'canvas-1') === activeCanvasId());
  if (typeof window.messsAPI.upsertBoardItems === 'function') {
    await window.messsAPI.upsertBoardItems(updates);
  } else {
    await Promise.all(updates.map((item) => window.messsAPI.upsertBoardItem(item)));
  }
  canvasWorkspaceTouch(request.canvasId || activeCanvasId());
  await canvasWorkspaceSave();
  renderBoard();
  if (
    updates.length &&
    activeCanvasId() === (request.canvasId || activeCanvasId()) &&
    !(typeof CanvasNodeMode !== 'undefined' && CanvasNodeMode.mode === 'node')
  ) {
    requestAnimationFrame(() => fitBoardItemsToViewport(updates));
  }
  if (typeof renderCanvasLibrary === 'function') renderCanvasLibrary();
}

function removeAiPlaceholders(placeholders) {
  const ids = new Set(placeholders.map((item) => item.id));
  AppState.boardItems = AppState.boardItems.filter((item) => !ids.has(item.id));
  canvasWorkspaceRemoveItems([...ids]);
  ids.forEach((id) => {
    if (window.messsAPI && typeof window.messsAPI.removeBoardItem === 'function') {
      Promise.resolve(window.messsAPI.removeBoardItem(id)).catch(() => {});
    }
  });
  renderBoard();
}

function buildAiComposer(aiConfig, initialKind = 'image') {
  const pop = document.createElement('div');
  pop.id = 'ai-image-popover';
  pop.className = 'ai-image-popover ai-composer' + (isBoardFullscreen() ? '' : ' is-panel-popover');
  pop.innerHTML = `
    <form class="ai-composer-form">
      <button type="button" class="ai-composer-close">
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
      <div class="ai-composer-mode" role="tablist" aria-label="生成类型">
        <button type="button" data-ai-kind="image" role="tab">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M3 17l5-5 4 4 3-3 6 6"/></svg>
          图片
        </button>
        <button type="button" data-ai-kind="video" role="tab">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="5" width="15" height="14" rx="2"/><path d="M17 10l5-3v10l-5-3z"/></svg>
          视频
        </button>
      </div>
      <div class="ai-composer-reference-strip" aria-label="参考图" hidden></div>
      <textarea class="ai-composer-prompt" rows="4" spellcheck="false"></textarea>
      <div class="ai-composer-footer">
        <div class="ai-composer-controls">
          <div class="ai-model-picker">
            <select class="ai-model-select" aria-label="生成模型"></select>
            <button type="button" class="ai-model-picker-trigger" aria-haspopup="listbox" aria-expanded="false">
              <span class="ai-model-picker-label"></span>
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 10l5 5 5-5"/></svg>
            </button>
            <div class="ai-model-picker-menu" role="listbox" hidden></div>
          </div>
          <button type="button" class="ai-options-toggle" aria-haspopup="true"></button>
        </div>
        <div class="ai-composer-submit-wrap">
          <span class="ai-credit-estimate" aria-live="polite" hidden></span>
          <span class="ai-generation-status"></span>
          <button type="submit" class="ai-composer-submit" aria-label="开始生成">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg>
          </button>
        </div>
      </div>
      <div class="ai-options-panel" hidden>
        <div class="ai-options-heading"><strong>画面比例</strong><span class="ai-ratio-value"></span></div>
        <div class="ai-ratio-grid"></div>
        <div class="ai-option-block ai-resolution-block">
          <div class="ai-options-heading"><strong>分辨率</strong><span class="ai-resolution-hint">≈ 1024 px</span></div>
          <div class="ai-segmented" data-option="size">
            <button type="button" data-value="1K">1K</button>
            <button type="button" data-value="2K">2K</button>
            <button type="button" data-value="4K">4K</button>
          </div>
        </div>
        <div class="ai-option-block ai-count-block">
          <div class="ai-options-heading"><strong>数量</strong><span class="ai-count-value">× 1</span></div>
          <div class="ai-segmented" data-option="count">
            <button type="button" data-value="1">1</button>
            <button type="button" data-value="2">2</button>
            <button type="button" data-value="3">3</button>
            <button type="button" data-value="4">4</button>
          </div>
        </div>
        <div class="ai-option-block ai-higgsfield-block" hidden>
          <label class="ai-field-row">
            <span>${t('Style', '风格')}</span>
            <select class="ai-higgsfield-style"><option value="">${t('No style', '不使用风格')}</option></select>
          </label>
          <label class="ai-field-row ai-field-toggle">
            <span>${t('Enhance prompt', '增强提示词')}</span>
            <input class="ai-higgsfield-enhance" type="checkbox" checked>
          </label>
          <label class="ai-field-row">
            <span>${t('Seed', '随机种子')}</span>
            <input class="ai-higgsfield-seed" type="number" min="1" max="1000000" step="1" placeholder="Auto">
          </label>
          <label class="ai-field-row ai-field-strength">
            <span>${t('Style strength', '风格强度')}</span>
            <input class="ai-higgsfield-strength" type="range" min="0" max="1" step="0.05" value="1">
            <output>1.00</output>
          </label>
        </div>
        <div class="ai-option-block ai-duration-block" hidden>
          <div class="ai-options-heading"><strong>时长</strong><span class="ai-duration-value">6 秒</span></div>
          <input class="ai-duration-range" type="range" min="6" max="15" value="6" step="1">
        </div>
      </div>
    </form>
  `;

  const form = pop.querySelector('form');
  const prompt = pop.querySelector('.ai-composer-prompt');
  const referenceStrip = pop.querySelector('.ai-composer-reference-strip');
  const modelSelect = pop.querySelector('.ai-model-select');
  const modelPicker = pop.querySelector('.ai-model-picker');
  const modelPickerTrigger = pop.querySelector('.ai-model-picker-trigger');
  const modelPickerLabel = pop.querySelector('.ai-model-picker-label');
  const modelPickerMenu = pop.querySelector('.ai-model-picker-menu');
  const optionsToggle = pop.querySelector('.ai-options-toggle');
  const optionsPanel = pop.querySelector('.ai-options-panel');
  const ratioGrid = pop.querySelector('.ai-ratio-grid');
  const status = pop.querySelector('.ai-generation-status');
  const creditEstimate = pop.querySelector('.ai-credit-estimate');
  const submit = pop.querySelector('.ai-composer-submit');
  const close = pop.querySelector('.ai-composer-close');
  const higgsfieldBlock = pop.querySelector('.ai-higgsfield-block');
  const higgsfieldStyle = pop.querySelector('.ai-higgsfield-style');
  const higgsfieldEnhance = pop.querySelector('.ai-higgsfield-enhance');
  const higgsfieldSeed = pop.querySelector('.ai-higgsfield-seed');
  const higgsfieldStrength = pop.querySelector('.ai-higgsfield-strength');
  const providers = getConfiguredImageProviders(aiConfig);
  const videoProviders = getConfiguredVideoProviders(aiConfig);
  let kind = initialKind === 'video' ? 'video' : 'image';
  let ratio = kind === 'video' ? (aiConfig.videoAspectRatio || '16:9') : (aiConfig.imageAspectRatio || '1:1');
  let size = aiConfig.imageSize || '1K';
  let count = 1;
  let duration = Number(aiConfig.videoDuration) || 6;
  let styleId = '';
  let enhancePrompt = true;
  let seed = null;
  let styleStrength = 1;
  let styleLoadRevision = 0;
  const boardReferences = new Map();
  let creditQuoteRevision = 0;

  function setOptionsOpen(open) {
    optionsPanel.hidden = !open;
    optionsToggle.classList.toggle('is-active', open);
  }

  function keepOptionsOpen() {
    setOptionsOpen(true);
  }

  function renderBoardReferences() {
    referenceStrip.innerHTML = '';
    referenceStrip.hidden = boardReferences.size === 0;
    boardReferences.forEach((entry) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ai-composer-reference-thumb';
      button.title = t(`Remove ${entry.name}`, `移除 ${entry.name}`);
      button.setAttribute('aria-label', button.title);
      const image = document.createElement('img');
      image.src = entry.thumbUrl || entry.dataUrl;
      image.alt = entry.name;
      const remove = document.createElement('span');
      remove.setAttribute('aria-hidden', 'true');
      remove.textContent = '×';
      button.append(image, remove);
      button.addEventListener('click', () => {
        boardReferences.delete(entry.fileId);
        renderBoardReferences();
        if (kind === 'video' && !boardReferences.size) ratio = aiConfig.videoAspectRatio || '16:9';
        syncGenerationOptions();
        syncAiComposerReferenceClasses();
      });
      referenceStrip.appendChild(button);
    });
  }

  async function toggleBoardReference(fileId) {
    if (boardReferences.has(fileId)) {
      boardReferences.delete(fileId);
      renderBoardReferences();
      if (kind === 'video' && !boardReferences.size) ratio = aiConfig.videoAspectRatio || '16:9';
      syncGenerationOptions();
      syncAiComposerReferenceClasses();
      return;
    }
    const capabilities = kind === 'video' ? selectedVideoCapabilities() : selectedImageCapabilities();
    const configuredLimit = Number(capabilities.maxReferenceImages);
    const limit = Number.isFinite(configuredLimit) && configuredLimit >= 0
      ? Math.floor(configuredLimit)
      : (kind === 'video' ? 2 : 14);
    if (limit === 0) {
      showToast(t('This model does not accept reference images.', '此模型不支持参考图。'), 'AI');
      return;
    }
    if (boardReferences.size >= limit) {
      showToast(
        t(`Up to ${limit} reference images can be used.`, `最多可使用 ${limit} 张参考图。`),
        'AI'
      );
      return;
    }
    const file = AppState.files.find((entry) => entry.id === fileId);
    if (!file || !isImageExt(file.ext)) return;
    const dataUrl = await window.messsAPI.readFileAsDataUrl(file.id);
    if (!dataUrl) throw new Error(t('Could not read the reference image.', '无法读取参考图。'));
    boardReferences.set(file.id, {
      fileId: file.id,
      name: file.name,
      dataUrl,
      thumbUrl: file.thumbUrl || file.url,
      sourceWidth: Number(file.sourceWidth) || null,
      sourceHeight: Number(file.sourceHeight) || null
    });
    renderBoardReferences();
    syncGenerationOptions();
    syncAiComposerReferenceClasses();
  }

  function setModeButtonLabel(button, label) {
    if (!button) return;
    [...button.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .forEach((node) => node.remove());
    button.appendChild(document.createTextNode(` ${label}`));
    button.setAttribute('aria-label', label);
  }

  function refreshLanguage() {
    const mode = pop.querySelector('.ai-composer-mode');
    const imageButton = pop.querySelector('[data-ai-kind="image"]');
    const videoButton = pop.querySelector('[data-ai-kind="video"]');
    const headings = pop.querySelectorAll('.ai-options-heading strong');
    const px = resolutionDisplayHint(size);
    const autoLabel = t('Auto', '自动');

    mode.setAttribute('aria-label', t('Generation type', '生成类型'));
    setModeButtonLabel(imageButton, t('Image', '图片'));
    setModeButtonLabel(videoButton, t('Video', '视频'));
    modelSelect.setAttribute('aria-label', t('Generation model', '生成模型'));
    modelPickerTrigger.title = t('Choose generation model', '选择生成模型');
    modelPickerTrigger.setAttribute('aria-label', t('Choose generation model', '选择生成模型'));
    prompt.placeholder = kind === 'video'
      ? t(
        'Describe the video content, action, camera movement, environment, and sound.',
        '描述视频内容、动作、镜头运动、环境和声音。'
      )
      : t(
        'Describe the subject, composition, camera, lighting, materials, and color mood.',
        '描述主体、构图、镜头、光线、材质和色彩氛围。'
      );
    referenceStrip.setAttribute('aria-label', t('Selected reference images', '已选参考图'));

    const submitLabel = t('Start generating', '开始生成');
    submit.title = submitLabel;
    submit.setAttribute('aria-label', submitLabel);
    optionsToggle.title = t('Generation settings', '生成设置');
    optionsToggle.setAttribute('aria-label', optionsToggle.title);
    close.title = t('Close generation panel', '关闭生成面板');
    close.setAttribute('aria-label', close.title);

    if (headings[0]) headings[0].textContent = t('Aspect ratio', '画面比例');
    if (headings[1]) headings[1].textContent = t('Resolution', '分辨率');
    if (headings[2]) headings[2].textContent = t('Count', '数量');
    if (headings[3]) headings[3].textContent = t('Duration', '时长');
    pop.querySelector('.ai-ratio-value').textContent = ratio === 'auto' || ratio === 'adaptive' ? autoLabel : ratio;
    pop.querySelectorAll('.ai-ratio-grid button[data-value="auto"] small, .ai-ratio-grid button[data-value="adaptive"] small').forEach((label) => {
      label.textContent = autoLabel;
    });
    pop.querySelector('.ai-count-value').textContent = t(`x ${count}`, `× ${count}`);
    pop.querySelector('.ai-resolution-hint').textContent = `≈ ${px}`;
    pop.querySelector('.ai-duration-value').textContent = t(`${duration}s`, `${duration} 秒`);
    refreshCreditEstimateLanguage();
    optionsToggle.textContent = kind === 'video'
      ? t(`${ratio} · ${size} · ${duration}s`, `${ratio} · ${size} · ${duration} 秒`)
      : `${ratio === 'auto' || ratio === 'adaptive' ? autoLabel : ratio} · ${size} · ${t(`x${count}`, `×${count}`)}`;
  }

  function renderModels() {
    modelSelect.innerHTML = '';
    modelPickerMenu.innerHTML = '';
    const options = kind === 'video'
      ? videoProviders
      : providers;
    options.forEach((provider) => {
      const option = document.createElement('option');
      option.value = provider.id;
      option.textContent = provider.name;
      modelSelect.appendChild(option);
    });
    if (kind === 'image' && providers.some((provider) => provider.id === aiConfig.activeImageProviderId)) {
      modelSelect.value = aiConfig.activeImageProviderId;
    }
    if (kind === 'video' && videoProviders.some((provider) => provider.id === aiConfig.activeVideoProviderId)) {
      modelSelect.value = aiConfig.activeVideoProviderId;
    }
    modelSelect.disabled = options.length < 2;
    modelPickerTrigger.disabled = options.length < 2;
    modelPickerMenu.hidden = true;
    modelPickerTrigger.setAttribute('aria-expanded', 'false');
    options.forEach((provider) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'ai-model-picker-option';
      option.dataset.value = provider.id;
      option.setAttribute('role', 'option');
      appendAiModelLabel(option, provider);
      option.addEventListener('click', () => {
        modelSelect.value = provider.id;
        appendAiModelLabel(modelPickerLabel, provider);
        modelPickerMenu.querySelectorAll('.ai-model-picker-option').forEach((item) => {
          item.classList.toggle('is-active', item === option);
          item.setAttribute('aria-selected', String(item === option));
        });
        modelPickerMenu.hidden = true;
        modelPickerTrigger.setAttribute('aria-expanded', 'false');
        syncGenerationOptions();
      });
      modelPickerMenu.appendChild(option);
    });
    const selected = options.find((provider) => provider.id === modelSelect.value) || options[0];
    modelPickerLabel.textContent = selected ? selected.name : t('No model configured', '未配置模型');
    if (selected) appendAiModelLabel(modelPickerLabel, selected);
    // A running request must not disable a newly opened composer. Each
    // submission owns its own request and placeholder state.
    submit.disabled = !selected;
    modelPickerMenu.querySelectorAll('.ai-model-picker-option').forEach((option) => {
      const active = selected && option.dataset.value === selected.id;
      option.classList.toggle('is-active', active);
      option.setAttribute('aria-selected', String(active));
    });
  }

  function selectedVideoProvider() {
    return videoProviders.find((provider) => provider.id === modelSelect.value) || null;
  }

  function selectedImageProvider() {
    return providers.find((provider) => provider.id === modelSelect.value) || null;
  }

  function renderCreditEstimate(totalCredits) {
    const total = Math.max(0, Math.ceil(Number(totalCredits) || 0));
    if (!total) {
      delete creditEstimate.dataset.credits;
      creditEstimate.hidden = true;
      creditEstimate.textContent = '';
      creditEstimate.removeAttribute('title');
      creditEstimate.removeAttribute('aria-busy');
      return;
    }
    creditEstimate.dataset.credits = String(total);
    creditEstimate.hidden = false;
    creditEstimate.removeAttribute('aria-busy');
    creditEstimate.textContent = t(`${total} credits`, `${total} 积分`);
    creditEstimate.title = t(`Estimated usage: ${total} credits`, `预计消耗 ${total} 积分`);
  }

  function refreshCreditEstimateLanguage() {
    const total = Number(creditEstimate.dataset.credits);
    if (Number.isFinite(total) && total > 0 && !creditEstimate.hidden) {
      creditEstimate.textContent = t(`${total} credits`, `${total} 积分`);
      creditEstimate.title = t(`Estimated usage: ${total} credits`, `预计消耗 ${total} 积分`);
    }
  }

  function updateCreditEstimate() {
    const provider = kind === 'video' ? selectedVideoProvider() : selectedImageProvider();
    const quoteApi = window.messsAPI && window.messsAPI.quoteMediaCredits;
    const revision = ++creditQuoteRevision;
    if (!provider || typeof quoteApi !== 'function') {
      renderCreditEstimate(0);
      return;
    }
    creditEstimate.hidden = false;
    creditEstimate.setAttribute('aria-busy', 'true');
    creditEstimate.textContent = t('Calculating…', '计算中…');
    creditEstimate.title = t('Calculating estimated usage', '正在计算预计消耗');
    const request = {
      kind,
      providerId: provider.id,
      imageProviderId: kind === 'image' ? provider.id : null,
      videoProviderId: kind === 'video' ? provider.id : null,
      count: kind === 'image' ? count : undefined,
      size: kind === 'image' ? size : undefined,
      resolution: size,
      duration: kind === 'video' ? duration : undefined
    };
    Promise.resolve(quoteApi.call(window.messsAPI, request)).then((pricing) => {
      if (revision !== creditQuoteRevision) return;
      renderCreditEstimate(pricing && pricing.totalCredits);
    }).catch(() => {
      if (revision !== creditQuoteRevision) return;
      renderCreditEstimate(0);
    });
  }

  function selectedImageCapabilities() {
    const provider = selectedImageProvider();
    return provider && provider.capabilities && typeof provider.capabilities === 'object'
      ? provider.capabilities
      : {};
  }

  function selectedVideoCapabilities() {
    const provider = selectedVideoProvider();
    return provider && provider.capabilities && typeof provider.capabilities === 'object'
      ? provider.capabilities
      : {};
  }

  async function syncHiggsfieldOptions() {
    const provider = selectedImageProvider();
    const capabilities = selectedImageCapabilities();
    const enabled = kind === 'image' && capabilities.styles === true && provider;
    higgsfieldBlock.hidden = !enabled;
    if (!enabled) return;
    const revision = ++styleLoadRevision;
    if (higgsfieldStyle.dataset.providerId === provider.id) return;
    higgsfieldStyle.disabled = true;
    higgsfieldStyle.innerHTML = `<option value="">${escapeHtml(t('Loading styles...', '正在加载风格...'))}</option>`;
    try {
      const payload = await window.messsAPI.getAiImageStyles(provider.id);
      if (revision !== styleLoadRevision || modelSelect.value !== provider.id) return;
      const styles = payload && Array.isArray(payload.styles) ? payload.styles : [];
      higgsfieldStyle.innerHTML = `<option value="">${escapeHtml(t('No style', '不使用风格'))}</option>`;
      styles.forEach((entry) => {
        const option = document.createElement('option');
        option.value = entry.id;
        option.textContent = entry.name;
        option.title = entry.description || entry.name;
        higgsfieldStyle.appendChild(option);
      });
      higgsfieldStyle.dataset.providerId = provider.id;
      higgsfieldStyle.value = styles.some((entry) => entry.id === styleId) ? styleId : '';
      if (!higgsfieldStyle.value) styleId = '';
    } catch (error) {
      if (revision !== styleLoadRevision) return;
      higgsfieldStyle.innerHTML = `<option value="">${escapeHtml(t('Styles unavailable', '风格暂不可用'))}</option>`;
    } finally {
      if (revision === styleLoadRevision) higgsfieldStyle.disabled = false;
    }
  }

  function syncGenerationOptions() {
    const capabilities = kind === 'video' ? selectedVideoCapabilities() : selectedImageCapabilities();
    if (kind === 'video') {
      const configuredLimit = Number(capabilities.maxReferenceImages);
      const limit = Number.isFinite(configuredLimit) && configuredLimit > 0 ? Math.floor(configuredLimit) : 2;
      if (boardReferences.size > limit) {
        [...boardReferences.keys()].slice(limit).forEach((fileId) => boardReferences.delete(fileId));
        renderBoardReferences();
        syncAiComposerReferenceClasses();
      }
      ratio = supportedVideoAspectRatio(ratio, capabilities, boardReferences.size > 0);
    } else {
      const configuredLimit = Number(capabilities.maxReferenceImages);
      if (Number.isFinite(configuredLimit) && configuredLimit >= 0 && boardReferences.size > configuredLimit) {
        [...boardReferences.keys()].slice(configuredLimit).forEach((fileId) => boardReferences.delete(fileId));
        renderBoardReferences();
        syncAiComposerReferenceClasses();
      }
    }
    const resolutions = kind === 'video'
      ? supportedVideoResolutions(capabilities)
      : supportedImageSizes(capabilities, boardReferences.size);
    const durations = kind === 'video' ? supportedVideoDurations(capabilities) : [6, 8, 10, 15];
    if (!resolutions.includes(size)) size = resolutions[0];
    const supportedCounts = kind === 'image' && Array.isArray(capabilities.counts) && capabilities.counts.length
      ? capabilities.counts.map(Number).filter((value) => Number.isInteger(value) && value >= 1 && value <= 4)
      : [1, 2, 3, 4];
    if (!supportedCounts.includes(count)) count = supportedCounts[0] || 1;
    const countGroup = pop.querySelector('[data-option="count"]');
    countGroup.innerHTML = '';
    supportedCounts.forEach((value) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.value = String(value);
      button.textContent = String(value);
      countGroup.appendChild(button);
    });
    const sizeGroup = pop.querySelector('[data-option="size"]');
    sizeGroup.innerHTML = '';
    resolutions.forEach((value) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.value = value;
      button.textContent = value === 'Default' ? t('Default', '默认', '기본') : value;
      sizeGroup.appendChild(button);
    });
    const durationRange = pop.querySelector('.ai-duration-range');
    const minimum = durations.length ? Math.min(...durations) : 6;
    const maximum = durations.length ? Math.max(...durations) : 15;
    durationRange.min = String(minimum);
    durationRange.max = String(maximum);
    duration = kind === 'video'
      ? supportedVideoDuration(duration, capabilities)
      : Math.max(minimum, Math.min(maximum, Math.round(duration)));
    durationRange.value = String(duration);
    pop.querySelector('.ai-resolution-block').hidden = resolutions.length === 0;
    renderRatios();
    syncSegments();
    updateSummary();
    refreshLanguage();
    updateCreditEstimate();
    void syncHiggsfieldOptions();
  }

  function renderRatios() {
    const capabilities = kind === 'video' ? selectedVideoCapabilities() : selectedImageCapabilities();
    const ratios = kind === 'video'
      ? supportedVideoRatios(capabilities, boardReferences.size > 0)
      : supportedImageRatios(capabilities, boardReferences.size > 0);
    if (!ratios.includes(ratio)) ratio = ratios[0];
    ratioGrid.innerHTML = '';
    ratios.forEach((value) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.value = value;
      button.className = ratio === value ? 'is-active' : '';
      button.disabled = ratios.length === 1;
      const numeric = BoardEngine.parseAspectRatio(value, 1);
      const iconWidth = numeric >= 1 ? 25 : Math.round(25 * numeric);
      const iconHeight = numeric >= 1 ? Math.round(25 / numeric) : 25;
      const automatic = value === 'auto' || value === 'adaptive';
      button.innerHTML = `<span class="ai-ratio-shape${automatic ? ' is-auto' : ''}" style="width:${iconWidth}px;height:${iconHeight}px"></span><small>${automatic ? t('Auto', '自动') : value}</small>`;
      button.addEventListener('click', () => {
        ratio = value;
        renderRatios();
        updateSummary();
        keepOptionsOpen();
      });
      ratioGrid.appendChild(button);
    });
    pop.querySelector('.ai-ratio-value').textContent = ratio === 'auto' || ratio === 'adaptive' ? t('Auto', '自动') : ratio;
  }

  function syncSegments() {
    pop.querySelectorAll('[data-option="size"] button').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.value === size);
    });
    pop.querySelectorAll('[data-option="count"] button').forEach((button) => {
      button.classList.toggle('is-active', Number(button.dataset.value) === count);
    });
    pop.querySelector('.ai-count-value').textContent = `× ${count}`;
    const sizeHint = resolutionDisplayHint(size);
    pop.querySelector('.ai-resolution-hint').textContent = `≈ ${sizeHint}`;
  }

  function updateSummary() {
    optionsToggle.textContent = kind === 'video'
      ? t(
        `${ratio === 'adaptive' ? 'Auto' : ratio} · ${size} · ${duration}s`,
        `${ratio === 'adaptive' ? '自动' : ratio} · ${size} · ${duration} 秒`
      )
      : `${ratio === 'auto' || ratio === 'adaptive' ? t('Auto', '自动') : ratio} · ${size} · ${t(`x${count}`, `×${count}`)}`;
  }

  function updateMode(nextKind) {
    kind = nextKind === 'video' ? 'video' : 'image';
    if (kind === 'video') {
      const configuredLimit = Number(selectedVideoCapabilities().maxReferenceImages);
      const limit = Number.isFinite(configuredLimit) && configuredLimit > 0 ? Math.floor(configuredLimit) : 2;
      if (boardReferences.size > limit) {
        [...boardReferences.keys()].slice(limit).forEach((fileId) => boardReferences.delete(fileId));
        renderBoardReferences();
        syncAiComposerReferenceClasses();
      }
    }
    pop.dataset.kind = kind;
    pop.querySelectorAll('[data-ai-kind]').forEach((button) => {
      const active = button.dataset.aiKind === kind;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });
    ratio = kind === 'video' ? (aiConfig.videoAspectRatio || '16:9') : (aiConfig.imageAspectRatio || '1:1');
    prompt.placeholder = kind === 'video'
      ? '描述视频内容、动作、镜头运动、环境和声音…'
      : '描述主体、构图、镜头、光线、材质和色彩氛围…';
    pop.querySelector('.ai-count-block').hidden = kind === 'video';
    pop.querySelector('.ai-duration-block').hidden = kind !== 'video';
    renderModels();
    syncGenerationOptions();
  }

  pop.querySelector('.ai-composer-mode').addEventListener('click', (event) => {
    const button = event.target.closest('[data-ai-kind]');
    if (button) {
      updateMode(button.dataset.aiKind);
      refreshLanguage();
    }
  });
  close.addEventListener('click', closeAiImagePopover);
  modelPickerTrigger.addEventListener('click', () => {
    if (modelPickerTrigger.disabled) return;
    const isOpen = !modelPickerMenu.hidden;
    modelPickerMenu.hidden = isOpen;
    modelPickerTrigger.setAttribute('aria-expanded', String(!isOpen));
  });
  modelSelect.addEventListener('change', () => {
    const selected = [...modelSelect.options].find((option) => option.value === modelSelect.value);
    if (selected) modelPickerLabel.textContent = selected.textContent;
    syncGenerationOptions();
  });
  pop.addEventListener('click', (event) => {
    if (!modelPicker.contains(event.target)) {
      modelPickerMenu.hidden = true;
      modelPickerTrigger.setAttribute('aria-expanded', 'false');
    }
  });
  optionsToggle.addEventListener('click', () => {
    setOptionsOpen(optionsPanel.hidden);
  });
  optionsPanel.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
  });
  optionsPanel.addEventListener('click', (event) => {
    event.stopPropagation();
    keepOptionsOpen();
  });
  pop.querySelector('[data-option="size"]').addEventListener('click', (event) => {
    const button = event.target.closest('[data-value]');
    if (!button) return;
    size = button.dataset.value;
    syncSegments();
    updateSummary();
    refreshLanguage();
    updateCreditEstimate();
    setOptionsOpen(true);
  });
  pop.querySelector('[data-option="count"]').addEventListener('click', (event) => {
    const button = event.target.closest('[data-value]');
    if (!button) return;
    count = Number(button.dataset.value);
    syncSegments();
    updateSummary();
    refreshLanguage();
    updateCreditEstimate();
    setOptionsOpen(true);
  });
  pop.querySelector('.ai-duration-range').addEventListener('input', (event) => {
    duration = kind === 'video'
      ? supportedVideoDuration(event.target.value, selectedVideoCapabilities())
      : Number(event.target.value);
    event.target.value = String(duration);
    pop.querySelector('.ai-duration-value').textContent = `${duration} 秒`;
    updateSummary();
    updateCreditEstimate();
  });

  pop.querySelector('.ai-duration-range').addEventListener('input', refreshLanguage);
  pop.querySelector('.ai-duration-range').addEventListener('input', keepOptionsOpen);
  higgsfieldStyle.addEventListener('change', () => { styleId = higgsfieldStyle.value; });
  higgsfieldEnhance.addEventListener('change', () => { enhancePrompt = higgsfieldEnhance.checked; });
  higgsfieldSeed.addEventListener('input', () => {
    const value = Math.round(Number(higgsfieldSeed.value));
    seed = Number.isInteger(value) && value >= 1 && value <= 1_000_000 ? value : null;
  });
  higgsfieldStrength.addEventListener('input', () => {
    styleStrength = Math.max(0, Math.min(1, Number(higgsfieldStrength.value)));
    higgsfieldBlock.querySelector('output').textContent = styleStrength.toFixed(2);
  });
  prompt.addEventListener('pointerdown', () => setOptionsOpen(false));
  prompt.addEventListener('focus', () => setOptionsOpen(false));
  prompt.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = prompt.value.trim();
    if (!text) {
      showToast(t('Enter a generation prompt first.', '请先输入生成提示词。'), 'AI');
      prompt.focus();
      return;
    }
    const selectedProvider = (kind === 'image' ? providers : videoProviders)
      .find((provider) => provider.id === modelSelect.value);
    const videoCapabilities = kind === 'video' && selectedProvider && selectedProvider.capabilities
      ? selectedProvider.capabilities
      : {};
    const request = {
      kind,
      prompt: text,
      size,
      resolution: size,
      count,
      duration: kind === 'video' ? supportedVideoDuration(duration, videoCapabilities) : duration,
      aspectRatio: kind === 'video'
        ? supportedVideoAspectRatio(ratio, videoCapabilities, boardReferences.size > 0)
        : ratio,
      imageProviderId: kind === 'image' && selectedProvider ? selectedProvider.id : null,
      videoProviderId: kind === 'video' && selectedProvider ? selectedProvider.id : null,
      modelName: selectedProvider ? selectedProvider.name : (aiConfig.videoProviderName || '视频生成'),
      enhancePrompt,
      seed,
      styleId,
      styleStrength,
      referenceFileIds: [...boardReferences.keys()],
      urls: [
        ...boardReferences.values().map((entry) => entry.dataUrl)
      ]
    };
    const generationHooks = pop._generationHooks || null;
    if (generationHooks && typeof generationHooks.onSubmit === 'function') {
      generationHooks.onSubmit(request);
    }
    closeAiImagePopover();
    const files = await generateAiMediaForBoardV3(request);
    if (generationHooks && typeof generationHooks.onComplete === 'function') {
      generationHooks.onComplete(files, request);
    }
  });

  pop._setMode = (nextKind) => {
    updateMode(nextKind);
    refreshLanguage();
  };
  pop._applyGenerationPreset = (preset = {}) => {
    updateMode(preset.kind === 'video' ? 'video' : 'image');
    const modelOption = [...modelSelect.options].find((entry) => entry.value === preset.providerId);
    if (modelOption) {
      modelSelect.value = modelOption.value;
      modelPickerLabel.textContent = modelOption.textContent;
      modelPickerMenu.querySelectorAll('.ai-model-picker-option').forEach((entry) => {
        const active = entry.dataset.value === modelOption.value;
        entry.classList.toggle('is-active', active);
        entry.setAttribute('aria-selected', String(active));
      });
    }
    if (kind === 'video') {
      const capabilities = selectedVideoCapabilities();
      size = supportedVideoResolution(preset.resolution || preset.size, capabilities);
      ratio = supportedVideoAspectRatio(
        preset.aspectRatio || ratio,
        capabilities,
        boardReferences.size > 0
      );
      duration = supportedVideoDuration(preset.duration || duration, capabilities);
    } else {
      const capabilities = selectedImageCapabilities();
      size = supportedImageSize(preset.size, capabilities);
      ratio = supportedImageAspectRatio(
        preset.aspectRatio || ratio,
        capabilities,
        boardReferences.size > 0
      );
    }
    count = Math.max(1, Math.min(4, Number(preset.count) || 1));
    syncGenerationOptions();
    updateSummary();
    refreshLanguage();
    updateCreditEstimate();
  };
  pop._hasBoardReference = (fileId) => boardReferences.has(fileId);
  pop._toggleBoardReference = toggleBoardReference;
  pop._refreshLanguage = refreshLanguage;
  updateMode(kind);
  refreshLanguage();
  return pop;
}

async function generateAiMediaForBoardV2(request, pop, status, submit) {
  const taskId = beginAiMediaTask(request);
  const controls = [...pop.querySelectorAll('button, textarea, select, input')];
  controls.forEach((control) => { control.disabled = true; });
  const placeholders = createAiPlaceholders(request);
  const startedAt = Date.now();
  status.textContent = '已提交';
  const progressTimer = setInterval(() => {
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    status.textContent = `生成中 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }, 1000);

  try {
    const folderId = AppState.activeFolderId && AppState.activeFolderId !== 'default'
      ? AppState.activeFolderId
      : null;
    const res = await window.messsAPI.generateAiMedia({ ...request, folderId, canvasId: activeCanvasId() });
    const files = res && Array.isArray(res.files) ? res.files : (res && res.file ? [res.file] : []);
    if (!res || !res.ok || !files.length) {
      const message = res && res.reason === 'missing-api-key'
        ? '请先在设置的 AI 接口管理中保存接口密钥。'
        : (res && res.message) || 'AI 生成失败。';
      removeAiPlaceholders(placeholders);
      showToast(message, 'AI');
      return;
    }

    AppState.files = [...files, ...AppState.files.filter((file) => !files.some((next) => next.id === file.id))];
    renderFileList(currentFileListScope());
    renderFolderGridIfActive();
    await replaceAiPlaceholders(placeholders, files, request);
    selectFileForPreview(files[0].id);
    if (res.unlocked && res.unlocked.length) await refreshAchievements();
    showToast(
      res.failedCount
        ? `已生成 ${files.length} 个，${res.failedCount} 个失败`
        : (request.kind === 'video' ? 'AI 视频已加入画布' : `${files.length} 张 AI 图片已加入画布`),
      'AI'
    );
    closeAiImagePopover();
  } catch (err) {
    removeAiPlaceholders(placeholders);
    showToast(err && err.message ? err.message : 'AI 生成失败。', 'AI');
  } finally {
    clearInterval(progressTimer);
    finishAiMediaTask(taskId);
    controls.forEach((control) => { control.disabled = false; });
    status.textContent = '';
    submit.disabled = false;
  }
}

async function generateAiMediaForBoardV3(request) {
  const creditAccess = await window.MesssCredits.ensure(request);
  if (!creditAccess.ok) return [];
  const taskId = beginAiMediaTask(request);
  const targetCanvasId = activeCanvasId();
  const generationRequest = { ...request, canvasId: targetCanvasId };
  const placeholders = createAiPlaceholders(generationRequest);

  try {
    const folderId = AppState.activeFolderId && AppState.activeFolderId !== 'default'
      ? AppState.activeFolderId
      : null;
    const placements = placeholders.map((placeholder) => ({
      id: placeholder.id,
      canvasId: placeholder.canvasId,
      x: placeholder.x,
      y: placeholder.y,
      width: placeholder.width,
      height: placeholder.height,
      aspectRatio: placeholder.aspectRatio,
      zIndex: placeholder.zIndex
    }));
    const res = await window.messsAPI.generateAiMedia({ ...generationRequest, folderId, placements });
    if (res && res.membership) window.MesssCredits.publish(res.membership);
    const files = res && Array.isArray(res.files) ? res.files : (res && res.file ? [res.file] : []);
    if (!res || !res.ok || !files.length) {
      const message = res && res.reason === 'missing-api-key'
        ? t(
          'Save an API key in Settings > AI API first.',
          '请先在设置的 AI 接口管理中保存 API Key。'
        )
        : (res && res.message) || t('AI generation failed.', 'AI 生成失败。');
      removeAiPlaceholders(placeholders);
      showToast(message, 'AI');
      return [];
    }

    AppState.files = [...files, ...AppState.files.filter((file) => !files.some((next) => next.id === file.id))];
    renderFileList(currentFileListScope());
    renderFolderGridIfActive();
    await replaceAiPlaceholders(placeholders, files, generationRequest, res.boardItems || []);
    selectFileForPreview(files[0].id);
    if (res.unlocked && res.unlocked.length) await refreshAchievements();

    const successMessage = res.failedCount
      ? t(
        `Generated ${files.length}; ${res.failedCount} failed`,
        `已生成 ${files.length} 个，${res.failedCount} 个失败`
      )
      : request.kind === 'video'
        ? t('AI video added to the canvas', 'AI 视频已加入画布')
        : t(
          `${files.length} AI image${files.length === 1 ? '' : 's'} added to the canvas`,
          `${files.length} 张 AI 图片已加入画布`
    );
    showToast(successMessage, 'AI');
    return files;
  } catch (err) {
    removeAiPlaceholders(placeholders);
    showToast(err && err.message ? err.message : t('AI generation failed.', 'AI 生成失败。'), 'AI');
    return [];
  } finally {
    finishAiMediaTask(taskId);
  }
}

let boardQuickGenerateOutsideClick = null;

function selectedBoardImageItems() {
  const filesById = new Map(AppState.files.map((file) => [file.id, file]));
  return AppState.boardItems.filter((item) => {
    if (!item.selected || !item.fileId) return false;
    const file = filesById.get(item.fileId);
    return file && isImageExt(file.ext);
  });
}

function closeBoardQuickGenerate() {
  const quick = document.getElementById('board-quick-generate');
  if (quick && !quick.classList.contains('is-closing')) {
    quick.classList.add('is-closing');
    window.setTimeout(() => quick.remove(), 160);
  }
  if (boardQuickGenerateOutsideClick) {
    document.removeEventListener('pointerdown', boardQuickGenerateOutsideClick, true);
    boardQuickGenerateOutsideClick = null;
  }
}

function positionBoardQuickGenerate(quick) {
  const panel = document.getElementById('board-panel');
  const viewport = document.getElementById('board-viewport');
  if (!quick || !panel || !viewport) return;
  const panelRect = panel.getBoundingClientRect();
  const selectedElements = selectedBoardImageItems()
    .map((item) => document.querySelector(`#board-canvas .board-item[data-board-id="${item.id}"]`))
    .filter(Boolean);

  let left = panelRect.width / 2;
  let top = panelRect.height - 92;
  if (selectedElements.length) {
    const bounds = selectedElements.reduce((result, element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: Math.min(result.left, rect.left),
        top: Math.min(result.top, rect.top),
        right: Math.max(result.right, rect.right),
        bottom: Math.max(result.bottom, rect.bottom)
      };
    }, { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
    left = (bounds.left + bounds.right) / 2 - panelRect.left;
    top = bounds.top - panelRect.top - quick.offsetHeight - 14;
    if (top < 64) top = bounds.bottom - panelRect.top + 14;
  }

  const maxLeft = Math.max(14, panelRect.width - quick.offsetWidth - 14);
  quick.style.left = `${Math.max(14, Math.min(left - quick.offsetWidth / 2, maxLeft))}px`;
  quick.style.top = `${Math.max(64, Math.min(top, panelRect.height - quick.offsetHeight - 18))}px`;
}

function greatestCommonDivisor(a, b) {
  let left = Math.max(1, Math.round(Math.abs(a)));
  let right = Math.max(1, Math.round(Math.abs(b)));
  while (right) {
    const next = left % right;
    left = right;
    right = next;
  }
  return left;
}

function sourceImageGenerationOptions() {
  const primary = selectedBoardImageItems()[0];
  const file = primary && AppState.files.find((entry) => entry.id === primary.fileId);
  const width = Math.max(1, Math.round(Number(file && (file.sourceWidth || file.width)) || Number(primary && primary.width) || 1));
  const height = Math.max(1, Math.round(Number(file && (file.sourceHeight || file.height)) || Number(primary && primary.height) || 1));
  const divisor = greatestCommonDivisor(width, height);
  return {
    aspectRatio: `${width / divisor}:${height / divisor}`,
    sourceWidth: width,
    sourceHeight: height
  };
}

async function boardSelectionReferenceData() {
  const references = [];
  for (const item of selectedBoardImageItems()) {
    const file = AppState.files.find((entry) => entry.id === item.fileId);
    if (!file) continue;
    const dataUrl = await window.messsAPI.readFileAsDataUrl(file.id);
    if (dataUrl) references.push(dataUrl);
  }
  return references;
}

async function submitBoardQuickGeneration(kind, promptText, options = {}) {
  if (!promptText) return [];
  try {
    const config = await window.messsAPI.getAiMediaConfig();
    const providers = kind === 'video'
      ? getConfiguredVideoProviders(config)
      : getConfiguredImageProviders(config);
    const activeId = kind === 'video' ? config.activeVideoProviderId : config.activeImageProviderId;
    const provider = providers.find((entry) => entry.id === activeId) || providers[0];
    if (!provider) return [];
    const explicitReferenceIds = Array.isArray(options.referenceFileIds)
      ? options.referenceFileIds
      : null;
    const referenceData = explicitReferenceIds
      ? await generatedReferenceData(explicitReferenceIds)
      : { urls: await boardSelectionReferenceData(), referenceFileIds: selectedBoardImageItems().map((item) => item.fileId) };
    const referenceFileIds = referenceData.referenceFileIds;
    const referenceFile = referenceFileIds.length
      ? AppState.files.find((entry) => entry.id === referenceFileIds[0])
      : null;
    const original = referenceFile
      ? sourceImageGenerationOptionsForFile(referenceFile)
      : sourceImageGenerationOptions();
    const urls = referenceData.urls;
    const isVideo = kind === 'video';
    const videoCapabilities = isVideo && provider.capabilities ? provider.capabilities : {};
    const imageCapabilities = !isVideo && provider.capabilities ? provider.capabilities : {};
    const videoResolution = isVideo
      ? supportedVideoResolution(null, videoCapabilities)
      : undefined;
    const imageSize = isVideo
      ? undefined
      : supportedImageSize(config.imageSize, imageCapabilities);
    return await generateAiMediaForBoardV3({
      kind,
      prompt: promptText,
      size: isVideo ? videoResolution : imageSize,
      resolution: videoResolution,
      count: 1,
      duration: isVideo
        ? supportedVideoDuration(config.videoDuration, videoCapabilities)
        : Number(config.videoDuration) || 6,
      aspectRatio: isVideo
        ? supportedVideoAspectRatio(original.aspectRatio, videoCapabilities, referenceFileIds.length > 0)
        : supportedImageAspectRatio(original.aspectRatio, imageCapabilities, referenceFileIds.length > 0),
      sourceWidth: original.sourceWidth,
      sourceHeight: original.sourceHeight,
      imageProviderId: kind === 'image' && provider ? provider.id : null,
      videoProviderId: kind === 'video' && provider ? provider.id : null,
      modelName: provider ? provider.name : t('Auto-detected API', '自动识别接口'),
      referenceFileIds,
      urls,
      placement: options.placement || null
    });
  } catch (err) {
    showToast(err && err.message ? err.message : t('AI generation failed.', 'AI 生成失败。'), 'AI');
    return [];
  }
}

function sourceImageGenerationOptionsForFile(file) {
  const width = Math.max(1, Math.round(Number(file && (file.sourceWidth || file.width)) || 1));
  const height = Math.max(1, Math.round(Number(file && (file.sourceHeight || file.height)) || 1));
  const divisor = greatestCommonDivisor(width, height);
  return { aspectRatio: `${width / divisor}:${height / divisor}`, sourceWidth: width, sourceHeight: height };
}

async function openAiComposerForSelection(kind, promptText = '', options = {}) {
  let pop = activeAiComposer();
  if (!pop) {
    await showAiImagePopover(kind);
    pop = activeAiComposer();
  } else if (pop.dataset.kind !== kind && typeof pop._setMode === 'function') {
    pop._setMode(kind);
  }
  if (!pop) return;
  pop._generationHooks = options;

  for (const item of selectedBoardImageItems()) {
    if (
      typeof pop._hasBoardReference === 'function' &&
      typeof pop._toggleBoardReference === 'function' &&
      !pop._hasBoardReference(item.fileId)
    ) {
      await pop._toggleBoardReference(item.fileId);
    }
  }
  syncAiComposerReferenceClasses();

  const prompt = pop.querySelector('.ai-composer-prompt');
  if (promptText) prompt.value = promptText;
  prompt.focus();
}

async function generatedReferenceData(fileIds) {
  const urls = [];
  const validFileIds = [];
  for (const fileId of Array.isArray(fileIds) ? fileIds : []) {
    const file = AppState.files.find((entry) => entry.id === fileId);
    if (!file || !isImageExt(file.ext)) continue;
    const dataUrl = await window.messsAPI.readFileAsDataUrl(file.id);
    if (!dataUrl) continue;
    validFileIds.push(file.id);
    urls.push(dataUrl);
  }
  return { urls, referenceFileIds: validFileIds };
}

async function retryGeneratedMediaFromDetails(file) {
  const generation = file && file.aiGeneration;
  if (!generation || !String(generation.prompt || '').trim()) {
    showToast(t('This earlier result has no reusable generation details.', '此早期结果没有可复用的生成信息。'), 'AI');
    return;
  }
  try {
    const references = await generatedReferenceData(generation.referenceFileIds);
    const isVideo = generation.kind === 'video';
    const config = await window.messsAPI.getAiMediaConfig();
    const videoProvider = isVideo
      ? getConfiguredVideoProviders(config || {}).find((provider) => provider.id === generation.providerId)
      : null;
    const imageProvider = !isVideo
      ? getConfiguredImageProviders(config || {}).find((provider) => provider.id === generation.providerId)
      : null;
    const videoCapabilities = videoProvider && videoProvider.capabilities
      ? videoProvider.capabilities
      : {};
    const videoResolution = isVideo
      ? supportedVideoResolution(generation.resolution || generation.size, videoCapabilities)
      : undefined;
    const imageCapabilities = imageProvider && imageProvider.capabilities
      ? imageProvider.capabilities
      : {};
    await generateAiMediaForBoardV3({
      kind: isVideo ? 'video' : 'image',
      prompt: generation.prompt,
      size: isVideo ? videoResolution : supportedImageSize(generation.size, imageCapabilities),
      resolution: videoResolution,
      count: 1,
      duration: isVideo
        ? supportedVideoDuration(generation.duration, videoCapabilities)
        : Number(generation.duration) || 6,
      aspectRatio: isVideo
        ? supportedVideoAspectRatio(generation.aspectRatio, videoCapabilities, references.referenceFileIds.length > 0)
        : supportedImageAspectRatio(
          generation.aspectRatio,
          imageCapabilities,
          references.referenceFileIds.length > 0
        ),
      sourceWidth: file.sourceWidth || null,
      sourceHeight: file.sourceHeight || null,
      imageProviderId: generation.kind === 'video' ? null : generation.providerId,
      videoProviderId: generation.kind === 'video' ? generation.providerId : null,
      modelName: generation.modelName || t('AI model', 'AI 模型'),
      referenceFileIds: references.referenceFileIds,
      urls: references.urls
    });
  } catch (err) {
    showToast(err && err.message ? err.message : t('AI generation failed.', 'AI 生成失败。'), 'AI');
  }
}

async function remixGeneratedMediaFromDetails(file, useGeneratedImage) {
  const generation = file && file.aiGeneration;
  const kind = generation && generation.kind === 'video' ? 'video' : 'image';
  let pop = activeAiComposer();
  if (!pop) {
    await showAiImagePopover(kind);
    pop = activeAiComposer();
  } else if (pop.dataset.kind !== kind && typeof pop._setMode === 'function') {
    pop._setMode(kind);
  }
  if (!pop) return;

  if (generation && typeof pop._applyGenerationPreset === 'function') {
    pop._applyGenerationPreset(generation);
  }
  const originalReferences = generation && Array.isArray(generation.referenceFileIds)
    ? generation.referenceFileIds
    : [];
  const referenceIds = useGeneratedImage
    ? [file.id]
    : (originalReferences.length ? originalReferences : [file.id]);
  for (const fileId of referenceIds) {
    if (
      typeof pop._hasBoardReference === 'function' &&
      typeof pop._toggleBoardReference === 'function' &&
      !pop._hasBoardReference(fileId)
    ) {
      await pop._toggleBoardReference(fileId);
    }
  }
  syncAiComposerReferenceClasses();
  const prompt = pop.querySelector('.ai-composer-prompt');
  prompt.value = generation && generation.prompt ? generation.prompt : '';
  prompt.focus();
}

function showBoardQuickGenerate() {
  const existing = document.getElementById('board-quick-generate');
  if (existing) {
    existing.querySelector('.board-quick-generate-input').focus();
    positionBoardQuickGenerate(existing);
    return;
  }
  if (!selectedBoardImageItems().length) return;

  const quick = document.createElement('form');
  quick.id = 'board-quick-generate';
  quick.className = 'board-quick-generate';
  quick.innerHTML = `
    <button type="button" class="board-quick-kind" data-kind="image" title="${t('Open image generation', '打开图片生成')}" aria-label="${t('Open image generation', '打开图片生成')}">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M3 17l5-5 4 4 3-3 6 6"/></svg>
    </button>
    <button type="button" class="board-quick-kind" data-kind="video" title="${t('Open video generation', '打开视频生成')}" aria-label="${t('Open video generation', '打开视频生成')}">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="5" width="15" height="14" rx="2"/><path d="M17 10l5-3v10l-5-3z"/></svg>
    </button>
    <input class="board-quick-generate-input" type="text" autocomplete="off" placeholder="${t('Describe what to generate', '描述想要生成的内容')}" aria-label="${t('Generation prompt', '生成提示词')}">
    <button type="submit" class="board-quick-generate-submit" title="${t('Generate image', '生成图片')}" aria-label="${t('Generate image', '生成图片')}">
      <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg>
    </button>
  `;
  document.getElementById('board-panel').appendChild(quick);
  requestAnimationFrame(() => positionBoardQuickGenerate(quick));

  const input = quick.querySelector('.board-quick-generate-input');
  let quickKind = 'image';
  const setQuickKind = (nextKind) => {
    quickKind = nextKind === 'video' ? 'video' : 'image';
    quick.querySelectorAll('.board-quick-kind').forEach((button) => {
      const active = button.dataset.kind === quickKind;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const submitButton = quick.querySelector('.board-quick-generate-submit');
    submitButton.title = quickKind === 'video'
      ? t('Generate video', '生成视频')
      : t('Generate image', '生成图片');
    submitButton.setAttribute('aria-label', submitButton.title);
  };
  quick.querySelectorAll('.board-quick-kind').forEach((button) => {
    button.addEventListener('click', () => {
      setQuickKind(button.dataset.kind);
      input.focus();
    });
  });
  quick.addEventListener('submit', async (event) => {
    event.preventDefault();
    const promptText = input.value.trim();
    if (!promptText) {
      input.focus();
      return;
    }
    closeBoardQuickGenerate();
    await submitBoardQuickGeneration(quickKind, promptText);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeBoardQuickGenerate();
    }
  });

  boardQuickGenerateOutsideClick = (event) => {
    if (!quick.contains(event.target)) closeBoardQuickGenerate();
  };
  window.setTimeout(() => {
    if (document.body.contains(quick)) {
      document.addEventListener('pointerdown', boardQuickGenerateOutsideClick, true);
    }
  }, 0);
  setQuickKind('image');
  input.focus();
}

function initBoardQuickGenerate() {
  window.addEventListener('resize', () => {
    const quick = document.getElementById('board-quick-generate');
    if (quick) positionBoardQuickGenerate(quick);
  });
}

async function showAiImagePopover(initialKind = 'image') {
  const existing = document.getElementById('ai-image-popover');
  if (existing) {
    if (existing.dataset.kind !== initialKind && typeof existing._setMode === 'function') {
      existing._setMode(initialKind);
      return;
    }
    closeAiImagePopover();
    return;
  }

  const anchor = document.getElementById('board-panel');
  const loading = document.createElement('div');
  loading.id = 'ai-image-popover';
  loading.className = 'ai-image-popover ai-composer ai-composer-loading' + (isBoardFullscreen() ? '' : ' is-panel-popover');
  loading.dataset.kind = initialKind;
  loading.innerHTML = `
    <button type="button" class="ai-composer-close" title="${t('Close', '关闭')}" aria-label="${t('Close', '关闭')}">x</button>
    <div class="ai-composer-loading-body" role="status">
      <span class="ai-composer-loading-dot" aria-hidden="true"></span>
      <span>${t('Loading generation tools...', '正在加载生成工具...')}</span>
    </div>
  `;
  loading.querySelector('.ai-composer-close').addEventListener('click', closeAiImagePopover);
  anchor.appendChild(loading);
  setAiImageButtonsActive(true);

  let config;
  try {
    config = await loadAiMediaConfigCached();
  } catch (err) {
    loading.remove();
    setAiImageButtonsActive(false);
    showToast('无法读取 AI 接口设置', 'AI');
    return;
  }
  if (!loading.isConnected || document.getElementById('ai-image-popover') !== loading) return;
  const pop = buildAiComposer(config, initialKind);
  loading.replaceWith(pop);

  const textarea = pop.querySelector('.ai-composer-prompt');
  setTimeout(() => textarea.focus(), 0);

  aiImagePopoverClickCloser = (e) => {
    if (pop.contains(e.target)) return;
    if (e.target.closest('#board-mode-toggle, #board-tool-ai-image, #board-tool-ai-video')) return;
    // Canvas images toggle AI reference state; they must not dismiss the active composer.
    if (e.target.closest('#board-canvas .board-item-image')) return;
    if (e.target.closest('#board-viewport') && boardImageItemAtClientPoint(e.clientX, e.clientY)) return;
    closeAiImagePopover();
  };
  aiImagePopoverKeyCloser = (e) => {
    if (e.key === 'Escape') closeAiImagePopover();
  };
  setTimeout(() => {
    document.addEventListener('click', aiImagePopoverClickCloser);
    document.addEventListener('keydown', aiImagePopoverKeyCloser);
  }, 0);
}

function initBoardBottomBar() {
  void loadAiMediaConfigCached();

  document.getElementById('board-theme-toggle').addEventListener('click', async () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    await window.messsAPI.setTheme(next);
  });

  document.getElementById('board-shortcuts-btn').addEventListener('click', () => {
    const existing = document.getElementById('shortcuts-popover');
    if (existing) { existing.remove(); return; }
    const pop = document.createElement('div');
    pop.id = 'shortcuts-popover';
    pop.className = 'shortcuts-popover';
    renderShortcutsPopover(pop);
    document.getElementById('board-bottom-bar').appendChild(pop);
    setTimeout(() => document.addEventListener('click', function closeOnce(e) {
      if (!pop.contains(e.target) && e.target.id !== 'board-shortcuts-btn') {
        pop.remove();
        document.removeEventListener('click', closeOnce);
      }
    }), 0);
  });

  document.getElementById('board-tool-upload').addEventListener('click', async () => {
    const paths = await window.messsAPI.pickFiles();
    if (paths && paths.length) await importFilesDirectlyToBoard(paths);
  });

  document.getElementById('board-tool-ai-image').addEventListener('click', () => showAiImagePopover('image'));
  document.getElementById('board-tool-ai-video').addEventListener('click', () => showAiImagePopover('video'));

  document.getElementById('board-tool-text').addEventListener('click', () => {
    armTextPlacement();
  });

  document.getElementById('board-tool-doodle').addEventListener('click', () => toggleDoodleMode());

  document.getElementById('board-bottom-zoom-out').addEventListener('click', () => document.getElementById('board-zoom-out').click());
  document.getElementById('board-bottom-zoom-in').addEventListener('click', () => document.getElementById('board-zoom-in').click());
  document.getElementById('board-bottom-zoom-label').addEventListener('click', resetBoardZoomTo100);
  document.getElementById('board-zoom-label').addEventListener('click', resetBoardZoomTo100);
  document.getElementById('board-bottom-fullscreen-toggle').addEventListener('click', toggleBoardFullscreen);

  const origZoomLabel = document.getElementById('board-zoom-label');
  new MutationObserver(syncBoardBottomZoomLabel).observe(origZoomLabel, { childList: true, characterData: true, subtree: true });
  document.addEventListener('messs:language-changed', refreshBoardLanguage);
  refreshBoardLanguage();
}

/* ===================== Text notes on the board ===================== */

let textPlacementArmed = false;
let activeTextNoteId = null;

/** Click the "T" tool once to arm placement mode �?the next click on empty
    canvas space creates a new, immediately-editable text box there (rather
    than the old prompt() popup), matching "点击打字工具，点击画布，出现
    杈撳叆椤甸潰鍜岃繖浜涚粏鑺傞潰鏉?. */
function armTextPlacement() {
  textPlacementArmed = true;
  document.getElementById('board-tool-text').classList.add('is-active');
  document.getElementById('board-viewport').classList.add('is-text-armed');
}

function disarmTextPlacement() {
  textPlacementArmed = false;
  document.getElementById('board-tool-text').classList.remove('is-active');
  document.getElementById('board-viewport').classList.remove('is-text-armed');
}

function addTextNoteToBoard(x, y) {
  const id = 'note_' + Math.random().toString(36).slice(2, 10);
  const note = {
    id, isNote: true, text: '',
    x: Math.round(x - 90), y: Math.round(y - 24),
    zIndex: AppState.boardItems.length + 1,
    fontFamily: 'inherit', fontSize: 32, fontWeight: '400',
    color: '#15171c', noFill: false, align: 'left'
  };
  note.canvasId = activeCanvasId();
  AppState.boardItems.push(note);
  canvasWorkspaceAddItem(note);
  renderBoard();
  return note;
}

/** Opens the floating detail panel (font/size/weight/color/align) for a
    given text note and wires its controls up to live-update that note. */
function showTextToolPanel(note, contentEl) {
  activeTextNoteId = note.id;
  const panel = document.getElementById('text-tool-panel');
  panel.hidden = false;

  const fontSelect = document.getElementById('text-font-select');
  const sizeLabel = document.getElementById('text-size-label');
  const weightSelect = document.getElementById('text-weight-select');
  const colorSwatch = document.getElementById('text-color-swatch');
  const colorInput = document.getElementById('text-color-input');

  fontSelect.value = note.fontFamily;
  sizeLabel.textContent = note.fontSize;
  weightSelect.value = note.fontWeight;
  colorSwatch.style.setProperty('--text-swatch-color', note.noFill ? 'transparent' : note.color);
  colorInput.value = note.color;
  document.getElementById('text-color-none').classList.toggle('is-active', note.noFill);
  ['left', 'center', 'right'].forEach((a) => {
    document.getElementById('text-align-' + a).classList.toggle('is-active', note.align === a);
  });

  applyTextNoteStyle(note, contentEl);
}

function hideTextToolPanel() {
  activeTextNoteId = null;
  document.getElementById('text-tool-panel').hidden = true;
}

function applyTextNoteStyle(note, contentEl) {
  const el = contentEl || document.querySelector(`.board-text-note[data-board-id="${note.id}"] .board-text-note-content`);
  if (!el) return;
  el.style.fontFamily = note.fontFamily;
  el.style.fontSize = note.fontSize + 'px';
  el.style.fontWeight = note.fontWeight;
  el.style.color = note.noFill ? 'transparent' : note.color;
  el.style.webkitTextStroke = note.noFill ? '1px ' + note.color : '';
  el.style.textAlign = note.align;
}

function getActiveTextNote() {
  return AppState.boardItems.find((b) => b.id === activeTextNoteId);
}

function initTextToolPanel() {
  document.getElementById('text-font-select').addEventListener('change', (e) => {
    const note = getActiveTextNote(); if (!note) return;
    note.fontFamily = e.target.value;
    applyTextNoteStyle(note);
    window.messsAPI.upsertBoardItem(note);
  });
  document.getElementById('text-size-dec').addEventListener('click', () => {
    const note = getActiveTextNote(); if (!note) return;
    note.fontSize = Math.max(10, note.fontSize - 2);
    document.getElementById('text-size-label').textContent = note.fontSize;
    applyTextNoteStyle(note);
    window.messsAPI.upsertBoardItem(note);
  });
  document.getElementById('text-size-inc').addEventListener('click', () => {
    const note = getActiveTextNote(); if (!note) return;
    note.fontSize = Math.min(160, note.fontSize + 2);
    document.getElementById('text-size-label').textContent = note.fontSize;
    applyTextNoteStyle(note);
    window.messsAPI.upsertBoardItem(note);
  });
  document.getElementById('text-weight-select').addEventListener('change', (e) => {
    const note = getActiveTextNote(); if (!note) return;
    note.fontWeight = e.target.value;
    applyTextNoteStyle(note);
    window.messsAPI.upsertBoardItem(note);
  });
  document.getElementById('text-color-swatch').addEventListener('click', () => {
    document.getElementById('text-color-input').click();
  });
  document.getElementById('text-color-input').addEventListener('input', (e) => {
    const note = getActiveTextNote(); if (!note) return;
    note.color = e.target.value;
    note.noFill = false;
    document.getElementById('text-color-swatch').style.setProperty('--text-swatch-color', note.color);
    document.getElementById('text-color-none').classList.remove('is-active');
    applyTextNoteStyle(note);
    window.messsAPI.upsertBoardItem(note);
  });
  document.getElementById('text-color-none').addEventListener('click', (e) => {
    const note = getActiveTextNote(); if (!note) return;
    note.noFill = !note.noFill;
    e.currentTarget.classList.toggle('is-active', note.noFill);
    document.getElementById('text-color-swatch').style.setProperty('--text-swatch-color', note.noFill ? 'transparent' : note.color);
    applyTextNoteStyle(note);
    window.messsAPI.upsertBoardItem(note);
  });
  ['left', 'center', 'right'].forEach((align) => {
    document.getElementById('text-align-' + align).addEventListener('click', () => {
      const note = getActiveTextNote(); if (!note) return;
      note.align = align;
      ['left', 'center', 'right'].forEach((a) => document.getElementById('text-align-' + a).classList.toggle('is-active', a === align));
      applyTextNoteStyle(note);
      window.messsAPI.upsertBoardItem(note);
    });
  });
}

/** Renders a confirmed doodle as a plain draggable image item �?visually
    and behaviorally like any other board item (selectable, draggable,
    removable), just backed by inline image data instead of a fileId. */
function buildDoodleItemEl(item) {
  const el = document.createElement('div');
  el.className = 'board-item board-item-doodle' + (item.selected ? ' is-selected' : '');
  el.style.left = item.x + 'px';
  el.style.top = item.y + 'px';
  el.style.width = (item.width || 320) + 'px';
  if (item.height) el.style.height = item.height + 'px';
  el.style.zIndex = item.zIndex || 1;
  el.dataset.boardId = item.id;
  el.addEventListener('click', (e) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      e.stopPropagation();
      item.selected = !item.selected;
      el.classList.toggle('is-selected', item.selected);
    } else if (!item.selected) {
      AppState.boardItems.forEach((b) => { b.selected = false; });
      item.selected = true;
      syncBoardSelectionClasses();
    }
  });

  const content = document.createElement('div');
  content.className = 'board-item-content';
  const img = document.createElement('img');
  img.alt = '涂鸦';
  img.draggable = false;
  img.addEventListener('load', () => trimStoredDoodleToInk(item, img), { once: true });
  img.src = item.imageData;
  content.appendChild(img);
  el.appendChild(content);

  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const selectedCount = AppState.boardItems.filter((boardItem) => boardItem.selected).length;
    if (selectedCount >= 2 && item.selected) showBoardMultiContextMenu(e.clientX, e.clientY);
    else showBoardItemContextMenu(item, e.clientX, e.clientY);
  });
  makeBoardItemDraggable(el, item);
  return el;
}



let doodleActive = false;
let doodleCtx = null;

function isDoodleActive() { return doodleActive; }

const DoodleState = { color: '#a855f7', size: 3, tool: 'pen' };

// Tracks whether anything has actually been drawn since doodle mode was
// entered, so confirming an untouched canvas doesn't litter the board with
// an empty image item.
let doodleHasStrokes = false;

function toggleDoodleMode() {
  if (doodleActive) {
    exitDoodleMode(false); // toolbar button toggling off = cancel, same as before
  } else {
    enterDoodleMode();
  }
}

function enterDoodleMode() {
  if (doodleActive) return;
  doodleActive = true;
  doodleHasStrokes = false;
  const canvas = document.getElementById('board-doodle-canvas');
  const btn = document.getElementById('board-tool-doodle');
  const colorPanel = document.getElementById('doodle-color-panel');
  canvas.hidden = false;
  colorPanel.hidden = false;
  btn.classList.add('is-active');

  const viewport = document.getElementById('board-viewport');
  canvas.width = viewport.clientWidth;
  canvas.height = viewport.clientHeight;
  doodleCtx = canvas.getContext('2d');
  applyDoodleBrushSettings();

  let drawing = false;
  let drawFrameId = 0;
  const pendingPoints = [];

  function pos(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function flushDoodlePoints() {
    drawFrameId = 0;
    if (!pendingPoints.length) return;
    for (const point of pendingPoints.splice(0)) {
      doodleCtx.lineTo(point.x, point.y);
    }
    doodleCtx.stroke();
  }

  function queueDoodlePoints(events) {
    for (const event of events) pendingPoints.push(pos(event));
    if (!drawFrameId) drawFrameId = requestAnimationFrame(flushDoodlePoints);
  }

  canvas.onpointerdown = (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    drawing = true;
    doodleHasStrokes = true;
    applyDoodleBrushSettings();
    const p = pos(e);
    doodleCtx.beginPath();
    doodleCtx.moveTo(p.x, p.y);
    if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
  };

  canvas.onpointermove = (e) => {
    if (!drawing || !(e.buttons & 1)) { drawing = false; return; }
    e.stopPropagation();
    const coalesced = typeof e.getCoalescedEvents === 'function'
      ? e.getCoalescedEvents()
      : [];
    queueDoodlePoints(coalesced.length ? coalesced : [e]);
  };

  canvas.onpointerup = (e) => {
    flushDoodlePoints();
    drawing = false;
    if (canvas.hasPointerCapture && canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
  };
  canvas.onpointercancel = () => {
    flushDoodlePoints();
    drawing = false;
  };
  function escHandler(e) {
    if (e.key === 'Escape' && doodleActive) exitDoodleMode(false);
  }
  canvas._doodleCleanup = () => {
    if (drawFrameId) cancelAnimationFrame(drawFrameId);
    drawFrameId = 0;
    pendingPoints.length = 0;
    document.removeEventListener('keydown', escHandler);
  };

  document.addEventListener('keydown', escHandler);
}

/** Leaves doodle mode. When `commit` is true (pressing the 鉁?confirm
    button), whatever was drawn is kept: it's turned into a normal,
    freely-draggable board item (like dropping in a file) positioned exactly
    where it visually was, instead of just being discarded. When `commit` is
    false (Escape, or toggling the tool off), the stroke is thrown away �?    matching the previous behavior. */
function exitDoodleMode(commit) {
  if (!doodleActive) return;
  const canvas = document.getElementById('board-doodle-canvas');
  const btn = document.getElementById('board-tool-doodle');
  const colorPanel = document.getElementById('doodle-color-panel');

  if (commit && doodleHasStrokes) {
    commitDoodleToBoard(canvas);
  }

  doodleActive = false;
  canvas.hidden = true;
  colorPanel.hidden = true;
  btn.classList.remove('is-active');
  if (typeof canvas._doodleCleanup === 'function') canvas._doodleCleanup();
  canvas._doodleCleanup = null;
  canvas.onpointerdown = null;
  canvas.onpointermove = null;
  canvas.onpointerup = null;
  canvas.onpointercancel = null;
  if (doodleCtx) doodleCtx.clearRect(0, 0, canvas.width, canvas.height);
  doodleHasStrokes = false;
}

/** Converts the current doodle canvas into a persistent board item placed
    at the same on-screen spot it was just drawn at, so it reads as
    "keep this drawing right here, now move it around freely" rather than
    resetting position/zoom. */
function commitDoodleToBoard(canvas) {
  const viewport = document.getElementById('board-viewport');
  const rect = viewport.getBoundingClientRect();
  const { x, y } = clientToBoardCoords(rect.left, rect.top);
  const bounds = getDoodleBounds(canvas);
  if (!bounds) return;
  const cropped = document.createElement('canvas');
  cropped.width = bounds.width;
  cropped.height = bounds.height;
  cropped.getContext('2d').drawImage(canvas, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
  const item = {
    id: 'doodle_' + Math.random().toString(36).slice(2, 10),
    isDoodle: true,
    imageData: cropped.toDataURL('image/png'),
    x: Math.round(x + bounds.x / Board.zoom),
    y: Math.round(y + bounds.y / Board.zoom),
    width: Math.round(bounds.width / Board.zoom),
    height: Math.round(bounds.height / Board.zoom),
    doodleTrimVersion: 2,
    zIndex: AppState.boardItems.length + 1,
    canvasId: activeCanvasId(),
    selected: true
  };
  AppState.boardItems.forEach((b) => { b.selected = false; });
  AppState.boardItems.push(item);
  canvasWorkspaceAddItem(item);
  window.messsAPI.upsertBoardItem(item);
  renderBoard();
}

function getDoodleBounds(canvas) {
  const imageData = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  return getAlphaBounds(imageData.data, canvas.width, canvas.height);
}

function getAlphaBounds(pixels, width, height) {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] === 0) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) return null;
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

/** Older saved doodles used the full viewport-sized transparent PNG. Tighten
    them once on load while preserving the exact on-board position and scale. */
function trimStoredDoodleToInk(item, img) {
  if (item.doodleTrimVersion >= 2 || !img.naturalWidth || !img.naturalHeight) return;

  const source = document.createElement('canvas');
  source.width = img.naturalWidth;
  source.height = img.naturalHeight;
  const sourceCtx = source.getContext('2d', { willReadFrequently: true });
  sourceCtx.drawImage(img, 0, 0);
  const pixels = sourceCtx.getImageData(0, 0, source.width, source.height).data;
  const bounds = getAlphaBounds(pixels, source.width, source.height);
  if (!bounds) return;

  const oldWidth = item.width || 320;
  const oldHeight = item.height || Math.round(oldWidth * source.height / source.width);
  const scaleX = oldWidth / source.width;
  const scaleY = oldHeight / source.height;

  const cropped = document.createElement('canvas');
  cropped.width = bounds.width;
  cropped.height = bounds.height;
  cropped.getContext('2d').drawImage(
    source,
    bounds.x, bounds.y, bounds.width, bounds.height,
    0, 0, bounds.width, bounds.height
  );

  item.x = Math.round(item.x + bounds.x * scaleX);
  item.y = Math.round(item.y + bounds.y * scaleY);
  item.width = Math.max(1, Math.round(bounds.width * scaleX));
  item.height = Math.max(1, Math.round(bounds.height * scaleY));
  item.imageData = cropped.toDataURL('image/png');
  item.doodleTrimVersion = 2;
  window.messsAPI.upsertBoardItem(item);
  renderBoard();
}

/** Applies the current tool/color/size to the doodle canvas's drawing
    context. The eraser is implemented via destination-out compositing
    (paints transparency instead of a color), so it actually erases
    whatever was drawn underneath rather than drawing over it in the
    canvas's background color. */
function applyDoodleBrushSettings() {
  if (!doodleCtx) return;
  doodleCtx.globalCompositeOperation = DoodleState.tool === 'eraser' ? 'destination-out' : 'source-over';
  doodleCtx.strokeStyle = DoodleState.color;
  doodleCtx.lineWidth = DoodleState.tool === 'eraser' ? DoodleState.size * 3 : DoodleState.size;
  doodleCtx.lineJoin = 'round';
  doodleCtx.lineCap = 'round';
}

function initDoodleColorPanel() {
  const penBtn = document.getElementById('doodle-tool-pen');
  const eraserBtn = document.getElementById('doodle-tool-eraser');
  const sizeSlider = document.getElementById('doodle-size-slider');
  const swatches = document.querySelectorAll('.doodle-swatch');
  const customColorInput = document.getElementById('doodle-custom-color');
  const confirmBtn = document.getElementById('doodle-confirm-btn');

  penBtn.addEventListener('click', () => {
    DoodleState.tool = 'pen';
    penBtn.classList.add('is-active');
    eraserBtn.classList.remove('is-active');
  });
  eraserBtn.addEventListener('click', () => {
    DoodleState.tool = 'eraser';
    eraserBtn.classList.add('is-active');
    penBtn.classList.remove('is-active');
  });
  sizeSlider.addEventListener('input', () => { DoodleState.size = parseInt(sizeSlider.value, 10); });

  swatches.forEach((sw) => {
    sw.addEventListener('click', () => {
      DoodleState.color = sw.dataset.color;
      swatches.forEach((s) => s.classList.remove('is-active'));
      sw.classList.add('is-active');
      // Picking a preset color also switches back to the pen �?selecting
      // a color while erasing doesn't make sense.
      DoodleState.tool = 'pen';
      penBtn.classList.add('is-active');
      eraserBtn.classList.remove('is-active');
    });
  });
  customColorInput.addEventListener('input', () => {
    DoodleState.color = customColorInput.value;
    swatches.forEach((s) => s.classList.remove('is-active'));
    DoodleState.tool = 'pen';
    penBtn.classList.add('is-active');
    eraserBtn.classList.remove('is-active');
  });

  confirmBtn.addEventListener('click', () => { if (doodleActive) exitDoodleMode(true); });
}


