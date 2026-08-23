'use strict';
/* Sidebar folders.
   Two kinds of "folder" exist, and they're shown in different places:
     - Folders you build yourself with the "+" button �?permanent navigation
       structure, always listed at the very top (#folder-list), right under
       the undeletable "default" folder.
     - Folders that come from importing a real OS folder (drag-in or the
       "导入文件�? button) �?behave like content: they show up as items
       inside whatever you were viewing when you imported them, the same
       way a sub-folder you drilled into shows its own children. They never
       get a row in the stable top-level list.
   Whichever folder is open, its children (manual or imported �?no
   distinction once you're inside something) appear in a section right
   below the stable top-level list, never above it, with a "back" row.

   Click behaviour differs by kind, per spec:
     - Manual folder:   1 click selects+enters; 2 clicks on the name renames.
     - Imported folder: 1 click only highlights ("鐐瑰嚮鏁堟灉"); 2 clicks
       enters; 3 clicks on the name renames.
   Shift+click toggles multi-select for the merge/delete-multiple menu.
   Click empty space anywhere to return to the default folder. */

function defaultFolderEntry() {
  const savedName = String(AppState.defaultFolderName || '').trim();
  const genericNames = new Set(['', 'Library', '资料库', 'Default', '默认']);
  const defaultName = genericNames.has(savedName) ? t('All files', '全部文件') : savedName;
  return { id: 'default', name: defaultName, isDefault: true, parentId: null };
}

function folderText(en, zh) {
  return t(en, zh);
}

function topLevelFolders() {
  return AppState.folders.filter((f) => !f.parentId && !f.isImported);
}

function childFoldersOf(contextId) {
  if (contextId === null) {
    return AppState.folders.filter((f) => !f.parentId && f.isImported);
  }
  return AppState.folders.filter((f) => f.parentId === contextId);
}

function renderFolderList() {
  const list = document.getElementById('folder-list');
  list.innerHTML = '';
  list.appendChild(buildFolderItem(defaultFolderEntry()));
  for (const folder of topLevelFolders()) {
    list.appendChild(buildFolderItem(folder));
  }
  renderChildFolderSection();
}

function beginFolderRename(folderId) {
  const row = document.querySelector(`#folder-list .folder-item[data-folder-id="${folderId}"]`);
  if (!row) return;
  const name = row.querySelector('.folder-item-name');
  const input = row.querySelector('.folder-item-rename-input');
  if (!name || !input) return;
  name.hidden = true;
  input.hidden = false;
  input.focus();
  input.select();
}

async function createTopLevelFolder() {
  const button = document.getElementById('add-folder-btn');
  if (button) button.disabled = true;
  try {
    const folder = await window.messsAPI.createFolder('', null);
    if (!folder || !folder.id) throw new Error(folderText('Could not create folder', '无法新建文件夹'));
    AppState.folders.push(folder);
    renderFolderList();
    beginFolderRename(folder.id);
  } catch (error) {
    showToast(error && error.message ? error.message : folderText('Could not create folder', '无法新建文件夹'));
  } finally {
    if (button) button.disabled = false;
  }
}

function renderChildFolderSection() {
  const breadcrumb = document.getElementById('folder-breadcrumb');
  const breadcrumbLabel = document.getElementById('folder-breadcrumb-label');
  const subList = document.getElementById('subfolder-list');
  subList.innerHTML = '';

  if (activeDateFolderMatchesContext()) {
    const parent = currentFolderContextId()
      ? AppState.folders.find((folder) => folder.id === currentFolderContextId())
      : null;
    breadcrumb.hidden = false;
    breadcrumbLabel.textContent = `${folderText('Back to', '\u8fd4\u56de')} ${parent ? parent.name : folderText('Library', '\u8d44\u6599\u5e93')}`;
    subList.hidden = true;
    return;
  }

  const context = activeFolderNavContext();
  if (!context) {
    breadcrumb.hidden = true;
    subList.hidden = true;
    return;
  }

  breadcrumb.hidden = !context.backLabel;
  if (context.backLabel) breadcrumbLabel.textContent = context.backLabel;
  subList.hidden = context.siblings.length === 0;
  if (context.siblings.length) {
    const label = document.createElement('li');
    label.className = 'subfolder-section-label';
    label.textContent = folderText('Subfolders', '子文件夹');
    subList.appendChild(label);
  }
  for (const sub of context.siblings) {
    subList.appendChild(buildFolderItem(sub, true));
  }
}

function activeFolderNavContext() {
  const active = AppState.activeFolderId;

  if (!active || active === 'default') {
    const children = childFoldersOf(null);
    if (children.length === 0) return null;
    return { backLabel: null, siblings: children };
  }

  const activeFolder = AppState.folders.find((f) => f.id === active);
  if (!activeFolder) return null;

  if (activeFolder.parentId) {
    const parent = AppState.folders.find((f) => f.id === activeFolder.parentId);
    return {
      backLabel: `${folderText('Back to', '返回')} ${parent ? parent.name : folderText('Parent', '上级')}`,
      siblings: [activeFolder]
    };
  }

  const children = childFoldersOf(activeFolder.id);
  if (activeFolder.isImported) {
    return {
      backLabel: folderText('Back to Library', '返回资料库'),
      siblings: [activeFolder, ...children]
    };
  }
  if (children.length === 0) return null;
  return { backLabel: activeFolder.name, siblings: children };
}

function currentFolderContextId() {
  if (!AppState.activeFolderId || AppState.activeFolderId === 'default') return null;
  return AppState.activeFolderId;
}

function activeDateFolderMatchesContext() {
  return !!AppState.activeDateFolderKey &&
    AppState.activeDateFolderBaseId === currentFolderContextId();
}

function activeDateFolderLabel() {
  return activeDateFolderMatchesContext()
    ? formatFileDayLabel(AppState.activeDateFolderKey)
    : '';
}

function filterFilesByActiveDateFolder(files) {
  if (!activeDateFolderMatchesContext()) return files;
  const contextId = currentFolderContextId();
  return files.filter((file) => {
    const inContext = contextId === null ? !file.folderId : file.folderId === contextId;
    return inContext && fileDayKey(file.importedAt) === AppState.activeDateFolderKey;
  });
}

function selectDateFolder(dayKey) {
  if (!dayKey) return;
  AppState.activeDateFolderKey = dayKey;
  AppState.activeDateFolderBaseId = currentFolderContextId();
  AppState.folderGridVisible = true;
  AppState.activeFileId = null;
  hideFileDetailPanel();
  if (typeof folderGridSelected !== 'undefined') folderGridSelected.clear();
  if (typeof sidebarSelected !== 'undefined') sidebarSelected.clear();
  renderFolderList();
  renderFileList(currentFileListScope());
  renderFolderGridIfActive();
}

function exitDateFolder() {
  if (!AppState.activeDateFolderKey) return false;
  AppState.activeDateFolderKey = null;
  AppState.activeDateFolderBaseId = null;
  AppState.folderGridVisible = false;
  AppState.activeFileId = null;
  hideFileDetailPanel();
  if (typeof folderGridSelected !== 'undefined') folderGridSelected.clear();
  if (typeof sidebarSelected !== 'undefined') sidebarSelected.clear();
  renderFolderList();
  renderFileList(currentFileListScope());
  clearPreview();
  return true;
}

const CLICK_WINDOW_MS = 450;
let lastClick = { folderId: null, time: 0, count: 0 };
const multiSelectedFolderIds = new Set();

function buildFolderItem(folder, isChildRow) {
  const li = document.createElement('li');
  li.className = 'folder-item' + (isChildRow ? ' is-subfolder' : '') + (folder.isImported ? ' is-imported' : '');
  li.dataset.folderId = folder.id;
  if (folder.id === AppState.activeFolderId) li.classList.add('is-active');
  if (multiSelectedFolderIds.has(folder.id)) li.classList.add('is-multi-selected');

  const expandIndicator = document.createElement('span');
  expandIndicator.className = 'folder-item-expand';
  if (childFoldersOf(folder.id).length > 0) {
    expandIndicator.innerHTML = '<svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 6 15 12 9 18"/></svg>';
  }

  const icon = document.createElement('div');
  icon.className = 'folder-item-icon';
  // The "默认" entry represents the library root, not a real sub-folder �?  // give it a simple house icon instead of the folder icon every other
  // (actual) folder uses, so it reads as "home" at a glance.
  icon.innerHTML = folder.isDefault
    ? '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11l9-7 9 7"/><path d="M5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9"/></svg>'
    : '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'folder-item-name';
  nameSpan.textContent = folder.name;

  const nameInput = document.createElement('input');
  nameInput.className = 'folder-item-rename-input';
  nameInput.type = 'text';
  nameInput.value = folder.name;
  nameInput.hidden = true;

  li.append(expandIndicator, icon, nameSpan, nameInput);

  if (!folder.isDefault) {
    const delBtn = document.createElement('button');
    delBtn.className = 'file-item-del';
    delBtn.title = folderText('Delete folder', '删除文件夹');
    delBtn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      promptDeleteFolder(folder, e.clientX, e.clientY);
    });
    li.appendChild(delBtn);
  }

  function startRename() {
    nameSpan.hidden = true;
    nameInput.hidden = false;
    nameInput.focus();
    nameInput.select();
  }

  li.addEventListener('click', (e) => {
    e.stopPropagation();

    if (e.shiftKey) {
      toggleMultiSelect(folder.id);
      return;
    }
    if (multiSelectedFolderIds.size > 0) clearMultiSelect();

    const isNameClick = !!e.target.closest('.folder-item-name');
    const now = Date.now();
    const isSameTarget = lastClick.folderId === folder.id && (now - lastClick.time) < CLICK_WINDOW_MS;
    const count = isSameTarget ? lastClick.count + 1 : 1;
    lastClick = { folderId: folder.id, time: now, count };

    const enterAt = folder.isImported ? 2 : 1;
    const renameAt = folder.isImported ? 3 : 2;

    if (isNameClick && count >= renameAt) {
      lastClick = { folderId: null, time: 0, count: 0 };
      startRename();
      return;
    }
    if (count >= enterAt) {
      selectFolder(folder.id);
    } else {
      highlightFolderOnly(folder.id);
    }
  });

  li.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (multiSelectedFolderIds.size >= 2 && multiSelectedFolderIds.has(folder.id)) {
      showFolderMultiContextMenu(e.clientX, e.clientY);
    } else {
      showFolderContextMenu(folder, e.clientX, e.clientY);
    }
  });

  async function commitRename() {
    nameInput.hidden = true;
    nameSpan.hidden = false;
    const newName = nameInput.value.trim();
    if (!newName || newName === folder.name) {
      nameInput.value = folder.name;
      return;
    }
    const res = await window.messsAPI.renameFolder(folder.id, newName);
    if (res.ok) {
      folder.name = newName;
      nameSpan.textContent = newName;
      if (folder.isDefault) AppState.defaultFolderName = newName;
      renderChildFolderSection();
    }
  }
  nameInput.addEventListener('blur', commitRename);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') nameInput.blur();
    if (e.key === 'Escape') { nameInput.value = folder.name; nameInput.blur(); }
  });
  nameInput.addEventListener('click', (e) => e.stopPropagation());

  li.draggable = true;
  li.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('application/x-messs-folder-id', folder.id);
    e.dataTransfer.effectAllowed = 'move';
  });
  li.addEventListener('dragover', (e) => { e.preventDefault(); li.classList.add('is-drop-target'); });
  li.addEventListener('dragleave', () => li.classList.remove('is-drop-target'));
  li.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    li.classList.remove('is-drop-target');

    const draggedFolderId = e.dataTransfer.getData('application/x-messs-folder-id');
    if (draggedFolderId && draggedFolderId !== folder.id) {
      const destId = folder.isDefault ? null : folder.id;
      await window.messsAPI.moveFolderInto(draggedFolderId, destId);
      const moved = AppState.folders.find((x) => x.id === draggedFolderId);
      if (moved) moved.parentId = destId;
      renderFolderList();
      return;
    }

    const destId = folder.isDefault ? null : folder.id;
    const fileId = e.dataTransfer.getData('application/x-messs-file-id');
    if (!fileId) {
      if (window.MesssFileDrop && window.MesssFileDrop.hasFiles(e.dataTransfer)
          && typeof handleExternalDrop === 'function') {
        await handleExternalDrop(e.dataTransfer, destId);
      }
      return;
    }
    await window.messsAPI.moveFileToFolder(fileId, destId);
    const f = AppState.files.find((x) => x.id === fileId);
    if (f) f.folderId = destId;
    renderFileList(currentFileListScope());
    renderFolderGridIfActive();
  });

  return li;
}

function highlightFolderOnly(folderId) {
  document.querySelectorAll('.folder-item').forEach((el) => {
    el.classList.toggle('is-active', el.dataset.folderId === folderId);
  });
}

function toggleMultiSelect(folderId) {
  if (multiSelectedFolderIds.has(folderId)) multiSelectedFolderIds.delete(folderId);
  else multiSelectedFolderIds.add(folderId);
  renderFolderList();
}

function clearMultiSelect() {
  multiSelectedFolderIds.clear();
  renderFolderList();
}

// buildAndShowSimpleMenu itself lives in context-menu.js (shared popup-menu
// infrastructure) �?folders.js just passes its own menuId so the two
// menus never collide if somehow both were open.
function showFolderSimpleMenu(items, x, y) {
  return buildAndShowSimpleMenu(items, x, y, 'folder-context-menu');
}

function showFolderContextMenu(folder, x, y) {
  const items = [{ label: folderText('Open containing folder', '打开所在位置'), action: () => window.messsAPI.revealFolder(folder.id) }];
  if (!folder.isDefault) {
    items.push({ label: folderText('Split folder (keep files)', '解散文件夹（保留文件）'), action: () => deleteFolderKeepingFiles(folder) });
  }
  items.push({ label: folderText('Rename', '重命名'), action: () => {
    const li = document.querySelector(`.folder-item[data-folder-id="${folder.id}"]`);
    if (!li) return;
    li.querySelector('.folder-item-name').hidden = true;
    const input = li.querySelector('.folder-item-rename-input');
    input.hidden = false;
    input.focus();
    input.select();
  } });
  showFolderSimpleMenu(items, x, y);
}

function showFolderMultiContextMenu(x, y) {
  const ids = [...multiSelectedFolderIds];
  showFolderSimpleMenu([
    { label: folderText(`Merge ${ids.length} folders`, `合并 ${ids.length} 个文件夹`), action: () => mergeFolders(ids) },
    { label: folderText(`Delete ${ids.length} folders`, `删除 ${ids.length} 个文件夹`), danger: true, action: () => {
      Promise.all(ids.map((id) => {
        const folder = AppState.folders.find((f) => f.id === id);
        return folder ? deleteFolderKeepingFiles(folder) : null;
      })).then(clearMultiSelect);
    } }
  ], x, y);
}

async function promptDeleteFolder(folder, x, y) {
  const childCount = childFoldersOf(folder.id).length;
  const fileCount = AppState.files.filter((f) => f.folderId === folder.id).length;
  if (fileCount === 0 && childCount === 0) {
    if (await showConfirmDialog({
      title: folderText('Delete folder', '删除文件夹'),
      message: folderText(`Delete empty folder "${folder.name}"?`, `删除空文件夹“${folder.name}”吗？`),
      confirmLabel: folderText('Delete', '删除')
    })) {
      await deleteFolderKeepingFiles(folder);
    }
    return;
  }
  showFolderSimpleMenu([
    { label: folderText(`Delete ${fileCount} files and folder`, `删除 ${fileCount} 个文件并删除文件夹`), danger: true, action: () => deleteFolderAndContents(folder) },
    { label: folderText('Delete folder only (keep files)', '只删除文件夹（文件变为未分类）'), action: () => deleteFolderKeepingFiles(folder) }
  ], x, y);
}

async function deleteFolderKeepingFiles(folder) {
  await window.messsAPI.deleteFolder(folder.id);
  const idsToRemove = new Set([folder.id, ...childFoldersOf(folder.id).map((f) => f.id)]);
  AppState.folders = AppState.folders.filter((f) => !idsToRemove.has(f.id));
  AppState.files.forEach((f) => { if (idsToRemove.has(f.folderId)) f.folderId = null; });
  if (idsToRemove.has(AppState.activeFolderId)) exitToDefaultFolder();
  renderFolderList();
  renderFileList(currentFileListScope());
}

async function deleteFolderAndContents(folder) {
  const idsToRemove = new Set([folder.id, ...childFoldersOf(folder.id).map((f) => f.id)]);
  const filesToDelete = AppState.files.filter((f) => idsToRemove.has(f.folderId));
  for (const f of filesToDelete) {
    await window.messsAPI.deleteFilePermanently(f.id);
  }
  await window.messsAPI.deleteFolder(folder.id);
  AppState.folders = AppState.folders.filter((f) => !idsToRemove.has(f.id));
  AppState.files = AppState.files.filter((f) => !idsToRemove.has(f.folderId));
  if (idsToRemove.has(AppState.activeFolderId)) exitToDefaultFolder();
  renderFolderList();
  renderFileList(currentFileListScope());
}

async function mergeFolders(ids) {
  const [targetId, ...rest] = ids;
  const target = AppState.folders.find((f) => f.id === targetId);
  if (!target) return;
  for (const sourceId of rest) {
    const source = AppState.folders.find((f) => f.id === sourceId);
    if (!source) continue;
    for (const f of AppState.files.filter((x) => x.folderId === sourceId)) {
      await window.messsAPI.moveFileToFolder(f.id, targetId);
      f.folderId = targetId;
    }
    await window.messsAPI.deleteFolder(sourceId);
    AppState.folders = AppState.folders.filter((x) => x.id !== sourceId);
  }
  clearMultiSelect();
  renderFolderList();
  renderFileList(currentFileListScope());
}

function selectFolder(folderId) {
  AppState.activeDateFolderKey = null;
  AppState.activeDateFolderBaseId = null;
  AppState.activeFolderId = folderId || 'default';
  AppState.folderGridVisible = true;
  AppState.activeFileId = null;
  hideFileDetailPanel();
  if (typeof folderGridSelected !== 'undefined') folderGridSelected.clear();
  if (typeof sidebarSelected !== 'undefined') sidebarSelected.clear();
  renderFolderList();
  renderFileList(currentFileListScope());
  renderFolderGridIfActive();
}

function currentFileListScope() {
  const contextId = currentFolderContextId();
  const files = contextId === null
    ? AppState.files.filter((f) => !f.folderId)
    : AppState.files.filter((f) => f.folderId === contextId);
  return filterFilesByActiveDateFolder(files);
}

function exitToDefaultFolder() {
  AppState.activeDateFolderKey = null;
  AppState.activeDateFolderBaseId = null;
  const wasBrowsing = AppState.folderGridVisible;
  AppState.activeFolderId = 'default';
  AppState.folderGridVisible = false;
  AppState.activeFileId = null;
  hideFileDetailPanel();
  if (typeof folderGridSelected !== 'undefined') folderGridSelected.clear();
  if (typeof sidebarSelected !== 'undefined') sidebarSelected.clear();
  renderFolderList();
  renderFileList(currentFileListScope());
  if (wasBrowsing) clearPreview();
}

function navigateFolderUp() {
  if (exitDateFolder()) return;
  const active = AppState.folders.find((f) => f.id === AppState.activeFolderId);
  if (active && active.parentId) {
    selectFolder(active.parentId);
  } else {
    exitToDefaultFolder();
  }
}

function initFolders() {
  document.getElementById('add-folder-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    void createTopLevelFolder();
  });

  document.getElementById('folder-breadcrumb-back').addEventListener('click', (e) => {
    e.stopPropagation();
    navigateFolderUp();
  });

  document.getElementById('file-list-wrap').addEventListener('click', (e) => {
    const blankTargets = ['file-list-wrap', 'file-list', 'folder-list', 'subfolder-list'];
    if (blankTargets.includes(e.target.id)) {
      if (multiSelectedFolderIds.size > 0) clearMultiSelect();
      exitToDefaultFolder();
    }
  });
}
