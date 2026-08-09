'use strict';

const assert = require('assert');
const { performance } = require('perf_hooks');
const BoardEngine = require('../src/js/board-engine');

const ITEM_COUNT = 50_000;
const VIEW_SWEEPS = 720;
const UPDATE_COUNT = 5_000;
const DOM_LIMIT = 320;
const index = BoardEngine.createSpatialIndex(400);
const ids = new Array(ITEM_COUNT);
const sizes = [
  [160, 90],
  [220, 220],
  [320, 180],
  [420, 560],
  [640, 360],
  [960, 540]
];

const heapBefore = process.memoryUsage().heapUsed;
const startedAt = performance.now();

for (let indexValue = 0; indexValue < ITEM_COUNT; indexValue += 1) {
  const id = `stress_${indexValue}`;
  const [width, height] = sizes[indexValue % sizes.length];
  const column = indexValue % 250;
  const row = Math.floor(indexValue / 250);
  ids[indexValue] = id;
  index.set(id, {
    x: column * 340 + (row % 3) * 13,
    y: row * 280 + (column % 5) * 9,
    w: width,
    h: height
  });
}

const buildFinishedAt = performance.now();
let totalVisible = 0;
let overviewFrames = 0;
let densityOverview = false;

for (let frame = 0; frame < VIEW_SWEEPS; frame += 1) {
  const zoom = [0.08, 0.12, 0.25, 0.62, 1, 1.8, 2.4][frame % 7];
  const view = {
    panX: -((frame * 977) % 72_000) * zoom,
    panY: -((frame * 431) % 48_000) * zoom,
    zoom
  };
  const regions = BoardEngine.viewportRects(view, { w: 1920, h: 1080 }, {
    mountMarginRatio: 0.45,
    keepMarginRatio: 1
  });
  const count = index.count(regions.mount, densityOverview ? 241 : 321);
  densityOverview = BoardEngine.isOverDomBudget(count, densityOverview, { enter: 320, exit: 240 });
  if (densityOverview) overviewFrames += 1;

  const mountIds = index.queryLimited(regions.mount, DOM_LIMIT);
  const prioritized = BoardEngine.prioritizeIdsByViewport(mountIds, index, regions.visible, DOM_LIMIT);
  assert.ok(prioritized.length <= DOM_LIMIT);
  assert.strictEqual(new Set(prioritized).size, prioritized.length);
  totalVisible += index.count(regions.visible, ITEM_COUNT);
}

const queryFinishedAt = performance.now();
for (let updateIndex = 0; updateIndex < UPDATE_COUNT; updateIndex += 1) {
  const numericId = (updateIndex * 37) % ITEM_COUNT;
  const id = ids[numericId];
  const previous = index.getBounds(id);
  assert.ok(previous);
  index.set(id, {
    x: previous.x + 17,
    y: previous.y - 11,
    w: previous.w,
    h: previous.h
  });
}
const finishedAt = performance.now();

assert.strictEqual(index.size, ITEM_COUNT);
assert.ok(totalVisible > 0);
assert.ok(overviewFrames > 0);

const heapAfter = process.memoryUsage().heapUsed;
const totalMs = finishedAt - startedAt;
const heapDeltaMb = Math.max(0, heapAfter - heapBefore) / 1024 / 1024;
assert.ok(totalMs < 15_000, `Canvas stress test exceeded 15s: ${totalMs.toFixed(1)}ms`);
assert.ok(heapDeltaMb < 384, `Canvas stress test exceeded 384MB heap growth: ${heapDeltaMb.toFixed(1)}MB`);

process.stdout.write([
  'Canvas stress test passed.',
  `items=${ITEM_COUNT}`,
  `build=${(buildFinishedAt - startedAt).toFixed(1)}ms`,
  `queries=${(queryFinishedAt - buildFinishedAt).toFixed(1)}ms`,
  `updates=${(finishedAt - queryFinishedAt).toFixed(1)}ms`,
  `total=${totalMs.toFixed(1)}ms`,
  `heapDelta=${heapDeltaMb.toFixed(1)}MB`,
  `overviewFrames=${overviewFrames}/${VIEW_SWEEPS}`
].join(' ') + '\n');
