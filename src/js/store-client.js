'use strict';
/* Shared in-renderer state + small utilities used across modules. */

const AppState = {
  files: [],          // [{id,name,importedAt,sourceFolder,sizeBytes,ext,url,folderId}]
  folders: [],        // [{id,name,createdAt}]
  defaultFolderName: 'Library',
  boardItems: [],
  allBoardItems: [],
  canvasProjects: [],
  canvases: [],
  activeCanvasId: 'canvas-1',
  usage: { totalSeconds: 0, firstRunAt: null, lastRunAt: null },
  achievements: [],
  activeFileId: null,
  activeFolderId: 'default',
  folderGridVisible: false,
  viewMode: 'grid',
  gridThumbSize: 140,
  theme: 'dark',
  language: 'en'
};

function isZh() {
  return AppState.language === 'zh';
}

function t(en, zh) {
  return isZh() ? zh : en;
}

function countText(count, singular, plural, zhUnit) {
  return isZh()
    ? `${count} ${zhUnit}`
    : `${count} ${count === 1 ? singular : plural}`;
}

function createLatestFrameRunner(callback) {
  let frameId = 0;
  let latestValue;

  function run() {
    frameId = 0;
    if (latestValue === undefined) return;
    const value = latestValue;
    latestValue = undefined;
    callback(value);
  }

  return {
    push(value) {
      latestValue = value;
      if (!frameId) frameId = requestAnimationFrame(run);
    },
    flush() {
      if (frameId) cancelAnimationFrame(frameId);
      frameId = 0;
      run();
    },
    cancel() {
      if (frameId) cancelAnimationFrame(frameId);
      frameId = 0;
      latestValue = undefined;
    }
  };
}

function beginRefreshRateSampling() {
  let frameId = 0;
  let previous = 0;
  let samples = [];

  function sample(now) {
    if (previous) {
      const delta = now - previous;
      if (delta > 1 && delta < 50) samples.push(delta);
    }
    previous = now;
    if (samples.length < 90) {
      frameId = requestAnimationFrame(sample);
      return;
    }
    const refreshRate = window.MesssBoardEngine
      ? window.MesssBoardEngine.estimateRefreshRate(samples)
      : 60;
    document.documentElement.dataset.refreshRate = String(refreshRate);
    document.documentElement.style.setProperty('--display-frame-ms', `${1000 / refreshRate}ms`);
    frameId = 0;
  }

  function restart() {
    if (frameId) cancelAnimationFrame(frameId);
    previous = 0;
    samples = [];
    frameId = requestAnimationFrame(sample);
  }

  restart();
  window.addEventListener('focus', restart);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) restart();
  });
}

function formatDateTime(iso) {
  if (!iso) return '--';
  const d = new Date(iso);
  return d.toLocaleString(AppState.language === 'zh' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (AppState.language === 'zh') {
    if (h > 0) return `${h} 小时 ${m} 分钟`;
    if (m > 0) return `${m} 分钟 ${s % 60} 秒`;
    return `${s} 秒`;
  }
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function groupFilesByDay(files) {
  const groups = new Map();
  const sorted = [...files].sort((a, b) => new Date(b.importedAt) - new Date(a.importedAt));
  for (const f of sorted) {
    const day = new Date(f.importedAt).toLocaleDateString(AppState.language === 'zh' ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(f);
  }
  return groups;
}

function isImageExt(ext) {
  return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.avif', '.tif', '.tiff'].includes(ext);
}

function isVideoExt(ext) {
  return ['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.wmv', '.flv', '.mpeg', '.mpg'].includes(ext);
}

function isAudioExt(ext) {
  return ['.mp3', '.wav', '.wave', '.ogg', '.oga', '.opus', '.m4a', '.m4b', '.aac', '.flac', '.aif', '.aiff', '.wma', '.amr', '.ape', '.alac', '.ac3', '.eac3', '.dts', '.caf', '.au', '.ra'].includes(ext);
}

function isEditableExt(ext) {
  return ['.txt', '.docx'].includes(String(ext || '').toLowerCase());
}

function fileIconLabel(ext) {
  const map = {
    '.pdf': 'PDF', '.doc': 'DOC', '.docx': 'DOC', '.xls': 'XLS', '.xlsx': 'XLS',
    '.zip': 'ZIP', '.mp4': 'MOV', '.mov': 'MOV', '.mp3': 'MP3', '.txt': 'TXT'
  };
  return map[ext] || (ext ? ext.replace('.', '').slice(0, 4).toUpperCase() : 'FILE');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(message, emoji) {
  const toast = document.getElementById('toast');
  toast.innerHTML = '';
  if (emoji) {
    const e = document.createElement('span');
    e.className = 'toast-emoji';
    e.textContent = emoji;
    toast.appendChild(e);
  }
  const span = document.createElement('span');
  span.textContent = message;
  toast.appendChild(span);
  toast.hidden = false;
  requestAnimationFrame(() => toast.classList.add('is-visible'));
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    toast.classList.remove('is-visible');
    setTimeout(() => { toast.hidden = true; }, 320);
  }, 3200);
}
