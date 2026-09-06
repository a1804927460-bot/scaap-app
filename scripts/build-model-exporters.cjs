'use strict';
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(root, 'vendor/model-exporters'), { recursive: true });
fs.copyFileSync(path.join(root, 'node_modules/three/LICENSE'), path.join(root, 'vendor/model-exporters/LICENSE'));
require('esbuild').build({
  stdin: { contents: "export { OBJExporter } from 'three/addons/exporters/OBJExporter.js'; export { STLExporter } from 'three/addons/exporters/STLExporter.js';", resolveDir: root },
  bundle: true, platform: 'node', format: 'cjs', target: 'node22',
  plugins: [{ name: 'external-three-core-only', setup(build) {
    build.onResolve({ filter: /^three$/ }, () => ({ path: 'three', external: true }));
  } }],
  outfile: path.join(root, 'vendor/model-exporters/index.cjs')
}).catch(error => { console.error(error); process.exitCode = 1; });
