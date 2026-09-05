'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const storeSource = fs.readFileSync(path.join(root, 'src', 'js', 'store-client.js'), 'utf8');
const foldersSource = fs.readFileSync(path.join(root, 'src', 'js', 'folders.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const preloadSource = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');

assert.match(storeSource, /function fileActivityTimestamp\(file\)/);
assert.match(storeSource, /function compareFilesByActivity\(left, right\)/);
assert.match(storeSource, /const sorted = \[\.\.\.files\]\.sort\(compareFilesByActivity\)/);
assert.match(foldersSource, /return filterFilesByActiveDateFolder\(files\)\.sort\(compareFilesByActivity\)/);
assert.match(mainSource, /lastDownloadedAt: f\.lastDownloadedAt \|\| null/);
assert.match(mainSource, /f\.lastDownloadedAt = new Date\(\)\.toISOString\(\)/);
assert.match(mainSource, /broadcastRendererEvent\('files:changed', \{ file \}\)/);
assert.match(mainSource, /matches[\s\S]*?\.sort\(\(left, right\) =>/);
assert.match(preloadSource, /onFilesChanged: \(callback\) =>/);

const sandbox = {
  Date,
  Number,
  String,
  document: { documentElement: { dataset: { language: 'en' } } },
  window: {},
  result: null
};
vm.runInNewContext(`${storeSource}
result = [
  { id: 'imported-new', importedAt: '2026-09-05T09:00:00.000Z' },
  { id: 'downloaded-old', importedAt: '2026-09-01T09:00:00.000Z', lastDownloadedAt: '2026-09-05T10:00:00.000Z' },
  { id: 'imported-old', importedAt: '2026-09-01T08:00:00.000Z' }
].sort(compareFilesByActivity).map((file) => file.id);`, sandbox);
assert.deepEqual(sandbox.result, ['downloaded-old', 'imported-new', 'imported-old']);

const secondSandbox = {
  Date,
  Number,
  String,
  document: { documentElement: { dataset: { language: 'en' } } },
  window: {},
  result: null
};
vm.runInNewContext(`${storeSource}
result = Array.from(groupFilesByDay([
  { id: 'old-day', importedAt: '2026-09-01T08:00:00.000Z', lastDownloadedAt: '2026-09-05T11:00:00.000Z' },
  { id: 'new-day', importedAt: '2026-09-05T09:00:00.000Z' }
]));`, secondSandbox);
assert.deepEqual(secondSandbox.result.map(([day, files]) => [day, files.map((file) => file.id)]), [
  ['2026-09-01', ['old-day']],
  ['2026-09-05', ['new-day']]
], 'Downloads must reorder files without moving them to a different import-date group.');

process.stdout.write('File download ordering tests passed.\n');
