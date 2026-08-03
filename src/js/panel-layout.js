'use strict';

const PANEL_LAYOUT_ORDER_KEY = 'messs.panel-order.v1';
const PANEL_LAYOUT_TARGETS = [
  { id: 'sidebar', selector: '#sidebar', handle: '.sidebar-brand' },
  { id: 'preview', selector: '.preview-panel', handle: '.panel-header' },
  { id: 'stats', selector: '.stats-panel', handle: '.ai-assistant-header' },
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

  PANEL_LAYOUT_TARGETS.forEach(({ selector, id }) => {
    const panel = document.querySelector(selector);
    if (!panel) return;
    let timer = 0;
    let pointerId = null;
    let dragging = false;
    let sourcePanel = null;
    let dragGhost = null;
    let startX = 0;
    let startY = 0;

    panel.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || isPanelLayoutControl(event.target)) return;
      pointerId = event.pointerId;
      sourcePanel = panel;
      startX = event.clientX;
      startY = event.clientY;
      timer = window.setTimeout(() => {
        dragging = true;
        sourcePanel.classList.add('is-layout-dragging');
        main.classList.add('is-layout-dragging');
        const title = sourcePanel.querySelector('.panel-title, .sidebar-logo, .ai-assistant-title');
        dragGhost = createPanelDragGhost(sourcePanel, (title && title.textContent.trim()) || id);
        movePanelDragGhost(dragGhost, event.clientX, event.clientY);
        if (panel.setPointerCapture) panel.setPointerCapture(pointerId);
      }, 180);
    });

    panel.addEventListener('pointermove', (event) => {
      if (event.pointerId !== pointerId) return;
      if (!dragging) {
        if (Math.hypot(event.clientX - startX, event.clientY - startY) > 7) {
          clearTimeout(timer);
          pointerId = null;
          sourcePanel = null;
        }
        return;
      }
      event.preventDefault();
      movePanelDragGhost(dragGhost, event.clientX, event.clientY);
      const target = panelFromElement(document.elementFromPoint(event.clientX, event.clientY));
      document.querySelectorAll('.is-layout-drop-target').forEach((item) => item.classList.remove('is-layout-drop-target'));
      if (target && target !== sourcePanel) target.classList.add('is-layout-drop-target');
    });

    function endDrag(event) {
      if (event.pointerId !== pointerId) return;
      clearTimeout(timer);
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
    }

    panel.addEventListener('pointerup', endDrag);
    panel.addEventListener('pointercancel', endDrag);
  });

  document.addEventListener('messs:sidebar-collapsed', () => {
    // Keep the collapsed grid stable when a user reorders panels.
    applyPanelOrder();
  });
}
