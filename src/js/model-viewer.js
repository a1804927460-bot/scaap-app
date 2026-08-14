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
  hemisphereLight: null,
  keyLight: null,
  rimLight: null,
  materialStats: null,
  modelStats: null,
  originalMaterials: new Map(),
  overrideMaterials: new Set(),
  displayMode: 'pbr',
  lightDragCleanup: null,
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
  if (BoardModelViewer.lightDragCleanup) BoardModelViewer.lightDragCleanup();
  if (BoardModelViewer.mixer && BoardModelViewer.root) {
    BoardModelViewer.mixer.stopAllAction();
    BoardModelViewer.mixer.uncacheRoot(BoardModelViewer.root);
  }
  restoreBoardModelMaterials();
  disposeBoardModelObject(BoardModelViewer.root);
  BoardModelViewer.overrideMaterials.forEach((material) => material.dispose());
  BoardModelViewer.overrideMaterials.clear();
  BoardModelViewer.originalMaterials.clear();
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
  BoardModelViewer.hemisphereLight = null;
  BoardModelViewer.keyLight = null;
  BoardModelViewer.rimLight = null;
  BoardModelViewer.materialStats = null;
  BoardModelViewer.modelStats = null;
  BoardModelViewer.displayMode = 'pbr';
  BoardModelViewer.lightDragCleanup = null;
  BoardModelViewer.keyHandler = null;
}

function createBoardWebglRenderer(THREE, options = {}) {
  return new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance', ...options });
}

const BOARD_MODEL_COLOR_TEXTURE_SLOTS = new Set([
  'map',
  'emissiveMap',
  'sheenColorMap',
  'specularColorMap'
]);

function prepareBoardModelMaterials(root, renderer, THREE) {
  if (!root || !renderer) return { meshes: 0, texturedMeshes: 0, textureSlots: {} };
  const maxAnisotropy = Math.max(1, Math.min(16, renderer.capabilities.getMaxAnisotropy()));
  let meshes = 0;
  let texturedMeshes = 0;
  const textureSlots = {};
  root.traverse((object) => {
    if (!object || !object.isMesh) return;
    meshes += 1;
    if (!object.material) {
      object.material = new THREE.MeshStandardMaterial({ color: 0xb9bec8, roughness: 0.72, metalness: 0.08 });
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    let hasTexture = false;
    materials.filter(Boolean).forEach((material) => {
      Object.entries(material).forEach(([slot, value]) => {
        if (!value || !value.isTexture) return;
        hasTexture = true;
        textureSlots[slot] = (textureSlots[slot] || 0) + 1;
        value.anisotropy = maxAnisotropy;
        if (BOARD_MODEL_COLOR_TEXTURE_SLOTS.has(slot)) value.colorSpace = THREE.SRGBColorSpace;
        value.needsUpdate = true;
      });
      if ('envMapIntensity' in material) material.envMapIntensity = Math.max(0.85, Number(material.envMapIntensity) || 0);
      material.needsUpdate = true;
    });
    if (hasTexture) texturedMeshes += 1;
  });
  return { meshes, texturedMeshes, textureSlots };
}

function cacheBoardModelMaterials(root) {
  BoardModelViewer.originalMaterials.clear();
  if (!root) return;
  root.traverse((object) => {
    if (object && object.isMesh) BoardModelViewer.originalMaterials.set(object, object.material);
  });
}

function restoreBoardModelMaterials() {
  BoardModelViewer.originalMaterials.forEach((material, mesh) => {
    if (mesh) mesh.material = material;
  });
}

function createBoardModelOverrideMaterial(THREE, mode) {
  const material = new THREE.MeshStandardMaterial(mode === 'clay'
    ? { color: 0xb97855, roughness: 0.86, metalness: 0.02 }
    : { color: 0xb9bec7, roughness: 0.58, metalness: 0.12 });
  BoardModelViewer.overrideMaterials.add(material);
  return material;
}

function setBoardModelDisplayMode(mode) {
  if (!['pbr', 'shaded', 'clay'].includes(mode) || !BoardModelViewer.root) return;
  const THREE = window.MesssModelViewerVendor && window.MesssModelViewerVendor.THREE;
  if (!THREE) return;
  BoardModelViewer.overrideMaterials.forEach((material) => material.dispose());
  BoardModelViewer.overrideMaterials.clear();
  BoardModelViewer.originalMaterials.forEach((originalMaterial, mesh) => {
    if (!mesh) return;
    if (mode === 'pbr') {
      mesh.material = originalMaterial;
      return;
    }
    const count = Array.isArray(originalMaterial) ? originalMaterial.length : 1;
    const replacements = Array.from({ length: count }, () => createBoardModelOverrideMaterial(THREE, mode));
    mesh.material = Array.isArray(originalMaterial) ? replacements : replacements[0];
  });
  BoardModelViewer.displayMode = mode;
  const overlay = BoardModelViewer.overlay;
  if (overlay) {
    overlay.querySelectorAll('[data-model-display-mode]').forEach((button) => {
      const active = button.dataset.modelDisplayMode === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });
  }
}

function boardModelSceneStats(root, THREE) {
  const materials = new Set();
  const textures = new Set();
  const bounds = new THREE.Box3().setFromObject(root);
  let meshes = 0;
  let triangles = 0;
  root.traverse((object) => {
    if (!object || !object.isMesh) return;
    meshes += 1;
    const geometry = object.geometry;
    if (geometry) {
      const count = geometry.index ? geometry.index.count : geometry.attributes.position && geometry.attributes.position.count;
      triangles += Math.floor((Number(count) || 0) / 3);
    }
    (Array.isArray(object.material) ? object.material : [object.material]).filter(Boolean).forEach((material) => {
      materials.add(material);
      Object.values(material).forEach((value) => {
        if (value && value.isTexture) textures.add(value);
      });
    });
  });
  const size = bounds.getSize(new THREE.Vector3());
  return { meshes, materials: materials.size, textures: textures.size, triangles, size };
}

function updateBoardModelSidebar() {
  const overlay = BoardModelViewer.overlay;
  const stats = BoardModelViewer.modelStats;
  const materialStats = BoardModelViewer.materialStats;
  if (!overlay || !stats || !materialStats) return;
  const values = {
    meshes: stats.meshes,
    materials: stats.materials,
    textures: stats.textures,
    triangles: stats.triangles.toLocaleString(),
    dimensions: [stats.size.x, stats.size.y, stats.size.z].map((value) => {
      const absolute = Math.abs(value);
      return absolute >= 100 ? value.toFixed(0) : absolute >= 10 ? value.toFixed(1) : value.toFixed(2);
    }).join(' x ')
  };
  Object.entries(values).forEach(([key, value]) => {
    const element = overlay.querySelector(`[data-model-stat="${key}"]`);
    if (element) element.textContent = String(value);
  });
  const slots = materialStats.textureSlots || {};
  const mapDefinitions = [
    ['map', t('Base color', '基础颜色', '기본 색상')],
    ['normalMap', t('Normal', '法线', '노멀')],
    ['roughnessMap', t('Roughness', '粗糙度', '거칠기')],
    ['metalnessMap', t('Metallic', '金属度', '금속성')],
    ['aoMap', t('Ambient occlusion', '环境光遮蔽', '앰비언트 오클루전')],
    ['emissiveMap', t('Emissive', '自发光', '발광')]
  ];
  const list = overlay.querySelector('.board-model-material-maps');
  if (list) {
    list.innerHTML = '';
    mapDefinitions.forEach(([slot, label]) => {
      const row = document.createElement('li');
      const count = Number(slots[slot]) || 0;
      row.className = count ? 'is-present' : 'is-missing';
      row.innerHTML = `<span>${label}</span><strong>${count ? t(`${count} map${count === 1 ? '' : 's'}`, `${count} 张`, `${count}개`) : t('None', '无', '없음')}</strong>`;
      list.appendChild(row);
    });
  }
}

async function renderBoardModelAfterTextureUpload(renderer, scene, camera) {
  renderer.render(scene, camera);
  await new Promise((resolve) => requestAnimationFrame(resolve));
  renderer.render(scene, camera);
  await new Promise((resolve) => requestAnimationFrame(resolve));
  renderer.render(scene, camera);
}

function installBoardModelLightDrag(canvas, light, controls, THREE, lighting = {}) {
  let drag = null;
  const hemisphereLight = lighting.hemisphereLight || null;
  const rimLight = lighting.rimLight || null;
  const scene = lighting.scene || null;
  const indicator = lighting.indicator || null;
  const applyLightContrast = (isDragging) => {
    light.intensity = isDragging ? 3.4 : 2.4;
    if (hemisphereLight) hemisphereLight.intensity = isDragging ? 0.3 : 0.7;
    if (rimLight) rimLight.intensity = isDragging ? 1.4 : 0.8;
    if (scene && 'environmentIntensity' in scene) scene.environmentIntensity = isDragging ? 0.45 : 0.75;
  };
  const updateLight = () => {
    if (!drag) return;
    const radius = 8;
    const horizontal = Math.cos(drag.elevation) * radius;
    light.position.set(
      Math.sin(drag.azimuth) * horizontal,
      Math.sin(drag.elevation) * radius,
      Math.cos(drag.azimuth) * horizontal
    );
    light.target.position.set(0, 0, 0);
    light.target.updateMatrixWorld();
    if (rimLight) {
      rimLight.position.set(-light.position.x, Math.max(1.5, -light.position.y * 0.35), -light.position.z);
      rimLight.target.position.set(0, 0, 0);
      rimLight.target.updateMatrixWorld();
    }
    if (indicator) {
      const degrees = THREE.MathUtils.radToDeg(drag.azimuth);
      indicator.style.setProperty('--light-angle', `${degrees}deg`);
    }
  };
  const onPointerDown = (event) => {
    if (event.target !== canvas || !event.shiftKey || event.button !== 2) return;
    const radius = Math.max(0.001, light.position.length());
    drag = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      azimuth: Math.atan2(light.position.x, light.position.z),
      elevation: Math.asin(THREE.MathUtils.clamp(light.position.y / radius, -1, 1))
    };
    controls.enabled = false;
    canvas.classList.add('is-light-dragging');
    if (indicator) indicator.classList.add('is-active');
    applyLightContrast(true);
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const onPointerMove = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const deltaX = event.clientX - drag.x;
    const deltaY = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    drag.azimuth += deltaX * 0.018;
    drag.elevation = THREE.MathUtils.clamp(drag.elevation - deltaY * 0.014, -1.35, 1.35);
    updateLight();
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const finish = (event) => {
    if (!drag || (event && event.pointerId !== drag.pointerId)) return;
    const pointerId = drag.pointerId;
    drag = null;
    controls.enabled = true;
    canvas.classList.remove('is-light-dragging');
    if (indicator) indicator.classList.remove('is-active');
    applyLightContrast(false);
    if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    if (event) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  const onContextMenu = (event) => {
    if (event.shiftKey || drag) event.preventDefault();
  };
  // Capture before OrbitControls sees the gesture so Shift + right-drag moves
  // only the light instead of panning the camera at the same time.
  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('pointermove', onPointerMove, true);
  window.addEventListener('pointerup', finish, true);
  window.addEventListener('pointercancel', finish, true);
  canvas.addEventListener('contextmenu', onContextMenu, true);
  applyLightContrast(false);
  return () => {
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('pointerup', finish, true);
    window.removeEventListener('pointercancel', finish, true);
    canvas.removeEventListener('contextmenu', onContextMenu, true);
    controls.enabled = true;
    if (indicator) indicator.classList.remove('is-active');
  };
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
  root.updateMatrixWorld(true);
  const maxSize = Math.max(size.x, size.y, size.z, 0.01);
  const verticalHalfFov = THREE.MathUtils.degToRad(camera.fov * 0.5);
  const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * Math.max(0.1, camera.aspect));
  const fitHalfFov = Math.max(0.08, Math.min(verticalHalfFov, horizontalHalfFov));
  const radius = Math.max(0.01, size.length() * 0.5);
  const distance = (radius / Math.sin(fitHalfFov)) * 1.12;
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
      <div class="board-model-viewer-body">
        <div class="board-model-viewer-stage">
          <div class="board-model-light-indicator" aria-hidden="true"><span></span></div>
          <div class="board-model-viewer-status" role="status" aria-live="polite"></div>
        </div>
        <aside class="board-model-viewer-sidebar">
          <div class="board-model-display-modes" role="tablist" aria-label="${t('Preview material mode', '预览材质模式', '미리보기 재질 모드')}">
            <button type="button" class="is-active" data-model-display-mode="pbr" role="tab" aria-selected="true">PBR</button>
            <button type="button" data-model-display-mode="shaded" role="tab" aria-selected="false">Shaded</button>
            <button type="button" data-model-display-mode="clay" role="tab" aria-selected="false">Clay</button>
          </div>
          <section class="board-model-properties">
            <h3>${t('Model', '模型', '모델')}</h3>
            <dl>
              <div><dt>${t('Meshes', '网格', '메시')}</dt><dd data-model-stat="meshes">-</dd></div>
              <div><dt>${t('Materials', '材质', '재질')}</dt><dd data-model-stat="materials">-</dd></div>
              <div><dt>${t('Textures', '贴图', '텍스처')}</dt><dd data-model-stat="textures">-</dd></div>
              <div><dt>${t('Triangles', '三角面', '삼각형')}</dt><dd data-model-stat="triangles">-</dd></div>
              <div><dt>${t('Dimensions', '尺寸', '크기')}</dt><dd data-model-stat="dimensions">-</dd></div>
            </dl>
          </section>
          <section class="board-model-properties">
            <h3>${t('PBR maps', 'PBR 贴图', 'PBR 맵')}</h3>
            <ul class="board-model-material-maps"></ul>
          </section>
          <button type="button" class="board-model-viewer-download-wide">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path></svg>
            ${t('Download model', '下载模型', '모델 다운로드')}
          </button>
        </aside>
      </div>
    </section>
  `;
  overlay.querySelector('.board-model-viewer-heading strong').textContent = file.name || t('3D model', '3D 模型', '3D 모델');
  overlay.querySelector('.board-model-viewer-close').addEventListener('click', closeBoardModelViewer);
  overlay.querySelector('.board-model-viewer-download').addEventListener('click', (event) => {
    void exportBoardModel(file, event.currentTarget);
  });
  overlay.querySelector('.board-model-viewer-download-wide').addEventListener('click', (event) => {
    void exportBoardModel(file, event.currentTarget);
  });
  overlay.querySelector('.board-model-display-modes').addEventListener('click', (event) => {
    const button = event.target.closest('[data-model-display-mode]');
    if (button) setBoardModelDisplayMode(button.dataset.modelDisplayMode);
  });
  overlay.addEventListener('pointerdown', (event) => {
    if (event.target === overlay) closeBoardModelViewer();
  });
  return overlay;
}

const BOARD_MODEL_FORMATS = new Set(['glb', 'fbx', 'obj']);
const BoardModelPreviewJobs = new Map();
let BoardModelPreviewQueue = Promise.resolve();

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

async function renderBoardModelPreview(file) {
  const vendor = window.MesssModelViewerVendor;
  if (!vendor || !vendor.THREE || !vendor.OrbitControls || !window.messsAPI ||
      typeof window.messsAPI.saveModelPreview !== 'function') return '';
  const { THREE, OrbitControls } = vendor;
  const payload = await readBoardModelPayload(file);
  const parsed = await parseBoardModel(vendor, payload);
  const renderer = createBoardWebglRenderer(THREE, { preserveDrawingBuffer: true });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 1000);
  const controls = new OrbitControls(camera, renderer.domElement);
  let environmentScene = null;
  let environmentTarget = null;
  let pmremGenerator = null;
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(512, 512, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.setClearColor(0x111317, 1);
    prepareBoardModelMaterials(parsed.root, renderer, THREE);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x20242b, 0.8));
    const key = new THREE.DirectionalLight(0xfff7e8, 2.4);
    key.position.set(4, 7, 5);
    const rim = new THREE.DirectionalLight(0x9ebeff, 0.7);
    rim.position.set(-4, 2, -5);
    scene.add(key, key.target, rim, rim.target, parsed.root);
    if (vendor.RoomEnvironment) {
      pmremGenerator = new THREE.PMREMGenerator(renderer);
      environmentScene = new vendor.RoomEnvironment();
      environmentTarget = pmremGenerator.fromScene(environmentScene, 0.04);
      scene.environment = environmentTarget.texture;
      if ('environmentIntensity' in scene) scene.environmentIntensity = 0.75;
    }
    frameBoardModel(parsed.root, camera, controls, THREE);
    await renderBoardModelAfterTextureUpload(renderer, scene, camera);
    const dataUrl = renderer.domElement.toDataURL('image/png');
    const saved = await window.messsAPI.saveModelPreview(file.id, dataUrl);
    if (!saved || !saved.ok || !saved.url) return '';
    file.modelPreviewUrl = String(saved.url);
    return file.modelPreviewUrl;
  } finally {
    controls.dispose();
    disposeBoardModelObject(parsed.root);
    disposeBoardModelObject(environmentScene);
    if (environmentTarget) environmentTarget.dispose();
    if (pmremGenerator) pmremGenerator.dispose();
    renderer.renderLists.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

function requestBoardModelPreview(file) {
  const id = String(file && file.id || '');
  if (!id || !isSupportedBoardModel(file)) return Promise.resolve('');
  if (BoardModelPreviewJobs.has(id)) return BoardModelPreviewJobs.get(id);
  const job = BoardModelPreviewQueue
    .catch(() => {})
    .then(() => renderBoardModelPreview(file));
  BoardModelPreviewQueue = job.then(() => undefined, () => undefined);
  BoardModelPreviewJobs.set(id, job);
  job.finally(() => {
    if (BoardModelPreviewJobs.get(id) === job) BoardModelPreviewJobs.delete(id);
  }).catch(() => {});
  return job;
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
    const renderer = createBoardWebglRenderer(THREE);
    renderer.domElement.className = 'board-model-viewer-canvas';
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.setClearColor(0x111317, 1);
    stage.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 1000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    const hemi = new THREE.HemisphereLight(0xffffff, 0x171a20, 0.7);
    const key = new THREE.DirectionalLight(0xfff7e8, 2.4);
    key.position.set(4, 7, 5);
    const rim = new THREE.DirectionalLight(0x9ebeff, 0.8);
    rim.position.set(-4, 2, -5);
    scene.add(hemi, key, key.target, rim, rim.target);
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const environmentScene = new RoomEnvironment();
    const environmentTarget = pmremGenerator.fromScene(environmentScene, 0.04);
    scene.environment = environmentTarget.texture;
    if ('environmentIntensity' in scene) scene.environmentIntensity = 0.75;
    BoardModelViewer.renderer = renderer;
    BoardModelViewer.scene = scene;
    BoardModelViewer.camera = camera;
    BoardModelViewer.controls = controls;
    BoardModelViewer.clock = new THREE.Clock();
    BoardModelViewer.environmentScene = environmentScene;
    BoardModelViewer.environmentTarget = environmentTarget;
    BoardModelViewer.pmremGenerator = pmremGenerator;
    BoardModelViewer.hemisphereLight = hemi;
    BoardModelViewer.keyLight = key;
    BoardModelViewer.rimLight = rim;
    BoardModelViewer.lightDragCleanup = installBoardModelLightDrag(renderer.domElement, key, controls, THREE, {
      hemisphereLight: hemi,
      rimLight: rim,
      scene,
      indicator: overlay.querySelector('.board-model-light-indicator')
    });
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
      BoardModelViewer.materialStats = prepareBoardModelMaterials(root, renderer, THREE);
      cacheBoardModelMaterials(root);
      BoardModelViewer.modelStats = boardModelSceneStats(root, THREE);
      BoardModelViewer.root = root;
      scene.add(root);
      frameBoardModel(root, camera, controls, THREE);
      setBoardModelDisplayMode('pbr');
      updateBoardModelSidebar();
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
window.requestBoardModelPreview = requestBoardModelPreview;
window.MesssBoardModelViewer = BoardModelViewer;
