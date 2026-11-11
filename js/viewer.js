// Scene, camera, lighting and controls for the 3D view.
//
// The source geometry of a mesh is never moved, centred or scaled. The
// camera is framed on what is in the scene instead, so coordinates stay in
// each mesh file's own space.
//
// Adapted from Landmarker3D's js/viewer.js, which shows one mesh at a time.
// Here the viewer only owns the camera, the lights and the frame loop; the
// objects in the scene (several meshes and what hangs under them) are built
// by scene-view.js, which tells the viewer the box to frame.

import * as THREE from 'three';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const BONE = 0xe4ddcf;

// Named views along the scene's axes. `dir` points from the scene to the camera.
const VIEWS = {
  '+x': { dir: [1, 0, 0], up: [0, 0, 1] },
  '-x': { dir: [-1, 0, 0], up: [0, 0, 1] },
  '+y': { dir: [0, 1, 0], up: [0, 0, 1] },
  '-y': { dir: [0, -1, 0], up: [0, 0, 1] },
  '+z': { dir: [0, 0, 1], up: [0, 1, 0] },
  '-z': { dir: [0, 0, -1], up: [0, 1, 0] },
  home: { dir: [0.45, 0.35, 1], up: [0, 1, 0] },
};

export class Viewer {
  constructor(container) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(this.renderer.domElement);
    this.frameHooks = [];

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 1000);
    this.scene.add(this.camera);

    // Soft fill from all around plus a key light that follows the camera,
    // so the side you are looking at is always lit.
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x6f6a62, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(0.6, 0.8, 0);
    key.target.position.set(0, 0, -1);
    this.camera.add(key, key.target);

    this.controls = new TrackballControls(this.camera, this.renderer.domElement);
    this.controls.rotateSpeed = 3.2;
    this.controls.zoomSpeed = 1.4;
    this.controls.panSpeed = 0.9;
    this.controls.staticMoving = true;

    this.box = null; // what the camera frames: everything shown, in scene coordinates

    this._resize = this._resize.bind(this);
    new ResizeObserver(this._resize).observe(container);
    this._resize();

    const loop = () => {
      this.controls.update();
      for (const hook of this.frameHooks) hook();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    loop();
  }

  addFrameHook(fn) {
    this.frameHooks.push(fn);
  }

  // Length of the framed box's diagonal, used to size markers.
  get diagonal() {
    return this.box ? this.box.min.distanceTo(this.box.max) : 1;
  }

  setBackground(color) {
    this.scene.background = new THREE.Color(color);
  }

  // The box around everything shown (a THREE.Box3 in scene coordinates), or
  // null when the scene is empty. The camera does not move until asked to.
  setContentBox(box) {
    this.box = box && !box.isEmpty() ? box.clone() : null;
  }

  // Frame everything, looking along one of the scene's axes.
  viewFrom(name) {
    const view = VIEWS[name] || VIEWS.home;
    this._frame(new THREE.Vector3(...view.dir).normalize(), new THREE.Vector3(...view.up));
  }

  // Frame everything from the current viewing direction.
  fit() {
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this._frame(dir, this.camera.up.clone());
  }

  // Where a point of the scene is on the page, in CSS pixels (for tests and overlays).
  toClient(point) {
    const v = new THREE.Vector3().fromArray(point).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  // Take up the size of the container now (it is also followed automatically).
  resize() {
    this._resize();
  }

  _frame(dir, up) {
    if (!this.box) return;
    const sphere = this.box.getBoundingSphere(new THREE.Sphere());
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const fov = Math.min(vFov, hFov);
    const dist = (sphere.radius / Math.sin(fov / 2)) * 1.08;

    this.controls.target.copy(sphere.center);
    this.camera.up.copy(up);
    this.camera.position.copy(sphere.center).addScaledVector(dir, dist);
    this.camera.near = Math.max(dist / 1000, 1e-6);
    this.camera.far = dist * 100;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(sphere.center);
    this.controls.update();
    this.camera.updateMatrixWorld(true);
  }

  _resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.controls.handleResize();
  }
}

// The copy of a mesh that is drawn. Vertex merging (for smooth shading)
// happens only here, never on the source geometry. mergeVertices keeps
// triangle order, so triangle i of the copy is still face i of the file.
export function displayGeometry(source, { smooth = true } = {}) {
  let g;
  if (smooth) {
    if (source.index) {
      g = source.clone();
      if (!g.attributes.normal) g.computeVertexNormals();
    } else {
      g = source.clone();
      g.deleteAttribute('normal');
      g = mergeVertices(g);
      g.computeVertexNormals();
    }
  } else {
    g = source.index ? source.toNonIndexed() : source.clone();
    g.deleteAttribute('normal');
    g.computeVertexNormals(); // non-indexed, so these are face normals
  }
  // The copy is for drawing only: it must not share the source's BVH.
  g.boundsTree = null;
  return g;
}
