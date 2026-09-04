'use strict';

const AiAssistant = {
  config: null,
  kind: 'chat',
  busy: false,
  activeTasks: 0,
  messages: [],
  attachments: [],
  sessions: [],
  activeSessionId: null,
  historyFavoritesOnly: false,
  historyDate: '',
  historyLoaded: false,
  languageTimer: 0,
  creditQuoteRevision: 0,
  compactObserver: null,
  referenceAutoState: null
};

const AI_CHAT_HISTORY_KEY = 'messs.ai-chat-history.v1';
const AI_CHAT_HISTORY_LIMIT = 60;
const AI_ASSISTANT_CHAT_MODELS = new Set([
  'gemini-3.1-pro',
  'gpt-5.6-sol',
  'kimi-k3'
]);
const AI_ASSISTANT_CHAT_MODEL_NAMES = {
  'gemini-3.1-pro': 'Gemini 3.1 Pro',
  'gpt-5.6-sol': 'GPT-5.6 Sol',
  'kimi-k3': 'Kimi K3'
};

function aiChatHistoryDate(value) {
  const date = new Date(value || 0);
  if (!Number.isFinite(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeAiChatSession(session) {
  if (!session || !session.id) return null;
  const messages = Array.isArray(session.messages) ? session.messages.slice(-100).map((message) => ({
    role: message && message.role === 'assistant' ? 'assistant' : 'user',
    content: String(message && message.content || '').slice(0, 16000),
    attachmentFileIds: Array.isArray(message && message.attachmentFileIds) ? message.attachmentFileIds.slice(0, 50) : [],
    attachmentTokens: Array.isArray(message && message.attachmentTokens) ? message.attachmentTokens.slice(0, 20) : [],
    attachments: Array.isArray(message && message.attachments) ? message.attachments.slice(0, 50).map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      kind: attachment.kind
    })) : [],
    generatedFiles: Array.isArray(message && message.generatedFiles) ? message.generatedFiles.slice(0, 12).map((file) => ({
      token: file.token,
      name: file.name,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes
    })) : []
  })).filter((message) => message.content) : [];
  return {
    id: String(session.id).slice(0, 120),
    title: String(session.title || t('New conversation', '\u65b0\u5bf9\u8bdd')).slice(0, 120),
    createdAt: session.createdAt || new Date().toISOString(),
    updatedAt: session.updatedAt || session.createdAt || new Date().toISOString(),
    favorite: session.favorite === true || session.pinned === true,
    unread: session.unread === true,
    messages
  };
}

function normalizedAiChatSessions(value) {
  return (Array.isArray(value) ? value : [])
    .map(normalizeAiChatSession)
    .filter(Boolean)
    .slice(0, AI_CHAT_HISTORY_LIMIT);
}

function mergeAiChatSessions(...sources) {
  const byId = new Map();
  sources.flatMap((source) => normalizedAiChatSessions(source)).forEach((session) => {
    const previous = byId.get(session.id);
    if (!previous || new Date(session.updatedAt) >= new Date(previous.updatedAt)) byId.set(session.id, session);
  });
  return [...byId.values()]
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, AI_CHAT_HISTORY_LIMIT);
}

function persistAiChatHistory() {
  const sessions = mergeAiChatSessions(AiAssistant.sessions);
  AiAssistant.sessions = sessions;
  try {
    localStorage.setItem(AI_CHAT_HISTORY_KEY, JSON.stringify(sessions));
  } catch (err) {
    // History is a convenience; an oversized clipboard image must not block chat.
  }
  if (window.messsAPI && typeof window.messsAPI.saveAiAssistantHistory === 'function') {
    void window.messsAPI.saveAiAssistantHistory(sessions).catch(() => {});
  }
}

function readLocalAiChatHistory() {
  try {
    return normalizedAiChatSessions(JSON.parse(localStorage.getItem(AI_CHAT_HISTORY_KEY) || '[]'));
  } catch (err) {
    return [];
  }
}

async function loadAiChatHistory() {
  const local = readLocalAiChatHistory();
  let durable = [];
  try {
    if (window.messsAPI && typeof window.messsAPI.getAiAssistantHistory === 'function') {
      const result = await window.messsAPI.getAiAssistantHistory();
      durable = normalizedAiChatSessions(result && result.sessions);
    }
  } catch (error) {}
  AiAssistant.sessions = mergeAiChatSessions(durable, local, AiAssistant.sessions);
  AiAssistant.historyLoaded = true;
  persistAiChatHistory();
  renderAiChatHistory();
}

function activeAiChatSession() {
  return AiAssistant.sessions.find((session) => session.id === AiAssistant.activeSessionId) || null;
}

function ensureAiChatSession(title) {
  if (AiAssistant.activeSessionId && activeAiChatSession()) return activeAiChatSession();
  const now = new Date().toISOString();
  const session = {
    id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: String(title || t('New conversation', '新对话')).slice(0, 64),
    createdAt: now,
    updatedAt: now,
    favorite: false,
    unread: false,
    messages: []
  };
  AiAssistant.sessions.unshift(session);
  AiAssistant.activeSessionId = session.id;
  renderAiChatHistory();
  return session;
}

function persistActiveAiChatSession() {
  const session = activeAiChatSession();
  if (!session) return;
  session.messages = AiAssistant.messages
    .filter((message) => message && (message.role === 'user' || message.role === 'assistant'))
    .slice(-80)
    .map((message) => ({
      role: message.role,
      content: String(message.content || '').slice(0, 12000),
      attachmentFileIds: Array.isArray(message.attachmentFileIds) ? message.attachmentFileIds.slice(0, 8) : [],
      attachmentTokens: Array.isArray(message.attachmentTokens) ? message.attachmentTokens.slice(0, 8) : [],
      attachments: Array.isArray(message.attachments) ? message.attachments.slice(0, 8).map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        kind: attachment.kind
      })) : [],
      generatedFiles: Array.isArray(message.generatedFiles) ? message.generatedFiles.slice(0, 6).map((file) => ({
        token: file.token,
        name: file.name,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes
      })) : []
    }));
  session.updatedAt = new Date().toISOString();
  session.unread = false;
  persistAiChatHistory();
  renderAiChatHistory();
}

function aiChatSessionMatchesFilter(session) {
  if (AiAssistant.historyFavoritesOnly && !session.favorite) return false;
  return true;
}

function renderAiChatHistory() {
  const recentList = document.getElementById('ai-chat-history-list');
  const pinnedList = document.getElementById('ai-chat-history-pinned-list');
  const recentEmpty = document.getElementById('ai-chat-history-empty');
  const pinnedEmpty = document.getElementById('ai-chat-history-pinned-empty');
  if (!recentList || !pinnedList || !recentEmpty || !pinnedEmpty) return;
  recentList.replaceChildren();
  pinnedList.replaceChildren();
  const sessions = AiAssistant.sessions
    .slice()
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || new Date(b.updatedAt) - new Date(a.updatedAt))
    .filter(aiChatSessionMatchesFilter);
  const pinnedSessions = sessions.filter((session) => session.favorite === true);
  const recentSessions = sessions.filter((session) => session.favorite !== true);
  recentEmpty.hidden = recentSessions.length > 0;
  recentEmpty.textContent = sessions.length ? t('No recent conversations', '\u6682\u65e0\u6700\u8fd1\u5bf9\u8bdd') : t('No conversations yet', '\u6682\u65e0\u5bf9\u8bdd');
  pinnedEmpty.hidden = pinnedSessions.length > 0;
  pinnedEmpty.textContent = t('No pinned conversations', '\u6682\u65e0\u7f6e\u9876\u5bf9\u8bdd');
  document.querySelectorAll('[data-history-count]').forEach((count) => {
    const section = count.dataset.historyCount === 'pinned' ? pinnedSessions : recentSessions;
    count.textContent = String(section.length);
  });

  const renderEntry = (session, list) => {
    const entry = document.createElement('div');
    entry.className = 'ai-chat-history-entry';
    entry.dataset.sessionId = session.id;
    entry.draggable = true;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ai-chat-history-item';
    button.classList.toggle('is-active', session.id === AiAssistant.activeSessionId);
    button.innerHTML = `<span class="ai-chat-history-star" aria-hidden="true">${session.favorite ? '\u2605' : '\u2606'}</span><span class="ai-chat-history-copy"><b></b><small></small></span><span class="ai-chat-history-unread" aria-hidden="true"></span>`;
    button.classList.toggle('is-unread', session.unread === true);
    button.querySelector('b').textContent = session.title || t('New conversation', '\u65b0\u5bf9\u8bdd');
    button.querySelector('small').textContent = session.unread
      ? t('Unread', '未读')
      : session.favorite
        ? t('Pinned', '置顶')
        : t('Recent', '最近');
    button.addEventListener('click', () => loadAiChatSession(session.id));
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'ai-chat-history-more';
    more.title = t('Conversation actions', '对话操作');
    more.setAttribute('aria-label', more.title);
    more.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>';
    more.addEventListener('click', (event) => {
      event.stopPropagation();
      showAiChatSessionMenu(session.id, event.clientX, event.clientY);
    });
    entry.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      showAiChatSessionMenu(session.id, event.clientX, event.clientY);
    });
    entry.addEventListener('dragstart', (event) => {
      event.dataTransfer.setData('text/messs-ai-session', session.id);
      event.dataTransfer.effectAllowed = 'move';
      entry.classList.add('is-dragging');
    });
    entry.addEventListener('dragend', () => entry.classList.remove('is-dragging'));
    entry.append(button, more);
    list.appendChild(entry);
  };
  pinnedSessions.forEach((session) => renderEntry(session, pinnedList));
  recentSessions.forEach((session) => renderEntry(session, recentList));
}

function renameAiChatSession(sessionId) {
  const session = AiAssistant.sessions.find((entry) => entry.id === sessionId);
  const row = [...document.querySelectorAll('.ai-chat-history-entry')]
    .find((entry) => entry.dataset.sessionId === sessionId);
  const title = row && row.querySelector('.ai-chat-history-copy b');
  if (!session || !row || !title) return;
  const input = document.createElement('input');
  input.className = 'ai-chat-history-rename';
  input.value = session.title || t('New conversation', '新对话');
  title.replaceWith(input);
  let finished = false;
  const commit = () => {
    if (finished) return;
    finished = true;
    const next = input.value.trim().slice(0, 64);
    if (next) session.title = next;
    session.updatedAt = new Date().toISOString();
    persistAiChatHistory();
    renderAiChatHistory();
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') commit();
    if (event.key === 'Escape') {
      finished = true;
      renderAiChatHistory();
    }
  });
  input.addEventListener('blur', commit, { once: true });
  input.focus();
  input.select();
}

async function deleteAiChatSession(sessionId) {
  const session = AiAssistant.sessions.find((entry) => entry.id === sessionId);
  if (!session) return;
  const confirmed = await showConfirmDialog({
    title: t('Delete conversation', '删除对话'),
    message: t(`Delete "${session.title}"? This cannot be undone.`, `删除“${session.title}”？此操作无法撤销。`),
    confirmLabel: t('Delete', '删除'),
    danger: true
  });
  if (!confirmed) return;
  AiAssistant.sessions = AiAssistant.sessions.filter((entry) => entry.id !== sessionId);
  if (AiAssistant.activeSessionId === sessionId) startNewAiChat();
  persistAiChatHistory();
  renderAiChatHistory();
}

async function exportAiChatSession(sessionId) {
  const session = AiAssistant.sessions.find((entry) => entry.id === sessionId);
  if (!session) return;
  const result = await window.messsAPI.exportAiChat(session);
  if (result && result.ok) showToast(t('Conversation exported', '对话已导出'), 'AI');
}

function showAiChatSessionMenu(sessionId, x, y) {
  const session = AiAssistant.sessions.find((entry) => entry.id === sessionId);
  if (!session || typeof buildAndShowSimpleMenu !== 'function') return;
  buildAndShowSimpleMenu([
    {
      label: session.favorite ? t('Unpin conversation', '取消置顶') : t('Pin conversation', '置顶'),
      icon: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3z',
      action: () => {
        session.favorite = !session.favorite;
        persistAiChatHistory();
        renderAiChatHistory();
      }
    },
    {
      label: session.unread ? t('Mark as read', '标记为已读') : t('Mark as unread', '标记为未读'),
      icon: 'M3 5h18v14H3z;M3 7l9 6 9-6',
      action: () => {
        session.unread = !session.unread;
        persistAiChatHistory();
        renderAiChatHistory();
      }
    },
    {
      label: t('Rename', '重命名'),
      icon: 'M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4',
      action: () => renameAiChatSession(sessionId)
    },
    {
      label: t('Export', '导出'),
      icon: 'M12 3v12M7 10l5 5 5-5M5 21h14',
      action: () => exportAiChatSession(sessionId)
    },
    {
      label: t('Delete', '删除'),
      icon: 'M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14',
      danger: true,
      action: () => deleteAiChatSession(sessionId)
    }
  ], x, y, 'ai-chat-session-menu');
}

function handleAiChatHistoryDrop(event, targetSection) {
  const draggedId = event.dataTransfer && event.dataTransfer.getData('text/messs-ai-session');
  const dragged = AiAssistant.sessions.find((entry) => entry.id === draggedId);
  if (!dragged) return;
  event.preventDefault();
  const destination = targetSection || event.currentTarget?.dataset.historySection || 'pinned';
  dragged.favorite = destination === 'pinned';
  persistAiChatHistory();
  renderAiChatHistory();
}

function loadAiChatSession(sessionId) {
  const session = AiAssistant.sessions.find((entry) => entry.id === sessionId);
  if (!session) return;
  AiAssistant.activeSessionId = session.id;
  session.unread = false;
  persistAiChatHistory();
  AiAssistant.messages = session.messages.map((message) => ({ ...message }));
  const messages = document.getElementById('ai-assistant-messages');
  messages.innerHTML = '';
  AiAssistant.messages.forEach((message) => {
    const row = appendAssistantText(message.role, message.content);
    appendAssistantMessageAttachments(row, Array.isArray(message.attachments) ? message.attachments : []);
    appendAssistantOutputFiles(row, message.generatedFiles);
  });
  if (AiAssistant.messages.length) showAssistantConversation();
  else {
    document.getElementById('ai-assistant-home').hidden = false;
    messages.hidden = true;
  }
  renderAiChatHistory();
}

function startNewAiChat() {
  AiAssistant.activeSessionId = null;
  AiAssistant.messages = [];
  AiAssistant.attachments = [];
  document.getElementById('ai-assistant-messages').innerHTML = '';
  document.getElementById('ai-assistant-messages').hidden = true;
  document.getElementById('ai-assistant-home').hidden = false;
  document.getElementById('ai-assistant-input').value = '';
  renderAssistantAttachments();
  renderAiChatHistory();
  document.getElementById('ai-assistant-input').focus();
}

function startAiDynamicPrompt() {
  const element = document.getElementById('ai-assistant-dynamic-prompt');
  if (!element) return;
  const phrases = [
    t('What should we solve today?', '今天要解决什么？', '오늘 무엇을 해결할까요?'),
    t('What would you like to create?', '你想创作什么？', '무엇을 만들고 싶으신가요?'),
    t('Where should we begin?', '我们从哪里开始？', '어디서 시작할까요?')
  ];
  let index = 0;
  clearInterval(AiAssistant.languageTimer);
  element.textContent = phrases[index];
  AiAssistant.languageTimer = setInterval(() => {
    element.classList.add('is-language-changing');
    setTimeout(() => {
      index = (index + 1) % phrases.length;
      element.textContent = phrases[index];
      element.classList.remove('is-language-changing');
    }, 230);
  }, 2200);
}

async function addPastedAssistantImage(file) {
  if (!file || AiAssistant.attachments.length >= assistantAttachmentLimit()) return;
  const dataUrl = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
  if (!dataUrl) return;
  const prepared = await window.messsAPI.preparePastedAiImage({
    dataUrl,
    name: file.name || 'Pasted image'
  });
  AiAssistant.attachments = [...AiAssistant.attachments, {
    id: `paste-${prepared.token}`,
    attachmentToken: prepared.token,
    name: file.name || t('Pasted image', '粘贴的图片'),
    dataUrl: prepared.dataUrl,
    mimeType: file.type || 'image/webp',
    sizeBytes: Number(file.size) || 0,
    kind: 'image'
  }];
  renderAssistantAttachments();
  syncAssistantMediaOptions();
}

function assistantFileKind(file) {
  const mimeType = String(file && file.mimeType || '').toLowerCase();
  const ext = String(file && file.ext || '').toLowerCase();
  if (mimeType.startsWith('image/') || isImageExt(ext)) return 'image';
  if (mimeType.startsWith('video/') || isVideoExt(ext)) return 'video';
  return String(file && file.kind || 'file');
}

function formatAssistantFileSize(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function createAssistantFileIcon(attachment) {
  const icon = document.createElement('span');
  icon.className = 'ai-assistant-file-icon';
  const extension = String(attachment && attachment.name || '').split('.').pop().slice(0, 4).toUpperCase();
  icon.innerHTML = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5"/></svg>';
  const badge = document.createElement('small');
  badge.textContent = extension && extension !== String(attachment.name || '').toUpperCase() ? extension : 'FILE';
  icon.appendChild(badge);
  return icon;
}

async function prepareAssistantImportedFiles(imported) {
  const limit = assistantAttachmentLimit();
  const remaining = Math.max(0, limit - AiAssistant.attachments.length);
  const accepted = AiAssistant.kind === 'chat'
    ? imported
    : imported.filter((file) => AiAssistant.kind === 'image'
      ? assistantFileKind(file) === 'image'
      : ['image', 'video'].includes(assistantFileKind(file)));
  const preparedResults = await Promise.allSettled(accepted.slice(0, remaining).map(async (file) => {
    const result = await window.messsAPI.prepareAiAttachment(file.id);
    if (!result || !result.ok || !result.attachment) return null;
    return { ...file, ...result.attachment, id: file.id };
  }));
  const prepared = preparedResults
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value)
    .filter(Boolean);
  const attachments = prepared.filter(Boolean);
  AiAssistant.attachments = [
    ...AiAssistant.attachments,
    ...attachments.filter((attachment) => !AiAssistant.attachments.some((entry) => entry.id === attachment.id))
  ];
  renderAssistantAttachments();
  syncAssistantMediaOptions();
  return attachments;
}

function mergeAssistantImportedFiles(imported) {
  if (!Array.isArray(imported) || !imported.length) return;
  AppState.files = [...imported, ...AppState.files.filter((file) =>
    !imported.some((next) => next.id === file.id)
  )];
  renderFileList(currentFileListScope());
  renderFolderGridIfActive();
}

async function importAssistantFilePaths(paths) {
  if (!paths.length) return [];
  const folderId = AppState.activeFolderId && AppState.activeFolderId !== 'default'
    ? AppState.activeFolderId
    : null;
  const result = await window.messsAPI.importFiles(paths, folderId, activeCanvasId());
  const imported = result && Array.isArray(result.imported) ? result.imported : [];
  mergeAssistantImportedFiles(imported);
  await prepareAssistantImportedFiles(imported);
  if (result && result.unlocked && result.unlocked.length) await refreshAchievements();
  return imported;
}

async function addExternalAssistantFiles(files) {
  if (!window.MesssFileDrop) return [];
  const folderId = AppState.activeFolderId && AppState.activeFolderId !== 'default'
    ? AppState.activeFolderId
    : null;
  const result = await window.MesssFileDrop.importEntries(
    window.MesssFileDrop.entriesFromFiles(files),
    folderId,
    activeCanvasId()
  );
  const imported = result && Array.isArray(result.imported) ? result.imported : [];
  AppState.files = [...imported, ...AppState.files.filter((file) =>
    !imported.some((next) => next.id === file.id)
  )];
  renderFileList(currentFileListScope());
  renderFolderGridIfActive();
  await prepareAssistantImportedFiles(imported);
  if (result.unlocked && result.unlocked.length) await refreshAchievements();
  if (result.failed && result.failed.length) {
    showToast(t('Some files could not be added.', '部分文件添加失败。'), 'AI');
  }
  return imported;
}

function configuredAssistantProviders(kind) {
  const config = AiAssistant.config || {};
  if (kind === 'image') return getConfiguredImageProviders(config);
  if (kind === 'video') return getConfiguredVideoProviders(config);
  if (kind === 'chat') {
    const chatProviders = Array.isArray(config.chatProviders)
      ? config.chatProviders
      : config.providerVisibilityEnforced
        ? []
        : [{
          id: 'chat-3',
          name: config.chatProviderName || 'OpenAI Compatible',
          endpoint: config.chatEndpoint || '',
          models: [config.chatModel || 'gemini-3.1-pro']
        }];
    const options = typeof MesssAiProviderOptions !== 'undefined'
      ? MesssAiProviderOptions.chatOptions(chatProviders, {
        allowedModels: AI_ASSISTANT_CHAT_MODELS,
        activeProviderId: config.activeChatProviderId,
        names: AI_ASSISTANT_CHAT_MODEL_NAMES
      })
      : [];
    if (options.length) return options;
    if (config.providerVisibilityEnforced) return [];
  }
  return [{
    id: 'chat',
    name: config.chatProviderName || t('OpenAI Compatible', 'OpenAI 兼容'),
    endpoint: config.chatEndpoint || ''
  }];
}

function renderAssistantModels() {
  const select = document.getElementById('ai-assistant-model');
  const picker = select.closest('.ai-assistant-model-picker');
  const trigger = document.getElementById('ai-assistant-model-trigger');
  const label = document.getElementById('ai-assistant-model-label');
  const menu = document.getElementById('ai-assistant-model-menu');
  const providers = configuredAssistantProviders(AiAssistant.kind);
  select.innerHTML = '';
  menu.innerHTML = '';

  providers.forEach((provider) => {
    const option = document.createElement('option');
    option.value = provider.id;
    option.textContent = typeof publicModelLabel === 'function' ? publicModelLabel(provider.name) : provider.name;
    if (provider.providerId) option.dataset.providerId = provider.providerId;
    if (provider.model) option.dataset.model = provider.model;
    select.appendChild(option);

    const menuOption = document.createElement('button');
    menuOption.type = 'button';
    menuOption.className = 'ai-model-picker-option';
    menuOption.dataset.value = provider.id;
    menuOption.setAttribute('role', 'option');
    appendAiModelLabel(menuOption, provider);
    menuOption.addEventListener('click', () => {
      select.value = provider.id;
      appendAiModelLabel(label, provider);
      menu.querySelectorAll('.ai-model-picker-option').forEach((item) => {
        const active = item === menuOption;
        item.classList.toggle('is-active', active);
        item.setAttribute('aria-selected', String(active));
      });
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      syncAssistantMediaOptions();
    });
    menu.appendChild(menuOption);
  });

  const config = AiAssistant.config || {};
  const activeId = AiAssistant.kind === 'image'
    ? config.activeImageProviderId
    : AiAssistant.kind === 'video'
      ? config.activeVideoProviderId
      : `${config.activeChatProviderId || 'chat-3'}::${config.chatModel || 'gemini-3.1-pro'}`;
  const active = providers.find((provider) => provider.id === activeId) || providers[0];
  select.value = active ? active.id : '';
  // A single configured provider is still a valid selection. Disabling the
  // trigger in that case makes the current model appear broken in the UI.
  select.disabled = providers.length === 0;
  trigger.disabled = providers.length === 0;
  trigger.setAttribute('aria-expanded', 'false');
  menu.hidden = true;
  const selected = providers.find((provider) => provider.id === select.value) || providers[0];
  picker.hidden = !selected;
  label.textContent = selected
    ? (typeof publicModelLabel === 'function' ? publicModelLabel(selected.name) : selected.name)
    : t('No provider configured', '未配置服务商');
  if (selected) appendAiModelLabel(label, selected);
  document.getElementById('ai-assistant-submit').disabled = !selected;
  menu.querySelectorAll('.ai-model-picker-option').forEach((option) => {
    const active = selected && option.dataset.value === selected.id;
    option.classList.toggle('is-active', active);
    option.setAttribute('aria-selected', String(active));
  });
  updateAssistantCreditEstimate();
}

function selectedAssistantProvider() {
  const select = document.getElementById('ai-assistant-model');
  return configuredAssistantProviders(AiAssistant.kind)
    .find((provider) => provider.id === (select && select.value)) || null;
}

function renderAssistantCreditEstimate(totalCredits) {
  const estimate = document.getElementById('ai-assistant-credit-estimate');
  if (!estimate) return;
  const total = Math.max(0, Math.ceil(Number(totalCredits) || 0));
  if (!total) {
    delete estimate.dataset.credits;
    estimate.hidden = true;
    estimate.textContent = '';
    estimate.removeAttribute('title');
    estimate.removeAttribute('aria-busy');
    return;
  }
  estimate.dataset.credits = String(total);
  estimate.hidden = false;
  estimate.removeAttribute('aria-busy');
  estimate.textContent = t(`${total} credits`, `${total} \u79ef\u5206`);
  estimate.title = t(`Estimated usage: ${total} credits`, `\u9884\u8ba1\u6d88\u8017 ${total} \u79ef\u5206`);
}

function refreshAssistantCreditEstimateLanguage() {
  const estimate = document.getElementById('ai-assistant-credit-estimate');
  if (!estimate || estimate.hidden) return;
  const total = Number(estimate.dataset.credits);
  if (Number.isFinite(total) && total > 0) renderAssistantCreditEstimate(total);
}

function updateAssistantCreditEstimate() {
  const estimate = document.getElementById('ai-assistant-credit-estimate');
  const provider = selectedAssistantProvider();
  const kind = AiAssistant.kind;
  const quoteApi = window.messsAPI && window.messsAPI.quoteMediaCredits;
  const revision = ++AiAssistant.creditQuoteRevision;
  if (!estimate || !provider) {
    renderAssistantCreditEstimate(0);
    return;
  }
  if (kind === 'chat') {
    // Chat/Agent is free. Clear a stale media quote when switching modes.
    renderAssistantCreditEstimate(0);
    return;
  }
  if (typeof quoteApi !== 'function') {
    renderAssistantCreditEstimate(0);
    return;
  }

  estimate.hidden = false;
  estimate.setAttribute('aria-busy', 'true');
  estimate.textContent = t('Calculating...', '\u8ba1\u7b97\u4e2d...');
  estimate.title = t('Calculating estimated usage', '\u6b63\u5728\u8ba1\u7b97\u9884\u8ba1\u6d88\u8017');
  const request = {
    kind,
    providerId: provider.id,
    imageProviderId: kind === 'image' ? provider.id : null,
    videoProviderId: kind === 'video' ? provider.id : null,
    count: kind === 'image' ? Number(document.getElementById('ai-assistant-count').value) : undefined,
    size: kind === 'image' ? document.getElementById('ai-assistant-size').value : undefined,
    quality: kind === 'image' ? document.getElementById('ai-assistant-quality').value : undefined,
    resolution: kind === 'video' ? document.getElementById('ai-assistant-size').value : undefined,
    duration: kind === 'video' ? Number(document.getElementById('ai-assistant-duration').value) : undefined
  };
  Promise.resolve(quoteApi.call(window.messsAPI, request)).then((pricing) => {
    if (revision !== AiAssistant.creditQuoteRevision || kind !== AiAssistant.kind) return;
    renderAssistantCreditEstimate(pricing && pricing.totalCredits);
  }).catch(() => {
    if (revision !== AiAssistant.creditQuoteRevision || kind !== AiAssistant.kind) return;
    renderAssistantCreditEstimate(0);
  });
}

function assistantVideoCapabilities() {
  const provider = selectedAssistantProvider();
  return provider && provider.capabilities && typeof provider.capabilities === 'object'
    ? provider.capabilities
    : {};
}

function assistantImageCapabilities() {
  const provider = selectedAssistantProvider();
  return provider && provider.capabilities && typeof provider.capabilities === 'object'
    ? provider.capabilities
      : {};
}

function assistantVideoModeForAttachments(attachments = AiAssistant.attachments) {
  const capabilities = assistantVideoCapabilities();
  const modes = Array.isArray(capabilities.videoModes)
    ? capabilities.videoModes.filter((entry) => entry && entry.id && entry.hidden !== true)
    : [];
  const available = (...ids) => ids.map((id) => modes.find((entry) => entry.id === id)).find(Boolean) || null;
  const mediaTypes = attachments.map(assistantFileKind).filter((kind) => ['image', 'video'].includes(kind));
  if (mediaTypes.includes('video')) return available('omni', 'video-reference', 'video-edit', 'video-extend');
  if (mediaTypes.length > 2) return available('omni', 'video-reference');
  if (mediaTypes.length === 2) return available('first-last-frame', 'omni');
  if (mediaTypes.length === 1) return available('first-frame', 'omni');
  return available('text');
}

function assistantVideoRatios(mode, capabilities = assistantVideoCapabilities()) {
  if (mode && Array.isArray(mode.ratios) && mode.ratios.length) return mode.ratios.map(String);
  if (mode && mode.id === 'text' && Array.isArray(capabilities.textRatios) && capabilities.textRatios.length) {
    return capabilities.textRatios.map(String);
  }
  if (mode && ['first-frame', 'first-last-frame'].includes(mode.id)) {
    return Array.isArray(capabilities.frameReferenceRatios) && capabilities.frameReferenceRatios.length
      ? capabilities.frameReferenceRatios.map(String)
      : ['adaptive'];
  }
  return Array.isArray(capabilities.ratios) && capabilities.ratios.length
    ? capabilities.ratios.map(String)
    : ['16:9', '9:16'];
}

function supportedAssistantVideoRatio(value, mode, capabilities = assistantVideoCapabilities()) {
  const ratios = assistantVideoRatios(mode, capabilities);
  const requested = String(value || '').trim();
  if (ratios.includes(requested)) return requested;
  if (ratios.includes('adaptive')) return 'adaptive';
  if (ratios.includes('16:9')) return '16:9';
  return ratios[0] || '16:9';
}

function assistantHasMediaAttachments() {
  return AiAssistant.attachments.some((attachment) => ['image', 'video'].includes(assistantFileKind(attachment)));
}

function assistantMediaAttachmentCount() {
  return AiAssistant.attachments.filter((attachment) => ['image', 'video'].includes(assistantFileKind(attachment))).length;
}

function assistantImageReferenceAutoActive() {
  return AiAssistant.kind === 'image' && assistantMediaAttachmentCount() > 0;
}

function assistantImageAttachmentDimensions(attachment) {
  const file = attachment && AppState.files.find((entry) => entry.id === attachment.id);
  const width = Number(attachment && (attachment.sourceWidth || attachment.width))
    || Number(file && (file.sourceWidth || file.width));
  const height = Number(attachment && (attachment.sourceHeight || attachment.height))
    || Number(file && (file.sourceHeight || file.height));
  return width > 0 && height > 0 ? { width, height } : null;
}

async function loadAssistantImageAttachmentDimensions(attachment) {
  const known = assistantImageAttachmentDimensions(attachment);
  if (known) return known;
  const source = String(attachment && (
    attachment.dataUrl || attachment.previewUrl || attachment.thumbUrl || attachment.url
  ) || '');
  if (!source) return null;
  return new Promise((resolve) => {
    const image = new Image();
    const finish = (dimensions) => {
      image.onload = null;
      image.onerror = null;
      resolve(dimensions);
    };
    image.onload = () => finish(
      image.naturalWidth > 0 && image.naturalHeight > 0
        ? { width: image.naturalWidth, height: image.naturalHeight }
        : null
    );
    image.onerror = () => finish(null);
    image.src = source;
  });
}

async function resolveAssistantImageGenerationOptions(options, attachments) {
  if (AiAssistant.kind !== 'image') return options;
  const capabilities = assistantImageCapabilities();
  const referenceImages = attachments.filter((attachment) => assistantFileKind(attachment) === 'image');
  let aspectRatio = String(options.aspectRatio || '').trim();
  let size = String(options.size || '').trim();

  if (referenceImages.length && aspectRatio === 'auto') {
    const dimensions = await loadAssistantImageAttachmentDimensions(referenceImages[0]);
    const sourceRatio = dimensions ? `${dimensions.width}:${dimensions.height}` : '';
    const savedRatio = AiAssistant.referenceAutoState && AiAssistant.referenceAutoState.ratio;
    aspectRatio = supportedImageAspectRatio(
      sourceRatio || savedRatio || (AiAssistant.config && AiAssistant.config.imageAspectRatio) || '1:1',
      capabilities,
      true
    );
  }

  if (referenceImages.length && size === 'auto') {
    const savedSize = AiAssistant.referenceAutoState && AiAssistant.referenceAutoState.size;
    size = supportedImageSizeForRatio(
      savedSize || (AiAssistant.config && AiAssistant.config.imageSize) || '1K',
      aspectRatio,
      capabilities,
      referenceImages.length
    );
  }

  return { ...options, aspectRatio, size };
}

function syncAssistantReferenceAutoMode() {
  const ratioSelect = document.getElementById('ai-assistant-ratio');
  const sizeSelect = document.getElementById('ai-assistant-size');
  if (!ratioSelect || !sizeSelect) return false;
  if (AiAssistant.kind !== 'image') {
    AiAssistant.referenceAutoState = null;
    return false;
  }

  if (assistantImageReferenceAutoActive()) {
    if (!AiAssistant.referenceAutoState) {
      AiAssistant.referenceAutoState = {
        ratio: ratioSelect.value || 'auto',
        size: sizeSelect.value || 'auto',
        ratioDisabled: ratioSelect.disabled,
        sizeDisabled: sizeSelect.disabled
      };
    }
    const ensureAutoOption = (select) => {
      if ([...select.options].some((option) => option.value === 'auto')) return;
      const option = document.createElement('option');
      option.value = 'auto';
      option.textContent = t('Auto', '自动');
      select.insertBefore(option, select.firstChild);
    };
    ensureAutoOption(ratioSelect);
    ensureAutoOption(sizeSelect);
    ratioSelect.value = 'auto';
    sizeSelect.value = 'auto';
    ratioSelect.disabled = true;
    sizeSelect.disabled = true;
    const title = t('Auto matches the reference image.', '已根据参考图自动匹配尺寸。');
    ratioSelect.title = title;
    sizeSelect.title = title;
    ratioSelect.setAttribute('aria-label', title);
    sizeSelect.setAttribute('aria-label', title);
    return true;
  }

  const saved = AiAssistant.referenceAutoState;
  if (!saved) return false;
  AiAssistant.referenceAutoState = null;
  ratioSelect.disabled = saved.ratioDisabled === true;
  sizeSelect.disabled = saved.sizeDisabled === true;
  ratioSelect.removeAttribute('title');
  sizeSelect.removeAttribute('title');
  ratioSelect.removeAttribute('aria-label');
  sizeSelect.removeAttribute('aria-label');
  if ([...ratioSelect.options].some((option) => option.value === saved.ratio)) {
    ratioSelect.value = saved.ratio;
  }
  if ([...sizeSelect.options].some((option) => option.value === saved.size)) {
    sizeSelect.value = saved.size;
  }
  return true;
}

function resetAssistantReferenceAutoMode() {
  const ratioSelect = document.getElementById('ai-assistant-ratio');
  const sizeSelect = document.getElementById('ai-assistant-size');
  AiAssistant.referenceAutoState = null;
  [ratioSelect, sizeSelect].filter(Boolean).forEach((select) => {
    select.disabled = false;
    select.removeAttribute('title');
    select.removeAttribute('aria-label');
  });
}

function assistantAttachmentLimit() {
  if (AiAssistant.kind === 'chat') return 8;
  const capabilities = AiAssistant.kind === 'video'
    ? assistantVideoCapabilities()
    : assistantImageCapabilities();
  const maximum = Number(capabilities.maxReferenceImages);
  if (Number.isFinite(maximum) && maximum >= 0) return Math.floor(maximum);
  return AiAssistant.kind === 'video' ? 2 : 4;
}

function syncAssistantMediaOptions() {
  const isVideo = AiAssistant.kind === 'video';
  const capabilities = isVideo ? assistantVideoCapabilities() : assistantImageCapabilities();
  if (assistantImageReferenceAutoActive()) syncAssistantReferenceAutoMode();
  const limit = assistantAttachmentLimit();
  if (AiAssistant.attachments.length > limit) {
    AiAssistant.attachments = AiAssistant.attachments.slice(0, limit);
    renderAssistantAttachments();
  }
  const sizeWrap = document.getElementById('ai-assistant-size-wrap');
  const sizeSelect = document.getElementById('ai-assistant-size');
  const qualityWrap = document.getElementById('ai-assistant-quality-wrap');
  const qualityInput = document.getElementById('ai-assistant-quality');
  const durationSelect = document.getElementById('ai-assistant-duration');
  const resolutions = isVideo
    ? (Array.isArray(capabilities.resolutions) ? capabilities.resolutions : ['768P', '2K'])
    : (assistantMediaAttachmentCount() > 1 && Array.isArray(capabilities.multiReferenceSizes)
      ? capabilities.multiReferenceSizes
      : assistantMediaAttachmentCount() > 0 && Array.isArray(capabilities.referenceSizes)
        ? capabilities.referenceSizes
      : Array.isArray(capabilities.resolutionPresets) && capabilities.resolutionPresets.length
        ? capabilities.resolutionPresets
      : Array.isArray(capabilities.sizes) && capabilities.sizes.length
        ? capabilities.sizes
        : ['1K', '2K', '4K']);
  const selectedVideoMode = isVideo ? assistantVideoModeForAttachments() : null;
  const durations = isVideo && selectedVideoMode && Array.isArray(selectedVideoMode.durations)
    && selectedVideoMode.durations.length
    ? selectedVideoMode.durations
    : isVideo && Array.isArray(capabilities.durations) && capabilities.durations.length
      ? capabilities.durations
    : [6, 8, 10, 15];
  const previousSize = sizeSelect.value;
  const previousDuration = Number(durationSelect.value);

  sizeWrap.hidden = isVideo && !capabilities.resolutions;
  sizeSelect.innerHTML = '';
  const appendResolutionOption = (container, value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value === 'Default'
      ? t('Default', '默认', '기본')
      : isVideo ? assistantVideoResolutionLabel(value) : value;
    container.appendChild(option);
  };
  const resolutionGroups = isVideo ? assistantVideoResolutionGroups(resolutions) : [];
  if (resolutionGroups.length > 1) {
    resolutionGroups.forEach((group) => {
      const optionGroup = document.createElement('optgroup');
      optionGroup.label = group.label;
      optionGroup.dataset.resolutionTier = group.id;
      group.values.forEach((value) => appendResolutionOption(optionGroup, value));
      sizeSelect.appendChild(optionGroup);
    });
  } else {
    resolutions.forEach((value) => appendResolutionOption(sizeSelect, value));
  }
  if (isVideo) {
    sizeSelect.value = resolutions.includes(previousSize) ? previousSize : resolutions[0];
  } else {
    sizeSelect.value = supportedImageSizeForRatio(
      previousSize,
      (AiAssistant.config && AiAssistant.config.imageAspectRatio) || '1:1',
      capabilities,
      assistantMediaAttachmentCount()
    );
  }

  const configuredQualities = !isVideo && Array.isArray(capabilities.qualities)
    ? capabilities.qualities.map((value) => String(value || '').trim().toLowerCase())
    : [];
  const visibleQualities = ['low', 'medium', 'high'].filter((quality) => configuredQualities.includes(quality));
  qualityWrap.hidden = visibleQualities.length < 2;
  const previousQuality = String(qualityInput.value || '').toLowerCase();
  qualityInput.value = visibleQualities.includes(previousQuality)
    ? previousQuality
    : visibleQualities.includes('medium') ? 'medium' : visibleQualities[0] || 'auto';
  document.querySelectorAll('#ai-assistant-quality-buttons [data-quality]').forEach((button) => {
    const quality = button.dataset.quality;
    button.hidden = !visibleQualities.includes(quality);
    const active = quality === qualityInput.value;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
    button.textContent = quality === 'low'
      ? t('Low', '低')
      : quality === 'high' ? t('High', '高') : t('Medium', '中');
  });

  durationSelect.innerHTML = '';
  durations.forEach((value) => {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = Number(value) === -1 ? t('Auto', '\u81ea\u52a8') : `${value}s`;
    durationSelect.appendChild(option);
  });
  durationSelect.value = durations.includes(previousDuration)
    ? String(previousDuration)
    : String(durations[0]);
  renderAssistantRatios({ syncReferenceAuto: false });
  if (!isVideo && !assistantImageReferenceAutoActive()) syncAssistantImageSizeRatio('size');
  if (!isVideo) syncAssistantReferenceAutoMode();
  refreshAssistantOptionPickers();
  refreshAssistantOptionSummary();
  updateAssistantCreditEstimate();
}

function renderAssistantAttachments() {
  const container = document.getElementById('ai-assistant-attachments');
  container.innerHTML = '';
  container.hidden = AiAssistant.attachments.length === 0;
  AiAssistant.attachments.forEach((attachment) => {
    const item = document.createElement('div');
    item.className = 'ai-assistant-attachment';
    const kind = assistantFileKind(attachment);
    let preview;
    if (kind === 'image' && (attachment.dataUrl || attachment.thumbUrl || attachment.previewUrl || attachment.url)) {
      preview = document.createElement('img');
      preview.src = attachment.dataUrl || attachment.thumbUrl || attachment.previewUrl || attachment.url;
      preview.alt = attachment.name;
    } else {
      preview = createAssistantFileIcon(attachment);
    }
    const copy = document.createElement('span');
    copy.className = 'ai-assistant-attachment-copy';
    const name = document.createElement('b');
    name.textContent = attachment.name;
    const meta = document.createElement('small');
    meta.textContent = `${kind === 'image' ? t('Image', '图片') : t('File', '文件')} · ${formatAssistantFileSize(attachment.sizeBytes)}`;
    copy.append(name, meta);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    remove.title = t('Remove attachment', '移除附件');
    remove.setAttribute('aria-label', remove.title);
    remove.addEventListener('click', () => {
      AiAssistant.attachments = AiAssistant.attachments.filter((entry) => entry.id !== attachment.id);
      renderAssistantAttachments();
      syncAssistantMediaOptions();
    });
    item.append(preview, copy, remove);
    container.appendChild(item);
  });
}

function appendAssistantMessageAttachments(row, attachments) {
  if (!row || !attachments.length) return;
  const strip = document.createElement('div');
  strip.className = 'ai-assistant-message-attachments';
  attachments.forEach((attachment) => {
    const kind = assistantFileKind(attachment);
    if (kind === 'image' && (attachment.dataUrl || attachment.thumbUrl || attachment.previewUrl || attachment.url)) {
      const image = document.createElement('img');
      image.src = attachment.dataUrl || attachment.thumbUrl || attachment.previewUrl || attachment.url;
      image.alt = attachment.name;
      image.title = attachment.name;
      strip.appendChild(image);
      return;
    }
    const file = document.createElement('div');
    file.className = 'ai-assistant-message-file';
    file.appendChild(createAssistantFileIcon(attachment));
    const copy = document.createElement('span');
    const name = document.createElement('b');
    name.textContent = attachment.name;
    const meta = document.createElement('small');
    meta.textContent = formatAssistantFileSize(attachment.sizeBytes);
    copy.append(name, meta);
    file.appendChild(copy);
    strip.appendChild(file);
  });
  row.appendChild(strip);
  const messages = document.getElementById('ai-assistant-messages');
  messages.scrollTop = messages.scrollHeight;
}

function assistantVideoResolutionLabel(value) {
  const resolution = String(value || '').trim().toUpperCase();
  if (resolution.includes('-ESR')) {
    const label = resolution.replace('-ESR', '-ESR（增强超分）').replace(' & 60FPS', ' · 60FPS');
    return t(resolution, label, resolution);
  }

  if (resolution.includes('-SR')) {
    return t(resolution, resolution.replace('-SR', '-SR（超分）'), resolution);
  }
  if (resolution === '4K') return t(resolution, '4K（增强超分）', resolution);
  return resolution;
}

function assistantVideoResolutionTier(value) {
  const resolution = String(value || '').trim().toUpperCase();
  if (resolution.includes('-ESR') || resolution === '4K') return 'enhanced';
  if (resolution.includes('-SR')) return 'upscaled';
  return 'native';
}

function assistantVideoResolutionGroups(values) {
  const definitions = [
    { id: 'native', label: t('Native', '原生', '원본') },
    { id: 'upscaled', label: t('Upscaled', '超分', '업스케일') },
    { id: 'enhanced', label: t('Enhanced upscale', '增强超分', '향상 업스케일') }
  ];
  return definitions.map((definition) => ({
    ...definition,
    values: values.filter((value) => assistantVideoResolutionTier(value) === definition.id)
  })).filter((group) => group.values.length);
}

function appendAssistantOutputFiles(row, files) {
  if (!row || !Array.isArray(files) || !files.length) return;
  const strip = document.createElement('div');
  strip.className = 'ai-assistant-output-files';
  files.forEach((file) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ai-assistant-output-file';
    button.appendChild(createAssistantFileIcon(file));
    const copy = document.createElement('span');
    const name = document.createElement('b');
    name.textContent = file.name;
    const meta = document.createElement('small');
    meta.textContent = `${formatAssistantFileSize(file.sizeBytes)} · ${t('Download', '下载')}`;
    copy.append(name, meta);
    button.appendChild(copy);
    button.addEventListener('click', async () => {
      const result = await window.messsAPI.saveGeneratedAiFile(file.token);
      if (result && result.ok) showToast(t('File saved.', '文件已保存。'), 'AI');
      else if (result && !result.canceled) showToast(result.message || t('The file could not be saved.', '文件保存失败。'), 'AI');
    });
    strip.appendChild(button);
  });
  row.appendChild(strip);
}

async function uploadAssistantFiles() {
  const folderId = AppState.activeFolderId && AppState.activeFolderId !== 'default'
    ? AppState.activeFolderId
    : null;
  const result = typeof window.messsAPI.pickAndPrepareAiAttachments === 'function'
    ? await window.messsAPI.pickAndPrepareAiAttachments(folderId, activeCanvasId())
    : null;
  if (result && result.canceled) return;
  if (!result) {
    const paths = await window.messsAPI.pickFiles();
    if (!paths || !paths.length) return;
    const before = AiAssistant.attachments.length;
    const imported = await importAssistantFilePaths(paths);
    if (!imported.length) {
      showToast(t('The file could not be uploaded.', '文件上传失败。'), 'AI');
      return;
    }
    const limit = assistantAttachmentLimit();
    if (AiAssistant.attachments.length - before < imported.length) {
      const message = AiAssistant.kind === 'chat'
        ? t(`Up to ${limit} files can be attached at once.`, `一次最多可附加 ${limit} 个文件。`)
        : t('This generation mode only accepts supported image or video references.', '当前生成模式只接受支持的图片或视频参考。');
      showToast(message, 'AI');
    }
    return;
  }

  const imported = Array.isArray(result.imported) ? result.imported : [];
  mergeAssistantImportedFiles(imported);
  const before = AiAssistant.attachments.length;
  const accepted = (Array.isArray(result.attachments) ? result.attachments : []).filter((attachment) =>
    AiAssistant.kind === 'chat'
      ? true
      : AiAssistant.kind === 'image'
        ? assistantFileKind(attachment) === 'image'
        : ['image', 'video'].includes(assistantFileKind(attachment))
  );
  const limit = assistantAttachmentLimit();
  const available = Math.max(0, limit - AiAssistant.attachments.length);
  AiAssistant.attachments = [
    ...AiAssistant.attachments,
    ...accepted.slice(0, available).filter((attachment) =>
      !AiAssistant.attachments.some((entry) => entry.id === attachment.id)
    )
  ];
  renderAssistantAttachments();
  syncAssistantMediaOptions();

  if (result.failed && result.failed.length) {
    const preparationFailure = result.failed.some((failure) => failure.stage === 'prepare');
    showToast(
      preparationFailure
        ? t('The file was imported, but could not be attached to AI.', '文件已导入，但无法作为 AI 附件读取。')
        : t('Some files could not be uploaded.', '部分文件上传失败。'),
      'AI'
    );
  }
  if (!imported.length && !accepted.length) {
    showToast(t('The file could not be uploaded.', '文件上传失败。'), 'AI');
    return;
  }
  if (AiAssistant.attachments.length - before < accepted.length) {
    const message = AiAssistant.kind === 'chat'
      ? t(`Up to ${limit} files can be attached at once.`, `一次最多可附加 ${limit} 个文件。`)
      : t('This generation mode only accepts supported image or video references.', '当前生成模式只接受支持的图片或视频参考。');
    showToast(message, 'AI');
  }
}

function renderAssistantRatios(options = {}) {
  const select = document.getElementById('ai-assistant-ratio');
  const capabilities = AiAssistant.kind === 'video' ? assistantVideoCapabilities() : assistantImageCapabilities();
  const selectedVideoMode = AiAssistant.kind === 'video' ? assistantVideoModeForAttachments() : null;
  const previous = select.value;
  const ratios = AiAssistant.kind === 'video'
    ? assistantVideoRatios(selectedVideoMode, capabilities)
    : (assistantHasMediaAttachments() && Array.isArray(capabilities.referenceRatios)
      ? capabilities.referenceRatios
      : (Array.isArray(capabilities.ratios) && capabilities.ratios.length
        ? capabilities.ratios
        : AI_IMAGE_RATIOS));
  const config = AiAssistant.config || {};
  const selected = AiAssistant.kind === 'video'
    ? supportedAssistantVideoRatio(previous || config.videoAspectRatio, selectedVideoMode, capabilities)
    : (config.imageAspectRatio || '1:1');
  select.innerHTML = '';
  ratios.forEach((ratio) => {
    const option = document.createElement('option');
    option.value = ratio;
    option.textContent = ratio === 'auto' || ratio === 'adaptive' ? t('Auto', '自动') : ratio;
    select.appendChild(option);
  });
  select.value = ratios.includes(selected) ? selected : ratios[0];
  select.disabled = ratios.length < 2;
  if (options.syncReferenceAuto !== false) syncAssistantReferenceAutoMode();
  refreshAssistantOptionPickers();
  refreshAssistantOptionSummary();
}

function syncAssistantImageSizeRatio(source) {
  if (AiAssistant.kind !== 'image') return;
  const sizeSelect = document.getElementById('ai-assistant-size');
  const ratioSelect = document.getElementById('ai-assistant-ratio');
  const capabilities = assistantImageCapabilities();
  if (source === 'ratio') {
    sizeSelect.value = imageSizeForRatio(
      ratioSelect.value,
      capabilities,
      assistantMediaAttachmentCount()
    ) || sizeSelect.value;
  } else {
    ratioSelect.value = imageRatioForSize(sizeSelect.value, capabilities) || ratioSelect.value;
  }
}

function closeAssistantOptionMenus(except = null) {
  document.querySelectorAll('.ai-assistant-option-menu:not([hidden])').forEach((menu) => {
    if (menu === except) return;
    menu.hidden = true;
    const trigger = menu.parentElement && menu.parentElement.querySelector('.ai-assistant-option-trigger');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  });
}

function renderAssistantOptionPicker(picker) {
  const select = document.getElementById(picker.dataset.optionPicker);
  const trigger = picker.querySelector('.ai-assistant-option-trigger');
  const label = trigger && trigger.querySelector('span');
  const menu = picker.querySelector('.ai-assistant-option-menu');
  if (!select || !trigger || !label || !menu) return;

  const selected = select.options[select.selectedIndex];
  label.textContent = selected ? selected.textContent : '';
  trigger.disabled = select.disabled || select.options.length < 1;
  trigger.setAttribute('aria-disabled', String(trigger.disabled));
  menu.replaceChildren();

  const appendOption = (option) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ai-assistant-option-choice';
    button.dataset.optionValue = option.value;
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', String(option.value === select.value));
    button.disabled = option.disabled;
    button.innerHTML = '<span></span><i aria-hidden="true">✓</i>';
    button.querySelector('span').textContent = option.textContent;
    button.querySelector('i').hidden = option.value !== select.value;
    menu.appendChild(button);
  };

  [...select.children].forEach((child) => {
    if (child.tagName === 'OPTGROUP') {
      const heading = document.createElement('div');
      heading.className = 'ai-assistant-option-group-label';
      heading.textContent = child.label;
      menu.appendChild(heading);
      [...child.children].forEach(appendOption);
      return;
    }
    if (child.tagName === 'OPTION') appendOption(child);
  });
}

function refreshAssistantOptionPickers() {
  document.querySelectorAll('.ai-assistant-option-picker').forEach(renderAssistantOptionPicker);
}

function initAssistantOptionPickers() {
  const options = document.getElementById('ai-assistant-options');
  if (!options) return;
  if (options.dataset.optionPickersInitialized === 'true') return;
  options.dataset.optionPickersInitialized = 'true';
  options.addEventListener('click', (event) => {
    const trigger = event.target.closest('.ai-assistant-option-trigger');
    if (trigger) {
      const picker = trigger.closest('.ai-assistant-option-picker');
      const menu = picker && picker.querySelector('.ai-assistant-option-menu');
      if (!menu || trigger.disabled) return;
      const opening = menu.hidden;
      closeAssistantOptionMenus(opening ? menu : null);
      menu.hidden = !opening;
      trigger.setAttribute('aria-expanded', String(opening));
      return;
    }

    const choice = event.target.closest('.ai-assistant-option-choice');
    if (!choice || choice.disabled) return;
    const picker = choice.closest('.ai-assistant-option-picker');
    const select = picker && document.getElementById(picker.dataset.optionPicker);
    if (!select) return;
    select.value = choice.dataset.optionValue;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    closeAssistantOptionMenus();
  });
  document.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('.ai-assistant-option-picker')) closeAssistantOptionMenus();
  }, true);
  refreshAssistantOptionPickers();
}

function refreshAssistantOptionSummary() {
  const toggle = document.getElementById('ai-assistant-options-toggle');
  if (!toggle) return;
  const ratio = document.getElementById('ai-assistant-ratio').value || 'auto';
  if (AiAssistant.kind === 'video') {
    const duration = document.getElementById('ai-assistant-duration').value || '6';
    const durationLabel = Number(duration) === -1 ? t('Auto', '\u81ea\u52a8') : `${duration}s`;
    const sizeWrap = document.getElementById('ai-assistant-size-wrap');
    const resolution = sizeWrap.hidden ? '' : ` · ${document.getElementById('ai-assistant-size').value}`;
    toggle.textContent = `${ratio}${resolution} · ${durationLabel}`;
  } else {
    const size = document.getElementById('ai-assistant-size').value || '1K';
    const count = document.getElementById('ai-assistant-count').value || '1';
    const qualityWrap = document.getElementById('ai-assistant-quality-wrap');
    const quality = document.getElementById('ai-assistant-quality').value;
    const qualityLabel = qualityWrap.hidden ? '' : ` · ${quality === 'low' ? t('Low', '低') : quality === 'high' ? t('High', '高') : t('Medium', '中')}`;
    toggle.textContent = `${ratio} · ${size}${qualityLabel} · x${count}`;
  }
}

function setAssistantKind(kind) {
  const panel = document.getElementById('ai-assistant-panel');
  if (panel && panel.classList.contains('is-chat-only-compact') && kind !== 'chat') {
    kind = 'chat';
  }
  if (AiAssistant.kind === 'image' && kind !== 'image') resetAssistantReferenceAutoMode();
  AiAssistant.kind = ['chat', 'image', 'video'].includes(kind) ? kind : 'chat';
  document.querySelectorAll('[data-assistant-kind]').forEach((button) => {
    const active = button.dataset.assistantKind === AiAssistant.kind;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  });

  const input = document.getElementById('ai-assistant-input');
  input.placeholder = AiAssistant.kind === 'chat'
    ? t('Type a message...', '输入消息...')
    : AiAssistant.kind === 'image'
      ? t('Describe the subject, composition, lighting, and color mood...', '描述主体、构图、光线和色彩氛围...')
      : t('Describe motion, shots, environment, and sound...', '描述动作、镜头、环境和声音...');

  const isMedia = AiAssistant.kind !== 'chat';
  const isVideo = AiAssistant.kind === 'video';
  const attachmentCountBeforeModeFilter = AiAssistant.attachments.length;
  if (isMedia) {
    AiAssistant.attachments = AiAssistant.attachments.filter((attachment) =>
      isVideo
        ? ['image', 'video'].includes(assistantFileKind(attachment))
        : assistantFileKind(attachment) === 'image'
    );
  }
  const attachmentLimit = assistantAttachmentLimit();
  if (AiAssistant.attachments.length > attachmentLimit) {
    AiAssistant.attachments = AiAssistant.attachments.slice(0, attachmentLimit);
    renderAssistantAttachments();
  } else if (AiAssistant.attachments.length !== attachmentCountBeforeModeFilter) {
    renderAssistantAttachments();
  }
  document.getElementById('ai-assistant-options-toggle').hidden = !isMedia;
  document.getElementById('ai-assistant-count-wrap').hidden = isVideo;
  document.getElementById('ai-assistant-duration-wrap').hidden = !isVideo;
  if (!isMedia) {
    document.getElementById('ai-assistant-options').hidden = true;
  }
  renderAssistantModels();
  syncAssistantMediaOptions();
}

function syncAssistantCompactMode(panel) {
  if (!panel) return;
  const width = panel.getBoundingClientRect().width;
  const wasCompact = panel.classList.contains('is-chat-only-compact');
  const compact = wasCompact ? width < 380 : width <= 360;
  panel.classList.toggle('is-chat-only-compact', compact);
  panel.dataset.assistantLayout = compact ? 'agent-only' : 'full';
  if (!compact) return;

  const modelMenu = document.getElementById('ai-assistant-model-menu');
  const modelTrigger = document.getElementById('ai-assistant-model-trigger');
  const options = document.getElementById('ai-assistant-options');
  const optionsToggle = document.getElementById('ai-assistant-options-toggle');
  if (modelMenu) modelMenu.hidden = true;
  if (modelTrigger) modelTrigger.setAttribute('aria-expanded', 'false');
  if (options) options.hidden = true;
  if (optionsToggle) optionsToggle.classList.remove('is-active');
  if (AiAssistant.kind !== 'chat') setAssistantKind('chat');
}

function showAssistantConversation() {
  document.getElementById('ai-assistant-home').hidden = true;
  document.getElementById('ai-assistant-messages').hidden = false;
}

function appendAssistantText(role, text, className = '') {
  showAssistantConversation();
  const messages = document.getElementById('ai-assistant-messages');
  const row = document.createElement('div');
  row.className = `ai-assistant-message is-${role}${className ? ` ${className}` : ''}`;
  const body = document.createElement('div');
  body.className = 'ai-assistant-message-body';
  body.textContent = text;
  row.appendChild(body);
  messages.appendChild(row);
  messages.scrollTop = messages.scrollHeight;
  return row;
}

function appendAssistantMedia(files, kind) {
  const messages = document.getElementById('ai-assistant-messages');
  const row = document.createElement('div');
  row.className = 'ai-assistant-message is-assistant';
  const body = document.createElement('div');
  body.className = 'ai-assistant-message-body';
  const completionText = kind === 'video'
    ? t('Video generated and saved to the library.', '视频已生成并保存到资料库。')
    : t(`${files.length} image${files.length === 1 ? '' : 's'} generated and saved to the library.`, `${files.length} 张图片已生成并保存到资料库。`);
  body.textContent = completionText;
  const grid = document.createElement('div');
  grid.className = 'ai-assistant-media-grid';

  files.forEach((file) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ai-assistant-media';
    button.title = file.name;
    button.draggable = true;
    if (kind === 'video') {
      const video = document.createElement('video');
      video.src = file.url;
      video.muted = true;
      video.preload = 'metadata';
      button.appendChild(video);
      const play = document.createElement('span');
      play.className = 'ai-assistant-media-play';
      play.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><polygon points="7 4 20 12 7 20"/></svg>';
      button.appendChild(play);
    } else {
      const image = document.createElement('img');
      image.src = file.thumbUrl || file.url;
      image.alt = file.name;
      image.loading = 'lazy';
      button.appendChild(image);
    }
    button.addEventListener('click', () => selectFileForPreview(file.id));
    button.addEventListener('dragstart', (event) => {
      event.dataTransfer.setData('application/x-messs-file-id', file.id);
      event.dataTransfer.effectAllowed = 'copy';
    });
    grid.appendChild(button);
  });

  row.append(body, grid);
  messages.appendChild(row);
  messages.scrollTop = messages.scrollHeight;
}

function setAssistantBusy(busy) {
  AiAssistant.activeTasks = Math.max(0, AiAssistant.activeTasks + (busy ? 1 : -1));
  AiAssistant.busy = AiAssistant.activeTasks > 0;
  const submit = document.getElementById('ai-assistant-submit');
  submit.classList.toggle('is-busy', AiAssistant.busy);
  submit.disabled = !selectedAssistantProvider();
}

async function submitAssistantMessage() {
  const input = document.getElementById('ai-assistant-input');
  const submittedKind = AiAssistant.kind;
  const submittedProvider = selectedAssistantProvider();
  const attachments = AiAssistant.attachments.map((attachment) => ({ ...attachment }));
  let submittedMediaOptions = {
    aspectRatio: document.getElementById('ai-assistant-ratio').value,
    size: document.getElementById('ai-assistant-size').value,
    quality: document.getElementById('ai-assistant-quality').value,
    count: Number(document.getElementById('ai-assistant-count').value),
    duration: Number(document.getElementById('ai-assistant-duration').value)
  };
  if (submittedKind === 'image') {
    submittedMediaOptions = await resolveAssistantImageGenerationOptions(submittedMediaOptions, attachments);
  } else if (submittedKind === 'video') {
    const selectedVideoMode = assistantVideoModeForAttachments(attachments);
    if (!selectedVideoMode) {
      showToast(t('Add the reference image or video required by this model.', '请先添加此模型所需的参考图片或视频。'), 'AI');
      return;
    }
    const minimumReferences = Math.max(0, Number(selectedVideoMode.minReferences) || 0);
    if (attachments.length < minimumReferences) {
      showToast(t(`This mode requires at least ${minimumReferences} reference file(s).`, `此模式至少需要 ${minimumReferences} 个参考文件。`), 'AI');
      return;
    }
    submittedMediaOptions.videoMode = selectedVideoMode.id;
    submittedMediaOptions.aspectRatio = supportedAssistantVideoRatio(
      submittedMediaOptions.aspectRatio,
      selectedVideoMode,
      assistantVideoCapabilities()
    );
  }
  let prompt = input.value.trim();
  if (!prompt && !attachments.length) {
    input.focus();
    return;
  }
  if (!prompt) prompt = t('Analyze the attached files.', '请分析这些附件。');
  if (submittedKind !== 'chat') {
    const creditAccess = await window.MesssCredits.ensure({
      kind: submittedKind,
      imageProviderId: submittedKind === 'image' && submittedProvider ? submittedProvider.id : null,
      videoProviderId: submittedKind === 'video' && submittedProvider ? submittedProvider.id : null,
      count: submittedMediaOptions.count,
      quality: submittedKind === 'image' ? submittedMediaOptions.quality : undefined,
      duration: submittedMediaOptions.duration,
      size: submittedKind === 'image' ? submittedMediaOptions.size : undefined,
      resolution: submittedKind === 'video'
        ? submittedMediaOptions.size
        : undefined,
      referenceMediaTypes: attachments.map((attachment) => assistantFileKind(attachment))
    });
    if (!creditAccess.ok) return;
  }
  input.value = '';
  AiAssistant.attachments = [];
  renderAssistantAttachments();
  syncAssistantMediaOptions();
  ensureAiChatSession(prompt);
  const userRow = appendAssistantText('user', prompt);
  appendAssistantMessageAttachments(userRow, attachments);
  AiAssistant.messages.push({
    role: 'user',
    content: prompt,
    attachmentFileIds: attachments.filter((item) => !item.attachmentToken).map((item) => item.id),
    attachmentTokens: attachments.map((item) => item.attachmentToken).filter(Boolean),
    attachments: attachments.map((item) => ({
      id: item.id,
      name: item.name,
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes,
      kind: assistantFileKind(item),
      dataUrl: item.dataUrl || ''
    }))
  });
  persistActiveAiChatSession();

  if (false) {
    AiAssistant.messages.push({ role: 'user', content: prompt, images: attachments.map((item) => item.dataUrl) });
    const greeting = 'Hi, I am here. You can ask me to make images, edit images, make videos, or just think through an idea.';
    const zhGreeting = '你好，我在这里。你可以让我生成图片、编辑图片、制作视频，或者一起梳理一个想法。';
    AiAssistant.messages.push({ role: 'assistant', content: greeting });
    appendAssistantText('assistant', t(greeting, zhGreeting));
    return;
  }

  setAssistantBusy(true);
  const modelName = submittedProvider
    ? (typeof publicModelLabel === 'function' ? publicModelLabel(submittedProvider.name) : submittedProvider.name)
    : 'AI model';
  const modelNameZh = submittedProvider
    ? (typeof publicModelLabel === 'function' ? publicModelLabel(submittedProvider.name) : submittedProvider.name)
    : t('AI model', 'AI 模型');
  const pending = appendAssistantText(
    'assistant',
    submittedKind === 'chat'
      ? t('Thinking...', '思考中...')
      : t(`Using ${modelName} to generate ${submittedKind === 'video' ? 'video' : 'image'}...`, `正在使用 ${modelNameZh} 生成${submittedKind === 'video' ? '视频' : '图片'}...`),
    'is-pending'
  );
  const startedAt = Date.now();
  const progress = setInterval(() => {
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    pending.querySelector('.ai-assistant-message-body').textContent =
      submittedKind === 'chat'
        ? t(`Thinking... ${seconds}s`, `思考中... ${seconds} 秒`)
        : t(`Using ${modelName} for ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`, `正在使用 ${modelNameZh} 生成 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
  }, 1000);
  let mediaPlaceholders = [];
  let generatedMediaFiles = [];

  try {
    if (submittedKind === 'chat') {
      const response = await window.messsAPI.chatWithAi({
        prompt,
        messages: AiAssistant.messages,
        attachmentFileIds: attachments.filter((item) => !item.attachmentToken).map((item) => item.id),
        attachmentTokens: attachments.map((item) => item.attachmentToken).filter(Boolean),
        chatProviderId: submittedProvider && submittedProvider.providerId,
        chatModel: submittedProvider && submittedProvider.model
      });
      if (!response || !response.ok) {
        throw new Error((response && response.message) || t('AI chat failed.', 'AI 对话失败。'));
      }
      AiAssistant.messages.push({
        role: 'assistant',
        content: response.text,
        generatedFiles: Array.isArray(response.files) ? response.files : []
      });
      persistActiveAiChatSession();
      pending.remove();
      const assistantRow = appendAssistantText('assistant', response.text);
      appendAssistantOutputFiles(assistantRow, response.files);
    } else {
      const request = {
        kind: submittedKind,
        prompt,
        aspectRatio: submittedMediaOptions.aspectRatio,
        size: submittedMediaOptions.size,
        quality: submittedKind === 'image' ? submittedMediaOptions.quality : undefined,
        resolution: submittedKind === 'video'
          ? submittedMediaOptions.size
          : undefined,
        videoMode: submittedKind === 'video' ? submittedMediaOptions.videoMode : undefined,
        count: submittedMediaOptions.count,
        duration: submittedMediaOptions.duration,
        referenceFileIds: attachments.filter((item) => !item.attachmentToken).map((item) => item.id),
        attachmentTokens: attachments.map((item) => item.attachmentToken).filter(Boolean),
        urls: [],
        imageProviderId: submittedKind === 'image' && submittedProvider ? submittedProvider.id : null,
        videoProviderId: submittedKind === 'video' && submittedProvider ? submittedProvider.id : null,
        canvasId: activeCanvasId(),
        folderId: AppState.activeFolderId && AppState.activeFolderId !== 'default'
          ? AppState.activeFolderId
          : null
      };
      if (typeof createAiPlaceholders === 'function') {
        mediaPlaceholders = createAiPlaceholders(request);
        request.placements = mediaPlaceholders.map((placeholder) => ({
          id: placeholder.id,
          canvasId: placeholder.canvasId,
          x: placeholder.x,
          y: placeholder.y,
          width: placeholder.width,
          height: placeholder.height,
          aspectRatio: placeholder.aspectRatio,
          zIndex: placeholder.zIndex
        }));
      }
      const response = await window.messsAPI.generateAiMedia(request);
      if (response && response.membership) window.MesssCredits.publish(response.membership);
      const files = response && Array.isArray(response.files)
        ? response.files
        : (response && response.file ? [response.file] : []);
      generatedMediaFiles = files;
      if (!response || !response.ok || !files.length) {
        throw new Error((response && response.message) || t('AI generation failed.', 'AI 生成失败。'));
      }
      AppState.files = [...files, ...AppState.files.filter((file) =>
        !files.some((generated) => generated.id === file.id)
      )];
      if (mediaPlaceholders.length && typeof replaceAiPlaceholders === 'function') {
        await replaceAiPlaceholders(mediaPlaceholders, files, request, response.boardItems || []);
        mediaPlaceholders = [];
      } else {
        const center = boardViewportCenterCoords();
        await addFilesToBoard(files.map((file) => file.id), center.x, center.y);
      }
      generatedMediaFiles = await confirmAiMediaDeliveries(files);
      renderFileList(currentFileListScope());
      renderFolderGridIfActive();
      if (response.unlocked && response.unlocked.length) await refreshAchievements();
      pending.remove();
      appendAssistantMedia(generatedMediaFiles, submittedKind);
      if (response.fallback && response.fallback.notice) showToast(response.fallback.notice, 'AI');
      AiAssistant.messages.push({
        role: 'assistant',
        content: `${submittedKind === 'video'
          ? t('Video generated and saved to the library.', '视频已生成并保存到资料库。')
          : t(`${generatedMediaFiles.length} image${generatedMediaFiles.length === 1 ? '' : 's'} generated and saved to the library.`, `${generatedMediaFiles.length} 张图片已生成并保存到资料库。`)}`
      });
      persistActiveAiChatSession();
    }
  } catch (err) {
    if (generatedMediaFiles.length && err && err.aiDeliveryConfirmationAttempted !== true) {
      try { await releaseAiMediaDeliveries(generatedMediaFiles); } catch (releaseError) {
        console.error('Could not release a failed AI media result:', releaseError);
      }
    }
    if (mediaPlaceholders.length && typeof removeAiPlaceholders === 'function') {
      removeAiPlaceholders(mediaPlaceholders);
      mediaPlaceholders = [];
    }
    pending.classList.remove('is-pending');
    pending.classList.add('is-error');
    pending.querySelector('.ai-assistant-message-body').textContent =
      typeof publicAiErrorMessage === 'function'
        ? publicAiErrorMessage(err && err.message, t('Request failed. Please try again.', '请求失败，请重试。'))
        : (err && err.message ? err.message : t('Request failed. Please try again.', '请求失败，请重试。'));
  } finally {
    clearInterval(progress);
    setAssistantBusy(false);
    input.focus();
  }
}

async function refreshAssistantConfig(config) {
  try {
    AiAssistant.config = config || await window.messsAPI.getAiMediaConfig();
    document.getElementById('ai-assistant-size').value = AiAssistant.config.imageSize || '1K';
    document.getElementById('ai-assistant-duration').value = String(AiAssistant.config.videoDuration || 6);
    renderAssistantModels();
    syncAssistantMediaOptions();
  } catch (err) {
    showToast(t('Failed to load API settings.', 'API 设置加载失败。'), 'AI');
  }
}

function refreshAssistantLanguage() {
  if (AiAssistant.kind) setAssistantKind(AiAssistant.kind);
  if (AiAssistant.config) {
    renderAssistantModels();
    renderAssistantRatios();
  }
  refreshAssistantCreditEstimateLanguage();
  const upload = document.getElementById('ai-assistant-upload');
  if (upload) {
    upload.title = t('Add files', '添加文件');
    upload.setAttribute('aria-label', upload.title);
  }
  const historyHeading = document.querySelector('.ai-chat-history-heading');
  if (historyHeading) historyHeading.textContent = t('History', '\u5386\u53f2\u8bb0\u5f55');
  const pinnedLabel = document.getElementById('ai-chat-history-pinned-label');
  if (pinnedLabel) pinnedLabel.textContent = t('Pinned', '\u7f6e\u9876');
  const recentLabel = document.getElementById('ai-chat-history-recent-label');
  if (recentLabel) recentLabel.textContent = t('Recent', '\u6700\u8fd1');
  const historyDate = document.getElementById('ai-chat-history-date');
  if (historyDate) historyDate.setAttribute('aria-label', t('Filter history by date', '\u6309\u65e5\u671f\u7b5b\u9009\u5386\u53f2\u8bb0\u5f55'));
  const chatButton = document.querySelector('[data-assistant-kind="chat"]');
  if (chatButton) chatButton.textContent = 'Agent';
  [
    ['image', t('Image', '图片')],
    ['video', t('Video', '视频')]
  ].forEach(([kind, label]) => {
    const button = document.querySelector(`[data-assistant-kind="${kind}"]`);
    if (!button) return;
    button.title = label;
    button.setAttribute('aria-label', label);
  });
  const home = document.getElementById('ai-assistant-home');
  const messages = document.getElementById('ai-assistant-messages');
  if (home && !home.hidden) {
    document.querySelectorAll('.ai-assistant-quick-prompts button').forEach((button) => {
      if (button.dataset.aiQuickAction === 'poster') {
        button.textContent = t('Create Poster', '生成海报');
        button.dataset.aiQuick = t('Help me create a professional poster.', '帮我生成一张专业海报。');
      } else if (button.dataset.aiQuickAction === 'logo') {
        button.textContent = t('Create LOGO', '生成 LOGO');
        button.dataset.aiQuick = t('Help me design a clean and professional logo.', '帮我设计一个简洁专业的 LOGO。');
      } else if (button.dataset.aiQuickAction === 'clarify') {
        button.textContent = t('Clarify Idea', '理清想法');
        button.dataset.aiQuick = t('Help me organize this idea into a clear execution plan.', '帮我把这个想法整理成清晰的执行计划。');
      } else if (button.dataset.aiQuickAction === 'short-video') {
        button.textContent = t('Short Video', '短视频');
        button.dataset.aiQuick = t('Generate a short video prompt with camera movement.', '生成一个带镜头运动的短视频提示词。');
      }
    });
  }
  if (messages && !messages.hidden) {
    messages.querySelectorAll('.ai-assistant-message-body').forEach((body) => {
      if (body.textContent === 'Thinking...') body.textContent = t('Thinking...', '思考中...');
    });
  }
  renderAiChatHistory();
  startAiDynamicPrompt();
}

function initAiAssistant() {
  const form = document.getElementById('ai-assistant-form');
  const panel = document.getElementById('ai-assistant-panel');
  initAssistantOptionPickers();
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitAssistantMessage();
  });
  panel.addEventListener('contextmenu', showAgentTextContextMenu);
  document.getElementById('ai-assistant-input').addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && ['a', 'c', 'v', 'x'].includes(event.key.toLowerCase())) {
      event.stopPropagation();
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  document.getElementById('ai-assistant-input').addEventListener('copy', (event) => event.stopPropagation());
  document.getElementById('ai-assistant-input').addEventListener('cut', (event) => event.stopPropagation());
  document.getElementById('ai-assistant-input').addEventListener('paste', (event) => {
    const files = [...(event.clipboardData && event.clipboardData.files || [])];
    if (!files.length) return;
    event.preventDefault();
    addExternalAssistantFiles(files).catch(() => {
      showToast(t('The pasted file could not be added.', '无法添加粘贴的文件。'), 'AI');
    });
  });
  document.querySelector('.ai-assistant-mode').addEventListener('click', (event) => {
    const button = event.target.closest('[data-assistant-kind]');
    if (button) setAssistantKind(button.dataset.assistantKind);
  });
  document.getElementById('ai-assistant-upload').addEventListener('click', () => {
    uploadAssistantFiles().catch((err) => {
      showToast(typeof publicAiErrorMessage === 'function'
        ? publicAiErrorMessage(err && err.message, t('The file could not be uploaded.', '文件上传失败。'))
        : (err && err.message ? err.message : t('The file could not be uploaded.', '文件上传失败。')), 'AI');
    });
  });
  document.getElementById('ai-assistant-model-trigger').addEventListener('click', (event) => {
    const trigger = event.currentTarget;
    if (trigger.disabled) return;
    const menu = document.getElementById('ai-assistant-model-menu');
    const isOpen = !menu.hidden;
    menu.hidden = isOpen;
    trigger.setAttribute('aria-expanded', String(!isOpen));
  });
  let assistantDragDepth = 0;
  form.addEventListener('dragenter', (event) => {
    if (!window.MesssFileDrop || !window.MesssFileDrop.hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    assistantDragDepth += 1;
    form.classList.add('is-image-dragover');
  });
  form.addEventListener('dragover', (event) => {
    if (!window.MesssFileDrop || !window.MesssFileDrop.hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });
  form.addEventListener('dragleave', () => {
    assistantDragDepth = Math.max(0, assistantDragDepth - 1);
    if (!assistantDragDepth) form.classList.remove('is-image-dragover');
  });
  form.addEventListener('drop', async (event) => {
    assistantDragDepth = 0;
    form.classList.remove('is-image-dragover');
    const files = [...(event.dataTransfer && event.dataTransfer.files || [])];
    if (!files.length) return;
    event.preventDefault();
    await addExternalAssistantFiles(files);
  });
  document.getElementById('ai-assistant-options-toggle').addEventListener('click', (event) => {
    const options = document.getElementById('ai-assistant-options');
    options.hidden = !options.hidden;
    event.currentTarget.classList.toggle('is-active', !options.hidden);
  });
  ['ai-assistant-ratio', 'ai-assistant-size', 'ai-assistant-count', 'ai-assistant-duration'].forEach((id) => {
    document.getElementById(id).addEventListener('change', () => {
      if (id === 'ai-assistant-ratio') syncAssistantImageSizeRatio('ratio');
      if (id === 'ai-assistant-size') syncAssistantImageSizeRatio('size');
      refreshAssistantOptionPickers();
      refreshAssistantOptionSummary();
      updateAssistantCreditEstimate();
    });
  });
  document.getElementById('ai-assistant-model').addEventListener('change', syncAssistantMediaOptions);
  document.querySelector('.ai-assistant-quick-prompts').addEventListener('click', (event) => {
    const button = event.target.closest('[data-ai-quick]');
    if (!button) return;
    const text = button.dataset.aiQuick;
    const lower = text.toLowerCase();
    const kind = button.dataset.aiKind || (lower.includes('video') ? 'video' : lower.includes('image') ? 'image' : 'chat');
    setAssistantKind(kind);
    const input = document.getElementById('ai-assistant-input');
    input.value = text;
    input.focus();
  });
  document.getElementById('ai-chat-new').addEventListener('click', startNewAiChat);
  document.querySelectorAll('[data-history-section]').forEach((section) => {
    section.addEventListener('dragover', (event) => {
      if (!event.dataTransfer || !event.dataTransfer.types.includes('text/messs-ai-session')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      event.currentTarget.classList.add('is-drop-target');
    });
    section.addEventListener('dragleave', (event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.classList.remove('is-drop-target');
    });
    section.addEventListener('drop', (event) => {
      event.currentTarget.classList.remove('is-drop-target');
      handleAiChatHistoryDrop(event, event.currentTarget.dataset.historySection);
    });
  });
  document.getElementById('ai-assistant-quality-buttons').addEventListener('click', (event) => {
    const button = event.target.closest('[data-quality]');
    if (!button || button.hidden) return;
    document.getElementById('ai-assistant-quality').value = button.dataset.quality;
    document.querySelectorAll('#ai-assistant-quality-buttons [data-quality]').forEach((option) => {
      const active = option === button;
      option.classList.toggle('is-active', active);
      option.setAttribute('aria-pressed', String(active));
    });
    refreshAssistantOptionSummary();
    updateAssistantCreditEstimate();
  });
  document.addEventListener('click', (event) => {
    const picker = document.querySelector('.ai-assistant-model-picker');
    if (picker && !picker.contains(event.target)) {
      document.getElementById('ai-assistant-model-menu').hidden = true;
      document.getElementById('ai-assistant-model-trigger').setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('messs:ai-config-updated', (event) => refreshAssistantConfig(event.detail));
  document.addEventListener('messs:language-changed', () => refreshAssistantLanguage());
  void loadAiChatHistory();
  renderAiChatHistory();
  setAssistantKind('chat');
  syncAssistantCompactMode(panel);
  if (typeof ResizeObserver === 'function') {
    if (AiAssistant.compactObserver) AiAssistant.compactObserver.disconnect();
    AiAssistant.compactObserver = new ResizeObserver(() => syncAssistantCompactMode(panel));
    AiAssistant.compactObserver.observe(panel);
  }
  startAiDynamicPrompt();
  refreshAssistantConfig();
}
