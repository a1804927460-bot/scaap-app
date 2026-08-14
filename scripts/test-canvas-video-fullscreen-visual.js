'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const electronPath = require('electron');
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const result = spawnSync(electronPath, [path.join(__dirname, 'test-canvas-video-fullscreen-visual-runner.js')], {
  cwd: path.join(__dirname, '..'),
  env: environment,
  encoding: 'utf8',
  timeout: 20_000,
  windowsHide: true
});

if (result.error) throw result.error;
assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
assert.match(result.stdout, /CANVAS_VIDEO_FULLSCREEN_OK toolbar=\d+ player=\d+x\d+ played=\d+\.\d+/);
process.stdout.write(`Canvas video fullscreen visual test passed (${result.stdout.trim()}).\n`);
