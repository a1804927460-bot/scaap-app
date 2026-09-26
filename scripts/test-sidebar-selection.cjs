'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles', 'sidebar-partitions.css'), 'utf8');
assert.match(css, /workspace-shortcuts button\.is-active \{ background:var\(--accent\); color:#fff; \}/);
assert.match(css, /border-radius:16px/);
assert.match(css, /workspace-shortcuts button svg \{ display:block;/);
assert.match(css, /workspace-shortcuts button\.is-active::before \{ display:none; \}/);
process.stdout.write('Sidebar selection styling passed.\n');
