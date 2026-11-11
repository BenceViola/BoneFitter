// Draws the object tree (scene-model.js) in the 3D view. Every node gets a
// three.js object, and objects are nested the way the tree is: what is
// attached to a mesh is a child of that mesh's object, so it is hidden with
// it and, once meshes can be moved, will move with it.
//
// A mesh's object is a group holding the display copy of the surface. The
// source geometry (exactly as read from the file) is kept beside it for
// picking and, later, fitting; it is never changed.

import * as THREE from 'three';
import { BONE, displayGeometry } from './viewer.js';

const POINT_COLORS = { placed: 0x2f63e0, estimated: 0xd98a00 };
const SELECTED = 0xe0337a;
const MESH_GLOW = 0x16264d; // added to a selected mesh's colour
const MARKER_SIZE = 0.006; // marker radius as a share of the scene's diagonal

export class SceneView {
  constructor(viewer, picker, model) {
    this.viewer = viewer;
    this.picker = picker;
    this.model = model;
    this.objects = new Map(); // node id -> THREE.Object3D
    this.sources = new Map(); // mesh id -> source geometry
    this.root = new THREE.Group();
    viewer.scene.add(this.root);
    this.pointGeometry = new THREE.SphereGeometry(1, 20, 14);
    this.raycaster = new THREE.Raycaster();
    this._selected = null;

    picker.canPick = (id) => model.isShown(id);
    model.addEventListener('change', (e) => this._onChange(e.detail));
  }

  objectOf(id) {
    return this.objects.get(id) || null;
  }

  // Put a loaded surface under its mesh node (added to the model just before).
  addMesh(node, source) {
    if (!source.boundingBox) source.computeBoundingBox();
    const group = new THREE.Group();
    group.name = node.id;
    const material = new THREE.MeshStandardMaterial({ color: BONE, roughness: 0.82, metalness: 0, side: THREE.DoubleSide });
    const surface = new THREE.Mesh(displayGeometry(source), material);
    surface.name = 'surface';
    group.add(surface);
    group.visible = node.visible;
    this.root.add(group);
    this.objects.set(node.id, group);
    this.sources.set(node.id, source);
    this.picker.add(node.id, source, group);
    this._refreshBox();
  }

  // The box around every mesh that is shown, in scene coordinates.
  contentBox() {
    const box = new THREE.Box3();
    for (const [id, source] of this.sources) {
      if (!this.model.isShown(id)) continue;
      const group = this.objects.get(id);
      group.updateWorldMatrix(true, false);
      box.union(source.boundingBox.clone().applyMatrix4(group.matrixWorld));
    }
    return box;
  }

  // The point marker under a screen position, unless a surface hides it.
  pointAt(clientX, clientY) {
    const markers = [];
    for (const [id, obj] of this.objects) {
      if (obj.userData.marker && this.model.isShown(id)) markers.push(obj);
    }
    if (!markers.length) return null;
    const ray = this.picker.rayAt(clientX, clientY);
    this.root.updateMatrixWorld(true);
    this.raycaster.ray.copy(ray);
    const hit = this.raycaster.intersectObjects(markers, false)[0];
    if (!hit) return null;
    const surface = this.picker.surfaceDistance(ray);
    const radius = hit.object.scale.x;
    if (surface !== null && surface < hit.distance - 2 * radius) return null;
    return hit.object.name;
  }

  _onChange({ kind, ids, removed }) {
    if (kind === 'add') {
      for (const id of ids) {
        const node = this.model.get(id);
        if (node && node.kind !== 'mesh') this._build(node);
      }
      this._sizeMarkers();
    } else if (kind === 'remove') {
      // Children first, so each object is still attached when it is taken out.
      for (const node of [...removed].reverse()) this._dispose(node);
      this._refreshBox();
    } else if (kind === 'visible') {
      for (const id of ids) {
        const obj = this.objects.get(id);
        if (obj) obj.visible = this.model.get(id).visible && !obj.userData.empty;
      }
      this._refreshBox();
    }
    if (kind === 'select' || kind === 'remove' || kind === 'add') this._showSelection();
  }

  _build(node) {
    const parent = this.objects.get(node.parent) || this.root;
    let obj;
    if (node.kind === 'point' && Array.isArray(node.position)) {
      const color = POINT_COLORS[node.status] ?? POINT_COLORS.placed;
      obj = new THREE.Mesh(this.pointGeometry, new THREE.MeshStandardMaterial({ color, roughness: 0.5 }));
      obj.position.fromArray(node.position);
      obj.userData.marker = true;
      obj.userData.color = color;
    } else {
      // A folder, or a point with no position (a missing landmark): nothing to draw.
      obj = new THREE.Group();
      obj.userData.empty = node.kind === 'point';
    }
    obj.name = node.id;
    obj.visible = node.visible && !obj.userData.empty;
    parent.add(obj);
    this.objects.set(node.id, obj);
  }

  _dispose(node) {
    const obj = this.objects.get(node.id);
    if (!obj) return;
    obj.removeFromParent();
    this.objects.delete(node.id);
    if (node.kind === 'mesh') {
      const surface = obj.getObjectByName('surface');
      surface.geometry.dispose();
      surface.material.dispose();
      const source = this.sources.get(node.id);
      source.disposeBoundsTree?.();
      source.dispose();
      this.sources.delete(node.id);
      this.picker.remove(node.id);
    } else if (obj.userData.marker) {
      obj.material.dispose();
    }
  }

  _refreshBox() {
    this.viewer.setContentBox(this.contentBox());
    this._sizeMarkers();
  }

  // Markers keep a size that suits the scene, and the selected one is larger.
  _sizeMarkers() {
    const r = this.viewer.diagonal * MARKER_SIZE;
    for (const [id, obj] of this.objects) {
      if (obj.userData.marker) obj.scale.setScalar(id === this._selected ? r * 1.5 : r);
    }
  }

  _showSelection() {
    const next = this.model.selectedId;
    for (const id of [this._selected, next]) {
      const obj = this.objects.get(id);
      if (!obj) continue;
      const on = id === next;
      if (obj.userData.marker) obj.material.color.setHex(on ? SELECTED : obj.userData.color);
      const surface = obj.getObjectByName('surface');
      if (surface) surface.material.emissive.setHex(on ? MESH_GLOW : 0x000000);
    }
    this._selected = next;
    this._sizeMarkers();
  }
}
