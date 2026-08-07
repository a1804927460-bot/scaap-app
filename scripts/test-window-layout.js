'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const main = read('main.js');
const preload = read('preload.js');
const indexHtml = read('src/index.html');
const startupThemeJs = read('src/js/startup-theme.js');
const themeJs = read('src/js/theme.js');
const startScreenJs = read('src/js/start-screen.js');
const themeCss = read('src/styles/theme.css');
const mainCss = read('src/styles/main.css');
const startCss = read('src/styles/start.css');

assert.match(themeCss, /--titlebar-h:\s*38px/);
assert.match(themeCss, /body\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?inset:\s*0;/);
assert.match(mainCss, /\.app-section\s*\{[\s\S]*?top:\s*var\(--titlebar-h\);[\s\S]*?bottom:\s*0;/);
assert.match(mainCss, /\.main-app\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*0;/);
assert.match(mainCss, /#search-input\s*\{[\s\S]*?flex:\s*1 1 auto;[\s\S]*?min-width:\s*0;/);
assert.match(mainCss, /\.sidebar\.is-density-compact[\s\S]*?\.sidebar\.is-density-minimal/);
const panelResize = read('src/js/panel-resize.js');
assert.match(panelResize, /SIDEBAR_COMPACT_MAX_PX\s*=\s*230/);
assert.match(panelResize, /SIDEBAR_MINIMAL_MAX_PX\s*=\s*200/);
assert.match(panelResize, /new ResizeObserver\(\(\)\s*=>\s*updateSidebarDensity\(sidebar\)\)/);
assert.match(startCss, /\.start-screen\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*0;/);
assert.match(main, /function createWindow\(\)\s*\{\s*const initialTheme\s*=\s*normalizeTheme\([\s\S]*?store\.data\.settings\.theme/);
assert.match(main, /new BrowserWindow\(\{[\s\S]*?show:\s*false,[\s\S]*?backgroundColor:\s*WINDOW_BACKGROUND_COLORS\[initialTheme\]/);
assert.match(main, /mainWindow\.loadFile\([\s\S]*?query:\s*\{\s*theme:\s*initialTheme\s*\}/);
assert.match(main, /mainWindow\.once\('ready-to-show',\s*revealWindow\)/);
assert.match(main, /mainWindow\.webContents\.once\('did-finish-load',[\s\S]*?revealWindow/);
assert.match(main, /ipcMain\.on\('window:syncThemeSurface',[\s\S]*?setWindowBackgroundColor\(theme\)/);
assert.match(preload, /syncThemeSurface:\s*\(theme\)\s*=>\s*ipcRenderer\.send\('window:syncThemeSurface',\s*theme\)/);
assert.ok(indexHtml.indexOf('<script src="js/startup-theme.js"></script>') < indexHtml.indexOf('<link rel="stylesheet" href="styles/theme.css"'), 'startup theme must run before CSS');
assert.match(startupThemeJs, /new URLSearchParams\(window\.location\.search\)\.get\('theme'\)/);
assert.match(startupThemeJs, /dataset\.theme\s*=\s*startupTheme\s*===\s*'light'\s*\?\s*'light'\s*:\s*'dark'/);
assert.doesNotMatch(themeCss, /html\[data-view="start"\]\s*\{[\s\S]*?--bg-base:/);
assert.doesNotMatch(themeJs, /syncThemeSurface\(appliedTheme\)/);
assert.match(startScreenJs, /setAttribute\('data-view',\s*'main'\);[\s\S]*?syncThemeSurface\(document\.documentElement\.getAttribute\('data-theme'\)/);
assert.match(startScreenJs, /setAttribute\('data-view',\s*'start'\);[\s\S]*?syncThemeSurface\(document\.documentElement\.getAttribute\('data-theme'\)/);
assert.match(main, /ipcMain\.handle\('settings:setTheme',[\s\S]*?setWindowBackgroundColor\(store\.data\.settings\.theme\)/);

console.log('Window layout tests passed.');
