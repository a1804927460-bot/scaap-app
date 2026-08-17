'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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
assert.doesNotMatch(source, /class="canvas-node-add-media/,
  'Node markup must not stack an extra circular add button over Drawflow ports.');
assert.match(styles, /\.drawflow-node \.input::after,[\s\S]*?\.drawflow-node \.output::after \{[\s\S]*?content:\s*'\+'/,
  'Both real Drawflow ports must render as plus controls.');
assert.match(source, /function bindCanvasNodeInputConnections[\s\S]*?\.drawflow-node \.input[\s\S]*?board-node-link-draft[\s\S]*?finishCanvasNodeInputConnection/,
  'Dragging the left plus must draw a reverse connection draft.');
assert.match(source, /function bindCanvasNodePortMagnetism[\s\S]*?pointermove[\s\S]*?applyCanvasNodePortMagnet/,
  'Node ports must expose a proximity magnet without moving the connection anchor.');
assert.match(styles, /--node-port-magnet-x:[\s\S]*?\.input\.is-magnetic[\s\S]*?\.output\.is-magnetic/,
  'Magnetic port styling must be shared by both sides of every node.');
assert.match(styles, /\.drawflow-node \.input \{ left: -63px; \}[\s\S]*?\.drawflow-node \.output \{ right: -7px; \}/,
  'Input and output plus controls must sit at matching visual distances from the node.');
assert.match(styles, /\.input::before,[\s\S]*?\.output::before \{[\s\S]*?width:\s*34px;[\s\S]*?background:\s*var\(--board-workspace-bg\)/,
  'Opaque compact port faces must mask connection endpoints instead of overlapping the plus.');
assert.match(styles, /\.board-node-link-draft \{[\s\S]*?z-index:\s*1;/,
  'Draft connections must stay underneath node ports.');
assert.match(source, /function copySelectedCanvasNodeMedia[\s\S]*?nodeRole === 'media'[\s\S]*?setBoardClipboardMedia\(fileIds, 'node'\)/,
  'Selected node media must copy into the shared canvas clipboard.');
assert.match(source, /function pasteCanvasNodeClipboardMedia[\s\S]*?boardClipboardMediaFiles\(\)[\s\S]*?addCanvasMediaNode[\s\S]*?applyCanvasNodeSelection/,
  'Canvas media copied in either mode must paste as selected media nodes.');
assert.match(boardSource, /function setBoardClipboardMedia[\s\S]*?mediaFileIds[\s\S]*?isImageExt[\s\S]*?isVideoExt/,
  'The shared clipboard must accept only image and video file references.');
assert.match(boardSource, /duplicateExisting:\s*true,[\s\S]*?selectAdded:\s*true/,
  'Node media pasted back to the ordinary canvas must create selected independent items.');

const sharedClipboardSandbox = {
  AppState: {
    files: [
      { id: 'image-a', ext: '.png' },
      { id: 'video-b', ext: '.mp4' },
      { id: 'document-c', ext: '.pdf' }
    ]
  },
  BoardClipboard: { items: [], mediaFileIds: [], sourceMode: '', preferInternal: false },
  CanvasNodeMode: { selectedNodeIds: new Set(['20', '10']) },
  window: { messsAPI: { copyBoardMediaToClipboard: async (ids) => ids } },
  isImageExt: (ext) => ext === '.png',
  isVideoExt: (ext) => ext === '.mp4',
  canvasNodeData: () => ({
    10: { data: { nodeRole: 'media', mediaKind: 'image', fileId: 'image-a' } },
    20: { data: { nodeRole: 'media', mediaKind: 'video', fileId: 'video-b' } },
    30: { data: { nodeRole: 'text', text: 'ignore' } }
  }),
  canvasNodeCenterPosition: () => ({ x: 100, y: 200 }),
  added: [],
  selected: [],
  Set,
  Map
};
sharedClipboardSandbox.globalThis = sharedClipboardSandbox;
vm.createContext(sharedClipboardSandbox);
const boardClipboardFunctions = boardSource.slice(
  boardSource.indexOf('function boardClipboardMediaFiles'),
  boardSource.indexOf('async function pasteBoardClipboardMedia')
);
const nodeClipboardFunctions = source.slice(
  source.indexOf('function copySelectedCanvasNodeMedia'),
  source.indexOf('function canvasNodePathKind')
);
vm.runInContext(`function addCanvasMediaNode(file, position) { added.push({ fileId: file.id, position }); return added.length; }\nfunction applyCanvasNodeSelection(ids) { selected = [...ids]; }\n${boardClipboardFunctions}\n${nodeClipboardFunctions}`, sharedClipboardSandbox);
assert.equal(vm.runInContext('copySelectedCanvasNodeMedia()', sharedClipboardSandbox), true);
assert.deepStrictEqual(
  Array.from(sharedClipboardSandbox.BoardClipboard.mediaFileIds),
  ['video-b', 'image-a'],
  'Node copying must preserve selected image/video order.'
);
assert.deepStrictEqual(
  Array.from(vm.runInContext('pasteCanvasNodeClipboardMedia()', sharedClipboardSandbox)),
  [1, 2],
  'Ordinary-to-node paste must create one media node per shared file.'
);
assert.deepStrictEqual(
  sharedClipboardSandbox.added.map((entry) => entry.fileId),
  ['video-b', 'image-a']
);
assert.match(source, /draft\.input_id[\s\S]*?Text prompt[\s\S]*?Image generation[\s\S]*?Video generation/,
  'Dropping a left connection on empty canvas must offer upstream node choices.');
assert.match(boardSource, /generationHooks\.placeOnBoard === false\) request\.placeOnBoard = false/);
assert.match(boardSource, /const placeOnBoard = request\.placeOnBoard !== false/);
assert.match(boardSource, /const placeholders = placeOnBoard \? createAiPlaceholders\(generationRequest\) : \[\]/);
assert.match(boardSource, /if \(placeOnBoard\) \{[\s\S]*?replaceAiPlaceholders[\s\S]*?selectFileForPreview/);
assert.match(mainSource, /const boardItem = request\.placeOnBoard === false[\s\S]*?\? null[\s\S]*?: addGeneratedMediaBoardItem/,
  'The main process must archive node outputs without adding ordinary board items.');
assert.match(boardSource, /nodeComposer[\s\S]*?getElementById\(nodeComposer \? 'board-node-mode' : 'board-viewport'\)/);
assert.match(boardSource, /function anchorAiComposerToNode[\s\S]*?nodeAnchorId[\s\S]*?MutationObserver[\s\S]*?syncNodeAiComposerPosition/);
assert.match(source, /openCanvasGenerationSettings[\s\S]*?nodeAnchorId:\s*String\(nodeId\)/,
  'Generation settings must follow the selected generation node.');
assert.match(styles, /\.ai-image-popover\.ai-composer\.is-node-composer \{[\s\S]*?bottom:\s*auto/);
assert.match(source, /function pruneCanvasNodeConnectionArtifacts[\s\S]*?canvasNodeConnectionDetails[\s\S]*?connection\.remove\(\)/,
  'Orphaned SVG connections must be removed instead of leaving horizontal paint artifacts.');

assert.match(source, /function removeSelectedCanvasNodes\(\)[\s\S]*?editor\.removeNodeId/);
assert.match(source, /event\.key !== 'Delete' && event\.key !== 'Backspace'[\s\S]*?stopImmediatePropagation\(\)[\s\S]*?removeSelectedCanvasNodes\(\)/,
  'Node deletion must stop the hidden ordinary canvas delete handler.');
assert.doesNotMatch(functionBody(source, 'removeSelectedCanvasNodes', 'initCanvasNodeMode'),
  /deleteFile|removeFile|messsAPI|AppState\.files|board:/,
  'Deleting a node must never delete its archived local file.');
assert.doesNotMatch(functionBody(source, 'ensureCanvasNodeEditor', 'applyCanvasModeVisibility'),
  /setTimeout\(reconcileCanvasNodes/,
  'Deleting a node must not recreate it from ordinary canvas state.');

assert.doesNotMatch(styles, /\.board-panel\.is-node-mode #board-zoom-out[\s\S]*?display:\s*none/,
  'Node mode must keep the shared zoom controls visible.');
assert.match(source, /runNodeZoomAction\('board-zoom-out'[,\s\S]*?runNodeZoomAction\('board-zoom-in'/,
  'Node mode zoom controls must operate on the Drawflow editor.');
assert.match(source, /bindCanvasNodePanning\(host, editor\);[\s\S]*?bindCanvasNodeMarqueeSelection\(host\);[\s\S]*?bindCanvasNodeFileDrop\(host\)/);
assert.match(source, /event\.button === 0 && \(event\.altKey \|\| CanvasNodeMode\.spacePressed\)/);
assert.match(source, /function bindCanvasNodeMarqueeSelection/);
assert.match(source, /function finishCanvasNodeMarquee[\s\S]*?const intersects =/);

process.stdout.write('Canvas node mode tests passed.\n');
