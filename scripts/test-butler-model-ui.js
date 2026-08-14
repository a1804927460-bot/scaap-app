'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const boardMedia = read('src', 'js', 'board-media-meta.js');
const boardCanvas = read('src', 'js', 'board-canvas.js');
const storeClient = read('src', 'js', 'store-client.js');
const modelViewer = read('src', 'js', 'model-viewer.js');
const styles = read('src', 'styles', 'main.css');
const html = read('src', 'index.html');
const packageJson = JSON.parse(read('package.json'));
const main = read('main.js');
const preload = read('preload.js');
const bundlePath = path.join(root, 'src', 'vendor', 'model-viewer.bundle.js');

assert.match(boardMedia, /className = 'board-butler-trigger'/, 'The selected-image toolbar must expose the Butler capsule.');
assert.match(boardMedia, /requestedMinimum = requestedSize === '4K' \? 3072[\s\S]*?requestedSize === '2K' \? 1536/, 'Generated-image details must verify requested quality against actual pixels.');
assert.match(boardMedia, /t\('Requested', '请求'\)[\s\S]*?t\('Actual', '实际'\)/, 'A legacy low-resolution result must not be labelled as its requested quality.');
assert.doesNotMatch(boardMedia, /key:\s*'more'/, 'The old three-dot toolbar action must be removed.');
assert.match(boardMedia, /window\.messsAPI && window\.messsAPI\.butler/, 'Butler must use the isolated preload namespace.');
assert.match(boardMedia, /api\.removeBackground\(file\.id, options\)/, 'Background removal must send only documented settings with the file id.');
assert.match(boardMedia, /api\.create3d\(file\.id, safeProviderId, options\)/, '3D creation must send the selected provider and validated settings.');
assert.match(boardMedia, /function openBoardButlerThreeDPanel[\s\S]*butler-3d-quality[\s\S]*butler-3d-geometry-quality/, 'Every 3D provider must expose its own documented quality controls.');
assert.match(boardMedia, /generate3d:hunyuan3d[\s\S]*generate3d:hyper3d[\s\S]*generate3d:tripo3d/, 'Hunyuan, Hyper3D and Tripo3D must keep independent task state.');
assert.match(boardMedia, /api\.get3dStatus\(taskToken\)[\s\S]*api\.download3d\(taskToken\)/, '3D jobs must poll with short requests before downloading.');
assert.match(boardMedia, /isTransientBoardButlerStatusFailure[\s\S]*transientStatusFailures < 6[\s\S]*continue;/, '3D polling must survive bounded transient gateway and provider failures.');
assert.match(boardMedia, /let status = normalizeBoardButlerJobStatus\(created\.status\)[\s\S]*status = normalizeBoardButlerJobStatus\(lastResult\.status \|\| 'processing'\)/, '3D polling must normalize queued provider aliases before deciding a task failed.');
assert.match(boardMedia, /isTransientBoardButlerStatusFailure[\s\S]*ai302-upstream-error/, '3D polling must retry bounded transient 302 upstream failures.');
assert.match(boardMedia, /role', 'toolbar'/, 'Butler tools must expand as a horizontal toolbar.');
assert.match(boardMedia, /function bindBoardButlerHoverSubmenu[\s\S]*group\.addEventListener\('mouseenter',[\s\S]*group\.addEventListener\('mouseleave'/, 'Butler secondary menus must open on hover and close after leaving.');
assert.match(boardMedia, /bindBoardButlerHoverSubmenu\(topazGroup, topazTrigger\)[\s\S]*bindBoardButlerHoverSubmenu\(modelGroup, modelTrigger\)/, 'Topaz and 3D must share hover-first submenu behavior.');
assert.doesNotMatch(boardMedia, /dataset\.pinned/, 'Butler secondary menus must not require click-pinning before choosing an option.');
assert.match(boardMedia, /event\.key === 'Escape'[\s\S]*closeBoardButlerMenu/, 'The Butler toolbar must close with Escape.');
['imageEdit', 'imageLayer', 'imageUpscale', 'eraseObject'].forEach((action) => {
  assert.match(boardMedia, new RegExp(`${action}: Object\\.freeze`), `${action} must have an explicit bridge hook.`);
  assert.match(boardMedia, new RegExp(`BOARD_BUTLER_ICONS\\.${action}`), `${action} must have a semantic icon.`);
});
[
  ['imageEdit', 'openBoardButlerImageEditPanel'],
  ['imageLayer', 'openBoardButlerLayerPanel'],
  ['imageUpscale', 'openBoardButlerUpscalePanel'],
  ['eraseObject', 'openBoardButlerErasePanel']
].forEach(([action, entryPoint]) => {
  assert.match(
    boardMedia,
    new RegExp(`'${action}'[\\s\\S]{0,260}${entryPoint}`),
    `${action} must execute from the selected-image Butler menu.`
  );
});
assert.match(boardMedia, /Qwen-Image-Edit-Plus/, 'Image edit must identify the Qwen edit model.');
assert.match(boardMedia, /numLayers:[\s\S]*Math\.max\(2[\s\S]*Math\.min\(8/, 'Layered images must expose a bounded 2-8 layer control.');
assert.match(boardMedia, /maskDataUrl[\s\S]*maskWidth[\s\S]*maskHeight/, 'Erase must submit a real PNG mask with dimensions.');
assert.match(boardMedia, /videoUpscale: Object\.freeze/, 'Video enhancement must have an isolated bridge hook.');
assert.match(boardMedia, /topaz-video-upscale/, 'Video enhancement must use the Topaz action key.');
assert.match(boardMedia, /board-butler-cost-estimate/, 'Video enhancement must show a parameter-sensitive points estimate.');
assert.match(boardMedia, /function updateBoardButlerVideoState[\s\S]*?'credits'[\s\S]*?'creditsCharged'[\s\S]*?result/, 'The accepted Topaz quote must update the visible task cost.');
assert.match(boardMedia, /task\.creditsCharged \?\? task\.credits[\s\S]*?const points[\s\S]*?task\.status === 'success'[\s\S]*?\$\{done\}[^\n]*\$\{points\}/, 'The completed Topaz task must show the actual charged points.');
assert.match(boardMedia, /phase === 'queued'[\s\S]*?phase === 'downloading'[\s\S]*?phase === 'saving'/, 'Video enhancement must expose its queue, download, and canvas-save phases.');
assert.match(boardMedia, /BOARD_BUTLER_VIDEO_EXTENSIONS[\s\S]*?\.mp4[\s\S]*?\.mkv[\s\S]*?appendBoardVideoButlerToolbar/, 'The Butler video entry must use the same supported container list as the desktop bridge.');
assert.match(boardMedia, /butlerOperation\.kind === 'video-upscale'[\s\S]*?operationCredits/, 'Enhanced-video details must preserve the charged points.');
assert.match(boardMedia, /butler-video-model[\s\S]*filters:\s*\[\{[\s\S]*videoType:[\s\S]*audioTransfer: 'Copy'/, 'Video enhancement must send the selected documented filter/output shape.');
assert.match(boardCanvas, /appendBoardVideoButlerToolbar\(el, f, item\)/, 'Selected videos must expose the Butler capsule.');
assert.match(
  boardCanvas,
  /const videoToolbar = appendBoardVideoButlerToolbar\(el, f, item\);[\s\S]*?appendGeneratedMediaDetailsControl\(el, f, videoToolbar\)/,
  'Video details must share the Butler toolbar instead of overlapping it.'
);
assert.match(
  boardMedia,
  /function appendGeneratedMediaDetailsControl\(element, file, toolbar = null\)[\s\S]*?\(toolbar \|\| element\)\.appendChild\(button\)/,
  'Generated-media details must support an inline toolbar host.'
);
assert.match(preload, /upscaleVideo:[\s\S]*butler:upscaleVideo/, 'The isolated preload must expose video enhancement.');
assert.match(preload, /getVideoToolStatus:[\s\S]*downloadVideoToolResult:/, 'The isolated preload must expose video polling and download.');
[
  ['editImage', 'butler:image-edit'],
  ['layerImage', 'butler:image-layer'],
  ['upscaleImage', 'butler:image-upscale'],
  ['eraseObject', 'butler:image-erase']
].forEach(([method, channel]) => {
  assert.match(preload, new RegExp(`${method}:[^\\n]+${channel}`), `${method} must use its isolated Butler IPC channel.`);
});
assert.match(preload, /getImageToolStatus:[^\n]+butler:image-tool-status/, 'Image tools must expose asynchronous status polling.');
assert.match(preload, /downloadImageToolResult:[^\n]+butler:image-tool-download/, 'Image tools must expose result download and archival.');
assert.match(boardMedia, /task\.phase === 'queued'[\s\S]*task\.phase === 'downloading'[\s\S]*task\.phase === 'saving'/, 'Image tools must expose their asynchronous phases.');
assert.match(boardMedia, /result\.result[\s\S]*result\.output/, 'Image tool results must accept archived files returned in nested task payloads.');
assert.match(boardMedia, /topazSharpenGen:[\s\S]*topaz-image-sharpen-gen/, 'Generative sharpen must have an isolated Topaz bridge hook.');
assert.match(boardMedia, /topazEnhanceGen:[\s\S]*topaz-image-enhance-gen/, 'Generative enhance must have an isolated Topaz bridge hook.');
assert.match(boardMedia, /Generative sharpen[\s\S]*Generative enhance/, 'Both Topaz generative tools must be visible in the Butler submenu.');
assert.doesNotMatch(preload, /AI302_KEY|AI_302_API_KEY|server-only-302-key/, 'The renderer bridge must never contain the 302 credential.');
assert.match(main, /async function butlerSourceVideo[\s\S]*realpath\(store\.libraryDir\)[\s\S]*isSymbolicLink/, 'Video enhancement must read only a real archived library file.');
assert.match(main, /MAX_BUTLER_VIDEO_BYTES = 48 \* 1024 \* 1024[\s\S]*butler-video-too-large/, 'Video relay input must be bounded before base64 encoding.');
assert.match(main, /Math\.min\(boundWidth \/ sourceWidth, boundHeight \/ sourceHeight\)/, 'Video output sizing must preserve the source aspect ratio.');
assert.match(main, /ipcMain\.handle\('butler:upscaleVideo'[\s\S]*ipcMain\.handle\('butler:getVideoToolStatus'[\s\S]*ipcMain\.handle\('butler:downloadVideoToolResult'/, 'Desktop video tasks must support create, poll, and archive.');
assert.match(main, /const butlerVideoTasks = new Map\(\)[\s\S]*const butlerVideoDownloads = new Map\(\)/, 'Video tasks and downloads must be independently concurrent and deduplicated.');
assert.match(main, /addButlerVideoOutputFile[\s\S]*butlerOperation:[\s\S]*kind: 'video-upscale'/, 'Enhanced videos must be archived with Butler provenance.');
assert.match(main, /creditsCharged !== undefined \? currentTask\.creditsCharged : currentTask\.credits/, 'Enhanced videos must archive the settled charge when available.');

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
assert.match(main, /ipcMain\.handle\('files:readModelData'/, 'The main process must own model binary reads.');
assert.match(modelViewer, /event\.shiftKey[\s\S]*event\.button !== 2[\s\S]*drag\.azimuth/, 'Shift plus right-drag must rotate the model key light through 360 degrees.');
assert.match(modelViewer, /BOARD_MODEL_COLOR_TEXTURE_SLOTS[\s\S]*function prepareBoardModelMaterials[\s\S]*value\.anisotropy[\s\S]*value\.colorSpace = THREE\.SRGBColorSpace/, 'Textured model materials must be prepared for accurate color and sharp rendering.');
assert.ok((modelViewer.match(/prepareBoardModelMaterials\(/g) || []).length >= 3, 'Material preparation must run for both model thumbnails and the full viewer.');
assert.match(modelViewer, /hemisphereLight\.intensity = isDragging \? 0\.08 : 0\.28[\s\S]*rimLight\.intensity = isDragging \? 3\.8 : 2\.7[\s\S]*scene\.environmentIntensity = isDragging \? 0\.06 : 0\.18/, 'Light dragging must produce unmistakable key, fill and environment contrast.');
assert.match(modelViewer, /rimLight\.position\.set\(-light\.position\.x[\s\S]*--light-angle/, 'The rim light and visible direction indicator must follow the rotated key light.');
assert.match(modelViewer, /window\.messsAPI\.exportFile\(file\.id\)/, 'The viewer download button must use the existing safe export IPC.');
assert.match(modelViewer, /cancelAnimationFrame[\s\S]*disposeBoardModelObject[\s\S]*forceContextLoss\(\)/, 'Closing the viewer must release animation, scene resources and the WebGL context.');
assert.match(styles, /\.board-model-viewer-overlay[\s\S]*place-items:\s*center/, 'The full-screen model dialog must be centered.');
assert.match(styles, /\.board-butler-menu\s*\{[\s\S]*display:\s*flex/, 'The Butler flyout must use the horizontal pill layout.');
assert.match(styles, /\.board-butler-config-panel[\s\S]*\.board-butler-segmented/, 'Butler parameter panels must share the compact control language.');
assert.match(styles, /\.board-butler-mask-overlay[\s\S]*\.board-butler-mask-stage/, 'Erase must use a dedicated mask workspace.');
assert.match(styles, /\.board-item-video\.is-selected\.is-single-selection \.board-image-toolbar/, 'Video Butler toolbar must appear for a selected video.');
assert.match(styles, /\.generated-media-detail-trigger\.is-inline\s*\{[\s\S]*?position:\s*static;[\s\S]*?flex:\s*0 0 25px;/,
  'The inline video details control must participate in toolbar layout.');

assert.match(html, /connect-src messs-file:;/, 'CSP must permit GLTFLoader to fetch only archived local model files.');
assert.doesNotMatch(html.match(/Content-Security-Policy[^>]+/)[0], /connect-src[^;]*(?:https?:|\*)/, 'The model-viewer CSP must not open network fetches.');
const bundleIndex = html.indexOf('vendor/model-viewer.bundle.js');
const controllerIndex = html.indexOf('js/model-viewer.js');
const boardIndex = html.indexOf('js/board-canvas.js');
assert(bundleIndex >= 0 && bundleIndex < controllerIndex && controllerIndex < boardIndex, 'The IIFE vendor and controller must load before the board.');
assert(fs.existsSync(bundlePath) && fs.statSync(bundlePath).size > 100000, 'The built Three.js IIFE bundle must be present.');
assert.strictEqual(packageJson.devDependencies.three, '0.185.1');
assert.strictEqual(packageJson.devDependencies.esbuild, '0.28.1');

process.stdout.write('Butler and model-viewer UI tests passed.\n');
