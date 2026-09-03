'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const storeSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'store.js'), 'utf8');
const { Store } = require('../lib/store');

async function withTempStore(test) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'messs-ai-media-persistence-'));
  try {
    await test(root, new Store(root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function testConcurrentSaves(root, store) {
  for (let index = 0; index < 32; index += 1) {
    store.data.testMarker = `save-${index}`;
    store.scheduleSave();
  }
  await store.flush();
  const restored = new Store(root);
  assert.equal(restored.data.testMarker, 'save-31');
  assert.equal(JSON.parse(fs.readFileSync(restored.dataPath, 'utf8'))._storeRevision > 0, true);
}

async function testSyncBarrier(root, store) {
  store.data.testMarker = 'async-old';
  store.scheduleSave();
  await new Promise((resolve) => setTimeout(resolve, 5));
  store.data.testMarker = 'sync-new';
  store.flushSync();
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(new Store(root).data.testMarker, 'sync-new');
}

async function testDeliveryStateRestores(root, store) {
  const mediaPath = path.join(store.libraryDir, 'canvas', 'generated.png');
  fs.mkdirSync(path.dirname(mediaPath), { recursive: true });
  fs.writeFileSync(mediaPath, Buffer.from('generated-media'));
  store.data.files.push({
    id: 'generated-file-1',
    name: 'generated.png',
    storedPath: mediaPath,
    sizeBytes: 15,
    canvasId: 'canvas-1'
  });
  store.data.boardItems.push({
    id: 'board-item-1',
    fileId: 'generated-file-1',
    canvasId: 'canvas-1',
    x: 0,
    y: 0,
    width: 300,
    height: 300
  });
  store.data.aiMediaDeliveries.push({
    token: 'ad-test',
    kind: 'image',
    recordIds: ['generated-file-1'],
    boardItemIds: ['board-item-1'],
    requiresBoardItem: true,
    status: 'pending',
    createdAt: Date.now()
  });
  store.scheduleSave();
  await store.flush();
  const restored = new Store(root);
  assert.equal(restored.data.files.some((file) => file.id === 'generated-file-1'), true);
  assert.equal(restored.data.boardItems.some((item) => item.fileId === 'generated-file-1'), true);
  assert.equal(restored.data.aiMediaDeliveries[0].token, 'ad-test');
}

async function testTempRecovery(root, store) {
  store.data.testMarker = 'formal';
  store.flushSync();
  const formal = JSON.parse(fs.readFileSync(store.dataPath, 'utf8'));
  formal.testMarker = 'recovered';
  formal._storeRevision = Number(formal._storeRevision) + 10;
  const tempPath = `${store.dataPath}.recovery.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(formal), 'utf8');
  assert.equal(new Store(root).data.testMarker, 'recovered');
}

(async () => {
  await withTempStore(async (root, store) => {
    await testConcurrentSaves(root, store);
    await testSyncBarrier(root, store);
    await testDeliveryStateRestores(root, store);
    await testTempRecovery(root, store);
  });

  assert.match(storeSource, /_saveQueue/);
  assert.match(storeSource, /fsyncSync/);
  assert.match(storeSource, /_storeRevision/);
  assert.match(storeSource, /Always write the current snapshot before shutdown/);
  assert.match(mainSource, /await flushStoreDurably\(\);[\s\S]*?aiMediaDeliveryIsDurable/);
  assert.match(mainSource, /boardItemIds:[\s\S]*?requiresBoardItem/);
  assert.match(mainSource, /Skipped rollback for a confirmed AI media result/);
  assert.match(mainSource, /Do not return a successful result until its file record/);
  const boardSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'board-canvas.js'), 'utf8');
  const assistantSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'ai-assistant.js'), 'utf8');
  assert.match(boardSource, /aiDeliveryConfirmationAttempted = true/);
  assert.match(boardSource, /generatedFiles\.length && err && err\.aiDeliveryConfirmationAttempted !== true/);
  assert.match(assistantSource, /generatedMediaFiles\.length && err && err\.aiDeliveryConfirmationAttempted !== true/);
  console.log('AI media persistence tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
