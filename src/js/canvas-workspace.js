'use strict';

const CanvasWorkspace = {
  agentMessages: [],
  agentSessions: [],
  activeAgentSessionId: null,
  agentSessionViews: new Map(),
  agentRequestSessionId: null,
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
  draggingCanvasId: null,
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
  return openCanvasInDetachedWindow(activeCanvasRecord()?.id, launchPoint);
}

async function openCanvasInDetachedWindow(canvasId, launchPoint = {}) {
  if (isDetachedCanvasWindow() || CanvasWorkspace.detachInFlight) return { ok: true, reused: true };
  const canvas = AppState.canvases.find((entry) => entry.id === canvasId);
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

function isSystemCanvasProject(project) {
  if (!project) return false;
  if (project.system === true || project.isSystem === true || project.id === 'project-1') return true;
  const firstProject = AppState.canvasProjects && AppState.canvasProjects[0];
  const legacyName = String(project.name || '').trim().toLowerCase();
  return firstProject && firstProject.id === project.id && ['general', '常规', '新项目'].includes(legacyName);
}

function canvasProjectsForScope(scope = CanvasWorkspace.libraryScope) {
  return AppState.canvasProjects;
}

function canvasLibraryScopeLabel(scope = CanvasWorkspace.libraryScope) {
  return t('All Canvases', '全部画布', '모든 캔버스');
}

function canvasLibraryScopeDescription(scope = CanvasWorkspace.libraryScope) {
  return t('Browse and manage your canvases', '浏览和管理你的画布');
}

function appendCanvasProjectOptions(select, projects, selectedId = null) {
    projects.forEach((project) => {
      const option = document.createElement('option');
      option.value = project.id;
      option.textContent = project.name;
      option.selected = project.id === selectedId;
      select.appendChild(option);
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
    creditsCharged: agentRecordedCredits(message?.creditsCharged),
    content: String(message && message.content || '').slice(0, 16000),
    displayContent: String(message && ((message.displayContent ?? message.content) || '')).slice(0, 12000),
    generatedFiles: normalizeAgentGeneratedFiles(message && message.generatedFiles),
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
    unread: session.unread === true,
    memory: typeof normalizeAgentMemory === 'function' ? normalizeAgentMemory(session.memory) : { facts: [] },
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
    unread: false,
    memory: { facts: [] },
    messages: []
  };
  CanvasWorkspace.agentSessions.unshift(session);
  CanvasWorkspace.activeAgentSessionId = session.id;
  renderCanvasAgentHistory();
  return session;
}

function persistActiveCanvasAgentSession(sessionId, messages = CanvasWorkspace.agentMessages) {
  const session = sessionId ? CanvasWorkspace.agentSessions.find(entry => entry.id === sessionId) : ensureCanvasAgentSession();
  if (!session) return;
  session.messages = messages.map((message) => ({
    role: message.role === 'assistant' ? 'assistant' : 'user',
    creditsCharged: agentRecordedCredits(message.creditsCharged),
    content: String(message.content || '').slice(0, 16000),
    displayContent: String((message.displayContent ?? message.content) || '').slice(0, 12000),
    generatedFiles: normalizeAgentGeneratedFiles(message.generatedFiles),
    attachmentFileIds: Array.isArray(message.attachmentFileIds) ? message.attachmentFileIds.slice(0, 50) : [],
    attachments: Array.isArray(message.attachments) ? message.attachments.slice(0, 50).map((file) => ({
      id: file.id, name: file.name, mimeType: file.mimeType, sizeBytes: file.sizeBytes, kind: file.kind
    })) : []
  }));
  if (typeof updateAgentMemory === 'function') session.memory = updateAgentMemory(session.memory, session.messages);
  session.updatedAt = new Date().toISOString();
  session.unread = session.id !== CanvasWorkspace.activeAgentSessionId || session.canvasId !== activeCanvasId();
  if (!session.unread) CanvasWorkspace.agentMessages = messages;
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
  stashCanvasAgentConversation();
  CanvasWorkspace.activeAgentSessionId = null;
  CanvasWorkspace.agentMessages = [];
  clearCanvasAgentComposer();
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
  if (!entries.length) {
    const placeholder = document.createElement('div');
    placeholder.className = 'canvas-library-thumb is-empty is-empty-canvas';
    placeholder.textContent = t('Empty canvas', '空白画布');
    mosaic.appendChild(placeholder);
    return mosaic;
  }
  for (let index = 0; index < 5; index += 1) {
    const cell = document.createElement('div');
    cell.className = 'canvas-library-thumb';
    const entry = entries[index];
    if (!entry) {
      cell.classList.add('is-empty');
      if (index === 0) cell.textContent = t('Empty canvas', '空白画布');
    } else if (entry.kind === 'video') {
      const video = document.createElement('video');
      video.draggable = false;
      video.src = entry.src;
      video.muted = true;
      video.preload = 'metadata';
      video.setAttribute('aria-label', entry.name);
      cell.appendChild(video);
    } else {
      const image = document.createElement('img');
      image.draggable = false;
      image.src = entry.src;
      image.alt = entry.name;
      image.loading = 'lazy';
      cell.appendChild(image);
    }
    mosaic.appendChild(cell);
  }
  return mosaic;
}

function filteredCanvases(ignoreQuery = false) {
  const query = ignoreQuery ? '' : CanvasWorkspace.libraryQuery.trim().toLowerCase();
  const rootProjectIds = new Set(
    canvasProjectsForScope().filter(isSystemCanvasProject).map((project) => project.id)
  );
  return AppState.canvases
    .filter((canvas) => (CanvasWorkspace.libraryProjectId
      ? canvas.projectId === CanvasWorkspace.libraryProjectId
      : (!canvas.projectId || rootProjectIds.has(canvas.projectId)))
      && (!query || canvas.name.toLowerCase().includes(query)))
    // Canvas order follows the user's open history. A newly created canvas is
    // opened immediately, so it naturally becomes the first card as well.
    .sort((a, b) => new Date(b.lastOpenedAt || b.updatedAt || b.createdAt || 0)
      - new Date(a.lastOpenedAt || a.updatedAt || a.createdAt || 0));
}

function filteredCanvasProjects(ignoreQuery = false) {
  const query = ignoreQuery ? '' : CanvasWorkspace.libraryQuery.trim().toLowerCase();
  if (CanvasWorkspace.libraryProjectId) return [];
  return AppState.canvasProjects
    .filter((project) => !isSystemCanvasProject(project))
    .filter((project) => !query || project.name.toLowerCase().includes(query));
}

function canvasLibraryOrderedEntries(ignoreQuery = false) {
  return [
    ...filteredCanvasProjects(ignoreQuery).map((record) => ({ key: `folder:${record.id}`, record })),
    ...filteredCanvases(ignoreQuery).map((record) => ({ key: `canvas:${record.id}`, record }))
  ];
}

let canvasLibraryShiftPreview = null;
function resetCanvasLibraryShiftPreview() {
  if (!canvasLibraryShiftPreview) return;
  for (const node of canvasLibraryShiftPreview.nodes) {
    node.style.removeProperty('translate');
    node.classList.remove('is-reorder-shifting');
  }
  canvasLibraryShiftPreview = null;
}
function previewCanvasLibraryShift(sourceKey, targetKey, after) {
  const grid = document.getElementById('canvas-library-grid');
  if (!grid) return;
  if (!canvasLibraryShiftPreview) {
    const nodes = [...grid.children].filter(node=>node.dataset.libraryKey);
    canvasLibraryShiftPreview = {nodes, rects:nodes.map(node=>node.getBoundingClientRect()), signature:''};
  }
  const state=canvasLibraryShiftPreview;
  const signature=sourceKey+'|'+targetKey+'|'+after;
  if (state.signature===signature) return;
  state.signature=signature;
  const order=[...state.nodes], source=order.find(n=>n.dataset.libraryKey===sourceKey), target=order.find(n=>n.dataset.libraryKey===targetKey);
  if (!source||!target||source===target) return;
  order.splice(order.indexOf(source),1);order.splice(order.indexOf(target)+Number(after),0,source);
  order.forEach((node,index)=>{
    const from=state.rects[state.nodes.indexOf(node)],to=state.rects[index];
    node.classList.add('is-reorder-shifting');
    node.style.translate=(to.left-from.left)+'px '+(to.top-from.top)+'px';
  });
}
function canvasLibraryDragRect(card) {
  const state=canvasLibraryShiftPreview, index=state?.nodes.indexOf(card);
  return index>=0 ? state.rects[index] : card.getBoundingClientRect();
}

function clearCanvasLibraryDropIndicators() {
  document.querySelectorAll('[data-library-drop]').forEach((node) => { delete node.dataset.libraryDrop; });
}

async function reorderCanvasLibrary(sourceKey, targetKey, after) {
  if (CanvasWorkspace.libraryOrderSaving || sourceKey === targetKey) return;
  resetCanvasLibraryShiftPreview();
  const entries = canvasLibraryOrderedEntries(true);
  const source = entries.find((entry) => entry.key === sourceKey);
  const target = entries.find((entry) => entry.key === targetKey);
  if (!source || !target) return;
  const previous = entries.map(({ record }) => [record, record.libraryOrder]);
  entries.splice(entries.indexOf(source), 1);
  entries.splice(entries.indexOf(target) + Number(after), 0, source);
  entries.forEach(({ record }, index) => { record.libraryOrder = index; });
  CanvasWorkspace.libraryOrderSaving = true;
  renderCanvasLibrary();
  try { await canvasWorkspaceSave(); }
  catch (error) {
    previous.forEach(([record, order]) => { record.libraryOrder = order; });
    showToast(error.message || t('Could not save order.', '无法保存排序。'), 'Canvas');
  } finally {
    CanvasWorkspace.libraryOrderSaving = false;
    renderCanvasLibrary();
  }
}

function bindCanvasLibraryReorder(card, key, folder = false) {
  card.dataset.libraryKey = key;
  card.draggable = true;
  let press = null, suppressClick = false;
  card.addEventListener('click', event => {
    if (!suppressClick) return;
    suppressClick = false; event.preventDefault(); event.stopImmediatePropagation();
  }, true);
  card.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('button,input,select') || CanvasWorkspace.libraryOrderSaving) return;
    const controller = new AbortController();
    const state = press = { x:event.clientX, y:event.clientY, active:false, ghost:null, target:null, after:false };
    const finish = cancel => {
      clearTimeout(timer); controller.abort(); state.ghost?.remove();
      card.classList.remove('is-longpress-dragging'); clearCanvasLibraryDropIndicators();
      if (state.active) suppressClick = true;
      press = null;
      resetCanvasLibraryShiftPreview();
      if (!cancel && state.active && state.target) void reorderCanvasLibrary(key,state.target,state.after);
    };
    const timer = setTimeout(() => {
      if (!card.isConnected) { finish(true); return; }
      state.active = true;
      const rect = card.getBoundingClientRect();
      const ghost = state.ghost = card.cloneNode(true);
      ghost.removeAttribute('id'); ghost.removeAttribute('data-library-key');
      ghost.setAttribute('aria-hidden','true');
      Object.assign(ghost.style,{position:'fixed',left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,height:`${rect.height}px`,margin:'0',pointerEvents:'none',zIndex:'10000',opacity:'.85'});
      state.left=rect.left; state.top=rect.top;
      document.body.append(ghost); card.classList.add('is-longpress-dragging');
    }, 350);
    window.addEventListener('pointermove', move => {
      if (!state.active) { if (Math.hypot(move.clientX-state.x,move.clientY-state.y)>7) finish(true); return; }
      move.preventDefault();
      state.ghost.style.transform=`translate(${move.clientX-state.x}px,${move.clientY-state.y}px)`;
      const grid=card.parentElement;
      const candidates=Array.from(grid.children).filter(node=>node!==card && node.dataset.libraryKey);
      let nearest=null, distance=Infinity;
      for (const node of candidates) {
        const r=canvasLibraryDragRect(node);
        const d=Math.hypot(move.clientX-(r.left+r.width/2),move.clientY-(r.top+r.height/2));
        if(d<distance){distance=d;nearest=node;}
      }
      clearCanvasLibraryDropIndicators();state.target=null;
      const area=grid.getBoundingClientRect();
      if(nearest && move.clientX>=area.left && move.clientX<=area.right && move.clientY>=area.top && move.clientY<=area.bottom){
        const r=canvasLibraryDragRect(nearest);state.target=nearest.dataset.libraryKey;state.after=move.clientX>r.left+r.width/2;
        nearest.dataset.libraryDrop=state.after?'after':'before';
        previewCanvasLibraryShift(key,state.target,state.after);
      }
    },{passive:false,signal:controller.signal});
    window.addEventListener('pointerup',()=>finish(false),{once:true,signal:controller.signal});
    window.addEventListener('pointercancel',()=>finish(true),{once:true,signal:controller.signal});
    window.addEventListener('blur',()=>finish(true),{once:true,signal:controller.signal});
    window.addEventListener('keydown',e=>{if(e.key==='Escape')finish(true);},{signal:controller.signal});
  });
  card.addEventListener('dragstart', (event) => {
    if (press?.active) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    if (CanvasWorkspace.libraryOrderSaving || event.target.closest('input')) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    if (!event.dataTransfer) return;
    CanvasWorkspace.libraryDragKey = key;
    event.dataTransfer.setData('text/messs-library-key', key);
    event.dataTransfer.effectAllowed = 'move';
  }, true);
  card.addEventListener('dragend', () => {
    CanvasWorkspace.libraryDragKey = null;
    resetCanvasLibraryShiftPreview();
    clearCanvasLibraryDropIndicators();
  });
  const position = (event) => {
    const source = CanvasWorkspace.libraryDragKey;
    if (!source || source === key || CanvasWorkspace.libraryOrderSaving) return null;
    const rect = canvasLibraryDragRect(card);
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    if (folder && source.startsWith('canvas:') && x > .25 && x < .75 && y > .2 && y < .8) return 'inside';
    return x >= .5 ? 'after' : 'before';
  };
  card.addEventListener('dragover', (event) => {
    const mode = position(event);
    clearCanvasLibraryDropIndicators();
    if (mode === 'inside') { resetCanvasLibraryShiftPreview(); return; }
    event.stopImmediatePropagation();
    card.classList.remove('is-drop-target');
    if (!mode) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    card.dataset.libraryDrop = mode;
    previewCanvasLibraryShift(CanvasWorkspace.libraryDragKey,key,mode==='after');
  }, true);
  card.addEventListener('dragleave', (event) => {
    if (!card.contains(event.relatedTarget)) delete card.dataset.libraryDrop;
  });
  card.addEventListener('drop', (event) => {
    const mode = position(event);
    clearCanvasLibraryDropIndicators();
    if (mode === 'inside') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (mode) void reorderCanvasLibrary(CanvasWorkspace.libraryDragKey, key, mode === 'after');
    CanvasWorkspace.libraryDragKey = null;
  }, true);
}

function bindCanvasLibraryInlineRename(title, record, rename) {
  title.addEventListener('click', (event) => event.stopPropagation());
  title.addEventListener('dblclick', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (title.querySelector('input')) return;
    const card = title.closest('article');
    const wasDraggable = card && card.draggable;
    if (card) card.draggable = false;
    const input = document.createElement('input');
    input.className = 'canvas-library-rename-input';
    input.value = record.name;
    input.setAttribute('aria-label', t('Name', '名称'));
    input.draggable = false;
    title.replaceChildren(input);
    let finished = false;
    const finish = async (cancel) => {
      if (finished) return;
      finished = true;
      const name = input.value.trim();
      if (card) card.draggable = wasDraggable;
      title.textContent = record.name;
      if (!cancel && name && name !== record.name) {
        try { await rename(name); }
        catch (error) { showToast(error.message || t('Rename failed.', '重命名失败。'), 'Canvas'); }
      }
      title.textContent = record.name;
      title.title = record.name;
    };
    input.addEventListener('keydown', (keyEvent) => {
      keyEvent.stopPropagation();
      if (keyEvent.isComposing) return;
      if (keyEvent.key === 'Enter' || keyEvent.key === 'Escape') {
        keyEvent.preventDefault();
        void finish(keyEvent.key === 'Escape');
      }
    });
    input.addEventListener('blur', () => { void finish(false); });
    input.addEventListener('dragstart', (dragEvent) => { dragEvent.preventDefault(); dragEvent.stopPropagation(); });
    input.focus();
    input.select();
  });
}

function buildCanvasLibraryFolderCard(project) {
  const card = document.createElement('article');
  card.className = 'canvas-library-folder-card';
  card.dataset.projectId = project.id;
  card.dataset.libraryKey = `folder:${project.id}`;
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', t(`Open folder ${project.name}`, `打开文件夹“${project.name}”`));

  const icon = document.createElement('span');
  icon.className = 'canvas-library-folder-icon';
  const folderImage = document.createElement('img');
  folderImage.src = 'assets/canvas-folder-brand-3d.png';
  folderImage.alt = '';
  folderImage.width = 128;
  folderImage.height = 128;
  folderImage.draggable = false;
  icon.appendChild(folderImage);
  const title = document.createElement('strong');
  title.className = 'canvas-library-folder-title';
  title.textContent = project.name;
  bindCanvasLibraryInlineRename(title, project, (name) => promptRenameCanvasProject(project.id, name));
  const canvasCount = AppState.canvases.filter((canvas) => canvas.projectId === project.id).length;
  card.title = t(`${canvasCount} canvas${canvasCount === 1 ? '' : 'es'}`, `${canvasCount} 个画布`);

  card.append(icon, title);
  card.addEventListener('click', () => {
    CanvasWorkspace.libraryProjectId = project.id;
    CanvasWorkspace.libraryQuery = '';
    const search = document.getElementById('canvas-library-search');
    if (search) search.value = '';
    const clear = document.getElementById('canvas-library-search-clear');
    if (clear) clear.hidden = true;
    renderCanvasLibrary();
  });
  card.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    card.click();
  });
  card.addEventListener('contextmenu', (event) => {
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
  card.addEventListener('dragover', (event) => {
    if (!event.dataTransfer || !event.dataTransfer.types.includes('text/messs-canvas-id')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    card.classList.add('is-drop-target');
  });
  card.addEventListener('dragleave', (event) => {
    if (event.relatedTarget && card.contains(event.relatedTarget)) return;
    card.classList.remove('is-drop-target');
  });
  card.addEventListener('drop', (event) => {
    event.preventDefault();
    event.stopPropagation();
    card.classList.remove('is-drop-target');
    const canvasId = event.dataTransfer && event.dataTransfer.getData('text/messs-canvas-id');
    if (canvasId) void moveCanvasToProject(canvasId, project.id, { notify: true });
  });
  return card;
}

function renderCanvasProjectList(list) {
  if (!list) return;
  list.innerHTML = '';
  canvasProjectsForScope().filter((project) => !isSystemCanvasProject(project)).forEach((project) => {
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

function renderCanvasLibraryProjects() {
  renderCanvasProjectList(document.getElementById('canvas-library-projects'));
  renderCanvasProjectList(document.getElementById('sidebar-project-list'));
  document.querySelectorAll('[data-sidebar-project-scope]').forEach((button) => {
    const active = normalizeCanvasProjectScope(button.dataset.sidebarProjectScope) === CanvasWorkspace.libraryScope;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
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

let canvasCardDensityObserver = null;
let canvasCardTextMeasure = null;

function syncCanvasCardDensity(headers) {
  const textWidth = element => {
    canvasCardTextMeasure ||= document.createElement('canvas').getContext('2d');
    const style = getComputedStyle(element);
    canvasCardTextMeasure.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    return canvasCardTextMeasure.measureText(element.textContent).width;
  };
  const changes = headers.map(header => {
    const title = header.querySelector('.canvas-library-card-title');
    const menu = header.querySelector('.canvas-library-card-menu-trigger');
    const pin = header.querySelector('.canvas-library-card-pin');
    if (!title || !menu || !pin || !header.clientWidth) return null;
    const gap = parseFloat(getComputedStyle(header).gap) || 0;
    const pinWidth = parseFloat(getComputedStyle(pin).flexBasis) || 22;
    const hidePin = textWidth(title) > header.clientWidth - menu.offsetWidth - pinWidth - gap * 2;
    const meta = header.parentElement.querySelector('.canvas-library-card-meta');
    const labels = meta ? [...meta.children] : [];
    const hideMeta = labels.length === 2 && labels.reduce((sum, el) => sum + textWidth(el), 0) + (parseFloat(getComputedStyle(meta).gap) || 0) > meta.clientWidth;
    return { header, hidePin, meta, hideMeta };
  });
  changes.filter(Boolean).forEach(({ header, hidePin, meta, hideMeta }) => {
    header.classList.toggle('is-title-priority', hidePin);
    meta?.classList.toggle('is-time-priority', hideMeta);
  });
}

function observeCanvasCardDensity(grid) {
  canvasCardDensityObserver?.disconnect();
  if (typeof ResizeObserver === 'undefined') return;
  canvasCardDensityObserver = new ResizeObserver(entries => {
    const headers = [...new Set(entries.map(entry => entry.target.closest('.canvas-library-card-header') || entry.target.parentElement.querySelector('.canvas-library-card-header')).filter(Boolean))];
    syncCanvasCardDensity(headers);
  });
  grid.querySelectorAll('.canvas-library-card-header, .canvas-library-card-title, .canvas-library-card-meta').forEach(element => canvasCardDensityObserver.observe(element));
}

function renderCanvasLibrary() {
  const grid = document.getElementById('canvas-library-grid');
  if (!grid) return;
  const canvases = filteredCanvases();
  const projects = filteredCanvasProjects();
  canvasCardDensityObserver?.disconnect();
  grid.innerHTML = '';
  projects.forEach((project) => grid.appendChild(buildCanvasLibraryFolderCard(project)));
  const folderBack = document.getElementById('canvas-library-folder-back');
  const folder = CanvasWorkspace.libraryProjectId
    ? AppState.canvasProjects.find((project) => project.id === CanvasWorkspace.libraryProjectId)
    : null;
  if (folderBack) {
    folderBack.hidden = !folder;
    folderBack.querySelector('span').textContent = t('All canvases', '全部画布');
  }
  const heading = document.getElementById('canvas-library-heading');
  if (heading) heading.textContent = folder ? folder.name : t('All Canvases', '全部画布');
  const subtitle = document.querySelector('.canvas-library-topline p');
  if (subtitle) subtitle.textContent = folder
    ? t('Canvas files in this folder', '此文件夹中的画布文件')
    : t('Browse and manage your canvases', '浏览和管理你的画布');
  canvases.forEach((canvas) => {
    const project = AppState.canvasProjects.find((entry) => entry.id === canvas.projectId);
    const card = document.createElement('article');
    card.className = 'canvas-library-card';
    card.classList.toggle('is-pinned', canvas.pinned === true);
    card.dataset.canvasId = canvas.id;
    card.draggable = true;
    card.tabIndex = 0;
    card.setAttribute('role', 'button');

    const title = document.createElement('div');
    title.className = 'canvas-library-card-title';
    title.textContent = canvas.name;
    title.title = canvas.name;

    const meta = document.createElement('div');
    meta.className = 'canvas-library-card-meta';
    const projectName = document.createElement('span');
    projectName.textContent = !project || isSystemCanvasProject(project)
      ? ''
      : project.name;
    const updated = document.createElement('span');
    updated.textContent = relativeCanvasTime(canvas.updatedAt || canvas.createdAt);
    if (projectName.textContent) meta.append(projectName);
    meta.append(updated);
    meta.title = [projectName.textContent, updated.textContent].filter(Boolean).join(' · ');

    const pinBadge = document.createElement('button');
    pinBadge.type = 'button';
    pinBadge.className = 'canvas-library-card-pin';
    pinBadge.title = t('Unpin canvas', '取消置顶');
    pinBadge.setAttribute('aria-label', pinBadge.title);
    pinBadge.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 3h8l-1 5 3 4H6l3-4z"/><path d="M12 12v9"/></svg>';
    pinBadge.hidden = canvas.pinned !== true;
    pinBadge.addEventListener('pointerdown', event => event.stopPropagation());
    pinBadge.addEventListener('keydown', event => event.stopPropagation());
    pinBadge.addEventListener('dragstart', event => { event.preventDefault(); event.stopPropagation(); });
    pinBadge.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation();
      if (canvas.pinned === true) toggleCanvasPinned(canvas.id);
    });

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
    const inFolder = Boolean(project && !isSystemCanvasProject(project));
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
        label: inFolder ? t('Move out of folder', '移出文件夹') : t('Move to folder', '移动到文件夹'),
        icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/><path d="M8 13h8M13 10l3 3-3 3"/></svg>'
      },
      {
        action: 'export',
        label: t('Export canvas', '导出画布'),
        icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>'
      },
      {
        action: 'usage',
        label: t('View points usage', '查看积分用量'),
        icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 3v18h18M7 14v3M12 9v8M17 5v12"/></svg>'
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
      if (button.dataset.canvasAction === 'move-folder') {
        if (inFolder) moveCanvasOutOfFolder(canvas.id);
        else promptMoveCanvasToFolder(canvas.id);
      }
      if (button.dataset.canvasAction === 'export') exportCanvasFile(canvas.id);
      if (button.dataset.canvasAction === 'usage') void openCanvasUsageDetails(canvas.id);
      if (button.dataset.canvasAction === 'delete') promptDeleteCanvas(canvas.id);
      if (button.dataset.canvasAction === 'toggle-pin') toggleCanvasPinned(canvas.id);
    });

    const header = document.createElement('div');
    header.className = 'canvas-library-card-header';
    header.append(title, pinBadge, menuTrigger);
    bindCanvasLibraryInlineRename(title, canvas, (name) => promptRenameCanvas(canvas.id, name));
    card.append(header, meta, buildCanvasMosaic(canvas), menu);
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
        ...(isSystemCanvasProject(AppState.canvasProjects.find((project) => project.id === canvas.projectId)) ? [] : [{
          label: t('Move out of folder', '移出文件夹'),
          icon: 'M3 7h18M12 10v8m-3-4 3 4 3-4',
          action: () => moveCanvasOutOfFolder(canvas.id)
        }]),
        {
          label: t('Move to folder', '移动到文件夹'),
          icon: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z;M8 13h8M13 10l3 3-3 3',
          action: () => inFolder ? moveCanvasOutOfFolder(canvas.id) : promptMoveCanvasToFolder(canvas.id)
        }
      ], event.clientX, event.clientY, 'canvas-card-context-menu');
    });
    card.addEventListener('click', () => switchCanvas(canvas.id, { enterWorkspace: true }));
    let tearOffDrag = null;
    card.addEventListener('dragstart', (event) => {
      if (!event.dataTransfer || card.querySelector('.canvas-library-rename-input')) {
        event.preventDefault();
        return;
      }
      CanvasWorkspace.draggingCanvasId = canvas.id;
      tearOffDrag?.controller.abort();
      const controller = new AbortController();
      const drag = tearOffDrag = { controller, canceled: false, dropped: false };
      window.addEventListener('keydown', (keyEvent) => {
        if (keyEvent.key === 'Escape') drag.canceled = true;
      }, { capture: true, signal: controller.signal });
      window.addEventListener('drop', () => { drag.dropped = true; }, { capture: true, signal: controller.signal });
      card.classList.add('is-dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/messs-canvas-id', canvas.id);
      const rect = card.getBoundingClientRect();
      event.dataTransfer.setDragImage(card, event.clientX - rect.left, event.clientY - rect.top);
    });
    card.addEventListener('dragend', (event) => {
      const drag = tearOffDrag;
      tearOffDrag = null;
      drag?.controller.abort();
      CanvasWorkspace.draggingCanvasId = null;
      card.classList.remove('is-dragging');
      document.querySelectorAll('.canvas-library-folder-card.is-drop-target').forEach((folderCard) => {
        folderCard.classList.remove('is-drop-target');
      });
      // Native dragend supplies screen coordinates even when released outside the window.
      const x = event.screenX, y = event.screenY;
      const outside = x < window.screenX || y < window.screenY
        || x >= window.screenX + window.outerWidth || y >= window.screenY + window.outerHeight;
      if (drag && !drag.canceled && !drag.dropped && outside
        && (x !== 0 || y !== 0) && event.dataTransfer?.dropEffect === 'none') {
        void openCanvasInDetachedWindow(canvas.id, { x, y });
      }
    });
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        switchCanvas(canvas.id, { enterWorkspace: true });
      }
    });
    grid.appendChild(card);
  });
  observeCanvasCardDensity(grid);
  const empty = document.getElementById('canvas-library-empty');
  if (empty) {
    empty.hidden = canvases.length > 0 || projects.length > 0 || Boolean(CanvasWorkspace.libraryQuery.trim());
    if (!empty.hidden) {
      empty.textContent = t('No canvases found', '没有找到画布');
    }
  }
}

function selectAllCanvasLibraryItems() {
  CanvasWorkspace.libraryProjectId = null;
  CanvasWorkspace.libraryQuery = '';
  const search = document.getElementById('canvas-library-search');
  if (search) search.value = '';
  const clear = document.getElementById('canvas-library-search-clear');
  if (clear) clear.hidden = true;
  renderCanvasLibrary();
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
  if (picker) {
    picker.hidden = true;
  }
  const heading = document.getElementById('canvas-library-heading');
  if (heading) heading.textContent = t('All Canvases', '全部画布', '모든 캔버스');
  const subtitle = document.querySelector('.canvas-library-topline p');
  if (subtitle) subtitle.textContent = t('Browse and manage your canvases', '浏览和管理你的画布');
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
  const canvasSettings = document.getElementById('board-canvas-settings');
  canvasSettings.hidden = true;
  document.getElementById('board-canvas-settings-popover').hidden = true;
  document.getElementById('board-settings-toggle').classList.remove('is-active');
  document.getElementById('board-settings-toggle').setAttribute('aria-expanded', 'false');
  document.getElementById('board-settings-shortcuts').setAttribute('aria-expanded', 'false');
  document.getElementById('shortcuts-popover')?.remove();
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
  document.getElementById('board-canvas-settings').hidden = false;
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
  allowEmpty = false,
  confirmLabel = t('Create', '创建')
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
        <div class="canvas-name-dialog-actions">
          <button type="button" class="pill-btn pill-btn-ghost canvas-name-cancel">${escapeHtml(t('Cancel', '取消'))}</button>
          <button type="submit" class="pill-btn canvas-name-confirm">${escapeHtml(confirmLabel)}</button>
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
      const projectOptions = canvasProjectsForScope();
      appendCanvasProjectOptions(projectSelect, projectOptions, projectId || null);
      projectSelect.value = projectId || (projectOptions[0] && projectOptions[0].id) || '';
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
      if (!value && !allowEmpty) {
        input.focus();
        return;
      }
      close({
        name: value,
        projectId: projectSelect.value || projectId
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
    const populatedProjects = AppState.canvasProjects.filter((project) => {
      const hasCanvas = AppState.canvases.some((canvas) => canvas.projectId === project.id);
      return hasCanvas || project.id === projectId;
    });
    appendCanvasProjectOptions(select, populatedProjects, projectId || null);
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
    lastOpenedAt: now,
    updatedAt: now
  };
  AppState.canvases.push(canvas);
  AppState.allBoardItems.forEach((item) => { item.selected = false; });
  await canvasWorkspaceSave();
  switchCanvas(canvas.id, { enterWorkspace: true });
  if (typeof openAiComposerForSelection === 'function') {
    await openAiComposerForSelection('image');
  }
}

async function promptNewCanvas() {
  const active = activeCanvasRecord();
  const selectedProjectRecord = AppState.canvasProjects.find((project) => project.id === CanvasWorkspace.libraryProjectId);
  const activeProject = AppState.canvasProjects.find((project) => active && project.id === active.projectId);
  const scopedProjects = canvasProjectsForScope();
  const rootProject = scopedProjects.find(isSystemCanvasProject);
  const scopedProject = rootProject || scopedProjects[0];
  const selectedProject = selectedProjectRecord
    ? selectedProjectRecord.id
    : (!CanvasWorkspace.libraryProjectId && rootProject
      ? rootProject.id
      : (activeProject
      ? activeProject.id
      : (scopedProject && scopedProject.id)));
  if (!selectedProject) {
    showToast(
      t('Create a folder first, then create a canvas.', '请先创建文件夹，再新建画布。'),
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

// The prominent entry point remains the one-click canvas flow. The compact
// toolbar action creates folders for organizing those canvases.
async function startCreatingCanvas() {
  const scopedProjects = canvasProjectsForScope();
  const project = scopedProjects.find(isSystemCanvasProject) || scopedProjects[0];
  if (!project) {
    showToast(t('Unable to create a canvas right now.', '暂时无法新建画布。'), 'Canvas');
    return;
  }
  await createCanvasForProject(project.id, t('Untitled', '未命名'));
}

async function promptNewProject() {
  const result = await showCanvasTextDialog({
    title: t('New folder', '新建文件夹'),
    label: t('Folder name', '文件夹名称'),
    initialValue: t('New folder', '新文件夹')
  });
  if (!result) return;
  const project = {
    id: `project-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: uniqueCanvasProjectName(result.name),
    scope: 'personal',
    createdAt: new Date().toISOString()
  };
  const previousProjects = AppState.canvasProjects;
  AppState.canvasProjects = [...previousProjects, project];
  try {
    await canvasWorkspaceSave();
    // Keep the all-items view open so the new folder is visible immediately.
    CanvasWorkspace.libraryScope = project.scope;
    CanvasWorkspace.libraryProjectId = null;
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

async function promptRenameCanvasProject(projectId, inlineName) {
  const project = AppState.canvasProjects.find((entry) => entry.id === projectId);
  if (!project) return;
  const result = typeof inlineName === 'string' ? { name: inlineName } : await showCanvasTextDialog({
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

async function moveCanvasOutOfFolder(canvasId) {
  const canvas = AppState.canvases.find((entry) => entry.id === canvasId);
  const target = AppState.canvasProjects.find((entry) => isSystemCanvasProject(entry));
  if (!canvas || !target || canvas.projectId === target.id) return;
  await moveCanvasToProject(canvasId, target.id, { notify: true });
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
  await moveCanvasToProject(canvasId, projectId, { notify: true });
}

async function moveCanvasToProject(canvasId, projectId, { notify = false } = {}) {
  const canvas = AppState.canvases.find((entry) => entry.id === canvasId);
  const project = AppState.canvasProjects.find((entry) => entry.id === projectId);
  if (!canvas || !project || canvas.projectId === project.id) return false;
  const previousProjectId = canvas.projectId;
  const previousUpdatedAt = canvas.updatedAt;
  canvas.projectId = project.id;
  canvas.updatedAt = new Date().toISOString();
  try {
    await canvasWorkspaceSave();
    renderCanvasWorkspaceControls();
    if (notify) showToast(t('Canvas moved to folder.', '画布已移动到文件夹。'), 'Canvas');
    return true;
  } catch (err) {
    canvas.projectId = previousProjectId;
    canvas.updatedAt = previousUpdatedAt;
    renderCanvasWorkspaceControls();
    if (notify) showToast(err && err.message ? err.message : t('Canvas move failed.', '画布移动失败。'), 'Canvas');
    return false;
  }
}

async function promptImportCanvas() {
  const scopedProjects = canvasProjectsForScope();
  if (!scopedProjects.length) {
    showToast(
      t('Create a folder before importing a canvas.', '请先创建文件夹，再导入画布。'),
      'Canvas'
    );
    return;
  }
  const active = activeCanvasRecord();
  const activeProject = AppState.canvasProjects.find((project) => active && project.id === active.projectId);
  const selectedProject = AppState.canvasProjects.find((project) => project.id === CanvasWorkspace.libraryProjectId);
  const targetProjectId = selectedProject
    ? selectedProject.id
    : (activeProject
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

  const fallback = AppState.canvasProjects.find((entry) => entry.id !== projectId && isSystemCanvasProject(entry))
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

async function promptRenameCanvas(canvasId = activeCanvasId(), inlineName) {
  const canvas = AppState.canvases.find((entry) => entry.id === canvasId);
  if (!canvas) return;
  const result = typeof inlineName === 'string' ? { name: inlineName } : await showCanvasTextDialog({
    title: t('Rename canvas', '重命名画布'),
    label: t('Canvas name', '画布名称'),
    initialValue: canvas.name
  });
  if (!result) return;
  const previousName = canvas.name;
  const previousUpdatedAt = canvas.updatedAt;
  canvas.name = uniqueCanvasName(result.name, canvas.id);
  canvas.updatedAt = new Date().toISOString();
  try {
    await canvasWorkspaceSave();
  } catch (error) {
    canvas.name = previousName;
    canvas.updatedAt = previousUpdatedAt;
    renderCanvasWorkspaceControls();
    throw error;
  }
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

function stashCanvasAgentConversation() {
  const id = CanvasWorkspace.activeAgentSessionId;
  const list = document.getElementById('board-agent-messages');
  if (!id || !list) return;
  const fragment = document.createDocumentFragment();
  while (list.firstChild) fragment.append(list.firstChild);
  CanvasWorkspace.agentSessionViews.set(id, fragment);
  for (const key of CanvasWorkspace.agentSessionViews.keys()) {
    if (CanvasWorkspace.agentSessionViews.size <= 6) break;
    if (key !== id && key !== CanvasWorkspace.agentRequestSessionId) CanvasWorkspace.agentSessionViews.delete(key);
  }
}

function clearCanvasAgentComposer() {
  const input = document.getElementById('board-agent-input');
  if (input) input.value = '';
  CanvasWorkspace.agentReferenceFileIds.clear();
  CanvasWorkspace.agentSelectionFileIds.clear();
  renderCanvasAgentReferences();
}

function appendCanvasAgentMessage(role, text, sessionId = CanvasWorkspace.activeAgentSessionId) {
  const visible = sessionId === CanvasWorkspace.activeAgentSessionId;
  let list = visible ? document.getElementById('board-agent-messages') : CanvasWorkspace.agentSessionViews.get(sessionId);
  if (!list && !visible) {
    list = document.createDocumentFragment();
    CanvasWorkspace.agentSessionViews.set(sessionId, list);
  }
  if (!list) return;
  const welcome = document.getElementById('board-agent-welcome');
  if (welcome && visible) welcome.hidden = true;
  const row = document.createElement('div');
  row.className = `board-agent-message is-${role}`;
  row._questionSession = sessionId;
  if (role === 'assistant') renderAgentMessageContent(row, text);
  else row.textContent = typeof agentVisibleUserText === 'function' ? agentVisibleUserText(text) : text;
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
    row.draggable = true;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'board-agent-history-item';
    button.classList.toggle('is-active', session.id === CanvasWorkspace.activeAgentSessionId);
    button.innerHTML = `<span class="board-agent-history-star" aria-hidden="true">${session.favorite ? '\u2605' : ''}</span><span class="board-agent-history-copy"><b></b><small></small></span><span class="board-agent-history-unread" aria-hidden="true"></span>`;
    button.classList.toggle('is-unread', session.unread === true);
    button.querySelector('b').textContent = session.title || t('New conversation', '\u65b0\u5bf9\u8bdd');
    button.querySelector('small').textContent = session.unread
      ? t('Unread', '未读')
      : t('Recent', '最近');
    button.addEventListener('click', () => loadCanvasAgentSession(session.id));
    row.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      showCanvasAgentSessionMenu(session.id, event.clientX, event.clientY);
    });
    row.addEventListener('dragstart', (event) => {
      event.dataTransfer.setData('text/messs-agent-session', session.id);
      event.dataTransfer.effectAllowed = 'move';
      row.classList.add('is-dragging');
    });
    row.addEventListener('dragend', () => row.classList.remove('is-dragging'));
    row.addEventListener('dragover', (event) => {
      if (!event.dataTransfer.types.includes('text/messs-agent-session')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      row.classList.add('is-drop-target');
    });
    row.addEventListener('dragleave', () => row.classList.remove('is-drop-target'));
    row.addEventListener('drop', (event) => {
      event.preventDefault();
      row.classList.remove('is-drop-target');
      const draggedId = event.dataTransfer.getData('text/messs-agent-session');
      const dragged = CanvasWorkspace.agentSessions.find((entry) => entry.id === draggedId);
      if (!dragged) return;
      dragged.favorite = true;
      dragged.unread = false;
      persistCanvasAgentHistory();
      renderCanvasAgentHistory();
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
  if (sessionId === CanvasWorkspace.activeAgentSessionId) return;
  stashCanvasAgentConversation();
  clearCanvasAgentComposer();
  CanvasWorkspace.activeAgentSessionId = session.id;
  session.unread = false;
  persistCanvasAgentHistory();
  CanvasWorkspace.agentMessages = session.messages.map((message) => ({ ...message }));
  const list = document.getElementById('board-agent-messages');
  if (!list) return;
  list.replaceChildren();
  const cached = CanvasWorkspace.agentSessionViews.get(sessionId);
  if (cached) list.append(cached);
  else CanvasWorkspace.agentMessages.forEach((message) => {
    const row = appendCanvasAgentMessage(message.role, message.displayContent || message.content);
    appendCanvasAgentAttachments(row, Array.isArray(message.attachments) ? message.attachments : []);
    appendAssistantOutputFiles(row, message.generatedFiles);
    appendAgentCharge(row, message);
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
      label: session.unread ? t('Mark as read', '标记为已读') : t('Mark as unread', '标记为未读'),
      icon: 'M3 5h18v14H3z;M3 7l9 6 9-6',
      action: () => {
        session.unread = !session.unread;
        persistCanvasAgentHistory();
        renderCanvasAgentHistory();
      }
    },
    {
      label: t('Rename', '重命名'),
      icon: 'M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4',
      action: () => renameCanvasAgentSession(sessionId)
    },
    {
      label: t('Delete', '删除'),
      icon: 'M4 7h16M9 7V4h6v3M7 7l1 14h8l-1-14',
      danger: true,
      action: () => deleteCanvasAgentSession(sessionId)
    },
    {
      label: t('Open conversation', '\u6253\u5f00\u5bf9\u8bdd'),
      icon: 'M4 5h16v12H8l-4 3V5z',
      action: () => loadCanvasAgentSession(session.id)
    }
  ], x, y, 'board-agent-history-context-menu');
}

function renameCanvasAgentSession(sessionId) {
  const session = CanvasWorkspace.agentSessions.find((entry) => entry.id === sessionId);
  const row = [...document.querySelectorAll('.board-agent-history-row')]
    .find((entry) => entry.dataset.sessionId === sessionId);
  const title = row && row.querySelector('.board-agent-history-copy b');
  if (!session || !row || !title) return;
  const input = document.createElement('input');
  input.className = 'board-agent-history-rename';
  input.value = session.title || t('New conversation', '新对话');
  title.replaceWith(input);
  let finished = false;
  const finish = (commit) => {
    if (finished) return;
    finished = true;
    if (commit) {
      const next = input.value.trim().slice(0, 120);
      if (next) session.title = next;
      session.updatedAt = new Date().toISOString();
      persistCanvasAgentHistory();
    }
    renderCanvasAgentHistory();
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') finish(true);
    if (event.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true), { once: true });
  input.focus();
  input.select();
}

async function deleteCanvasAgentSession(sessionId) {
  const session = CanvasWorkspace.agentSessions.find((entry) => entry.id === sessionId);
  if (!session) return;
  const confirmed = typeof showConfirmDialog === 'function'
    ? await showConfirmDialog({
      title: t('Delete conversation', '删除对话'),
      message: t(`Delete "${session.title}"? This cannot be undone.`, `删除“${session.title}”？此操作无法撤销。`),
      confirmLabel: t('Delete', '删除'),
      danger: true
    })
    : window.confirm(t(`Delete "${session.title}"?`, `删除“${session.title}”？`));
  if (!confirmed) return;
  CanvasWorkspace.agentSessions = CanvasWorkspace.agentSessions.filter((entry) => entry.id !== sessionId);
  if (CanvasWorkspace.activeAgentSessionId === sessionId) startNewCanvasAgentChat();
  CanvasWorkspace.agentSessionViews.delete(sessionId);
  persistCanvasAgentHistory();
  renderCanvasAgentHistory();
}

function toggleCanvasAgentHistory(open = null) {
  const drawer = document.getElementById('board-agent-history-drawer');
  if (!drawer) return;
  drawer.hidden = open === null ? !drawer.hidden : !open;
  if (!drawer.hidden) renderCanvasAgentHistory();
}

function handleCanvasAgentShortcut(event) {
  if (event.code !== 'Space' || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
  if (typeof isBoardWorkspaceActive !== 'function' || !isBoardWorkspaceActive()) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.repeat || event.isComposing) return;
  const agent = document.getElementById('board-agent-panel');
  setCanvasAgentOpen(!!agent?.classList.contains('is-hidden'), { focus: true });
}

function setCanvasAgentOpen(open, options = {}) {
  const agent = document.getElementById('board-agent-panel');
  const board = document.getElementById('board-panel');
  const toggle = document.getElementById('board-agent-toggle');
  if (!agent || !board) return false;
  const allowed = !!open && !board.classList.contains('is-canvas-library');
  const wasOpen = !agent.classList.contains('is-hidden');
  if (!allowed) setCanvasAgentFloating(false);
  if (wasOpen === allowed) return allowed;
  agent.classList.toggle('is-hidden', !allowed);
  agent.inert = !allowed;
  if (toggle) toggle.setAttribute('aria-expanded', String(allowed));
  const historyDrawer = document.getElementById('board-agent-history-drawer');
  const historyToggle = document.getElementById('board-agent-history');
  if (!allowed && historyDrawer) historyDrawer.hidden = true;
  if (!allowed && historyToggle) historyToggle.setAttribute('aria-expanded', 'false');
  if (allowed) {
    renderCanvasAgentContext();
    syncCanvasAgentReferencesToSelection();
    if (options.focus) {
      requestAnimationFrame(() => {
        if (!agent.classList.contains('is-hidden')) {
          document.getElementById('board-agent-input')?.focus({ preventScroll: true });
        }
      });
    }
  } else {
    CanvasWorkspace.agentReferenceFileIds.clear();
    CanvasWorkspace.agentSelectionFileIds.clear();
    renderCanvasAgentReferences();
    if (agent.contains(document.activeElement)) {
      document.getElementById('board-viewport')?.focus({ preventScroll: true });
    }
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
  const names = {
    'gemini-3.8-flash': 'Gemini 3.8 Flash',
    'gemini-3.1-pro': 'Gemini 3.1 Pro',
    'gpt-5.6-sol': 'GPT-5.6 Sol',
    'kimi-k3': 'Kimi K3',
    'deepseek-v4-flash': 'DeepSeek V4 Flash',
    'deepseek-v4-pro': 'DeepSeek V4 Pro',
    'gpt-6-astra': 'GPT-6 Astra'
  };
  const providers = (Array.isArray(config.chatProviders) ? config.chatProviders : []).flatMap((provider) => {
    if (!provider || provider.available === false || provider.hidden === true || !provider.endpoint) return [];
    return (Array.isArray(provider.models) ? provider.models : [])
      .map((model) => String(model || '').trim())
      .filter(Boolean)
      .map((model) => ({ providerId: provider.id, model, name: names[model] || model }));
  });
  if (typeof MesssAiProviderOptions !== 'undefined' && MesssAiProviderOptions.chatOptions) {
    return MesssAiProviderOptions.chatOptions(config.chatProviders, {
      activeProviderId: config.activeChatProviderId,
      names
    });
  }
  return providers;
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
    const preferred = chatProviders.find((entry) => entry.model === 'gemini-3.8-flash') || chatProviders[0] || null;
    CanvasWorkspace.agentChatProviderId = preferred && preferred.providerId;
    CanvasWorkspace.agentChatModel = preferred && preferred.model;
  }
  chatList.replaceChildren();
  MesssAiProviderOptions.appendChatPresets(chatList, chatProviders,
    CanvasWorkspace.agentMode === 'chat' ? CanvasWorkspace.agentChatModel : null,
    (entry) => {
      CanvasWorkspace.agentMode = 'chat';
      CanvasWorkspace.agentChatProviderId = entry.providerId;
      CanvasWorkspace.agentChatModel = entry.model;
      CanvasWorkspace.agentChatUsePreset = true;
      renderCanvasAgentModels();
    }, t);
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
    const label = document.createElement('span');
    label.textContent = typeof publicModelLabel === 'function' ? publicModelLabel(provider.name) : provider.name;
    const check = document.createElement('i');
    check.textContent = '✓';
    button.append(label, check);
    list.appendChild(button);
  });
  const selected = providers.find((provider) => provider.id === CanvasWorkspace.agentProviderId);
  const selectedChat = activeCanvasAgentProvider();
  triggerLabel.textContent = CanvasWorkspace.agentMode === 'chat'
    ? selectedChat.name
    : (selected
      ? (typeof publicModelLabel === 'function' ? publicModelLabel(selected.name) : selected.name)
      : t('No model', '无可用模型'));
  MesssAiProviderOptions.syncChatPresetSelection(chatList, triggerLabel, CanvasWorkspace.agentChatModel,
    CanvasWorkspace.agentMode === 'chat' && CanvasWorkspace.agentChatUsePreset !== false, t);
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
  const selectedFiles = ids
    .map((fileId) => AppState.files.find((entry) => entry.id === fileId))
    .filter(Boolean);
  if (selectedFiles.some((file) => isImageExt(file.ext) || isVideoExt(file.ext))) {
    CanvasWorkspace.agentMode = 'generate';
    CanvasWorkspace.agentGenerationKind = selectedFiles.some((file) => isVideoExt(file.ext)) && !selectedFiles.some((file) => isImageExt(file.ext))
      ? 'video'
      : 'image';
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
  CanvasWorkspace.agentGenerationKind = isVideoExt(file.ext) ? 'video' : 'image';
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
  const session = ensureCanvasAgentSession(displayPrompt);
  const sessionId = session.id, canvasId = session.canvasId;
  CanvasWorkspace.agentRequestSessionId = sessionId;
  const messages = CanvasWorkspace.agentMessages.map(message => ({ ...message }));
  const userRow = appendCanvasAgentMessage('user', displayPrompt, sessionId);
  appendCanvasAgentAttachments(userRow, referenceFiles);
  messages.push({
    role: 'user',
    content: contextualPrompt,
    displayContent: displayPrompt,
    attachmentFileIds: referenceFiles.map((file) => file.id),
    attachments: referenceFiles.map(canvasAgentAttachmentRecord)
  });
  persistActiveCanvasAgentSession(sessionId, messages);
  const confidentialityReply = window.MesssAgentBrandPolicy?.replyForRequest(displayPrompt);
  if (confidentialityReply) {
    const response = { ok: true, text: confidentialityReply, files: [], creditsCharged: null, localPolicy: true };
    messages.push({ role: 'assistant', content: confidentialityReply, displayContent: confidentialityReply, creditsCharged: null, generatedFiles: [] });
    persistActiveCanvasAgentSession(sessionId, messages);
    appendCanvasAgentMessage('assistant', confidentialityReply, sessionId);
    if (typeof options.onResponse === 'function') await options.onResponse(confidentialityReply, response);
    return response;
  }
  CanvasWorkspace.agentBusy = true;
  if (input) input.disabled = true;
  if (submitButton) submitButton.disabled = true;
  const pending = appendCanvasAgentMessage('assistant', canvasAgentThinkingText(), sessionId);
  pending.classList.add('is-pending');
  const thinkingStartedAt = Date.now();
  const thinkingTimer = window.setInterval(() => {
    if (!pending.isConnected || pending.dataset.streaming === 'true') return;
    const seconds = Math.max(1, Math.floor((Date.now() - thinkingStartedAt) / 1000));
    pending.textContent = canvasAgentThinkingText(seconds);
  }, 1000);
  try {
    const response = await chatWithAgentEstimate(pending, {
      canvasId,
      permissionSession: window.MesssComposerActions?.sessionFor('canvas', sessionId),
      prompt: contextualPrompt,
      messages: options.isolated === true
        ? [{ role: 'user', content: contextualPrompt }]
        : (typeof buildAgentContextMessages === 'function'
          ? buildAgentContextMessages(messages, session.memory)
          : messages),
      attachmentFileIds: referenceFiles.map((file) => file.id),
      chatProviderId: selected.providerId,
      routingStrategy: window.MesssAiProviderOptions?.routingStrategy(selected.model, CanvasWorkspace.agentChatUsePreset !== false),
      chatModel: selected.model
    });
    if (!response || !response.ok) {
      throw new Error((response && response.message) || t('Canvas Agent request failed.', '画布 Agent 请求失败。'));
    }
    window.clearInterval(thinkingTimer);
    messages.push({ role: 'assistant', content: response.text, displayContent: response.text, creditsCharged: agentRecordedCredits(response.creditsCharged), generatedFiles: normalizeAgentGeneratedFiles(response.files) });
    persistActiveCanvasAgentSession(sessionId, messages);
    pending.classList.remove('is-pending');
    renderAgentMessageContent(pending, response.text);
    if (typeof appendAssistantOutputFiles === 'function') appendAssistantOutputFiles(pending, response.files);
    appendAgentCharge(pending, response);
    if (typeof options.onResponse === 'function') await options.onResponse(response.text, response);
    return response;
  } catch (err) {
    const interrupted = preserveInterruptedAgentReply(pending);
    if (interrupted) {
      messages.push(interrupted);
      persistActiveCanvasAgentSession(sessionId, messages);
    } else pending.remove();
    appendCanvasAgentMessage('error', typeof publicAiErrorMessage === 'function'
      ? publicAiErrorMessage(err && err.message, t('Canvas Agent request failed.', '画布 Agent 请求失败。'))
      : (err && err.message ? err.message : t('Canvas Agent request failed.', '画布 Agent 请求失败。')), sessionId);
    if (typeof options.onError === 'function') options.onError(err);
    return null;
  } finally {
    window.clearInterval(thinkingTimer);
    CanvasWorkspace.agentBusy = false;
    CanvasWorkspace.agentRequestSessionId = null;
    if (input) input.disabled = false;
    if (submitButton) submitButton.disabled = false;
    if (input && options.focusInput !== false && CanvasWorkspace.activeAgentSessionId === sessionId && activeCanvasId() === canvasId) input.focus();
  }
}

function handleCanvasAgentHistoryDrop(event) {
  const draggedId = event.dataTransfer && event.dataTransfer.getData('text/messs-agent-session');
  const dragged = CanvasWorkspace.agentSessions.find((entry) => entry.id === draggedId);
  if (!dragged) return;
  event.preventDefault();
  dragged.favorite = true;
  dragged.unread = false;
  persistCanvasAgentHistory();
  renderCanvasAgentHistory();
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
  input.value = '';
  return requestCanvasAgentText({ displayPrompt: prompt, contextualPrompt: canvasAgentPrompt(prompt), referenceFiles });
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
  const importButton = document.getElementById('canvas-import');
  if (importButton) {
    importButton.title = t('Import canvas', '导入画布');
    importButton.setAttribute('aria-label', importButton.title);
  }
  setText('#canvas-folder-new span', 'New folder', '新建文件夹');
  setText('#canvas-start-creating .canvas-start-label', 'Start creating', '开始创作');
  setText('.canvas-library-topline h2', 'All Canvases', '全部画布');
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
  const toggleLabel = toggle?.querySelector('.board-agent-toggle-label');
  if (toggleLabel) toggleLabel.textContent = 'Messs Agent';
  if (input) input.placeholder = t('Ask about this canvas...', '询问这个画布...');
  const historyTitle = document.querySelector('.board-agent-history-drawer > header strong');
  if (historyTitle) historyTitle.textContent = t('Agent history', 'Agent \u5386\u53f2\u8bb0\u5f55');
  const historyFavorites = document.getElementById('board-agent-history-favorites');
  if (historyFavorites) historyFavorites.textContent = t('Pinned', '置顶');
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

  document.getElementById('canvas-import').addEventListener('click', promptImportCanvas);
  document.getElementById('canvas-folder-new').addEventListener('click', promptNewProject);
  document.getElementById('canvas-start-creating')?.addEventListener('click', startCreatingCanvas);
  const libraryGrid = document.getElementById('canvas-library-view');
  libraryGrid?.addEventListener('contextmenu', (event) => {
    if (event.target.closest('.canvas-library-card, .canvas-library-folder-card, button, input, select, textarea')) return;
    event.preventDefault(); event.stopPropagation();
    buildAndShowSimpleMenu([{ label: t('New folder', '新建文件夹'), icon: 'M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3z', action: () => promptNewProject() }, { label: t('New canvas', '新建画布'), icon: 'M3 3h18v18H3z;M12 8v8M8 12h8', action: () => promptNewCanvas() }], event.clientX, event.clientY, 'canvas-library-background-menu');
  });
  document.getElementById('canvas-library-back').addEventListener('click', showCanvasLibrary);
  document.getElementById('canvas-library-folder-back').addEventListener('click', selectAllCanvasLibraryItems);
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
    const clear = document.getElementById('canvas-library-search-clear');
    if (clear) clear.hidden = !event.target.value;
    renderCanvasLibrary();
  });
  document.getElementById('canvas-library-search-clear').addEventListener('click', () => {
    const search = document.getElementById('canvas-library-search');
    if (!search) return;
    search.value = '';
    CanvasWorkspace.libraryQuery = '';
    document.getElementById('canvas-library-search-clear').hidden = true;
    renderCanvasLibrary();
    search.focus();
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.canvas-library-card-menu, .canvas-library-card-menu-trigger')) {
      closeCanvasCardMenus();
    }
  });
  initCanvasAgentFloating();
  document.addEventListener('keydown', handleCanvasAgentShortcut, true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeCanvasCardMenus();
  });

  document.getElementById('board-agent-toggle').addEventListener('click', () => {
    const agent = document.getElementById('board-agent-panel');
    setCanvasAgentOpen(agent.classList.contains('is-hidden'), { focus: true });
  });
  document.getElementById('board-agent-close').addEventListener('click', () => {
    if (document.getElementById('board-agent-panel').classList.contains('is-floating')) { setCanvasAgentFloating(false); setCanvasAgentOpen(true); return; }
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
  const agentHistoryPinned = document.getElementById('board-agent-history-favorites');
  agentHistoryPinned.addEventListener('dragover', (event) => {
    if (!event.dataTransfer || !event.dataTransfer.types.includes('text/messs-agent-session')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    event.currentTarget.classList.add('is-drop-target');
  });
  agentHistoryPinned.addEventListener('dragleave', (event) => event.currentTarget.classList.remove('is-drop-target'));
  agentHistoryPinned.addEventListener('drop', (event) => {
    event.currentTarget.classList.remove('is-drop-target');
    handleCanvasAgentHistoryDrop(event);
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
    CanvasWorkspace.agentChatUsePreset = false;
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
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) {
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
  if (isDetachedCanvasWindow()) {
    document.body.classList.add('is-detached-canvas-window');
    document.title = `${activeCanvasRecord().name} - Messs.`;
    showCanvasWorkspace();
  } else {
    showCanvasLibrary();
  }
  refreshCanvasWorkspaceLanguage();
  // Local navigation must not wait for provider configuration or chat history.
  try {
    CanvasWorkspace.config = await window.messsAPI.getAiMediaConfig();
  } catch (err) {
    CanvasWorkspace.config = null;
  }
  renderCanvasAgentModels();
  renderCanvasAgentReferences();
  renderCanvasAgentHistory();
  void loadCanvasAgentHistory();
}
function canvasAgentFloatingBounds() {
  const viewport = document.getElementById('board-viewport');
  const workspace = document.getElementById('board-workspace-body');
  const target = viewport && !viewport.hidden && viewport.getBoundingClientRect().width
    ? viewport
    : workspace;
  return target ? target.getBoundingClientRect() : {
    left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight,
    width: window.innerWidth, height: window.innerHeight
  };
}

function setCanvasAgentFloating(floating) {
  const panel = document.getElementById('board-agent-panel');
  const button = document.getElementById('board-agent-detach');
  panel.classList.toggle('is-floating', floating);
  document.getElementById('board-panel').classList.toggle('has-floating-agent', floating);
  button.setAttribute('aria-pressed', String(floating));
  button.title = floating ? '放回 Agent' : '取下 Agent';
  button.setAttribute('aria-label', button.title);
  if (floating) {
    const workspace = document.getElementById('board-workspace-body');
    const bounds = canvasAgentFloatingBounds();
    const width = Math.min(480, Math.max(240, (workspace?.clientWidth || bounds.width) - 24));
    const height = Math.min(680, Math.max(260, (workspace?.clientHeight || bounds.height) - 24));
    panel.style.width = `${width}px`;
    panel.style.height = `${height}px`;
    panel.style.left = '0px';
    panel.style.top = '0px';
    setCanvasAgentOpen(true, {focus:true});
    positionCanvasAgentFloating(
      bounds.left + (bounds.width - panel.getBoundingClientRect().width) / 2,
      bounds.top + (bounds.height - panel.getBoundingClientRect().height) / 2
    );
  } else {
    for (const key of ['width','height','left','top']) panel.style.removeProperty(key);
  }
}
function initCanvasAgentFloating() {
  const panel = document.getElementById('board-agent-panel');
  document.getElementById('board-agent-detach').addEventListener('click', () => setCanvasAgentFloating(!panel.classList.contains('is-floating')));
  const handle = document.getElementById('board-agent-drag');
  let drag;
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !panel.classList.contains('is-floating')) return;
    const rect = panel.getBoundingClientRect();
    drag = {x:event.clientX-rect.left,y:event.clientY-rect.top};
    handle.setPointerCapture(event.pointerId); event.preventDefault();
  });
  handle.addEventListener('pointermove', event => {
    if (!drag || panel.classList.contains('is-hidden') || !panel.classList.contains('is-floating')) return;
    positionCanvasAgentFloating(event.clientX-drag.x, event.clientY-drag.y);
  });
  handle.addEventListener('lostpointercapture', () => { drag = null; });
  handle.addEventListener('pointerup', () => { drag = null; });
  handle.addEventListener('pointercancel', () => { drag = null; });
  window.addEventListener('resize', () => {
    if (!panel.classList.contains('is-floating')) return;
    const workspace = document.getElementById('board-workspace-body');
    if (workspace) {
      panel.style.width = `${Math.min(panel.offsetWidth, Math.max(240, workspace.clientWidth - 24))}px`;
      panel.style.height = `${Math.min(panel.offsetHeight, Math.max(260, workspace.clientHeight - 24))}px`;
    }
    const rect = panel.getBoundingClientRect();
    positionCanvasAgentFloating(rect.left, rect.top);
  });
}

function positionCanvasAgentFloating(left, top) {
  const panel = document.getElementById('board-agent-panel');
  const rect = panel.getBoundingClientRect();
  const bounds = canvasAgentFloatingBounds();
  const inset = 12;
  const scaleX = rect.width / panel.offsetWidth || 1;
  const scaleY = rect.height / panel.offsetHeight || 1;
  const minLeft = bounds.left + inset;
  const minTop = bounds.top + inset;
  const maxLeft = Math.max(minLeft, bounds.right - rect.width - inset);
  const maxTop = Math.max(minTop, bounds.bottom - rect.height - inset);
  const targetLeft = Math.max(minLeft, Math.min(maxLeft, left));
  const targetTop = Math.max(minTop, Math.min(maxTop, top));
  // Convert viewport displacement to the fixed element's containing-block coordinates.
  panel.style.left = `${(parseFloat(panel.style.left) || 0) + (targetLeft - rect.left) / scaleX}px`;
  panel.style.top = `${(parseFloat(panel.style.top) || 0) + (targetTop - rect.top) / scaleY}px`;
}
