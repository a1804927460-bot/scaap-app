'use strict';
/* Custom right-click context menus. */

const FILE_CONTEXT_ITEMS = [
  { key: 'open-other', label: ['Open in Other App', '在其他应用中打开'], icon: 'M4 7l8-4 8 4M4 7v10l8 4 8-4V7M4 7l8 4 8-4M12 11v10' },
  { key: 'open-default', label: ['Open Default App', '用默认应用打开'], icon: 'M14 3h7v7M21 3L13 11M5 5h6v2H7v10h10v-4h2v6H5z' },
  { key: 'open-manager', label: ['Open in File Manager', '在文件管理器中打开'], icon: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z' },
  { key: 'reveal', label: ['Show in Folder', '在文件夹中显示'], icon: 'M21 10c0 6-9 12-9 12s-9-6-9-12a9 9 0 1 1 18 0z;M12 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', divider: true },
  { key: 'copy-selection', label: ['Copy', '复制'], icon: 'M9 9h11v11H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1' },
  { key: 'cut-selection', label: ['Cut', '剪切'], icon: 'M4 4l16 16M20 4L4 20' },
  { key: 'paste-selection', label: ['Paste', '粘贴'], icon: 'M9 3h6a2 2 0 0 1 2 2v1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h1V5a2 2 0 0 1 2-2z' },
  { key: 'copy-file', label: ['Copy File', '复制文件'], icon: 'M9 9h11v11H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1', divider: true },
  { key: 'copy-path', label: ['Copy Path', '复制路径'], icon: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1' },
  { key: 'duplicate', label: ['Duplicate', '复制副本'], icon: 'M8 8h11v11H8zM4 4h11v4H8v7H4z', divider: true },
  { key: 'trash', label: ['Move to Trash', '移到废纸篓'], icon: 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m-9 0v14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6', danger: true }
];

let contextMenuTargetFileId = null;
let contextMenuTargetFolderId = null;
const FileClipboard = { fileIds: [], mode: null };

function buildIconSvg(pathData) {
  const paths = pathData.split(';').map((d) => `<path d="${d}"/>`).join('');
  return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8">${paths}</svg>`;
}

function copyBoardSelection(items) {
  const copied = typeof setBoardClipboardItems === 'function'
    ? setBoardClipboardItems(items)
    : (BoardClipboard.items = items.map((item) => ({ ...item })));
  const mediaFileIds = BoardClipboard.mediaFileIds || [];
  if (mediaFileIds.length && window.messsAPI && window.messsAPI.copyBoardMediaToClipboard) {
    void window.messsAPI.copyBoardMediaToClipboard(mediaFileIds)
      .catch(() => {})
      .then(() => typeof captureBoardClipboardSignature === 'function' && captureBoardClipboardSignature());
  } else if (typeof captureBoardClipboardSignature === 'function') {
    void captureBoardClipboardSignature();
  }
  return copied;
}

function cutBoardSelection(items) {
  copyBoardSelection(items);
  removeBoardItemsWithHistory(items);
}

function pasteBoardSelectionAt(clickX, clickY) {
  const { x, y } = clientToBoardCoords(clickX, clickY);
  const placement = {
    x: Math.round(x - 110),
    y: Math.round(y - 70),
    partitionPoint: { x, y },
    externalPlacement: { x, y }
  };
  void pasteBoardClipboardOrExternal(placement).catch((error) => {
    showToast(error && error.message ? error.message : t('Could not paste the image', '无法粘贴图片'));
  });
}

function normalizeTargetFolderId(folderId) {
  return folderId && folderId !== 'default' ? folderId : null;
}

function folderIdForFile(fileId) {
  const file = AppState.files.find((item) => item.id === fileId);
  return normalizeTargetFolderId(file && file.folderId);
}

function setFileClipboard(fileIds, mode) {
  FileClipboard.fileIds = [...new Set(fileIds.filter(Boolean))];
  FileClipboard.mode = mode === 'cut' ? 'cut' : 'copy';
}

function refreshFileSurfaces() {
  renderFileList(currentFileListScope());
  if (typeof renderFolderGridIfActive === 'function') renderFolderGridIfActive();
}

async function pasteFileClipboardIntoFolder(folderId) {
  const ids = [...new Set(FileClipboard.fileIds)];
  if (!ids.length) {
    showToast(t('Clipboard is empty', '剪贴板为空'));
    return;
  }

  const targetFolderId = normalizeTargetFolderId(folderId);
  if (FileClipboard.mode === 'cut') {
    for (const id of ids) {
      await window.messsAPI.moveFileToFolder(id, targetFolderId);
      const file = AppState.files.find((item) => item.id === id);
      if (file) file.folderId = targetFolderId;
    }
    FileClipboard.fileIds = [];
    FileClipboard.mode = null;
    refreshFileSurfaces();
    showToast(t(`Moved ${ids.length} file${ids.length === 1 ? '' : 's'}`, `已移动 ${ids.length} 个文件`));
    return;
  }

  let pasted = 0;
  for (const id of ids) {
    const res = await window.messsAPI.duplicateFile(id, targetFolderId);
    if (res.ok) {
      pasted += 1;
      AppState.files = [res.file, ...AppState.files];
    }
  }
  refreshFileSurfaces();
  showToast(t(`Pasted ${pasted} file${pasted === 1 ? '' : 's'}`, `已粘贴 ${pasted} 个文件`));
}

function renderContextMenuItems() {
  const menu = document.getElementById('context-menu');
  menu.innerHTML = '';
  for (const item of FILE_CONTEXT_ITEMS) {
    if (item.divider) {
      const hr = document.createElement('li');
      hr.className = 'context-menu-divider';
      menu.appendChild(hr);
    }
    const li = document.createElement('li');
    li.className = 'context-menu-item' + (item.danger ? ' is-danger' : '');
    li.dataset.action = item.key;
    li.innerHTML = `<span class="context-menu-icon">${buildIconSvg(item.icon)}</span><span>${t(item.label[0], item.label[1])}</span>`;
    li.addEventListener('click', () => handleContextMenuAction(item.key));
    menu.appendChild(li);
  }
}

async function handleContextMenuAction(action) {
  const clickX = parseInt(document.getElementById('context-menu').style.left, 10);
  const clickY = parseInt(document.getElementById('context-menu').style.top, 10);
  hideContextMenu();
  const id = contextMenuTargetFileId;
  if (!id) return;
  const f = AppState.files.find((x) => x.id === id);

  switch (action) {
    case 'open-other':
      await window.messsAPI.openWithOtherApp(id);
      break;
    case 'open-default':
      await window.messsAPI.openFileExternally(id);
      break;
    case 'open-manager':
      await window.messsAPI.openInFileManager(id);
      break;
    case 'reveal':
      await window.messsAPI.revealFile(id);
      break;
    case 'copy-selection':
      setFileClipboard([id], 'copy');
      showToast(t('File copied', '文件已复制'));
      break;
    case 'cut-selection':
      setFileClipboard([id], 'cut');
      showToast(t('File cut', '文件已剪切'));
      break;
    case 'paste-selection':
      await pasteFileClipboardIntoFolder(contextMenuTargetFolderId);
      break;
    case 'copy-file':
      await window.messsAPI.copyFileToClipboard(id);
      showToast(t('File copied to system clipboard', '文件已复制到系统剪贴板'));
      break;
    case 'copy-path':
      await window.messsAPI.copyFilePath(id);
      showToast(t('Path copied', '路径已复制'));
      break;
    case 'duplicate': {
      const res = await window.messsAPI.duplicateFile(id);
      if (res.ok) {
        AppState.files = [res.file, ...AppState.files];
        renderFileList(currentFileListScope());
        showToast(t('Duplicate created', '已创建副本'));
      }
      break;
    }
    case 'trash': {
      if (!f) break;
      const ok = await showConfirmDialog({
        title: t('Move to Trash', '移到废纸篓'),
        message: t(`Move "${f.name}" to the trash? This cannot be undone.`, `将“${f.name}”移到废纸篓吗？此操作无法撤销。`),
        confirmLabel: t('Move to Trash', '移到废纸篓')
      });
      if (!ok) break;
      const res = await window.messsAPI.moveFileToTrash(id);
      if (res.ok) {
        AppState.files = AppState.files.filter((x) => x.id !== id);
        removeBoardItemsForFile(id);
        renderFileList(currentFileListScope());
        if (AppState.activeFileId === id) clearPreview();
        showToast(t('Moved to trash', '已移到废纸篓'));
      }
      break;
    }
  }
}

function showContextMenu(fileId, clientX, clientY) {
  contextMenuTargetFileId = fileId;
  contextMenuTargetFolderId = folderIdForFile(fileId);
  renderContextMenuItems();
  const menu = document.getElementById('context-menu');
  menu.hidden = false;
  menu.classList.remove('is-visible');

  const rect = menu.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 8;
  const maxY = window.innerHeight - rect.height - 8;
  menu.style.left = Math.max(8, Math.min(clientX, maxX)) + 'px';
  menu.style.top = Math.max(8, Math.min(clientY, maxY)) + 'px';

  requestAnimationFrame(() => menu.classList.add('is-visible'));
}

function hideContextMenu() {
  const menu = document.getElementById('context-menu');
  if (menu.hidden) return;
  menu.classList.remove('is-visible');
  setTimeout(() => { menu.hidden = true; }, 160);
}

function buildAndShowSimpleMenu(items, x, y, menuId = 'simple-context-menu') {
  const existing = document.getElementById(menuId);
  if (existing) existing.remove();

  const menu = document.createElement('ul');
  menu.id = menuId;
  menu.className = 'context-menu is-visible';
  document.body.appendChild(menu);

  for (const item of items) {
    if (item.divider) {
      const divider = document.createElement('li');
      divider.className = 'context-menu-divider';
      divider.setAttribute('role', 'separator');
      menu.appendChild(divider);
    }
    const li = document.createElement('li');
    li.className = 'context-menu-item' + (item.danger ? ' is-danger' : '');
    if (item.icon) {
      li.classList.add('has-icon');
      li.innerHTML = `<span class="context-menu-icon">${buildIconSvg(item.icon)}</span><span></span>`;
      li.lastElementChild.textContent = item.label;
    } else {
      li.textContent = item.label;
    }
    li.addEventListener('click', () => { menu.remove(); item.action(); });
    menu.appendChild(li);
  }

  const rect = menu.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 8;
  const maxY = window.innerHeight - rect.height - 8;
  menu.style.left = Math.max(8, Math.min(x, maxX)) + 'px';
  menu.style.top = Math.max(8, Math.min(y, maxY)) + 'px';

  const closeOnce = (e) => {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener('click', closeOnce);
    }
  };
  setTimeout(() => document.addEventListener('click', closeOnce), 0);
  return menu;
}

function textSelectionInside(element) {
  const selection = window.getSelection && window.getSelection();
  if (!element || !selection || selection.isCollapsed || !selection.rangeCount) return '';
  const range = selection.getRangeAt(0);
  const start = range.startContainer.nodeType === Node.ELEMENT_NODE
    ? range.startContainer
    : range.startContainer.parentElement;
  const end = range.endContainer.nodeType === Node.ELEMENT_NODE
    ? range.endContainer
    : range.endContainer.parentElement;
  return start && end && element.contains(start) && element.contains(end)
    ? selection.toString()
    : '';
}

async function writePlainTextToClipboard(text) {
  const value = String(text || '');
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch (error) {}
  const fallback = document.createElement('textarea');
  fallback.value = value;
  fallback.style.position = 'fixed';
  fallback.style.opacity = '0';
  document.body.appendChild(fallback);
  fallback.select();
  const copied = document.execCommand('copy');
  fallback.remove();
  return copied;
}

async function pastePlainTextIntoInput(input) {
  input.focus();
  try {
    const text = await navigator.clipboard.readText();
    if (!text) return;
    input.setRangeText(text, input.selectionStart, input.selectionEnd, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  } catch (error) {
    document.execCommand('paste');
  }
}

const PromptOptimizerState = {
  input: null,
  originalValue: '',
  sourceText: '',
  selectionStart: 0,
  selectionEnd: 0,
  revision: 0
};

function normalizeAgentPromptSuggestion(value) {
  let text = String(value || '').trim();
  const fenced = text.match(/^```(?:text|markdown|prompt)?\s*\n?([\s\S]*?)\n?```$/i);
  if (fenced) text = fenced[1].trim();
  return text.slice(0, 20000);
}

function closePromptOptimizerDialog(options = {}) {
  const overlay = document.getElementById('prompt-optimizer-overlay');
  if (!overlay) return;
  PromptOptimizerState.revision += 1;
  const input = PromptOptimizerState.input;
  overlay.classList.remove('is-open');
  window.setTimeout(() => overlay.remove(), 180);
  if (options.restoreFocus !== false && input && input.isConnected) {
    window.setTimeout(() => input.focus({ preventScroll: true }), 0);
  }
}

function promptOptimizerInstruction(sourceText, kind, selectedOnly) {
  return [
    `You are optimizing an AI ${kind === 'video' ? 'video' : 'image'} generation prompt.`,
    'Keep the source prompt language. Do not translate it, and keep necessary model terms unchanged.',
    selectedOnly
      ? 'Optimize only the selected fragment so it can replace the original fragment cleanly.'
      : 'Optimize the complete prompt.',
    'Remove repetition, improve clarity and structure, and make the instruction directly executable by a generation model.',
    'Preserve every concrete requirement, count, position, direction, subject, and negative constraint.',
    'Preserve reference labels such as image 1, image 2, first frame, and last frame, including their order and roles.',
    'Do not invent requirements. Do not mention this task, Agent, pricing, or model providers.',
    'Return only the optimized prompt without commentary, headings, quotation marks, or Markdown fences.',
    'Prompt to optimize:',
    sourceText
  ].join('\n\n');
}

function replacePromptWithAgentSuggestion() {
  const overlay = document.getElementById('prompt-optimizer-overlay');
  const input = PromptOptimizerState.input;
  const suggestion = overlay && overlay.querySelector('.prompt-optimizer-result');
  const nextText = normalizeAgentPromptSuggestion(suggestion && suggestion.value);
  if (!overlay || !input || !input.isConnected || !nextText) return false;
  if (input.value !== PromptOptimizerState.originalValue) {
    const status = overlay.querySelector('.prompt-optimizer-status');
    status.textContent = t(
      'The prompt changed while Agent was working. Start optimization again to avoid overwriting it.',
      'Agent 优化期间提示词已经被修改，请重新优化，避免覆盖新内容。',
      'Agent가 작업하는 동안 프롬프트가 변경되었습니다. 새 내용을 덮어쓰지 않도록 다시 최적화하세요.'
    );
    status.dataset.state = 'error';
    return false;
  }
  input.setRangeText(
    nextText,
    PromptOptimizerState.selectionStart,
    PromptOptimizerState.selectionEnd,
    'end'
  );
  input.dispatchEvent(new Event('input', { bubbles: true }));
  closePromptOptimizerDialog();
  showToast(t('Prompt replaced', '提示词已替换', '프롬프트를 교체했습니다'), 'AI');
  return true;
}

function createPromptOptimizerDialog(selectedOnly) {
  document.getElementById('prompt-optimizer-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'prompt-optimizer-overlay';
  overlay.className = 'prompt-optimizer-overlay';
  overlay.dataset.boardUiLayer = 'true';
  overlay.innerHTML = `
    <button class="prompt-optimizer-backdrop" type="button" aria-label="${t('Keep original prompt', '保留原提示词', '원래 프롬프트 유지')}"></button>
    <section class="prompt-optimizer-dialog" role="dialog" aria-modal="true" aria-labelledby="prompt-optimizer-title">
      <header class="prompt-optimizer-header">
        <span class="prompt-optimizer-mark" aria-hidden="true">${buildIconSvg('M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z;M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z')}</span>
        <div><h2 id="prompt-optimizer-title">${t('Optimize prompt with Agent', '使用 Agent 优化提示词', 'Agent로 프롬프트 최적화')}</h2><p>${selectedOnly ? t('Review the selected-text revision before replacing it.', '查看选中文字的优化结果，再决定是否替换。', '선택한 텍스트의 수정 결과를 확인한 후 교체 여부를 결정하세요.') : t('Compare both versions before replacing the current prompt.', '对比优化前后的提示词，再决定是否替换。', '현재 프롬프트를 교체하기 전에 두 버전을 비교하세요.')}</p></div>
        <button class="prompt-optimizer-close" type="button" title="${t('Keep original', '保留原文', '원문 유지')}" aria-label="${t('Keep original', '保留原文', '원문 유지')}"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      </header>
      <div class="prompt-optimizer-compare">
        <label><span>${t('Original prompt', '原提示词', '원래 프롬프트')}</span><textarea class="prompt-optimizer-original" readonly spellcheck="false"></textarea></label>
        <label><span>${t('Agent revision', 'Agent 优化结果', 'Agent 수정 결과')}</span><textarea class="prompt-optimizer-result" readonly spellcheck="true" placeholder="${t('Agent is optimizing...', 'Agent 正在优化...', 'Agent가 최적화하고 있습니다...')}"></textarea></label>
      </div>
      <footer class="prompt-optimizer-footer">
        <span class="prompt-optimizer-status" role="status">${t('Agent is optimizing...', 'Agent 正在优化...', 'Agent가 최적화하고 있습니다...')}</span>
        <div class="prompt-optimizer-actions">
          <button class="prompt-optimizer-keep" type="button">${t('Keep original', '保留原文', '원문 유지')}</button>
          <button class="prompt-optimizer-replace" type="button" disabled>${selectedOnly ? t('Replace selection', '替换选中文字', '선택 영역 교체') : t('Replace prompt', '替换提示词', '프롬프트 교체')}</button>
        </div>
      </footer>
    </section>
  `;
  const close = () => closePromptOptimizerDialog();
  overlay.querySelector('.prompt-optimizer-backdrop').addEventListener('click', close);
  overlay.querySelector('.prompt-optimizer-close').addEventListener('click', close);
  overlay.querySelector('.prompt-optimizer-keep').addEventListener('click', close);
  overlay.querySelector('.prompt-optimizer-replace').addEventListener('click', replacePromptWithAgentSuggestion);
  overlay.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close();
  });
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('is-open'));
  return overlay;
}

async function openPromptOptimizerDialog(input, selection = {}) {
  const originalValue = String(input && input.value || '');
  const start = Math.max(0, Math.min(originalValue.length, Number(selection.start) || 0));
  const end = Math.max(start, Math.min(originalValue.length, Number(selection.end) || originalValue.length));
  const sourceText = originalValue.slice(start, end).trim();
  if (!input || !sourceText) {
    showToast(t('Enter a prompt before asking Agent to optimize it.', '请先输入提示词，再交给 Agent 优化。', '먼저 프롬프트를 입력한 후 Agent에게 최적화를 요청하세요.'), 'AI');
    return null;
  }
  if (typeof requestCanvasAgentText !== 'function') {
    showToast(t('Agent is unavailable.', 'Agent 当前不可用。', 'Agent를 사용할 수 없습니다.'), 'AI');
    return null;
  }
  const selectedOnly = start > 0 || end < originalValue.length;
  const composer = input.closest('.ai-composer');
  if (composer) composer.dataset.keepOpenAfterBlur = 'true';
  PromptOptimizerState.input = input;
  PromptOptimizerState.originalValue = originalValue;
  PromptOptimizerState.sourceText = sourceText;
  PromptOptimizerState.selectionStart = start;
  PromptOptimizerState.selectionEnd = end;
  PromptOptimizerState.revision += 1;
  const revision = PromptOptimizerState.revision;
  const overlay = createPromptOptimizerDialog(selectedOnly);
  overlay.querySelector('.prompt-optimizer-original').value = sourceText;
  overlay.querySelector('.prompt-optimizer-result').focus({ preventScroll: true });
  const status = overlay.querySelector('.prompt-optimizer-status');
  const resultField = overlay.querySelector('.prompt-optimizer-result');
  const replaceButton = overlay.querySelector('.prompt-optimizer-replace');
  const kind = composer && composer.dataset.kind === 'video' ? 'video' : 'image';
  let requestFailed = false;
  const response = await requestCanvasAgentText({
    displayPrompt: selectedOnly
      ? t('Optimize the selected prompt text', '优化选中的提示词', '선택한 프롬프트 텍스트 최적화')
      : t(`Optimize the current ${kind} prompt`, `优化当前${kind === 'video' ? '视频' : '生图'}提示词`, `현재 ${kind === 'video' ? '비디오' : '이미지'} 프롬프트 최적화`),
    contextualPrompt: promptOptimizerInstruction(sourceText, kind, selectedOnly),
    referenceFiles: [],
    focusInput: false,
    isolated: true,
    onResponse: (responseText) => {
      if (revision !== PromptOptimizerState.revision || !overlay.isConnected) return;
      const optimized = normalizeAgentPromptSuggestion(responseText);
      if (!optimized) return;
      resultField.value = optimized;
      resultField.readOnly = false;
      replaceButton.disabled = false;
      status.textContent = t('Review the result, edit it if needed, then choose whether to replace.', '请查看优化结果；可以继续修改，再选择是否替换。', '결과를 확인하고 필요하면 수정한 뒤 교체 여부를 선택하세요.');
      status.dataset.state = 'ready';
      resultField.focus({ preventScroll: true });
      resultField.setSelectionRange(0, 0);
    },
    onError: () => { requestFailed = true; }
  });
  if (revision === PromptOptimizerState.revision && overlay.isConnected && (!response || !resultField.value)) {
    status.textContent = requestFailed
      ? t('Agent could not optimize this prompt. Please try again.', 'Agent 未能完成优化，请重试。', 'Agent가 프롬프트를 최적화하지 못했습니다. 다시 시도하세요.')
      : t('Agent is busy. Please try again shortly.', 'Agent 正在处理其他任务，请稍后重试。', 'Agent가 다른 작업을 처리 중입니다. 잠시 후 다시 시도하세요.');
    status.dataset.state = 'error';
  }
  return response;
}

function promptTextSelection(editable) {
  const start = Number.isInteger(editable.selectionStart) ? editable.selectionStart : 0;
  const end = Number.isInteger(editable.selectionEnd) ? editable.selectionEnd : start;
  return { start, end, text: editable.value.slice(start, end) };
}

function showAgentTextContextMenu(event) {
  const editable = event.target.closest('textarea, input[type="text"], input:not([type])');
  const message = event.target.closest('.board-agent-message, .ai-assistant-message-body');
  if (!editable && !message) return false;
  event.preventDefault();
  event.stopPropagation();

  if (editable) {
    const selection = promptTextSelection(editable);
    const selectedText = selection.text;
    const items = [];
    if (selectedText) {
      items.push({
        label: t('Cut', '\u526a\u5207'),
        action: async () => {
          if (!await writePlainTextToClipboard(selectedText)) return;
          editable.setRangeText('', editable.selectionStart, editable.selectionEnd, 'end');
          editable.dispatchEvent(new Event('input', { bubbles: true }));
          editable.focus();
        }
      });
      items.push({
        label: t('Copy', '\u590d\u5236'),
        action: () => writePlainTextToClipboard(selectedText)
      });
    }
    items.push({
      label: t('Paste', '\u7c98\u8d34'),
      action: () => pastePlainTextIntoInput(editable)
    });
    items.push({
      label: t('Select all', '\u5168\u9009'),
      action: () => {
        editable.focus();
        editable.select();
      }
    });
    buildAndShowSimpleMenu(items, event.clientX, event.clientY, 'agent-text-context-menu');
    return true;
  }

  const text = textSelectionInside(message) || message.innerText || message.textContent;
  const items = [{
    label: t('Copy', '\u590d\u5236'),
    icon: 'M8 8h11v11H8z;M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
    action: () => writePlainTextToClipboard(text)
  }];
  if (text && typeof openMoodboardTargetPicker === 'function') {
    items.push({
      label: t('Send to moodboard', '发送到情绪板'),
      icon: 'M4 4h6a3 3 0 0 1 3 3v13a3 3 0 0 0-3-3H4z;M20 4h-6a3 3 0 0 0-3 3v13a3 3 0 0 1 3-3h6z',
      action: () => openMoodboardTargetPicker(text)
    });
  }
  buildAndShowSimpleMenu(items, event.clientX, event.clientY, 'agent-text-context-menu');
  return true;
}

function showPromptTextContextMenu(event) {
  const editable = event.target.closest('.ai-composer-prompt');
  if (!editable) return false;
  event.preventDefault();
  event.stopPropagation();
  const selection = promptTextSelection(editable);
  const optimizeSelection = !!selection.text.trim();
  const optimizeRange = optimizeSelection
    ? { start: selection.start, end: selection.end }
    : { start: 0, end: editable.value.length };
  const items = [{
    label: optimizeSelection
      ? t('Optimize selected text with Agent', '使用 Agent 优化选中文字', 'Agent로 선택한 텍스트 최적화')
      : t('Optimize prompt with Agent', '使用 Agent 优化提示词', 'Agent로 프롬프트 최적화'),
    icon: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z;M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z',
    action: () => void openPromptOptimizerDialog(editable, optimizeRange)
  }, { divider: true, dividerOnly: true }];
  if (selection.text) {
    items.push({
      label: t('Cut', '剪切', '잘라내기'),
      action: async () => {
        if (!await writePlainTextToClipboard(selection.text)) return;
        editable.setRangeText('', selection.start, selection.end, 'end');
        editable.dispatchEvent(new Event('input', { bubbles: true }));
        editable.focus();
      }
    }, {
      label: t('Copy', '复制', '복사'),
      action: () => writePlainTextToClipboard(selection.text)
    });
  }
  items.push({
    label: t('Paste', '粘贴', '붙여넣기'),
    action: () => pastePlainTextIntoInput(editable)
  }, {
    label: t('Select all', '全选', '전체 선택'),
    action: () => { editable.focus(); editable.select(); }
  });
  buildAndShowSimpleMenu(items, event.clientX, event.clientY, 'prompt-text-context-menu');
  return true;
}

async function sendBoardMediaToCreativeApp(fileId, target) {
  const appName = target === 'after-effects' ? 'After Effects' : 'Photoshop';
  try {
    const result = await window.messsAPI.sendToCreativeApp(fileId, target);
    if (result && result.ok) {
      showToast(result.message || t(`Sent to ${appName}.`, `已发送到 ${appName}。`));
      return;
    }
    // The main process distinguishes missing source files, unsupported media,
    // missing Adobe installs and actual launch failures. Surface that reason
    // instead of reporting every failure as "not installed".
    showToast((result && result.message) || t(
      `Could not send this file to ${appName}.`,
      `无法将这个文件发送到 ${appName}。`
    ));
  } catch (error) {
    showToast(t(
      `Could not send this file to ${appName}.`,
      `无法将这个文件发送到 ${appName}。`
    ));
  }
}

function formatCanvasUsagePoints(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return t('Not recorded', '\u672a\u8bb0\u5f55');
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(Math.max(0, numeric));
}

function formatCanvasUsageDate(value) {
  const date = new Date(value || 0);
  if (!Number.isFinite(date.getTime())) return '-';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  }).format(date);
}

function closeCanvasUsageDetails() {
  const overlay = document.getElementById('canvas-usage-overlay');
  if (!overlay || overlay.hidden) return;
  overlay.classList.remove('is-visible');
  window.setTimeout(() => { overlay.hidden = true; }, 160);
}

function initCanvasUsageDialog() {
  const overlay = document.getElementById('canvas-usage-overlay');
  if (!overlay || overlay.dataset.initialized === 'true') return overlay;
  overlay.dataset.initialized = 'true';
  document.getElementById('canvas-usage-close').addEventListener('click', closeCanvasUsageDetails);
  document.getElementById('canvas-usage-done').addEventListener('click', closeCanvasUsageDetails);
  document.getElementById('canvas-usage-account').addEventListener('click', () => {
    closeCanvasUsageDetails();
    if (typeof window.openUsageSettings === 'function') window.openUsageSettings();
    else {
      const opener = document.getElementById('usage-settings-open');
      if (opener) opener.click();
    }
  });
  overlay.addEventListener('pointerdown', (event) => {
    if (event.target === overlay) closeCanvasUsageDetails();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !overlay.hidden) closeCanvasUsageDetails();
  });
  return overlay;
}

function renderCanvasUsageDetails(result) {
  const summary = document.getElementById('canvas-usage-summary');
  const rows = document.getElementById('canvas-usage-rows');
  const note = document.getElementById('canvas-usage-note');
  const empty = document.getElementById('canvas-usage-empty');
  const details = Array.isArray(result.details) ? result.details : [];
  const totals = result.totals || {};
  const breakdown = result.breakdown || {};
  document.getElementById('canvas-usage-kicker').textContent = t('Canvas points usage', '\u753b\u5e03\u79ef\u5206\u7528\u91cf');
  document.getElementById('canvas-usage-title').textContent = result.canvas && result.canvas.name
    ? result.canvas.name
    : t('Usage details', '\u4f7f\u7528\u660e\u7ec6');
  const tableHeaders = document.querySelectorAll('.canvas-usage-table th');
  [t('Date', '\u65e5\u671f'), t('Type', '\u7c7b\u578b'), t('Model', '\u6a21\u578b'), t('Output', '\u751f\u6210\u7ed3\u679c'), t('Estimated', '\u9884\u4f30')]
    .forEach((label, index) => { if (tableHeaders[index]) tableHeaders[index].textContent = label; });
  const metrics = [
    [t('Estimated total', '\u9884\u4f30\u603b\u989d'), formatCanvasUsagePoints(totals.estimatedCredits ?? totals.credits)],
    [t('AI results', 'AI \u7ed3\u679c'), String(Math.max(0, Number(totals.generations) || 0))],
    [t('Images', '\u56fe\u7247'), `${formatCanvasUsagePoints(breakdown.image && (breakdown.image.estimatedCredits ?? breakdown.image.credits))} / ${Number(breakdown.image && breakdown.image.generations) || 0}`],
    [t('Videos', '\u89c6\u9891'), `${formatCanvasUsagePoints(breakdown.video && (breakdown.video.estimatedCredits ?? breakdown.video.credits))} / ${Number(breakdown.video && breakdown.video.generations) || 0}`],
    ['3D', `${formatCanvasUsagePoints(breakdown['3d'] && (breakdown['3d'].estimatedCredits ?? breakdown['3d'].credits))} / ${Number(breakdown['3d'] && breakdown['3d'].generations) || 0}`]
  ];
  summary.replaceChildren(...metrics.map(([label, value]) => {
    const metric = document.createElement('div');
    const copy = document.createElement('span');
    const strong = document.createElement('strong');
    copy.textContent = label;
    strong.textContent = value;
    metric.append(copy, strong);
    return metric;
  }));
  const unknown = Math.max(0, Number(totals.unrecorded) || 0);
  const estimated = Math.max(0, Number(totals.estimated) || 0);
  const notes = [];
  if (estimated > 0) notes.push(t(
    `${estimated} result${estimated === 1 ? '' : 's'} were recalculated from saved model settings using the latest price table.`,
    `${estimated} \u6761\u7ed3\u679c\u5df2\u6839\u636e\u4fdd\u5b58\u7684\u6a21\u578b\u53c2\u6570\u6309\u6700\u65b0\u4ef7\u683c\u91cd\u7b97\u3002`
  ));
  if (unknown > 0) notes.push(t(
    `${unknown} result${unknown === 1 ? '' : 's'} do not contain enough model parameters to calculate the latest price and are excluded from the current-price total.`,
    `${unknown} \u6761\u7ed3\u679c\u7f3a\u5c11\u6309\u6700\u65b0\u4ef7\u683c\u91cd\u7b97\u6240\u9700\u7684\u6a21\u578b\u53c2\u6570\uff0c\u672a\u8ba1\u5165\u6309\u73b0\u4ef7\u603b\u989d\u3002`
  ));
  note.hidden = notes.length === 0;
  note.textContent = notes.join(' ');
  rows.replaceChildren(...details.map((entry) => {
    const row = document.createElement('tr');
    const labels = {
      image: t('Image', '\u56fe\u7247'),
      video: t('Video', '\u89c6\u9891'),
      '3d': '3D'
    };
    [
      formatCanvasUsageDate(entry.createdAt),
      labels[entry.kind] || entry.kind || '-',
      typeof publicModelLabel === 'function'
        ? publicModelLabel(entry.modelName || (typeof usageModelName === 'function' ? usageModelName(entry.providerId) : ''), '-')
        : (entry.modelName || entry.providerId || '-'),
      entry.name || '-',
      entry.status === 'pending'
        ? t('Pending', '\u5f85\u7ed3\u7b97')
        : formatCanvasUsagePoints(entry.estimatedCredits)
    ].forEach((value, index) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      if (index === 4 && (entry.estimatedCredits === null || entry.status === 'pending')) cell.className = 'is-unrecorded';
      row.appendChild(cell);
    });
    return row;
  }));
  empty.hidden = details.length > 0;
  empty.textContent = t('No AI usage recorded on this canvas.', '\u8fd9\u4e2a\u753b\u5e03\u8fd8\u6ca1\u6709 AI \u4f7f\u7528\u8bb0\u5f55\u3002');
  document.getElementById('canvas-usage-account').textContent = t('View account usage', '\u67e5\u770b\u8d26\u6237\u7528\u91cf');
  document.getElementById('canvas-usage-done').textContent = t('Done', '\u5b8c\u6210');
}

async function openCanvasUsageDetails() {
  const overlay = initCanvasUsageDialog();
  if (!overlay || !window.messsAPI || typeof window.messsAPI.getCanvasCreditUsage !== 'function') {
    if (typeof window.openUsageSettings === 'function') window.openUsageSettings();
    return;
  }
  const loading = document.getElementById('canvas-usage-loading');
  const content = document.getElementById('canvas-usage-content');
  overlay.hidden = false;
  loading.hidden = false;
  loading.textContent = t('Loading usage...', '\u6b63\u5728\u52a0\u8f7d\u7528\u91cf...');
  content.hidden = true;
  requestAnimationFrame(() => overlay.classList.add('is-visible'));
  document.getElementById('canvas-usage-close').focus({ preventScroll: true });
  try {
    const result = await window.messsAPI.getCanvasCreditUsage(activeCanvasId());
    if (!result || !result.ok) throw new Error(result && result.reason || 'usage-unavailable');
    renderCanvasUsageDetails(result);
    loading.hidden = true;
    content.hidden = false;
  } catch (error) {
    loading.textContent = t('Canvas usage could not be loaded.', '\u65e0\u6cd5\u52a0\u8f7d\u753b\u5e03\u7528\u91cf\u3002');
  }
}

function showBoardCanvasContextMenu(x, y) {
  buildAndShowSimpleMenu([
    {
      label: t('Import files', '\u5bfc\u5165\u6587\u4ef6'),
      icon: 'M12 3v12;M7 8l5-5 5 5;M4 20h16',
      action: async () => {
        const paths = await window.messsAPI.pickFiles();
        if (!paths || !paths.length) return;
        const targetFolderId = AppState.activeFolderId && AppState.activeFolderId !== 'default'
          ? AppState.activeFolderId : null;
        const result = await window.messsAPI.importFiles(paths, targetFolderId, activeCanvasId());
        const imported = Array.isArray(result && result.imported) ? result.imported : [];
        if (!imported.length) return;
        AppState.files = [...imported, ...AppState.files];
        renderFileList(currentFileListScope());
        if (typeof renderFolderGridIfActive === 'function') renderFolderGridIfActive();
        const point = clientToBoardCoords(x, y);
        await addFilesToBoard(imported.map((file) => file.id), point.x, point.y, { selectAdded: true });
        showToast(t('Imported and added to the canvas', '\u5df2\u5bfc\u5165\u5e76\u653e\u5165\u753b\u5e03'));
      }
    },
    {
      label: t('View points usage', '\u67e5\u770b\u79ef\u5206\u7528\u91cf'),
      icon: 'M4 19V5M4 19h16M8 16v-4M12 16V8M16 16v-7',
      action: openCanvasUsageDetails
    }
  ], x, y, 'board-canvas-context-menu');
}

function duplicateBoardItem(item) {
  copyBoardSelection([item]);
  const copies = pasteBoardClipboard(item.x + 28, item.y + 28);
  if (copies.length) showToast(t('Duplicate created', '\u5df2\u521b\u5efa\u526f\u672c'));
}

async function exportBoardItemFile(item) {
  const result = await window.messsAPI.exportFile(item.fileId);
  if (result && result.ok) showToast(t('File downloaded', '\u6587\u4ef6\u5df2\u4e0b\u8f7d'));
}

async function removeBoardItemFromCanvas(item) {
  if (removeBoardItemsWithHistory([item])) {
    showToast(t('Removed from canvas', '\u5df2\u4ece\u753b\u5e03\u79fb\u9664'));
  }
}

function showBoardItemContextMenu(item, x, y) {
  if (item.isPartition) {
    buildAndShowSimpleMenu([
      {
        label: t('Rename partition', '重命名分区'),
        icon: 'M4 20h4l10-10-4-4L4 16v4;M13 5l4 4',
        action: () => beginBoardPartitionRename(item)
      },
      {
        label: t('Remove secondary partition', '取消二级分区'),
        icon: 'M4 4l16 16;M4 20h16;M4 4h16',
        divider: true,
        action: () => {
          if (removeBoardPartition(item, { recordHistory: true })) {
            showToast(t('Partition removed; its media was kept.', '已取消分区，图片和视频仍然保留。'));
          }
        }
      }
    ], x, y, 'board-partition-context-menu');
    return;
  }
  if (item.isMoodboard) {
    buildAndShowSimpleMenu([
      {
        label: t('Open text moodboard', '打开文字情绪板'),
        icon: 'M15 3h6v6;M21 3l-8 8;M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
        action: () => openMoodboardEditor(item)
      },
      {
        label: t('Create duplicate', '创建副本'),
        icon: 'M8 8h11v11H8z;M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
        action: () => duplicateBoardItem(item)
      },
      {
        label: t('Delete', '删除'),
        icon: 'M3 6h18;M8 6V4h8v2;M7 6l1 15h8l1-15;M10 10v7;M14 10v7',
        divider: true,
        danger: true,
        action: () => removeBoardItemFromCanvas(item)
      }
    ], x, y, 'board-moodboard-context-menu');
    return;
  }
  if (item.fileId) {
    const file = AppState.files.find((entry) => entry.id === item.fileId);
    const isImage = !!(file && isImageExt(file.ext));
    const isVideo = !!(file && isVideoExt(file.ext));
    const items = [
      {
        label: t('Create duplicate', '\u521b\u5efa\u526f\u672c'),
        icon: 'M8 8h11v11H8z;M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
        action: () => duplicateBoardItem(item)
      },
      {
        label: t('Download', '\u4e0b\u8f7d'),
        icon: 'M12 3v12;M7 10l5 5 5-5;M4 20h16',
        action: () => exportBoardItemFile(item)
      }
    ];
    if (isImage || isVideo) {
      items.push({
        label: t('Send to After Effects', '\u53d1\u9001\u5230 After Effects'),
        icon: 'M22 2 11 13;M22 2l-7 20-4-9-9-4z',
        action: () => sendBoardMediaToCreativeApp(item.fileId, 'after-effects')
      });
    }
    if (isImage) {
      items.push({
        label: t('Send to Photoshop', '\u53d1\u9001\u5230 Photoshop'),
        icon: 'M4 5h16v14H4z;M8 15l3-3 2 2 2-2 3 3;M16 8h.01',
        action: () => sendBoardMediaToCreativeApp(item.fileId, 'photoshop')
      });
    }
    items.push({
      label: t('View points usage', '\u67e5\u770b\u79ef\u5206\u7528\u91cf'),
      icon: 'M4 19V5M4 19h16M8 16v-4M12 16V8M16 16v-7',
      divider: true,
      action: openCanvasUsageDetails
    });
    items.push({
      label: t('Delete', '\u5220\u9664'),
      icon: 'M3 6h18;M8 6V4h8v2;M7 6l1 15h8l1-15;M10 10v7;M14 10v7',
      divider: true,
      danger: true,
      action: () => removeBoardItemFromCanvas(item)
    });
    buildAndShowSimpleMenu(items, x, y, 'board-item-context-menu');
    return;
  }

  const selected = AppState.boardItems.filter((boardItem) => boardItem.selected);
  const items = [
    { label: t('Copy', '\u590d\u5236'), action: () => copyBoardSelection(selected.length ? selected : [item]) },
    { label: t('Cut', '\u526a\u5207'), action: () => cutBoardSelection(selected.length ? selected : [item]) },
    { label: t('Paste', '\u7c98\u8d34'), action: () => pasteBoardSelectionAt(x, y), danger: false },
    {
      label: t('Remove from Canvas', '\u4ece\u753b\u5e03\u79fb\u9664'),
      danger: true,
      action: () => removeBoardItemFromCanvas(item)
    }
  ];
  buildAndShowSimpleMenu(items, x, y, 'board-item-context-menu');
}

const MULTI_MENU_ITEMS = [
  { key: 'copy', label: ['Copy', '复制'] },
  { key: 'cut', label: ['Cut', '剪切'] },
  { key: 'paste', label: ['Paste', '粘贴'] },
  { key: 'arrange', label: ['Arrange', '排列'], submenu: [
    { key: 'arrange-pack', label: ['Pack', '紧凑排列'] },
    { key: 'arrange-row', label: ['Row', '横向排列'] },
    { key: 'arrange-column', label: ['Column', '纵向排列'] }
  ] },
  { key: 'scale', label: ['Scale', '缩放'], submenu: [
    { key: 'scale-max', label: ['Scale to Maximum', '放大至最大', '최대로 확대'] },
    { key: 'scale-100', label: ['Scale to 100%', '放大至100%', '100%로 확대'] },
    { key: 'scale-min', label: ['Scale to Minimum', '缩小至最小', '최소로 축소'] }
  ] },
  { key: 'download', label: ['Export', '导出'] },
  { key: 'usage', label: ['View points usage', '\u67e5\u770b\u79ef\u5206\u7528\u91cf'] },
  { key: 'secondary-partition', label: ['Secondary partition', '二级分区'] },
  { key: 'group', label: ['Group', '成组'] },
  { key: 'ungroup', label: ['Ungroup', '取消成组'] },
  { key: 'delete', label: ['Delete', '删除'], danger: true }
];

function selectionGroupState() {
  const selected = AppState.boardItems.filter((item) => item.selected);
  const groupIds = new Set(selected.map((item) => item.groupId).filter(Boolean));
  return { isGrouped: groupIds.size === 1 && selected.every((item) => item.groupId) };
}

function showBoardMultiContextMenu(x, y) {
  const existing = document.getElementById('board-multi-menu');
  if (existing) existing.remove();
  const existingSub = document.getElementById('board-multi-submenu');
  if (existingSub) existingSub.remove();

  const { isGrouped } = selectionGroupState();
  const partitionSelection = AppState.boardItems.filter((item) => item.selected);
  const canCreatePartition = partitionSelection.length >= 2 && partitionSelection.every((item) => {
    const file = AppState.files.find((entry) => entry.id === item.fileId);
    return !item.isPartition && !item.partitionId && file && (isImageExt(file.ext) || isVideoExt(file.ext));
  });
  const menu = document.createElement('ul');
  menu.id = 'board-multi-menu';
  menu.className = 'context-menu is-visible';
  document.body.appendChild(menu);

  let submenuEl = null;
  let closeSubmenuTimer = null;

  function closeSubmenu() {
    if (submenuEl) {
      submenuEl.remove();
      submenuEl = null;
    }
  }

  for (const item of MULTI_MENU_ITEMS) {
    if (item.key === 'group' && isGrouped) continue;
    if (item.key === 'ungroup' && !isGrouped) continue;
    if (item.key === 'secondary-partition' && !canCreatePartition) continue;

    const li = document.createElement('li');
    li.className = 'context-menu-item' + (item.danger ? ' is-danger' : '');
    li.innerHTML = `<span>${t(item.label[0], item.label[1])}</span>` + (item.submenu ? '<span class="context-menu-caret">›</span>' : '');

    if (item.submenu) {
      li.addEventListener('mouseenter', () => {
        clearTimeout(closeSubmenuTimer);
        closeSubmenu();
        submenuEl = buildSubmenu(item, li);
      });
      li.addEventListener('mouseleave', () => {
        closeSubmenuTimer = setTimeout(closeSubmenu, 150);
      });
    } else {
      li.addEventListener('mouseenter', () => { clearTimeout(closeSubmenuTimer); closeSubmenu(); });
      li.addEventListener('click', () => { menu.remove(); closeSubmenu(); runMultiMenuAction(item.key, x, y); });
    }
    menu.appendChild(li);
  }

  function buildSubmenu(parentItem, anchorLi) {
    const sub = document.createElement('ul');
    sub.id = 'board-multi-submenu';
    sub.className = 'context-menu is-visible';
    document.body.appendChild(sub);

    for (const leaf of parentItem.submenu) {
      const li = document.createElement('li');
      li.className = 'context-menu-item';
      li.textContent = t(leaf.label[0], leaf.label[1]);
      li.addEventListener('click', () => { menu.remove(); sub.remove(); runMultiMenuAction(leaf.key, x, y); });
      sub.appendChild(li);
    }
    sub.addEventListener('mouseenter', () => clearTimeout(closeSubmenuTimer));
    sub.addEventListener('mouseleave', () => { closeSubmenuTimer = setTimeout(closeSubmenu, 150); });

    const anchorRect = anchorLi.getBoundingClientRect();
    const subRect = sub.getBoundingClientRect();
    let left = anchorRect.right + 2;
    if (left + subRect.width > window.innerWidth - 8) left = anchorRect.left - subRect.width - 2;
    let top = anchorRect.top;
    if (top + subRect.height > window.innerHeight - 8) top = window.innerHeight - subRect.height - 8;
    sub.style.left = left + 'px';
    sub.style.top = Math.max(8, top) + 'px';
    return sub;
  }

  const rect = menu.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 8;
  const maxY = window.innerHeight - rect.height - 8;
  menu.style.left = Math.max(8, Math.min(x, maxX)) + 'px';
  menu.style.top = Math.max(8, Math.min(y, maxY)) + 'px';

  const closeOnce = (e) => {
    if (!menu.contains(e.target) && !(submenuEl && submenuEl.contains(e.target))) {
      menu.remove();
      closeSubmenu();
      document.removeEventListener('click', closeOnce);
    }
  };
  setTimeout(() => document.addEventListener('click', closeOnce), 0);
}

async function runMultiMenuAction(key, x, y) {
  const selected = AppState.boardItems.filter((item) => item.selected);
  if (!selected.length && key !== 'paste') return;

  switch (key) {
    case 'copy':
      copyBoardSelection(selected);
      break;
    case 'cut':
      cutBoardSelection(selected);
      break;
    case 'paste':
      pasteBoardSelectionAt(x, y);
      break;
    case 'arrange-pack':
      await arrangeItemsGrid(selected);
      break;
    case 'arrange-row':
      arrangeItemsLine(selected, 'row');
      break;
    case 'arrange-column':
      arrangeItemsLine(selected, 'column');
      break;
    case 'scale-max':
      scaleBoardItemsToWidth(selected, MAX_BOARD_ITEM_WIDTH);
      break;
    case 'scale-100':
      scaleBoardItemsToWidth(selected, DEFAULT_BOARD_ITEM_WIDTH);
      break;
    case 'scale-min':
      scaleBoardItemsToWidth(selected, MIN_BOARD_ITEM_WIDTH);
      break;
    case 'download':
      for (const item of selected) {
        if (item.fileId) await window.messsAPI.exportFile(item.fileId);
      }
      showToast(t(`Exported ${selected.length} file${selected.length === 1 ? '' : 's'}`, `已导出 ${selected.length} 个文件`));
      break;
    case 'usage':
      openCanvasUsageDetails();
      break;
    case 'secondary-partition':
      createSecondaryPartition(selected);
      break;
    case 'group': {
      const groupId = 'g_' + Math.random().toString(36).slice(2, 10);
      selected.forEach((item) => { item.groupId = groupId; window.messsAPI.upsertBoardItem(item); });
      showToast(t(`Grouped ${selected.length} item${selected.length === 1 ? '' : 's'}`, `已成组 ${selected.length} 个项目`));
      break;
    }
    case 'ungroup':
      selected.forEach((item) => { delete item.groupId; window.messsAPI.upsertBoardItem(item); });
      showToast(t('Ungrouped', '已取消成组'));
      break;
    case 'delete':
      removeBoardItemsWithHistory(selected);
      break;
  }
}

function scaleBoardItemsToWidth(items, targetWidth) {
  const width = Math.max(1, Math.round(Number(targetWidth) || DEFAULT_BOARD_ITEM_WIDTH));
  const changedItems = items.filter((item) => item && !item.isPartition);
  changedItems.forEach((item) => {
    const previousWidth = Math.max(1, Number(item.width) || DEFAULT_BOARD_ITEM_WIDTH);
    const previousHeight = Number(item.height);
    if (previousHeight > 0) {
      item.height = Math.max(1, Math.round(previousHeight * width / previousWidth));
    }
    item.width = width;
  });
  if (typeof fitBoardItemsIntoPartitions === 'function') fitBoardItemsIntoPartitions(changedItems);
  if (typeof window.messsAPI.upsertBoardItems === 'function') window.messsAPI.upsertBoardItems(changedItems);
  else changedItems.forEach((item) => window.messsAPI.upsertBoardItem(item));
  renderBoard();
}

async function arrangeItemsGrid(items) {
  const mediaItems = items.filter((item) => {
    const file = AppState.files.find((entry) => entry.id === item.fileId);
    return file && (isImageExt(file.ext) || isVideoExt(file.ext));
  });
  if (!mediaItems.length) return;
  const startFrames = mediaItems.map((item) => {
    const bounds = typeof boardItemBounds === 'function'
      ? boardItemBounds(item)
      : { x: item.x, y: item.y, w: item.width || 220, h: item.height || 180 };
    return {
      item,
      x: bounds.x,
      y: bounds.y,
      width: bounds.w,
      height: bounds.h
    };
  });
  const originX = mediaItems.reduce((min, item) => Math.min(min, item.x), Infinity);
  const originY = mediaItems.reduce((min, item) => Math.min(min, item.y), Infinity);
  const measuredItems = mediaItems.map((item) => {
    const bounds = typeof boardItemBounds === 'function'
      ? boardItemBounds(item)
      : { w: item.width || 220, h: item.height || 180 };
    return { ...item, width: bounds.w, height: bounds.h };
  });
  const packed = window.MesssBoardEngine.compactMediaGrid(measuredItems, {
    originX,
    originY,
    gap: 20,
    columns: Math.max(1, Math.ceil(Math.sqrt(mediaItems.length * 1.35))),
    minWidth: typeof MIN_BOARD_ITEM_WIDTH === 'number' ? MIN_BOARD_ITEM_WIDTH : 90
  });
  const itemsById = new Map(mediaItems.map((item) => [item.id, item]));
  packed.forEach((position) => {
    const item = itemsById.get(position.id);
    if (!item) return;
    item.x = position.x;
    item.y = position.y;
    item.width = position.width;
    item.height = position.height;
    delete item.layoutFrame;
  });
  if (typeof fitBoardItemsIntoPartitions === 'function') fitBoardItemsIntoPartitions(mediaItems);

  const recorded = typeof recordBoardResizeHistory === 'function' &&
    recordBoardResizeHistory(startFrames);
  if (recorded && typeof persistBoardMoveHistory === 'function') {
    persistBoardMoveHistory(mediaItems);
  } else if (typeof window.messsAPI.upsertBoardItems === 'function') {
    await window.messsAPI.upsertBoardItems(mediaItems);
  } else {
    await Promise.all(mediaItems.map((item) => window.messsAPI.upsertBoardItem(item)));
  }
  renderBoard();
}

function arrangeItemsLine(items, direction) {
  const gap = 12;
  const originX = items.reduce((min, it) => Math.min(min, it.x), Infinity);
  const originY = items.reduce((min, it) => Math.min(min, it.y), Infinity);
  let cursor = direction === 'row' ? originX : originY;
  const changedItems = items.filter((item) => item && !item.isPartition);
  changedItems.forEach((item) => {
    const w = item.width || 220;
    if (direction === 'row') {
      item.x = Math.round(cursor);
      item.y = Math.round(originY);
      cursor += w + gap;
    } else {
      item.x = Math.round(originX);
      item.y = Math.round(cursor);
      cursor += w * 0.75 + gap;
    }
  });
  if (typeof fitBoardItemsIntoPartitions === 'function') fitBoardItemsIntoPartitions(changedItems);
  if (typeof window.messsAPI.upsertBoardItems === 'function') window.messsAPI.upsertBoardItems(changedItems);
  else changedItems.forEach((item) => window.messsAPI.upsertBoardItem(item));
  renderBoard();
}

function showMultiFileContextMenu(fileIds, x, y, targetFileId) {
  const targetFolderId = folderIdForFile(targetFileId || fileIds[0]);
  buildAndShowSimpleMenu([
    {
      label: t(`Copy (${fileIds.length})`, `复制（${fileIds.length}）`),
      action: () => {
        setFileClipboard(fileIds, 'copy');
        showToast(t(`${fileIds.length} file${fileIds.length === 1 ? '' : 's'} copied`, `已复制 ${fileIds.length} 个文件`));
      }
    },
    {
      label: t(`Cut (${fileIds.length})`, `剪切（${fileIds.length}）`),
      action: () => {
        setFileClipboard(fileIds, 'cut');
        showToast(t(`${fileIds.length} file${fileIds.length === 1 ? '' : 's'} cut`, `已剪切 ${fileIds.length} 个文件`));
      }
    },
    {
      label: t('Paste', '粘贴'),
      action: async () => pasteFileClipboardIntoFolder(targetFolderId)
    },
    {
      label: t(`Copy Paths (${fileIds.length})`, `复制路径（${fileIds.length}）`),
      action: async () => {
        for (const id of fileIds) await window.messsAPI.copyFilePath(id);
        showToast(t('Paths copied', '路径已复制'));
      }
    },
    {
      label: t(`Duplicate (${fileIds.length})`, `复制副本（${fileIds.length}）`),
      action: async () => {
        for (const id of fileIds) {
          const res = await window.messsAPI.duplicateFile(id);
          if (res.ok) AppState.files = [res.file, ...AppState.files];
        }
        renderFileList(currentFileListScope());
        renderFolderGridIfActive();
        showToast(t('Duplicates created', '已创建副本'));
      }
    },
    {
      label: t(`Move to Trash (${fileIds.length})`, `移到废纸篓（${fileIds.length}）`),
      danger: true,
      action: async () => {
        const ok = await showConfirmDialog({
          title: t('Move to Trash', '移到废纸篓'),
          message: t(`Move these ${fileIds.length} files to the trash? This cannot be undone.`, `将这 ${fileIds.length} 个文件移到废纸篓吗？此操作无法撤销。`),
          confirmLabel: t('Move to Trash', '移到废纸篓')
        });
        if (!ok) return;
        for (const id of fileIds) {
          const res = await window.messsAPI.moveFileToTrash(id);
          if (res.ok) {
            AppState.files = AppState.files.filter((x) => x.id !== id);
            removeBoardItemsForFile(id);
            if (AppState.activeFileId === id) clearPreview();
          }
        }
        renderFileList(currentFileListScope());
        renderFolderGridIfActive();
        showToast(t('Moved to trash', '已移到废纸篓'));
      }
    }
  ], x, y, 'multi-file-context-menu');
}

function initContextMenu() {
  renderContextMenuItems();
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#context-menu')) hideContextMenu();
  });
  document.addEventListener('contextmenu', (e) => {
    if (!e.target.closest('.board-item') && !e.target.closest('.folder-grid-item') && !e.target.closest('.file-item')) {
      hideContextMenu();
    }
  });
  window.addEventListener('blur', hideContextMenu);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideContextMenu();
  });
}
