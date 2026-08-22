'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src', 'js', 'file-drop.js'), 'utf8');
const context = { window: { messsAPI: { getPathForFile: () => { throw new Error('macOS webUtils fallback'); } } } };
vm.runInNewContext(source, context);

const finderFile = {
  name: '参考图.png', size: 42, lastModified: 7, type: 'image/png',
  path: '/Users/test/Pictures/参考图.png'
};
const entries = context.window.MesssFileDrop.entries({
  items: [],
  files: [finderFile]
});
assert.strictEqual(entries.length, 1);
assert.strictEqual(String(entries[0].path), '/Users/test/Pictures/参考图.png');

const second = { name: 'video.mp4', size: 84, lastModified: 8, type: 'video/mp4', path: '/Users/test/Movies/video.mp4' };
const item = { kind: 'file', getAsFile: () => second, webkitGetAsEntry: () => ({ isDirectory: false }) };
const merged = context.window.MesssFileDrop.entries({ items: [item], files: [second] });
assert.strictEqual(merged.length, 1, 'items and files must not duplicate one Finder drop');
assert.strictEqual(merged[0].path, '/Users/test/Movies/video.mp4');

process.stdout.write('File drop compatibility tests passed.\n');
