'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildCfHDrop, parseCfHDrop } = require('../lib/clipboard-files');

const root = path.join(__dirname, '..');
const boardSource = fs.readFileSync(path.join(root, 'src', 'js', 'board-canvas.js'), 'utf8');
const workspaceSource = fs.readFileSync(path.join(root, 'src', 'js', 'canvas-workspace.js'), 'utf8');
const boardStyles = fs.readFileSync(path.join(root, 'src', 'styles', 'main.css'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const gatewayServerSource = fs.readFileSync(path.join(root, 'gateway', 'src', 'server.js'), 'utf8');
const sidebarSource = fs.readFileSync(path.join(root, 'src', 'js', 'sidebar.js'), 'utf8');
const previewSource = fs.readFileSync(path.join(root, 'src', 'js', 'preview-canvas.js'), 'utf8');
const contextMenuSource = fs.readFileSync(path.join(root, 'src', 'js', 'context-menu.js'), 'utf8');
const themeSource = fs.readFileSync(path.join(root, 'src', 'styles', 'theme.css'), 'utf8');
const boardMediaMetaSource = fs.readFileSync(path.join(root, 'src', 'js', 'board-media-meta.js'), 'utf8');
const modelViewerSource = fs.readFileSync(path.join(root, 'src', 'js', 'model-viewer.js'), 'utf8');
const usageSettingsSource = fs.readFileSync(path.join(root, 'src', 'js', 'usage-settings.js'), 'utf8');
const documentEditorSource = fs.readFileSync(path.join(root, 'src', 'js', 'document-editor.js'), 'utf8');
const leaferLayerSource = fs.readFileSync(path.join(root, 'src', 'js', 'board-leafer-layer.js'), 'utf8');

assert.doesNotMatch(
  indexHtml,
  /id="board-theme-toggle"|id="board-shortcuts-btn"/,
  'Theme and shortcut controls must no longer occupy the center canvas toolbar.'
);
assert.match(
  indexHtml,
  /id="board-canvas-settings"[\s\S]*?id="board-settings-theme"[\s\S]*?id="board-settings-watermark"[\s\S]*?id="board-settings-shortcuts"[\s\S]*?id="board-settings-toggle"/,
  'The lower-right canvas settings must contain theme, AI generation mark and shortcut controls.'
);
assert.match(
  indexHtml,
  /id="board-agent-model-trigger"[^>]*>\s*<span id="board-agent-model-label">Agent<\/span>\s*<svg/,
  'The Canvas Agent model trigger must not show a redundant icon before the active model label.'
);
assert.match(
  workspaceSource,
  /showCanvasLibrary\(\)[\s\S]*?canvasSettings\.hidden = true[\s\S]*?shortcuts-popover'\)\?\.remove\(\)[\s\S]*?showCanvasWorkspace\(\)[\s\S]*?board-canvas-settings'\)\.hidden = false/,
  'Canvas settings must follow the library/workspace visibility state.'
);
assert.match(
  boardStyles,
  /\.board-canvas-settings\s*\{[\s\S]*?right:\s*16px;[\s\S]*?bottom:\s*16px;/,
  'Canvas settings must be anchored in the lower-right corner.'
);
assert.match(
  boardSource,
  /prompt\.addEventListener\('keydown',[\s\S]*?event\.key === 'Enter'[\s\S]*?event\.ctrlKey \|\| event\.metaKey[\s\S]*?form\.requestSubmit\(\)/,
  'Image and video generation must submit on Ctrl/Cmd+Enter while leaving Enter for a newline.'
);
assert.match(
  workspaceSource,
  /board-agent-input'\)\.addEventListener\('keydown',[\s\S]*?event\.key === 'Enter'[\s\S]*?event\.ctrlKey \|\| event\.metaKey[\s\S]*?board-agent-form'\)\.requestSubmit\(\)/,
  'Canvas Agent must submit on Ctrl/Cmd+Enter while leaving Enter for a newline.'
);

assert.doesNotMatch(
  indexHtml,
  /board-performance-switch|data-performance-mode/,
  'The canvas must not expose the removed normal/performance mode control.'
);
assert.doesNotMatch(
  boardStyles,
  /\.board-performance-switch|\.ai-performance-option/,
  'Removed generation-mode controls must not leave stale styling behind.'
);
assert.match(
  boardSource,
  /localStorage\.removeItem\('messs-canvas-performance-mode'\);/,
  'The composer must discard the retired generation-mode preference.'
);
assert.match(
  boardSource,
  /const generationRequest = \{ \.\.\.request, performanceMode: 'normal', watermark: boardAiWatermarkEnabled\(\), canvasId: activeCanvasId\(\) \};/,
  'Board generation must use the standard pricing path.'
);
assert.match(
  boardSource,
  /async function generateAiMediaForBoardV3\(request\)[\s\S]*?const generationRequest = \{ \.\.\.request, performanceMode: 'normal', watermark: boardAiWatermarkEnabled\(\), canvasId: targetCanvasId \};[\s\S]*?MesssCredits\.ensure\(generationRequest\)[\s\S]*?generateAiMedia\(\{ \.\.\.generationRequest, folderId, placements \}\)/,
  'Quick and automated board generation must quote and submit through the standard pricing path.'
);
assert.match(
  boardSource,
  /const request = \{[\s\S]*?performanceMode: 'normal',[\s\S]*?quoteApi\.call\(window\.messsAPI, request\)/,
  'Credit estimates must use the same standard pricing path as generation.'
);
assert.match(
  boardSource,
  /pop\.querySelector\('\.ai-gpt25-background'\)\.hidden = !supportsGpt25Variants;/,
  'Mess Image2.5 background controls must remain available without a performance mode.'
);
assert.match(
  boardSource,
  /const supportedQualities = kind === 'image' && Array\.isArray\(capabilities\.qualities\)/,
  'Image quality controls must continue to follow model capabilities.'
);
assert.doesNotMatch(
  boardSource,
  /supportsGpt25Variants && performanceMode|performanceMode !== 'performance'/,
  'Mess Image2.5 options must not depend on the removed mode.'
);

assert.match(
  boardStyles,
  /\.ai-model-picker-menu\s*\{[\s\S]*?min-width:\s*224px;[\s\S]*?max-height:\s*300px;/,
  'The image and video model menu must keep a comfortably sized selection surface.'
);
assert.match(
  boardStyles,
  /\.ai-model-picker-option\s*\{[\s\S]*?min-height:\s*40px;[\s\S]*?font-size:\s*12\.5px;/,
  'Model choices must remain large enough to scan and click reliably.'
);

assert.match(
  boardSource,
  /BOARD_LIGHTWEIGHT_EFFECTS_ENTER_COUNT = 72;[\s\S]*?BOARD_LIGHTWEIGHT_EFFECTS_EXIT_COUNT = 48;/,
  'Large canvases must use separate enter and exit thresholds to avoid effect-mode thrashing.'
);
assert.doesNotMatch(
  boardSource,
  /if \(f\.videoPreviewReady === true\) void ensurePlayer\(\);/,
  'Video cards must not create decoders before the user interacts with them.'
);
assert.match(
  boardSource,
  /function installBoardMediaControls\(element, file, item, kind\)[\s\S]*?element\._boardEnsureMediaControls[\s\S]*?if \(item\.selected && Board\.selectedCount === 1\)/,
  'Expensive media toolbars must be mounted only for the active single selection.'
);
assert.match(
  boardSource,
  /element\._boardRemoveMediaControls = \(\) => \{[\s\S]*?\.board-image-toolbar, \.board-edit-hint[\s\S]*?delete element\.dataset\.mediaControlsReady/,
  'Media toolbars must be removed after selection changes instead of accumulating across a long canvas session.'
);
assert.match(
  boardSource,
  /const releasePlayer = \(\) => \{[\s\S]*?player\._boardCleanup[\s\S]*?content\.replaceChildren\(preview\)[\s\S]*?const schedulePlayerRelease/,
  'Video hover previews must release their decoder after the interaction grace period.'
);
assert.match(
  workspaceSource,
  /function ensureCanvasWorkspaceItemIndex\(\)[\s\S]*?new Map\(\)[\s\S]*?function upsertCanvasWorkspaceItem\([\s\S]*?itemIndex\.get\(item\.id\)/,
  'Workspace item synchronization must use an index instead of scanning the full canvas for every upsert.'
);
assert.match(
  boardSource,
  /const BOARD_LEAFER_MIN_DPR = 1;[\s\S]*?const BOARD_LEAFER_MAX_DPR = 2;/,
  'The Leafer renderer must use a bounded device-pixel ratio.'
);
const lightweightEffectsSource = boardSource.slice(
  boardSource.indexOf('function syncBoardLightweightEffects()'),
  boardSource.indexOf('function ensureBoardSelectionGroup()')
);
const lightweightPanel = {
  dataset: {},
  enabled: false,
  classList: {
    toggle(_name, enabled) { lightweightPanel.enabled = enabled; }
  }
};
const lightweightSandbox = {
  AppState: { boardItems: [] },
  Board: { lightweightEffects: false },
  BOARD_LIGHTWEIGHT_EFFECTS_ENTER_COUNT: 72,
  BOARD_LIGHTWEIGHT_EFFECTS_EXIT_COUNT: 48,
  document: { getElementById: () => lightweightPanel }
};
vm.runInNewContext(
  `${lightweightEffectsSource}\nthis.syncBoardLightweightEffects = syncBoardLightweightEffects;`,
  lightweightSandbox
);
lightweightSandbox.AppState.boardItems = new Array(71);
lightweightSandbox.syncBoardLightweightEffects();
assert.equal(lightweightSandbox.Board.lightweightEffects, false);
lightweightSandbox.AppState.boardItems = new Array(72);
lightweightSandbox.syncBoardLightweightEffects();
assert.equal(lightweightSandbox.Board.lightweightEffects, true);
assert.equal(lightweightPanel.enabled, true);
assert.equal(lightweightPanel.dataset.boardEffectMode, 'lightweight');
lightweightSandbox.AppState.boardItems = new Array(49);
lightweightSandbox.syncBoardLightweightEffects();
assert.equal(lightweightSandbox.Board.lightweightEffects, true);
lightweightSandbox.AppState.boardItems = new Array(48);
lightweightSandbox.syncBoardLightweightEffects();
assert.equal(lightweightSandbox.Board.lightweightEffects, false);
assert.equal(lightweightPanel.enabled, false);
assert.equal(lightweightPanel.dataset.boardEffectMode, 'full');
assert.match(
  boardStyles,
  /\.board-panel\.is-performance-lite \.board-item:not\(\.is-selected\)[\s\S]*?box-shadow:\s*none;/,
  'Lightweight canvas mode must remove repeated card shadows.'
);
assert.match(
  boardStyles,
  /\.board-panel\.is-performance-lite \.board-image-layer,[\s\S]*?\.board-quick-generate\s*\{\s*transition:\s*none;/,
  'Lightweight canvas mode must remove nonessential media control transitions.'
);
assert.match(
  boardStyles,
  /\.board-panel\.is-performance-lite \.board-agent-panel,[\s\S]*?-webkit-backdrop-filter:\s*none;[\s\S]*?backdrop-filter:\s*none;/,
  'Lightweight canvas mode must avoid expensive Agent and tool backdrop filters.'
);
assert.match(
  boardStyles,
  /\.board-canvas \.board-item-image:not\(\.is-selected\),[\s\S]*?\.board-canvas \.board-item-video:not\(\.is-selected\)[\s\S]*?border:\s*0;[\s\S]*?outline:\s*none;/,
  'Unselected image and video items must not show a frame before the user clicks them.'
);
assert.match(
  boardStyles,
  /\.board-canvas \.board-item-image\.is-selected,[\s\S]*?\.board-canvas \.board-item-video\.is-selected[\s\S]*?outline:\s*none;/,
  'Selected image and video items must remain borderless.'
);
assert.match(
  boardStyles,
  /\.board-item-image\.is-ai-reference\.is-selected\s*\{/,
  'An AI reference marker must not create a frame on an unselected media item.'
);
assert.match(
  boardStyles,
  /\.ai-assistant-panel\.is-fullscreen \.ai-assistant-home p\s*\{\s*animation:\s*none;/,
  'Decorative assistant copy must not animate continuously.'
);
assert.match(
  boardStyles,
  /\.ai-assistant-form::before,[\s\S]*?\.board-agent-form::before\s*\{[\s\S]*?animation:\s*none;/,
  'Composer border decoration must remain static instead of consuming continuous paint work.'
);
assert.match(
  boardStyles,
  /\.ai-assistant-panel::before\s*\{[\s\S]*?animation:\s*none;/,
  'Assistant panel border decoration must remain static instead of consuming continuous paint work.'
);
assert.match(
  boardStyles,
  /\.board-partition-border-beam > span\s*\{[\s\S]*?animation:\s*board-partition-border-beam 1\.05s linear 1 both;/,
  'Secondary partition creation must retain its one-shot confirmation beam.'
);
assert.match(
  boardStyles,
  /\.board-panel\.is-performance-lite \.board-partition-border-beam > span\s*\{[\s\S]*?animation-duration:\s*\.72s;/,
  'Lightweight mode should shorten, not remove, secondary partition confirmation.'
);

assert.match(
  boardSource,
  /const TEXT_NOTE_DEFAULT_COLOR = '#15171c';[\s\S]*?function textNoteUsesThemeColor\(note\)[\s\S]*?note\.colorMode === 'auto'/,
  'Board text needs a theme-aware automatic color mode.'
);
assert.match(
  boardSource,
  /color: TEXT_NOTE_DEFAULT_COLOR, colorMode: 'auto', noFill: false, align: 'left'/,
  'New board text should inherit the active theme foreground by default.'
);
assert.match(
  boardSource,
  /el\.style\.color = note\.noFill \? 'transparent' : displayColor;[\s\S]*?note\.colorMode = 'manual';/,
  'Manual text colors must remain an explicit user choice while automatic text follows the theme.'
);

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
  /const BOARD_WHEEL_SMOOTHING = 0\.28[\s\S]*?function stepBoardZoom\(now\)[\s\S]*?Math\.pow\(1 - BOARD_WHEEL_SMOOTHING/,
  'Canvas wheel zoom must follow a frame-rate-independent smoothing curve instead of jumping per wheel event.'
);
assert.match(
  boardSource,
  /function boardTransform\(\)\s*\{[\s\S]*?return `translate\(\$\{Board\.panX\}px, \$\{Board\.panY\}px\) scale\(\$\{Board\.zoom\}\)`;/,
  'The overflow-based infinite canvas must use a 2D transform so Chromium does not cull media outside its 1px origin.'
);
assert.doesNotMatch(boardSource, /function boardTransform\(\)[\s\S]{0,200}?translate3d\(/,
  'Wheel interaction must not promote the entire overflow-based canvas into one 3D compositor layer.');
assert.match(boardStyles, /\.board-canvas\.is-transforming\s*\{[\s\S]*?will-change:\s*transform;[\s\S]*?\}/,
  'Transforming the infinite canvas should promote only during camera movement.');
assert.match(
  boardSource,
  /const groupMates = item\.isPartition[\s\S]*?: \(item\.selected && selectedMates\.length > 1\)[\s\S]*?\? selectedMates\s*: \[item\]/,
  'Dragging must use the current selection, never a legacy explicit group.');
assert.match(
  boardSource,
  /function onUp\(ev\) \{[\s\S]*?selectRunner\.push\(\{ clientX: ev\.clientX, clientY: ev\.clientY \}\);[\s\S]*?selectRunner\.flush\(\);/,
  'Box selection must include the final mouseup coordinate before committing.');
assert.doesNotMatch(
  boardSource,
  /\(!selectionPartition && candidate\.partitionId\)/,
  'A marquee started outside a partition must still be able to select visible items inside partitions.');
assert.doesNotMatch(
  boardSource,
  /beginBoardInteractionOverview|finishBoardInteractionOverview|is-board-interaction-overview/,
  'Canvas interaction must keep real media DOM visible instead of swapping in a low-resolution interaction overview.'
);
assert.doesNotMatch(
  boardStyles,
  /\.board-viewport\.is-board-interaction-overview[\s\S]*?visibility:\s*hidden/,
  'Canvas interaction must not hide the real media DOM behind a blurred overview layer.'
);
assert.match(
  boardSource,
  /function scheduleBoardInteractionPrefetch\(view\)[\s\S]*?compatibility hook inert[\s\S]*?interactionPrefetchView/,
  'Zoom and pan must leave scene rendering to Leafer and only retain the latest camera target.'
);
assert.doesNotMatch(
  boardSource.slice(
    boardSource.indexOf('function scheduleBoardInteractionPrefetch(view)'),
    boardSource.indexOf('function clearBoardInteractionOverviewWork')
  ),
  /queryLimited\([\s\S]*?queueBoardMounts\(/,
  'Interaction prefetch must not mutate the live DOM mount queue while the transform is moving.'
);
assert.match(
  boardSource,
  /function setBoardZoomTarget[\s\S]*?scheduleBoardInteractionPrefetch\(Board\.zoomTarget\)[\s\S]*?function setBoardPanTarget[\s\S]*?scheduleBoardInteractionPrefetch\(target\)/,
  'Both wheel zoom and wheel pan must warm their destination media.'
);
assert.match(
  boardSource,
  /BOARD_INTERACTION_MEDIA_MOUNTS_PER_FRAME = 6[\s\S]*?BOARD_MOUNT_FRAME_BUDGET_MS = 7[\s\S]*?function processBoardMountQueue\(\)[\s\S]*?interactionActive[\s\S]*?performance\.now\(\) - frameStartedAt >= BOARD_MOUNT_FRAME_BUDGET_MS/,
  'Visible media mounting must catch up faster during interaction while retaining a per-frame work budget.'
);
assert.match(
  boardSource,
  /function queueBoardMounts\(ids, visibleRect, prioritize = false\)[\s\S]*?if \(prioritize && ordered\.length\)[\s\S]*?ordered\.forEach[\s\S]*?pending\.forEach/,
  'Target-visible mounts must run ahead of stale overscan work.'
);
assert.match(
  boardSource,
  /function replaceAiPlaceholders[\s\S]*?AppState\.allBoardItems = workingBoardItems[\s\S]*?renderBoard\(\);[\s\S]*?await window\.messsAPI\.upsertBoardItems\(updates\)/,
  'Durable generated media must display before the duplicate reconciliation write.'
);
assert.match(boardSource,
  /await replaceAiPlaceholders\(placeholders, files, generationRequest, res\.boardItems \|\| \[\]\);\s*generatedFiles = await confirmAiMediaDeliveries\(files\);/,
  'Delivery confirmation must still follow awaited board reconciliation.');
assert.match(
  boardSource,
  /function removeAiPlaceholders\(placeholders\)[\s\S]*?live\.isAiPlaceholder[\s\S]*?if \(!ids\.size\) return/,
  'A persistence failure must not remove a generated result that already replaced its placeholder.'
);
const legacyBoardGeneration = boardSource.slice(
  boardSource.indexOf('async function generateAiMediaForBoard(request'),
  boardSource.indexOf('const AI_IMAGE_RATIOS')
);
assert.match(
  legacyBoardGeneration,
  /const placeholders = createAiPlaceholders\(generationRequest\)[\s\S]*?const placements = placeholders\.map/,
  'The legacy board generation entry point must create placements before submitting to the gateway.'
);
assert.match(
  legacyBoardGeneration,
  /const files = res && Array\.isArray\(res\.files\)[\s\S]*?!files\.length[\s\S]*?removeAiPlaceholders\(placeholders\)/,
  'An empty or failed legacy generation response must remove every pending canvas item.'
);
assert.match(
  legacyBoardGeneration,
  /await replaceAiPlaceholders\(placeholders, files[\s\S]*?catch \(err\) \{[\s\S]*?removeAiPlaceholders\(placeholders\)/,
  'The legacy board entry point must replace multi-file results and clean up on exceptions.'
);
for (const handler of ['removeBackground', 'image-expand', 'image-upscale', 'image-erase']) {
  const start = mainSource.indexOf(`ipcMain.handle('butler:${handler}`);
  const end = mainSource.indexOf("ipcMain.handle('", start + 1);
  const handlerSource = mainSource.slice(start, end === -1 ? undefined : end);
  assert.match(
    handlerSource,
    /let record = null[\s\S]*?record = await addButlerOutputFile[\s\S]*?if \(record\) await rollbackGeneratedMediaFile\(record\)/,
    `Failed ${handler} delivery must roll back the local output file.`
  );
}
assert.match(
  boardSource,
  /function recordBoardMoveHistory[\s\S]*?before:[\s\S]*?after:[\s\S]*?function undoBoardMove[\s\S]*?applyBoardHistory\(entry, 'before'\)/,
  'Board moves must retain their previous coordinates for Ctrl+Z.'
);
assert.match(
  boardSource,
  /function recordBoardItemsHistory[\s\S]*?type, items[\s\S]*?function applyBoardItemsHistory[\s\S]*?canvasWorkspaceAddItem[\s\S]*?canvasWorkspaceRemoveItems/,
  'Added and removed board items must retain complete snapshots for undo and redo.'
);
assert.match(
  boardSource,
  /Delete'[\s\S]*?removeBoardItemsWithHistory\(selected\)/,
  'Keyboard deletion must enter the same undo history as context-menu deletion.'
);
assert.match(
  boardSource,
  /if \(moved\) \{[\s\S]*?recordBoardMoveHistory\(groupStartPositions\)[\s\S]*?shortcutKey === 'z'[\s\S]*?undoBoardMove\(\)/,
  'Completed single or grouped drags must become one keyboard undo step.'
);
assert.match(
  boardSource,
  /function persistBoardMoveHistory[\s\S]*?historyPersistPromise[\s\S]*?upsertBoardItems/,
  'Rapid undo and redo persistence must remain ordered.'
);
assert.match(
  boardSource,
  /aiImagePopoverClickCloser = \(e\) => \{[\s\S]*?e\.composedPath[\s\S]*?eventPath\.includes\(pop\)[\s\S]*?#board-tool-ai-image[\s\S]*?board-item-image, #board-canvas \.board-item-video[\s\S]*?closeAiImagePopover\(\);/,
  'Selecting or removing image/video references must keep the AI composer open while other outside clicks still close it.'
);
assert.match(
  boardSource,
  /const agentInteraction = eventPath\.some\([\s\S]*?#board-agent-panel, #board-agent-history-drawer, \.agent-text-context-menu[\s\S]*?if \(agentInteraction \|\| e\.target\.closest\?\./,
  'Copying or selecting Agent text must keep the AI composer open.'
);
assert.match(
  boardSource,
  /function aiComposerHasDraft\([\s\S]*?\.ai-composer-reference-thumb, \.ai-prompt-style-toggle\.is-active/,
  'The composer must detect unfinished prompt, reference, or style drafts.'
);
assert.match(
  boardSource,
  /window\.addEventListener\('blur', \(\) => \{[\s\S]*?aiComposerHasDraft\(composer\)[\s\S]*?keepOpenAfterBlur/,
  'Leaving the app with a draft must mark the composer to survive focus loss.'
);
assert.doesNotMatch(
  boardSource,
  /window\.addEventListener\('blur', \(\) => \{[\s\S]*?BoardClipboard\.items = \[\]/,
  'The application clipboard must survive focus changes so it can be pasted into another canvas.'
);
assert.match(
  boardSource,
  /if \(pop\.dataset\.keepOpenAfterBlur === 'true'\) return/,
  'A composer with an unfinished draft must survive leaving the app to copy text elsewhere.'
);
assert.match(
  boardSource,
  /function syncAiComposerFullscreenState\(\)[\s\S]*?selectionStart[\s\S]*?classList\.toggle\('is-panel-popover', !isBoardFullscreen\(\)\)[\s\S]*?prompt\.focus\(\{ preventScroll: true \}\)[\s\S]*?setSelectionRange/,
  'Fullscreen changes must preserve the open composer, prompt focus, and caret selection.'
);
assert.doesNotMatch(boardSource, /function enterBoardFullscreen\(/,
  'The removed fullscreen entry point must not return.');
assert.match(boardSource, /function exitBoardFullscreen\(\)[\s\S]*?syncAiComposerFullscreenState\(\)/,
  'Legacy fullscreen cleanup must preserve the composer.');
assert.match(
  boardSource,
  /function setBoardReferenceOrder[\s\S]*?function commitBoardReferenceOrder[\s\S]*?referenceStrip\.addEventListener\('dragover'[\s\S]*?insertBefore\(dragged,[\s\S]*?referenceStrip\.addEventListener\('drop'[\s\S]*?commitBoardReferenceOrder\(\)/,
  'Composer references must support drag-and-drop reordering and persist that order for generation.'
);
assert.match(
  boardSource,
  /referenceKind === 'video'[\s\S]*?availableModes = composerVideoModes\(capabilities\)[\s\S]*?videoModeForReference[\s\S]*?mode\.id === 'video-reference'[\s\S]*?setVideoMode\(videoModeForReference\.id\)/,
  'Clicking a reference video must switch to a capable video-reference mode.'
);
assert.match(boardSource, /referenceMediaTypes:\s*selectedReferenceKinds/);
assert.match(boardSource, /boardReferenceMediaItemAtClientPoint[\s\S]*?isVideoExt\(file\.ext\)/);
assert.match(
  boardSource,
  /const pendingEntry = \{[\s\S]*?fileId:\s*file\.id[\s\S]*?isLoading:\s*true[\s\S]*?const referenceKey = nextBoardReferenceKey\(file\.id\);[\s\S]*?boardReferences\.set\(referenceKey, pendingEntry\);[\s\S]*?await window\.messsAPI\.readFileAsDataUrl\(file\.id\)[\s\S]*?boardReferences\.get\(referenceKey\) !== pendingEntry[\s\S]*?pendingEntry\.dataUrl = dataUrl/,
  'Reference order must be reserved at click time rather than asynchronous file-read completion time.'
);
assert.match(boardSource, /activeVideoMode\.id === 'first-last-frame'[\s\S]*?t\('First', '首'\)[\s\S]*?t\('Last', '尾'\)/);
assert.match(
  boardSource,
  /function nextBoardReferenceKey\(fileId\)[\s\S]*?if \(!boardReferences\.has\(fileId\)\) return fileId;[\s\S]*?`\$\{fileId\}::frame-\$\{boardReferenceSequence\}`/,
  'Repeated use of one image must allocate an independent first/last-frame slot.'
);
assert.match(
  boardSource,
  /const duplicateSameFrame = addingSecondFrame && matchingReferenceKeys\.length === 1;[\s\S]*?if \(matchingReferenceKeys\.length && !duplicateSameFrame\)/,
  'Selecting the same image for the last frame must add a slot instead of toggling the first slot off.'
);
assert.match(
  boardSource,
  /const selectedReferenceIds = \[\.\.\.boardReferences\.values\(\)\]\.map\(\(entry\) => entry\.fileId\)[\s\S]*?referenceFileIds:\s*selectedReferenceIds/,
  'Generation requests must preserve repeated real file IDs from independent reference slots.'
);
assert.match(
  boardSource,
  /function firstLastFrameUnsupportedMessage[\s\S]*?does not support first and last frames[\s\S]*?不支持首尾帧/,
  'Models without first/last-frame support must show an explicit compatibility message.'
);
const referenceSlotFunctions = boardSource.slice(
  boardSource.indexOf('function boardReferenceKeysForFile'),
  boardSource.indexOf('function firstLastFrameUnsupportedMessage')
);
const referenceSlotSandbox = {};
vm.runInNewContext(
  `const boardReferences = new Map();\nlet boardReferenceSequence = 0;\n${referenceSlotFunctions}\nthis.referenceSlotApi = { boardReferences, boardReferenceKeysForFile, nextBoardReferenceKey };`,
  referenceSlotSandbox
);
const repeatedFileId = 'same-frame-file';
const firstReferenceKey = referenceSlotSandbox.referenceSlotApi.nextBoardReferenceKey(repeatedFileId);
referenceSlotSandbox.referenceSlotApi.boardReferences.set(firstReferenceKey, { fileId: repeatedFileId });
const lastReferenceKey = referenceSlotSandbox.referenceSlotApi.nextBoardReferenceKey(repeatedFileId);
referenceSlotSandbox.referenceSlotApi.boardReferences.set(lastReferenceKey, { fileId: repeatedFileId });
assert.notEqual(lastReferenceKey, firstReferenceKey);
assert.deepStrictEqual(
  Array.from(referenceSlotSandbox.referenceSlotApi.boardReferenceKeysForFile(repeatedFileId)),
  [firstReferenceKey, lastReferenceKey]
);
assert.deepStrictEqual(
  Array.from(referenceSlotSandbox.referenceSlotApi.boardReferences.values(), (entry) => entry.fileId),
  [repeatedFileId, repeatedFileId],
  'The generated request must retain the same image in both ordered frame slots.'
);
assert.match(
  boardSource,
  /function videoModeLabel[\s\S]*?'first-last-frame':[\s\S]*?omni:[\s\S]*?function renderVideoModes[\s\S]*?composerVideoModes\(capabilities\)[\s\S]*?function setVideoMode/,
  'Video composer must expose the text, frame, and omni reference modes.'
);
assert.match(
  boardSource,
  /function composerVideoRequestMode[\s\S]*?count === 0[\s\S]*?'text'[\s\S]*?count >= 2 \? 'first-last-frame' : 'first-frame'/,
  'The video UI must submit text mode without references and frame modes when references are selected.'
);
assert.match(
  boardSource,
  /let videoMode = 'text';/,
  'The video composer must open in text-to-video mode.'
);
const videoModeFunctions = boardSource.slice(
  boardSource.indexOf('function supportedVideoModes'),
  boardSource.indexOf('function videoModeReferenceLimit')
);
const videoModeSandbox = {};
vm.runInNewContext(
  `${videoModeFunctions}\nthis.videoModeApi = { composerVideoModes, composerVideoRequestMode, supportsVideoFirstLastFrame };`,
  videoModeSandbox
);
const videoCapabilities = {
  videoModes: [
    { id: 'text', minReferences: 0, maxReferences: 0 },
    { id: 'first-frame', minReferences: 1, maxReferences: 1 },
    { id: 'first-last-frame', minReferences: 2, maxReferences: 2 },
    { id: 'omni', minReferences: 1, maxReferences: 9, mediaTypes: ['image', 'video'] }
  ]
};
assert.deepStrictEqual(
  Array.from(videoModeSandbox.videoModeApi.composerVideoModes(videoCapabilities), (entry) => entry.id),
  ['text', 'first-last-frame', 'omni']
);
assert.equal(videoModeSandbox.videoModeApi.composerVideoRequestMode('', 0, videoCapabilities).id, 'text');
assert.equal(videoModeSandbox.videoModeApi.composerVideoRequestMode('text', 0, videoCapabilities).id, 'text');
assert.equal(videoModeSandbox.videoModeApi.composerVideoRequestMode('text', 1, videoCapabilities).id, 'first-frame');
assert.equal(videoModeSandbox.videoModeApi.composerVideoRequestMode('text', 2, videoCapabilities).id, 'first-last-frame');
assert.equal(videoModeSandbox.videoModeApi.composerVideoRequestMode('first-last-frame', 1, videoCapabilities).id, 'first-frame');
assert.equal(videoModeSandbox.videoModeApi.composerVideoRequestMode('first-last-frame', 2, videoCapabilities).id, 'first-last-frame');
assert.equal(videoModeSandbox.videoModeApi.composerVideoRequestMode('omni', 3, videoCapabilities).id, 'omni');
assert.equal(videoModeSandbox.videoModeApi.supportsVideoFirstLastFrame(videoCapabilities), true);
const firstFrameOnlyCapabilities = {
  videoModes: [
    { id: 'text', minReferences: 0, maxReferences: 0 },
    { id: 'first-frame', minReferences: 1, maxReferences: 1 }
  ]
};
assert.equal(videoModeSandbox.videoModeApi.supportsVideoFirstLastFrame(firstFrameOnlyCapabilities), false);
assert.equal(videoModeSandbox.videoModeApi.composerVideoRequestMode('first-last-frame', 2, firstFrameOnlyCapabilities).id, 'first-frame');
const textOnlyCapabilities = {
  videoModes: [{ id: 'text', minReferences: 0, maxReferences: 0 }]
};
assert.equal(videoModeSandbox.videoModeApi.supportsVideoFirstLastFrame(textOnlyCapabilities), false);
assert.deepStrictEqual(
  Array.from(videoModeSandbox.videoModeApi.composerVideoModes(textOnlyCapabilities), (entry) => entry.id),
  ['text']
);
assert.match(
  boardSource,
  /class="ai-composer-reference-strip"[\s\S]*?class="ai-composer-prompt"[\s\S]*?class="ai-model-picker"[\s\S]*?class="ai-video-mode-picker"/,
  'Selected references must stay in the header while the compact video mode picker sits beside the model.'
);
assert.match(
  boardSource,
  /function videoReferenceSelectionLimit[\s\S]*?supportedVideoModes[\s\S]*?videoReferenceSelectionLimit\(capabilities\)[\s\S]*?videoModeReferenceLimit\(activeMode, capabilities\)/,
  'Video reference selection must honor the active frame or omni mode limit.'
);
assert.match(
  boardSource,
  /function supportedVideoModes[\s\S]*?configuredMinimum === 0[\s\S]*?'first-frame'[\s\S]*?'first-last-frame'[\s\S]*?function supportedVideoMode/,
  'Legacy video models must expose only the text/frame modes allowed by their documented reference limits.'
);
assert.doesNotMatch(
  boardSource,
  /function setVideoMode\([\s\S]{0,800}?boardReferences\.delete/,
  'Changing the video mode must never silently delete selected reference images.'
);
assert.match(
  boardSource,
  /videoMode:\s*kind === 'video' \? selectedMode\.id : null/,
  'The selected video mode must be submitted to the desktop and gateway.'
);
assert.match(
  boardSource,
  /class="ai-camera-control-toggle"[\s\S]*?class="ai-camera-control-panel"[\s\S]*?data-camera-field="\$\{field\}"[\s\S]*?class="ai-camera-motion-grid"/,
  'Video generation must expose the CameraCtrl optics and motion panel.'
);
assert.match(
  boardSource,
  /function renderCameraControl\(\)[\s\S]*?cameraControlToggle\.hidden = !isVideo[\s\S]*?cameraControl\.enabled[\s\S]*?function cycleCameraControl/,
  'Camera control must be visible only in video mode and keep explicit enabled state.'
);
assert.match(
  boardSource,
  /cameraControlToggle\.addEventListener\('click'[\s\S]*?setCameraControlOpen\(cameraControlPanel\.hidden, true\)[\s\S]*?ai-camera-control-disable[\s\S]*?cameraControl\.enabled = false[\s\S]*?ai-camera-control-save[\s\S]*?setCameraControlOpen\(false\)/,
  'Opening, saving, and disabling camera control must remain distinct actions.'
);
assert.match(
  boardSource,
  /cameraControlPanel\.addEventListener\('pointerdown',[\s\S]*?stopPropagation[\s\S]*?cameraControlPanel\.addEventListener\('wheel',[\s\S]*?stopPropagation/,
  'Camera control interactions must not reach the canvas pan or zoom handlers.'
);
assert.match(boardSource, /cameraControl:\s*kind === 'video' \? normalizeAiCameraControl\(cameraControl\) : null/);
assert.match(
  boardSource,
  /retryGeneratedMediaFromDetails[\s\S]*?cameraControl:\s*isVideo \? normalizeAiCameraControl\(generation\.cameraControl\) : null/,
  'Retrying a generated video must preserve its camera settings.'
);
assert.match(boardStyles, /\.ai-camera-optics-grid \{[\s\S]*?grid-template-columns:\s*repeat\(4/);
assert.match(boardStyles, /\.ai-camera-control-panel[\s\S]*?overscroll-behavior:\s*contain/);

const cameraConstants = mainSource.slice(
  mainSource.indexOf('const AI_VIDEO_CAMERA_PRESETS'),
  mainSource.indexOf('const PUBLIC_RELEASE')
);
const cameraFunctions = mainSource.slice(
  mainSource.indexOf('function normalizeVideoCameraControl'),
  mainSource.indexOf('function imageDimensionsWithinCapabilities')
);
const cameraSandbox = {};
vm.runInNewContext(
  `${cameraConstants}\n${cameraFunctions}\nthis.cameraApi = { normalizeVideoCameraControl, videoPromptWithCameraControl };`,
  cameraSandbox
);
const originalVideoPrompt = 'A calm portrait in morning light.';
assert.equal(
  cameraSandbox.cameraApi.videoPromptWithCameraControl(originalVideoPrompt, { enabled: false, motion: 'pan-left' }),
  originalVideoPrompt,
  'Disabled camera control must not alter the provider prompt.'
);
const normalizedCamera = cameraSandbox.cameraApi.normalizeVideoCameraControl({
  enabled: true,
  camera: 'untrusted-camera',
  lens: 'untrusted-lens',
  focalLength: '999mm',
  aperture: 'f0.1',
  motion: 'delete-everything'
});
assert.equal(normalizedCamera.camera, 'arri-alexa-65');
assert.equal(normalizedCamera.lens, 'cooke-panchro');
assert.equal(normalizedCamera.focalLength, '125mm');
assert.equal(normalizedCamera.aperture, 'f1.4');
assert.equal(normalizedCamera.motion, 'static');
const controlledVideoPrompt = cameraSandbox.cameraApi.videoPromptWithCameraControl(originalVideoPrompt, normalizedCamera);
assert.match(controlledVideoPrompt, /^A calm portrait in morning light\.[\s\S]*Camera specification:/);
assert.match(controlledVideoPrompt, /ARRI Alexa 65[\s\S]*Cooke Panchro[\s\S]*125mm[\s\S]*f\/1\.4[\s\S]*locked-off static camera/);
assert.ok(controlledVideoPrompt.length <= 7000, 'The provider prompt must stay inside its fallback limit.');
assert.match(mainSource, /const providerPrompt = kind === 'video'[\s\S]*?videoPromptWithCameraControl\(prompt, request\.cameraControl\)[\s\S]*?generateAiMediaWithFallback\(\s*kind,\s*providerPrompt/);
assert.match(mainSource, /aiGeneration:\s*\{[\s\S]*?cameraControl:\s*mediaKind === 'video' \? normalizeVideoCameraControl\(request\.cameraControl\) : null/);
assert.match(boardStyles, /\.ai-composer-reference-order \{[\s\S]*?pointer-events:\s*none/);
assert.match(
  boardSource,
  /function syncComposerSubmitAvailability[\s\S]*?referencesLoading[\s\S]*?submit\.disabled = !hasProvider \|\| referencesLoading[\s\S]*?form\.addEventListener\('submit'[\s\S]*?boardReferences\.values\(\)[\s\S]*?请等待参考图加载完成/,
  'Generation must wait until every click-ordered reference has finished loading.'
);
assert.match(
  boardSource,
  /remove\.addEventListener\('click',[\s\S]*?event\.stopPropagation\(\);[\s\S]*?removeBoardReference\(referenceKey\)/,
  'Removing one reference must not bubble into the composer outside-click closer.'
);
assert.match(
  mainSource,
  /const maxArchivedReferences = mediaKind === 'video' \? 30 : 14[\s\S]*?const referenceFileIds = Array\.isArray\(request\.referenceFileIds\)[\s\S]*?\.map\(\(value\) => String\(value \|\| ''\)\.trim\(\)\)[\s\S]*?\.filter\(Boolean\)[\s\S]*?\.filter\(\(value\) => !!store\.getFile\(value\)\)[\s\S]*?\.slice\(0, maxArchivedReferences\)/,
  'Generated media metadata must retain repeated first/last-frame file IDs for retry and remix.'
);
assert.match(boardStyles, /\.ai-composer-reference-thumb\.is-dragging[\s\S]*?cursor:\s*var\(--cursor-grabbing\)/);
assert.match(
  boardSource,
  /function supportedImageRatios\([\s\S]*?capabilities\.referenceRatios[\s\S]*?function supportedImageAspectRatio/,
  'Image generation must switch to provider-documented reference-image ratios.'
);
assert.match(
  boardSource,
  /function imageRatioForSize[\s\S]*?capabilities\.sizeRatios[\s\S]*?function imageSizeForRatio[\s\S]*?function supportedImageSizeForRatio/,
  'Mapped image sizes and ratios must be normalized as one coherent option.'
);
assert.match(
  boardSource,
  /submitBoardQuickGeneration[\s\S]*?supportedImageSizeForRatio\(config\.imageSize, original\.aspectRatio, imageCapabilities, referenceFileIds\.length\)[\s\S]*?imageRatioForSize\(imageSize, imageCapabilities\)[\s\S]*?supportedImageAspectRatio\(original\.aspectRatio, imageCapabilities, referenceFileIds\.length > 0\)/,
  'Quick image generation must preserve source orientation while selecting a provider size.'
);
assert.match(workspaceSource, /submitCanvasAgentGeneration[\s\S]*?supportedImageSizeForRatio\(config\.imageSize, original\.aspectRatio, capabilities, references\.referenceFileIds\.length\)/);
assert.match(
  mainSource,
  /const sizeRatios = capabilities\.sizeRatios[\s\S]*?mappedRatio !== effectiveAspectRatio[\s\S]*?invalid-size-ratio/,
  'Desktop validation must reject contradictory mapped image sizes and ratios.'
);
assert.match(
  mainSource,
  /function normalizeImageSize[\s\S]*?\(\?:1\|2\|4\)k\$\/i[\s\S]*?return text\.toUpperCase\(\)[\s\S]*?normalized\.size = size/,
  'Desktop validation must normalize lowercase 1k, 2k, and 4k before provider checks.'
);
assert.match(
  gatewayServerSource,
  /function normalizeImageSize[\s\S]*?\(\?:1\|2\|4\)k\$\/i[\s\S]*?return text\.toUpperCase\(\)[\s\S]*?size: kind === 'image' \? requestedSize/,
  'Gateway validation must forward the same canonical image resolution used for validation.'
);
assert.match(
  boardSource,
  /function boardReferenceMediaItemAtClientPoint[\s\S]*?Board\.spatialIndex\.query/,
  'Overview-mode images and videos must remain selectable as references without dismissing the composer.'
);
assert.match(boardSource, /viewport\.addEventListener\('click',[\s\S]*?boardReferenceMediaItemAtClientPoint[\s\S]*?toggleAiComposerBoardReference/);
assert.match(
  boardSource,
  /viewport\.addEventListener\('wheel',[\s\S]*?const horizontalPan = e\.shiftKey[\s\S]*?setBoardPanTarget[\s\S]*?setBoardZoomTarget/,
  'Plain vertical wheel input must zoom around the pointer while Shift or horizontal trackpad input pans.'
);
assert.match(
  boardSource,
  /modelPickerMenu\.addEventListener\('wheel',[\s\S]*?event\.stopPropagation\(\)[\s\S]*?passive:\s*true/,
  'Scrolling the model picker must not zoom or pan the board behind it.'
);
assert.match(boardSource, /const BOARD_WHEEL_MAX_DELTA = 96;/);
assert.match(boardSource, /const BOARD_WHEEL_PAN_GAIN = 0\.64;/);
assert.match(boardSource, /const BOARD_WHEEL_ZOOM_RATE = 0\.001;/);
assert.match(
  boardSource,
  /function finishBoardWheelInteraction[\s\S]*?isWheelZooming = false[\s\S]*?applyBoardTransform\(\)[\s\S]*?function beginBoardWheelInteraction[\s\S]*?clearTimeout\(Board\.qualityTimer\)[\s\S]*?isWheelZooming = true/,
  'Wheel input must defer expensive canvas reconciliation until scrolling settles.'
);
assert.match(
  boardSource,
  /const lightweight = Board\.isWheelZooming \|\| Board\.isPanning[\s\S]*?Wheel and pan frames must stay compositor-only[\s\S]*?return;/,
  'Active wheel and pan frames must only update the compositor transform and zoom label.'
);
assert.match(boardSource, /if \(!Board\.isWheelZooming\) scheduleBoardFullImagePrewarm/);
assert.match(
  boardSource,
  /function stepBoardZoom[\s\S]*?Object\.assign\(Board, target\)[\s\S]*?Board\.zoomTarget = null/,
  'Wheel motion must follow each animation frame at a linear rate without an inertial tail.'
);
assert.doesNotMatch(
  boardSource,
  /BOARD_OVERVIEW|board-overview-canvas|drawBoardOverview|syncBoardOverviewFallback/,
  'The board source must not retain the removed 2D overview renderer.'
);
assert.match(boardSource, /function setBoardPanTarget[\s\S]*?requestAnimationFrame\(stepBoardZoom\)/);
assert.match(
  boardSource,
  /function cancelBoardViewportMotion[\s\S]*?cancelAnimationFrame\(Board\.zoomFrame\)[\s\S]*?Board\.zoomTarget = null;[\s\S]*?function resetBoardZoomTo100[\s\S]*?cancelBoardViewportMotion\(\);[\s\S]*?BoardEngine\.zoomAtPoint[\s\S]*?Board\.zoom = 1;[\s\S]*?applyBoardTransform\(\);/,
  'Resetting the board must settle pending animation and return to an exact 100% around the viewport center.'
);
assert.match(
  boardSource,
  /function fitBoardItemsToViewport[\s\S]*?cancelBoardViewportMotion\(\);[\s\S]*?Number\.isFinite\(bounds\.w\)[\s\S]*?Board\.zoomLod = null;[\s\S]*?applyBoardTransform\(\);/,
  'Fit-to-content must cancel stale wheel targets and ignore malformed item bounds.'
);
assert.match(
  boardSource,
  /board-bottom-zoom-label'\)\.addEventListener\('click', resetBoardZoomTo100\)[\s\S]*?board-zoom-label'\)\.addEventListener\('click', resetBoardZoomTo100\)/,
  'Both visible zoom percentages must provide a direct 100% reset.'
);
assert.match(indexHtml, /id="board-zoom-label"[^>]*zoom-reset-button[^>]*Reset to 100%/);
assert.match(indexHtml, /id="board-bottom-zoom-label"[^>]*zoom-reset-button[^>]*Reset to 100%/);
assert.match(
  boardSource,
  /function initBoardCanvas[\s\S]*?restoreBoardViewport\(\);[\s\S]*?resetBoardZoomTo100\(\);/,
  'The board must initialize at 100% even when a previous zoom was saved.'
);
assert.match(
  workspaceSource,
  /function showCanvasWorkspace[\s\S]*?restoreBoardViewport\(activeCanvasId\(\)\);[\s\S]*?resetBoardZoomTo100\(\);/,
  'Returning from the canvas library must always enter the canvas at 100%.'
);
assert.match(
  mainSource,
  /function persistentBoardItem[\s\S]*?delete normalized\.selected;[\s\S]*?function ensureCanvasState[\s\S]*?store\.data\.boardItems\.forEach[\s\S]*?delete item\.selected;/,
  'Canvas selection must remain renderer-only and stale saved selections must be migrated away.'
);
assert.match(
  mainSource,
  /ipcMain\.handle\('board:upsertItem'[\s\S]*?persistentBoardItem\(item,[\s\S]*?ipcMain\.handle\('board:upsertItems'[\s\S]*?persistedItems = items[\s\S]*?persistentBoardItem/,
  'Single and bulk canvas persistence must strip transient selection state.'
);
assert.match(
  workspaceSource,
  /function switchCanvas[\s\S]*?allBoardItems\.forEach\(\(item\) => \{ item\.selected = false; \}\)[\s\S]*?function initCanvasWorkspace[\s\S]*?selected: false/,
  'Opening or switching canvases must never inherit a stale multi-selection.'
);
assert.match(
  workspaceSource,
  /function showCanvasLibrary\(\)[\s\S]*?exitBoardFullscreen\(\)[\s\S]*?panel\.classList\.add\('is-canvas-library'\)/,
  'Leaving a maximized canvas for the library must restore compact mode before fullscreen controls are hidden.'
);
assert.doesNotMatch(indexHtml, /id="board-(?:bottom-)?fullscreen-toggle"/,
  'Canvas fullscreen controls must not be rendered.');
assert.match(
  workspaceSource,
  /function setCanvasAgentOpen[\s\S]*?!!open && !board\.classList\.contains\('is-canvas-library'\)[\s\S]*?agent\.classList\.toggle\('is-hidden', !allowed\)/,
  'Messs Agent must open beside a normal canvas without requiring fullscreen.'
);
assert.match(
  workspaceSource,
  /function handleCanvasAgentShortcut[\s\S]*?event\.code !== 'Space'[\s\S]*?event\.ctrlKey \|\| event\.metaKey[\s\S]*?event\.repeat \|\| event\.isComposing[\s\S]*?setCanvasAgentOpen\(!!agent\?\.classList\.contains\('is-hidden'\), \{ focus: true \}\)/,
  'Ctrl or Command plus Space must toggle Messs Agent in the canvas workspace.'
);
assert.doesNotMatch(
  workspaceSource,
  /isEditableTarget[\s\S]*?!isEditableTarget/,
  'Ctrl+Space must remain a reliable Agent toggle even when an editor has focus.'
);
assert.match(indexHtml, /id="board-agent-welcome"[\s\S]*?assets\/logo-mark\.png[\s\S]*?Messs Agent/);
assert.match(indexHtml, /id="board-agent-toggle"[\s\S]*?message-square\.svg[\s\S]*?board-agent-toggle-label">Messs Agent/,
  'The canvas Agent entry should show a chat icon before its label.');
assert.match(workspaceSource, /toggle\?\.querySelector\('\.board-agent-toggle-label'\)[\s\S]*?toggleLabel\.textContent = 'Messs Agent'/,
  'Language refresh must preserve the canvas Agent entry icon.');
assert.match(
  boardStyles,
  /\.board-panel\.is-canvas-library #board-agent-toggle[\s\S]*?display:\s*none;/,
  'The Agent control must disappear in the canvas library but remain available in the workspace.'
);
assert.match(
  boardStyles,
  /\.board-agent-panel \{[\s\S]*?margin:\s*0;[\s\S]*?border:\s*0;[\s\S]*?border-radius:\s*18px 0 0 18px;/,
  'The docked Agent must keep a restrained rounded exposed edge.'
);
assert.match(
  boardStyles,
  /\.resize-handle::before \{[\s\S]*?opacity:\s*0;[\s\S]*?\.resize-handle:hover::before[\s\S]*?opacity:\s*1;[\s\S]*?#resize-handle-board-agent::before \{[\s\S]*?background:\s*linear-gradient[\s\S]*?opacity:\s*0;/,
  'Panel dividers must stay hidden until hover or active dragging.'
);
assert.match(
  boardStyles,
  /\.board-panel:has\(\.board-agent-panel:not\(\.is-hidden\)\) \.board-bottom-bar \{[\s\S]*?left:\s*calc\(\(100% - var\(--agent-w, 420px\)\) \/ 2\)/,
  'The toolbar must stay centered in the drawable canvas when Agent is open.'
);
assert.match(
  boardStyles,
  /\.ai-image-popover\.ai-composer,[\s\S]*?width:\s*min\(760px, calc\(100% - 40px\)\);[\s\S]*?height:\s*176px;[\s\S]*?\.ai-composer-reference-strip \{[\s\S]*?flex:\s*1 1 auto;[\s\S]*?min-height:\s*36px;[\s\S]*?\.ai-composer-prompt \{[\s\S]*?flex:\s*1 1 auto;[\s\S]*?min-height:\s*0;/,
  'The generation composer must use a shorter footprint while reserving its flexible center for a taller prompt.'
);
assert.match(
  boardStyles,
  /\.ai-image-popover\.ai-composer,[\s\S]*?\.ai-image-popover\.ai-composer\.is-panel-popover \{[\s\S]*?bottom:\s*74px;/,
  'Compact and fullscreen generation composers must clear the persistent bottom toolbar.'
);
assert.match(boardStyles, /\.ai-video-mode-picker \{[\s\S]*?position:\s*relative;[\s\S]*?\.ai-video-mode-menu \{[\s\S]*?bottom:\s*calc\(100% \+ 7px\)/);
assert.match(indexHtml, /id="board-agent-references"[\s\S]*?id="board-agent-add-reference"[\s\S]*?id="board-agent-model-menu"[\s\S]*?data-agent-kind="image"[\s\S]*?data-agent-kind="video"/,
  'Canvas Agent must expose references plus image/video model selection.');
assert.match(workspaceSource, /button\.className = `board-agent-model-option is-chat-option[\s\S]*?button\.querySelector\('span'\)\.textContent = entry\.name/,
  'Canvas Agent chat model options must use the full-width chat row variant.');
assert.match(boardStyles, /\.board-agent-model-option\.is-chat-option \{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) 16px;/,
  'Canvas Agent chat model names must not be constrained by the media icon column.');
assert.match(boardStyles, /\.board-agent-form textarea \{[\s\S]*?min-height:\s*58px;[\s\S]*?max-height:\s*112px;/,
  'The Canvas Agent prompt must be approximately half its previous height.');
assert.match(
  boardSource,
  /el\.addEventListener\('click',[\s\S]*?syncCanvasAgentReferencesToSelection\(\)/,
  'Clicking a canvas media item must automatically sync it to Agent references.'
);
assert.match(
  workspaceSource,
  /getElementById\('board-agent-add-reference'\)[\s\S]*?addEventListener\('click', addSelectedImagesToCanvasAgent\)/,
  'Agent references must only be added through the explicit add-reference control.'
);
assert.match(
  workspaceSource,
  /function addSelectedImagesToCanvasAgent\(\) \{[\s\S]*?CanvasWorkspace\.agentMode = 'generate';/,
  'Adding selected canvas media to Agent must switch the panel into generation mode.'
);
assert.match(
  workspaceSource,
  /function addCanvasAgentReference[\s\S]*?CanvasWorkspace\.agentGenerationKind = isVideoExt\(file\.ext\) \? 'video' : 'image';/,
  'Single media references must preserve video generation mode when needed.'
);
assert.match(workspaceSource, /selectedCanvasAgentMediaIds[\s\S]*?isVideoExt/,
  'Canvas Agent references must recognize both images and videos.');
assert.match(workspaceSource, /board-agent-input[\s\S]*?handleCanvasAgentPaste[\s\S]*?event\.stopPropagation\(\)/,
  'Agent input must isolate native copy/paste and import pasted media locally.');
assert.match(
  workspaceSource,
  /board-agent-panel'\)\.addEventListener\('contextmenu', showAgentTextContextMenu\)/,
  'Canvas Agent messages and its input must expose the shared text clipboard menu.'
);
assert.match(
  boardSource,
  /const selection = window\.getSelection[\s\S]*?shortcutKey === 'c'[\s\S]*?!selection\.isCollapsed[\s\S]*?return;/,
  'Canvas copy shortcuts must not intercept a real text selection inside Agent.'
);
assert.match(
  boardSource,
  /const BOARD_UI_EVENT_SELECTOR[\s\S]*?function isBoardUiEventTarget[\s\S]*?viewport\.addEventListener\('pointerdown',[\s\S]*?isBoardUiEventTarget\(e\.target\)[\s\S]*?viewport\.addEventListener\('mousedown',[\s\S]*?isBoardUiEventTarget\(e\.target\)[\s\S]*?viewport\.addEventListener\('wheel',[\s\S]*?isBoardUiEventTarget\(e\.target\)/,
  'Top-level canvas UI must reject pointer, selection, and wheel events before they reach the board.'
);
assert.match(
  workspaceSource,
  /button\.addEventListener\('click', \(event\) => \{[\s\S]*?event\.stopPropagation\(\)[\s\S]*?agentReferenceFileIds\.delete\(fileId\)[\s\S]*?item\.fileId === fileId[\s\S]*?item\.selected = false[\s\S]*?syncBoardSelectionClasses/,
  'Removing an Agent reference must also cancel that image selection on the canvas.'
);
assert.match(indexHtml, /id="board-agent-panel"[^>]*data-board-ui-layer="true"/);
assert.match(workspaceSource, /function addCanvasAgentReference[\s\S]*?agentReferenceFileIds[\s\S]*?function submitCanvasAgentGeneration[\s\S]*?generateAiMediaForBoardV3/,
  'Agent references and model selection must submit through the real board generation pipeline.');
assert.match(workspaceSource, /function canvasAgentMediaProviders[\s\S]*?getConfiguredVideoProviders[\s\S]*?getConfiguredImageProviders[\s\S]*?function renderCanvasAgentModels/,
  'Agent model choices must come from the public provider configuration.');
assert.doesNotMatch(workspaceSource, /else icon\.innerHTML|canvasAgentProviderIcon/,
  'Agent generation choices must not invent icons for models other than Nano Banana Pro.');
assert.match(
  mainSource,
  /parseCfHDrop\(clipboard\.readBuffer\('CF_HDROP'\)\)[\s\S]*?preview\.isImageExt/,
  'Copying an image file in another Windows app must import it from CF_HDROP.'
);
assert.match(
  mainSource,
  /extractClipboardImageSources[\s\S]*?clipboardDataImageBuffer[\s\S]*?clipboard\.readImage\(\)[\s\S]*?downloadClipboardImage/,
  'Clipboard import must fall back from files to renderer images, native bitmaps, HTML and public HTTPS URLs.'
);
assert.match(
  boardSource,
  /transfer\.files[\s\S]*?transfer\.items[\s\S]*?clipboardFileDataUrl\(file\)/,
  'External paste must accept browser clipboard files even when Chromium omits file items.'
);
assert.match(
  boardSource,
  /systemSignature[\s\S]*?getClipboardSignature[\s\S]*?pasteBoardClipboardOrExternal/,
  'External clipboard changes must override stale in-app canvas clipboard contents.'
);
assert.match(
  mainSource,
  /readClipboardNativeImageBuffer[\s\S]*?public\.png[\s\S]*?clipboard\.readBuffer\(format\)/,
  'Native clipboard image formats must be read directly for browser and macOS clipboard providers.'
);
assert.match(
  mainSource,
  /resolvePublicClipboardHost[\s\S]*?isPrivateNetworkAddress[\s\S]*?MAX_CLIPBOARD_IMAGE_BYTES/,
  'Remote clipboard images must block private networks and enforce a download limit.'
);
assert.match(
  boardSource,
  /document\.addEventListener\('paste'[\s\S]*?clipboardImageRequest\(event\.clipboardData\)[\s\S]*?pasteExternalImageWithFeedback/,
  'The real paste event must get first access to browser and chat image files.'
);
assert.match(
  boardSource,
  /addBoardPartitionResizeHandles[\s\S]*?startMemberFrames[\s\S]*?partition\.contentScale[\s\S]*?persistBoardMoveHistory\(changedItems/,
  'Resizing a secondary partition must scale and persist its members together with the frame.'
);
assert.match(
  boardSource,
  /e\.key\.toLowerCase\(\) === 'v'[\s\S]*?clipboardPasteTimer[\s\S]*?pasteBoardClipboardOrExternal/,
  'Ctrl/Cmd+V must use a delayed desktop fallback so the native paste event can run first.'
);
assert.match(
  contextMenuSource,
  /function copyBoardSelection[\s\S]*?setBoardClipboardItems\(items\)[\s\S]*?copyBoardMediaToClipboard[\s\S]*?captureBoardClipboardSignature/,
  'Context-menu canvas copy must use the unified application clipboard and system signature.'
);
assert.match(
  boardStyles,
  /\.board-item \{[\s\S]*?cursor:\s*var\(--cursor-grab\)/,
  'Canvas item cursors must be hand-shaped and theme aware.'
);
assert.match(
  boardStyles,
  /\.canvas-library-card \{[\s\S]*?backdrop-filter:\s*none/,
  'Canvas library cards must not require backdrop compositing.'
);
assert.match(
  workspaceSource,
  /button\.addEventListener\('contextmenu',[\s\S]*?event\.preventDefault\(\);[\s\S]*?event\.stopPropagation\(\);[\s\S]*?Delete folder[\s\S]*?promptDeleteCanvasProject\(project\.id\)[\s\S]*?canvas-project-context-menu/,
  'Right-clicking a folder must open its management menu without triggering the folder filter.'
);
assert.match(indexHtml, /id="canvas-folder-new"[\s\S]*?New folder/,
  'The canvas library toolbar must expose its new-folder entry point.');
assert.match(
  indexHtml,
  /id="canvas-library-view"[\s\S]*?canvas-library-toolbar[\s\S]*?id="canvas-library-search"[\s\S]*?canvas-library-actions[\s\S]*?id="canvas-import"[\s\S]*?id="canvas-folder-new"[\s\S]*?New folder/,
  'Canvas library must retain search, import, and new-folder controls beside the search field.'
);
assert.match(
  workspaceSource,
  /getElementById\('canvas-folder-new'\)\.addEventListener\('click', promptNewProject\)/,
  'The canvas library new-folder control must open the folder creation flow.'
);
assert.doesNotMatch(indexHtml, /id="canvas-header-new"/, 'The duplicate top-right new-canvas plus button must be removed.');
assert.doesNotMatch(indexHtml, /class="sidebar-projects"/, 'The sidebar project management block must be removed.');
assert.doesNotMatch(indexHtml, /class="canvas-library-nav"/, 'The canvas all/recent filter must be removed.');
assert.doesNotMatch(indexHtml, /id="canvas-scope-picker"/, 'The canvas project-type picker must be removed.');
assert.doesNotMatch(indexHtml, /class="canvas-library-project-filter"/, 'The canvas folder filter must be removed.');
assert.doesNotMatch(indexHtml, /id="canvas-new"/, 'The duplicate top toolbar new-canvas action must be removed.');
assert.match(
  workspaceSource,
  /function filteredCanvases\(ignoreQuery = false\)[\s\S]*?return AppState\.canvases[\s\S]*?CanvasWorkspace\.libraryProjectId[\s\S]*?canvas\.name\.toLowerCase\(\)\.includes\(query\)/,
  'Canvas library must apply folder scope and the visible search query.');
assert.doesNotMatch(
  workspaceSource,
  /document\.getElementById\('canvas-scope-picker'\)\.addEventListener\('change'/,
  'Removed canvas project-type controls must not leave stale event bindings.');
assert.match(
  mainSource,
  /store\.data\.canvasProjects = projects\.map\([\s\S]*?scope:\s*normalizeCanvasProjectScope\(project\.scope\)/,
  'Canvas project scope must be normalized before it is persisted.');
assert.doesNotMatch(
  workspaceSource,
  /buildCanvasLibraryCreateCard|grid\.appendChild\(buildCanvasLibraryCreateCard\(\)\)/,
  'The canvas library must not inject a duplicate create-canvas card.'
);
assert.match(
  boardStyles,
  /\.canvas-library-view \{[\s\S]*?display:\s*flex;[\s\S]*?\.canvas-library-toolbar \{[\s\S]*?flex:\s*1 1 680px;[\s\S]*?\.canvas-library-actions \.canvas-library-action\.is-primary \{/,
  'Canvas library controls must use the responsive top toolbar layout.'
);
assert.match(
  workspaceSource,
  /async function promptNewProject[\s\S]*?uniqueCanvasProjectName\(result\.name\)[\s\S]*?canvasWorkspaceSave\(\)[\s\S]*?libraryProjectId = null[\s\S]*?Folder created/,
  'Creating a folder must normalize its name and persist it without creating an unrelated canvas.'
);
assert.match(
  workspaceSource,
  /function showCanvasFolderDialog[\s\S]*?Destination folder[\s\S]*?canvas-folder-select[\s\S]*?canvas-folder-confirm/,
  'Moving a canvas must present a destination-folder selector.'
);
assert.match(
  workspaceSource,
  /action: 'move-folder'[\s\S]*?promptMoveCanvasToFolder\(canvas\.id\)/,
  'Canvas actions must expose moving a canvas into a folder.'
);
assert.match(
  workspaceSource,
  /async function promptMoveCanvasToFolder[\s\S]*?moveCanvasToProject\(canvasId, projectId[\s\S]*?async function moveCanvasToProject[\s\S]*?canvas\.projectId = project\.id[\s\S]*?canvasWorkspaceSave\(\)/,
  'Moving a canvas must update its folder and persist the change.'
);
assert.match(
  workspaceSource,
  /function buildCanvasLibraryFolderCard[\s\S]*?text\/messs-canvas-id[\s\S]*?moveCanvasToProject\(canvasId, project\.id[\s\S]*?async function moveCanvasToProject[\s\S]*?canvas\.projectId = project\.id[\s\S]*?canvasWorkspaceSave\(\)/,
  'Canvas library folders must accept dragged canvas cards and persist the destination folder.'
);
assert.match(
  workspaceSource,
  /card\.draggable = true[\s\S]*?dragstart[\s\S]*?setData\('text\/messs-canvas-id', canvas\.id\)[\s\S]*?dragend/,
  'Canvas library files must expose a native drag source for folder drops.'
);
assert.match(
  workspaceSource,
  /function filteredCanvasProjects[\s\S]*?!isSystemCanvasProject\(project\)[\s\S]*?function renderCanvasLibrary[\s\S]*?projects\.forEach\(\(project\) => grid\.appendChild\(buildCanvasLibraryFolderCard\(project\)\)/,
  'User folders must render with root canvases while the system folder remains hidden.'
);
assert.match(
  workspaceSource,
  /canvas-library-folder-back[\s\S]*?selectAllCanvasLibraryItems/,
  'Opening a folder must provide a reliable return-to-all-canvases control.'
);
assert.match(indexHtml, /id="canvas-library-folder-back"[^>]*All canvases/);
assert.match(
  boardStyles,
  /\.canvas-library-folder-card \{[\s\S]*?min-height:\s*188px;[\s\S]*?\.canvas-library-folder-icon \{[\s\S]*?width:\s*78px;[\s\S]*?height:\s*78px;/,
  'Folders in the canvas library must use a large, easy-to-recognize icon card.'
);
assert.match(
  workspaceSource,
  /async function promptRenameCanvasProject[\s\S]*?uniqueCanvasProjectName\(result\.name, project\.id\)[\s\S]*?canvasWorkspaceSave\(\)/,
  'Folders must support renaming with durable persistence.'
);
assert.match(
  workspaceSource,
  /function toggleCanvasPinned\(canvasId\)[\s\S]*?canvas\.pinned = pinned[\s\S]*?canvasWorkspaceSave\(\)/,
  'Canvas pinning must toggle a durable canvas flag and save it.'
);
assert.match(
  workspaceSource,
  /function filteredCanvases\(ignoreQuery = false\)[\s\S]*?\.sort\(\(a, b\) => new Date\(b\.lastOpenedAt \|\| b\.updatedAt \|\| b\.createdAt \|\| 0\)[\s\S]*?function filteredCanvasProjects/,
  'Canvas cards must follow the user\'s open history, with newly opened canvases first.'
);
assert.match(
  workspaceSource,
  /card\.addEventListener\('contextmenu',[\s\S]*?buildAndShowSimpleMenu\([\s\S]*?toggleCanvasPinned\(canvas\.id\)/,
  'Right-clicking a canvas card must expose the pin action.'
);
assert.match(mainSource, /lastOpenedAt: canvas\.lastOpenedAt \|\| null,[\s\S]*?pinned: canvas\.pinned === true/,
  'Canvas pin state must survive the main-process canvas-state normalization.');
assert.match(indexHtml, /id="canvas-import"[^>]*title="Import canvas"/,
  'The canvas library must expose a .Messs import entry point.');
assert.match(workspaceSource, /async function promptImportCanvas[\s\S]*?window\.messsAPI\.importCanvas\(projectId\)[\s\S]*?switchCanvas\(result\.canvas\.id/,
  'Importing a .Messs package must merge its files and layout, then open the imported canvas.');
assert.match(mainSource, /const CANVAS_PACKAGE_MAGIC = Buffer\.from\('MESSS-CANVAS-PKG'/,
  'Canvas packages must use an application-specific binary signature.');
assert.match(mainSource, /function prepareCanvasPackageExport[\s\S]*?file\.canvasId === canvas\.id \|\| fileIds\.has[\s\S]*?hashArchivedFile/,
  'Canvas export must include every file assigned to the canvas and hash each payload.');
assert.match(mainSource, /ipcMain\.handle\('canvas:export'[\s\S]*?extensions: \['Messs'\][\s\S]*?ensureCanvasPackagePath[\s\S]*?writeCanvasPackage/,
  'Canvas export must write a .Messs package instead of a metadata-only JSON file.');
assert.match(mainSource, /function readCanvasPackageManifest[\s\S]*?payloadOffset \+ payloadBytes !== stat\.size/,
  'Canvas import must reject truncated or extra package data before touching application state.');
assert.match(mainSource, /function extractCanvasPackageFile[\s\S]*?sha256\.toLowerCase\(\) !== String\(entry\.sha256\)\.toLowerCase\(\)/,
  'Every imported canvas file must pass its SHA-256 integrity check.');
assert.match(mainSource, /function replaceCanvasPackageAtomically[\s\S]*?backupPath[\s\S]*?rename\(temporaryPath, targetPath\)/,
  'Export must replace an existing package atomically and restore it if replacement fails.');
const projectDeleteSource = workspaceSource.slice(
  workspaceSource.indexOf('async function promptDeleteCanvasProject'),
  workspaceSource.indexOf('async function promptRenameCanvas(canvasId')
);
assert.match(projectDeleteSource, /AppState\.canvasProjects\.length <= 1/,
  'Deleting a project must preserve at least one project.');
assert.match(
  projectDeleteSource,
  /isSystemCanvasProject\(entry\)[\s\S]*?affectedCanvases[\s\S]*?canvas\.projectId = fallback\.id[\s\S]*?canvasWorkspaceSave\(\)/,
  'Deleting a project must move its canvases to a remaining project before saving.'
);
assert.match(
  projectDeleteSource,
  /previousProjects[\s\S]*?catch \(err\)[\s\S]*?AppState\.canvasProjects = previousProjects[\s\S]*?canvas\.projectId = originalProjectId/,
  'A failed project deletion save must restore project and canvas ownership in the UI.'
);
assert.doesNotMatch(projectDeleteSource, /deleteCanvas\(|deletePermanently\(|removeFile\(/,
  'Deleting a project must never delete canvases or local media files.');
assert.match(indexHtml, /js\/vendor\/perfect-freehand\.js[\s\S]*?js\/board-canvas\.js/,
  'The smooth-stroke library must load before canvas interactions.');
assert.match(boardSource, /window\.PerfectFreehand\.getStroke[\s\S]*?smoothing:\s*0\.72[\s\S]*?streamline:\s*0\.48/,
  'Doodles must use perfect-freehand smoothing instead of raw pixelated line segments.');
assert.match(boardSource, /function pos\(e\)[\s\S]*?clientToBoardCoords\(e\.clientX, e\.clientY\)[\s\S]*?return \[point\.x, point\.y, pressure\]/,
  'Doodle input must be converted into board coordinates before rendering.');
assert.doesNotMatch(boardSource, /keepDoodleScreenSpace|canvas\.addEventListener\('wheel'/,
  'Doodle input must not reassert a screen-locked drawing layer during wheel zoom.');
assert.match(boardSource, /points: stroke\.outline\.map\(\(point\) => \[[\s\S]*?Number\(point\[0\]\) - bounds\.x[\s\S]*?Number\(point\[1\]\) - bounds\.y/,
  'Committed doodles must persist local world-coordinate paths.');
assert.match(boardStyles, /\.board-doodle-canvas\s*\{[\s\S]*?touch-action: none/,
  'The active doodle input surface must remain pointer-capable without a bitmap overlay.');
assert.match(boardSource, /doodlePixelRatio = 1[\s\S]*?Board\.leaferLayer\.renderDoodle/,
  'Active doodles must use Leafer paths instead of allocating a second high-DPI bitmap.');
assert.match(boardSource, /const BOARD_FAILED_SOURCE_LIMIT = 256[\s\S]*?function rememberFailedBoardFullImage[\s\S]*?BOARD_FAILED_SOURCE_LIMIT/,
  'Failed image sources must be bounded to avoid unbounded memory growth.');
assert.match(boardSource, /function syncMountedImageQuality[\s\S]*?Never downgrade a decoded image[\s\S]*?transitionBoardImageQuality\(element, 'full'\)/,
  'Selection refreshes must never downgrade an already decoded image.');
assert.match(boardSource, /const BOARD_LEAFER_FULL_ITEM_LIMIT = 8[\s\S]*?function updateLeaferFullImageWindow[\s\S]*?cachedBoardFullImage/,
  'Leafer full-resolution textures must use a bounded decoded-image window.');
assert.match(boardSource, /function beginTextNoteEditing[\s\S]*?note\.isTextEditing = true[\s\S]*?syncBoardLeaferItems\(note\)/,
  'Native text editing must temporarily hide the Leafer text copy.');
assert.match(boardSource, /function finishTextNoteEditing[\s\S]*?note\.isTextEditing = false[\s\S]*?syncBoardLeaferItems\(note\)/,
  'Leafer text must return after native text editing ends.');
assert.match(boardSource, /e\.key === 'Enter'[\s\S]*?commitActiveTextNote\(\)[\s\S]*?document\.addEventListener\('pointerdown'[\s\S]*?commitActiveTextNote\(\)/,
  'Enter and outside pointer clicks must commit text editing.');
assert.match(boardSource, /content\.contentEditable = 'false'[\s\S]*?beginTextNoteEditing[\s\S]*?contentEl\.contentEditable = 'true'/,
  'Confirmed text must leave editing mode so the board drag handler can move it.');
assert.match(boardSource, /if \(e\.key === 'Enter'\)[\s\S]*?exitDoodleMode\(true\)[\s\S]*?outsideHandler[\s\S]*?exitDoodleMode\(true\)/,
  'Enter and outside pointer clicks must commit the current drawing.');
assert.match(boardStyles, /\.board-text-note\.is-text-editing \{[\s\S]*?background:\s*var\(--bg-elevated\)[\s\S]*?border:\s*1px/,
  'Text input chrome must appear only while editing.');

const qualitySource = boardSource.slice(
  boardSource.indexOf('function syncMountedImageQuality'),
  boardSource.indexOf('function applyBoardTransform')
);
assert.match(
  qualitySource,
  /Board\.isWheelZooming \|\| Board\.isPanning \|\| Board\.zoomFrame \|\| Date\.now\(\) < Board\.interactingUntil/,
  'Image LOD changes must remain frozen for the full pan/zoom interaction.'
);
assert.match(
  qualitySource,
  /const fullIds = new Set\([\s\S]*?if \(!fullIds\.has\(id\) \|\| image\.dataset\.quality === 'full'\) continue;[\s\S]*?transitionBoardImageQuality\(element, 'full'\)/,
  'Image quality must only promote the bounded visible full-resolution set without click-time downgrades.'
);
assert.match(
  boardSource,
  /function preloadBoardFullImage[\s\S]*?await image\.decode\(\)[\s\S]*?cacheBoardFullImage\(source, image\)/,
  'Full images must finish decoding in the background before replacing thumbnails.'
);
assert.match(
  boardSource,
  /function scheduleBoardFullImagePrewarm[\s\S]*?if \(Board\.isWheelZooming \|\| Board\.isPanning\) return[\s\S]*?prewarmMountedFullImages[\s\S]*?scheduleBoardFullImagePrewarm\(Board\.zoomTarget\.zoom\)/,
  'Full-image prewarming must pause during wheel/pan input and resume for programmatic zoom targets.'
);
assert.match(
  boardSource,
  /function prewarmMountedFullImages[\s\S]*?preloadBoardFullImage\(entry\.source\)\.then[\s\S]*?transitionBoardImageQuality\(element, 'full'\)/,
  'A decoded 4K source must replace its enlarged thumbnail immediately, without waiting for wheel settle.'
);
assert.match(
  boardSource,
  /function processBoardMountQueue[\s\S]*?if \(Board\.mountQueue\.size\)[\s\S]*?else \{[\s\S]*?scheduleBoardFullImagePrewarm\(Board\.zoom\)[\s\S]*?scheduleMountedImageQuality\(\)/,
  'Visible images must begin loading originals once the multi-frame mount queue has drained.'
);
assert.match(
  boardSource,
  /fullImagePrewarmZoom[\s\S]*?Math\.max\(Board\.fullImagePrewarmZoom \|\| 0, requestedZoom\)[\s\S]*?targetZoom/,
  'Rapid wheel input must retain the furthest requested zoom for full-image prewarming.'
);
assert.match(
  boardSource,
  /const fullEligible = Board\.visibleIds\.has\(item\.id\)[\s\S]*?cachedBoardFullImage\(fullSource\) \? 'full' : 'thumb'[\s\S]*?img\.loading = Board\.visibleIds\.has\(item\.id\) \? 'eager' : 'lazy'/,
  'Remounted images must use cached full sources only for visible, sufficiently large cards.'
);
assert.match(
  boardSource,
  /function rememberBoardFullImage[\s\S]*?item\.fileId[\s\S]*?BOARD_FULL_IMAGE_READY_LIMIT/,
  'Full-image continuity must use bounded file IDs rather than retaining potentially large data URLs.'
);
assert.match(
  boardSource,
  /BOARD_FULL_IMAGE_CACHE_PIXEL_BUDGET = 24_000_000[\s\S]*?function cacheBoardFullImage[\s\S]*?fullImageCachePixels[\s\S]*?BOARD_FULL_IMAGE_CACHE_PIXEL_BUDGET/,
  'Decoded 4K caching must use a pixel budget so several originals cannot exhaust graphics memory.'
);
assert.match(
  boardSource,
  /function pruneBoardRuntimeCaches[\s\S]*?Board\.metrics\.keys\(\)[\s\S]*?Board\.previewGenerations\.keys\(\)[\s\S]*?BoardPreviewCache\.keys\(\)[\s\S]*?Board\.fullImageReadyFileIds/,
  'Removed files and items must be pruned from long-lived board runtime caches.'
);
assert.match(
  boardSource,
  /function createAiPlaceholders[\s\S]*?firstReference\.sourceWidth[\s\S]*?\['auto', 'adaptive'\]\.includes\(requestedRatio\)[\s\S]*?fitAspectRatio\(placeholderRatio/,
  'Adaptive video placeholders must follow the first reference image dimensions.'
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
  /const BOARD_DOM_ITEM_LIMIT = 72;[\s\S]*?queryLimited\(regions\.mount, BOARD_DOM_ITEM_LIMIT\)[\s\S]*?syncBoardLeaferScene\(force\)/,
  'The board must keep a bounded DOM interaction layer while Leafer renders the complete scene.'
);
assert.match(
  boardSource,
  /const source = Board\.leaferFullItemIds\.has\(itemId\)[\s\S]*?\(thumbSource \|\| fullSource\)/,
  'Leafer must keep thumbnails as its normal scene texture and only promote a bounded decoded window.'
);
assert.doesNotMatch(
  leaferLayerSource,
  /renderSpread\s*:/,
  'Individual Leafer items must not expand the renderer culling area.'
);
assert.match(
  leaferLayerSource,
  /const showSelectionStroke = kind === 'doodle'[\s\S]*?stroke: showSelectionStroke \? stroke : undefined/,
  'Leafer image and video nodes must never draw a selection border.'
);
assert.match(
  boardStyles,
  /\.board-canvas \.board-item-image\.is-selected,[\s\S]*?\.board-item-video\.is-selected \{[\s\S]*?outline:\s*none/,
  'Selected image and video DOM targets must remain borderless.'
);
assert.match(boardSource, /function syncBoardLeaferScene\(force = false\)[\s\S]*?layer\.sync\([\s\S]*?layer\.setTransform/,
  'Leafer must synchronize the complete board scene before applying its world transform.');
assert.match(boardSource, /function ensureBoardLeaferCanvas\(\)[\s\S]*?MesssBoardLeaferLayer[\s\S]*?layer\.init/,
  'The board must initialize one Leafer layer as its renderer.');
assert.match(
  boardSource,
  /function renderBoard\(\)[\s\S]*?rebuildBoardSpatialIndex\(\);[\s\S]*?reconcileMountedBoardItemsAfterDataChange\(\);[\s\S]*?reconcileBoardViewport\(true\);/,
  'Board data refreshes must preserve unchanged mounted media instead of flashing through a full remount.'
);
const renderBoardSource = boardSource.slice(
  boardSource.indexOf('function renderBoard()'),
  boardSource.indexOf('function syncBoardSelectionClasses')
);
assert.doesNotMatch(
  renderBoardSource,
  /clearMountedBoardItems\(\)/,
  'Normal board renders must not discard every decoded image and video.'
);
assert.match(
  boardSource,
  /function boardSelectionBounds\(items\)[\s\S]*?boardItemBounds\(item\)[\s\S]*?w: Math\.max\(1, right - left\)[\s\S]*?h: Math\.max\(1, bottom - top\)/,
  'A multi-selection must derive one world-space bounds rectangle from every selected item.'
);
assert.match(
  boardSource,
  /function syncBoardSelectionGroup\(selectedItems = null\)[\s\S]*?selected\.length >= 2[\s\S]*?group\.style\.left[\s\S]*?group\.style\.width[\s\S]*?group\.style\.height/,
  'Multi-selection must render one shared selection box and hide it for smaller selections.'
);
assert.match(
  boardSource,
  /function startBoardSelectionResize\(event, corner, group\)[\s\S]*?anchorX[\s\S]*?anchorY[\s\S]*?const scale[\s\S]*?item\.x = Math\.round\(anchorX[\s\S]*?item\.width[\s\S]*?syncBoardSelectionGroup\(\)[\s\S]*?recordBoardResizeHistory\(startFrames\)[\s\S]*?persistBoardMoveHistory\(selectedItems\)/,
  'The shared corner handles must scale positions and sizes together, then persist one resize history entry.'
);
assert.match(
  boardSource,
  /function applyBoardResizeHistory\(entry, direction\)[\s\S]*?item\.width = frame\.width[\s\S]*?item\.height = frame\.height[\s\S]*?syncMountedBoardItemGeometry[\s\S]*?persistBoardMoveHistory\(changedItems\)/,
  'Grouped resize must be undoable and redoable with complete item frames.'
);
assert.match(
  boardSource,
  /function scheduleBoardLeaferSync\(\)[\s\S]*?syncBoardLeaferScene\(\)/,
  'Media settling must schedule a Leafer scene refresh.'
);
assert.match(
  boardSource,
  /function boardLeaferPixelRatio\(\)[\s\S]*?BOARD_LEAFER_MAX_DPR[\s\S]*?function ensureBoardLeaferCanvas/,
  'Leafer rendering must use a stable bounded pixel ratio without reallocating during input.'
);
assert.match(
  boardSource,
  /const revision = Number\(Board\.leaferContentRevision\)[\s\S]*?const cacheKey = \[[\s\S]*?activeCanvasId\(\)[\s\S]*?BoardEngine\.hashSet\(ids\)/,
  'Leafer node synchronization must be cached by canvas and data revision.'
);
assert.doesNotMatch(
  boardStyles,
  /\.board-item[^\{]*\{[^}]*content-visibility:\s*auto/,
  'Browser content-visibility must not compete with board viewport virtualization.'
);
assert.match(
  boardSource,
  /function rebuildBoardSpatialIndex\(\)[\s\S]*?Board\.indexItemsRef === AppState\.boardItems[\s\S]*?Board\.indexDirty/,
  'Repeated board renders must reuse the spatial index when the item and file collections are unchanged.'
);
assert.match(
  boardSource,
  /function syncBoardElementViewportState\([\s\S]*?scheduleBoardMediaRelease[\s\S]*?function buildMiniVideoPlayer[\s\S]*?preload = 'none'/,
  'Retained media must release decoders after leaving the viewport and use metadata-only video preload.'
);
assert.match(
  boardSource,
  /function makeBoardItemDraggable[\s\S]*?style\.translate = `\$\{gItem\.x - startLeft\}px \$\{gItem\.y - startTop\}px`[\s\S]*?style\.translate = ''/,
  'Multi-item dragging must update the compositor position during input and commit layout coordinates after release.'
);
assert.match(
  boardStyles,
  /\.board-canvas \{[^}]*will-change:\s*auto[^}]*backface-visibility:\s*visible[^}]*\}[\s\S]*?\.board-canvas\.is-transforming \{[\s\S]*?will-change:\s*transform;/,
  'The overflow-based infinite canvas should promote only during interaction.'
);
assert.doesNotMatch(
  boardStyles,
  /\.board-canvas\.is-transforming \.board-image-layer/,
  'Individual image layers must not be promoted and demoted during every interaction.'
);
assert.match(
  boardStyles,
  /\.board-image-layer \{[\s\S]*?transition:\s*none;/,
  'Image quality changes must not fade through a soft intermediate frame.'
);
assert.match(
  workspaceSource,
  /function canvasAgentThinkingText[\s\S]*?Thinking\.\.\.[\s\S]*?const pending = appendCanvasAgentMessage\('assistant', canvasAgentThinkingText\(\), sessionId\)[\s\S]*?setInterval[\s\S]*?renderAgentMessageContent\(pending, response\.text\)[\s\S]*?clearInterval\(thinkingTimer\)/,
  'Canvas Agent must show an elapsed thinking state until the response replaces it in place.'
);
assert.match(boardSource, /--board-selection-width[\s\S]*?2\.2 \/ Math\.max\(Board\.zoom/);
assert.match(
  boardSource,
  /function boardToolbarScreenScale\(zoom\)[\s\S]*?BOARD_TOOLBAR_COMPACT_START_ZOOM[\s\S]*?BOARD_TOOLBAR_MIN_SCREEN_SCALE[\s\S]*?eased/,
  'Canvas action capsules must become gently more compact only at high zoom.'
);
assert.match(
  boardSource,
  /--board-toolbar-scale[\s\S]*?boardToolbarScreenScale\(Board\.zoom\) \/ Math\.max\(Board\.zoom[\s\S]*?--board-toolbar-gap[\s\S]*?BOARD_TOOLBAR_SCREEN_GAP \/ Math\.max\(Board\.zoom/,
  'Canvas action capsules and their media gap must compensate for the parent canvas scale.'
);
assert.match(
  boardSource,
  /--board-label-scale',\s*'var\(--board-toolbar-scale\)'/,
  'The edit hint and media labels must share the Butler capsule screen-scale compensation.'
);
assert.match(
  boardStyles,
  /\.board-image-toolbar \{[\s\S]*?--board-toolbar-effective-scale:\s*var\(--board-toolbar-scale, 1\)[\s\S]*?bottom:\s*calc\(100% \+ var\(--board-toolbar-gap, 7px\)\)[\s\S]*?scale\(var\(--board-toolbar-effective-scale\)\)/,
  'Image and video action capsules must consume the dedicated zoom-compensated toolbar variables.'
);
assert.match(
  boardStyles,
  /\.board-canvas\.is-transforming \.board-image-toolbar \{\s*transition:\s*none;/,
  'Action capsules must track active wheel zoom without a delayed size trail.'
);
assert.match(
  boardStyles,
  /\.board-edit-hint \{[\s\S]*?top:\s*calc\(100% \+ var\(--board-toolbar-gap, 7px\)\)[\s\S]*?scale\(var\(--board-label-scale, 1\)\)/,
  'The edit hint must use the same zoom-compensated gap and label scale as the Butler capsule.'
);
assert.match(boardStyles, /\.board-item\.is-selected \{[\s\S]*?outline:\s*var\(--board-selection-width/);
assert.match(
  boardStyles,
  /\.board-selection-group-box \{[\s\S]*?pointer-events: none[\s\S]*?\.board-selection-group-box \.board-resize-handle[\s\S]*?pointer-events: auto/,
  'The shared selection box must not block canvas interaction while keeping its handles interactive.'
);
assert.match(
  boardStyles,
  /\.board-canvas\.is-multi-selection \.board-item\.is-selected:not\(\.is-single-selection\) \{[\s\S]*?outline: none/,
  'Individual selection outlines must be suppressed while a shared multi-selection box is visible.'
);
assert.match(
  boardStyles,
  /\.board-canvas\.is-multi-selection \.board-item\.is-selected:not\(\.is-single-selection\) \.board-resize-handle \{[\s\S]*?display: none/,
  'Individual resize handles must be suppressed while a shared multi-selection box is visible.'
);
assert.match(
  boardStyles,
  /\.board-item-image\.is-selected\.is-single-selection,[\s\S]*?\.board-item-video\.is-selected\.is-single-selection[\s\S]*?z-index:\s*100000\s*!important/,
  'A single selected media item must keep its action capsule above neighboring canvas items.'
);
assert.match(boardStyles, /width:\s*min\(760px, calc\(100% - 40px\)\)/, 'The generation composer must keep the shorter centered footprint.');
assert.match(
  boardSource,
  /class="ai-prompt-style-toggle"[\s\S]*?t\('Skill', '技能'\)[\s\S]*?class="ai-prompt-style-panel"[\s\S]*?t\('Skills', '技能库'\)/,
  'The generation composer must expose workspace skills as the reusable guidance picker.'
);
assert.doesNotMatch(boardSource, /class="ai-prompt-style-(?:new|editor|cover-upload)"/, 'Skills may only be selected from the composer; authoring belongs in the skill library.');
assert.match(boardSource, /listWorkspaceResources[\s\S]*?entry\.kind === 'skill'[\s\S]*?AI_SKILL_HISTORY_KEY[\s\S]*?slice\(0, 5\)/, 'The composer must load workspace skills and retain only the five most recent selections.');
assert.match(boardSource, /skillProviderForModel[\s\S]*?modelSelect\.value = provider\.id[\s\S]*?modelSelect\.dataset\.skillModel[\s\S]*?modelPickerTrigger\.disabled = true[\s\S]*?Skill auto-select[\s\S]*?is-skill-auto/, 'A fixed-model skill must own the real provider selection and show the blue automatic model state.');
assert.match(
  boardSource,
  /const upstreamPrompt = promptStyle[\s\S]*?Skill instructions:[\s\S]*?prompt: upstreamPrompt,[\s\S]*?visiblePrompt: text/,
  'The selected skill instructions must be appended only to the upstream request while preserving the visible textarea value.'
);
assert.match(
  boardSource,
  /class="ai-composer-submit"[\s\S]*?assets\/logo-mark\.png[\s\S]*?class="ai-credit-estimate"/,
  'The submit control must use the Messs mark and keep the estimated points inside the button.'
);
assert.match(boardStyles, /\.ai-composer-submit \{[\s\S]*?min-width:\s*112px;[\s\S]*?border-radius:\s*11px;[\s\S]*?backdrop-filter:\s*blur\(14px\)/);
assert.match(
  themeSource,
  /--action-gradient:\s*linear-gradient\(135deg,[\s\S]*?--action-border:[\s\S]*?--action-shadow:/,
  'Primary commands must share the Send button action-surface tokens.'
);
assert.match(
  themeSource,
  /--motion-popup-spring:[\s\S]*?--motion-popup-duration:\s*380ms;[\s\S]*?--motion-menu-duration:\s*300ms;[\s\S]*?--motion-exit-duration:\s*150ms;/,
  'Popups must share a controlled spring opening and a faster exit duration.'
);
assert.match(
  boardStyles,
  /@keyframes modal-spring-in[\s\S]*?@keyframes popup-backdrop-out[\s\S]*?Unified popup motion[\s\S]*?ai-camera-control-panel:not\(\[hidden\]\)[\s\S]*?prefers-reduced-motion/,
  'Dialogs, menus, and camera controls must use the unified motion system and respect reduced motion.'
);
assert.match(
  boardStyles,
  /\.ai-image-popover \{[\s\S]*?animation:\s*centered-surface-spring-in/,
  'Centered AI popovers must preserve their translateX positioning throughout spring motion.'
);
assert.match(
  boardMediaMetaSource,
  /function closeBoardButlerMenu\(\)[\s\S]*?classList\.remove\('is-visible'\)[\s\S]*?setTimeout\(\(\) => menu\.remove\(\), 150\)/,
  'The Butler menu must animate out before its DOM node is removed.'
);
assert.match(
  boardMediaMetaSource,
  /function setBoardButlerPanelPosition[\s\S]*?--board-butler-panel-top[\s\S]*?requestAnimationFrame\(\(\) => \{[\s\S]*?positionBoardButlerPanel\(panel, anchor\)[\s\S]*?clampBoardButlerPanelToViewport\(panel\)/,
  'Butler panels must be remeasured after their forms mount and constrained to the compact viewport.'
);
assert.match(
  boardStyles,
  /\.board-butler-config-panel \{[\s\S]*?--board-butler-panel-top:\s*12px;[\s\S]*?max-height:\s*min\(720px, calc\(100vh - var\(--board-butler-panel-top\) - 12px\)\)/,
  'Butler panel height must account for its actual viewport position.'
);
assert.match(
  sidebarSource,
  /function openAiProviderManager[\s\S]*?_closeTimer[\s\S]*?classList\.remove\('is-closing'\)[\s\S]*?function closeAiProviderManager[\s\S]*?classList\.add\('is-closing'\)[\s\S]*?}, 150\)/,
  'Settings dialogs must cancel stale close timers and animate before hiding.'
);
assert.match(usageSettingsSource, /window\.openAiProviderManager\('usage'\)/);
assert.match(
  previewSource,
  /function closeFullscreenPreview\(\)[\s\S]*?classList\.add\('is-closing'\)[\s\S]*?setTimeout\(finalizeFullscreenPreviewClose, 150\)/,
  'Fullscreen media must remain mounted for its closing animation.'
);
assert.match(
  modelViewerSource,
  /function closeBoardModelViewer\(\)[\s\S]*?const snapshot =[\s\S]*?classList\.add\('is-closing'\)[\s\S]*?setTimeout\(\(\) => disposeBoardModelViewerSnapshot\(snapshot\), 150\)/,
  'The 3D viewer must retain its last rendered frame until its exit motion completes.'
);
assert.match(documentEditorSource, /function closeDocumentEditor[\s\S]*?classList\.add\('is-closing'\)[\s\S]*?}, 150\)/);
assert.match(
  boardStyles,
  /\.pill-btn \{[\s\S]*?background:\s*var\(--action-gradient\);[\s\S]*?box-shadow:\s*var\(--action-shadow\);[\s\S]*?backdrop-filter:\s*blur\(14px\) saturate\(145%\)/,
  'Export, save, login and other pill actions must match the Send button surface.'
);
assert.doesNotMatch(sidebarSource, /Return home|\\u8fd4\\u56de\\u9996\\u9875/, 'The brand menu must not offer a return-to-home action.');
assert.match(
  sidebarSource,
  /lastClickedSidebarId = f\.id;[\s\S]*?selectFileForPreview\(f\.id\)/,
  'A plain sidebar click must establish the range-selection anchor.'
);
const sidebarThumbnailSource = sidebarSource.slice(
  sidebarSource.indexOf('function appendFileThumbnail'),
  sidebarSource.indexOf('function createSidebarDragGhost')
);
assert.ok(
  sidebarThumbnailSource.includes('isModelFile(file)') &&
  sidebarThumbnailSource.includes('fileIconLabel(file.ext)') &&
  sidebarThumbnailSource.includes('file.modelPreviewUrl') &&
  sidebarThumbnailSource.includes('requestModelPreview'),
  'Sidebar and folder thumbnails must render 3D previews with a stable fallback.'
);
assert.match(
  sidebarSource,
  /stopImmediatePropagation\(\);[\s\S]*?selectAllSidebarFiles\(\);[\s\S]*?\}, true\);/,
  'Sidebar Ctrl+A must be captured before the canvas-wide shortcut.'
);
assert.match(previewSource, /clone\.removeAttribute\('style'\)[\s\S]*?clone\.removeAttribute\('width'\)[\s\S]*?clone\.removeAttribute\('height'\)/);
assert.match(previewSource, /async function openFileFullscreenPreview\(file, sourceMedia = null\)[\s\S]*?showFullscreenMedia\(image/);
assert.match(
  previewSource,
  /fullscreen-overlay'\)\.addEventListener\('click',[\s\S]*?event\.target\.closest\([\s\S]*?#fullscreen-stage > img[\s\S]*?#fullscreen-stage video[\s\S]*?video-control-capsule[\s\S]*?if \(!mediaHit\) closeFullscreenPreview\(\)/,
  'Clicking outside the actual fullscreen image or video controls must close the viewer.'
);
assert.match(boardStyles, /\.fullscreen-overlay \{[\s\S]*?z-index:\s*400;[\s\S]*?background:\s*rgba\(5, 6, 8, \.88\)/,
  'The fullscreen media viewer must render above the fullscreen board and Butler overlays.');
assert.match(
  boardStyles,
  /\.fullscreen-stage \{[\s\S]*?--fullscreen-media-max-width:\s*min\(82vw, 1440px\);[\s\S]*?--fullscreen-media-max-height:\s*min\(76vh, 860px\)/,
  'Fullscreen media must use a bounded viewport-relative frame.'
);
assert.match(boardStyles, /\.fullscreen-stage > img \{[\s\S]*?max-width:\s*var\(--fullscreen-media-max-width\);[\s\S]*?max-height:\s*var\(--fullscreen-media-max-height\);/);
assert.match(
  contextMenuSource,
  /function arrangeItemsGrid[\s\S]*?startFrames[\s\S]*?boardItemBounds\(item\)[\s\S]*?compactMediaGrid\(measuredItems,[\s\S]*?gap:\s*20[\s\S]*?columns:\s*Math\.max\(1,\s*Math\.ceil\(Math\.sqrt\(mediaItems\.length\s*\*\s*1\.35\)\)\)[\s\S]*?minWidth:[\s\S]*?recordBoardResizeHistory\(startFrames\)[\s\S]*?persistBoardMoveHistory\(mediaItems\)/,
  'Compact arrangement must reject tiny outlier widths, retain the wide rectangle, and remain undoable.'
);
assert.match(
  contextMenuSource,
  /function showBoardItemContextMenu[\s\S]*?Create duplicate[\s\S]*?Download[\s\S]*?Send to After Effects[\s\S]*?Send to Photoshop[\s\S]*?Delete/,
  'A single canvas file must expose the compact five-command media menu.'
);
assert.match(
  contextMenuSource,
  /function duplicateBoardItem[\s\S]*?pasteBoardClipboard\(item\.x \+ 28, item\.y \+ 28\)/,
  'Creating a duplicate must place an offset canvas copy instead of overlapping the source.'
);
assert.match(
  boardSource,
  /function setBoardClipboardItems[\s\S]*?map\(cloneBoardHistoryItem\)[\s\S]*?sourceCanvasId = BoardClipboard\.items\.length \? sourceCanvasId : null/,
  'Canvas copy must preserve an independent application-level snapshot and its source canvas.'
);
assert.match(
  boardSource,
  /function pasteBoardClipboard[\s\S]*?targetCanvasId = activeCanvasId\(\)[\s\S]*?cloneBoardHistoryItem\(clipboardItem\)[\s\S]*?canvasId: targetCanvasId[\s\S]*?persistBoardItemMutation\(\{ upsert: newItems \}, targetCanvasId\)/,
  'Canvas paste must clone copied items into the currently active canvas and persist them there.'
);
assert.match(
  workspaceSource,
  /function switchCanvas[\s\S]*?AppState\.activeCanvasId = next\.id[\s\S]*?AppState\.boardItems = AppState\.allBoardItems\.filter/,
  'Switching canvases must retain the application-level board clipboard while loading the target canvas.'
);
assert.match(contextMenuSource, /if \(item\.divider\)[\s\S]*?context-menu-divider/,
  'The destructive canvas command must support a visual divider.');
assert.match(contextMenuSource, /function exportBoardItemFile[\s\S]*?exportFile\(item\.fileId\)/);
assert.match(contextMenuSource, /function removeBoardItemFromCanvas[\s\S]*?removeBoardItemsWithHistory\(\[item\]\)/);
assert.match(
  contextMenuSource,
  /function showBoardCanvasContextMenu[\s\S]*?Import files[\s\S]*?pickFiles\(\)[\s\S]*?importFiles[\s\S]*?addFilesToBoard/,
  'Blank-canvas right click must import selected files at the clicked board location.'
);
assert.match(
  mainSource,
  /const supported = normalizedTarget === 'illustrator'[\s\S]*?normalizedTarget === 'photoshop'[\s\S]*?preview\.isImageExt\(ext\)[\s\S]*?preview\.isImageExt\(ext\) \|\| preview\.isVideoExt\(ext\)/,
  'Images must be accepted by both Photoshop and After Effects while videos remain available to After Effects.'
);
assert.doesNotMatch(mainSource, /reason:\s*'not-ai-media'/,
  'Imported images must not be blocked from Photoshop solely because they were not AI generated.');
assert.doesNotMatch(contextMenuSource, /item\.layoutFrame = 'uniform-grid'/);
assert.match(
  boardSource,
  /function restoreLegacyUniformBoardFrames[\s\S]*?width \* sourceHeight \/ sourceWidth[\s\S]*?needsRatioRepair[\s\S]*?delete item\.layoutFrame/,
  'Legacy and distorted media frames must restore source aspect ratios and remove the cropping frame.'
);
assert.match(
  boardSource,
  /function renderBoard\(\)[\s\S]*?restoreLegacyUniformBoardFrames\(\)[\s\S]*?rebuildBoardSpatialIndex\(\)/,
  'Legacy uniform frames must be repaired before board bounds are rebuilt.'
);
assert.match(
  boardSource,
  /function boardMediaResizeAspect[\s\S]*?file\.sourceWidth[\s\S]*?media\.naturalWidth[\s\S]*?sourceHeight \/ sourceWidth/,
  'Media resize must prefer the original file or decoded-media aspect ratio.'
);
assert.match(
  boardSource,
  /const freeResize = !locksMediaAspect && point\.shiftKey;[\s\S]*?locksMediaAspect[\s\S]*?newWidth \* aspectRatio/,
  'Images and videos must remain proportional even while Shift is held.'
);
assert.match(
  boardSource,
  /function observeBoardMediaIntrinsicRatio[\s\S]*?syncBoardMediaIntrinsicRatio[\s\S]*?loadedmetadata/,
  'Missing legacy media dimensions must be repaired after the source decodes.'
);
assert.match(
  themeSource,
  /\[data-theme="dark"\][\s\S]*?--bg-deep:\s*#070808;[\s\S]*?--bg-base:\s*#0b0c0d;[\s\S]*?--bg-elevated:\s*#181a1c;[\s\S]*?--bg-surface:\s*#111315;[\s\S]*?--bg-surface-2:\s*#24272a;[\s\S]*?--bg-frame:\s*#0b0c0d;/,
  'Dark mode must preserve distinct frame, workspace, panel, card, and interaction layers.'
);
assert.match(
  themeSource,
  /\[data-theme="light"\][\s\S]*?--bg-base:\s*#ffffff;[\s\S]*?--bg-surface:\s*#f6f6f6;[\s\S]*?--bg-surface-2:\s*#ededed;[\s\S]*?--bg-frame:\s*#ffffff;[\s\S]*?--board-workspace-bg:\s*#ffffff;/,
  'Light mode must use the neutral gray-white hierarchy from the supplied reference.'
);
assert.doesNotMatch(
  boardSource,
  /replaceAiPlaceholders[\s\S]*?requestAnimationFrame\(\(\) => fitBoardItemsToViewport\(updates\)\)/,
  'Replacing a generation placeholder must preserve the current canvas view instead of flashing through auto-fit.'
);
assert.match(
  boardSource,
  /function replaceAiPlaceholders[\s\S]*?const livePlaceholder = itemIndex >= 0 \? workingBoardItems\[itemIndex\] : placeholder;[\s\S]*?\.\.\.\(persistedItem \|\| \{\}\)[\s\S]*?x: livePlaceholder\.x,[\s\S]*?y: livePlaceholder\.y,[\s\S]*?width: livePlaceholder\.width,[\s\S]*?zIndex: livePlaceholder\.zIndex/,
  'Generated media must replace the live placeholder in place, even when it moved while the request was running.'
);
assert.match(
  mainSource,
  /function addGeneratedMediaBoardItem[\s\S]*?Math\.min\(360, numberOr\(placement\.width, 300\)\)/,
  'Generated 2K/4K source dimensions must never become oversized canvas placement dimensions.'
);
assert.match(
  boardSource,
  /function keepBoardSelectionAboveComposer[\s\S]*?Board\.panY -=[\s\S]*?applyBoardTransform\(\)/,
  'Opening the generation composer must pan covered selections into the visible canvas without changing zoom.'
);
assert.match(
  boardSource,
  /sizeGroup\.classList\.toggle\('is-resolution-groups', showResolutionGroups\);[\s\S]*?sizeGroup\.classList\.toggle\('is-grid', !showResolutionGroups && resolutions\.length > 6\)/,
  'Seedance must use labelled resolution groups while other large catalogs keep the compact scrolling grid.'
);
assert.match(
  boardStyles,
  /\.ai-segmented\.is-grid \{[\s\S]*?max-height:\s*124px;[\s\S]*?grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\);[\s\S]*?overflow-y:\s*auto;/,
  'The GPT Image 2 size catalog must remain contained inside the generation options panel.'
);
assert.match(boardStyles, /\.app-titlebar \{[\s\S]*?background:\s*var\(--bg-frame, var\(--bg-base\)\)/,
  'The light title bar must use the sampled frame gray while dark mode keeps its fallback.');
assert.match(
  themeSource,
  /\[data-theme="dark"\][\s\S]*?--board-workspace-bg:\s*#070808/,
  'Dark canvas modes must share the existing node-canvas background color.'
);
assert.match(
  boardStyles,
  /\[data-theme="dark"\] \.canvas-library-view \{ background: var\(--bg-deep\); \}[\s\S]*?\[data-theme="dark"\] \.canvas-library-content \{ background: var\(--bg-deep\); \}/,
  'The dark canvas library must keep its content on the shared deep workspace surface.'
);
assert.match(
  boardStyles,
  /\.board-viewport \{[\s\S]*?background-color:\s*var\(--board-workspace-bg\)[\s\S]*?\.board-node-mode \{[\s\S]*?background-color:\s*var\(--board-workspace-bg\)/,
  'Canvas and node mode must render on the same workspace background.'
);
assert.match(contextMenuSource, /key:\s*'scale-max'[\s\S]*?'放大至最大'/);
assert.match(contextMenuSource, /key:\s*'scale-100'[\s\S]*?'放大至100%'/);
assert.match(contextMenuSource, /key:\s*'scale-min'[\s\S]*?'缩小至最小'/);
assert.match(contextMenuSource, /function scaleBoardItemsToWidth[\s\S]*?previousHeight \* width \/ previousWidth/);
assert.match(boardSource, /const DEFAULT_BOARD_ITEM_WIDTH = 220;/);
assert.match(contextMenuSource, /case 'scale-100':[\s\S]*?scaleBoardItemsToWidth\(selected, DEFAULT_BOARD_ITEM_WIDTH\)/);
assert.match(boardStyles, /\[data-theme="dark"\] \.board-image-toolbar,[\s\S]*?\[data-theme="dark"\] \.board-butler-menu/);
assert.match(
  contextMenuSource,
  /const isVideo = !!\(file && isVideoExt\(file\.ext\)\);[\s\S]*?if \(isImage \|\| isVideo\) \{[\s\S]*?Send to After Effects[\s\S]*?'after-effects'/,
  'Every canvas video must expose Send to After Effects, not only generated videos.'
);
assert.match(
  contextMenuSource,
  /function openCanvasUsageDetails\(canvasId\)[\s\S]*?requestedCanvasId = [^;]*activeCanvasId\(\)[\s\S]*?getCanvasCreditUsage\(requestedCanvasId\)[\s\S]*?renderCanvasUsageDetails/,
  'Canvas usage must query the requested canvas, defaulting to the active canvas.'
);
assert.match(
  contextMenuSource,
  /function renderCanvasUsageDetails[\s\S]*?breakdown\.image[\s\S]*?breakdown\.video[\s\S]*?breakdown\['3d'\][\s\S]*?recorded settlements/,
  'Canvas usage must show recorded settlements.'
);
assert.doesNotMatch(contextMenuSource, /Original settlement record|\u539f\u59cb\u7ed3\u7b97\u8bb0\u5f55/,
  'The obsolete original-settlement metric must not be exposed in the UI.');
assert.match(indexHtml, /id="canvas-usage-overlay"[\s\S]*?id="canvas-usage-summary"[\s\S]*?id="canvas-usage-rows"/,
  'Canvas usage needs an accessible summary and detailed rows dialog.');
assert.match(
  mainSource,
  /function ensureCanvasUsageLedger\(\)[\s\S]*?canvasUsageEntryFromFile[\s\S]*?async function canvasCreditUsage\(canvasId\)[\s\S]*?getCanvasUsage\(id\)[\s\S]*?breakdown[\s\S]*?ipcMain\.handle\('canvas:getCreditUsage'/,
  'The main process must preserve an append-only local ledger, merge cloud billing, and expose a dedicated IPC route.'
);
assert.match(mainSource, /recordCanvasUsageFile\(record\)/,
  'Generated and Butler outputs must enter the canvas ledger before they can be deleted.');
assert.match(mainSource, /accountingRequestId:\s*generated\.accountingRequestId/,
  'Generated output records must retain the gateway billing request id for exact cloud deduplication.');
const ledgerSource = mainSource.slice(
  mainSource.indexOf('function canvasUsageKind'),
  mainSource.indexOf('async function canvasCreditUsage')
);
const ledgerSandbox = {
  store: { data: { files: [], canvasUsageLedger: [] } },
  quoteMediaCredits: (request) => request && request.kind === 'video'
    ? { unitCredits: 202.5073064868, totalCredits: 1216 }
    : { unitCredits: 12, totalCredits: 12 },
  CREDIT_PRICING_VERSION: '202608210002',
  BUTLER_IMAGE_TOOL_CREDITS: {}
};
vm.runInNewContext(
  `${ledgerSource}\nthis.canvasLedgerApi = { ensureCanvasUsageLedger, recordCanvasUsageFile, preserveSettledCanvasUsage };`,
  ledgerSandbox
);
const billedFile = {
  id: 'generated-file-1',
  name: 'Generated.png',
  canvasId: 'canvas-history',
  importedAt: '2026-08-01T00:00:00.000Z',
  aiGeneration: {
    kind: 'image',
    providerId: 'image-6',
    modelName: 'GPT Image 2',
    size: '4K',
    credits: 24,
    accountingRequestId: '00000000-0000-4000-8000-000000000099',
    createdAt: '2026-08-01T00:00:00.000Z'
  }
};
ledgerSandbox.canvasLedgerApi.recordCanvasUsageFile(billedFile);
assert.equal(ledgerSandbox.store.data.canvasUsageLedger.length, 1);
ledgerSandbox.store.data.files = [billedFile];
ledgerSandbox.canvasLedgerApi.ensureCanvasUsageLedger();
assert.equal(ledgerSandbox.store.data.canvasUsageLedger.length, 1, 'Restart backfill must not duplicate a billed output.');
ledgerSandbox.store.data.files = [];
ledgerSandbox.store.data.canvasUsageLedger = JSON.parse(JSON.stringify(ledgerSandbox.store.data.canvasUsageLedger));
ledgerSandbox.canvasLedgerApi.ensureCanvasUsageLedger();
assert.equal(ledgerSandbox.store.data.canvasUsageLedger.length, 1, 'Deleting media and reloading after an update must preserve canvas usage.');
assert.equal(ledgerSandbox.store.data.canvasUsageLedger[0].estimatedCredits, 24);
assert.equal(ledgerSandbox.store.data.canvasUsageLedger[0].creditsCharged, 24);
assert.equal(ledgerSandbox.store.data.canvasUsageLedger[0].credits, 24);
assert.equal(ledgerSandbox.store.data.canvasUsageLedger[0].canvasId, 'canvas-history');
const staleVideo = {
  id: 'generated-video-1',
  name: 'Seedance.mp4',
  canvasId: 'canvas-history',
  importedAt: '2026-08-01T00:00:00.000Z',
  aiGeneration: {
    kind: 'video', providerId: 'video-3', resolution: '4K-ESR', duration: 6,
    credits: 151, accountingRequestId: '00000000-0000-4000-8000-000000000100',
    createdAt: '2026-08-01T00:00:00.000Z'
  }
};
ledgerSandbox.canvasLedgerApi.recordCanvasUsageFile(staleVideo);
assert.equal(
  ledgerSandbox.store.data.canvasUsageLedger.find((entry) => entry.sourceFileId === staleVideo.id).estimatedCredits,
  151,
  'Canvas history uses its saved receipt rather than repricing the past.'
);
assert.equal(
  ledgerSandbox.store.data.canvasUsageLedger.find((entry) => entry.sourceFileId === staleVideo.id).creditsCharged,
  151,
  'Canvas history must retain the old settled charge as an audit record.'
);
const preservedVideo = ledgerSandbox.canvasLedgerApi.preserveSettledCanvasUsage({
  ...ledgerSandbox.store.data.canvasUsageLedger.find((entry) => entry.sourceFileId === staleVideo.id),
  status: 'succeeded'
});
assert.equal(preservedVideo.historicalCreditsCharged, 151);
assert.equal(preservedVideo.creditsCharged, 151);
assert.equal(preservedVideo.credits, 151, 'Settled canvas reports must use the immutable settled charge.');
assert.equal(
  ledgerSandbox.store.data.canvasUsageLedger.find((entry) => entry.sourceFileId === staleVideo.id).creditsCharged,
  151,
  'Display repricing must not mutate the persisted canvas ledger.'
);
assert.match(
  workspaceSource,
  /async function loadCanvasAgentHistory\(\)[\s\S]*?getCanvasAgentHistory[\s\S]*?mergeCanvasAgentSessions\(durable, local, CanvasWorkspace\.agentSessions\)/,
  'Canvas Agent history must be durable, favoritable, and searchable by date.'
);
assert.match(workspaceSource, /saveCanvasAgentHistory/);
assert.match(workspaceSource, /agentHistoryFavoritesOnly/);
assert.match(workspaceSource, /canvasAgentHistoryDate/);
assert.match(workspaceSource, /function canvasAgentSessionsFor\(canvasId = activeCanvasId\(\)\)/,
  'Canvas Agent history must be scoped to the active canvas.');
assert.match(workspaceSource, /migrateLegacyCanvasAgentSessions\([\s\S]*?activeCanvasId\(\)/,
  'Legacy Agent sessions without a canvas id must be migrated instead of duplicated across canvases.');
assert.match(workspaceSource, /previousCanvasId !== next\.id[\s\S]*?persistActiveCanvasAgentSession\(\)[\s\S]*?restoreCanvasAgentSessionForCanvas\(next\.id\)/,
  'Switching canvases must save the old Agent session and restore the new canvas session.');
assert.match(workspaceSource, /filter\(\(session\) => canvasAgentSessionCanvasId\(session\) === activeCanvasId\(\)\)/,
  'The Agent history drawer must only list conversations from the current canvas.');
assert.match(workspaceSource, /if \(!session \|\| canvasAgentSessionCanvasId\(session\) !== activeCanvasId\(\)\) return;/,
  'A conversation from another canvas must not be loadable into the current canvas.');

process.stdout.write('Canvas interaction tests passed.\n');
