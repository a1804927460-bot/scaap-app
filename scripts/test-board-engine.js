'use strict';

const assert = require('assert');
const engine = require('../src/js/board-engine');

assert.strictEqual(engine.parseAspectRatio('16:9'), 16 / 9);
assert.strictEqual(engine.parseAspectRatio('auto'), 1);
assert.deepStrictEqual(engine.fitAspectRatio('1:1', 300, 220), { width: 220, height: 220 });
assert.deepStrictEqual(engine.fitAspectRatio('16:9', 300, 220), { width: 300, height: 169 });

const positions = engine.gridAroundCenter(4, { width: 100, height: 80 }, { x: 0, y: 0 }, 20);
assert.deepStrictEqual(positions, [
  { x: -110, y: -90 },
  { x: 10, y: -90 },
  { x: -110, y: 10 },
  { x: 10, y: 10 }
]);

const mixedMediaLayout = engine.packRows([
  { id: 'portrait', x: 0, y: 0, width: 100, height: 200 },
  { id: 'landscape', x: 200, y: 0, width: 300, height: 100 },
  { id: 'square', x: 0, y: 300, width: 150, height: 150 },
  { id: 'tall-video', x: 200, y: 300, width: 50, height: 250 }
], { gap: 10, columns: 2 });
assert.deepStrictEqual(mixedMediaLayout.map(({ id, x, y }) => ({ id, x, y })), [
  { id: 'portrait', x: 0, y: 0 },
  { id: 'landscape', x: 110, y: 50 },
  { id: 'square', x: 100, y: 260 },
  { id: 'tall-video', x: 260, y: 210 }
]);
assert.strictEqual(
  mixedMediaLayout[1].x - (mixedMediaLayout[0].x + mixedMediaLayout[0].width),
  10
);
assert.strictEqual(
  mixedMediaLayout[3].x - (mixedMediaLayout[2].x + mixedMediaLayout[2].width),
  10
);

const compactMediaLayout = engine.compactMediaGrid([
  { id: 'small', x: 0, y: 0, width: 100, height: 200 },
  { id: 'wide', x: 200, y: 0, width: 400, height: 200 },
  { id: 'portrait', x: 0, y: 300, width: 200, height: 500 },
  { id: 'square', x: 300, y: 300, width: 100, height: 100 }
], { originX: 0, originY: 0, gap: 12, columns: 2 });
assert.deepStrictEqual(compactMediaLayout.map(({ id, x, y, width, height }) => ({ id, x, y, width, height })), [
  { id: 'small', x: 0, y: 0, width: 100, height: 200 },
  { id: 'wide', x: 112, y: 75, width: 100, height: 50 },
  { id: 'portrait', x: 0, y: 212, width: 100, height: 250 },
  { id: 'square', x: 112, y: 287, width: 100, height: 100 }
]);
assert.strictEqual(Math.min(...compactMediaLayout.map((item) => item.width)), 100);
assert.ok(compactMediaLayout.every((item) => item.width === 100), 'compact media must use the smallest selected width');

const compactRectangularLayout = engine.compactMediaGrid([
  { id: 'one', x: 0, y: 0, width: 100, height: 100 },
  { id: 'two', x: 100, y: 0, width: 100, height: 100 },
  { id: 'three', x: 200, y: 0, width: 100, height: 100 },
  { id: 'four', x: 300, y: 0, width: 100, height: 100 }
], { originX: 0, originY: 0, gap: 12 });
assert.strictEqual(new Set(compactRectangularLayout.map((item) => item.x)).size, 2);
assert.strictEqual(new Set(compactRectangularLayout.map((item) => item.y)).size, 2);

const shortLastRow = engine.packRows([
  { id: 'c', x: 0, y: 100, width: 80, height: 80 },
  { id: 'b', x: 100, y: 0, width: 80, height: 80 },
  { id: 'a', x: 0, y: 0, width: 80, height: 80 }
], { gap: 12, columns: 2, originX: 20, originY: 30 });
assert.deepStrictEqual(shortLastRow.map(({ id, x, y }) => ({ id, x, y })), [
  { id: 'a', x: 20, y: 30 },
  { id: 'b', x: 112, y: 30 },
  { id: 'c', x: 66, y: 122 }
]);

const uniformGrid = engine.packUniformGrid([
  { id: 'wide', x: 200, y: 0, width: 900, height: 200 },
  { id: 'tiny', x: 0, y: 0, width: 40, height: 90 },
  { id: 'portrait', x: 0, y: 300, width: 100, height: 500 },
  { id: 'square', x: 300, y: 300, width: 240, height: 240 }
], { originX: 10, originY: 20, width: 280, height: 168, gap: 20, columns: 2 });
assert.deepStrictEqual(uniformGrid.map(({ id, x, y, width, height }) => ({ id, x, y, width, height })), [
  { id: 'tiny', x: 10, y: 20, width: 280, height: 168 },
  { id: 'wide', x: 310, y: 20, width: 280, height: 168 },
  { id: 'portrait', x: 10, y: 208, width: 280, height: 168 },
  { id: 'square', x: 310, y: 208, width: 280, height: 168 }
]);

for (const refreshRate of [60, 120, 144, 240]) {
  const deltas = Array(90).fill(1000 / refreshRate);
  assert.strictEqual(engine.estimateRefreshRate(deltas), refreshRate);
}
assert.strictEqual(
  engine.estimateRefreshRate([1000 / 144, 1000 / 144, 32, 1000 / 144]),
  144
);
assert.strictEqual(engine.estimateRefreshRate(Array(90).fill(1000 / 238)), 240);

const bufferedViewport = engine.viewportRects(
  { panX: -400, panY: -200, zoom: 2 },
  { w: 1000, h: 600 },
  { mountMarginRatio: 0.5, keepMarginRatio: 1 }
);
assert.deepStrictEqual(bufferedViewport, {
  visible: { x: 200, y: 100, w: 500, h: 300 },
  mount: { x: -50, y: -50, w: 1000, h: 600 },
  keep: { x: -300, y: -200, w: 1500, h: 900 }
});
assert.strictEqual(engine.intersects(
  { x: -40, y: 0, w: 20, h: 20 },
  bufferedViewport.mount
), true);
assert.strictEqual(engine.intersects(
  { x: -280, y: 0, w: 20, h: 20 },
  bufferedViewport.mount
), false);
assert.strictEqual(engine.intersects(
  { x: -280, y: 0, w: 20, h: 20 },
  bufferedViewport.keep
), true);

// LOD thresholds have separate enter/exit points, so small zoom jitter does
// not repeatedly rebuild the mounted item set.
assert.strictEqual(engine.resolveZoomLod(0.09, 'compact'), 'overview');
assert.strictEqual(engine.resolveZoomLod(0.13, 'overview'), 'overview');
assert.strictEqual(engine.resolveZoomLod(0.15, 'overview'), 'compact');
assert.strictEqual(engine.resolveZoomLod(0.4, 'detail'), 'detail');
assert.strictEqual(engine.resolveZoomLod(0.37, 'detail'), 'compact');
assert.strictEqual(engine.resolveZoomLod(0.4, 'compact'), 'compact');
assert.strictEqual(engine.resolveZoomLod(0.47, 'compact'), 'detail');
assert.strictEqual(engine.resolveZoomLod(0.12), 'overview');
assert.strictEqual(engine.resolveZoomLod(0.3), 'compact');
assert.strictEqual(engine.resolveZoomLod(0.42), 'detail');

assert.strictEqual(engine.isOverDomBudget(320, false), false);
assert.strictEqual(engine.isOverDomBudget(321, false), true);
assert.strictEqual(engine.isOverDomBudget(241, true), true);
assert.strictEqual(engine.isOverDomBudget(240, true), false);

const largeIndex = engine.createSpatialIndex(256);
const largeIds = [];
for (let row = 0; row < 100; row += 1) {
  for (let column = 0; column < 100; column += 1) {
    const id = `grid_${column}_${row}`;
    largeIds.push(id);
    largeIndex.set(id, {
      x: column * 120,
      y: row * 120,
      w: 100,
      h: 100
    });
  }
}
assert.strictEqual(largeIndex.size, 10000);
assert.strictEqual(largeIndex.query({ x: 1200, y: 2400, w: 960, h: 720 }).size, 48);
assert.strictEqual(largeIndex.count({ x: 0, y: 0, w: 12000, h: 12000 }, 321), 321);
assert.strictEqual(largeIndex.queryLimited(
  { x: 0, y: 0, w: 12000, h: 12000 },
  320
).size, 320);

const domCandidates = engine.prioritizeIdsByViewport(
  largeIds,
  largeIndex,
  { x: 0, y: 0, w: 1200, h: 1200 },
  320
);
assert.strictEqual(domCandidates.length, 320);
assert.strictEqual(new Set(domCandidates).size, 320);
assert.strictEqual(domCandidates[0], 'grid_5_5');
assert.ok(domCandidates.includes('grid_0_0'));
assert.ok(!domCandidates.includes('grid_99_99'));

largeIndex.remove('grid_10_20');
assert.strictEqual(largeIndex.query({ x: 1200, y: 2400, w: 100, h: 100 }).size, 0);
largeIndex.set('grid_10_20', { x: -500, y: -500, w: 100, h: 100 });
assert.strictEqual(largeIndex.query({ x: -510, y: -510, w: 120, h: 120 }).has('grid_10_20'), true);

// A stronger order-independent set fingerprint avoids stale virtualization
// state for same-sized sets whose simple character sums collide.
assert.strictEqual(
  engine.hashSet(new Set(['grid_1_2', 'grid_2_1'])),
  engine.hashSet(new Set(['grid_2_1', 'grid_1_2']))
);
assert.notStrictEqual(
  engine.hashSet(new Set(['0', '3'])),
  engine.hashSet(new Set(['1', '2']))
);

process.stdout.write('Board engine tests passed.\n');
