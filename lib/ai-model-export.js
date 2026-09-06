'use strict';

// Accept geometry data only. Model-generated JavaScript never runs in the host.
async function exportModel(file) {
  const THREE = require('three');
  if (!Array.isArray(file.parts) || !file.parts.length || file.parts.length > 128) throw new Error('Model requires 1-128 parts');
  const vector = (value, fallback, positive = false) => {
    const v = value === undefined ? fallback : value;
    if (!Array.isArray(v) || v.length !== 3 || v.some(n => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 10000 || (positive && n <= 0))) throw new Error('Invalid model dimensions');
    return v;
  };
  const root = new THREE.Group();
  try {
    for (const part of file.parts) {
      const size = vector(part.size, [1,1,1], true);
      const position = vector(part.position, [0,0,0]);
      const rotation = vector(part.rotation, [0,0,0]);
      let geometry;
      if (part.shape === 'box') geometry = new THREE.BoxGeometry(...size);
      else if (part.shape === 'sphere') geometry = new THREE.SphereGeometry(0.5,24,16);
      else if (part.shape === 'cylinder') geometry = new THREE.CylinderGeometry(0.5,0.5,1,32);
      else throw new Error('Supported shapes: box, sphere, cylinder');
      const mesh = new THREE.Mesh(geometry);
      root.add(mesh);
      if (part.shape !== 'box') mesh.scale.set(...size);
      mesh.position.set(...position); mesh.rotation.set(...rotation);
      mesh.name = `part_${root.children.length}`;
    }
    root.updateMatrixWorld(true);
    if (/\.obj$/i.test(file.name)) {
      const {OBJExporter} = await import('three/addons/exporters/OBJExporter.js');
      return {data:Buffer.from(new OBJExporter().parse(root),'utf8'),mimeType:'text/plain'};
    }
    if (/\.stl$/i.test(file.name)) {
      const {STLExporter} = await import('three/addons/exporters/STLExporter.js');
      const view = new STLExporter().parse(root,{binary:true});
      return {data:Buffer.from(view.buffer,view.byteOffset,view.byteLength),mimeType:'model/stl'};
    }
    throw new Error('Model export supports OBJ and STL; do not substitute HTML');
  } finally {
    root.traverse(node => {node.geometry?.dispose();node.material?.dispose();});
    root.clear();
  }
}
function requiresModelArtifact(prompt) {
  const text = String(prompt || '');
  return !/html|网页|viewer|website/i.test(text) &&
    /生成|制作|创建|导出|create|generate|export|make/i.test(text) &&
    /3\s*d\s*(?:文件|模型|model|file)|三维模型|\.obj\b|\.stl\b|\.glb\b/i.test(text);
}
function assertModelArtifact(prompt, files) {
  if (requiresModelArtifact(prompt) && !files.some(file => /\.(obj|stl|glb|gltf|fbx|ply|usdz)$/i.test(file.name || ''))) {
    throw new Error('未生成实际 3D 模型文件，HTML 预览不能代替模型交付。请重试导出 OBJ 或 STL。');
  }
}
module.exports = {exportModel, requiresModelArtifact, assertModelArtifact};
