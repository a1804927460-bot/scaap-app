'use strict';

/* Drawflow-backed workflow view. The graph stores library file IDs, but never
   ordinary canvas item IDs, so deleting or arranging either view cannot alter
   the other one. */

const CanvasNodeMode = {
  mode: 'canvas',
  editor: null,
  canvasId: null,
  loading: false,
  saveTimer: 0,
  runningNodes: new Set(),
  panPointerId: null,
  panStart: null,
  panPoint: null,
  panFrame: 0,
  spacePressed: false,
  selectedNodeId: null,
  selectedNodeIds: new Set(),
  selectedConnection: null,
  connectionObserver: null,
  connectionDraft: null,
  inputConnectionDraft: null,
  connectionPointer: null,
  portMagnetFrame: 0,
  portMagnetPoint: null,
  magneticPort: null,
  connectionMenu: null,
  addMenuPosition: null,
  textEditor: null,
  textEditorNodeId: null,
  marqueePointerId: null,
  marqueeStart: null,
  marqueePoint: null,
  marqueeElement: null,
  marqueeInitialSelection: new Set()
};

const CANVAS_NODE_MODE_KEY = 'messs.canvas.mode.v1';
const CANVAS_NODE_LAYOUT_KEY = 'messs.canvas.nodes.v2';

const NODE_ICONS = {
  text: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6V4h14v2M12 4v16M8 20h8"/></svg>',
  image: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m3 17 5-5 4 4 3-3 6 6"/></svg>',
  video: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="14" height="14" rx="2"/><path d="m17 10 4-2v8l-4-2z"/></svg>',
  audio: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 10v4"/></svg>',
  model: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></svg>',
  generate: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.3 4.1L17 9l-3.7 1.9L12 15l-1.3-4.1L7 9l3.7-1.9L12 3Z"/><path d="m18.5 14 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z"/></svg>'
};

function canvasNodeLayoutKey(canvasId = activeCanvasId()) {
  return `${CANVAS_NODE_LAYOUT_KEY}.${encodeURIComponent(canvasId)}`;
}

function canvasNodeMediaKind(file) {
  if (!file) return null;
  if (typeof isModelFile === 'function' && isModelFile(file)) return 'model';
  if (isImageExt(file.ext)) return 'image';
  if (isVideoExt(file.ext)) return 'video';
  if (typeof isAudioExt === 'function' && isAudioExt(file.ext)) return 'audio';
  return null;
}

function canvasNodeMediaRatio(file, fallback = 16 / 9) {
  const width = Number(file && (file.sourceWidth || file.width));
  const height = Number(file && (file.sourceHeight || file.height));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return fallback;
  return width / height;
}

function canvasNodeMediaStyle(file, fallback) {
  return ` style="--canvas-node-media-ratio:${canvasNodeMediaRatio(file, fallback).toFixed(4)}"`;
}

function canvasNodeMediaMarkup(item, file) {
  const kind = canvasNodeMediaKind(file);
  const title = String(file && file.name || t('Untitled media', '未命名媒体', '제목 없는 미디어'));
  const source = String(file && (
    kind === 'model' ? file.modelPreviewUrl || file.previewUrl || file.thumbUrl :
      file.thumbUrl || (kind === 'image' ? file.url : '')
  ) || '');
  const preview = source
    ? `<img src="${escapeHtml(source)}" alt="" draggable="false" />`
    : `<span class="canvas-node-placeholder">${NODE_ICONS[kind] || NODE_ICONS.image}</span>`;
  const typeLabels = {
    image: t('Image', '图片', '이미지'),
    video: t('Video', '视频', '비디오'),
    audio: t('Audio', '音频', '오디오'),
    model: '3D'
  };
  const typeLabel = typeLabels[kind] || t('File', '文件', '파일');
  return `<article class="canvas-media-node canvas-media-node-${kind}" title="${escapeHtml(title)}">
    <header class="canvas-media-node-label"><span class="canvas-node-title-icon">${NODE_ICONS[kind]}<b>${escapeHtml(typeLabel)}</b></span>
      <button class="canvas-node-open nodrag" type="button" data-node-file-id="${escapeHtml(file.id)}" title="${escapeHtml(t('Open preview', '放大查看', '미리보기 열기'))}" aria-label="${escapeHtml(t('Open preview', '放大查看', '미리보기 열기'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg></button>
    </header>
    <div class="canvas-node-preview"${canvasNodeMediaStyle(file, kind === 'model' || kind === 'audio' ? 1 : 16 / 9)}>${preview}${kind === 'video' ? `<i class="canvas-node-video-mark">${NODE_ICONS.video}</i>` : ''}</div>
  </article>`;
}

function canvasTextNodeMarkup(data = {}) {
  return `<article class="canvas-flow-node canvas-text-node" data-node-action="text" role="button" tabindex="0" title="${escapeHtml(t('Edit text prompt', '编辑文本提示词', '텍스트 프롬프트 편집'))}" aria-label="${escapeHtml(t('Edit text prompt', '编辑文本提示词', '텍스트 프롬프트 편집'))}">
    <header><span class="canvas-node-title-icon">${NODE_ICONS.text}<b>${escapeHtml(t('Text prompt', '文本提示词', '텍스트 프롬프트'))}</b></span></header>
    <textarea class="canvas-node-textarea nodrag" df-text rows="5" placeholder="${escapeHtml(t('Describe the image or video...', '描述要生成的图片或视频...', '생성할 이미지나 비디오를 설명하세요...'))}">${escapeHtml(data.text || '')}</textarea>
    <footer>${escapeHtml(t('Connect this to a generation node', '连接到生成节点', '생성 노드에 연결하세요'))}</footer>
  </article>`;
}

function canvasGenerateResultsMarkup(data = {}) {
  const fileIds = Array.isArray(data.lastOutputFileIds) ? data.lastOutputFileIds : [];
  const files = fileIds
    .map((fileId) => AppState.files.find((file) => file.id === fileId))
    .filter(Boolean);
  if (!files.length) return '';
  const items = files.map((file) => {
    const kind = isVideoExt(file.ext) ? 'video' : 'image';
    const thumbnail = String(file.thumbUrl || '');
    const source = String(thumbnail || file.url || '');
    const preview = source
      ? (kind === 'video' && !thumbnail
        ? `<video src="${escapeHtml(source)}" muted playsinline preload="metadata"></video>`
        : `<img src="${escapeHtml(source)}" alt="" draggable="false" />`)
      : `<span class="canvas-node-placeholder">${kind === 'video' ? NODE_ICONS.video : NODE_ICONS.image}</span>`;
    return `<button type="button" class="canvas-generate-result canvas-generate-result-${kind} nodrag"${canvasNodeMediaStyle(file, 16 / 9)} data-node-file-id="${escapeHtml(file.id)}" title="${escapeHtml(file.name || '')}">${preview}${kind === 'video' ? `<i>${NODE_ICONS.video}</i>` : ''}</button>`;
  }).join('');
  return `<div class="canvas-generate-results" data-count="${Math.min(files.length, 4)}">${items}</div>`;
}

function canvasGenerateNodeMarkup(kind, data = {}) {
  const isVideo = kind === 'video';
  const label = isVideo
    ? t('Video generation', '视频生成', '비디오 생성')
    : t('Image generation', '图片生成', '이미지 생성');
  const results = canvasGenerateResultsMarkup(data);
  const emptyPreview = `<div class="canvas-generate-empty">${isVideo ? NODE_ICONS.video : NODE_ICONS.image}<span>${escapeHtml(t('Click to configure', '点击配置生成', '설정하려면 클릭'))}</span></div>`;
  return `<article class="canvas-flow-node canvas-generate-node" data-generate-kind="${kind}" data-node-action="settings" role="button" tabindex="0" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">
    <header><span class="canvas-node-title-icon">${isVideo ? NODE_ICONS.video : NODE_ICONS.generate}<b>${escapeHtml(label)}</b></span><i class="canvas-node-status" data-node-status>${escapeHtml(t('Ready', '就绪', '준비'))}</i></header>
    <div class="canvas-generate-preview">${results || emptyPreview}</div>
  </article>`;
}

function readCanvasNodeLayout(canvasId) {
  try {
    const saved = JSON.parse(localStorage.getItem(canvasNodeLayoutKey(canvasId)) || 'null');
    return saved && saved.drawflow && saved.drawflow.Home ? saved : null;
  } catch (error) {
    return null;
  }
}

function saveCanvasNodeLayout() {
  if (!CanvasNodeMode.editor || CanvasNodeMode.loading || !CanvasNodeMode.canvasId) return;
  clearTimeout(CanvasNodeMode.saveTimer);
  CanvasNodeMode.saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(canvasNodeLayoutKey(CanvasNodeMode.canvasId), JSON.stringify(CanvasNodeMode.editor.export()));
    } catch (error) {}
  }, 180);
}

function canvasNodeData() {
  if (!CanvasNodeMode.editor) return {};
  const drawflow = CanvasNodeMode.editor.drawflow;
  return drawflow && drawflow.drawflow && drawflow.drawflow.Home
    ? drawflow.drawflow.Home.data || {}
    : {};
}

function nextCanvasNodePosition(index) {
  const host = document.getElementById('board-node-mode');
  const columns = Math.max(2, Math.floor(((host && host.clientWidth) || 900) / 310));
  return { x: 70 + (index % columns) * 290, y: 70 + Math.floor(index / columns) * 245 };
}

function canvasNodeCenterPosition() {
  const editor = CanvasNodeMode.editor;
  const host = document.getElementById('board-node-editor');
  const zoom = Math.max(0.01, Number(editor && editor.zoom) || 1);
  return {
    x: Math.round((((host && host.clientWidth) || 900) / 2 - (editor ? editor.canvas_x : 0)) / zoom - 130),
    y: Math.round((((host && host.clientHeight) || 600) / 2 - (editor ? editor.canvas_y : 0)) / zoom - 100)
  };
}

function saveCanvasTextEditor() {
  const editorElement = CanvasNodeMode.textEditor;
  const nodeId = CanvasNodeMode.textEditorNodeId;
  const node = nodeId && canvasNodeData()[String(nodeId)];
  if (!editorElement || !node || !node.data || node.data.nodeRole !== 'text') return;
  const value = String(editorElement.querySelector('textarea')?.value || '');
  CanvasNodeMode.editor.updateNodeDataFromId(String(nodeId), { ...node.data, text: value });
  const hiddenInput = document.querySelector(`#node-${nodeId} textarea[df-text]`);
  if (hiddenInput) hiddenInput.value = value;
  saveCanvasNodeLayout();
}

function closeCanvasTextEditor(options = {}) {
  if (!CanvasNodeMode.textEditor) return;
  if (options.save !== false) saveCanvasTextEditor();
  CanvasNodeMode.textEditor.remove();
  CanvasNodeMode.textEditor = null;
  CanvasNodeMode.textEditorNodeId = null;
}

function openCanvasTextEditor(nodeId) {
  const id = String(nodeId);
  const node = canvasNodeData()[id];
  const mode = document.getElementById('board-node-mode');
  if (!node || !node.data || node.data.nodeRole !== 'text' || !mode) return;
  closeCanvasTextEditor();
  if (typeof closeAiImagePopover === 'function') closeAiImagePopover();
  const editorElement = document.createElement('section');
  editorElement.className = 'board-node-text-editor';
  editorElement.setAttribute('role', 'dialog');
  editorElement.setAttribute('aria-label', t('Text prompt', '文本提示词', '텍스트 프롬프트'));
  editorElement.innerHTML = `<form>
    <div class="board-node-text-editor-heading">
      <span class="canvas-node-title-icon">${NODE_ICONS.text}<b>${escapeHtml(t('Text prompt', '文本提示词', '텍스트 프롬프트'))}</b></span>
      <button type="button" data-text-editor-close title="${escapeHtml(t('Close', '关闭', '닫기'))}" aria-label="${escapeHtml(t('Close', '关闭', '닫기'))}">×</button>
    </div>
    <textarea rows="5" spellcheck="false" placeholder="${escapeHtml(t('Describe the image or video...', '描述要生成的图片或视频...', '생성할 이미지나 비디오를 설명하세요...'))}">${escapeHtml(node.data.text || '')}</textarea>
    <button type="submit" class="board-node-text-editor-submit" title="${escapeHtml(t('Save prompt', '保存提示词', '프롬프트 저장'))}" aria-label="${escapeHtml(t('Save prompt', '保存提示词', '프롬프트 저장'))}">↑</button>
  </form>`;
  editorElement.querySelector('form').addEventListener('submit', (event) => {
    event.preventDefault();
    closeCanvasTextEditor();
  });
  editorElement.querySelector('[data-text-editor-close]').addEventListener('click', () => closeCanvasTextEditor());
  editorElement.querySelector('textarea').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      closeCanvasTextEditor();
    }
  });
  mode.appendChild(editorElement);
  CanvasNodeMode.textEditor = editorElement;
  CanvasNodeMode.textEditorNodeId = id;
  window.requestAnimationFrame(() => editorElement.querySelector('textarea')?.focus());
}

function addCanvasWorkflowNode(role, kind = null, positionOverride = null) {
  const editor = ensureCanvasNodeEditor();
  const position = positionOverride || canvasNodeCenterPosition();
  const offset = positionOverride ? 0 : Object.keys(canvasNodeData()).length % 5 * 18;
  let id;
  if (role === 'text') {
    id = editor.addNode('text-prompt', 0, 1, position.x + offset, position.y + offset, 'messs-flow-node messs-text-node', {
      nodeRole: 'text', text: ''
    }, canvasTextNodeMarkup(), false);
  } else {
    const mediaKind = kind === 'video' ? 'video' : 'image';
    id = editor.addNode(`generate-${mediaKind}`, 1, 1, position.x + offset, position.y + offset, 'messs-flow-node messs-generate-node', {
      nodeRole: 'generate', kind: mediaKind, prompt: '', lastOutputFileIds: []
    }, canvasGenerateNodeMarkup(mediaKind), false);
  }
  const empty = document.getElementById('board-node-empty');
  if (empty) empty.hidden = true;
  saveCanvasNodeLayout();
  if (role === 'text') window.setTimeout(() => openCanvasTextEditor(id), 0);
  return id;
}

function reconcileCanvasNodes() {
  const editor = CanvasNodeMode.editor;
  if (!editor || CanvasNodeMode.canvasId !== activeCanvasId()) return;
  const nodes = canvasNodeData();

  CanvasNodeMode.loading = true;
  Object.entries(nodes).forEach(([nodeId, node]) => {
    const data = node && node.data || {};
    const role = data.nodeRole;
    if (role === 'text') return;
    if (role === 'generate') {
      const validOutputIds = Array.isArray(data.lastOutputFileIds)
        ? data.lastOutputFileIds.filter((fileId) => AppState.files.some((file) => file.id === fileId))
        : [];
      const nextData = { ...data, lastOutputFileIds: validOutputIds };
      if (validOutputIds.length !== (data.lastOutputFileIds || []).length) {
        editor.updateNodeDataFromId(nodeId, nextData);
      }
      const content = document.querySelector(`#node-${nodeId} .drawflow_content_node`);
      if (content) content.innerHTML = canvasGenerateNodeMarkup(data.kind, nextData);
      return;
    }
    if (role !== 'media' || !data.fileId) {
      editor.removeNodeId(`node-${nodeId}`);
      return;
    }
    const file = AppState.files.find((entry) => entry.id === data.fileId);
    const kind = canvasNodeMediaKind(file);
    if (!file || !kind) {
      editor.removeNodeId(`node-${nodeId}`);
      return;
    }
    const nextData = { ...data, nodeRole: 'media', mediaKind: kind };
    if (data.mediaKind !== kind) editor.updateNodeDataFromId(nodeId, nextData);
    const content = document.querySelector(`#node-${nodeId} .drawflow_content_node`);
    if (content) content.innerHTML = canvasNodeMediaMarkup(nextData, file);
  });
  CanvasNodeMode.loading = false;

  const empty = document.getElementById('board-node-empty');
  if (empty) empty.hidden = Object.keys(canvasNodeData()).length > 0;
  saveCanvasNodeLayout();
}

function canvasNodeByFileId(fileId) {
  return Object.entries(canvasNodeData()).find(([, node]) => node && node.data && node.data.fileId === fileId);
}

function upstreamCanvasNodes(nodeId) {
  const nodes = canvasNodeData();
  const found = [];
  const visited = new Set([String(nodeId)]);
  const visit = (currentId) => {
    const node = nodes[String(currentId)];
    if (!node) return;
    Object.values(node.inputs || {}).forEach((input) => {
      (input.connections || []).forEach((connection) => {
        const sourceId = String(connection.node);
        if (visited.has(sourceId)) return;
        visited.add(sourceId);
        if (nodes[sourceId]) found.push([sourceId, nodes[sourceId]]);
        visit(sourceId);
      });
    });
  };
  visit(String(nodeId));
  return found;
}

function canvasGenerationInputs(nodeId) {
  const node = canvasNodeData()[String(nodeId)];
  const upstream = upstreamCanvasNodes(nodeId);
  const promptParts = [String(node && node.data && node.data.prompt || '').trim()];
  const referenceFileIds = [];
  upstream.forEach(([, source]) => {
    const data = source.data || {};
    if (data.nodeRole === 'text' && String(data.text || '').trim()) promptParts.push(String(data.text).trim());
    if (data.nodeRole === 'media' && (data.mediaKind === 'image' || data.mediaKind === 'video') && data.fileId) {
      referenceFileIds.push(data.fileId);
    }
  });
  return {
    prompt: promptParts.filter(Boolean).join('\n\n'),
    referenceFileIds: [...new Set(referenceFileIds)]
  };
}

function setCanvasNodeRunState(nodeId, state, message) {
  const element = document.getElementById(`node-${nodeId}`);
  if (!element) return;
  element.classList.toggle('is-running', state === 'running');
  element.classList.toggle('has-error', state === 'error');
  const status = element.querySelector('[data-node-status]');
  if (status) status.textContent = message;
  element.querySelectorAll('[data-node-action]').forEach((button) => {
    if (button.dataset.nodeAction === 'run') button.disabled = state === 'running';
  });
}

async function runCanvasGenerationNode(nodeId) {
  const id = String(nodeId);
  if (CanvasNodeMode.runningNodes.has(id)) return;
  const node = canvasNodeData()[id];
  if (!node || !node.data || node.data.nodeRole !== 'generate') return;
  const inputs = canvasGenerationInputs(id);
  if (!inputs.prompt) {
    setCanvasNodeRunState(id, 'error', t('Prompt required', '需要提示词', '프롬프트 필요'));
    const textarea = document.querySelector(`#node-${id} textarea`);
    if (textarea) textarea.focus();
    return;
  }

  CanvasNodeMode.runningNodes.add(id);
  setCanvasNodeRunState(id, 'running', t('Generating...', '生成中...', '생성 중...'));
  try {
    const files = await submitBoardQuickGeneration(node.data.kind, inputs.prompt, {
      referenceFileIds: inputs.referenceFileIds,
      placeOnBoard: false
    });
    if (!Array.isArray(files) || !files.length) {
      setCanvasNodeRunState(id, 'error', t('Failed', '失败', '실패'));
      return;
    }
    const outputIds = files.map((file) => file && file.id).filter(Boolean);
    const current = canvasNodeData()[id];
    if (current) CanvasNodeMode.editor.updateNodeDataFromId(id, { ...current.data, lastOutputFileIds: outputIds });
    reconcileCanvasNodes();
    setCanvasNodeRunState(id, 'ready', t('Completed', '已完成', '완료'));
    saveCanvasNodeLayout();
  } catch (error) {
    setCanvasNodeRunState(id, 'error', t('Failed', '失败', '실패'));
    showToast(error && error.message ? error.message : t('AI generation failed.', 'AI 生成失败。', 'AI 생성에 실패했습니다.'), 'AI');
  } finally {
    CanvasNodeMode.runningNodes.delete(id);
  }
}

function connectCanvasGenerationOutputs(nodeId, files) {
  const id = String(nodeId);
  if (!CanvasNodeMode.editor || !canvasNodeData()[id]) return;
  const outputIds = files.map((file) => file && file.id).filter(Boolean);
  const current = canvasNodeData()[id];
  if (current) CanvasNodeMode.editor.updateNodeDataFromId(id, { ...current.data, lastOutputFileIds: outputIds });
  reconcileCanvasNodes();
  setCanvasNodeRunState(id, outputIds.length ? 'ready' : 'error', outputIds.length
    ? t('Completed', '已完成', '완료')
    : t('Failed', '失败', '실패'));
  saveCanvasNodeLayout();
}

async function openCanvasGenerationSettings(nodeId) {
  const node = canvasNodeData()[String(nodeId)];
  if (!node || !node.data || node.data.nodeRole !== 'generate') return;
  closeCanvasTextEditor();
  const inputs = canvasGenerationInputs(nodeId);
  await openAiComposerForSelection(node.data.kind, inputs.prompt, {
    referenceFileIds: inputs.referenceFileIds,
    nodeAnchorId: String(nodeId),
    placeOnBoard: false,
    onSubmit: () => setCanvasNodeRunState(nodeId, 'running', t('Generating...', '生成中...', '생성 중...')),
    onComplete: (files) => connectCanvasGenerationOutputs(nodeId, Array.isArray(files) ? files : [])
  });
}

function loadCanvasNodeLayout(canvasId) {
  if (!CanvasNodeMode.editor) return;
  CanvasNodeMode.loading = true;
  CanvasNodeMode.canvasId = canvasId;
  CanvasNodeMode.editor.clear();
  const saved = readCanvasNodeLayout(canvasId);
  if (saved) {
    try { CanvasNodeMode.editor.import(saved); } catch (error) { CanvasNodeMode.editor.clear(); }
  }
  CanvasNodeMode.loading = false;
  reconcileCanvasNodes();
}

function closeCanvasNodeAddMenu() {
  const menu = document.getElementById('board-node-add-menu');
  if (menu) menu.hidden = true;
  CanvasNodeMode.addMenuPosition = null;
}

function openCanvasNodeAddMenu(clientX, clientY) {
  const menu = document.getElementById('board-node-add-menu');
  const mode = document.getElementById('board-node-mode');
  if (!menu || !mode) return;
  closeCanvasNodeConnectionMenu();
  CanvasNodeMode.addMenuPosition = canvasNodeWorldPoint(clientX, clientY);
  menu.hidden = false;
  const modeRect = mode.getBoundingClientRect();
  const menuWidth = menu.offsetWidth || 252;
  const menuHeight = menu.offsetHeight || 300;
  const left = Math.max(10, Math.min(modeRect.width - menuWidth - 10, clientX - modeRect.left));
  const top = Math.max(10, Math.min(modeRect.height - menuHeight - 10, clientY - modeRect.top));
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
  window.requestAnimationFrame(() => menu.querySelector('button')?.focus({ preventScroll: true }));
}

function closeCanvasNodeConnectionMenu() {
  if (CanvasNodeMode.connectionMenu) CanvasNodeMode.connectionMenu.remove();
  CanvasNodeMode.connectionMenu = null;
}

function canvasNodeWorldPoint(clientX, clientY) {
  const editor = CanvasNodeMode.editor;
  const host = document.getElementById('board-node-editor');
  const rect = host.getBoundingClientRect();
  const zoom = Math.max(0.01, Number(editor && editor.zoom) || 1);
  return {
    x: (clientX - rect.left - Number(editor && editor.canvas_x || 0)) / zoom,
    y: (clientY - rect.top - Number(editor && editor.canvas_y || 0)) / zoom
  };
}

function addCanvasNodeFromConnection(choice, draft) {
  if (!draft || !CanvasNodeMode.editor) return null;
  const upstream = Boolean(draft.input_id);
  const role = choice && choice.role === 'text' ? 'text' : 'generate';
  const kind = choice && choice.kind === 'video' ? 'video' : 'image';
  const position = {
    x: Math.round(draft.worldX + (upstream ? (role === 'text' ? -316 : -396) : 36)),
    y: Math.round(draft.worldY - 92)
  };
  const nodeId = addCanvasWorkflowNode(role, kind, position);
  if (upstream) {
    CanvasNodeMode.editor.addConnection(
      String(nodeId),
      String(draft.input_id),
      'output_1',
      draft.input_class || 'input_1'
    );
  } else {
    CanvasNodeMode.editor.addConnection(
      String(draft.output_id),
      String(nodeId),
      draft.output_class || 'output_1',
      'input_1'
    );
  }
  closeCanvasNodeConnectionMenu();
  saveCanvasNodeLayout();
  return nodeId;
}

function openCanvasNodeConnectionMenu(draft) {
  closeCanvasNodeConnectionMenu();
  closeCanvasNodeAddMenu();
  const host = document.getElementById('board-node-editor');
  const mode = document.getElementById('board-node-mode');
  if (!host || !mode || !draft) return;
  const target = document.elementFromPoint(draft.clientX, draft.clientY);
  if (!target || !host.contains(target) || (target.closest('.drawflow-node') && !draft.allowSourceTarget)) return;

  const world = canvasNodeWorldPoint(draft.clientX, draft.clientY);
  const menu = document.createElement('div');
  menu.className = 'board-node-connection-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', t('Choose connected node', '选择连接节点', '연결 노드 선택'));
  const choices = draft.input_id
    ? [
      { role: 'text', kind: null, icon: NODE_ICONS.text, label: t('Text prompt', '文本提示词', '텍스트 프롬프트') },
      { role: 'generate', kind: 'image', icon: NODE_ICONS.generate, label: t('Image generation', '图片生成', '이미지 생성') },
      { role: 'generate', kind: 'video', icon: NODE_ICONS.video, label: t('Video generation', '视频生成', '비디오 생성') }
    ]
    : [
      { role: 'generate', kind: 'image', icon: NODE_ICONS.generate, label: t('Image generation', '图片生成', '이미지 생성') },
      { role: 'generate', kind: 'video', icon: NODE_ICONS.video, label: t('Video generation', '视频生成', '비디오 생성') }
    ];
  choices.forEach((choice) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.dataset.connectedNodeKind = choice.kind;
    button.innerHTML = `<span class="board-node-menu-icon">${choice.icon}</span><span>${escapeHtml(choice.label)}</span>`;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      addCanvasNodeFromConnection(choice, {
        ...draft,
        worldX: world.x,
        worldY: world.y
      });
    });
    menu.appendChild(button);
  });
  ['pointerdown', 'mousedown'].forEach((eventName) => {
    menu.addEventListener(eventName, (event) => event.stopPropagation());
  });
  mode.appendChild(menu);
  CanvasNodeMode.connectionMenu = menu;

  const modeRect = mode.getBoundingClientRect();
  const menuWidth = menu.offsetWidth || 206;
  const menuHeight = menu.offsetHeight || 82;
  const left = Math.max(10, Math.min(modeRect.width - menuWidth - 10, draft.clientX - modeRect.left + 12));
  const top = Math.max(10, Math.min(modeRect.height - menuHeight - 10, draft.clientY - modeRect.top + 12));
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
  window.requestAnimationFrame(() => menu.querySelector('button')?.focus({ preventScroll: true }));
}

function pathExtension(filePath) {
  const name = String(filePath || '').split(/[\\/]/).pop() || '';
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index).toLowerCase() : '';
}

function addCanvasMediaNode(file, positionOverride = null) {
  const editor = ensureCanvasNodeEditor();
  const kind = canvasNodeMediaKind(file);
  if (!kind) return null;
  const position = positionOverride || nextCanvasNodePosition(Object.keys(canvasNodeData()).length);
  const nodeId = editor.addNode(
    `media-${kind}`,
    1,
    1,
    Math.round(position.x),
    Math.round(position.y),
    'messs-media-node',
    { nodeRole: 'media', fileId: file.id, mediaKind: kind },
    canvasNodeMediaMarkup({ fileId: file.id }, file),
    false
  );
  const empty = document.getElementById('board-node-empty');
  if (empty) empty.hidden = true;
  saveCanvasNodeLayout();
  return nodeId;
}

function canvasNodePathKind(filePath) {
  return canvasNodeMediaKind({ ext: pathExtension(filePath) });
}

async function importCanvasNodePaths(paths, requestedKind = null, positionOverride = null) {
  const accepted = (paths || []).filter((filePath) => {
    const detectedKind = canvasNodePathKind(filePath);
    return detectedKind && (!requestedKind || detectedKind === requestedKind);
  });
  if (!accepted.length) {
    showToast(t('Choose a supported image, video, audio, or 3D file.', '请选择支持的图片、视频、音频或 3D 文件。', '지원되는 미디어 파일을 선택하세요.'));
    return [];
  }
  const folderId = AppState.activeFolderId && AppState.activeFolderId !== 'default'
    ? AppState.activeFolderId
    : null;
  const result = await window.messsAPI.importFiles(accepted, folderId, activeCanvasId());
  const imported = result && Array.isArray(result.imported) ? result.imported : [];
  if (!imported.length) return [];
  AppState.files = [...imported, ...AppState.files.filter((file) => !imported.some((entry) => entry.id === file.id))];
  if (typeof renderFileList === 'function' && typeof currentFileListScope === 'function') renderFileList(currentFileListScope());
  if (typeof renderFolderGridIfActive === 'function') renderFolderGridIfActive();
  if (result.unlocked && result.unlocked.length && typeof refreshAchievements === 'function') await refreshAchievements();
  const origin = positionOverride || canvasNodeCenterPosition();
  imported.forEach((file, index) => addCanvasMediaNode(file, {
    x: origin.x + index * 34,
    y: origin.y + index * 34
  }));
  return imported;
}

async function importCanvasNodeMedia(kind, positionOverride = null) {
  const paths = await window.messsAPI.pickFiles();
  if (!paths || !paths.length) return;
  await importCanvasNodePaths(paths, kind, positionOverride);
}

function bindCanvasNodeFileDrop(host) {
  host.addEventListener('dragover', (event) => {
    if (!event.dataTransfer || !Array.from(event.dataTransfer.types || []).includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    host.classList.add('is-file-drag-over');
  });
  host.addEventListener('dragleave', (event) => {
    if (!host.contains(event.relatedTarget)) host.classList.remove('is-file-drag-over');
  });
  host.addEventListener('drop', (event) => {
    host.classList.remove('is-file-drag-over');
    const files = Array.from(event.dataTransfer && event.dataTransfer.files || []);
    if (!files.length) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const paths = files.map((file) => {
      try { return window.messsAPI.getPathForFile(file); } catch (error) { return ''; }
    }).filter(Boolean);
    void importCanvasNodePaths(paths, null, canvasNodeWorldPoint(event.clientX, event.clientY));
  }, true);
}

function applyCanvasNodePan() {
  CanvasNodeMode.panFrame = 0;
  const editor = CanvasNodeMode.editor;
  const start = CanvasNodeMode.panStart;
  const point = CanvasNodeMode.panPoint;
  if (!editor || !start || !point) return;
  editor.canvas_x = start.canvasX + point.clientX - start.clientX;
  editor.canvas_y = start.canvasY + point.clientY - start.clientY;
  editor.precanvas.style.transform = `translate(${editor.canvas_x}px, ${editor.canvas_y}px) scale(${editor.zoom})`;
  editor.dispatch('translate', { x: editor.canvas_x, y: editor.canvas_y });
}

function queueCanvasNodePan(point) {
  CanvasNodeMode.panPoint = point;
  if (CanvasNodeMode.panFrame) return;
  CanvasNodeMode.panFrame = requestAnimationFrame(applyCanvasNodePan);
}

function finishCanvasNodePan(event) {
  const pointerId = CanvasNodeMode.panPointerId;
  if (pointerId === null || (event && event.pointerId !== undefined && event.pointerId !== pointerId)) return;
  if (CanvasNodeMode.panFrame) {
    cancelAnimationFrame(CanvasNodeMode.panFrame);
    CanvasNodeMode.panFrame = 0;
    applyCanvasNodePan();
  }
  const host = document.getElementById('board-node-editor');
  CanvasNodeMode.panPointerId = null;
  CanvasNodeMode.panStart = null;
  CanvasNodeMode.panPoint = null;
  if (host) {
    host.classList.remove('is-panning');
    if (host.hasPointerCapture && host.hasPointerCapture(pointerId)) host.releasePointerCapture(pointerId);
  }
}

function isCanvasNodeTextTarget(target) {
  return Boolean(target && typeof target.closest === 'function' && target.closest('input, textarea, select, [contenteditable="true"]'));
}

function canvasNodeIdFromElement(element) {
  return element && String(element.id || '').replace(/^node-/, '');
}

function applyCanvasNodeSelection(nodeIds) {
  const host = document.getElementById('board-node-editor');
  if (!host) return;
  const selectedIds = new Set([...nodeIds].map(String));
  host.querySelectorAll('.drawflow-node').forEach((node) => {
    node.classList.toggle('selected', selectedIds.has(canvasNodeIdFromElement(node)));
  });
  CanvasNodeMode.selectedNodeIds = selectedIds;
  CanvasNodeMode.selectedNodeId = selectedIds.size === 1 ? [...selectedIds][0] : null;
  const editor = CanvasNodeMode.editor;
  if (editor) {
    editor.node_selected = CanvasNodeMode.selectedNodeId
      ? host.querySelector(`#node-${CSS.escape(CanvasNodeMode.selectedNodeId)}`)
      : null;
  }
  syncCanvasNodeConnectionFlow();
}

function clearCanvasNodeConnectionSelection() {
  const editor = CanvasNodeMode.editor;
  if (!editor || !editor.connection_selected) return;
  editor.connection_selected.classList.remove('selected');
  editor.connection_selected = null;
  CanvasNodeMode.selectedConnection = null;
}

function updateCanvasNodeMarquee() {
  const start = CanvasNodeMode.marqueeStart;
  const point = CanvasNodeMode.marqueePoint;
  const box = CanvasNodeMode.marqueeElement;
  if (!start || !point || !box) return;
  const left = Math.min(start.x, point.x);
  const top = Math.min(start.y, point.y);
  const width = Math.abs(point.x - start.x);
  const height = Math.abs(point.y - start.y);
  box.style.left = `${left}px`;
  box.style.top = `${top}px`;
  box.style.width = `${width}px`;
  box.style.height = `${height}px`;
  box.hidden = width < 3 && height < 3;
}

function finishCanvasNodeMarquee(event) {
  const pointerId = CanvasNodeMode.marqueePointerId;
  if (pointerId === null || (event && event.pointerId !== undefined && event.pointerId !== pointerId)) return;
  const host = document.getElementById('board-node-editor');
  const start = CanvasNodeMode.marqueeStart;
  const point = CanvasNodeMode.marqueePoint || start;
  const selectedIds = new Set(CanvasNodeMode.marqueeInitialSelection);
  const dragged = !!(start && point && (Math.abs(point.x - start.x) >= 3 || Math.abs(point.y - start.y) >= 3));
  if (host && dragged) {
    const hostRect = host.getBoundingClientRect();
    const selectionRect = {
      left: hostRect.left + Math.min(start.x, point.x),
      right: hostRect.left + Math.max(start.x, point.x),
      top: hostRect.top + Math.min(start.y, point.y),
      bottom: hostRect.top + Math.max(start.y, point.y)
    };
    host.querySelectorAll('.drawflow-node').forEach((node) => {
      const rect = node.getBoundingClientRect();
      const intersects = rect.right >= selectionRect.left && rect.left <= selectionRect.right &&
        rect.bottom >= selectionRect.top && rect.top <= selectionRect.bottom;
      if (intersects) selectedIds.add(canvasNodeIdFromElement(node));
    });
  }
  applyCanvasNodeSelection(selectedIds);
  CanvasNodeMode.marqueeElement?.remove();
  CanvasNodeMode.marqueePointerId = null;
  CanvasNodeMode.marqueeStart = null;
  CanvasNodeMode.marqueePoint = null;
  CanvasNodeMode.marqueeElement = null;
  CanvasNodeMode.marqueeInitialSelection = new Set();
  if (host) {
    host.classList.remove('is-marquee-selecting');
    if (host.hasPointerCapture && host.hasPointerCapture(pointerId)) host.releasePointerCapture(pointerId);
  }
}

function bindCanvasNodeMarqueeSelection(host) {
  host.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.altKey || CanvasNodeMode.spacePressed) return;
    if (event.target.closest('.drawflow-node, .connection, .input, .output, .point')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    closeCanvasNodeAddMenu();
    closeCanvasNodeConnectionMenu();
    clearCanvasNodeConnectionSelection();
    const rect = host.getBoundingClientRect();
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    CanvasNodeMode.marqueePointerId = event.pointerId;
    CanvasNodeMode.marqueeStart = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    CanvasNodeMode.marqueePoint = { ...CanvasNodeMode.marqueeStart };
    CanvasNodeMode.marqueeInitialSelection = additive
      ? new Set(CanvasNodeMode.selectedNodeIds)
      : new Set();
    const box = document.createElement('div');
    box.className = 'board-node-selection-box';
    box.hidden = true;
    box.setAttribute('aria-hidden', 'true');
    host.appendChild(box);
    CanvasNodeMode.marqueeElement = box;
    host.classList.add('is-marquee-selecting');
    if (host.setPointerCapture) host.setPointerCapture(event.pointerId);
  }, true);
  host.addEventListener('mousedown', (event) => {
    if (CanvasNodeMode.marqueePointerId === null) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  host.addEventListener('pointermove', (event) => {
    if (event.pointerId !== CanvasNodeMode.marqueePointerId) return;
    event.preventDefault();
    const rect = host.getBoundingClientRect();
    CanvasNodeMode.marqueePoint = {
      x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, event.clientY - rect.top))
    };
    updateCanvasNodeMarquee();
  }, true);
  host.addEventListener('pointerup', finishCanvasNodeMarquee, true);
  host.addEventListener('pointercancel', finishCanvasNodeMarquee, true);
  host.addEventListener('lostpointercapture', finishCanvasNodeMarquee, true);
  window.addEventListener('blur', () => finishCanvasNodeMarquee());
}

function bindCanvasNodePanning(host, editor) {
  host.addEventListener('pointerdown', (event) => {
    const modifierPan = event.button === 0 && (event.altKey || CanvasNodeMode.spacePressed);
    if (event.button !== 1 && !modifierPan) return;
    if (CanvasNodeMode.spacePressed && isCanvasNodeTextTarget(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    closeCanvasNodeAddMenu();
    CanvasNodeMode.panPointerId = event.pointerId;
    CanvasNodeMode.panStart = {
      clientX: event.clientX,
      clientY: event.clientY,
      canvasX: editor.canvas_x,
      canvasY: editor.canvas_y
    };
    CanvasNodeMode.panPoint = { clientX: event.clientX, clientY: event.clientY };
    host.classList.add('is-panning');
    if (host.setPointerCapture) host.setPointerCapture(event.pointerId);
  }, true);
  host.addEventListener('mousedown', (event) => {
    if (CanvasNodeMode.panPointerId === null) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  host.addEventListener('pointermove', (event) => {
    if (event.pointerId !== CanvasNodeMode.panPointerId) return;
    event.preventDefault();
    const coalesced = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
    const point = coalesced.length ? coalesced[coalesced.length - 1] : event;
    queueCanvasNodePan({ clientX: point.clientX, clientY: point.clientY });
  }, true);
  host.addEventListener('pointerup', finishCanvasNodePan, true);
  host.addEventListener('pointercancel', finishCanvasNodePan, true);
  host.addEventListener('lostpointercapture', finishCanvasNodePan, true);
  host.addEventListener('auxclick', (event) => {
    if (event.button === 1) event.preventDefault();
  });
  window.addEventListener('blur', () => finishCanvasNodePan());
}

function canvasNodeConnectionMatches(connection, details) {
  if (!connection || !details) return false;
  return connection.classList.contains(`node_out_node-${details.output_id}`) &&
    connection.classList.contains(`node_in_node-${details.input_id}`) &&
    connection.classList.contains(details.output_class) &&
    connection.classList.contains(details.input_class);
}

function syncCanvasNodeConnectionFlow() {
  const host = document.getElementById('board-node-editor');
  if (!host) return;
  host.querySelectorAll('.drawflow .connection').forEach((connection) => {
    const active = [...CanvasNodeMode.runningNodes].some((nodeId) =>
      connection.classList.contains(`node_out_node-${nodeId}`)
    );
    connection.classList.toggle('is-flowing', active);
  });
}

function canvasNodeConnectionDetails(element) {
  if (!element || !element.classList) return null;
  const outputNode = [...element.classList].find((name) => name.startsWith('node_out_node-'));
  const inputNode = [...element.classList].find((name) => name.startsWith('node_in_node-'));
  const outputClass = [...element.classList].find((name) => name.startsWith('output_'));
  const inputClass = [...element.classList].find((name) => name.startsWith('input_'));
  if (!outputNode || !inputNode || !outputClass || !inputClass) return null;
  return {
    output_id: outputNode.slice('node_out_node-'.length),
    input_id: inputNode.slice('node_in_node-'.length),
    output_class: outputClass,
    input_class: inputClass
  };
}

function pruneCanvasNodeConnectionArtifacts() {
  const editor = CanvasNodeMode.editor;
  const host = document.getElementById('board-node-editor');
  if (!editor || !host || editor.connection) return;
  const nodes = canvasNodeData();
  host.querySelectorAll('.drawflow .connection').forEach((connection) => {
    const details = canvasNodeConnectionDetails(connection);
    if (!details) {
      connection.remove();
      return;
    }
    const source = nodes[details.output_id];
    const target = nodes[details.input_id];
    const valid = source && target && source.outputs && source.outputs[details.output_class] &&
      target.inputs && target.inputs[details.input_class] &&
      source.outputs[details.output_class].connections.some((entry) => (
        String(entry.node) === details.input_id && String(entry.output) === details.input_class
      ));
    if (!valid) connection.remove();
  });
}

function ensureCanvasNodeFlowPaths(root) {
  const host = document.getElementById('board-node-editor');
  if (!host) return;
  const scope = root && root.querySelectorAll ? root : host;
  const connections = [];
  if (scope.matches && scope.matches('.connection')) connections.push(scope);
  scope.querySelectorAll('.connection').forEach((connection) => connections.push(connection));
  connections.forEach((connection) => {
    connection.querySelectorAll('.canvas-node-flow-pulse').forEach((pulse) => pulse.remove());
  });
  pruneCanvasNodeConnectionArtifacts();
  syncCanvasNodeConnectionFlow();
}

function updateCanvasNodeInputDraft(point) {
  const draft = CanvasNodeMode.inputConnectionDraft;
  const mode = document.getElementById('board-node-mode');
  const path = draft && draft.path;
  if (!draft || !mode || !path) return;
  const rect = mode.getBoundingClientRect();
  const x = point.clientX - rect.left;
  const y = point.clientY - rect.top;
  const mid = (draft.startX + x) / 2;
  path.setAttribute('d', `M ${draft.startX} ${draft.startY} C ${mid} ${draft.startY} ${mid} ${y} ${x} ${y}`);
}

function cancelCanvasNodeInputConnection() {
  const draft = CanvasNodeMode.inputConnectionDraft;
  if (!draft) return;
  CanvasNodeMode.inputConnectionDraft = null;
  draft.path?.parentElement?.remove();
  const host = document.getElementById('board-node-editor');
  if (host && host.hasPointerCapture && host.hasPointerCapture(draft.pointerId)) {
    host.releasePointerCapture(draft.pointerId);
  }
}

function clearCanvasNodePortMagnet() {
  if (CanvasNodeMode.portMagnetFrame) {
    cancelAnimationFrame(CanvasNodeMode.portMagnetFrame);
    CanvasNodeMode.portMagnetFrame = 0;
  }
  const port = CanvasNodeMode.magneticPort;
  if (port) {
    port.classList.remove('is-magnetic');
    port.style.removeProperty('--node-port-magnet-x');
    port.style.removeProperty('--node-port-magnet-y');
  }
  CanvasNodeMode.magneticPort = null;
  CanvasNodeMode.portMagnetPoint = null;
}

function applyCanvasNodePortMagnet() {
  CanvasNodeMode.portMagnetFrame = 0;
  const host = document.getElementById('board-node-editor');
  const point = CanvasNodeMode.portMagnetPoint;
  if (!host || !point || CanvasNodeMode.mode !== 'node') {
    clearCanvasNodePortMagnet();
    return;
  }
  let nearest = null;
  let nearestDistance = 54;
  host.querySelectorAll('.drawflow-node .input, .drawflow-node .output').forEach((port) => {
    const rect = port.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const distance = Math.hypot(point.clientX - centerX, point.clientY - centerY);
    if (distance >= nearestDistance) return;
    nearestDistance = distance;
    nearest = { port, centerX, centerY };
  });
  if (CanvasNodeMode.magneticPort && CanvasNodeMode.magneticPort !== nearest?.port) {
    CanvasNodeMode.magneticPort.classList.remove('is-magnetic');
    CanvasNodeMode.magneticPort.style.removeProperty('--node-port-magnet-x');
    CanvasNodeMode.magneticPort.style.removeProperty('--node-port-magnet-y');
  }
  CanvasNodeMode.magneticPort = nearest?.port || null;
  if (!nearest) return;
  const pullX = Math.max(-6, Math.min(6, (point.clientX - nearest.centerX) * 0.22));
  const pullY = Math.max(-6, Math.min(6, (point.clientY - nearest.centerY) * 0.22));
  nearest.port.style.setProperty('--node-port-magnet-x', `${pullX.toFixed(2)}px`);
  nearest.port.style.setProperty('--node-port-magnet-y', `${pullY.toFixed(2)}px`);
  nearest.port.classList.add('is-magnetic');
}

function bindCanvasNodePortMagnetism(host) {
  host.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return;
    CanvasNodeMode.portMagnetPoint = { clientX: event.clientX, clientY: event.clientY };
    if (!CanvasNodeMode.portMagnetFrame) {
      CanvasNodeMode.portMagnetFrame = requestAnimationFrame(applyCanvasNodePortMagnet);
    }
  }, true);
  host.addEventListener('pointerdown', (event) => {
    if (event.target.closest && event.target.closest('.drawflow-node .input, .drawflow-node .output')) {
      clearCanvasNodePortMagnet();
    }
  }, true);
  host.addEventListener('pointerleave', clearCanvasNodePortMagnet, true);
}

function finishCanvasNodeInputConnection(event) {
  const draft = CanvasNodeMode.inputConnectionDraft;
  if (!draft || (event && event.pointerId !== undefined && event.pointerId !== draft.pointerId)) return;
  if (event && (event.type === 'pointercancel' || event.type === 'lostpointercapture')) {
    cancelCanvasNodeInputConnection();
    return;
  }
  const host = document.getElementById('board-node-editor');
  const mode = document.getElementById('board-node-mode');
  const point = event && event.clientX !== undefined
    ? { clientX: event.clientX, clientY: event.clientY }
    : draft;
  const distance = Math.hypot(point.clientX - draft.originClientX, point.clientY - draft.originClientY);
  const target = document.elementFromPoint(point.clientX, point.clientY);
  const output = target && target.closest ? target.closest('.drawflow-node .output') : null;
  draft.path?.parentElement?.remove();
  CanvasNodeMode.inputConnectionDraft = null;
  if (host && host.hasPointerCapture && host.hasPointerCapture(draft.pointerId)) host.releasePointerCapture(draft.pointerId);
  if (distance < 8) return;
  if (output && mode && host.contains(output)) {
    const sourceNode = output.parentElement && output.parentElement.parentElement;
    const sourceId = sourceNode && String(sourceNode.id || '').replace(/^node-/, '');
    const sourceClass = [...output.classList].find((name) => name.startsWith('output_')) || 'output_1';
    if (sourceId && sourceId !== String(draft.input_id)) {
      CanvasNodeMode.editor.addConnection(sourceId, String(draft.input_id), sourceClass, draft.input_class || 'input_1');
      saveCanvasNodeLayout();
    }
    return;
  }
  openCanvasNodeConnectionMenu({
    input_id: String(draft.input_id),
    input_class: draft.input_class || 'input_1',
    clientX: point.clientX,
    clientY: point.clientY,
    worldX: canvasNodeWorldPoint(point.clientX, point.clientY).x,
    worldY: canvasNodeWorldPoint(point.clientX, point.clientY).y
  });
}

function bindCanvasNodeInputConnections(host) {
  host.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || CanvasNodeMode.inputConnectionDraft) return;
    const input = event.target.closest && event.target.closest('.drawflow-node .input');
    if (!input) return;
    const nodeElement = input.closest('.drawflow-node');
    const inputId = nodeElement && String(nodeElement.id || '').replace(/^node-/, '');
    if (!inputId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    closeCanvasNodeAddMenu();
    closeCanvasNodeConnectionMenu();
    const mode = document.getElementById('board-node-mode');
    const rect = mode.getBoundingClientRect();
    const inputRect = input.getBoundingClientRect();
    const startX = inputRect.left + inputRect.width / 2 - rect.left;
    const startY = inputRect.top + inputRect.height / 2 - rect.top;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('board-node-link-draft');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    svg.appendChild(path);
    mode.appendChild(svg);
    CanvasNodeMode.inputConnectionDraft = {
      pointerId: event.pointerId,
      input_id: inputId,
      input_class: [...input.classList].find((name) => name.startsWith('input_')) || 'input_1',
      startX,
      startY,
      originClientX: event.clientX,
      originClientY: event.clientY,
      clientX: event.clientX,
      clientY: event.clientY,
      path
    };
    updateCanvasNodeInputDraft({ clientX: event.clientX, clientY: event.clientY });
    if (host.setPointerCapture) host.setPointerCapture(event.pointerId);
  }, true);
  host.addEventListener('pointermove', (event) => {
    if (!CanvasNodeMode.inputConnectionDraft || event.pointerId !== CanvasNodeMode.inputConnectionDraft.pointerId) return;
    event.preventDefault();
    CanvasNodeMode.inputConnectionDraft.clientX = event.clientX;
    CanvasNodeMode.inputConnectionDraft.clientY = event.clientY;
    updateCanvasNodeInputDraft(event);
  }, true);
  host.addEventListener('pointerup', finishCanvasNodeInputConnection, true);
  host.addEventListener('pointercancel', finishCanvasNodeInputConnection, true);
  host.addEventListener('lostpointercapture', finishCanvasNodeInputConnection, true);
}

function observeCanvasNodeConnections(host) {
  if (CanvasNodeMode.connectionObserver) return;
  CanvasNodeMode.connectionObserver = new MutationObserver((mutations) => {
    const roots = new Set();
    mutations.forEach((mutation) => {
      if (mutation.type === 'attributes' && mutation.target.classList.contains('main-path')) {
        const connection = mutation.target.closest('.connection');
        if (connection) roots.add(connection);
      } else if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE && !node.classList.contains('canvas-node-flow-pulse')) roots.add(node);
        });
      }
    });
    roots.forEach((root) => ensureCanvasNodeFlowPaths(root));
  });
  CanvasNodeMode.connectionObserver.observe(host, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['d']
  });
  ensureCanvasNodeFlowPaths(host);
}

function ensureCanvasNodeEditor() {
  if (CanvasNodeMode.editor) return CanvasNodeMode.editor;
  if (typeof Drawflow !== 'function') throw new Error('Drawflow is unavailable');
  const host = document.getElementById('board-node-editor');
  const editor = new Drawflow(host);
  // Reroute points and per-connection animated SVG paths become expensive on
  // production-sized flows. A simple curve stays responsive while dragging.
  editor.reroute = false;
  editor.curvature = 0.42;
  editor.reroute_curvature_start_end = 0.42;
  editor.zoom_min = 0.25;
  editor.zoom_max = 2.4;
  editor.zoom_value = 0.08;
  editor.draggable_inputs = false;
  editor.start();
  CanvasNodeMode.editor = editor;
  bindCanvasNodePanning(host, editor);
  bindCanvasNodeMarqueeSelection(host);
  bindCanvasNodeFileDrop(host);
  bindCanvasNodePortMagnetism(host);
  bindCanvasNodeInputConnections(host);
  observeCanvasNodeConnections(host);
  ['pointerdown', 'pointermove', 'pointerup'].forEach((eventName) => {
    host.addEventListener(eventName, (event) => {
      CanvasNodeMode.connectionPointer = { clientX: event.clientX, clientY: event.clientY };
    }, true);
  });

  ['nodeMoved', 'connectionCreated', 'connectionRemoved', 'rerouteMoved', 'nodeDataChanged'].forEach((eventName) => {
    editor.on(eventName, saveCanvasNodeLayout);
  });
  editor.on('nodeMoved', () => {
    pruneCanvasNodeConnectionArtifacts();
    if (typeof syncNodeAiComposerPosition === 'function') syncNodeAiComposerPosition();
  });
  editor.on('translate', () => {
    if (typeof syncNodeAiComposerPosition === 'function') syncNodeAiComposerPosition();
  });
  editor.on('zoom', () => {
    if (typeof syncNodeAiComposerPosition === 'function') syncNodeAiComposerPosition();
  });
  editor.on('nodeSelected', (nodeId) => {
    applyCanvasNodeSelection(new Set([String(nodeId)]));
    CanvasNodeMode.selectedConnection = null;
  });
  editor.on('nodeUnselected', () => {
    if (CanvasNodeMode.marqueePointerId === null) applyCanvasNodeSelection(new Set());
  });
  editor.on('connectionSelected', (details) => {
    applyCanvasNodeSelection(new Set());
    CanvasNodeMode.selectedConnection = details;
    syncCanvasNodeConnectionFlow();
  });
  editor.on('connectionUnselected', () => {
    CanvasNodeMode.selectedConnection = null;
    syncCanvasNodeConnectionFlow();
  });
  editor.on('connectionStart', (details) => {
    closeCanvasNodeConnectionMenu();
    CanvasNodeMode.connectionDraft = {
      ...details,
      ...(CanvasNodeMode.connectionPointer || {})
    };
  });
  editor.on('connectionCancel', () => {
    const draft = CanvasNodeMode.connectionDraft;
    CanvasNodeMode.connectionDraft = null;
    const point = CanvasNodeMode.connectionPointer;
    if (!draft || !point) return;
    openCanvasNodeConnectionMenu({ ...draft, ...point });
    window.requestAnimationFrame(pruneCanvasNodeConnectionArtifacts);
  });
  editor.on('connectionCreated', () => {
    CanvasNodeMode.connectionDraft = null;
    closeCanvasNodeConnectionMenu();
    window.requestAnimationFrame(() => ensureCanvasNodeFlowPaths(host));
  });
  editor.on('connectionRemoved', () => {
    pruneCanvasNodeConnectionArtifacts();
    syncCanvasNodeConnectionFlow();
  });
  editor.on('nodeRemoved', (nodeId) => {
    if (String(nodeId) === String(CanvasNodeMode.textEditorNodeId)) closeCanvasTextEditor({ save: false });
    if (String(nodeId) === String(CanvasNodeMode.inputConnectionDraft?.input_id || '')) {
      cancelCanvasNodeInputConnection();
    }
    const composer = typeof activeAiComposer === 'function' ? activeAiComposer() : null;
    if (composer && String(composer.dataset.nodeAnchorId || '') === String(nodeId)) closeAiImagePopover();
    CanvasNodeMode.selectedNodeIds.delete(String(nodeId));
    CanvasNodeMode.selectedNodeId = CanvasNodeMode.selectedNodeIds.size === 1
      ? [...CanvasNodeMode.selectedNodeIds][0]
      : null;
    saveCanvasNodeLayout();
    const empty = document.getElementById('board-node-empty');
    if (empty) empty.hidden = Object.keys(canvasNodeData()).length > 0;
  });
  host.addEventListener('wheel', (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.deltaY < 0) editor.zoom_in();
    else if (event.deltaY > 0) editor.zoom_out();
  }, { capture: true, passive: false });
  host.addEventListener('click', (event) => {
    const openButton = event.target.closest('button[data-node-file-id]');
    if (openButton) {
      event.preventDefault();
      event.stopPropagation();
      selectFileForPreview(openButton.dataset.nodeFileId);
      return;
    }
    const action = event.target.closest('[data-node-action]');
    if (!action) return;
    const element = action.closest('.drawflow-node');
    const nodeId = element && element.id.replace(/^node-/, '');
    if (!nodeId) return;
    event.preventDefault();
    event.stopPropagation();
    if (action.dataset.nodeAction === 'settings') void openCanvasGenerationSettings(nodeId);
    else if (action.dataset.nodeAction === 'text') openCanvasTextEditor(nodeId);
  });
  host.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const action = event.target.closest('[data-node-action]');
    if (!action) return;
    const element = action.closest('.drawflow-node');
    const nodeId = element && element.id.replace(/^node-/, '');
    if (!nodeId) return;
    event.preventDefault();
    event.stopPropagation();
    if (action.dataset.nodeAction === 'settings') void openCanvasGenerationSettings(nodeId);
    else if (action.dataset.nodeAction === 'text') openCanvasTextEditor(nodeId);
  });
  return editor;
}

function applyCanvasModeVisibility() {
  const panel = document.getElementById('board-panel');
  const viewport = document.getElementById('board-viewport');
  const nodeMode = document.getElementById('board-node-mode');
  const bottomBar = document.getElementById('board-bottom-bar');
  const nodeActive = CanvasNodeMode.mode === 'node';
  if (panel) panel.classList.toggle('is-node-mode', nodeActive);
  if (viewport) viewport.hidden = nodeActive;
  if (nodeMode) nodeMode.hidden = !nodeActive;
  if (bottomBar && panel && !panel.classList.contains('is-canvas-library')) bottomBar.hidden = nodeActive;
  if (!nodeActive) {
    const composer = typeof activeAiComposer === 'function' ? activeAiComposer() : null;
    if (composer && composer.classList.contains('is-node-composer')) closeAiImagePopover();
    closeCanvasNodeAddMenu();
    closeCanvasNodeConnectionMenu();
    closeCanvasTextEditor();
    CanvasNodeMode.connectionDraft = null;
    cancelCanvasNodeInputConnection();
    clearCanvasNodePortMagnet();
    finishCanvasNodePan();
    finishCanvasNodeMarquee();
    applyCanvasNodeSelection(new Set());
    CanvasNodeMode.spacePressed = false;
    document.getElementById('board-node-editor')?.classList.remove('is-pan-ready');
  }
}

function switchCanvasMode(mode, options = {}) {
  CanvasNodeMode.mode = mode === 'node' ? 'node' : 'canvas';
  try { localStorage.setItem(CANVAS_NODE_MODE_KEY, CanvasNodeMode.mode); } catch (error) {}
  const toggle = document.getElementById('board-mode-toggle');
  const nodeActive = CanvasNodeMode.mode === 'node';
  if (toggle) {
    toggle.classList.toggle('is-active', nodeActive);
    toggle.setAttribute('aria-pressed', String(nodeActive));
  }
  refreshCanvasNodeModeLanguage();
  applyCanvasModeVisibility();
  if (nodeActive) {
    if (typeof closeAiImagePopover === 'function') closeAiImagePopover();
    if (typeof setCanvasAgentOpen === 'function') setCanvasAgentOpen(false);
    ensureCanvasNodeEditor();
    if (CanvasNodeMode.canvasId !== activeCanvasId()) loadCanvasNodeLayout(activeCanvasId());
    else reconcileCanvasNodes();
    requestAnimationFrame(() => {
      if (CanvasNodeMode.editor) CanvasNodeMode.editor.zoom_refresh();
    });
  } else if (!options.silent && document.getElementById('board-viewport')) {
    document.getElementById('board-viewport').focus({ preventScroll: true });
  }
}

function syncCanvasNodeMode() {
  applyCanvasModeVisibility();
  if (CanvasNodeMode.mode !== 'node' || !CanvasNodeMode.editor) return;
  if (CanvasNodeMode.canvasId !== activeCanvasId()) loadCanvasNodeLayout(activeCanvasId());
  else reconcileCanvasNodes();
}

function refreshCanvasNodeModeLanguage() {
  const toggle = document.getElementById('board-mode-toggle');
  if (!toggle) return;
  const nodeActive = CanvasNodeMode.mode === 'node';
  const label = nodeActive
    ? t('Switch to canvas mode', '切换到画布模式', '캔버스 모드로 전환')
    : t('Switch to node mode', '切换到节点模式', '노드 모드로 전환');
  toggle.title = label;
  toggle.setAttribute('aria-label', label);
  const empty = document.getElementById('board-node-empty');
  if (empty) empty.textContent = t('Right-click to add a node, or drop media here', '右键添加节点，或将媒体拖到这里', '우클릭하여 노드를 추가하거나 미디어를 놓으세요');
  const menu = document.getElementById('board-node-add-menu');
  const title = menu && menu.querySelector('.board-node-add-title');
  if (title) title.textContent = t('Add node', '添加节点', '노드 추가');
  const menuLabels = {
    text: t('Text', '文本', '텍스트'),
    image: t('Image', '图片', '이미지'),
    video: t('Video', '视频', '비디오'),
    audio: t('Audio', '音频', '오디오'),
    model: '3D'
  };
  document.querySelectorAll('#board-node-add-menu [data-add-node]').forEach((button) => {
    const labelElement = button.querySelector('.board-node-menu-copy b');
    if (labelElement) labelElement.textContent = menuLabels[button.dataset.addNode] || '';
  });
  const subtitle = menu && menu.querySelector('[data-add-node="image"] small');
  if (subtitle) subtitle.textContent = t('Poster, cover, campaign visual', '宣传图、海报、封面', '포스터, 표지, 캠페인 비주얼');
  document.querySelectorAll('[data-node-menu-icon]').forEach((element) => {
    element.innerHTML = NODE_ICONS[element.dataset.nodeMenuIcon] || '';
  });
}

function removeSelectedCanvasNodes() {
  const editor = CanvasNodeMode.editor;
  if (!editor) return false;
  const nodeIds = [...CanvasNodeMode.selectedNodeIds];
  if (nodeIds.length) {
    nodeIds.forEach((nodeId) => editor.removeNodeId(`node-${nodeId}`));
    applyCanvasNodeSelection(new Set());
    saveCanvasNodeLayout();
    return true;
  }
  const connection = CanvasNodeMode.selectedConnection;
  if (connection && typeof editor.removeSingleConnection === 'function') {
    editor.removeSingleConnection(
      connection.output_id,
      connection.input_id,
      connection.output_class,
      connection.input_class
    );
    clearCanvasNodeConnectionSelection();
    saveCanvasNodeLayout();
    return true;
  }
  return false;
}

function initCanvasNodeMode() {
  const toggle = document.getElementById('board-mode-toggle');
  if (!toggle) return;
  toggle.addEventListener('click', () => {
    switchCanvasMode(CanvasNodeMode.mode === 'node' ? 'canvas' : 'node');
  });
  const nodeEditor = document.getElementById('board-node-editor');
  nodeEditor?.addEventListener('contextmenu', (event) => {
    if (event.target.closest('.drawflow-node, .connection, .input, .output, .point')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openCanvasNodeAddMenu(event.clientX, event.clientY);
  }, true);
  document.getElementById('board-node-add-menu')?.addEventListener('click', (event) => {
    const item = event.target.closest('[data-add-node]');
    if (!item) return;
    const action = item.dataset.addNode;
    const position = CanvasNodeMode.addMenuPosition || canvasNodeCenterPosition();
    closeCanvasNodeAddMenu();
    if (action === 'text') addCanvasWorkflowNode('text', null, position);
    else if (action === 'image') addCanvasWorkflowNode('generate', 'image', position);
    else if (action === 'video') addCanvasWorkflowNode('generate', 'video', position);
    else if (action === 'audio' || action === 'model') void importCanvasNodeMedia(action, position);
  });
  document.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('#board-node-add-menu')) closeCanvasNodeAddMenu();
    if (!event.target.closest('.board-node-connection-menu')) closeCanvasNodeConnectionMenu();
    if (
      CanvasNodeMode.textEditor &&
      !event.target.closest('.board-node-text-editor') &&
      !event.target.closest('[data-node-action="text"]')
    ) closeCanvasTextEditor();
  }, true);
  document.addEventListener('keydown', (event) => {
    if (
      CanvasNodeMode.mode !== 'node' ||
      (event.key !== 'Delete' && event.key !== 'Backspace') ||
      isCanvasNodeTextTarget(event.target)
    ) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    removeSelectedCanvasNodes();
  }, true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeCanvasNodeAddMenu();
      closeCanvasNodeConnectionMenu();
      closeCanvasTextEditor();
    }
    if (
      event.code === 'Space' &&
      CanvasNodeMode.mode === 'node' &&
      !isCanvasNodeTextTarget(event.target)
    ) {
      CanvasNodeMode.spacePressed = true;
      document.getElementById('board-node-editor')?.classList.add('is-pan-ready');
      event.preventDefault();
    }
  });
  document.addEventListener('keyup', (event) => {
    if (event.code !== 'Space') return;
    CanvasNodeMode.spacePressed = false;
    document.getElementById('board-node-editor')?.classList.remove('is-pan-ready');
  });
  window.addEventListener('blur', () => {
    CanvasNodeMode.spacePressed = false;
    document.getElementById('board-node-editor')?.classList.remove('is-pan-ready');
  });
  document.addEventListener('messs:language-changed', refreshCanvasNodeModeLanguage);
  let savedMode = 'canvas';
  try { savedMode = localStorage.getItem(CANVAS_NODE_MODE_KEY) || 'canvas'; } catch (error) {}
  switchCanvasMode(savedMode, { silent: true });
}
