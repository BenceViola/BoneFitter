// Cutting a mesh with a plane: the outlines where the plane meets the
// surface, and the section's area and shape (cross-sectional geometry).
// No page, no three.js.
//
//   sectionOf(positions, index, plane) → {
//     loops:     [{ points: [[x, y, z]…], closed, length, area, hole }]
//     area       the area inside the closed outlines, holes taken away
//                (a hollow bone: the cortical area)
//     perimeter  every outline's length together
//     centroid   [x, y, z], on the plane (null with no area)
//     u, v       the plane's own axes (see planeAxes); origin = plane.point
//     moments    second moments of area about the centroid, in the plane's
//                axes: Iu (about the u axis: ∫v²), Iv (∫u²), Iuv, J = Iu + Iv
//                (polar), Imax, Imin, angle (degrees from u towards v of
//                the axis about which it is Imax)
//     error      null, or 'none' (the plane misses the mesh)
//   }
//
// A triangle is cut where its corners lie on both sides of the plane (a
// corner exactly on the plane counts as above it). Crossing points are
// worked out from each edge's two corners in a fixed order, so the two
// triangles sharing an edge give exactly the same point and the pieces
// join into outlines. An outline inside an odd number of others is a hole.

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const clean = (a) => a.map((x) => x || 0);

// Two directions across the plane, u × v = normal: u along the scene's X
// as seen on the plane (or Y, when the plane is nearly square to X).
export function planeAxes(normal) {
  const n = unit(normal);
  const ref = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = unit(sub(ref, n.map((x) => x * dot(ref, n))));
  return { u: clean(u), v: clean(cross(n, u)) };
}

// Open outlines whose ends lie at almost the same place are one outline:
// a mesh whose shared corners differ in the last digits (a seam written
// twice) would otherwise come apart there.
function stitch(chains, points) {
  const at = (k) => points.get(k);
  let lo = [Infinity, Infinity, Infinity];
  let hi = [-Infinity, -Infinity, -Infinity];
  for (const p of points.values()) {
    lo = lo.map((v, i) => Math.min(v, p[i]));
    hi = hi.map((v, i) => Math.max(v, p[i]));
  }
  const tol = 1e-6 * Math.max(Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]), 1e-12);
  const close = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= tol;
  for (let joined = true; joined; ) {
    joined = false;
    for (let i = 0; i < chains.length && !joined; i++) {
      const c = chains[i];
      if (c.closed) continue;
      const end = at(c.keys[c.keys.length - 1]);
      // Its own start: it closes.
      if (c.keys.length > 2 && close(end, at(c.keys[0]))) {
        c.keys.pop();
        c.closed = true;
        joined = true;
        break;
      }
      for (let j = 0; j < chains.length; j++) {
        const d = chains[j];
        if (j === i || d.closed) continue;
        const flip = close(end, at(d.keys[d.keys.length - 1]));
        if (!flip && !close(end, at(d.keys[0]))) continue;
        const next = flip ? d.keys.slice().reverse() : d.keys;
        c.keys = c.keys.concat(next.slice(1));
        chains.splice(j, 1);
        joined = true;
        break;
      }
      if (joined) break;
      // Or its start meets another's end: try that chain the other way round next time.
      const start = at(c.keys[0]);
      for (let j = 0; j < chains.length; j++) {
        const d = chains[j];
        if (j === i || d.closed) continue;
        if (close(start, at(d.keys[0])) || close(start, at(d.keys[d.keys.length - 1]))) {
          c.keys.reverse();
          joined = true;
          break;
        }
      }
    }
  }
}

export function sectionOf(positions, index, plane) {
  const n = unit(plane.normal);
  const d = dot(n, plane.point);
  const vertexCount = positions.length / 3;
  const faceCount = index ? index.length / 3 : vertexCount / 3;
  const side = new Float64Array(vertexCount);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < vertexCount; i++) {
    side[i] = n[0] * positions[3 * i] + n[1] * positions[3 * i + 1] + n[2] * positions[3 * i + 2] - d;
    lo = Math.min(lo, side[i]);
    hi = Math.max(hi, side[i]);
  }
  // A corner within rounding of the plane is on it (and counts as above it):
  // a seam written twice must not fall on both sides.
  const eps = 1e-9 * Math.max(hi - lo, 1e-12);
  for (let i = 0; i < vertexCount; i++) if (Math.abs(side[i]) <= eps) side[i] = 0;
  const corner = (f, k) => (index ? index[3 * f + k] : 3 * f + k);
  const pos = (i) => [positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]];
  const before = (a, b) => (a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2]);

  // Each cut edge: a key (its two corners' positions, in a fixed order) and the crossing point.
  const points = new Map();
  const edgeKey = (i, j) => {
    let a = pos(i);
    let b = pos(j);
    let sa = side[i];
    let sb = side[j];
    if (before(b, a)) [a, b, sa, sb] = [b, a, sb, sa];
    // Cut at a corner lying on the plane: the corner itself, whichever edge led there.
    const on = sa === 0 ? a : sb === 0 ? b : null;
    if (on) {
      const key = `${on[0]},${on[1]},${on[2]}`;
      if (!points.has(key)) points.set(key, on);
      return key;
    }
    const key = `${a[0]},${a[1]},${a[2]}|${b[0]},${b[1]},${b[2]}`;
    if (!points.has(key)) {
      const t = sa / (sa - sb);
      points.set(key, [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])]);
    }
    return key;
  };
  const segments = [];
  for (let f = 0; f < faceCount; f++) {
    const c = [corner(f, 0), corner(f, 1), corner(f, 2)];
    const up = c.map((i) => side[i] >= 0);
    if (up[0] === up[1] && up[1] === up[2]) continue;
    const cut = [];
    for (let k = 0; k < 3; k++) {
      const i = c[k];
      const j = c[(k + 1) % 3];
      if (up[k] !== up[(k + 1) % 3]) cut.push(edgeKey(i, j));
    }
    if (cut.length === 2 && cut[0] !== cut[1]) segments.push(cut);
  }

  const axes = planeAxes(n);
  const empty = { loops: [], area: 0, perimeter: 0, centroid: null, ...axes, origin: plane.point.slice(), moments: null };
  if (!segments.length) return { ...empty, error: 'none' };

  // Join the pieces into outlines.
  const at = new Map();
  segments.forEach(([a, b], s) => {
    for (const k of [a, b]) {
      if (!at.has(k)) at.set(k, []);
      at.get(k).push(s);
    }
  });
  const used = new Uint8Array(segments.length);
  const walk = (start, startKey) => {
    const keys = [startKey];
    let s = start;
    let key = startKey;
    for (;;) {
      used[s] = 1;
      const [a, b] = segments[s];
      key = a === key ? b : a;
      if (key === startKey) return { keys, closed: true };
      keys.push(key);
      const next = at.get(key).find((t) => !used[t]);
      if (next === undefined) return { keys, closed: false };
      s = next;
    }
  };
  const chains = [];
  // Open outlines first, from their ends, so they come out whole.
  for (const [key, list] of at) {
    if (list.length !== 1 || used[list[0]]) continue;
    chains.push(walk(list[0], key));
  }
  for (let s = 0; s < segments.length; s++) if (!used[s]) chains.push(walk(s, segments[s][0]));
  stitch(chains, points);

  // In the plane's own axes.
  const o = plane.point;
  const flat = (p) => {
    const r = sub(p, o);
    return [dot(r, axes.u), dot(r, axes.v)];
  };
  const loops = chains.map(({ keys, closed }) => {
    const pts = keys.map((k) => points.get(k));
    let length = 0;
    for (let i = 1; i < pts.length; i++) length += Math.hypot(...sub(pts[i], pts[i - 1]));
    if (closed) length += Math.hypot(...sub(pts[0], pts[pts.length - 1]));
    return { points: pts, closed, length, flat: pts.map(flat) };
  });

  // Area integrals of each closed outline (signed, by its direction round).
  const integrals = (q) => {
    let A = 0;
    let Su = 0;
    let Sv = 0;
    let Iuu = 0;
    let Ivv = 0;
    let Iuv = 0;
    for (let i = 0; i < q.length; i++) {
      const [x0, y0] = q[i];
      const [x1, y1] = q[(i + 1) % q.length];
      const c = x0 * y1 - x1 * y0;
      A += c / 2;
      Su += ((x0 + x1) * c) / 6;
      Sv += ((y0 + y1) * c) / 6;
      Iuu += ((x0 * x0 + x0 * x1 + x1 * x1) * c) / 12; // ∫u²
      Ivv += ((y0 * y0 + y0 * y1 + y1 * y1) * c) / 12; // ∫v²
      Iuv += ((x0 * y1 + 2 * x0 * y0 + 2 * x1 * y1 + x1 * y0) * c) / 24;
    }
    return { A, Su, Sv, Iuu, Ivv, Iuv };
  };
  const inside = (p, q) => {
    let hit = false;
    for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
      const [xi, yi] = q[i];
      const [xj, yj] = q[j];
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };
  const closed = loops.filter((l) => l.closed && l.flat.length >= 3);
  const total = { A: 0, Su: 0, Sv: 0, Iuu: 0, Ivv: 0, Iuv: 0 };
  for (const l of closed) {
    const depth = closed.filter((other) => other !== l && inside(l.flat[0], other.flat)).length;
    l.hole = depth % 2 === 1;
    const m = integrals(l.flat);
    l.area = Math.abs(m.A);
    // Outer outlines add, holes take away, whichever way round they run.
    const f = (l.hole ? -1 : 1) * Math.sign(m.A || 1);
    for (const k of Object.keys(total)) total[k] += f * m[k];
  }
  for (const l of loops) {
    if (!l.closed) {
      l.hole = false;
      l.area = 0;
    }
    delete l.flat;
  }
  const perimeter = loops.reduce((s, l) => s + l.length, 0);
  if (!(total.A > 1e-12)) return { ...empty, loops, perimeter, error: null };
  const cu = total.Su / total.A;
  const cv = total.Sv / total.A;
  const Iu = total.Ivv - total.A * cv * cv;
  const Iv = total.Iuu - total.A * cu * cu;
  const Iuv = total.Iuv - total.A * cu * cv;
  const mid = (Iu + Iv) / 2;
  const R = Math.hypot((Iu - Iv) / 2, Iuv);
  const angle = (0.5 * Math.atan2(-2 * Iuv, Iu - Iv) * 180) / Math.PI;
  return {
    loops,
    area: total.A,
    perimeter,
    centroid: [0, 1, 2].map((k) => o[k] + cu * axes.u[k] + cv * axes.v[k]),
    centroid2d: [cu, cv],
    ...axes,
    origin: o.slice(),
    moments: { Iu, Iv, Iuv, J: Iu + Iv, Imax: mid + R, Imin: mid - R, angle },
    error: null,
  };
}
