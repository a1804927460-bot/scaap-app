const path = require('node:path');
const fs = require('node:fs');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
fs.writeFileSync(path.join(root, 'src/vendor/canvas-plugins-LICENSE.txt'), [
  'leafer-x-richText: https://github.com/ZhengNan-coder/leafer-x-richText\nCommit 22fee19638c7f84f0a00d51a10311871621daf7e; upstream declares MIT in package.json and README.\n',
  ...['third-party/package/LICENSE', 'node_modules/leafer-x-webfont/LICENSE', 'node_modules/webfont-sdk/LICENSE'].map(file => fs.readFileSync(path.join(root, file), 'utf8')),
].join('\n\n'));
esbuild.build({
  stdin: {
    contents: `export { RichText } from './third-party/leafer-x-richtext/src/richtext/RichText.ts';
      export { Snap } from './third-party/package/src/snap.ts';`,
    resolveDir: root,
  },
  bundle: true, format: 'iife', globalName: 'MesssCanvasPlugins', platform: 'browser',
  target: 'chrome140', minify: true,
  tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } },
  outfile: path.join(root, 'src/vendor/canvas-plugins.js'),
  plugins: [{ name: 'existing-leafer', setup(build) {
    build.onResolve({ filter: /^(leafer-ui|@leafer-ui\/core|@leafer\/core)$/ }, () => ({ path: 'leafer', namespace: 'shared' }));
    build.onLoad({ filter: /.*/, namespace: 'shared' }, () => ({ contents: 'module.exports = globalThis.LeaferUI;', loader: 'js' }));
  } }],
}).then(() => esbuild.build({
  stdin: { contents: "export { WebFontPlugin } from 'leafer-x-webfont';", resolveDir: root },
  bundle: true, format: 'iife', globalName: 'MesssWebFont', platform: 'browser',
  target: 'chrome140', minify: true, outfile: path.join(root, 'src/vendor/canvas-webfont.js'),
})).catch(error => { console.error(error); process.exitCode = 1; });
