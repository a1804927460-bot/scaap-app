'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const html = read('src', 'index.html');
const workshop = read('src', 'js', 'workshop.js');
const preload = read('preload.js');
const main = read('main.js');
const css = read('src', 'styles', 'main.css');
const migration = read('supabase', 'migrations', '202608220001_workshop_posts.sql');
const followupMigration = read('supabase', 'migrations', '202608220005_workshop_prompt_and_delete.sql');
const deleteRpcMigration = read('supabase', 'migrations', '202609040001_workshop_delete_rpc.sql');

assert.match(html, /id="section-workshop" class="app-section workshop-section"/);
['workshop-grid', 'workshop-publish-overlay', 'workshop-detail-overlay', 'workshop-select-from-canvas', 'workshop-detail-prompt', 'workshop-copy-title', 'workshop-copy-description', 'workshop-copy-prompt', 'workshop-detail-delete', 'workshop-canvas-target-overlay', 'workshop-canvas-target-list', 'workshop-canvas-target-confirm'].forEach((id) => {
  assert.match(html, new RegExp(`id="${id}"`), `Workshop is missing ${id}`);
});
assert.match(html, /<script src="js\/workshop\.js"><\/script>/);
assert.match(preload, /workshop: Object\.freeze\(/);
['workshop:list', 'workshop:publish', 'workshop:incrementClick', 'workshop:toggleLike', 'workshop:importMedia', 'workshop:delete'].forEach((channel) => {
  assert.match(main, new RegExp(`ipcMain\\.handle\\('${channel}'`), `Missing ${channel} IPC handler`);
});
assert.match(preload, /delete: \(postId\) => ipcRenderer\.invoke\('workshop:delete'/);
assert.match(preload, /importMedia: \(postId, folderId, canvasId\) => ipcRenderer\.invoke\('workshop:importMedia'/);
assert.match(workshop, /AppState\.boardItems[\s\S]*?selected/);
assert.match(workshop, /WorkshopState\.sort === 'newest'[\s\S]*?b\.clicks - a\.clicks/);
assert.match(workshop, /prompt: String\(raw\.prompt/);
assert.match(workshop, /workshopPostPrompt\(post\)/);
assert.match(workshop, /workshopCanDeletePost\(post\)/);
assert.match(workshop, /openAiComposerForSelection\([\s\S]*?prompt,[\s\S]*?referenceFileIds/);
assert.match(workshop, /function chooseWorkshopCanvasTarget\([\s\S]*?WorkshopState\.canvasTargetId/);
assert.match(workshop, /workshop\.importMedia\(post\.id, folderId, targetCanvasId\)/);
assert.match(workshop, /switchCanvas\(targetCanvasId, \{ enterWorkspace: true \}\)/);
assert.match(workshop, /referenceFileIds: file \? \[file\.id\] : \[\]/);
assert.match(workshop, /canvas\.textContent = workshopText\('Open on canvas', '在画布打开'\)/);
assert.match(workshop, /copyWorkshopDetailText[\s\S]*?navigator\.clipboard\.writeText/);
assert.doesNotMatch(html, /id="workshop-detail-reference"/);
assert.match(workshop, /deleteApi \? await deleteApi\(post\.id\)/);
assert.match(workshop, /WorkshopState\.deletingPostId[\s\S]*?deleteButton\.disabled = true[\s\S]*?deleteButton\.disabled = false/);
assert.match(workshop, /reason === 'auth-required'[\s\S]*?reason === 'not-owner'[\s\S]*?作品删除失败/);
assert.match(workshop, /textContent/);
assert.match(main, /workshop_increment_click/);
assert.match(main, /async function deleteWorkshopPost\(postId\)/);
assert.match(main, /async function importWorkshopPostMedia\(postId, folderId, canvasId\)/);
assert.match(main, /storage\/v1\/object\/public/);
assert.match(main, /validateButlerVideoBuffer\(buffer, mimeType\)/);
assert.match(main, /rpc\/workshop_delete_post/);
assert.match(main, /owner_id', `eq\.\$\{ownerId\}`/);
assert.match(main, /store\.removeFileById/); // local library deletion remains a separate, explicit action.
const workshopDeleteSource = main.slice(main.indexOf('async function deleteWorkshopPost(postId)'), main.indexOf('async function sanitizeImageForAi'));
assert.doesNotMatch(workshopDeleteSource, /store\.removeFileById|unlinkSync\(post\.media_path/,
  'Deleting a Workshop work must never delete the original local library file.');
assert.match(main, /method: 'DELETE'/);
assert.match(css, /\.workshop-grid\s*\{/);
assert.match(css, /\.workshop-overlay\s*\{/);
assert.match(css, /\.workshop-card-media video \{[^}]*object-fit: contain/s);
assert.match(css, /\.workshop-detail-media[\s\S]*?object-fit: contain/);
assert.match(css, /\.workshop-canvas-target-dialog[\s\S]*?\.workshop-canvas-target-option\.is-active/);
assert.match(migration, /create table if not exists public\.workshop_posts/);
assert.match(migration, /workshop_post_likes/);
assert.match(migration, /workshop_increment_click/);
assert.match(migration, /workshop_toggle_like/);
assert.match(migration, /bucket_id = 'workshop-media'/);
assert.match(migration, /prompt text not null default ''/);
assert.match(migration, /Users can delete their own Workshop posts/);
assert.match(followupMigration, /add column if not exists prompt/);
assert.match(followupMigration, /owner_id = auth\.uid\(\)/);
assert.match(followupMigration, /storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/);
assert.match(main, /rpc\/workshop_delete_post/);
assert.match(main, /owner_id', `eq\.\$\{ownerId\}`/);
assert.match(main, /Prefer: 'return=representation'/);
assert.match(deleteRpcMigration, /create or replace function public\.workshop_delete_post\(p_post_id uuid\)/);
assert.match(deleteRpcMigration, /where id = p_post_id and owner_id = current_user_id/);
assert.match(deleteRpcMigration, /grant execute on function public\.workshop_delete_post\(uuid\) to authenticated/);

process.stdout.write('Workshop checks passed.\n');
