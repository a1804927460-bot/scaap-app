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
    // Accept a whole anonymous function as well as the documented function body.
    // Invocation remains inside QuickJS with the same memory/time limits.
    let code = workerData.code.trim();
    const fenced = /^```(?:javascript|js)?\s*\n([\s\S]*?)\n```$/.exec(code);
    if (fenced) code = fenced[1].trim();
    if (/^function\s*\(/.test(code)) {
      code = 'return (' + code.replace(/;\s*$/, '') + ')(uploads);';
    }
    const source = `const uploads = ${JSON.stringify(workerData.uploads)};\n` +
      `const output = (function(){"use strict";\n${code}\n})();\n` +
      'const encoded = JSON.stringify(output); if (!encoded) throw new Error("Empty output"); if (encoded.length > 4000000) throw new Error("MESSS_WORK_OUTPUT_LIMIT"); encoded;';
    const result = vm.evalCode(source, 'messs-work.js');
    if (result.error) { const error = vm.dump(result.error); result.error.dispose(); throw Object.assign(new Error(error.message || 'Execution failed'), { name: error.name || 'Error' }); }
    const output = vm.getString(result.value); result.value.dispose();
    parentPort.postMessage({ ok: true, output: JSON.parse(output) });
  } finally { vm.dispose(); runtime.dispose(); }
})().catch(error => parentPort.postMessage({ ok: false, errorName: error.name, message: String(error.message).slice(0, 1000) }));
