'use strict';

const MOODBOARD_TEXT_LIMIT = 40000;
const MOODBOARD_DEFAULT_WIDTH = 360;
const MOODBOARD_DEFAULT_HEIGHT = 260;
const MOODBOARD_ALLOWED_FORMATS = new Set([
  'bold', 'italic', 'underline', 'strike', 'header', 'list', 'blockquote', 'indent', 'align'
]);

const MoodboardEditorState = {
  itemId: null,
  quill: null,
  saveTimer: 0,
  suppressChange: false,
  agentBusy: false,
  agentModel: 'gemini-3.8-flash'
};

function normalizeMoodboardAttributes(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const next = {};
  Object.entries(value).forEach(([key, raw]) => {
    if (!MOODBOARD_ALLOWED_FORMATS.has(key)) return;
    if (['bold', 'italic', 'underline', 'strike', 'blockquote'].includes(key) && raw === true) next[key] = true;
    else if (key === 'header' && [1, 2].includes(Number(raw))) next[key] = Number(raw);
    else if (key === 'list' && ['ordered', 'bullet'].includes(raw)) next[key] = raw;
    else if (key === 'indent' && Number.isInteger(Number(raw)) && Number(raw) >= 1 && Number(raw) <= 4) next[key] = Number(raw);
    else if (key === 'align' && ['center', 'right', 'justify'].includes(raw)) next[key] = raw;
  });
  return Object.keys(next).length ? next : undefined;
}

function normalizeMoodboardDelta(value) {
  const sourceOps = value && Array.isArray(value.ops) ? value.ops : [];
  const ops = [];
  let remaining = MOODBOARD_TEXT_LIMIT;
  for (const operation of sourceOps) {
    if (!operation || typeof operation.insert !== 'string' || remaining <= 0) continue;
    const insert = operation.insert.slice(0, remaining);
    if (!insert) continue;
    remaining -= insert.length;
    const attributes = normalizeMoodboardAttributes(operation.attributes);
    ops.push(attributes ? { insert, attributes } : { insert });
  }
  if (!ops.length) return { ops: [{ insert: '\n' }] };
  const finalInsert = String(ops[ops.length - 1].insert || '');
  if (!finalInsert.endsWith('\n')) ops.push({ insert: '\n' });
  return { ops };
}

function moodboardPlainTextFromDelta(delta) {
  return normalizeMoodboardDelta(delta).ops
    .map((operation) => operation.insert)
    .join('')
    .replace(/\n$/, '')
    .slice(0, MOODBOARD_TEXT_LIMIT);
}

function moodboardPlainText(item) {
  if (!item) return '';
  if (item.moodboardDelta && Array.isArray(item.moodboardDelta.ops)) {
    return moodboardPlainTextFromDelta(item.moodboardDelta);
  }
  return String(item.moodboardText || item.text || '').slice(0, MOODBOARD_TEXT_LIMIT);
}

function moodboardDeltaForItem(item) {
  if (item && item.moodboardDelta && Array.isArray(item.moodboardDelta.ops)) {
    return normalizeMoodboardDelta(item.moodboardDelta);
  }
  const text = moodboardPlainText(item);
  return normalizeMoodboardDelta({ ops: [{ insert: `${text}\n` }] });
}

function moodboardSetPlainText(item, text) {
  const value = String(text || '').slice(0, MOODBOARD_TEXT_LIMIT).replace(/\r\n?/g, '\n');
  item.moodboardText = value;
  item.moodboardDelta = normalizeMoodboardDelta({ ops: [{ insert: `${value}\n` }] });
}

function moodboardTitle(item) {
  const value = String(item && item.moodboardTitle || '').trim().slice(0, 120);
  return value || t('Text moodboard', '文字情绪板');
}

function moodboardItemsForCanvas(canvasId = activeCanvasId()) {
  return AppState.boardItems.filter((item) => item && item.isMoodboard && item.canvasId === canvasId);
}

function moodboardTextCount(text) {
  const value = String(text || '').trim();
  if (!value) return t('0 words', '0 字');
  if (isZh()) return `${[...value.replace(/\s/g, '')].length} 字`;
  const words = value.split(/\s+/).filter(Boolean).length;
  return t(`${words} words`, `${words} 字`);
}

function moodboardPreviewText(text) {
  return String(text || '').trim() || t('Start collecting and refining text.', '开始收集和筛选文字。');
}

function moodboardPersistItem(item) {
  if (!item || !item.id) return;
  item.updatedAt = new Date().toISOString();
  canvasWorkspaceAddItem(item);
  if (typeof persistBoardItemMutation === 'function') {
    persistBoardItemMutation({ upsert: [item] }, item.canvasId || activeCanvasId());
  } else {
    void window.messsAPI.upsertBoardItem(item).catch(() => {});
  }
}

function syncMoodboardNodePreview(item) {
  const element = document.querySelector(`.board-moodboard[data-board-id="${item.id}"]`);
  if (!element) return;
  const title = element.querySelector('.board-moodboard-title');
  const preview = element.querySelector('.board-moodboard-preview');
  const count = element.querySelector('.board-moodboard-count');
  const text = moodboardPlainText(item);
  if (title) title.textContent = moodboardTitle(item);
  if (preview) preview.textContent = moodboardPreviewText(text);
  if (count) count.textContent = moodboardTextCount(text);
  if (typeof boardItemRenderSignature === 'function') {
    element._boardRenderSignature = boardItemRenderSignature(item, null);
  }
}

function moodboardSaveState(text, state = '') {
  const element = document.getElementById('moodboard-save-state');
  if (!element) return;
  element.textContent = text;
  element.dataset.state = state;
}

function saveActiveMoodboardNow() {
  window.clearTimeout(MoodboardEditorState.saveTimer);
  MoodboardEditorState.saveTimer = 0;
  const item = AppState.boardItems.find((entry) => entry.id === MoodboardEditorState.itemId && entry.isMoodboard);
  if (!item) return;
  moodboardPersistItem(item);
  moodboardSaveState(t('Saved', '已保存'), 'saved');
}

function scheduleActiveMoodboardSave(item) {
  if (!item) return;
  moodboardSaveState(t('Saving...', '保存中...'), 'saving');
  window.clearTimeout(MoodboardEditorState.saveTimer);
  MoodboardEditorState.saveTimer = window.setTimeout(saveActiveMoodboardNow, 360);
}

function updateMoodboardEditorCount(item) {
  const count = document.getElementById('moodboard-text-count');
  if (count) count.textContent = moodboardTextCount(moodboardPlainText(item));
}

function renderMoodboardSuggestion(item) {
  const panel = document.getElementById('moodboard-agent-suggestion');
  const text = document.getElementById('moodboard-suggestion-text');
  if (!panel || !text) return;
  const suggestion = item && item.moodboardSuggestion;
  const value = String(suggestion && suggestion.text || '').trim();
  panel.hidden = !value;
  text.textContent = value;
}

function moodboardEnsureQuill() {
  if (MoodboardEditorState.quill) return MoodboardEditorState.quill;
  if (typeof Quill !== 'function') throw new Error('The text editor could not be loaded.');
  const quill = new Quill('#moodboard-editor', {
    theme: 'snow',
    formats: [...MOODBOARD_ALLOWED_FORMATS],
    modules: {
      toolbar: false,
      history: { delay: 600, maxStack: 120, userOnly: true }
    },
    placeholder: t('Collect, compare, and refine text...', '收集、对比并筛选文字...')
  });
  quill.root.setAttribute('spellcheck', 'true');
  quill.root.addEventListener('paste', (event) => {
    const text = event.clipboardData && event.clipboardData.getData('text/plain');
    if (!text) return;
    event.preventDefault();
    const range = quill.getSelection(true) || { index: quill.getLength() - 1, length: 0 };
    quill.deleteText(range.index, range.length, 'user');
    quill.insertText(range.index, text.slice(0, MOODBOARD_TEXT_LIMIT), 'user');
    quill.setSelection(range.index + Math.min(text.length, MOODBOARD_TEXT_LIMIT), 0, 'silent');
  });
  quill.root.addEventListener('drop', (event) => {
    if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length) {
      event.preventDefault();
      showToast(t('This moodboard accepts text only.', '文字情绪板只接收文字。'));
    }
  });
  quill.on('text-change', () => {
    if (MoodboardEditorState.suppressChange) return;
    const item = AppState.boardItems.find((entry) => entry.id === MoodboardEditorState.itemId && entry.isMoodboard);
    if (!item) return;
    item.moodboardDelta = normalizeMoodboardDelta(quill.getContents());
    item.moodboardText = moodboardPlainTextFromDelta(item.moodboardDelta);
    syncMoodboardNodePreview(item);
    updateMoodboardEditorCount(item);
    scheduleActiveMoodboardSave(item);
  });
  MoodboardEditorState.quill = quill;
  return quill;
}

function openMoodboardEditor(item) {
  if (!item || !item.isMoodboard) return false;
  const overlay = document.getElementById('moodboard-overlay');
  const titleInput = document.getElementById('moodboard-editor-title');
  if (!overlay || !titleInput) return false;
  let quill;
  try {
    quill = moodboardEnsureQuill();
  } catch (error) {
    showToast(t('The text editor could not be loaded.', '文字编辑器加载失败。'));
    return false;
  }
  if (MoodboardEditorState.itemId && MoodboardEditorState.itemId !== item.id) saveActiveMoodboardNow();
  MoodboardEditorState.itemId = item.id;
  MoodboardEditorState.suppressChange = true;
  quill.setContents(moodboardDeltaForItem(item), 'silent');
  quill.history.clear();
  MoodboardEditorState.suppressChange = false;
  titleInput.value = moodboardTitle(item);
  renderMoodboardAgentPresets();
  renderMoodboardSuggestion(item);
  updateMoodboardEditorCount(item);
  moodboardSaveState(t('Saved', '已保存'), 'saved');
  document.getElementById('moodboard-agent-status').textContent = '';
  overlay.hidden = false;
  document.body.classList.add('is-moodboard-editor-open');
  requestAnimationFrame(() => {
    overlay.classList.add('is-open');
    quill.focus();
  });
  return true;
}

function closeMoodboardEditor() {
  const overlay = document.getElementById('moodboard-overlay');
  if (!overlay || overlay.hidden) return;
  saveActiveMoodboardNow();
  overlay.classList.remove('is-open');
  document.body.classList.remove('is-moodboard-editor-open');
  window.setTimeout(() => {
    if (!overlay.classList.contains('is-open')) overlay.hidden = true;
  }, 180);
}

function moodboardAppendDelta(item, text, heading = '') {
  const value = String(text || '').trim().slice(0, MOODBOARD_TEXT_LIMIT);
  if (!value) return false;
  const delta = moodboardDeltaForItem(item);
  const currentText = moodboardPlainTextFromDelta(delta).trim();
  const ops = currentText ? delta.ops.slice() : [];
  if (currentText) ops.push({ insert: '\n' });
  if (heading) {
    ops.push({ insert: String(heading).slice(0, 160) });
    ops.push({ insert: '\n', attributes: { header: 2 } });
  }
  ops.push({ insert: value });
  ops.push({ insert: '\n' });
  item.moodboardDelta = normalizeMoodboardDelta({ ops });
  item.moodboardText = moodboardPlainTextFromDelta(item.moodboardDelta);
  moodboardPersistItem(item);
  syncMoodboardNodePreview(item);
  if (MoodboardEditorState.itemId === item.id && MoodboardEditorState.quill) {
    MoodboardEditorState.suppressChange = true;
    MoodboardEditorState.quill.setContents(item.moodboardDelta, 'silent');
    MoodboardEditorState.suppressChange = false;
    renderMoodboardSuggestion(item);
    updateMoodboardEditorCount(item);
  }
  return true;
}

function addAgentTextToMoodboard(item, text) {
  const now = new Date();
  const stamp = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const added = moodboardAppendDelta(item, text, t(`Agent feedback · ${stamp}`, `Agent 反馈 · ${stamp}`));
  if (added) showToast(t(`Sent to “${moodboardTitle(item)}”`, `已发送到“${moodboardTitle(item)}”`));
  return added;
}

function createBoardMoodboard(options = {}) {
  const point = Number.isFinite(options.x) && Number.isFinite(options.y)
    ? { x: options.x, y: options.y }
    : boardViewportCenterCoords();
  const existingCount = moodboardItemsForCanvas().length;
  const item = {
    id: `moodboard_${Math.random().toString(36).slice(2, 11)}`,
    isMoodboard: true,
    moodboardTitle: options.title || `${t('Text moodboard', '文字情绪板')} ${existingCount + 1}`,
    moodboardDelta: { ops: [{ insert: '\n' }] },
    moodboardText: '',
    x: Math.round(point.x - MOODBOARD_DEFAULT_WIDTH / 2),
    y: Math.round(point.y - MOODBOARD_DEFAULT_HEIGHT / 2),
    width: MOODBOARD_DEFAULT_WIDTH,
    height: MOODBOARD_DEFAULT_HEIGHT,
    zIndex: AppState.boardItems.length + 1,
    canvasId: activeCanvasId(),
    selected: true,
    createdAt: new Date().toISOString()
  };
  if (options.text) moodboardSetPlainText(item, options.text);
  AppState.boardItems.forEach((entry) => { entry.selected = false; });
  AppState.boardItems.push(item);
  canvasWorkspaceAddItem(item);
  if (typeof recordBoardItemsHistory === 'function') recordBoardItemsHistory('add', [item]);
  moodboardPersistItem(item);
  renderBoard();
  showToast(t('Text moodboard created', '文字情绪板已建立'));
  if (options.open === true) window.setTimeout(() => openMoodboardEditor(item), 50);
  return item;
}

function closeMoodboardTargetPicker() {
  const overlay = document.getElementById('moodboard-target-overlay');
  if (overlay) overlay.remove();
}

function openMoodboardTargetPicker(text) {
  const value = String(text || '').trim().slice(0, MOODBOARD_TEXT_LIMIT);
  if (!value) return false;
  const moodboards = moodboardItemsForCanvas();
  if (!moodboards.length) {
    createBoardMoodboard({ text: value });
    return true;
  }
  if (moodboards.length === 1) return addAgentTextToMoodboard(moodboards[0], value);

  closeMoodboardTargetPicker();
  const overlay = document.createElement('div');
  overlay.id = 'moodboard-target-overlay';
  overlay.className = 'moodboard-target-overlay';
  overlay.dataset.boardUiLayer = 'true';
  const dialog = document.createElement('section');
  dialog.className = 'moodboard-target-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  const header = document.createElement('header');
  const heading = document.createElement('h2');
  heading.textContent = t('Send to canvas', '发送到画布');
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'icon-btn-sm';
  close.title = t('Close', '关闭');
  close.setAttribute('aria-label', close.title);
  close.textContent = 'x';
  close.addEventListener('click', closeMoodboardTargetPicker);
  header.append(heading, close);
  const list = document.createElement('div');
  list.className = 'moodboard-target-list';
  moodboards.forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    const strong = document.createElement('strong');
    strong.textContent = moodboardTitle(item);
    const small = document.createElement('small');
    small.textContent = moodboardPreviewText(moodboardPlainText(item)).slice(0, 90);
    button.append(strong, small);
    button.addEventListener('click', () => {
      closeMoodboardTargetPicker();
      addAgentTextToMoodboard(item, value);
    });
    list.appendChild(button);
  });
  const create = document.createElement('button');
  create.type = 'button';
  create.className = 'moodboard-target-create';
  create.textContent = t('New moodboard', '新建情绪板');
  create.addEventListener('click', () => {
    closeMoodboardTargetPicker();
    createBoardMoodboard({ text: value });
  });
  dialog.append(header, list, create);
  overlay.appendChild(dialog);
  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) closeMoodboardTargetPicker();
  });
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('is-open'));
  return true;
}

function buildBoardMoodboardElement(item) {
  const element = document.createElement('article');
  element.className = 'board-item board-moodboard' + (item.selected ? ' is-selected' : '');
  element.dataset.boardId = item.id;
  syncMountedBoardItemGeometry(element, item);

  const header = document.createElement('header');
  header.className = 'board-moodboard-header';
  const icon = document.createElement('span');
  icon.className = 'board-moodboard-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 4h6a3 3 0 0 1 3 3v13a3 3 0 0 0-3-3H4z"/><path d="M20 4h-6a3 3 0 0 0-3 3v13a3 3 0 0 1 3-3h6z"/></svg>';
  const title = document.createElement('strong');
  title.className = 'board-moodboard-title';
  title.textContent = moodboardTitle(item);
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'board-moodboard-open';
  open.title = t('Open half-screen editor', '半屏打开');
  open.setAttribute('aria-label', open.title);
  open.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M15 3h6v6M21 3l-8 8"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>';
  open.addEventListener('click', (event) => {
    event.stopPropagation();
    openMoodboardEditor(item);
  });
  const generate = document.createElement('button');
  generate.type = 'button';
  generate.className = 'board-moodboard-generate';
  generate.innerHTML = '<img src="assets/icons/lucide/sparkles.svg" width="17" height="17" alt="" aria-hidden="true">';
  generate.setAttribute('aria-haspopup', 'dialog');
  generate.title = t('Generate from moodboard', '根据情绪板生成');
  generate.setAttribute('aria-label', generate.title);
  generate.addEventListener('pointerdown', event => event.stopPropagation());
  generate.addEventListener('mousedown', event => event.stopPropagation());
  generate.addEventListener('click', event => {
    event.stopPropagation();
    const prompt = moodboardPlainText(item).trim();
    if (!prompt) {
      showToast(t('Add text to the moodboard first.', '请先填写情绪板内容。'), 'Messs');
      openMoodboardEditor(item);
      return;
    }
    void openAiComposerForSelection('image', prompt, {
      referenceFileIds: [], moodboardAnchor: generate, moodboardItemId: item.id
    }).catch(error => showToast(error.message || t('Could not open generation settings.', '无法打开生成设置。'), 'AI'));
  });
  header.append(icon, title, open, generate);

  const preview = document.createElement('div');
  preview.className = 'board-moodboard-preview';
  preview.textContent = moodboardPreviewText(moodboardPlainText(item));
  const footer = document.createElement('footer');
  const count = document.createElement('span');
  count.className = 'board-moodboard-count';
  count.textContent = moodboardTextCount(moodboardPlainText(item));
  const status = document.createElement('span');
  status.textContent = item.moodboardSuggestion ? t('Agent suggestion ready', 'Agent 建议待审') : '';
  footer.append(count, status);
  element.append(header, preview, footer);

  element.addEventListener('click', (event) => {
    if (!(event.ctrlKey || event.metaKey || event.shiftKey)) {
      AppState.boardItems.forEach((entry) => { entry.selected = false; });
    }
    item.selected = true;
    syncBoardSelectionClasses();
  });
  element.addEventListener('dblclick', (event) => {
    if (event.button !== 0 || event.target.closest('button')) return;
    event.preventDefault();
    event.stopPropagation();
    openMoodboardEditor(item);
  });
  element.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!item.selected) {
      AppState.boardItems.forEach((entry) => { entry.selected = entry.id === item.id; });
      syncBoardSelectionClasses();
    }
    const selectedCount = AppState.boardItems.filter((entry) => entry.selected).length;
    if (selectedCount >= 2) showBoardMultiContextMenu(event.clientX, event.clientY);
    else showBoardItemContextMenu(item, event.clientX, event.clientY);
  });
  makeBoardItemDraggable(element, item);
  return element;
}

function activeMoodboardItem() {
  return AppState.boardItems.find((entry) => entry.id === MoodboardEditorState.itemId && entry.isMoodboard) || null;
}

function renderMoodboardAgentPresets() {
  const host = document.getElementById('moodboard-agent-presets');
  if (!host) return;
  host.replaceChildren();
  host.setAttribute('aria-label', t('Agent mode', 'Agent 模式'));
  const providers = canvasAgentChatProviders();
  MesssAiProviderOptions.chatPresets.slice(0, 2).forEach((preset) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.moodboardModel = preset.model;
    button.disabled = MoodboardEditorState.agentBusy || !providers.some(entry => entry.model === preset.model);
    button.setAttribute('aria-pressed', String(MoodboardEditorState.agentModel === preset.model));
    const icon = document.createElement('img');
    icon.src = `assets/icons/lucide/${preset.icon}.svg`;
    icon.alt = '';
    const label = document.createElement('span');
    label.textContent = t(preset.en, preset.zh);
    button.append(icon, label);
    button.addEventListener('click', () => {
      MoodboardEditorState.agentModel = preset.model;
      renderMoodboardAgentPresets();
    });
    host.append(button);
  });
}

function moodboardRevisionBody(text, title) {
  const lines = String(text || '').trim().split('\n');
  const heading = lines[0].trim().replace(/^#{1,6}\s+/, '').replace(/^\*\*(.*)\*\*$/, '$1');
  if (heading === String(title || '').trim()) lines.shift();
  return lines.join('\n').trim().slice(0, MOODBOARD_TEXT_LIMIT);
}

function setMoodboardAgentBusy(busy) {
  MoodboardEditorState.agentBusy = busy;
  renderMoodboardAgentPresets();
  document.querySelectorAll('[data-moodboard-agent-action], #moodboard-agent-submit').forEach((button) => {
    button.disabled = busy;
  });
  const status = document.getElementById('moodboard-agent-status');
  if (status) status.textContent = busy ? t('Agent is refining...', 'Agent 正在优化...') : '';
}

async function requestMoodboardAgentOptimization(action, customInstruction = '') {
  const item = activeMoodboardItem();
  const sourceText = moodboardPlainText(item).trim();
  if (!item || !sourceText || MoodboardEditorState.agentBusy) {
    if (!sourceText) showToast(t('Add text before asking Agent to refine it.', '请先添加文字，再交给 Agent 优化。'));
    return null;
  }
  if (typeof requestCanvasAgentText !== 'function') {
    showToast(t('Agent is unavailable.', 'Agent 当前不可用。'));
    return null;
  }
  const provider = canvasAgentChatProviders().find(entry => entry.model === MoodboardEditorState.agentModel);
  if (!provider) {
    showToast(t('The selected Agent mode is unavailable.', '所选 Agent 模式暂不可用。'));
    return null;
  }
  const instructions = {
    polish: t('Polish the wording while preserving its intent, concrete details, and tone.', '润色文字，保留原意、具体细节和语气。'),
    shorten: t('Condense the text, remove repetition, and preserve all important information.', '精简文字，删除重复表达，保留全部重要信息。'),
    expand: t('Expand the text with clearer structure and useful creative detail without inventing unsupported facts.', '扩展文字，使结构更清晰并补充有用的创意细节，不虚构没有依据的事实。'),
    custom: String(customInstruction || '').trim()
  };
  const instruction = instructions[action] || instructions.custom;
  if (!instruction) {
    document.getElementById('moodboard-agent-instruction').focus();
    return null;
  }
  const locale = isZh() ? 'Return Simplified Chinese.' : (isKo() ? 'Return Korean.' : 'Return English.');
  const prompt = [
    'You are refining a text-only creative moodboard.',
    locale,
    instruction,
    'Return only the revised body text. Do not repeat the moodboard title. Do not add commentary, costs, model names, or image-generation instructions.',
    `Moodboard title: ${moodboardTitle(item)}`,
    'Text:',
    sourceText
  ].join('\n\n');
  const displayPrompt = t(
    `Refine moodboard “${moodboardTitle(item)}”`,
    `优化情绪板“${moodboardTitle(item)}”`
  );
  setMoodboardAgentBusy(true);
  try {
    if (CanvasWorkspace.agentBusy) return null;
    CanvasWorkspace.agentChatProviderId = provider.providerId;
    CanvasWorkspace.agentChatModel = provider.model;
    CanvasWorkspace.agentChatUsePreset = true;
    CanvasWorkspace.agentMode = 'chat';
    renderCanvasAgentModels();
    if (typeof setCanvasAgentOpen === 'function') setCanvasAgentOpen(true);
    return await requestCanvasAgentText({
      displayPrompt,
      contextualPrompt: prompt,
      referenceFiles: [],
      focusInput: false,
      onResponse: (responseText) => {
        item.moodboardSuggestion = {
          text: moodboardRevisionBody(responseText, moodboardTitle(item)),
          action,
          createdAt: new Date().toISOString()
        };
        moodboardPersistItem(item);
        syncMoodboardNodePreview(item);
        renderMoodboardSuggestion(item);
      }
    });
  } finally {
    setMoodboardAgentBusy(false);
  }
}

function moodboardApplySuggestion(mode) {
  const item = activeMoodboardItem();
  const suggestion = item && item.moodboardSuggestion;
  const text = String(suggestion && suggestion.text || '').trim();
  if (!item || !text) return;
  if (mode === 'replace') moodboardSetPlainText(item, text);
  else moodboardAppendDelta(item, text, t('Agent revision', 'Agent 优化稿'));
  delete item.moodboardSuggestion;
  moodboardPersistItem(item);
  renderMoodboardSuggestion(item);
  syncMoodboardNodePreview(item);
  if (MoodboardEditorState.quill) {
    MoodboardEditorState.suppressChange = true;
    MoodboardEditorState.quill.setContents(item.moodboardDelta, 'silent');
    MoodboardEditorState.quill.history.clear();
    MoodboardEditorState.suppressChange = false;
  }
  updateMoodboardEditorCount(item);
}

function removeMoodboardSuggestion() {
  const item = activeMoodboardItem();
  if (!item || !item.moodboardSuggestion) return;
  delete item.moodboardSuggestion;
  moodboardPersistItem(item);
  renderMoodboardSuggestion(item);
  syncMoodboardNodePreview(item);
}

function refreshMoodboardLanguage() {
  renderMoodboardAgentPresets();
  const button = document.getElementById('board-tool-moodboard');
  if (button) {
    button.title = t('Text moodboard', '文字情绪板');
    button.setAttribute('aria-label', button.title);
  }
  const panel = document.querySelector('.moodboard-editor-panel');
  if (panel) panel.setAttribute('aria-label', t('Text moodboard editor', '文字情绪板编辑器'));
  const labels = {
    polish: t('Polish', '润色'),
    shorten: t('Shorten', '精简'),
    expand: t('Expand', '扩展')
  };
  document.querySelectorAll('[data-moodboard-agent-action]').forEach((element) => {
    element.textContent = labels[element.dataset.moodboardAgentAction] || element.textContent;
  });
  const instruction = document.getElementById('moodboard-agent-instruction');
  if (instruction) instruction.placeholder = t('Describe the revision', '描述修改要求');
  const setText = (id, en, zh) => {
    const element = document.getElementById(id);
    if (element) element.textContent = t(en, zh);
  };
  setText('moodboard-suggestion-copy', 'Copy', '复制');
  setText('moodboard-suggestion-append', 'Append', '追加');
  setText('moodboard-suggestion-replace', 'Replace text', '替换正文');
  const suggestionHeading = document.querySelector('#moodboard-agent-suggestion header strong');
  if (suggestionHeading) suggestionHeading.textContent = t('Agent suggestion', 'Agent 建议');
}

function initBoardMoodboards() {
  const createButton = document.getElementById('board-tool-moodboard');
  const overlay = document.getElementById('moodboard-overlay');
  if (!createButton || !overlay || createButton.dataset.initialized === 'true') return;
  createButton.dataset.initialized = 'true';
  overlay.dataset.boardUiLayer = 'true';
  createButton.addEventListener('click', () => createBoardMoodboard());
  document.getElementById('moodboard-backdrop').addEventListener('click', closeMoodboardEditor);
  document.getElementById('moodboard-editor-close').addEventListener('click', closeMoodboardEditor);
  document.getElementById('moodboard-editor-title').addEventListener('input', (event) => {
    const item = activeMoodboardItem();
    if (!item) return;
    item.moodboardTitle = String(event.target.value || '').slice(0, 120);
    syncMoodboardNodePreview(item);
    scheduleActiveMoodboardSave(item);
  });
  document.querySelectorAll('[data-moodboard-agent-action]').forEach((button) => {
    button.addEventListener('click', () => void requestMoodboardAgentOptimization(button.dataset.moodboardAgentAction));
  });
  const instruction = document.getElementById('moodboard-agent-instruction');
  const submitCustom = () => {
    const value = instruction.value.trim();
    if (!value) { instruction.focus(); return; }
    void requestMoodboardAgentOptimization('custom', value);
  };
  document.getElementById('moodboard-agent-submit').addEventListener('click', submitCustom);
  instruction.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitCustom();
    }
  });
  document.getElementById('moodboard-suggestion-copy').addEventListener('click', () => {
    const item = activeMoodboardItem();
    if (item && item.moodboardSuggestion) void writePlainTextToClipboard(item.moodboardSuggestion.text);
  });
  document.getElementById('moodboard-suggestion-append').addEventListener('click', () => moodboardApplySuggestion('append'));
  document.getElementById('moodboard-suggestion-replace').addEventListener('click', () => moodboardApplySuggestion('replace'));
  document.getElementById('moodboard-suggestion-dismiss').addEventListener('click', removeMoodboardSuggestion);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !overlay.hidden) {
      event.preventDefault();
      closeMoodboardEditor();
    }
  });
  document.addEventListener('messs:language-changed', refreshMoodboardLanguage);
  refreshMoodboardLanguage();
}

window.MesssMoodboard = Object.freeze({
  normalizeDelta: normalizeMoodboardDelta,
  plainText: moodboardPlainText,
  create: createBoardMoodboard,
  open: openMoodboardEditor,
  sendText: openMoodboardTargetPicker
});
