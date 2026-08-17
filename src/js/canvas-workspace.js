'use strict';

const CanvasWorkspace = {
  agentMessages: [],
  agentBusy: false,
  agentMode: 'chat',
  agentGenerationKind: 'image',
  agentProviderId: null,
  agentReferenceFileIds: new Set(),
  agentSelectionFileIds: new Set(),
  config: null,
  libraryFilter: 'all',
  libraryProjectId: null,
  libraryQuery: ''
};

function activeCanvasRecord() {
  return AppState.canvases.find((canvas) => canvas.id === AppState.activeCanvasId) || AppState.canvases[0] || null;
}

function activeCanvasId() {
  return AppState.activeCanvasId || (AppState.canvases[0] && AppState.canvases[0].id) || 'canvas-1';
}

function canvasWorkspaceAddItem(item) {
  if (!item) return;
  item.canvasId = item.canvasId || activeCanvasId();
  if (!Array.isArray(AppState.allBoardItems)) AppState.allBoardItems = [];
  const index = AppState.allBoardItems.findIndex((entry) => entry.id === item.id);
  if (index === -1) AppState.allBoardItems.push(item);
  else AppState.allBoardItems[index] = item;
}

function canvasWorkspaceRemoveItems(ids) {
  const removed = new Set(ids || []);
  if (Array.isArray(AppState.allBoardItems)) {
    AppState.allBoardItems = AppState.allBoardItems.filter((item) => !removed.has(item.id));
  }
}

function canvasWorkspaceReplaceItem(oldId, item) {
  if (!item) return;
  item.canvasId = item.canvasId || activeCanvasId();
  const index = AppState.allBoardItems.findIndex((entry) => entry.id === oldId);
  if (index === -1) AppState.allBoardItems.push(item);
  else AppState.allBoardItems[index] = item;
}

function canvasWorkspaceTouch(canvasId = activeCanvasId()) {
  const canvas = AppState.canvases.find((entry) => entry.id === canvasId);
  if (canvas) canvas.updatedAt = new Date().toISOString();
}

async function canvasWorkspaceSave() {
  const result = await window.messsAPI.saveCanvasState({
    projects: AppState.canvasProjects,
    canvases: AppState.canvases
  });
  if (result && Array.isArray(result.projects)) AppState.canvasProjects = result.projects;
  if (result && Array.isArray(result.canvases)) AppState.canvases = result.canvases;
  return result;
}

function uniqueCanvasName(value, exceptId) {
  const base = String(value || t('Untitled', '未命名')).trim() || t('Untitled', '未命名');
  const names = new Set(
    AppState.canvases
      .filter((canvas) => canvas.id !== exceptId)
      .map((canvas) => canvas.name.toLowerCase())
  );
  if (!names.has(base.toLowerCase())) return base;
  let index = 2;
  while (names.has(`${base} ${index}`.toLowerCase())) index += 1;
  return `${base} ${index}`;
}

function relativeCanvasTime(value) {
  const time = new Date(value || 0).getTime();
  if (!Number.isFinite(time) || !time) return t('Just now', '刚刚');
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return t('Just now', '刚刚');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t(`${minutes}m ago`, `${minutes} 分钟前`);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t(`${hours}h ago`, `${hours} 小时前`);
  const days = Math.floor(hours / 24);
  if (days < 30) return t(`${days}d ago`, `${days} 天前`);
  return new Date(time).toLocaleDateString(appLocale());
}

function canvasPreviewEntries(canvasId) {
  const entries = [];
  const items = AppState.allBoardItems
    .filter((item) => (item.canvasId || AppState.canvases[0].id) === canvasId)
    .sort((a, b) => Number(b.zIndex || 0) - Number(a.zIndex || 0));

  for (const item of items) {
    if (entries.length >= 5) break;
    if (item.isDoodle && item.imageData) {
      entries.push({ kind: 'image', src: item.imageData, name: t('Drawing', '绘图') });
      continue;
    }
    const file = item.fileId && AppState.files.find((entry) => entry.id === item.fileId);
    if (!file) continue;
    if (isImageExt(file.ext)) {
      entries.push({ kind: 'image', src: file.thumbUrl || file.url, name: file.name });
    } else if (isVideoExt(file.ext)) {
      entries.push({ kind: 'video', src: file.url, name: file.name });
    }
  }
  return entries;
}

function buildCanvasMosaic(canvas) {
  const mosaic = document.createElement('div');
  mosaic.className = 'canvas-library-mosaic';
  const entries = canvasPreviewEntries(canvas.id);
  for (let index = 0; index < 5; index += 1) {
    const cell = document.createElement('div');
    cell.className = 'canvas-library-thumb';
    const entry = entries[index];
    if (!entry) {
      cell.classList.add('is-empty');
      if (index === 0) cell.textContent = t('Empty canvas', '空白画布');
    } else if (entry.kind === 'video') {
      const video = document.createElement('video');
      video.src = entry.src;
      video.muted = true;
      video.preload = 'metadata';
      video.setAttribute('aria-label', entry.name);
      cell.appendChild(video);
    } else {
      const image = document.createElement('img');
      image.src = entry.src;
      image.alt = entry.name;
      image.loading = 'lazy';
      cell.appendChild(image);
    }
    mosaic.appendChild(cell);
  }
  return mosaic;
}

function filteredCanvases() {
  const query = CanvasWorkspace.libraryQuery.trim().toLowerCase();
  const now = Date.now();
  return AppState.canvases
    .filter((canvas) => !CanvasWorkspace.libraryProjectId || canvas.projectId === CanvasWorkspace.libraryProjectId)
    .filter((canvas) => {
    if (CanvasWorkspace.libraryFilter !== 'recent') return true;
      const updated = new Date(canvas.lastOpenedAt || canvas.updatedAt || canvas.createdAt || 0).getTime();
      return now - updated <= 1000 * 60 * 60 * 24 * 30;
    })
    .filter((canvas) => !query || canvas.name.toLowerCase().includes(query))
    .sort((a, b) => new Date(b.lastOpenedAt || b.updatedAt || b.createdAt || 0) - new Date(a.lastOpenedAt || a.updatedAt || a.createdAt || 0));
}

function renderCanvasLibraryProjects() {
  const list = document.getElementById('canvas-library-projects');
  if (!list) return;
  list.innerHTML = '';
  AppState.canvasProjects.forEach((project) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.projectId = project.id;
    button.classList.toggle('is-active', CanvasWorkspace.libraryProjectId === project.id);
    const count = AppState.canvases.filter((canvas) => canvas.projectId === project.id).length;
    button.textContent = `${project.name} (${count})`;
    list.appendChild(button);
  });
}

function closeCanvasCardMenus(exceptMenu = null) {
  document.querySelectorAll('.canvas-library-card-menu').forEach((menu) => {
    if (menu === exceptMenu) return;
    menu.hidden = true;
    const card = menu.closest('.canvas-library-card');
    if (card) {
      card.classList.remove('has-open-menu');
      const trigger = card.querySelector('.canvas-library-card-menu-trigger');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    }
  });
}

function renderCanvasLibrary() {
  const grid = document.getElementById('canvas-library-grid');
  if (!grid) return;
  const canvases = filteredCanvases();
  grid.innerHTML = '';
  canvases.forEach((canvas) => {
    const project = AppState.canvasProjects.find((entry) => entry.id === canvas.projectId);
    const card = document.createElement('article');
    card.className = 'canvas-library-card';
    card.dataset.canvasId = canvas.id;
    card.tabIndex = 0;
    card.setAttribute('role', 'button');

    const title = document.createElement('div');
    title.className = 'canvas-library-card-title';
    title.textContent = canvas.name;

    const meta = document.createElement('div');
    meta.className = 'canvas-library-card-meta';
    const projectName = document.createElement('span');
    projectName.textContent = project ? project.name : t('General', '常规');
    const updated = document.createElement('span');
    updated.textContent = relativeCanvasTime(canvas.updatedAt || canvas.createdAt);
    meta.append(projectName, updated);

    const menuTrigger = document.createElement('button');
    menuTrigger.type = 'button';
    menuTrigger.className = 'canvas-library-card-menu-trigger';
    menuTrigger.title = t('Canvas actions', '画布操作');
    menuTrigger.setAttribute('aria-label', menuTrigger.title);
    menuTrigger.setAttribute('aria-haspopup', 'menu');
    menuTrigger.setAttribute('aria-expanded', 'false');
    menuTrigger.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>';

    const menu = document.createElement('div');
    menu.className = 'canvas-library-card-menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;
    const actions = [
      {
        action: 'rename',
        label: t('Rename canvas', '重命名画布'),
        icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>'
      },
      {
        action: 'export',
        label: t('Export canvas', '导出画布'),
        icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>'
      },
      {
        action: 'delete',
        label: t('Delete canvas', '删除画布'),
        danger: true,
        icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M7 7l1 13h8l1-13"/></svg>'
      }
    ];
    actions.forEach((action) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `canvas-library-card-menu-item${action.danger ? ' is-danger' : ''}`;
      button.dataset.canvasAction = action.action;
      button.setAttribute('role', 'menuitem');
      button.innerHTML = `${action.icon}<span>${escapeHtml(action.label)}</span>`;
      menu.appendChild(button);
    });

    menuTrigger.addEventListener('click', (event) => {
      event.stopPropagation();
      const willOpen = menu.hidden;
      closeCanvasCardMenus(willOpen ? menu : null);
      menu.hidden = !willOpen;
      card.classList.toggle('has-open-menu', willOpen);
      menuTrigger.setAttribute('aria-expanded', String(willOpen));
    });
    menu.addEventListener('click', (event) => {
      event.stopPropagation();
      const button = event.target.closest('[data-canvas-action]');
      if (!button) return;
      closeCanvasCardMenus();
      if (button.dataset.canvasAction === 'rename') promptRenameCanvas(canvas.id);
      if (button.dataset.canvasAction === 'export') exportCanvasFile(canvas.id);
      if (button.dataset.canvasAction === 'delete') promptDeleteCanvas(canvas.id);
    });

    card.append(title, meta, buildCanvasMosaic(canvas), menuTrigger, menu);
    card.addEventListener('click', () => switchCanvas(canvas.id, { enterWorkspace: true }));
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        switchCanvas(canvas.id, { enterWorkspace: true });
      }
    });
    grid.appendChild(card);
  });
  const empty = document.getElementById('canvas-library-empty');
  empty.hidden = canvases.length > 0;
  renderCanvasLibraryProjects();
}

function renderCanvasWorkspaceControls() {
  renderCanvasLibrary();
  renderCanvasAgentContext();
  const active = activeCanvasRecord();
  const title = document.getElementById('board-panel-title');
  const panel = document.getElementById('board-panel');
  if (title && panel && !panel.classList.contains('is-canvas-library')) {
    title.textContent = active ? active.name : t('Integrated Canvas', '整合画布');
  }
}

function showCanvasLibrary() {
  const panel = document.getElementById('board-panel');
  const library = document.getElementById('canvas-library-view');
  const workspace = document.getElementById('board-workspace-body');
  if (!panel || !library || !workspace) return;
  // Fullscreen belongs to one active canvas workspace. Clear it before the
  // workspace controls are hidden, otherwise the library traps the panel in
  // fullscreen with no visible control that can restore the compact layout.
  if (typeof exitBoardFullscreen === 'function') exitBoardFullscreen();
  else panel.classList.remove('is-fullscreen');
  panel.classList.add('is-canvas-library');
  library.hidden = false;
  workspace.hidden = true;
  document.getElementById('canvas-library-back').hidden = true;
  document.getElementById('board-bottom-bar').hidden = true;
  setCanvasAgentOpen(false);
  document.getElementById('board-panel-title').textContent = t('All Canvases', '全部画布');
  if (typeof closeAiImagePopover === 'function') closeAiImagePopover();
  renderCanvasLibrary();
}

function showCanvasWorkspace() {
  const panel = document.getElementById('board-panel');
  const library = document.getElementById('canvas-library-view');
  const workspace = document.getElementById('board-workspace-body');
  if (!panel || !library || !workspace) return;
  panel.classList.remove('is-canvas-library');
  library.hidden = true;
  workspace.hidden = false;
  document.getElementById('canvas-library-back').hidden = false;
  document.getElementById('board-bottom-bar').hidden = false;
  const active = activeCanvasRecord();
  document.getElementById('board-panel-title').textContent = active ? active.name : t('Integrated Canvas', '整合画布');
  requestAnimationFrame(() => {
    if (typeof renderBoard === 'function') renderBoard();
    if (typeof restoreBoardViewport === 'function') restoreBoardViewport(activeCanvasId());
    if (typeof resetBoardZoomTo100 === 'function') resetBoardZoomTo100();
  });
}

function switchCanvas(canvasId, options = {}) {
  const next = AppState.canvases.find((canvas) => canvas.id === canvasId);
  if (!next) return;
  if (typeof pauseAllBoardMedia === 'function') pauseAllBoardMedia();
  const panel = document.getElementById('board-panel');
  if (
    panel &&
    !panel.classList.contains('is-canvas-library') &&
    typeof flushBoardViewportSave === 'function'
  ) {
    flushBoardViewportSave();
  }
  AppState.activeCanvasId = next.id;
  AppState.boardItems = AppState.allBoardItems.filter((item) => (item.canvasId || 'canvas-1') === next.id);
  next.lastOpenedAt = new Date().toISOString();
  canvasWorkspaceSave().catch(() => {});
  if (options.enterWorkspace) showCanvasWorkspace();
  renderCanvasWorkspaceControls();
  if (typeof renderBoard === 'function') renderBoard();
  renderCanvasAgentContext();
}

function showCanvasTextDialog({ title, label, initialValue = '', projectId = null, includeProject = false }) {
  return new Promise((resolve) => {
    const old = document.getElementById('canvas-name-dialog');
    if (old) old.remove();
    const overlay = document.createElement('div');
    overlay.id = 'canvas-name-dialog';
    overlay.className = 'canvas-name-dialog-overlay';
    overlay.innerHTML = `
      <form class="canvas-name-dialog" aria-modal="true" role="dialog">
        <h3>${escapeHtml(title)}</h3>
        <label><span>${escapeHtml(label)}</span><input class="canvas-name-input" maxlength="80" /></label>
        <label class="canvas-project-field"><span>${escapeHtml(t('Project', '项目'))}</span><select class="canvas-project-input"></select></label>
        <div class="canvas-name-dialog-actions">
          <button type="button" class="pill-btn pill-btn-ghost canvas-name-cancel">${escapeHtml(t('Cancel', '取消'))}</button>
          <button type="submit" class="pill-btn canvas-name-confirm">${escapeHtml(t('Create', '创建'))}</button>
        </div>
      </form>
    `;
    document.body.appendChild(overlay);
    const form = overlay.querySelector('form');
    const input = overlay.querySelector('.canvas-name-input');
    const projectField = overlay.querySelector('.canvas-project-field');
    const projectSelect = overlay.querySelector('.canvas-project-input');
    input.value = initialValue;
    projectField.hidden = !includeProject;
    if (includeProject) {
      AppState.canvasProjects.forEach((project) => {
        const option = document.createElement('option');
        option.value = project.id;
        option.textContent = project.name;
        projectSelect.appendChild(option);
      });
      projectSelect.value = projectId || (AppState.canvasProjects[0] && AppState.canvasProjects[0].id) || '';
    }
    requestAnimationFrame(() => overlay.classList.add('is-visible'));

    function close(value) {
      overlay.classList.remove('is-visible');
      setTimeout(() => overlay.remove(), 180);
      resolve(value);
    }
    overlay.querySelector('.canvas-name-cancel').addEventListener('click', () => close(null));
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close(null);
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const value = input.value.trim();
      if (!value) {
        input.focus();
        return;
      }
      close({ name: value, projectId: projectSelect.value || projectId });
    });
    input.focus();
    input.select();
  });
}

function showCanvasConfirmDialog({ title, message, confirmLabel }) {
  return new Promise((resolve) => {
    const old = document.getElementById('canvas-confirm-dialog');
    if (old) old.remove();
    const overlay = document.createElement('div');
    overlay.id = 'canvas-confirm-dialog';
    overlay.className = 'canvas-name-dialog-overlay';
    overlay.innerHTML = `
      <section class="canvas-name-dialog canvas-confirm-dialog" aria-modal="true" role="dialog">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(message)}</p>
        <div class="canvas-name-dialog-actions">
          <button type="button" class="pill-btn pill-btn-ghost canvas-confirm-cancel">${escapeHtml(t('Cancel', '取消'))}</button>
          <button type="button" class="pill-btn canvas-confirm-submit">${escapeHtml(confirmLabel)}</button>
        </div>
      </section>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('is-visible'));

    function close(value) {
      overlay.classList.remove('is-visible');
      setTimeout(() => overlay.remove(), 180);
      resolve(value);
    }
    overlay.querySelector('.canvas-confirm-cancel').addEventListener('click', () => close(false));
    overlay.querySelector('.canvas-confirm-submit').addEventListener('click', () => close(true));
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close(false);
    });
    overlay.querySelector('.canvas-confirm-cancel').focus();
  });
}

async function createCanvasForProject(projectId, name) {
  const project = AppState.canvasProjects.find((entry) => entry.id === projectId) || AppState.canvasProjects[0];
  if (!project) return;
  const now = new Date().toISOString();
  const canvas = {
    id: `canvas-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    projectId: project.id,
    name: uniqueCanvasName(name),
    createdAt: now,
    updatedAt: now
  };
  AppState.canvases.push(canvas);
  AppState.allBoardItems.forEach((item) => { item.selected = false; });
  await canvasWorkspaceSave();
  switchCanvas(canvas.id, { enterWorkspace: true });
}

async function promptNewCanvas() {
  const active = activeCanvasRecord();
  const selectedProject = CanvasWorkspace.libraryProjectId || (active && active.projectId) ||
    (AppState.canvasProjects[0] && AppState.canvasProjects[0].id);
  const result = await showCanvasTextDialog({
    title: t('New canvas', '新建画布'),
    label: t('Canvas name', '画布名称'),
    initialValue: t('Untitled', '未命名'),
    projectId: selectedProject,
    includeProject: true
  });
  if (result) await createCanvasForProject(result.projectId, result.name);
}

async function promptNewProject() {
  const result = await showCanvasTextDialog({
    title: t('New project', '新建项目'),
    label: t('Project name', '项目名称'),
    initialValue: t('New project', '新项目')
  });
  if (!result) return;
  const project = {
    id: `project-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: result.name,
    createdAt: new Date().toISOString()
  };
  AppState.canvasProjects.push(project);
  await createCanvasForProject(project.id, t('Untitled', '未命名'));
}

async function promptRenameCanvas(canvasId = activeCanvasId()) {
  const canvas = AppState.canvases.find((entry) => entry.id === canvasId);
  if (!canvas) return;
  const result = await showCanvasTextDialog({
    title: t('Rename canvas', '重命名画布'),
    label: t('Canvas name', '画布名称'),
    initialValue: canvas.name
  });
  if (!result) return;
  canvas.name = uniqueCanvasName(result.name, canvas.id);
  canvas.updatedAt = new Date().toISOString();
  await canvasWorkspaceSave();
  renderCanvasWorkspaceControls();
}

async function exportCanvasFile(canvasId) {
  try {
    const result = await window.messsAPI.exportCanvas(canvasId);
    if (result && result.ok) {
      showToast(t('Canvas exported as one development file.', '画布已导出为单个开发文件。'), 'Canvas');
    } else if (result && !result.canceled) {
      showToast(t('Canvas export failed.', '画布导出失败。'), 'Canvas');
    }
  } catch (err) {
    showToast(err && err.message ? err.message : t('Canvas export failed.', '画布导出失败。'), 'Canvas');
  }
}

async function promptDeleteCanvas(canvasId) {
  const canvas = AppState.canvases.find((entry) => entry.id === canvasId);
  if (!canvas) return;
  if (AppState.canvases.length <= 1) {
    showToast(t('Keep at least one canvas.', '至少需要保留一个画布。'), 'Canvas');
    return;
  }
  const confirmed = await showCanvasConfirmDialog({
    title: t('Delete canvas', '删除画布'),
    message: t(
      `Delete "${canvas.name}"? Its canvas layout will be removed, while source files remain in the library.`,
      `确定删除“${canvas.name}”吗？画布排版会被移除，但源文件仍保留在资料库中。`
    ),
    confirmLabel: t('Delete', '删除')
  });
  if (!confirmed) return;

  try {
    const result = await window.messsAPI.deleteCanvas(canvasId);
    if (!result || !result.ok) {
      const message = result && result.reason === 'last-canvas'
        ? t('Keep at least one canvas.', '至少需要保留一个画布。')
        : t('Canvas deletion failed.', '画布删除失败。');
      showToast(message, 'Canvas');
      return;
    }
    AppState.canvases = result.canvases;
    AppState.canvasProjects = result.projects;
    AppState.allBoardItems = AppState.allBoardItems.filter((item) => item.canvasId !== canvasId);
    AppState.files = AppState.files.map((file) => (
      file.canvasId === canvasId ? { ...file, canvasId: result.fallbackCanvasId } : file
    ));
    if (AppState.activeCanvasId === canvasId) AppState.activeCanvasId = result.fallbackCanvasId;
    AppState.boardItems = AppState.allBoardItems.filter((item) => item.canvasId === activeCanvasId());
    if (typeof renderFileList === 'function') renderFileList(currentFileListScope());
    renderCanvasWorkspaceControls();
    if (typeof renderBoard === 'function') renderBoard();
    showToast(t('Canvas deleted. Source files were kept.', '画布已删除，源文件仍然保留。'), 'Canvas');
  } catch (err) {
    showToast(err && err.message ? err.message : t('Canvas deletion failed.', '画布删除失败。'), 'Canvas');
  }
}

function renderCanvasAgentContext() {
  const context = document.getElementById('board-agent-context');
  const active = activeCanvasRecord();
  const selected = AppState.boardItems.filter((item) => item.selected).length;
  if (!context) return;
  context.textContent = active
    ? t(`${active.name} · ${selected} selected`, `${active.name} · 已选 ${selected} 项`)
    : t('Current canvas', '当前画布');
}

function appendCanvasAgentMessage(role, text) {
  const list = document.getElementById('board-agent-messages');
  if (!list) return;
  const welcome = document.getElementById('board-agent-welcome');
  if (welcome) welcome.hidden = true;
  const row = document.createElement('div');
  row.className = `board-agent-message is-${role}`;
  row.textContent = text;
  list.appendChild(row);
  list.scrollTop = list.scrollHeight;
  return row;
}

function canvasAgentThinkingText(seconds = 0) {
  return seconds > 0
    ? t(`Thinking... ${seconds}s`, `\u601d\u8003\u4e2d... ${seconds}\u79d2`)
    : t('Thinking...', '\u601d\u8003\u4e2d...');
}

function canvasAgentAttachmentRecord(file) {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    kind: isImageExt(file.ext) ? 'image' : isVideoExt(file.ext) ? 'video' : 'file',
    dataUrl: file.thumbUrl || file.previewUrl || file.url || ''
  };
}

function appendCanvasAgentAttachments(row, files) {
  if (!row || !files.length) return;
  const strip = document.createElement('div');
  strip.className = 'board-agent-message-files';
  files.forEach((file) => {
    const attachment = canvasAgentAttachmentRecord(file);
    if (attachment.kind === 'image' && attachment.dataUrl) {
      const image = document.createElement('img');
      image.src = attachment.dataUrl;
      image.alt = attachment.name;
      strip.appendChild(image);
      return;
    }
    const card = document.createElement('div');
    card.className = 'board-agent-message-file';
    if (typeof createAssistantFileIcon === 'function') card.appendChild(createAssistantFileIcon(attachment));
    const copy = document.createElement('span');
    const name = document.createElement('b');
    name.textContent = attachment.name;
    const meta = document.createElement('small');
    meta.textContent = typeof formatAssistantFileSize === 'function'
      ? formatAssistantFileSize(attachment.sizeBytes)
      : `${attachment.sizeBytes || 0} B`;
    copy.append(name, meta);
    card.appendChild(copy);
    strip.appendChild(card);
  });
  row.appendChild(strip);
}

function setCanvasAgentOpen(open, options = {}) {
  const agent = document.getElementById('board-agent-panel');
  const board = document.getElementById('board-panel');
  const toggle = document.getElementById('board-agent-toggle');
  if (!agent || !board) return false;
  const allowed = !!open && board.classList.contains('is-fullscreen') &&
    !board.classList.contains('is-canvas-library');
  agent.classList.toggle('is-hidden', !allowed);
  if (toggle) toggle.setAttribute('aria-expanded', String(allowed));
  if (allowed) {
    renderCanvasAgentContext();
    syncCanvasAgentReferencesToSelection();
    if (options.focus) {
      requestAnimationFrame(() => document.getElementById('board-agent-input').focus());
    }
  } else {
    CanvasWorkspace.agentReferenceFileIds.clear();
    CanvasWorkspace.agentSelectionFileIds.clear();
    renderCanvasAgentReferences();
  }
  window.dispatchEvent(new Event('resize'));
  return allowed;
}

function canvasAgentPrompt(prompt) {
  const active = activeCanvasRecord();
  const selected = AppState.boardItems.filter((item) => item.selected);
  const subject = selected.length ? selected : AppState.boardItems.slice(0, 24);
  const files = subject.map((item) => {
    const file = AppState.files.find((entry) => entry.id === item.fileId);
    if (!file) return item.isNote ? 'Text note' : 'Canvas object';
    const mediaType = isVideoExt(file.ext) ? 'video' : isImageExt(file.ext) ? 'image' : 'file';
    return `${file.name} [${mediaType}] (${file.sourceWidth || '?'}x${file.sourceHeight || '?'})`;
  });
  const references = [...CanvasWorkspace.agentReferenceFileIds]
    .map((fileId) => AppState.files.find((entry) => entry.id === fileId))
    .filter(Boolean)
    .map((file) => `${file.name} [${isVideoExt(file.ext) ? 'video' : isImageExt(file.ext) ? 'image' : 'file'}]`);
  const locale = isZh()
    ? 'Reply in Simplified Chinese.'
    : (isKo() ? 'Reply in Korean.' : 'Reply in English.');
  return [
    locale,
    `Canvas: ${active ? active.name : 'Untitled'}`,
    `Selected objects: ${selected.length}`,
    `Visible objects: ${files.join('; ') || 'none'}`,
    `Attached references: ${references.join('; ') || 'none'}`,
    `User request: ${prompt}`
  ].join('\n');
}

function activeCanvasAgentProvider() {
  const config = CanvasWorkspace.config || {};
  const providers = Array.isArray(config.chatProviders) ? config.chatProviders : [];
  const provider = providers.find((entry) => entry.available !== false && entry.id === config.activeChatProviderId && entry.endpoint) ||
    providers.find((entry) => entry && entry.available !== false && entry.endpoint);
  if (!provider) return { providerId: null, model: config.chatModel || null };
  const models = Array.isArray(provider.models) ? provider.models.filter(Boolean) : [];
  return {
    providerId: provider.id,
    model: models.includes(config.chatModel) ? config.chatModel : (models[0] || config.chatModel || null)
  };
}

function canvasAgentMediaProviders(kind = CanvasWorkspace.agentGenerationKind) {
  const config = CanvasWorkspace.config || {};
  if (kind === 'video') {
    return typeof getConfiguredVideoProviders === 'function' ? getConfiguredVideoProviders(config) : [];
  }
  return typeof getConfiguredImageProviders === 'function' ? getConfiguredImageProviders(config) : [];
}

function renderCanvasAgentModels() {
  const list = document.getElementById('board-agent-model-options');
  const triggerLabel = document.getElementById('board-agent-model-label');
  const chatOption = document.getElementById('board-agent-chat-mode');
  if (!list || !triggerLabel || !chatOption) return;
  const providers = canvasAgentMediaProviders();
  if (!providers.some((provider) => provider.id === CanvasWorkspace.agentProviderId)) {
    const config = CanvasWorkspace.config || {};
    const activeId = CanvasWorkspace.agentGenerationKind === 'video'
      ? config.activeVideoProviderId
      : config.activeImageProviderId;
    CanvasWorkspace.agentProviderId = (providers.find((provider) => provider.id === activeId) || providers[0] || {}).id || null;
  }
  chatOption.classList.toggle('is-active', CanvasWorkspace.agentMode === 'chat');
  list.innerHTML = '';
  providers.forEach((provider) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `board-agent-model-option${CanvasWorkspace.agentMode === 'generate' && provider.id === CanvasWorkspace.agentProviderId ? ' is-active' : ''}`;
    button.dataset.providerId = provider.id;
    button.setAttribute('role', 'option');
    const icon = document.createElement('span');
    const badgeKind = typeof aiModelBadgeKind === 'function' ? aiModelBadgeKind(provider) : null;
    if (badgeKind && typeof createAiModelBadge === 'function') icon.appendChild(createAiModelBadge(badgeKind));
    const label = document.createElement('span');
    label.textContent = provider.name;
    const check = document.createElement('i');
    check.textContent = '✓';
    button.append(icon, label, check);
    list.appendChild(button);
  });
  const selected = providers.find((provider) => provider.id === CanvasWorkspace.agentProviderId);
  triggerLabel.textContent = CanvasWorkspace.agentMode === 'chat'
    ? 'Agent'
    : (selected ? selected.name : t('No model', '无可用模型'));
  document.querySelectorAll('[data-agent-kind]').forEach((button) => {
    const active = button.dataset.agentKind === CanvasWorkspace.agentGenerationKind;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  });
}

function canvasAgentReferenceLimit() {
  if (CanvasWorkspace.agentMode === 'chat') return 8;
  const kind = CanvasWorkspace.agentMode === 'generate' ? CanvasWorkspace.agentGenerationKind : 'image';
  const provider = canvasAgentMediaProviders(kind)
    .find((entry) => entry.id === CanvasWorkspace.agentProviderId);
  const configured = Number(provider && provider.capabilities && provider.capabilities.maxReferenceImages);
  return Number.isFinite(configured) && configured >= 0 ? Math.floor(configured) : 14;
}

function addCanvasAgentReferenceIds(fileIds) {
  renderCanvasAgentModels();
  const limit = canvasAgentReferenceLimit();
  if (limit === 0) {
    showToast(t('This model does not accept reference images.', '此模型不支持参考图。'), 'AI');
    return false;
  }
  let added = false;
  for (const fileId of fileIds) {
    const file = AppState.files.find((entry) => entry.id === fileId);
    if (!file) continue;
    if (CanvasWorkspace.agentMode === 'generate' && !isImageExt(file.ext) && !isVideoExt(file.ext)) continue;
    if (CanvasWorkspace.agentReferenceFileIds.has(fileId)) continue;
    if (CanvasWorkspace.agentReferenceFileIds.size >= limit) {
      showToast(t(`Up to ${limit} reference images can be used.`, `最多可使用 ${limit} 张参考图。`), 'AI');
      break;
    }
    CanvasWorkspace.agentReferenceFileIds.add(fileId);
    added = true;
  }
  renderCanvasAgentReferences();
  return added;
}

function syncCanvasAgentReferencesToSelection() {
  const panel = document.getElementById('board-agent-panel');
  if (!panel || panel.classList.contains('is-hidden')) return;
  const selectedIds = selectedCanvasAgentAttachmentIds();
  const selectedSet = new Set(selectedIds);
  [...CanvasWorkspace.agentSelectionFileIds].forEach((fileId) => {
    if (!selectedSet.has(fileId)) {
      CanvasWorkspace.agentSelectionFileIds.delete(fileId);
      CanvasWorkspace.agentReferenceFileIds.delete(fileId);
    }
  });
  addCanvasAgentReferenceIds(selectedIds);
  selectedIds.forEach((fileId) => CanvasWorkspace.agentSelectionFileIds.add(fileId));
  renderCanvasAgentReferences();
  if (typeof syncAiComposerReferenceClasses === 'function') syncAiComposerReferenceClasses();
}

function renderCanvasAgentReferences() {
  const strip = document.getElementById('board-agent-references');
  if (!strip) return;
  [...CanvasWorkspace.agentReferenceFileIds].forEach((fileId) => {
    const file = AppState.files.find((entry) => entry.id === fileId);
    if (!file || (CanvasWorkspace.agentMode === 'generate' && !isImageExt(file.ext) && !isVideoExt(file.ext))) {
      CanvasWorkspace.agentReferenceFileIds.delete(fileId);
      CanvasWorkspace.agentSelectionFileIds.delete(fileId);
    }
  });
  strip.innerHTML = '';
  CanvasWorkspace.agentReferenceFileIds.forEach((fileId) => {
    const file = AppState.files.find((entry) => entry.id === fileId);
    if (!file) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'board-agent-reference';
    button.title = t(`Remove ${file.name}`, `移除 ${file.name}`);
    const isVideo = isVideoExt(file.ext);
    const isImage = isImageExt(file.ext);
    let preview;
    if (isImage || isVideo) {
      preview = isVideo ? document.createElement('video') : document.createElement('img');
      preview.src = isVideo
        ? (file.url || file.previewUrl || file.thumbUrl)
        : (file.thumbUrl || file.previewUrl || file.url);
      preview.alt = file.name;
      if (preview.tagName === 'VIDEO') {
        preview.muted = true;
        preview.playsInline = true;
        preview.preload = 'metadata';
        preview.setAttribute('aria-label', file.name);
      }
    } else if (typeof createAssistantFileIcon === 'function') {
      preview = createAssistantFileIcon(canvasAgentAttachmentRecord(file));
    } else {
      preview = document.createElement('span');
      preview.className = 'board-agent-file-fallback';
      preview.textContent = 'FILE';
    }
    const remove = document.createElement('span');
    remove.textContent = '×';
    button.append(preview, remove);
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      CanvasWorkspace.agentReferenceFileIds.delete(fileId);
      CanvasWorkspace.agentSelectionFileIds.delete(fileId);
      AppState.boardItems.forEach((item) => {
        if (item.fileId === fileId) item.selected = false;
      });
      renderCanvasAgentReferences();
      if (typeof syncBoardSelectionClasses === 'function') syncBoardSelectionClasses();
      if (typeof syncAiComposerReferenceClasses === 'function') syncAiComposerReferenceClasses();
      renderCanvasAgentContext();
    });
    strip.appendChild(button);
  });
  strip.hidden = CanvasWorkspace.agentReferenceFileIds.size === 0;
}

function selectedCanvasAgentImageIds() {
  return selectedCanvasAgentMediaIds();
}

function selectedCanvasAgentAttachmentIds() {
  return CanvasWorkspace.agentMode === 'chat'
    ? AppState.boardItems.filter((item) => item.selected && item.fileId).map((item) => item.fileId)
    : selectedCanvasAgentMediaIds();
}

function selectedCanvasAgentMediaIds() {
  const filesById = new Map(AppState.files.map((file) => [file.id, file]));
  return AppState.boardItems
    .filter((item) => item.selected && item.fileId)
    .map((item) => filesById.get(item.fileId))
    .filter((file) => file && (isImageExt(file.ext) || isVideoExt(file.ext)))
    .map((file) => file.id);
}

function addSelectedImagesToCanvasAgent() {
  const ids = selectedCanvasAgentAttachmentIds();
  if (!ids.length) {
    void uploadCanvasAgentAttachments();
    return true;
  }
  const added = addCanvasAgentReferenceIds(ids);
  ids.forEach((fileId) => CanvasWorkspace.agentSelectionFileIds.add(fileId));
  return added;
}

async function uploadCanvasAgentAttachments() {
  if (typeof window.messsAPI.pickFiles !== 'function') return false;
  const paths = await window.messsAPI.pickFiles();
  if (!paths || !paths.length) return false;
  const result = await window.messsAPI.importFiles(paths, AppState.activeFolderId, activeCanvasId());
  const imported = result && Array.isArray(result.imported) ? result.imported : [];
  if (!imported.length) {
    showToast(t('The files could not be uploaded.', '文件上传失败。'), 'AI');
    return false;
  }
  AppState.files = [...imported, ...AppState.files.filter((file) =>
    !imported.some((next) => next.id === file.id)
  )];
  if (typeof renderFileList === 'function') renderFileList(currentFileListScope());
  if (typeof renderFolderGridIfActive === 'function') renderFolderGridIfActive();
  const accepted = CanvasWorkspace.agentMode === 'chat'
    ? imported
    : imported.filter((file) => isImageExt(file.ext) || isVideoExt(file.ext));
  const added = addCanvasAgentReferenceIds(accepted.map((file) => file.id));
  if (accepted.length < imported.length) {
    showToast(t('Generation mode only accepts image or video references.', '生成模式只接受图片或视频参考。'), 'AI');
  }
  return added;
}

function addCanvasAgentReference(fileId) {
  const file = AppState.files.find((entry) => entry.id === fileId);
  if (!file || (!isImageExt(file.ext) && !isVideoExt(file.ext))) return false;
  CanvasWorkspace.agentMode = 'generate';
  CanvasWorkspace.agentGenerationKind = 'image';
  return addCanvasAgentReferenceIds([file.id]);
}

async function submitCanvasAgentGeneration(prompt) {
  const providers = canvasAgentMediaProviders();
  const provider = providers.find((entry) => entry.id === CanvasWorkspace.agentProviderId) || providers[0];
  if (!provider || typeof generateAiMediaForBoardV3 !== 'function') {
    showToast(t('No generation model is available.', '没有可用的生成模型。'), 'AI');
    return;
  }
  const config = CanvasWorkspace.config || {};
  const kind = CanvasWorkspace.agentGenerationKind;
  const referenceLimit = kind === 'image'
    ? canvasAgentReferenceLimit()
    : (() => {
      const configured = Number(provider.capabilities && provider.capabilities.maxReferenceImages);
      return Number.isFinite(configured) && configured >= 0 ? Math.floor(configured) : 2;
    })();
  const referenceIds = [...CanvasWorkspace.agentReferenceFileIds].slice(0, referenceLimit);
  const references = typeof generatedReferenceData === 'function'
    ? await generatedReferenceData(referenceIds)
    : { urls: [], referenceFileIds: [] };
  const sourceFile = references.referenceFileIds.length
    ? AppState.files.find((entry) => entry.id === references.referenceFileIds[0])
    : null;
  const original = sourceFile && typeof sourceImageGenerationOptionsForFile === 'function'
    ? sourceImageGenerationOptionsForFile(sourceFile)
    : { aspectRatio: kind === 'video' ? '16:9' : '1:1', sourceWidth: null, sourceHeight: null };
  const capabilities = provider.capabilities || {};
  const resolution = kind === 'video'
    ? supportedVideoResolution(null, capabilities)
    : supportedImageSizeForRatio(config.imageSize, original.aspectRatio, capabilities, references.referenceFileIds.length);
  const imageRatio = kind === 'image'
    ? (imageRatioForSize(resolution, capabilities)
      || supportedImageAspectRatio(original.aspectRatio, capabilities, references.referenceFileIds.length > 0))
    : undefined;
  await generateAiMediaForBoardV3({
    kind,
    prompt,
    size: resolution,
    resolution: kind === 'video' ? resolution : undefined,
    count: 1,
    duration: kind === 'video' ? supportedVideoDuration(config.videoDuration, capabilities) : Number(config.videoDuration) || 6,
    aspectRatio: kind === 'video'
      ? supportedVideoAspectRatio(original.aspectRatio, capabilities, references.referenceFileIds.length > 0)
      : imageRatio,
    sourceWidth: original.sourceWidth,
    sourceHeight: original.sourceHeight,
    imageProviderId: kind === 'image' ? provider.id : null,
    videoProviderId: kind === 'video' ? provider.id : null,
    modelName: provider.name,
    referenceFileIds: references.referenceFileIds,
    urls: references.urls
  });
}

async function submitCanvasAgentMessage() {
  if (CanvasWorkspace.agentBusy) return;
  const input = document.getElementById('board-agent-input');
  let prompt = input.value.trim();
  const referenceFiles = [...CanvasWorkspace.agentReferenceFileIds]
    .map((fileId) => AppState.files.find((entry) => entry.id === fileId))
    .filter(Boolean);
  if (!prompt && !referenceFiles.length) return;
  if (!prompt) prompt = t('Analyze the attached files.', '请分析这些附件。');
  if (CanvasWorkspace.agentMode === 'generate') {
    input.value = '';
    input.disabled = true;
    document.getElementById('board-agent-submit').disabled = true;
    try {
      await submitCanvasAgentGeneration(prompt);
    } finally {
      input.disabled = false;
      document.getElementById('board-agent-submit').disabled = false;
      input.focus();
    }
    return;
  }
  const selected = activeCanvasAgentProvider();
  input.value = '';
  const userRow = appendCanvasAgentMessage('user', prompt);
  appendCanvasAgentAttachments(userRow, referenceFiles);
  const contextualPrompt = canvasAgentPrompt(prompt);
  CanvasWorkspace.agentMessages.push({
    role: 'user',
    content: contextualPrompt,
    attachmentFileIds: referenceFiles.map((file) => file.id),
    attachments: referenceFiles.map(canvasAgentAttachmentRecord)
  });
  CanvasWorkspace.agentBusy = true;
  input.disabled = true;
  document.getElementById('board-agent-submit').disabled = true;
  const pending = appendCanvasAgentMessage('assistant', canvasAgentThinkingText());
  pending.classList.add('is-pending');
  const thinkingStartedAt = Date.now();
  const thinkingTimer = window.setInterval(() => {
    if (!pending.isConnected) return;
    const seconds = Math.max(1, Math.floor((Date.now() - thinkingStartedAt) / 1000));
    pending.textContent = canvasAgentThinkingText(seconds);
  }, 1000);
  try {
    const response = await window.messsAPI.chatWithAi({
      prompt: contextualPrompt,
      messages: CanvasWorkspace.agentMessages,
      attachmentFileIds: referenceFiles.map((file) => file.id),
      chatProviderId: selected.providerId,
      chatModel: selected.model
    });
    if (!response || !response.ok) {
      throw new Error((response && response.message) || t('Canvas Agent request failed.', '画布 Agent 请求失败。'));
    }
    CanvasWorkspace.agentMessages.push({ role: 'assistant', content: response.text });
    pending.classList.remove('is-pending');
    pending.textContent = response.text;
    if (typeof appendAssistantOutputFiles === 'function') appendAssistantOutputFiles(pending, response.files);
  } catch (err) {
    pending.remove();
    appendCanvasAgentMessage('error', err && err.message ? err.message : t('Canvas Agent request failed.', '画布 Agent 请求失败。'));
  } finally {
    window.clearInterval(thinkingTimer);
    CanvasWorkspace.agentBusy = false;
    input.disabled = false;
    document.getElementById('board-agent-submit').disabled = false;
    input.focus();
  }
}

function readCanvasAgentClipboardFile(file) {
  return new Promise((resolve) => {
    if (!file || !/^image\//i.test(file.type || '') || Number(file.size) > 64 * 1024 * 1024) {
      resolve('');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}

async function importCanvasAgentPastedMedia(file, event) {
  if (!file) return false;
  const isImage = /^image\//i.test(file.type || '');
  let importedFile = null;
  if (isImage) {
    const dataUrl = await readCanvasAgentClipboardFile(file);
    if (!dataUrl) return false;
    const result = await window.messsAPI.importClipboardImage({
      canvasId: activeCanvasId(),
      folderId: AppState.activeFolderId,
      dataUrl,
      html: '',
      text: ''
    });
    importedFile = result && result.ok ? result.file : null;
  } else {
    let filePath = null;
    try { filePath = window.messsAPI.getPathForFile(file); } catch (error) {}
    if (!filePath || typeof window.messsAPI.importFiles !== 'function') return false;
    const result = await window.messsAPI.importFiles([filePath], AppState.activeFolderId, activeCanvasId());
    importedFile = result && Array.isArray(result.imported) ? result.imported[0] : null;
  }
  if (!importedFile) return false;
  AppState.files = [importedFile, ...AppState.files.filter((entry) => entry.id !== importedFile.id)];
  if (typeof renderFileList === 'function') renderFileList(currentFileListScope());
  if (typeof renderFolderGridIfActive === 'function') renderFolderGridIfActive();
  addCanvasAgentReferenceIds([importedFile.id]);
  renderCanvasAgentContext();
  return true;
}

function handleCanvasAgentPaste(event) {
  const transfer = event && event.clipboardData;
  const files = transfer ? [...(transfer.files || [])] : [];
  if (!files.length) return;
  event.preventDefault();
  event.stopPropagation();
  void (async () => {
    for (const file of files.slice(0, canvasAgentReferenceLimit())) {
      await importCanvasAgentPastedMedia(file, event);
    }
  })().catch((error) => {
    showToast(error && error.message ? error.message : t('Could not add the pasted files.', '无法添加粘贴的文件。'), 'AI');
  });
}

function refreshCanvasWorkspaceLanguage() {
  const setText = (selector, en, zh) => {
    const element = document.querySelector(selector);
    if (element) element.textContent = t(en, zh);
  };
  setText('#canvas-new span', 'New canvas', '新建画布');
  setText('#canvas-project-new span', 'New project', '新建项目');
  setText('[data-canvas-filter="all"]', 'All canvases', '全部画布');
  setText('[data-canvas-filter="recent"]', 'Recent', '最近使用');
  setText('.canvas-library-project-label', 'Projects', '项目');
  setText('.canvas-library-topline h2', 'All Canvases', '全部画布');
  setText('.canvas-library-topline p', 'Browse and manage your canvases', '浏览和管理你的画布');
  setText('#canvas-library-empty', 'No canvases found', '没有找到画布');
  const search = document.getElementById('canvas-library-search');
  if (search) search.placeholder = t('Search canvases...', '搜索画布...');
  const panel = document.getElementById('board-panel');
  if (panel && panel.classList.contains('is-canvas-library')) {
    document.getElementById('board-panel-title').textContent = t('All Canvases', '全部画布');
  }
  const agentTitle = document.querySelector('.board-agent-welcome strong');
  const toggle = document.getElementById('board-agent-toggle');
  if (agentTitle) agentTitle.textContent = 'Messs Agent';
  const agentSubtitle = document.querySelector('.board-agent-welcome span');
  if (agentSubtitle) agentSubtitle.textContent = t('Solve your problem.', '解决你的问题。');
  const input = document.getElementById('board-agent-input');
  if (toggle) toggle.textContent = 'Messs Agent';
  if (input) input.placeholder = t('Ask about this canvas...', '询问这个画布...');
  const send = document.getElementById('board-agent-submit');
  if (send) {
    send.title = t('Send', '发送');
    send.setAttribute('aria-label', send.title);
  }
  renderCanvasAgentContext();
  renderCanvasLibrary();
}

async function initCanvasWorkspace(initial) {
  AppState.canvasProjects = Array.isArray(initial.canvasProjects) && initial.canvasProjects.length
    ? initial.canvasProjects
    : [{ id: 'project-1', name: 'General', createdAt: new Date().toISOString() }];
  AppState.canvases = Array.isArray(initial.canvases) && initial.canvases.length
    ? initial.canvases
    : [{
      id: 'canvas-1',
      projectId: AppState.canvasProjects[0].id,
      name: 'Untitled',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }];
  AppState.allBoardItems = (initial.boardItems || []).map((item) => ({
    ...item,
    canvasId: item.canvasId || AppState.canvases[0].id
  }));
  // Restore the canvas the user was working in. Generated media is stored
  // against that canvas, so always opening canvas-1 makes valid results look
  // like they disappeared after restarting the app.
  const lastOpenedCanvas = AppState.canvases
    .filter((canvas) => canvas && canvas.lastOpenedAt)
    .sort((a, b) => new Date(b.lastOpenedAt) - new Date(a.lastOpenedAt))[0];
  AppState.activeCanvasId = (lastOpenedCanvas || AppState.canvases[0]).id;
  AppState.boardItems = AppState.allBoardItems.filter((item) => item.canvasId === AppState.activeCanvasId);

  document.getElementById('canvas-new').addEventListener('click', promptNewCanvas);
  document.getElementById('canvas-header-new').addEventListener('click', promptNewCanvas);
  document.getElementById('canvas-project-new').addEventListener('click', promptNewProject);
  document.getElementById('canvas-library-back').addEventListener('click', showCanvasLibrary);
  document.getElementById('canvas-library-search').addEventListener('input', (event) => {
    CanvasWorkspace.libraryQuery = event.target.value;
    renderCanvasLibrary();
  });
  document.querySelector('.canvas-library-nav').addEventListener('click', (event) => {
    const button = event.target.closest('[data-canvas-filter]');
    if (!button) return;
    CanvasWorkspace.libraryFilter = button.dataset.canvasFilter;
    CanvasWorkspace.libraryProjectId = null;
    document.querySelectorAll('[data-canvas-filter]').forEach((entry) => {
      entry.classList.toggle('is-active', entry === button);
    });
    renderCanvasLibrary();
  });
  document.getElementById('canvas-library-projects').addEventListener('click', (event) => {
    const button = event.target.closest('[data-project-id]');
    if (!button) return;
    CanvasWorkspace.libraryProjectId = CanvasWorkspace.libraryProjectId === button.dataset.projectId
      ? null
      : button.dataset.projectId;
    CanvasWorkspace.libraryFilter = 'all';
    document.querySelectorAll('[data-canvas-filter]').forEach((entry) => {
      entry.classList.toggle('is-active', entry.dataset.canvasFilter === 'all' && !CanvasWorkspace.libraryProjectId);
    });
    renderCanvasLibrary();
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.canvas-library-card-menu, .canvas-library-card-menu-trigger')) {
      closeCanvasCardMenus();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeCanvasCardMenus();
  });

  document.getElementById('board-agent-toggle').addEventListener('click', () => {
    const agent = document.getElementById('board-agent-panel');
    setCanvasAgentOpen(agent.classList.contains('is-hidden'), { focus: true });
  });
  document.getElementById('board-agent-close').addEventListener('click', () => {
    setCanvasAgentOpen(false);
  });
  const modelTrigger = document.getElementById('board-agent-model-trigger');
  const modelMenu = document.getElementById('board-agent-model-menu');
  modelTrigger.addEventListener('click', () => {
    modelMenu.hidden = !modelMenu.hidden;
    modelTrigger.setAttribute('aria-expanded', String(!modelMenu.hidden));
    if (!modelMenu.hidden) renderCanvasAgentModels();
  });
  document.getElementById('board-agent-chat-mode').addEventListener('click', () => {
    CanvasWorkspace.agentMode = 'chat';
    renderCanvasAgentModels();
    renderCanvasAgentReferences();
    modelMenu.hidden = true;
    modelTrigger.setAttribute('aria-expanded', 'false');
  });
  document.querySelector('.board-agent-kind-switch').addEventListener('click', (event) => {
    const button = event.target.closest('[data-agent-kind]');
    if (!button) return;
    CanvasWorkspace.agentGenerationKind = button.dataset.agentKind === 'video' ? 'video' : 'image';
    CanvasWorkspace.agentMode = 'generate';
    CanvasWorkspace.agentProviderId = null;
    renderCanvasAgentModels();
    renderCanvasAgentReferences();
  });
  document.getElementById('board-agent-model-options').addEventListener('click', (event) => {
    const option = event.target.closest('[data-provider-id]');
    if (!option) return;
    CanvasWorkspace.agentMode = 'generate';
    CanvasWorkspace.agentProviderId = option.dataset.providerId;
    renderCanvasAgentModels();
    renderCanvasAgentReferences();
    modelMenu.hidden = true;
    modelTrigger.setAttribute('aria-expanded', 'false');
  });
  document.getElementById('board-agent-add-reference').addEventListener('click', addSelectedImagesToCanvasAgent);
  document.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('.board-agent-model-picker')) {
      modelMenu.hidden = true;
      modelTrigger.setAttribute('aria-expanded', 'false');
    }
  }, true);
  document.getElementById('board-agent-form').addEventListener('submit', (event) => {
    event.preventDefault();
    submitCanvasAgentMessage();
  });
  document.getElementById('board-agent-panel').addEventListener('contextmenu', showAgentTextContextMenu);
  document.getElementById('board-agent-input').addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && ['a', 'c', 'v', 'x'].includes(event.key.toLowerCase())) {
      event.stopPropagation();
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      document.getElementById('board-agent-form').requestSubmit();
    }
  });
  document.getElementById('board-agent-input').addEventListener('copy', (event) => event.stopPropagation());
  document.getElementById('board-agent-input').addEventListener('cut', (event) => event.stopPropagation());
  document.getElementById('board-agent-input').addEventListener('paste', handleCanvasAgentPaste);
  const agentForm = document.getElementById('board-agent-form');
  agentForm.addEventListener('dragover', (event) => {
    if (![...(event.dataTransfer && event.dataTransfer.items || [])].some((item) => item.kind === 'file')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    agentForm.classList.add('is-file-dragover');
  });
  agentForm.addEventListener('dragleave', () => agentForm.classList.remove('is-file-dragover'));
  agentForm.addEventListener('drop', (event) => {
    agentForm.classList.remove('is-file-dragover');
    const files = [...(event.dataTransfer && event.dataTransfer.files || [])];
    if (!files.length) return;
    event.preventDefault();
    void (async () => {
      for (const file of files.slice(0, canvasAgentReferenceLimit())) {
        await importCanvasAgentPastedMedia(file, event);
      }
    })().catch((error) => {
      showToast(error && error.message ? error.message : t('Could not add the dropped files.', '无法添加拖入的文件。'), 'AI');
    });
  });
  document.addEventListener('messs:ai-config-updated', (event) => {
    CanvasWorkspace.config = event.detail || CanvasWorkspace.config;
    renderCanvasAgentModels();
  });
  try {
    CanvasWorkspace.config = await window.messsAPI.getAiMediaConfig();
  } catch (err) {
    CanvasWorkspace.config = null;
  }
  renderCanvasAgentModels();
  renderCanvasAgentReferences();
  showCanvasLibrary();
  refreshCanvasWorkspaceLanguage();
}
