'use strict';
/* Custom right-click context menus. */

const FILE_CONTEXT_ITEMS = [
  { key: 'open-other', label: ['Open in Other App', '在其他应用中打开'], icon: 'M4 7l8-4 8 4M4 7v10l8 4 8-4V7M4 7l8 4 8-4M12 11v10' },
  { key: 'open-default', label: ['Open Default App', '用默认应用打开'], icon: 'M14 3h7v7M21 3L13 11M5 5h6v2H7v10h10v-4h2v6H5z' },
  { key: 'open-manager', label: ['Open in File Manager', '在文件管理器中打开'], icon: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z' },
  { key: 'reveal', label: ['Show in Folder', '在文件夹中显示'], icon: 'M21 10c0 6-9 12-9 12s-9-6-9-12a9 9 0 1 1 18 0z;M12 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', divider: true },
  { key: 'copy-selection', label: ['Copy', '复制'], icon: 'M9 9h11v11H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1' },
  { key: 'cut-selection', label: ['Cut', '剪切'], icon: 'M4 4l16 16M20 4L4 20' },
  { key: 'paste-selection', label: ['Paste', '粘贴'], icon: 'M9 3h6a2 2 0 0 1 2 2v1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h1V5a2 2 0 0 1 2-2z' },
  { key: 'copy-file', label: ['Copy File', '复制文件'], icon: 'M9 9h11v11H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1', divider: true },
  { key: 'copy-path', label: ['Copy Path', '复制路径'], icon: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1' },
  { key: 'duplicate', label: ['Duplicate', '复制副本'], icon: 'M8 8h11v11H8zM4 4h11v4H8v7H4z', divider: true },
  { key: 'trash', label: ['Move to Trash', '移到废纸篓'], icon: 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m-9 0v14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6', danger: true }
];

let contextMenuTargetFileId = null;
let contextMenuTargetFolderId = null;
const FileClipboard = { fileIds: [], mode: null };

function buildIconSvg(pathData) {
  const paths = pathData.split(';').map((d) => `<path d="${d}"/>`).join('');
  return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8">${paths}</svg>`;
}

function copyBoardSelection(items) {
  BoardClipboard.items = items.map((item) => ({ ...item }));
}

function cutBoardSelection(items) {
  copyBoardSelection(items);
  const ids = new Set(items.map((item) => item.id));
  AppState.boardItems = AppState.boardItems.filter((item) => !ids.has(item.id));
  canvasWorkspaceRemoveItems([...ids]);
  items.forEach((item) => window.messsAPI.removeBoardItem(item.id));
  renderBoard();
}

function pasteBoardSelectionAt(clickX, clickY) {
  if (!BoardClipboard.items.length) return;
  const { x, y } = clientToBoardCoords(clickX, clickY);
  pasteBoardClipboard(Math.round(x - 110), Math.round(y - 70));
}

function normalizeTargetFolderId(folderId) {
  return folderId && folderId !== 'default' ? folderId : null;
}

function folderIdForFile(fileId) {
  const file = AppState.files.find((item) => item.id === fileId);
  return normalizeTargetFolderId(file && file.folderId);
}

function setFileClipboard(fileIds, mode) {
  FileClipboard.fileIds = [...new Set(fileIds.filter(Boolean))];
  FileClipboard.mode = mode === 'cut' ? 'cut' : 'copy';
}

function refreshFileSurfaces() {
  renderFileList(currentFileListScope());
  if (typeof renderFolderGridIfActive === 'function') renderFolderGridIfActive();
}

async function pasteFileClipboardIntoFolder(folderId) {
  const ids = [...new Set(FileClipboard.fileIds)];
  if (!ids.length) {
    showToast(t('Clipboard is empty', '剪贴板为空'));
    return;
  }

  const targetFolderId = normalizeTargetFolderId(folderId);
  if (FileClipboard.mode === 'cut') {
    for (const id of ids) {
      await window.messsAPI.moveFileToFolder(id, targetFolderId);
      const file = AppState.files.find((item) => item.id === id);
      if (file) file.folderId = targetFolderId;
    }
    FileClipboard.fileIds = [];
    FileClipboard.mode = null;
    refreshFileSurfaces();
    showToast(t(`Moved ${ids.length} file${ids.length === 1 ? '' : 's'}`, `已移动 ${ids.length} 个文件`));
    return;
  }

  let pasted = 0;
  for (const id of ids) {
    const res = await window.messsAPI.duplicateFile(id, targetFolderId);
    if (res.ok) {
      pasted += 1;
      AppState.files = [res.file, ...AppState.files];
    }
  }
  refreshFileSurfaces();
  showToast(t(`Pasted ${pasted} file${pasted === 1 ? '' : 's'}`, `已粘贴 ${pasted} 个文件`));
}

function renderContextMenuItems() {
  const menu = document.getElementById('context-menu');
  menu.innerHTML = '';
  for (const item of FILE_CONTEXT_ITEMS) {
    if (item.divider) {
      const hr = document.createElement('li');
      hr.className = 'context-menu-divider';
      menu.appendChild(hr);
    }
    const li = document.createElement('li');
    li.className = 'context-menu-item' + (item.danger ? ' is-danger' : '');
    li.dataset.action = item.key;
    li.innerHTML = `<span class="context-menu-icon">${buildIconSvg(item.icon)}</span><span>${t(item.label[0], item.label[1])}</span>`;
    li.addEventListener('click', () => handleContextMenuAction(item.key));
    menu.appendChild(li);
  }
}

async function handleContextMenuAction(action) {
  const clickX = parseInt(document.getElementById('context-menu').style.left, 10);
  const clickY = parseInt(document.getElementById('context-menu').style.top, 10);
  hideContextMenu();
  const id = contextMenuTargetFileId;
  if (!id) return;
  const f = AppState.files.find((x) => x.id === id);

  switch (action) {
    case 'open-other':
      await window.messsAPI.openWithOtherApp(id);
      break;
    case 'open-default':
      await window.messsAPI.openFileExternally(id);
      break;
    case 'open-manager':
      await window.messsAPI.openInFileManager(id);
      break;
    case 'reveal':
      await window.messsAPI.revealFile(id);
      break;
    case 'copy-selection':
      setFileClipboard([id], 'copy');
      showToast(t('File copied', '文件已复制'));
      break;
    case 'cut-selection':
      setFileClipboard([id], 'cut');
      showToast(t('File cut', '文件已剪切'));
      break;
    case 'paste-selection':
      await pasteFileClipboardIntoFolder(contextMenuTargetFolderId);
      break;
    case 'copy-file':
      await window.messsAPI.copyFileToClipboard(id);
      showToast(t('File copied to system clipboard', '文件已复制到系统剪贴板'));
      break;
    case 'copy-path':
      await window.messsAPI.copyFilePath(id);
      showToast(t('Path copied', '路径已复制'));
      break;
    case 'duplicate': {
      const res = await window.messsAPI.duplicateFile(id);
      if (res.ok) {
        AppState.files = [res.file, ...AppState.files];
        renderFileList(currentFileListScope());
        showToast(t('Duplicate created', '已创建副本'));
      }
      break;
    }
    case 'trash': {
      if (!f) break;
      const ok = await showConfirmDialog({
        title: t('Move to Trash', '移到废纸篓'),
        message: t(`Move "${f.name}" to the trash? This cannot be undone.`, `将“${f.name}”移到废纸篓吗？此操作无法撤销。`),
        confirmLabel: t('Move to Trash', '移到废纸篓')
      });
      if (!ok) break;
      const res = await window.messsAPI.moveFileToTrash(id);
      if (res.ok) {
        AppState.files = AppState.files.filter((x) => x.id !== id);
        removeBoardItemsForFile(id);
        renderFileList(currentFileListScope());
        if (AppState.activeFileId === id) clearPreview();
        showToast(t('Moved to trash', '已移到废纸篓'));
      }
      break;
    }
  }
}

function showContextMenu(fileId, clientX, clientY) {
  contextMenuTargetFileId = fileId;
  contextMenuTargetFolderId = folderIdForFile(fileId);
  renderContextMenuItems();
  const menu = document.getElementById('context-menu');
  menu.hidden = false;
  menu.classList.remove('is-visible');

  const rect = menu.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 8;
  const maxY = window.innerHeight - rect.height - 8;
  menu.style.left = Math.max(8, Math.min(clientX, maxX)) + 'px';
  menu.style.top = Math.max(8, Math.min(clientY, maxY)) + 'px';

  requestAnimationFrame(() => menu.classList.add('is-visible'));
}

function hideContextMenu() {
  const menu = document.getElementById('context-menu');
  if (menu.hidden) return;
  menu.classList.remove('is-visible');
  setTimeout(() => { menu.hidden = true; }, 160);
}

function buildAndShowSimpleMenu(items, x, y, menuId = 'simple-context-menu') {
  const existing = document.getElementById(menuId);
  if (existing) existing.remove();

  const menu = document.createElement('ul');
  menu.id = menuId;
  menu.className = 'context-menu is-visible';
  document.body.appendChild(menu);

  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'context-menu-item' + (item.danger ? ' is-danger' : '');
    if (item.icon) {
      li.classList.add('has-icon');
      li.innerHTML = `<span class="context-menu-icon">${buildIconSvg(item.icon)}</span><span></span>`;
      li.lastElementChild.textContent = item.label;
    } else {
      li.textContent = item.label;
    }
    li.addEventListener('click', () => { menu.remove(); item.action(); });
    menu.appendChild(li);
  }

  const rect = menu.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 8;
  const maxY = window.innerHeight - rect.height - 8;
  menu.style.left = Math.max(8, Math.min(x, maxX)) + 'px';
  menu.style.top = Math.max(8, Math.min(y, maxY)) + 'px';

  const closeOnce = (e) => {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener('click', closeOnce);
    }
  };
  setTimeout(() => document.addEventListener('click', closeOnce), 0);
  return menu;
}

async function sendBoardMediaToCreativeApp(fileId, target) {
  const appName = target === 'after-effects' ? 'After Effects' : 'Photoshop';
  try {
    const result = await window.messsAPI.sendToCreativeApp(fileId, target);
    if (result && result.ok) {
      showToast(result.message || t(`Sent to ${appName}.`, `已发送到 ${appName}。`));
      return;
    }
    // The main process distinguishes missing source files, unsupported media,
    // missing Adobe installs and actual launch failures. Surface that reason
    // instead of reporting every failure as "not installed".
    showToast((result && result.message) || t(
      `Could not send this file to ${appName}.`,
      `无法将这个文件发送到 ${appName}。`
    ));
  } catch (error) {
    showToast(t(
      `Could not send this file to ${appName}.`,
      `无法将这个文件发送到 ${appName}。`
    ));
  }
}

function showBoardItemContextMenu(item, x, y) {
  const selected = AppState.boardItems.filter((boardItem) => boardItem.selected);
  const items = [
    { label: t('Copy', '复制'), action: () => copyBoardSelection(selected.length ? selected : [item]) },
    { label: t('Cut', '剪切'), action: () => cutBoardSelection(selected.length ? selected : [item]) },
    { label: t('Paste', '粘贴'), action: () => pasteBoardSelectionAt(x, y), danger: false }
  ];

  if (item.fileId) {
    const file = AppState.files.find((entry) => entry.id === item.fileId);
    const isGenerated = !!(file && (file.aiGeneration || file.sourceFolder === 'AI Generated'));
    if (isGenerated && isImageExt(file.ext)) {
      items.push({
        label: t('Send to Photoshop', '发送到 Photoshop'),
        action: () => sendBoardMediaToCreativeApp(item.fileId, 'photoshop')
      });
    }
    if (isGenerated && isVideoExt(file.ext)) {
      items.push({
        label: t('Send to After Effects', '发送到 After Effects'),
        action: () => sendBoardMediaToCreativeApp(item.fileId, 'after-effects')
      });
    }
    items.push(
      { label: t('Open Default App', '用默认应用打开'), action: () => window.messsAPI.openFileExternally(item.fileId) },
      { label: t('Show in Folder', '在文件夹中显示'), action: () => window.messsAPI.revealFile(item.fileId) }
    );
  }

  items.push({
    label: t('Remove from Canvas', '从画布移除'),
    danger: true,
    action: async () => {
      AppState.boardItems = AppState.boardItems.filter((boardItem) => boardItem.id !== item.id);
      canvasWorkspaceRemoveItems([item.id]);
      await window.messsAPI.removeBoardItem(item.id);
      if (item.isNote && typeof activeTextNoteId !== 'undefined' && activeTextNoteId === item.id) hideTextToolPanel();
      renderBoard();
      showToast(t('Removed from canvas', '已从画布移除'));
    }
  });
  buildAndShowSimpleMenu(items, x, y, 'board-item-context-menu');
}

const MULTI_MENU_ITEMS = [
  { key: 'copy', label: ['Copy', '复制'] },
  { key: 'cut', label: ['Cut', '剪切'] },
  { key: 'paste', label: ['Paste', '粘贴'] },
  { key: 'arrange', label: ['Arrange', '排列'], submenu: [
    { key: 'arrange-pack', label: ['Pack', '紧凑排列'] },
    { key: 'arrange-row', label: ['Row', '横向排列'] },
    { key: 'arrange-column', label: ['Column', '纵向排列'] }
  ] },
  { key: 'scale', label: ['Scale', '缩放'], submenu: [
    { key: 'scale-max', label: ['Scale Up', '放大'] },
    { key: 'scale-min', label: ['Scale Down', '缩小'] }
  ] },
  { key: 'download', label: ['Export', '导出'] },
  { key: 'group', label: ['Group', '成组'] },
  { key: 'ungroup', label: ['Ungroup', '取消成组'] },
  { key: 'delete', label: ['Delete', '删除'], danger: true }
];

function selectionGroupState() {
  const selected = AppState.boardItems.filter((item) => item.selected);
  const groupIds = new Set(selected.map((item) => item.groupId).filter(Boolean));
  return { isGrouped: groupIds.size === 1 && selected.every((item) => item.groupId) };
}

function showBoardMultiContextMenu(x, y) {
  const existing = document.getElementById('board-multi-menu');
  if (existing) existing.remove();
  const existingSub = document.getElementById('board-multi-submenu');
  if (existingSub) existingSub.remove();

  const { isGrouped } = selectionGroupState();
  const menu = document.createElement('ul');
  menu.id = 'board-multi-menu';
  menu.className = 'context-menu is-visible';
  document.body.appendChild(menu);

  let submenuEl = null;
  let closeSubmenuTimer = null;

  function closeSubmenu() {
    if (submenuEl) {
      submenuEl.remove();
      submenuEl = null;
    }
  }

  for (const item of MULTI_MENU_ITEMS) {
    if (item.key === 'group' && isGrouped) continue;
    if (item.key === 'ungroup' && !isGrouped) continue;

    const li = document.createElement('li');
    li.className = 'context-menu-item' + (item.danger ? ' is-danger' : '');
    li.innerHTML = `<span>${t(item.label[0], item.label[1])}</span>` + (item.submenu ? '<span class="context-menu-caret">›</span>' : '');

    if (item.submenu) {
      li.addEventListener('mouseenter', () => {
        clearTimeout(closeSubmenuTimer);
        closeSubmenu();
        submenuEl = buildSubmenu(item, li);
      });
      li.addEventListener('mouseleave', () => {
        closeSubmenuTimer = setTimeout(closeSubmenu, 150);
      });
    } else {
      li.addEventListener('mouseenter', () => { clearTimeout(closeSubmenuTimer); closeSubmenu(); });
      li.addEventListener('click', () => { menu.remove(); closeSubmenu(); runMultiMenuAction(item.key, x, y); });
    }
    menu.appendChild(li);
  }

  function buildSubmenu(parentItem, anchorLi) {
    const sub = document.createElement('ul');
    sub.id = 'board-multi-submenu';
    sub.className = 'context-menu is-visible';
    document.body.appendChild(sub);

    for (const leaf of parentItem.submenu) {
      const li = document.createElement('li');
      li.className = 'context-menu-item';
      li.textContent = t(leaf.label[0], leaf.label[1]);
      li.addEventListener('click', () => { menu.remove(); sub.remove(); runMultiMenuAction(leaf.key, x, y); });
      sub.appendChild(li);
    }
    sub.addEventListener('mouseenter', () => clearTimeout(closeSubmenuTimer));
    sub.addEventListener('mouseleave', () => { closeSubmenuTimer = setTimeout(closeSubmenu, 150); });

    const anchorRect = anchorLi.getBoundingClientRect();
    const subRect = sub.getBoundingClientRect();
    let left = anchorRect.right + 2;
    if (left + subRect.width > window.innerWidth - 8) left = anchorRect.left - subRect.width - 2;
    let top = anchorRect.top;
    if (top + subRect.height > window.innerHeight - 8) top = window.innerHeight - subRect.height - 8;
    sub.style.left = left + 'px';
    sub.style.top = Math.max(8, top) + 'px';
    return sub;
  }

  const rect = menu.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 8;
  const maxY = window.innerHeight - rect.height - 8;
  menu.style.left = Math.max(8, Math.min(x, maxX)) + 'px';
  menu.style.top = Math.max(8, Math.min(y, maxY)) + 'px';

  const closeOnce = (e) => {
    if (!menu.contains(e.target) && !(submenuEl && submenuEl.contains(e.target))) {
      menu.remove();
      closeSubmenu();
      document.removeEventListener('click', closeOnce);
    }
  };
  setTimeout(() => document.addEventListener('click', closeOnce), 0);
}

async function runMultiMenuAction(key, x, y) {
  const selected = AppState.boardItems.filter((item) => item.selected);
  if (!selected.length && key !== 'paste') return;

  switch (key) {
    case 'copy':
      copyBoardSelection(selected);
      break;
    case 'cut':
      cutBoardSelection(selected);
      break;
    case 'paste':
      pasteBoardSelectionAt(x, y);
      break;
    case 'arrange-pack':
      arrangeItemsGrid(selected);
      break;
    case 'arrange-row':
      arrangeItemsLine(selected, 'row');
      break;
    case 'arrange-column':
      arrangeItemsLine(selected, 'column');
      break;
    case 'scale-max':
      selected.forEach((item) => { item.width = MAX_BOARD_ITEM_WIDTH; window.messsAPI.upsertBoardItem(item); });
      renderBoard();
      break;
    case 'scale-min':
      selected.forEach((item) => { item.width = MIN_BOARD_ITEM_WIDTH; window.messsAPI.upsertBoardItem(item); });
      renderBoard();
      break;
    case 'download':
      for (const item of selected) {
        if (item.fileId) await window.messsAPI.exportFile(item.fileId);
      }
      showToast(t(`Exported ${selected.length} file${selected.length === 1 ? '' : 's'}`, `已导出 ${selected.length} 个文件`));
      break;
    case 'group': {
      const groupId = 'g_' + Math.random().toString(36).slice(2, 10);
      selected.forEach((item) => { item.groupId = groupId; window.messsAPI.upsertBoardItem(item); });
      showToast(t(`Grouped ${selected.length} item${selected.length === 1 ? '' : 's'}`, `已成组 ${selected.length} 个项目`));
      break;
    }
    case 'ungroup':
      selected.forEach((item) => { delete item.groupId; window.messsAPI.upsertBoardItem(item); });
      showToast(t('Ungrouped', '已取消成组'));
      break;
    case 'delete':
      selected.forEach((item) => window.messsAPI.removeBoardItem(item.id));
      canvasWorkspaceRemoveItems(selected.map((item) => item.id));
      AppState.boardItems = AppState.boardItems.filter((item) => !item.selected);
      renderBoard();
      break;
  }
}

function arrangeItemsGrid(items) {
  const cols = Math.ceil(Math.sqrt(items.length));
  const gap = 10;
  const originX = items.reduce((min, it) => Math.min(min, it.x), Infinity);
  const originY = items.reduce((min, it) => Math.min(min, it.y), Infinity);

  // Pack each column and row from the actual item bounds. Fixed cells leave
  // huge gaps after users scale thumbnails down, especially at overview zoom.
  const sizes = items.map((item) => {
    const width = Math.max(1, Number(item.width) || 220);
    const file = AppState.files.find((entry) => entry.id === item.fileId);
    const sourceWidth = Number(file && file.sourceWidth);
    const sourceHeight = Number(file && file.sourceHeight);
    const height = Number(item.height) ||
      (sourceWidth > 0 && sourceHeight > 0 ? width * sourceHeight / sourceWidth : width * 0.75);
    return { width, height: Math.max(1, height) };
  });
  const rows = Math.ceil(items.length / cols);
  const columnWidths = Array.from({ length: cols }, () => 1);
  const rowHeights = Array.from({ length: rows }, () => 1);
  sizes.forEach((size, index) => {
    columnWidths[index % cols] = Math.max(columnWidths[index % cols], size.width);
    rowHeights[Math.floor(index / cols)] = Math.max(rowHeights[Math.floor(index / cols)], size.height);
  });
  const columnX = [];
  const rowY = [];
  let cursorX = originX;
  let cursorY = originY;
  columnWidths.forEach((width) => {
    columnX.push(cursorX);
    cursorX += width + gap;
  });
  rowHeights.forEach((height) => {
    rowY.push(cursorY);
    cursorY += height + gap;
  });

  items.forEach((item, i) => {
    item.x = Math.round(columnX[i % cols]);
    item.y = Math.round(rowY[Math.floor(i / cols)]);
    window.messsAPI.upsertBoardItem(item);
  });
  renderBoard();
}

function arrangeItemsLine(items, direction) {
  const gap = 12;
  const originX = items.reduce((min, it) => Math.min(min, it.x), Infinity);
  const originY = items.reduce((min, it) => Math.min(min, it.y), Infinity);
  let cursor = direction === 'row' ? originX : originY;
  items.forEach((item) => {
    const w = item.width || 220;
    if (direction === 'row') {
      item.x = Math.round(cursor);
      item.y = Math.round(originY);
      cursor += w + gap;
    } else {
      item.x = Math.round(originX);
      item.y = Math.round(cursor);
      cursor += w * 0.75 + gap;
    }
    window.messsAPI.upsertBoardItem(item);
  });
  renderBoard();
}

function showMultiFileContextMenu(fileIds, x, y, targetFileId) {
  const targetFolderId = folderIdForFile(targetFileId || fileIds[0]);
  buildAndShowSimpleMenu([
    {
      label: t(`Copy (${fileIds.length})`, `复制（${fileIds.length}）`),
      action: () => {
        setFileClipboard(fileIds, 'copy');
        showToast(t(`${fileIds.length} file${fileIds.length === 1 ? '' : 's'} copied`, `已复制 ${fileIds.length} 个文件`));
      }
    },
    {
      label: t(`Cut (${fileIds.length})`, `剪切（${fileIds.length}）`),
      action: () => {
        setFileClipboard(fileIds, 'cut');
        showToast(t(`${fileIds.length} file${fileIds.length === 1 ? '' : 's'} cut`, `已剪切 ${fileIds.length} 个文件`));
      }
    },
    {
      label: t('Paste', '粘贴'),
      action: async () => pasteFileClipboardIntoFolder(targetFolderId)
    },
    {
      label: t(`Copy Paths (${fileIds.length})`, `复制路径（${fileIds.length}）`),
      action: async () => {
        for (const id of fileIds) await window.messsAPI.copyFilePath(id);
        showToast(t('Paths copied', '路径已复制'));
      }
    },
    {
      label: t(`Duplicate (${fileIds.length})`, `复制副本（${fileIds.length}）`),
      action: async () => {
        for (const id of fileIds) {
          const res = await window.messsAPI.duplicateFile(id);
          if (res.ok) AppState.files = [res.file, ...AppState.files];
        }
        renderFileList(currentFileListScope());
        renderFolderGridIfActive();
        showToast(t('Duplicates created', '已创建副本'));
      }
    },
    {
      label: t(`Move to Trash (${fileIds.length})`, `移到废纸篓（${fileIds.length}）`),
      danger: true,
      action: async () => {
        const ok = await showConfirmDialog({
          title: t('Move to Trash', '移到废纸篓'),
          message: t(`Move these ${fileIds.length} files to the trash? This cannot be undone.`, `将这 ${fileIds.length} 个文件移到废纸篓吗？此操作无法撤销。`),
          confirmLabel: t('Move to Trash', '移到废纸篓')
        });
        if (!ok) return;
        for (const id of fileIds) {
          const res = await window.messsAPI.moveFileToTrash(id);
          if (res.ok) {
            AppState.files = AppState.files.filter((x) => x.id !== id);
            removeBoardItemsForFile(id);
            if (AppState.activeFileId === id) clearPreview();
          }
        }
        renderFileList(currentFileListScope());
        renderFolderGridIfActive();
        showToast(t('Moved to trash', '已移到废纸篓'));
      }
    }
  ], x, y, 'multi-file-context-menu');
}

function initContextMenu() {
  renderContextMenuItems();
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#context-menu')) hideContextMenu();
  });
  document.addEventListener('contextmenu', (e) => {
    if (!e.target.closest('.board-item') && !e.target.closest('.folder-grid-item') && !e.target.closest('.file-item')) {
      hideContextMenu();
    }
  });
  window.addEventListener('blur', hideContextMenu);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideContextMenu();
  });
}
