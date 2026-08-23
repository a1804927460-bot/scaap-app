'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src', 'js', 'file-drop.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const preloadSource = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const previewSource = fs.readFileSync(path.join(root, 'src', 'js', 'preview-canvas.js'), 'utf8');

function finderFile(name, bytes, options = {}) {
  const data = Uint8Array.from(bytes);
  return {
    name,
    size: data.byteLength,
    lastModified: options.lastModified || 7,
    type: options.type || 'application/octet-stream',
    ...(options.path ? { path: options.path } : {}),
    slice(start, end) {
      const part = data.slice(start, end);
      return {
        async arrayBuffer() {
          return part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength);
        }
      };
    }
  };
}

async function run() {
  const uploads = new Map();
  let abortCount = 0;
  const context = {
    Uint8Array,
    window: {
      messsAPI: {
        getPathForFile: (file) => file.nativePath || '',
        importFiles: async (paths) => ({
          imported: paths.map((filePath) => ({ id: filePath, name: path.basename(filePath) })),
          unlocked: ['path-import']
        }),
        beginDroppedFileImport: async (metadata) => {
          const uploadId = `upload-${uploads.size + 1}`;
          uploads.set(uploadId, { metadata, chunks: [] });
          return { uploadId, chunkSize: 3 };
        },
        appendDroppedFileImport: async (uploadId, chunk) => {
          uploads.get(uploadId).chunks.push(Buffer.from(chunk));
          return { received: uploads.get(uploadId).chunks.reduce((sum, item) => sum + item.length, 0) };
        },
        finishDroppedFileImport: async (uploadId) => {
          const upload = uploads.get(uploadId);
          upload.finished = true;
          return {
            imported: [{ id: uploadId, name: upload.metadata.name }],
            unlocked: ['byte-import']
          };
        },
        abortDroppedFileImport: async () => {
          abortCount += 1;
          return { ok: true };
        }
      }
    }
  };
  vm.runInNewContext(source, context);
  const drop = context.window.MesssFileDrop;

  const nativeFile = finderFile('native.png', [1], { type: 'image/png' });
  nativeFile.nativePath = '/Users/test/Pictures/native.png';
  assert.strictEqual(
    drop.pathForFile(nativeFile),
    '/Users/test/Pictures/native.png',
    'webUtils path resolution must work without legacy file.path'
  );

  const fallbackFile = finderFile('参考图.png', [1, 2, 3, 4, 5, 6, 7], { type: 'image/png' });
  const finderTransfer = { types: ['Files'], items: [], files: [fallbackFile] };
  assert.strictEqual(drop.hasFiles(finderTransfer), true, 'Finder files-only transfers must be accepted');
  const finderEntries = drop.entries(finderTransfer);
  assert.strictEqual(finderEntries.length, 1);
  assert.strictEqual(String(finderEntries[0].path), '', 'the regression fixture must not expose file.path');

  const fallbackResult = await drop.importEntries(finderEntries, null, 'canvas-1');
  assert.strictEqual(fallbackResult.imported.length, 1);
  assert.deepStrictEqual(Array.from(fallbackResult.unlocked), ['byte-import']);
  const upload = uploads.get('upload-1');
  assert.strictEqual(upload.finished, true);
  assert.deepStrictEqual([...Buffer.concat(upload.chunks)], [1, 2, 3, 4, 5, 6, 7]);
  assert.strictEqual(upload.chunks.length, 3, 'pathless Finder files must use bounded chunks');

  const second = finderFile('video.mp4', [8, 9], { type: 'video/mp4' });
  second.nativePath = '/Users/test/Movies/video.mp4';
  const item = {
    kind: 'file',
    getAsFile: () => second,
    webkitGetAsEntry: () => ({ isDirectory: false })
  };
  const merged = drop.entries({ types: ['Files'], items: [item], files: [second] });
  assert.strictEqual(merged.length, 1, 'items and files must not duplicate one Finder drop');
  assert.strictEqual(merged[0].path, '/Users/test/Movies/video.mp4');

  const pathResult = await drop.importEntries(merged, null, 'canvas-1');
  assert.strictEqual(pathResult.imported[0].id, '/Users/test/Movies/video.mp4');
  assert.strictEqual(abortCount, 0);

  for (const channel of [
    'files:beginDroppedImport',
    'files:appendDroppedImport',
    'files:finishDroppedImport',
    'files:abortDroppedImport'
  ]) {
    assert(mainSource.includes(`ipcMain.handle('${channel}'`), `main process must handle ${channel}`);
    assert(preloadSource.includes(channel), `preload must expose ${channel}`);
  }
  assert(mainSource.includes('session.received !== session.size'), 'main process must reject incomplete files');
  assert(mainSource.includes('normalizeDroppedFileName'), 'main process must validate dropped filenames');
  assert.strictEqual(
    (previewSource.match(/canvas\.addEventListener\('drop'/g) || []).length,
    1,
    'preview canvas must not import the same external drop twice'
  );
  assert(mainSource.includes("message.role === 'user' && index === lastUserIndex"),
    'AI chat must send image payloads only for the newest user turn');

  process.stdout.write('File drop compatibility tests passed.\n');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
