'use strict';

/* Drawflow-backed image/video workflow view. Media nodes reference the same
   board item and file IDs; only workflow-only nodes and graph layout live here. */

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
  selectedConnection: null,
  connectionObserver: null,
  connectionDraft: null,
  connectionPointer: null,
  connectionMenu: null,
  textEditor: null,
  textEditorNodeId: null
};

const CANVAS_NODE_MODE_KEY = 'messs.canvas.mode.v1';
const CANVAS_NODE_LAYOUT_KEY = 'messs.canvas.nodes.v1';

const NODE_ICONS = {
  text: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6V4h14v2M12 4v16M8 20h8"/></svg>',
  image: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m3 17 5-5 4 4 3-3 6 6"/></svg>',
  video: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="14" height="14" rx="2"/><path d="m17 10 4-2v8l-4-2z"/></svg>',
  generate: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.3 4.1L17 9l-3.7 1.9L12 15l-1.3-4.1L7 9l3.7-1.9L12 3Z"/><path d="m18.5 14 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z"/></svg>'
};

function canvasNodeLayoutKey(canvasId = activeCanvasId()) {
  return `${CANVAS_NODE_LAYOUT_KEY}.${encodeURIComponent(canvasId)}`;
}

function canvasNodeFile(item) {
  return item && item.fileId ? AppState.files.find((file) => file.id === item.fileId) : null;
}

function canvasNodeMediaKind(file) {
  if (!file || (typeof isModelFile === 'function' && isModelFile(file))) return null;
  if (isImageExt(file.ext)) return 'image';
  if (isVideoExt(file.ext)) return 'video';
  return null;
}

function canvasNodeMediaMarkup(item, file) {
  const kind = canvasNodeMediaKind(file);
  const title = String(file && file.name || t('Untitled media', '未命名媒体', '제목 없는 미디어'));
  const source = String(file && (file.thumbUrl || (kind === 'image' ? file.url : '')) || '');
  const preview = source
    ? `<img src="${escapeHtml(source)}" alt="" draggable="false" />`
    : `<span class="canvas-node-placeholder">${kind === 'video' ? NODE_ICONS.video : NODE_ICONS.image}</span>`;
  const typeLabel = kind === 'video'
    ? t('Video', '视频', '비디오')
    : t('Image', '图片', '이미지');
  return `<article class="canvas-media-node canvas-media-node-${kind}" data-board-item-id="${escapeHtml(item.id)}" title="${escapeHtml(title)}">
    <header class="canvas-media-node-label"><span class="canvas-node-title-icon">${NODE_ICONS[kind]}<b>${escapeHtml(typeLabel)}</b></span>
      <button class="canvas-node-open nodrag" type="button" data-node-file-id="${escapeHtml(file.id)}" title="${escapeHtml(t('Open preview', '放大查看', '미리보기 열기'))}" aria-label="${escapeHtml(t('Open preview', '放大查看', '미리보기 열기'))}">↗</button>
    </header>
    <div class="canvas-node-preview">${preview}${kind === 'video' ? '<i class="canvas-node-video-mark">▶</i>' : ''}</div>
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
    return `<button type="button" class="canvas-generate-result canvas-generate-result-${kind} nodrag" data-node-file-id="${escapeHtml(file.id)}" title="${escapeHtml(file.name || '')}">${preview}${kind === 'video' ? '<i>▶</i>' : ''}</button>`;
  }).join('');
  return `<div class="canvas-generate-results" data-count="${Math.min(files.length, 4)}">${items}</div>`;
}

function canvasGenerateNodeMarkup(kind, data = {}) {
  const isVideo = kind === 'video';
  const label = isVideo
    ? t('Video generation', '视频生成', '비디오 생성')
    : t('Image generation', '图片生成', '이미지 생성');
  return `<article class="canvas-flow-node canvas-generate-node" data-generate-kind="${kind}" data-node-action="settings" role="button" tabindex="0" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${canvasGenerateResultsMarkup(data)}
    <header><span class="canvas-node-title-icon">${isVideo ? NODE_ICONS.video : NODE_ICONS.generate}<b>${escapeHtml(label)}</b></span><i class="canvas-node-status" data-node-status>${escapeHtml(t('Ready', '就绪', '준비'))}</i></header>
    <textarea class="canvas-node-textarea nodrag" df-prompt rows="4" placeholder="${escapeHtml(t('Optional prompt; connected text is appended', '可选提示词；会合并已连接文本', '선택 프롬프트; 연결된 텍스트가 추가됩니다'))}">${escapeHtml(data.prompt || '')}</textarea>
    <div class="canvas-node-actions nodrag">
      <button type="button" data-node-action="settings">${escapeHtml(t('More settings', '更多设置', '추가 설정'))}</button>
      <button type="button" class="is-primary" data-node-action="run">${escapeHtml(t('Run', '运行', '실행'))}</button>
    </div>
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
  window.setTimeout(() => {
    if (role === 'text') {
      openCanvasTextEditor(id);
    } else {
      void openCanvasGenerationSettings(id);
    }
  }, 0);
  return id;
}

function reconcileCanvasNodes() {
  const editor = CanvasNodeMode.editor;
  if (!editor || CanvasNodeMode.canvasId !== activeCanvasId()) return;
  const nodes = canvasNodeData();
  const embeddedOutputFileIds = new Set();
  Object.values(nodes).forEach((node) => {
    const data = node && node.data || {};
    if (data.nodeRole !== 'generate' || !Array.isArray(data.lastOutputFileIds)) return;
    data.lastOutputFileIds.forEach((fileId) => embeddedOutputFileIds.add(fileId));
  });
  const items = AppState.boardItems.filter((item) => {
    const file = canvasNodeFile(item);
    return Boolean(item && item.fileId && !embeddedOutputFileIds.has(item.fileId) && canvasNodeMediaKind(file));
  });
  const itemIds = new Set(items.map((item) => item.id));
  const nodesByItem = new Map();

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
    const boardItemId = data.boardItemId;
    if (!boardItemId || !itemIds.has(boardItemId)) {
      editor.removeNodeId(`node-${nodeId}`);
      return;
    }
    if (role !== 'media') editor.updateNodeDataFromId(nodeId, { ...data, nodeRole: 'media' });
    nodesByItem.set(boardItemId, nodeId);
  });

  items.forEach((item, index) => {
    if (nodesByItem.has(item.id)) return;
    const file = canvasNodeFile(item);
    const kind = canvasNodeMediaKind(file);
    const position = nextCanvasNodePosition(index);
    const nodeId = editor.addNode(
      `media-${kind}`,
      1,
      1,
      position.x,
      position.y,
      'messs-media-node',
      { nodeRole: 'media', boardItemId: item.id, fileId: item.fileId, mediaKind: kind },
      canvasNodeMediaMarkup(item, file),
      false
    );
    nodesByItem.set(item.id, String(nodeId));
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
    if (data.nodeRole === 'media' && data.mediaKind === 'image' && data.fileId) referenceFileIds.push(data.fileId);
  });
  return {
    prompt: promptParts.filter(Boolean).join('\n\n'),
    referenceFileIds: [...new Set(referenceFileIds)]
  };
}

function canvasNodeBoardPlacement(referenceFileIds) {
  const ids = new Set(referenceFileIds || []);
  const references = AppState.boardItems.filter((item) => ids.has(item.fileId));
  if (references.length) {
    return {
      x: Math.round(references.reduce((sum, item) => sum + Number(item.x || 0) + Number(item.width || 0) / 2, 0) / references.length),
      y: Math.round(references.reduce((sum, item) => sum + Number(item.y || 0) + Number(item.height || 0) / 2, 0) / references.length)
    };
  }
  return { x: 0, y: 0 };
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
      placement: canvasNodeBoardPlacement(inputs.referenceFileIds)
    });
    if (!Array.isArray(files) || !files.length) {
      setCanvasNodeRunState(id, 'error', t('Failed', '失败', '실패'));
      return;
    }
    reconcileCanvasNodes();
    const outputIds = [];
    files.forEach((file) => {
      const target = canvasNodeByFileId(file.id);
      if (!target) return;
      outputIds.push(file.id);
      CanvasNodeMode.editor.addConnection(id, String(target[0]), 'output_1', 'input_1');
    });
    const current = canvasNodeData()[id];
    if (current) CanvasNodeMode.editor.updateNodeDataFromId(id, { ...current.data, lastOutputFileIds: outputIds });
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
  const selectedSnapshot = new Map(AppState.boardItems.map((item) => [item.id, Boolean(item.selected)]));
  const references = new Set(inputs.referenceFileIds);
  AppState.boardItems.forEach((item) => { item.selected = references.has(item.fileId); });
  syncBoardSelectionClasses();
  try {
    await openAiComposerForSelection(node.data.kind, inputs.prompt, {
      onSubmit: () => setCanvasNodeRunState(nodeId, 'running', t('Generating...', '生成中...', '생성 중...')),
      onComplete: (files) => connectCanvasGenerationOutputs(nodeId, Array.isArray(files) ? files : [])
    });
  } finally {
    AppState.boardItems.forEach((item) => { item.selected = selectedSnapshot.get(item.id) || false; });
    syncBoardSelectionClasses();
  }
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
  const button = document.getElementById('board-node-add-toggle');
  if (menu) menu.hidden = true;
  if (button) button.setAttribute('aria-expanded', 'false');
}

function toggleCanvasNodeAddMenu() {
  const menu = document.getElementById('board-node-add-menu');
  const button = document.getElementById('board-node-add-toggle');
  if (!menu || !button) return;
  menu.hidden = !menu.hidden;
  button.setAttribute('aria-expanded', String(!menu.hidden));
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

function addCanvasNodeFromConnection(kind, draft) {
  if (!draft || !CanvasNodeMode.editor) return null;
  const position = {
    x: Math.round(draft.worldX + 36),
    y: Math.round(draft.worldY - 92)
  };
  const nodeId = addCanvasWorkflowNode('generate', kind, position);
  CanvasNodeMode.editor.addConnection(
    String(draft.output_id),
    String(nodeId),
    draft.output_class || 'output_1',
    'input_1'
  );
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
  if (!target || !host.contains(target) || target.closest('.drawflow-node')) return;

  const world = canvasNodeWorldPoint(draft.clientX, draft.clientY);
  const menu = document.createElement('div');
  menu.className = 'board-node-connection-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', t('Choose connected node', '选择连接节点', '연결 노드 선택'));
  const choices = [
    {
      kind: 'image',
      icon: NODE_ICONS.generate,
      label: t('Image generation', '图片生成', '이미지 생성')
    },
    {
      kind: 'video',
      icon: NODE_ICONS.video,
      label: t('Video generation', '视频生成', '비디오 생성')
    }
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
      addCanvasNodeFromConnection(choice.kind, {
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

async function importCanvasNodeMedia(kind) {
  const paths = await window.messsAPI.pickFiles();
  if (!paths || !paths.length) return;
  const accepted = paths.filter((filePath) => kind === 'video'
    ? isVideoExt(pathExtension(filePath))
    : isImageExt(pathExtension(filePath)));
  if (!accepted.length) {
    showToast(kind === 'video'
      ? t('Choose a supported video file.', '请选择支持的视频文件。', '지원되는 비디오 파일을 선택하세요.')
      : t('Choose a supported image file.', '请选择支持的图片文件。', '지원되는 이미지 파일을 선택하세요.'));
    return;
  }
  await importFilesDirectlyToBoard(accepted, { x: 0, y: 0 });
  reconcileCanvasNodes();
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
  return Boolean(target && target.closest('input, textarea, select, [contenteditable="true"]'));
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
  const nodeId = CanvasNodeMode.selectedNodeId;
  const selectedConnection = CanvasNodeMode.selectedConnection;
  host.querySelectorAll('.drawflow .connection').forEach((connection) => {
    const connectedToNode = nodeId && (
      connection.classList.contains(`node_out_node-${nodeId}`) ||
      connection.classList.contains(`node_in_node-${nodeId}`)
    );
    connection.classList.toggle(
      'is-flowing',
      Boolean(connectedToNode || canvasNodeConnectionMatches(connection, selectedConnection))
    );
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
    const paths = Array.from(connection.children).filter((child) => child.classList && child.classList.contains('main-path'));
    const pulses = Array.from(connection.children).filter((child) => child.classList && child.classList.contains('canvas-node-flow-pulse'));
    paths.forEach((path, index) => {
      let pulse = pulses[index];
      if (!pulse) {
        pulse = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        pulse.classList.add('canvas-node-flow-pulse');
        pulse.setAttribute('aria-hidden', 'true');
        connection.appendChild(pulse);
      }
      pulse.setAttribute('d', path.getAttribute('d') || '');
    });
    pulses.slice(paths.length).forEach((pulse) => pulse.remove());
  });
  syncCanvasNodeConnectionFlow();
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
  editor.reroute = true;
  editor.curvature = 0.42;
  editor.reroute_curvature_start_end = 0.42;
  editor.zoom_min = 0.25;
  editor.zoom_max = 2.4;
  editor.zoom_value = 0.08;
  editor.draggable_inputs = false;
  editor.start();
  CanvasNodeMode.editor = editor;
  bindCanvasNodePanning(host, editor);
  observeCanvasNodeConnections(host);
  ['pointerdown', 'pointermove', 'pointerup'].forEach((eventName) => {
    host.addEventListener(eventName, (event) => {
      CanvasNodeMode.connectionPointer = { clientX: event.clientX, clientY: event.clientY };
    }, true);
  });

  ['nodeMoved', 'connectionCreated', 'connectionRemoved', 'rerouteMoved', 'nodeDataChanged'].forEach((eventName) => {
    editor.on(eventName, saveCanvasNodeLayout);
  });
  editor.on('nodeSelected', (nodeId) => {
    CanvasNodeMode.selectedNodeId = String(nodeId);
    CanvasNodeMode.selectedConnection = null;
    syncCanvasNodeConnectionFlow();
  });
  editor.on('nodeUnselected', () => {
    CanvasNodeMode.selectedNodeId = null;
    syncCanvasNodeConnectionFlow();
  });
  editor.on('connectionSelected', (details) => {
    CanvasNodeMode.selectedNodeId = null;
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
  });
  editor.on('connectionCreated', () => {
    CanvasNodeMode.connectionDraft = null;
    closeCanvasNodeConnectionMenu();
    window.requestAnimationFrame(() => ensureCanvasNodeFlowPaths(host));
  });
  editor.on('connectionRemoved', syncCanvasNodeConnectionFlow);
  editor.on('nodeRemoved', (nodeId) => {
    if (String(nodeId) === String(CanvasNodeMode.textEditorNodeId)) closeCanvasTextEditor({ save: false });
    CanvasNodeMode.selectedNodeId = null;
    saveCanvasNodeLayout();
    window.setTimeout(reconcileCanvasNodes, 0);
  });
  host.addEventListener('wheel', (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.deltaY < 0) editor.zoom_in();
    else if (event.deltaY > 0) editor.zoom_out();
  }, { capture: true, passive: false });
  host.addEventListener('click', (event) => {
    const openButton = event.target.closest('[data-node-file-id]');
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
    closeCanvasNodeAddMenu();
    closeCanvasNodeConnectionMenu();
    closeCanvasTextEditor();
    CanvasNodeMode.connectionDraft = null;
    finishCanvasNodePan();
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
  if (empty) empty.textContent = t('Add a node or place an image/video on this canvas', '添加节点，或在画布中放入图片/视频', '노드를 추가하거나 캔버스에 이미지/비디오를 배치하세요');
  const add = document.getElementById('board-node-add-toggle');
  if (add) add.querySelector('span').textContent = t('Add node', '添加节点', '노드 추가');
  const menuLabels = {
    text: t('Text prompt', '文本提示词', '텍스트 프롬프트'),
    'import-image': t('Import image', '导入图片', '이미지 가져오기'),
    'import-video': t('Import video', '导入视频', '비디오 가져오기'),
    'generate-image': t('Image generation', '图片生成', '이미지 생성'),
    'generate-video': t('Video generation', '视频生成', '비디오 생성')
  };
  document.querySelectorAll('#board-node-add-menu [data-add-node]').forEach((button) => {
    const labelElement = button.lastElementChild;
    if (labelElement) labelElement.textContent = menuLabels[button.dataset.addNode] || '';
  });
}

function initCanvasNodeMode() {
  const toggle = document.getElementById('board-mode-toggle');
  if (!toggle) return;
  toggle.addEventListener('click', () => {
    switchCanvasMode(CanvasNodeMode.mode === 'node' ? 'canvas' : 'node');
  });
  const addToggle = document.getElementById('board-node-add-toggle');
  if (addToggle) addToggle.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleCanvasNodeAddMenu();
  });
  document.getElementById('board-node-add-menu')?.addEventListener('click', (event) => {
    const item = event.target.closest('[data-add-node]');
    if (!item) return;
    closeCanvasNodeAddMenu();
    const action = item.dataset.addNode;
    if (action === 'text') addCanvasWorkflowNode('text');
    else if (action === 'generate-image') addCanvasWorkflowNode('generate', 'image');
    else if (action === 'generate-video') addCanvasWorkflowNode('generate', 'video');
    else if (action === 'import-image') void importCanvasNodeMedia('image');
    else if (action === 'import-video') void importCanvasNodeMedia('video');
  });
  document.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('.board-node-add')) closeCanvasNodeAddMenu();
    if (!event.target.closest('.board-node-connection-menu')) closeCanvasNodeConnectionMenu();
    if (
      CanvasNodeMode.textEditor &&
      !event.target.closest('.board-node-text-editor') &&
      !event.target.closest('[data-node-action="text"]')
    ) closeCanvasTextEditor();
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
