'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const boardMedia = read('src', 'js', 'board-media-meta.js');
const boardCanvas = read('src', 'js', 'board-canvas.js');
const canvasWorkspace = read('src', 'js', 'canvas-workspace.js');
const storeClient = read('src', 'js', 'store-client.js');
const modelViewer = read('src', 'js', 'model-viewer.js');
const styles = read('src', 'styles', 'main.css');
const html = read('src', 'index.html');
const packageJson = JSON.parse(read('package.json'));
const main = read('main.js');
const preload = read('preload.js');
const bundlePath = path.join(root, 'src', 'vendor', 'model-viewer.bundle.js');
const boardButlerMenu = boardMedia.slice(
  boardMedia.indexOf('function openBoardButlerMenu'),
  boardMedia.indexOf('function appendBoardButlerTrigger')
);

assert.match(boardMedia, /className = 'board-butler-trigger'/, 'The selected-image toolbar must expose the Butler capsule.');
assert.match(boardMedia, /requestedMinimum = requestedSize === '4K' \? 3072[\s\S]*?requestedSize === '2K' \? 1536/, 'Generated-image details must verify requested quality against actual pixels.');
assert.match(boardMedia, /t\('Requested', '请求'\)[\s\S]*?t\('Actual', '实际'\)/, 'A legacy low-resolution result must not be labelled as its requested quality.');
assert.match(boardCanvas, /class="ai-option-block ai-quality-block"[\s\S]*?data-option="quality"[\s\S]*?data-value="low"[\s\S]*?data-value="medium"[\s\S]*?data-value="high"/, 'The canvas capsule must expose GPT Image 2 low, medium, and high quality controls.');
assert.match(boardCanvas, /quality: kind === 'image' \? quality : undefined[\s\S]*?Promise\.resolve\(quoteApi/, 'The canvas capsule estimate must include the selected image quality.');
assert.match(boardCanvas, /const request = \{[\s\S]*?quality: kind === 'image' \? quality : undefined[\s\S]*?imageProviderId:/, 'The canvas capsule generation request must include the selected image quality.');
assert.match(
  boardCanvas,
  /function aiVideoResolutionTier[\s\S]*?includes\('-ESR'\)[\s\S]*?resolution === '4K'[\s\S]*?function aiVideoResolutionGroups[\s\S]*?id: 'native'[\s\S]*?id: 'upscaled'[\s\S]*?id: 'enhanced'/,
  'Seedance resolutions must be classified as native, upscaled, or enhanced-upscale without changing the provider value.'
);
assert.match(
  boardCanvas,
  /className = 'ai-resolution-group'[\s\S]*?dataset\.resolutionTier = group\.id[\s\S]*?className = 'ai-resolution-group-options'/,
  'The canvas capsule must render Seedance resolution tiers as three visible groups.'
);
assert.match(
  styles,
  /\.ai-segmented\.is-resolution-groups[\s\S]*?\.ai-resolution-group-label[\s\S]*?\.ai-resolution-group-options/,
  'Grouped Seedance controls must keep stable labels and a bounded option grid.'
);
assert.doesNotMatch(boardMedia, /key:\s*'more'/, 'The old three-dot toolbar action must be removed.');
assert.match(boardMedia, /window\.messsAPI && window\.messsAPI\.butler/, 'Butler must use the isolated preload namespace.');
assert.match(boardMedia, /api\.removeBackground\(file\.id, options\)/, 'Background removal must send only documented settings with the file id.');
assert.match(boardMedia, /api\.create3d\(file\.id, safeProviderId, options\)/, '3D creation must send the selected provider and validated settings.');
assert.match(boardMedia, /function openBoardButlerThreeDPanel[\s\S]*butler-3d-quality[\s\S]*butler-3d-geometry-quality/, 'Every 3D provider must expose its own documented quality controls.');
assert.match(boardMedia, /butler-3d-prompt[\s\S]*prompt: String\(data\.get\('butler-3d-prompt'\)/, 'Hyper3D must submit the prompt currently edited by the user.');
assert.match(boardMedia, /generate3d:hunyuan3d[\s\S]*generate3d:hyper3d[\s\S]*generate3d:tripo3d/, 'Hunyuan, Hyper3D and Tripo3D must keep independent task state.');
assert.match(boardMedia, /api\.get3dStatus\(taskToken\)[\s\S]*api\.download3d\(taskToken\)/, '3D jobs must poll with short requests before downloading.');
assert.match(boardMedia, /isTransientBoardButlerStatusFailure[\s\S]*transientStatusFailures < 6[\s\S]*continue;/, '3D polling must survive bounded transient gateway and provider failures.');
assert.match(boardMedia, /let status = normalizeBoardButlerJobStatus\(created\.status\)[\s\S]*status = normalizeBoardButlerJobStatus\(lastResult\.status \|\| 'processing'\)/, '3D polling must normalize queued provider aliases before deciding a task failed.');
assert.match(boardMedia, /isTransientBoardButlerStatusFailure[\s\S]*ai302-upstream-error/, '3D polling must retry bounded transient 302 upstream failures.');
assert.match(boardMedia, /role', 'toolbar'/, 'Butler tools must expand as a horizontal toolbar.');
assert.match(boardMedia, /function bindBoardButlerHoverSubmenu[\s\S]*group\.addEventListener\('mouseenter',[\s\S]*group\.addEventListener\('mouseleave'/, 'Butler secondary menus must open on hover and close after leaving.');
assert.match(boardMedia, /bindBoardButlerHoverSubmenu\(modelGroup, modelTrigger\)/, '3D must keep hover-first submenu behavior.');
assert.doesNotMatch(boardMedia, /dataset\.pinned/, 'Butler secondary menus must not require click-pinning before choosing an option.');
assert.match(boardMedia, /event\.key === 'Escape'[\s\S]*closeBoardButlerMenu/, 'The Butler toolbar must close with Escape.');
assert.match(boardButlerMenu, /'removeBackground'/, 'Background removal must remain available in the image Butler menu.');
assert.match(boardButlerMenu, /'imageExpand'/, 'Image expansion must remain available in the image Butler menu.');
assert.match(boardButlerMenu, /'generate3d'/, '3D generation must remain available in the image Butler menu.');
['imageEdit', 'imageEnhance', 'eraseObject', 'topazImage'].forEach((action) => {
  assert.doesNotMatch(boardButlerMenu, new RegExp(`'${action}'`), `${action} must be removed from the visible image Butler menu.`);
});
['imageEdit', 'imageExpand', 'imageEnhance', 'eraseObject'].forEach((action) => {
  assert.match(boardMedia, new RegExp(`${action}: Object\\.freeze`), `${action} must have an explicit bridge hook.`);
});
assert.match(boardMedia, /BOARD_BUTLER_ICONS\.imageLayer/, 'Image expansion must have a semantic expansion icon.');
[
  ['imageEdit', 'openBoardButlerSeedEditPanel|openBoardButlerImageEditPanel'],
  ['imageExpand', 'openBoardButlerExpandPanel'],
  ['imageEnhance', 'runBoardButlerImageTool'],
  ['eraseObject', 'openBoardButlerErasePanel']
].forEach(([action, entryPoint]) => {
  assert.match(
    boardMedia,
    new RegExp(`(?:function ${entryPoint}|'${action}'[\\s\\S]*?${entryPoint})`),
    `${action} must execute from the selected-image Butler menu.`
  );
});
assert.match(boardMedia, /SeedEdit 3\.0/, 'Image edit must identify SeedEdit 3.0.');
assert.match(boardMedia, /imageEdit: boardButlerCreditsFromPtc\(0\.05\)[\s\S]*imageExpand: boardButlerCreditsFromPtc\(0\.50\)/, 'Image edit and expansion must derive the gateway-aligned paid prices from protected provider cost.');
assert.doesNotMatch(boardMedia, /Free · SeedEdit|免费 · SeedEdit|무료 · SeedEdit/, 'SeedEdit must never be presented as free.');
assert.doesNotMatch(boardMedia, /\$\{t\('Free', '免费', '무료'\)\}/, 'Paid expansion must never be presented as free.');
assert.match(boardMedia, /Clipdrop Uncrop/, 'Image expansion must identify the documented Clipdrop endpoint.');
assert.match(boardMedia, /butler-expand-width[\s\S]*butler-expand-height/, 'Image expansion must expose exact target dimensions.');
assert.match(boardMedia, /21:9[\s\S]*dataset\.expandRatio[\s\S]*data-expand-edge/, 'Image expansion must expose ratio presets and four draggable edges.');
assert.match(boardMedia, /offsets\.left[\s\S]*Math\.min\(2000[\s\S]*offsets\.down/, 'Expansion must enforce Clipdrop\'s 2000-pixel limit on each side.');
assert.match(
  boardMedia,
  /function openBoardButlerExpandPanel\([\s\S]*?className = 'board-butler-expand-editor'[\s\S]*?canvas\.appendChild\(editor\)/,
  'Image expansion must open as an editor attached to the transformed canvas.'
);
assert.match(
  boardMedia,
  /board-butler-expand-ratio-toolbar[\s\S]*?butler-expand-width[\s\S]*?butler-expand-height[\s\S]*?butler-expand-seed[\s\S]*?board-butler-expand-submit/,
  'The canvas expansion editor must retain ratio, dimensions, seed, cost, and submit controls.'
);
assert.match(
  boardMedia,
  /const options = \{[\s\S]*?left: offsets\.left[\s\S]*?right: offsets\.right[\s\S]*?up: offsets\.up[\s\S]*?down: offsets\.down[\s\S]*?launchBoardButlerImageTool\('imageExpand'/,
  'The canvas expansion editor must submit the four visible edge offsets to the existing paid tool.'
);
assert.match(boardMedia, /function syncBoardButlerExpandEditorToSelection[\s\S]*?closeBoardButlerExpandEditor/,
  'Changing the source selection must close its canvas expansion editor.');
assert.match(canvasWorkspace, /function showCanvasLibrary[\s\S]*?closeBoardButlerExpandEditor/,
  'Leaving the canvas workspace must close the expansion editor.');
assert.doesNotMatch(boardButlerMenu, /Enhance quality|画质提升|Image enhancement|图片增强/, 'Removed image enhancement tools must not remain visible in the image Butler menu.');
assert.doesNotMatch(boardMedia, /Creative upscale|图片创意放大/, 'The removed creative-upscale product must not remain visible.');
assert.match(boardMedia, /maskDataUrl[\s\S]*maskWidth[\s\S]*maskHeight/, 'Erase must submit a real PNG mask with dimensions.');
assert.match(boardMedia, /videoUpscale: Object\.freeze/, 'Video enhancement must have an isolated bridge hook.');
assert.match(boardMedia, /topaz-video-upscale/, 'Video enhancement must use the Topaz action key.');
assert.doesNotMatch(boardMedia, /aion-1/, 'Video enhancement must expose only models documented by the 302 Topaz endpoint.');
assert.match(boardMedia, /board-butler-cost-estimate/, 'Video enhancement must show a parameter-sensitive points estimate.');
assert.match(boardMedia, /function updateBoardButlerVideoState[\s\S]*?'credits'[\s\S]*?'creditsCharged'[\s\S]*?result/, 'The accepted Topaz quote must update the visible task cost.');
assert.match(boardMedia, /if \(task\.status === 'success'\) return t\('Done', '完成', '완료'\)/, 'The completed Topaz task must show completion without exposing the settled charge.');
assert.match(boardMedia, /phase === 'queued'[\s\S]*?phase === 'downloading'[\s\S]*?phase === 'saving'/, 'Video enhancement must expose its queue, download, and canvas-save phases.');
assert.match(
  boardMedia,
  /function invokeBoardButlerWithTransientRetry[\s\S]*?BOARD_BUTLER_MAX_TRANSIENT_RETRIES[\s\S]*?state\.phase = 'reconnecting'[\s\S]*?2 \*\* failure/,
  'Topaz image/video polling and downloads must survive bounded transient failures with exponential backoff.'
);
assert.match(
  boardMedia,
  /getImageToolStatus[\s\S]*?invokeBoardButlerWithTransientRetry[\s\S]*?downloadImageToolResult[\s\S]*?invokeBoardButlerWithTransientRetry[\s\S]*?getVideoToolStatus[\s\S]*?invokeBoardButlerWithTransientRetry[\s\S]*?downloadVideoToolResult/,
  'Every Topaz status and result bridge must share the transient retry policy.'
);
assert.match(boardMedia, /BOARD_BUTLER_VIDEO_EXTENSIONS[\s\S]*?\.mp4[\s\S]*?\.mkv[\s\S]*?appendBoardVideoButlerToolbar/, 'The Butler video entry must use the same supported container list as the desktop bridge.');
assert.match(boardMedia, /const billingOperation = file\.aiGeneration \|\| file\.butlerOperation[\s\S]*?rawEstimatedCredits[\s\S]*?estimatedCredits/, 'Generated-media details must preserve the protected estimate.');
assert.match(boardMedia, /function formatBoardGenerationDate[\s\S]*?Number\.isFinite\(date\.getTime\(\)\)[\s\S]*?formatDateTime/, 'Generated-media details must format timestamps safely for the active locale.');
assert.match(boardMedia, /const generatedAt = formatBoardGenerationDate\([\s\S]*?generation\.createdAt[\s\S]*?butlerOperation\.createdAt[\s\S]*?file\.importedAt/, 'Generated-media details must fall back to the saved file time for older records.');
assert.match(boardMedia, /generated-media-detail-created-at[\s\S]*?t\('Generated at', '生成时间'/, 'Generated-media details must show the generation date and time.');
assert.doesNotMatch(boardMedia, /Generated-media details[\s\S]{0,160}rawChargedCredits/, 'Generated-media details must not expose the settled charge in the renderer.');
assert.match(boardMedia, /butler-video-model[\s\S]*filters:\s*\[\{[\s\S]*videoType:[\s\S]*audioTransfer: 'Copy'/, 'Video enhancement must send the selected documented filter/output shape.');
assert.match(
  boardCanvas,
  /function installBoardMediaControls\(element, file, item, kind\)[\s\S]*?appendBoardVideoButlerToolbar\(element, file, item\)/,
  'Selected videos must expose the Butler capsule when the active single-selection controls are mounted.'
);
assert.match(
  boardCanvas,
  /const videoToolbar = appendBoardVideoButlerToolbar\(element, file, item\);[\s\S]*?appendGeneratedMediaDetailsControl\(element, file, videoToolbar\)/,
  'Video details must share the Butler toolbar instead of overlapping it.'
);
assert.match(
  boardMedia,
  /function appendGeneratedMediaDetailsControl\(element, file, toolbar = null\)[\s\S]*?\(toolbar \|\| element\)\.appendChild\(button\)/,
  'Generated-media details must support an inline toolbar host.'
);
assert.match(preload, /upscaleVideo:[\s\S]*butler:upscaleVideo/, 'The isolated preload must expose video enhancement.');
assert.match(preload, /getVideoToolStatus:[\s\S]*downloadVideoToolResult:/, 'The isolated preload must expose video polling and download.');
assert.match(main, /'ai302-invalid-response': 'The AI service returned an unsupported response/);
assert.match(main, /'tool-disabled': 'This AI tool is temporarily unavailable/);
assert.match(main, /'credit-schema-missing': 'The points service is being upgraded/);
assert.match(main, /function butlerFailure[\s\S]*?httpStatus[\s\S]*?httpStatus \}/, 'Renderer failures must retain HTTP status so terminal 4xx errors are not retried.');
[
  ['editImage', 'butler:image-edit'],
  ['expandImage', 'butler:image-expand'],
  ['upscaleImage', 'butler:image-upscale'],
  ['eraseObject', 'butler:image-erase']
].forEach(([method, channel]) => {
  assert.match(preload, new RegExp(`${method}:[^\\n]+${channel}`), `${method} must use its isolated Butler IPC channel.`);
});
assert.match(main, /butler:image-upscale[\s\S]*clipdrop-upscale[\s\S]*aiGateway\.upscaleImage/, 'Quality enhancement must use the Clipdrop desktop invocation path.');
assert.match(preload, /getImageToolStatus:[^\n]+butler:image-tool-status/, 'Image tools must expose asynchronous status polling.');
assert.match(preload, /downloadImageToolResult:[^\n]+butler:image-tool-download/, 'Image tools must expose result download and archival.');
assert.match(boardMedia, /task\.phase === 'queued'[\s\S]*task\.phase === 'downloading'[\s\S]*task\.phase === 'saving'/, 'Image tools must expose their asynchronous phases.');
assert.match(boardMedia, /result\.result[\s\S]*result\.output/, 'Image tool results must accept archived files returned in nested task payloads.');
assert.match(boardMedia, /topazSharpenGen:[\s\S]*topaz-image-sharpen-gen/, 'Generative sharpen must have an isolated Topaz bridge hook.');
assert.match(boardMedia, /topazEnhanceGen:[\s\S]*topaz-image-enhance-gen/, 'Generative enhance must have an isolated Topaz bridge hook.');
assert.doesNotMatch(boardButlerMenu, /Generative sharpen|Generative enhance/, 'Removed Topaz generative tools must stay out of the visible Butler menu.');
assert.doesNotMatch(preload, /AI302_KEY|AI_302_API_KEY|server-only-302-key/, 'The renderer bridge must never contain the 302 credential.');
assert.match(main, /async function butlerSourceVideo[\s\S]*realpath\(store\.libraryDir\)[\s\S]*isSymbolicLink/, 'Video enhancement must read only a real archived library file.');
assert.match(main, /MAX_BUTLER_VIDEO_BYTES = 48 \* 1024 \* 1024[\s\S]*butler-video-too-large/, 'Video relay input must be bounded before base64 encoding.');
assert.match(main, /Math\.min\(boundWidth \/ sourceWidth, boundHeight \/ sourceHeight\)/, 'Video output sizing must preserve the source aspect ratio.');
assert.match(main, /ipcMain\.handle\('butler:upscaleVideo'[\s\S]*ipcMain\.handle\('butler:getVideoToolStatus'[\s\S]*ipcMain\.handle\('butler:downloadVideoToolResult'/, 'Desktop video tasks must support create, poll, and archive.');
assert.match(main, /videoBuffer:\s*buffer[\s\S]*upscaleVideo\(source\.videoBuffer,\s*\{[\s\S]*\.\.\.source\.toolOptions[\s\S]*onProgress:/, 'Desktop video enhancement must use bounded chunk upload and report upload progress.');
assert.match(main, /const butlerVideoTasks = new Map\(\)[\s\S]*const butlerVideoDownloads = new Map\(\)/, 'Video tasks and downloads must be independently concurrent and deduplicated.');
assert.match(main, /addButlerVideoOutputFile[\s\S]*butlerOperation:[\s\S]*kind: 'video-upscale'/, 'Enhanced videos must be archived with Butler provenance.');
assert.match(main, /creditsCharged !== undefined \? currentTask\.creditsCharged : currentTask\.credits/, 'Enhanced videos must archive the settled charge when available.');
assert.match(main, /function butlerRetailCreditsFromPtc[\s\S]*?retailCreditsFromUpstreamCny[\s\S]*?const BUTLER_IMAGE_TOOL_CREDITS/, 'Main-process Butler history must derive current prices from the shared retail formula.');
assert.match(main, /function butlerThreeDRetailCredits[\s\S]*?butlerThreeDPricingOptions[\s\S]*?pricingOptions: currentTask\.options/, '3D usage repricing must preserve the options that affect current retail points.');
assert.match(main, /const taskOptions = \{ \.\.\.options, prompt: effectivePrompt \}[\s\S]*?options: taskOptions/, '3D task persistence must retain the effective Hyper3D prompt for recovery.');
assert.match(preload, /confirmDelivery:[^\n]+butler:confirmDelivery[\s\S]*releaseDelivery:[^\n]+butler:releaseDelivery/,
  'The isolated Butler bridge must expose only opaque delivery confirmation tokens.');
assert.match(main, /function registerButlerDelivery[\s\S]*accountingRequestId = requestId[\s\S]*delete record\.butlerOperation\.creditsCharged/,
  'Pending Butler files must retain one accounting request without recording an unconfirmed charge.');
assert.match(main, /ipcMain\.handle\('butler:confirmDelivery'[\s\S]*settleButlerDeliveryToken\(deliveryToken, true\)[\s\S]*ipcMain\.handle\('butler:releaseDelivery'[\s\S]*settleButlerDeliveryToken\(deliveryToken, false\)/,
  'Main-process Butler delivery must explicitly confirm successful placement or release failed placement.');
assert.match(boardMedia, /await addFileToBoard\(file\.id, placementX, placementY(?:,\s*\{[\s\S]*?\})?\)[\s\S]*await confirmBoardButlerDeliveries\(\[file\]\)/,
  'A single Butler result must be charged only after it is added to the canvas.');
assert.match(boardMedia, /for \(let index = 0; index < validFiles\.length[\s\S]*await addFileToBoard[\s\S]*await confirmBoardButlerDeliveries\(validFiles\)/,
  'A multi-result Butler task must confirm its charge only after every result reaches the canvas.');
assert.match(boardMedia, /catch \(error\) \{[\s\S]*releaseBoardButlerDeliveries\(validFiles\)[\s\S]*throw error/,
  'A failed multi-result placement must release points and remove partial local results.');

assert.match(storeClient, /MODEL_FILE_EXTENSIONS = new Set\(\['\.glb', '\.fbx', '\.obj'\]\)/, 'GLB, FBX and OBJ must share model recognition.');
assert.match(storeClient, /mime === 'model\/gltf-binary'/, 'GLB recognition must include the standard model MIME type.');
assert.match(boardCanvas, /if \(isModelFile\(f\)\)/, 'All supported model formats must use the model card.');
assert.match(boardCanvas, /f\.modelPreviewUrl \|\| f\.previewUrl \|\| ''/, 'Model cards must use only a static model preview image.');
assert.match(boardCanvas, /requestBoardModelPreview\(f\)/, 'Missing model thumbnails must be rendered through the shared model-viewer queue.');
assert.doesNotMatch(boardCanvas, /new\s+(?:THREE\.)?WebGLRenderer/, 'Board cards must never allocate a WebGL renderer.');
assert.match(boardCanvas, /else if \(isModel\)[\s\S]*dblclick[\s\S]*openBoardModelViewer\(f\)/, 'Double-clicking a model card must open the viewer.');

assert.strictEqual((modelViewer.match(/new THREE\.WebGLRenderer/g) || []).length, 1, 'The app must have one model-viewer renderer allocation path.');
assert.match(modelViewer, /new OrbitControls\(camera, renderer\.domElement\)/, 'The viewer must support orbit interaction.');
assert.match(modelViewer, /new vendor\.GLTFLoader[\s\S]*new vendor\.FBXLoader[\s\S]*new vendor\.OBJLoader/, 'The viewer must parse GLB, FBX and OBJ with dedicated loaders.');
assert.match(modelViewer, /window\.messsAPI\.readModelData\(file\.id\)/, 'Model parsing must use the isolated binary IPC instead of production custom-protocol fetches.');
assert.match(preload, /readModelData:[^\n]+files:readModelData/, 'The isolated preload must expose model reads by file id only.');
assert.match(preload, /saveModelPreview:[^\n]+files:saveModelPreview/, 'The isolated preload must expose only validated model thumbnail writes.');
assert.match(main, /async function readArchivedModelData[\s\S]*realpath\(store\.libraryDir\)[\s\S]*MAX_MODEL_PREVIEW_BYTES/, 'Model preview reads must stay inside the archive and enforce a size limit.');
assert.match(main, /async function saveArchivedModelPreview[\s\S]*data:image\\\/png;base64[\s\S]*model-preview\.png/, 'Generated model thumbnails must be validated and stored in the preview cache.');
assert.match(main, /MODEL_PREVIEW_CACHE_VERSION = 'pbr-v3'[\s\S]*MODEL_PREVIEW_MARKER_FILENAME[\s\S]*writeFile\(pbrMarkerPath, `\$\{MODEL_PREVIEW_CACHE_VERSION\}\\n`/, 'Only current texture-ready thumbnails rendered from the model itself may be reused as PBR previews.');
assert.doesNotMatch(main, /await writeButlerModelPreview\(record\.id, sourceFile/, 'A source reference image must never masquerade as the generated model thumbnail.');
assert.match(main, /ipcMain\.handle\('files:readModelData'/, 'The main process must own model binary reads.');
assert.match(modelViewer, /event\.shiftKey[\s\S]*event\.button !== 2[\s\S]*drag\.azimuth/, 'Shift plus right-drag must rotate the model key light through 360 degrees.');
assert.match(modelViewer, /BOARD_MODEL_COLOR_TEXTURE_SLOTS[\s\S]*function prepareBoardModelMaterials[\s\S]*value\.anisotropy[\s\S]*value\.colorSpace = THREE\.SRGBColorSpace/, 'Textured model materials must be prepared for accurate color and sharp rendering.');
assert.match(modelViewer, /function renderBoardModelAfterTextureUpload[\s\S]*renderer\.initTexture[\s\S]*renderer\.compileAsync[\s\S]*requestAnimationFrame[\s\S]*context\.finish[\s\S]*await renderBoardModelAfterTextureUpload/, 'Model thumbnails must finish texture upload, shader compilation, and GPU drawing before capture.');
assert.ok((modelViewer.match(/prepareBoardModelMaterials\(/g) || []).length >= 3, 'Material preparation must run for both model thumbnails and the full viewer.');
assert.match(modelViewer, /light\.intensity = isDragging \? 3\.4 : 2\.4[\s\S]*hemisphereLight\.intensity = isDragging \? 0\.3 : 0\.7[\s\S]*rimLight\.intensity = isDragging \? 1\.4 : 0\.8[\s\S]*scene\.environmentIntensity = isDragging \? 0\.45 : 0\.75/, 'Light dragging must preserve PBR material color while producing clear key, fill and environment contrast.');
assert.match(modelViewer, /textureSlots\[slot\][\s\S]*BoardModelViewer\.materialStats = prepareBoardModelMaterials/, 'The viewer must retain and report the GLB PBR texture slots instead of replacing its materials.');
assert.match(modelViewer, /rimLight\.position\.set\(-light\.position\.x[\s\S]*--light-angle/, 'The rim light and visible direction indicator must follow the rotated key light.');
assert.match(modelViewer, /window\.messsAPI\.exportFile\(file\.id\)/, 'The viewer download button must use the existing safe export IPC.');
assert.match(modelViewer, /cancelAnimationFrame[\s\S]*disposeBoardModelObject[\s\S]*forceContextLoss\(\)/, 'Closing the viewer must release animation, scene resources and the WebGL context.');
assert.match(styles, /\.board-model-viewer-overlay[\s\S]*place-items:\s*center/, 'The full-screen model dialog must be centered.');
assert.match(styles, /\.board-butler-menu\s*\{[\s\S]*display:\s*flex/, 'The Butler flyout must use the horizontal pill layout.');
assert.match(styles, /\.board-butler-config-panel[\s\S]*\.board-butler-segmented/, 'Butler parameter panels must share the compact control language.');
assert.match(boardMedia, /function makeBoardButlerPanelDraggable[\s\S]*?setPointerCapture[\s\S]*?clampBoardButlerPanelToViewport/, 'Butler parameter panels must be draggable and remain fully inside the window.');
assert.match(boardMedia, /ResizeObserver[\s\S]*?clampBoardButlerPanelToViewport/, 'Growing Butler option panels must be reclamped after their content is rendered.');
assert.match(styles, /\.board-butler-mask-overlay[\s\S]*\.board-butler-mask-stage/, 'Erase must use a dedicated mask workspace.');
assert.match(styles, /\.board-butler-expand-editor \{[\s\S]*?z-index:\s*120000[\s\S]*?\.board-butler-expand-ratio-toolbar,[\s\S]*?\.board-butler-expand-controls/,
  'Canvas expansion must render above media with floating ratio and parameter capsules.');
assert.match(boardCanvas, /BOARD_UI_EVENT_SELECTOR[\s\S]*?\.board-butler-expand-editor/,
  'Expansion handles and controls must not leak drag or zoom gestures into the canvas.');
assert.match(styles, /\.board-item-video\.is-selected\.is-single-selection \.board-image-toolbar/, 'Video Butler toolbar must appear for a selected video.');
assert.match(styles, /\.generated-media-detail-trigger\.is-inline\s*\{[\s\S]*?position:\s*static;[\s\S]*?flex:\s*0 0 25px;/,
  'The inline video details control must participate in toolbar layout.');

assert.match(html, /connect-src messs-file: blob:;/, 'CSP must permit archived models and their embedded GLB texture blobs.');
assert.doesNotMatch(html.match(/Content-Security-Policy[^>]+/)[0], /connect-src[^;]*(?:https?:|\*)/, 'The model-viewer CSP must not open network fetches.');
const bundleIndex = html.indexOf('vendor/model-viewer.bundle.js');
const controllerIndex = html.indexOf('js/model-viewer.js');
const boardIndex = html.indexOf('js/board-canvas.js');
assert(bundleIndex >= 0 && bundleIndex < controllerIndex && controllerIndex < boardIndex, 'The IIFE vendor and controller must load before the board.');
assert(fs.existsSync(bundlePath) && fs.statSync(bundlePath).size > 100000, 'The built Three.js IIFE bundle must be present.');
assert.strictEqual(packageJson.devDependencies.three, '0.185.1');
assert.strictEqual(packageJson.devDependencies.esbuild, '0.28.1');

process.stdout.write('Butler and model-viewer UI tests passed.\n');
