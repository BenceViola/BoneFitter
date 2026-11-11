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
//
// A region is drawn as a see-through tint: a copy of just its triangles,
// laid over the surface. Its edge is therefore exactly the region's edge.

import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { BONE, displayGeometry } from './viewer.js';
import { FIT_KINDS } from './fit-engine.js';

const POINT_COLORS = { placed: 0x2f63e0, estimated: 0xd98a00 };
const CURVE_COLOR = 0x0e9fc7;
const REGION_COLOR = 0x0e9fc7;
const REGION_OPACITY = 0.4;
const FIT_COLOR = 0xd97706;
const FIT_REACH = 10; // px: a click this close to a sphere's centre mark selects it
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
        if (obj.userData.fit) obj.getObjectByName('outline').material.resolution.copy(this._size);
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

  // The region whose triangles are under a screen position; where regions
  // overlap, the smallest. Null beside the mesh or on bare surface.
  regionAt(clientX, clientY) {
    const hit = this.picker.pickAt(clientX, clientY);
    const face = hit?.anchor?.face;
    if (!Number.isInteger(face)) return null;
    let best = null;
    for (const node of this.model.children(hit.id)) {
      if (node.kind !== 'region' || !this.model.isShown(node.id) || !hasFace(node.faces, face)) continue;
      if (!best || node.faceCount < best.faceCount) best = node;
    }
    return best ? best.id : null;
  }

  // The fitted sphere whose centre mark is under a screen position. The mark
  // is drawn through the mesh, so nothing hides it.
  fitAt(clientX, clientY) {
    const rect = this.viewer.renderer.domElement.getBoundingClientRect();
    this.root.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    let best = null;
    for (const [id, obj] of this.objects) {
      if (!obj.userData.fit || !obj.visible || !this.model.isShown(id)) continue;
      obj.getObjectByName('centre').getWorldPosition(v).project(this.viewer.camera);
      if (v.z > 1) continue;
      const d = Math.hypot(rect.left + ((v.x + 1) / 2) * rect.width - clientX, rect.top + ((1 - v.y) / 2) * rect.height - clientY);
      if (d <= FIT_REACH && (!best || d < best.d)) best = { id, d };
    }
    return best ? best.id : null;
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
        else if (node?.kind === 'region') this._drawRegion(node);
        else if (FIT_KINDS.has(node?.kind)) this._drawFit(node);
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
    } else if (FIT_KINDS.has(node.kind)) {
      obj = this._buildFit(node);
    } else if (node.kind === 'region') {
      const material = new THREE.MeshBasicMaterial({
        color: REGION_COLOR,
        transparent: true,
        opacity: REGION_OPACITY,
        side: THREE.DoubleSide,
        depthWrite: false,
        // In front of the surface (pushed back by 1), behind the lines drawn on it.
        polygonOffset: true,
        polygonOffsetFactor: 0.5,
        polygonOffsetUnits: 0.5,
      });
      obj = new THREE.Mesh(new THREE.BufferGeometry(), material);
      obj.userData.region = true;
      obj.renderOrder = 1;
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
    if (node.kind === 'region') this._drawRegion(node);
    if (FIT_KINDS.has(node.kind)) this._drawFit(node);
  }

  // A fitted primitive: an outline (and, for a plane, a faint fill) and a
  // mark at its centre, all drawn through the mesh, because a fitted shape
  // lies in or under the bone's surface, where it would otherwise be hidden.
  // The outline is made once for a unit shape and placed, turned and scaled
  // to the fit: a unit sphere at the origin; a unit cylinder along Y from
  // −0.5 to 0.5 with its axis; a square from −1 to 1 square to Z with its normal.
  _buildFit(node) {
    const obj = new THREE.Group();
    obj.userData.fit = true;
    const shape = { sphere: sphereOutline, cylinder: cylinderOutline, plane: planeOutline }[node.kind]();
    const outline = new LineSegments2(
      new LineSegmentsGeometry().setPositions(shape),
      new LineMaterial({ color: FIT_COLOR, linewidth: 1.5, worldUnits: false, transparent: true, opacity: 0.75, depthTest: false })
    );
    outline.name = 'outline';
    outline.renderOrder = 4;
    if (node.kind === 'plane') {
      const fill = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        new THREE.MeshBasicMaterial({ color: FIT_COLOR, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false, depthTest: false })
      );
      fill.name = 'fill';
      fill.renderOrder = 3;
      outline.add(fill);
    }
    const centre = new THREE.Mesh(this.pointGeometry, new THREE.MeshBasicMaterial({ color: FIT_COLOR, depthTest: false }));
    centre.name = 'centre';
    centre.renderOrder = 5;
    obj.add(outline, centre);
    return obj;
  }

  // Bring a fitted primitive's drawing up to date with its node.
  _drawFit(node) {
    const obj = this.objects.get(node.id);
    if (!obj) return;
    const at = node.kind === 'sphere' ? node.centre : node.point;
    const ok = !node.error && Array.isArray(at);
    obj.userData.empty = !ok;
    obj.visible = node.visible && ok;
    if (!ok) return;
    const outline = obj.getObjectByName('outline');
    const centre = obj.getObjectByName('centre');
    if (node.kind === 'sphere') {
      outline.position.fromArray(node.centre);
      outline.quaternion.identity();
      outline.scale.setScalar(node.radius);
      centre.position.fromArray(node.centre);
    } else if (node.kind === 'cylinder') {
      const mid = node.ends[0].map((v, i) => (v + node.ends[1][i]) / 2);
      outline.position.fromArray(mid);
      outline.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...node.direction));
      outline.scale.set(node.radius, Math.max(node.length, 1e-6), node.radius);
      centre.position.fromArray(mid);
    } else {
      outline.position.fromArray(node.point);
      outline.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...node.normal));
      outline.scale.setScalar(Math.max(node.size * 1.1, 1e-6));
      centre.position.fromArray(node.point);
    }
    const on = node.id === this.model.selectedId;
    const color = on ? SELECTED : FIT_COLOR;
    outline.material.color.setHex(color);
    outline.material.linewidth = on ? 2.5 : 1.5;
    centre.material.color.setHex(color);
    outline.getObjectByName('fill')?.material.color.setHex(color);
    this._sizeMarkers();
  }

  // Bring a region's tint up to date with its node: a copy of its triangles.
  _drawRegion(node) {
    const obj = this.objects.get(node.id);
    const source = this.sources.get(node.parent);
    if (!obj || !source) return;
    const faces = node.faces || [];
    const from = source.attributes.position;
    const index = source.index;
    const positions = new Float32Array(faces.length * 9);
    for (let i = 0; i < faces.length; i++) {
      for (let k = 0; k < 3; k++) {
        const v = index ? index.getX(3 * faces[i] + k) : 3 * faces[i] + k;
        positions[9 * i + 3 * k] = from.getX(v);
        positions[9 * i + 3 * k + 1] = from.getY(v);
        positions[9 * i + 3 * k + 2] = from.getZ(v);
      }
    }
    obj.geometry.dispose();
    obj.geometry = new THREE.BufferGeometry();
    obj.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    obj.userData.empty = faces.length === 0;
    obj.visible = node.visible && faces.length > 0;
    const on = node.id === this.model.selectedId;
    obj.material.color.setHex(on ? SELECTED : REGION_COLOR);
    obj.material.opacity = on ? REGION_OPACITY + 0.1 : REGION_OPACITY;
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
    } else if (obj.userData.region) {
      obj.geometry.dispose();
      obj.material.dispose();
    } else if (obj.userData.fit) {
      const outline = obj.getObjectByName('outline');
      outline.geometry.dispose();
      outline.material.dispose();
      obj.getObjectByName('centre').material.dispose();
      const fill = outline.getObjectByName('fill');
      if (fill) {
        fill.geometry.dispose();
        fill.material.dispose();
      }
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
      else if (obj.userData.fit) obj.getObjectByName('centre').scale.setScalar(id === this._selected ? r * 1.2 : r * 0.8);
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
      if (obj.userData.region) this._drawRegion(this.model.get(id));
      if (obj.userData.fit) this._drawFit(this.model.get(id));
      const surface = obj.getObjectByName('surface');
      if (surface) surface.material.emissive.setHex(on ? MESH_GLOW : 0x000000);
    }
    this._selected = next;
    this._sizeMarkers();
  }
}

// Is `face` in the sorted list `faces`?
function hasFace(faces, face) {
  let lo = 0;
  let hi = (faces?.length ?? 0) - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (faces[mid] === face) return true;
    if (faces[mid] < face) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

// The outline of a unit sphere at the origin, as line segments (6 numbers
// each): 8 circles of longitude and 5 of latitude.
function sphereOutline(segments = 64) {
  const out = [];
  const circle = (point) => {
    for (let k = 0; k < segments; k++) out.push(...point((2 * Math.PI * k) / segments), ...point((2 * Math.PI * (k + 1)) / segments));
  };
  for (let m = 0; m < 8; m++) {
    const phi = (Math.PI * m) / 8;
    circle((t) => [Math.cos(t) * Math.cos(phi), Math.sin(t), Math.cos(t) * Math.sin(phi)]);
  }
  for (const lat of [-60, -30, 0, 30, 60]) {
    const y = Math.sin((lat * Math.PI) / 180);
    const r = Math.cos((lat * Math.PI) / 180);
    circle((t) => [r * Math.cos(t), y, r * Math.sin(t)]);
  }
  return new Float32Array(out);
}

// A unit cylinder along Y (radius 1, from −0.5 to 0.5) as line segments:
// rings at both ends and in the middle, 8 lines along it, and its axis
// running a little past the ends.
function cylinderOutline(segments = 64) {
  const out = [];
  for (const y of [-0.5, 0, 0.5]) {
    for (let k = 0; k < segments; k++) {
      const a = (2 * Math.PI * k) / segments;
      const b = (2 * Math.PI * (k + 1)) / segments;
      out.push(Math.cos(a), y, Math.sin(a), Math.cos(b), y, Math.sin(b));
    }
  }
  for (let m = 0; m < 8; m++) {
    const a = (Math.PI * m) / 4;
    out.push(Math.cos(a), -0.5, Math.sin(a), Math.cos(a), 0.5, Math.sin(a));
  }
  out.push(0, -0.65, 0, 0, 0.65, 0);
  return new Float32Array(out);
}

// A square from −1 to 1 in the XY plane as line segments: its edges, a
// cross through the middle, and the normal (+Z) as a short line from the centre.
function planeOutline() {
  const out = [];
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let k = 0; k < 4; k++) out.push(...corners[k], 0, ...corners[(k + 1) % 4], 0);
  out.push(-1, 0, 0, 1, 0, 0, 0, -1, 0, 0, 1, 0);
  out.push(0, 0, 0, 0, 0, 0.5);
  return new Float32Array(out);
}
