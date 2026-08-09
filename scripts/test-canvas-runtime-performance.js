'use strict';

const assert = require('assert');

const port = Math.max(1, Number(process.argv[2]) || 9333);

async function connectDebugger() {
  const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
  const target = targets.find((entry) => entry.type === 'page');
  if (!target) throw new Error(`No Electron page target on port ${port}.`);

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 0;
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  };
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });

  return {
    close: () => socket.close(),
    call(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    }
  };
}

async function measureRuntimeRefresh() {
  const debuggerClient = await connectDebugger();
  const expression = `(${(() => {
    const original = {
      files: AppState.files,
      boardItems: AppState.boardItems,
      panX: Board.panX,
      panY: Board.panY,
      zoom: Board.zoom,
      zoomLod: Board.zoomLod,
      densityOverview: Board.densityOverview,
      lastZoomBucket: Board.lastZoomBucket
    };
    const originalNodeMode = typeof CanvasNodeMode === 'undefined' ? null : CanvasNodeMode.mode;
    const boardPanel = document.getElementById('board-panel');
    const libraryView = document.getElementById('canvas-library-view');
    const workspaceBody = document.getElementById('board-workspace-body');
    const originalLibraryMode = boardPanel.classList.contains('is-canvas-library');
    const originalLibraryHidden = libraryView.hidden;
    const originalWorkspaceHidden = workspaceBody.hidden;
    try {
      boardPanel.classList.remove('is-canvas-library');
      libraryView.hidden = true;
      workspaceBody.hidden = false;
      const source = 'data:image/svg+xml,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#20242a"/></svg>'
      );
      AppState.files = Array.from({ length: 48 }, (_, index) => ({
        id: `runtime_stress_file_${index}`,
        ext: '.png',
        name: `Runtime stress ${index}`,
        url: source,
        thumbUrl: source,
        sourceWidth: 320,
        sourceHeight: 180
      }));
      AppState.boardItems = AppState.files.map((file, index) => ({
        id: `runtime_stress_item_${index}`,
        fileId: file.id,
        x: (index % 8) * 340,
        y: Math.floor(index / 8) * 200,
        width: 320,
        height: 180,
        zIndex: index + 1,
        selected: false
      }));
      if (originalNodeMode !== null) {
        CanvasNodeMode.mode = 'canvas';
        applyCanvasModeVisibility();
      }
      Board.panX = 80;
      Board.panY = 80;
      Board.zoom = 1;
      Board.zoomLod = 'detail';
      Board.densityOverview = false;
      Board.lastZoomBucket = null;
      renderBoard();
      let guard = 0;
      while (Board.mountQueue.size && guard < 100) {
        processBoardMountQueue();
        guard += 1;
      }

      const before = new Map(Board.mounted);
      const started = performance.now();
      for (let iteration = 0; iteration < 25; iteration += 1) renderBoard();
      const preserved = [...before].filter(([id, element]) => Board.mounted.get(id) === element).length;
      return {
        boardItems: AppState.boardItems.length,
        mountedBefore: before.size,
        mountedAfter: Board.mounted.size,
        preserved,
        refreshes: 25,
        durationMs: Number((performance.now() - started).toFixed(2))
      };
    } finally {
      AppState.files = original.files;
      AppState.boardItems = original.boardItems;
      Board.panX = original.panX;
      Board.panY = original.panY;
      Board.zoom = original.zoom;
      Board.zoomLod = original.zoomLod;
      Board.densityOverview = original.densityOverview;
      Board.lastZoomBucket = original.lastZoomBucket;
      if (originalNodeMode !== null) {
        CanvasNodeMode.mode = originalNodeMode;
        applyCanvasModeVisibility();
      }
      boardPanel.classList.toggle('is-canvas-library', originalLibraryMode);
      libraryView.hidden = originalLibraryHidden;
      workspaceBody.hidden = originalWorkspaceHidden;
      renderBoard();
    }
  }).toString()})()`;

  try {
    const response = await debuggerClient.call('Runtime.evaluate', {
      expression,
      returnByValue: true
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.text || 'Electron runtime evaluation failed.');
    }
    return response.result.value;
  } finally {
    debuggerClient.close();
  }
}

measureRuntimeRefresh().then((metrics) => {
  assert.ok(metrics && Number.isFinite(metrics.durationMs));
  assert.ok(metrics.mountedBefore > 0,
    'Runtime refresh test could not mount a focused board region.');
  assert.strictEqual(metrics.preserved, metrics.mountedBefore,
    'Repeated board refreshes replaced mounted elements and can flash decoded media.');
  process.stdout.write(`Canvas runtime refresh test passed. ${JSON.stringify(metrics)}\n`);
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
