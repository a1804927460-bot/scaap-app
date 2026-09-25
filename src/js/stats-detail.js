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
let assistantReadingPosition = null;
let assistantScrollRestoreFrame = 0;

function captureAssistantReadingPosition(panel) {
  const messages = document.getElementById('ai-assistant-messages');
  if (!messages || messages.hidden) return null;
  const top = messages.getBoundingClientRect().top;
  const scale = messages.getBoundingClientRect().width / messages.offsetWidth || 1;
  const anchor = Array.from(messages.children).find(row => row.getBoundingClientRect().bottom > top);
  return {
    sessionId: typeof AiAssistant === 'undefined' ? null : AiAssistant.activeSessionId,
    top: messages.scrollTop,
    width: messages.clientWidth,
    anchor,
    offset: anchor ? (anchor.getBoundingClientRect().top - top) / scale : 0,
    sidebarTop: panel.querySelector('.ai-chat-history-sections')?.scrollTop || 0
  };
}

function restoreAssistantReadingPosition(panel, position) {
  const messages = document.getElementById('ai-assistant-messages');
  const sessionId = typeof AiAssistant === 'undefined' ? null : AiAssistant.activeSessionId;
  if (!position || !messages || messages.hidden || sessionId !== position.sessionId || !panel.classList.contains('is-fullscreen')) return;
  messages.scrollTo({top:position.top,behavior:'instant'});
  if (position.width !== messages.clientWidth && position.anchor?.parentElement === messages) {
    const scale = messages.getBoundingClientRect().width / messages.offsetWidth || 1;
    messages.scrollTo({top:messages.scrollTop + (position.anchor.getBoundingClientRect().top - messages.getBoundingClientRect().top) / scale - position.offset,behavior:'instant'});
  }
  const sidebar = panel.querySelector('.ai-chat-history-sections');
  if (sidebar) sidebar.scrollTo({top:position.sidebarTop,behavior:'instant'});
}

function updateAssistantCompactState() {
  const panel = document.getElementById('ai-assistant-panel');
  if (!panel) return;
  const host = panel.closest('.stats-panel');
  const compact = !!host && !panel.classList.contains('is-fullscreen') && host.clientHeight < 270;
  panel.classList.toggle('is-compact', compact);
}

function syncAssistantFullscreenNavigation(expanded) {
  if (typeof setAppSurfaceNavigationActive === 'function') {
    setAppSurfaceNavigationActive(expanded ? 'agent' : '');
  }
  document.body.classList.toggle('is-app-surface-open', expanded);
}

function assistantOccupiesFullscreenLayer(panel) {
  return !!panel && (panel.classList.contains('is-fullscreen') || panel.parentElement === document.body);
}

function restoreAssistantPanelToWorkspace(panel) {
  if (assistantPanelAnchor && assistantPanelAnchor.parentNode) {
    assistantPanelAnchor.parentNode.insertBefore(panel, assistantPanelAnchor);
    assistantPanelAnchor.remove();
  } else {
    const workspaceHost = document.querySelector('.stats-panel');
    if (workspaceHost && panel.parentElement !== workspaceHost) {
      workspaceHost.insertBefore(panel, workspaceHost.firstChild);
    }
  }
  assistantPanelAnchor = null;
}

function setAssistantFullscreen(expanded, options = {}) {
  const panel = document.getElementById('ai-assistant-panel');
  const button = document.getElementById('ai-assistant-history');
  const wasExpanded = panel.classList.contains('is-fullscreen');
  if (assistantScrollRestoreFrame) cancelAnimationFrame(assistantScrollRestoreFrame);
  if (wasExpanded) assistantReadingPosition = captureAssistantReadingPosition(panel);
  if (expanded && panel.parentElement !== document.body) {
    assistantPanelAnchor = document.createComment('ai-assistant-panel');
    panel.parentNode.insertBefore(assistantPanelAnchor, panel);
    document.body.appendChild(panel);
  } else if (!expanded) {
    restoreAssistantPanelToWorkspace(panel);
  }
  panel.classList.toggle('is-fullscreen', expanded);
  if (expanded) {
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Agent');
  } else {
    panel.removeAttribute('role');
    panel.removeAttribute('aria-modal');
    panel.removeAttribute('aria-label');
  }
  document.body.classList.toggle('is-ai-assistant-fullscreen', expanded);
  button.hidden = expanded;
  button.title = t('Return to chat home', '返回对话首页');
  button.setAttribute('aria-label', button.title);
  const homeButton = document.getElementById('ai-assistant-home-button');
  if (homeButton) {
    homeButton.title = button.title;
    homeButton.setAttribute('aria-label', button.title);
  }
  const closeButton = document.getElementById('ai-assistant-dialog-close');
  if (closeButton) closeButton.hidden = !expanded;
  button.innerHTML = expanded ? ASSISTANT_ICON_COMPRESS : ASSISTANT_ICON_EXPAND;
  if (options.syncNavigation === true) syncAssistantFullscreenNavigation(expanded);
  updateAssistantCompactState();
  if (expanded && assistantReadingPosition) {
    restoreAssistantReadingPosition(panel, assistantReadingPosition);
    assistantScrollRestoreFrame = requestAnimationFrame(() => {
      assistantScrollRestoreFrame = 0;
      restoreAssistantReadingPosition(panel, assistantReadingPosition);
    });
  }
}

function refreshStatsLanguage() {
  renderTopStats();
  renderAchievementList();
  const panel = document.getElementById('ai-assistant-panel');
  if (panel) setAssistantFullscreen(panel.classList.contains('is-fullscreen'));
}

function returnToAssistantHome() {
  startNewAiChat();
  setAssistantFullscreen(true, { syncNavigation: true });
}

function initStatsDetail() {
  const statsPanel = document.querySelector('.stats-panel');
  if (statsPanel && typeof ResizeObserver !== 'undefined') {
    const compactObserver = new ResizeObserver(updateAssistantCompactState);
    compactObserver.observe(statsPanel);
  }
  updateAssistantCompactState();
  document.getElementById('ai-assistant-history').addEventListener('click', returnToAssistantHome);
  const sidebarToggle = document.getElementById('ai-assistant-sidebar-toggle');
  if (sidebarToggle) sidebarToggle.addEventListener('click', () => {
    const panel = document.getElementById('ai-assistant-panel');
    const collapsed = panel.classList.toggle('is-history-collapsed');
    sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
    sidebarToggle.title = collapsed ? t('Expand sidebar', '展开侧栏') : t('Collapse sidebar', '收缩侧栏');
    sidebarToggle.setAttribute('aria-label', sidebarToggle.title);
  });
  document.getElementById('ai-assistant-home-button').addEventListener('click', returnToAssistantHome);
  document.getElementById('ai-assistant-dialog-close')?.addEventListener('click', () => {
    setAssistantFullscreen(false, { syncNavigation: true });
    document.querySelector('[data-app-surface="agent"]')?.focus();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!document.getElementById('fullscreen-overlay')?.hidden) return;
    const panel = document.getElementById('ai-assistant-panel');
    if (assistantOccupiesFullscreenLayer(panel)) {
      setAssistantFullscreen(false, { syncNavigation: true });
    }
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

}
