'use strict';

const ChatUiState = {
  initialized: false,
  initializing: false,
  state: null,
  activeConversationId: null,
  historyCursor: null,
  historyHasMore: false,
  historyLoading: false,
  renderedMessageIds: new Set(),
  refreshTimer: null
};

function chatEl(id) { return document.getElementById(id); }

function chatNotice(message) {
  if (typeof showToast === 'function') showToast(String(message || ''));
}

function chatInitials(profile) {
  const name = String(profile && profile.displayName || profile && profile.email || 'M').trim();
  return Array.from(name)[0] ? Array.from(name)[0].toUpperCase() : 'M';
}

function chatAvatar(profile, className = 'chat-avatar') {
  const avatar = document.createElement('span');
  avatar.className = className;
  avatar.textContent = chatInitials(profile);
  return avatar;
}

function chatProfileCopy(profile) {
  const copy = document.createElement('span');
  copy.className = 'chat-person-copy';
  const strong = document.createElement('strong');
  strong.textContent = profile.displayName || 'Messs user';
  const small = document.createElement('small');
  small.textContent = profile.messsId || profile.email || '';
  copy.append(strong, small);
  return copy;
}

function chatPublicProfile(profile) {
  if (!profile) return null;
  return {
    id: profile.id,
    messsId: profile.messsId || '',
    displayName: profile.displayName || 'Messs user',
    avatarUrl: profile.avatarUrl || null,
    relationshipStatus: profile.relationshipStatus || null
  };
}

function chatTime(value) {
  const date = new Date(value || 0);
  if (!Number.isFinite(date.getTime())) return '';
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'numeric', day: 'numeric' });
}

function setChatState(next) {
  if (!next) return;
  const safeState = {
    ...next,
    profile: chatPublicProfile(next.profile),
    friends: (next.friends || []).map(chatPublicProfile),
    requests: (next.requests || []).map((request) => ({ ...request, profile: chatPublicProfile(request.profile) })),
    conversations: (next.conversations || []).map((conversation) => ({ ...conversation, other: chatPublicProfile(conversation.other) }))
  };
  const previousUserId = ChatUiState.state && ChatUiState.state.user && ChatUiState.state.user.id;
  const nextUserId = safeState.user && safeState.user.id;
  if (previousUserId && previousUserId !== nextUserId) {
    ChatUiState.activeConversationId = null;
    ChatUiState.historyCursor = null;
    ChatUiState.renderedMessageIds.clear();
    chatEl('chat-search-result').hidden = true;
    chatEl('chat-search-result').replaceChildren();
    chatEl('chat-thread').hidden = true;
    chatEl('chat-thread-empty').hidden = false;
  }
  ChatUiState.state = safeState;
  renderChatShell();
}

function renderChatShell() {
  const state = ChatUiState.state || {};
  const shell = chatEl('chat-shell');
  const authenticated = !!state.authenticated;
  chatEl('chat-auth-empty').hidden = authenticated;
  shell.dataset.status = state.status || 'offline';

  if (!authenticated) {
    chatEl('chat-search-result').hidden = true;
    chatEl('chat-request-list').replaceChildren();
    chatEl('chat-friend-list').replaceChildren();
    chatEl('chat-conversation-list').replaceChildren();
    chatEl('chat-requests-section').hidden = true;
    closeChatThread();
    return;
  }
  const profile = state.profile || { displayName: state.user && state.user.email || 'Messs user' };
  chatEl('chat-own-avatar').textContent = chatInitials(profile);
  chatEl('chat-own-name').textContent = profile.displayName || 'Messs user';
  chatEl('chat-own-id').textContent = profile.messsId || state.user && state.user.email || '';

  const labels = {
    online: '实时在线',
    'sync-only': '已同步 · 实时连接重试中',
    'setup-required': '本地历史可用 · 云端准备中',
    syncing: '同步中',
    offline: '离线 · 本地历史可用',
    idle: '准备就绪'
  };
  chatEl('chat-connection-text').textContent = labels[state.status] || '连接中';
  renderChatRequests(state.requests || []);
  renderChatFriends(state.friends || []);
  renderChatConversations(state.conversations || []);

  if (ChatUiState.activeConversationId && !(state.conversations || []).some((item) => item.id === ChatUiState.activeConversationId)) {
    closeChatThread();
  } else if (ChatUiState.activeConversationId) {
    renderChatThreadHeader();
  }
}

function renderChatFriends(friends) {
  const list = chatEl('chat-friend-list');
  list.replaceChildren();
  chatEl('chat-friend-count').textContent = String(friends.length);
  chatEl('chat-friend-empty').hidden = friends.length > 0;
  friends.forEach((profile) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'chat-person-row';
    row.append(chatAvatar(profile), chatProfileCopy(profile));
    row.addEventListener('click', () => startChatWithFriend(profile.id));
    list.appendChild(row);
  });
}

function renderChatRequests(requests) {
  const section = chatEl('chat-requests-section');
  const list = chatEl('chat-request-list');
  list.replaceChildren();
  section.hidden = requests.length === 0;
  chatEl('chat-request-count').textContent = String(requests.length);
  requests.forEach((request) => {
    const row = document.createElement('div');
    row.className = 'chat-request-row';
    row.append(chatAvatar(request.profile), chatProfileCopy(request.profile));
    if (request.direction === 'incoming') {
      const actions = document.createElement('span');
      actions.className = 'chat-request-actions';
      const accept = document.createElement('button');
      accept.type = 'button';
      accept.textContent = '接受';
      accept.addEventListener('click', () => respondToChatRequest(request.id, 'accept'));
      const reject = document.createElement('button');
      reject.type = 'button';
      reject.textContent = '拒绝';
      reject.addEventListener('click', () => respondToChatRequest(request.id, 'reject'));
      actions.append(accept, reject);
      row.appendChild(actions);
    } else {
      const waiting = document.createElement('small');
      waiting.textContent = '等待接受';
      row.appendChild(waiting);
    }
    list.appendChild(row);
  });
}

function renderChatConversations(conversations) {
  const list = chatEl('chat-conversation-list');
  list.replaceChildren();
  chatEl('chat-conversation-empty').hidden = conversations.length > 0;
  conversations.forEach((conversation) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'chat-conversation-row';
    row.classList.toggle('is-active', conversation.id === ChatUiState.activeConversationId);
    row.append(chatAvatar(conversation.other));
    const copy = document.createElement('span');
    copy.className = 'chat-conversation-copy';
    const name = document.createElement('strong');
    name.textContent = conversation.other && conversation.other.displayName || 'Messs user';
    const id = document.createElement('small');
    id.textContent = conversation.other && (conversation.other.messsId || conversation.other.email) || '';
    copy.append(name, id);
    const time = document.createElement('span');
    time.className = 'chat-conversation-time';
    time.textContent = chatTime(conversation.updatedAt);
    row.append(copy, time);
    row.addEventListener('click', () => openChatConversation(conversation.id));
    list.appendChild(row);
  });
}

function renderChatThreadHeader() {
  const conversation = (ChatUiState.state && ChatUiState.state.conversations || [])
    .find((item) => item.id === ChatUiState.activeConversationId);
  if (!conversation) return;
  chatEl('chat-thread-avatar').textContent = chatInitials(conversation.other);
  chatEl('chat-thread-name').textContent = conversation.other.displayName || 'Messs user';
  chatEl('chat-thread-id').textContent = conversation.other.messsId || conversation.other.email || '';
}

async function ensureChatInitialized(force = false) {
  if (ChatUiState.initializing || (ChatUiState.initialized && !force)) return;
  ChatUiState.initializing = true;
  try {
    const session = await window.messsAPI.getCloudSession();
    const state = await window.messsAPI.initializeChat();
    ChatUiState.initialized = true;
    if (session && session.authenticated && (!state || state.authenticated !== true)) {
      chatNotice('聊天初始化失败，请重试。');
      setChatState({ configured: true, authenticated: true, user: session.user, status: 'offline' });
    } else {
      setChatState(state);
    }
  } catch (error) {
    setChatState({ authenticated: false, configured: true, status: 'offline' });
    chatNotice(error && error.message || '聊天初始化失败。');
  } finally {
    ChatUiState.initializing = false;
  }
}

async function syncChatNow() {
  chatEl('chat-sync-btn').disabled = true;
  try {
    const result = await window.messsAPI.syncChat();
    if (result.state) setChatState(result.state);
    if (!result.ok) chatNotice(result.message || '同步失败，本机历史仍可查看。');
  } finally {
    chatEl('chat-sync-btn').disabled = false;
  }
}

async function searchChatUser(event) {
  event.preventDefault();
  const input = chatEl('chat-user-search');
  const query = input.value.trim();
  if (!query) return;
  const resultBox = chatEl('chat-search-result');
  if (ChatUiState.state && ChatUiState.state.status === 'setup-required') {
    resultBox.hidden = false;
    resultBox.replaceChildren();
    const message = document.createElement('span');
    message.textContent = ChatUiState.state.lastError || '聊天云端服务正在准备中；本机历史仍可查看。';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'chat-search-action';
    retry.textContent = '重试';
    retry.addEventListener('click', syncChatNow);
    resultBox.append(message, retry);
    return;
  }
  resultBox.hidden = false;
  resultBox.textContent = '搜索中…';
  try {
    const result = await window.messsAPI.searchChatUser(query);
    if (!result.ok) {
      resultBox.textContent = result.message || '搜索失败';
      return;
    }
    if (!result.profile) {
      resultBox.textContent = '没有找到完全匹配的用户';
      return;
    }
    renderChatSearchProfile(result.profile);
  } catch (error) {
    resultBox.textContent = error && error.message || '搜索失败';
  }
}

function renderChatSearchProfile(profile) {
  const box = chatEl('chat-search-result');
  box.replaceChildren();
  const row = document.createElement('div');
  row.className = 'chat-search-person';
  row.append(chatAvatar(profile), chatProfileCopy(profile));
  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'chat-search-action';
  const relationship = profile.relationshipStatus || 'none';
  action.textContent = relationship === 'friend' ? '发消息'
    : relationship === 'outgoing' ? '已发送'
      : relationship === 'incoming' ? '待接受' : '添加';
  action.disabled = relationship === 'outgoing' || relationship === 'incoming';
  action.addEventListener('click', async () => {
    if (relationship === 'friend') return startChatWithFriend(profile.id);
    action.disabled = true;
    const result = await window.messsAPI.sendChatFriendRequest(profile.id);
    if (!result.ok) {
      action.disabled = false;
      chatNotice(result.message || '好友请求发送失败。');
      return;
    }
    setChatState(result.state);
    action.textContent = '已发送';
  });
  row.appendChild(action);
  box.appendChild(row);
}

async function respondToChatRequest(requestId, action) {
  const result = await window.messsAPI.respondChatFriendRequest(requestId, action);
  if (!result.ok) return chatNotice(result.message || '操作失败。');
  setChatState(result.state);
}

async function startChatWithFriend(friendId) {
  const result = await window.messsAPI.startChatConversation(friendId);
  if (!result.ok) return chatNotice(result.message || '无法发起对话。');
  chatEl('chat-shell').classList.remove('is-contacts-open');
  setChatState(result.state);
  await openChatConversation(result.conversationId);
}

async function openChatConversation(conversationId) {
  ChatUiState.activeConversationId = conversationId;
  ChatUiState.historyCursor = null;
  ChatUiState.renderedMessageIds.clear();
  chatEl('chat-thread-empty').hidden = true;
  chatEl('chat-thread').hidden = false;
  chatEl('chat-shell').classList.add('is-thread-open');
  renderChatShell();
  renderChatThreadHeader();
  await loadChatHistory(false);
  chatEl('chat-message-input').focus();
}

function closeChatThread() {
  ChatUiState.activeConversationId = null;
  ChatUiState.historyCursor = null;
  ChatUiState.renderedMessageIds.clear();
  chatEl('chat-thread').hidden = true;
  chatEl('chat-thread-empty').hidden = false;
  chatEl('chat-shell').classList.remove('is-thread-open');
  renderChatConversations(ChatUiState.state && ChatUiState.state.conversations || []);
}

async function loadChatHistory(older) {
  if (!ChatUiState.activeConversationId || ChatUiState.historyLoading) return;
  ChatUiState.historyLoading = true;
  const list = chatEl('chat-message-list');
  const oldHeight = list.scrollHeight;
  try {
    const options = {
      limit: 50,
      cursor: older ? ChatUiState.historyCursor : null
    };
    let page = older
      ? await window.messsAPI.loadOlderChatHistory(ChatUiState.activeConversationId, options)
      : await window.messsAPI.getChatHistory(ChatUiState.activeConversationId, options);
    if (!older && (!page.messages || page.messages.length === 0)) {
      page = await window.messsAPI.loadOlderChatHistory(ChatUiState.activeConversationId, options);
    }
    ChatUiState.historyCursor = page.nextCursor;
    ChatUiState.historyHasMore = page.hasMore;
    chatEl('chat-load-older').hidden = !page.hasMore;
    renderChatMessages(page.messages || [], older);
    if (older) list.scrollTop += list.scrollHeight - oldHeight;
    else list.scrollTop = list.scrollHeight;
  } catch (error) {
    chatNotice(error && error.message || '无法读取聊天历史。');
  } finally {
    ChatUiState.historyLoading = false;
  }
}

function renderChatMessages(messages, prepend) {
  const list = chatEl('chat-message-list');
  const loadButton = chatEl('chat-load-older');
  if (!prepend) {
    [...list.querySelectorAll('.chat-message')].forEach((node) => node.remove());
    ChatUiState.renderedMessageIds.clear();
  }
  const fragment = document.createDocumentFragment();
  messages.forEach((message) => {
    if (ChatUiState.renderedMessageIds.has(message.clientId)) return;
    ChatUiState.renderedMessageIds.add(message.clientId);
    fragment.appendChild(createChatMessage(message));
  });
  if (prepend) loadButton.after(fragment);
  else list.appendChild(fragment);
}

function createChatMessage(message) {
  const ownId = ChatUiState.state && ChatUiState.state.user && ChatUiState.state.user.id;
  const own = message.senderId === ownId;
  const row = document.createElement('article');
  row.className = `chat-message ${own ? 'is-own' : 'is-other'}`;
  row.dataset.clientId = message.clientId;
  const bubble = document.createElement('div');
  bubble.className = 'chat-message-bubble';
  if (message.kind === 'image') {
    bubble.classList.add('chat-message-image-bubble');
    const image = document.createElement('img');
    image.className = 'chat-message-image';
    image.alt = 'Shared image';
    image.draggable = false;
    image.width = message.imageWidth || 320;
    image.height = message.imageHeight || 220;
    window.messsAPI.getChatImageDataUrl(message.clientId).then((result) => {
      if (result && result.ok && row.isConnected) image.src = result.dataUrl;
      else if (row.isConnected) image.alt = result && result.message || '图片暂不可用';
    });
    bubble.appendChild(image);
  } else {
    bubble.textContent = message.body || '';
  }
  const meta = document.createElement('span');
  meta.className = 'chat-message-meta';
  if (message.status === 'queued') {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'chat-message-retry';
    retry.textContent = message.error ? '待重试' : '发送中';
    retry.title = message.error || '';
    retry.addEventListener('click', () => window.messsAPI.retryChatMessage(message.clientId));
    meta.appendChild(retry);
  } else {
    meta.textContent = chatTime(message.createdAt);
  }
  row.append(bubble, meta);
  return row;
}

function scheduleActiveChatRefresh(event) {
  if (!ChatUiState.activeConversationId) return;
  if (event && event.detail && event.detail.conversationId && event.detail.conversationId !== ChatUiState.activeConversationId) return;
  clearTimeout(ChatUiState.refreshTimer);
  ChatUiState.refreshTimer = setTimeout(() => loadChatHistory(false), 80);
}

async function submitChatMessage(event) {
  event.preventDefault();
  if (!ChatUiState.activeConversationId) return;
  const input = chatEl('chat-message-input');
  const body = input.value.trim();
  if (!body) return;
  input.value = '';
  resizeChatComposer();
  try {
    const result = await window.messsAPI.sendChatText(ChatUiState.activeConversationId, body);
    if (!result.ok) throw new Error(result.message || '发送失败');
    await loadChatHistory(false);
  } catch (error) {
    input.value = body;
    resizeChatComposer();
    chatNotice(error && error.message || '消息发送失败。');
  }
}

async function sendChatImageFromPicker() {
  if (!ChatUiState.activeConversationId) return;
  if (ChatUiState.state && ChatUiState.state.cloud && ChatUiState.state.cloud.imageStorageReady === false) {
    return chatNotice('聊天图片云端存储尚未启用，请同步重试。');
  }
  chatEl('chat-image-btn').disabled = true;
  try {
    const result = await window.messsAPI.sendChatImage(ChatUiState.activeConversationId);
    if (result.reason === 'cancelled') return;
    if (!result.ok) return chatNotice(result.message || '图片发送失败。');
    await loadChatHistory(false);
  } finally {
    chatEl('chat-image-btn').disabled = false;
  }
}

function resizeChatComposer() {
  const input = chatEl('chat-message-input');
  input.style.height = 'auto';
  input.style.height = `${Math.min(120, input.scrollHeight)}px`;
}

function openChatSettings() {
  const messsTab = document.querySelector('.section-tab[data-section="messs"]');
  if (messsTab) messsTab.click();
  const settingsButton = chatEl('settings-btn');
  if (settingsButton) settingsButton.click();
  const allSettings = chatEl('ai-provider-manager-open');
  if (allSettings) allSettings.click();
}

function initRealtimeChat() {
  document.querySelector('.section-tab[data-section="chat"]')?.addEventListener('click', () => ensureChatInitialized(true));
  chatEl('chat-sync-btn').addEventListener('click', syncChatNow);
  chatEl('chat-contacts-toggle').addEventListener('click', () => chatEl('chat-shell').classList.add('is-contacts-open'));
  chatEl('chat-contacts-close').addEventListener('click', () => chatEl('chat-shell').classList.remove('is-contacts-open'));
  chatEl('chat-user-search-form').addEventListener('submit', searchChatUser);
  chatEl('chat-load-older').addEventListener('click', () => loadChatHistory(true));
  chatEl('chat-composer').addEventListener('submit', submitChatMessage);
  chatEl('chat-image-btn').addEventListener('click', sendChatImageFromPicker);
  chatEl('chat-mobile-back').addEventListener('click', closeChatThread);
  chatEl('chat-open-settings').addEventListener('click', openChatSettings);
  chatEl('chat-message-input').addEventListener('input', resizeChatComposer);
  chatEl('chat-message-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      chatEl('chat-composer').requestSubmit();
    }
  });
  window.messsAPI.onChatEvent((event) => {
    if (event && event.state) setChatState(event.state);
    if (event && (event.type === 'message' || event.type === 'image-cached' || event.type === 'synced')) {
      scheduleActiveChatRefresh(event);
    }
  });
}

document.addEventListener('DOMContentLoaded', initRealtimeChat);
