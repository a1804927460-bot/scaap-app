var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// <stdin>
var stdin_exports = {};
__export(stdin_exports, {
  OBJExporter: () => OBJExporter,
  STLExporter: () => STLExporter
});
module.exports = __toCommonJS(stdin_exports);

// node_modules/three/examples/jsm/exporters/OBJExporter.js
var import_three = require("three");
var OBJExporter = class {
  /**
   * Parses the given 3D object and generates the OBJ output.
   *
   * If the 3D object is composed of multiple children and geometry, they are merged into a single mesh in the file.
   *
   * @param {Object3D} object - The 3D object to export.
   * @return {string} The exported OBJ.
   */
  parse(object) {
    let output = "";
    let indexVertex = 0;
    let indexVertexUvs = 0;
    let indexNormals = 0;
    const vertex = new import_three.Vector3();
    const color = new import_three.Color();
    const normal = new import_three.Vector3();
    const uv = new import_three.Vector2();
    const face = [];
    function parseMesh(mesh) {
      let nbVertex = 0;
      let nbNormals = 0;
      let nbVertexUvs = 0;
      const geometry = mesh.geometry;
      const normalMatrixWorld = new import_three.Matrix3();
      const vertices = geometry.getAttribute("position");
      const normals = geometry.getAttribute("normal");
      const uvs = geometry.getAttribute("uv");
      const indices = geometry.getIndex();
      output += "o " + mesh.name + "\n";
      if (mesh.material && mesh.material.name) {
        output += "usemtl " + mesh.material.name + "\n";
      }
      if (vertices !== void 0) {
        for (let i = 0, l = vertices.count; i < l; i++, nbVertex++) {
          vertex.fromBufferAttribute(vertices, i);
          vertex.applyMatrix4(mesh.matrixWorld);
          output += "v " + vertex.x + " " + vertex.y + " " + vertex.z + "\n";
        }
      }
      if (uvs !== void 0) {
        for (let i = 0, l = uvs.count; i < l; i++, nbVertexUvs++) {
          uv.fromBufferAttribute(uvs, i);
          output += "vt " + uv.x + " " + uv.y + "\n";
        }
      }
      if (normals !== void 0) {
        normalMatrixWorld.getNormalMatrix(mesh.matrixWorld);
        for (let i = 0, l = normals.count; i < l; i++, nbNormals++) {
          normal.fromBufferAttribute(normals, i);
          normal.applyMatrix3(normalMatrixWorld).normalize();
          output += "vn " + normal.x + " " + normal.y + " " + normal.z + "\n";
        }
      }
      if (indices !== null) {
        for (let i = 0, l = indices.count; i < l; i += 3) {
          for (let m = 0; m < 3; m++) {
            const j = indices.getX(i + m) + 1;
            face[m] = indexVertex + j + (normals || uvs ? "/" + (uvs ? indexVertexUvs + j : "") + (normals ? "/" + (indexNormals + j) : "") : "");
          }
          output += "f " + face.join(" ") + "\n";
        }
      } else {
        for (let i = 0, l = vertices.count; i < l; i += 3) {
          for (let m = 0; m < 3; m++) {
            const j = i + m + 1;
            face[m] = indexVertex + j + (normals || uvs ? "/" + (uvs ? indexVertexUvs + j : "") + (normals ? "/" + (indexNormals + j) : "") : "");
          }
          output += "f " + face.join(" ") + "\n";
        }
      }
      indexVertex += nbVertex;
      indexVertexUvs += nbVertexUvs;
      indexNormals += nbNormals;
    }
    function parseLine(line) {
      let nbVertex = 0;
      const geometry = line.geometry;
      const type = line.type;
      const vertices = geometry.getAttribute("position");
      output += "o " + line.name + "\n";
      if (vertices !== void 0) {
        for (let i = 0, l = vertices.count; i < l; i++, nbVertex++) {
          vertex.fromBufferAttribute(vertices, i);
          vertex.applyMatrix4(line.matrixWorld);
          output += "v " + vertex.x + " " + vertex.y + " " + vertex.z + "\n";
        }
      }
      if (type === "Line") {
        output += "l ";
        for (let j = 1, l = vertices.count; j <= l; j++) {
          output += indexVertex + j + " ";
        }
        output += "\n";
      }
      if (type === "LineSegments") {
        for (let j = 1, k = j + 1, l = vertices.count; j < l; j += 2, k = j + 1) {
          output += "l " + (indexVertex + j) + " " + (indexVertex + k) + "\n";
        }
      }
      indexVertex += nbVertex;
    }
    function parsePoints(points) {
      let nbVertex = 0;
      const geometry = points.geometry;
      const vertices = geometry.getAttribute("position");
      const colors = geometry.getAttribute("color");
      output += "o " + points.name + "\n";
      if (vertices !== void 0) {
        for (let i = 0, l = vertices.count; i < l; i++, nbVertex++) {
          vertex.fromBufferAttribute(vertices, i);
          vertex.applyMatrix4(points.matrixWorld);
          output += "v " + vertex.x + " " + vertex.y + " " + vertex.z;
          if (colors !== void 0) {
            color.fromBufferAttribute(colors, i);
            import_three.ColorManagement.workingToColorSpace(color, import_three.SRGBColorSpace);
            output += " " + color.r + " " + color.g + " " + color.b;
          }
          output += "\n";
        }
        output += "p ";
        for (let j = 1, l = vertices.count; j <= l; j++) {
          output += indexVertex + j + " ";
        }
        output += "\n";
      }
      indexVertex += nbVertex;
    }
    object.traverse(function(child) {
      if (child.isMesh === true) {
        parseMesh(child);
      }
      if (child.isLine === true) {
        parseLine(child);
      }
      if (child.isPoints === true) {
        parsePoints(child);
      }
    });
    return output;
  }
};

// node_modules/three/examples/jsm/exporters/STLExporter.js
var import_three2 = require("three");
var STLExporter = class {
  /**
   * Parses the given 3D object and generates the STL output.
   *
   * If the 3D object is composed of multiple children and geometry, they are merged into a single mesh in the file.
   *
   * @param {Object3D} scene - A scene, mesh or any other 3D object containing meshes to encode.
   * @param {STLExporter~Options} options - The export options.
   * @return {string|ArrayBuffer} The exported STL.
   */
  parse(scene, options = {}) {
    options = Object.assign({
      binary: false
    }, options);
    const binary = options.binary;
    const objects = [];
    let triangles = 0;
    scene.traverse(function(object) {
      if (object.isMesh) {
        const geometry = object.geometry;
        const index = geometry.index;
        const positionAttribute = geometry.getAttribute("position");
        triangles += index !== null ? index.count / 3 : positionAttribute.count / 3;
        objects.push({
          object3d: object,
          geometry
        });
      }
    });
    let output;
    let offset = 80;
    if (binary === true) {
      const bufferLength = triangles * 2 + triangles * 3 * 4 * 4 + 80 + 4;
      const arrayBuffer = new ArrayBuffer(bufferLength);
      output = new DataView(arrayBuffer);
      output.setUint32(offset, triangles, true);
      offset += 4;
    } else {
      output = "";
      output += "solid exported\n";
    }
    const vA = new import_three2.Vector3();
    const vB = new import_three2.Vector3();
    const vC = new import_three2.Vector3();
    const cb = new import_three2.Vector3();
    const ab = new import_three2.Vector3();
    const normal = new import_three2.Vector3();
    for (let i = 0, il = objects.length; i < il; i++) {
      const object = objects[i].object3d;
      const geometry = objects[i].geometry;
      const index = geometry.index;
      const positionAttribute = geometry.getAttribute("position");
      if (index !== null) {
        for (let j = 0; j < index.count; j += 3) {
          const a = index.getX(j + 0);
          const b = index.getX(j + 1);
          const c = index.getX(j + 2);
          writeFace(a, b, c, positionAttribute, object);
        }
      } else {
        for (let j = 0; j < positionAttribute.count; j += 3) {
          const a = j + 0;
          const b = j + 1;
          const c = j + 2;
          writeFace(a, b, c, positionAttribute, object);
        }
      }
    }
    if (binary === false) {
      output += "endsolid exported\n";
    }
    return output;
    function writeFace(a, b, c, positionAttribute, object) {
      vA.fromBufferAttribute(positionAttribute, a);
      vB.fromBufferAttribute(positionAttribute, b);
      vC.fromBufferAttribute(positionAttribute, c);
      if (object.isSkinnedMesh === true) {
        object.applyBoneTransform(a, vA);
        object.applyBoneTransform(b, vB);
        object.applyBoneTransform(c, vC);
      }
      vA.applyMatrix4(object.matrixWorld);
      vB.applyMatrix4(object.matrixWorld);
      vC.applyMatrix4(object.matrixWorld);
      writeNormal(vA, vB, vC);
      writeVertex(vA);
      writeVertex(vB);
      writeVertex(vC);
      if (binary === true) {
        output.setUint16(offset, 0, true);
        offset += 2;
      } else {
        output += "		endloop\n";
        output += "	endfacet\n";
      }
    }
    function writeNormal(vA2, vB2, vC2) {
      cb.subVectors(vC2, vB2);
      ab.subVectors(vA2, vB2);
      cb.cross(ab).normalize();
      normal.copy(cb).normalize();
      if (binary === true) {
        output.setFloat32(offset, normal.x, true);
        offset += 4;
        output.setFloat32(offset, normal.y, true);
        offset += 4;
        output.setFloat32(offset, normal.z, true);
        offset += 4;
      } else {
        output += "	facet normal " + normal.x + " " + normal.y + " " + normal.z + "\n";
        output += "		outer loop\n";
      }
    }
    function writeVertex(vertex) {
      if (binary === true) {
        output.setFloat32(offset, vertex.x, true);
        offset += 4;
        output.setFloat32(offset, vertex.y, true);
        offset += 4;
        output.setFloat32(offset, vertex.z, true);
        offset += 4;
      } else {
        output += "			vertex " + vertex.x + " " + vertex.y + " " + vertex.z + "\n";
      }
    }
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  OBJExporter,
  STLExporter
});
