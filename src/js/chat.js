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
  refreshTimer: null,
  view: 'messages',
  moments: [],
  pendingAttachments: [],
  groupMode: 'create',
  ownAvatarDataUrl: '',
  ownAvatarUserId: null,
  ownAvatarLoadGeneration: 0
};

const CHAT_EMOJI = [
  '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰',
  '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩', '🥳', '😏',
  '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠',
  '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫', '🤥',
  '😶', '😐', '😑', '😬', '🙄', '😮‍💨', '😴', '🤤', '😪', '😵', '🤐', '🥴', '🤢', '🤮', '🤧', '😷',
  '🤒', '🤕', '🤑', '🤠', '😈', '👿', '👹', '👺', '🤡', '💩', '👻', '💀', '☠️', '👽', '👾', '🤖',
  '🎃', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾', '🙈', '🙉', '🙊', '💋', '💌', '💘',
  '💝', '💖', '💗', '💓', '💞', '💕', '💟', '❣️', '💔', '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤',
  '🤍', '🤎', '💯', '💢', '💥', '💫', '💦', '💨', '💣', '👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘',
  '🤙', '👈', '👉', '👆', '👇', '☝️', '✋', '🤚', '🖐️', '🖖', '👋', '🤏', '💪', '🙏', '👏', '🙌',
  '👐', '🤝', '💅', '🤳', '👀', '👁️', '🧠', '👄', '🔥', '✨', '🌟', '⭐', '🌈', '☀️', '🌤️', '☁️',
  '❄️', '⚡', '💧', '🌊', '🎉', '🎊', '🎁', '🎈', '🎂', '🍻', '☕', '🍕', '🍔', '🍟', '🍎', '🍓',
  '🍉', '🥑', '🌹', '🌸', '🌺', '🌻', '🌼', '🌷', '✅', '❌', '❗', '❓', '‼️', '⁉️', '💬', '💭',
  '💤', '🚀', '🎯', '🏆', '🥇', '🥈', '🥉', '🎵', '🎶', '🔔', '🔒', '🔑', '📌', '📎', '🗂️', '🖼️', '✂️'
];

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
  renderChatAvatarElement(avatar, profile);
  return avatar;
}

function validChatAvatarDataUrl(value) {
  const source = String(value || '').trim();
  return /^data:image\/(?:jpeg|png|webp);base64,/i.test(source) ? source : '';
}

function renderChatAvatarElement(element, profile, preferredDataUrl = '') {
  if (!element) return;
  const dataUrl = validChatAvatarDataUrl(preferredDataUrl || (profile && profile.avatarUrl));
  element.replaceChildren();
  if (dataUrl) {
    const image = document.createElement('img');
    image.src = dataUrl;
    image.alt = '';
    image.draggable = false;
    element.appendChild(image);
    element.classList.add('has-image');
  } else {
    element.textContent = chatInitials(profile);
    element.classList.remove('has-image');
  }
}

function chatCurrentUserId() {
  return ChatUiState.state && ChatUiState.state.user && String(ChatUiState.state.user.id || '').trim() || '';
}

async function refreshChatOwnAvatar(expectedUserId = chatCurrentUserId()) {
  if (!expectedUserId || typeof window.messsAPI.getProfileAvatar !== 'function') return;
  const generation = ++ChatUiState.ownAvatarLoadGeneration;
  try {
    const dataUrl = await window.messsAPI.getProfileAvatar();
    if (generation !== ChatUiState.ownAvatarLoadGeneration || expectedUserId !== chatCurrentUserId()) return;
    ChatUiState.ownAvatarUserId = expectedUserId;
    ChatUiState.ownAvatarDataUrl = validChatAvatarDataUrl(dataUrl);
    renderChatAvatarElement(chatEl('chat-rail-avatar'), ChatUiState.state && ChatUiState.state.profile, ChatUiState.ownAvatarDataUrl);
  } catch (error) {}
}

async function chooseChatOwnAvatar() {
  const userId = chatCurrentUserId();
  const button = chatEl('chat-rail-avatar');
  if (!userId || typeof window.messsAPI.chooseProfileAvatar !== 'function') {
    chatNotice(t('Sign in before changing your profile image.', '请先登录再更换头像。'));
    return;
  }
  button.disabled = true;
  try {
    const result = await window.messsAPI.chooseProfileAvatar();
    if (!result || !result.ok) {
      if (result && !['cancelled', 'auth-required', 'account-changed'].includes(result.reason)) {
        chatNotice(t('Could not update the profile image.', '无法更新头像。'));
      }
      return;
    }
    ChatUiState.ownAvatarUserId = userId;
    ChatUiState.ownAvatarDataUrl = validChatAvatarDataUrl(result.dataUrl || await window.messsAPI.getProfileAvatar());
    renderChatAvatarElement(button, ChatUiState.state && ChatUiState.state.profile, ChatUiState.ownAvatarDataUrl);
    document.dispatchEvent(new CustomEvent('messs:profile-avatar-updated', {
      detail: { userId, dataUrl: ChatUiState.ownAvatarDataUrl }
    }));
    chatNotice(t('Profile image updated.', '头像已更新。'));
  } catch (error) {
    chatNotice(error && error.message || t('Could not update the profile image.', '无法更新头像。'));
  } finally {
    button.disabled = false;
  }
}

function showChatAvatarContextMenu(event) {
  event.preventDefault();
  event.stopPropagation();
  if (!chatCurrentUserId()) {
    chatNotice(t('Sign in before changing your profile image.', '请先登录再更换头像。'));
    return;
  }
  if (typeof buildAndShowSimpleMenu === 'function') {
    buildAndShowSimpleMenu([{
      label: t('Change profile image', '更换头像'),
      icon: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M8.5 9h.01',
      action: chooseChatOwnAvatar
    }], event.clientX, event.clientY, 'chat-avatar-context-menu');
  } else {
    chooseChatOwnAvatar();
  }
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

function chatConversationProfile(conversation) {
  if (conversation && conversation.type === 'group') {
    return { displayName: conversation.name || t('Group chat', '群聊'), email: '' };
  }
  return conversation && conversation.other || { displayName: t('Messs user', 'Messs 用户'), email: '' };
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
    conversations: (next.conversations || []).map((conversation) => ({
      ...conversation,
      type: conversation.type === 'group' ? 'group' : 'direct',
      other: chatPublicProfile(conversation.other),
      members: (conversation.members || []).map(chatPublicProfile).filter(Boolean)
    }))
  };
  const previousUserId = ChatUiState.state && ChatUiState.state.user && ChatUiState.state.user.id;
  const nextUserId = safeState.user && safeState.user.id;
  if (previousUserId && previousUserId !== nextUserId) {
    clearChatAttachmentDrafts();
    ChatUiState.activeConversationId = null;
    ChatUiState.historyCursor = null;
    ChatUiState.renderedMessageIds.clear();
    chatEl('chat-search-result').hidden = true;
    chatEl('chat-search-result').replaceChildren();
    chatEl('chat-thread').hidden = true;
    chatEl('chat-thread-empty').hidden = false;
  }
  if (previousUserId !== nextUserId) {
    ChatUiState.ownAvatarUserId = null;
    ChatUiState.ownAvatarDataUrl = '';
    ChatUiState.ownAvatarLoadGeneration += 1;
  }
  ChatUiState.state = safeState;
  if (previousUserId !== nextUserId) loadChatMoments();
  renderChatShell();
  if (nextUserId && ChatUiState.ownAvatarUserId !== nextUserId) refreshChatOwnAvatar(nextUserId);
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
  renderChatAvatarElement(chatEl('chat-rail-avatar'), profile, ChatUiState.ownAvatarDataUrl);
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
    const profile = chatConversationProfile(conversation);
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'chat-conversation-row';
    row.classList.toggle('is-active', conversation.id === ChatUiState.activeConversationId);
    row.append(chatAvatar(profile));
    const copy = document.createElement('span');
    copy.className = 'chat-conversation-copy';
    const name = document.createElement('strong');
    name.textContent = conversation.other && conversation.other.displayName || t('Messs user', 'Messs 用户');
    if (conversation.type === 'group') name.textContent = profile.displayName;
    copy.appendChild(name);
    const email = conversation.other && String(conversation.other.email || '').trim();
    if (email) {
      const secondary = document.createElement('small');
      secondary.textContent = email;
      copy.appendChild(secondary);
    }
    if (conversation.type === 'group') {
      const secondary = document.createElement('small');
      secondary.textContent = t(`${conversation.memberCount || conversation.members.length} members`, `${conversation.memberCount || conversation.members.length} 位成员`);
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
  if (conversation.type === 'group') {
    const count = conversation.memberCount || conversation.members.length;
    renderChatAvatarElement(chatEl('chat-thread-avatar'), chatConversationProfile(conversation));
    chatEl('chat-thread-name').textContent = conversation.name || t('Group chat', '群聊');
    chatEl('chat-thread-id').textContent = t(`${count} members`, `${count} 位成员`);
    const ownId = ChatUiState.state && ChatUiState.state.user && ChatUiState.state.user.id;
    chatEl('chat-add-group-members-btn').hidden = conversation.ownerId !== ownId;
    return;
  }
  chatEl('chat-add-group-members-btn').hidden = true;
  renderChatAvatarElement(chatEl('chat-thread-avatar'), conversation.other);
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
  const syncButton = chatEl('chat-sync-btn');
  if (syncButton) syncButton.disabled = true;
  try {
    const result = await window.messsAPI.syncChat();
    if (result.state) setChatState(result.state);
    if (!result.ok) chatNotice(result.message || t('Sync failed. Local history is still available.', '同步失败，本机历史仍可查看。'));
  } finally {
    if (syncButton) syncButton.disabled = false;
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

function activeChatConversation() {
  return (ChatUiState.state && ChatUiState.state.conversations || [])
    .find((conversation) => conversation.id === ChatUiState.activeConversationId) || null;
}

function closeChatGroupModal() {
  chatEl('chat-group-modal').hidden = true;
  chatEl('chat-group-form').reset();
}

function updateChatGroupSelection() {
  const count = chatEl('chat-group-friend-list').querySelectorAll('input:checked').length;
  chatEl('chat-group-selected-count').textContent = t(`${count} selected`, `已选择 ${count} 人`);
  chatEl('chat-group-submit').disabled = count === 0;
}

function openChatGroupModal(mode = 'create') {
  const state = ChatUiState.state || {};
  if (state.cloud && state.cloud.groupReady === false) {
    return chatNotice(t('Group chat needs the latest cloud update.', '群聊需要部署最新云端更新。'));
  }
  const conversation = activeChatConversation();
  const adding = mode === 'add' && conversation && conversation.type === 'group';
  ChatUiState.groupMode = adding ? 'add' : 'create';
  chatEl('chat-group-title').textContent = adding ? t('Add members', '添加成员') : t('New group', '新建群聊');
  chatEl('chat-group-name-field').hidden = adding;
  chatEl('chat-group-submit').textContent = adding ? t('Add', '添加') : t('Create', '创建');
  const existingIds = new Set(adding ? (conversation.members || []).map((member) => member.id) : []);
  const list = chatEl('chat-group-friend-list');
  list.replaceChildren();
  (state.friends || []).filter((friend) => !existingIds.has(friend.id)).forEach((friend) => {
    const label = document.createElement('label');
    label.className = 'chat-group-friend-option';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = friend.id;
    checkbox.addEventListener('change', updateChatGroupSelection);
    label.append(chatAvatar(friend), chatProfileCopy(friend), checkbox);
    list.appendChild(label);
  });
  if (!list.children.length) {
    const empty = document.createElement('div');
    empty.className = 'chat-list-empty';
    empty.textContent = t('No friends available to add', '暂无可添加的好友');
    list.appendChild(empty);
  }
  chatEl('chat-group-modal').hidden = false;
  updateChatGroupSelection();
  if (!adding) setTimeout(() => chatEl('chat-group-name').focus(), 0);
}

async function submitChatGroup(event) {
  event.preventDefault();
  const selected = [...chatEl('chat-group-friend-list').querySelectorAll('input:checked')].map((input) => input.value);
  if (!selected.length) return;
  const submit = chatEl('chat-group-submit');
  submit.disabled = true;
  try {
    const result = ChatUiState.groupMode === 'add'
      ? await window.messsAPI.addChatGroupMembers(ChatUiState.activeConversationId, selected)
      : await window.messsAPI.createChatGroup(chatEl('chat-group-name').value.trim(), selected);
    if (!result.ok) return chatNotice(result.message || t('Group operation failed.', '群聊操作失败。'));
    setChatState(result.state);
    closeChatGroupModal();
    if (result.conversationId) await openChatConversation(result.conversationId);
  } finally {
    submit.disabled = false;
  }
}

function renderChatAttachmentTray() {
  const tray = chatEl('chat-attachment-tray');
  tray.replaceChildren();
  tray.hidden = ChatUiState.pendingAttachments.length === 0;
  ChatUiState.pendingAttachments.forEach((draft) => {
    const item = document.createElement('div');
    item.className = 'chat-attachment-draft';
    if (draft.previewDataUrl) {
      const image = document.createElement('img');
      image.src = draft.previewDataUrl;
      image.alt = draft.name || t('Attachment preview', '附件预览');
      item.appendChild(image);
    } else {
      const icon = document.createElement('span');
      icon.className = 'chat-attachment-draft-icon';
      icon.innerHTML = draft.mediaType === 'video'
        ? '<svg viewBox="0 0 24 24" width="25" height="25" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="14" height="14" rx="2"/><path d="m17 10 4-2v8l-4-2z"/></svg>'
        : '<svg viewBox="0 0 24 24" width="25" height="25" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5"/></svg>';
      item.appendChild(icon);
    }
    const name = document.createElement('span');
    name.className = 'chat-attachment-draft-name';
    name.textContent = draft.name || t('Attachment', '附件');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'chat-attachment-remove';
    remove.textContent = 'x';
    remove.title = t('Remove attachment', '移除附件');
    remove.addEventListener('click', async () => {
      ChatUiState.pendingAttachments = ChatUiState.pendingAttachments.filter((item) => item.token !== draft.token);
      await window.messsAPI.discardChatAttachmentDraft(draft.token);
      renderChatAttachmentTray();
      resizeChatComposer();
    });
    item.append(name, remove);
    tray.appendChild(item);
  });
}

function addChatAttachmentDrafts(drafts) {
  const existing = new Set(ChatUiState.pendingAttachments.map((draft) => draft.token));
  (Array.isArray(drafts) ? drafts : []).forEach((draft) => {
    if (draft && draft.token && !existing.has(draft.token) && ChatUiState.pendingAttachments.length < 10) {
      ChatUiState.pendingAttachments.push(draft);
      existing.add(draft.token);
    }
  });
  renderChatAttachmentTray();
  resizeChatComposer();
}

async function clearChatAttachmentDrafts() {
  const drafts = ChatUiState.pendingAttachments.splice(0);
  await Promise.all(drafts.map((draft) => window.messsAPI.discardChatAttachmentDraft(draft.token).catch(() => false)));
  renderChatAttachmentTray();
  resizeChatComposer();
}

async function pickChatAttachment(kind) {
  const result = kind === 'image' ? await window.messsAPI.pickChatImageDrafts() : await window.messsAPI.pickChatFileDrafts();
  if (result.reason === 'cancelled') return;
  if (!result.ok) return chatNotice(result.message || t('Attachment could not be added.', '无法添加附件。'));
  addChatAttachmentDrafts(result.drafts);
}

function chatClipboardPlainText(data) {
  if (!data || typeof data.getData !== 'function') return '';
  try { return String(data.getData('text/plain') || ''); } catch (error) { return ''; }
}

function restoreChatClipboardText(input, text, selectionStart, selectionEnd) {
  if (!input || !text) return;
  const maximum = input.value.length;
  const start = Number.isInteger(selectionStart) ? Math.min(selectionStart, maximum) : maximum;
  const end = Number.isInteger(selectionEnd) ? Math.max(start, Math.min(selectionEnd, maximum)) : start;
  input.setRangeText(text, start, end, 'end');
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function pasteChatClipboardAttachments(event) {
  const input = event.currentTarget;
  const fallbackText = chatClipboardPlainText(event.clipboardData);
  const selectionStart = input && input.selectionStart;
  const selectionEnd = input && input.selectionEnd;

  // Canvas copies use Windows CF_HDROP. Electron can read that native format,
  // but Chromium frequently omits it from clipboardData.files and items.
  event.preventDefault();
  const result = await window.messsAPI.readChatClipboardDrafts();
  if (result.ok) {
    addChatAttachmentDrafts(result.drafts);
    return;
  }
  if (fallbackText) {
    restoreChatClipboardText(input, fallbackText, selectionStart, selectionEnd);
    return;
  }
  if (result.reason !== 'clipboard-empty') {
    chatNotice(result.message || t('Clipboard media could not be added.', '无法添加剪贴板媒体。'));
  }
}

async function openChatConversation(conversationId) {
  if (ChatUiState.activeConversationId && ChatUiState.activeConversationId !== conversationId) await clearChatAttachmentDrafts();
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
  if (ChatUiState.pendingAttachments.length) clearChatAttachmentDrafts();
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
  } else if (message.kind === 'file' && /^video\//i.test(message.fileMime || '')) {
    bubble.classList.add('chat-message-video-bubble');
    const video = document.createElement('video');
    video.className = 'chat-message-video';
    video.src = `messs-chat-file://${message.clientId}`;
    video.controls = true;
    video.preload = 'metadata';
    video.playsInline = true;
    video.addEventListener('error', () => {
      if (video.isConnected) video.title = t('Video is unavailable', '视频暂不可用');
    });
    bubble.appendChild(video);
  } else if (message.kind === 'file') {
    bubble.classList.add('chat-message-file-bubble');
    bubble.tabIndex = 0;
    bubble.setAttribute('role', 'button');
    const icon = document.createElement('span');
    icon.className = 'chat-file-icon';
    icon.innerHTML = '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5M9 13h6M9 17h4"/></svg>';
    const copy = document.createElement('span');
    copy.className = 'chat-file-copy';
    const name = document.createElement('strong');
    name.textContent = message.fileName || t('Shared file', '共享文件');
    const size = document.createElement('small');
    size.textContent = formatChatFileSize(message.fileSize);
    copy.append(name, size);
    bubble.append(icon, copy);
    const open = async () => {
      const result = await window.messsAPI.openChatFile(message.clientId);
      if (!result || !result.ok) chatNotice(result && result.message || t('File is unavailable.', '文件暂时无法打开。'));
    };
    bubble.addEventListener('click', open);
    bubble.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
    });
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
  const conversation = activeChatConversation();
  if (!own && conversation && conversation.type === 'group') {
    const sender = (conversation.members || []).find((member) => member.id === message.senderId);
    const senderLabel = document.createElement('span');
    senderLabel.className = 'chat-message-sender';
    senderLabel.textContent = sender && sender.displayName || t('Group member', '群成员');
    bubble.prepend(senderLabel);
  }
  row.append(bubble, meta);
  return row;
}

function formatChatFileSize(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function switchChatView(view) {
  const next = ['messages', 'contacts', 'moments'].includes(view) ? view : 'messages';
  ChatUiState.view = next;
  document.querySelectorAll('[data-chat-view]').forEach((button) => {
    const active = button.dataset.chatView === next;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });
  document.querySelectorAll('[data-chat-side-view]').forEach((panel) => {
    panel.hidden = panel.dataset.chatSideView !== next;
  });
  chatEl('chat-moments').hidden = next !== 'moments';
  if (next === 'moments') {
    chatEl('chat-thread').hidden = true;
    chatEl('chat-thread-empty').hidden = true;
    renderChatMoments();
  } else {
    chatEl('chat-thread').hidden = !ChatUiState.activeConversationId;
    chatEl('chat-thread-empty').hidden = !!ChatUiState.activeConversationId;
  }
}

function loadChatMoments() {
  const userId = ChatUiState.state && ChatUiState.state.user && ChatUiState.state.user.id || 'signed-out';
  try {
    const parsed = JSON.parse(localStorage.getItem(`messs-chat-moments:${userId}`) || '[]');
    ChatUiState.moments = Array.isArray(parsed) ? parsed.slice(0, 100) : [];
  } catch (error) { ChatUiState.moments = []; }
}

function renderChatMoments() {
  const list = chatEl('chat-moment-list');
  list.replaceChildren();
  chatEl('chat-moment-empty').hidden = ChatUiState.moments.length > 0;
  const profile = ChatUiState.state && ChatUiState.state.profile || {};
  ChatUiState.moments.forEach((moment) => {
    const article = document.createElement('article');
    article.className = 'chat-moment';
    article.appendChild(chatAvatar(profile));
    const copy = document.createElement('div');
    copy.className = 'chat-moment-copy';
    const name = document.createElement('strong');
    name.textContent = profile.displayName || t('Me', '我');
    const body = document.createElement('p');
    body.textContent = moment.body;
    copy.append(name, body);
    const time = document.createElement('time');
    time.textContent = chatTime(moment.createdAt);
    article.append(copy, time);
    list.appendChild(article);
  });
}

function publishChatMoment(event) {
  event.preventDefault();
  const input = chatEl('chat-moment-input');
  const body = input.value.trim();
  if (!body) return;
  ChatUiState.moments.unshift({ id: crypto.randomUUID(), body, createdAt: new Date().toISOString() });
  ChatUiState.moments = ChatUiState.moments.slice(0, 100);
  const userId = ChatUiState.state && ChatUiState.state.user && ChatUiState.state.user.id || 'signed-out';
  localStorage.setItem(`messs-chat-moments:${userId}`, JSON.stringify(ChatUiState.moments));
  input.value = '';
  renderChatMoments();
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
  if (!body && !ChatUiState.pendingAttachments.length) return;
  input.value = '';
  resizeChatComposer();
  try {
    const result = body ? await window.messsAPI.sendChatText(ChatUiState.activeConversationId, body) : { ok: true };
    if (!result.ok) throw new Error(result.message || t('Send failed', '发送失败'));
    for (const draft of [...ChatUiState.pendingAttachments]) {
      const attachmentResult = await window.messsAPI.sendChatAttachmentDraft(ChatUiState.activeConversationId, draft.token);
      if (!attachmentResult.ok) throw new Error(attachmentResult.message || t('Attachment could not be sent.', '附件发送失败。'));
      ChatUiState.pendingAttachments = ChatUiState.pendingAttachments.filter((item) => item.token !== draft.token);
      renderChatAttachmentTray();
    }
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
    const result = await window.messsAPI.pickChatImageDrafts();
    if (result.reason === 'cancelled') return;
    if (!result.ok) return chatNotice(result.message || t('Image could not be sent.', '图片发送失败。'));
    addChatAttachmentDrafts(result.drafts);
  } finally {
    chatEl('chat-image-btn').disabled = false;
  }
}

async function sendChatFileFromPicker() {
  if (!ChatUiState.activeConversationId) return;
  const button = chatEl('chat-file-btn');
  button.disabled = true;
  try {
    const result = await window.messsAPI.pickChatFileDrafts();
    if (result.reason === 'cancelled') return;
    if (!result.ok) return chatNotice(result.message || t('File could not be sent.', '文件发送失败。'));
    addChatAttachmentDrafts(result.drafts);
  } finally { button.disabled = false; }
}

async function captureChatScreenshot() {
  if (!ChatUiState.activeConversationId) return;
  const button = chatEl('chat-screenshot-btn');
  button.disabled = true;
  try {
    const result = await window.messsAPI.captureChatScreenshotDraft();
    if (result.reason === 'cancelled') return;
    if (!result.ok) return chatNotice(result.message || t('Screenshot could not be sent.', '截图发送失败。'));
    addChatAttachmentDrafts([result.draft]);
  } finally { button.disabled = false; }
}

function initializeEmojiPicker() {
  const picker = chatEl('chat-emoji-popover');
  CHAT_EMOJI.forEach((emoji) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = emoji;
    button.setAttribute('aria-label', emoji);
    button.addEventListener('click', () => {
      const input = chatEl('chat-message-input');
      input.setRangeText(emoji, input.selectionStart, input.selectionEnd, 'end');
      picker.hidden = true;
      input.focus();
      resizeChatComposer();
    });
    picker.appendChild(button);
  });
}

function toggleEmojiPicker() {
  const picker = chatEl('chat-emoji-popover');
  picker.hidden = !picker.hidden;
}

function resizeChatComposer() {
  chatEl('chat-send-btn').disabled = !chatEl('chat-message-input').value.trim() && ChatUiState.pendingAttachments.length === 0;
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
  setAttr('#chat-rail-avatar', 'title', 'Right-click to change profile image', '右键更换头像');
  setAttr('#chat-rail-avatar', 'aria-label', 'Profile image; right-click to change', '头像；右键更换');
  setAttr('[data-chat-view="messages"]', 'title', 'Messages', '消息');
  setAttr('[data-chat-view="messages"]', 'aria-label', 'Messages', '消息');
  setAttr('[data-chat-view="contacts"]', 'title', 'Contacts', '联系人');
  setAttr('[data-chat-view="contacts"]', 'aria-label', 'Contacts', '联系人');
  setAttr('[data-chat-view="moments"]', 'title', 'Moments', '朋友圈');
  setAttr('[data-chat-view="moments"]', 'aria-label', 'Moments', '朋友圈');
  setAttr('#chat-user-search', 'placeholder', 'Search email or ID', '搜索邮箱或 ID');
  setAttr('#chat-user-search', 'aria-label', 'Search users by email or ID', '按邮箱或 ID 搜索用户');
  setText('#chat-user-search-form button[type="submit"]', 'Search', '搜索');
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
  setAttr('#chat-file-btn', 'title', 'Send file', '发送文件');
  setAttr('#chat-file-btn', 'aria-label', 'Send file', '发送文件');
  setAttr('#chat-screenshot-btn', 'title', 'Screenshot', '截图');
  setAttr('#chat-screenshot-btn', 'aria-label', 'Screenshot', '截图');
  setAttr('#chat-emoji-btn', 'title', 'Emoji', '表情');
  setAttr('#chat-emoji-btn', 'aria-label', 'Emoji', '表情');
  setAttr('#chat-message-input', 'placeholder', 'Type a message…', '输入消息…');
  setAttr('#chat-message-input', 'aria-label', 'Message', '消息');
  setAttr('#chat-send-btn', 'title', 'Send', '发送');
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
  loadChatMoments();
  initializeEmojiPicker();
  renderChatAttachmentTray();
  switchChatView('messages');
  resizeChatComposer();
  chatEl('chat-rail-avatar').addEventListener('contextmenu', showChatAvatarContextMenu);
  document.querySelectorAll('[data-chat-view]').forEach((button) => {
    button.addEventListener('click', () => switchChatView(button.dataset.chatView));
  });
  document.querySelector('.section-tab[data-section="chat"]')?.addEventListener('click', () => ensureChatInitialized(true));
  chatEl('chat-new-group-btn').addEventListener('click', () => openChatGroupModal('create'));
  chatEl('chat-add-group-members-btn').addEventListener('click', () => openChatGroupModal('add'));
  chatEl('chat-group-form').addEventListener('submit', submitChatGroup);
  chatEl('chat-group-close').addEventListener('click', closeChatGroupModal);
  chatEl('chat-group-cancel').addEventListener('click', closeChatGroupModal);
  chatEl('chat-group-modal').addEventListener('pointerdown', (event) => {
    if (event.target === chatEl('chat-group-modal')) closeChatGroupModal();
  });
  chatEl('chat-user-search-form').addEventListener('submit', searchChatUser);
  chatEl('chat-load-older').addEventListener('click', () => loadChatHistory(true));
  chatEl('chat-composer').addEventListener('submit', submitChatMessage);
  chatEl('chat-image-btn').addEventListener('click', sendChatImageFromPicker);
  chatEl('chat-file-btn').addEventListener('click', sendChatFileFromPicker);
  chatEl('chat-screenshot-btn').addEventListener('click', captureChatScreenshot);
  chatEl('chat-emoji-btn').addEventListener('click', toggleEmojiPicker);
  chatEl('chat-moment-composer').addEventListener('submit', publishChatMoment);
  chatEl('chat-mobile-back').addEventListener('click', closeChatThread);
  chatEl('chat-open-settings').addEventListener('click', openChatSettings);
  chatEl('chat-message-input').addEventListener('input', resizeChatComposer);
  chatEl('chat-message-input').addEventListener('paste', pasteChatClipboardAttachments);
  chatEl('chat-message-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      chatEl('chat-composer').requestSubmit();
    }
  });
  window.messsAPI.onChatEvent((event) => {
    if (event && event.state) setChatState(event.state);
    if (event && (event.type === 'message' || event.type === 'message-recalled' || event.type === 'image-cached' || event.type === 'file-cached' || event.type === 'synced')) {
      scheduleActiveChatRefresh(event);
    }
  });
  window.messsAPI.onOpenChatConversation((conversationId) => {
    const chatTab = document.querySelector('.section-tab[data-section="chat"]');
    if (chatTab) chatTab.click();
    switchChatView('messages');
    ensureChatInitialized().then(() => {
      if (conversationId) openChatConversation(conversationId);
    });
  });
  document.addEventListener('pointerdown', (event) => {
    const picker = chatEl('chat-emoji-popover');
    if (!picker.hidden && !picker.contains(event.target) && event.target !== chatEl('chat-emoji-btn')) picker.hidden = true;
  });
  document.addEventListener('messs:language-changed', refreshChatLanguage);
  document.addEventListener('messs:profile-avatar-updated', (event) => {
    const userId = event.detail && String(event.detail.userId || '').trim();
    if (userId && userId !== chatCurrentUserId()) return;
    ChatUiState.ownAvatarDataUrl = validChatAvatarDataUrl(event.detail && event.detail.dataUrl);
    renderChatAvatarElement(chatEl('chat-rail-avatar'), ChatUiState.state && ChatUiState.state.profile, ChatUiState.ownAvatarDataUrl);
  });
}

document.addEventListener('DOMContentLoaded', initRealtimeChat);
