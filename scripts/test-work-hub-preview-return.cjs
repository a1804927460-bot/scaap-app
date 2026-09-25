'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const preview = fs.readFileSync(path.join(root, 'src', 'js', 'preview-canvas.js'), 'utf8');
const hub = fs.readFileSync(path.join(root, 'src', 'js', 'work-hub.js'), 'utf8');
const motion = fs.readFileSync(path.join(root, 'src', 'styles', 'ui-motion.css'), 'utf8');

assert.match(
  preview,
  /function closeFullscreenPreview\(\)[\s\S]*?__messsPreviewReturnToFiles[\s\S]*?finalizeFullscreenPreviewClose\(\);[\s\S]*?return;[\s\S]*?classList\.add\('is-closing'\)/,
  'Returning to Files must finalize before the fullscreen fade can expose the canvas.'
);
assert.match(
  preview,
  /MesssWorkHub\.open\('files', \{ restoreFromPreview: true \}\)/,
  'Fullscreen cleanup must identify the preview return when reopening Files.'
);
assert.match(
  hub,
  /async function open\(next='schedule', options=\{\}\)[\s\S]*?options\.restoreFromPreview === true\)root\.classList\.add\('is-preview-return'\)[\s\S]*?root\.showModal\(\)/,
  'The work hub must suppress its entrance before becoming modal.'
);
assert.match(
  hub,
  /addEventListener\('close',[\s\S]*?classList\.remove\('is-preview-return'\)/,
  'The no-flash return marker should remain stable until the work hub closes.'
);
assert.match(
  motion,
  /\.work-hub\.is-preview-return\[open\]\s*\{\s*animation: none;/,
  'The restored Files dialog must not fade in over the canvas.'
);

process.stdout.write('Work hub fullscreen return tests passed.\n');
