'use strict';

const CanvasWorkspace = {
  agentMessages: [],
  agentSessions: [],
  activeAgentSessionId: null,
  agentHistoryFavoritesOnly: false,
  agentHistoryDate: '',
  agentHistoryLoaded: false,
  agentBusy: false,
  agentMode: 'chat',
  agentGenerationKind: 'image',
  agentProviderId: null,
  agentChatProviderId: null,
  agentChatModel: null,
  agentReferenceFileIds: new Set(),
  agentSelectionFileIds: new Set(),
  config: null,
  libraryFilter: 'all',
  libraryScope: 'personal',
  libraryProjectId: null,
  libraryQuery: '',
  boardItemIndex: new Map(),
  boardItemIndexRef: null,
  boardItemIndexCount: -1,
  detachedCanvasId: String(new URLSearchParams(window.location.search).get('detachedCanvas') || '').trim(),
  detachInFlight: false
};

function isDetachedCanvasWindow() {
  return !!CanvasWorkspace.detachedCanvasId;
}

async function openActiveCanvasInDetachedWindow(launchPoint = {}) {
  if (isDetachedCanvasWindow() || CanvasWorkspace.detachInFlight) return { ok: true, reused: true };
  const canvas = activeCanvasRecord();
  if (!canvas || !window.messsAPI || typeof window.messsAPI.openDetachedCanvas !== 'function') {
    return { ok: false, reason: 'unavailable' };
  }
  CanvasWorkspace.detachInFlight = true;
  const button = document.getElementById('board-detach-window');
  if (button) button.disabled = true;
  try {
    if (typeof flushBoardViewportSave === 'function') flushBoardViewportSave();
    await canvasWorkspaceSave();
    const result = await window.messsAPI.openDetachedCanvas(canvas.id, {
      x: Number.isFinite(Number(launchPoint.x)) ? Number(launchPoint.x) : undefined,
      y: Number.isFinite(Number(launchPoint.y)) ? Number(launchPoint.y) : undefined
    });
    if (!result || result.ok !== true) {
      showToast(t('Could not open the separate canvas window.', '无法打开独立画布窗口。'));
    }
    return result || { ok: false, reason: 'unknown' };
  } catch (error) {
    showToast(t('Could not open the separate canvas window.', '无法打开独立画布窗口。'));
    return { ok: false, reason: error && error.message || 'open-failed' };
  } finally {
    CanvasWorkspace.detachInFlight = false;
    if (button) button.disabled = false;
  }
}

function returnMainWindowToCanvasLibrary() {
  if (isDetachedCanvasWindow()) return;
  const panel = document.getElementById('board-panel');
  if (!panel || panel.classList.contains('is-canvas-library')) return;
  showCanvasLibrary();
}

function applyRemoteCanvasItemsChange(payload = {}) {
  const canvasId = String(payload.canvasId || '').trim();
  if (!canvasId) return;
  const removedIds = new Set(Array.isArray(payload.remove) ? payload.remove.filter(Boolean) : []);
  if (removedIds.size) {
    AppState.allBoardItems = AppState.allBoardItems.filter((item) => !removedIds.has(item.id));
    invalidateCanvasWorkspaceItemIndex();
  }
  for (const item of Array.isArray(payload.upsert) ? payload.upsert : []) {
    if (!item || !item.id) continue;
    upsertCanvasWorkspaceItem(item, canvasId);
  }
  for (const file of Array.isArray(payload.files) ? payload.files : []) {
    if (!file || !file.id) continue;
    const index = AppState.files.findIndex((entry) => entry.id === file.id);
    if (index === -1) AppState.files.push(file);
    else AppState.files[index] = file;
  }
  if (canvasId !== activeCanvasId()) return;
  AppState.boardItems = AppState.allBoardItems.filter((item) => (item.canvasId || 'canvas-1') === canvasId);
  if (typeof renderBoard === 'function') renderBoard();
  if (typeof renderFileList === 'function' && typeof currentFileListScope === 'function') {
    renderFileList(currentFileListScope());
  }
}

function applyRemoteCanvasStateChange(payload = {}) {
  if (Array.isArray(payload.projects) && payload.projects.length) {
    AppState.canvasProjects = payload.projects.map(normalizeCanvasProject).filter(Boolean);
  }
  if (Array.isArray(payload.canvases) && payload.canvases.length) {
    AppState.canvases = payload.canvases;
  }
  if (isDetachedCanvasWindow() && !AppState.canvases.some((canvas) => canvas.id === CanvasWorkspace.detachedCanvasId)) {
    window.messsAPI.closeWindow();
    return;
  }
  const active = activeCanvasRecord();
  const title = document.getElementById('board-panel-title');
  if (title && active) title.textContent = active.name;
  if (isDetachedCanvasWindow() && active) document.title = `${active.name} - Messs.`;
  if (document.getElementById('board-panel').classList.contains('is-canvas-library')) renderCanvasLibrary();
}

function normalizeCanvasProjectScope(value) {
  return String(value || '').trim().toLowerCase() === 'team' ? 'team' : 'personal';
}

function normalizeCanvasProject(project, index = 0) {
  if (!project || typeof project !== 'object') return null;
  return {
    ...project,
    id: String(project.id || `project-${index + 1}`),
    name: String(project.name || t('General', '常规', '일반')).trim().slice(0, 80) || t('General', '常规', '일반'),
    scope: normalizeCanvasProjectScope(project.scope),
    createdAt: project.createdAt || new Date().toISOString()
  };
}

function canvasProjectScope(project) {
  return normalizeCanvasProjectScope(project && project.scope);
}

function canvasProjectsForScope(scope = CanvasWorkspace.libraryScope) {
  const targetScope = normalizeCanvasProjectScope(scope);
  return AppState.canvasProjects.filter((project) => canvasProjectScope(project) === targetScope);
}

function canvasLibraryScopeLabel(scope = CanvasWorkspace.libraryScope) {
  return normalizeCanvasProjectScope(scope) === 'team'
    ? t('Team projects', '团队项目', '팀 프로젝트')
    : t('Independent projects', '独立项目', '독립 프로젝트');
}

function canvasLibraryScopeDescription(scope = CanvasWorkspace.libraryScope) {
  return normalizeCanvasProjectScope(scope) === 'team'
    ? t('Browse and manage your team projects', '浏览和管理你的团队项目', '팀 프로젝트를 둘러보고 관리하세요')
    : t('Browse and manage your independent projects', '浏览和管理你的独立项目', '독립 프로젝트를 둘러보고 관리하세요');
}

function appendCanvasProjectOptions(select, projects, selectedId = null) {
  const groups = ['personal', 'team'];
  groups.forEach((scope) => {
    const scopedProjects = projects.filter((project) => canvasProjectScope(project) === scope);
    if (!scopedProjects.length) return;
    const group = document.createElement('optgroup');
    group.label = canvasLibraryScopeLabel(scope);
    scopedProjects.forEach((project) => {
      const option = document.createElement('option');
      option.value = project.id;
      option.textContent = project.name;
      option.selected = project.id === selectedId;
      group.appendChild(option);
    });
    select.appendChild(group);
  });
}

const CANVAS_AGENT_HISTORY_KEY = 'messs.canvas-agent-history.v1';
const CANVAS_AGENT_HISTORY_LIMIT = 100;

function canvasAgentHistoryDate(value) {
  const date = new Date(value || 0);
  if (!Number.isFinite(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeCanvasAgentSession(session, fallbackCanvasId = null) {
  if (!session || !session.id) return null;
  const messages = Array.isArray(session.messages) ? session.messages.slice(-100).map((message) => ({
    role: message && message.role === 'assistant' ? 'assistant' : 'user',
    content: String(message && message.content || '').slice(0, 16000),
    displayContent: String(message && ((message.displayContent ?? message.content) || '')).slice(0, 12000),
    attachmentFileIds: Array.isArray(message && message.attachmentFileIds)
      ? [...new Set(message.attachmentFileIds.filter(Boolean))].slice(0, 50)
      : [],
    attachments: Array.isArray(message && message.attachments) ? message.attachments.slice(0, 50).map((file) => ({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      kind: file.kind
    })) : []
  })).filter((message) => message.content || message.displayContent) : [];
  return {
    id: String(session.id).slice(0, 120),
    title: String(session.title || t('New conversation', '\u65b0\u5bf9\u8bdd')).slice(0, 120),
    canvasId: String(session.canvasId || fallbackCanvasId || '').slice(0, 120) || null,
    createdAt: session.createdAt || new Date().toISOString(),
    updatedAt: session.updatedAt || session.createdAt || new Date().toISOString(),
    favorite: session.favorite === true || session.pinned === true,
    messages
  };
}

function normalizedCanvasAgentSessions(value, fallbackCanvasId = null) {
  return (Array.isArray(value) ? value : [])
    .map((session) => normalizeCanvasAgentSession(session, fallbackCanvasId))
    .filter(Boolean)
    .slice(0, CANVAS_AGENT_HISTORY_LIMIT);
}

function canvasAgentSessionCanvasId(session, fallbackCanvasId = activeCanvasId()) {
  return String(session && session.canvasId || fallbackCanvasId || '').trim();
}

function migrateLegacyCanvasAgentSessions(sessions, canvasId = activeCanvasId()) {
  const fallbackCanvasId = String(canvasId || '').trim();
  if (!fallbackCanvasId) return sessions;
  return sessions.map((session) => (
    session.canvasId
      ? session
      : { ...session, canvasId: fallbackCanvasId }
  ));
}

function canvasAgentSessionsFor(canvasId = activeCanvasId()) {
  const targetCanvasId = String(canvasId || '').trim();
  return CanvasWorkspace.agentSessions.filter((session) => (
    canvasAgentSessionCanvasId(session, targetCanvasId) === targetCanvasId
  ));
}

function latestCanvasAgentSession(canvasId = activeCanvasId()) {
  return canvasAgentSessionsFor(canvasId)
    .slice()
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || new Date(b.updatedAt) - new Date(a.updatedAt))[0] || null;
}

function mergeCanvasAgentSessions(...sources) {
  const byId = new Map();
  sources.flatMap((source) => normalizedCanvasAgentSessions(source)).forEach((session) => {
    const previous = byId.get(session.id);
    if (!previous || new Date(session.updatedAt) >= new Date(previous.updatedAt)) byId.set(session.id, session);
  });
  return [...byId.values()]
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, CANVAS_AGENT_HISTORY_LIMIT);
}

function persistCanvasAgentHistory() {
  const sessions = migrateLegacyCanvasAgentSessions(
    mergeCanvasAgentSessions(CanvasWorkspace.agentSessions),
    activeCanvasId()
  );
  CanvasWorkspace.agentSessions = sessions;
  try { localStorage.setItem(CANVAS_AGENT_HISTORY_KEY, JSON.stringify(sessions)); } catch (error) {}
  if (window.messsAPI && typeof window.messsAPI.saveCanvasAgentHistory === 'function') {
    void window.messsAPI.saveCanvasAgentHistory(sessions).catch(() => {});
  }
}

function readLocalCanvasAgentHistory() {
  try {
    return normalizedCanvasAgentSessions(JSON.parse(localStorage.getItem(CANVAS_AGENT_HISTORY_KEY) || '[]'));
  } catch (error) {
    return [];
  }
}

async function loadCanvasAgentHistory() {
  const local = readLocalCanvasAgentHistory();
  let durable = [];
  try {
    if (window.messsAPI && typeof window.messsAPI.getCanvasAgentHistory === 'function') {
      const result = await window.messsAPI.getCanvasAgentHistory();
      durable = normalizedCanvasAgentSessions(result && result.sessions);
    }
  } catch (error) {}
  CanvasWorkspace.agentSessions = migrateLegacyCanvasAgentSessions(
    mergeCanvasAgentSessions(durable, local, CanvasWorkspace.agentSessions),
    activeCanvasId()
  );
  CanvasWorkspace.agentHistoryLoaded = true;
  persistCanvasAgentHistory();
  const active = latestCanvasAgentSession(activeCanvasId());
  if (active) loadCanvasAgentSession(active.id);
  else startNewCanvasAgentChat();
  renderCanvasAgentHistory();
}

function activeCanvasAgentSession() {
  const canvasId = activeCanvasId();
  return CanvasWorkspace.agentSessions.find((session) => (
    session.id === CanvasWorkspace.activeAgentSessionId
      && canvasAgentSessionCanvasId(session, canvasId) === canvasId
  )) || null;
}

function ensureCanvasAgentSession(title = '') {
  const active = activeCanvasAgentSession();
  if (active) return active;
  CanvasWorkspace.activeAgentSessionId = null;
  const now = new Date().toISOString();
  const session = {
    id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: String(title || t('New conversation', '\u65b0\u5bf9\u8bdd')).slice(0, 120),
    canvasId: activeCanvasId(),
    createdAt: now,
    updatedAt: now,
    favorite: false,
    messages: []
  };
  CanvasWorkspace.agentSessions.unshift(session);
  CanvasWorkspace.activeAgentSessionId = session.id;
  renderCanvasAgentHistory();
  return session;
}

function persistActiveCanvasAgentSession() {
  const session = ensureCanvasAgentSession();
  session.messages = CanvasWorkspace.agentMessages.map((message) => ({
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: String(message.content || '').slice(0, 16000),
    displayContent: String((message.displayContent ?? message.content) || '').slice(0, 12000),
    attachmentFileIds: Array.isArray(message.attachmentFileIds) ? message.attachmentFileIds.slice(0, 50) : [],
    attachments: Array.isArray(message.attachments) ? message.attachments.slice(0, 50).map((file) => ({
      id: file.id, name: file.name, mimeType: file.mimeType, sizeBytes: file.sizeBytes, kind: file.kind
    })) : []
  }));
  session.updatedAt = new Date().toISOString();
  if (!session.messages.length) session.title = t('New conversation', '\u65b0\u5bf9\u8bdd');
  else {
    const first = session.messages.find((message) => message.role === 'user');
    if (first && session.title === t('New conversation', '\u65b0\u5bf9\u8bdd')) {
      session.title = String(first.displayContent || first.content).split('\n').pop().slice(0, 120) || session.title;
    }
  }
  persistCanvasAgentHistory();
  renderCanvasAgentHistory();
}

function clearCanvasAgentMessages() {
  CanvasWorkspace.activeAgentSessionId = null;
  CanvasWorkspace.agentMessages = [];
  const list = document.getElementById('board-agent-messages');
  if (list) {
    list.innerHTML = '';
    const welcome = document.createElement('div');
    welcome.id = 'board-agent-welcome';
    welcome.className = 'board-agent-welcome';
    welcome.innerHTML = '<img src="assets/logo-mark.png" alt="" draggable="false"><strong>Messs Agent</strong><span></span>';
    welcome.querySelector('span').textContent = t('Solve your problem.', '\u89e3\u51b3\u4f60\u7684\u95ee\u9898\u3002');
    list.appendChild(welcome);
  }
}

function startNewCanvasAgentChat() {
  clearCanvasAgentMessages();
  renderCanvasAgentHistory();
}

function restoreCanvasAgentSessionForCanvas(canvasId = activeCanvasId()) {
  const session = latestCanvasAgentSession(canvasId);
  if (session) {
    loadCanvasAgentSession(session.id);
    return session;
  }
  clearCanvasAgentMessages();
  renderCanvasAgentHistory();
  return null;
}

function activeCanvasRecord() {
  return AppState.canvases.find((canvas) => canvas.id === AppState.activeCanvasId) || AppState.canvases[0] || null;
}

function activeCanvasId() {
  return AppState.activeCanvasId || (AppState.canvases[0] && AppState.canvases[0].id) || 'canvas-1';
}

function invalidateCanvasWorkspaceItemIndex() {
  CanvasWorkspace.boardItemIndexRef = null;
  CanvasWorkspace.boardItemIndexCount = -1;
  CanvasWorkspace.boardItemIndex.clear();
}

function ensureCanvasWorkspaceItemIndex() {
  if (!Array.isArray(AppState.allBoardItems)) AppState.allBoardItems = [];
  if (
    CanvasWorkspace.boardItemIndexRef === AppState.allBoardItems &&
    CanvasWorkspace.boardItemIndexCount === AppState.allBoardItems.length
  ) return CanvasWorkspace.boardItemIndex;
  const index = new Map();
  AppState.allBoardItems.forEach((item, itemIndex) => {
    if (item && item.id) index.set(item.id, itemIndex);
  });
  CanvasWorkspace.boardItemIndex = index;
  CanvasWorkspace.boardItemIndexRef = AppState.allBoardItems;
  CanvasWorkspace.boardItemIndexCount = AppState.allBoardItems.length;
  return index;
}

function upsertCanvasWorkspaceItem(item, fallbackCanvasId = activeCanvasId()) {
  if (!item || !item.id) return;
  item.canvasId = item.canvasId || fallbackCanvasId;
  const itemIndex = ensureCanvasWorkspaceItemIndex();
  let index = itemIndex.get(item.id);
  if (index !== undefined && (!AppState.allBoardItems[index] || AppState.allBoardItems[index].id !== item.id)) {
    invalidateCanvasWorkspaceItemIndex();
    index = ensureCanvasWorkspaceItemIndex().get(item.id);
  }
  if (index === undefined) {
    AppState.allBoardItems.push(item);
    CanvasWorkspace.boardItemIndex.set(item.id, AppState.allBoardItems.length - 1);
    CanvasWorkspace.boardItemIndexCount = AppState.allBoardItems.length;
  } else {
    AppState.allBoardItems[index] = item;
  }
}

function canvasWorkspaceAddItem(item) {
  upsertCanvasWorkspaceItem(item);
}

function canvasWorkspaceRemoveItems(ids) {
  const removed = new Set(ids || []);
  if (Array.isArray(AppState.allBoardItems)) {
    AppState.allBoardItems = AppState.allBoardItems.filter((item) => !removed.has(item.id));
    invalidateCanvasWorkspaceItemIndex();
  }
}

function canvasWorkspaceReplaceItem(oldId, item) {
  if (!item) return;
  item.canvasId = item.canvasId || activeCanvasId();
  const itemIndex = ensureCanvasWorkspaceItemIndex();
  const index = itemIndex.get(oldId);
  if (index === undefined) {
    upsertCanvasWorkspaceItem(item);
    return;
  }
  AppState.allBoardItems[index] = item;
  itemIndex.delete(oldId);
  itemIndex.set(item.id, index);
}

function canvasWorkspaceTouch(canvasId = activeCanvasId()) {
  const canvas = AppState.canvases.find((entry) => entry.id === canvasId);
  if (canvas) canvas.updatedAt = new Date().toISOString();
}

function toggleCanvasPinned(canvasId) {
  const canvas = AppState.canvases.find((entry) => entry.id === canvasId);
  if (!canvas) return;
  const pinned = canvas.pinned !== true;
  canvas.pinned = pinned;
  renderCanvasLibrary();
  canvasWorkspaceSave().catch(() => {
    // Keep the UI and durable state aligned if the save was rejected.
    if (canvas.pinned === pinned) {
      canvas.pinned = !pinned;
      renderCanvasLibrary();
    }
  });
}

async function canvasWorkspaceSave() {
  const result = await window.messsAPI.saveCanvasState({
    projects: AppState.canvasProjects,
    canvases: AppState.canvases,
    detachedCanvasId: isDetachedCanvasWindow() ? CanvasWorkspace.detachedCanvasId : null
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
  const projectsById = new Map(AppState.canvasProjects.map((project) => [project.id, project]));
  return AppState.canvases
    .filter((canvas) => {
      const project = projectsById.get(canvas.projectId);
      return project && canvasProjectScope(project) === normalizeCanvasProjectScope(CanvasWorkspace.libraryScope);
    })
    .filter((canvas) => !CanvasWorkspace.libraryProjectId || canvas.projectId === CanvasWorkspace.libraryProjectId)
    .filter((canvas) => {
    if (CanvasWorkspace.libraryFilter !== 'recent') return true;
      if (canvas.pinned === true) return true;
      const updated = new Date(canvas.lastOpenedAt || canvas.updatedAt || canvas.createdAt || 0).getTime();
      return now - updated <= 1000 * 60 * 60 * 24 * 30;
    })
    .filter((canvas) => !query || canvas.name.toLowerCase().includes(query))
    .sort((a, b) => Number(b.pinned === true) - Number(a.pinned === true)
      || new Date(b.lastOpenedAt || b.updatedAt || b.createdAt || 0) - new Date(a.lastOpenedAt || a.updatedAt || a.createdAt || 0));
}

function renderCanvasLibraryProjects() {
  const list = document.getElementById('canvas-library-projects');
  if (!list) return;
  list.innerHTML = '';
  canvasProjectsForScope().forEach((project) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.projectId = project.id;
    button.classList.toggle('is-active', CanvasWorkspace.libraryProjectId === project.id);
    const count = AppState.canvases.filter((canvas) => canvas.projectId === project.id).length;
    button.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg><span class="canvas-library-project-name">${escapeHtml(project.name)}</span><small class="canvas-library-project-count">${count}</small>`;
    button.title = t('Right-click to manage this folder', '右键管理此文件夹');
    button.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      buildAndShowSimpleMenu([
        {
          label: t('Rename folder', '重命名文件夹'),
          icon: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
          action: () => promptRenameCanvasProject(project.id)
        },
        {
          label: t('Delete folder', '删除文件夹'),
          icon: 'M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13',
          danger: true,
          action: () => promptDeleteCanvasProject(project.id)
        }
      ], event.clientX, event.clientY, 'canvas-project-context-menu');
    });
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

function buildCanvasLibraryCreateCard() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'canvas-library-create-card';
  button.setAttribute('aria-label', t('New canvas', '新建画布'));
  button.innerHTML = '<span class="canvas-library-create-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 5v14M5 12h14"/></svg></span><span class="canvas-library-create-label"></span>';
  button.querySelector('.canvas-library-create-label').textContent = t('New canvas', '新建画布');
  button.addEventListener('click', () => promptNewCanvas());
  return button;
}

function renderCanvasLibrary() {
  const grid = document.getElementById('canvas-library-grid');
  if (!grid) return;
  document.querySelectorAll('[data-canvas-filter]').forEach((entry) => {
    entry.classList.toggle('is-active', !CanvasWorkspace.libraryProjectId && entry.dataset.canvasFilter === CanvasWorkspace.libraryFilter);
  });
  const canvases = filteredCanvases();
  grid.innerHTML = '';
  canvases.forEach((canvas) => {
    const project = AppState.canvasProjects.find((entry) => entry.id === canvas.projectId);
    const card = document.createElement('article');
    card.className = 'canvas-library-card';
    card.classList.toggle('is-pinned', canvas.pinned === true);
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

    const pinBadge = document.createElement('span');
    pinBadge.className = 'canvas-library-card-pin';
    pinBadge.title = t('Pinned canvas', '已置顶画布');
    pinBadge.setAttribute('aria-label', pinBadge.title);
    pinBadge.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 3h8l-1 5 3 4H6l3-4z"/><path d="M12 12v9"/></svg>';
    pinBadge.hidden = canvas.pinned !== true;

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
        action: 'toggle-pin',
        label: canvas.pinned === true ? t('Unpin canvas', '取消置顶') : t('Pin canvas', '置顶画布'),
        icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 3h8l-1 5 3 4H6l3-4z"/><path d="M12 12v9"/></svg>'
      },
      {
        action: 'rename',
        label: t('Rename canvas', '重命名画布'),
        icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>'
      },
      {
        action: 'move-folder',
        label: t('Move to folder', '移动到文件夹'),
        icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/><path d="M8 13h8M13 10l3 3-3 3"/></svg>'
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
      if (button.dataset.canvasAction === 'move-folder') promptMoveCanvasToFolder(canvas.id);
      if (button.dataset.canvasAction === 'export') exportCanvasFile(canvas.id);
      if (button.dataset.canvasAction === 'delete') promptDeleteCanvas(canvas.id);
      if (button.dataset.canvasAction === 'toggle-pin') toggleCanvasPinned(canvas.id);
    });

    card.append(title, meta, buildCanvasMosaic(canvas), pinBadge, menuTrigger, menu);
    card.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeCanvasCardMenus();
      buildAndShowSimpleMenu([
        {
          label: canvas.pinned === true ? t('Unpin canvas', '取消置顶') : t('Pin canvas', '置顶画布'),
          icon: 'M8 3h8l-1 5 3 4H6l3-4z;M12 12v9',
          action: () => toggleCanvasPinned(canvas.id)
        },
        {
          label: t('Move to folder', '移动到文件夹'),
          icon: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z;M8 13h8M13 10l3 3-3 3',
          action: () => promptMoveCanvasToFolder(canvas.id)
        }
      ], event.clientX, event.clientY, 'canvas-card-context-menu');
    });
    card.addEventListener('click', () => switchCanvas(canvas.id, { enterWorkspace: true }));
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        switchCanvas(canvas.id, { enterWorkspace: true });
      }
    });
    grid.appendChild(card);
  });
  if (!CanvasWorkspace.libraryQuery.trim()) grid.appendChild(buildCanvasLibraryCreateCard());
  const empty = document.getElementById('canvas-library-empty');
  if (empty) {
    empty.hidden = canvases.length > 0 || Boolean(CanvasWorkspace.libraryQuery.trim());
    if (!empty.hidden) {
      empty.textContent = canvasProjectsForScope().length
        ? t('No canvases in this project type yet.', '这个项目类型里还没有画布。', '이 프로젝트 유형에는 아직 캔버스가 없습니다.')
        : t('No projects here yet. Create a project to get started.', '这里还没有项目。创建一个项目即可开始。', '아직 프로젝트가 없습니다. 프로젝트를 만들어 시작하세요.');
    }
  }
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

function syncCanvasLibraryScopePicker() {
  const picker = document.getElementById('canvas-scope-picker');
  const scope = normalizeCanvasProjectScope(CanvasWorkspace.libraryScope);
  if (picker) {
    picker.value = scope;
    picker.setAttribute('aria-label', t('Project type', '项目类型', '프로젝트 유형'));
  }
  const heading = document.getElementById('canvas-library-heading');
  if (heading) heading.textContent = t('All Canvases', '全部画布', '모든 캔버스');
  const subtitle = document.querySelector('.canvas-library-topline p');
  if (subtitle) subtitle.textContent = canvasLibraryScopeDescription(scope);
}

function selectCanvasLibraryScope(scope, { render = true } = {}) {
  CanvasWorkspace.libraryScope = normalizeCanvasProjectScope(scope);
  CanvasWorkspace.libraryProjectId = null;
  CanvasWorkspace.libraryFilter = 'all';
  document.querySelectorAll('[data-canvas-filter]').forEach((entry) => {
    entry.classList.toggle('is-active', entry.dataset.canvasFilter === 'all');
  });
  syncCanvasLibraryScopePicker();
  if (render) renderCanvasLibrary();
}

function showCanvasLibrary() {
  const panel = document.getElementById('board-panel');
  const library = document.getElementById('canvas-library-view');
  const workspace = document.getElementById('board-workspace-body');
  if (!panel || !library || !workspace) return;
  if (typeof closeBoardButlerExpandEditor === 'function') closeBoardButlerExpandEditor();
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
  syncCanvasLibraryScopePicker();
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
  if (isDetachedCanvasWindow() && canvasId !== CanvasWorkspace.detachedCanvasId) return;
  const next = AppState.canvases.find((canvas) => canvas.id === canvasId);
  if (!next) return;
  const previousCanvasId = activeCanvasId();
  if (previousCanvasId !== next.id && CanvasWorkspace.agentBusy) {
    showToast(
      t('Finish the current Agent request before switching canvases.', '\u8bf7\u7b49 Agent \u8bf7\u6c42\u5b8c\u6210\u540e\u518d\u5207\u6362\u753b\u5e03\u3002'),
      'AI'
    );
    return;
  }
  if (previousCanvasId !== next.id && (CanvasWorkspace.activeAgentSessionId || CanvasWorkspace.agentMessages.length)) {
    persistActiveCanvasAgentSession();
  }
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
  AppState.allBoardItems.forEach((item) => { item.selected = false; });
  AppState.boardItems = AppState.allBoardItems.filter((item) => (item.canvasId || 'canvas-1') === next.id);
  CanvasWorkspace.agentReferenceFileIds.clear();
  CanvasWorkspace.agentSelectionFileIds.clear();
  next.lastOpenedAt = new Date().toISOString();
  canvasWorkspaceSave().catch(() => {});
  if (options.enterWorkspace) showCanvasWorkspace();
  renderCanvasWorkspaceControls();
  if (typeof renderBoard === 'function') renderBoard();
  restoreCanvasAgentSessionForCanvas(next.id);
  renderCanvasAgentReferences();
  renderCanvasAgentContext();
}

function showCanvasTextDialog({
  title,
  label,
  initialValue = '',
  projectId = null,
  includeProject = false,
  includeScope = false,
  scope = CanvasWorkspace.libraryScope
}) {
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
        <label class="canvas-project-field"><span>${escapeHtml(t('Folder', '文件夹'))}</span><select class="canvas-project-input"></select></label>
        <label class="canvas-scope-field"><span>${escapeHtml(t('Project type', '项目类型', '프로젝트 유형'))}</span><select class="canvas-scope-input">
          <option value="personal">${escapeHtml(t('Independent projects', '独立项目', '독립 프로젝트'))}</option>
          <option value="team">${escapeHtml(t('Team projects', '团队项目', '팀 프로젝트'))}</option>
        </select></label>
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
    const scopeField = overlay.querySelector('.canvas-scope-field');
    const scopeSelect = overlay.querySelector('.canvas-scope-input');
    input.value = initialValue;
    projectField.hidden = !includeProject;
    scopeField.hidden = !includeScope;
    if (includeProject) {
      const projectOptions = canvasProjectsForScope();
      appendCanvasProjectOptions(projectSelect, projectOptions, projectId || null);
      projectSelect.value = projectId || (projectOptions[0] && projectOptions[0].id) || '';
    }
    scopeSelect.value = normalizeCanvasProjectScope(scope);
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
      close({
        name: value,
        projectId: projectSelect.value || projectId,
        scope: normalizeCanvasProjectScope(scopeSelect.value)
      });
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

function showCanvasFolderDialog({
  title,
  projectId = null,
  folderLabel = t('Destination folder', '目标文件夹'),
  confirmLabel = t('Move', '移动')
}) {
  return new Promise((resolve) => {
    const old = document.getElementById('canvas-folder-dialog');
    if (old) old.remove();
    const overlay = document.createElement('div');
    overlay.id = 'canvas-folder-dialog';
    overlay.className = 'canvas-name-dialog-overlay';
    overlay.innerHTML = `
      <form class="canvas-name-dialog canvas-folder-dialog" aria-modal="true" role="dialog">
        <h3>${escapeHtml(title)}</h3>
        <label><span>${escapeHtml(folderLabel)}</span><select class="canvas-folder-select"></select></label>
        <div class="canvas-name-dialog-actions">
          <button type="button" class="pill-btn pill-btn-ghost canvas-folder-cancel">${escapeHtml(t('Cancel', '取消'))}</button>
          <button type="submit" class="pill-btn canvas-folder-confirm">${escapeHtml(confirmLabel)}</button>
        </div>
      </form>
    `;
    document.body.appendChild(overlay);
    const form = overlay.querySelector('form');
    const select = overlay.querySelector('.canvas-folder-select');
    appendCanvasProjectOptions(select, AppState.canvasProjects, projectId || null);
    requestAnimationFrame(() => overlay.classList.add('is-visible'));

    function close(value) {
      overlay.classList.remove('is-visible');
      setTimeout(() => overlay.remove(), 180);
      resolve(value);
    }
    overlay.querySelector('.canvas-folder-cancel').addEventListener('click', () => close(null));
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close(null);
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      close(select.value || null);
    });
    select.focus();
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
  const selectedProjectRecord = AppState.canvasProjects.find((project) => project.id === CanvasWorkspace.libraryProjectId);
  const activeProject = AppState.canvasProjects.find((project) => active && project.id === active.projectId);
  const scopedProject = canvasProjectsForScope()[0];
  const selectedProject = selectedProjectRecord && canvasProjectScope(selectedProjectRecord) === CanvasWorkspace.libraryScope
    ? selectedProjectRecord.id
    : (activeProject && canvasProjectScope(activeProject) === CanvasWorkspace.libraryScope
      ? activeProject.id
      : (scopedProject && scopedProject.id));
  if (!selectedProject) {
    showToast(
      t('Create a team project first, then create a canvas.', '请先创建团队项目，再新建画布。', '먼저 팀 프로젝트를 만든 다음 캔버스를 만드세요.'),
      'Canvas'
    );
    return;
  }
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
    title: t('New folder', '新建文件夹'),
    label: t('Folder name', '文件夹名称'),
    initialValue: t('New folder', '新文件夹'),
    includeScope: true,
    scope: CanvasWorkspace.libraryScope
  });
  if (!result) return;
  const project = {
    id: `project-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: uniqueCanvasProjectName(result.name),
    scope: normalizeCanvasProjectScope(result.scope || CanvasWorkspace.libraryScope),
    createdAt: new Date().toISOString()
  };
  const previousProjects = AppState.canvasProjects;
  AppState.canvasProjects = [...previousProjects, project];
  try {
    await canvasWorkspaceSave();
    CanvasWorkspace.libraryScope = project.scope;
    CanvasWorkspace.libraryProjectId = project.id;
    CanvasWorkspace.libraryFilter = 'all';
    renderCanvasWorkspaceControls();
    showCanvasLibrary();
    showToast(t('Folder created.', '文件夹已创建。'), 'Canvas');
  } catch (err) {
    AppState.canvasProjects = previousProjects;
    renderCanvasWorkspaceControls();
    showToast(err && err.message ? err.message : t('Folder creation failed.', '文件夹创建失败。'), 'Canvas');
  }
}

function uniqueCanvasProjectName(value, exceptId = null) {
  const base = String(value || t('New folder', '新文件夹')).trim() || t('New folder', '新文件夹');
  const names = new Set(
    AppState.canvasProjects
      .filter((project) => project.id !== exceptId)
      .map((project) => String(project.name || '').toLowerCase())
  );
  if (!names.has(base.toLowerCase())) return base;
  let index = 2;
  let candidate = `${base} ${index}`;
  while (names.has(candidate.toLowerCase())) candidate = `${base} ${++index}`;
  return candidate;
}

async function promptRenameCanvasProject(projectId) {
  const project = AppState.canvasProjects.find((entry) => entry.id === projectId);
  if (!project) return;
  const result = await showCanvasTextDialog({
    title: t('Rename folder', '重命名文件夹'),
    label: t('Folder name', '文件夹名称'),
    initialValue: project.name
  });
  if (!result) return;
  const previousName = project.name;
  project.name = uniqueCanvasProjectName(result.name, project.id);
  try {
    await canvasWorkspaceSave();
    renderCanvasWorkspaceControls();
    showToast(t('Folder renamed.', '文件夹已重命名。'), 'Canvas');
  } catch (err) {
    project.name = previousName;
    renderCanvasWorkspaceControls();
    showToast(err && err.message ? err.message : t('Folder rename failed.', '文件夹重命名失败。'), 'Canvas');
  }
}

async function promptMoveCanvasToFolder(canvasId) {
  const canvas = AppState.canvases.find((entry) => entry.id === canvasId);
  if (!canvas) return;
  if (AppState.canvasProjects.length <= 1) {
    showToast(t('Create another folder before moving a canvas.', '请先新建一个文件夹，再移动画布。'), 'Canvas');
    return;
  }
  const projectId = await showCanvasFolderDialog({
    title: t('Move canvas to folder', '将画布移动到文件夹'),
    projectId: canvas.projectId
  });
  if (!projectId || projectId === canvas.projectId) return;
  const previousProjectId = canvas.projectId;
  const previousUpdatedAt = canvas.updatedAt;
  canvas.projectId = projectId;
  canvas.updatedAt = new Date().toISOString();
  try {
    await canvasWorkspaceSave();
    renderCanvasWorkspaceControls();
    showToast(t('Canvas moved to folder.', '画布已移动到文件夹。'), 'Canvas');
  } catch (err) {
    canvas.projectId = previousProjectId;
    canvas.updatedAt = previousUpdatedAt;
    renderCanvasWorkspaceControls();
    showToast(err && err.message ? err.message : t('Canvas move failed.', '画布移动失败。'), 'Canvas');
  }
}

async function promptImportCanvas() {
  const scopedProjects = canvasProjectsForScope();
  if (!scopedProjects.length) {
    showToast(
      t('Create a project in this type before importing a canvas.', '请先在这个项目类型下创建项目，再导入画布。', '이 유형에 프로젝트를 만든 다음 캔버스를 가져오세요.'),
      'Canvas'
    );
    return;
  }
  const active = activeCanvasRecord();
  const activeProject = AppState.canvasProjects.find((project) => active && project.id === active.projectId);
  const selectedProject = AppState.canvasProjects.find((project) => project.id === CanvasWorkspace.libraryProjectId);
  const targetProjectId = selectedProject && canvasProjectScope(selectedProject) === CanvasWorkspace.libraryScope
    ? selectedProject.id
    : (activeProject && canvasProjectScope(activeProject) === CanvasWorkspace.libraryScope
      ? activeProject.id
      : scopedProjects[0].id);
  const projectId = await showCanvasFolderDialog({
    title: t('Import .Messs canvas', '导入 .Messs 画布'),
    projectId: targetProjectId,
    folderLabel: t('Import into folder', '导入到文件夹'),
    confirmLabel: t('Import', '导入')
  });
  if (!projectId) return;
  try {
    const result = await window.messsAPI.importCanvas(projectId);
    if (!result || !result.ok) {
      if (result && !result.canceled) {
        showToast(result.message || t('Canvas import failed.', '画布导入失败。'), 'Canvas');
      }
      return;
    }
    AppState.canvasProjects = Array.isArray(result.projects) ? result.projects : AppState.canvasProjects;
    AppState.canvases = Array.isArray(result.canvases) ? result.canvases : AppState.canvases;
    const importedFiles = Array.isArray(result.files) ? result.files : [];
    const importedItems = Array.isArray(result.boardItems) ? result.boardItems : [];
    AppState.files = [
      ...AppState.files.filter((file) => !importedFiles.some((entry) => entry.id === file.id)),
      ...importedFiles
    ];
    AppState.allBoardItems = [
      ...AppState.allBoardItems.filter((item) => !importedItems.some((entry) => entry.id === item.id)),
      ...importedItems
    ];
    if (typeof renderFileList === 'function') renderFileList(currentFileListScope());
    if (typeof renderFolderGridIfActive === 'function') renderFolderGridIfActive();
    if (result.canvas && result.canvas.id) {
      switchCanvas(result.canvas.id, { enterWorkspace: true });
    } else {
      renderCanvasWorkspaceControls();
    }
    showToast(
      t(`Imported canvas with ${importedFiles.length} file${importedFiles.length === 1 ? '' : 's'}.`, `画布导入成功，共 ${importedFiles.length} 个文件。`),
      'Canvas'
    );
  } catch (err) {
    showToast(err && err.message ? err.message : t('Canvas import failed.', '画布导入失败。'), 'Canvas');
  }
}

async function promptDeleteCanvasProject(projectId) {
  const project = AppState.canvasProjects.find((entry) => entry.id === projectId);
  if (!project) return;
  if (AppState.canvasProjects.length <= 1) {
    showToast(t('Keep at least one folder.', '至少需要保留一个文件夹。'), 'Canvas');
    return;
  }

  const fallback = AppState.canvasProjects.find((entry) => entry.id !== projectId && entry.name === 'General')
    || AppState.canvasProjects.find((entry) => entry.id !== projectId);
  if (!fallback) return;
  const canvasCount = AppState.canvases.filter((canvas) => canvas.projectId === projectId).length;
  const confirmed = await showCanvasConfirmDialog({
    title: t('Delete folder', '删除文件夹'),
    message: canvasCount
      ? t(
        `Delete "${project.name}"? Its ${canvasCount} canvas${canvasCount === 1 ? '' : 'es'} will move to "${fallback.name}". Source files will be kept.`,
        `确定删除“${project.name}”吗？其中 ${canvasCount} 个画布会移到“${fallback.name}”，源文件将会保留。`
      )
      : t(
        `Delete "${project.name}"? Source files will be kept.`,
        `确定删除“${project.name}”吗？源文件将会保留。`
      ),
    confirmLabel: t('Delete', '删除')
  });
  if (!confirmed) return;

  const previousProjects = AppState.canvasProjects;
  const affectedCanvases = AppState.canvases
    .filter((canvas) => canvas.projectId === projectId)
    .map((canvas) => ({ canvas, projectId: canvas.projectId, updatedAt: canvas.updatedAt }));
  AppState.canvasProjects = AppState.canvasProjects.filter((entry) => entry.id !== projectId);
  affectedCanvases.forEach(({ canvas }) => {
    canvas.projectId = fallback.id;
    canvas.updatedAt = new Date().toISOString();
  });
  const previousLibraryProjectId = CanvasWorkspace.libraryProjectId;
  if (previousLibraryProjectId === projectId) CanvasWorkspace.libraryProjectId = null;
  try {
    await canvasWorkspaceSave();
    renderCanvasWorkspaceControls();
    showToast(t('Folder deleted. Canvases and source files were kept.', '文件夹已删除，画布和源文件仍然保留。'), 'Canvas');
  } catch (err) {
    AppState.canvasProjects = previousProjects;
    affectedCanvases.forEach(({ canvas, projectId: originalProjectId, updatedAt }) => {
      canvas.projectId = originalProjectId;
      canvas.updatedAt = updatedAt;
    });
    CanvasWorkspace.libraryProjectId = previousLibraryProjectId;
    renderCanvasWorkspaceControls();
    showToast(err && err.message ? err.message : t('Folder deletion failed.', '文件夹删除失败。'), 'Canvas');
  }
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
  if (typeof renderFileList === 'function' && typeof currentFileListScope === 'function') {
    renderFileList(currentFileListScope());
  }
}

async function exportCanvasFile(canvasId) {
  try {
    const result = await window.messsAPI.exportCanvas(canvasId);
    if (result && result.ok) {
      showToast(
        t(`Canvas exported as .Messs with ${result.fileCount || 0} file${result.fileCount === 1 ? '' : 's'}.`, `画布已导出为 .Messs 文件，共 ${result.fileCount || 0} 个文件。`),
        'Canvas'
      );
    } else if (result && !result.canceled) {
      showToast(result.message || t('Canvas export failed.', '画布导出失败。'), 'Canvas');
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
  const liveFile = AppState.files.find((entry) => entry.id === file.id) || file;
  const mimeType = String(liveFile.mimeType || file.mimeType || '');
  const kind = ['image', 'video', 'file'].includes(file.kind)
    ? file.kind
    : isImageExt(liveFile.ext) || mimeType.startsWith('image/')
      ? 'image'
      : isVideoExt(liveFile.ext) || mimeType.startsWith('video/') ? 'video' : 'file';
  return {
    id: liveFile.id || file.id,
    name: liveFile.name || file.name,
    mimeType,
    sizeBytes: liveFile.sizeBytes || file.sizeBytes,
    kind,
    dataUrl: liveFile.thumbUrl || liveFile.previewUrl || liveFile.url || file.dataUrl || ''
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

function canvasAgentSessionMatchesFilter(session) {
  if (CanvasWorkspace.agentHistoryFavoritesOnly && !session.favorite) return false;
  if (CanvasWorkspace.agentHistoryDate && canvasAgentHistoryDate(session.updatedAt) !== CanvasWorkspace.agentHistoryDate) return false;
  return true;
}

function renderCanvasAgentHistory() {
  const list = document.getElementById('board-agent-history-list');
  const empty = document.getElementById('board-agent-history-empty');
  const drawer = document.getElementById('board-agent-history-drawer');
  if (!list || !empty) return;
  const sessions = CanvasWorkspace.agentSessions
    .slice()
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || new Date(b.updatedAt) - new Date(a.updatedAt))
    .filter((session) => canvasAgentSessionCanvasId(session) === activeCanvasId())
    .filter(canvasAgentSessionMatchesFilter);
  list.replaceChildren();
  empty.hidden = sessions.length > 0;
  sessions.forEach((session) => {
    const row = document.createElement('div');
    row.className = 'board-agent-history-row';
    row.dataset.sessionId = session.id;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'board-agent-history-item';
    button.classList.toggle('is-active', session.id === CanvasWorkspace.activeAgentSessionId);
    button.innerHTML = `<span class="board-agent-history-star" aria-hidden="true">${session.favorite ? '\u2605' : '\u2606'}</span><span class="board-agent-history-copy"><b></b><small></small></span>`;
    button.querySelector('b').textContent = session.title || t('New conversation', '\u65b0\u5bf9\u8bdd');
    button.querySelector('small').textContent = canvasAgentHistoryDate(session.updatedAt);
    button.addEventListener('click', () => loadCanvasAgentSession(session.id));
    row.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      showCanvasAgentSessionMenu(session.id, event.clientX, event.clientY);
    });
    row.appendChild(button);
    list.appendChild(row);
  });
  const favorites = document.getElementById('board-agent-history-favorites');
  if (favorites) {
    favorites.classList.toggle('is-active', CanvasWorkspace.agentHistoryFavoritesOnly);
    favorites.setAttribute('aria-pressed', String(CanvasWorkspace.agentHistoryFavoritesOnly));
  }
  if (drawer) drawer.dataset.hasResults = String(sessions.length > 0);
}

function loadCanvasAgentSession(sessionId) {
  const session = CanvasWorkspace.agentSessions.find((entry) => entry.id === sessionId);
  if (!session || canvasAgentSessionCanvasId(session) !== activeCanvasId()) return;
  CanvasWorkspace.activeAgentSessionId = session.id;
  CanvasWorkspace.agentMessages = session.messages.map((message) => ({ ...message }));
  const list = document.getElementById('board-agent-messages');
  if (!list) return;
  list.replaceChildren();
  CanvasWorkspace.agentMessages.forEach((message) => {
    const row = appendCanvasAgentMessage(message.role, message.displayContent || message.content);
    appendCanvasAgentAttachments(row, Array.isArray(message.attachments) ? message.attachments : []);
  });
  renderCanvasAgentHistory();
  const drawer = document.getElementById('board-agent-history-drawer');
  if (drawer) drawer.hidden = true;
}

function showCanvasAgentSessionMenu(sessionId, x, y) {
  const session = CanvasWorkspace.agentSessions.find((entry) => entry.id === sessionId);
  if (!session || typeof buildAndShowSimpleMenu !== 'function') return;
  buildAndShowSimpleMenu([
    {
      label: session.favorite ? t('Remove from Favorites', '\u53d6\u6d88\u6536\u85cf') : t('Add to Favorites', '\u52a0\u5165\u6536\u85cf\u5939'),
      icon: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3z',
      action: () => {
        session.favorite = !session.favorite;
        persistCanvasAgentHistory();
        renderCanvasAgentHistory();
      }
    },
    {
      label: t('Open conversation', '\u6253\u5f00\u5bf9\u8bdd'),
      icon: 'M4 5h16v12H8l-4 3V5z',
      action: () => loadCanvasAgentSession(session.id)
    }
  ], x, y, 'board-agent-history-context-menu');
}

function toggleCanvasAgentHistory(open = null) {
  const drawer = document.getElementById('board-agent-history-drawer');
  if (!drawer) return;
  drawer.hidden = open === null ? !drawer.hidden : !open;
  if (!drawer.hidden) renderCanvasAgentHistory();
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
  const historyDrawer = document.getElementById('board-agent-history-drawer');
  const historyToggle = document.getElementById('board-agent-history');
  if (!allowed && historyDrawer) historyDrawer.hidden = true;
  if (!allowed && historyToggle) historyToggle.setAttribute('aria-expanded', 'false');
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
  const options = canvasAgentChatProviders();
  const selected = options.find((entry) => (
    entry.providerId === CanvasWorkspace.agentChatProviderId
      && entry.model === CanvasWorkspace.agentChatModel
  )) || options[0];
  return selected || { providerId: null, model: null, name: 'Agent' };
}

function canvasAgentChatProviders() {
  const config = CanvasWorkspace.config || {};
  const allowedModels = new Set(['gemini-3.7-flash', 'gpt-5.6-luna']);
  const names = {
    'gemini-3.7-flash': 'Gemini 3.7 Flash',
    'gpt-5.6-luna': 'GPT-5.6 Luna'
  };
  return (Array.isArray(config.chatProviders) ? config.chatProviders : []).flatMap((provider) => {
    if (!provider || provider.available === false || !provider.endpoint) return [];
    return (Array.isArray(provider.models) ? provider.models : [])
      .map((model) => String(model || '').trim())
      .filter((model) => allowedModels.has(model))
      .map((model) => ({ providerId: provider.id, model, name: names[model] || model }));
  });
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
  const chatList = document.getElementById('board-agent-chat-options');
  const triggerLabel = document.getElementById('board-agent-model-label');
  if (!list || !chatList || !triggerLabel) return;
  const chatProviders = canvasAgentChatProviders();
  if (!chatProviders.some((entry) => (
    entry.providerId === CanvasWorkspace.agentChatProviderId && entry.model === CanvasWorkspace.agentChatModel
  ))) {
    const preferred = chatProviders.find((entry) => entry.model === 'gemini-3.7-flash') || chatProviders[0] || null;
    CanvasWorkspace.agentChatProviderId = preferred && preferred.providerId;
    CanvasWorkspace.agentChatModel = preferred && preferred.model;
  }
  chatList.replaceChildren();
  chatProviders.forEach((entry) => {
    const button = document.createElement('button');
    const active = CanvasWorkspace.agentMode === 'chat'
      && entry.providerId === CanvasWorkspace.agentChatProviderId
      && entry.model === CanvasWorkspace.agentChatModel;
    button.type = 'button';
    button.className = `board-agent-model-option is-chat-option${active ? ' is-active' : ''}`;
    button.dataset.agentChatProviderId = entry.providerId;
    button.dataset.agentChatModel = entry.model;
    button.setAttribute('role', 'option');
    button.innerHTML = '<span></span><i aria-hidden="true">✓</i>';
    button.querySelector('span').textContent = entry.name;
    chatList.appendChild(button);
  });
  const providers = canvasAgentMediaProviders();
  if (!providers.some((provider) => provider.id === CanvasWorkspace.agentProviderId)) {
    const config = CanvasWorkspace.config || {};
    const activeId = CanvasWorkspace.agentGenerationKind === 'video'
      ? config.activeVideoProviderId
      : config.activeImageProviderId;
    CanvasWorkspace.agentProviderId = (providers.find((provider) => provider.id === activeId) || providers[0] || {}).id || null;
  }
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
    label.textContent = typeof publicModelLabel === 'function' ? publicModelLabel(provider.name) : provider.name;
    const check = document.createElement('i');
    check.textContent = '✓';
    button.append(icon, label, check);
    list.appendChild(button);
  });
  const selected = providers.find((provider) => provider.id === CanvasWorkspace.agentProviderId);
  const selectedChat = activeCanvasAgentProvider();
  triggerLabel.textContent = CanvasWorkspace.agentMode === 'chat'
    ? selectedChat.name
    : (selected
      ? (typeof publicModelLabel === 'function' ? publicModelLabel(selected.name) : selected.name)
      : t('No model', '无可用模型'));
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
    modelName: typeof publicModelLabel === 'function' ? publicModelLabel(provider.name) : provider.name,
    referenceFileIds: references.referenceFileIds,
    urls: references.urls
  });
}

async function requestCanvasAgentText(options = {}) {
  if (CanvasWorkspace.agentBusy) return null;
  const input = document.getElementById('board-agent-input');
  const submitButton = document.getElementById('board-agent-submit');
  const displayPrompt = String(options.displayPrompt || '').trim();
  const contextualPrompt = String(options.contextualPrompt || displayPrompt).trim();
  const referenceFiles = Array.isArray(options.referenceFiles) ? options.referenceFiles.filter(Boolean) : [];
  if (!displayPrompt || !contextualPrompt) return null;
  const selected = activeCanvasAgentProvider();
  const userRow = appendCanvasAgentMessage('user', displayPrompt);
  appendCanvasAgentAttachments(userRow, referenceFiles);
  ensureCanvasAgentSession(displayPrompt);
  CanvasWorkspace.agentMessages.push({
    role: 'user',
    content: contextualPrompt,
    displayContent: displayPrompt,
    attachmentFileIds: referenceFiles.map((file) => file.id),
    attachments: referenceFiles.map(canvasAgentAttachmentRecord)
  });
  persistActiveCanvasAgentSession();
  CanvasWorkspace.agentBusy = true;
  if (input) input.disabled = true;
  if (submitButton) submitButton.disabled = true;
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
      messages: options.isolated === true
        ? [{ role: 'user', content: contextualPrompt }]
        : CanvasWorkspace.agentMessages,
      attachmentFileIds: referenceFiles.map((file) => file.id),
      chatProviderId: selected.providerId,
      chatModel: selected.model
    });
    if (!response || !response.ok) {
      throw new Error((response && response.message) || t('Canvas Agent request failed.', '画布 Agent 请求失败。'));
    }
    CanvasWorkspace.agentMessages.push({ role: 'assistant', content: response.text, displayContent: response.text });
    persistActiveCanvasAgentSession();
    pending.classList.remove('is-pending');
    pending.textContent = response.text;
    if (typeof appendAssistantOutputFiles === 'function') appendAssistantOutputFiles(pending, response.files);
    if (typeof options.onResponse === 'function') await options.onResponse(response.text, response);
    return response;
  } catch (err) {
    pending.remove();
    appendCanvasAgentMessage('error', typeof publicAiErrorMessage === 'function'
      ? publicAiErrorMessage(err && err.message, t('Canvas Agent request failed.', '画布 Agent 请求失败。'))
      : (err && err.message ? err.message : t('Canvas Agent request failed.', '画布 Agent 请求失败。')));
    if (typeof options.onError === 'function') options.onError(err);
    return null;
  } finally {
    window.clearInterval(thinkingTimer);
    CanvasWorkspace.agentBusy = false;
    if (input) input.disabled = false;
    if (submitButton) submitButton.disabled = false;
    if (input && options.focusInput !== false) input.focus();
  }
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
  ensureCanvasAgentSession(prompt);
  CanvasWorkspace.agentMessages.push({
    role: 'user',
    content: contextualPrompt,
    displayContent: prompt,
    attachmentFileIds: referenceFiles.map((file) => file.id),
    attachments: referenceFiles.map(canvasAgentAttachmentRecord)
  });
  persistActiveCanvasAgentSession();
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
    CanvasWorkspace.agentMessages.push({ role: 'assistant', content: response.text, displayContent: response.text });
    persistActiveCanvasAgentSession();
    pending.classList.remove('is-pending');
    pending.textContent = response.text;
    if (typeof appendAssistantOutputFiles === 'function') appendAssistantOutputFiles(pending, response.files);
  } catch (err) {
    pending.remove();
    appendCanvasAgentMessage('error', typeof publicAiErrorMessage === 'function'
      ? publicAiErrorMessage(err && err.message, t('Canvas Agent request failed.', '画布 Agent 请求失败。'))
      : (err && err.message ? err.message : t('Canvas Agent request failed.', '画布 Agent 请求失败。')));
  } finally {
    window.clearInterval(thinkingTimer);
    CanvasWorkspace.agentBusy = false;
    input.disabled = false;
    document.getElementById('board-agent-submit').disabled = false;
    input.focus();
  }
}

async function importCanvasAgentPastedMedia(file, event) {
  if (!file || !window.MesssFileDrop) return false;
  const folderId = AppState.activeFolderId && AppState.activeFolderId !== 'default'
    ? AppState.activeFolderId
    : null;
  const result = await window.MesssFileDrop.importEntries(
    window.MesssFileDrop.entriesFromFiles([file]),
    folderId,
    activeCanvasId()
  );
  const importedFile = result && Array.isArray(result.imported) ? result.imported[0] : null;
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
  setText('#canvas-import span', 'Import .Messs', '导入 .Messs');
  setText('#canvas-project-new span', 'New folder', '新建文件夹');
  setText('[data-canvas-filter="all"]', 'All canvases', '全部画布');
  setText('[data-canvas-filter="recent"]', 'Recent', '最近使用');
  setText('.canvas-library-project-label', 'Projects', '项目');
  setText('.canvas-library-topline h2', 'All Canvases', '全部画布');
  const scopePicker = document.getElementById('canvas-scope-picker');
  if (scopePicker) {
    scopePicker.querySelector('option[value="personal"]').textContent = t('Independent projects', '独立项目', '독립 프로젝트');
    scopePicker.querySelector('option[value="team"]').textContent = t('Team projects', '团队项目', '팀 프로젝트');
  }
  const scope = normalizeCanvasProjectScope(CanvasWorkspace.libraryScope);
  const scopeSubtitle = document.querySelector('.canvas-library-topline p');
  if (scopeSubtitle) scopeSubtitle.textContent = canvasLibraryScopeDescription(scope);
  if (scopePicker) {
    scopePicker.value = scope;
    scopePicker.setAttribute('aria-label', t('Project type', '项目类型', '프로젝트 유형'));
  }
  setText('#canvas-library-empty', 'No canvases found', '没有找到画布');
  const search = document.getElementById('canvas-library-search');
  if (search) search.placeholder = t('Search canvases...', '搜索画布...');
  const panel = document.getElementById('board-panel');
  if (panel && panel.classList.contains('is-canvas-library')) {
    syncCanvasLibraryScopePicker();
  }
  const agentTitle = document.querySelector('.board-agent-welcome strong');
  const toggle = document.getElementById('board-agent-toggle');
  if (agentTitle) agentTitle.textContent = 'Messs Agent';
  const agentSubtitle = document.querySelector('.board-agent-welcome span');
  if (agentSubtitle) agentSubtitle.textContent = t('Solve your problem.', '解决你的问题。');
  const input = document.getElementById('board-agent-input');
  if (toggle) toggle.textContent = 'Messs Agent';
  if (input) input.placeholder = t('Ask about this canvas...', '询问这个画布...');
  const historyTitle = document.querySelector('.board-agent-history-drawer > header strong');
  if (historyTitle) historyTitle.textContent = t('Agent history', 'Agent \u5386\u53f2\u8bb0\u5f55');
  const historyFavorites = document.getElementById('board-agent-history-favorites');
  if (historyFavorites) historyFavorites.textContent = t('Favorites', '\u6536\u85cf\u5939');
  const historyEmpty = document.getElementById('board-agent-history-empty');
  if (historyEmpty) historyEmpty.textContent = t('No conversations found', '\u6ca1\u6709\u627e\u5230\u5bf9\u8bdd');
  const send = document.getElementById('board-agent-submit');
  if (send) {
    send.title = t('Send', '发送');
    send.setAttribute('aria-label', send.title);
  }
  renderCanvasAgentContext();
  renderCanvasLibrary();
}

async function initCanvasWorkspace(initial) {
  AppState.canvasProjects = (Array.isArray(initial.canvasProjects) && initial.canvasProjects.length
    ? initial.canvasProjects
    : [{ id: 'project-1', name: 'General', scope: 'personal', createdAt: new Date().toISOString() }])
    .map(normalizeCanvasProject)
    .filter(Boolean);
  if (!AppState.canvasProjects.length) {
    AppState.canvasProjects = [normalizeCanvasProject({ id: 'project-1', name: 'General', scope: 'personal' })];
  }
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
    canvasId: item.canvasId || AppState.canvases[0].id,
    selected: false
  }));
  // Restore the canvas the user was working in. Generated media is stored
  // against that canvas, so always opening canvas-1 makes valid results look
  // like they disappeared after restarting the app.
  const lastOpenedCanvas = AppState.canvases
    .filter((canvas) => canvas && canvas.lastOpenedAt)
    .sort((a, b) => new Date(b.lastOpenedAt) - new Date(a.lastOpenedAt))[0];
  const detachedCanvas = CanvasWorkspace.detachedCanvasId
    ? AppState.canvases.find((canvas) => canvas.id === CanvasWorkspace.detachedCanvasId)
    : null;
  if (CanvasWorkspace.detachedCanvasId && !detachedCanvas) CanvasWorkspace.detachedCanvasId = '';
  AppState.activeCanvasId = (detachedCanvas || lastOpenedCanvas || AppState.canvases[0]).id;
  AppState.boardItems = AppState.allBoardItems.filter((item) => item.canvasId === AppState.activeCanvasId);
  const activeProject = AppState.canvasProjects.find((project) => project.id === (lastOpenedCanvas || AppState.canvases[0]).projectId);
  CanvasWorkspace.libraryScope = canvasProjectScope(activeProject);

  document.getElementById('canvas-new').addEventListener('click', promptNewCanvas);
  document.getElementById('canvas-header-new').addEventListener('click', promptNewCanvas);
  document.getElementById('canvas-import').addEventListener('click', promptImportCanvas);
  document.getElementById('canvas-project-new').addEventListener('click', promptNewProject);
  document.getElementById('canvas-library-back').addEventListener('click', showCanvasLibrary);
  document.getElementById('board-detach-window').addEventListener('click', () => {
    void openActiveCanvasInDetachedWindow();
  });
  if (window.messsAPI && typeof window.messsAPI.onCanvasItemsChanged === 'function') {
    window.messsAPI.onCanvasItemsChanged(applyRemoteCanvasItemsChange);
  }
  if (window.messsAPI && typeof window.messsAPI.onCanvasStateChanged === 'function') {
    window.messsAPI.onCanvasStateChanged(applyRemoteCanvasStateChange);
  }
  if (window.messsAPI && typeof window.messsAPI.onCanvasDetached === 'function') {
    window.messsAPI.onCanvasDetached(returnMainWindowToCanvasLibrary);
  }
  document.getElementById('canvas-library-search').addEventListener('input', (event) => {
    CanvasWorkspace.libraryQuery = event.target.value;
    renderCanvasLibrary();
  });
  document.getElementById('canvas-scope-picker').addEventListener('change', (event) => {
    selectCanvasLibraryScope(event.target.value);
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
  document.getElementById('board-agent-history').addEventListener('click', (event) => {
    event.stopPropagation();
    const drawer = document.getElementById('board-agent-history-drawer');
    toggleCanvasAgentHistory(drawer && drawer.hidden);
    event.currentTarget.setAttribute('aria-expanded', String(!!drawer && !drawer.hidden));
  });
  document.getElementById('board-agent-history-new').addEventListener('click', () => {
    startNewCanvasAgentChat();
    toggleCanvasAgentHistory(false);
    document.getElementById('board-agent-history').setAttribute('aria-expanded', 'false');
    document.getElementById('board-agent-input').focus();
  });
  document.getElementById('board-agent-history-favorites').addEventListener('click', (event) => {
    CanvasWorkspace.agentHistoryFavoritesOnly = !CanvasWorkspace.agentHistoryFavoritesOnly;
    event.currentTarget.setAttribute('aria-pressed', String(CanvasWorkspace.agentHistoryFavoritesOnly));
    renderCanvasAgentHistory();
  });
  document.getElementById('board-agent-history-date').addEventListener('change', (event) => {
    CanvasWorkspace.agentHistoryDate = String(event.target.value || '');
    renderCanvasAgentHistory();
  });
  document.getElementById('board-agent-history-date-clear').addEventListener('click', () => {
    CanvasWorkspace.agentHistoryDate = '';
    document.getElementById('board-agent-history-date').value = '';
    renderCanvasAgentHistory();
  });
  const modelTrigger = document.getElementById('board-agent-model-trigger');
  const modelMenu = document.getElementById('board-agent-model-menu');
  modelTrigger.addEventListener('click', () => {
    modelMenu.hidden = !modelMenu.hidden;
    modelTrigger.setAttribute('aria-expanded', String(!modelMenu.hidden));
    if (!modelMenu.hidden) renderCanvasAgentModels();
  });
  document.getElementById('board-agent-chat-options').addEventListener('click', (event) => {
    const option = event.target.closest('[data-agent-chat-model]');
    if (!option) return;
    CanvasWorkspace.agentMode = 'chat';
    CanvasWorkspace.agentChatProviderId = option.dataset.agentChatProviderId;
    CanvasWorkspace.agentChatModel = option.dataset.agentChatModel;
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
    if (!window.MesssFileDrop || !window.MesssFileDrop.hasFiles(event.dataTransfer)) return;
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
  renderCanvasAgentHistory();
  void loadCanvasAgentHistory();
  if (isDetachedCanvasWindow()) {
    document.body.classList.add('is-detached-canvas-window');
    document.title = `${activeCanvasRecord().name} - Messs.`;
    showCanvasWorkspace();
  } else {
    showCanvasLibrary();
  }
  refreshCanvasWorkspaceLanguage();
}
