'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

async function run() {
  if (process.env.MESSS_EXPORT_TEST_ARCHIVE) {
    const { exportModel } = require(path.join(process.env.MESSS_EXPORT_TEST_ARCHIVE, 'lib/ai-model-export.js'));
    const parts = [{ shape: 'box', size: [7, 14, 0.8] }, { shape: 'cylinder', size: [1, 0.2, 1], position: [2, 5, 0.5] }];
    const obj = await exportModel({ name: 'phone.obj', parts });
    assert.match(obj.data.toString(), /^v /m); assert.match(obj.data.toString(), /^f /m);
    assert.match(obj.data.toString(), /o part_2/);
    const stl = await exportModel({ name: 'phone.stl', parts });
    assert.ok(stl.data.readUInt32LE(80) > 12);
    assert.equal(stl.data.length, 84 + stl.data.readUInt32LE(80) * 50);
    console.log('ASAR_MODEL_EXPORT_OK: OBJ and binary STL without three/examples');
    return;
  }
  const root = path.resolve(__dirname, '..');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'messs-model-asar-'));
  try {
    const app = path.join(temp, 'app');
    // Match production pruning: retain Three core but omit its examples tree.
    for (const relative of ['lib/ai-model-export.js', 'vendor/model-exporters', 'node_modules/three/package.json', 'node_modules/three/build']) {
      const destination = path.join(app, relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.cpSync(path.join(root, relative), destination, { recursive: true });
    }
    const archive = path.join(temp, 'app.asar');
    await require('@electron/asar').createPackage(app, archive);
    const result = spawnSync(require('electron'), [__filename], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', MESSS_EXPORT_TEST_ARCHIVE: archive }, encoding: 'utf8', timeout: 30000
    });
    assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
    assert.match(result.stdout, /ASAR_MODEL_EXPORT_OK/);
    console.log(result.stdout.trim());
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
