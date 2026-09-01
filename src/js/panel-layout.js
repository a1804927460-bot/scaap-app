'use strict';

const PANEL_LAYOUT_ORDER_KEY = 'messs.panel-order.v1';
const PANEL_LAYOUT_TARGETS = [
  { id: 'sidebar', selector: '#sidebar', handle: '.sidebar-brand' },
  { id: 'preview', selector: '.preview-panel', handle: '.panel-header' },
  { id: 'stats', selector: '.stats-panel', handle: '.ai-assistant-header, .ai-assistant-compact' },
  { id: 'board', selector: '#board-panel', handle: '.panel-header' }
];

function readPanelOrder() {
  try {
    const saved = JSON.parse(localStorage.getItem(PANEL_LAYOUT_ORDER_KEY) || '{}');
    return saved && typeof saved === 'object' ? saved : {};
  } catch (err) {
    return {};
  }
}

function applyPanelOrder() {
  const saved = readPanelOrder();
  PANEL_LAYOUT_TARGETS.forEach(({ id, selector }) => {
    const panel = document.querySelector(selector);
    if (panel) panel.style.gridArea = saved[id] || id;
  });
}

function savePanelOrder() {
  const value = {};
  PANEL_LAYOUT_TARGETS.forEach(({ id, selector }) => {
    const panel = document.querySelector(selector);
    if (panel) value[id] = getComputedStyle(panel).gridArea;
  });
  try {
    localStorage.setItem(PANEL_LAYOUT_ORDER_KEY, JSON.stringify(value));
  } catch (err) {}
}

function resetPanelLayout() {
  const main = document.getElementById('main-app');
  try {
    localStorage.removeItem(PANEL_LAYOUT_ORDER_KEY);
    localStorage.removeItem('messs.panel-layout.v2');
  } catch (err) {}

  PANEL_LAYOUT_TARGETS.forEach(({ id, selector }) => {
    const panel = document.querySelector(selector);
    if (panel) panel.style.gridArea = id;
  });
  if (main && typeof PANEL_LIMITS !== 'undefined') {
    Object.values(PANEL_LIMITS).forEach((limits) => {
      main.style.removeProperty(limits.cssVar);
    });
    if (typeof clampPanelLayout === 'function') clampPanelLayout(main);
  }
  if (typeof setSidebarCollapsed === 'function') setSidebarCollapsed(false);
  if (window.messsAPI && typeof window.messsAPI.setSidebarCollapsed === 'function') {
    window.messsAPI.setSidebarCollapsed(false);
  }
  window.dispatchEvent(new Event('resize'));
}

function panelFromElement(element) {
  if (!element || !element.closest) return null;
  const target = PANEL_LAYOUT_TARGETS.find(({ selector }) => element.closest(selector));
  return target ? document.querySelector(target.selector) : null;
}

function createPanelDragGhost(panel, label) {
  const ghost = document.createElement('div');
  ghost.className = 'panel-drag-ghost';
  ghost.setAttribute('aria-hidden', 'true');
  ghost.innerHTML = `
    <span class="panel-drag-ghost-grip"><i></i><i></i><i></i><i></i><i></i><i></i></span>
    <strong>${label}</strong>
  `;
  const rect = panel.getBoundingClientRect();
  ghost.style.width = `${Math.min(360, Math.max(220, rect.width * .46))}px`;
  document.body.appendChild(ghost);
  return ghost;
}

function movePanelDragGhost(ghost, clientX, clientY) {
  if (!ghost) return;
  ghost.style.left = `${clientX + 18}px`;
  ghost.style.top = `${clientY + 18}px`;
}

function isPanelLayoutControl(target) {
  if (!target || typeof target.closest !== 'function') return true;
  return !!target.closest(
    'button, input, select, textarea, a, [contenteditable="true"], ' +
    '.resize-handle, .board-item, .file-item, .folder-item, ' +
    '.canvas-library-card, .ai-image-popover, .context-menu'
  );
}

function initPanelLayout() {
  applyPanelOrder();
  const main = document.getElementById('main-app');
  if (!main) return;

  PANEL_LAYOUT_TARGETS.forEach(({ selector, id, handle }) => {
    const panel = document.querySelector(selector);
    if (!panel) return;
    let timer = 0;
    let pointerId = null;
    let dragging = false;
    let sourcePanel = null;
    let dragGhost = null;
    let startX = 0;
    let startY = 0;
    let startedAt = 0;
    let detachTriggered = false;
    let detachWatchTimer = 0;

    function beginDrag(clientX, clientY) {
      if (dragging || pointerId === null || !sourcePanel) return;
      dragging = true;
      sourcePanel.classList.add('is-layout-dragging');
      main.classList.add('is-layout-dragging');
      const title = sourcePanel.querySelector('.panel-title, .brand-word, .ai-assistant-title, .ai-assistant-header strong');
      dragGhost = createPanelDragGhost(sourcePanel, (title && title.textContent.trim()) || id);
      movePanelDragGhost(dragGhost, clientX, clientY);
      if (panel.setPointerCapture) panel.setPointerCapture(pointerId);
    }

    panel.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || isPanelLayoutControl(event.target) || !event.target.closest(handle)) return;
      pointerId = event.pointerId;
      sourcePanel = panel;
      if (id === 'board' && panel.setPointerCapture) panel.setPointerCapture(pointerId);
      startX = event.clientX;
      startY = event.clientY;
      startedAt = Date.now();
      detachTriggered = false;
      if (id === 'board' && typeof isDetachedCanvasWindow === 'function' && !isDetachedCanvasWindow()) {
        detachWatchTimer = window.setTimeout(() => {
          detachWatchTimer = 0;
          if (pointerId !== null && window.messsAPI && typeof window.messsAPI.beginCanvasDetachDrag === 'function') {
            window.messsAPI.beginCanvasDetachDrag(activeCanvasId());
          }
        }, 280);
      }
      timer = window.setTimeout(() => beginDrag(startX, startY), 180);
    });

    panel.addEventListener('pointermove', (event) => {
      if (event.pointerId !== pointerId) return;
      if (!dragging) {
        if (Math.hypot(event.clientX - startX, event.clientY - startY) > 5) {
          clearTimeout(timer);
          beginDrag(event.clientX, event.clientY);
        }
        if (!dragging) return;
      }
      event.preventDefault();
      movePanelDragGhost(dragGhost, event.clientX, event.clientY);
      const outsideWindow = event.screenX < window.screenX - 3
        || event.screenX > window.screenX + window.outerWidth + 3
        || event.screenY < window.screenY - 3
        || event.screenY > window.screenY + window.outerHeight + 3;
      if (
        id === 'board'
        && outsideWindow
        && Date.now() - startedAt >= 280
        && !detachTriggered
        && typeof openActiveCanvasInDetachedWindow === 'function'
        && typeof isDetachedCanvasWindow === 'function'
        && !isDetachedCanvasWindow()
      ) {
        detachTriggered = true;
        void openActiveCanvasInDetachedWindow({ x: event.screenX, y: event.screenY });
      }
      const target = panelFromElement(document.elementFromPoint(event.clientX, event.clientY));
      document.querySelectorAll('.is-layout-drop-target').forEach((item) => item.classList.remove('is-layout-drop-target'));
      if (target && target !== sourcePanel) target.classList.add('is-layout-drop-target');
    });

    function endDrag(event) {
      if (event.pointerId !== pointerId) return;
      clearTimeout(timer);
      clearTimeout(detachWatchTimer);
      detachWatchTimer = 0;
      if (id === 'board' && window.messsAPI && typeof window.messsAPI.cancelCanvasDetachDrag === 'function') {
        window.messsAPI.cancelCanvasDetachDrag();
      }
      const target = dragging ? panelFromElement(document.elementFromPoint(event.clientX, event.clientY)) : null;
      document.querySelectorAll('.is-layout-drop-target').forEach((item) => item.classList.remove('is-layout-drop-target'));
      if (dragging && target && target !== sourcePanel) {
        const sourceArea = sourcePanel.style.gridArea || getComputedStyle(sourcePanel).gridArea;
        const targetArea = target.style.gridArea || getComputedStyle(target).gridArea;
        sourcePanel.style.gridArea = targetArea;
        target.style.gridArea = sourceArea;
        savePanelOrder();
      }
      if (sourcePanel) sourcePanel.classList.remove('is-layout-dragging');
      if (dragging && sourcePanel) sourcePanel.dataset.layoutDraggedAt = String(Date.now());
      main.classList.remove('is-layout-dragging');
      if (dragGhost) {
        dragGhost.remove();
        dragGhost = null;
      }
      if (panel.hasPointerCapture && panel.hasPointerCapture(event.pointerId)) {
        panel.releasePointerCapture(event.pointerId);
      }
      pointerId = null;
      sourcePanel = null;
      dragging = false;
      detachTriggered = false;
    }

    panel.addEventListener('pointerup', endDrag);
    panel.addEventListener('pointercancel', endDrag);
  });

  document.addEventListener('messs:sidebar-collapsed', () => {
    // Keep the collapsed grid stable when a user reorders panels.
    applyPanelOrder();
  });
}
