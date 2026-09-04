'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  decodeTextBuffer,
  readTextPreview
} = require('../lib/preview');

const root = path.resolve(__dirname, '..');
const previewSource = fs.readFileSync(path.join(root, 'lib', 'preview.js'), 'utf8');
const preloadSource = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');
const builder = fs.readFileSync(path.join(root, 'electron-builder.release.yml'), 'utf8');

assert.match(
  previewSource,
  /const sourceState = await sourceFingerprint\(srcPath\)[\s\S]*?markCachedOutput\(metadataPath, srcPath, sourceState\)/,
  'Document conversions must bind cached output to the source state captured before conversion.'
);
assert.match(
  previewSource,
  /mkdtemp\(path\.join\(cacheDir, '\.office-preview-'\)\)[\s\S]*?validatePdfOutput\(producedPath\)/,
  'LibreOffice must convert in a fresh directory and validate the produced PDF.'
);
assert.doesNotMatch(
  previewSource,
  /limitInputPixels:\s*false/,
  'Untrusted image previews must retain Sharp decompression-bomb limits.'
);
assert.match(
  preloadSource,
  /MAX_CACHED_PDF_DOCUMENTS[\s\S]*?mtimeNs[\s\S]*?activeRenders[\s\S]*?disposeRequested[\s\S]*?releaseCachedPdf/,
  'PDF rendering must use a bounded, file-signature-aware cache that defers disposal while rendering.'
);
assert.match(
  previewSource,
  /saved\.schema === PREVIEW_CACHE_SCHEMA[\s\S]*?cached\.schema === PREVIEW_CACHE_SCHEMA/,
  'Preview caches must reject metadata from unsupported cache schemas.'
);
assert.match(workflow, /choco install libreoffice --no-progress/);
assert.match(workflow, /soffice\.exe/);
assert.match(workflow, /choco install imagemagick\.app/);
assert.match(workflow, /Copy-Item \$libreOffice build-resources\/tools\/libreoffice -Recurse/);
assert.match(builder, /from:\s*build-resources\/tools[\s\S]*?to:\s*tools/);

const gb18030 = decodeTextBuffer(Buffer.from([0xD6, 0xD0, 0xCE, 0xC4]));
assert.equal(gb18030.encoding, 'gb18030');
assert.equal(gb18030.text, '中文');

const truncatedUtf8Bom = decodeTextBuffer(Buffer.from([0xEF, 0xBB, 0xBF, 0x61, 0xE4, 0xB8]), {
  allowTruncatedUtf8: true
});
assert.deepEqual(truncatedUtf8Bom, { text: 'a', encoding: 'utf-8' });
const truncatedUtf16BeBom = decodeTextBuffer(Buffer.from([0xFE, 0xFF, 0x00, 0x61, 0x4E]), {
  allowTruncatedUtf8: true
});
assert.deepEqual(truncatedUtf16BeBom, { text: 'a', encoding: 'utf-16be' });

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'messs-document-preview-'));
  const textPath = path.join(tempDir, 'utf8-boundary.txt');
  try {
    fs.writeFileSync(textPath, 'abc你def', 'utf8');
    const preview = await readTextPreview(textPath, 5);
    assert.equal(preview.encoding, 'utf-8');
    assert.equal(preview.content, 'abc');
    assert.equal(preview.partial, true);
    assert.equal(preview.content.includes('ä'), false);
    process.stdout.write('Document preview tests passed.\n');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
