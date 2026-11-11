// Regions: the triangles of a mesh that closed curves enclose. Pure maths,
// no three.js; it works on the corner table of geodesic.js (`topo`), which
// is indexed by the file's own face numbers.
//
// How a region is found:
//
//   1. A curve's path crosses triangles wherever it likes. It is turned
//      into a fence along triangle edges that follows it closely: from the
//      triangle under each point of the path to the triangle under the
//      next, by the shortest route along edges. The fence is a closed chain
//      of edges, so nothing can slip through it.
//   2. Starting from the triangles next to the fence, the surface is
//      spread over from triangle to neighbouring triangle, never across the
//      fence. That splits it into parts.
//   3. One curve splits a closed surface into two parts; the smaller is
//      taken as the inside. With several curves, the region is the part
//      that touches all of them (the ring between an outer and an inner
//      loop, the band between two rings). `flipped` gives everything else.
//
// A region's edge therefore runs along triangle edges, within about one
// triangle of the curve.
//
// A curve has no inside when it crosses itself, when it does not divide
// the surface (a ring round a handle, or a surface with holes), or when it
// is no bigger than a few triangles. These are reported as errors; nothing
// is selected then.

import { edgePath } from './geodesic.js';

// At most this many curves can bound one region.
export const MAX_BOUNDARIES = 8;
// Parts of this many triangles or fewer are specks the fence cut off beside
// the path, not sides of the curve. They go with the region.
const SPECK = 6;

const round = (n) => Math.round(n * 1e6) / 1e6;

/**
 * Which triangles share an edge. Returns { nbr, first, hi, slot }:
 *   nbr    the face across side k of face f is nbr[3f + k] (-1: an open edge);
 *          side k runs from corner k to corner k + 1
 *   first/hi/slot  the sides listed by their lower corner: the sides at
 *          corner v are i = first[v] .. first[v + 1] - 1, each running to
 *          corner hi[i] and being side slot[i] (= 3f + k)
 */
export function faceNeighbours(topo) {
  const { tri, nVerts } = topo;
  const n = tri.length;
  const next = (s) => (s % 3 === 2 ? s - 2 : s + 1);
  const first = new Uint32Array(nVerts + 1);
  for (let s = 0; s < n; s++) {
    const a = tri[s];
    const b = tri[next(s)];
    if (a !== b) first[Math.min(a, b) + 1]++;
  }
  for (let v = 0; v < nVerts; v++) first[v + 1] += first[v];
  const fill = first.slice(0, nVerts);
  const hi = new Uint32Array(first[nVerts]);
  const slot = new Uint32Array(first[nVerts]);
  for (let s = 0; s < n; s++) {
    const a = tri[s];
    const b = tri[next(s)];
    if (a === b) continue;
    const i = fill[Math.min(a, b)]++;
    hi[i] = Math.max(a, b);
    slot[i] = s;
  }
  const nbr = new Int32Array(n).fill(-1);
  for (let v = 0; v < nVerts; v++) {
    for (let i = first[v]; i < first[v + 1]; i++) {
      for (let j = i + 1; j < first[v + 1]; j++) {
        if (hi[i] !== hi[j]) continue;
        nbr[slot[i]] = (slot[j] / 3) | 0;
        nbr[slot[j]] = (slot[i] / 3) | 0;
      }
    }
  }
  return { nbr, first, hi, slot };
}

/**
 * The fence for one closed path: corners of the mesh in order, each joined
 * to the next (and the last to the first) by a triangle edge. `faces[i]` is
 * the triangle under `line[i]` (or null). Returns null when the path jumps
 * between separate pieces of the mesh.
 */
export function edgeLoop(topo, line, faces) {
  const chain = [];
  let prev = -1;
  for (let i = 0; i < line.length; i++) {
    if (!Number.isInteger(faces[i])) continue;
    if (prev >= 0 && faces[i] !== faces[prev]) {
      const route = edgePath(topo, line[prev], faces[prev], line[i], faces[i]);
      if (route === null) return null;
      for (const v of route) if (chain[chain.length - 1] !== v) chain.push(v);
    }
    prev = i;
  }
  if (chain.length > 1 && chain[0] === chain[chain.length - 1]) chain.pop();
  return chain;
}

// What a region is when its curves enclose nothing: empty, with the reason.
export const emptyRegion = (error) => ({ faces: new Uint32Array(0), faceCount: 0, area: 0, centroid: null, error });
const failed = emptyRegion;

/**
 * The region bounded by closed paths. `loops` is [{ line, faces }], one per
 * curve (see edgeLoop). Returns { faces, faceCount, area, centroid, error }:
 * `faces` are the file's face numbers in rising order; `error` is null or
 *   'small'      a curve is no bigger than a few triangles
 *   'apart'      a curve jumps between separate pieces of the mesh
 *   'open'       the curves do not divide the surface
 *   'crossing'   a curve crosses itself or another one
 *   'no-common'  no part of the surface touches all the curves
 * and the region is then empty.
 */
export function computeRegion(topo, loops, { flipped = false } = {}) {
  const { tri, verts: V } = topo;
  const nF = tri.length / 3;
  const sides = (topo.sides ||= faceNeighbours(topo));
  const { nbr, first, hi, slot } = sides;

  // 1. The fences: which loops run along each side of each triangle (one bit per loop).
  const fence = new Uint8Array(3 * nF);
  const seeds = [];
  let fenceEdges = 0;
  for (let l = 0; l < loops.length; l++) {
    const chain = edgeLoop(topo, loops[l].line, loops[l].faces);
    if (chain === null) return failed('apart');
    if (new Set(chain).size < 3) return failed('small');
    for (let i = 0; i < chain.length; i++) {
      const a = chain[i];
      const b = chain[(i + 1) % chain.length];
      if (a === b) continue;
      const lo = Math.min(a, b);
      const up = Math.max(a, b);
      for (let e = first[lo]; e < first[lo + 1]; e++) {
        if (hi[e] !== up) continue;
        fence[slot[e]] |= 1 << l;
        seeds.push((slot[e] / 3) | 0);
      }
      fenceEdges++;
    }
  }

  // 2. Spread from the triangles beside the fences; each spread is one part.
  const part = new Int32Array(nF).fill(-1);
  const stack = new Int32Array(nF);
  const parts = [];
  for (const seed of seeds) {
    if (part[seed] >= 0) continue;
    const p = { id: parts.length, n: 0, area: 0, sum: [0, 0, 0], touches: 0 };
    let top = 0;
    stack[top++] = seed;
    part[seed] = p.id;
    while (top) {
      const f = stack[--top];
      const a = 3 * tri[3 * f];
      const b = 3 * tri[3 * f + 1];
      const c = 3 * tri[3 * f + 2];
      const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2];
      const vx = V[c] - V[a], vy = V[c + 1] - V[a + 1], vz = V[c + 2] - V[a + 2];
      const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
      p.n++;
      p.area += area;
      p.sum[0] += (area * (V[a] + V[b] + V[c])) / 3;
      p.sum[1] += (area * (V[a + 1] + V[b + 1] + V[c + 1])) / 3;
      p.sum[2] += (area * (V[a + 2] + V[b + 2] + V[c + 2])) / 3;
      for (let s = 3 * f; s < 3 * f + 3; s++) {
        if (fence[s]) {
          p.touches |= fence[s];
          continue;
        }
        const g = nbr[s];
        if (g >= 0 && part[g] < 0) {
          part[g] = p.id;
          stack[top++] = g;
        }
      }
    }
    parts.push(p);
  }

  // 3. Which parts are the region.
  const specks = parts.filter((p) => p.n <= SPECK);
  const mains = parts.filter((p) => p.n > SPECK);
  if (mains.length < 2) return failed(specks.length && fenceEdges <= 2 * SPECK ? 'small' : 'open');
  if (mains.length > loops.length + 1) return failed('crossing');
  const all = (1 << loops.length) - 1;
  const touching = mains.filter((p) => p.touches === all);
  if (!touching.length) return failed('no-common');
  const inside = touching.reduce((a, b) => (b.area < a.area ? b : a));
  const chosen = new Set((flipped ? mains.filter((p) => p !== inside) : [inside]).concat(specks).map((p) => p.id));

  let count = 0;
  let area = 0;
  const sum = [0, 0, 0];
  for (const p of parts) {
    if (!chosen.has(p.id)) continue;
    count += p.n;
    area += p.area;
    for (let k = 0; k < 3; k++) sum[k] += p.sum[k];
  }
  const faces = new Uint32Array(count);
  const isChosen = new Uint8Array(parts.length);
  for (const id of chosen) isChosen[id] = 1;
  let i = 0;
  for (let f = 0; f < nF; f++) if (part[f] >= 0 && isChosen[part[f]]) faces[i++] = f;
  return { faces, faceCount: count, area: round(area), centroid: area > 0 ? sum.map((v) => round(v / area)) : null, error: null };
}
