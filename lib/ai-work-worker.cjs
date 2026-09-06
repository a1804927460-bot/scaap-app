const { parentPort, workerData } = require('node:worker_threads');
const { getQuickJS } = require('quickjs-emscripten');
(async () => {
  const engine = await getQuickJS();
  const runtime = engine.newRuntime();
  runtime.setMemoryLimit(32 * 1024 * 1024);
  runtime.setMaxStackSize(512 * 1024);
  const deadline = Date.now() + 4000;
  runtime.setInterruptHandler(() => Date.now() > deadline);
  const vm = runtime.newContext();
  try {
    const source = `const uploads = ${JSON.stringify(workerData.uploads)};\n` +
      `const output = (function(){"use strict";\n${workerData.code}\n})();\n` +
      'const encoded = JSON.stringify(output); if (!encoded || encoded.length > 4000000) throw new Error("Output exceeds limit"); encoded;';
    const result = vm.evalCode(source, 'messs-work.js');
    if (result.error) { const error = vm.dump(result.error); result.error.dispose(); throw new Error(error.message || 'Execution failed'); }
    const output = vm.getString(result.value); result.value.dispose();
    parentPort.postMessage({ ok: true, output: JSON.parse(output) });
  } finally { vm.dispose(); runtime.dispose(); }
})().catch(error => parentPort.postMessage({ ok: false, message: String(error.message).slice(0, 1000) }));
