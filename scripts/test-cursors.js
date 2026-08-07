'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const stylesDir = path.join(root, 'src', 'styles');
const cursorDir = path.join(root, 'src', 'assets', 'cursors');
const themeSource = fs.readFileSync(path.join(stylesDir, 'theme.css'), 'utf8');
const mainSource = fs.readFileSync(path.join(stylesDir, 'main.css'), 'utf8');
const allStyles = fs.readdirSync(stylesDir)
  .filter((name) => name.endsWith('.css'))
  .map((name) => fs.readFileSync(path.join(stylesDir, name), 'utf8'))
  .join('\n');

const cursorAssets = {
  default: 'arrow',
  click: 'click',
  grab: 'hand',
  grabbing: 'grabbing',
  text: 'text',
  'col-resize': 'col-resize',
  'row-resize': 'row-resize',
  'nwse-resize': 'nwse-resize',
  'nesw-resize': 'nesw-resize',
  crosshair: 'crosshair',
  wait: 'wait'
};
const compactHandCursors = new Set(['click', 'grab', 'grabbing']);

for (const theme of ['light', 'dark']) {
  const expectedCore = theme === 'light' ? '#111318' : '#fff';
  const expectedOutline = theme === 'light' ? '#fff' : '#080a0d';

  for (const [semantic, assetName] of Object.entries(cursorAssets)) {
    const fileName = `${assetName}-${theme}.svg`;
    const filePath = path.join(cursorDir, fileName);
    assert.ok(fs.existsSync(filePath), `Missing ${theme} cursor asset: ${fileName}`);

    const svg = fs.readFileSync(filePath, 'utf8');
    const expectedSize = compactHandCursors.has(semantic) ? 20 : 24;
    assert.match(
      svg,
      new RegExp(`<svg[^>]+width="${expectedSize}"[^>]+height="${expectedSize}"`),
      `${fileName} must stay compact at ${expectedSize}px.`
    );
    assert.ok(svg.includes(expectedCore), `${fileName} must use the ${theme} theme foreground.`);
    assert.ok(svg.includes(expectedOutline), `${fileName} must use the contrasting outline.`);

    assert.match(
      themeSource,
      new RegExp(`--cursor-${semantic}:\\s*url\\('\\.\\.\\/assets\\/cursors\\/${fileName.replace('.', '\\.')}'\\)`),
      `${semantic} must resolve to ${fileName} in the ${theme} theme.`
    );
  }
}

for (const match of allStyles.matchAll(/cursor\s*:\s*([^;}]+)/g)) {
  const value = match[1].trim();
  assert.ok(
    value === 'inherit' || /^var\(--cursor-[a-z-]+\)(?:\s*!important)?$/.test(value),
    `Cursor declarations must use a theme cursor variable, found: ${value}`
  );
}

assert.match(themeSource, /html, body \{[\s\S]*?cursor:\s*var\(--cursor-default\)/, 'The whole app needs a themed default arrow.');
assert.match(themeSource, /button \{[\s\S]*?cursor:\s*var\(--cursor-click\)/, 'Buttons need the compact click cursor.');
assert.match(themeSource, /button \*,[\s\S]*?cursor:\s*inherit/, 'Button contents must retain the button cursor instead of falling back to a native cursor.');
assert.match(themeSource, /\[draggable="true"\] \*[\s\S]*?cursor:\s*var\(--cursor-grab\)/, 'Dragged content must retain the themed hand cursor.');
assert.match(themeSource, /input:not\(\[type\]\)[\s\S]*?cursor:\s*var\(--cursor-text\)/, 'Editable inputs need the themed text cursor.');
assert.match(mainSource, /\.board-item \{[\s\S]*?cursor:\s*var\(--cursor-grab\)/, 'Canvas media needs the compact open-hand cursor.');
assert.match(mainSource, /\.board-viewport\.is-panning[\s\S]*?cursor:\s*var\(--cursor-grabbing\) !important/, 'Canvas panning needs the grabbing cursor.');
assert.match(mainSource, /\.board-resize-handle\.corner-sw[^}]+cursor:\s*var\(--cursor-nesw-resize\)/, 'Canvas corners need directionally correct resize cursors.');

process.stdout.write('Cursor consistency tests passed.\n');
