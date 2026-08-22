'use strict';

/* Finder and Explorer expose external drops through slightly different
 * DataTransfer collections. macOS can populate only `files`, so normalize
 * both collections before a drop target tries to import anything. */
(function exposeFileDropHelpers() {
  function fileKey(file) {
    if (!file) return '';
    return [file.name || '', file.size || 0, file.lastModified || 0, file.type || ''].join('|');
  }

  function pathForFile(file) {
    if (!file) return '';
    try {
      const resolved = window.messsAPI && typeof window.messsAPI.getPathForFile === 'function'
        ? window.messsAPI.getPathForFile(file)
        : '';
      if (resolved) return String(resolved);
    } catch (error) {
      // Older macOS Chromium builds can reject a Finder File in webUtils.
    }
    return typeof file.path === 'string' ? file.path : '';
  }

  function entries(dataTransfer) {
    if (!dataTransfer) return [];
    const result = [];
    const seen = new Set();
    const add = (file, entry = null) => {
      if (!file) return;
      const key = fileKey(file);
      if (seen.has(key)) return;
      seen.add(key);
      result.push({ file, entry, path: pathForFile(file) });
    };

    for (const item of Array.from(dataTransfer.items || [])) {
      if (item.kind !== 'file') continue;
      let file = null;
      try { file = typeof item.getAsFile === 'function' ? item.getAsFile() : null; } catch (error) {}
      let entry = null;
      try { entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null; } catch (error) {}
      add(file, entry);
    }
    // Finder drops may expose no items even though files is populated.
    for (const file of Array.from(dataTransfer.files || [])) add(file);
    return result;
  }

  window.MesssFileDrop = Object.freeze({ entries, pathForFile });
})();
