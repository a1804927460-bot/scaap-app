const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
fs.copyFileSync(path.join(root, 'node_modules/leafer-x-clip-resize-inner-editor/LICENSE'), path.join(root, 'src/vendor/canvas-crop-LICENSE.txt'));
require('esbuild').build({
  stdin: { contents: "export { App, PropertyEvent } from 'leafer-ui'; import '@leafer-in/export'; export { ClipImage, ClipResizeEditor } from 'leafer-x-clip-resize-inner-editor';", resolveDir: root },
  bundle: true, format: 'iife', globalName: 'MesssCanvasCrop', platform: 'browser',
  target: 'chrome140', minify: true, outfile: path.join(root, 'src/vendor/canvas-crop.js'),
  plugins: [{ name: 'single-draw-runtime', setup(build) {
    build.onResolve({ filter: /^@leafer-ui\/draw$/ }, () => ({ path: require.resolve('@leafer-ui/draw', { paths: [path.dirname(require.resolve('leafer-ui'))] }).replace('.min.cjs', '.esm.min.js') }));
  } }],
}).catch(error => { console.error(error); process.exitCode = 1; });
