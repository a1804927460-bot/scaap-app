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

assert.match(html, /id="section-workshop" class="app-section workshop-section"/);
['workshop-grid', 'workshop-publish-overlay', 'workshop-detail-overlay', 'workshop-select-from-canvas'].forEach((id) => {
  assert.match(html, new RegExp(`id="${id}"`), `Workshop is missing ${id}`);
});
assert.match(html, /<script src="js\/workshop\.js"><\/script>/);
assert.match(preload, /workshop: Object\.freeze\(/);
['workshop:list', 'workshop:publish', 'workshop:incrementClick', 'workshop:toggleLike'].forEach((channel) => {
  assert.match(main, new RegExp(`ipcMain\\.handle\\('${channel}'`), `Missing ${channel} IPC handler`);
});
assert.match(workshop, /AppState\.boardItems[\s\S]*?selected/);
assert.match(workshop, /WorkshopState\.sort === 'newest'[\s\S]*?b\.clicks - a\.clicks/);
assert.match(workshop, /textContent/);
assert.match(main, /workshop_increment_click/);
assert.match(css, /\.workshop-grid\s*\{/);
assert.match(css, /\.workshop-overlay\s*\{/);
assert.match(migration, /create table if not exists public\.workshop_posts/);
assert.match(migration, /workshop_post_likes/);
assert.match(migration, /workshop_increment_click/);
assert.match(migration, /workshop_toggle_like/);
assert.match(migration, /bucket_id = 'workshop-media'/);

process.stdout.write('Workshop checks passed.\n');
