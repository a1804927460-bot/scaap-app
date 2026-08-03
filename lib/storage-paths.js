'use strict';
/**
 * Resolves where the Messs. library (file index + saved file copies) lives
 * on disk. By design this is a plain, visible, top-level folder — not
 * tucked away inside AppData/Application Support — so that:
 *   1. Users can find and back up their library easily.
 *   2. Uninstalling the app never touches it (NSIS/the macOS uninstaller
 *      only remove what they installed; this folder is outside that scope).
 *   3. Reinstalling the app and pointing it at the same fixed path means
 *      all prior files and the file index are picked back up automatically.
 */
const path = require('path');
const os = require('os');

function getDefaultLibraryRoot() {
  const override = String(process.env.MESSS_LIBRARY_ROOT || '').trim();
  if (override) return path.resolve(override);
  if (process.platform === 'win32') {
    const systemDrive = (process.env.SystemDrive || 'C:').replace(/\\+$/, '');
    return path.join(systemDrive + '\\', 'MesssLibrary');
  }
  // macOS / Linux have no "C:\" concept — the closest equivalent of "a plain,
  // easy-to-find folder outside a hidden app-data directory" is one right in
  // the user's home folder.
  return path.join(os.homedir(), 'MesssLibrary');
}

module.exports = { getDefaultLibraryRoot };
