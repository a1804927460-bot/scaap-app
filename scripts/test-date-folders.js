'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

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
  /if \(activeDate\)[\s\S]*?buildDateFolderLabel\(AppState\.activeDateFolderKey, files\.length, true\)[\s\S]*?buildFileItem\(file\)[\s\S]*?renderDateFolderTree/,
  'Files must render only after a day folder is selected.'
);
assert.match(
  stylesSource,
  /\.file-date-folder \{[\s\S]*?cursor:\s*var\(--cursor-click\)[\s\S]*?\.file-date-folder\.is-active/,
  'Date folders must share the sidebar folder interaction styling.'
);

process.stdout.write('Date folder tests passed.\n');
