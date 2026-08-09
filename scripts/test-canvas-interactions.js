'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildCfHDrop, parseCfHDrop } = require('../lib/clipboard-files');

const root = path.join(__dirname, '..');
const boardSource = fs.readFileSync(path.join(root, 'src', 'js', 'board-canvas.js'), 'utf8');
const workspaceSource = fs.readFileSync(path.join(root, 'src', 'js', 'canvas-workspace.js'), 'utf8');
const boardStyles = fs.readFileSync(path.join(root, 'src', 'styles', 'main.css'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

const clipboardPaths = [
  'C:\\Users\\Example\\Pictures\\copied image.png',
  'C:\\素材\\参考图.webp'
];
assert.deepStrictEqual(parseCfHDrop(buildCfHDrop(clipboardPaths)), clipboardPaths);
assert.deepStrictEqual(parseCfHDrop(Buffer.alloc(4)), []);

assert.match(
  boardSource,
  /viewport\.addEventListener\('pointerdown', \(e\) => \{[\s\S]*?e\.stopImmediatePropagation\(\);[\s\S]*?setPointerCapture\(e\.pointerId\)[\s\S]*?\}, true\);/,
  'Canvas panning must capture the pointer before media item drag handlers.'
);
assert.match(
  boardSource,
  /viewport\.addEventListener\('pointercancel', finishBoardPan\);[\s\S]*?viewport\.addEventListener\('lostpointercapture', finishBoardPan\);[\s\S]*?window\.addEventListener\('blur', \(\) => finishBoardPan\(\)\);/,
  'Canvas panning must settle cleanly when capture or window focus is lost.'
);
assert.match(
  boardSource,
  /aiImagePopoverClickCloser = \(e\) => \{[\s\S]*?if \(pop\.contains\(e\.target\)\) return;[\s\S]*?if \(e\.target\.closest\('#board-canvas \.board-item-image'\)\) return;[\s\S]*?closeAiImagePopover\(\);/,
  'Selecting or removing an image reference must keep the AI composer open while other outside clicks still close it.'
);
assert.match(
  boardSource,
  /function boardImageItemAtClientPoint[\s\S]*?Board\.spatialIndex\.query/,
  'Overview-mode images must remain selectable as references without dismissing the composer.'
);
assert.match(boardSource, /viewport\.addEventListener\('click',[\s\S]*?boardImageItemAtClientPoint[\s\S]*?toggleAiComposerBoardReference/);
assert.match(
  boardSource,
  /viewport\.addEventListener\('wheel',[\s\S]*?!\(e\.ctrlKey \|\| e\.metaKey\)[\s\S]*?setBoardPanTarget[\s\S]*?setBoardZoomTarget/,
  'Plain wheel input must pan smoothly while Ctrl/Cmd wheel keeps pointer-centered zoom.'
);
assert.match(boardSource, /const BOARD_WHEEL_PAN_GAIN = 0\.78;/);
assert.match(boardSource, /const BOARD_WHEEL_ZOOM_RATE = 0\.00125;/);
assert.match(boardSource, /function setBoardPanTarget[\s\S]*?requestAnimationFrame\(stepBoardZoom\)/);
assert.match(
  boardSource,
  /function enterBoardFullscreen[\s\S]*?setCanvasAgentOpen\(true\)[\s\S]*?function exitBoardFullscreen[\s\S]*?setCanvasAgentOpen\(false\)/,
  'Messs Agent must open with fullscreen canvas and close when fullscreen ends.'
);
assert.match(
  workspaceSource,
  /function setCanvasAgentOpen[\s\S]*?board\.classList\.contains\('is-fullscreen'\)[\s\S]*?agent\.classList\.toggle\('is-hidden', !allowed\)/,
  'Messs Agent must reject attempts to open outside fullscreen canvas mode.'
);
assert.match(indexHtml, /id="board-agent-welcome"[\s\S]*?assets\/logo-mark\.png[\s\S]*?Messs Agent/);
assert.match(
  boardStyles,
  /\.board-panel:not\(\.is-fullscreen\) #board-agent-toggle[\s\S]*?display:\s*none;/,
  'The Agent control must disappear on the compact canvas.'
);
assert.match(boardStyles, /\.board-agent-panel \{[\s\S]*?border-radius:\s*18px/);
assert.match(
  mainSource,
  /parseCfHDrop\(clipboard\.readBuffer\('CF_HDROP'\)\)[\s\S]*?preview\.isImageExt/,
  'Copying an image file in another Windows app must import it from CF_HDROP.'
);
assert.match(
  boardStyles,
  /\.board-item \{[\s\S]*?cursor:\s*var\(--cursor-grab\)/,
  'Canvas item cursors must be hand-shaped and theme aware.'
);
assert.match(
  boardStyles,
  /\.canvas-library-card \{[\s\S]*?backdrop-filter:\s*blur\(/,
  'Canvas library cards must use the restrained glass surface.'
);

const qualitySource = boardSource.slice(
  boardSource.indexOf('function syncMountedImageQuality'),
  boardSource.indexOf('function applyBoardTransform')
);
assert.match(
  qualitySource,
  /Board\.isPanning \|\| Board\.zoomFrame \|\| Date\.now\(\) < Board\.interactingUntil/,
  'Image LOD changes must remain frozen for the full pan/zoom interaction.'
);
const transformSource = boardSource.slice(
  boardSource.indexOf('function applyBoardTransform'),
  boardSource.indexOf('function setBoardZoomTarget')
);
assert.doesNotMatch(
  transformSource,
  /syncMountedImageQuality\(true\)|qualityFrame/,
  'Canvas transforms must not force thumbnail/full-image swaps on animation frames.'
);
assert.match(
  boardSource,
  /const BOARD_DOM_ITEM_LIMIT = 320;[\s\S]*?BoardEngine\.resolveZoomLod[\s\S]*?BoardEngine\.isOverDomBudget[\s\S]*?queryLimited\(regions\.mount, BOARD_DOM_ITEM_LIMIT\)/,
  'The board must combine a hard DOM budget with zoom and density hysteresis.'
);
assert.match(
  boardSource,
  /if \(useOverview\) \{[\s\S]*?drawBoardOverview\(visibleIds, rect\);[\s\S]*?clearMountedBoardItems\(\);/,
  'The overview fallback must paint before dense DOM content is removed.'
);
assert.doesNotMatch(
  boardStyles,
  /\.board-item[^\{]*\{[^}]*content-visibility:\s*auto/,
  'Browser content-visibility must not compete with board viewport virtualization.'
);
assert.match(
  boardStyles,
  /\.board-canvas \{[^}]*will-change:\s*transform/,
  'The canvas must keep one stable compositor layer while panning and zooming.'
);
assert.doesNotMatch(
  boardStyles,
  /\.board-canvas\.is-transforming \.board-image-layer/,
  'Individual image layers must not be promoted and demoted during every interaction.'
);

process.stdout.write('Canvas interaction tests passed.\n');
