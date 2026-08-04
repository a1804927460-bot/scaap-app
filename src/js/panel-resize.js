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
const SIDEBAR_COMPACT_MAX_PX = 230;
const SIDEBAR_MINIMAL_MAX_PX = 200;

function updateSidebarDensity(sidebar) {
  if (!sidebar) return;
  const width = sidebar.getBoundingClientRect().width;
  sidebar.classList.toggle('is-density-compact', width <= SIDEBAR_COMPACT_MAX_PX);
  sidebar.classList.toggle('is-density-minimal', width <= SIDEBAR_MINIMAL_MAX_PX);
}

function readPanelSize(mainApp, target) {
  const limits = PANEL_LIMITS[target];
  const raw = parseFloat(getComputedStyle(mainApp).getPropertyValue(limits.cssVar));
  return Number.isFinite(raw) ? raw : limits.defaultPx;
}

function writePanelSize(mainApp, target, value) {
  const limits = PANEL_LIMITS[target];
  const normalized = Math.round(value * 2) / 2;
  const previous = parseFloat(mainApp.style.getPropertyValue(limits.cssVar));
  if (Number.isFinite(previous) && Math.abs(previous - normalized) < 0.25) return;
  mainApp.style.setProperty(limits.cssVar, `${normalized}px`);
}

function lastCoalescedPointer(event) {
  if (typeof event.getCoalescedEvents !== 'function') return event;
  const points = event.getCoalescedEvents();
  return points.length ? points[points.length - 1] : event;
}

function setPanelResizeCursor(mainApp, cursor) {
  if (cursor) mainApp.dataset.resizeCursor = cursor;
  else delete mainApp.dataset.resizeCursor;
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
  const originalSidebarSize = readPanelSize(mainApp, 'sidebar');
  const originalStatsSize = readPanelSize(mainApp, 'stats');
  const originalPreviewSize = readPanelSize(mainApp, 'preview');
  const originalAgentSize = readPanelSize(mainApp, 'agent');
  let sidebarSize = Math.max(PANEL_LIMITS.sidebar.min, originalSidebarSize);
  let statsSize = Math.max(PANEL_LIMITS.stats.min, originalStatsSize);

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

  const previewSize = clampPanelSize(mainApp, 'preview', originalPreviewSize);
  const agentSize = clampPanelSize(mainApp, 'agent', originalAgentSize);
  if (Math.abs(sidebarSize - originalSidebarSize) > 0.5) writePanelSize(mainApp, 'sidebar', sidebarSize);
  if (Math.abs(statsSize - originalStatsSize) > 0.5) writePanelSize(mainApp, 'stats', statsSize);
  if (Math.abs(previewSize - originalPreviewSize) > 0.5) writePanelSize(mainApp, 'preview', previewSize);
  if (Math.abs(agentSize - originalAgentSize) > 0.5) writePanelSize(mainApp, 'agent', agentSize);
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

  const sidebar = document.getElementById('sidebar');
  updateSidebarDensity(sidebar);
  if (sidebar && typeof ResizeObserver !== 'undefined') {
    const sidebarDensityObserver = new ResizeObserver(() => updateSidebarDensity(sidebar));
    sidebarDensityObserver.observe(sidebar);
  }

  document.querySelectorAll('.resize-handle').forEach((handle) => {
    if (handle.classList.contains('resize-handle-corner')) return;
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
      const maximumSize = getPanelMaximum(mainApp, target);
      const pointerId = event.pointerId;

      handle.classList.add('is-active');
      mainApp.classList.add('is-resizing-panel');
      setPanelResizeCursor(mainApp, isVertical ? 'col' : 'row');
      handle.setPointerCapture(pointerId);

      const resizeRunner = createLatestFrameRunner((point) => {
        const position = isVertical ? point.clientX : point.clientY;
        const delta = (position - startPosition) * limits.direction;
        const nextSize = Math.min(maximumSize, Math.max(limits.min, startSize + delta));
        writePanelSize(mainApp, target, nextSize);
      });

      function onPointerMove(moveEvent) {
        if (moveEvent.pointerId !== pointerId) return;
        const point = lastCoalescedPointer(moveEvent);
        resizeRunner.push({ clientX: point.clientX, clientY: point.clientY });
      }

      let finished = false;
      function finishResize(endEvent) {
        if (finished || endEvent.pointerId !== pointerId) return;
        finished = true;
        resizeRunner.flush();
        handle.classList.remove('is-active');
        mainApp.classList.remove('is-resizing-panel');
        setPanelResizeCursor(mainApp, '');
        handle.removeEventListener('pointermove', onPointerMove);
        handle.removeEventListener('pointerup', finishResize);
        handle.removeEventListener('pointercancel', finishResize);
        handle.removeEventListener('lostpointercapture', finishResize);
        if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
        refreshAriaValue();
        persistPanelLayout(mainApp);
      }

      handle.addEventListener('pointermove', onPointerMove);
      handle.addEventListener('pointerup', finishResize);
      handle.addEventListener('pointercancel', finishResize);
      handle.addEventListener('lostpointercapture', finishResize);
    });
  });

  document.querySelectorAll('.resize-handle-corner').forEach((handle) => {
    const [horizontalTarget, verticalTarget] = String(handle.dataset.targets || '').split(',');
    if (!PANEL_LIMITS[horizontalTarget] || verticalTarget !== 'preview') return;
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      const startHorizontal = readPanelSize(mainApp, horizontalTarget);
      const startPreview = readPanelSize(mainApp, 'preview');
      const maximumHorizontal = getPanelMaximum(mainApp, horizontalTarget);
      const maximumPreview = getPanelMaximum(mainApp, 'preview');
      handle.classList.add('is-active');
      mainApp.classList.add('is-resizing-panel');
      setPanelResizeCursor(mainApp, handle.id === 'resize-corner-right' ? 'nesw' : 'nwse');
      handle.setPointerCapture(pointerId);

      const resizeRunner = createLatestFrameRunner((point) => {
        const horizontalDelta = (point.clientX - startX) * PANEL_LIMITS[horizontalTarget].direction;
        const horizontalSize = Math.min(
          maximumHorizontal,
          Math.max(PANEL_LIMITS[horizontalTarget].min, startHorizontal + horizontalDelta)
        );
        const previewSize = Math.min(
          maximumPreview,
          Math.max(PANEL_LIMITS.preview.min, startPreview + point.clientY - startY)
        );
        writePanelSize(mainApp, horizontalTarget, horizontalSize);
        writePanelSize(mainApp, 'preview', previewSize);
      });
      const move = (moveEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        const point = lastCoalescedPointer(moveEvent);
        resizeRunner.push({ clientX: point.clientX, clientY: point.clientY });
      };
      let finished = false;
      const finish = (endEvent) => {
        if (finished || endEvent.pointerId !== pointerId) return;
        finished = true;
        resizeRunner.flush();
        handle.classList.remove('is-active');
        mainApp.classList.remove('is-resizing-panel');
        setPanelResizeCursor(mainApp, '');
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', finish);
        handle.removeEventListener('pointercancel', finish);
        handle.removeEventListener('lostpointercapture', finish);
        if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
        persistPanelLayout(mainApp);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', finish);
      handle.addEventListener('pointercancel', finish);
      handle.addEventListener('lostpointercapture', finish);
    });
  });

  let resizeFrame = 0;
  window.addEventListener('resize', () => {
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      clampPanelLayout(mainApp);
      updateSidebarDensity(sidebar);
      document.querySelectorAll('.resize-handle[data-target]').forEach((handle) => {
        const target = handle.dataset.target;
        if (!PANEL_LIMITS[target]) return;
        updateSeparatorValue(handle, {
          current: readPanelSize(mainApp, target),
          max: getPanelMaximum(mainApp, target)
        });
      });
    });
  });
}
