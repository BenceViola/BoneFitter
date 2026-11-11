// Fitted primitives as objects of the scene, kept up to date with what they
// were fitted to. The maths is in fit.js.
//
//   sphere, cylinder   fitted to a region
//   plane              fitted to a region, or to the path of a curve (a rim)
//
//   the source changes      the fit is fitted again
//   the source is removed   its fits are removed with it (a fit without its
//                           source could no longer be checked or redone)
//
// A fitted node holds what it was made from (`source`: a region's or a
// curve's id, `method`, and `flipped` for planes and cylinders: the normal
// or axis turned the other way) and what was computed from that, all in
// the mesh file's own coordinates:
//   sphere    centre, radius, rms, maxDeviation, coverage, faceCount, area
//   plane     point, normal, d (normal · x = d), rms, maxDeviation, size,
//             faceCount and area (from a region) or pathLength (from a curve)
//   cylinder  point, direction, radius, length, ends, rms, maxDeviation,
//             arc, spread, faceCount, area
// and `error`. Change a fit only through this engine, so the computed part
// never goes stale.

import { fitSphereToTriangles, fitPlaneToTriangles, fitPlaneToPath, fitCylinderToTriangles } from './fit.js';

// The kinds of node that are fitted primitives.
export const FIT_KINDS = new Set(['sphere', 'plane', 'cylinder']);

// A fit with no result: every computed field cleared, so nothing stale is left.
const EMPTY = {
  sphere: { centre: null, radius: 0, rms: 0, maxDeviation: 0, coverage: 0, faceCount: 0, area: 0 },
  plane: { point: null, normal: null, d: 0, rms: 0, maxDeviation: 0, size: 0, faceCount: 0, area: 0, pathLength: 0 },
  cylinder: { point: null, direction: null, radius: 0, length: 0, ends: null, rms: 0, maxDeviation: 0, arc: 0, spread: 0, faceCount: 0, area: 0 },
};

// What each kind can be fitted to.
const SOURCES = { sphere: ['region'], cylinder: ['region'], plane: ['region', 'curve'] };

export class FitEngine {
  // `geometryOf(meshId)` gives a mesh's source geometry (as read from its file).
  constructor(model, geometryOf) {
    this.model = model;
    this.geometryOf = geometryOf;
    model.addEventListener('change', (e) => this._onChange(e.detail));
  }

  // The fits made from a region or curve.
  fitsOf(sourceId) {
    return [...this.model.nodes.values()].filter((n) => FIT_KINDS.has(n.kind) && n.source === sourceId);
  }

  // Can a `kind` be fitted to this node?
  canFit(kind, source) {
    if (!SOURCES[kind]?.includes(source?.kind)) return false;
    return source.kind !== 'curve' || !source.drawing;
  }

  // Fit a primitive (sphere, plane or cylinder) to a region or curve.
  // Returns its node, or null when that kind can't be fitted to it.
  create(sourceId, kind = 'sphere') {
    const source = this.model.get(sourceId);
    if (!this.canFit(kind, source)) return null;
    const fields = { parent: source.parent, source: sourceId, method: 'geometric', ...(kind === 'sphere' ? {} : { flipped: false }) };
    return this.model.add(kind, { ...fields, ...this.compute({ ...fields, kind }) });
  }

  // The triangles of a region, 9 numbers each, in the mesh file's coordinates.
  trianglesOf(region) {
    const g = this.geometryOf(region.parent);
    if (!g) return new Float64Array(0);
    const pos = g.attributes.position;
    const index = g.index;
    const out = new Float64Array(region.faces.length * 9);
    for (let i = 0; i < region.faces.length; i++) {
      for (let k = 0; k < 3; k++) {
        const v = index ? index.getX(3 * region.faces[i] + k) : 3 * region.faces[i] + k;
        out[9 * i + 3 * k] = pos.getX(v);
        out[9 * i + 3 * k + 1] = pos.getY(v);
        out[9 * i + 3 * k + 2] = pos.getZ(v);
      }
    }
    return out;
  }

  compute(node) {
    const source = this.model.get(node.source);
    const fail = (error) => ({ ...EMPTY[node.kind], error });
    if (!source || !SOURCES[node.kind]?.includes(source.kind)) return fail('no-source');
    let r;
    if (source.kind === 'curve') {
      if (!source.line || source.line.length < 3) return fail('curve');
      r = fitPlaneToPath(source.line, !!source.closed);
    } else {
      if (source.error || !source.faceCount) return fail('region');
      const tris = this.trianglesOf(source);
      r = node.kind === 'sphere' ? fitSphereToTriangles(tris) : node.kind === 'plane' ? fitPlaneToTriangles(tris) : fitCylinderToTriangles(tris);
    }
    if (node.flipped && !r.error) {
      // Turned the other way at the user's request; the plane or axis stays where it is.
      if (r.normal) {
        r.normal = r.normal.map((v) => -v || 0);
        r.d = -r.d || 0;
      }
      if (r.direction) {
        r.direction = r.direction.map((v) => -v || 0);
        r.ends = [r.ends[1], r.ends[0]];
      }
    }
    return { ...EMPTY[node.kind], ...r };
  }

  // Fit again and store the result on the node.
  refresh(id) {
    const node = this.model.get(id);
    if (node && FIT_KINDS.has(node.kind)) this.model.update(id, this.compute(node));
  }

  // Change a fit (`flipped`) and fit it again, as one change.
  set(id, fields) {
    const node = this.model.get(id);
    if (!node || !FIT_KINDS.has(node.kind)) return;
    this.model.update(id, { ...fields, ...this.compute({ ...node, ...fields }) });
  }

  _onChange({ kind, ids, removed }) {
    if (kind === 'update') {
      for (const id of ids) {
        const k = this.model.get(id)?.kind;
        if (k !== 'region' && k !== 'curve') continue;
        for (const fit of this.fitsOf(id)) this.refresh(fit.id);
      }
    } else if (kind === 'remove') {
      for (const gone of removed) {
        if (gone.kind !== 'region' && gone.kind !== 'curve') continue;
        for (const fit of this.fitsOf(gone.id)) this.model.remove(fit.id);
      }
    }
  }
}
