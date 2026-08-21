'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const electronPath = require('electron');
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const result = spawnSync(electronPath, [path.join(__dirname, 'test-butler-expand-canvas-visual-runner.js')], {
  cwd: path.join(__dirname, '..'),
  env: environment,
  encoding: 'utf8',
  timeout: 30_000,
  windowsHide: true
});

if (result.error) throw result.error;
assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
assert.match(result.stdout, /BUTLER_EXPAND_CANVAS_OK editor=\d+x\d+ dragged=\d+ ratio=16:9 colors=\d+/);
process.stdout.write(`Butler canvas expansion visual test passed (${result.stdout.trim()}).\n`);
