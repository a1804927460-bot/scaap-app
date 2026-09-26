'use strict';
/**
 * Resolves where the SCAAP. library (file index + saved file copies) lives
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
const fs = require('fs');

function getDefaultLibraryRoot() {
  const override = String(process.env.MESSS_LIBRARY_ROOT || '').trim();
  if (override) return path.resolve(override);
  if (process.platform === 'win32') {
    const systemDrive = (process.env.SystemDrive || 'C:').replace(/\\+$/, '');
    return path.join(systemDrive + '\\', 'SCAAPLibrary');
  }
  // macOS / Linux have no "C:\" concept — the closest equivalent of "a plain,
  // easy-to-find folder outside a hidden app-data directory" is one right in
  // the user's home folder.
  return path.join(os.homedir(), 'SCAAPLibrary');
}

function configuredLibraryRoot(userDataDir) {
  const directory = String(userDataDir || '').trim();
  if (!directory) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(directory, 'library-location.json'), 'utf8'));
    const value = String(parsed && parsed.path || '').trim();
    if (!path.isAbsolute(value)) return null;
    const resolved = path.resolve(value);
    return fs.existsSync(resolved) ? resolved : null;
  } catch (error) {
    return null;
  }
}

function saveConfiguredLibraryRoot(userDataDir, libraryRoot) {
  const directory = path.resolve(String(userDataDir || ''));
  const configPath = path.join(directory, 'library-location.json');
  const temporaryPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(temporaryPath, JSON.stringify({ path: path.resolve(libraryRoot) }), {
    encoding: 'utf8', mode: 0o600
  });
  try {
    fs.renameSync(temporaryPath, configPath);
  } catch (error) {
    if (process.platform !== 'win32' || !fs.existsSync(configPath)) throw error;
    const backupPath = `${configPath}.bak`;
    fs.copyFileSync(configPath, backupPath);
    try {
      fs.rmSync(configPath, { force: true });
      fs.renameSync(temporaryPath, configPath);
      fs.rmSync(backupPath, { force: true });
    } catch (replaceError) {
      try { fs.renameSync(backupPath, configPath); } catch (restoreError) {}
      throw replaceError;
    }
  }
}

module.exports = { configuredLibraryRoot, getDefaultLibraryRoot, saveConfiguredLibraryRoot };
