'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src', 'js', 'canvas-node-mode.js'), 'utf8');
const boardSource = fs.readFileSync(path.join(root, 'src', 'js', 'board-canvas.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src', 'styles', 'main.css'), 'utf8');
const pkg = require('../package.json');

assert.strictEqual(pkg.dependencies.drawflow, '0.0.60');
assert.match(html, /node_modules\/drawflow\/dist\/drawflow\.min\.css/);
assert.match(html, /id="board-mode-toggle"[\s\S]*?id="board-node-mode"/);
assert.match(html, /node_modules\/drawflow\/dist\/drawflow\.min\.js[\s\S]*?canvas-node-mode\.js/);
assert.match(source, /new Drawflow\(host\)/, 'Node mode must use the selected open-source editor.');

assert.match(source, /canvasNodeMediaKind\(file\)[\s\S]*?isModelFile\(file\)[\s\S]*?return null/);
assert.match(source, /isImageExt\(file\.ext\)[\s\S]*?isVideoExt\(file\.ext\)/);
assert.doesNotMatch(source, /return 'model'/, '3D files must never become workflow nodes.');
assert.match(source, /nodeRole: 'media'[\s\S]*?boardItemId: item\.id[\s\S]*?fileId: item\.fileId/);
assert.match(
  source,
  /function canvasNodeMediaMarkup[\s\S]*?canvas-media-node-label[\s\S]*?canvas-node-preview/,
  'Media node labels must render outside and before the preview frame.'
);
assert.doesNotMatch(
  source,
  /function canvasNodeMediaMarkup[\s\S]*?<footer title=/,
  'Media nodes must not render a filename footer below the preview.'
);
assert.match(source, /nodeRole: 'text'/);
assert.match(source, /nodeRole: 'generate'[\s\S]*?lastOutputFileIds/);

['text', 'import-image', 'import-video', 'generate-image', 'generate-video'].forEach((action) => {
  assert.match(html, new RegExp(`data-add-node="${action}"`), `Missing ${action} add-node action.`);
});
assert.match(html, /id="board-node-add-toggle"/);
assert.match(styles, /\.board-node-add-toggle/);
assert.match(styles, /\.board-node-add-menu/);
assert.match(styles, /\.drawflow-node\.messs-flow-node/);
assert.match(styles, /\.drawflow-node \.drawflow_content_node svg\s*\{[\s\S]*?position:\s*static;[\s\S]*?z-index:\s*auto;/);

assert.match(source, /upstreamCanvasNodes\(nodeId\)/);
assert.match(source, /referenceFileIds:[\s\S]*new Set/);
assert.match(source, /canvasGenerateNodeMarkup[\s\S]*?data-node-action="settings"[\s\S]*?role="button"/);
assert.match(styles, /\.canvas-generate-node > \.canvas-node-textarea,[\s\S]*?display:\s*none;/);
assert.match(source, /openAiComposerForSelection\(node\.data\.kind, inputs\.prompt,[\s\S]*?onComplete/);
assert.match(source, /function canvasGenerateResultsMarkup\(data = \{\}\)[\s\S]*?lastOutputFileIds[\s\S]*?canvas-generate-result/);
assert.match(source, /function connectCanvasGenerationOutputs\(nodeId, files\)[\s\S]*?updateNodeDataFromId\(id,[\s\S]*?lastOutputFileIds: outputIds[\s\S]*?reconcileCanvasNodes\(\)/);
assert.match(source, /embeddedOutputFileIds[\s\S]*?!embeddedOutputFileIds\.has\(item\.fileId\)/);
assert.match(source, /canvasTextNodeMarkup[\s\S]*?data-node-action="text"[\s\S]*?role="button"/);
assert.match(source, /function openCanvasTextEditor\(nodeId\)[\s\S]*?board-node-text-editor[\s\S]*?updateNodeDataFromId/);
assert.match(styles, /\.canvas-text-node > \.canvas-node-textarea,[\s\S]*?display:\s*none;/);
assert.match(styles, /\.board-node-text-editor\s*\{[\s\S]*?position:\s*absolute;/);
assert.match(boardSource, /openAiComposerForSelection\(kind, promptText = '', options = \{\}\)/);
assert.match(boardSource, /generationHooks\.onComplete\(files, request\)/);
assert.match(source, /editor\.export\(\)/, 'Node positions, content, and connections must persist.');
assert.match(source, /editor\.import\(saved\)/, 'Persisted node graphs must restore.');
assert.match(source, /nodeDataChanged/);
assert.match(
  source,
  /editor\.on\('connectionStart',[\s\S]*?editor\.on\('connectionCancel',[\s\S]*?openCanvasNodeConnectionMenu/,
  'Dropping a new connection on empty canvas must open the node picker.'
);
assert.match(
  source,
  /function addCanvasNodeFromConnection\(kind, draft\)[\s\S]*?addCanvasWorkflowNode\('generate', kind, position\)[\s\S]*?addConnection\([\s\S]*?'input_1'/,
  'Choosing a node from the connection picker must create and connect it.'
);
assert.match(styles, /\.board-node-connection-menu\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?z-index:\s*32;/);
assert.match(
  source,
  /function bindCanvasNodePanning\(host, editor\)[\s\S]*?event\.button === 0 && \(event\.altKey \|\| CanvasNodeMode\.spacePressed\)[\s\S]*?setPointerCapture\(event\.pointerId\)/,
  'Node panning must start anywhere with middle mouse or a left-button modifier and capture the pointer.'
);
assert.match(
  source,
  /pointercancel', finishCanvasNodePan[\s\S]*?lostpointercapture', finishCanvasNodePan[\s\S]*?window\.addEventListener\('blur', \(\) => finishCanvasNodePan\(\)\)/,
  'Interrupted node panning must settle without leaving the editor stuck.'
);
assert.match(source, /event\.code === 'Space'[\s\S]*?CanvasNodeMode\.spacePressed = true/);
assert.match(styles, /\.board-node-editor\.is-panning[\s\S]*?var\(--cursor-grabbing\)/);
assert.match(
  source,
  /function bindCanvasNodeMarqueeSelection[\s\S]*?event\.button !== 0 \|\| event\.altKey \|\| CanvasNodeMode\.spacePressed[\s\S]*?drawflow-node, \.connection, \.input, \.output, \.point/,
  'Plain left drag on empty node-canvas space must start marquee selection without stealing node or port interactions.'
);
assert.match(
  source,
  /function finishCanvasNodeMarquee[\s\S]*?getBoundingClientRect\(\)[\s\S]*?const intersects =[\s\S]*?selectedIds\.add/,
  'Marquee selection must use rendered node bounds so it remains correct under zoom and pan.'
);
assert.match(
  source,
  /event\.shiftKey \|\| event\.ctrlKey \|\| event\.metaKey[\s\S]*?new Set\(CanvasNodeMode\.selectedNodeIds\)/,
  'Shift, Ctrl, and Command marquee gestures must add to the current node selection.'
);
assert.match(source, /bindCanvasNodePanning\(host, editor\);[\s\S]*?bindCanvasNodeMarqueeSelection\(host\)/);
assert.match(styles, /\.board-node-selection-box \{[\s\S]*?pointer-events:\s*none;[\s\S]*?border:\s*1px solid var\(--accent\)/,
  'The visible marquee must use the theme accent and never block pointer release.');

assert.match(boardSource, /async function submitBoardQuickGeneration\(kind, promptText, options = \{\}\)/);
assert.match(boardSource, /options\.referenceFileIds/);
assert.match(boardSource, /return await generateAiMediaForBoardV3/);
assert.match(styles, /\.board-node-editor \.drawflow \.connection \.main-path/);
assert.match(
  styles,
  /\.board-node-editor \{[\s\S]*?--node-port-hit-padding:\s*10px;[\s\S]*?\.drawflow-node \.input::before,[\s\S]*?\.drawflow-node \.output::before \{[\s\S]*?inset:\s*calc\(-1 \* var\(--node-port-hit-padding\)\);[\s\S]*?pointer-events:\s*auto;/,
  'Node ports must keep their visual size while exposing a forgiving transparent connection target.'
);
assert.match(styles, /\.connection\.is-flowing \.canvas-node-flow-pulse/);
assert.match(styles, /@keyframes canvas-node-signal-flow/);
assert.match(styles, /\.drawflow-node\.messs-media-node/);
assert.match(
  styles,
  /\.canvas-node-preview \{[\s\S]*?aspect-ratio:\s*16 \/ 9;[\s\S]*?border-radius:\s*8px;/,
  'Image and video node previews must use a consistent 16:9 frame.'
);
assert.match(styles, /\.messs-media-node\.selected \.canvas-node-preview \{/);
assert.match(source, /function ensureCanvasNodeFlowPaths\(root\)/);
assert.match(source, /editor\.on\('nodeSelected',[\s\S]*?applyCanvasNodeSelection\(new Set/);
assert.match(source, /editor\.on\('nodeUnselected',[\s\S]*?applyCanvasNodeSelection\(new Set\(\)\)/);

process.stdout.write('Canvas node mode tests passed.\n');
