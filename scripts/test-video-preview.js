'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { findWebCompatibleVideoPreview, transcodeVideoToWebCompatible } = require('../lib/preview');

const boardSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'board-canvas.js'), 'utf8');
const boardStyles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles', 'main.css'), 'utf8');
const previewSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'preview-canvas.js'), 'utf8');
const mediaMetaSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'board-media-meta.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const gatewayServerSource = fs.readFileSync(path.join(__dirname, '..', 'gateway', 'src', 'server.js'), 'utf8');
const localFileResponseSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'local-file-response.js'), 'utf8');

assert.match(
  boardSource,
  /function recoverPlayableSource\(\)[\s\S]*?transcodeVideo\(f\.id\)[\s\S]*?cacheBoardPreview\(f\.id,[\s\S]*?installVideoSource\(res\.url, true\)/,
  'A failed native canvas video must cache and install its transcoded source.'
);
assert.match(
  boardSource,
  /function armPlaybackWatchdog\(request\)[\s\S]*?startedAt[\s\S]*?video\.currentTime[\s\S]*?recoverPlayableSource\(\);[\s\S]*?\}, 2600\);/,
  'Canvas video playback must recover when the browser stalls without emitting an error.'
);
assert.match(
  boardSource,
  /video\.addEventListener\('waiting',[\s\S]*?armPlaybackWatchdog\(playRequest\)[\s\S]*?video\.addEventListener\('stalled',[\s\S]*?armPlaybackWatchdog\(playRequest\)/,
  'Waiting and stalled canvas videos must be covered by the playback watchdog.'
);
assert.match(
  boardSource,
  /function armReadyPlaybackRetry\(request\)[\s\S]*?loadeddata[\s\S]*?canplay[\s\S]*?function requestPlayback\(request = playRequest\)[\s\S]*?HAVE_CURRENT_DATA[\s\S]*?video\.load\(\)/,
  'Canvas video playback must wait for decodable data without stacking duplicate ready listeners.'
);
assert.match(
  boardSource,
  /content\.addEventListener\('click',[\s\S]*?Board\.lastDragEndedAt[\s\S]*?ensurePlayer\(\)[\s\S]*?_boardPlayPreview/,
  'A non-drag primary click must start canvas video playback immediately.'
);
assert.match(
  boardSource,
  /let activePlayPromise = null;[\s\S]*?if \(activePlayPromise\) return;[\s\S]*?playbackRetries \+= 1[\s\S]*?playbackRetries > 2[\s\S]*?recoverPlayableSource/,
  'Interrupted play requests must retry idempotently before falling back to a compatible transcode.'
);
assert.match(
  boardSource,
  /if \(e\.button !== 0 \|\| e\.altKey\) return;/,
  'Middle-button and Alt gestures must not start a board-item drag.'
);
assert.match(
  boardStyles,
  /\.mini-video-player video\s*\{[\s\S]*?pointer-events:\s*none;/,
  'The video surface must leave board dragging to the parent item.'
);
assert.doesNotMatch(boardSource, /board-video-play-indicator/,
  'Canvas videos must not cover their content with a central play button.');
const boardUiSelectorSource = boardSource.slice(
  boardSource.indexOf('const BOARD_UI_EVENT_SELECTOR = ['),
  boardSource.indexOf('function isBoardUiEventTarget')
);
assert.doesNotMatch(boardUiSelectorSource, /'\.mini-video-player'/,
  'The video player surface must not be classified as a canvas UI layer that blocks dragging.');
assert.match(
  boardSource,
  /content\.addEventListener\('mouseenter',[\s\S]*?_boardPlayPreview[\s\S]*?content\.addEventListener\('mouseleave',[\s\S]*?_boardStopPreview/,
  'Canvas videos must play on hover and stop when the pointer leaves.'
);
assert.match(
  boardSource,
  /poster\.addEventListener\('load',[\s\S]*?scheduleBoardLeaferSync[\s\S]*?video\.addEventListener\('loadeddata',[\s\S]*?classList\.add\('has-frame'\)/,
  'The video poster must remain until a decodable frame is ready and schedule a coalesced Leafer refresh after loading.'
);
assert.match(
  boardSource,
  /playerPromise\s*=\s*loadBoardPreview\(f\.id\)[\s\S]*?\.catch\(\(\)\s*=>\s*\{[\s\S]*?playerPromise\s*=\s*null;/,
  'A transient preview failure must allow the next hover to retry.'
);
assert.match(
  boardSource,
  /createBoardVideoDurationBadge[\s\S]*?board-video-duration/,
  'Canvas videos must render a duration badge.'
);
assert.doesNotMatch(
  boardSource,
  /appendBoardMediaMeta\(el, f\)/,
  'Canvas media must not render filename, dimensions or file size labels outside the item.'
);
assert.match(
  boardSource,
  /function supportedVideoResolution[\s\S]*?supportedVideoResolutions\(capabilities\)/,
  'Board quick generation and retries must map video requests to the selected provider capabilities.'
);
assert.match(
  boardSource,
  /submitBoardQuickGeneration[\s\S]*?const videoMode = isVideo[\s\S]*?videoModeRatios\(videoMode, videoCapabilities\)[\s\S]*?resolution:\s*videoResolution[\s\S]*?videoMode:\s*isVideo \? videoMode\.id : null/,
  'Quick video generation must use the selected provider resolution and generation-mode ratios.'
);
assert.match(
  boardSource,
  /retryGeneratedMediaFromDetails[\s\S]*?videoProvider[\s\S]*?const videoMode = isVideo[\s\S]*?generation\.videoMode[\s\S]*?resolution:\s*videoResolution[\s\S]*?videoMode:\s*isVideo \? videoMode\.id : null/,
  'Video retries must preserve the original generation mode and repair metadata against provider capabilities.'
);
assert.match(
  boardSource,
  /'480P': '480p'[\s\S]*?'720P': '720p'/,
  'Seedance resolutions must have accurate UI hints instead of falling through to the 4K label.'
);
assert.doesNotMatch(
  boardSource,
  /aspectRatio:\s*kind === 'video' && boardReferences\.size \? 'adaptive' : ratio/,
  'Reference images must not force every video provider to the MiniMax adaptive ratio.'
);
assert.match(
  mainSource,
  /supportedRatios\.size === 1 && supportedRatios\.has\('adaptive'\)[\s\S]*?aspectRatio = 'adaptive'/,
  'Desktop validation must accept an explicit source ratio for adaptive-only reference modes.'
);
assert.match(
  gatewayServerSource,
  /const generalRatios = new Set\(configuredGeneralRatios\.map\(String\)\)[\s\S]*?videoMode === 'text' \? textRatios : generalRatios/,
  'Gateway validation must accept adaptive ratios for Seedance full-reference modes.'
);
assert.match(
  boardSource,
  /function adaptiveRatioDisplayLabel[\s\S]*?Follow reference[\s\S]*?sourceWidth[\s\S]*?sourceHeight/,
  'Adaptive reference modes must explain that they follow the source material and show its real ratio.'
);
assert.match(
  previewSource,
  /function monitorVideoPlayback[\s\S]*?startedAt[\s\S]*?video\.currentTime[\s\S]*?2600[\s\S]*?NotSupportedError[\s\S]*?waiting[\s\S]*?stalled/,
  'The main file preview must recover from silent video stalls as well as codec errors.'
);
assert.match(
  localFileResponseSource,
  /function createLocalFileResponse[\s\S]*?headers\.get\('range'\)[\s\S]*?status:\s*200[\s\S]*?'Accept-Ranges': 'bytes'[\s\S]*?status:\s*206[\s\S]*?'Content-Range': `bytes \$\{start\}-\$\{end\}\/\$\{total\}`/,
  'Local media must return a standards-compliant partial response for reliable streaming and seeking.'
);
assert.match(
  localFileResponseSource,
  /function createCancelableFileWebStream[\s\S]*?if \(settled\) return;[\s\S]*?cancel\(\)[\s\S]*?fileStream\.destroy\(\)/,
  'Cancelled protocol media streams must settle once and destroy their file reader safely.'
);
assert.match(mainSource, /function localFileProtocolResponse[\s\S]*?createLocalFileResponse\(request, filePath/);
assert.match(
  mainSource,
  /function normalizedVideoModes[\s\S]*?configuredMinimum === 0[\s\S]*?'first-frame'[\s\S]*?'first-last-frame'[\s\S]*?const videoModes = normalizedVideoModes\(capabilities\)/,
  'Desktop request validation must infer the same frame modes shown for legacy video models.'
);
assert.match(
  mainSource,
  /async function addGeneratedMediaFile[\s\S]*?\.part`\)[\s\S]*?handle\.sync\(\)[\s\S]*?rename\(temporaryPath, storedPath\)[\s\S]*?validateVideoFile\(storedPath\)[\s\S]*?transcodeVideoToWebCompatible\(storedPath, previewCacheDir, id\)[\s\S]*?videoPreviewError[\s\S]*?store\.addFile\(record\)/,
  'Generated videos must be atomically archived and retained even when initial preview preparation fails.'
);
const generatedMediaFunction = mainSource.match(/async function addGeneratedMediaFile[\s\S]*?\r?\n}\r?\n\r?\nfunction addGeneratedMediaBoardItem/);
assert.ok(generatedMediaFunction, 'Generated media archival function must remain inspectable.');
assert.doesNotMatch(
  generatedMediaFunction[0],
  /catch \(error\) \{[\s\S]{0,500}?rm\(storedPath/,
  'A preview or codec failure must never delete an already downloaded paid video.'
);
assert.match(
  mainSource,
  /files:getPreview[\s\S]*?findWebCompatibleVideoPreview[\s\S]*?messs-transcode:\/\/\$\{f\.id\}[\s\S]*?transcoded:\s*true/,
  'Every later preview must reuse the prepared or previously cached compatible video.'
);
assert.match(
  mainSource,
  /protocol\.handle\('messs-file',[\s\S]*?localFileProtocolResponse\([\s\S]*?protocol\.handle\('messs-transcode',[\s\S]*?localFileProtocolResponse\(/,
  'Original and transcoded media protocols must share the byte-range responder.'
);
assert.match(
  mainSource,
  /scheme: 'messs-file',[\s\S]*?standard: true[\s\S]*?scheme: 'messs-transcode',[\s\S]*?standard: true/,
  'Local media schemes must be standard schemes so Chromium accepts them as video sources.'
);
assert.match(
  mediaMetaSource,
  /function appendBoardVideoButlerToolbar[\s\S]*?isVideoExt\(file\.ext\)[\s\S]*?BOARD_BUTLER_VIDEO_EXTENSIONS\.has[\s\S]*?board-video-fullscreen[\s\S]*?BOARD_IMAGE_TOOL_ICONS\.fullscreen[\s\S]*?openFileFullscreenPreview\(file, video\)/,
  'Every selected canvas video must expose the same fullscreen action as an image, even when Butler does not support its container.'
);
assert.match(
  boardSource,
  /function installBoardMediaControls\(element, file, item, kind\)[\s\S]*?if \(kind === 'image'\)[\s\S]*?return;[\s\S]*?const videoToolbar = appendBoardVideoButlerToolbar\(element, file, item\);[\s\S]*?appendGeneratedMediaDetailsControl\(element, file, videoToolbar\);[\s\S]*?appendBoardEditHint\(element, 'video'\);/,
  'Every canvas video must expose details and the Tab edit capsule when its active single-selection controls are mounted.'
);
assert.match(
  boardSource,
  /e\.key === 'Tab'[\s\S]*?selectedBoardVideoItems\(\)\.length[\s\S]*?openAiComposerForSelection\(editKind\)/,
  'Tab must route a selected video into the video composer instead of the image composer.'
);
assert.match(
  mediaMetaSource,
  /const isVideoDetail = isVideoExt\(file && file\.ext\)[\s\S]*?const mediaDuration = Number\(file\.sourceDuration\)[\s\S]*?isVideoDetail && mediaDuration > 0/,
  'Imported videos must render video metadata even when no generation record exists.'
);
assert.match(
  boardStyles,
  /\.board-item-video\.is-selected\.is-single-selection \.board-edit-hint[\s\S]*?opacity:\s*1/,
  'The selected-video edit capsule must be visible.'
);
assert.match(
  boardStyles,
  /\.fullscreen-stage \.messs-video-player\.is-fullscreen-player video \{[\s\S]*?width:\s*100%;[\s\S]*?height:\s*100%;[\s\S]*?object-fit:\s*contain;/,
  'Fullscreen videos must fit their complete frame inside the viewport instead of using oversized intrinsic dimensions.'
);
assert.match(
  previewSource,
  /async function openFileFullscreenPreview\(file, sourceMedia = null\)[\s\S]*?isVideoExt\(file\.ext\)[\s\S]*?showFullscreenMedia\(video, \{ videoFileId: file\.id, autoplay: true \}\)/,
  'The file fullscreen helper must open canvas videos, preserve mounted players and start playback immediately.'
);
assert.doesNotMatch(
  boardSource,
  /if \(f\.videoPreviewReady === true\) void ensurePlayer\(\);/,
  'Canvas videos must keep the lightweight preview until the user interacts instead of starting a decoder for every mounted item.'
);
assert.match(
  previewSource,
  /function showFullscreenMedia[\s\S]*?videoFileId[\s\S]*?transcodeVideo\(options\.videoFileId\)[\s\S]*?playbackMonitor\.reset\(\)/,
  'Fullscreen canvas video playback must retain the codec-recovery fallback.'
);

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'messs-video-preview-'));
  const source = path.join(root, 'small-source.mp4');
  try {
    const generated = spawnSync(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=0x2f80ed:s=960x540:d=4:r=24',
      '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      source
    ], { encoding: 'utf8', windowsHide: true });
    assert.strictEqual(generated.status, 0, generated.stderr || 'Could not create the video fixture.');

    const output = await transcodeVideoToWebCompatible(source, path.join(root, 'cache'), 'fixture');
    const outputSize = fs.statSync(output).size;
    assert.ok(outputSize > 0, 'The transcoded preview must be non-empty.');
    assert.ok(outputSize < 32 * 1024, 'The fixture must cover valid previews smaller than the old 32 KiB cutoff.');

    const cached = await transcodeVideoToWebCompatible(source, path.join(root, 'cache'), 'fixture');
    assert.strictEqual(cached, output);
    const discovered = await findWebCompatibleVideoPreview(source, path.join(root, 'cache'), 'fixture');
    assert.strictEqual(discovered, output, 'Prepared playback must be discoverable without another transcode.');
    process.stdout.write('Video preview tests passed.\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
