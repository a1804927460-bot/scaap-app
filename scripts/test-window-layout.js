'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const main = read('main.js');
const themeCss = read('src/styles/theme.css');
const mainCss = read('src/styles/main.css');
const startCss = read('src/styles/start.css');

assert.match(themeCss, /--titlebar-h:\s*38px/);
assert.match(themeCss, /body\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?inset:\s*0;/);
assert.match(mainCss, /\.app-section\s*\{[\s\S]*?top:\s*var\(--titlebar-h\);[\s\S]*?bottom:\s*0;/);
assert.match(mainCss, /\.main-app\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*0;/);
assert.match(startCss, /\.start-screen\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*0;/);
assert.match(main, /backgroundColor:\s*WINDOW_BACKGROUND_COLORS\[initialTheme\]/);
assert.match(main, /ipcMain\.handle\('settings:setTheme',[\s\S]*?setWindowBackgroundColor\(store\.data\.settings\.theme\)/);

console.log('Window layout tests passed.');
