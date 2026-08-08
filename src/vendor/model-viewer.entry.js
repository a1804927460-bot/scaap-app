import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

globalThis.MesssModelViewerVendor = Object.freeze({
  THREE,
  GLTFLoader,
  OrbitControls,
  RoomEnvironment,
  MeshoptDecoder
});
