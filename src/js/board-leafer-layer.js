'use strict';

(function exposeBoardLeaferLayer(root, factory) {
  const api = factory(root);
  if (root) root.MesssBoardLeaferLayer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createBoardLeaferLayer(root) {
  const SCREEN_PIXEL_RATIO = 1;
  const MAX_EXPORT_PIXEL_RATIO = 3;
  const state = {
    canvas: null,
    leafer: null,
    group: null,
    doodleGroup: null,
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
    lastError: null,
    options: null
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

  function polygonPath(points) {
    const normalized = (points || []).filter((point) => (
      point && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1]))
    ));
    if (!normalized.length) return '';
    return `M ${normalized.map((point) => `${finite(point[0])} ${finite(point[1])}`).join(' L ')} Z`;
  }

  function normalizeSource(value) {
    return String(value || '').trim();
  }

  function normalizeBounds(item, getBounds) {
    const source = typeof getBounds === 'function' ? getBounds(item) : null;
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
    if (item.isPartition) return String(item.partitionName || '');
    if (item.isMoodboard) return String(item.moodboardTitle || item.moodboardText || '');
    if (item.isNote) return String(item.text || '');
    if (item.fileName) return String(item.fileName);
    return '';
  }

  function moodboardBodyForItem(item) {
    if (!item) return '';
    if (item.moodboardText) return String(item.moodboardText);
    const delta = item.moodboardDelta;
    if (!delta || !Array.isArray(delta.ops)) return '';
    return delta.ops.map((op) => {
      if (!op || typeof op.insert !== 'string') return '';
      return op.insert;
    }).join('').replace(/\n+$/, '');
  }

  function moodboardTitleForItem(item) {
    return String(item && item.moodboardTitle || 'Text moodboard');
  }

  function itemKind(item, file, source) {
    if (item.isPartition) return 'partition';
    if (item.isDoodle && Array.isArray(item.doodlePaths) && item.doodlePaths.length) return 'vector-doodle';
    if (item.isDoodle) return source ? 'doodle' : 'rect';
    if (item.isMoodboard) return 'moodboard';
    if (item.isNote) return 'text';
    if (item.isAiPlaceholder) return 'pending';
    // Keep media as media while its preview URL is being resolved. Falling
    // back to a colored rectangle creates false image flashes on first paint.
    if (file && (source || ['image', 'video', 'model'].includes(file.kind) ||
        /\.(?:avif|bmp|gif|jpe?g|png|webp)$/i.test(String(file.ext || '')))) return 'media';
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
      item.isMoodboard ? moodboardBodyForItem(item) : '',
      item.isTextEditing ? 1 : 0,
      item.fontFamily || '',
      item.fontSize || '',
      item.fontWeight || '',
      item.color || '',
      item.colorMode || '',
      item.noFill ? 1 : 0,
      item.partitionName || '',
      item.fileName || '',
      JSON.stringify(item.doodlePaths || '')
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
      opacity: 1,
      hittable: false,
      cornerRadius: 0,
      lazy: true,
      // Media textures can be decoded asynchronously. A colored placeholder
      // becomes a false image flash during the first frame and camera motion.
      placeholderColor: 'rgba(0, 0, 0, 0)'
    };
  }

  function textOptions(item, bounds, text, color, extra = {}) {
    return {
      id: `messs-board-text-${item.id}`,
      x: extra.x === undefined ? 8 : extra.x,
      y: extra.y === undefined ? 8 : extra.y,
      width: Math.max(1, extra.width === undefined ? bounds.width - 16 : extra.width),
      height: Math.max(1, extra.height === undefined ? bounds.height - 16 : extra.height),
      text,
      fill: color,
      fontFamily: textFontFamilyForItem(item),
      fontSize: clamp(
        finite(extra.fontSize === undefined ? item.fontSize : extra.fontSize, item.isNote ? 32 : 14),
        item.isNote ? 10 : 8,
        item.isNote ? 160 : 36
      ),
      fontWeight: extra.fontWeight || item.fontWeight || 500,
      lineHeight: extra.lineHeight,
      textWrap: 'normal',
      textOverflow: 'ellipsis',
      verticalAlign: extra.verticalAlign || 'top',
      padding: extra.padding === undefined ? 0 : extra.padding,
      hittable: false,
      cornerRadius: 0
    };
  }

  function textColorForItem(item) {
    if (item && item.isNote && !item.noFill) {
      const color = String(item.color || '').trim().toLowerCase();
      const colorMode = String(item.colorMode || '').trim().toLowerCase();
      if (colorMode === 'auto' || (!colorMode && color === '#15171c')) return '#f3f5f8';
    }
    return item && item.noFill ? 'rgba(0,0,0,0)' : (item && item.color || '#e8ebf1');
  }

  function textFontFamilyForItem(item) {
    const family = String(item && item.fontFamily || '').trim();
    return family && family !== 'inherit'
      ? family
      : 'Segoe UI, PingFang SC, Microsoft YaHei, Arial, sans-serif';
  }

  function textFontSizeForItem(item) {
    return clamp(finite(item && item.fontSize, item && item.isNote ? 32 : 14), item && item.isNote ? 10 : 8, item && item.isNote ? 160 : 36);
  }

  function addChildren(group, children) {
    const valid = children.filter(Boolean);
    if (valid.length) group.add(valid);
    group._messsParts = valid;
    return group;
  }

  function createPath(api, id, points, color, tool) {
    if (!api || typeof api.Path !== 'function') return null;
    const path = polygonPath(points);
    if (!path) return null;
    return new api.Path({
      id,
      path,
      fill: color || '#a855f7',
      eraser: tool === 'eraser' ? true : undefined,
      hittable: false
    });
  }

  function createPartitionDrawable(api, item, bounds, color) {
    const group = new api.Group({
      ...baseOptions(item, bounds, color),
      opacity: 1,
      hittable: false
    });
    const rect = new api.Rect({
      id: `messs-board-partition-bg-${item.id}`,
      x: 0,
      y: 0,
      width: bounds.width,
      height: bounds.height,
      fill: 'rgba(125, 135, 152, 0.22)',
      stroke: item.selected ? '#f5f7fb' : 'rgba(190, 198, 212, 0.4)',
      strokeWidth: item.selected ? 1.2 : 0.8,
      cornerRadius: 0,
      hittable: false
    });
    const title = new api.Text(textOptions(
      item,
      bounds,
      textForItem(item),
      '#f5f7fb',
      { x: 18, y: 14, width: bounds.width - 36, height: 34, fontSize: 15, fontWeight: 720 }
    ));
    return addChildren(group, [rect, title]);
  }

  function createLabelDrawable(api, item, bounds, color, pending = false) {
    const group = new api.Group({
      ...baseOptions(item, bounds, color),
      opacity: 1,
      hittable: false
    });
    const rect = new api.Rect({
      id: `messs-board-label-bg-${item.id}`,
      x: 0,
      y: 0,
      width: bounds.width,
      height: bounds.height,
      fill: pending ? 'rgba(125, 135, 152, 0.3)' : color,
      stroke: item.selected ? '#f5f7fb' : 'rgba(220, 226, 235, 0.72)',
      strokeWidth: item.selected ? 1.2 : 0.8,
      cornerRadius: 0,
      hittable: false
    });
    const label = textForItem(item);
    const text = label
      ? new api.Text(textOptions(item, bounds, label, '#f3f5f8', {
        x: 10,
        y: 10,
        width: bounds.width - 20,
        height: bounds.height - 20,
        fontSize: 13,
        fontWeight: 560,
        verticalAlign: 'middle'
      }))
      : null;
    return addChildren(group, [rect, text]);
  }

  function createMoodboardDrawable(api, item, bounds) {
    const group = new api.Group({
      ...baseOptions(item, bounds, '#1d2430'),
      hittable: false
    });
    const background = new api.Rect({
      id: `messs-board-moodboard-bg-${item.id}`,
      x: 0,
      y: 0,
      width: bounds.width,
      height: bounds.height,
      fill: '#1d2430',
      stroke: item.selected ? '#f5f7fb' : undefined,
      strokeWidth: item.selected ? 1.2 : 0,
      cornerRadius: 0,
      hittable: false
    });
    const title = new api.Text(textOptions(item, bounds, moodboardTitleForItem(item), '#f3f5f8', {
      x: 16,
      y: 14,
      width: Math.max(1, bounds.width - 32),
      height: 28,
      fontSize: 20,
      fontWeight: 720,
      lineHeight: { type: 'percent', value: 1.25 },
      textOverflow: 'ellipsis'
    }));
    const body = new api.Text(textOptions(item, bounds, moodboardBodyForItem(item), '#f3f5f8', {
      x: 16,
      y: 52,
      width: Math.max(1, bounds.width - 32),
      height: Math.max(1, bounds.height - 68),
      fontSize: 17,
      fontWeight: 560,
      lineHeight: { type: 'percent', value: 1.5 },
      verticalAlign: 'top',
      textOverflow: 'ellipsis'
    }));
    return addChildren(group, [background, title, body]);
  }

  function createDrawable(item, file, bounds, source, kind, color) {
    const api = classes();
    if (!api) return null;
    const options = baseOptions(item, bounds, color);
    const stroke = item.selected ? '#f5f7fb' : undefined;
    const strokeWidth = item.selected ? 1.2 : 0;

    if (kind === 'vector-doodle' && api.Path) {
      const group = new api.Group({ ...options, hittable: false });
      const paths = (item.doodlePaths || []).map((entry, index) => {
        return createPath(
          api,
          `messs-board-doodle-path-${item.id}-${index}`,
          entry && entry.points,
          entry && entry.color || color,
          entry && entry.tool
        );
      }).filter(Boolean);
      if (paths.length) group.add(paths);
      group._messsParts = paths;
      return group;
    }

    if (kind === 'media' || kind === 'doodle') {
      const showSelectionStroke = kind === 'doodle';
      const image = new api.Image({
        ...options,
        fill: {
          type: 'image',
          url: source,
          mode: 'fit',
          showProgress: false
        },
        stroke: showSelectionStroke ? stroke : undefined,
        strokeWidth: showSelectionStroke ? strokeWidth : 0,
        cornerRadius: 0
      });
      // Geometry and selection updates are frequent. Do not reassign the
      // same image fill because Leafer may start a duplicate texture upload.
      image._messsSource = normalizeSource(source);
      return image;
    }

    if (kind === 'text') {
      const text = textForItem(item);
      return new api.Text({
        ...options,
        text,
        fill: textColorForItem(item),
        fontFamily: textFontFamilyForItem(item),
        fontSize: textFontSizeForItem(item),
        fontWeight: item.fontWeight || 500,
        textWrap: 'normal',
        textOverflow: 'ellipsis',
        verticalAlign: 'top',
        padding: item.isNote || item.isMoodboard ? 8 : 0,
        stroke: undefined,
        cornerRadius: 0,
        opacity: item.isTextEditing ? 0 : 1
      });
    }

    if (kind === 'moodboard') {
      return createMoodboardDrawable(api, item, bounds);
    }

    if (kind === 'partition') {
      return createPartitionDrawable(api, item, bounds, color);
    }

    return createLabelDrawable(api, item, bounds, color, kind === 'pending');
  }

  function updateDrawable(drawable, item, bounds, source, kind, color) {
    if (!drawable) return;
    drawable.x = bounds.x;
    drawable.y = bounds.y;
    drawable.width = bounds.width;
    drawable.height = bounds.height;
    drawable.zIndex = finite(item.zIndex, item.isPartition ? 0 : 1);
    drawable.opacity = 1;
    if (kind === 'partition') {
      const [rect, title] = drawable._messsParts || [];
      if (rect) {
        rect.width = bounds.width;
        rect.height = bounds.height;
        rect.stroke = item.selected ? '#f5f7fb' : 'rgba(190, 198, 212, 0.4)';
        rect.strokeWidth = item.selected ? 1.2 : 0.8;
        rect.fill = 'rgba(125, 135, 152, 0.22)';
      }
      if (title) {
        title.x = 18;
        title.y = 14;
        title.width = Math.max(1, bounds.width - 36);
        title.height = 34;
        title.text = textForItem(item);
      }
    } else if (kind === 'moodboard') {
      const [background, title, body] = drawable._messsParts || [];
      if (background) {
        background.width = bounds.width;
        background.height = bounds.height;
        background.stroke = item.selected ? '#f5f7fb' : undefined;
        background.strokeWidth = item.selected ? 1.2 : 0;
      }
      if (title) {
        title.width = Math.max(1, bounds.width - 32);
        title.text = moodboardTitleForItem(item);
      }
      if (body) {
        body.width = Math.max(1, bounds.width - 32);
        body.height = Math.max(1, bounds.height - 68);
        body.text = moodboardBodyForItem(item);
      }
    } else if (kind === 'text') {
      drawable.text = textForItem(item);
      drawable.fill = textColorForItem(item);
      drawable.fontSize = textFontSizeForItem(item);
      drawable.fontWeight = item.fontWeight || 500;
      drawable.opacity = item.isTextEditing ? 0 : 1;
    } else if (kind === 'media' || kind === 'doodle') {
      const nextSource = normalizeSource(source);
      if (nextSource && nextSource !== drawable._messsSource) {
        drawable.fill = {
          type: 'image',
          url: nextSource,
          mode: 'fit',
          showProgress: false
        };
        drawable._messsSource = nextSource;
      }
      drawable.stroke = kind === 'doodle' && item.selected ? '#f5f7fb' : undefined;
      drawable.strokeWidth = kind === 'doodle' && item.selected ? 1.2 : 0;
    } else if (kind === 'vector-doodle') {
      const api = classes();
      const entries = item.doodlePaths || [];
      const paths = drawable._messsParts || [];
      if (api && typeof api.Path === 'function' && paths.length !== entries.length) {
        drawable.removeAll(true);
        const nextPaths = entries.map((entry, index) => createPath(
          api,
          `messs-board-doodle-path-${item.id}-${index}`,
          entry && entry.points,
          entry && entry.color || color,
          entry && entry.tool
        )).filter(Boolean);
        if (nextPaths.length) drawable.add(nextPaths);
        drawable._messsParts = nextPaths;
      } else {
        entries.forEach((entry, index) => {
          const path = paths[index];
          if (!path) return;
          path.path = polygonPath(entry && entry.points);
          path.fill = entry && entry.color || color;
          path.eraser = entry && entry.tool === 'eraser' ? true : undefined;
        });
      }
    } else if (kind === 'rect' || kind === 'pending') {
      const [rect, label] = drawable._messsParts || [];
      if (rect) {
        rect.width = bounds.width;
        rect.height = bounds.height;
        rect.fill = kind === 'pending' ? 'rgba(125, 135, 152, 0.3)' : color;
        rect.stroke = item.selected ? '#f5f7fb' : undefined;
        rect.strokeWidth = item.selected ? 1.2 : 0;
      }
      if (label) {
        label.text = textForItem(item);
        label.width = Math.max(1, bounds.width - 20);
        label.height = Math.max(1, bounds.height - 20);
      }
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
        smooth: true,
        hittable: false,
        lazySpeard: 1200,
        start: true
      });
      const group = new api.Group({ id: 'messs-board-world', hittable: false });
      leafer.add(group);
      const doodleGroup = new api.Group({
        id: 'messs-board-doodles',
        zIndex: 100000,
        hittable: false
      });
      leafer.add(doodleGroup);
      state.canvas = canvas;
      state.leafer = leafer;
      state.group = group;
      state.doodleGroup = doodleGroup;
      // Leafer has already allocated this exact backing store in its
      // constructor. Record it instead of resizing a second time on init.
      state.width = width;
      state.height = height;
      state.pixelRatio = pixelRatio;
      state.resizeCalls = 0;
      state.lastTransform = null;
      state.lastError = null;
      state.options = null;
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
    state.doodleGroup.x = next.x;
    state.doodleGroup.y = next.y;
    state.doodleGroup.scaleX = next.scaleX;
    state.doodleGroup.scaleY = next.scaleY;
    state.lastTransform = next;
    return true;
  }

  function sync(options = {}) {
    if (!state.leafer || !state.group || !Array.isArray(options.items) && !(options.items instanceof Set)) {
      return false;
    }
    state.options = options;
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
      item.fileName = file && file.name ? String(file.name) : item.fileName || '';
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

  function resolveItem(item, options = null) {
    if (!item || !item.id) return null;
    const resolvedOptions = options && Object.keys(options).length ? options : (state.options || {});
    const bounds = normalizeBounds(item, resolvedOptions.getBounds);
    if (!bounds) return null;
    const file = typeof resolvedOptions.getFile === 'function' ? resolvedOptions.getFile(item) : null;
    const source = normalizeSource(typeof resolvedOptions.getSource === 'function' ? resolvedOptions.getSource(file, item) : '');
    const color = colorForItem(item, resolvedOptions.getColor);
    const kind = itemKind(item, file, source);
    const signature = itemSignature(item, file, bounds, source, kind, color);
    return { bounds, file, source, color, kind, signature };
  }

  function updateItem(item, options = {}) {
    if (!state.leafer || !state.group || !item || !item.id) return false;
    const resolved = resolveItem(item, options);
    if (!resolved) return false;
    item.fileName = resolved.file && resolved.file.name
      ? String(resolved.file.name)
      : item.fileName || '';
    const previous = state.entries.get(item.id);
    let drawable = previous && previous.kind === resolved.kind ? previous.drawable : null;
    if (!drawable) {
      if (previous && previous.drawable) state.group.remove(previous.drawable, true);
      drawable = createDrawable(
        item,
        resolved.file,
        resolved.bounds,
        resolved.source,
        resolved.kind,
        resolved.color
      );
      if (!drawable) return false;
      state.entries.set(item.id, {
        drawable,
        kind: resolved.kind,
        signature: resolved.signature,
        item
      });
      state.group.add(drawable);
    } else if (previous.signature !== resolved.signature) {
      updateDrawable(
        drawable,
        item,
        resolved.bounds,
        resolved.source,
        resolved.kind,
        resolved.color
      );
      previous.signature = resolved.signature;
      previous.item = item;
    }
    state.lastSyncKey = '';
    state.leafer.requestRender(true);
    return true;
  }

  function updateItems(items, options = {}) {
    let changed = false;
    for (const item of items || []) {
      if (!state.leafer || !state.group || !item || !item.id) continue;
      const resolved = resolveItem(item, options);
      if (!resolved) continue;
      item.fileName = resolved.file && resolved.file.name
        ? String(resolved.file.name)
        : item.fileName || '';
      const previous = state.entries.get(item.id);
      let drawable = previous && previous.kind === resolved.kind ? previous.drawable : null;
      if (!drawable) {
        if (previous && previous.drawable) state.group.remove(previous.drawable, true);
        drawable = createDrawable(
          item,
          resolved.file,
          resolved.bounds,
          resolved.source,
          resolved.kind,
          resolved.color
        );
        if (!drawable) continue;
        state.entries.set(item.id, {
          drawable,
          kind: resolved.kind,
          signature: resolved.signature,
          item
        });
        state.group.add(drawable);
        changed = true;
      } else if (previous.signature !== resolved.signature) {
        updateDrawable(
          drawable,
          item,
          resolved.bounds,
          resolved.source,
          resolved.kind,
          resolved.color
        );
        previous.signature = resolved.signature;
        previous.item = item;
        changed = true;
      }
    }
    if (changed) {
      state.lastSyncKey = '';
      state.leafer.requestRender(true);
    }
    return changed;
  }

  function removeItems(ids) {
    if (!state.group) return false;
    let changed = false;
    for (const id of ids || []) {
      const entry = state.entries.get(id);
      if (!entry) continue;
      state.group.remove(entry.drawable, true);
      state.entries.delete(id);
      changed = true;
    }
    if (changed) {
      state.orderSignature = '';
      state.lastSyncKey = '';
      state.leafer.requestRender(true);
    }
    return changed;
  }

  function renderDoodle(strokes = []) {
    if (!state.leafer || !state.doodleGroup) return false;
    const api = classes();
    if (!api || typeof api.Path !== 'function') return false;
    const previous = state.doodleGroup._messsParts || [];
    const entries = Array.isArray(strokes) ? strokes : [];
    const next = [];
    entries.forEach((stroke, index) => {
      const path = previous[index] || createPath(
        api,
        `messs-active-doodle-${index}`,
        stroke && (stroke.outline || stroke.points),
        stroke && stroke.color,
        stroke && stroke.tool
      );
      if (!path) return;
      path.path = polygonPath(stroke && (stroke.outline || stroke.points));
      path.fill = stroke && stroke.color || '#a855f7';
      path.eraser = stroke && stroke.tool === 'eraser' ? true : undefined;
      if (!previous[index]) state.doodleGroup.add(path);
      next.push(path);
    });
    previous.slice(next.length).forEach((path) => state.doodleGroup.remove(path, true));
    state.doodleGroup._messsParts = next;
    state.leafer.requestRender(true);
    return true;
  }

  function clearDoodle() {
    if (!state.doodleGroup) return false;
    state.doodleGroup.removeAll(true);
    state.doodleGroup._messsParts = [];
    if (state.leafer) state.leafer.requestRender(true);
    return true;
  }

  function setVisible(value) {
    state.visible = Boolean(value);
    if (state.canvas) state.canvas.hidden = !state.visible;
    return true;
  }

  function clear() {
    if (state.group) state.group.removeAll(true);
    clearDoodle();
    state.entries.clear();
    state.orderSignature = '';
    state.lastSyncKey = '';
    state.lastTransform = null;
    state.options = null;
    setVisible(false);
    if (state.leafer) state.leafer.requestRender(true);
    return true;
  }

  function toDataURL(options = {}) {
    if (!state.leafer || !state.canvas) return '';
    const requestedRatio = clamp(finite(options.pixelRatio, state.pixelRatio), 1, MAX_EXPORT_PIXEL_RATIO);
    const fallback = () => state.canvas.toDataURL('image/png');
    const normalizeResult = (result) => {
      if (typeof result === 'string') return result;
      if (result && result.error) state.lastError = result.error;
      if (result && typeof result.data === 'string') return result.data;
      if (result && result.data && typeof result.data.toDataURL === 'function') {
        return result.data.toDataURL('image/png');
      }
      return fallback();
    };
    try {
      if (typeof state.leafer.syncExport === 'function') {
        return normalizeResult(state.leafer.syncExport('png', {
          pixelRatio: requestedRatio,
          smooth: options.smooth !== false,
          fill: options.fill,
          clip: options.clip
        }));
      }
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
    state.doodleGroup = null;
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
    updateItem,
    updateItems,
    removeItems,
    renderDoodle,
    clearDoodle,
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
    get doodleCount() { return state.doodleGroup ? (state.doodleGroup._messsParts || []).length : 0; },
    get lastError() { return state.lastError; }
  };
});
