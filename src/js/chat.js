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
  strong.textContent = profile.displayName || t('Messs user', 'Messs 用户');
  copy.appendChild(strong);
  const email = String(profile.email || '').trim();
  if (email) {
    const small = document.createElement('small');
    small.textContent = email;
    copy.appendChild(small);
  }
  return copy;
}

function chatPublicProfile(profile) {
  if (!profile) return null;
  return {
    id: profile.id,
    email: profile.email || '',
    displayName: profile.displayName || t('Messs user', 'Messs 用户'),
    avatarUrl: profile.avatarUrl || null,
    relationshipStatus: profile.relationshipStatus || null
  };
}

function chatTime(value) {
  const date = new Date(value || 0);
  if (!Number.isFinite(date.getTime())) return '';
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(appLocale(), { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString(appLocale(), { month: 'numeric', day: 'numeric' });
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
  const profile = state.profile || { displayName: state.user && state.user.email || t('Messs user', 'Messs 用户') };
  chatEl('chat-own-avatar').textContent = chatInitials(profile);
  chatEl('chat-own-name').textContent = profile.displayName || t('Messs user', 'Messs 用户');

  const labels = {
    online: t('Live', '实时在线'),
    'sync-only': t('Synced · reconnecting live updates', '已同步 · 实时连接重试中'),
    'setup-required': t('Local history available · cloud setup pending', '本地历史可用 · 云端准备中'),
    syncing: t('Syncing', '同步中'),
    offline: t('Offline · local history available', '离线 · 本地历史可用'),
    idle: t('Ready to chat', '准备就绪')
  };
  chatEl('chat-connection-text').textContent = labels[state.status] || t('Connecting', '连接中');
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
      accept.textContent = t('Accept', '接受');
      accept.addEventListener('click', () => respondToChatRequest(request.id, 'accept'));
      const reject = document.createElement('button');
      reject.type = 'button';
      reject.textContent = t('Reject', '拒绝');
      reject.addEventListener('click', () => respondToChatRequest(request.id, 'reject'));
      actions.append(accept, reject);
      row.appendChild(actions);
    } else {
      const waiting = document.createElement('small');
      waiting.textContent = t('Waiting for acceptance', '等待接受');
      row.appendChild(waiting);
    }
    list.appendChild(row);
  });
}

function renderChatConversations(conversations) {
  const list = chatEl('chat-conversation-list');
  list.replaceChildren();
  list.hidden = conversations.length === 0;
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
    name.textContent = conversation.other && conversation.other.displayName || t('Messs user', 'Messs 用户');
    copy.appendChild(name);
    const email = conversation.other && String(conversation.other.email || '').trim();
    if (email) {
      const secondary = document.createElement('small');
      secondary.textContent = email;
      copy.appendChild(secondary);
    }
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
  chatEl('chat-thread-name').textContent = conversation.other.displayName || t('Messs user', 'Messs 用户');
  chatEl('chat-thread-id').textContent = conversation.other.email || '';
}

async function ensureChatInitialized(force = false) {
  if (ChatUiState.initializing || (ChatUiState.initialized && !force)) return;
  ChatUiState.initializing = true;
  try {
    const session = await window.messsAPI.getCloudSession();
    const state = await window.messsAPI.initializeChat();
    ChatUiState.initialized = true;
    if (session && session.authenticated && (!state || state.authenticated !== true)) {
      chatNotice(t('Chat initialization failed. Please try again.', '聊天初始化失败，请重试。'));
      setChatState({ configured: true, authenticated: true, user: session.user, status: 'offline' });
    } else {
      setChatState(state);
    }
  } catch (error) {
    setChatState({ authenticated: false, configured: true, status: 'offline' });
    chatNotice(error && error.message || t('Chat initialization failed.', '聊天初始化失败。'));
  } finally {
    ChatUiState.initializing = false;
  }
}

async function syncChatNow() {
  chatEl('chat-sync-btn').disabled = true;
  try {
    const result = await window.messsAPI.syncChat();
    if (result.state) setChatState(result.state);
    if (!result.ok) chatNotice(result.message || t('Sync failed. Local history is still available.', '同步失败，本机历史仍可查看。'));
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
    message.textContent = ChatUiState.state.lastError || t(
      'Chat cloud service is being prepared; local history is still available.',
      '聊天云端服务正在准备中；本机历史仍可查看。'
    );
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'chat-search-action';
    retry.textContent = t('Retry', '重试');
    retry.addEventListener('click', syncChatNow);
    resultBox.append(message, retry);
    return;
  }
  resultBox.hidden = false;
  resultBox.textContent = t('Searching…', '搜索中…');
  try {
    const result = await window.messsAPI.searchChatUser(query);
    if (!result.ok) {
      resultBox.textContent = result.message || t('Search failed', '搜索失败');
      return;
    }
    if (!result.profile) {
      resultBox.textContent = t('No exact matching user found', '没有找到完全匹配的用户');
      return;
    }
    renderChatSearchProfile(result.profile);
  } catch (error) {
    resultBox.textContent = error && error.message || t('Search failed', '搜索失败');
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
  action.textContent = relationship === 'friend' ? t('Send message', '发消息')
    : relationship === 'outgoing' ? t('Sent', '已发送')
      : relationship === 'incoming' ? t('Pending', '待接受') : t('Add', '添加');
  action.disabled = relationship === 'outgoing' || relationship === 'incoming';
  action.addEventListener('click', async () => {
    if (relationship === 'friend') return startChatWithFriend(profile.id);
    action.disabled = true;
    const result = await window.messsAPI.sendChatFriendRequest(profile.id);
    if (!result.ok) {
      action.disabled = false;
      chatNotice(result.message || t('Friend request failed.', '好友请求发送失败。'));
      return;
    }
    setChatState(result.state);
    action.textContent = t('Sent', '已发送');
  });
  row.appendChild(action);
  box.appendChild(row);
}

async function respondToChatRequest(requestId, action) {
  const result = await window.messsAPI.respondChatFriendRequest(requestId, action);
  if (!result.ok) return chatNotice(result.message || t('Operation failed.', '操作失败。'));
  setChatState(result.state);
}

async function startChatWithFriend(friendId) {
  const result = await window.messsAPI.startChatConversation(friendId);
  if (!result.ok) return chatNotice(result.message || t('Could not start the conversation.', '无法发起对话。'));
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
    chatNotice(error && error.message || t('Could not load chat history.', '无法读取聊天历史。'));
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
  if (message.recalledAt) {
    row.classList.add('is-recalled');
    bubble.textContent = t('Message recalled', '消息已撤回');
  } else if (message.kind === 'image') {
    bubble.classList.add('chat-message-image-bubble');
    const image = document.createElement('img');
    image.className = 'chat-message-image';
    image.alt = t('Shared image', '共享图片');
    image.draggable = false;
    image.width = message.imageWidth || 320;
    image.height = message.imageHeight || 220;
    window.messsAPI.getChatImageDataUrl(message.clientId).then((result) => {
      if (result && result.ok && row.isConnected) image.src = result.dataUrl;
      else if (row.isConnected) image.alt = result && result.message || t('Image unavailable', '图片暂不可用');
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
    retry.textContent = message.error ? t('Retry pending', '待重试') : t('Sending', '发送中');
    retry.title = message.error || '';
    retry.addEventListener('click', () => window.messsAPI.retryChatMessage(message.clientId));
    meta.appendChild(retry);
  } else {
    meta.textContent = chatTime(message.createdAt);
    const recallReady = ChatUiState.state && ChatUiState.state.cloud
      && ChatUiState.state.cloud.recallReady === true;
    if (own && recallReady && message.serverId && !message.recalledAt) {
      const recall = document.createElement('button');
      recall.type = 'button';
      recall.className = 'chat-message-recall';
      recall.textContent = t('Recall', '撤回');
      recall.title = t('Recall message', '撤回消息');
      recall.addEventListener('click', () => recallChatMessage(message, recall));
      meta.appendChild(recall);
    }
  }
  row.append(bubble, meta);
  return row;
}

async function recallChatMessage(message, button) {
  if (!message || !message.clientId || button.disabled) return;
  const confirmed = typeof showConfirmDialog === 'function'
    ? await showConfirmDialog({
      title: t('Recall message', '撤回消息'),
      message: t('After recall, both people will only see “Message recalled”.', '撤回后，双方都只会看到“消息已撤回”。'),
      confirmLabel: t('Recall', '撤回'),
      cancelLabel: t('Cancel', '取消'),
      danger: false
    })
    : false;
  if (!confirmed) return;
  button.disabled = true;
  try {
    const result = await window.messsAPI.recallChatMessage(message.clientId);
    if (!result || !result.ok) {
      chatNotice(result && result.message || t('Could not recall the message.', '无法撤回消息。'));
      return;
    }
    await loadChatHistory(false);
  } finally {
    button.disabled = false;
  }
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
    if (!result.ok) throw new Error(result.message || t('Send failed', '发送失败'));
    await loadChatHistory(false);
  } catch (error) {
    input.value = body;
    resizeChatComposer();
    chatNotice(error && error.message || t('Message could not be sent.', '消息发送失败。'));
  }
}

async function sendChatImageFromPicker() {
  if (!ChatUiState.activeConversationId) return;
  if (ChatUiState.state && ChatUiState.state.cloud && ChatUiState.state.cloud.imageStorageReady === false) {
    return chatNotice(t(
      'Cloud storage for chat images is not enabled yet. Sync and try again.',
      '聊天图片云端存储尚未启用，请同步重试。'
    ));
  }
  chatEl('chat-image-btn').disabled = true;
  try {
    const result = await window.messsAPI.sendChatImage(ChatUiState.activeConversationId);
    if (result.reason === 'cancelled') return;
    if (!result.ok) return chatNotice(result.message || t('Image could not be sent.', '图片发送失败。'));
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

function refreshChatLanguage() {
  const setText = (selector, en, zh) => {
    const node = document.querySelector(selector);
    if (node) node.textContent = t(en, zh);
  };
  const setAttr = (selector, name, en, zh) => {
    const node = document.querySelector(selector);
    if (node) node.setAttribute(name, t(en, zh));
  };

  setAttr('#chat-shell', 'aria-label', 'Messs Chat', 'Messs 聊天');
  setAttr('#chat-user-search', 'placeholder', 'Search email or ID', '搜索邮箱或 ID');
  setAttr('#chat-user-search', 'aria-label', 'Search users by email or ID', '按邮箱或 ID 搜索用户');
  setText('#chat-user-search-form button[type="submit"]', 'Search', '搜索');
  setAttr('#chat-sync-btn', 'title', 'Sync', '同步');
  setAttr('#chat-sync-btn', 'aria-label', 'Sync chat', '同步聊天');
  setText('#chat-requests-section .chat-list-heading > span:first-child', 'Friend requests', '好友请求');
  setText('.chat-conversations-panel .chat-list-heading > span:first-child', 'Messages', '消息');
  setText('#chat-conversation-empty strong', 'No conversations yet', '暂无对话');
  setText('#chat-conversation-empty small', 'Start a chat from your friends list', '从好友列表发起对话');
  setText('.chat-friends-section .chat-list-heading > span:first-child', 'Friends', '好友');
  setText('#chat-friend-empty', 'Add friends using their full email or ID', '使用完整邮箱或 ID 添加好友');
  setText('#chat-thread-empty strong', 'Select a conversation', '选择一个对话');
  setText('#chat-thread-empty small', 'Text and images are saved securely in the cloud and on this device', '文字和图片会安全保存在云端和本机');
  setText('#chat-load-older', 'View older messages', '查看更早的消息');
  setAttr('#chat-mobile-back', 'aria-label', 'Back', '返回');
  setAttr('#chat-image-btn', 'title', 'Send image', '发送图片');
  setAttr('#chat-image-btn', 'aria-label', 'Send image', '发送图片');
  setAttr('#chat-message-input', 'placeholder', 'Type a message…', '输入消息…');
  setAttr('#chat-message-input', 'aria-label', 'Message', '消息');
  setAttr('#chat-send-btn', 'aria-label', 'Send', '发送');
  setText('#chat-auth-empty strong', 'Sign in to start chatting', '登录后开始聊天');
  setText('#chat-auth-empty small', 'Sign in to Messs from More Settings', '请在更多设置中登录 Messs');
  setText('#chat-open-settings', 'Open Settings', '打开设置');

  document.querySelectorAll('.chat-message.is-recalled .chat-message-bubble').forEach((node) => {
    node.textContent = t('Message recalled', '消息已撤回');
  });
  document.querySelectorAll('.chat-message-recall').forEach((node) => {
    node.textContent = t('Recall', '撤回');
    node.title = t('Recall message', '撤回消息');
  });
  document.querySelectorAll('.chat-message-image').forEach((node) => {
    if (!node.complete || !node.naturalWidth) node.alt = t('Shared image', '共享图片');
  });

  renderChatShell();
  if (ChatUiState.activeConversationId) loadChatHistory(false);
}

function initRealtimeChat() {
  document.querySelector('.section-tab[data-section="chat"]')?.addEventListener('click', () => ensureChatInitialized(true));
  chatEl('chat-sync-btn').addEventListener('click', syncChatNow);
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
    if (event && (event.type === 'message' || event.type === 'message-recalled' || event.type === 'image-cached' || event.type === 'synced')) {
      scheduleActiveChatRefresh(event);
    }
  });
  document.addEventListener('messs:language-changed', refreshChatLanguage);
}

document.addEventListener('DOMContentLoaded', initRealtimeChat);
