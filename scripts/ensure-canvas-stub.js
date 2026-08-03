'use strict';
/**
 * Runs automatically after `npm install` finishes (see package.json's
 * "postinstall" script). Makes sure node_modules/canvas exists and is our
 * empty stub — regardless of whether npm's `overrides` field actually
 * resolved/linked it the way we expect.
 *
 * Why this exists: pdfjs-dist declares `canvas` as a real dependency, and
 * canvas needs a C++ compiler to build from source, which most Windows
 * machines don't have — so a plain `npm install` fails outright on most
 * Windows machines (see README "canvas@2.11.2 install" section). The fix
 * is package.json's `"overrides": { "canvas": "file:./vendor/empty-canvas-stub" }`,
 * which is supposed to make npm install our empty placeholder instead of
 * the real canvas package.
 *
 * In testing, that worked fine for the `npm install` step itself, but
 * electron-builder's `@electron/rebuild` step (which scans node_modules
 * for native dependencies before packaging into an .exe) appears to look
 * at pdfjs-dist's *declared* dependency on canvas rather than what
 * `overrides` actually resolved it to in some dependency-tree shapes, and
 * throws `ENOENT: no such file or directory, stat '...\node_modules\canvas'`
 * if that folder doesn't exist on disk at all.
 *
 * IMPORTANT Windows quirk discovered after the first version of this fix
 * shipped: plain `fs.mkdirSync(dir, { recursive: true })` can itself throw
 * ENOENT on Windows even when the parent directory genuinely exists — this
 * is a known, documented Node.js/Windows behavior (see e.g.
 * nodejs/node#31481, and the npm "mkdirp" package's own docs, which warn
 * that Windows can report ENOENT for failures that have nothing to do with
 * a missing path). The most likely real cause here: `overrides` already
 * created *something* at node_modules/canvas — possibly a broken or
 * partial symlink/junction — and Windows' ENOENT is actually describing
 * that broken link, not a genuinely missing parent folder. A bare mkdir
 * can't recover from that.
 *
 * So instead of trusting mkdirSync's recursive option to "just work", this
 * version explicitly removes whatever is at the target path first (file,
 * directory, or broken link — fs.rmSync with force:true handles all three
 * without caring which one it is), and only then creates a fresh real
 * directory and writes the stub's files into it. This makes the fix work
 * regardless of what (if anything) was left behind at that path before.
 */
const fs = require('fs');
const path = require('path');

// This script lives in scripts/, so __dirname is .../scripts — go up one
// level to reach the actual project root where vendor/ and node_modules/ live.
const projectRoot = path.join(__dirname, '..');
const stubDir = path.join(projectRoot, 'vendor', 'empty-canvas-stub');
const nodeModulesDir = path.join(projectRoot, 'node_modules');
const targetDir = path.join(nodeModulesDir, 'canvas');

function isValidStub(dir) {
  try {
    return fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'index.js'));
  } catch (err) {
    return false; // an existsSync check on a broken link can itself throw on some platforms
  }
}

function ensureCanvasStub() {
  if (isValidStub(targetDir)) {
    console.log('[postinstall] node_modules/canvas already present (empty stub) — nothing to do.');
    return;
  }

  if (!fs.existsSync(nodeModulesDir)) {
    // node_modules itself genuinely doesn't exist — npm install must not
    // have run (or ran somewhere unexpected). Nothing useful to do here;
    // surface a clear message and bail without throwing.
    console.error('[postinstall] node_modules itself was not found at', nodeModulesDir);
    console.error('[postinstall] This usually means npm install did not run in this folder. Skipping.');
    return;
  }

  console.log('[postinstall] node_modules/canvas missing or incomplete — clearing and rewriting it.');

  // Clear out whatever is currently at the target path — could be nothing,
  // a stray file, a real directory, or (most likely, based on the Windows
  // ENOENT reports) a broken symlink/junction left behind by `overrides`.
  // force:true means this won't throw even if the path doesn't exist at all.
  try {
    fs.rmSync(targetDir, { recursive: true, force: true });
  } catch (err) {
    console.error('[postinstall] Could not clear the existing node_modules/canvas path:', err.message);
    console.error('[postinstall] Continuing anyway — the mkdir below may still succeed or fail informatively.');
  }

  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(path.join(stubDir, 'package.json'), path.join(targetDir, 'package.json'));
  fs.copyFileSync(path.join(stubDir, 'index.js'), path.join(targetDir, 'index.js'));
  console.log('[postinstall] Done — node_modules/canvas now exists as a harmless empty stub.');
}

try {
  ensureCanvasStub();
} catch (err) {
  // Never let this script itself break `npm install` — if something here
  // goes wrong, surface it clearly but don't throw, since failing the
  // whole install over what's meant to be a defensive fixup would be worse
  // than just leaving the (already-attempted) overrides result in place.
  console.error('[postinstall] Could not verify/create the canvas stub:', err.message);
  console.error('[postinstall] This is usually harmless — continuing.');
}
