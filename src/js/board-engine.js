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

    function query(rect) {
      const candidates = new Set();
      forEachCell(rect, (key) => {
        const bucket = grid.get(key);
        if (bucket) bucket.forEach((id) => candidates.add(id));
      });
      for (const id of [...candidates]) {
        const bounds = boundsById.get(id);
        if (!bounds || !intersects(bounds, rect)) candidates.delete(id);
      }
      return candidates;
    }

    function clear() {
      grid.clear();
      boundsById.clear();
    }

    return {
      set,
      remove,
      query,
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

  function viewportRects(view, viewport) {
    const zoom = Math.max(0.0001, view.zoom);
    const worldW = Math.max(1, viewport.w) / zoom;
    const worldH = Math.max(1, viewport.h) / zoom;
    const x = -view.panX / zoom;
    const y = -view.panY / zoom;
    const mountMargin = Math.max(worldW, worldH) * 0.3;
    return {
      visible: { x, y, w: worldW, h: worldH },
      mount: {
        x: x - mountMargin,
        y: y - mountMargin,
        w: worldW + mountMargin * 2,
        h: worldH + mountMargin * 2
      },
      keep: {
        x: x - worldW,
        y: y - worldH,
        w: worldW * 3,
        h: worldH * 3
      }
    };
  }

  function hashSet(values) {
    let hash = values.size | 0;
    for (const value of values) {
      const text = String(value);
      let itemHash = 0;
      for (let i = 0; i < text.length; i += 1) {
        itemHash = (Math.imul(itemHash, 31) + text.charCodeAt(i)) | 0;
      }
      hash = (hash + itemHash) | 0;
    }
    return hash;
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

  return {
    createSpatialIndex,
    clampZoom,
    zoomAtPoint,
    viewportRects,
    hashSet,
    intersects,
    parseAspectRatio,
    fitAspectRatio,
    estimateRefreshRate,
    gridAroundCenter
  };
});
