// Draws the object tree (scene-model.js) in the 3D view. Every node gets a
// three.js object, and objects are nested the way the tree is: what is
// attached to a mesh is a child of that mesh's object, so it is hidden with
// it and, once meshes can be moved, will move with it.
//
// A mesh's object is a group holding the display copy of the surface. The
// source geometry (exactly as read from the file) is kept beside it for
// picking, curves and, later, fitting; it is never changed.
//
// A curve is drawn as a line along its path across the surface. The points
// that were clicked are shown as small diamonds ("handles") on the curve
// that is selected or being drawn, where they can be clicked and dragged.

import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { BONE, displayGeometry } from './viewer.js';

const POINT_COLORS = { placed: 0x2f63e0, estimated: 0xd98a00 };
const CURVE_COLOR = 0x0e9fc7;
const HANDLE_COLOR = 0xffffff;
const SELECTED = 0xe0337a;
const MESH_GLOW = 0x16264d; // added to a selected mesh's colour
const MARKER_SIZE = 0.006; // marker radius as a share of the scene's diagonal
const HANDLE_SIZE = 0.008;
const CURVE_REACH = 6; // px: a click this close to a curve's line selects it

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
    this.handleGeometry = new THREE.OctahedronGeometry(1);
    this.handleMaterial = new THREE.MeshStandardMaterial({ color: HANDLE_COLOR, roughness: 0.5, emissive: HANDLE_COLOR, emissiveIntensity: 0.25 });
    this.raycaster = new THREE.Raycaster();
    this._selected = null;
    this._size = new THREE.Vector2();

    picker.canPick = (id) => model.isShown(id);
    model.addEventListener('change', (e) => this._onChange(e.detail));
    // Lines have a width in pixels, so they need to know the size of the view.
    viewer.addFrameHook?.(() => {
      viewer.renderer.getSize(this._size);
      for (const obj of this.objects.values()) {
        if (obj.userData.curve) obj.getObjectByName('line').material.resolution.copy(this._size);
      }
    });
  }

  objectOf(id) {
    return this.objects.get(id) || null;
  }

  // Put a loaded surface under its mesh node (added to the model just before).
  addMesh(node, source) {
    if (!source.boundingBox) source.computeBoundingBox();
    const group = new THREE.Group();
    group.name = node.id;
    const material = new THREE.MeshStandardMaterial({
      color: BONE,
      roughness: 0.82,
      metalness: 0,
      side: THREE.DoubleSide,
      // Pushed back a hair in depth, so lines drawn on the surface aren't hidden in it.
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
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

  // The handle (clicked point of a curve) under a screen position:
  // { id, index }, or null. Only curves that show their handles count.
  handleAt(clientX, clientY) {
    const ray = this.picker.rayAt(clientX, clientY);
    this.root.updateMatrixWorld(true);
    const c = new THREE.Vector3();
    let best = null;
    for (const [id, obj] of this.objects) {
      if (!obj.userData.curve || !this.model.isShown(id)) continue;
      obj.getObjectByName('handles').children.forEach((h, index) => {
        h.getWorldPosition(c);
        const r = h.scale.x;
        if (ray.distanceToPoint(c) > r * 1.8) return;
        const t = ray.origin.distanceTo(c);
        if (!best || t < best.t) best = { id, index, t, r };
      });
    }
    if (!best) return null;
    const surface = this.picker.surfaceDistance(ray);
    if (surface !== null && surface < best.t - best.r * 1.5) return null;
    return { id: best.id, index: best.index };
  }

  // The curve whose line passes under a screen position (within a few
  // pixels), unless a surface hides it there.
  curveAt(clientX, clientY) {
    const rect = this.viewer.renderer.domElement.getBoundingClientRect();
    const camera = this.viewer.camera;
    this.root.updateMatrixWorld(true);
    const eye = camera.getWorldPosition(new THREE.Vector3());
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const sa = new THREE.Vector3();
    const sb = new THREE.Vector3();
    const toScreen = (world, out) => {
      out.copy(world).project(camera);
      out.set(rect.left + ((out.x + 1) / 2) * rect.width, rect.top + ((1 - out.y) / 2) * rect.height, out.z);
    };
    let best = null;
    for (const [id, obj] of this.objects) {
      const line = obj.userData.curve && this.model.isShown(id) ? this.model.get(id).line : null;
      if (!line || line.length < 2) continue;
      a.fromArray(line[0]).applyMatrix4(obj.matrixWorld);
      toScreen(a, sa);
      for (let i = 1; i < line.length; i++) {
        b.fromArray(line[i]).applyMatrix4(obj.matrixWorld);
        toScreen(b, sb);
        if (sa.z < 1 && sb.z < 1) {
          // How far along this stretch the cursor is nearest, and how near.
          const dx = sb.x - sa.x;
          const dy = sb.y - sa.y;
          const len2 = dx * dx + dy * dy;
          const u = len2 > 0 ? Math.min(1, Math.max(0, ((clientX - sa.x) * dx + (clientY - sa.y) * dy) / len2)) : 0;
          const d = Math.hypot(clientX - (sa.x + u * dx), clientY - (sa.y + u * dy));
          if (d <= CURVE_REACH && (!best || d < best.d)) best = { id, d, at: a.clone().lerp(b, u) };
        }
        a.copy(b);
        sa.copy(sb);
      }
    }
    if (!best) return null;
    return this.picker.isHidden(best.at, eye, this.viewer.diagonal * 0.004) ? null : best.id;
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
    } else if (kind === 'update') {
      for (const id of ids) {
        const node = this.model.get(id);
        if (node?.kind === 'curve') this._drawCurve(node);
      }
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
    } else if (node.kind === 'curve') {
      obj = new THREE.Group();
      obj.userData.curve = true;
      const line = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({ color: CURVE_COLOR, linewidth: 2.5, worldUnits: false }));
      line.name = 'line';
      line.renderOrder = 2;
      const handles = new THREE.Group();
      handles.name = 'handles';
      obj.add(line, handles);
    } else {
      // A folder, or a point with no position (a missing landmark): nothing to draw.
      obj = new THREE.Group();
      obj.userData.empty = node.kind === 'point';
    }
    obj.name = node.id;
    obj.visible = node.visible && !obj.userData.empty;
    parent.add(obj);
    this.objects.set(node.id, obj);
    if (node.kind === 'curve') this._drawCurve(node);
  }

  // Bring a curve's line and handles up to date with its node.
  _drawCurve(node) {
    const obj = this.objects.get(node.id);
    if (!obj) return;
    const active = node.drawing || node.id === this.model.selectedId;
    const line = obj.getObjectByName('line');
    const path = node.line || [];
    if (path.length >= 2) {
      const seg = new Float32Array((path.length - 1) * 6);
      for (let i = 1; i < path.length; i++) seg.set([...path[i - 1], ...path[i]], (i - 1) * 6);
      line.geometry.dispose();
      line.geometry = new LineSegmentsGeometry().setPositions(seg);
    }
    line.visible = path.length >= 2;
    line.material.color.setHex(active ? SELECTED : CURVE_COLOR);
    line.material.linewidth = active ? 3 : 2.5;

    // Handles: one per clicked point, only on the curve being worked on.
    const handles = obj.getObjectByName('handles');
    const points = active ? node.control_points || [] : [];
    while (handles.children.length > points.length) handles.remove(handles.children.at(-1));
    while (handles.children.length < points.length) {
      const h = new THREE.Mesh(this.handleGeometry, this.handleMaterial);
      h.renderOrder = 3;
      handles.add(h);
    }
    points.forEach((p, i) => handles.children[i].position.fromArray(p.position));
    this._sizeHandles(handles);
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
    } else if (obj.userData.curve) {
      const line = obj.getObjectByName('line');
      line.geometry.dispose();
      line.material.dispose();
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
      else if (obj.userData.curve) this._sizeHandles(obj.getObjectByName('handles'));
    }
  }

  _sizeHandles(handles) {
    const r = this.viewer.diagonal * HANDLE_SIZE;
    for (const h of handles.children) h.scale.setScalar(r);
  }

  _showSelection() {
    const next = this.model.selectedId;
    for (const id of new Set([this._selected, next])) {
      const obj = this.objects.get(id);
      if (!obj) continue;
      const on = id === next;
      if (obj.userData.marker) obj.material.color.setHex(on ? SELECTED : obj.userData.color);
      if (obj.userData.curve) this._drawCurve(this.model.get(id));
      const surface = obj.getObjectByName('surface');
      if (surface) surface.material.emissive.setHex(on ? MESH_GLOW : 0x000000);
    }
    this._selected = next;
    this._sizeMarkers();
  }
}
