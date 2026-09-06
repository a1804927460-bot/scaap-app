'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const context = vm.createContext({
  document: { addEventListener() {}, getElementById() { return null; } },
  window: { messsAPI: { workshop: {} } },
  localStorage: { setItem() {} },
  showConfirmDialog: async () => true,
  showToast() {},
  AppState: { files: [] }
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/js/workshop.js'), 'utf8'), context);
const run = (code) => vm.runInContext(code, context);

(async () => {
  run(`WorkshopState.currentUserId = 'alice';
    WorkshopState.posts = [
      { id: 'a', ownerId: 'alice', tags: [] },
      { id: 'b', ownerId: 'bob', tags: [] },
      { id: 'c', ownerId: null, tags: [] }
    ];`);
  assert.equal(run('workshopCanDeletePost(WorkshopState.posts[0])'), true);
  assert.equal(run('workshopCanDeletePost(WorkshopState.posts[1])'), false);
  run("WorkshopState.currentUserId = null; WorkshopState.category = 'mine'");
  assert.equal(run('workshopVisiblePosts().length'), 0, 'Logged-out users do not own anonymous posts');
  run("WorkshopState.currentUserId = 'alice'");
  let calls = 0;
  context.window.messsAPI.workshop.delete = async () => { calls++; return { ok: false, reason: 'not-owner' }; };
  await run('deleteWorkshopPost(WorkshopState.posts[1])');
  assert.equal(calls, 0, 'Cannot send deletion for another author');
  await run('deleteWorkshopPost(WorkshopState.posts[0])');
  assert.equal(run('WorkshopState.posts.length'), 3, 'Failure preserves the post');
  assert.equal(run('WorkshopState.deletingPostId'), null);
  let complete;
  context.window.messsAPI.workshop.delete = () => new Promise(resolve => { calls++; complete = resolve; });
  const pending = run('deleteWorkshopPost(WorkshopState.posts[0])');
  await Promise.resolve();
  await run('deleteWorkshopPost(WorkshopState.posts[0])');
  assert.equal(calls, 2, 'Repeated clicks do not create duplicate requests');
  complete({ ok: true });
  await pending;
  assert.equal(run('WorkshopState.posts.length'), 2);
  assert.equal(run('WorkshopState.deletingPostId'), null);
  console.log('Workshop deletion behavior passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
