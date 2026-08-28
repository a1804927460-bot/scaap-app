'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const storeSource = fs.readFileSync(path.join(root, 'src', 'js', 'store-client.js'), 'utf8');
const foldersSource = fs.readFileSync(path.join(root, 'src', 'js', 'folders.js'), 'utf8');
const sidebarSource = fs.readFileSync(path.join(root, 'src', 'js', 'sidebar.js'), 'utf8');
const stylesSource = fs.readFileSync(path.join(root, 'src', 'styles', 'main.css'), 'utf8');

assert.match(storeSource, /activeDateFolderKey:\s*null[\s\S]*?activeDateFolderBaseId:\s*null/);
assert.match(storeSource, /function fileDayKey\(value\)[\s\S]*?getFullYear\(\)[\s\S]*?padStart/);
assert.match(storeSource, /function formatFileDayLabel\(dayKey\)[\s\S]*?toLocaleDateString\(appLocale\(\)/);
assert.match(storeSource, /function groupFilesByDay\(files\)[\s\S]*?const day = fileDayKey\(f\.importedAt\)/);

assert.match(
  foldersSource,
  /function selectDateFolder\(dayKey\)[\s\S]*?activeDateFolderKey = dayKey[\s\S]*?activeDateFolderBaseId = currentFolderContextId\(\)[\s\S]*?renderFolderGridIfActive\(\)/,
  'A date group must open as an independent virtual folder without moving files.'
);
assert.match(
  foldersSource,
  /function currentFileListScope\(\)[\s\S]*?filterFilesByActiveDateFolder\(files\)/,
  'Date-folder navigation must constrain both the sidebar and folder grid.'
);
assert.match(
  foldersSource,
  /function selectFolder\(folderId\)[\s\S]*?activeDateFolderKey = null[\s\S]*?function exitToDefaultFolder\(\)[\s\S]*?activeDateFolderBaseId = null/,
  'Entering a real folder or returning to the library must clear the date scope.'
);
assert.match(
  sidebarSource,
  /function buildDateFolderLabel\(dayKey, count, active = false\)[\s\S]*?file-date-folder-icon[\s\S]*?selectDateFolder\(dayKey\)/,
  'Every date group must expose a keyboard-accessible folder affordance.'
);
assert.match(
  sidebarSource,
  /const expandedDateYears = new Set\(\)[\s\S]*?const expandedDateMonths = new Set\(\)[\s\S]*?function dateFolderHierarchy/,
  'The date library must use explicit collapsed year and month state.'
);
assert.match(
  sidebarSource,
  /function renderDateFolderTree[\s\S]*?level: 'year'[\s\S]*?level: 'month'[\s\S]*?buildDateFolderLabel\(dayKey, items\.length\)/,
  'The library must render year, month, and day folders before showing files.'
);
assert.match(
  sidebarSource,
  /function initializeDateFolderBranch\(files\)[\s\S]*?todayDateFolderKey\(\)[\s\S]*?expandDateFolderBranch\(preferred, true\)/,
  'The first date-tree render must expand and focus today, or the newest available date.'
);
assert.match(
  sidebarSource,
  /dayKey === todayDateFolderKey\(\)[\s\S]*?addEventListener\('dragover'[\s\S]*?handleExternalDrop\(event\.dataTransfer\)/,
  'Today must accept external file drops without changing the real folder context.'
);
assert.match(
  sidebarSource,
  /if \(activeDate\)[\s\S]*?buildDateFolderLabel\(AppState\.activeDateFolderKey, files\.length, true\)[\s\S]*?renderDateCanvasGroups\(list, AppState\.activeDateFolderKey, files\)[\s\S]*?renderDateFolderTree/,
  'Files must render by canvas only after a day folder is selected.'
);
assert.match(
  sidebarSource,
  /function dateCanvasGroups\(files\)[\s\S]*?validCanvasIds[\s\S]*?dateCanvasGroupId\(file, validCanvasIds\)[\s\S]*?Intl\.Collator[\s\S]*?function ensureDateCanvasGroupExpansion/,
  'A selected date must classify every file by canvas name with stable ordering.'
);
assert.match(
  sidebarSource,
  /function dateCanvasGroupId\(file, validCanvasIds = null\)[\s\S]*?__unassigned__[\s\S]*?function dateCanvasGroupLabel[\s\S]*?Unassigned/,
  'Files without a valid canvas must remain visible in an unassigned group.'
);

const groupingSource = sidebarSource.slice(
  sidebarSource.indexOf('function dateCanvasGroupId'),
  sidebarSource.indexOf('function dateCanvasGroupStateKey')
);
const groupingSandbox = {
  AppState: {
    canvases: [
      { id: 'canvas-b', name: 'Beta' },
      { id: 'canvas-a', name: 'Alpha' }
    ]
  },
  Intl,
  appLocale: () => 'en-US',
  t: (en) => en
};
vm.runInNewContext(`${groupingSource}\nresult = dateCanvasGroups([
  { id: 'file-b1', canvasId: 'canvas-b' },
  { id: 'file-orphan', canvasId: 'missing-canvas' },
  { id: 'file-a1', canvasId: 'canvas-a' },
  { id: 'file-a2', canvasId: 'canvas-a' },
  { id: 'file-none', canvasId: null }
]);`, groupingSandbox);
assert.deepEqual(
  Array.from(groupingSandbox.result, (group) => ({
    id: group.id,
    label: group.label,
    files: Array.from(group.files, (file) => file.id)
  })),
  [
    { id: 'canvas-a', label: 'Alpha', files: ['file-a1', 'file-a2'] },
    { id: 'canvas-b', label: 'Beta', files: ['file-b1'] },
    { id: '__unassigned__', label: 'Unassigned', files: ['file-orphan', 'file-none'] }
  ],
  'Canvas grouping must sort names, preserve every file, and merge invalid canvas references.'
);
const canvasGroupSource = sidebarSource.slice(
  sidebarSource.indexOf('function buildDateCanvasGroup'),
  sidebarSource.indexOf('function renderDateCanvasGroups')
);
assert.ok(
  canvasGroupSource.includes("document.createElement('button')") &&
  canvasGroupSource.includes("trigger.setAttribute('aria-controls'") &&
  canvasGroupSource.includes("trigger.setAttribute('aria-expanded'") &&
  canvasGroupSource.includes("content.className = 'file-canvas-group-content'") &&
  canvasGroupSource.includes('buildFileItem(file)') &&
  canvasGroupSource.includes('content.inert = !open'),
  'Canvas groups must be keyboard-accessible and keep the original file item behavior.'
);
assert.match(
  sidebarSource,
  /function buildDateTreeFolder[\s\S]*?file-date-tree-content[\s\S]*?classList\.toggle\('is-collapsed'[\s\S]*?return \{ element: branch, children \}/,
  'Year and month folders must expand in place instead of flashing through a full rerender.'
);
assert.match(
  stylesSource,
  /\.file-date-folder \{[\s\S]*?cursor:\s*var\(--cursor-click\)[\s\S]*?\.file-date-folder\.is-active/,
  'Date folders must share the sidebar folder interaction styling.'
);
assert.match(
  stylesSource,
  /\.file-canvas-group-content[\s\S]*?grid-template-rows:\s*1fr[\s\S]*?\.file-canvas-group-content\.is-collapsed[\s\S]*?grid-template-rows:\s*0fr/,
  'Canvas groups must use smooth, layout-safe expand and collapse transitions.'
);
assert.match(
  stylesSource,
  /is-date-library-entering[\s\S]*?@keyframes date-library-row-in[\s\S]*?@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?file-canvas-group/,
  'Date-library motion must include an accessible reduced-motion fallback.'
);

process.stdout.write('Date folder tests passed.\n');
