'use strict';

let boardImageCrop = null;
let boardImageCropBundle = null;

function loadBoardImageCropPlugin() {
  if (!boardImageCropBundle) {
    boardImageCropBundle = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'vendor/canvas-crop.js';
      script.onload = resolve;
      script.onerror = () => { script.remove(); boardImageCropBundle = null; reject(new Error('Crop editor could not be loaded.')); };
      document.head.append(script);
    });
  }
  return boardImageCropBundle;
}

function closeBoardImageCrop() {
  const state = boardImageCrop;
  if (!state || state.saving) return;
  boardImageCrop = null;
  state.abort.abort();
  state.observer?.disconnect();
  state.app?.destroy();
  state.image.src = '';
  state.overlay.remove();
}

async function openBoardImageCrop(file, item) {
  if (boardImageCrop?.saving) return;
  closeBoardImageCrop();
  closeBoardButlerExpandEditor();
  if (typeof cancelBoardViewportMotion === 'function') cancelBoardViewportMotion();
  const viewport = document.getElementById('board-viewport');
  if (!viewport || !file?.url || !item) return;
  const overlay = document.createElement('div');
  overlay.className = 'board-image-crop';
  overlay.dataset.boardUiLayer = 'true';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', t('Crop image', '图片裁切'));
  const surface = document.createElement('div'); surface.className = 'board-image-crop-surface';
  const toolbar = document.createElement('div'); toolbar.className = 'board-image-crop-toolbar';
  toolbar.setAttribute('role', 'toolbar'); toolbar.setAttribute('aria-label', t('Crop controls', '裁切工具'));
  const label = document.createElement('span'); label.title = t('Crop image', '图片裁切');
  const cropIcon = document.createElement('img'); cropIcon.src = 'assets/icons/lucide/crop.svg'; cropIcon.alt = ''; label.append(cropIcon);
  const ratios = document.createElement('select'); ratios.setAttribute('aria-label', t('Aspect ratio', '裁切比例'));
  for (const [value, title] of [['', t('Free', '自由')], ['original', t('Original', '原比例')], ['1:1', '1:1'], ['4:3', '4:3'], ['3:4', '3:4'], ['16:9', '16:9'], ['9:16', '9:16']]) {
    const option = document.createElement('option'); option.value = value; option.textContent = title; ratios.append(option);
  }
  const status = document.createElement('output'); status.textContent = t('Loading...', '加载中...');
  const action = (icon, title) => {
    const button = document.createElement('button'); button.type = 'button'; button.title = title; button.setAttribute('aria-label', title);
    const image = document.createElement('img'); image.src = `assets/icons/lucide/${icon}.svg`; image.alt = ''; button.append(image); return button;
  };
  const reset = action('rotate-ccw', t('Reset', '重置'));
  const cancel = action('x', t('Cancel', '取消'));
  const apply = action('check', t('Apply crop', '确认裁切'));
  apply.className = 'is-primary';
  const applyLabel = document.createElement('span'); applyLabel.textContent = t('Done', '完成'); apply.append(applyLabel);
  label.className = 'board-image-crop-title';
  status.className = 'board-image-crop-size';
  ratios.disabled = reset.disabled = apply.disabled = true;
  const divider = document.createElement('span'); divider.className = 'board-image-crop-divider'; divider.setAttribute('aria-hidden', 'true');
  toolbar.classList.toggle('is-compact', viewport.clientWidth < 420);
  toolbar.append(label, ratios, status, divider, reset, cancel, apply);
  toolbar.style.left = '12px'; toolbar.style.top = '12px';
  overlay.append(surface, toolbar); viewport.append(overlay);
  const state = { overlay, image: new Image(), abort: new AbortController(), app: null, saving: false, canvasId: activeCanvasId() };
  boardImageCrop = state;
  const signal = state.abort.signal;
  cancel.addEventListener('click', closeBoardImageCrop);
  window.addEventListener('keydown', event => {
    event.stopImmediatePropagation();
    if (event.key === 'Escape') { event.preventDefault(); closeBoardImageCrop(); }
    if (event.key === 'Enter' && !event.repeat && !['SELECT', 'BUTTON'].includes(document.activeElement?.tagName)) {
      event.preventDefault(); if (!apply.disabled) apply.click();
    }
  }, { capture: true, signal });
  overlay.addEventListener('wheel', event => {
    event.preventDefault(); event.stopImmediatePropagation();
    if (!state.zoomAt || state.saving || toolbar.contains(event.target)) return;
    const rect = viewport.getBoundingClientRect();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
    state.zoomAt(event.clientX - rect.left, event.clientY - rect.top, Math.exp(-Math.max(-160, Math.min(160, delta)) * .002));
  }, { passive: false, capture: true, signal });
  try {
    state.image.crossOrigin = 'anonymous';
    state.image.src = file.url;
    await Promise.all([loadBoardImageCropPlugin(), state.image.decode()]);
    if (signal.aborted) return;
    const sw = state.image.naturalWidth, sh = state.image.naturalHeight;
    if (!sw || !sh || sw * sh > 40000000) throw new Error(t('This image exceeds the 40 MP crop limit.', '这张图片超出 4000 万像素裁切上限。'));
    const bounds = boardItemBounds(item);
    const scale = Math.min(bounds.w * Board.zoom / sw, (viewport.clientWidth - 48) / sw, (viewport.clientHeight - 120) / sh);
    if (!(scale > 0)) throw new Error(t('The canvas is too small.', '画布视窗过小。'));
    const width = sw * scale, height = sh * scale;
    const x = Math.max(24, Math.min(viewport.clientWidth - width - 24, bounds.x * Board.zoom + Board.panX));
    const y = Math.max(70, Math.min(viewport.clientHeight - height - 24, bounds.y * Board.zoom + Board.panY));
    const accent = getComputedStyle(viewport).getPropertyValue('--accent').trim() || '#53b8dd';
    const app = state.app = new MesssCanvasCrop.App({ view: surface, width: viewport.clientWidth, height: viewport.clientHeight,
      tree: {}, sky: {}, editor: { stroke: accent, pointSize: 7, rotateable: false, skewable: false, keyEvent: true, buttons: [] } });
    const { ClipImage, ClipResizeEditor } = MesssCanvasCrop;
    // The plugin normally pans the source bitmap. Move the aperture instead,
    // compensating the inner image so its world position remains unchanged.
    if (!ClipResizeEditor.prototype.messsFrameDrag) {
      ClipResizeEditor.prototype.messsFrameDrag = true;
      ClipResizeEditor.prototype.onMove = function(event) {
        const image = this.clipInner, frame = this.clipUI;
        const zoom = this.editor.app.tree.scaleX || 1;
        const dx = Math.max(image.x, Math.min(image.x + image.width - frame.width, (event.moveX || 0) / zoom));
        const dy = Math.max(image.y, Math.min(image.y + image.height - frame.height, (event.moveY || 0) / zoom));
        this.editor.app.lockLayout();
        frame.x += dx; frame.y += dy;
        image.x -= dx; image.y -= dy;
        this.editor.app.unlockLayout();
        this.onUpdate();
      };
    }
    ClipImage.setEditInner(ClipResizeEditor.prototype.tag);
    const node = state.node = new ClipImage({ url: file.url, x, y, width, height, editable: true });
    app.tree.add(node);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (signal.aborted) return;
    app.editor.openInnerEditor(node, true);
    const positionToolbar = () => {
      const zoom = app.tree.scaleX || 1;
      const rect = { x: node.x * zoom + app.tree.x, y: node.y * zoom + app.tree.y,
        width: node.width * zoom, height: node.height * zoom };
      const tw = toolbar.offsetWidth, th = toolbar.offsetHeight;
      const margin = 12, gap = 12;
      const left = Math.max(margin, Math.min(viewport.clientWidth - tw - margin, rect.x + rect.width / 2 - tw / 2));
      const below = rect.y + rect.height + gap;
      const top = below + th <= viewport.clientHeight - margin ? below : rect.y - th - gap;
      toolbar.style.left = `${left}px`;
      toolbar.style.top = `${Math.max(margin, Math.min(viewport.clientHeight - th - margin, top))}px`;
    };
    const updateStatus = () => {
      status.textContent = `${Math.max(1, Math.round(node.width / scale))} × ${Math.max(1, Math.round(node.height / scale))}`;
      positionToolbar();
    };
    const camera = { zoom: Board.zoom, panX: Board.panX, panY: Board.panY };
    state.zoomAt = (px, py, factor) => {
      if (app.editor.innerEditor?.myEditBox.dragging) return;
      const oldZoom = Board.zoom;
      const minZoom = typeof BOARD_ZOOM_MIN === 'number' ? BOARD_ZOOM_MIN : .1;
      const maxZoom = typeof BOARD_ZOOM_MAX === 'number' ? BOARD_ZOOM_MAX : 4;
      const zoom = Math.max(minZoom, Math.min(maxZoom, oldZoom * factor));
      const ratio = zoom / oldZoom;
      Board.panX = px - (px - Board.panX) * ratio;
      Board.panY = py - (py - Board.panY) * ratio;
      Board.zoom = zoom;
      if (typeof applyBoardTransformNow === 'function') applyBoardTransformNow();
      if (typeof scheduleBoardViewportSave === 'function') scheduleBoardViewportSave();
      const relative = zoom / camera.zoom;
      app.tree.set({ scaleX: relative, scaleY: relative,
        x: Board.panX - camera.panX * relative, y: Board.panY - camera.panY * relative });
      app.editor.innerEditor?.onUpdate();
      positionToolbar();
    };
    node.on(MesssCanvasCrop.PropertyEvent.CHANGE, updateStatus);
    updateStatus();
    ratios.disabled = reset.disabled = apply.disabled = false;
    ratios.addEventListener('change', () => {
      const inner = app.editor.innerEditor;
      if (!inner) return;
      node.lockRatio = !!ratios.value;
      if (ratios.value) inner.updateClipRatio(ratios.value === 'original' ? `${sw}:${sh}` : ratios.value);
      updateStatus();
    });
    reset.addEventListener('click', () => { app.editor.innerEditor?.reset(); ratios.value = ''; node.lockRatio = false; updateStatus(); });
    apply.addEventListener('click', async () => {
      if (state.saving) return;
      state.saving = true;
      ratios.disabled = reset.disabled = apply.disabled = cancel.disabled = true;
      status.textContent = t('Saving...', '保存中...');
      try {
        app.editor.closeInnerEditor();
        node.visible = true;
        if (node.width * node.height / (scale * scale) > 40000000) throw new Error(t('Crop area is too large.', '裁切区域过大。'));
        const exported = await node.export('png', { pixelRatio: 1 / scale, trim: false });
        const result = await window.messsAPI.importCroppedImage({ dataUrl: exported.data, canvasId: state.canvasId, folderId: AppState.activeFolderId });
        if (!result?.ok || !result.file) throw new Error(t('Could not save the cropped image.', '裁切图片保存失败。'));
        AppState.files = [result.file, ...AppState.files.filter(entry => entry.id !== result.file.id)];
        if (state.canvasId === activeCanvasId()) {
          await addFileToBoard(result.file.id, bounds.x + bounds.w + 32, bounds.y, { partitionId: item.partitionId });
        }
        if (typeof renderFileList === 'function') renderFileList(currentFileListScope());
        state.saving = false;
        closeBoardImageCrop();
        showToast(t('Cropped image saved. Original preserved.', '裁切图片已保存，原图已保留。'));
      } catch (error) {
        state.saving = false;
        ratios.disabled = reset.disabled = apply.disabled = cancel.disabled = false;
        app.editor.openInnerEditor(node, true);
        status.textContent = t('Not saved', '未保存');
        showToast(error.message || t('Crop failed.', '裁切失败。'));
      }
    });
    const vw = viewport.clientWidth, vh = viewport.clientHeight;
    state.observer = new ResizeObserver(() => {
      if (!overlay.isConnected || viewport.clientWidth !== vw || viewport.clientHeight !== vh) closeBoardImageCrop();
    });
    state.observer.observe(viewport);
  } catch (error) {
    if (!signal.aborted) { closeBoardImageCrop(); showToast(error.message || t('Crop editor failed.', '裁切编辑器加载失败。')); }
  }
}
