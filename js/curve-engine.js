// Computes curves on the meshes of the scene: from the points that were
// clicked to the path across the surface, its length and its centroid.
//
// The maths is Landmarker3D's (curves.js, geodesic.js), used unchanged. This
// module supplies what it needs for one mesh among several: the surface to
// put points on (the picker's nearest-point search, in the mesh file's own
// coordinates) and, for paths across the surface, the table of which
// triangles share corners. That table is built once per mesh, the first time
// a curve on it needs it (about half a second per million triangles), and
// the path between each pair of points is cached, so moving one point only
// recomputes the two stretches next to it.

import { computeCurve } from './curves.js';
import { buildTopology, geodesicSegment } from './geodesic.js';

// Above this many triangles, preparing a mesh is worth a busy note.
export const BIG_MESH = 200000;

const round = (n) => Math.round(n * 1e6) / 1e6;

// The centroid of a path: the mean position along it, each stretch counted
// by its length. Null for fewer than two points or a path of no length.
export function pathCentroid(line) {
  let L = 0;
  const c = [0, 0, 0];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    L += len;
    for (let k = 0; k < 3; k++) c[k] += (len * (a[k] + b[k])) / 2;
  }
  return L > 0 ? c.map((v) => round(v / L)) : null;
}

export class CurveEngine {
  // `geometryOf(meshId)` gives a mesh's source geometry (as read from its file).
  constructor(model, picker, geometryOf) {
    this.model = model;
    this.picker = picker;
    this.geometryOf = geometryOf;
    this.topo = new Map(); // mesh id -> corner table
    this.routes = new Map(); // stretch between two points -> { path, ok }
    model.addEventListener('change', (e) => {
      if (e.detail.kind !== 'remove') return;
      for (const n of e.detail.removed) if (n.kind === 'mesh') this.forget(n.id);
    });
  }

  // Has this mesh been prepared for paths across its surface?
  isReady(meshId) {
    return this.topo.has(meshId);
  }

  // Build the corner table of a mesh (once). The geometry is only read.
  prepare(meshId) {
    let topo = this.topo.get(meshId);
    if (!topo) {
      const g = this.geometryOf(meshId);
      if (!g) return null;
      topo = buildTopology(g.attributes.position.array, g.index ? g.index.array : null);
      this.topo.set(meshId, topo);
    }
    return topo;
  }

  forget(meshId) {
    this.topo.delete(meshId);
    for (const key of [...this.routes.keys()]) if (key.startsWith(`${meshId}|`)) this.routes.delete(key);
  }

  /**
   * Compute a curve node. Returns the fields that describe the result:
   *   line      the path across the surface, as positions (closed: ends where it starts)
   *   length    its length
   *   centroid  its centroid, or null
   *   used      'geodesic' or 'euclidean', the kind of path actually computed
   *   warning   null, or 'apart' when two points had no route between them
   *             across the surface (that stretch is then a straight line)
   */
  compute(node) {
    const mesh = this.model.meshOf(node.id);
    const empty = { line: [], length: 0, centroid: null, used: node.path, warning: null };
    if (!mesh || !this.picker.has(mesh.id)) return empty;
    const project = (p) => this.picker.snap(mesh.id, p)?.fields || null;
    const def = { id: node.id, closed: !!node.closed, path: node.path };
    const entry = { status: 'placed', control_points: node.control_points || [] };
    let route = null;
    if (node.path === 'geodesic') {
      const topo = this.prepare(mesh.id);
      if (topo) route = (P, fp, Q, fq) => this._route(mesh.id, topo, P, fp, Q, fq, project);
    }
    const r = computeCurve(def, entry, () => null, project, { route });
    if (r.error) return { ...empty, used: r.used };
    return { line: r.path, length: r.length, centroid: pathCentroid(r.path), used: r.used, warning: r.warning?.code || null };
  }

  // Recompute a curve and store the result on its node.
  refresh(id) {
    const node = this.model.get(id);
    if (node?.kind === 'curve') this.model.update(id, this.compute(node));
  }

  // Change a curve (its points, whether it is closed, …) and recompute it, as one change.
  set(id, fields) {
    const node = this.model.get(id);
    if (node?.kind !== 'curve') return;
    this.model.update(id, { ...fields, ...this.compute({ ...node, ...fields }) });
  }

  _route(meshId, topo, P, fp, Q, fq, project) {
    const faceOf = (p, f) => (Number.isInteger(f) ? f : project(p)?.anchor?.face ?? null);
    const a = faceOf(P, fp);
    const b = faceOf(Q, fq);
    if (a === null || b === null) return { path: [P, Q], ok: false };
    const key = `${meshId}|${P.join()}|${a}|${Q.join()}|${b}`;
    let r = this.routes.get(key);
    if (!r) {
      r = geodesicSegment(topo, P, a, Q, b, project);
      if (this.routes.size > 4000) this.routes.clear();
      this.routes.set(key, r);
    }
    return r;
  }
}
