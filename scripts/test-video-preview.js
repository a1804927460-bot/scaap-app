'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { transcodeVideoToWebCompatible } = require('../lib/preview');

const boardSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'board-canvas.js'), 'utf8');
const boardStyles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles', 'main.css'), 'utf8');
const previewSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'preview-canvas.js'), 'utf8');
const mediaMetaSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'board-media-meta.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

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
  /function requestPlayback\(\)[\s\S]*?HAVE_CURRENT_DATA[\s\S]*?loadeddata[\s\S]*?canplay[\s\S]*?video\.load\(\)/,
  'Canvas video hover playback must wait for decodable data and retry instead of swallowing an early play rejection.'
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
assert.doesNotMatch(boardSource, /'\.mini-video-player'/,
  'The video player surface must not be classified as a canvas UI layer that blocks dragging.');
assert.match(
  boardSource,
  /content\.addEventListener\('mouseenter',[\s\S]*?_boardPlayPreview[\s\S]*?content\.addEventListener\('mouseleave',[\s\S]*?_boardStopPreview/,
  'Canvas videos must play on hover and stop when the pointer leaves.'
);
assert.match(
  boardSource,
  /poster\.addEventListener\('load',[\s\S]*?syncBoardOverviewFallback[\s\S]*?video\.addEventListener\('loadeddata',[\s\S]*?classList\.add\('has-frame'\)/,
  'The video poster must remain until a decodable frame is ready and resync the canvas fallback after loading.'
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
  /submitBoardQuickGeneration[\s\S]*?resolution:\s*videoResolution[\s\S]*?supportedVideoAspectRatio\(original\.aspectRatio, videoCapabilities, referenceFileIds\.length > 0\)/,
  'Quick video generation must use the selected provider resolution and frame-reference ratios.'
);
assert.match(
  boardSource,
  /retryGeneratedMediaFromDetails[\s\S]*?videoProvider[\s\S]*?resolution:\s*videoResolution[\s\S]*?supportedVideoAspectRatio\(generation\.aspectRatio, videoCapabilities, references\.referenceFileIds\.length > 0\)/,
  'Video retries must repair metadata against the original provider capabilities.'
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
  previewSource,
  /function monitorVideoPlayback[\s\S]*?startedAt[\s\S]*?video\.currentTime[\s\S]*?2600[\s\S]*?NotSupportedError[\s\S]*?waiting[\s\S]*?stalled/,
  'The main file preview must recover from silent video stalls as well as codec errors.'
);
assert.match(
  mainSource,
  /function localFileProtocolResponse[\s\S]*?headers\.get\('range'\)[\s\S]*?status:\s*206[\s\S]*?'Accept-Ranges': 'bytes'[\s\S]*?'Content-Range': `bytes \$\{start\}-\$\{end\}\/\$\{total\}`/,
  'Local media must return a standards-compliant partial response for reliable streaming and seeking.'
);
assert.match(
  mainSource,
  /protocol\.handle\('messs-file',[\s\S]*?localFileProtocolResponse\([\s\S]*?protocol\.handle\('messs-transcode',[\s\S]*?localFileProtocolResponse\(/,
  'Original and transcoded media protocols must share the byte-range responder.'
);
assert.match(
  mediaMetaSource,
  /function appendBoardVideoButlerToolbar[\s\S]*?isVideoExt\(file\.ext\)[\s\S]*?BOARD_BUTLER_VIDEO_EXTENSIONS\.has[\s\S]*?board-video-fullscreen[\s\S]*?BOARD_IMAGE_TOOL_ICONS\.fullscreen[\s\S]*?openFileFullscreenPreview\(file, video\)/,
  'Every selected canvas video must expose the same fullscreen action as an image, even when Butler does not support its container.'
);
assert.match(
  previewSource,
  /async function openFileFullscreenPreview\(file, sourceMedia = null\)[\s\S]*?isVideoExt\(file\.ext\)[\s\S]*?showFullscreenMedia\(video, \{ videoFileId: file\.id \}\)/,
  'The file fullscreen helper must open canvas videos and preserve an already-mounted player when available.'
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
    process.stdout.write('Video preview tests passed.\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
