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

  function pathFromFileUrl(value) {
    const source = String(value || '').trim();
    if (!/^file:\/\//i.test(source)) return '';
    try {
      const parsed = new URL(source);
      if (parsed.protocol !== 'file:') return '';
      let pathname = decodeURIComponent(parsed.pathname || '');
      if (!pathname) return '';
      if (parsed.hostname && parsed.hostname !== 'localhost') {
        pathname = `//${parsed.hostname}${pathname}`;
      } else if (/^\/[A-Za-z]:\//.test(pathname)) {
        pathname = pathname.slice(1);
      }
      return pathname;
    } catch (error) {
      return '';
    }
  }

  function pathsFromDataTransfer(dataTransfer) {
    if (!dataTransfer || typeof dataTransfer.getData !== 'function') return [];
    const values = [];
    for (const type of ['text/uri-list', 'public.file-url']) {
      try { values.push(String(dataTransfer.getData(type) || '')); } catch (error) {}
    }
    const paths = [];
    const seen = new Set();
    values.join('\n').split(/\r?\n/).forEach((value) => {
      if (!value || /^\s*#/.test(value)) return;
      const filePath = pathFromFileUrl(value);
      if (filePath && !seen.has(filePath)) {
        seen.add(filePath);
        paths.push(filePath);
      }
    });
    return paths;
  }

  function entries(dataTransfer) {
    if (!dataTransfer) return [];
    const result = [];
    const seen = new Set();
    const add = (file, entry = null, explicitPath = '') => {
      if (!file) return;
      const resolvedPath = explicitPath || pathForFile(file);
      const key = resolvedPath ? `path:${resolvedPath}` : fileKey(file);
      if (seen.has(key)) return;
      seen.add(key);
      result.push({ file, entry, path: resolvedPath });
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
    // Some macOS Finder/Electron combinations expose only file:// URIs and
    // leave both DataTransfer.files and DataTransfer.items empty.
    for (const filePath of pathsFromDataTransfer(dataTransfer)) {
      const name = filePath.split(/[\\/]/).pop() || 'Dropped file';
      const pathlessMatch = result.find((entry) =>
        !entry.path && entry.file && String(entry.file.name || '') === name
      );
      if (pathlessMatch) {
        pathlessMatch.path = filePath;
        seen.add(`path:${filePath}`);
        continue;
      }
      add({ name, size: 0, lastModified: 0, type: 'application/octet-stream' }, null, filePath);
    }
    return result;
  }

  function entriesFromFiles(files) {
    return Array.from(files || []).filter(Boolean).map((file) => ({
      file,
      entry: null,
      path: pathForFile(file)
    }));
  }

  function hasFiles(dataTransfer) {
    if (!dataTransfer) return false;
    if (Array.from(dataTransfer.types || []).includes('Files')) return true;
    if (Array.from(dataTransfer.items || []).some((item) => item && item.kind === 'file')) return true;
    if (dataTransfer.files && dataTransfer.files.length) return true;
    return pathsFromDataTransfer(dataTransfer).length > 0;
  }

  async function importFileBytes(file, folderId, canvasId) {
    const api = window.messsAPI;
    if (!api || typeof api.beginDroppedFileImport !== 'function') {
      throw new Error('This version cannot import a dropped file without a native path.');
    }
    const started = await api.beginDroppedFileImport({
      name: file.name,
      size: Number(file.size),
      type: file.type || '',
      lastModified: Number(file.lastModified) || 0
    }, folderId, canvasId);
    const uploadId = started && started.uploadId;
    const chunkSize = Math.max(1, Number(started && started.chunkSize) || 8 * 1024 * 1024);
    if (!uploadId) throw new Error('The dropped file import could not be started.');
    const readBlob = async (blob) => {
      if (blob && typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
      if (typeof FileReader === 'undefined') throw new Error('The dropped file could not be read by this macOS build.');
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('The dropped file could not be read.'));
        reader.readAsArrayBuffer(blob);
      });
    };
    try {
      for (let offset = 0; offset < file.size; offset += chunkSize) {
        const blob = typeof file.slice === 'function'
          ? file.slice(offset, Math.min(file.size, offset + chunkSize))
          : file;
        const buffer = await readBlob(blob);
        await api.appendDroppedFileImport(uploadId, new Uint8Array(buffer));
        if (typeof file.slice !== 'function') break;
      }
      return await api.finishDroppedFileImport(uploadId);
    } catch (error) {
      if (typeof api.abortDroppedFileImport === 'function') {
        await api.abortDroppedFileImport(uploadId).catch(() => {});
      }
      throw error;
    }
  }

  function mergeImportResult(target, result) {
    if (!result) return;
    if (Array.isArray(result.imported)) target.imported.push(...result.imported);
    if (Array.isArray(result.unlocked)) result.unlocked.forEach((key) => target.unlocked.add(key));
    if (Array.isArray(result.failed)) target.failed.push(...result.failed);
  }

  async function importEntries(droppedEntries, folderId, canvasId) {
    const normalized = Array.from(droppedEntries || []).filter((entry) => entry && entry.file);
    const result = { imported: [], unlocked: new Set(), failed: [] };
    const paths = normalized
      .filter((entry) => !(entry.entry && entry.entry.isDirectory) && entry.path)
      .map((entry) => entry.path);
    if (paths.length) {
      mergeImportResult(result, await window.messsAPI.importFiles(paths, folderId, canvasId));
    }
    for (const entry of normalized) {
      if ((entry.entry && entry.entry.isDirectory) || entry.path) continue;
      try {
        mergeImportResult(result, await importFileBytes(entry.file, folderId, canvasId));
      } catch (error) {
        result.failed.push({ name: entry.file.name || '', error });
      }
    }
    return { imported: result.imported, unlocked: [...result.unlocked], failed: result.failed };
  }

  window.MesssFileDrop = Object.freeze({
    entries,
    entriesFromFiles,
    hasFiles,
    importEntries,
    pathForFile
  });
})();
