'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../lib/store');

(async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'messs-storage-test-'));
  const source = path.join(root, 'source');
  const target = path.join(root, 'target');
  try {
    const store = new Store(source);
    const storedPath = path.join(store.libraryDir, 'canvas-1', 'asset.png');
    await fs.promises.mkdir(path.dirname(storedPath), { recursive: true });
    await fs.promises.writeFile(storedPath, Buffer.from('asset'));
    const record = { id: 'file-1', name: 'asset.png', storedPath };
    store.addFile(record);
    store.save();

    const moved = await store.moveLibraryTo(target);
    assert.equal(moved, target);
    assert.equal(record.storedPath, path.join(target, 'library', 'canvas-1', 'asset.png'));
    assert.equal(fs.readFileSync(record.storedPath, 'utf8'), 'asset');
    assert.ok(fs.existsSync(path.join(target, 'data.json')));
    assert.equal(store.data.settings.libraryRootPath, target);
    assert.ok(fs.existsSync(path.join(source, 'data.json')), 'source remains as a rollback copy');

    const occupied = path.join(root, 'occupied');
    await fs.promises.mkdir(occupied, { recursive: true });
    await fs.promises.writeFile(path.join(occupied, 'keep.txt'), 'keep');
    await assert.rejects(() => store.moveLibraryTo(occupied), { code: 'storage-path-not-empty' });
    assert.equal(fs.readFileSync(path.join(occupied, 'keep.txt'), 'utf8'), 'keep');
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
  console.log('Storage location tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
