'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const start = mainSource.indexOf('const CANVAS_PACKAGE_MAGIC');
const end = mainSource.indexOf('function canvasFolderName', start);
assert.ok(start >= 0 && end > start, 'Canvas package helpers must be present.');

const sandbox = {
  Buffer,
  console,
  crypto,
  fs,
  path,
  store: { libraryDir: os.tmpdir(), data: { canvases: [] } }
};
vm.runInNewContext(`${mainSource.slice(start, end)}\nthis.canvasPackageApi = { writeCanvasPackage, readCanvasPackageManifest, extractCanvasPackageFile };`, sandbox);

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'messs-canvas-package-'));
  try {
    const sourceBytes = Buffer.from('Messs canvas package integrity test\n\x00\x01\x02', 'utf8');
    const sourcePath = path.join(directory, 'source.bin');
    const packagePath = path.join(directory, 'canvas.Messs');
    const extractedPath = path.join(directory, 'extracted.bin');
    fs.writeFileSync(sourcePath, sourceBytes);
    const prepared = {
      manifest: {
        format: 'messs-canvas-package',
        version: 1,
        canvas: { id: 'canvas-test', name: 'Package Test' },
        boardItems: [{ id: 'item-test', canvasId: 'canvas-test', fileId: 'file-test', x: 1, y: 2 }],
        files: [{ id: 'file-test', name: 'source.bin', metadata: {}, sizeBytes: sourceBytes.length, sha256: sha256(sourceBytes) }]
      },
      sources: [{ sourcePath, name: 'source.bin', sizeBytes: sourceBytes.length, sha256: sha256(sourceBytes) }]
    };
    await sandbox.canvasPackageApi.writeCanvasPackage(packagePath, prepared);
    const parsed = await sandbox.canvasPackageApi.readCanvasPackageManifest(packagePath);
    assert.equal(parsed.manifest.files.length, 1);
    const packageHandle = await fs.promises.open(packagePath, 'r');
    await sandbox.canvasPackageApi.extractCanvasPackageFile(
      packageHandle,
      packagePath,
      parsed.payloadOffset,
      parsed.manifest.files[0],
      extractedPath
    );
    await packageHandle.close();
    assert.deepEqual(fs.readFileSync(extractedPath), sourceBytes);

    const damagedPath = path.join(directory, 'damaged.Messs');
    fs.copyFileSync(packagePath, damagedPath);
    const damagedHandle = await fs.promises.open(damagedPath, 'r+');
    const damagedPosition = parsed.payloadOffset;
    const originalByte = Buffer.alloc(1);
    await damagedHandle.read(originalByte, 0, 1, damagedPosition);
    await damagedHandle.write(Buffer.from([originalByte[0] ^ 0xff]), 0, 1, damagedPosition);
    await damagedHandle.close();
    const damagedParsed = await sandbox.canvasPackageApi.readCanvasPackageManifest(damagedPath);
    const damagedPackageHandle = await fs.promises.open(damagedPath, 'r');
    await assert.rejects(
      sandbox.canvasPackageApi.extractCanvasPackageFile(
        damagedPackageHandle,
        damagedPath,
        damagedParsed.payloadOffset,
        damagedParsed.manifest.files[0],
        path.join(directory, 'damaged.bin')
      ),
      /integrity check/
    );
    await damagedPackageHandle.close();
    process.stdout.write('Canvas package integrity tests passed.\n');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
