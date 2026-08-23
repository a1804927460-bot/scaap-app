'use strict';
/* Sidebar: search, grouped file list, imports, compact settings, and the
   centered advanced settings dialog. */

let sidebarSelected = new Set();
let lastClickedSidebarId = null;
let isSidebarListHovered = false;
let importProgressHideTimer = null;
let sidebarDragGhost = null;
let activeAccountAvatarUserId = null;
let accountSummaryRenderGeneration = 0;
let accountAvatarLoadGeneration = 0;
let accountProfileDisplayName = '';
let accountProfileSignature = '';
let accountProfileFallbackName = 'Messs user';
let colorManagementState = { profile: 'auto', activeProfile: 'auto', restartRequired: false };
let displayP3MediaQuery = null;
const expandedDateYears = new Set();
const expandedDateMonths = new Set();
const initializedDateFolderContexts = new Set();
let pendingDateFolderFocusKey = null;

function todayDateFolderKey() {
  return fileDayKey(new Date());
}

function dateFolderContextKey() {
  return String(currentFolderContextId() || '__root__');
}

function expandDateFolderBranch(dayKey, focus = false) {
  const [year, month] = String(dayKey || '').split('-');
  if (!year || !month) return;
  expandedDateYears.add(year);
  expandedDateMonths.add(`${year}-${month}`);
  if (focus) pendingDateFolderFocusKey = dayKey;
}

function initializeDateFolderBranch(files) {
  const contextKey = dateFolderContextKey();
  if (initializedDateFolderContexts.has(contextKey)) return;
  initializedDateFolderContexts.add(contextKey);
  const groups = groupFilesByDay(files);
  if (!groups.length) return;
  const today = todayDateFolderKey();
  const preferred = groups.some(([dayKey]) => dayKey === today) ? today : groups[0][0];
  expandDateFolderBranch(preferred, true);
}

function focusPendingDateFolder(list) {
  const dayKey = pendingDateFolderFocusKey;
  if (!dayKey) return;
  requestAnimationFrame(() => {
    const row = Array.from(list.querySelectorAll('[data-date-folder-key]'))
      .find((entry) => entry.dataset.dateFolderKey === dayKey);
    if (!row) return;
    pendingDateFolderFocusKey = null;
    row.scrollIntoView({ block: 'nearest' });
  });
}

function appendFileThumbnail(container, file, alt = '') {
  const image = document.createElement('img');
  image.src = file.thumbUrl || file.url;
  image.loading = 'lazy';
  image.alt = alt;
  image.addEventListener('error', () => {
    image.remove();
    container.textContent = fileIconLabel(file.ext);
  }, { once: true });
  container.appendChild(image);
  return image;
}

function createSidebarDragGhost(file, count) {
  if (sidebarDragGhost) sidebarDragGhost.remove();
  const ghost = document.createElement('div');
  ghost.className = 'sidebar-drag-ghost';
  const icon = document.createElement('div');
  icon.className = 'file-item-icon';
  appendFileThumbnail(icon, file);
  ghost.appendChild(icon);
  const label = document.createElement('span');
  label.textContent = count > 1 ? t(`${count} files`, `${count} 个文件`) : file.name;
  ghost.appendChild(label);
  document.body.appendChild(ghost);
  sidebarDragGhost = ghost;
  return ghost;
}

function clearSidebarDragGhost() {
  if (sidebarDragGhost) sidebarDragGhost.remove();
  sidebarDragGhost = null;
}

function toggleSidebarSelect(id) {
  if (sidebarSelected.has(id)) sidebarSelected.delete(id);
  else sidebarSelected.add(id);
  lastClickedSidebarId = id;
  renderFileList(currentFileListScope());
}

function selectSidebarRange(toId) {
  const ids = [...document.querySelectorAll('#file-list .file-item')].map((item) => item.dataset.fileId);
  const fromIdx = lastClickedSidebarId ? ids.indexOf(lastClickedSidebarId) : -1;
  const toIdx = ids.indexOf(toId);
  if (fromIdx === -1 || toIdx === -1) {
    sidebarSelected.add(toId);
    lastClickedSidebarId = toId;
  } else {
    const [start, end] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
    ids.slice(start, end + 1).forEach((id) => sidebarSelected.add(id));
  }
  renderFileList(currentFileListScope());
}

function clearSidebarSelect() {
  if (!sidebarSelected.size) return;
  sidebarSelected.clear();
  renderFileList(currentFileListScope());
}

function selectAllSidebarFiles() {
  sidebarSelected = new Set(
    [...document.querySelectorAll('#file-list .file-item')].map((item) => item.dataset.fileId)
  );
  renderFileList(currentFileListScope());
}

function buildDateFolderLabel(dayKey, count, active = false) {
  const label = document.createElement('li');
  label.className = 'file-group-label file-date-folder' + (active ? ' is-active' : '');
  label.classList.toggle('is-today', dayKey === todayDateFolderKey());
  label.dataset.dateFolderKey = dayKey;
  label.setAttribute('role', active ? 'heading' : 'button');
  if (!active) {
    label.tabIndex = 0;
    label.title = t('Open date folder', '\u6253\u5f00\u65e5\u671f\u6587\u4ef6\u5939');
    label.setAttribute('aria-label', `${t('Open date folder', '\u6253\u5f00\u65e5\u671f\u6587\u4ef6\u5939')}: ${formatFileDayLabel(dayKey)}`);
  }

  const icon = document.createElement('span');
  icon.className = 'file-date-folder-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h3.2l2 2H18a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5z"/></svg>';
  const name = document.createElement('span');
  name.className = 'file-date-folder-name';
  name.textContent = formatFileDayLabel(dayKey);
  const countLabel = document.createElement('small');
  countLabel.className = 'file-date-folder-count';
  countLabel.textContent = String(count);
  label.append(icon, name, countLabel);

  if (!active) {
    const open = () => selectDateFolder(dayKey);
    label.addEventListener('click', open);
    label.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    });
    if (dayKey === todayDateFolderKey()) {
      label.addEventListener('dragover', (event) => {
        if (!Array.from(event.dataTransfer && event.dataTransfer.types || []).includes('Files')) return;
        event.preventDefault();
        event.stopPropagation();
        label.classList.add('is-drop-target');
      });
      label.addEventListener('dragleave', () => label.classList.remove('is-drop-target'));
      label.addEventListener('drop', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        label.classList.remove('is-drop-target');
        expandDateFolderBranch(todayDateFolderKey(), true);
        await handleExternalDrop(event.dataTransfer);
      });
    }
  }
  return label;
}

function buildDateTreeFolder({ key, label, count, level, expanded, onToggle }) {
  const row = document.createElement('li');
  row.className = 'file-group-label file-date-folder file-date-tree-folder';
  row.dataset.dateTreeKey = key;
  row.dataset.dateTreeLevel = level;
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  row.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  row.innerHTML = `
    <span class="file-date-tree-caret" aria-hidden="true">
      <svg viewBox="0 0 12 12" width="11" height="11"><path d="m4 2.5 4 3.5-4 3.5"/></svg>
    </span>
    <span class="file-date-folder-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h3.2l2 2H18a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5z"/></svg>
    </span>
    <span class="file-date-folder-name"></span>
    <small class="file-date-folder-count">${count}</small>
  `;
  row.querySelector('.file-date-folder-name').textContent = label;
  const toggle = () => onToggle(!expanded);
  row.addEventListener('click', toggle);
  row.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggle();
  });
  return row;
}

function dateFolderHierarchy(files) {
  const years = new Map();
  for (const [dayKey, items] of groupFilesByDay(files)) {
    const [year, month] = dayKey.split('-');
    if (!years.has(year)) years.set(year, new Map());
    const months = years.get(year);
    if (!months.has(month)) months.set(month, []);
    months.get(month).push({ dayKey, items });
  }
  return years;
}

function monthFolderLabel(year, month) {
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString(appLocale(), {
    month: 'long'
  });
}

function renderDateFolderTree(list, files) {
  initializeDateFolderBranch(files);
  const hierarchy = dateFolderHierarchy(files);
  for (const [year, months] of hierarchy) {
    const yearCount = Array.from(months.values()).flat().reduce((sum, group) => sum + group.items.length, 0);
    const yearExpanded = expandedDateYears.has(year);
    list.appendChild(buildDateTreeFolder({
      key: year, label: year, count: yearCount, level: 'year', expanded: yearExpanded,
      onToggle: (open) => {
        if (open) expandedDateYears.add(year); else expandedDateYears.delete(year);
        renderFileList(currentFileListScope());
      }
    }));
    if (!yearExpanded) continue;
    for (const [month, days] of months) {
      const monthKey = `${year}-${month}`;
      const monthCount = days.reduce((sum, group) => sum + group.items.length, 0);
      const monthExpanded = expandedDateMonths.has(monthKey);
      list.appendChild(buildDateTreeFolder({
        key: monthKey,
        label: monthFolderLabel(year, month),
        count: monthCount,
        level: 'month',
        expanded: monthExpanded,
        onToggle: (open) => {
          if (open) expandedDateMonths.add(monthKey); else expandedDateMonths.delete(monthKey);
          renderFileList(currentFileListScope());
        }
      }));
      if (!monthExpanded) continue;
      days.forEach(({ dayKey, items }) => list.appendChild(buildDateFolderLabel(dayKey, items.length)));
    }
  }
  focusPendingDateFolder(list);
}

function renderFileList(files) {
  const list = document.getElementById('file-list');
  const empty = document.getElementById('file-list-empty');
  list.innerHTML = '';
  const nested = currentFolderContextId() !== null;
  const activeDate = activeDateFolderMatchesContext();
  list.classList.toggle('is-folder-contents', nested);
  list.classList.toggle('is-date-folder-contents', activeDate);
  empty.classList.toggle('is-folder-contents', nested);

  if (!files.length) {
    if (activeDate) list.appendChild(buildDateFolderLabel(AppState.activeDateFolderKey, 0, true));
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  if (nested) {
    const contentLabel = document.createElement('li');
    contentLabel.className = 'file-content-section-label';
    contentLabel.textContent = t('Folder contents', '文件夹内容');
    list.appendChild(contentLabel);
  }

  if (activeDate) {
    list.appendChild(buildDateFolderLabel(AppState.activeDateFolderKey, files.length, true));
    for (const file of files) list.appendChild(buildFileItem(file));
    return;
  }
  renderDateFolderTree(list, files);
}

function buildFileItem(f) {
  const li = document.createElement('li');
  li.className = 'file-item';
  li.dataset.fileId = f.id;
  li.draggable = true;
  if (f.id === AppState.activeFileId) li.classList.add('is-active');
  if (sidebarSelected.has(f.id)) li.classList.add('is-multi-selected');

  const icon = document.createElement('div');
  icon.className = 'file-item-icon';
  appendFileThumbnail(icon, f);

  const meta = document.createElement('div');
  meta.className = 'file-item-meta';
  const name = document.createElement('div');
  name.className = 'file-item-name';
  name.textContent = f.name;
  const date = document.createElement('div');
  date.className = 'file-item-date';
  date.textContent = formatDateTime(f.importedAt);
  meta.append(name, date);

  const del = document.createElement('button');
  del.className = 'file-item-del';
  del.title = t('Delete permanently', '永久删除');
  del.setAttribute('aria-label', del.title);
  del.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';
  del.addEventListener('click', async (e) => {
    e.stopPropagation();
    const ok = await showConfirmDialog({
      title: t('Delete permanently', '永久删除'),
      message: t(`Delete "${f.name}" forever? This cannot be undone.`, `永久删除“${f.name}”？此操作无法撤销。`),
      confirmLabel: t('Delete', '删除')
    });
    if (!ok) return;
    const res = await window.messsAPI.deleteFilePermanently(f.id);
    if (res.ok) {
      AppState.files = AppState.files.filter((x) => x.id !== f.id);
      renderFileList(currentFileListScope());
      removeBoardItemsForFile(f.id);
      if (AppState.activeFileId === f.id) clearPreview();
      showToast(t('File deleted permanently', '文件已永久删除'));
    }
  });

  li.append(icon, meta, del);

  li.addEventListener('click', (e) => {
    if (e.shiftKey) {
      e.stopPropagation();
      selectSidebarRange(f.id);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      e.stopPropagation();
      toggleSidebarSelect(f.id);
      return;
    }
    if (sidebarSelected.size) clearSidebarSelect();
    lastClickedSidebarId = f.id;
    selectFileForPreview(f.id);
  });

  li.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (sidebarSelected.size >= 2 && sidebarSelected.has(f.id)) {
      showMultiFileContextMenu([...sidebarSelected], e.clientX, e.clientY, f.id);
    } else {
      showContextMenu(f.id, e.clientX, e.clientY);
    }
  });

  li.addEventListener('dragstart', (e) => {
    const draggedIds = sidebarSelected.size > 1 && sidebarSelected.has(f.id)
      ? [...sidebarSelected]
      : [f.id];
    if (sidebarSelected.size > 1 && sidebarSelected.has(f.id)) {
      e.dataTransfer.setData('application/x-messs-file-ids', JSON.stringify(draggedIds));
    }
    e.dataTransfer.setData('application/x-messs-file-id', f.id);
    e.dataTransfer.effectAllowed = 'copy';
    const ghost = createSidebarDragGhost(f, draggedIds.length);
    e.dataTransfer.setDragImage(ghost, 24, 24);
    document.body.classList.add('is-dragging-sidebar-file');
  });

  li.addEventListener('dragend', async (e) => {
    clearSidebarDragGhost();
    document.body.classList.remove('is-dragging-sidebar-file');
    if (e.dataTransfer && e.dataTransfer.dropEffect === 'copy') return;
    if (!f.folderId) return;
    const wrap = document.getElementById('file-list-wrap');
    const rect = wrap.getBoundingClientRect();
    if (e.clientY <= rect.bottom) return;
    const ok = await showConfirmDialog({
      title: t('Move to library', '移回资料库'),
      message: t(`Move "${f.name}" out of its folder and back to Library?`, `将“${f.name}”移出文件夹并放回资料库吗？`),
      confirmLabel: t('Move', '移动')
    });
    if (!ok) return;
    await window.messsAPI.moveFileToFolder(f.id, null);
    f.folderId = null;
    renderFileList(currentFileListScope());
    renderFolderGridIfActive();
  });

  return li;
}

function initSidebar(initial = {}) {
  accountProfileDisplayName = String(initial.profileDisplayName || '').trim();
  accountProfileSignature = String(initial.profileSignature || '').trim();
  const searchInput = document.getElementById('search-input');
  let debounceTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      const query = searchInput.value.trim();
      if (!query) {
        renderFileList(currentFileListScope());
        return;
      }
      const matches = await window.messsAPI.searchFiles(query);
      renderFileList(filterFilesByActiveDateFolder(matches));
      await refreshAchievements();
    }, 180);
  });

  document.getElementById('import-btn').addEventListener('click', async () => {
    const paths = await window.messsAPI.pickFiles();
    if (paths && paths.length) await importFilePaths(paths);
  });

  document.getElementById('import-folder-btn').addEventListener('click', async () => {
    const res = await window.messsAPI.pickFolderToImport(activeCanvasId());
    if (res) mergeImportedDirectoryResult(res);
  });

  document.getElementById('sidebar-brand-btn').addEventListener('click', (event) => {
    const draggedAt = Number(event.currentTarget.closest('.sidebar').dataset.layoutDraggedAt || 0);
    if (Date.now() - draggedAt < 450) return;
    resetPanelLayout();
    showToast(t('Default layout restored', '已恢复默认布局'), 'Messs');
  });

  document.getElementById('sidebar-brand-btn').addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    buildAndShowSimpleMenu([
      {
        label: t('Sponsor', '\u8d5e\u52a9'),
        icon: 'M12 21s-8-4.8-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6.2-8 11-8 11z',
        action: () => showToast(t('Sponsorship is coming soon.', '\u8d5e\u52a9\u529f\u80fd\u5f85\u5b9a\u3002'), 'Messs')
      }
    ], event.clientX, event.clientY, 'brand-context-menu');
  });

  initColorManagementSettings(initial.colorManagement);
  initLanguageSettings();
  initSidebarDropZone();
  initLibraryPathSettings();
  initAiMediaSettings();
  if (typeof initUsageSettings === 'function') initUsageSettings();
  initImportProgress();
  initSidebarMultiSelectShortcuts();
  initAccountProfileEditing();
  document.addEventListener('messs:membership-updated', (event) => {
    renderMembershipBalance(event.detail);
  });
}

function initSidebarMultiSelectShortcuts() {
  const wrap = document.getElementById('file-list-wrap');
  wrap.tabIndex = -1;
  wrap.addEventListener('pointerdown', () => wrap.focus({ preventScroll: true }));
  wrap.addEventListener('mouseenter', () => { isSidebarListHovered = true; });
  wrap.addEventListener('mouseleave', () => { isSidebarListHovered = false; });

  document.addEventListener('keydown', (e) => {
    if (!isSidebarListHovered && !wrap.contains(document.activeElement) && document.activeElement !== wrap) return;
    const tag = document.activeElement && document.activeElement.tagName;
    const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || (document.activeElement && document.activeElement.isContentEditable);
    if (isEditable) return;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      e.stopImmediatePropagation();
      selectAllSidebarFiles();
    } else if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') || e.key === 'Escape') {
      if (sidebarSelected.size) {
        e.preventDefault();
        e.stopImmediatePropagation();
        clearSidebarSelect();
      }
    }
  }, true);
}

function setText(selector, en, zh) {
  const el = document.querySelector(selector);
  if (el) el.textContent = t(en, zh);
}

function accountProfileElement(field) {
  return document.getElementById(field === 'name' ? 'account-popover-name' : 'account-popover-signature');
}

function renderAccountProfileText() {
  const displayName = accountProfileDisplayName || accountProfileFallbackName;
  const values = {
    'account-footer-name': displayName,
    'account-footer-signature': accountProfileSignature,
    'account-popover-name': displayName,
    'account-popover-signature': accountProfileSignature
  };
  Object.entries(values).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (!element || element.matches('input')) return;
    element.textContent = value;
    if (id.endsWith('signature')) {
      element.classList.toggle('is-empty', !value);
      element.dataset.placeholder = t('Personal signature', '个性签名');
    }
  });
}

function beginAccountProfileEdit(field) {
  const element = accountProfileElement(field);
  if (!element || element.matches('input')) return;
  const previousValue = field === 'name'
    ? (accountProfileDisplayName || accountProfileFallbackName)
    : accountProfileSignature;
  const input = document.createElement('input');
  input.id = element.id;
  input.className = 'account-profile-edit-input';
  input.type = 'text';
  input.maxLength = field === 'name' ? 80 : 120;
  input.value = previousValue;
  input.setAttribute('aria-label', field === 'name' ? t('Display name', '显示名称') : t('Personal signature', '个性签名'));
  element.replaceWith(input);
  input.focus();
  input.select();

  let finished = false;
  const finish = async (save) => {
    if (finished) return;
    finished = true;
    const nextValue = input.value.replace(/\s+/g, ' ').trim();
    const replacement = document.createElement(field === 'name' ? 'strong' : 'small');
    replacement.id = input.id;
    replacement.className = 'account-profile-editable';
    replacement.dataset.profileField = field;
    input.replaceWith(replacement);

    if (!save || (field === 'name' && !nextValue)) {
      renderAccountProfileText();
      return;
    }

    if (field === 'name') accountProfileDisplayName = nextValue;
    else accountProfileSignature = nextValue;
    renderAccountProfileText();

    try {
      const method = field === 'name' ? 'setProfileDisplayName' : 'setProfileSignature';
      const result = await window.messsAPI[method](nextValue);
      if (!result || !result.ok) throw new Error(t('Could not save profile.', '无法保存个人资料。'));
      if (field === 'name') accountProfileDisplayName = result.value;
      else accountProfileSignature = result.value;
      renderAccountProfileText();
    } catch (error) {
      if (field === 'name') accountProfileDisplayName = previousValue === accountProfileFallbackName ? '' : previousValue;
      else accountProfileSignature = previousValue;
      renderAccountProfileText();
      showToast(error && error.message ? error.message : t('Could not save profile.', '无法保存个人资料。'), 'Messs');
    }
  };

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void finish(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      void finish(false);
    }
  });
  input.addEventListener('blur', () => void finish(true), { once: true });
}

function initAccountProfileEditing() {
  const head = document.querySelector('.account-popover-head');
  if (!head) return;
  head.addEventListener('dblclick', (event) => {
    const target = event.target.closest('[data-profile-field]');
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    beginAccountProfileEdit(target.dataset.profileField);
  });
  document.querySelector('.account-footer-copy')?.addEventListener('dblclick', (event) => {
    const target = event.target.closest('[data-profile-field]');
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    document.getElementById('settings-popover').hidden = true;
    document.getElementById('account-popover').hidden = false;
    beginAccountProfileEdit(target.dataset.profileField);
  });
  renderAccountProfileText();
}

function setAttr(selector, attr, en, zh) {
  const el = document.querySelector(selector);
  if (el) el.setAttribute(attr, t(en, zh));
}

function setTitleAndLabel(selector, en, zh) {
  const value = t(en, zh);
  const el = document.querySelector(selector);
  if (!el) return;
  el.title = value;
  el.setAttribute('aria-label', value);
}

function setButtonTailText(selector, en, zh) {
  const value = ` ${t(en, zh)}`;
  document.querySelectorAll(selector).forEach((el) => {
    const textNode = [...el.childNodes].reverse().find((node) =>
      node.nodeType === Node.TEXT_NODE && node.textContent.trim()
    );
    if (textNode) textNode.textContent = value;
    else el.appendChild(document.createTextNode(value));
  });
}

function setChatProviderColumnLabels() {
  const labels = [
    t('Default', '\u9ed8\u8ba4'),
    t('Connection name', '\u8fde\u63a5\u540d\u79f0'),
    'Base URL',
    t('Models', '\u6a21\u578b'),
    'API Key'
  ];
  document.querySelectorAll('.ai-chat-provider-columns span').forEach((span, index) => {
    span.textContent = labels[index] || span.textContent;
  });
}

function refreshApiSettingsLanguage() {
  setChatProviderColumnLabels();
  setText('#ai-provider-manager-title', 'More Settings', '更多设置');
  setTitleAndLabel('#ai-provider-manager-close', 'Close', '关闭');
  setText('.storage-settings-section .ai-provider-section-heading strong', 'Storage', '存储');
  setText('#library-path-add-btn', 'Add Mirror Location', '添加镜像位置');
  setText('.ai-provider-chat-section .ai-provider-section-heading strong', 'Chat API', '对话 API');
  setText('.ai-provider-chat-section .ai-provider-section-heading small', 'Automatic protocol detection', '自动识别接口协议');
  setText('.ai-provider-chat-grid label:nth-child(1) span', 'Profile Name', '配置名称');
  setText('.ai-provider-chat-grid label:nth-child(2) span', 'Base URL', 'Base URL');
  setText('.ai-provider-chat-grid label:nth-child(3) span', 'Model ID', '模型 ID');
  setText('.ai-provider-chat-grid label:nth-child(4) span', 'API Key', 'API Key');
  if (typeof updateAiChatConfigHint === 'function') updateAiChatConfigHint();
}

function refreshStaticLanguage() {
  setChatProviderColumnLabels();
  document.title = t('Messs. - Resolve your confusion', 'Messs. - 解决你的混乱');
  setAttr('#section-tabs', 'aria-label', 'Sections', '分区');
  setText('.section-tab[data-section="chat"]', 'Chat', '聊天');
  setText('.section-tab[data-section="market"]', 'Market', '市场');
  setText('.section-tab[data-section="workshop"]', 'Workshop', '创意工坊');
  setTitleAndLabel('#win-minimize-btn', 'Minimize', '最小化');
  setTitleAndLabel('#win-close-btn', 'Close', '关闭');

  setText('.start-subtitle', 'Resolve your confusion', '解决你的混乱');
  setText('.start-btn-label', 'Start', '开始');
  setTitleAndLabel('#start-btn', 'Start', '开始');
  setTitleAndLabel('#sidebar-brand-btn', 'Restore default layout', '恢复默认布局');
  setText('.brand-tagline', 'Resolve your confusion', '解决你的混乱');

  setAttr('#search-input', 'placeholder', 'Search files', '搜索文件');
  setText('.file-list-label', 'Files', '文件');
  setText('#file-list-empty', 'No files yet. Drop files on the canvas or use Import.', '还没有文件。把文件拖进画布，或点击导入。');
  setTitleAndLabel('#add-folder-btn', 'New folder', '新建文件夹');
  setTitleAndLabel('#collapse-sidebar-btn', 'Collapse sidebar', '收起侧边栏');
  setTitleAndLabel('#expand-sidebar-btn', 'Expand sidebar', '展开侧边栏');
  setTitleAndLabel('#import-btn', 'Import files', '导入文件');
  setTitleAndLabel('#import-folder-btn', 'Import folder', '导入文件夹');
  setTitleAndLabel('#settings-btn', 'Settings', '设置');
  setTitleAndLabel('#account-popover-avatar', 'Change profile image', '更换头像');

  setText('.settings-popover-title:not(.settings-section-spaced)', 'Appearance', '外观');
  setButtonTailText('.theme-opt[data-theme-choice="light"]', 'Light', '浅色');
  setButtonTailText('.theme-opt[data-theme-choice="dark"]', 'Dark', '深色');
  setText('#ai-provider-manager-open strong', 'More Settings', '更多设置');
  setText('#ai-provider-summary', 'Theme, language, updates, redemption', '主题、语言、更新、兑换');

  setText('.preview-panel .panel-title', 'Preview Canvas', '预览画布');
  setTitleAndLabel('#preview-back-btn', 'Back', '返回');
  setTitleAndLabel('#preview-page-prev', 'Previous page', '上一页');
  setTitleAndLabel('#preview-page-next', 'Next page', '下一页');
  setAttr('#view-mode-toggle', 'aria-label', 'View mode', '视图模式');
  setTitleAndLabel('#view-mode-grid', 'Grid view', '网格视图');
  setTitleAndLabel('#view-mode-list', 'List view', '列表视图');
  setTitleAndLabel('#preview-zoom-out', 'Zoom out', '缩小');
  setTitleAndLabel('#preview-zoom-in', 'Zoom in', '放大');
  setTitleAndLabel('#preview-fullscreen', 'Enlarge preview', '放大预览');
  setText('#preview-empty p:first-child', 'Drop files here to save them automatically.', '把文件拖到这里会自动保存。');
  setText('#preview-empty .preview-empty-sub', 'Or select an item from the sidebar to preview it.', '也可以从侧边栏选择文件进行预览。');
  setText('#preview-open-external', 'Open in Default App', '用默认应用打开');
  setText('#preview-reveal', 'Show in Folder', '在文件夹中显示');
  setText('#preview-loading p', 'Generating preview...', '正在生成预览...');

  setText('#ai-assistant-home h2', 'Messs resolves your confusion.', 'Messs 帮你理清混乱。');
  setText('#ai-assistant-home p', 'What should we solve today?', '今天要解决什么？');
  setText('.ai-assistant-quick-prompts [data-ai-quick-action="poster"]', 'Create Poster', '生成海报');
  setText('.ai-assistant-quick-prompts [data-ai-quick-action="logo"]', 'Create LOGO', '生成 LOGO');
  setText('.ai-assistant-quick-prompts [data-ai-quick-action="clarify"]', 'Clarify Idea', '理清想法');
  setText('.ai-assistant-quick-prompts [data-ai-quick-action="short-video"]', 'Short Video', '短视频');
  setText('[data-assistant-kind="chat"]', 'Chat', '对话');
  setTitleAndLabel('[data-assistant-kind="image"]', 'Image', '图片');
  setTitleAndLabel('[data-assistant-kind="video"]', 'Video', '视频');
  setAttr('.ai-assistant-mode', 'aria-label', 'AI mode', 'AI 模式');
  setAttr('#ai-assistant-model', 'aria-label', 'AI provider', 'AI 服务商');
  setTitleAndLabel('#ai-assistant-upload', 'Upload image', '上传图片');
  setTitleAndLabel('#ai-assistant-model-trigger', 'Choose AI provider', '选择 AI 服务商');
  setTitleAndLabel('#ai-assistant-options-toggle', 'Generation settings', '生成设置');
  setTitleAndLabel('#ai-assistant-submit', 'Send', '发送');
  setText('#ai-assistant-options label:nth-child(1) span', 'Aspect', '比例');
  setText('#ai-assistant-size-wrap span', 'Resolution', '分辨率');
  setText('#ai-assistant-count-wrap span', 'Count', '数量');
  setText('#ai-assistant-duration-wrap span', 'Duration', '时长');

  setText('.file-detail-title', 'File Details', '文件详情');
  setTitleAndLabel('#file-detail-close', 'Close details', '关闭详情');
  setButtonTailText('#file-detail-export', 'Export', '导出');

  setText('#board-panel .panel-title', 'Integrated Canvas', '整合画布');
  setText('#board-empty', 'Drag files here to compare, arrange, and generate freely.', '把文件拖到这里，自由对比、排布和生成。');
  if (typeof refreshCanvasNodeModeLanguage === 'function') refreshCanvasNodeModeLanguage();
  setTitleAndLabel('#board-zoom-out', 'Zoom out', '缩小');
  setTitleAndLabel('#board-zoom-in', 'Zoom in', '放大');
  setTitleAndLabel('#board-fit-all', 'Fit all', '适应全部');
  setTitleAndLabel('#doodle-tool-pen', 'Pen', '画笔');
  setTitleAndLabel('#doodle-tool-eraser', 'Eraser', '橡皮擦');
  setAttr('#doodle-size-slider', 'title', 'Brush size', '画笔大小');
  setAttr('#doodle-custom-color', 'title', 'Custom color', '自定义颜色');
  setTitleAndLabel('#doodle-confirm-btn', 'Confirm drawing', '确认绘制');
  setAttr('#text-font-select', 'title', 'Font', '字体');
  setAttr('#text-weight-select', 'title', 'Weight', '字重');
  setAttr('#text-color-swatch', 'title', 'Text color', '文字颜色');
  setAttr('#text-color-none', 'title', 'No fill', '无填充');
  setAttr('#text-align-left', 'title', 'Align left', '左对齐');
  setAttr('#text-align-center', 'title', 'Center align', '居中对齐');
  setAttr('#text-align-right', 'title', 'Align right', '右对齐');
  setTitleAndLabel('#board-theme-toggle', 'Toggle theme', '切换主题');
  setTitleAndLabel('#board-shortcuts-btn', 'Shortcuts', '快捷键');
  setTitleAndLabel('#board-tool-upload', 'Upload files', '上传文件');
  setTitleAndLabel('#board-tool-ai-image', 'AI image', 'AI 图片');
  setTitleAndLabel('#board-tool-ai-video', 'AI video', 'AI 视频');
  setTitleAndLabel('#board-tool-text', 'Text', '文字');
  setTitleAndLabel('#board-tool-doodle', 'Draw', '绘制');
  setAttr('#board-bottom-zoom-out', 'title', 'Zoom out', '缩小');
  setAttr('#board-bottom-zoom-in', 'title', 'Zoom in', '放大');
  setTitleAndLabel('#board-bottom-fullscreen-toggle', 'Exit fullscreen', '退出全屏');

  setText('#ai-provider-manager-title', 'More Settings', '更多设置');
  setTitleAndLabel('#ai-provider-manager-close', 'Close', '关闭');
  setText('.preferences-settings-section .ai-provider-section-heading strong', 'Preferences', '偏好设置');
  setText('.appearance-settings-row .preference-settings-copy strong', 'Appearance', '外观');
  setText('.appearance-settings-row .preference-settings-copy small', 'Choose the app theme', '选择软件主题');
  setText('.language-settings-row .preference-settings-copy strong', 'Language', '语言');
  setText('.language-settings-row .preference-settings-copy small', 'Interface language', '界面语言');
  setText('#text-size-title', 'Text size', '文字大小');
  setText('#text-size-description', 'Adjust interface text size', '调整界面文字大小');
  setText('#text-size-label-0', 'Extra small', '极小');
  setText('#text-size-label-1', 'Small', '小');
  setText('#text-size-label-2', 'Medium', '中');
  setText('#text-size-label-3', 'Large', '大');
  setText('#text-size-label-4', 'Extra large', '极大');
  setAttr('#text-size-range', 'aria-label', 'Text size', '文字大小');
  renderTextSizeSettings();
  setText('#color-management-title', 'Color management', '色彩管理');
  setAttr('.preferences-settings-section .theme-switch', 'aria-label', 'Appearance', '外观');
  setAttr('.preferences-settings-section .language-switch', 'aria-label', 'Language', '语言');
  setAttr('.color-profile-switch', 'aria-label', 'Color management', '色彩管理');
  setText('.storage-settings-section .ai-provider-section-heading strong', 'Storage', '存储');
  setText('#library-path-add-btn', 'Add Mirror Location', '添加镜像位置');
  setText('.ai-provider-chat-grid label:nth-child(1) span', 'Profile Name', '配置名称');
  setText('.ai-provider-chat-grid label:nth-child(2) span', 'Base URL', 'Base URL');
  setText('.ai-provider-chat-grid label:nth-child(3) span', 'Model', '模型');
  setText('.ai-provider-chat-grid label:nth-child(4) span', 'API Key', 'API Key');
  setText('.software-update-section .ai-provider-section-heading strong', 'Software Update', '软件更新');
  setText('.software-update-settings > label strong', 'Automatic updates', '自动更新');
  setText('.software-update-settings > label small', 'Download updates and install after restart', '自动下载，重启后安装');
  setText('#software-check-update-btn', 'Check Now', '立即检查');
  setText('.activation-redemption-copy strong', 'Redemption code', '兑换码');
  setText('.activation-redemption-copy small', 'Add points to this account', '为当前账号添加积分');
  setAttr('#activation-settings-code', 'placeholder', 'Enter redemption code', '输入兑换码');
  setText('#activation-settings-form button', 'Redeem', '兑换');
  setText('.cloud-security-section .ai-provider-section-heading strong', 'Cloud Account', '云端账号');
  document.querySelectorAll('.ai-provider-columns').forEach((row) => {
    const labels = [
      t('Default', '默认'),
      t('Connection name', '连接名称'),
      t('Base URL or request URL (auto-detect)', 'Base URL 或请求 URL（自动识别）'),
      'API Key'
    ];
    row.querySelectorAll('span').forEach((span, index) => { span.textContent = labels[index] || span.textContent; });
  });
  setChatProviderColumnLabels();
  setText('.ai-provider-shared-key label span', 'Shared Media API Key', '共享媒体 API Key');
  setText('.preview-tools-section .ai-provider-section-heading strong', 'Preview Tools', '预览工具');
  setText('#tool-status-refresh-btn', 'Check Again', '重新检测');
  setText('#ai-api-key-clear', 'Clear All Keys', '清除全部密钥');
  setText('#ai-service-save', 'Save Settings', '保存设置');

  setText('#detail-overlay h2', 'Usage', '使用情况');
  setTitleAndLabel('#detail-close', 'Close', '关闭');
  setText('.detail-time-block:nth-child(1) .detail-time-label', 'Total Time', '总时长');
  setText('.detail-time-block:nth-child(2) .detail-time-label', 'Last Run', '上次运行');
  setTitleAndLabel('#fullscreen-close', 'Close preview', '关闭预览');
  setText('.update-banner-text', 'A new version has been downloaded. Restart to update.', '新版本已下载，重启即可更新。');
  setText('#update-install-btn', 'Restart Now', '立即重启');
  setTitleAndLabel('#update-dismiss-btn', 'Dismiss', '忽略');
  setText('#import-progress-label', 'Importing folder...', '正在导入文件夹...');
  setTitleAndLabel('#editor-bold', 'Bold', '加粗');
  setTitleAndLabel('#editor-italic', 'Italic', '斜体');
  setTitleAndLabel('#editor-underline', 'Underline', '下划线');
  setTitleAndLabel('#editor-close', 'Close editor', '关闭编辑器');
  setText('#section-chat .section-placeholder-name', 'Chat', '聊天');
  setText('#section-market .section-placeholder-name', 'Market', '市场');
  setText('#section-workshop .section-placeholder-name', 'Workshop', '创意工坊');
  document.querySelectorAll('.section-placeholder-inner p').forEach((p) => { p.textContent = t('Coming soon.', '即将推出。'); });
  renderColorManagementSettings();
}

function refreshLanguageDependentViews() {
  if (typeof renderFolderList === 'function') renderFolderList();
  if (typeof renderFileList === 'function' && typeof currentFileListScope === 'function') renderFileList(currentFileListScope());
  if (typeof renderFolderGridIfActive === 'function') renderFolderGridIfActive();
  if (typeof renderBoard === 'function') renderBoard();
  if (typeof refreshStatsLanguage === 'function') refreshStatsLanguage();
  else {
    if (typeof renderTopStats === 'function') renderTopStats();
    if (typeof renderAchievementList === 'function') renderAchievementList();
  }
  if (typeof refreshLibraryPathUI === 'function') refreshLibraryPathUI();
  if (typeof updateAiProviderCount === 'function') updateAiProviderCount();
  if (typeof refreshAiProviderSlotLanguage === 'function') refreshAiProviderSlotLanguage();
  if (typeof renderContextMenuItems === 'function') renderContextMenuItems();
  if (typeof refreshTitlebarLanguage === 'function') refreshTitlebarLanguage();
  if (typeof refreshUpdaterLanguage === 'function') refreshUpdaterLanguage();
  if (typeof refreshAssistantLanguage === 'function') refreshAssistantLanguage();
  if (typeof refreshCanvasWorkspaceLanguage === 'function') refreshCanvasWorkspaceLanguage();
  if (typeof refreshBoardLanguage === 'function') refreshBoardLanguage();
  if (typeof refreshPreviewLanguage === 'function') refreshPreviewLanguage();
  if (typeof refreshEditorLanguage === 'function') refreshEditorLanguage();

  const detailPanel = document.getElementById('file-detail-panel');
  if (detailPanel && !detailPanel.hidden && AppState.activeFileId) {
    const file = AppState.files.find((item) => item.id === AppState.activeFileId);
    if (file && typeof showFileDetailPanel === 'function') showFileDetailPanel(file);
  }
}

function applyLanguageChoice(language, options = {}) {
  const lang = normalizeAppLanguage(language);
  AppState.language = lang;
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : (lang === 'ko' ? 'ko' : 'en');
  document.documentElement.dataset.language = lang;
  document.querySelectorAll('.language-opt').forEach((btn) => {
    const active = btn.dataset.languageChoice === lang;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('[data-i18n-en]').forEach((node) => {
    const next = t(node.dataset.i18nEn, node.dataset.i18nZh, node.dataset.i18nKo);
    if (next) node.textContent = next;
  });
  document.querySelectorAll('[data-i18n-placeholder-en]').forEach((node) => {
    const next = t(
      node.dataset.i18nPlaceholderEn,
      node.dataset.i18nPlaceholderZh,
      node.dataset.i18nPlaceholderKo
    );
    if (next) node.setAttribute('placeholder', next);
  });
  refreshStaticLanguage();
  setText('.start-btn-label', 'START', 'START');
  setTitleAndLabel('#start-btn', 'Start', 'Start');
  setTitleAndLabel('#import-btn', 'Upload files', '\u4e0a\u4f20\u6587\u4ef6');
  setTitleAndLabel('#import-folder-btn', 'Upload folder', '\u4e0a\u4f20\u6587\u4ef6\u5939');
  setText('.ai-assistant-compact h2', 'Messs resolves your confusion.', 'Messs \u5e2e\u4f60\u7406\u6e05\u6df7\u4e71\u3002');
  setText('.ai-assistant-compact p', 'What should we solve today?', '\u4eca\u5929\u8981\u89e3\u51b3\u4ec0\u4e48\uff1f');
  refreshApiSettingsLanguage();
  if (typeof refreshTitlebarLanguage === 'function') refreshTitlebarLanguage();
  if (options.rerender !== false) refreshLanguageDependentViews();
  document.dispatchEvent(new CustomEvent('messs:language-changed', { detail: { language: lang } }));
}

function initLanguageSettings() {
  applyLanguageChoice(AppState.language || 'ko', { rerender: false });
  document.querySelectorAll('.language-opt').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const choice = normalizeAppLanguage(btn.dataset.languageChoice);
      applyLanguageChoice(choice);
      if (typeof window.messsAPI.setLanguage === 'function') {
        await window.messsAPI.setLanguage(choice);
      }
    });
  });
}

const TEXT_SIZE_LEVELS = Object.freeze([
  { id: 'extra-small', scale: 0.84 },
  { id: 'small', scale: 0.92 },
  { id: 'medium', scale: 1 },
  { id: 'large', scale: 1.12 },
  { id: 'extra-large', scale: 1.26 }
]);
const TEXT_SIZE_TAG = 'data-messs-text-scale';
const TEXT_SIZE_DYNAMIC_SURFACE = '#board-canvas, .drawflow';
let textSizeState = { id: 'medium', scale: 1 };
let textSizeObserver = null;

function normalizeTextSize(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return TEXT_SIZE_LEVELS.some((level) => level.id === normalized) ? normalized : 'medium';
}

function textSizeLevel(value) {
  return TEXT_SIZE_LEVELS.find((level) => level.id === normalizeTextSize(value)) || TEXT_SIZE_LEVELS[2];
}

function textSizeLabel(id) {
  const labels = {
    'extra-small': t('Extra small', '极小'),
    small: t('Small', '小'),
    medium: t('Medium', '中'),
    large: t('Large', '大'),
    'extra-large': t('Extra large', '极大')
  };
  return labels[id] || labels.medium;
}

function textSizeScalableElement(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
  if (element.matches(TEXT_SIZE_DYNAMIC_SURFACE) || element.closest(TEXT_SIZE_DYNAMIC_SURFACE)) return false;
  return !['SVG', 'PATH', 'CIRCLE', 'RECT', 'LINE', 'POLYLINE', 'POLYGON', 'G', 'DEFS', 'IMG', 'VIDEO', 'AUDIO', 'CANVAS', 'IFRAME', 'SCRIPT', 'STYLE', 'LINK', 'META', 'BR', 'HR'].includes(element.tagName);
}

function rememberTextSizeBaselines(root = document.body) {
  if (!root) return;
  if (root.nodeType === Node.ELEMENT_NODE && root.closest(TEXT_SIZE_DYNAMIC_SURFACE)) return;
  const elements = [];
  if (textSizeScalableElement(root)) elements.push(root);
  if (typeof root.querySelectorAll === 'function') {
    root.querySelectorAll('*').forEach((element) => {
      if (textSizeScalableElement(element)) elements.push(element);
    });
  }
  const scale = Math.max(0.01, Number(textSizeState.scale) || 1);
  elements.forEach((element) => {
    if (element.hasAttribute(TEXT_SIZE_TAG)) return;
    const computed = parseFloat(getComputedStyle(element).fontSize);
    if (Number.isFinite(computed) && computed > 0) {
      element.style.setProperty('--messs-base-font-size', `${computed / scale}px`);
    }
    element.setAttribute(TEXT_SIZE_TAG, '');
  });
}

function renderTextSizeSettings() {
  const level = textSizeLevel(textSizeState.id);
  const range = document.getElementById('text-size-range');
  const output = document.getElementById('text-size-value');
  if (range) {
    const index = TEXT_SIZE_LEVELS.findIndex((item) => item.id === level.id);
    range.value = String(Math.max(0, index));
    range.setAttribute('aria-valuetext', textSizeLabel(level.id));
  }
  if (output) output.textContent = textSizeLabel(level.id);
}

function applyTextSize(value) {
  const level = textSizeLevel(value);
  rememberTextSizeBaselines();
  textSizeState = { id: level.id, scale: level.scale };
  document.documentElement.dataset.textSize = level.id;
  document.documentElement.style.setProperty('--text-size-scale', String(level.scale));
  renderTextSizeSettings();
}

function initTextSizeSettings(initialValue = 'medium') {
  // Capture normal computed sizes before applying the selected scale. A
  // mutation observer covers panels and dialogs created after startup.
  textSizeState = { id: 'medium', scale: 1 };
  document.documentElement.style.setProperty('--text-size-scale', '1');
  rememberTextSizeBaselines();
  applyTextSize(initialValue);
  if (!textSizeObserver && document.body) {
    textSizeObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) rememberTextSizeBaselines(node);
      }));
    });
    textSizeObserver.observe(document.body, { childList: true, subtree: true });
  }
  const range = document.getElementById('text-size-range');
  if (!range || range.dataset.bound === 'true') return;
  range.dataset.bound = 'true';
  range.addEventListener('input', () => {
    const rawIndex = Number(range.value);
    const index = Number.isFinite(rawIndex)
      ? Math.max(0, Math.min(TEXT_SIZE_LEVELS.length - 1, Math.round(rawIndex)))
      : 2;
    applyTextSize(TEXT_SIZE_LEVELS[index].id);
  });
  range.addEventListener('change', async () => {
    try {
      await window.messsAPI.setTextSize(textSizeState.id);
    } catch (error) {
      console.warn('Could not save text size:', error && error.message || error);
    }
  });
}

function normalizeRendererColorProfile(profile) {
  return ['auto', 'srgb', 'display-p3'].includes(profile) ? profile : 'auto';
}

function colorProfileStatusText(profile) {
  if (profile === 'srgb') return t('sRGB output profile', 'sRGB 输出色域');
  if (profile === 'display-p3') return t('Display P3 output profile', 'Display P3 输出色域');
  return t('System ICC profile', '跟随系统 ICC 配置');
}

function renderColorManagementSettings() {
  const profile = normalizeRendererColorProfile(colorManagementState.profile);
  const activeProfile = normalizeRendererColorProfile(colorManagementState.activeProfile);
  const restartRequired = profile !== activeProfile;
  const p3Supported = !!(displayP3MediaQuery && displayP3MediaQuery.matches);

  colorManagementState = { profile, activeProfile, restartRequired };
  document.documentElement.dataset.colorProfile = activeProfile;
  document.documentElement.dataset.selectedColorProfile = profile;

  document.querySelectorAll('.color-profile-opt').forEach((button) => {
    const choice = button.dataset.colorProfile;
    const active = choice === profile;
    const unavailable = choice === 'display-p3' && !p3Supported && !active;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-checked', String(active));
    button.disabled = unavailable;
    if (unavailable) {
      const reason = t('This display does not report Display P3 support', '当前显示器未报告 Display P3 支持');
      button.title = reason;
      button.setAttribute('aria-label', reason);
    } else {
      button.removeAttribute('title');
      button.setAttribute('aria-label', choice === 'auto' ? t('Auto', '自动') : (choice === 'srgb' ? 'sRGB' : 'Display P3'));
    }
  });

  const status = document.getElementById('color-management-status');
  if (status) {
    const base = colorProfileStatusText(profile);
    status.textContent = restartRequired
      ? `${base} · ${t('Restart required', '需要重启')}`
      : base;
  }

  const restartButton = document.getElementById('color-profile-restart');
  if (restartButton) {
    restartButton.hidden = !restartRequired;
    const label = restartButton.querySelector('span');
    if (label) label.textContent = t('Restart now', '立即重启');
  }
}

function initColorManagementSettings(initialState = {}) {
  colorManagementState = {
    profile: normalizeRendererColorProfile(initialState.profile),
    activeProfile: normalizeRendererColorProfile(initialState.activeProfile),
    restartRequired: !!initialState.restartRequired
  };
  displayP3MediaQuery = window.matchMedia('(color-gamut: p3)');
  if (typeof displayP3MediaQuery.addEventListener === 'function') {
    displayP3MediaQuery.addEventListener('change', renderColorManagementSettings);
  }

  document.querySelectorAll('.color-profile-opt').forEach((button) => {
    button.addEventListener('click', async () => {
      const profile = normalizeRendererColorProfile(button.dataset.colorProfile);
      if (profile === colorManagementState.profile || button.disabled) return;
      const controls = [...document.querySelectorAll('.color-profile-opt')];
      controls.forEach((control) => { control.disabled = true; });
      try {
        colorManagementState = await window.messsAPI.setColorProfile(profile);
      } catch (error) {
        showToast(t('Could not save color management setting', '无法保存色彩管理设置'));
      }
      renderColorManagementSettings();
    });
  });

  const restartButton = document.getElementById('color-profile-restart');
  if (restartButton) {
    restartButton.addEventListener('click', async () => {
      restartButton.disabled = true;
      const label = restartButton.querySelector('span');
      if (label) label.textContent = t('Restarting...', '正在重启...');
      try {
        await window.messsAPI.restartForColorProfile();
      } catch (error) {
        restartButton.disabled = false;
        renderColorManagementSettings();
        showToast(t('Could not restart the app', '无法重启软件'));
      }
    });
  }

  renderColorManagementSettings();
}

function initImportProgress() {
  window.messsAPI.onImportProgress((payload) => {
    const banner = document.getElementById('import-progress-banner');
    const fill = document.getElementById('import-progress-fill');
    const count = document.getElementById('import-progress-count');

    clearTimeout(importProgressHideTimer);
    if (payload.total <= 8) {
      if (payload.finished) banner.classList.remove('is-visible');
      return;
    }

    banner.hidden = false;
    requestAnimationFrame(() => banner.classList.add('is-visible'));
    count.textContent = `${payload.done} / ${payload.total}`;
    fill.style.width = (payload.total ? (payload.done / payload.total) * 100 : 0) + '%';

    if (payload.finished) {
      importProgressHideTimer = setTimeout(() => {
        banner.classList.remove('is-visible');
        setTimeout(() => { banner.hidden = true; }, 260);
      }, 500);
    }
  });
}

function initSidebarDropZone() {
  const sidebar = document.getElementById('sidebar');
  ['dragenter', 'dragover'].forEach((evt) => {
    sidebar.addEventListener(evt, (e) => {
      if (e.target.closest('.folder-item')) return;
      e.preventDefault();
      sidebar.classList.add('is-drag-over');
    });
  });
  ['dragleave', 'drop'].forEach((evt) => {
    sidebar.addEventListener(evt, (e) => {
      if (e.target.closest('.folder-item')) return;
      sidebar.classList.remove('is-drag-over');
    });
  });
  sidebar.addEventListener('drop', async (e) => {
    if (e.target.closest('.folder-item')) return;
    e.preventDefault();
    expandDateFolderBranch(todayDateFolderKey(), true);
    await handleExternalDrop(e.dataTransfer);
  });
}

async function importFilePaths(paths) {
  const targetFolderId = AppState.activeFolderId && AppState.activeFolderId !== 'default'
    ? AppState.activeFolderId
    : null;
  await importFilePathsCore(paths, targetFolderId);
}

async function importFilePathsCore(paths, targetFolderId) {
  const result = await window.messsAPI.importFiles(paths, targetFolderId, activeCanvasId());
  await mergeImportedFilesResult(result);
  if (result && result.failed && result.failed.length) {
    const failure = result.failed[0] || {};
    showToast(failure.reason === 'EACCES' || failure.reason === 'EPERM'
      ? t('macOS blocked access to this file. Choose it again from Finder or allow Messs access in System Settings.', 'macOS 阻止了这个文件的访问，请从 Finder 重新选择，或在系统设置中允许 Messs 访问文件和文件夹。')
      : t('Some files could not be imported.', `部分文件导入失败${failure.name ? `：${failure.name}` : ''}。`));
  }
}

async function mergeImportedFilesResult(result) {
  const imported = result && Array.isArray(result.imported) ? result.imported : [];
  const unlocked = result && Array.isArray(result.unlocked) ? result.unlocked : [];
  if (imported.length) {
    AppState.files = [...imported, ...AppState.files];
    renderFileList(currentFileListScope());
    renderFolderGridIfActive();
    showToast(t(`Imported ${imported.length} file${imported.length === 1 ? '' : 's'}`, `已导入 ${imported.length} 个文件`));
    if (imported.length === 1) selectFileForPreview(imported[0].id);
  }
  if (unlocked && unlocked.length) await refreshAchievements();
}

function mergeImportedDirectoryResult(res) {
  if (!res) return;
  AppState.folders = [...AppState.folders, ...res.folders];
  AppState.files = [...res.files, ...AppState.files];
  renderFolderList();
  renderFileList(currentFileListScope());
  renderFolderGridIfActive();
  const name = res.topFolder && res.topFolder.name ? res.topFolder.name : t('folder', '文件夹');
  showToast(t(`Imported "${name}" (${res.files.length} files)`, `已导入“${name}”（${res.files.length} 个文件）`));
}

async function handleExternalDrop(dataTransfer, targetFolderId) {
  const resolvedTarget = targetFolderId !== undefined ? targetFolderId : (
    AppState.activeFolderId && AppState.activeFolderId !== 'default' ? AppState.activeFolderId : null
  );

  const droppedFiles = window.MesssFileDrop
    ? window.MesssFileDrop.entries(dataTransfer)
    : [];
  const fileEntries = [];
  const dirPaths = [];
  let unreadableDirectory = false;

  for (const dropped of droppedFiles) {
    const { entry, path: resolvedPath } = dropped;
    if (entry && entry.isDirectory) {
      if (resolvedPath) dirPaths.push(resolvedPath);
      else unreadableDirectory = true;
    } else {
      fileEntries.push(dropped);
    }
  }

  if (!fileEntries.length && !dirPaths.length) {
    showToast(t('Could not read the dropped path. Use the import buttons instead.', '无法读取拖入的路径，请改用导入按钮。'));
    return;
  }

  if (fileEntries.length) {
    const result = await window.MesssFileDrop.importEntries(fileEntries, resolvedTarget, activeCanvasId());
    await mergeImportedFilesResult(result);
    if (result.failed && result.failed.length) {
      const failure = result.failed[0] || {};
      const message = failure.reason === 'EACCES' || failure.reason === 'EPERM'
        ? t('macOS blocked access to this file. Choose it again from Finder or allow Messs access in System Settings.', 'macOS 阻止了这个文件的访问，请从 Finder 重新选择，或在系统设置中允许 Messs 访问文件和文件夹。')
        : t('Some dropped files could not be imported.', `部分拖入文件导入失败${failure.name ? `：${failure.name}` : ''}。`);
      showToast(message);
    }
  }
  for (const dirPath of dirPaths) {
    const res = await window.messsAPI.importDirectory(dirPath, resolvedTarget, activeCanvasId());
    mergeImportedDirectoryResult(res);
  }
  if (unreadableDirectory) {
    showToast(t('Use Import Folder when Finder does not provide a directory path.', 'Finder 未提供文件夹路径，请使用“导入文件夹”。'));
  }
}

function toggleSidebarCollapsed() {
  const collapsed = !document.getElementById('sidebar').classList.contains('is-collapsed');
  setSidebarCollapsed(collapsed);
  window.messsAPI.setSidebarCollapsed(collapsed);
}

function setSidebarCollapsed(collapsed) {
  document.getElementById('main-app').classList.toggle('sidebar-collapsed', collapsed);
  document.getElementById('sidebar').classList.toggle('is-collapsed', collapsed);
  const expandBtn = document.getElementById('expand-sidebar-btn');
  if (expandBtn && collapsed) {
    expandBtn.hidden = false;
    requestAnimationFrame(() => expandBtn.classList.add('is-visible'));
  } else if (expandBtn) {
    expandBtn.classList.remove('is-visible');
    setTimeout(() => { expandBtn.hidden = true; }, 220);
  }
  document.dispatchEvent(new CustomEvent('messs:sidebar-collapsed', { detail: { collapsed } }));
}

async function goBackToStartScreen() {
  if (hasUnsavedEditorWork()) await saveEditorContent();
  await window.messsAPI.checkUnsavedWork();
  showStartScreenAgain();
}

function initLibraryPathSettings() {
  refreshLibraryPathUI();
  document.getElementById('library-path-add-btn').addEventListener('click', async () => {
    const chosen = await window.messsAPI.pickCustomLibraryPath();
    if (chosen) {
      showToast(t('Added a mirror library path', '已添加镜像库位置'));
      refreshLibraryPathUI();
    }
  });
}

async function refreshLibraryPathUI() {
  const paths = await window.messsAPI.getLibraryPaths();
  const defaultRow = document.getElementById('library-path-default');
  const customRow = document.getElementById('library-path-custom');
  defaultRow.innerHTML = `<span class="library-path-label">${t('Default', '默认')}</span><span class="library-path-value" title="${escapeHtml(paths.defaultPath)}">${escapeHtml(paths.defaultPath)}</span>`;

  if (paths.customPath) {
    customRow.hidden = false;
    customRow.innerHTML = `<span class="library-path-label">${t('Mirror', '镜像')}</span><span class="library-path-value" title="${escapeHtml(paths.customPath)}">${escapeHtml(paths.customPath)}</span><button id="library-path-clear-btn" class="icon-btn-sm" title="${t('Remove mirror path', '移除镜像路径')}" aria-label="${t('Remove mirror path', '移除镜像路径')}">x</button>`;
    document.getElementById('library-path-clear-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      await window.messsAPI.clearCustomLibraryPath();
      refreshLibraryPathUI();
    });
    document.getElementById('library-path-add-btn').hidden = true;
  } else {
    customRow.hidden = true;
    document.getElementById('library-path-add-btn').hidden = false;
  }
}

function describeMediaEndpoint(endpoint, kind) {
  const value = String(endpoint || '').trim().toLowerCase();
  if (!value) return '';
  if (
    value.includes('generativelanguage.googleapis.com') ||
    /\/v1beta(?:[/?#]|$)/.test(value) ||
    /\/models\/[^/]+:(?:stream)?generatecontent(?:[/?#]|$)/.test(value)
  ) {
    return t('Gemini native', 'Gemini 原生');
  }
  if (kind === 'image') {
    if (/\/chat\/completions(?:[/?#]|$)/.test(value)) {
      return t('Chat image', 'Chat 生图');
    }
    if (/\/images\/edits(?:[/?#]|$)/.test(value)) {
      return t('OpenAI image edit', 'OpenAI 图片编辑');
    }
    if (/\/images\/generations(?:[/?#]|$)/.test(value)) {
      return t('OpenAI images', 'OpenAI 生图');
    }
  }
  if (kind === 'video') {
    if (/\/kling\//.test(value)) return t('Kling API', 'Kling 接口');
    if (/\/v1\/video\/(?:create|query)(?:[/?#]|$)/.test(value)) {
      return t('Unified video task', '统一视频任务');
    }
    if (/\/videos(?:\/[^/?#]+)?(?:\/content)?(?:[/?#]|$)/.test(value)) {
      return t('OpenAI videos', 'OpenAI 视频');
    }
  }
  try {
    const path = new URL(endpoint).pathname;
    if (path === '/' || /^\/v\d+(?:beta\d*)?\/?$/.test(path)) {
      return t('OpenAI compatible', 'OpenAI 兼容');
    }
  } catch (err) {}
  return t('Custom async', '自定义异步');
}

function renderAiProviderSlots(containerId, kind, providers, activeProviderId, fallbackName, fallbackEndpoint, allowFallback = true) {
  const slots = document.getElementById(containerId);
  slots.innerHTML = '';
  const list = Array.isArray(providers) ? providers : [];
  Array.from({ length: Math.max(10, list.length) }, (_, index) => list[index] || {
    id: `${kind}-${index + 1}`,
    name: index === 0 && allowFallback ? fallbackName : '',
    endpoint: index === 0 && allowFallback ? fallbackEndpoint : ''
  }).forEach((provider, index) => {
    const row = document.createElement('div');
    row.className = 'ai-provider-slot';
    row.dataset.providerId = provider.id || `${kind}-${index + 1}`;
    row.dataset.providerKind = kind;

    const defaultWrap = document.createElement('label');
    defaultWrap.className = 'ai-provider-slot-default';
    defaultWrap.title = kind === 'video'
      ? t('Use as default video provider', '设为默认视频服务商')
      : t('Use as default image provider', '设为默认图片服务商');
    const defaultInput = document.createElement('input');
    defaultInput.type = 'radio';
    defaultInput.name = `ai-default-${kind}-provider`;
    defaultInput.value = row.dataset.providerId;
    defaultInput.checked = activeProviderId === row.dataset.providerId;
    defaultWrap.appendChild(defaultInput);

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'ai-provider-name';
    nameInput.maxLength = 40;
    nameInput.placeholder = t('Optional; detected from URL', '可选，根据 URL 自动识别');
    nameInput.value = provider.name || '';

    const endpointInput = document.createElement('input');
    endpointInput.type = 'url';
    endpointInput.className = 'ai-provider-endpoint';
    endpointInput.spellcheck = false;
    endpointInput.placeholder = 'https://...';
    endpointInput.value = provider.endpoint || '';
    endpointInput.title = t(
      'Paste a Base URL or full request URL; the protocol is detected automatically.',
      '粘贴 Base URL 或完整请求 URL，协议会自动识别。'
    );
    const endpointWrap = document.createElement('div');
    endpointWrap.className = 'ai-provider-endpoint-wrap';
    const protocolHint = document.createElement('span');
    protocolHint.className = 'ai-provider-protocol';
    const updateProtocolHint = () => {
      const protocol = describeMediaEndpoint(endpointInput.value, kind);
      protocolHint.textContent = protocol;
      protocolHint.hidden = !protocol;
      protocolHint.title = protocol
        ? t(`Detected automatically: ${protocol}`, `已自动识别：${protocol}`)
        : '';
      if (!nameInput.value.trim()) {
        nameInput.placeholder = protocol || t('Optional; detected from URL', '可选，根据 URL 自动识别');
      }
    };
    endpointInput.addEventListener('input', updateProtocolHint);
    endpointWrap.append(endpointInput, protocolHint);
    updateProtocolHint();

    const keyInput = document.createElement('input');
    keyInput.type = 'password';
    keyInput.className = 'ai-provider-key';
    keyInput.autocomplete = 'new-password';
    const usesFallbackKey = !provider.hasOwnApiKey && provider.hasApiKey && provider.name && provider.endpoint;
    keyInput.placeholder = provider.hasOwnApiKey
      ? t('Saved securely; leave blank to keep it', '已安全保存，留空则保持不变')
      : (usesFallbackKey ? t('Using shared fallback key', '正在使用共享备用密钥') : 'API key');

    row.append(defaultWrap, nameInput, endpointWrap, keyInput);
    slots.appendChild(row);
  });
}

function renderChatProviderSlots(providers, activeProviderId, allowFallback = true) {
  const slots = document.getElementById('ai-chat-provider-slots');
  if (!slots) return;
  slots.innerHTML = '';
  const list = Array.isArray(providers) ? providers : [];
  Array.from({ length: Math.max(10, list.length) }, (_, index) => list[index] || {
    id: `chat-${index + 1}`,
    name: index === 0 && allowFallback ? 'Messs AI' : '',
    endpoint: '',
    models: index === 0 && allowFallback ? ['gemini-2.5-pro', 'gemini-2.5-flash'] : []
  }).forEach((provider, index) => {
    const row = document.createElement('div');
    row.className = 'ai-provider-slot ai-chat-provider-slot';
    row.dataset.providerId = provider.id || `chat-${index + 1}`;
    row.dataset.providerKind = 'chat';

    const defaultWrap = document.createElement('label');
    defaultWrap.className = 'ai-provider-slot-default';
    defaultWrap.title = t('Use as default chat connection', '设为默认对话接口');
    const defaultInput = document.createElement('input');
    defaultInput.type = 'radio';
    defaultInput.name = 'ai-default-chat-provider';
    defaultInput.value = row.dataset.providerId;
    defaultInput.checked = activeProviderId === row.dataset.providerId;
    defaultWrap.appendChild(defaultInput);

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'ai-chat-provider-name';
    nameInput.maxLength = 40;
    nameInput.placeholder = `Connection ${index + 1}`;
    nameInput.value = provider.name || '';

    const endpointInput = document.createElement('input');
    endpointInput.type = 'url';
    endpointInput.className = 'ai-chat-provider-endpoint';
    endpointInput.spellcheck = false;
    endpointInput.placeholder = 'https://api.example.com/v1';
    endpointInput.value = provider.endpoint || '';
    endpointInput.title = t(
      'Paste a Base URL or full request URL; the protocol is detected automatically.',
      '粘贴 Base URL 或完整请求 URL，协议会自动识别。'
    );
    const endpointWrap = document.createElement('div');
    endpointWrap.className = 'ai-provider-endpoint-wrap';
    const protocolHint = document.createElement('span');
    protocolHint.className = 'ai-provider-protocol';
    const updateProtocolHint = () => {
      const protocol = describeChatEndpoint(endpointInput.value);
      protocolHint.textContent = protocol;
      protocolHint.hidden = !protocol;
      protocolHint.title = protocol
        ? t(`Detected automatically: ${protocol}`, `已自动识别：${protocol}`)
        : '';
      if (!nameInput.value.trim()) {
        nameInput.placeholder = protocol || `Connection ${index + 1}`;
      }
    };
    endpointInput.addEventListener('input', updateProtocolHint);
    endpointWrap.append(endpointInput, protocolHint);
    updateProtocolHint();

    const modelsInput = document.createElement('input');
    modelsInput.type = 'text';
    modelsInput.className = 'ai-chat-provider-models';
    modelsInput.spellcheck = false;
    modelsInput.placeholder = 'model-a, model-b';
    modelsInput.value = Array.isArray(provider.models) ? provider.models.join(', ') : '';

    const keyInput = document.createElement('input');
    keyInput.type = 'password';
    keyInput.className = 'ai-chat-provider-key';
    keyInput.autocomplete = 'new-password';
    keyInput.placeholder = provider.hasOwnApiKey
      ? t('Saved; leave blank to keep', '已保存，留空保持不变')
      : (provider.hasApiKey ? t('Using shared fallback key', '使用共享备用密钥') : 'API key');

    row.append(defaultWrap, nameInput, endpointWrap, modelsInput, keyInput);
    slots.appendChild(row);
  });
}

function describeChatEndpoint(endpoint) {
  const value = String(endpoint || '').trim().toLowerCase();
  if (!value) return '';
  if (
    value.includes('generativelanguage.googleapis.com') ||
    /\/v1beta(?:[/?#]|$)/.test(value) ||
    /:generatecontent(?:[?#]|$)/.test(value) ||
    /:streamgeneratecontent(?:[?#]|$)/.test(value)
  ) {
    return t('Gemini native', 'Gemini 原生');
  }
  if (value.includes('api.anthropic.com') || /\/v1\/messages(?:[/?#]|$)/.test(value)) {
    return t('Claude native', 'Claude 原生');
  }
  if (/\/responses(?:[/?#]|$)/.test(value)) {
    return 'OpenAI Responses';
  }
  return t('OpenAI compatible', 'OpenAI 兼容');
}

function updateAiChatConfigHint() {
  const chatSlots = document.getElementById('ai-chat-provider-slots');
  if (chatSlots) {
    const hint = document.getElementById('ai-chat-config-hint');
    const readyState = document.getElementById('ai-chat-ready-state');
    const rows = [...chatSlots.querySelectorAll('.ai-chat-provider-slot')];
    const configured = rows.filter((row) =>
      row.querySelector('.ai-chat-provider-endpoint').value.trim() &&
      row.querySelector('.ai-chat-provider-models').value.trim()
    );
    const ready = configured.length > 0;
    hint.classList.toggle('is-ready', ready);
    readyState.textContent = ready ? t('Ready', '已就绪') : t('Not configured', '未配置');
    if (ready) {
      const protocol = describeChatEndpoint(
        configured[0].querySelector('.ai-chat-provider-endpoint').value
      );
      hint.textContent = t(
        `Detected: ${protocol} · Request path, body and authentication are handled automatically`,
        `已识别：${protocol} · 自动处理请求路径、请求体和鉴权`
      );
    } else {
      hint.textContent = t(
        'Paste a Base URL or full request URL · OpenAI / Responses / Gemini / Claude are detected automatically',
        '粘贴 Base URL 或完整请求 URL · 自动识别 OpenAI / Responses / Gemini / Claude'
      );
    }
    return;
  }
  const hint = document.getElementById('ai-chat-config-hint');
  const readyState = document.getElementById('ai-chat-ready-state');
  const endpointInput = document.getElementById('ai-chat-endpoint');
  const modelInput = document.getElementById('ai-chat-model');
  if (!hint || !readyState || !endpointInput || !modelInput) return;

  const ready = !!(endpointInput.value.trim() && modelInput.value.trim());
  hint.classList.toggle('is-ready', ready);
  readyState.textContent = ready ? t('Ready', '已就绪') : t('Not configured', '未配置');
  const protocol = describeChatEndpoint(endpointInput.value);
  hint.textContent = ready
    ? t(
      `Detected: ${protocol} · Request path, body and authentication are handled automatically`,
      `已识别：${protocol} · 自动处理请求路径、请求体和鉴权`
    )
    : t(
      'Paste a Base URL or full request URL; the protocol is detected automatically',
      '粘贴 Base URL 或完整请求 URL，软件会自动识别协议'
    );
}

function renderAccountAvatars(initial, dataUrl) {
  ['account-footer-avatar', 'account-popover-avatar'].forEach((id) => {
    const element = document.getElementById(id);
    if (!element) return;
    element.dataset.fallbackInitial = initial;
    element.replaceChildren();
    if (dataUrl) {
      const image = document.createElement('img');
      image.src = dataUrl;
      image.alt = '';
      image.draggable = false;
      element.appendChild(image);
      element.classList.add('has-image');
    } else {
      element.textContent = initial;
      element.classList.remove('has-image');
    }
  });
}

async function chooseAccountAvatar() {
  const button = document.getElementById('account-popover-avatar');
  const accountUserId = button && button.dataset.accountUserId || '';
  if (!button || !accountUserId || button.disabled || typeof window.messsAPI.chooseProfileAvatar !== 'function') return;
  const avatarLoadGeneration = ++accountAvatarLoadGeneration;
  const fallbackInitial = button.dataset.fallbackInitial || 'M';
  button.disabled = true;
  try {
    const result = await window.messsAPI.chooseProfileAvatar();
    if (avatarLoadGeneration !== accountAvatarLoadGeneration || activeAccountAvatarUserId !== accountUserId) return;
    if (!result || !result.ok) {
      if (result && !['cancelled', 'auth-required', 'account-changed'].includes(result.reason)) {
        showToast(t('Could not update the profile image.', '无法更新头像。'), 'Messs');
      }
      return;
    }
    const dataUrl = result.dataUrl || await window.messsAPI.getProfileAvatar();
    if (avatarLoadGeneration !== accountAvatarLoadGeneration || activeAccountAvatarUserId !== accountUserId) return;
    renderAccountAvatars(fallbackInitial, dataUrl);
    document.dispatchEvent(new CustomEvent('messs:profile-avatar-updated', {
      detail: { userId: accountUserId, dataUrl: dataUrl || '' }
    }));
    showToast(t('Profile image updated.', '头像已更新。'), 'Messs');
  } catch (error) {
    showToast(error && error.message ? error.message : t('Could not update the profile image.', '无法更新头像。'), 'Messs');
  } finally {
    button.disabled = !activeAccountAvatarUserId || button.dataset.accountUserId !== activeAccountAvatarUserId;
  }
}

async function renderAccountSummary(config) {
  const summaryRenderGeneration = ++accountSummaryRenderGeneration;
  const avatarLoadGeneration = ++accountAvatarLoadGeneration;
  const session = config && config.cloudSession || {};
  const email = session.user && session.user.email || '';
  const authenticated = !!session.authenticated;
  const accountUserId = authenticated && session.user && String(session.user.id || '').trim() || '';
  const previousAccountUserId = activeAccountAvatarUserId;
  activeAccountAvatarUserId = accountUserId || null;
  const fallbackName = authenticated ? (email.split('@')[0] || 'Messs user') : t('Messs user', 'Messs 用户');
  const fallbackInitial = (fallbackName.trim()[0] || 'M').toUpperCase();
  const avatarButton = document.getElementById('account-popover-avatar');
  if (avatarButton) {
    avatarButton.dataset.accountUserId = accountUserId;
    avatarButton.disabled = !accountUserId;
  }
  if (!accountUserId || previousAccountUserId !== activeAccountAvatarUserId) {
    renderAccountAvatars(fallbackInitial, null);
  }
  let membership = null;
  let avatarDataUrl = null;
  try {
    [membership, avatarDataUrl] = await Promise.all([
      window.messsAPI.getMembershipSnapshot().catch(() => null),
      accountUserId && typeof window.messsAPI.getProfileAvatar === 'function'
        ? window.messsAPI.getProfileAvatar().catch(() => null)
        : Promise.resolve(null)
    ]);
  } catch (error) {}
  if (summaryRenderGeneration !== accountSummaryRenderGeneration || activeAccountAvatarUserId !== (accountUserId || null)) return;
  accountProfileFallbackName = authenticated
    ? ((membership && membership.account && membership.account.displayName) || email.split('@')[0] || 'Messs user')
    : t('Messs user', 'Messs 用户');
  const displayName = accountProfileDisplayName || accountProfileFallbackName;
  const plan = membership && membership.plan && membership.plan.name || t('Free', '免费');
  const balance = membership && Number.isFinite(Number(membership.credits && membership.credits.balance))
    ? Number(membership.credits.balance)
    : 0;
  const initial = (displayName.trim()[0] || 'M').toUpperCase();
  if (avatarLoadGeneration === accountAvatarLoadGeneration) {
    renderAccountAvatars(initial, avatarDataUrl);
  }
  const values = {
    'account-credit-count': balance.toLocaleString(appLocale()),
    'account-plan-badge': plan
  };
  Object.entries(values).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  });
  renderAccountFooterCredits(membership);
  renderAccountProfileText();
  const google = document.getElementById('account-google-sign-in');
  const signOut = document.getElementById('account-sign-out');
  if (avatarButton) avatarButton.disabled = !accountUserId;
  if (google) google.hidden = authenticated;
  if (signOut) signOut.hidden = !authenticated;
}

function renderAccountFooterCredits(membership) {
  const credits = membership && membership.credits || {};
  const balance = Number.isFinite(Number(credits.balance)) ? Number(credits.balance) : 0;
  const reserved = Number.isFinite(Number(credits.reserved)) ? Number(credits.reserved) : 0;
  const available = Math.max(0, balance - reserved);
  const footerCredits = document.getElementById('account-footer-credits');
  if (!footerCredits) return;
  const label = t('Available points', '可用积分', '사용 가능 포인트');
  const unit = t(' points', ' 积分', ' 포인트');
  const value = available.toLocaleString(appLocale());
  footerCredits.querySelector('b').textContent = value;
  footerCredits.querySelector('small').textContent = unit;
  footerCredits.title = `${label}: ${value}`;
  footerCredits.setAttribute('aria-label', `${label}: ${value}`);
}

function renderMembershipBalance(membership) {
  if (!membership) return;
  const plan = membership.plan && membership.plan.name || t('Free', '免费');
  const balance = Number.isFinite(Number(membership.credits && membership.credits.balance))
    ? Number(membership.credits.balance)
    : 0;
  const creditCount = document.getElementById('account-credit-count');
  const planBadge = document.getElementById('account-plan-badge');
  if (creditCount) creditCount.textContent = balance.toLocaleString(appLocale());
  if (planBadge) planBadge.textContent = plan;
  renderAccountFooterCredits(membership);
}

function renderCloudSecurity(config) {
  const section = document.querySelector('.cloud-security-section');
  const state = document.getElementById('cloud-security-state');
  const signedOut = document.getElementById('cloud-account-signed-out');
  const signedIn = document.getElementById('cloud-account-signed-in');
  const user = document.getElementById('cloud-account-user');
  const note = document.getElementById('cloud-security-note');
  if (!section || !state || !signedOut || !signedIn) return;

  const configured = !!(config && config.cloudConfigured);
  const session = config && config.cloudSession || {};
  const authenticated = configured && !!session.authenticated;
  renderAccountSummary(config);
  document.querySelectorAll('.direct-ai-provider-section').forEach((item) => {
    item.hidden = configured || !(config && config.directAiAllowed);
  });
  const footer = document.getElementById('ai-provider-manager-footer');
  if (footer) footer.hidden = false;
  signedOut.hidden = authenticated;
  signedIn.hidden = !authenticated;
  section.classList.toggle('is-ready', authenticated);
  [...signedOut.querySelectorAll('input, button')].forEach((control) => {
    control.disabled = !configured;
  });
  if (!configured) {
    state.textContent = t('Build setup required', '\u9700\u8981\u5b8c\u6210\u4e0a\u7ebf\u914d\u7f6e');
    note.textContent = t(
      'AI is locked until the Railway gateway and Supabase publishable key are configured for this build.',
      '\u5f53\u524d\u7248\u672c\u5c1a\u672a\u914d\u7f6e Railway \u7f51\u5173\u548c Supabase \u53ef\u53d1\u5e03\u5bc6\u94a5\uff0cAI \u5df2\u5b89\u5168\u9501\u5b9a\u3002'
    );
  } else if (authenticated) {
    state.textContent = t('Secure gateway ready', '\u5b89\u5168\u7f51\u5173\u5df2\u5c31\u7eea');
    if (user) user.textContent = session.user && session.user.email || t('Messs account', 'Messs \u8d26\u53f7');
    note.textContent = t(
      'Provider keys stay in sealed Railway variables. Only a short-lived account token is stored encrypted on this device.',
      '\u670d\u52a1\u5546\u5bc6\u94a5\u53ea\u4fdd\u5b58\u5728 Railway \u5c01\u5b58\u53d8\u91cf\u4e2d\uff1b\u672c\u673a\u4ec5\u52a0\u5bc6\u4fdd\u5b58\u77ed\u671f\u8d26\u53f7\u4f1a\u8bdd\u3002'
    );
  } else {
    state.textContent = t('Sign in required', '\u9700\u8981\u767b\u5f55');
    note.textContent = t(
      'Sign in to obtain a short-lived Supabase session. Provider keys never leave Railway.',
      '\u767b\u5f55\u540e\u83b7\u53d6 Supabase \u77ed\u671f\u4f1a\u8bdd\uff0c\u670d\u52a1\u5546\u5bc6\u94a5\u6c38\u8fdc\u4e0d\u4f1a\u79bb\u5f00 Railway\u3002'
    );
  }
}

async function signInCloudWithGoogle(button) {
  if (!button || button.disabled) return;
  button.disabled = true;
  try {
    await window.messsAPI.signInCloudWithGoogle();
    const config = await refreshAiMediaSettings();
    document.dispatchEvent(new CustomEvent('messs:ai-config-updated', { detail: config }));
    showToast(t('Google account connected.', 'Google 账号已连接。'), 'Cloud');
  } catch (error) {
    showToast(error && error.message ? error.message : t('Google sign-in failed.', 'Google 登录失败。'), 'Cloud');
  } finally {
    button.disabled = false;
  }
}

async function signOutCloudAccount() {
  ++accountSummaryRenderGeneration;
  ++accountAvatarLoadGeneration;
  activeAccountAvatarUserId = null;
  const avatarButton = document.getElementById('account-popover-avatar');
  if (avatarButton) {
    avatarButton.dataset.accountUserId = '';
    avatarButton.disabled = true;
  }
  renderAccountAvatars('M', null);
  await window.messsAPI.signOutCloud();
  const config = await refreshAiMediaSettings();
  document.dispatchEvent(new CustomEvent('messs:ai-config-updated', { detail: config }));
  showToast(t('Signed out.', '已退出登录。'), 'Cloud');
}

async function submitCloudAccount(action) {
  const email = document.getElementById('cloud-account-email').value.trim();
  const password = document.getElementById('cloud-account-password').value;
  if (!email || password.length < 8) {
    showToast(t('Enter an email and a password of at least 8 characters.', '\u8bf7\u8f93\u5165\u90ae\u7bb1\u548c\u81f3\u5c11 8 \u4f4d\u5bc6\u7801\u3002'), 'Cloud');
    return;
  }
  const button = document.getElementById(action === 'signup' ? 'cloud-account-sign-up' : 'cloud-account-sign-in');
  button.disabled = true;
  try {
    const result = action === 'signup'
      ? await window.messsAPI.signUpCloud({ email, password })
      : await window.messsAPI.signInCloud({ email, password });
    document.getElementById('cloud-account-password').value = '';
    const config = await refreshAiMediaSettings();
    document.dispatchEvent(new CustomEvent('messs:ai-config-updated', { detail: config }));
    showToast(result.confirmationRequired
      ? t('Check your email to confirm the account.', '\u8bf7\u524d\u5f80\u90ae\u7bb1\u5b8c\u6210\u8d26\u53f7\u786e\u8ba4\u3002')
      : t('Cloud account connected.', '\u4e91\u7aef\u8d26\u53f7\u5df2\u8fde\u63a5\u3002'), 'Cloud');
  } catch (error) {
    showToast(error && error.message ? error.message : t('Could not connect the cloud account.', '\u65e0\u6cd5\u8fde\u63a5\u4e91\u7aef\u8d26\u53f7\u3002'), 'Cloud');
  } finally {
    button.disabled = false;
  }
}

async function refreshAiMediaSettings() {
  const config = await window.messsAPI.getAiMediaConfig();
  renderCloudSecurity(config);
  const allowLegacyProviderFallback = config.providerVisibilityEnforced !== true;
  renderAiProviderSlots('ai-image-provider-slots', 'image', config.imageProviders, config.activeImageProviderId, 'Nano Banana Pro', config.imageEndpoint, allowLegacyProviderFallback);
  renderAiProviderSlots('ai-video-provider-slots', 'video', config.videoProviders, config.activeVideoProviderId, config.videoProviderName || 'MiniMax H3', config.videoEndpoint, allowLegacyProviderFallback);
  if (document.getElementById('ai-chat-provider-slots')) {
    renderChatProviderSlots(config.chatProviders, config.activeChatProviderId, allowLegacyProviderFallback);
    const chatSection = document.querySelector('.ai-provider-chat-section');
    if (chatSection) {
      chatSection.hidden = true;
      chatSection.setAttribute('aria-hidden', 'true');
    }
    document.getElementById('ai-api-key').value = '';
    document.getElementById('ai-api-key').placeholder = config.hasApiKey
      ? t('Saved securely; leave blank to keep it', '已安全保存，留空则保持不变')
      : t('Shared key for image/video providers', '图片/视频服务商共享密钥');
    document.getElementById('ai-api-key-state').textContent = config.hasApiKey
      ? t('A shared media API key is saved locally.', '共享媒体 API Key 已保存在本机。')
      : t('No shared media API key saved.', '尚未保存共享媒体 API Key。');
    document.getElementById('ai-api-key-state').classList.toggle('is-ready', config.hasApiKey);
    updateAiChatConfigHint();
    updateAiProviderCount();
    return config;
  }

  const hasChatEndpoint = !!String(config.chatEndpoint || '').trim();
  document.getElementById('ai-chat-provider-name').value = hasChatEndpoint ? (config.chatProviderName || 'Messs AI') : 'Messs AI';
  document.getElementById('ai-chat-endpoint').value = hasChatEndpoint ? config.chatEndpoint : '';
  document.getElementById('ai-chat-model').value = hasChatEndpoint ? (config.chatModel || 'gpt-4o-mini') : 'gemini-2.5-pro';
  document.getElementById('ai-chat-api-key').value = '';
  document.getElementById('ai-chat-api-key').placeholder = config.hasOwnChatApiKey
    ? t('Saved securely; leave blank to keep it', '已安全保存，留空则保持不变')
    : (config.hasChatApiKey && config.chatEndpoint ? t('Using shared fallback key', '正在使用共享备用密钥') : 'sk-... or Bearer sk-...');
  document.getElementById('ai-chat-api-key').placeholder = config.hasOwnChatApiKey
    ? t('Saved securely; leave blank to keep it', '已安全保存，留空则保持不变')
    : (config.hasChatApiKey && config.chatEndpoint
      ? t('Using shared fallback key', '正在使用共享备用密钥')
      : t('Paste API key', '粘贴 API Key'));
  document.getElementById('ai-api-key').value = '';
  document.getElementById('ai-api-key').placeholder = config.hasApiKey
    ? t('Saved securely; leave blank to keep it', '已安全保存，留空则保持不变')
    : t('Shared key for image/video providers', '图片/视频服务商共享密钥');
  document.getElementById('ai-api-key-state').textContent = config.hasApiKey
    ? t('A shared media API key is saved locally.', '共享媒体 API Key 已保存到本机。')
    : t('No shared media API key saved.', '尚未保存共享媒体 API Key。');
  document.getElementById('ai-api-key-state').classList.toggle('is-ready', config.hasApiKey);
  updateAiChatConfigHint();
  updateAiProviderCount();
  return config;
}

function collectAiMediaSettings(extra = {}) {
  const collectProviders = (kind) => [...document.querySelectorAll(`.ai-provider-slot[data-provider-kind="${kind}"]`)].map((row) => ({
    id: row.dataset.providerId,
    name: row.querySelector('.ai-provider-name').value.trim(),
    endpoint: row.querySelector('.ai-provider-endpoint').value.trim(),
    apiKey: row.querySelector('.ai-provider-key').value.trim()
  }));
  const imageProviders = collectProviders('image');
  const videoProviders = collectProviders('video');
  const selected = document.querySelector('input[name="ai-default-image-provider"]:checked');
  const selectedVideo = document.querySelector('input[name="ai-default-video-provider"]:checked');
  const firstConfigured = imageProviders.find((provider) => provider.endpoint);
  const firstConfiguredVideo = videoProviders.find((provider) => provider.endpoint);
  const chatRows = [...document.querySelectorAll('#ai-chat-provider-slots .ai-chat-provider-slot')];
  if (chatRows.length) {
    const chatProviders = chatRows.map((row) => ({
      id: row.dataset.providerId,
      name: row.querySelector('.ai-chat-provider-name').value.trim(),
      endpoint: row.querySelector('.ai-chat-provider-endpoint').value.trim(),
      models: row.querySelector('.ai-chat-provider-models').value
        .split(/[\n,]+/).map((model) => model.trim()).filter(Boolean),
      apiKey: row.querySelector('.ai-chat-provider-key').value.trim()
    }));
    const selectedChat = document.querySelector('input[name="ai-default-chat-provider"]:checked');
    const firstConfiguredChat = chatProviders.find((provider) =>
      provider.endpoint && provider.models.length
    );
    return {
      imageProviders,
      activeImageProviderId: selected ? selected.value : (firstConfigured ? firstConfigured.id : 'image-1'),
      videoProviders,
      activeVideoProviderId: selectedVideo ? selectedVideo.value : (firstConfiguredVideo ? firstConfiguredVideo.id : 'video-1'),
      chatProviders,
      activeChatProviderId: selectedChat ? selectedChat.value : (firstConfiguredChat ? firstConfiguredChat.id : 'chat-1'),
      chatProviderName: firstConfiguredChat ? firstConfiguredChat.name : '',
      chatEndpoint: firstConfiguredChat ? firstConfiguredChat.endpoint : '',
      chatModel: firstConfiguredChat && firstConfiguredChat.models[0] || 'gpt-4o-mini',
      apiKey: document.getElementById('ai-api-key').value.trim(),
      ...extra
    };
  }
  return {
    imageProviders,
    activeImageProviderId: selected ? selected.value : (firstConfigured ? firstConfigured.id : 'image-1'),
    videoProviders,
    activeVideoProviderId: selectedVideo ? selectedVideo.value : (firstConfiguredVideo ? firstConfiguredVideo.id : 'video-1'),
    chatProviderName: document.getElementById('ai-chat-provider-name').value.trim(),
    chatEndpoint: document.getElementById('ai-chat-endpoint').value.trim(),
    chatModel: document.getElementById('ai-chat-model').value.trim(),
    chatApiKey: document.getElementById('ai-chat-api-key').value.trim(),
    apiKey: document.getElementById('ai-api-key').value.trim(),
    ...extra
  };
}

async function autoDiscoverChatModels() {
  const rows = [...document.querySelectorAll('#ai-chat-provider-slots .ai-chat-provider-slot')];
  const candidates = rows.filter((row) => {
    const endpoint = row.querySelector('.ai-chat-provider-endpoint').value.trim();
    const models = row.querySelector('.ai-chat-provider-models').value
      .split(/[\n,]+/).map((model) => model.trim()).filter(Boolean);
    return endpoint && (
      !models.length ||
      (models.length === 1 && ['gpt-4o-mini', 'gemini-2.5-pro'].includes(models[0]))
    );
  });
  if (!candidates.length || typeof window.messsAPI.discoverAiModels !== 'function') return;
  const hint = document.getElementById('ai-chat-config-hint');
  const originalHint = hint && hint.textContent;
  if (hint) hint.textContent = t('Detecting available models...', '正在自动识别可用模型...');
  await Promise.all(candidates.map(async (row) => {
    const sharedKey = document.getElementById('ai-api-key');
    const result = await window.messsAPI.discoverAiModels({
      endpoint: row.querySelector('.ai-chat-provider-endpoint').value.trim(),
      apiKey: row.querySelector('.ai-chat-provider-key').value.trim() ||
        (sharedKey ? sharedKey.value.trim() : ''),
      providerId: row.dataset.providerId
    });
    if (result && result.ok && result.models && result.models.length) {
      row.querySelector('.ai-chat-provider-models').value = result.models.join(', ');
    }
  }));
  if (hint && originalHint) hint.textContent = originalHint;
  updateAiProviderCount();
}

function updateAiProviderCount() {
  const configuredFor = (kind) => [...document.querySelectorAll(`.ai-provider-slot[data-provider-kind="${kind}"]`)].filter((row) =>
    row.querySelector('.ai-provider-endpoint').value.trim()
  ).length;
  const configuredImages = configuredFor('image');
  const configuredVideos = configuredFor('video');
  const chatRows = [...document.querySelectorAll('#ai-chat-provider-slots .ai-chat-provider-slot')];
  if (chatRows.length) {
    const configuredChats = chatRows.filter((row) =>
      row.querySelector('.ai-chat-provider-endpoint').value.trim() &&
      row.querySelector('.ai-chat-provider-models').value.trim()
    ).length;
    document.getElementById('ai-provider-count').textContent = `${configuredImages} / 10`;
    document.getElementById('ai-video-provider-count').textContent = `${configuredVideos} / 10`;
    document.getElementById('ai-chat-provider-count').textContent = `${configuredChats} / 10`;
    const compact = document.getElementById('ai-provider-summary');
    if (compact) compact.textContent = t(
      `${configuredChats} chat, ${configuredImages} image, ${configuredVideos} video`,
      `${configuredChats} 个对话，${configuredImages} 个图片，${configuredVideos} 个视频`
    );
    updateAiChatConfigHint();
    return;
  }
  const chatReady = !!(document.getElementById('ai-chat-endpoint').value.trim() && document.getElementById('ai-chat-model').value.trim());
  document.getElementById('ai-provider-count').textContent = `${configuredImages} / 10`;
  document.getElementById('ai-video-provider-count').textContent = `${configuredVideos} / 10`;
  const summary = t(
    `${configuredImages} image, ${configuredVideos} video, chat ${chatReady ? 'ready' : 'not set'}`,
    `${configuredImages} 个图片，${configuredVideos} 个视频，对话${chatReady ? '已配置' : '未配置'}`
  );
  const compact = document.getElementById('ai-provider-summary');
  if (compact) compact.textContent = summary;
  if (compact) {
    compact.textContent = t(
      `${configuredImages} image, ${configuredVideos} video, chat ${chatReady ? 'ready' : 'not set'}`,
      `${configuredImages} 个图片，${configuredVideos} 个视频，对话${chatReady ? '已配置' : '未配置'}`
    );
  }
}

function openAiProviderManager(view = 'general') {
  const overlay = document.getElementById('ai-provider-overlay');
  if (!overlay) return;
  if (overlay._closeTimer) {
    window.clearTimeout(overlay._closeTimer);
    overlay._closeTimer = 0;
  }
  overlay.classList.remove('is-closing');
  overlay.hidden = false;
  if (typeof setSettingsView === 'function') setSettingsView(view);
}

function closeAiProviderManager() {
  const overlay = document.getElementById('ai-provider-overlay');
  if (!overlay || overlay.hidden || overlay.classList.contains('is-closing')) return;
  overlay.classList.add('is-closing');
  overlay._closeTimer = window.setTimeout(() => {
    overlay.hidden = true;
    overlay.classList.remove('is-closing');
    overlay._closeTimer = 0;
  }, 150);
}

window.openAiProviderManager = openAiProviderManager;
window.closeAiProviderManager = closeAiProviderManager;

async function initAiMediaSettings() {
  await refreshAiMediaSettings();

  document.getElementById('ai-provider-manager-open').addEventListener('click', () => {
    document.getElementById('settings-popover').hidden = true;
    openAiProviderManager('general');
  });
  document.getElementById('ai-provider-manager-close').addEventListener('click', closeAiProviderManager);
  document.getElementById('ai-provider-overlay').addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeAiProviderManager();
  });
  document.getElementById('cloud-account-sign-in').addEventListener('click', () => submitCloudAccount('signin'));
  document.getElementById('cloud-account-sign-up').addEventListener('click', () => submitCloudAccount('signup'));
  document.getElementById('cloud-account-sign-out').addEventListener('click', signOutCloudAccount);
  document.getElementById('account-sign-out').addEventListener('click', signOutCloudAccount);
  document.getElementById('cloud-account-google').addEventListener('click', (event) => signInCloudWithGoogle(event.currentTarget));
  document.getElementById('account-google-sign-in').addEventListener('click', (event) => signInCloudWithGoogle(event.currentTarget));
  document.getElementById('account-plan-open').addEventListener('click', () => {
    showToast(t('Plans will be available before the public release.', '套餐将在正式发布前开放。'), 'Messs');
  });
  document.getElementById('account-popover-avatar').addEventListener('click', chooseAccountAvatar);
  document.addEventListener('messs:profile-avatar-updated', (event) => {
    const button = document.getElementById('account-popover-avatar');
    const accountUserId = button && button.dataset.accountUserId || '';
    const userId = event.detail && String(event.detail.userId || '').trim();
    if (!button || !accountUserId || (userId && userId !== accountUserId)) return;
    renderAccountAvatars(button.dataset.fallbackInitial || 'M', event.detail && event.detail.dataUrl || '');
  });
  document.getElementById('ai-image-provider-slots').addEventListener('input', updateAiProviderCount);
  document.getElementById('ai-video-provider-slots').addEventListener('input', updateAiProviderCount);
  document.getElementById('ai-chat-provider-slots').addEventListener('input', () => {
    updateAiProviderCount();
  });
  const legacyChatEndpoint = document.getElementById('ai-chat-endpoint');
  if (legacyChatEndpoint) legacyChatEndpoint.addEventListener('input', () => {
    updateAiChatConfigHint();
    updateAiProviderCount();
  });
  const legacyChatModel = document.getElementById('ai-chat-model');
  if (legacyChatModel) legacyChatModel.addEventListener('input', () => {
    updateAiChatConfigHint();
    updateAiProviderCount();
  });

  document.getElementById('ai-service-save').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = t('Saving...', '保存中...');
    try {
      await autoDiscoverChatModels();
      const config = await window.messsAPI.setAiMediaConfig(collectAiMediaSettings());
      await refreshAiMediaSettings();
      document.dispatchEvent(new CustomEvent('messs:ai-config-updated', { detail: config }));
      showToast(t('Settings saved', '设置已保存'), 'Messs');
      closeAiProviderManager();
    } catch (err) {
      showToast(err && err.message ? err.message : t('Could not save AI settings', '无法保存 AI 设置'), 'AI');
    } finally {
      button.disabled = false;
      button.textContent = t('Save Settings', '保存设置');
    }
  });

}

const TOOL_LABELS = {
  hasSoffice: ['LibreOffice (Word / PPT / Excel conversion)', 'LibreOffice（Word / PPT / Excel 转换）'],
  hasImageMagick: ['ImageMagick (PSD conversion)', 'ImageMagick（PSD 转换）'],
  hasSharp: ['sharp (TIFF and image metadata)', 'sharp（TIFF 与图片元数据）'],
  hasFfmpeg: ['FFmpeg (video/audio preview conversion)', 'FFmpeg（视频/音频预览转换）']
};

function renderToolStatus(caps) {
  const list = document.getElementById('tool-status-list');
  list.innerHTML = '';
  for (const [key, labelPair] of Object.entries(TOOL_LABELS)) {
    const ok = !!caps[key];
    const label = t(labelPair[0], labelPair[1]);
    const row = document.createElement('div');
    row.className = 'tool-status-row' + (ok ? ' is-ok' : ' is-missing');
    row.innerHTML = `<span class="tool-status-dot"></span><span class="tool-status-label">${label}</span><span class="tool-status-state">${ok ? t('Detected', '已检测到') : t('Missing', '缺失')}</span>`;
    list.appendChild(row);
  }
}

async function initToolStatusPanel() {
  const caps = await window.messsAPI.getPreviewToolStatus(false);
  renderToolStatus(caps);

  document.getElementById('tool-status-refresh-btn').addEventListener('click', async (e) => {
    e.stopPropagation();
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = t('Checking...', '检测中...');
    const fresh = await window.messsAPI.getPreviewToolStatus(true);
    renderToolStatus(fresh);
    btn.disabled = false;
    btn.textContent = t('Check Again', '重新检测');
  });
}
