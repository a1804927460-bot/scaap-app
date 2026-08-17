'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  normalizeColorProfile,
  chromiumColorProfile,
  colorProfileBootstrapPath,
  readColorProfileBootstrap,
  writeColorProfileBootstrapSync
} = require('../lib/color-management');

const root = path.join(__dirname, '..');
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const preloadSource = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const sidebarSource = fs.readFileSync(path.join(root, 'src', 'js', 'sidebar.js'), 'utf8');
const packageData = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

assert.deepStrictEqual(
  ['auto', 'srgb', 'display-p3'].map(normalizeColorProfile),
  ['auto', 'srgb', 'display-p3']
);
for (const invalid of ['', null, 'P3', 'display_p3', 'hdr10']) {
  assert.strictEqual(normalizeColorProfile(invalid), 'auto');
}
assert.strictEqual(chromiumColorProfile('auto'), null);
assert.strictEqual(chromiumColorProfile('srgb'), 'srgb');
assert.strictEqual(chromiumColorProfile('display-p3'), 'display-p3-d65');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'messs-color-profile-'));
try {
  const bootstrapPath = colorProfileBootstrapPath(tempRoot);
  assert.deepStrictEqual(readColorProfileBootstrap(bootstrapPath), { profile: 'auto', valid: false });
  writeColorProfileBootstrapSync(bootstrapPath, 'display-p3');
  assert.deepStrictEqual(readColorProfileBootstrap(bootstrapPath), { profile: 'display-p3', valid: true });
  fs.writeFileSync(bootstrapPath, '{not json', 'utf8');
  assert.deepStrictEqual(readColorProfileBootstrap(bootstrapPath), { profile: 'auto', valid: false });
  fs.writeFileSync(bootstrapPath, JSON.stringify({ colorProfile: 'hdr10' }), 'utf8');
  assert.deepStrictEqual(readColorProfileBootstrap(bootstrapPath), { profile: 'auto', valid: false });
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

assert.match(mainSource, /force-color-profile/);
assert.strictEqual(chromiumColorProfile('display-p3'), 'display-p3-d65');
assert.match(mainSource, /settings:setColorProfile/);
assert.match(mainSource, /settings:restartForColorProfile/);
assert.match(mainSource, /restartRequired:\s*profile !== startupColorProfile/);
assert.match(preloadSource, /setColorProfile[\s\S]*settings:setColorProfile/);
assert.match(preloadSource, /restartForColorProfile[\s\S]*settings:restartForColorProfile/);
assert.match(indexSource, /data-color-profile="auto"/);
assert.match(indexSource, /data-color-profile="srgb"/);
assert.match(indexSource, /data-color-profile="display-p3"/);
assert.match(sidebarSource, /matchMedia\('\(color-gamut: p3\)'\)/);
assert.match(sidebarSource, /This display does not report Display P3 support/);
assert.strictEqual((packageData.scripts.test.match(/node scripts\/test-color-management\.js/g) || []).length, 1);

console.log('Color management tests passed.');
