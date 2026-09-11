const path = require('node:path');
const root = path.resolve(__dirname, '..');
require('node:fs').copyFileSync(path.join(root, 'node_modules/motion/LICENSE.md'), path.join(root, 'src/vendor/ui-motion-LICENSE.txt'));
require('esbuild').build({
  stdin: { contents: "export { animate } from 'motion/mini'; export { spring } from 'motion';", resolveDir: root },
  bundle: true, format: 'iife', globalName: 'MesssMotionRuntime', platform: 'browser',
  target: 'chrome140', minify: true, outfile: path.join(root, 'src/vendor/ui-motion.js')
}).catch(error => { console.error(error); process.exitCode = 1; });
