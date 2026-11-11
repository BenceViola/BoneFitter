// Surface picking on the source meshes (each geometry exactly as read from
// its file), accelerated with three-mesh-bvh.
//
// The BVH is built in "indirect" mode: it sorts its own lookup table instead
// of reordering the geometry's triangles, so the face index of a hit is the
// face index in the file.
//
// Adapted from Landmarker3D's js/picking.js, which picks on one mesh. Here
// several meshes are in the scene at once, and each can sit anywhere in it
// (its "owner" object carries the mesh's position and orientation). A hit
// says which mesh it is on and gives the point in that mesh's own file
// coordinates, wherever the mesh has been moved to.

import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const round = (n) => Math.round(n * 1e6) / 1e6; // up to 6 decimal places, as in landmark files

export class Picker {
  constructor(viewer) {
    this.viewer = viewer;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.firstHitOnly = true;
    this.targets = new Map(); // id -> { mesh (ray tests only), owner }
    this.canPick = () => true; // (id) => bool; hidden meshes are skipped
    this._ndc = new THREE.Vector2();
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._c = new THREE.Vector3();
  }

  // Make a mesh pickable. `owner` is the scene object the mesh hangs under;
  // leave it out for a mesh that sits in the scene as it is in its file.
  // Building the BVH takes a moment on large meshes; it stays on the geometry.
  add(id, geometry, owner = null) {
    if (!geometry.boundsTree) geometry.computeBoundsTree({ indirect: true });
    // Never rendered; only used for ray tests. DoubleSide so inner walls can be picked.
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    mesh.matrixAutoUpdate = false;
    mesh.matrixWorldAutoUpdate = false;
    this.targets.set(id, { mesh, owner });
  }

  remove(id) {
    this.targets.delete(id);
  }

  has(id) {
    return this.targets.has(id);
  }

  // The camera ray under a screen position.
  rayAt(clientX, clientY) {
    const rect = this.viewer.renderer.domElement.getBoundingClientRect();
    this._ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(this._ndc, this.viewer.camera);
    return this.raycaster.ray.clone();
  }

  // The nearest surface point under the cursor: which mesh, and the point in
  // that mesh's file coordinates ({ id, position, anchor, normal }).
  pickAt(clientX, clientY) {
    this.rayAt(clientX, clientY);
    return this._describe(this._firstHit(0, Infinity));
  }

  // The nearest surface point along a ray given in scene coordinates.
  pickRay(ray) {
    this.raycaster.ray.copy(ray);
    return this._describe(this._firstHit(0, Infinity));
  }

  // Distance along `ray` (scene coordinates) to the first surface hit, or null.
  surfaceDistance(ray) {
    this.raycaster.ray.copy(ray);
    const hit = this._firstHit(0, Infinity);
    return hit ? hit.distance : null;
  }

  // True when a surface lies between `from` and `point` (scene coordinates).
  isHidden(point, from, margin) {
    const dir = point.clone().sub(from);
    const dist = dir.length();
    if (dist === 0) return false;
    this.raycaster.ray.set(from, dir.divideScalar(dist));
    const hit = this._firstHit(0, dist);
    return !!hit && hit.distance < dist - margin;
  }

  // Nearest surface point of one mesh to a position in that mesh's file
  // coordinates, plus how far away it was.
  snap(id, position) {
    const t = this.targets.get(id);
    if (!t) return null;
    const p = new THREE.Vector3().fromArray(position);
    const hit = t.mesh.geometry.boundsTree.closestPointToPoint(p, {});
    if (!hit) return null;
    return { fields: this._fields(t.mesh.geometry, hit.point, hit.faceIndex), distance: hit.distance };
  }

  _firstHit(near, far) {
    this.raycaster.near = near;
    this.raycaster.far = far;
    let best = null;
    for (const [id, t] of this.targets) {
      if (!this.canPick(id)) continue;
      if (t.owner) {
        t.owner.updateWorldMatrix(true, false);
        t.mesh.matrixWorld.copy(t.owner.matrixWorld);
      } else {
        t.mesh.matrixWorld.identity();
      }
      const hit = this.raycaster.intersectObject(t.mesh, false)[0];
      if (hit && (!best || hit.distance < best.distance)) best = { ...hit, id, target: t };
    }
    return best;
  }

  _describe(hit) {
    if (!hit) return null;
    // From the scene back into the mesh's own coordinates.
    const local = hit.point.clone().applyMatrix4(hit.target.mesh.matrixWorld.clone().invert());
    return { id: hit.id, ...this._fields(hit.target.mesh.geometry, local, hit.faceIndex) };
  }

  _fields(g, point, face) {
    const pos = g.attributes.position;
    const idx = g.index;
    const ia = idx ? idx.getX(3 * face) : 3 * face;
    const ib = idx ? idx.getX(3 * face + 1) : 3 * face + 1;
    const ic = idx ? idx.getX(3 * face + 2) : 3 * face + 2;
    const a = this._a.fromBufferAttribute(pos, ia);
    const b = this._b.fromBufferAttribute(pos, ib);
    const c = this._c.fromBufferAttribute(pos, ic);

    const result = { position: point.toArray().map(round) };
    const bary = THREE.Triangle.getBarycoord(point, a, b, c, new THREE.Vector3());
    if (bary) result.anchor = { face, bary: bary.toArray().map(round) };
    const normal = THREE.Triangle.getNormal(a, b, c, new THREE.Vector3());
    if (normal.lengthSq() > 0) result.normal = normal.toArray().map(round);
    return result;
  }
}
