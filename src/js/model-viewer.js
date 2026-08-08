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

function openBoardModelViewer(file) {
  if (!file || !isGlbFile(file)) return;
  closeBoardModelViewer();
  const vendor = window.MesssModelViewerVendor;
  const overlay = createBoardModelViewerOverlay(file);
  document.body.appendChild(overlay);
  BoardModelViewer.overlay = overlay;
  const loadGeneration = BoardModelViewer.loadGeneration;
  const fail = (error) => {
    if (loadGeneration !== BoardModelViewer.loadGeneration || !BoardModelViewer.overlay) return;
    console.error('Could not load 3D model:', error);
    setBoardModelViewerState('error', t('Could not preview this 3D model.', '无法预览这个 3D 模型。', '이 3D 모델을 미리 볼 수 없습니다.'));
  };
  if (!vendor || !vendor.THREE || !vendor.GLTFLoader || !vendor.OrbitControls) {
    fail(new Error('3D viewer bundle is unavailable'));
    return;
  }
  try {
    const { THREE, GLTFLoader, OrbitControls, RoomEnvironment, MeshoptDecoder } = vendor;
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
    const loader = new GLTFLoader();
    if (MeshoptDecoder) loader.setMeshoptDecoder(MeshoptDecoder);
    loader.load(file.url || `messs-file://${file.id}`, (gltf) => {
      if (loadGeneration !== BoardModelViewer.loadGeneration || !BoardModelViewer.scene) {
        disposeBoardModelObject(gltf.scene);
        return;
      }
      BoardModelViewer.root = gltf.scene;
      scene.add(gltf.scene);
      frameBoardModel(gltf.scene, camera, controls, THREE);
      if (Array.isArray(gltf.animations) && gltf.animations.length) {
        BoardModelViewer.mixer = new THREE.AnimationMixer(gltf.scene);
        gltf.animations.forEach((clip) => BoardModelViewer.mixer.clipAction(clip).play());
      }
      setBoardModelViewerState('ready');
    }, undefined, fail);
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
