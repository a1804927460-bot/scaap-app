'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src', 'js', 'canvas-node-mode.js'), 'utf8');
const boardSource = fs.readFileSync(path.join(root, 'src', 'js', 'board-canvas.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src', 'styles', 'main.css'), 'utf8');
const pkg = require('../package.json');

function functionBody(text, name, nextName) {
  const start = text.indexOf(`function ${name}`);
  const end = nextName ? text.indexOf(`function ${nextName}`, start + 1) : text.length;
  assert.ok(start >= 0 && end > start, `Could not isolate ${name}.`);
  return text.slice(start, end);
}

assert.strictEqual(pkg.dependencies.drawflow, '0.0.60');
assert.match(html, /node_modules\/drawflow\/dist\/drawflow\.min\.css/);
assert.match(source, /new Drawflow\(host\)/);
assert.match(source, /messs\.canvas\.nodes\.v2/, 'Node graphs must use the independent empty layout namespace.');

const reconcile = functionBody(source, 'reconcileCanvasNodes', 'canvasNodeByFileId');
assert.doesNotMatch(reconcile, /AppState\.boardItems|boardItemId/,
  'Reconciliation must never mirror ordinary canvas items into the node graph.');
assert.doesNotMatch(reconcile, /editor\.addNode/,
  'Reconciliation must not automatically populate an empty graph.');
assert.match(reconcile, /data\.fileId[\s\S]*?AppState\.files\.find/,
  'Node media may only resolve its archived library file.');

const addWorkflow = functionBody(source, 'addCanvasWorkflowNode', 'reconcileCanvasNodes');
assert.doesNotMatch(addWorkflow, /openCanvasGenerationSettings/,
  'Creating a generation node must not open the composer until the node is clicked.');
assert.match(addWorkflow, /role === 'text'[\s\S]*?openCanvasTextEditor/);

assert.match(source, /function canvasNodeMediaKind\(file\)[\s\S]*?return 'model'[\s\S]*?return 'audio'/);
assert.match(source, /function canvasNodeMediaRatio\(file, fallback = 16 \/ 9\)/);
assert.doesNotMatch(functionBody(source, 'canvasNodeMediaRatio', 'canvasNodeMediaStyle'), /Math\.(min|max)|0\.42|2\.4/,
  'Source media ratios must not be clamped.');
assert.match(source, /nodeRole: 'media', fileId: file\.id, mediaKind: kind/);
assert.doesNotMatch(source, /nodeRole: 'media'[\s\S]{0,120}boardItemId/);
assert.match(styles, /\.canvas-node-preview \{[\s\S]*?aspect-ratio:\s*var\(--canvas-node-media-ratio, 1\.7778\)/);
assert.match(styles, /\.canvas-generate-result img,[\s\S]*?object-fit:\s*contain/);

const importPaths = functionBody(source, 'importCanvasNodePaths', 'importCanvasNodeMedia');
assert.match(importPaths, /window\.messsAPI\.importFiles\(accepted, folderId, activeCanvasId\(\)\)/);
assert.match(importPaths, /addCanvasMediaNode\(file/);
assert.doesNotMatch(importPaths, /importFilesDirectlyToBoard|addFilesToBoard|AppState\.boardItems/,
  'Node imports must archive files without placing them on the ordinary canvas.');
assert.match(source, /bindCanvasNodeFileDrop[\s\S]*?getPathForFile[\s\S]*?importCanvasNodePaths/);

['text', 'image', 'video', 'audio', 'model'].forEach((action) => {
  assert.match(html, new RegExp(`data-add-node="${action}"`), `Missing ${action} node action.`);
});
assert.doesNotMatch(html, /id="board-node-add-toggle"/,
  'Node mode must not show the ordinary bottom add capsule.');
assert.match(source, /addEventListener\('contextmenu'[\s\S]*?openCanvasNodeAddMenu\(event\.clientX, event\.clientY\)/);
assert.match(source, /event\.target\.closest\('\.drawflow-node, \.connection, \.input, \.output, \.point'\)/);
assert.match(styles, /\.board-node-add-menu \{[\s\S]*?position:\s*absolute;[\s\S]*?width:\s*252px/);

assert.match(source, /openAiComposerForSelection\(node\.data\.kind, inputs\.prompt,[\s\S]*?placeOnBoard: false/);
assert.match(source, /canvasGenerateNodeMarkup[\s\S]*?data-node-action="add-generation"/,
  'Generation previews need a trailing add control like media nodes.');
assert.match(boardSource, /generationHooks\.placeOnBoard === false\) request\.placeOnBoard = false/);
assert.match(boardSource, /const placeOnBoard = request\.placeOnBoard !== false/);
assert.match(boardSource, /const placeholders = placeOnBoard \? createAiPlaceholders\(generationRequest\) : \[\]/);
assert.match(boardSource, /if \(placeOnBoard\) \{[\s\S]*?replaceAiPlaceholders[\s\S]*?selectFileForPreview/);
assert.match(mainSource, /const boardItem = request\.placeOnBoard === false[\s\S]*?\? null[\s\S]*?: addGeneratedMediaBoardItem/,
  'The main process must archive node outputs without adding ordinary board items.');
assert.match(boardSource, /nodeComposer[\s\S]*?getElementById\(nodeComposer \? 'board-node-mode' : 'board-viewport'\)/);
assert.match(styles, /\.ai-image-popover\.ai-composer\.is-node-composer[\s\S]*?bottom:\s*22px/);

assert.match(source, /function removeSelectedCanvasNodes\(\)[\s\S]*?editor\.removeNodeId/);
assert.match(source, /event\.key !== 'Delete' && event\.key !== 'Backspace'[\s\S]*?stopImmediatePropagation\(\)[\s\S]*?removeSelectedCanvasNodes\(\)/,
  'Node deletion must stop the hidden ordinary canvas delete handler.');
assert.doesNotMatch(functionBody(source, 'removeSelectedCanvasNodes', 'initCanvasNodeMode'),
  /deleteFile|removeFile|messsAPI|AppState\.files|board:/,
  'Deleting a node must never delete its archived local file.');
assert.doesNotMatch(functionBody(source, 'ensureCanvasNodeEditor', 'applyCanvasModeVisibility'),
  /setTimeout\(reconcileCanvasNodes/,
  'Deleting a node must not recreate it from ordinary canvas state.');

assert.match(styles, /\.board-panel\.is-node-mode #board-zoom-out,[\s\S]*?#board-fit-all \{ display: none; \}/);
assert.match(source, /bindCanvasNodePanning\(host, editor\);[\s\S]*?bindCanvasNodeMarqueeSelection\(host\);[\s\S]*?bindCanvasNodeFileDrop\(host\)/);
assert.match(source, /event\.button === 0 && \(event\.altKey \|\| CanvasNodeMode\.spacePressed\)/);
assert.match(source, /function bindCanvasNodeMarqueeSelection/);
assert.match(source, /function finishCanvasNodeMarquee[\s\S]*?const intersects =/);

process.stdout.write('Canvas node mode tests passed.\n');
