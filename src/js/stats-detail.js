'use strict';
/* Right-side usage stats and the detail overlay. */

function renderTopStats() {
  document.getElementById('stat-last-run').textContent = formatDateTime(AppState.usage.lastRunAt);
  document.getElementById('stat-total-time').textContent = formatDuration(AppState.usage.totalSeconds);
  document.getElementById('stat-achievements').textContent = t(
    `${AppState.files.length} file${AppState.files.length === 1 ? '' : 's'}`,
    `${AppState.files.length} 个文件`
  );
}

const ACHIEVEMENT_COPY = {
  first_import: {
    title: ['Ordered Chaos', '混乱有序'],
    desc: ['Imported the first file into Messs.', '第一次把文件导入 Messs。']
  },
  deep_search: {
    title: ['Search Wizard', '神级搜索术'],
    desc: ['Found a file imported at least a week ago within the early session window.', '在会话早期定位到一周前导入的文件。']
  },
  final_version: {
    title: ['Final Final Version', '你管这叫最终版？'],
    desc: ['Deleted a recent duplicate with a final-version style name.', '删除了一个近期导入的“最终版”重复文件。']
  },
  lost_folder: {
    title: ['Was This Planned?', '这也在你的计划之中吗？'],
    desc: ['Recovered a file from a folder named like New Folder (7).', '从类似“新建文件夹 (7)”的角落里找到了文件。']
  },
  no_clutter_month: {
    title: ['Desktop Truce', '桌面休战'],
    desc: ['Kept the desktop free of default new text documents for a month.', '连续一个月没有在桌面留下默认新建文本文档。']
  },
  minimalist: {
    title: ['Minimalist', '极简主义者'],
    desc: ['Imported files for 7 days while keeping the desktop from growing.', '连续 7 天导入文件，同时让桌面保持克制。']
  }
};

function achievementCopy(item, field) {
  const copy = ACHIEVEMENT_COPY[item.key];
  if (!copy) return item[field] || '';
  return t(copy[field][0], copy[field][1]);
}

function renderAchievementList() {
  const list = document.getElementById('achievement-list');
  if (!list) return;
  list.innerHTML = '';
  for (const a of AppState.achievements) {
    const li = document.createElement('li');
    li.className = 'achievement-item' + (a.unlocked ? ' is-unlocked' : '');

    const badge = document.createElement('div');
    badge.className = 'achievement-badge';
    badge.textContent = a.unlocked ? 'OK' : '--';

    const text = document.createElement('div');
    text.innerHTML = `
      <div class="achievement-title">${escapeHtml(achievementCopy(a, 'title'))}</div>
      <div class="achievement-desc">${escapeHtml(achievementCopy(a, 'desc'))}</div>
      ${a.unlocked ? `<div class="achievement-date">${t('Unlocked', '已解锁')} ${formatDateTime(a.unlockedAt)}</div>` : ''}
    `;

    li.append(badge, text);
    list.appendChild(li);
  }
}

async function refreshAchievements() {
  renderTopStats();
  renderAchievementList();
}

const ASSISTANT_ICON_EXPAND = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
const ASSISTANT_ICON_COMPRESS = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 3v4a2 2 0 0 1-2 2H3"/><path d="M21 9h-4a2 2 0 0 1-2-2V3"/><path d="M3 15h4a2 2 0 0 1 2 2v4"/><path d="M15 21v-4a2 2 0 0 1 2-2h4"/></svg>';
let assistantPanelAnchor = null;

function setAssistantFullscreen(expanded) {
  const panel = document.getElementById('ai-assistant-panel');
  const button = document.getElementById('ai-assistant-history');
  if (expanded && panel.parentElement !== document.body) {
    assistantPanelAnchor = document.createComment('ai-assistant-panel');
    panel.parentNode.insertBefore(assistantPanelAnchor, panel);
    document.body.appendChild(panel);
  } else if (!expanded && assistantPanelAnchor && assistantPanelAnchor.parentNode) {
    assistantPanelAnchor.parentNode.insertBefore(panel, assistantPanelAnchor);
    assistantPanelAnchor.remove();
    assistantPanelAnchor = null;
  }
  panel.classList.toggle('is-fullscreen', expanded);
  document.body.classList.toggle('is-ai-assistant-fullscreen', expanded);
  button.title = expanded ? t('Exit fullscreen chat', '退出全屏对话') : t('Open fullscreen chat', '打开全屏对话');
  button.setAttribute('aria-label', button.title);
  button.setAttribute('aria-pressed', String(expanded));
  button.innerHTML = expanded ? ASSISTANT_ICON_COMPRESS : ASSISTANT_ICON_EXPAND;
}

function refreshStatsLanguage() {
  renderTopStats();
  renderAchievementList();
  const panel = document.getElementById('ai-assistant-panel');
  if (panel) setAssistantFullscreen(panel.classList.contains('is-fullscreen'));
}

function initStatsDetail() {
  document.getElementById('ai-assistant-history').addEventListener('click', () => {
    const panel = document.getElementById('ai-assistant-panel');
    setAssistantFullscreen(!panel.classList.contains('is-fullscreen'));
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const panel = document.getElementById('ai-assistant-panel');
    if (panel && panel.classList.contains('is-fullscreen')) setAssistantFullscreen(false);
  });

  document.getElementById('detail-close').addEventListener('click', () => {
    document.getElementById('detail-overlay').hidden = true;
  });
  document.getElementById('detail-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'detail-overlay') e.currentTarget.hidden = true;
  });

  setInterval(() => {
    AppState.usage.totalSeconds += 1;
    renderTopStats();
    if (!document.getElementById('detail-overlay').hidden) {
      document.getElementById('detail-total-time').textContent = formatDuration(AppState.usage.totalSeconds);
    }
  }, 1000);

  window.messsAPI.onAchievementsUpdated((payload) => {
    AppState.achievements = payload;
    renderTopStats();
    renderAchievementList();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setAssistantFullscreen(false);
  });
}
