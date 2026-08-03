'use strict';

const PANEL_LAYOUT_STORAGE_KEY = 'messs.panel-layout.v2';
const PANEL_LIMITS = {
  sidebar: { min: 176, cssVar: '--sidebar-w', defaultPx: 272, direction: 1 },
  stats: { min: 220, cssVar: '--stats-w', defaultPx: 320, direction: -1 },
  preview: { min: 150, cssVar: '--preview-h', defaultPx: 340, direction: 1 },
  agent: { min: 220, cssVar: '--agent-w', defaultPx: 320, direction: -1 }
};

const MAIN_HORIZONTAL_CHROME_PX = 36;
const MAIN_VERTICAL_CHROME_PX = 28;
const MIN_CENTER_COLUMN_PX = 260;
const MIN_BOARD_ROW_PX = 220;
const MIN_BOARD_VIEWPORT_PX = 280;

function readPanelSize(mainApp, target) {
  const limits = PANEL_LIMITS[target];
  const raw = parseFloat(getComputedStyle(mainApp).getPropertyValue(limits.cssVar));
  return Number.isFinite(raw) ? raw : limits.defaultPx;
}

function writePanelSize(mainApp, target, value) {
  const limits = PANEL_LIMITS[target];
  mainApp.style.setProperty(limits.cssVar, `${Math.round(value)}px`);
}

function readStoredPanelLayout() {
  try {
    const value = JSON.parse(localStorage.getItem(PANEL_LAYOUT_STORAGE_KEY));
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function persistPanelLayout(mainApp) {
  const value = {};
  Object.keys(PANEL_LIMITS).forEach((target) => {
    value[target] = Math.round(readPanelSize(mainApp, target));
  });
  try {
    localStorage.setItem(PANEL_LAYOUT_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Layout persistence is optional; resizing still works without storage.
  }
}

function restorePanelLayout(mainApp) {
  const saved = readStoredPanelLayout();
  Object.keys(PANEL_LIMITS).forEach((target) => {
    if (Number.isFinite(Number(saved[target]))) {
      writePanelSize(mainApp, target, Number(saved[target]));
    }
  });
}

function getPanelMaximum(mainApp, target) {
  if (target === 'sidebar' || target === 'stats') {
    const otherTarget = target === 'sidebar' ? 'stats' : 'sidebar';
    const available = mainApp.clientWidth - MAIN_HORIZONTAL_CHROME_PX - MIN_CENTER_COLUMN_PX;
    return Math.max(PANEL_LIMITS[target].min, available - readPanelSize(mainApp, otherTarget));
  }

  if (target === 'preview') {
    return Math.max(
      PANEL_LIMITS.preview.min,
      mainApp.clientHeight - MAIN_VERTICAL_CHROME_PX - MIN_BOARD_ROW_PX
    );
  }

  const boardBody = document.querySelector('.board-workspace-body');
  const width = boardBody ? boardBody.clientWidth : 0;
  return Math.max(PANEL_LIMITS.agent.min, width - MIN_BOARD_VIEWPORT_PX);
}

function clampPanelSize(mainApp, target, requestedSize) {
  const limits = PANEL_LIMITS[target];
  return Math.min(
    getPanelMaximum(mainApp, target),
    Math.max(limits.min, requestedSize)
  );
}

function clampPanelLayout(mainApp) {
  const horizontalAvailable = Math.max(
    PANEL_LIMITS.sidebar.min + PANEL_LIMITS.stats.min,
    mainApp.clientWidth - MAIN_HORIZONTAL_CHROME_PX - MIN_CENTER_COLUMN_PX
  );
  let sidebarSize = Math.max(PANEL_LIMITS.sidebar.min, readPanelSize(mainApp, 'sidebar'));
  let statsSize = Math.max(PANEL_LIMITS.stats.min, readPanelSize(mainApp, 'stats'));

  if (sidebarSize + statsSize > horizontalAvailable) {
    let overflow = sidebarSize + statsSize - horizontalAvailable;
    const sidebarRoom = sidebarSize - PANEL_LIMITS.sidebar.min;
    const statsRoom = statsSize - PANEL_LIMITS.stats.min;
    const totalRoom = sidebarRoom + statsRoom;

    if (totalRoom > 0) {
      const sidebarReduction = Math.min(sidebarRoom, overflow * (sidebarRoom / totalRoom));
      sidebarSize -= sidebarReduction;
      overflow -= sidebarReduction;
    }
    if (overflow > 0) statsSize -= Math.min(statsRoom, overflow);
  }

  writePanelSize(mainApp, 'sidebar', sidebarSize);
  writePanelSize(mainApp, 'stats', statsSize);
  writePanelSize(mainApp, 'preview', clampPanelSize(mainApp, 'preview', readPanelSize(mainApp, 'preview')));
  writePanelSize(mainApp, 'agent', clampPanelSize(mainApp, 'agent', readPanelSize(mainApp, 'agent')));
}

function updateSeparatorValue(handle, value) {
  handle.setAttribute('aria-valuemin', String(PANEL_LIMITS[handle.dataset.target].min));
  handle.setAttribute('aria-valuemax', String(Math.round(value.max)));
  handle.setAttribute('aria-valuenow', String(Math.round(value.current)));
}

function initPanelResize() {
  const mainApp = document.getElementById('main-app');
  if (!mainApp) return;

  restorePanelLayout(mainApp);
  clampPanelLayout(mainApp);

  document.querySelectorAll('.resize-handle').forEach((handle) => {
    const target = handle.dataset.target;
    const limits = PANEL_LIMITS[target];
    if (!limits) return;

    const refreshAriaValue = () => updateSeparatorValue(handle, {
      current: readPanelSize(mainApp, target),
      max: getPanelMaximum(mainApp, target)
    });
    refreshAriaValue();

    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();

      const isVertical = handle.classList.contains('resize-handle-v');
      const startPosition = isVertical ? event.clientX : event.clientY;
      const startSize = readPanelSize(mainApp, target);
      const pointerId = event.pointerId;

      handle.classList.add('is-active');
      mainApp.classList.add('is-resizing-panel');
      handle.setPointerCapture(pointerId);

      const resizeRunner = createLatestFrameRunner((point) => {
        const position = isVertical ? point.clientX : point.clientY;
        const delta = (position - startPosition) * limits.direction;
        const nextSize = clampPanelSize(mainApp, target, startSize + delta);
        writePanelSize(mainApp, target, nextSize);
        refreshAriaValue();
      });

      function onPointerMove(moveEvent) {
        if (moveEvent.pointerId !== pointerId) return;
        resizeRunner.push({ clientX: moveEvent.clientX, clientY: moveEvent.clientY });
      }

      function finishResize(endEvent) {
        if (endEvent.pointerId !== pointerId) return;
        resizeRunner.flush();
        handle.classList.remove('is-active');
        mainApp.classList.remove('is-resizing-panel');
        handle.removeEventListener('pointermove', onPointerMove);
        handle.removeEventListener('pointerup', finishResize);
        handle.removeEventListener('pointercancel', finishResize);
        if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
        persistPanelLayout(mainApp);
      }

      handle.addEventListener('pointermove', onPointerMove);
      handle.addEventListener('pointerup', finishResize);
      handle.addEventListener('pointercancel', finishResize);
    });
  });

  let resizeFrame = 0;
  window.addEventListener('resize', () => {
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      clampPanelLayout(mainApp);
      document.querySelectorAll('.resize-handle[data-target]').forEach((handle) => {
        const target = handle.dataset.target;
        if (!PANEL_LIMITS[target]) return;
        updateSeparatorValue(handle, {
          current: readPanelSize(mainApp, target),
          max: getPanelMaximum(mainApp, target)
        });
      });
      persistPanelLayout(mainApp);
    });
  });
}
