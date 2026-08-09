'use strict';

(function exposeBoardEngine(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MesssBoardEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createBoardEngineApi() {
  function intersects(a, b) {
    return a.x < b.x + b.w &&
      a.x + a.w > b.x &&
      a.y < b.y + b.h &&
      a.y + a.h > b.y;
  }

  function createSpatialIndex(cellSize = 400) {
    cellSize = Number.isFinite(cellSize) && cellSize > 0 ? cellSize : 400;
    const grid = new Map();
    const boundsById = new Map();

    function cellRange(bounds) {
      const w = Math.max(1, bounds.w);
      const h = Math.max(1, bounds.h);
      return {
        minX: Math.floor(bounds.x / cellSize),
        maxX: Math.floor((bounds.x + w - 0.0001) / cellSize),
        minY: Math.floor(bounds.y / cellSize),
        maxY: Math.floor((bounds.y + h - 0.0001) / cellSize)
      };
    }

    function forEachCell(bounds, callback) {
      const range = cellRange(bounds);
      for (let x = range.minX; x <= range.maxX; x += 1) {
        for (let y = range.minY; y <= range.maxY; y += 1) {
          callback(`${x}:${y}`);
        }
      }
    }

    function remove(id) {
      const previous = boundsById.get(id);
      if (!previous) return;
      forEachCell(previous, (key) => {
        const bucket = grid.get(key);
        if (!bucket) return;
        bucket.delete(id);
        if (!bucket.size) grid.delete(key);
      });
      boundsById.delete(id);
    }

    function set(id, bounds) {
      remove(id);
      const normalized = {
        x: Number.isFinite(bounds.x) ? bounds.x : 0,
        y: Number.isFinite(bounds.y) ? bounds.y : 0,
        w: Math.max(1, Number.isFinite(bounds.w) ? bounds.w : 1),
        h: Math.max(1, Number.isFinite(bounds.h) ? bounds.h : 1)
      };
      boundsById.set(id, normalized);
      forEachCell(normalized, (key) => {
        let bucket = grid.get(key);
        if (!bucket) {
          bucket = new Set();
          grid.set(key, bucket);
        }
        bucket.add(id);
      });
    }

    function forEachMatch(rect, callback) {
      const seen = new Set();
      const range = cellRange(rect);
      for (let x = range.minX; x <= range.maxX; x += 1) {
        for (let y = range.minY; y <= range.maxY; y += 1) {
          const bucket = grid.get(`${x}:${y}`);
          if (!bucket) continue;
          for (const id of bucket) {
            if (seen.has(id)) continue;
            seen.add(id);
            const bounds = boundsById.get(id);
            if (bounds && intersects(bounds, rect) && callback(id, bounds) === false) {
              return;
            }
          }
        }
      }
    }

    function queryLimited(rect, limit = Infinity) {
      const normalizedLimit = Number.isFinite(limit)
        ? Math.max(0, Math.floor(limit))
        : Infinity;
      const matches = new Set();
      if (!normalizedLimit) return matches;
      forEachMatch(rect, (id) => {
        matches.add(id);
        return matches.size < normalizedLimit;
      });
      return matches;
    }

    function query(rect) {
      return queryLimited(rect);
    }

    function count(rect, stopAt = Infinity) {
      const normalizedLimit = Number.isFinite(stopAt)
        ? Math.max(0, Math.floor(stopAt))
        : Infinity;
      if (!normalizedLimit) return 0;
      let matches = 0;
      forEachMatch(rect, () => {
        matches += 1;
        return matches < normalizedLimit;
      });
      return matches;
    }

    function clear() {
      grid.clear();
      boundsById.clear();
    }

    return {
      set,
      remove,
      query,
      queryLimited,
      count,
      clear,
      getBounds: (id) => boundsById.get(id) || null,
      get size() { return boundsById.size; },
      get cellCount() { return grid.size; }
    };
  }

  function clampZoom(zoom, min = 0.03, max = 4) {
    return Math.min(max, Math.max(min, zoom));
  }

  function zoomAtPoint(view, point, factor, limits) {
    const nextZoom = clampZoom(
      view.zoom * factor,
      limits && limits.min,
      limits && limits.max
    );
    const ratio = nextZoom / view.zoom;
    return {
      panX: point.x - (point.x - view.panX) * ratio,
      panY: point.y - (point.y - view.panY) * ratio,
      zoom: nextZoom
    };
  }

  function viewportRects(view, viewport, options = {}) {
    const zoom = Math.max(0.0001, view.zoom);
    const worldW = Math.max(1, viewport.w) / zoom;
    const worldH = Math.max(1, viewport.h) / zoom;
    const x = -view.panX / zoom;
    const y = -view.panY / zoom;
    const mountMarginRatio = Number.isFinite(options.mountMarginRatio)
      ? Math.max(0, options.mountMarginRatio)
      : 0.3;
    const keepMarginRatio = Number.isFinite(options.keepMarginRatio)
      ? Math.max(mountMarginRatio, options.keepMarginRatio)
      : Math.max(1, mountMarginRatio);
    const mountMarginX = worldW * mountMarginRatio;
    const mountMarginY = worldH * mountMarginRatio;
    const keepMarginX = worldW * keepMarginRatio;
    const keepMarginY = worldH * keepMarginRatio;
    return {
      visible: { x, y, w: worldW, h: worldH },
      mount: {
        x: x - mountMarginX,
        y: y - mountMarginY,
        w: worldW + mountMarginX * 2,
        h: worldH + mountMarginY * 2
      },
      keep: {
        x: x - keepMarginX,
        y: y - keepMarginY,
        w: worldW + keepMarginX * 2,
        h: worldH + keepMarginY * 2
      }
    };
  }

  function resolveZoomLod(zoom, previous, thresholds = {}) {
    const overviewEnter = Number.isFinite(thresholds.overviewEnter)
      ? Math.max(0, thresholds.overviewEnter)
      : 0.1;
    const overviewExit = Math.max(
      overviewEnter,
      Number.isFinite(thresholds.overviewExit) ? thresholds.overviewExit : 0.14
    );
    const detailExit = Math.max(
      overviewExit,
      Number.isFinite(thresholds.detailExit) ? thresholds.detailExit : 0.38
    );
    const detailEnter = Math.max(
      detailExit,
      Number.isFinite(thresholds.detailEnter) ? thresholds.detailEnter : 0.46
    );
    const safeZoom = Number.isFinite(zoom) ? Math.max(0, zoom) : 1;

    if (previous === 'overview') {
      if (safeZoom <= overviewExit) return 'overview';
      return safeZoom >= detailEnter ? 'detail' : 'compact';
    }
    if (previous === 'detail') {
      if (safeZoom >= detailExit) return 'detail';
      return safeZoom <= overviewEnter ? 'overview' : 'compact';
    }
    if (previous === 'compact') {
      if (safeZoom <= overviewEnter) return 'overview';
      if (safeZoom >= detailEnter) return 'detail';
      return 'compact';
    }

    const thresholdEpsilon = 1e-12;
    if (safeZoom <= (overviewEnter + overviewExit) / 2 + thresholdEpsilon) return 'overview';
    if (safeZoom >= (detailExit + detailEnter) / 2 - thresholdEpsilon) return 'detail';
    return 'compact';
  }

  function isOverDomBudget(candidateCount, wasOverBudget = false, thresholds = {}) {
    const enter = Number.isFinite(thresholds.enter)
      ? Math.max(1, Math.floor(thresholds.enter))
      : 320;
    const exit = Math.min(
      enter,
      Number.isFinite(thresholds.exit) ? Math.max(0, Math.floor(thresholds.exit)) : 240
    );
    const count = Number.isFinite(candidateCount) ? Math.max(0, candidateCount) : 0;
    return wasOverBudget ? count > exit : count > enter;
  }

  function prioritizeIdsByViewport(ids, spatialIndex, visibleRect, limit = Infinity) {
    const normalizedLimit = Number.isFinite(limit)
      ? Math.max(0, Math.floor(limit))
      : Infinity;
    if (!normalizedLimit) return [];
    const centerX = visibleRect.x + visibleRect.w / 2;
    const centerY = visibleRect.y + visibleRect.h / 2;
    const getBounds = typeof spatialIndex === 'function'
      ? spatialIndex
      : (id) => spatialIndex && spatialIndex.getBounds(id);
    const candidates = [];

    for (const id of ids) {
      const bounds = getBounds(id);
      if (!bounds) continue;
      const itemCenterX = bounds.x + bounds.w / 2;
      const itemCenterY = bounds.y + bounds.h / 2;
      const dx = itemCenterX - centerX;
      const dy = itemCenterY - centerY;
      candidates.push({
        id,
        visibleRank: intersects(bounds, visibleRect) ? 0 : 1,
        distance: dx * dx + dy * dy
      });
    }

    candidates.sort((a, b) => (
      a.visibleRank - b.visibleRank ||
      a.distance - b.distance ||
      String(a.id).localeCompare(String(b.id))
    ));
    return candidates.slice(0, normalizedLimit).map((entry) => entry.id);
  }

  function hashSet(values) {
    let sum = 0;
    let xor = 0;
    for (const value of values) {
      const text = String(value);
      let itemHash = 2166136261;
      for (let i = 0; i < text.length; i += 1) {
        itemHash = Math.imul(itemHash ^ text.charCodeAt(i), 16777619);
      }
      itemHash ^= itemHash >>> 16;
      itemHash = Math.imul(itemHash, 0x7feb352d);
      itemHash ^= itemHash >>> 15;
      sum = (sum + itemHash) | 0;
      xor ^= ((itemHash << (itemHash & 15)) | (itemHash >>> (32 - (itemHash & 15))));
    }
    return `${values.size}:${sum >>> 0}:${xor >>> 0}`;
  }

  function parseAspectRatio(value, fallback = 1) {
    if (!value || value === 'auto') return fallback;
    const match = String(value).match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
    if (!match) return fallback;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!width || !height) return fallback;
    return width / height;
  }

  function fitAspectRatio(value, maxWidth = 300, maxHeight = 220) {
    const ratio = parseAspectRatio(value, 1);
    let width = maxWidth;
    let height = width / ratio;
    if (height > maxHeight) {
      height = maxHeight;
      width = height * ratio;
    }
    return {
      width: Math.max(80, Math.round(width)),
      height: Math.max(80, Math.round(height))
    };
  }

  function estimateRefreshRate(frameDeltas, minRate = 30, maxRate = 360) {
    const samples = frameDeltas
      .filter((delta) => Number.isFinite(delta) && delta > 1 && delta < 50)
      .sort((a, b) => a - b);
    if (!samples.length) return 60;
    const middle = Math.floor(samples.length / 2);
    const median = samples.length % 2
      ? samples[middle]
      : (samples[middle - 1] + samples[middle]) / 2;
    const measuredRate = Math.max(minRate, Math.min(maxRate, Math.round(1000 / median)));
    const commonRates = [30, 50, 60, 72, 75, 90, 100, 120, 144, 165, 180, 200, 240, 360];
    const nearestRate = commonRates.reduce((nearest, rate) => (
      Math.abs(rate - measuredRate) < Math.abs(nearest - measuredRate) ? rate : nearest
    ));
    return Math.abs(nearestRate - measuredRate) / nearestRate <= 0.04
      ? nearestRate
      : measuredRate;
  }

  function gridAroundCenter(count, itemSize, center, gap = 24) {
    const safeCount = Math.max(1, Math.min(4, Math.round(Number(count) || 1)));
    const columns = safeCount === 1 ? 1 : 2;
    const rows = Math.ceil(safeCount / columns);
    const totalWidth = columns * itemSize.width + (columns - 1) * gap;
    const totalHeight = rows * itemSize.height + (rows - 1) * gap;
    return Array.from({ length: safeCount }, (_, index) => ({
      x: Math.round(center.x - totalWidth / 2 + (index % columns) * (itemSize.width + gap)),
      y: Math.round(center.y - totalHeight / 2 + Math.floor(index / columns) * (itemSize.height + gap))
    }));
  }

  function packRows(items, options = {}) {
    if (!Array.isArray(items) || !items.length) return [];

    const gap = Number.isFinite(options.gap) ? Math.max(0, options.gap) : 12;
    const originX = Number.isFinite(options.originX)
      ? options.originX
      : Math.min(...items.map((item) => Number.isFinite(item.x) ? item.x : 0));
    const originY = Number.isFinite(options.originY)
      ? options.originY
      : Math.min(...items.map((item) => Number.isFinite(item.y) ? item.y : 0));
    const columns = Math.max(1, Math.min(
      items.length,
      Number.isFinite(options.columns)
        ? Math.floor(options.columns)
        : Math.ceil(Math.sqrt(items.length))
    ));
    const ordered = items.map((item, index) => ({
      ...item,
      _packIndex: index,
      width: Math.max(1, Number(item.width) || Number(item.w) || 1),
      height: Math.max(1, Number(item.height) || Number(item.h) || 1)
    })).sort((a, b) => (
      (Number(a.y) || 0) - (Number(b.y) || 0) ||
      (Number(a.x) || 0) - (Number(b.x) || 0) ||
      a._packIndex - b._packIndex
    ));

    const rows = [];
    for (let index = 0; index < ordered.length; index += columns) {
      const rowItems = ordered.slice(index, index + columns);
      rows.push({
        items: rowItems,
        width: rowItems.reduce((sum, item) => sum + item.width, 0) +
          Math.max(0, rowItems.length - 1) * gap,
        height: Math.max(...rowItems.map((item) => item.height))
      });
    }

    const layoutWidth = Math.max(...rows.map((row) => row.width));
    const packed = [];
    let cursorY = originY;
    for (const row of rows) {
      let cursorX = originX + (layoutWidth - row.width) / 2;
      for (const item of row.items) {
        packed.push({
          id: item.id,
          sourceIndex: item._packIndex,
          x: Math.round(cursorX),
          y: Math.round(cursorY + (row.height - item.height) / 2),
          width: item.width,
          height: item.height
        });
        cursorX += item.width + gap;
      }
      cursorY += row.height + gap;
    }
    return packed;
  }

  function packUniformGrid(items, options = {}) {
    if (!Array.isArray(items) || !items.length) return [];
    const gap = Number.isFinite(options.gap) ? Math.max(0, options.gap) : 20;
    const width = Math.max(1, Number(options.width) || 280);
    const height = Math.max(1, Number(options.height) || 168);
    const originX = Number.isFinite(options.originX)
      ? options.originX
      : Math.min(...items.map((item) => Number(item.x) || 0));
    const originY = Number.isFinite(options.originY)
      ? options.originY
      : Math.min(...items.map((item) => Number(item.y) || 0));
    const columns = Math.max(1, Math.min(
      items.length,
      Number.isFinite(options.columns)
        ? Math.floor(options.columns)
        : Math.max(1, Math.round(Math.sqrt(items.length * 1.5)))
    ));
    const ordered = items.map((item, index) => ({ ...item, _packIndex: index })).sort((a, b) => (
      (Number(a.y) || 0) - (Number(b.y) || 0) ||
      (Number(a.x) || 0) - (Number(b.x) || 0) ||
      a._packIndex - b._packIndex
    ));
    return ordered.map((item, index) => ({
      id: item.id,
      sourceIndex: item._packIndex,
      x: Math.round(originX + (index % columns) * (width + gap)),
      y: Math.round(originY + Math.floor(index / columns) * (height + gap)),
      width,
      height
    }));
  }

  return {
    createSpatialIndex,
    clampZoom,
    zoomAtPoint,
    viewportRects,
    resolveZoomLod,
    isOverDomBudget,
    prioritizeIdsByViewport,
    hashSet,
    intersects,
    parseAspectRatio,
    fitAspectRatio,
    estimateRefreshRate,
    gridAroundCenter,
    packRows,
    packUniformGrid
  };
});
