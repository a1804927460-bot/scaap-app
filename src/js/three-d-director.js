'use strict';

// Shot workflow follows the camera-blocking ideas popularized by Wonder Unit's
// open-source Storyboarder Shot Generator. Rendering uses the app's existing
// MIT-licensed Three.js bundle so the director remains lightweight and native.
const ThreeDDirector = {
  overlay: null,
  renderer: null,
  scene: null,
  camera: null,
  controls: null,
  stage: null,
  keyLight: null,
  fillLight: null,
  rimLight: null,
  resizeObserver: null,
  animationFrame: 0,
  currentPreset: 'wide',
  currentLayout: 'solo',
  currentLight: 'studio',
  aspect: '16:9',
  movement: 'locked',
  lens: 35,
  lightIntensity: 1.2,
  frame: { left: 0, top: 0, width: 1, height: 1 }
};

const DIRECTOR_SHOTS = {
  wide: { en: 'Establishing', zh: '\u8fdc\u666f', position: [5.2, 3.2, 6.2], target: [0, 1.15, 0], lens: 24 },
  medium: { en: 'Medium', zh: '\u4e2d\u666f', position: [4.2, 2.45, 5.3], target: [0, 1.25, 0], lens: 50 },
  close: { en: 'Close-up', zh: '\u7279\u5199', position: [4.2, 2.2, 4.8], target: [0, 1.5, 0], lens: 85 },
  low: { en: 'Low angle', zh: '\u4f4e\u673a\u4f4d', position: [4.8, .58, 5.8], target: [0, 1.45, 0], lens: 32 },
  overhead: { en: 'Overhead', zh: '\u4fef\u62cd', position: [.1, 9.2, .1], target: [0, 0, 0], lens: 28 }
};

const DIRECTOR_LAYOUTS = {
  solo: ['Solo', '\u5355\u4eba'],
  dialogue: ['Dialogue', '\u5bf9\u8bdd'],
  product: ['Product', '\u4ea7\u54c1'],
  group: ['Group', '\u7fa4\u50cf'],
  action: ['Action', '\u52a8\u4f5c'],
  empty: ['Empty', '\u7a7a\u666f']
};

const DIRECTOR_LIGHTS = {
  studio: ['Studio', '\u5f71\u68da'],
  daylight: ['Daylight', '\u65e5\u5149'],
  sunset: ['Sunset', '\u9ec4\u660f'],
  noir: ['Noir', '\u9ed1\u8272']
};

const DIRECTOR_MOVEMENTS = {
  locked: ['locked camera', '\u56fa\u5b9a\u955c\u5934'],
  dolly: ['slow dolly in', '\u7f13\u6162\u63a8\u8f68'],
  orbit: ['controlled orbit', '\u73af\u7ed5\u8fd0\u955c'],
  crane: ['crane reveal', '\u6447\u81c2\u63ed\u793a'],
  handheld: ['subtle handheld motion', '\u8f7b\u5fae\u624b\u6301\u611f']
};

function directorText(en, zh) {
  return typeof t === 'function' ? t(en, zh) : (document.documentElement.dataset.language === 'zh' ? zh : en);
}

function directorIcon(path) {
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

function directorButtonGroup(items, active, dataName) {
  return Object.entries(items).map(([id, labels]) => (
    `<button type="button" data-${dataName}="${id}" class="${id === active ? 'is-active' : ''}">${directorText(labels[0], labels[1])}</button>`
  )).join('');
}

function ensureThreeDDirectorUi() {
  if (ThreeDDirector.overlay) return ThreeDDirector.overlay;
  const overlay = document.createElement('div');
  overlay.id = 'three-d-director-overlay';
  overlay.className = 'three-d-director-overlay';
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'three-d-director-title');
  overlay.innerHTML = `
    <section class="three-d-director-shell">
      <header class="three-d-director-header">
        <div class="three-d-director-brand">
          <strong id="three-d-director-title">${directorText('3D Director', '3D \u5bfc\u6f14\u53f0')}</strong>
          <small>${directorText('Shot blocking for AI image and video', 'AI \u751f\u56fe\u4e0e\u89c6\u9891\u955c\u5934\u9884\u6f14')}</small>
        </div>
        <nav class="three-d-director-presets" aria-label="${directorText('Shot presets', '\u955c\u5934\u9884\u8bbe')}">
          ${Object.entries(DIRECTOR_SHOTS).map(([id, shot]) => `<button type="button" data-shot="${id}" class="${id === ThreeDDirector.currentPreset ? 'is-active' : ''}">${directorText(shot.en, shot.zh)}</button>`).join('')}
        </nav>
        <button class="three-d-director-close" type="button" title="${directorText('Close', '\u5173\u95ed')}" aria-label="${directorText('Close', '\u5173\u95ed')}"><span aria-hidden="true">&times;</span></button>
      </header>
      <div class="three-d-director-stage">
        <div class="three-d-director-viewport"></div>
        <div class="three-d-director-frame" aria-hidden="true"></div>
        <div class="three-d-director-hud"><i></i><span class="three-d-director-hud-copy"></span></div>
      </div>
      <aside class="three-d-director-inspector">
        <section class="three-d-director-section">
          <h3>${directorText('Shot', '\u955c\u5934')}</h3>
          <input class="three-d-director-shot-name" type="text" maxlength="80" value="${directorText('Untitled shot', '\u672a\u547d\u540d\u955c\u5934')}" aria-label="${directorText('Shot name', '\u955c\u5934\u540d\u79f0')}" />
          <div class="three-d-director-aspects">
            ${['16:9', '9:16', '1:1', '4:3', '21:9'].map(value => `<button type="button" data-aspect="${value}" class="${value === ThreeDDirector.aspect ? 'is-active' : ''}">${value}</button>`).join('')}
          </div>
        </section>
        <section class="three-d-director-section">
          <h3>${directorText('Blocking', '\u8c03\u5ea6')}</h3>
          <div class="three-d-director-layouts">${directorButtonGroup(DIRECTOR_LAYOUTS, ThreeDDirector.currentLayout, 'layout')}</div>
        </section>
        <section class="three-d-director-section">
          <h3>${directorText('Camera', '\u6444\u5f71\u673a')}</h3>
          <div class="three-d-director-field"><label for="three-d-director-lens">${directorText('Focal length', '\u7126\u6bb5')}</label><output id="three-d-director-lens-output">35 mm</output><input id="three-d-director-lens" type="range" min="18" max="135" step="1" value="35" /></div>
          <div class="three-d-director-field"><label for="three-d-director-movement">${directorText('Movement', '\u8fd0\u955c')}</label><select id="three-d-director-movement">${Object.entries(DIRECTOR_MOVEMENTS).map(([id, labels]) => `<option value="${id}">${directorText(labels[0], labels[1])}</option>`).join('')}</select></div>
        </section>
        <section class="three-d-director-section">
          <h3>${directorText('Lighting', '\u706f\u5149')}</h3>
          <div class="three-d-director-light-presets">${directorButtonGroup(DIRECTOR_LIGHTS, ThreeDDirector.currentLight, 'light')}</div>
          <div class="three-d-director-field"><label for="three-d-director-intensity">${directorText('Key intensity', '\u4e3b\u5149\u5f3a\u5ea6')}</label><output id="three-d-director-intensity-output">1.2</output><input id="three-d-director-intensity" type="range" min="0.2" max="3" step="0.1" value="1.2" /></div>
        </section>
        <section class="three-d-director-section">
          <h3>${directorText('AI shot prompt', 'AI \u955c\u5934\u63d0\u793a\u8bcd')}</h3>
          <textarea class="three-d-director-prompt" spellcheck="false"></textarea>
        </section>
      </aside>
      <footer class="three-d-director-footer">
        <span class="three-d-director-footer-note">${directorText('Drag to orbit, wheel to zoom, right-drag to pan', '\u62d6\u62fd\u73af\u7ed5\uff0c\u6eda\u8f6e\u7f29\u653e\uff0c\u53f3\u952e\u62d6\u62fd\u5e73\u79fb')}</span>
        <button class="three-d-director-action" type="button" data-director-action="copy">${directorIcon('M8 8h11v11H8zM5 16H4V5h11v1')}<span>${directorText('Copy prompt', '\u590d\u5236\u63d0\u793a\u8bcd')}</span></button>
        <button class="three-d-director-action" type="button" data-director-action="snapshot">${directorIcon('M4 7h4l2-2h4l2 2h4v12H4zM12 10a3 3 0 1 0 0 6 3 3 0 0 0 0-6')}<span>${directorText('Add shot to canvas', '\u6dfb\u52a0\u955c\u5934\u5230\u753b\u5e03')}</span></button>
        <button class="three-d-director-action is-primary" type="button" data-director-action="image">${directorIcon('M4 5h16v14H4zM7 15l3-3 3 3 2-2 3 3')}<span>${directorText('Use for image', '\u7528\u4e8e\u751f\u56fe')}</span></button>
        <button class="three-d-director-action is-primary" type="button" data-director-action="video">${directorIcon('M3 6h12v12H3zM15 10l6-3v10l-6-3z')}<span>${directorText('Use for video', '\u7528\u4e8e\u89c6\u9891')}</span></button>
      </footer>
    </section>`;
  document.body.append(overlay);
  ThreeDDirector.overlay = overlay;
  bindThreeDDirectorUi();
  return overlay;
}

function createDirectorActor(THREE, color, x, z, rotation = 0) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color, roughness: .66, metalness: .03 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(.32, 1.05, 6, 12), material);
  body.position.y = 1.05;
  body.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(.27, 20, 14), material);
  head.position.y = 1.9;
  head.castShadow = true;
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(.42, .46, 32),
    new THREE.MeshBasicMaterial({ color: 0x58bde8, transparent: true, opacity: .75, side: THREE.DoubleSide })
  );
  marker.rotation.x = -Math.PI / 2;
  marker.position.y = .012;
  group.add(body, head, marker);
  group.position.set(x, 0, z);
  group.rotation.y = rotation;
  return group;
}

function buildDirectorStage() {
  const vendor = window.MesssModelViewerVendor;
  const host = ThreeDDirector.overlay.querySelector('.three-d-director-viewport');
  if (!vendor || !vendor.THREE || !vendor.OrbitControls || !host) return false;
  const { THREE, OrbitControls } = vendor;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setClearColor(0x090b0d, 1);
  host.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x090b0d);
  scene.fog = new THREE.Fog(0x090b0d, 14, 34);
  const camera = new THREE.PerspectiveCamera(38, 1, .05, 120);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = .075;
  controls.minDistance = 1.25;
  controls.maxDistance = 24;
  controls.maxPolarAngle = Math.PI * .49;
  controls.target.set(0, 1.15, 0);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(36, 36),
    new THREE.MeshStandardMaterial({ color: 0x15191c, roughness: .92, metalness: .02 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(36, 36, 0x40515a, 0x242d32);
  grid.position.y = .008;
  grid.material.transparent = true;
  grid.material.opacity = .48;
  scene.add(grid);

  const stage = new THREE.Group();
  scene.add(stage);
  const hemi = new THREE.HemisphereLight(0xbfdcf0, 0x17120f, .8);
  const key = new THREE.DirectionalLight(0xfff3dd, 2.35);
  key.position.set(5, 8, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  const fill = new THREE.DirectionalLight(0x8fbce9, .72);
  fill.position.set(-5, 4, 3);
  const rim = new THREE.DirectionalLight(0x5f7fff, 1.1);
  rim.position.set(-4, 5, -6);
  scene.add(hemi, key, key.target, fill, fill.target, rim, rim.target);

  ThreeDDirector.renderer = renderer;
  ThreeDDirector.scene = scene;
  ThreeDDirector.camera = camera;
  ThreeDDirector.controls = controls;
  ThreeDDirector.stage = stage;
  ThreeDDirector.keyLight = key;
  ThreeDDirector.fillLight = fill;
  ThreeDDirector.rimLight = rim;
  ThreeDDirector.resizeObserver = new ResizeObserver(resizeThreeDDirector);
  ThreeDDirector.resizeObserver.observe(host);
  setDirectorLayout(ThreeDDirector.currentLayout);
  applyDirectorShot(ThreeDDirector.currentPreset);
  applyDirectorLight(ThreeDDirector.currentLight);
  return true;
}

function disposeDirectorObject(root) {
  if (!root) return;
  root.traverse((object) => {
    if (object.geometry && typeof object.geometry.dispose === 'function') object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.filter(Boolean).forEach(material => material.dispose && material.dispose());
  });
  root.clear();
}

function setDirectorLayout(layout) {
  if (!DIRECTOR_LAYOUTS[layout] || !ThreeDDirector.stage) return;
  const THREE = window.MesssModelViewerVendor.THREE;
  disposeDirectorObject(ThreeDDirector.stage);
  ThreeDDirector.currentLayout = layout;
  if (layout === 'solo') ThreeDDirector.stage.add(createDirectorActor(THREE, 0x9fb8c7, 0, 0));
  if (layout === 'dialogue') {
    ThreeDDirector.stage.add(createDirectorActor(THREE, 0xc7a28f, -1.15, 0, -Math.PI / 5));
    ThreeDDirector.stage.add(createDirectorActor(THREE, 0x8eaec2, 1.15, .2, Math.PI / 5));
  }
  if (layout === 'group') {
    ThreeDDirector.stage.add(createDirectorActor(THREE, 0xb8a38d, -1.15, .35));
    ThreeDDirector.stage.add(createDirectorActor(THREE, 0x90adbd, 0, -.25));
    ThreeDDirector.stage.add(createDirectorActor(THREE, 0xa89ab9, 1.15, .4));
  }
  if (layout === 'action') {
    const first = createDirectorActor(THREE, 0xcf9e83, -1.35, -.2, -Math.PI / 3);
    const second = createDirectorActor(THREE, 0x789fb8, 1.1, .7, Math.PI / 2.5);
    first.rotation.z = -.12;
    second.rotation.z = .09;
    ThreeDDirector.stage.add(first, second);
  }
  if (layout === 'product') {
    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(.78, .92, 1.05, 32),
      new THREE.MeshStandardMaterial({ color: 0x3c454b, roughness: .48, metalness: .22 })
    );
    pedestal.position.y = .525;
    pedestal.castShadow = true;
    pedestal.receiveShadow = true;
    const product = new THREE.Mesh(
      new THREE.TorusKnotGeometry(.42, .14, 96, 18),
      new THREE.MeshStandardMaterial({ color: 0x74c8e9, roughness: .23, metalness: .58 })
    );
    product.position.y = 1.45;
    product.castShadow = true;
    ThreeDDirector.stage.add(pedestal, product);
  }
  syncDirectorButtons('layout', layout);
  updateDirectorPrompt();
}

function applyDirectorShot(id) {
  const shot = DIRECTOR_SHOTS[id];
  if (!shot || !ThreeDDirector.camera || !ThreeDDirector.controls) return;
  ThreeDDirector.currentPreset = id;
  ThreeDDirector.lens = shot.lens;
  ThreeDDirector.camera.position.fromArray(shot.position);
  ThreeDDirector.controls.target.fromArray(shot.target);
  ThreeDDirector.camera.setFocalLength(shot.lens);
  ThreeDDirector.camera.updateProjectionMatrix();
  ThreeDDirector.controls.update();
  const slider = ThreeDDirector.overlay.querySelector('#three-d-director-lens');
  if (slider) slider.value = String(shot.lens);
  syncDirectorLensOutput();
  syncDirectorButtons('shot', id);
  updateDirectorPrompt();
}

function applyDirectorLight(id) {
  if (!DIRECTOR_LIGHTS[id] || !ThreeDDirector.keyLight) return;
  const THREE = window.MesssModelViewerVendor.THREE;
  ThreeDDirector.currentLight = id;
  const presets = {
    studio: { key: 0xfff3dd, fill: 0x8fbce9, rim: 0x5f7fff, positions: [[5, 8, 5], [-5, 4, 3], [-4, 5, -6]] },
    daylight: { key: 0xddeeff, fill: 0x9fd5ff, rim: 0xffffff, positions: [[-5, 9, 4], [5, 3, 2], [0, 4, -6]] },
    sunset: { key: 0xff9c58, fill: 0x7c83bd, rim: 0xffd28d, positions: [[-7, 3, 4], [4, 2, 3], [3, 4, -6]] },
    noir: { key: 0xe8f3ff, fill: 0x56606a, rim: 0xffffff, positions: [[7, 8, 1], [-5, 1, 1], [-2, 5, -7]] }
  };
  const preset = presets[id];
  ThreeDDirector.keyLight.color = new THREE.Color(preset.key);
  ThreeDDirector.fillLight.color = new THREE.Color(preset.fill);
  ThreeDDirector.rimLight.color = new THREE.Color(preset.rim);
  ThreeDDirector.keyLight.position.fromArray(preset.positions[0]);
  ThreeDDirector.fillLight.position.fromArray(preset.positions[1]);
  ThreeDDirector.rimLight.position.fromArray(preset.positions[2]);
  syncDirectorLightIntensity();
  syncDirectorButtons('light', id);
  updateDirectorPrompt();
}

function syncDirectorButtons(name, value) {
  if (!ThreeDDirector.overlay) return;
  ThreeDDirector.overlay.querySelectorAll(`[data-${name}]`).forEach(button => {
    button.classList.toggle('is-active', button.dataset[name] === value);
  });
}

function syncDirectorLensOutput() {
  if (!ThreeDDirector.overlay) return;
  ThreeDDirector.overlay.querySelector('#three-d-director-lens-output').textContent = `${Math.round(ThreeDDirector.lens)} mm`;
  if (ThreeDDirector.camera) {
    ThreeDDirector.camera.setFocalLength(ThreeDDirector.lens);
    ThreeDDirector.camera.updateProjectionMatrix();
  }
  updateDirectorHud();
}

function syncDirectorLightIntensity() {
  if (!ThreeDDirector.overlay || !ThreeDDirector.keyLight) return;
  ThreeDDirector.keyLight.intensity = ThreeDDirector.lightIntensity * 1.9;
  ThreeDDirector.fillLight.intensity = ThreeDDirector.lightIntensity * .55;
  ThreeDDirector.rimLight.intensity = ThreeDDirector.lightIntensity * .82;
  ThreeDDirector.overlay.querySelector('#three-d-director-intensity-output').textContent = ThreeDDirector.lightIntensity.toFixed(1);
}

function directorCameraAngle() {
  if (!ThreeDDirector.camera || !ThreeDDirector.controls) return ['eye-level', '\u5e73\u89c6'];
  const delta = ThreeDDirector.camera.position.y - ThreeDDirector.controls.target.y;
  if (delta > 4) return ['overhead', '\u4fef\u62cd'];
  if (delta > 1.8) return ['high angle', '\u9ad8\u673a\u4f4d'];
  if (delta < -.15) return ['low angle', '\u4f4e\u673a\u4f4d'];
  return ['eye-level', '\u5e73\u89c6'];
}

function buildDirectorPrompt(kind = 'image') {
  const shot = DIRECTOR_SHOTS[ThreeDDirector.currentPreset];
  const layout = DIRECTOR_LAYOUTS[ThreeDDirector.currentLayout];
  const light = DIRECTOR_LIGHTS[ThreeDDirector.currentLight];
  const angle = directorCameraAngle();
  const movement = DIRECTOR_MOVEMENTS[ThreeDDirector.movement];
  const name = String(ThreeDDirector.overlay?.querySelector('.three-d-director-shot-name')?.value || '').trim();
  const zh = document.documentElement.dataset.language === 'zh';
  if (zh) {
    const motion = kind === 'video' ? `\uff0c${movement[1]}\uff0c\u8fd0\u52a8\u8fde\u7eed\u3001\u8282\u594f\u7a33\u5b9a` : '';
    return `${name ? `${name}\uff0c` : ''}${shot.zh}\uff0c${angle[1]}\uff0c${ThreeDDirector.lens}mm \u7535\u5f71\u955c\u5934\uff0c${layout[1]}\u8c03\u5ea6\uff0c${light[1]}\u5e03\u5149\uff0c\u4e3b\u5149\u5f3a\u5ea6 ${ThreeDDirector.lightIntensity.toFixed(1)}\uff0c${ThreeDDirector.aspect} \u753b\u5e45\uff0c\u660e\u786e\u7a7a\u95f4\u5173\u7cfb\uff0c\u81ea\u7136\u900f\u89c6\uff0c\u7535\u5f71\u7ea7\u6784\u56fe\uff0c\u9ad8\u7ec6\u8282${motion}`;
  }
  const motion = kind === 'video' ? `, ${movement[0]}, coherent motion, stable pacing` : '';
  return `${name ? `${name}, ` : ''}${shot.en} shot, ${angle[0]}, ${ThreeDDirector.lens}mm cinema lens, ${layout[0].toLowerCase()} blocking, ${light[0].toLowerCase()} lighting, key intensity ${ThreeDDirector.lightIntensity.toFixed(1)}, ${ThreeDDirector.aspect} frame, clear spatial relationships, natural perspective, cinematic composition, high detail${motion}`;
}

function updateDirectorPrompt() {
  if (!ThreeDDirector.overlay) return;
  const prompt = ThreeDDirector.overlay.querySelector('.three-d-director-prompt');
  if (prompt && document.activeElement !== prompt) prompt.value = buildDirectorPrompt('image');
  updateDirectorHud();
}

function updateDirectorHud() {
  if (!ThreeDDirector.overlay) return;
  const shot = DIRECTOR_SHOTS[ThreeDDirector.currentPreset];
  const hud = ThreeDDirector.overlay.querySelector('.three-d-director-hud-copy');
  if (hud) hud.textContent = `${directorText(shot.en, shot.zh)}  /  ${Math.round(ThreeDDirector.lens)} mm  /  ${ThreeDDirector.aspect}`;
}

function resizeThreeDDirector() {
  const host = ThreeDDirector.overlay?.querySelector('.three-d-director-viewport');
  const frame = ThreeDDirector.overlay?.querySelector('.three-d-director-frame');
  if (!host || !frame || !ThreeDDirector.renderer || !ThreeDDirector.camera) return;
  const rect = host.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  ThreeDDirector.renderer.setSize(width, height, false);
  ThreeDDirector.camera.aspect = width / height;
  ThreeDDirector.camera.updateProjectionMatrix();
  const [aw, ah] = ThreeDDirector.aspect.split(':').map(Number);
  const ratio = aw / ah;
  const margin = 24;
  const availableW = Math.max(1, width - margin * 2);
  const availableH = Math.max(1, height - margin * 2);
  let frameW = availableW;
  let frameH = frameW / ratio;
  if (frameH > availableH) {
    frameH = availableH;
    frameW = frameH * ratio;
  }
  const left = (width - frameW) / 2;
  const top = (height - frameH) / 2;
  Object.assign(frame.style, { left: `${left}px`, top: `${top}px`, width: `${frameW}px`, height: `${frameH}px`, right: 'auto', bottom: 'auto' });
  ThreeDDirector.frame = { left, top, width: frameW, height: frameH };
}

function animateThreeDDirector() {
  if (!ThreeDDirector.overlay || ThreeDDirector.overlay.hidden) return;
  ThreeDDirector.animationFrame = requestAnimationFrame(animateThreeDDirector);
  ThreeDDirector.controls?.update();
  ThreeDDirector.renderer?.render(ThreeDDirector.scene, ThreeDDirector.camera);
}

function directorSnapshotDataUrl() {
  if (!ThreeDDirector.renderer) return '';
  ThreeDDirector.renderer.render(ThreeDDirector.scene, ThreeDDirector.camera);
  const source = ThreeDDirector.renderer.domElement;
  const frame = ThreeDDirector.frame;
  const scaleX = source.width / Math.max(1, source.clientWidth);
  const scaleY = source.height / Math.max(1, source.clientHeight);
  const sx = Math.max(0, Math.round(frame.left * scaleX));
  const sy = Math.max(0, Math.round(frame.top * scaleY));
  const sw = Math.min(source.width - sx, Math.max(1, Math.round(frame.width * scaleX)));
  const sh = Math.min(source.height - sy, Math.max(1, Math.round(frame.height * scaleY)));
  const maxEdge = 1600;
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const output = document.createElement('canvas');
  output.width = Math.max(1, Math.round(sw * scale));
  output.height = Math.max(1, Math.round(sh * scale));
  const context = output.getContext('2d');
  context.drawImage(source, sx, sy, sw, sh, 0, 0, output.width, output.height);
  return output.toDataURL('image/png');
}

async function saveDirectorSnapshot() {
  const dataUrl = directorSnapshotDataUrl();
  const importShot = window.messsAPI?.importCroppedImage || window.messsAPI?.importClipboardImage;
  if (!dataUrl || typeof importShot !== 'function') throw new Error(directorText('Could not capture the shot.', '\u65e0\u6cd5\u6355\u6349\u5f53\u524d\u955c\u5934\u3002'));
  const result = await importShot.call(window.messsAPI, {
    canvasId: typeof activeCanvasId === 'function' ? activeCanvasId() : null,
    folderId: window.AppState?.activeFolderId || null,
    dataUrl
  });
  if (!result?.ok || !result.file) throw new Error(directorText('Could not save the shot.', '\u65e0\u6cd5\u4fdd\u5b58\u5f53\u524d\u955c\u5934\u3002'));
  const file = result.file;
  if (window.AppState) {
    AppState.files = [file, ...AppState.files.filter(entry => entry.id !== file.id)];
    if (typeof renderFileList === 'function' && typeof currentFileListScope === 'function') renderFileList(currentFileListScope());
    if (typeof renderFolderGridIfActive === 'function') renderFolderGridIfActive();
    if (typeof addFilesToBoard === 'function') {
      const point = typeof boardViewportCenterCoords === 'function' ? boardViewportCenterCoords() : { x: 0, y: 0 };
      await addFilesToBoard([file.id], point.x, point.y, { selectAdded: true });
    }
  }
  return file;
}

async function sendDirectorShotToComposer(kind) {
  const actions = ThreeDDirector.overlay.querySelectorAll('[data-director-action]');
  actions.forEach(button => { button.disabled = true; });
  try {
    const prompt = buildDirectorPrompt(kind);
    const file = await saveDirectorSnapshot();
    closeThreeDDirector();
    if (typeof showAiImagePopover !== 'function') throw new Error(directorText('AI generation tools are unavailable.', 'AI \u751f\u6210\u5de5\u5177\u6682\u4e0d\u53ef\u7528\u3002'));
    await showAiImagePopover(kind);
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const composer = document.getElementById('ai-image-popover');
      const input = composer?.querySelector('.ai-composer-prompt');
      if (input && !composer.classList.contains('ai-composer-loading')) {
        input.value = prompt;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        if (typeof composer._toggleBoardReference === 'function') await composer._toggleBoardReference(file.id);
        input.focus();
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 80));
    }
    throw new Error(directorText('The AI composer did not open.', 'AI \u751f\u6210\u5668\u672a\u80fd\u6253\u5f00\u3002'));
  } catch (error) {
    if (typeof showToast === 'function') showToast(error?.message || directorText('Could not use this shot.', '\u65e0\u6cd5\u4f7f\u7528\u5f53\u524d\u955c\u5934\u3002'), '3D');
  } finally {
    actions.forEach(button => { button.disabled = false; });
  }
}

function bindThreeDDirectorUi() {
  const overlay = ThreeDDirector.overlay;
  overlay.querySelector('.three-d-director-close').addEventListener('click', closeThreeDDirector);
  overlay.querySelectorAll('[data-shot]').forEach(button => button.addEventListener('click', () => applyDirectorShot(button.dataset.shot)));
  overlay.querySelectorAll('[data-layout]').forEach(button => button.addEventListener('click', () => setDirectorLayout(button.dataset.layout)));
  overlay.querySelectorAll('[data-light]').forEach(button => button.addEventListener('click', () => applyDirectorLight(button.dataset.light)));
  overlay.querySelectorAll('[data-aspect]').forEach(button => button.addEventListener('click', () => {
    ThreeDDirector.aspect = button.dataset.aspect;
    syncDirectorButtons('aspect', ThreeDDirector.aspect);
    resizeThreeDDirector();
    updateDirectorPrompt();
  }));
  const lens = overlay.querySelector('#three-d-director-lens');
  lens.addEventListener('input', () => {
    ThreeDDirector.lens = Number(lens.value);
    syncDirectorLensOutput();
    updateDirectorPrompt();
  });
  const intensity = overlay.querySelector('#three-d-director-intensity');
  intensity.addEventListener('input', () => {
    ThreeDDirector.lightIntensity = Number(intensity.value);
    syncDirectorLightIntensity();
    updateDirectorPrompt();
  });
  const movement = overlay.querySelector('#three-d-director-movement');
  movement.addEventListener('change', () => { ThreeDDirector.movement = movement.value; updateDirectorPrompt(); });
  overlay.querySelector('.three-d-director-shot-name').addEventListener('input', updateDirectorPrompt);
  overlay.querySelector('[data-director-action="copy"]').addEventListener('click', async () => {
    const prompt = overlay.querySelector('.three-d-director-prompt').value;
    await navigator.clipboard.writeText(prompt);
    if (typeof showToast === 'function') showToast(directorText('Shot prompt copied.', '\u955c\u5934\u63d0\u793a\u8bcd\u5df2\u590d\u5236\u3002'), '3D');
  });
  overlay.querySelector('[data-director-action="snapshot"]').addEventListener('click', async () => {
    try {
      await saveDirectorSnapshot();
      if (typeof showToast === 'function') showToast(directorText('Shot added to canvas.', '\u955c\u5934\u5df2\u6dfb\u52a0\u5230\u753b\u5e03\u3002'), '3D');
    } catch (error) {
      if (typeof showToast === 'function') showToast(error?.message || directorText('Could not save the shot.', '\u65e0\u6cd5\u4fdd\u5b58\u955c\u5934\u3002'), '3D');
    }
  });
  overlay.querySelector('[data-director-action="image"]').addEventListener('click', () => sendDirectorShotToComposer('image'));
  overlay.querySelector('[data-director-action="video"]').addEventListener('click', () => sendDirectorShotToComposer('video'));
}

function openThreeDDirector() {
  const overlay = ensureThreeDDirectorUi();
  if (!ThreeDDirector.renderer && !buildDirectorStage()) {
    if (typeof showToast === 'function') showToast(directorText('WebGL is unavailable.', 'WebGL \u6682\u4e0d\u53ef\u7528\u3002'), '3D');
    return;
  }
  overlay.hidden = false;
  document.body.classList.add('is-three-d-director-open');
  resizeThreeDDirector();
  updateDirectorPrompt();
  cancelAnimationFrame(ThreeDDirector.animationFrame);
  animateThreeDDirector();
  overlay.querySelector('.three-d-director-close').focus({ preventScroll: true });
}

function closeThreeDDirector() {
  if (!ThreeDDirector.overlay || ThreeDDirector.overlay.hidden) return;
  ThreeDDirector.overlay.hidden = true;
  document.body.classList.remove('is-three-d-director-open');
  cancelAnimationFrame(ThreeDDirector.animationFrame);
  ThreeDDirector.animationFrame = 0;
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && ThreeDDirector.overlay && !ThreeDDirector.overlay.hidden) {
    event.preventDefault();
    event.stopPropagation();
    closeThreeDDirector();
  }
}, true);

window.MesssThreeDDirector = Object.freeze({
  open: openThreeDDirector,
  close: closeThreeDDirector,
  snapshot: directorSnapshotDataUrl,
  prompt: buildDirectorPrompt
});
