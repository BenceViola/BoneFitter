// Points and lines made in the app, as objects of the scene, kept up to date
// with what they were made from. The maths is in construct.js.
//
// A point (kind 'point') has a `method`:
//   'surface'    clicked on a mesh: `anchor` (the triangle) and `position`,
//                attached to that mesh. It has no inputs.
//   'centre'     the centre of a sphere             inputs [sphere]
//   'centroid'   the centroid of a region or curve  inputs [region or curve]
//   'midpoint'   midway between two points          inputs [point, point]
//   'line-plane' where a line meets a plane         inputs [line, plane]
// and the computed `position` and `error`. Landmarks from a file are points
// without a method; this engine leaves them alone.
//
// A line (kind 'line') has a `method`:
//   'two-points'    from the first point through the second  inputs [point, point]
//   'axis'          the axis of a cylinder                   inputs [cylinder]
//   'fit-curve'     the straight line nearest a curve's path inputs [curve]
//   'perpendicular' square to a plane, through a point       inputs [plane, point]
//   'planes'        where two planes meet                    inputs [plane, plane]
// `flipped` (turned the other way), and the computed point, direction,
// ends, length, signed (perpendicular: the point's side of the plane), rms
// and maxDeviation (fit-curve), error.
//
// Wherever a point is asked for, a sphere stands for its centre.
//
//   an input changes   the point or line is made again
//   an input is gone   the point or line is removed with it
//
// Everything is in the mesh file's coordinates. A point or line whose
// inputs are all on one mesh is attached to that mesh; otherwise it is
// global (top level). Meshes can't be moved yet, so file and scene
// coordinates are the same; when they can, inputs from different meshes
// must be brought into scene coordinates here first.

import { midpoint, lineThrough, fitLineToPath, perpendicularTo, planesMeet, lineMeetsPlane } from './construct.js';

export const CONSTRUCT_KINDS = new Set(['point', 'line']);

const EMPTY = {
  point: { position: null },
  line: { point: null, direction: null, ends: null, length: 0, signed: 0, rms: 0, maxDeviation: 0 },
};

export const POINT_METHODS = ['centre', 'centroid', 'midpoint', 'line-plane'];
export const LINE_METHODS = ['two-points', 'axis', 'fit-curve', 'perpendicular', 'planes'];

// A made point or line (not a landmark, not a clicked point).
export const isConstructed = (node) => CONSTRUCT_KINDS.has(node?.kind) && Array.isArray(node.inputs);

// Where an object is, when it stands for a point: a point's position, a sphere's centre.
export function positionOf(node) {
  if (!node || node.error) return null;
  if (node.kind === 'point') return Array.isArray(node.position) ? node.position : null;
  if (node.kind === 'sphere') return node.centre ?? null;
  return null;
}

export class ConstructionEngine {
  constructor(model) {
    this.model = model;
    model.addEventListener('change', (e) => this._onChange(e.detail));
  }

  // The points and lines made from this object.
  dependentsOf(id) {
    return [...this.model.nodes.values()].filter((n) => isConstructed(n) && n.inputs.includes(id));
  }

  // A point clicked on a mesh: `hit` as the picker gives it ({ id, position, anchor }).
  placePoint(hit) {
    return this.model.add('point', { parent: hit.id, method: 'surface', anchor: hit.anchor, position: hit.position.slice() });
  }

  // Make a point or line from other objects. Returns its node.
  create(kind, method, inputs, fields = {}) {
    const meshes = new Set(inputs.map((id) => this.model.meshOf(id)?.id ?? null));
    const parent = meshes.size === 1 ? [...meshes][0] : null;
    const base = { parent, method, inputs: inputs.slice(), ...(kind === 'line' ? { flipped: false } : {}), ...fields };
    return this.model.add(kind, { ...base, ...this.compute({ ...base, kind }) });
  }

  compute(node) {
    const fail = (error) => ({ ...EMPTY[node.kind], error });
    const inputs = node.inputs.map((id) => this.model.get(id));
    if (inputs.some((n) => !n)) return fail('no-input');
    const pos = inputs.map(positionOf);
    if (node.kind === 'point') {
      switch (node.method) {
        case 'centre':
          return pos[0] ? { position: pos[0].slice(), error: null } : fail('input');
        case 'centroid': {
          const c = inputs[0].error ? null : inputs[0].centroid;
          return Array.isArray(c) ? { position: c.slice(), error: null } : fail('input');
        }
        case 'midpoint':
          return pos[0] && pos[1] ? { position: midpoint(pos[0], pos[1]), error: null } : fail('input');
        case 'line-plane': {
          const [line, plane] = inputs;
          if (line.error || !line.direction || plane.error || !plane.normal) return fail('input');
          const r = lineMeetsPlane(line, plane);
          return r.error ? fail(r.error) : { position: r.position, error: null };
        }
        default:
          return fail('method');
      }
    }
    let r;
    switch (node.method) {
      case 'two-points':
        if (!pos[0] || !pos[1]) return fail('input');
        r = lineThrough(pos[0], pos[1]);
        break;
      case 'axis': {
        const c = inputs[0];
        if (c.error || !c.direction) return fail('input');
        r = { point: c.point.slice(), direction: c.direction.slice(), ends: c.ends.map((e) => e.slice()), length: c.length, error: null };
        break;
      }
      case 'fit-curve': {
        const c = inputs[0];
        if (!c.line || c.line.length < 2) return fail('input');
        r = fitLineToPath(c.line, !!c.closed);
        break;
      }
      case 'perpendicular': {
        const [plane] = inputs;
        if (plane.error || !plane.normal || !pos[1]) return fail('input');
        r = perpendicularTo(plane, pos[1]);
        delete r.foot;
        break;
      }
      case 'planes': {
        const [a, b] = inputs;
        if (a.error || !a.normal || b.error || !b.normal) return fail('input');
        r = planesMeet(a, b);
        break;
      }
      default:
        return fail('method');
    }
    if (r.error) return fail(r.error);
    if (node.flipped) {
      // Turned the other way at the user's request; the line stays where it is.
      r.direction = r.direction.map((v) => -v || 0);
      r.ends = [r.ends[1], r.ends[0]];
      if (r.signed) r.signed = -r.signed;
    }
    return { ...EMPTY.line, ...r };
  }

  // Make it again and store the result on the node.
  refresh(id) {
    const node = this.model.get(id);
    if (isConstructed(node)) this.model.update(id, this.compute(node));
  }

  // Change a line (`flipped`) and make it again, as one change.
  set(id, fields) {
    const node = this.model.get(id);
    if (!isConstructed(node)) return;
    this.model.update(id, { ...fields, ...this.compute({ ...node, ...fields }) });
  }

  _onChange({ kind, ids, removed }) {
    if (kind === 'update') {
      // A made point's own update reaches what was made from it in turn.
      for (const id of ids) for (const n of this.dependentsOf(id)) this.refresh(n.id);
    } else if (kind === 'remove') {
      for (const gone of removed) for (const n of this.dependentsOf(gone.id)) this.model.remove(n.id);
    }
  }
}
