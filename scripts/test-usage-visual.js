'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const electronPath = require('electron');
const runnerPath = path.join(__dirname, 'test-usage-visual-runner.js');
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const result = spawnSync(electronPath, [runnerPath], {
  cwd: path.join(__dirname, '..'),
  env: environment,
  encoding: 'utf8',
  timeout: 30_000,
  windowsHide: true
});

if (result.error) throw result.error;
assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
assert.match(result.stdout, /USAGE_VISUAL_OK desktop=\d+x\d+ compact=\d+x\d+/);
process.stdout.write(`Usage visual test passed (${result.stdout.trim()}).\n`);
