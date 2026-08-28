'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const electronPath = require('electron');
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const result = spawnSync(electronPath, [path.join(__dirname, 'test-moodboard-visual-runner.js')], {
  cwd: path.join(__dirname, '..'),
  env: environment,
  encoding: 'utf8',
  timeout: 30_000,
  windowsHide: true
});

if (result.error) throw result.error;
assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
assert.match(result.stdout, /MOODBOARD_VISUAL_OK node=\d+x\d+ panel=\d+x\d+ editor=\d+x\d+ suggestion=\d+x\d+/);
process.stdout.write(`Text moodboard visual test passed (${result.stdout.trim()}).\n`);
