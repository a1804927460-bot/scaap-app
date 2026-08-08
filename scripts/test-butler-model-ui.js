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
assert.doesNotMatch(boardMedia, /key:\s*'more'/, 'The old three-dot toolbar action must be removed.');
assert.match(boardMedia, /window\.messsAPI && window\.messsAPI\.butler/, 'Butler must use the isolated preload namespace.');
assert.match(boardMedia, /api\.removeBackground\(file\.id\)/, 'Background removal must send only the file id.');
assert.match(boardMedia, /api\.create3d\(file\.id, safeProviderId\)/, '3D creation must send the selected provider id.');
assert.match(boardMedia, /generate3d:hunyuan3d[\s\S]*generate3d:hyper3d/, 'Hunyuan and Hyper3D must keep independent task state.');
assert.match(boardMedia, /api\.get3dStatus\(taskToken\)[\s\S]*api\.download3d\(taskToken\)/, '3D jobs must poll with short requests before downloading.');
assert.match(boardMedia, /role', 'toolbar'/, 'Butler tools must expand as a horizontal toolbar.');
assert.match(boardMedia, /modelGroup\.addEventListener\('mouseenter'/, 'The 3D provider layer must open on hover.');
assert.match(boardMedia, /event\.key === 'Escape'[\s\S]*closeBoardButlerMenu/, 'The Butler toolbar must close with Escape.');
['imageEdit', 'imageLayer', 'imageUpscale', 'eraseObject'].forEach((action) => {
  assert.match(boardMedia, new RegExp(`${action}: Object\\.freeze`), `${action} must have an explicit bridge hook.`);
  assert.match(boardMedia, new RegExp(`BOARD_BUTLER_ICONS\\.${action}`), `${action} must have a semantic icon.`);
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
assert.match(boardMedia, /filters:\s*\[\{ model: 'prob-4' \}\][\s\S]*audioTransfer: 'Copy'/, 'Video enhancement must send the documented filter/output shape.');
assert.match(boardCanvas, /appendBoardVideoButlerToolbar\(el, f, item\)/, 'Selected videos must expose the Butler capsule.');
assert.match(preload, /upscaleVideo:[\s\S]*butler:upscaleVideo/, 'The isolated preload must expose video enhancement.');
assert.match(preload, /getVideoToolStatus:[\s\S]*downloadVideoToolResult:/, 'The isolated preload must expose video polling and download.');
assert.doesNotMatch(preload, /AI302_KEY|AI_302_API_KEY|server-only-302-key/, 'The renderer bridge must never contain the 302 credential.');
assert.match(main, /async function butlerSourceVideo[\s\S]*realpath\(store\.libraryDir\)[\s\S]*isSymbolicLink/, 'Video enhancement must read only a real archived library file.');
assert.match(main, /MAX_BUTLER_VIDEO_BYTES = 48 \* 1024 \* 1024[\s\S]*butler-video-too-large/, 'Video relay input must be bounded before base64 encoding.');
assert.match(main, /Math\.min\(boundWidth \/ sourceWidth, boundHeight \/ sourceHeight\)/, 'Video output sizing must preserve the source aspect ratio.');
assert.match(main, /ipcMain\.handle\('butler:upscaleVideo'[\s\S]*ipcMain\.handle\('butler:getVideoToolStatus'[\s\S]*ipcMain\.handle\('butler:downloadVideoToolResult'/, 'Desktop video tasks must support create, poll, and archive.');
assert.match(main, /const butlerVideoTasks = new Map\(\)[\s\S]*const butlerVideoDownloads = new Map\(\)/, 'Video tasks and downloads must be independently concurrent and deduplicated.');
assert.match(main, /addButlerVideoOutputFile[\s\S]*butlerOperation:[\s\S]*kind: 'video-upscale'/, 'Enhanced videos must be archived with Butler provenance.');
assert.match(main, /creditsCharged !== undefined \? currentTask\.creditsCharged : currentTask\.credits/, 'Enhanced videos must archive the settled charge when available.');

assert.match(storeClient, /mime === 'model\/gltf-binary'/, 'GLB recognition must include the standard model MIME type.');
assert.match(boardCanvas, /f\.modelPreviewUrl \|\| f\.previewUrl \|\| ''/, 'GLB cards must use only a static model preview image.');
assert.doesNotMatch(boardCanvas, /new\s+(?:THREE\.)?WebGLRenderer/, 'Board cards must never allocate a WebGL renderer.');
assert.match(boardCanvas, /else if \(isModel\)[\s\S]*dblclick[\s\S]*openBoardModelViewer\(f\)/, 'Double-clicking a GLB card must open the viewer.');

assert.strictEqual((modelViewer.match(/new THREE\.WebGLRenderer/g) || []).length, 1, 'The app must have one model-viewer renderer allocation path.');
assert.match(modelViewer, /new OrbitControls\(camera, renderer\.domElement\)/, 'The viewer must support orbit interaction.');
assert.match(modelViewer, /window\.messsAPI\.exportFile\(file\.id\)/, 'The viewer download button must use the existing safe export IPC.');
assert.match(modelViewer, /cancelAnimationFrame[\s\S]*disposeBoardModelObject[\s\S]*forceContextLoss\(\)/, 'Closing the viewer must release animation, scene resources and the WebGL context.');
assert.match(styles, /\.board-model-viewer-overlay[\s\S]*place-items:\s*center/, 'The full-screen model dialog must be centered.');
assert.match(styles, /\.board-butler-menu\s*\{[\s\S]*display:\s*flex/, 'The Butler flyout must use the horizontal pill layout.');
assert.match(styles, /\.board-butler-config-panel[\s\S]*\.board-butler-segmented/, 'Butler parameter panels must share the compact control language.');
assert.match(styles, /\.board-butler-mask-overlay[\s\S]*\.board-butler-mask-stage/, 'Erase must use a dedicated mask workspace.');
assert.match(styles, /\.board-item-video\.is-selected\.is-single-selection \.board-image-toolbar/, 'Video Butler toolbar must appear for a selected video.');

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
