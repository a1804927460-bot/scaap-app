'use strict';

function formatBoardMediaSize(file) {
  const width = Number(file.sourceWidth);
  const height = Number(file.sourceHeight);
  const fileSize = Number(file.sizeBytes);
  const parts = [];
  if (Number.isFinite(width) && Number.isFinite(height)) {
    parts.push(t(`${Math.round(width)} x ${Math.round(height)} px`, `${Math.round(width)} x ${Math.round(height)} 像素`));
  }
  if (Number.isFinite(fileSize) && fileSize >= 0) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = fileSize;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    parts.push(`${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`);
  }
  return parts.join(' | ') || t('Source size unavailable', '源文件尺寸不可用');
}

function appendBoardMediaMeta(element, file) {
  const meta = document.createElement('div');
  meta.className = 'board-media-meta';
  const name = document.createElement('strong');
  name.className = 'board-media-meta-name';
  name.textContent = file.name;
  const dimensions = document.createElement('span');
  dimensions.className = 'board-media-meta-size';
  dimensions.textContent = formatBoardMediaSize(file);
  meta.append(name, dimensions);
  element.appendChild(meta);
  return meta;
}

function formatBoardFileSize(file) {
  const fileSize = Number(file && file.sizeBytes);
  if (!Number.isFinite(fileSize) || fileSize < 0) return t('Size unavailable', '大小未知');
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = fileSize;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

let generatedMediaDetailKeyHandler = null;
let boardButlerMenu = null;
let boardButlerMenuClickCloser = null;
let boardButlerMenuKeyHandler = null;
let boardButlerPanel = null;
let boardButlerPanelClickCloser = null;
let boardButlerPanelKeyHandler = null;
const BoardButlerTasks = new Map();
const BOARD_BUTLER_MAX_POLLS = 360;
const BOARD_BUTLER_MAX_VIDEO_BYTES = 48 * 1024 * 1024;
const BOARD_BUTLER_VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov', '.webm', '.mkv']);

const BOARD_IMAGE_TOOL_ICONS = {
  details: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"></circle><path d="M12 11v6"></path><path d="M12 7h.01"></path></svg>',
  fullscreen: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 3H5a2 2 0 0 0-2 2v3"></path><path d="M16 3h3a2 2 0 0 1 2 2v3"></path><path d="M8 21H5a2 2 0 0 1-2-2v-3"></path><path d="M16 21h3a2 2 0 0 0 2-2v-3"></path></svg>'
};

const BOARD_BUTLER_ICONS = {
  trigger: '<svg class="board-butler-icon-svg" viewBox="0 0 24 24"><path d="M13 2 4.8 13h6.4L10 22l8.2-11h-6.4L13 2Z"></path></svg>',
  caret: '<svg class="board-butler-icon-svg board-butler-caret" viewBox="0 0 12 12"><path d="m3 4.5 3 3 3-3"></path></svg>',
  close: '<svg class="board-butler-icon-svg" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"></path></svg>',
  removeBackground: '<svg class="board-butler-icon-svg" viewBox="0 0 24 24"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z"></path><path d="m15 18 2 2 4-5"></path></svg>',
  imageEdit: '<svg class="board-butler-icon-svg" viewBox="0 0 24 24"><rect x="3" y="4" width="15" height="15" rx="2"></rect><path d="m4 15 4-4 3 3 2-2 2 2"></path><path d="m14.5 7.5 4-4 2 2-4 4-3 .9z"></path></svg>',
  imageLayer: '<svg class="board-butler-icon-svg" viewBox="0 0 24 24"><path d="m12 3 9 5-9 5-9-5 9-5Z"></path><path d="m5 12-2 1 9 5 9-5-2-1M5 17l-2 1 9 5 9-5-2-1"></path></svg>',
  imageUpscale: '<svg class="board-butler-icon-svg" viewBox="0 0 24 24"><path d="M9 3H3v6M15 3h6v6M9 21H3v-6M15 21h6v-6"></path><path d="m3 9 6-6m6 0 6 6M3 15l6 6m6 0 6-6"></path></svg>',
  videoUpscale: '<svg class="board-butler-icon-svg" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m10 9 5 3-5 3V9Z"></path><path d="M6 2v3M18 2v3M6 19v3M18 19v3"></path></svg>',
  eraseObject: '<svg class="board-butler-icon-svg" viewBox="0 0 24 24"><path d="m7.5 19 11-11a2.8 2.8 0 0 0-4-4l-11 11a2.8 2.8 0 0 0 0 4l1 1h9"></path><path d="m10 8 6 6M7.5 19l-4-4"></path></svg>',
  generate3d: '<svg class="board-butler-icon-svg" viewBox="0 0 24 24"><path d="m12 2 8 4.5v9L12 20l-8-4.5v-9L12 2Z"></path><path d="m4 6.5 8 4.5 8-4.5M12 11v9"></path></svg>',
  hunyuan3d: '<svg class="board-butler-icon-svg" viewBox="0 0 24 24"><path d="m12 3 7 4v8l-7 4-7-4V7l7-4Z"></path><path d="m5 7 7 4 7-4M12 11v8"></path><path d="m18.5 2 .5 1.5L20.5 4 19 4.5 18.5 6 18 4.5 16.5 4l1.5-.5.5-1.5Z"></path></svg>',
  hyper3d: '<svg class="board-butler-icon-svg" viewBox="0 0 24 24"><path d="m12 7 4 2.3v4.5L12 16l-4-2.2V9.3L12 7Z"></path><ellipse cx="12" cy="11.5" rx="10" ry="4.5" transform="rotate(28 12 11.5)"></ellipse><ellipse cx="12" cy="11.5" rx="10" ry="4.5" transform="rotate(-28 12 11.5)"></ellipse></svg>',
  prompt: '<svg class="board-butler-icon-svg" viewBox="0 0 24 24"><path d="M4 5h11a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3H9l-5 4V5Z"></path><path d="M8 9h6M8 12h4"></path></svg>',
  layers: '<svg class="board-butler-icon-svg" viewBox="0 0 24 24"><path d="m12 4 8 4-8 4-8-4 8-4Z"></path><path d="m5 12-1 1 8 4 8-4-1-1M5 17l-1 1 8 4 8-4-1-1"></path></svg>',
  detail: '<svg class="board-butler-icon-svg" viewBox="0 0 24 24"><path d="M12 3v4M12 17v4M3 12h4M17 12h4"></path><circle cx="12" cy="12" r="4"></circle></svg>',
  frameRate: '<svg class="board-butler-icon-svg" viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="2"></rect><path d="M8 2v3M16 2v3M8 19v3M16 19v3M4 9h16"></path></svg>',
  brush: '<svg class="board-butler-icon-svg" viewBox="0 0 24 24"><path d="m14 4 6 6-8 8H6v-6l8-8Z"></path><path d="m12 6 6 6M6 18c0 2-1 3-3 3 1-1 0-3 3-3Z"></path></svg>',
  clear: '<svg class="board-butler-icon-svg" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"></path><path d="M10 11v5M14 11v5"></path></svg>'
};

const BOARD_BUTLER_IMAGE_TOOL_HOOKS = Object.freeze({
  imageEdit: Object.freeze({ method: 'editImage', toolId: 'qwen-image-edit-plus' }),
  imageLayer: Object.freeze({ method: 'layerImage', toolId: 'qwen-image-layered' }),
  imageUpscale: Object.freeze({ method: 'upscaleImage', toolId: 'super-upscale-v2' }),
  eraseObject: Object.freeze({ method: 'eraseObject', toolId: 'erase' })
});

const BOARD_BUTLER_VIDEO_TOOL_HOOKS = Object.freeze({
  videoUpscale: Object.freeze({ method: 'upscaleVideo', toolId: 'topaz-video-upscale' })
});

const BOARD_BUTLER_TASK_ACTIONS = Object.freeze([
  'removeBackground',
  'imageEdit',
  'imageLayer',
  'imageUpscale',
  'eraseObject',
  'videoUpscale',
  'generate3d:hunyuan3d',
  'generate3d:hyper3d'
]);

function boardButlerTaskKey(fileId, action) {
  return `${String(fileId)}:${action}`;
}

function getBoardButlerTask(fileId, action) {
  return BoardButlerTasks.get(boardButlerTaskKey(fileId, action)) || null;
}

function setBoardButlerTask(fileId, action, state) {
  const key = boardButlerTaskKey(fileId, action);
  if (state) BoardButlerTasks.set(key, state);
  else BoardButlerTasks.delete(key);
  syncBoardButlerTaskUi(fileId);
}

function boardButlerStatusText(action, task) {
  if (!task) return '';
  if (action === 'videoUpscale') {
    if (task.status === 'error') return t('Retry', '重试', '다시 시도');
    const credits = Math.max(0, Math.round(Number(task.creditsCharged ?? task.credits) || 0));
    const points = credits > 0 ? t(`${credits} pts`, `${credits} 积分`, `${credits}포인트`) : '';
    if (task.status === 'success') {
      const done = t('Done', '完成', '완료');
      return points ? `${done} · ${points}` : done;
    }
    const progress = Math.max(0, Math.min(100, Math.round(Number(task.progress) || 0)));
    let phase;
    if (task.phase === 'queued') phase = t('Queued', '排队中', '대기 중');
    else if (task.phase === 'downloading') phase = t('Downloading...', '下载中...', '다운로드 중...');
    else if (task.phase === 'saving') phase = t('Adding to canvas...', '正在加入画布...', '캔버스에 추가 중...');
    else if (task.phase === 'creating') phase = t('Starting...', '正在提交...', '시작 중...');
    else phase = progress > 0
      ? t(`Enhancing ${progress}%`, `超清处理中 ${progress}%`, `고화질 처리 중 ${progress}%`)
      : t('Enhancing...', '超清处理中...', '고화질 처리 중...');
    return points ? `${phase} · ${points}` : phase;
  }
  if (task.status === 'error') return t('Retry', '重试', '다시 시도');
  if (task.status === 'success') return t('Done', '完成', '완료');
  if (task.phase === 'queued') return t('Queued', '排队中', '대기 중');
  if (task.phase === 'downloading') return t('Downloading...', '下载中...', '다운로드 중...');
  if (task.phase === 'saving') return t('Adding to canvas...', '正在加入画布...', '캔버스에 추가 중...');
  if (task.phase === 'creating') return t('Starting...', '正在提交...', '시작 중...');
  if (action === 'removeBackground') {
    return t('Removing...', '处理中...', '처리 중...');
  }
  if (action === 'eraseObject') return t('Erasing...', '消除中...', '지우는 중...');
  if (action === 'imageUpscale') return t('Upscaling...', '放大中...', '확대 중...');
  if (action === 'imageLayer') return t('Layering...', '分层中...', '레이어 분리 중...');
  if (action === 'imageEdit') return t('Editing...', '修改中...', '편집 중...');
  if (task.phase === 'downloading') return t('Saving...', '保存中...', '저장 중...');
  if (task.phase === 'queued') return t('Queued', '排队中', '대기 중');
  return t('Creating...', '生成中...', '생성 중...');
}

function syncBoardButlerTaskUi(fileId) {
  const id = String(fileId);
  const tasksByAction = new Map(BOARD_BUTLER_TASK_ACTIONS.map((action) => [
    action,
    getBoardButlerTask(id, action)
  ]));
  const tasks = Array.from(tasksByAction.values());
  const hasRunningTask = tasks.some((task) => task && task.status === 'running');
  document.querySelectorAll('.board-butler-trigger').forEach((button) => {
    if (button.dataset.fileId !== id) return;
    button.classList.toggle('is-busy', hasRunningTask);
    button.setAttribute('aria-busy', hasRunningTask ? 'true' : 'false');
  });
  document.querySelectorAll('.board-butler-menu-item').forEach((button) => {
    if (button.dataset.fileId !== id) return;
    const is3dGroup = button.dataset.butlerAction === 'generate3d';
    const task = is3dGroup
      ? ['generate3d:hunyuan3d', 'generate3d:hyper3d']
        .map((action) => tasksByAction.get(action))
        .find((entry) => entry && entry.status === 'running') ||
        ['generate3d:hunyuan3d', 'generate3d:hyper3d']
          .map((action) => tasksByAction.get(action))
          .find((entry) => entry && entry.status === 'error') ||
        ['generate3d:hunyuan3d', 'generate3d:hyper3d']
          .map((action) => tasksByAction.get(action))
          .find(Boolean)
      : tasksByAction.get(button.dataset.butlerAction);
    const isRunning = !!task && task.status === 'running';
    button.disabled = is3dGroup ? false : isRunning;
    button.classList.toggle('is-loading', isRunning);
    button.classList.toggle('is-error', !!task && task.status === 'error');
    button.classList.toggle('is-success', !!task && task.status === 'success');
    button.setAttribute('aria-busy', isRunning ? 'true' : 'false');
    const status = button.querySelector(':scope > .board-butler-menu-status');
    if (status) {
      status.textContent = boardButlerStatusText(button.dataset.butlerAction, task);
      status.hidden = !task;
    }
  });
  if (boardButlerMenu && boardButlerMenu._trigger && boardButlerMenu._trigger.isConnected) {
    requestAnimationFrame(() => {
      if (boardButlerMenu && boardButlerMenu._trigger) {
        positionBoardButlerMenu(boardButlerMenu, boardButlerMenu._trigger);
      }
    });
  }
}

function closeBoardButlerPanel() {
  if (boardButlerPanel) {
    const panel = boardButlerPanel;
    boardButlerPanel = null;
    if (typeof panel._cleanup === 'function') panel._cleanup();
    panel.classList.remove('is-visible');
    panel.style.pointerEvents = 'none';
    window.setTimeout(() => panel.remove(), 150);
  }
  if (boardButlerPanelClickCloser) {
    document.removeEventListener('pointerdown', boardButlerPanelClickCloser, true);
    boardButlerPanelClickCloser = null;
  }
  if (boardButlerPanelKeyHandler) {
    document.removeEventListener('keydown', boardButlerPanelKeyHandler);
    boardButlerPanelKeyHandler = null;
  }
}

function closeBoardButlerMenu() {
  if (boardButlerMenu) {
    const trigger = boardButlerMenu._trigger;
    if (trigger) {
      trigger.classList.remove('is-open');
      trigger.setAttribute('aria-expanded', 'false');
    }
    boardButlerMenu.remove();
    boardButlerMenu = null;
  }
  if (boardButlerMenuClickCloser) {
    document.removeEventListener('pointerdown', boardButlerMenuClickCloser, true);
    boardButlerMenuClickCloser = null;
  }
  if (boardButlerMenuKeyHandler) {
    document.removeEventListener('keydown', boardButlerMenuKeyHandler);
    boardButlerMenuKeyHandler = null;
  }
}

function positionBoardButlerMenu(menu, trigger) {
  const triggerRect = trigger.getBoundingClientRect();
  const margin = 10;
  const gap = 7;
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  const fitsRight = triggerRect.right + gap + width <= window.innerWidth - margin;
  const fitsLeft = triggerRect.left - gap - width >= margin;
  let left = fitsRight
    ? triggerRect.right + gap
    : (fitsLeft ? triggerRect.left - width - gap : Math.max(margin, window.innerWidth - width - margin));
  let top = triggerRect.top + (triggerRect.height - height) / 2;
  if (!fitsRight && !fitsLeft) {
    const fitsBelow = triggerRect.bottom + gap + height <= window.innerHeight - margin;
    top = fitsBelow ? triggerRect.bottom + gap : triggerRect.top - height - gap;
  }
  left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
  top = Math.max(margin, Math.min(top, window.innerHeight - height - margin));
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
  menu.classList.toggle('opens-upward', top + height + 104 > window.innerHeight - margin);
}

function positionBoardButlerPanel(panel, anchor) {
  if (!panel || !anchor || !anchor.isConnected) return;
  const rect = anchor.getBoundingClientRect();
  const margin = 12;
  const gap = 8;
  const width = panel.offsetWidth;
  const height = panel.offsetHeight;
  let left = rect.left;
  let top = rect.bottom + gap;
  if (left + width > window.innerWidth - margin) left = window.innerWidth - width - margin;
  if (top + height > window.innerHeight - margin) top = rect.top - height - gap;
  if (top < margin) top = Math.max(margin, (window.innerHeight - height) / 2);
  left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
}

function boardButlerApi() {
  return window.messsAPI && window.messsAPI.butler;
}

function boardButlerError(result, fallback) {
  const candidates = result && typeof result === 'object'
    ? [result.message, result.errorMessage, result.error && result.error.message]
    : [];
  const supplied = candidates.find((value) => typeof value === 'string' && value.trim());
  const message = supplied ? supplied.trim() : fallback;
  const error = new Error(message);
  error.reason = result && (result.reason || result.errorCode || result.code);
  return error;
}

function boardButlerPollDelay(value) {
  const delay = Number(value);
  return Math.max(800, Math.min(10000, Number.isFinite(delay) ? delay : 2400));
}

function waitForBoardButlerPoll(delay) {
  return new Promise((resolve) => window.setTimeout(resolve, delay));
}

async function placeBoardButlerResult(file, sourceItem, action) {
  if (!file || !file.id) throw new Error(t('The result file is missing.', '结果文件缺失。', '결과 파일이 없습니다.'));
  AppState.files = [file, ...AppState.files.filter((entry) => entry.id !== file.id)];
  if (typeof renderFileList === 'function') renderFileList(currentFileListScope());
  if (typeof renderFolderGridIfActive === 'function') renderFolderGridIfActive();
  const sourceWidth = Math.max(1, Number(sourceItem && sourceItem.width) || 220);
  const sourceX = Number(sourceItem && sourceItem.x) || 0;
  const sourceY = Number(sourceItem && sourceItem.y) || 0;
  const placementX = sourceX + sourceWidth + 150;
  const placementOffset = action === 'generate3d:hyper3d' ? 520 : (action.startsWith('generate3d:') ? 320 : 110);
  const placementY = sourceY + placementOffset;
  closeBoardButlerMenu();
  await addFileToBoard(file.id, placementX, placementY);
}

async function placeBoardButlerResults(files, sourceItem, action) {
  const validFiles = Array.isArray(files) ? files.filter((file) => file && file.id) : [];
  if (!validFiles.length) {
    throw new Error(t('The result file is missing.', '结果文件缺失。', '결과 파일이 없습니다.'));
  }
  validFiles.slice().reverse().forEach((file) => {
    AppState.files = [file, ...AppState.files.filter((entry) => entry.id !== file.id)];
  });
  if (typeof renderFileList === 'function') renderFileList(currentFileListScope());
  if (typeof renderFolderGridIfActive === 'function') renderFolderGridIfActive();
  const sourceWidth = Math.max(1, Number(sourceItem && sourceItem.width) || 220);
  const sourceHeight = Math.max(1, Number(sourceItem && sourceItem.height) || 170);
  const sourceX = Number(sourceItem && sourceItem.x) || 0;
  const sourceY = Number(sourceItem && sourceItem.y) || 0;
  const cardGap = 34;
  const columnWidth = Math.max(180, Math.min(360, sourceWidth));
  const rowHeight = Math.max(150, Math.min(300, sourceHeight));
  const baseX = sourceX + sourceWidth + 150;
  const baseY = sourceY + (action === 'imageLayer' ? 80 : 110);
  closeBoardButlerMenu();
  closeBoardButlerPanel();
  for (let index = 0; index < validFiles.length; index += 1) {
    const column = index % 3;
    const row = Math.floor(index / 3);
    await addFileToBoard(
      validFiles[index].id,
      baseX + column * (columnWidth + cardGap),
      baseY + row * (rowHeight + cardGap)
    );
  }
}

function boardButlerImageToolInvoker(action) {
  const api = boardButlerApi();
  const hook = BOARD_BUTLER_IMAGE_TOOL_HOOKS[action];
  if (!api || !hook) return null;
  if (typeof api[hook.method] === 'function') {
    return (fileId, options) => api[hook.method](fileId, options);
  }
  if (typeof api.runImageTool === 'function') {
    return (fileId, options) => api.runImageTool(fileId, hook.toolId, options);
  }
  return null;
}

function normalizeBoardButlerJobStatus(value) {
  const status = String(value || 'queued').trim().toLowerCase().replace(/[_\s]+/g, '-');
  if (['completed', 'complete', 'success', 'succeeded', 'ready', 'done'].includes(status)) return 'succeeded';
  if (['failed', 'error', 'cancelled', 'canceled'].includes(status)) return 'failed';
  if (['running', 'processing', 'in-progress'].includes(status)) return 'processing';
  return 'queued';
}

function boardButlerResultFiles(result) {
  if (!result || typeof result !== 'object') return [];
  if (Array.isArray(result.files)) return result.files.filter((file) => file && file.id);
  if (result.file && result.file.id) return [result.file];
  if (result.result && result.result !== result) return boardButlerResultFiles(result.result);
  if (result.output && result.output !== result) return boardButlerResultFiles(result.output);
  return [];
}

async function resolveBoardButlerImageToolResult(api, hook, initialResult, state, fileId) {
  let result = initialResult;
  let files = boardButlerResultFiles(result);
  if (files.length) return files;
  const taskToken = String(result && result.taskToken || '').trim();
  if (!taskToken) return [];
  if (typeof api.getImageToolStatus !== 'function') {
    throw new Error(t(
      'The desktop service needs an image-tool status bridge.',
      '桌面服务尚未接入图片工具状态查询。',
      '데스크톱 서비스에 이미지 도구 상태 조회 연결이 필요합니다.'
    ));
  }
  let status = normalizeBoardButlerJobStatus(result.status);
  let retryAfterMs = boardButlerPollDelay(result.retryAfterMs);
  for (let attempt = 0; status !== 'succeeded' && attempt < BOARD_BUTLER_MAX_POLLS; attempt += 1) {
    if (status === 'failed') {
      throw boardButlerError(result, t('Image processing failed.', '图片处理失败。', '이미지 처리에 실패했습니다.'));
    }
    state.phase = status === 'queued' ? 'queued' : 'processing';
    syncBoardButlerTaskUi(fileId);
    await waitForBoardButlerPoll(retryAfterMs);
    result = await api.getImageToolStatus(taskToken, hook.toolId);
    if (!result || !result.ok) {
      throw boardButlerError(result, t(
        'Could not check image processing.',
        '无法查询图片处理进度。',
        '이미지 처리 상태를 확인하지 못했습니다.'
      ));
    }
    files = boardButlerResultFiles(result);
    if (files.length) return files;
    status = normalizeBoardButlerJobStatus(result.status);
    if (Number.isFinite(Number(result.progress))) {
      state.progress = Math.max(0, Math.min(100, Number(result.progress)));
    }
    retryAfterMs = boardButlerPollDelay(result.retryAfterMs);
  }
  if (status !== 'succeeded') {
    throw new Error(t(
      'Image processing timed out. Try again later.',
      '图片处理等待超时，请稍后重试。',
      '이미지 처리 대기 시간이 초과되었습니다. 나중에 다시 시도하세요.'
    ));
  }
  if (typeof api.downloadImageToolResult !== 'function') return [];
  state.phase = 'downloading';
  syncBoardButlerTaskUi(fileId);
  const downloaded = await api.downloadImageToolResult(taskToken, hook.toolId);
  if (!downloaded || !downloaded.ok) {
    throw boardButlerError(downloaded, t('Could not save the processed image.', '无法保存处理后的图片。', '처리된 이미지를 저장하지 못했습니다.'));
  }
  return boardButlerResultFiles(downloaded);
}

async function runBoardButlerImageTool(action, file, item, options) {
  if (getBoardButlerTask(file.id, action)?.status === 'running') return;
  const api = boardButlerApi();
  const hook = BOARD_BUTLER_IMAGE_TOOL_HOOKS[action];
  const invoke = boardButlerImageToolInvoker(action);
  if (!api || !hook || !invoke) {
    showToast(t(
      'This Butler tool is ready for the desktop service update.',
      '此 Butler 工具正在等待桌面服务接入。',
      '이 Butler 도구는 데스크톱 서비스 연결을 기다리고 있습니다.'
    ));
    return;
  }
  const state = { status: 'running', phase: 'creating' };
  setBoardButlerTask(file.id, action, state);
  try {
    const requestOptions = { ...options, modelId: hook.toolId };
    const initialResult = await invoke(file.id, requestOptions);
    if (!initialResult || !initialResult.ok) {
      throw boardButlerError(initialResult, t('Image processing failed.', '图片处理失败。', '이미지 처리에 실패했습니다.'));
    }
    const resultFiles = await resolveBoardButlerImageToolResult(api, hook, initialResult, state, file.id);
    if (!resultFiles.length) {
      throw new Error(t('The result file is missing.', '结果文件缺失。', '결과 파일이 없습니다.'));
    }
    state.phase = 'saving';
    syncBoardButlerTaskUi(file.id);
    await placeBoardButlerResults(resultFiles, item, action);
    state.status = 'success';
    syncBoardButlerTaskUi(file.id);
    showToast(t(
      resultFiles.length > 1 ? 'Images added to the canvas.' : 'Image added to the canvas.',
      resultFiles.length > 1 ? '图片已加入画布。' : '图片已加入画布。',
      resultFiles.length > 1 ? '이미지를 캔버스에 추가했습니다.' : '이미지를 캔버스에 추가했습니다.'
    ));
    clearCompletedBoardButlerTask(file.id, action, state);
  } catch (error) {
    state.status = 'error';
    state.message = error && error.message;
    syncBoardButlerTaskUi(file.id);
    showToast(state.message || t('Image processing failed.', '图片处理失败。', '이미지 처리에 실패했습니다.'));
  }
}

function launchBoardButlerImageTool(action, file, item, options) {
  if (!boardButlerImageToolInvoker(action)) {
    showToast(t(
      'This Butler tool is ready for the desktop service update.',
      '此 Butler 工具正在等待桌面服务接入。',
      '이 Butler 도구는 데스크톱 서비스 연결을 기다리고 있습니다.'
    ));
    return false;
  }
  void runBoardButlerImageTool(action, file, item, options);
  return true;
}

function boardButlerVideoToolInvoker(action) {
  const api = boardButlerApi();
  const hook = BOARD_BUTLER_VIDEO_TOOL_HOOKS[action];
  if (!api || !hook) return null;
  if (typeof api[hook.method] === 'function') {
    return (fileId, options) => api[hook.method](fileId, options);
  }
  if (typeof api.runVideoTool === 'function') {
    return (fileId, options) => api.runVideoTool(fileId, hook.toolId, options);
  }
  return null;
}

function updateBoardButlerVideoState(state, result) {
  ['credits', 'creditsCharged', 'creditsReleased', 'providerCost', 'progress'].forEach((key) => {
    if (Number.isFinite(Number(result && result[key]))) state[key] = Number(result[key]);
  });
}

async function resolveBoardButlerVideoToolResult(api, hook, initialResult, state, fileId) {
  let result = initialResult;
  updateBoardButlerVideoState(state, result);
  let files = boardButlerResultFiles(result);
  if (files.length) return files;
  const taskToken = String(result && result.taskToken || '').trim();
  if (!taskToken) return [];
  if (typeof api.getVideoToolStatus !== 'function') {
    throw new Error(t(
      'The desktop service needs a video-tool status bridge.',
      '桌面服务尚未接入视频工具状态查询。',
      '데스크톱 서비스에 비디오 도구 상태 조회 연결이 필요합니다.'
    ));
  }
  let status = normalizeBoardButlerJobStatus(result.status);
  let retryAfterMs = boardButlerPollDelay(result.retryAfterMs);
  for (let attempt = 0; status !== 'succeeded' && attempt < BOARD_BUTLER_MAX_POLLS; attempt += 1) {
    if (status === 'failed') {
      throw boardButlerError(result, t('Video enhancement failed.', '视频超清失败。', '비디오 고화질 처리에 실패했습니다.'));
    }
    state.phase = status === 'queued' ? 'queued' : 'processing';
    syncBoardButlerTaskUi(fileId);
    await waitForBoardButlerPoll(retryAfterMs);
    result = await api.getVideoToolStatus(taskToken, hook.toolId);
    if (!result || !result.ok) {
      throw boardButlerError(result, t(
        'Could not check video enhancement.',
        '无法查询视频超清进度。',
        '비디오 고화질 처리 상태를 확인하지 못했습니다.'
      ));
    }
    updateBoardButlerVideoState(state, result);
    files = boardButlerResultFiles(result);
    if (files.length) return files;
    status = normalizeBoardButlerJobStatus(result.status);
    retryAfterMs = boardButlerPollDelay(result.retryAfterMs);
  }
  if (status !== 'succeeded') {
    throw new Error(t(
      'Video enhancement timed out. Try again later.',
      '视频超清等待超时，请稍后重试。',
      '비디오 고화질 처리 대기 시간이 초과되었습니다. 나중에 다시 시도하세요.'
    ));
  }
  if (typeof api.downloadVideoToolResult !== 'function') return [];
  state.phase = 'downloading';
  syncBoardButlerTaskUi(fileId);
  const downloaded = await api.downloadVideoToolResult(taskToken, hook.toolId);
  if (!downloaded || !downloaded.ok) {
    throw boardButlerError(downloaded, t('Could not save the enhanced video.', '无法保存超清视频。', '고화질 비디오를 저장하지 못했습니다.'));
  }
  return boardButlerResultFiles(downloaded);
}

async function runBoardButlerVideoTool(action, file, item, options) {
  if (getBoardButlerTask(file.id, action)?.status === 'running') return;
  const api = boardButlerApi();
  const hook = BOARD_BUTLER_VIDEO_TOOL_HOOKS[action];
  const invoke = boardButlerVideoToolInvoker(action);
  if (!api || !hook || !invoke) {
    showToast(t(
      'This Butler tool is ready for the desktop service update.',
      '此 Butler 工具正在等待桌面服务接入。',
      '이 Butler 도구는 데스크톱 서비스 연결을 기다리고 있습니다.'
    ));
    return;
  }
  const state = { status: 'running', phase: 'creating' };
  setBoardButlerTask(file.id, action, state);
  try {
    const initialResult = await invoke(file.id, { ...options, modelId: hook.toolId });
    if (!initialResult || !initialResult.ok) {
      throw boardButlerError(initialResult, t('Video enhancement failed.', '视频超清失败。', '비디오 고화질 처리에 실패했습니다.'));
    }
    const resultFiles = await resolveBoardButlerVideoToolResult(api, hook, initialResult, state, file.id);
    if (!resultFiles.length) {
      throw new Error(t('The result file is missing.', '结果文件缺失。', '결과 파일이 없습니다.'));
    }
    state.phase = 'saving';
    syncBoardButlerTaskUi(file.id);
    await placeBoardButlerResults(resultFiles, item, action);
    state.status = 'success';
    syncBoardButlerTaskUi(file.id);
    showToast(t('Enhanced video added to the canvas.', '超清视频已加入画布。', '고화질 비디오를 캔버스에 추가했습니다.'));
    clearCompletedBoardButlerTask(file.id, action, state);
  } catch (error) {
    state.status = 'error';
    state.message = error && error.message;
    syncBoardButlerTaskUi(file.id);
    showToast(state.message || t('Video enhancement failed.', '视频超清失败。', '비디오 고화질 처리에 실패했습니다.'));
  }
}

function launchBoardButlerVideoTool(action, file, item, options) {
  if (!boardButlerVideoToolInvoker(action)) {
    showToast(t(
      'This Butler tool is ready for the desktop service update.',
      '此 Butler 工具正在等待桌面服务接入。',
      '이 Butler 도구는 데스크톱 서비스 연결을 기다리고 있습니다.'
    ));
    return false;
  }
  void runBoardButlerVideoTool(action, file, item, options);
  return true;
}

function createBoardButlerConfigPanel(anchor, icon, title, modelName) {
  closeBoardButlerPanel();
  const panel = document.createElement('section');
  panel.className = 'board-butler-config-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-label', title);
  panel.innerHTML = `
    <header class="board-butler-config-header">
      <span class="board-butler-config-icon" aria-hidden="true">${icon}</span>
      <span class="board-butler-config-heading">
        <strong></strong>
        <small></small>
      </span>
      <button type="button" class="board-butler-config-close" aria-label="${t('Close', '关闭', '닫기')}">
        ${BOARD_BUTLER_ICONS.close}
      </button>
    </header>
    <div class="board-butler-config-body"></div>
  `;
  panel.querySelector('.board-butler-config-heading strong').textContent = title;
  panel.querySelector('.board-butler-config-heading small').textContent = modelName;
  panel.querySelector('.board-butler-config-close').addEventListener('click', closeBoardButlerPanel);
  document.body.appendChild(panel);
  boardButlerPanel = panel;
  positionBoardButlerPanel(panel, anchor);
  closeBoardButlerMenu();
  requestAnimationFrame(() => panel.classList.add('is-visible'));
  window.setTimeout(() => {
    if (boardButlerPanel !== panel || !panel.isConnected) return;
    boardButlerPanelClickCloser = (event) => {
      if (panel.contains(event.target) || (anchor && anchor.contains(event.target))) return;
      closeBoardButlerPanel();
    };
    document.addEventListener('pointerdown', boardButlerPanelClickCloser, true);
  }, 0);
  boardButlerPanelKeyHandler = (event) => {
    if (event.key === 'Escape') closeBoardButlerPanel();
  };
  document.addEventListener('keydown', boardButlerPanelKeyHandler);
  return { panel, body: panel.querySelector('.board-butler-config-body') };
}

function appendBoardButlerFormActions(form, submitLabel) {
  const actions = document.createElement('div');
  actions.className = 'board-butler-config-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'board-butler-config-button is-secondary';
  cancel.textContent = t('Cancel', '取消', '취소');
  cancel.addEventListener('click', closeBoardButlerPanel);
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'board-butler-config-button is-primary';
  submit.textContent = submitLabel;
  actions.append(cancel, submit);
  form.appendChild(actions);
  return submit;
}

function openBoardButlerImageEditPanel(anchor, file, item) {
  const { body } = createBoardButlerConfigPanel(
    anchor,
    BOARD_BUTLER_ICONS.imageEdit,
    t('Edit image', '图片修改', '이미지 편집'),
    'Qwen-Image-Edit-Plus'
  );
  const form = document.createElement('form');
  form.className = 'board-butler-config-form';
  form.innerHTML = `
    <label class="board-butler-config-field">
      <span>${BOARD_BUTLER_ICONS.prompt}<strong>${t('Prompt', '提示词', '프롬프트')}</strong></span>
      <textarea rows="4" maxlength="1200" required placeholder="${t(
        'Describe the change you want',
        '描述想要修改的内容',
        '원하는 변경 사항을 설명하세요'
      )}"></textarea>
    </label>
  `;
  appendBoardButlerFormActions(form, t('Edit', '开始修改', '편집'));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const prompt = form.querySelector('textarea').value.trim();
    if (!prompt) return;
    if (launchBoardButlerImageTool('imageEdit', file, item, { prompt })) closeBoardButlerPanel();
  });
  body.appendChild(form);
  form.querySelector('textarea').focus();
}

function openBoardButlerLayerPanel(anchor, file, item) {
  const { body } = createBoardButlerConfigPanel(
    anchor,
    BOARD_BUTLER_ICONS.imageLayer,
    t('Separate layers', '图片分层', '이미지 레이어 분리'),
    'Qwen-Image-Layered'
  );
  const form = document.createElement('form');
  form.className = 'board-butler-config-form';
  form.innerHTML = `
    <label class="board-butler-config-field">
      <span>${BOARD_BUTLER_ICONS.layers}<strong>${t('Layers', '图层数量', '레이어 수')}</strong><output>4</output></span>
      <input type="range" min="2" max="8" step="1" value="4" aria-label="${t('Layers', '图层数量', '레이어 수')}">
      <small>2&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;8</small>
    </label>
    <label class="board-butler-config-field">
      <span>${BOARD_BUTLER_ICONS.prompt}<strong>${t('Prompt', '提示词', '프롬프트')}</strong><em>${t('Optional', '选填', '선택')}</em></span>
      <textarea rows="3" maxlength="800" placeholder="${t(
        'Guide how the image should be separated',
        '描述希望如何拆分图层',
        '레이어 분리 방식을 설명하세요'
      )}"></textarea>
    </label>
  `;
  const range = form.querySelector('input[type="range"]');
  const output = form.querySelector('output');
  range.addEventListener('input', () => { output.textContent = range.value; });
  appendBoardButlerFormActions(form, t('Separate', '开始分层', '분리'));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const options = {
      numLayers: Math.max(2, Math.min(8, Number(range.value) || 4)),
      prompt: form.querySelector('textarea').value.trim()
    };
    if (launchBoardButlerImageTool('imageLayer', file, item, options)) closeBoardButlerPanel();
  });
  body.appendChild(form);
}

function boardButlerSegmentedField(icon, title, name, options, selectedValue) {
  const field = document.createElement('fieldset');
  field.className = 'board-butler-config-field board-butler-segmented-field';
  const legend = document.createElement('legend');
  legend.innerHTML = `${icon}<strong>${title}</strong>`;
  const control = document.createElement('div');
  control.className = 'board-butler-segmented';
  options.forEach((option) => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = String(option.value);
    input.checked = String(option.value) === String(selectedValue);
    const span = document.createElement('span');
    span.textContent = option.label;
    label.append(input, span);
    control.appendChild(label);
  });
  field.append(legend, control);
  return field;
}

function openBoardButlerUpscalePanel(anchor, file, item) {
  const { body } = createBoardButlerConfigPanel(
    anchor,
    BOARD_BUTLER_ICONS.imageUpscale,
    t('Upscale image', '图片放大', '이미지 확대'),
    'Super-Upscale-V2'
  );
  const form = document.createElement('form');
  form.className = 'board-butler-config-form';
  form.appendChild(boardButlerSegmentedField(
    BOARD_BUTLER_ICONS.imageUpscale,
    t('Scale', '放大倍率', '확대 배율'),
    'butler-upscale-scale',
    [{ value: 2, label: '2x' }, { value: 3, label: '3x' }, { value: 4, label: '4x' }],
    3
  ));
  form.appendChild(boardButlerSegmentedField(
    BOARD_BUTLER_ICONS.detail,
    t('Detail', '细节强度', '디테일'),
    'butler-upscale-detail',
    [
      { value: 1, label: t('Soft', '柔和', '부드럽게') },
      { value: 2, label: t('Balanced', '均衡', '균형') },
      { value: 3, label: t('Sharp', '清晰', '선명하게') }
    ],
    2
  ));
  appendBoardButlerFormActions(form, t('Upscale', '开始放大', '확대'));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const options = {
      scale: Number(new FormData(form).get('butler-upscale-scale')) || 3,
      detail: Number(new FormData(form).get('butler-upscale-detail')) || 2
    };
    if (launchBoardButlerImageTool('imageUpscale', file, item, options)) closeBoardButlerPanel();
  });
  body.appendChild(form);
}

function openBoardButlerVideoUpscalePanel(anchor, file, item) {
  if (Number(file && file.sizeBytes) > BOARD_BUTLER_MAX_VIDEO_BYTES) {
    showToast(t(
      'Video enhancement currently supports files up to 48 MB.',
      '视频超清目前支持最大 48 MB 的文件。',
      '비디오 고화질 처리는 현재 최대 48MB 파일을 지원합니다.'
    ));
    return;
  }
  const { body } = createBoardButlerConfigPanel(
    anchor,
    BOARD_BUTLER_ICONS.videoUpscale,
    t('Enhance video', '视频超清', '비디오 고화질'),
    'Topaz Video AI'
  );
  const form = document.createElement('form');
  form.className = 'board-butler-config-form';
  const portrait = Number(file.sourceHeight) > Number(file.sourceWidth);
  const dimensions = portrait
    ? ['1080x1920', '1440x2560', '2160x3840']
    : ['1920x1080', '2560x1440', '3840x2160'];
  form.appendChild(boardButlerSegmentedField(
    BOARD_BUTLER_ICONS.videoUpscale,
    t('Resolution', '输出分辨率', '출력 해상도'),
    'butler-video-resolution',
    [
      { value: dimensions[0], label: '1080p' },
      { value: dimensions[1], label: '2K' },
      { value: dimensions[2], label: '4K' }
    ],
    dimensions[2]
  ));
  form.appendChild(boardButlerSegmentedField(
    BOARD_BUTLER_ICONS.frameRate,
    t('Frame rate', '输出帧率', '출력 프레임'),
    'butler-video-frame-rate',
    [{ value: 30, label: '30 FPS' }, { value: 60, label: '60 FPS' }],
    30
  ));
  const cost = document.createElement('div');
  cost.className = 'board-butler-cost-estimate';
  const updateCost = () => {
    const formData = new FormData(form);
    const resolution = String(formData.get('butler-video-resolution') || dimensions[2]);
    const frameRate = Number(formData.get('butler-video-frame-rate')) || 30;
    const duration = Math.max(1, Number(file.sourceDuration) || 5);
    const pixelFactor = resolution === dimensions[0] ? 0.25 : (resolution === dimensions[1] ? 0.45 : 1);
    const providerEstimate = Math.max(1, Math.ceil(duration * 0.75 * pixelFactor * frameRate / 24));
    const credits = providerEstimate * 3;
    cost.textContent = t(
      `About ${credits} pts · final charge follows the provider quote`,
      `约 ${credits} 积分 · 最终按服务商实际费用结算`,
      `약 ${credits}포인트 · 최종 요금은 제공업체 견적 기준`
    );
  };
  form.appendChild(cost);
  form.addEventListener('change', updateCost);
  updateCost();
  appendBoardButlerFormActions(form, t('Enhance', '开始超清', '고화질 처리'));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const resolution = String(formData.get('butler-video-resolution') || dimensions[2]);
    const [width, height] = resolution.split('x').map((value) => Number(value));
    const options = {
      filters: [{ model: 'prob-4' }],
      output: {
        resolution: { width, height },
        frameRate: Number(formData.get('butler-video-frame-rate')) || 30,
        audioCodec: 'AAC',
        audioTransfer: 'Copy',
        videoEncoder: 'H264',
        videoProfile: 'Main',
        dynamicCompressionLevel: 'High',
        container: 'mp4'
      }
    };
    if (launchBoardButlerVideoTool('videoUpscale', file, item, options)) closeBoardButlerPanel();
  });
  body.appendChild(form);
}

function openBoardButlerErasePanel(file, item) {
  closeBoardButlerPanel();
  closeBoardButlerMenu();
  const overlay = document.createElement('div');
  overlay.className = 'board-butler-mask-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', t('Erase objects', '物体消除', '개체 지우기'));
  overlay.innerHTML = `
    <section class="board-butler-mask-dialog">
      <header class="board-butler-mask-header">
        <span class="board-butler-config-icon" aria-hidden="true">${BOARD_BUTLER_ICONS.eraseObject}</span>
        <span class="board-butler-config-heading">
          <strong>${t('Erase objects', '物体消除', '개체 지우기')}</strong>
          <small>Erase</small>
        </span>
        <button type="button" class="board-butler-config-close" data-mask-close aria-label="${t('Close', '关闭', '닫기')}">
          ${BOARD_BUTLER_ICONS.close}
        </button>
      </header>
      <div class="board-butler-mask-workspace">
        <div class="board-butler-mask-stage" data-state="loading">
          <img alt="" draggable="false">
          <canvas></canvas>
          <span class="board-butler-mask-status">${t('Preparing image...', '正在准备图片...', '이미지 준비 중...')}</span>
        </div>
      </div>
      <footer class="board-butler-mask-toolbar">
        <div class="board-butler-mask-modes" role="group" aria-label="${t('Mask mode', '遮罩模式', '마스크 모드')}">
          <button type="button" class="is-active" data-mask-mode="paint">${BOARD_BUTLER_ICONS.brush}<span>${t('Paint', '涂抹', '칠하기')}</span></button>
          <button type="button" data-mask-mode="erase">${BOARD_BUTLER_ICONS.eraseObject}<span>${t('Erase', '擦除', '지우기')}</span></button>
        </div>
        <label class="board-butler-mask-size">
          <span>${t('Brush', '笔刷', '브러시')}</span>
          <input type="range" min="6" max="120" step="2" value="36" aria-label="${t('Brush size', '笔刷大小', '브러시 크기')}">
          <output>36</output>
        </label>
        <button type="button" class="board-butler-mask-clear">${BOARD_BUTLER_ICONS.clear}<span>${t('Clear', '清空', '지우기')}</span></button>
        <div class="board-butler-mask-actions">
          <button type="button" class="board-butler-config-button is-secondary" data-mask-close>${t('Cancel', '取消', '취소')}</button>
          <button type="button" class="board-butler-config-button is-primary" data-mask-submit disabled>${t('Erase object', '开始消除', '개체 지우기')}</button>
        </div>
      </footer>
    </section>
  `;
  document.body.appendChild(overlay);
  boardButlerPanel = overlay;
  const stage = overlay.querySelector('.board-butler-mask-stage');
  const image = stage.querySelector('img');
  const displayCanvas = stage.querySelector('canvas');
  const displayContext = displayCanvas.getContext('2d');
  const maskCanvas = document.createElement('canvas');
  const maskContext = maskCanvas.getContext('2d');
  const submit = overlay.querySelector('[data-mask-submit]');
  const sizeInput = overlay.querySelector('.board-butler-mask-size input');
  const sizeOutput = overlay.querySelector('.board-butler-mask-size output');
  let mode = 'paint';
  let drawing = false;
  let dirty = false;
  let lastPoint = null;
  let ready = false;

  const pointFromEvent = (event) => {
    const rect = displayCanvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * displayCanvas.width / Math.max(1, rect.width),
      y: (event.clientY - rect.top) * displayCanvas.height / Math.max(1, rect.height)
    };
  };
  const drawMaskSegment = (from, to) => {
    const lineWidth = Math.max(2, Number(sizeInput.value) || 36) * displayCanvas.width / 1024;
    [
      { context: displayContext, color: 'rgba(217, 245, 109, .64)' },
      { context: maskContext, color: '#ffffff' }
    ].forEach(({ context, color }) => {
      context.save();
      context.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over';
      context.strokeStyle = color;
      context.fillStyle = color;
      context.lineWidth = lineWidth;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.stroke();
      if (from.x === to.x && from.y === to.y) {
        context.beginPath();
        context.arc(to.x, to.y, lineWidth / 2, 0, Math.PI * 2);
        context.fill();
      }
      context.restore();
    });
    dirty = true;
    submit.disabled = false;
  };
  const finishStroke = (event) => {
    if (!drawing) return;
    drawing = false;
    lastPoint = null;
    if (event && displayCanvas.hasPointerCapture(event.pointerId)) {
      displayCanvas.releasePointerCapture(event.pointerId);
    }
  };
  displayCanvas.addEventListener('pointerdown', (event) => {
    if (!ready || event.button !== 0) return;
    event.preventDefault();
    drawing = true;
    lastPoint = pointFromEvent(event);
    displayCanvas.setPointerCapture(event.pointerId);
    drawMaskSegment(lastPoint, lastPoint);
  });
  displayCanvas.addEventListener('pointermove', (event) => {
    if (!drawing || !lastPoint) return;
    event.preventDefault();
    const point = pointFromEvent(event);
    drawMaskSegment(lastPoint, point);
    lastPoint = point;
  });
  displayCanvas.addEventListener('pointerup', finishStroke);
  displayCanvas.addEventListener('pointercancel', finishStroke);
  overlay.querySelectorAll('[data-mask-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      mode = button.dataset.maskMode === 'erase' ? 'erase' : 'paint';
      overlay.querySelectorAll('[data-mask-mode]').forEach((entry) => {
        entry.classList.toggle('is-active', entry === button);
      });
    });
  });
  sizeInput.addEventListener('input', () => { sizeOutput.textContent = sizeInput.value; });
  overlay.querySelector('.board-butler-mask-clear').addEventListener('click', () => {
    displayContext.clearRect(0, 0, displayCanvas.width, displayCanvas.height);
    maskContext.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    dirty = false;
    submit.disabled = true;
  });
  overlay.querySelectorAll('[data-mask-close]').forEach((button) => {
    button.addEventListener('click', closeBoardButlerPanel);
  });
  submit.addEventListener('click', () => {
    if (!ready || !dirty) return;
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = maskCanvas.width;
    exportCanvas.height = maskCanvas.height;
    const context = exportCanvas.getContext('2d');
    context.fillStyle = '#000000';
    context.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    context.drawImage(maskCanvas, 0, 0);
    const options = {
      maskDataUrl: exportCanvas.toDataURL('image/png'),
      maskWidth: exportCanvas.width,
      maskHeight: exportCanvas.height,
      sourceWidth: Number(file.sourceWidth) || image.naturalWidth,
      sourceHeight: Number(file.sourceHeight) || image.naturalHeight
    };
    if (launchBoardButlerImageTool('eraseObject', file, item, options)) closeBoardButlerPanel();
  });
  image.addEventListener('load', () => {
    const naturalWidth = Math.max(1, image.naturalWidth || Number(file.sourceWidth) || 1);
    const naturalHeight = Math.max(1, image.naturalHeight || Number(file.sourceHeight) || 1);
    const scale = Math.min(1, 2048 / Math.max(naturalWidth, naturalHeight));
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));
    displayCanvas.width = width;
    displayCanvas.height = height;
    maskCanvas.width = width;
    maskCanvas.height = height;
    stage.style.aspectRatio = `${width} / ${height}`;
    stage.dataset.state = 'ready';
    ready = true;
  });
  const imageSources = [...new Set([file.url, file.previewUrl, file.thumbUrl].filter(Boolean))];
  let imageSourceIndex = 0;
  image.addEventListener('error', () => {
    imageSourceIndex += 1;
    if (imageSources[imageSourceIndex]) {
      image.src = imageSources[imageSourceIndex];
      return;
    }
    stage.dataset.state = 'error';
    stage.querySelector('.board-butler-mask-status').textContent = t(
      'Could not prepare this image.',
      '无法准备此图片。',
      '이 이미지를 준비하지 못했습니다.'
    );
  });
  if (imageSources.length) image.src = imageSources[0];
  else image.dispatchEvent(new Event('error'));
  overlay.addEventListener('pointerdown', (event) => {
    if (event.target === overlay) closeBoardButlerPanel();
  });
  overlay._cleanup = () => finishStroke();
  boardButlerPanelKeyHandler = (event) => {
    if (event.key === 'Escape') closeBoardButlerPanel();
  };
  document.addEventListener('keydown', boardButlerPanelKeyHandler);
  requestAnimationFrame(() => overlay.classList.add('is-visible'));
}

function clearCompletedBoardButlerTask(fileId, action, state) {
  window.setTimeout(() => {
    if (getBoardButlerTask(fileId, action) === state) setBoardButlerTask(fileId, action, null);
  }, 1800);
}

async function runBoardButlerRemoveBackground(file, item) {
  const action = 'removeBackground';
  if (getBoardButlerTask(file.id, action)?.status === 'running') return;
  const api = boardButlerApi();
  if (!api || typeof api.removeBackground !== 'function') {
    showToast(t('Butler is not available yet.', 'Butler 暂不可用。', 'Butler를 아직 사용할 수 없습니다.'));
    return;
  }
  const state = { status: 'running', phase: 'processing' };
  setBoardButlerTask(file.id, action, state);
  try {
    const result = await api.removeBackground(file.id);
    if (!result || !result.ok || !result.file) {
      throw boardButlerError(result, t('Could not remove the background.', '去除背景失败。', '배경을 제거하지 못했습니다.'));
    }
    state.phase = 'saving';
    syncBoardButlerTaskUi(file.id);
    await placeBoardButlerResult(result.file, item, action);
    state.status = 'success';
    syncBoardButlerTaskUi(file.id);
    showToast(t('Background removed and added to the canvas.', '已去除背景并加入画布。', '배경을 제거해 캔버스에 추가했습니다.'));
    clearCompletedBoardButlerTask(file.id, action, state);
  } catch (error) {
    state.status = 'error';
    state.message = error && error.message;
    syncBoardButlerTaskUi(file.id);
    showToast(state.message || t('Could not remove the background.', '去除背景失败。', '배경을 제거하지 못했습니다.'));
  }
}

async function runBoardButlerGenerate3d(file, item, providerId) {
  const safeProviderId = providerId === 'hyper3d' ? 'hyper3d' : 'hunyuan3d';
  const action = `generate3d:${safeProviderId}`;
  if (getBoardButlerTask(file.id, action)?.status === 'running') return;
  const api = boardButlerApi();
  if (!api || typeof api.create3d !== 'function' || typeof api.get3dStatus !== 'function' ||
      typeof api.download3d !== 'function') {
    showToast(t('3D generation is not available yet.', '生成 3D 暂不可用。', '3D 생성을 아직 사용할 수 없습니다.'));
    return;
  }
  const state = { status: 'running', phase: 'creating' };
  setBoardButlerTask(file.id, action, state);
  try {
    const created = await api.create3d(file.id, safeProviderId);
    if (!created || !created.ok || !created.taskToken) {
      throw boardButlerError(created, t('Could not start 3D generation.', '无法发起 3D 生成。', '3D 생성을 시작하지 못했습니다.'));
    }
    const taskToken = created.taskToken;
    let status = String(created.status || 'queued').toLowerCase();
    let retryAfterMs = boardButlerPollDelay(created.retryAfterMs);
    let lastResult = created;
    for (let attempt = 0; status !== 'succeeded' && attempt < BOARD_BUTLER_MAX_POLLS; attempt += 1) {
      if (status === 'failed') {
        throw boardButlerError(lastResult, t('3D generation failed.', '3D 生成失败。', '3D 생성에 실패했습니다.'));
      }
      state.phase = status === 'queued' ? 'queued' : 'processing';
      syncBoardButlerTaskUi(file.id);
      await waitForBoardButlerPoll(retryAfterMs);
      lastResult = await api.get3dStatus(taskToken);
      if (!lastResult || !lastResult.ok) {
        throw boardButlerError(lastResult, t('Could not check 3D generation.', '无法查询 3D 生成进度。', '3D 생성 상태를 확인하지 못했습니다.'));
      }
      status = String(lastResult.status || 'processing').toLowerCase();
      retryAfterMs = boardButlerPollDelay(lastResult.retryAfterMs);
    }
    if (status !== 'succeeded') {
      throw new Error(t('3D generation timed out. Try again later.', '3D 生成等待超时，请稍后重试。', '3D 생성 대기 시간이 초과되었습니다. 나중에 다시 시도하세요.'));
    }
    state.phase = 'downloading';
    syncBoardButlerTaskUi(file.id);
    const downloaded = await api.download3d(taskToken);
    if (!downloaded || !downloaded.ok || !downloaded.file) {
      throw boardButlerError(downloaded, t('Could not save the 3D model.', '无法保存 3D 模型。', '3D 모델을 저장하지 못했습니다.'));
    }
    await placeBoardButlerResult(downloaded.file, item, action);
    state.status = 'success';
    syncBoardButlerTaskUi(file.id);
    showToast(t('3D model added to the canvas.', '3D 模型已加入画布。', '3D 모델을 캔버스에 추가했습니다.'));
    clearCompletedBoardButlerTask(file.id, action, state);
  } catch (error) {
    state.status = 'error';
    state.message = error && error.message;
    syncBoardButlerTaskUi(file.id);
    showToast(state.message || t('3D generation failed.', '3D 生成失败。', '3D 생성에 실패했습니다.'));
  }
}

function createBoardButlerMenuButton(file, action, icon, label, onClick, options = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `board-butler-menu-item${options.hasSubmenu ? ' has-submenu' : ''}`;
  button.dataset.butlerAction = action;
  button.dataset.fileId = String(file.id);
  button.title = label;
  button.setAttribute('aria-label', label);
  if (options.popup) {
    button.setAttribute('aria-haspopup', options.popup);
    button.setAttribute('aria-expanded', 'false');
  }
  button.innerHTML = `
    <span class="board-butler-menu-icon" aria-hidden="true">${icon}</span>
    <span class="board-butler-menu-label">${label}</span>
    <small class="board-butler-menu-status" hidden></small>
    ${options.hasSubmenu ? BOARD_BUTLER_ICONS.caret : ''}
  `;
  if (typeof onClick === 'function') {
    button.addEventListener('click', () => {
      if (!button.disabled) onClick(button);
    });
  }
  return button;
}

function openBoardButlerMenu(trigger, file, item) {
  if (boardButlerMenu && boardButlerMenu._trigger === trigger) {
    closeBoardButlerMenu();
    return;
  }
  closeBoardButlerPanel();
  closeBoardButlerMenu();
  const menu = document.createElement('div');
  menu.className = 'board-butler-menu';
  menu.setAttribute('role', 'toolbar');
  menu.setAttribute('aria-label', t('Butler tools', 'Butler 工具', 'Butler 도구'));
  menu._trigger = trigger;
  const isVideo = typeof isVideoExt === 'function' && isVideoExt(file.ext);
  if (isVideo && BOARD_BUTLER_VIDEO_EXTENSIONS.has(String(file.ext || '').toLowerCase())) {
    menu.appendChild(createBoardButlerMenuButton(
      file,
      'videoUpscale',
      BOARD_BUTLER_ICONS.videoUpscale,
      t('Enhance video', '视频超清', '비디오 고화질'),
      (button) => openBoardButlerVideoUpscalePanel(button, file, item),
      { popup: 'dialog' }
    ));
  } else {
    menu.appendChild(createBoardButlerMenuButton(
    file,
    'removeBackground',
    BOARD_BUTLER_ICONS.removeBackground,
    t('Remove background', '去除背景', '배경 제거'),
    () => void runBoardButlerRemoveBackground(file, item)
  ));
  menu.appendChild(createBoardButlerMenuButton(
    file,
    'imageEdit',
    BOARD_BUTLER_ICONS.imageEdit,
    t('Edit image', '图片修改', '이미지 편집'),
    (button) => openBoardButlerImageEditPanel(button, file, item),
    { popup: 'dialog' }
  ));
  menu.appendChild(createBoardButlerMenuButton(
    file,
    'imageLayer',
    BOARD_BUTLER_ICONS.imageLayer,
    t('Separate layers', '图片分层', '이미지 레이어 분리'),
    (button) => openBoardButlerLayerPanel(button, file, item),
    { popup: 'dialog' }
  ));
  menu.appendChild(createBoardButlerMenuButton(
    file,
    'imageUpscale',
    BOARD_BUTLER_ICONS.imageUpscale,
    t('Upscale image', '图片放大', '이미지 확대'),
    (button) => openBoardButlerUpscalePanel(button, file, item),
    { popup: 'dialog' }
  ));
  menu.appendChild(createBoardButlerMenuButton(
    file,
    'eraseObject',
    BOARD_BUTLER_ICONS.eraseObject,
    t('Erase objects', '物体消除', '개체 지우기'),
    () => openBoardButlerErasePanel(file, item),
    { popup: 'dialog' }
  ));

  const modelGroup = document.createElement('div');
  modelGroup.className = 'board-butler-model-group board-butler-submenu-group';
  const modelTrigger = createBoardButlerMenuButton(
    file,
    'generate3d',
    BOARD_BUTLER_ICONS.generate3d,
    t('Generate 3D', '生成3D', '3D 생성'),
    null,
    { popup: 'menu', hasSubmenu: true }
  );
  const modelMenu = document.createElement('div');
  modelMenu.className = 'board-butler-model-menu board-butler-submenu';
  modelMenu.setAttribute('role', 'menu');
  modelMenu.innerHTML = `
    <button type="button" class="board-butler-model-option board-butler-submenu-option board-butler-menu-item" data-butler-action="generate3d:hunyuan3d" role="menuitem">
      <span class="board-butler-submenu-icon" aria-hidden="true">${BOARD_BUTLER_ICONS.hunyuan3d}</span>
      <span class="board-butler-submenu-label">${t('Hunyuan 3D', '混元 3D', '혼위안 3D')}</span>
      <small class="board-butler-menu-status" hidden></small>
    </button>
    <button type="button" class="board-butler-model-option board-butler-submenu-option board-butler-menu-item" data-butler-action="generate3d:hyper3d" role="menuitem">
      <span class="board-butler-submenu-icon" aria-hidden="true">${BOARD_BUTLER_ICONS.hyper3d}</span>
      <span class="board-butler-submenu-label">Hyper3D</span>
      <small class="board-butler-menu-status" hidden></small>
    </button>
  `;
  modelMenu.querySelectorAll('.board-butler-model-option').forEach((button) => {
    button.dataset.fileId = String(file.id);
  });
  const setModelMenuOpen = (open) => {
    modelGroup.classList.toggle('is-open', open);
    modelTrigger.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  modelTrigger.addEventListener('click', () => {
    if (modelTrigger.disabled) return;
    const pinned = modelGroup.dataset.pinned !== 'true';
    modelGroup.dataset.pinned = pinned ? 'true' : 'false';
    setModelMenuOpen(pinned);
  });
  modelGroup.addEventListener('mouseenter', () => setModelMenuOpen(true));
  modelGroup.addEventListener('mouseleave', () => {
    if (modelGroup.dataset.pinned !== 'true') setModelMenuOpen(false);
  });
  modelMenu.querySelector('[data-butler-action="generate3d:hunyuan3d"]').addEventListener('click', (event) => {
    if (!event.currentTarget.disabled) void runBoardButlerGenerate3d(file, item, 'hunyuan3d');
  });
  modelMenu.querySelector('[data-butler-action="generate3d:hyper3d"]').addEventListener('click', (event) => {
    if (!event.currentTarget.disabled) void runBoardButlerGenerate3d(file, item, 'hyper3d');
  });
    modelGroup.append(modelTrigger, modelMenu);
    menu.appendChild(modelGroup);
  }
  document.body.appendChild(menu);
  boardButlerMenu = menu;
  trigger.classList.add('is-open');
  trigger.setAttribute('aria-expanded', 'true');
  syncBoardButlerTaskUi(file.id);
  positionBoardButlerMenu(menu, trigger);
  requestAnimationFrame(() => menu.classList.add('is-visible'));
  window.setTimeout(() => {
    if (boardButlerMenu !== menu || !menu.isConnected) return;
    boardButlerMenuClickCloser = (event) => {
      if (menu.contains(event.target) || trigger.contains(event.target)) return;
      closeBoardButlerMenu();
    };
    document.addEventListener('pointerdown', boardButlerMenuClickCloser, true);
  }, 0);
  boardButlerMenuKeyHandler = (event) => {
    if (event.key === 'Escape') {
      closeBoardButlerMenu();
      trigger.focus();
    }
  };
  document.addEventListener('keydown', boardButlerMenuKeyHandler);
}

function appendBoardButlerTrigger(toolbar, file, item) {
  const butler = document.createElement('button');
  butler.type = 'button';
  butler.className = 'board-butler-trigger';
  butler.dataset.fileId = String(file.id);
  butler.title = t('Open Butler tools', '打开 Butler 工具', 'Butler 도구 열기');
  butler.setAttribute('aria-label', butler.title);
  butler.setAttribute('aria-haspopup', 'menu');
  butler.setAttribute('aria-expanded', 'false');
  butler.innerHTML = `${BOARD_BUTLER_ICONS.trigger}<span>Butler</span>${BOARD_BUTLER_ICONS.caret}`;
  ['pointerdown', 'mousedown', 'click'].forEach((eventName) => {
    butler.addEventListener(eventName, (event) => {
      event.stopPropagation();
      if (eventName !== 'click') event.preventDefault();
    });
  });
  butler.addEventListener('click', () => openBoardButlerMenu(butler, file, item));
  toolbar.appendChild(butler);
  syncBoardButlerTaskUi(file.id);
  return butler;
}

function appendBoardImageToolbar(element, file, item) {
  const toolbar = document.createElement('div');
  toolbar.className = 'board-image-toolbar';
  toolbar.dataset.boardInteractive = 'true';
  toolbar.draggable = false;
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', t('Image actions', '图片操作'));
  ['pointerdown', 'mousedown', 'click'].forEach((eventName) => {
    toolbar.addEventListener(eventName, (event) => {
      event.stopPropagation();
      if (eventName !== 'click') event.preventDefault();
    });
  });

  const actions = [
    {
      key: 'details',
      title: t('Image details', '图片详情'),
      run: () => showGeneratedMediaDetails(file, element)
    },
    {
      key: 'fullscreen',
      title: t('View large image', '查看大图'),
      run: () => {
        if (typeof openFileFullscreenPreview === 'function') {
          openFileFullscreenPreview(file);
          return;
        }
        selectFileForPreview(file.id);
      }
    }
  ];

  actions.forEach((action) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `board-image-toolbar-button is-${action.key}`;
    button.dataset.boardInteractive = 'true';
    button.draggable = false;
    button.title = action.title;
    button.setAttribute('aria-label', action.title);
    button.innerHTML = BOARD_IMAGE_TOOL_ICONS[action.key];
    ['pointerdown', 'mousedown', 'click'].forEach((eventName) => {
      button.addEventListener(eventName, (event) => {
        event.stopPropagation();
        if (eventName !== 'click') event.preventDefault();
      });
    });
    button.addEventListener('click', () => action.run(button));
    toolbar.appendChild(button);
  });

  appendBoardButlerTrigger(toolbar, file, item);
  element.appendChild(toolbar);
  return toolbar;
}

function appendBoardVideoButlerToolbar(element, file, item) {
  if (!BOARD_BUTLER_VIDEO_EXTENSIONS.has(String(file && file.ext || '').toLowerCase())) return null;
  const toolbar = document.createElement('div');
  toolbar.className = 'board-image-toolbar board-video-butler-toolbar';
  toolbar.dataset.boardInteractive = 'true';
  toolbar.draggable = false;
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', t('Video actions', '视频操作', '비디오 작업'));
  ['pointerdown', 'mousedown', 'click'].forEach((eventName) => {
    toolbar.addEventListener(eventName, (event) => {
      event.stopPropagation();
      if (eventName !== 'click') event.preventDefault();
    });
  });
  appendBoardButlerTrigger(toolbar, file, item);
  element.appendChild(toolbar);
  return toolbar;
}

function appendGeneratedMediaDetailsControl(element, file) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'generated-media-detail-trigger';
  button.title = t('Generation details', '生成详情');
  button.setAttribute('aria-label', button.title);
  button.innerHTML = `
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="9"></circle>
      <path d="M12 11v6"></path>
      <path d="M12 7h.01"></path>
    </svg>
  `;
  ['pointerdown', 'mousedown', 'click'].forEach((eventName) => {
    button.addEventListener(eventName, (event) => event.stopPropagation());
  });
  button.addEventListener('click', () => showGeneratedMediaDetails(file, element));
  element.appendChild(button);
  return button;
}

function closeGeneratedMediaDetails(immediate = false) {
  document.querySelectorAll('.generated-media-detail-overlay').forEach((overlay) => {
    overlay.removeAttribute('id');
    overlay.classList.remove('is-visible');
    overlay.style.pointerEvents = 'none';
    if (immediate === true) {
      overlay.remove();
    } else if (!overlay.dataset.isClosing) {
      overlay.dataset.isClosing = 'true';
      window.setTimeout(() => overlay.remove(), 180);
    }
  });
  if (generatedMediaDetailKeyHandler) {
    document.removeEventListener('keydown', generatedMediaDetailKeyHandler);
    generatedMediaDetailKeyHandler = null;
  }
}

function formatBoardAspectRatio(file, generation) {
  const recorded = String(generation && generation.aspectRatio || '').trim();
  if (recorded && recorded !== 'auto') return recorded;
  const width = Number(file && file.sourceWidth);
  const height = Number(file && file.sourceHeight);
  if (!(width > 0 && height > 0)) return '';
  const ratio = width / height;
  const commonRatios = [
    ['1:1', 1], ['5:4', 5 / 4], ['4:3', 4 / 3], ['3:2', 3 / 2],
    ['16:10', 16 / 10], ['16:9', 16 / 9], ['21:9', 21 / 9],
    ['4:5', 4 / 5], ['3:4', 3 / 4], ['2:3', 2 / 3], ['9:16', 9 / 16]
  ];
  const nearest = commonRatios.reduce((best, entry) => (
    Math.abs(entry[1] - ratio) < Math.abs(best[1] - ratio) ? entry : best
  ));
  if (Math.abs(nearest[1] - ratio) / ratio < 0.015) return nearest[0];
  return ratio >= 1 ? `${ratio.toFixed(2)}:1` : `1:${(1 / ratio).toFixed(2)}`;
}

function boardGenerationModelLabel(generation) {
  const model = String(generation && generation.modelName || '').trim();
  const provider = String(
    generation && (generation.providerName || generation.providerId) || ''
  ).trim();
  const safeProvider = /quick\s*router/i.test(provider) ? '' : provider;
  if (model && safeProvider && safeProvider !== model) return `${model} · ${safeProvider}`;
  return model || safeProvider;
}

function showGeneratedMediaDetails(file, anchorElement) {
  closeGeneratedMediaDetails(true);
  const generation = file.aiGeneration || {};
  const butlerOperation = file.butlerOperation || {};
  const prompt = String(generation.prompt || '').trim();
  const referenceIds = Array.isArray(generation.referenceFileIds)
    ? generation.referenceFileIds
    : [];
  const references = referenceIds
    .map((id) => AppState.files.find((entry) => entry.id === id))
    .filter(Boolean);
  const referenceCount = Math.max(
    referenceIds.length,
    references.length,
    Number(generation.referenceCount) || 0
  );
  const hasDimensions = Number(file.sourceWidth) > 0 && Number(file.sourceHeight) > 0;
  const dimensions = hasDimensions
    ? `${Math.round(file.sourceWidth)} x ${Math.round(file.sourceHeight)}`
    : '';
  const aspectRatio = formatBoardAspectRatio(file, generation);
  const modelLabel = boardGenerationModelLabel(generation) ||
    (butlerOperation.kind === 'video-upscale' ? 'Topaz Video AI' : '');
  const isGenerated = !!(file.aiGeneration || file.sourceFolder === 'AI Generated');
  const isVideoDetail = generation.kind === 'video' || butlerOperation.kind === 'video-upscale';
  const operationCredits = Number.isFinite(Number(butlerOperation.credits))
    ? Math.max(0, Math.round(Number(butlerOperation.credits)))
    : null;

  const overlay = document.createElement('div');
  overlay.id = 'generated-media-detail-overlay';
  overlay.className = 'generated-media-detail-overlay';
  overlay.innerHTML = `
    <section class="generated-media-detail-panel" role="dialog" aria-modal="true">
      <header class="generated-media-detail-header">
        <div>
          <strong class="generated-media-detail-type"></strong>
          <span class="generated-media-detail-dimensions"></span>
        </div>
        <div class="generated-media-detail-header-actions">
          <button type="button" class="generated-media-edit"></button>
          <button type="button" class="generated-media-detail-close" aria-label="${t('Close', '关闭')}">x</button>
        </div>
      </header>
      <div class="generated-media-detail-model"></div>
      <div class="generated-media-detail-chips"></div>
      <section class="generated-media-detail-section" data-media-section="prompt">
        <div class="generated-media-detail-section-heading">
          <strong>${t('Prompt', '提示词')}</strong>
          <button type="button" class="generated-media-prompt-copy">${t('Copy', '复制')}</button>
        </div>
        <p class="generated-media-detail-prompt"></p>
      </section>
      <section class="generated-media-detail-section" data-media-section="references">
        <div class="generated-media-detail-section-heading">
          <strong>${t('References', '参考图')}</strong>
          <span class="generated-media-reference-count"></span>
        </div>
        <div class="generated-media-reference-list"></div>
      </section>
      <footer class="generated-media-detail-footer">
        <button type="button" class="generated-media-retry">${t('Retry', '重试')}</button>
        <button type="button" class="generated-media-remix">${t('Remix', '再创作')}</button>
      </footer>
    </section>
  `;

  overlay.querySelector('.generated-media-detail-type').textContent =
    isVideoDetail ? t('VIDEO', '视频', '비디오') : t('IMAGE', '图片', '이미지');
  const dimensionsElement = overlay.querySelector('.generated-media-detail-dimensions');
  dimensionsElement.textContent = dimensions ? ` · ${dimensions}` : '';
  dimensionsElement.hidden = !dimensions;
  const modelElement = overlay.querySelector('.generated-media-detail-model');
  modelElement.textContent = modelLabel ? `${t('Model', '模型')} · ${modelLabel}` : '';
  modelElement.hidden = !modelLabel;
  const editButton = overlay.querySelector('.generated-media-edit');
  editButton.textContent = t('Edit image', '编辑图片');
  editButton.hidden = !isGenerated || !prompt || generation.kind === 'video';
  const promptSection = overlay.querySelector('[data-media-section="prompt"]');
  promptSection.hidden = !prompt;
  overlay.querySelector('.generated-media-detail-prompt').textContent = prompt;
  const referenceSection = overlay.querySelector('[data-media-section="references"]');
  referenceSection.hidden = !referenceCount;
  overlay.querySelector('.generated-media-reference-count').textContent =
    String(referenceCount).padStart(2, '0');

  const chips = overlay.querySelector('.generated-media-detail-chips');
  if (aspectRatio) {
    const aspect = document.createElement('span');
    aspect.textContent = `${t('Aspect', '比例')} ${aspectRatio}`;
    chips.appendChild(aspect);
  }
  if (generation.size) {
    const size = document.createElement('span');
    size.textContent = `${t('Quality', '画质')} ${generation.size}`;
    chips.appendChild(size);
  }
  if (operationCredits !== null) {
    const points = document.createElement('span');
    points.textContent = `${t('Points', '积分', '포인트')} ${operationCredits}`;
    chips.appendChild(points);
  }
  if (Number.isFinite(Number(file.sizeBytes)) && Number(file.sizeBytes) >= 0) {
    const fileSize = document.createElement('span');
    fileSize.textContent = `${t('File', '大小')} ${formatBoardFileSize(file)}`;
    chips.appendChild(fileSize);
  }
  if (generation.kind === 'video' && generation.duration) {
    const duration = document.createElement('span');
    duration.textContent = `${t('Duration', '时长')} ${generation.duration}s`;
    chips.appendChild(duration);
  }
  chips.hidden = !chips.childElementCount;

  const referenceList = overlay.querySelector('.generated-media-reference-list');
  references.forEach((reference) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'generated-media-reference-thumb';
    button.title = reference.name;
    const image = document.createElement('img');
    image.src = reference.thumbUrl || reference.url;
    image.alt = reference.name;
    button.appendChild(image);
    button.addEventListener('click', () => {
      closeGeneratedMediaDetails();
      selectFileForPreview(reference.id);
    });
    referenceList.appendChild(button);
  });
  if (referenceCount > references.length) {
    const missing = document.createElement('span');
    missing.className = 'generated-media-reference-missing';
    missing.textContent = `+${referenceCount - references.length}`;
    referenceList.appendChild(missing);
  }
  overlay.querySelector('.generated-media-detail-close').addEventListener('click', closeGeneratedMediaDetails);
  overlay.querySelector('.generated-media-prompt-copy').disabled = !prompt;
  overlay.querySelector('.generated-media-prompt-copy').addEventListener('click', async () => {
    if (!prompt) return;
    await copyGeneratedPrompt(prompt);
    showToast(t('Prompt copied', '提示词已复制'), 'AI');
  });

  const retry = overlay.querySelector('.generated-media-retry');
  const remix = overlay.querySelector('.generated-media-remix');
  overlay.querySelector('.generated-media-detail-footer').hidden = !isGenerated || !prompt;
  retry.disabled = !prompt;
  remix.disabled = !prompt;
  retry.addEventListener('click', async () => {
    closeGeneratedMediaDetails();
    if (typeof retryGeneratedMediaFromDetails === 'function') {
      await retryGeneratedMediaFromDetails(file);
    }
  });
  remix.addEventListener('click', async () => {
    closeGeneratedMediaDetails();
    if (typeof remixGeneratedMediaFromDetails === 'function') {
      await remixGeneratedMediaFromDetails(file, false);
    }
  });
  overlay.querySelector('.generated-media-edit').addEventListener('click', async () => {
    closeGeneratedMediaDetails();
    if (typeof remixGeneratedMediaFromDetails === 'function') {
      await remixGeneratedMediaFromDetails(file, true);
    }
  });
  overlay.addEventListener('pointerdown', (event) => {
    if (event.target === overlay) closeGeneratedMediaDetails();
  });

  document.body.appendChild(overlay);
  overlay.querySelector('.generated-media-detail-panel').setAttribute(
    'aria-label',
    `${t('Image details', '图片详情')}: ${file.name || t('Image', '图片')}`
  );
  positionGeneratedMediaDetailsPanel(overlay, anchorElement);
  generatedMediaDetailKeyHandler = (event) => {
    if (event.key === 'Escape') closeGeneratedMediaDetails();
  };
  document.addEventListener('keydown', generatedMediaDetailKeyHandler);
  requestAnimationFrame(() => overlay.classList.add('is-visible'));
}

function positionGeneratedMediaDetailsPanel(overlay, anchorElement) {
  const panel = overlay.querySelector('.generated-media-detail-panel');
  if (!panel || !anchorElement) return;
  const anchor = anchorElement.getBoundingClientRect();
  const panelWidth = panel.offsetWidth;
  const panelHeight = panel.offsetHeight;
  const margin = 18;
  const gap = 14;
  let left;
  if (anchor.right + gap + panelWidth <= window.innerWidth - margin) {
    left = anchor.right + gap;
  } else if (anchor.left - gap - panelWidth >= margin) {
    left = anchor.left - gap - panelWidth;
  } else {
    left = Math.max(margin, (window.innerWidth - panelWidth) / 2);
  }
  const maxTop = Math.max(margin, window.innerHeight - panelHeight - margin);
  const top = Math.max(margin, Math.min(anchor.top, maxTop));
  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
}

async function copyGeneratedPrompt(prompt) {
  try {
    await navigator.clipboard.writeText(prompt);
    return;
  } catch (err) {}
  const input = document.createElement('textarea');
  input.value = prompt;
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();
  document.execCommand('copy');
  input.remove();
}
