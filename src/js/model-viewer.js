'use strict';

const BoardModelViewer = {
  overlay: null,
  renderer: null,
  scene: null,
  camera: null,
  controls: null,
  root: null,
  mixer: null,
  clock: null,
  animationFrame: 0,
  resizeObserver: null,
  environmentTarget: null,
  environmentScene: null,
  pmremGenerator: null,
  keyHandler: null,
  loadGeneration: 0
};

function disposeBoardModelObject(root) {
  if (!root) return;
  const textures = new Set();
  const materials = new Set();
  const geometries = new Set();
  root.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    objectMaterials.filter(Boolean).forEach((material) => {
      materials.add(material);
      Object.values(material).forEach((value) => {
        if (value && value.isTexture) textures.add(value);
      });
    });
  });
  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
}

function closeBoardModelViewer() {
  BoardModelViewer.loadGeneration += 1;
  if (BoardModelViewer.animationFrame) cancelAnimationFrame(BoardModelViewer.animationFrame);
  BoardModelViewer.animationFrame = 0;
  if (BoardModelViewer.resizeObserver) BoardModelViewer.resizeObserver.disconnect();
  BoardModelViewer.resizeObserver = null;
  if (BoardModelViewer.controls) BoardModelViewer.controls.dispose();
  if (BoardModelViewer.mixer && BoardModelViewer.root) {
    BoardModelViewer.mixer.stopAllAction();
    BoardModelViewer.mixer.uncacheRoot(BoardModelViewer.root);
  }
  disposeBoardModelObject(BoardModelViewer.root);
  disposeBoardModelObject(BoardModelViewer.environmentScene);
  if (BoardModelViewer.environmentTarget) BoardModelViewer.environmentTarget.dispose();
  if (BoardModelViewer.pmremGenerator) BoardModelViewer.pmremGenerator.dispose();
  if (BoardModelViewer.renderer) {
    BoardModelViewer.renderer.setAnimationLoop(null);
    BoardModelViewer.renderer.renderLists.dispose();
    BoardModelViewer.renderer.dispose();
    BoardModelViewer.renderer.forceContextLoss();
    if (BoardModelViewer.renderer.domElement) BoardModelViewer.renderer.domElement.remove();
  }
  if (BoardModelViewer.keyHandler) document.removeEventListener('keydown', BoardModelViewer.keyHandler);
  if (BoardModelViewer.overlay) BoardModelViewer.overlay.remove();
  BoardModelViewer.overlay = null;
  BoardModelViewer.renderer = null;
  BoardModelViewer.scene = null;
  BoardModelViewer.camera = null;
  BoardModelViewer.controls = null;
  BoardModelViewer.root = null;
  BoardModelViewer.mixer = null;
  BoardModelViewer.clock = null;
  BoardModelViewer.environmentTarget = null;
  BoardModelViewer.environmentScene = null;
  BoardModelViewer.pmremGenerator = null;
  BoardModelViewer.keyHandler = null;
}

function resizeBoardModelViewer() {
  const stage = BoardModelViewer.overlay && BoardModelViewer.overlay.querySelector('.board-model-viewer-stage');
  if (!stage || !BoardModelViewer.renderer || !BoardModelViewer.camera) return;
  const width = Math.max(1, stage.clientWidth);
  const height = Math.max(1, stage.clientHeight);
  BoardModelViewer.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  BoardModelViewer.renderer.setSize(width, height, false);
  BoardModelViewer.camera.aspect = width / height;
  BoardModelViewer.camera.updateProjectionMatrix();
}

function frameBoardModel(root, camera, controls, THREE) {
  const bounds = new THREE.Box3().setFromObject(root);
  if (bounds.isEmpty()) throw new Error(t('This 3D model has no visible geometry.', '这个 3D 模型没有可见几何体。', '이 3D 모델에는 표시할 형상이 없습니다.'));
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  root.position.sub(center);
  const maxSize = Math.max(size.x, size.y, size.z, 0.01);
  const distance = (maxSize / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)))) * 1.42;
  camera.near = Math.max(maxSize / 1000, 0.001);
  camera.far = Math.max(maxSize * 1000, 100);
  camera.position.set(distance * 0.72, distance * 0.48, distance);
  camera.updateProjectionMatrix();
  controls.target.set(0, 0, 0);
  controls.minDistance = maxSize * 0.16;
  controls.maxDistance = maxSize * 14;
  controls.update();
}

function renderBoardModelFrame() {
  if (!BoardModelViewer.renderer || !BoardModelViewer.scene || !BoardModelViewer.camera) return;
  BoardModelViewer.animationFrame = requestAnimationFrame(renderBoardModelFrame);
  const delta = BoardModelViewer.clock ? BoardModelViewer.clock.getDelta() : 0;
  if (BoardModelViewer.mixer) BoardModelViewer.mixer.update(delta);
  if (BoardModelViewer.controls) BoardModelViewer.controls.update();
  BoardModelViewer.renderer.render(BoardModelViewer.scene, BoardModelViewer.camera);
}

function setBoardModelViewerState(state, message = '') {
  const overlay = BoardModelViewer.overlay;
  if (!overlay) return;
  overlay.dataset.state = state;
  const status = overlay.querySelector('.board-model-viewer-status');
  if (status) {
    status.textContent = message;
    status.setAttribute('aria-label', message);
  }
}

async function exportBoardModel(file, button) {
  if (!window.messsAPI || typeof window.messsAPI.exportFile !== 'function') return;
  button.disabled = true;
  try {
    const result = await window.messsAPI.exportFile(file.id);
    if (result && result.ok) {
      showToast(t('3D model downloaded.', '3D 模型已下载。', '3D 모델을 다운로드했습니다.'));
    }
  } finally {
    button.disabled = false;
  }
}

function createBoardModelViewerOverlay(file) {
  const overlay = document.createElement('div');
  overlay.className = 'board-model-viewer-overlay';
  overlay.dataset.state = 'loading';
  overlay.innerHTML = `
    <section class="board-model-viewer-dialog" role="dialog" aria-modal="true">
      <header class="board-model-viewer-header">
        <div class="board-model-viewer-heading">
          <span class="board-model-viewer-mark" aria-hidden="true">3D</span>
          <strong></strong>
        </div>
        <div class="board-model-viewer-actions">
          <button type="button" class="board-model-viewer-download icon-btn-sm" aria-label="${t('Download model', '下载模型', '모델 다운로드')}" title="${t('Download model', '下载模型', '모델 다운로드')}">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path></svg>
          </button>
          <button type="button" class="board-model-viewer-close icon-btn-sm" aria-label="${t('Close', '关闭', '닫기')}" title="${t('Close', '关闭', '닫기')}">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9"><path d="m6 6 12 12M18 6 6 18"></path></svg>
          </button>
        </div>
      </header>
      <div class="board-model-viewer-stage">
        <div class="board-model-viewer-status" role="status" aria-live="polite"></div>
      </div>
    </section>
  `;
  overlay.querySelector('.board-model-viewer-heading strong').textContent = file.name || t('3D model', '3D 模型', '3D 모델');
  overlay.querySelector('.board-model-viewer-close').addEventListener('click', closeBoardModelViewer);
  overlay.querySelector('.board-model-viewer-download').addEventListener('click', (event) => {
    void exportBoardModel(file, event.currentTarget);
  });
  overlay.addEventListener('pointerdown', (event) => {
    if (event.target === overlay) closeBoardModelViewer();
  });
  return overlay;
}

const BOARD_MODEL_FORMATS = new Set(['glb', 'fbx', 'obj']);

function boardModelFormat(file) {
  if (!file) return '';
  const extension = String(file.ext || '').trim().toLowerCase().replace(/^\./, '');
  if (BOARD_MODEL_FORMATS.has(extension)) return extension;
  const match = String(file.name || '').trim().toLowerCase().match(/\.([a-z0-9]+)$/);
  if (match && BOARD_MODEL_FORMATS.has(match[1])) return match[1];
  const mime = String(file.mimeType || file.mime || '').trim().toLowerCase().split(';', 1)[0];
  if (mime === 'model/gltf-binary') return 'glb';
  if (mime === 'model/vnd.autodesk.fbx' || mime === 'application/vnd.autodesk.fbx') return 'fbx';
  if (mime === 'model/obj') return 'obj';
  return '';
}

function isSupportedBoardModel(file) {
  if (typeof isModelFile === 'function') return isModelFile(file);
  return BOARD_MODEL_FORMATS.has(boardModelFormat(file));
}

function boardModelArrayBuffer(value) {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  if (value && value.type === 'Buffer' && Array.isArray(value.data)) {
    return Uint8Array.from(value.data).buffer;
  }
  throw Object.assign(new Error('The 3D model data is invalid.'), { code: 'invalid-model-data' });
}

async function readBoardModelPayload(file) {
  const fallbackFormat = boardModelFormat(file);
  if (window.messsAPI && typeof window.messsAPI.readModelData === 'function' && file.id) {
    const result = await window.messsAPI.readModelData(file.id);
    if (!result || !result.ok) {
      const error = new Error(result && result.message || 'The 3D model could not be read.');
      error.code = result && result.reason || 'model-read-failed';
      throw error;
    }
    const format = String(result.format || fallbackFormat).trim().toLowerCase();
    if (!BOARD_MODEL_FORMATS.has(format)) {
      throw Object.assign(new Error('This 3D model format is not supported.'), { code: 'unsupported-model-format' });
    }
    return { format, data: boardModelArrayBuffer(result.data) };
  }

  const url = String(file.url || (file.id ? `messs-file://${file.id}` : '')).trim();
  if (!url) throw Object.assign(new Error('The 3D model could not be found.'), { code: 'file-not-found' });
  const response = await fetch(url);
  if (!response.ok) {
    throw Object.assign(new Error(`The 3D model could not be read (${response.status}).`), { code: 'model-read-failed' });
  }
  return { format: fallbackFormat, data: await response.arrayBuffer() };
}

function parseGlbModel(vendor, data) {
  return new Promise((resolve, reject) => {
    const loader = new vendor.GLTFLoader();
    if (vendor.MeshoptDecoder) loader.setMeshoptDecoder(vendor.MeshoptDecoder);
    loader.parse(data, '', (gltf) => {
      resolve({ root: gltf.scene, animations: Array.isArray(gltf.animations) ? gltf.animations : [] });
    }, reject);
  });
}

async function parseBoardModel(vendor, payload) {
  if (payload.format === 'glb') {
    if (!vendor.GLTFLoader) {
      throw Object.assign(new Error('The GLB loader is unavailable.'), { code: 'model-loader-unavailable' });
    }
    return parseGlbModel(vendor, payload.data);
  }
  if (payload.format === 'fbx') {
    if (!vendor.FBXLoader) {
      throw Object.assign(new Error('The FBX loader is unavailable.'), { code: 'model-loader-unavailable' });
    }
    const root = new vendor.FBXLoader().parse(payload.data, '');
    return { root, animations: Array.isArray(root.animations) ? root.animations : [] };
  }
  if (payload.format === 'obj') {
    if (!vendor.OBJLoader) {
      throw Object.assign(new Error('The OBJ loader is unavailable.'), { code: 'model-loader-unavailable' });
    }
    const text = new TextDecoder('utf-8').decode(new Uint8Array(payload.data));
    const root = new vendor.OBJLoader().parse(text);
    return { root, animations: [] };
  }
  throw Object.assign(new Error('This 3D model format is not supported.'), { code: 'unsupported-model-format' });
}

function boardModelErrorMessage(error) {
  const code = String(error && error.code || '');
  if (code === 'model-too-large') {
    return t('This 3D model is too large to preview safely.', '这个 3D 模型太大，无法安全预览。', '이 3D 모델은 안전하게 미리 보기에는 너무 큽니다.');
  }
  if (code === 'unsupported-model-format' || code === 'model-loader-unavailable') {
    return t('This build cannot preview that 3D format.', '当前版本无法预览这种 3D 格式。', '현재 버전에서는 이 3D 형식을 미리 볼 수 없습니다.');
  }
  if (code === 'file-not-found' || code === 'model-changed') {
    return t('This 3D model is no longer available.', '这个 3D 模型已无法读取。', '이 3D 모델을 더 이상 읽을 수 없습니다.');
  }
  return t('Could not preview this 3D model.', '无法预览这个 3D 模型。', '이 3D 모델을 미리 볼 수 없습니다.');
}

function openBoardModelViewer(file) {
  if (!file || !isSupportedBoardModel(file)) return;
  closeBoardModelViewer();
  const vendor = window.MesssModelViewerVendor;
  const overlay = createBoardModelViewerOverlay(file);
  const format = boardModelFormat(file);
  const mark = overlay.querySelector('.board-model-viewer-mark');
  if (mark) mark.textContent = format ? format.toUpperCase() : '3D';
  document.body.appendChild(overlay);
  BoardModelViewer.overlay = overlay;
  const loadGeneration = BoardModelViewer.loadGeneration;
  const fail = (error) => {
    if (loadGeneration !== BoardModelViewer.loadGeneration || !BoardModelViewer.overlay) return;
    console.error('Could not load 3D model:', error);
    setBoardModelViewerState('error', boardModelErrorMessage(error));
  };
  if (!vendor || !vendor.THREE || !vendor.OrbitControls) {
    fail(new Error('3D viewer bundle is unavailable'));
    return;
  }
  try {
    const { THREE, OrbitControls, RoomEnvironment } = vendor;
    const stage = overlay.querySelector('.board-model-viewer-stage');
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.domElement.className = 'board-model-viewer-canvas';
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setClearColor(0x111317, 1);
    stage.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 1000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    const hemi = new THREE.HemisphereLight(0xffffff, 0x303642, 1.5);
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(4, 7, 5);
    scene.add(hemi, key);
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const environmentScene = new RoomEnvironment();
    const environmentTarget = pmremGenerator.fromScene(environmentScene, 0.04);
    scene.environment = environmentTarget.texture;
    BoardModelViewer.renderer = renderer;
    BoardModelViewer.scene = scene;
    BoardModelViewer.camera = camera;
    BoardModelViewer.controls = controls;
    BoardModelViewer.clock = new THREE.Clock();
    BoardModelViewer.environmentScene = environmentScene;
    BoardModelViewer.environmentTarget = environmentTarget;
    BoardModelViewer.pmremGenerator = pmremGenerator;
    BoardModelViewer.resizeObserver = new ResizeObserver(resizeBoardModelViewer);
    BoardModelViewer.resizeObserver.observe(stage);
    resizeBoardModelViewer();
    renderBoardModelFrame();
    setBoardModelViewerState('loading', t('Loading 3D model...', '正在加载 3D 模型...', '3D 모델을 불러오는 중...'));
    void readBoardModelPayload(file).then((payload) => parseBoardModel(vendor, payload)).then(({ root, animations }) => {
      if (loadGeneration !== BoardModelViewer.loadGeneration || !BoardModelViewer.scene) {
        disposeBoardModelObject(root);
        return;
      }
      if (!root || !root.isObject3D) {
        throw Object.assign(new Error('The model does not contain a valid scene.'), { code: 'invalid-model-data' });
      }
      BoardModelViewer.root = root;
      scene.add(root);
      frameBoardModel(root, camera, controls, THREE);
      if (Array.isArray(animations) && animations.length) {
        BoardModelViewer.mixer = new THREE.AnimationMixer(root);
        animations.forEach((clip) => BoardModelViewer.mixer.clipAction(clip).play());
      }
      setBoardModelViewerState('ready');
    }).catch(fail);
    BoardModelViewer.keyHandler = (event) => {
      if (event.key === 'Escape') closeBoardModelViewer();
    };
    document.addEventListener('keydown', BoardModelViewer.keyHandler);
    requestAnimationFrame(() => overlay.classList.add('is-visible'));
    overlay.querySelector('.board-model-viewer-close').focus();
  } catch (error) {
    fail(error);
  }
}

window.openBoardModelViewer = openBoardModelViewer;
window.closeBoardModelViewer = closeBoardModelViewer;
window.MesssBoardModelViewer = BoardModelViewer;
