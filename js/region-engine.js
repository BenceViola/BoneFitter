// Regions as objects of the scene: made from closed curves, and kept up to
// date with them. The maths is in region.js; this module supplies the mesh
// (its corner table, shared with the curve engine, and the triangle under
// each point of a curve's path) and watches the tree:
//
//   a boundary curve changes   its regions are recomputed
//   a boundary curve is removed   it is taken off its regions; a region
//                                 left with no boundary is removed too
//
// A region node holds what it was made from (`boundary`: curve ids, and
// `flipped`: the other side) and what was computed from that (`faces`,
// `faceCount`, `area`, `centroid`, `error`). Change a region only through
// this engine, so the computed part never goes stale.

import { computeRegion, emptyRegion, MAX_BOUNDARIES } from './region.js';
import { BIG_MESH } from './curve-engine.js';

export class RegionEngine {
  constructor(model, picker, curveEngine) {
    this.model = model;
    this.picker = picker;
    this.curveEngine = curveEngine;
    this.paused = false;
    this.waiting = new Set(); // regions to recompute when the pause ends
    model.addEventListener('change', (e) => this._onChange(e.detail));
  }

  // The regions a curve bounds.
  regionsOf(curveId) {
    return [...this.model.nodes.values()].filter((n) => n.kind === 'region' && n.boundary.includes(curveId));
  }

  // Can this curve bound a region? Only a finished closed loop can.
  canBound(curve) {
    return curve?.kind === 'curve' && !!curve.closed && !curve.drawing;
  }

  // The curves that could be added to a region as a further boundary.
  candidates(id) {
    const region = this.model.get(id);
    if (region?.kind !== 'region' || region.boundary.length >= MAX_BOUNDARIES) return [];
    return this.model.children(region.parent).filter((c) => this.canBound(c) && !region.boundary.includes(c.id));
  }

  // Make a region from a closed curve. Returns its node, or null for a curve that can't bound one.
  create(curveId) {
    const curve = this.model.get(curveId);
    if (!this.canBound(curve)) return null;
    const fields = { parent: curve.parent, boundary: [curveId], flipped: false };
    return this.model.add('region', { ...fields, ...this.compute(fields) });
  }

  // Add a further boundary: a hole in the region, or the other end of a band.
  addBoundary(id, curveId) {
    if (!this.candidates(id).some((c) => c.id === curveId)) return false;
    this.set(id, { boundary: [...this.model.get(id).boundary, curveId] });
    return true;
  }

  // Compute a region (a node, or just { parent, boundary, flipped }).
  compute(region) {
    const meshId = region.parent;
    const curves = region.boundary.map((id) => this.model.get(id));
    if (!curves.length || curves.some((c) => !c)) return emptyRegion('no-curve');
    if (curves.some((c) => !this.canBound(c))) return emptyRegion('not-closed');
    if (curves.some((c) => c.warning === 'apart')) return emptyRegion('apart');
    const topo = this.picker.has(meshId) ? this.curveEngine.prepare(meshId) : null;
    if (!topo) return emptyRegion('no-curve');
    const faceAt = (p) => this.picker.snap(meshId, p)?.fields.anchor?.face ?? null;
    const loops = curves.map((c) => ({ line: c.line, faces: c.line.map(faceAt) }));
    return computeRegion(topo, loops, { flipped: !!region.flipped });
  }

  // Recompute a region and store the result on its node.
  refresh(id) {
    const node = this.model.get(id);
    if (node?.kind === 'region') this.model.update(id, this.compute(node));
  }

  // Change a region (its boundary, its side) and recompute it, as one change.
  set(id, fields) {
    const node = this.model.get(id);
    if (node?.kind !== 'region') return;
    this.model.update(id, { ...fields, ...this.compute({ ...node, ...fields }) });
  }

  // While a curve is dragged it changes at every frame. On a large mesh its
  // regions wait until the drag ends; on a small one they follow along.
  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
    const ids = [...this.waiting];
    this.waiting.clear();
    for (const id of ids) this.refresh(id);
  }

  _onChange({ kind, ids, removed }) {
    if (kind === 'update') {
      for (const id of ids) {
        if (this.model.get(id)?.kind !== 'curve') continue;
        for (const region of this.regionsOf(id)) {
          const big = (this.model.get(region.parent)?.faceCount ?? 0) > BIG_MESH;
          if (this.paused && big) this.waiting.add(region.id);
          else this.refresh(region.id);
        }
      }
    } else if (kind === 'remove') {
      for (const gone of removed) {
        if (gone.kind !== 'curve') continue;
        for (const region of this.regionsOf(gone.id)) {
          const boundary = region.boundary.filter((id) => id !== gone.id);
          if (boundary.length) this.set(region.id, { boundary });
          else this.model.remove(region.id);
        }
      }
    }
  }
}
