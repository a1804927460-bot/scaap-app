'use strict';

(function exposeBoardLeaferLayer(root, factory) {
  const api = factory(root);
  if (root) root.MesssBoardLeaferLayer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createBoardLeaferLayer(root) {
  const SCREEN_PIXEL_RATIO = 1;
  const MAX_EXPORT_PIXEL_RATIO = 3;
  const DEFAULT_RADIUS = 6;
  const state = {
    canvas: null,
    leafer: null,
    group: null,
    entries: new Map(),
    orderSignature: '',
    visible: false,
    width: 0,
    height: 0,
    pixelRatio: SCREEN_PIXEL_RATIO,
    resizeCalls: 0,
    syncCalls: 0,
    lastSyncKey: '',
    lastTransform: null,
    lastError: null
  };

  function finite(value, fallback = 0) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  }

  function positive(value, fallback = 1) {
    return Math.max(1, finite(value, fallback));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function classes() {
    const api = root && root.LeaferUI;
    if (!api || typeof api.Leafer !== 'function' || typeof api.Group !== 'function' ||
        typeof api.Rect !== 'function' || typeof api.Image !== 'function' ||
        typeof api.Text !== 'function') return null;
    return api;
  }

  function normalizeSource(value) {
    return String(value || '').trim();
  }

  function normalizeBounds(item, getBounds) {
    const source = typeof getBounds === 'function' ? getBounds(item.id) : null;
    const bounds = source || item;
    if (!bounds) return null;
    const width = positive(bounds.w || bounds.width, 1);
    const height = positive(bounds.h || bounds.height, 1);
    return {
      x: finite(bounds.x, 0),
      y: finite(bounds.y, 0),
      width,
      height
    };
  }

  function colorForItem(item, getColor) {
    const value = typeof getColor === 'function' ? getColor(item) : '';
    return String(value || '#7d8798');
  }

  function textForItem(item) {
    if (item.isMoodboard) return String(item.moodboardTitle || item.moodboardText || '');
    if (item.isNote) return String(item.text || '');
    return '';
  }

  function itemKind(item, file, source) {
    if (item.isPartition) return 'partition';
    if (item.isDoodle && source) return 'doodle';
    if (item.isMoodboard || item.isNote) return 'text';
    if (item.isAiPlaceholder) return 'pending';
    if (source && file) return 'media';
    return 'rect';
  }

  function itemSignature(item, file, bounds, source, kind, color) {
    return [
      kind,
      item.id,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      item.selected ? 1 : 0,
      finite(item.zIndex, 0),
      source,
      color,
      textForItem(item),
      item.fontFamily || '',
      item.fontSize || '',
      item.fontWeight || '',
      item.noFill ? 1 : 0
    ].join('\u001f');
  }

  function baseOptions(item, bounds, color) {
    return {
      id: `messs-board-${item.id}`,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      zIndex: finite(item.zIndex, item.isPartition ? 0 : 1),
      opacity: item.selected ? 1 : 0.84,
      hittable: false,
      cornerRadius: DEFAULT_RADIUS,
      placeholderColor: color
    };
  }

  function createDrawable(item, file, bounds, source, kind, color) {
    const api = classes();
    if (!api) return null;
    const options = baseOptions(item, bounds, color);
    const stroke = item.selected ? '#f5f7fb' : 'rgba(220, 226, 235, 0.72)';
    const strokeWidth = item.selected ? 1.2 : 0.8;

    if (kind === 'media' || kind === 'doodle') {
      return new api.Image({
        ...options,
        fill: {
          type: 'image',
          url: source,
          mode: kind === 'doodle' ? 'stretch' : 'cover',
          showProgress: false
        },
        stroke,
        strokeWidth,
        cornerRadius: kind === 'doodle' ? 0 : DEFAULT_RADIUS
      });
    }

    if (kind === 'text') {
      const text = textForItem(item);
      return new api.Text({
        ...options,
        text,
        fill: item.color || '#e8ebf1',
        fontFamily: item.fontFamily || 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
        fontSize: clamp(finite(item.fontSize, 14), 8, 36),
        fontWeight: item.fontWeight || 500,
        textWrap: 'normal',
        textOverflow: 'ellipsis',
        verticalAlign: 'top',
        padding: 8,
        stroke: undefined,
        cornerRadius: DEFAULT_RADIUS
      });
    }

    if (kind === 'partition') {
      return new api.Rect({
        ...options,
        fill: 'rgba(125, 135, 152, 0.22)',
        stroke: item.selected ? '#f5f7fb' : 'rgba(190, 198, 212, 0.4)',
        strokeWidth,
        cornerRadius: 8,
        opacity: item.selected ? 1 : 0.92
      });
    }

    return new api.Rect({
      ...options,
      fill: kind === 'pending' ? 'rgba(125, 135, 152, 0.3)' : color,
      stroke,
      strokeWidth
    });
  }

  function updateDrawable(drawable, item, bounds, source, kind, color) {
    if (!drawable) return;
    drawable.x = bounds.x;
    drawable.y = bounds.y;
    drawable.width = bounds.width;
    drawable.height = bounds.height;
    drawable.zIndex = finite(item.zIndex, item.isPartition ? 0 : 1);
    drawable.opacity = item.selected ? 1 : (kind === 'partition' ? 0.92 : 0.84);
    if (kind === 'partition') {
      drawable.stroke = item.selected ? '#f5f7fb' : 'rgba(190, 198, 212, 0.4)';
      drawable.fill = 'rgba(125, 135, 152, 0.22)';
    } else if (kind === 'text') {
      drawable.text = textForItem(item);
      drawable.fill = item.color || '#e8ebf1';
      drawable.fontSize = clamp(finite(item.fontSize, 14), 8, 36);
      drawable.fontWeight = item.fontWeight || 500;
    } else if (kind === 'media' || kind === 'doodle') {
      drawable.fill = source ? {
        type: 'image',
        url: source,
        mode: kind === 'doodle' ? 'stretch' : 'cover',
        showProgress: false
      } : color;
    } else if (kind === 'rect' || kind === 'pending') {
      drawable.fill = kind === 'pending' ? 'rgba(125, 135, 152, 0.3)' : color;
    }
  }

  function resize(width, height, pixelRatio = state.pixelRatio) {
    if (!state.leafer || !state.canvas) return false;
    const nextWidth = Math.max(1, Math.round(finite(width, state.canvas.clientWidth || 1)));
    const nextHeight = Math.max(1, Math.round(finite(height, state.canvas.clientHeight || 1)));
    const nextPixelRatio = clamp(finite(pixelRatio, SCREEN_PIXEL_RATIO), 1, MAX_EXPORT_PIXEL_RATIO);
    if (state.width === nextWidth && state.height === nextHeight &&
        state.pixelRatio === nextPixelRatio) return true;
    try {
      state.leafer.resize({ width: nextWidth, height: nextHeight, pixelRatio: nextPixelRatio });
      state.width = nextWidth;
      state.height = nextHeight;
      state.pixelRatio = nextPixelRatio;
      state.resizeCalls += 1;
      state.canvas.style.width = `${nextWidth}px`;
      state.canvas.style.height = `${nextHeight}px`;
      return true;
    } catch (error) {
      state.lastError = error;
      return false;
    }
  }

  function init(options = {}) {
    const canvas = options.canvas;
    if (!canvas) return false;
    if (state.leafer && state.canvas === canvas) {
      resize(
        options.width,
        options.height,
        options.pixelRatio === undefined ? state.pixelRatio : options.pixelRatio
      );
      return true;
    }
    destroy();
    const api = classes();
    if (!api) return false;
    try {
      const width = Math.max(1, Math.round(finite(options.width, canvas.clientWidth || 1)));
      const height = Math.max(1, Math.round(finite(options.height, canvas.clientHeight || 1)));
      const pixelRatio = clamp(finite(options.pixelRatio, SCREEN_PIXEL_RATIO), 1, MAX_EXPORT_PIXEL_RATIO);
      const leafer = new api.Leafer({
        view: canvas,
        width,
        height,
        pixelRatio,
        smooth: false,
        hittable: false,
        lazySpeard: 1200,
        start: true
      });
      const group = new api.Group({ id: 'messs-board-world', hittable: false });
      leafer.add(group);
      state.canvas = canvas;
      state.leafer = leafer;
      state.group = group;
      // Leafer has already allocated this exact backing store in its
      // constructor. Record it instead of resizing a second time on init.
      state.width = width;
      state.height = height;
      state.pixelRatio = pixelRatio;
      state.resizeCalls = 0;
      state.lastTransform = null;
      state.lastError = null;
      canvas.classList.add('board-leafer-canvas');
      canvas.dataset.boardRenderer = 'leafer';
      canvas.setAttribute('aria-hidden', 'true');
      canvas.style.pointerEvents = 'none';
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      setVisible(false);
      return true;
    } catch (error) {
      state.lastError = error;
      destroy();
      return false;
    }
  }

  function setTransform(view = {}) {
    if (!state.group) return false;
    const next = {
      x: finite(view.panX, 0),
      y: finite(view.panY, 0),
      scaleX: Math.max(0.0001, finite(view.zoom, 1)),
      scaleY: Math.max(0.0001, finite(view.zoom, 1))
    };
    const previous = state.lastTransform;
    if (previous && previous.x === next.x && previous.y === next.y &&
        previous.scaleX === next.scaleX && previous.scaleY === next.scaleY) return true;
    state.group.x = next.x;
    state.group.y = next.y;
    state.group.scaleX = next.scaleX;
    state.group.scaleY = next.scaleY;
    state.lastTransform = next;
    return true;
  }

  function sync(options = {}) {
    if (!state.leafer || !state.group || !Array.isArray(options.items) && !(options.items instanceof Set)) {
      return false;
    }
    const cacheKey = String(options.cacheKey || '');
    if (cacheKey && cacheKey === state.lastSyncKey) {
      setVisible(true);
      return true;
    }
    state.syncCalls += 1;
    const items = options.items instanceof Set ? [...options.items] : options.items;
    const nextIds = new Set();
    const nextEntries = [];
    for (const item of items) {
      if (!item || !item.id) continue;
      const bounds = normalizeBounds(item, options.getBounds);
      if (!bounds) continue;
      const file = typeof options.getFile === 'function' ? options.getFile(item) : null;
      const source = normalizeSource(typeof options.getSource === 'function' ? options.getSource(file, item) : '');
      const color = colorForItem(item, options.getColor);
      const kind = itemKind(item, file, source);
      const signature = itemSignature(item, file, bounds, source, kind, color);
      const previous = state.entries.get(item.id);
      let drawable = previous && previous.kind === kind ? previous.drawable : null;
      if (!drawable) {
        if (previous && previous.drawable) state.group.remove(previous.drawable, true);
        drawable = createDrawable(item, file, bounds, source, kind, color);
        if (!drawable) continue;
        state.entries.set(item.id, { drawable, kind, signature });
      } else if (previous.signature !== signature) {
        updateDrawable(drawable, item, bounds, source, kind, color);
        previous.signature = signature;
      }
      nextIds.add(item.id);
      nextEntries.push({ id: item.id, drawable, kind, zIndex: finite(item.zIndex, item.isPartition ? 0 : 1) });
    }

    for (const [id, entry] of [...state.entries]) {
      if (nextIds.has(id)) continue;
      state.group.remove(entry.drawable, true);
      state.entries.delete(id);
    }

    nextEntries.sort((left, right) => (
      (left.kind === 'partition' ? -1 : 0) - (right.kind === 'partition' ? -1 : 0) ||
      left.zIndex - right.zIndex ||
      String(left.id).localeCompare(String(right.id))
    ));
    const orderSignature = nextEntries.map((entry) => entry.id).join('\u001f');
    if (orderSignature !== state.orderSignature) {
      state.group.removeAll(false);
      state.group.add(nextEntries.map((entry) => entry.drawable));
      state.orderSignature = orderSignature;
    }
    state.lastSyncKey = cacheKey;
    setVisible(true);
    state.leafer.requestRender(true);
    return true;
  }

  function setVisible(value) {
    state.visible = Boolean(value);
    if (state.canvas) state.canvas.hidden = !state.visible;
    return true;
  }

  function clear() {
    if (state.group) state.group.removeAll(true);
    state.entries.clear();
    state.orderSignature = '';
    state.lastSyncKey = '';
    state.lastTransform = null;
    setVisible(false);
    if (state.leafer) state.leafer.requestRender(true);
    return true;
  }

  function toDataURL(options = {}) {
    if (!state.leafer || !state.canvas) return '';
    const requestedRatio = clamp(finite(options.pixelRatio, state.pixelRatio), 1, MAX_EXPORT_PIXEL_RATIO);
    const fallback = () => {
      const width = Math.max(1, state.width || state.canvas.clientWidth || state.canvas.width || 1);
      const height = Math.max(1, state.height || state.canvas.clientHeight || state.canvas.height || 1);
      if (requestedRatio === state.pixelRatio) return state.canvas.toDataURL('image/png');
      const document = root && root.document;
      if (!document || typeof document.createElement !== 'function') {
        return state.canvas.toDataURL('image/png');
      }
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = Math.max(1, Math.round(width * requestedRatio));
      exportCanvas.height = Math.max(1, Math.round(height * requestedRatio));
      const context = exportCanvas.getContext('2d');
      if (!context) return state.canvas.toDataURL('image/png');
      context.imageSmoothingEnabled = options.smooth !== false;
      context.drawImage(state.canvas, 0, 0, exportCanvas.width, exportCanvas.height);
      return exportCanvas.toDataURL('image/png');
    };
    const normalizeResult = (result) => {
      if (typeof result === 'string') return result;
      if (result && result.data && typeof result.data.toDataURL === 'function') {
        return result.data.toDataURL('image/png');
      }
      return fallback();
    };
    try {
      if (typeof state.leafer.export === 'function') {
        const result = state.leafer.export('png', {
          pixelRatio: requestedRatio,
          smooth: options.smooth !== false,
          fill: options.fill,
          clip: options.clip
        });
        if (result && typeof result.then === 'function') {
          return Promise.resolve(result).then(normalizeResult).catch(fallback);
        }
        return normalizeResult(result);
      }
      return fallback();
    } catch (error) {
      state.lastError = error;
      return fallback();
    }
  }

  function destroy() {
    if (state.leafer) {
      try { state.leafer.destroy(true); } catch (error) { state.lastError = error; }
    }
    if (state.canvas) {
      state.canvas.classList.remove('board-leafer-canvas');
      delete state.canvas.dataset.boardRenderer;
    }
    state.canvas = null;
    state.leafer = null;
    state.group = null;
    state.entries.clear();
    state.orderSignature = '';
    state.visible = false;
    state.width = 0;
    state.height = 0;
    state.pixelRatio = SCREEN_PIXEL_RATIO;
    state.resizeCalls = 0;
    state.syncCalls = 0;
    state.lastSyncKey = '';
    state.lastTransform = null;
  }

  return {
    isSupported: () => Boolean(classes()),
    init,
    resize,
    setTransform,
    sync,
    setVisible,
    clear,
    destroy,
    toDataURL,
    get width() { return state.width; },
    get height() { return state.height; },
    get pixelRatio() { return state.pixelRatio; },
    get resizeCalls() { return state.resizeCalls; },
    get syncCalls() { return state.syncCalls; },
    get visible() { return state.visible; },
    get itemCount() { return state.entries.size; },
    get lastError() { return state.lastError; }
  };
});
