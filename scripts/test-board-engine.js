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

for (const refreshRate of [60, 120, 144, 240]) {
  const deltas = Array(90).fill(1000 / refreshRate);
  assert.strictEqual(engine.estimateRefreshRate(deltas), refreshRate);
}
assert.strictEqual(
  engine.estimateRefreshRate([1000 / 144, 1000 / 144, 32, 1000 / 144]),
  144
);
assert.strictEqual(engine.estimateRefreshRate(Array(90).fill(1000 / 238)), 240);

process.stdout.write('Board engine tests passed.\n');
