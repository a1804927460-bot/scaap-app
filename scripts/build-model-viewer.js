'use strict';

const path = require('path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');

esbuild.build({
  entryPoints: [path.join(root, 'src', 'vendor', 'model-viewer.entry.js')],
  outfile: path.join(root, 'src', 'vendor', 'model-viewer.bundle.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome120'],
  legalComments: 'none',
  minify: true,
  sourcemap: false
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
