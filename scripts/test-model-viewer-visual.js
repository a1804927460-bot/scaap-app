'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const electronPath = require('electron');
const runnerPath = path.join(__dirname, 'test-model-viewer-visual-runner.js');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync(electronPath, [runnerPath], {
  cwd: path.join(__dirname, '..'),
  env,
  encoding: 'utf8',
  timeout: 45000,
  windowsHide: true
});

if (result.error) throw result.error;
assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
const verificationPattern = process.env.MESSS_MODEL_VIEWER_ONLY === '1'
  ? (process.env.MESSS_MODEL_VIEWER_GLB_PATH
      ? /MODEL_VIEWER_REAL_PBR_OK desktop=\d+ colors=\d+ thumbnailColors=\d+ textures=\{[^\n]+\}/
      : /MODEL_VIEWER_PBR_OK desktop=\d+ colors=\d+ compact=\d+ textures=\{[^\n]+\}/)
  : /MODEL_VIEWER_VISUAL_OK desktop=\d+ compact=\d+ rotation=[\d.]+ light=[\d.]+ previews=\d+,\d+,\d+ fbx=\d+ obj=\d+/;
const verification = result.stdout.match(verificationPattern);
assert(verification, result.stdout || result.stderr);
process.stdout.write(`Model-viewer visual interaction test passed (${verification[0]}).\n`);
