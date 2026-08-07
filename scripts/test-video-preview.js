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

assert.match(
  boardSource,
  /video\.addEventListener\('error',[\s\S]*?video\.src\s*=\s*res\.url;[\s\S]*?video\.load\(\);[\s\S]*?if \(wantsPreview\) video\.play\(\)/,
  'A failed native video must resume hover playback after its transcoded source is installed.'
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
assert.match(
  boardSource,
  /content\.addEventListener\('mouseenter',[\s\S]*?_boardPlayPreview[\s\S]*?content\.addEventListener\('mouseleave',[\s\S]*?_boardStopPreview/,
  'Canvas videos must play on hover and stop when the pointer leaves.'
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
  /function supportedMiniMaxResolution[\s\S]*?\['768P', '2K'\]/,
  'Board quick generation and retries must map video requests to a MiniMax resolution.'
);
assert.match(
  boardSource,
  /submitBoardQuickGeneration[\s\S]*?resolution:\s*videoResolution[\s\S]*?supportedMiniMaxAspectRatio\(original\.aspectRatio, referenceFileIds\.length > 0\)/,
  'Quick video generation must send a resolution and use the adaptive frame-reference ratio.'
);
assert.match(
  boardSource,
  /retryGeneratedMediaFromDetails[\s\S]*?resolution:\s*videoResolution[\s\S]*?supportedMiniMaxAspectRatio\(generation\.aspectRatio, references\.referenceFileIds\.length > 0\)/,
  'Video retries must repair legacy resolution and reference-ratio metadata.'
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
