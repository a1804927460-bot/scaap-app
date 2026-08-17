'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const electronPath = require('electron');
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

const result = spawnSync(electronPath, [path.join(__dirname, 'test-screenshot-runtime-runner.js')], {
  cwd: path.join(__dirname, '..'),
  env: environment,
  encoding: 'utf8',
  timeout: 40_000,
  windowsHide: true
});

if (result.error) throw result.error;
assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
assert.match(result.stdout, /SCREENSHOT_RUNTIME_OK first=\d+ms second=\d+ms reused=true/);
process.stdout.write(`${result.stdout.trim()}\n`);
