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
const sidebarSource = fs.readFileSync(path.join(root, 'src', 'js', 'sidebar.js'), 'utf8');
const previewSource = fs.readFileSync(path.join(root, 'src', 'js', 'preview-canvas.js'), 'utf8');
const contextMenuSource = fs.readFileSync(path.join(root, 'src', 'js', 'context-menu.js'), 'utf8');
const themeSource = fs.readFileSync(path.join(root, 'src', 'styles', 'theme.css'), 'utf8');

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
  /function recordBoardMoveHistory[\s\S]*?before:[\s\S]*?after:[\s\S]*?function undoBoardMove[\s\S]*?applyBoardMoveHistory\(entry, 'before'\)/,
  'Board moves must retain their previous coordinates for Ctrl+Z.'
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
  /aiImagePopoverClickCloser = \(e\) => \{[\s\S]*?e\.composedPath[\s\S]*?eventPath\.includes\(pop\)[\s\S]*?if \(e\.target\.closest\('#board-canvas \.board-item-image'\)\) return;[\s\S]*?closeAiImagePopover\(\);/,
  'Selecting or removing an image reference must keep the AI composer open while other outside clicks still close it.'
);
assert.match(
  boardSource,
  /function setBoardReferenceOrder[\s\S]*?function commitBoardReferenceOrder[\s\S]*?referenceStrip\.addEventListener\('dragover'[\s\S]*?insertBefore\(dragged,[\s\S]*?referenceStrip\.addEventListener\('drop'[\s\S]*?commitBoardReferenceOrder\(\)/,
  'Composer references must support drag-and-drop reordering and persist that order for generation.'
);
assert.match(
  boardSource,
  /const pendingEntry = \{[\s\S]*?isLoading:\s*true[\s\S]*?boardReferences\.set\(file\.id, pendingEntry\);[\s\S]*?await window\.messsAPI\.readFileAsDataUrl\(file\.id\)[\s\S]*?boardReferences\.get\(file\.id\) !== pendingEntry[\s\S]*?pendingEntry\.dataUrl = dataUrl/,
  'Reference order must be reserved at click time rather than asynchronous file-read completion time.'
);
assert.match(boardSource, /order\.textContent = String\(\[\.\.\.boardReferences\.keys\(\)\]\.indexOf\(fileId\) \+ 1\)/);
assert.match(boardStyles, /\.ai-composer-reference-order \{[\s\S]*?pointer-events:\s*none/);
assert.match(
  boardSource,
  /function syncComposerSubmitAvailability[\s\S]*?referencesLoading[\s\S]*?submit\.disabled = !hasProvider \|\| referencesLoading[\s\S]*?form\.addEventListener\('submit'[\s\S]*?boardReferences\.values\(\)[\s\S]*?请等待参考图加载完成/,
  'Generation must wait until every click-ordered reference has finished loading.'
);
assert.match(
  boardSource,
  /remove\.addEventListener\('click',[\s\S]*?event\.stopPropagation\(\);[\s\S]*?removeBoardReference\(fileId\)/,
  'Removing one reference must not bubble into the composer outside-click closer.'
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
  /const sizeRatios = capabilities\.sizeRatios[\s\S]*?mappedRatio !== aspectRatio[\s\S]*?invalid-size-ratio/,
  'Desktop validation must reject contradictory mapped image sizes and ratios.'
);
assert.match(
  boardSource,
  /function boardImageItemAtClientPoint[\s\S]*?Board\.spatialIndex\.query/,
  'Overview-mode images must remain selectable as references without dismissing the composer.'
);
assert.match(boardSource, /viewport\.addEventListener\('click',[\s\S]*?boardImageItemAtClientPoint[\s\S]*?toggleAiComposerBoardReference/);
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
  /function stepBoardZoom[\s\S]*?Object\.assign\(Board, target\)[\s\S]*?Board\.zoomTarget = null/,
  'Wheel motion must follow each animation frame at a linear rate without an inertial tail.'
);
assert.match(boardSource, /function setBoardPanTarget[\s\S]*?requestAnimationFrame\(stepBoardZoom\)/);
assert.match(
  boardSource,
  /function resetBoardZoomTo100[\s\S]*?cancelAnimationFrame\(Board\.zoomFrame\)[\s\S]*?BoardEngine\.zoomAtPoint[\s\S]*?Board\.zoom = 1;[\s\S]*?applyBoardTransform\(\);/,
  'Resetting the board must settle pending animation and return to an exact 100% around the viewport center.'
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
  workspaceSource,
  /function showCanvasLibrary\(\)[\s\S]*?exitBoardFullscreen\(\)[\s\S]*?panel\.classList\.add\('is-canvas-library'\)/,
  'Leaving a maximized canvas for the library must restore compact mode before fullscreen controls are hidden.'
);
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
  boardStyles,
  /\.board-panel\.is-fullscreen:has\(\.board-agent-panel:not\(\.is-hidden\)\) \.board-bottom-bar \{[\s\S]*?left:\s*calc\(\(100% - var\(--agent-w, 320px\) - 12px\) \/ 2\)/,
  'The fullscreen toolbar must stay centered in the drawable canvas when Agent is open.'
);
assert.match(
  boardStyles,
  /\.ai-image-popover\.ai-composer,[\s\S]*?height:\s*142px;[\s\S]*?\.ai-image-popover\.ai-composer:has\(\.ai-composer-reference-strip:not\(\[hidden\]\)\)[\s\S]*?height:\s*194px;/,
  'The generation composer must stay flat by default and grow only for reference thumbnails.'
);
assert.match(indexHtml, /id="board-agent-references"[\s\S]*?id="board-agent-add-reference"[\s\S]*?id="board-agent-model-menu"[\s\S]*?data-agent-kind="image"[\s\S]*?data-agent-kind="video"/,
  'Canvas Agent must expose references plus image/video model selection.');
assert.match(boardStyles, /\.board-agent-form textarea \{[\s\S]*?min-height:\s*58px;[\s\S]*?max-height:\s*112px;/,
  'The Canvas Agent prompt must be approximately half its previous height.');
assert.doesNotMatch(
  boardSource,
  /el\.addEventListener\('click',[\s\S]*?syncCanvasAgentReferencesToSelection\(\)/,
  'Clicking a canvas image must not automatically add it to Agent references.'
);
assert.match(
  workspaceSource,
  /getElementById\('board-agent-add-reference'\)[\s\S]*?addEventListener\('click', addSelectedImagesToCanvasAgent\)/,
  'Agent references must only be added through the explicit add-reference control.'
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
  mainSource,
  /resolvePublicClipboardHost[\s\S]*?isPrivateNetworkAddress[\s\S]*?MAX_CLIPBOARD_IMAGE_BYTES/,
  'Remote clipboard images must block private networks and enforce a download limit.'
);
assert.match(
  boardSource,
  /setTimeout\(\(\) => \{[\s\S]*?pasteExternalImageWithFeedback[\s\S]*?document\.addEventListener\('paste'[\s\S]*?clipboardImageRequest\(event\.clipboardData\)/,
  'The real paste event must get first access to browser and chat image files.'
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
assert.match(indexHtml, /js\/vendor\/perfect-freehand\.js[\s\S]*?js\/board-canvas\.js/,
  'The smooth-stroke library must load before canvas interactions.');
assert.match(boardSource, /window\.PerfectFreehand\.getStroke[\s\S]*?smoothing:\s*0\.72[\s\S]*?streamline:\s*0\.48/,
  'Doodles must use perfect-freehand smoothing instead of raw pixelated line segments.');
assert.match(boardSource, /window\.devicePixelRatio[\s\S]*?canvas\.width[\s\S]*?doodlePixelRatio/,
  'The doodle surface must render at device pixel ratio.');
assert.match(boardSource, /16_000_000[\s\S]*?maximumPixelRatio[\s\S]*?doodlePixelRatio/,
  'High-DPI doodles must retain a bounded backing-store pixel count on large displays.');
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
  /Board\.isPanning \|\| Board\.zoomFrame \|\| Date\.now\(\) < Board\.interactingUntil/,
  'Image LOD changes must remain frozen for the full pan/zoom interaction.'
);
assert.match(
  qualitySource,
  /image\.dataset\.quality === 'full' && quality === 'thumb'/,
  'Decoded full-resolution images must not downgrade and flash during later zoom changes.'
);
assert.match(
  boardSource,
  /function preloadBoardFullImage[\s\S]*?await image\.decode\(\)[\s\S]*?cacheBoardFullImage\(source, image\)/,
  'Full images must finish decoding in the background before replacing thumbnails.'
);
assert.match(
  boardSource,
  /function scheduleBoardFullImagePrewarm[\s\S]*?prewarmMountedFullImages[\s\S]*?scheduleBoardFullImagePrewarm\(Board\.zoomTarget\.zoom\)/,
  'Zoom targets must prewarm full images before the visible quality threshold is crossed.'
);
assert.match(
  boardSource,
  /fullImageReadyFileIds\.has\(String\(f\.id \|\| ''\)\) \|\| cachedBoardFullImage\(fullSource\)[\s\S]*?img\.loading = 'eager'/,
  'Remounted images must remember decoded full sources instead of flashing back to a thumbnail after cache eviction.'
);
assert.match(
  boardSource,
  /function rememberBoardFullImage[\s\S]*?item\.fileId[\s\S]*?BOARD_FULL_IMAGE_READY_LIMIT/,
  'Full-image continuity must use bounded file IDs rather than retaining potentially large data URLs.'
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
assert.match(
  boardSource,
  /const BOARD_OVERVIEW_IMAGE_LIMIT = 1600;[\s\S]*?const BOARD_OVERVIEW_IMAGE_CONCURRENCY = 16;/,
  'Dense boards must retain enough overview thumbnails without starting every decoder at once.'
);
assert.match(
  boardSource,
  /function boardOverviewThumbnailSource\(file\)[\s\S]*?file\.thumbUrl[\s\S]*?file\.modelPreviewUrl[\s\S]*?function processBoardOverviewImageQueue/,
  'Overview rendering must include video posters and model previews in addition to images.'
);
assert.match(
  boardSource,
  /BOARD_OVERVIEW_IMAGE_MAX_EDGE[\s\S]*?createImageBitmap\(image[\s\S]*?cacheBoardOverviewImage/,
  'Dense-board thumbnails must be downsampled before entering the long-lived overview cache.'
);
assert.match(
  boardSource,
  /overviewImageFailed: new Set\(\)[\s\S]*?image\.onerror = \(\) => \{[\s\S]*?overviewImageFailed\.add[\s\S]*?function requestBoardOverviewImage\(file, deferStart = false\)[\s\S]*?overviewImageFailed\.has/,
  'Broken overview thumbnails must not enter an unbounded retry loop.'
);
assert.match(
  boardSource,
  /function renderBoard\(\)[\s\S]*?rebuildBoardSpatialIndex\(\);[\s\S]*?reconcileMountedBoardItemsAfterDataChange\(\);[\s\S]*?reconcileBoardViewport\(true\);/,
  'Board data refreshes must preserve unchanged mounted media instead of flashing through a full remount.'
);
assert.match(
  boardSource,
  /function isBoardElementPaintReady[\s\S]*?image\.naturalWidth > 0[\s\S]*?function syncBoardOverviewFallback[\s\S]*?overviewHideFrame = requestAnimationFrame[\s\S]*?overviewHideFrame = requestAnimationFrame[\s\S]*?visibleBoardDomReady\(\)/,
  'The painted overview must remain through two stable frames and only yield to successfully decoded DOM media.'
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
  /function prioritizeBoardOverviewImageQueue\(files\)[\s\S]*?overviewImageQueue\.length = 0;[\s\S]*?requestBoardOverviewImage\(file, true\)[\s\S]*?prioritizeBoardOverviewImageQueue\(prioritizedImages\.map/,
  'Dense-canvas thumbnail work must be reprioritized for the current viewport.'
);
assert.match(
  boardSource,
  /const BOARD_OVERVIEW_IMAGE_PIXEL_BUDGET = 24_000_000;[\s\S]*?overviewImagePixels > BOARD_OVERVIEW_IMAGE_PIXEL_BUDGET/,
  'Overview thumbnails must respect a decoded-pixel memory budget.'
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
assert.match(boardSource, /--board-selection-width[\s\S]*?1\.2 \/ Math\.max\(Board\.zoom/);
assert.match(boardStyles, /\.board-item\.is-selected \{[\s\S]*?outline:\s*var\(--board-selection-width/);
assert.match(boardStyles, /width:\s*min\(940px, calc\(100% - 40px\)\)/, 'The generation composer must keep the wider centered footprint.');
assert.doesNotMatch(sidebarSource, /Return home|\\u8fd4\\u56de\\u9996\\u9875/, 'The brand menu must not offer a return-to-home action.');
assert.match(
  sidebarSource,
  /lastClickedSidebarId = f\.id;[\s\S]*?selectFileForPreview\(f\.id\)/,
  'A plain sidebar click must establish the range-selection anchor.'
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
assert.match(boardStyles, /\.fullscreen-stage > img \{[\s\S]*?max-width:\s*min\(88vw, 1600px\);[\s\S]*?max-height:\s*82vh;/);
assert.match(contextMenuSource, /function arrangeItemsGrid[\s\S]*?boardItemBounds\(item\)[\s\S]*?packRows\(layoutItems,[\s\S]*?gap:\s*20/);
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
assert.match(contextMenuSource, /if \(item\.divider\)[\s\S]*?context-menu-divider/,
  'The destructive canvas command must support a visual divider.');
assert.match(contextMenuSource, /function exportBoardItemFile[\s\S]*?exportFile\(item\.fileId\)/);
assert.match(contextMenuSource, /function removeBoardItemFromCanvas[\s\S]*?removeBoardItem\(item\.id\)/);
assert.match(
  mainSource,
  /const supported = normalizedTarget === 'photoshop'[\s\S]*?preview\.isImageExt\(ext\)[\s\S]*?preview\.isImageExt\(ext\) \|\| preview\.isVideoExt\(ext\)/,
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
assert.match(themeSource, /\[data-theme="dark"\][\s\S]*?--bg-base:\s*#111111;[\s\S]*?--bg-surface-2:\s*#282828;/);
assert.match(
  themeSource,
  /\[data-theme="light"\][\s\S]*?--bg-base:\s*#fafafa;[\s\S]*?--bg-surface:\s*#f5f5f7;[\s\S]*?--bg-frame:\s*#e3e3e8;[\s\S]*?--board-workspace-bg:\s*#eeeeec;/,
  'Light mode must use the neutral gray-white hierarchy from the supplied reference.'
);
assert.doesNotMatch(
  boardSource,
  /replaceAiPlaceholders[\s\S]*?requestAnimationFrame\(\(\) => fitBoardItemsToViewport\(updates\)\)/,
  'Replacing a generation placeholder must preserve the current canvas view instead of flashing through auto-fit.'
);
assert.match(
  boardSource,
  /function keepBoardSelectionAboveComposer[\s\S]*?Board\.panY -=[\s\S]*?applyBoardTransform\(\)/,
  'Opening the generation composer must pan covered selections into the visible canvas without changing zoom.'
);
assert.match(boardStyles, /\.app-titlebar \{[\s\S]*?background:\s*var\(--bg-frame, var\(--bg-base\)\)/,
  'The light title bar must use the sampled frame gray while dark mode keeps its fallback.');
assert.match(
  themeSource,
  /\[data-theme="dark"\][\s\S]*?--board-workspace-bg:\s*color-mix\(in srgb, var\(--bg-deep\) 94%, #090b10 6%\)/,
  'Dark canvas modes must share the existing node-canvas background color.'
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

process.stdout.write('Canvas interaction tests passed.\n');
