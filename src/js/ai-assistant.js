'use strict';

const AiAssistant = {
  config: null,
  kind: 'chat',
  busy: false,
  messages: [],
  attachments: [],
  sessions: [],
  activeSessionId: null,
  languageTimer: 0
};

const AI_CHAT_HISTORY_KEY = 'messs.ai-chat-history.v1';

function persistAiChatHistory() {
  try {
    const sessions = AiAssistant.sessions
      .slice()
      .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || new Date(b.updatedAt) - new Date(a.updatedAt))
      .slice(0, 30);
    localStorage.setItem(AI_CHAT_HISTORY_KEY, JSON.stringify(sessions));
  } catch (err) {
    // History is a convenience; an oversized clipboard image must not block chat.
  }
}

function loadAiChatHistory() {
  try {
    const value = JSON.parse(localStorage.getItem(AI_CHAT_HISTORY_KEY) || '[]');
    AiAssistant.sessions = Array.isArray(value)
      ? value.filter((session) => session && session.id && Array.isArray(session.messages))
        .map((session) => ({ ...session, pinned: !!session.pinned }))
      : [];
  } catch (err) {
    AiAssistant.sessions = [];
  }
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
    pinned: false,
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
      content: String(message.content || '').slice(0, 12000)
    }));
  session.updatedAt = new Date().toISOString();
  persistAiChatHistory();
  renderAiChatHistory();
}

function renderAiChatHistory() {
  const list = document.getElementById('ai-chat-history-list');
  const empty = document.getElementById('ai-chat-history-empty');
  if (!list || !empty) return;
  list.innerHTML = '';
  const sessions = AiAssistant.sessions
    .slice()
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || new Date(b.updatedAt) - new Date(a.updatedAt));
  empty.hidden = sessions.length > 0;
  sessions.forEach((session) => {
    const entry = document.createElement('div');
    entry.className = 'ai-chat-history-entry';
    entry.dataset.sessionId = session.id;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ai-chat-history-item';
    button.classList.toggle('is-active', session.id === AiAssistant.activeSessionId);
    button.innerHTML = session.pinned
      ? '<svg class="ai-chat-history-pin" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m14 4 6 6-3 1-4 4-1 4-2-2-2-2 4-1 4-4z"/></svg><span></span>'
      : '<span></span>';
    button.querySelector('span').textContent = session.title || t('New conversation', '新对话');
    button.addEventListener('click', () => loadAiChatSession(session.id));
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'ai-chat-history-more';
    more.title = t('Conversation actions', '对话操作');
    more.setAttribute('aria-label', more.title);
    more.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>';
    more.addEventListener('click', (event) => showAiChatSessionMenu(session.id, event.clientX, event.clientY));
    entry.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      showAiChatSessionMenu(session.id, event.clientX, event.clientY);
    });
    entry.append(button, more);
    list.appendChild(entry);
  });
}

function renameAiChatSession(sessionId) {
  const session = AiAssistant.sessions.find((entry) => entry.id === sessionId);
  const row = [...document.querySelectorAll('.ai-chat-history-entry')]
    .find((entry) => entry.dataset.sessionId === sessionId);
  const title = row && row.querySelector('.ai-chat-history-item span');
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
      label: session.pinned ? t('Unpin', '取消置顶') : t('Pin', '置顶'),
      icon: 'M14 4l6 6-3 1-4 4-1 4-2-2-2-2 4-1 4-4z',
      action: () => {
        session.pinned = !session.pinned;
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

function loadAiChatSession(sessionId) {
  const session = AiAssistant.sessions.find((entry) => entry.id === sessionId);
  if (!session) return;
  AiAssistant.activeSessionId = session.id;
  AiAssistant.messages = session.messages.map((message) => ({ ...message }));
  const messages = document.getElementById('ai-assistant-messages');
  messages.innerHTML = '';
  AiAssistant.messages.forEach((message) => appendAssistantText(message.role, message.content));
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
    'What should we solve today?',
    '今天要解决什么？',
    '今日は何を解決しよう？',
    '오늘 무엇을 해결할까요?'
  ];
  let index = 0;
  clearInterval(AiAssistant.languageTimer);
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
  if (!file || AiAssistant.busy || AiAssistant.attachments.length >= assistantAttachmentLimit()) return;
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
    dataUrl: prepared.dataUrl
  }];
  renderAssistantAttachments();
  renderAssistantRatios();
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
          id: 'chat-1',
          name: config.chatProviderName || 'OpenAI Compatible',
          endpoint: config.chatEndpoint || '',
          models: [config.chatModel || 'gpt-4o-mini']
        }];
    const options = [];
    chatProviders.forEach((provider) => {
      if (!provider || provider.available === false || !provider.name || !provider.endpoint) return;
      const models = Array.isArray(provider.models) && provider.models.length
        ? provider.models
        : [provider.model || 'gpt-4o-mini'];
      models.forEach((model) => {
        const modelId = String(model || '').trim();
        if (!modelId) return;
        options.push({
          id: `${provider.id}::${modelId}`,
          providerId: provider.id,
          model: modelId,
          name: modelId,
          endpoint: provider.endpoint
        });
      });
    });
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
    option.textContent = provider.name;
    if (provider.providerId) option.dataset.providerId = provider.providerId;
    if (provider.model) option.dataset.model = provider.model;
    select.appendChild(option);

    const menuOption = document.createElement('button');
    menuOption.type = 'button';
    menuOption.className = 'ai-model-picker-option';
    menuOption.dataset.value = provider.id;
    menuOption.setAttribute('role', 'option');
    menuOption.textContent = provider.name;
    menuOption.addEventListener('click', () => {
      select.value = provider.id;
      label.textContent = provider.name;
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
      : `${config.activeChatProviderId || 'chat-1'}::${config.chatModel || ''}`;
  if (providers.some((provider) => provider.id === activeId)) select.value = activeId;
  select.disabled = providers.length < 2;
  trigger.disabled = providers.length < 2;
  trigger.setAttribute('aria-expanded', 'false');
  menu.hidden = true;
  const selected = providers.find((provider) => provider.id === select.value) || providers[0];
  picker.hidden = !selected;
  label.textContent = selected ? selected.name : t('No provider configured', '未配置服务商');
  document.getElementById('ai-assistant-submit').disabled = AiAssistant.busy || !selected;
  menu.querySelectorAll('.ai-model-picker-option').forEach((option) => {
    const active = selected && option.dataset.value === selected.id;
    option.classList.toggle('is-active', active);
    option.setAttribute('aria-selected', String(active));
  });
}

function selectedAssistantProvider() {
  const select = document.getElementById('ai-assistant-model');
  return configuredAssistantProviders(AiAssistant.kind)
    .find((provider) => provider.id === (select && select.value)) || null;
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

function assistantHasMediaAttachments() {
  return AiAssistant.attachments.length > 0;
}

function assistantAttachmentLimit() {
  if (AiAssistant.kind !== 'video') return 4;
  const maximum = Number(assistantVideoCapabilities().maxReferenceImages);
  return Number.isFinite(maximum) && maximum > 0 ? Math.floor(maximum) : 2;
}

function syncAssistantMediaOptions() {
  const isVideo = AiAssistant.kind === 'video';
  const capabilities = isVideo ? assistantVideoCapabilities() : assistantImageCapabilities();
  if (isVideo) {
    const maximum = Number(capabilities.maxReferenceImages);
    const limit = Number.isFinite(maximum) && maximum > 0 ? Math.floor(maximum) : 2;
    if (AiAssistant.attachments.length > limit) {
      AiAssistant.attachments = AiAssistant.attachments.slice(0, limit);
      renderAssistantAttachments();
    }
  }
  const sizeWrap = document.getElementById('ai-assistant-size-wrap');
  const sizeSelect = document.getElementById('ai-assistant-size');
  const durationSelect = document.getElementById('ai-assistant-duration');
  const resolutions = isVideo
    ? (Array.isArray(capabilities.resolutions) ? capabilities.resolutions : ['768P', '2K'])
    : (Array.isArray(capabilities.sizes) && capabilities.sizes.length
      ? capabilities.sizes
      : ['1K', '2K', '4K']);
  const durations = isVideo && Array.isArray(capabilities.durations) && capabilities.durations.length
    ? capabilities.durations
    : [6, 8, 10, 15];
  const previousSize = sizeSelect.value;
  const previousDuration = Number(durationSelect.value);

  sizeWrap.hidden = isVideo && !capabilities.resolutions;
  sizeSelect.innerHTML = '';
  resolutions.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    sizeSelect.appendChild(option);
  });
  sizeSelect.value = resolutions.includes(previousSize) ? previousSize : resolutions[0];

  durationSelect.innerHTML = '';
  durations.forEach((value) => {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = `${value}s`;
    durationSelect.appendChild(option);
  });
  durationSelect.value = durations.includes(previousDuration)
    ? String(previousDuration)
    : String(durations[0]);
  renderAssistantRatios();
  refreshAssistantOptionSummary();
}

function renderAssistantAttachments() {
  const container = document.getElementById('ai-assistant-attachments');
  container.innerHTML = '';
  container.hidden = AiAssistant.attachments.length === 0;
  AiAssistant.attachments.forEach((attachment) => {
    const item = document.createElement('div');
    item.className = 'ai-assistant-attachment';
    const image = document.createElement('img');
    image.src = attachment.dataUrl;
    image.alt = attachment.name;
    const name = document.createElement('span');
    name.textContent = attachment.name;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    remove.title = t('Remove image', '移除图片');
    remove.setAttribute('aria-label', remove.title);
    remove.addEventListener('click', () => {
      AiAssistant.attachments = AiAssistant.attachments.filter((entry) => entry.id !== attachment.id);
      renderAssistantAttachments();
      renderAssistantRatios();
    });
    item.append(image, name, remove);
    container.appendChild(item);
  });
}

function appendAssistantMessageAttachments(row, attachments) {
  if (!row || !attachments.length) return;
  const strip = document.createElement('div');
  strip.className = 'ai-assistant-message-attachments';
  attachments.forEach((attachment) => {
    const image = document.createElement('img');
    image.src = attachment.dataUrl;
    image.alt = attachment.name;
    image.title = attachment.name;
    strip.appendChild(image);
  });
  row.appendChild(strip);
  const messages = document.getElementById('ai-assistant-messages');
  messages.scrollTop = messages.scrollHeight;
}

async function uploadAssistantImages() {
  if (AiAssistant.busy) return;
  const paths = await window.messsAPI.pickFiles();
  if (!paths || !paths.length) return;
  const imagePaths = paths.filter((filePath) =>
    /\.(?:avif|bmp|gif|heic|heif|jpe?g|png|tiff?|webp)$/i.test(String(filePath || ''))
  );
  if (!imagePaths.length) {
    showToast(t('Choose an image file.', '请选择图片文件。'), 'AI');
    return;
  }

  const folderId = AppState.activeFolderId && AppState.activeFolderId !== 'default'
    ? AppState.activeFolderId
    : null;
  const result = await window.messsAPI.importFiles(imagePaths, folderId, activeCanvasId());
  const imported = result && Array.isArray(result.imported) ? result.imported : [];
  if (!imported.length) {
    showToast(t('The image could not be uploaded.', '图片上传失败。'), 'AI');
    return;
  }

  AppState.files = [...imported, ...AppState.files.filter((file) =>
    !imported.some((next) => next.id === file.id)
  )];
  renderFileList(currentFileListScope());
  renderFolderGridIfActive();
  const limit = assistantAttachmentLimit();
  const remaining = Math.max(0, limit - AiAssistant.attachments.length);
  const attachments = (await Promise.all(imported.slice(0, remaining).map(async (file) => ({
    id: file.id,
    name: file.name,
    dataUrl: await window.messsAPI.readFileAsDataUrl(file.id)
  })))).filter((attachment) => attachment.dataUrl);
  AiAssistant.attachments = [...AiAssistant.attachments, ...attachments];
  renderAssistantAttachments();
  renderAssistantRatios();
  if (result.unlocked && result.unlocked.length) await refreshAchievements();
  if (imported.length > attachments.length) {
    showToast(t(`Up to ${limit} images can be attached at once.`, `一次最多可附加 ${limit} 张图片。`), 'AI');
  }
}

function renderAssistantRatios() {
  const select = document.getElementById('ai-assistant-ratio');
  const capabilities = AiAssistant.kind === 'video' ? assistantVideoCapabilities() : assistantImageCapabilities();
  const ratios = AiAssistant.kind === 'video'
    ? (assistantHasMediaAttachments()
      ? (Array.isArray(capabilities.frameReferenceRatios) && capabilities.frameReferenceRatios.length
        ? capabilities.frameReferenceRatios
        : ['adaptive'])
      : (Array.isArray(capabilities.ratios) && capabilities.ratios.length
        ? capabilities.ratios
        : ['16:9', '9:16']))
    : (Array.isArray(capabilities.ratios) && capabilities.ratios.length
      ? capabilities.ratios
      : AI_IMAGE_RATIOS);
  const config = AiAssistant.config || {};
  const selected = AiAssistant.kind === 'video'
    ? (config.videoAspectRatio || '16:9')
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
  refreshAssistantOptionSummary();
}

function refreshAssistantOptionSummary() {
  const toggle = document.getElementById('ai-assistant-options-toggle');
  if (!toggle) return;
  const ratio = document.getElementById('ai-assistant-ratio').value || 'auto';
  if (AiAssistant.kind === 'video') {
    const duration = document.getElementById('ai-assistant-duration').value || '6';
    const sizeWrap = document.getElementById('ai-assistant-size-wrap');
    const resolution = sizeWrap.hidden ? '' : ` · ${document.getElementById('ai-assistant-size').value}`;
    toggle.textContent = `${ratio}${resolution} · ${duration}s`;
  } else {
    const size = document.getElementById('ai-assistant-size').value || '1K';
    const count = document.getElementById('ai-assistant-count').value || '1';
    toggle.textContent = `${ratio} · ${size} · x${count}`;
  }
}

function setAssistantKind(kind) {
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
  const attachmentLimit = assistantAttachmentLimit();
  if (AiAssistant.attachments.length > attachmentLimit) {
    AiAssistant.attachments = AiAssistant.attachments.slice(0, attachmentLimit);
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
  body.textContent = kind === 'video'
    ? t('Video generated and saved to the library.', '视频已生成并保存到资料库。')
    : t(`${files.length} image${files.length === 1 ? '' : 's'} generated and saved to the library.`, `${files.length} 张图片已生成并保存到资料库。`);
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
  AiAssistant.busy = busy;
  const form = document.getElementById('ai-assistant-form');
  form.querySelectorAll('button, textarea, select').forEach((control) => {
    control.disabled = busy;
  });
  document.getElementById('ai-assistant-submit').classList.toggle('is-busy', busy);
  if (!busy) renderAssistantModels();
}

async function submitAssistantMessage() {
  if (AiAssistant.busy) return;
  const input = document.getElementById('ai-assistant-input');
  const attachments = AiAssistant.attachments.map((attachment) => ({ ...attachment }));
  const submittedMediaOptions = {
    aspectRatio: document.getElementById('ai-assistant-ratio').value,
    size: document.getElementById('ai-assistant-size').value,
    count: Number(document.getElementById('ai-assistant-count').value),
    duration: Number(document.getElementById('ai-assistant-duration').value)
  };
  let prompt = input.value.trim();
  if (!prompt && !attachments.length) {
    input.focus();
    return;
  }
  if (!prompt) prompt = t('Describe this image.', '请分析这张图片。');
  if (AiAssistant.kind !== 'chat') {
    const provider = selectedAssistantProvider();
    const creditAccess = await window.MesssCredits.ensure({
      kind: AiAssistant.kind,
      imageProviderId: AiAssistant.kind === 'image' && provider ? provider.id : null,
      videoProviderId: AiAssistant.kind === 'video' && provider ? provider.id : null,
      count: submittedMediaOptions.count,
      duration: submittedMediaOptions.duration,
      resolution: AiAssistant.kind === 'video'
        ? submittedMediaOptions.size
        : undefined
    });
    if (!creditAccess.ok) return;
  }
  input.value = '';
  AiAssistant.attachments = [];
  renderAssistantAttachments();
  renderAssistantRatios();
  ensureAiChatSession(prompt);
  const userRow = appendAssistantText('user', prompt);
  appendAssistantMessageAttachments(userRow, attachments);
  AiAssistant.messages.push({
    role: 'user',
    content: prompt,
    images: attachments.map((item) => item.dataUrl)
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
  const model = document.getElementById('ai-assistant-model');
  const modelName = model.selectedOptions[0] ? model.selectedOptions[0].textContent : 'OpenAI Compatible';
  const modelNameZh = model.selectedOptions[0] ? model.selectedOptions[0].textContent : t('OpenAI Compatible', 'OpenAI 兼容');
  const pending = appendAssistantText(
    'assistant',
    AiAssistant.kind === 'chat'
      ? t('Thinking...', '思考中...')
      : t(`Using ${modelName} to generate ${AiAssistant.kind === 'video' ? 'video' : 'image'}...`, `正在使用 ${modelNameZh} 生成${AiAssistant.kind === 'video' ? '视频' : '图片'}...`),
    'is-pending'
  );
  const startedAt = Date.now();
  const progress = setInterval(() => {
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    pending.querySelector('.ai-assistant-message-body').textContent =
      AiAssistant.kind === 'chat'
        ? t(`Thinking... ${seconds}s`, `思考中... ${seconds} 秒`)
        : t(`Using ${modelName} for ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`, `正在使用 ${modelNameZh} 生成 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
  }, 1000);

  try {
    if (AiAssistant.kind === 'chat') {
      const response = await window.messsAPI.chatWithAi({
        prompt,
        messages: AiAssistant.messages,
        attachmentFileIds: attachments.filter((item) => !item.attachmentToken).map((item) => item.id),
        attachmentTokens: attachments.map((item) => item.attachmentToken).filter(Boolean),
        chatProviderId: model.selectedOptions[0] && model.selectedOptions[0].dataset.providerId,
        chatModel: model.selectedOptions[0] && model.selectedOptions[0].dataset.model
      });
      if (!response || !response.ok) {
        throw new Error((response && response.message) || t('AI chat failed.', 'AI 对话失败。'));
      }
      AiAssistant.messages.push({ role: 'assistant', content: response.text });
      persistActiveAiChatSession();
      pending.remove();
      appendAssistantText('assistant', response.text);
    } else {
      const request = {
        kind: AiAssistant.kind,
        prompt,
        aspectRatio: submittedMediaOptions.aspectRatio,
        size: submittedMediaOptions.size,
        resolution: AiAssistant.kind === 'video'
          ? submittedMediaOptions.size
          : undefined,
        count: submittedMediaOptions.count,
        duration: submittedMediaOptions.duration,
        referenceFileIds: attachments.filter((item) => !item.attachmentToken).map((item) => item.id),
        attachmentTokens: attachments.map((item) => item.attachmentToken).filter(Boolean),
        urls: [],
        imageProviderId: AiAssistant.kind === 'image' ? model.value : null,
        videoProviderId: AiAssistant.kind === 'video' ? model.value : null,
        canvasId: activeCanvasId(),
        folderId: AppState.activeFolderId && AppState.activeFolderId !== 'default'
          ? AppState.activeFolderId
          : null
      };
      const response = await window.messsAPI.generateAiMedia(request);
      if (response && response.membership) window.MesssCredits.publish(response.membership);
      const files = response && Array.isArray(response.files)
        ? response.files
        : (response && response.file ? [response.file] : []);
      if (!response || !response.ok || !files.length) {
        throw new Error((response && response.message) || t('AI generation failed.', 'AI 生成失败。'));
      }
      AppState.files = [...files, ...AppState.files.filter((file) =>
        !files.some((generated) => generated.id === file.id)
      )];
      const center = boardViewportCenterCoords();
      await addFilesToBoard(files.map((file) => file.id), center.x, center.y);
      renderFileList(currentFileListScope());
      renderFolderGridIfActive();
      if (response.unlocked && response.unlocked.length) await refreshAchievements();
      pending.remove();
      appendAssistantMedia(files, AiAssistant.kind);
      AiAssistant.messages.push({
        role: 'assistant',
        content: AiAssistant.kind === 'video'
          ? t('Video generated and saved to the library.', '视频已生成并保存到资料库。')
          : t(`${files.length} image${files.length === 1 ? '' : 's'} generated and saved to the library.`, `${files.length} 张图片已生成并保存到资料库。`)
      });
      persistActiveAiChatSession();
    }
  } catch (err) {
    pending.classList.remove('is-pending');
    pending.classList.add('is-error');
    pending.querySelector('.ai-assistant-message-body').textContent =
      err && err.message ? err.message : t('Request failed. Please try again.', '请求失败，请重试。');
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
  const upload = document.getElementById('ai-assistant-upload');
  if (upload) {
    upload.title = t('Add image', '添加图片');
    upload.setAttribute('aria-label', upload.title);
  }
  const chatButton = document.querySelector('[data-assistant-kind="chat"]');
  if (chatButton) chatButton.textContent = t('Chat', '对话');
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
      if (button.dataset.aiKind === 'image') {
        button.textContent = t('Concept Art', '概念图');
        button.dataset.aiQuick = t('Help me generate a cinematic concept image.', '帮我生成一张电影感概念图。');
      } else if (button.dataset.aiKind === 'chat') {
        button.textContent = t('Clarify Idea', '理清想法');
        button.dataset.aiQuick = t('Help me organize this idea into a clear execution plan.', '帮我把这个想法整理成清晰的执行计划。');
      } else if (button.dataset.aiKind === 'video') {
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
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitAssistantMessage();
  });
  document.getElementById('ai-assistant-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  document.getElementById('ai-assistant-input').addEventListener('paste', (event) => {
    const imageItem = [...(event.clipboardData && event.clipboardData.items || [])]
      .find((item) => item.kind === 'file' && /^image\//i.test(item.type));
    if (!imageItem) return;
    const file = imageItem.getAsFile();
    if (!file) return;
    event.preventDefault();
    addPastedAssistantImage(file).catch(() => {
      showToast(t('The pasted image could not be added.', '无法添加粘贴的图片。'), 'AI');
    });
  });
  document.querySelector('.ai-assistant-mode').addEventListener('click', (event) => {
    const button = event.target.closest('[data-assistant-kind]');
    if (button && !AiAssistant.busy) setAssistantKind(button.dataset.assistantKind);
  });
  document.getElementById('ai-assistant-upload').addEventListener('click', () => {
    uploadAssistantImages().catch((err) => {
      showToast(err && err.message ? err.message : t('The image could not be uploaded.', '图片上传失败。'), 'AI');
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
    if (![...(event.dataTransfer && event.dataTransfer.items || [])].some((item) => item.kind === 'file' && /^image\//i.test(item.type))) return;
    event.preventDefault();
    assistantDragDepth += 1;
    form.classList.add('is-image-dragover');
  });
  form.addEventListener('dragover', (event) => {
    if (![...(event.dataTransfer && event.dataTransfer.items || [])].some((item) => item.kind === 'file' && /^image\//i.test(item.type))) return;
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
    const images = [...(event.dataTransfer && event.dataTransfer.files || [])]
      .filter((file) => /^image\//i.test(file.type));
    if (!images.length) return;
    event.preventDefault();
    for (const file of images.slice(0, Math.max(0, assistantAttachmentLimit() - AiAssistant.attachments.length))) {
      await addPastedAssistantImage(file);
    }
  });
  document.getElementById('ai-assistant-options-toggle').addEventListener('click', (event) => {
    const options = document.getElementById('ai-assistant-options');
    options.hidden = !options.hidden;
    event.currentTarget.classList.toggle('is-active', !options.hidden);
  });
  ['ai-assistant-ratio', 'ai-assistant-size', 'ai-assistant-count', 'ai-assistant-duration'].forEach((id) => {
    document.getElementById(id).addEventListener('change', refreshAssistantOptionSummary);
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
  document.addEventListener('click', (event) => {
    const picker = document.querySelector('.ai-assistant-model-picker');
    if (picker && !picker.contains(event.target)) {
      document.getElementById('ai-assistant-model-menu').hidden = true;
      document.getElementById('ai-assistant-model-trigger').setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('messs:ai-config-updated', (event) => refreshAssistantConfig(event.detail));
  document.addEventListener('messs:language-changed', () => refreshAssistantLanguage());
  loadAiChatHistory();
  renderAiChatHistory();
  setAssistantKind('chat');
  startAiDynamicPrompt();
  refreshAssistantConfig();
}
