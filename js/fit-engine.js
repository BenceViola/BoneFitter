// Fitted primitives as objects of the scene, kept up to date with the
// region they were fitted to. The maths is in fit.js.
//
//   the region changes        its fits are fitted again
//   the region is removed     its fits are removed with it (a fit without
//                             its region could no longer be checked or redone)
//
// A fitted sphere node holds what it was made from (`source`: the region's
// id) and what was computed from that (`centre`, `radius`, `rms`,
// `maxDeviation`, `coverage`, `faceCount`, `area`, `error`), all in the mesh
// file's own coordinates. Change a fit only through this engine, so the
// computed part never goes stale.

import { fitSphereToTriangles } from './fit.js';

// The kinds of node that are fitted primitives.
export const FIT_KINDS = new Set(['sphere']);

export class FitEngine {
  // `geometryOf(meshId)` gives a mesh's source geometry (as read from its file).
  constructor(model, geometryOf) {
    this.model = model;
    this.geometryOf = geometryOf;
    model.addEventListener('change', (e) => this._onChange(e.detail));
  }

  // The fits made from a region.
  fitsOf(regionId) {
    return [...this.model.nodes.values()].filter((n) => FIT_KINDS.has(n.kind) && n.source === regionId);
  }

  // Fit a sphere to a region. Returns its node, or null when `regionId` is not a region.
  create(regionId) {
    const region = this.model.get(regionId);
    if (region?.kind !== 'region') return null;
    const fields = { parent: region.parent, source: regionId, method: 'geometric' };
    return this.model.add('sphere', { ...fields, ...this.compute(fields) });
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
    const region = this.model.get(node.source);
    const empty = { centre: null, radius: 0, rms: 0, maxDeviation: 0, coverage: 0, faceCount: 0, area: 0 };
    if (region?.kind !== 'region') return { ...empty, error: 'no-region' };
    if (region.error || !region.faceCount) return { ...empty, error: 'region' };
    return fitSphereToTriangles(this.trianglesOf(region));
  }

  // Fit again and store the result on the node.
  refresh(id) {
    const node = this.model.get(id);
    if (node && FIT_KINDS.has(node.kind)) this.model.update(id, this.compute(node));
  }

  _onChange({ kind, ids, removed }) {
    if (kind === 'update') {
      for (const id of ids) {
        if (this.model.get(id)?.kind !== 'region') continue;
        for (const fit of this.fitsOf(id)) this.refresh(fit.id);
      }
    } else if (kind === 'remove') {
      for (const gone of removed) {
        if (gone.kind !== 'region') continue;
        for (const fit of this.fitsOf(gone.id)) this.model.remove(fit.id);
      }
    }
  }
}
