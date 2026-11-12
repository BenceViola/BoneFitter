// Points and lines made from other objects: the maths, no page and no
// three.js. construction-engine.js applies it to the objects of the scene.
//
// A line is { point, direction, ends, length }: a point on it, a unit
// direction (its sign means something: a flip turns it round), and the
// stretch it is drawn over (`ends`, in the order of the direction) with
// that stretch's length. What `length` measures depends on how the line was
// made: the distance between two points, from a point to a plane, and so on.

import { eigenSym3 } from './fit.js';

const EPS = 1e-12;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => scale(a, 1 / norm(a));
const clean = (a) => a.map((v) => v || 0); // no −0
const byLargest = (v) => {
  let k = 0;
  for (let i = 1; i < 3; i++) if (Math.abs(v[i]) > Math.abs(v[k])) k = i;
  return v[k] < 0 ? clean(v.map((x) => -x)) : v;
};
const noLine = (error) => ({ point: null, direction: null, ends: null, length: 0, error });

export const midpoint = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

// The two points in the order of the direction.
export const orderAlong = ([a, b], u) => (dot(sub(b, a), u) < 0 ? [b, a] : [a, b]);

// The line from `a` through `b`.
export function lineThrough(a, b) {
  const v = sub(b, a);
  const length = norm(v);
  if (length < EPS * Math.max(1, norm(a))) return noLine('same');
  return { point: a.slice(), direction: scale(v, 1 / length), ends: [a.slice(), b.slice()], length, error: null };
}

// The straight line that best fits a path (each stretch counted by its
// length): through the path's weighted mean, along its longest spread.
// It points from the path's start towards its end; for a closed loop its
// largest component is positive. Also the RMS and largest distance of the
// path's points from the line.
export function fitLineToPath(line, closed) {
  const n = line.length;
  const weights = new Float64Array(n);
  let total = 0;
  for (let i = 1; i < n; i++) {
    const len = norm(sub(line[i], line[i - 1]));
    weights[i - 1] += len / 2;
    weights[i] += len / 2;
    total += len;
  }
  if (n < 2 || total < EPS) return { ...noLine('few'), rms: 0, maxDeviation: 0 };
  const mean = [0, 0, 0];
  line.forEach((p, i) => {
    for (let k = 0; k < 3; k++) mean[k] += (weights[i] * p[k]) / total;
  });
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  line.forEach((p, i) => {
    const d = sub(p, mean);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C[r][c] += weights[i] * d[r] * d[c];
  });
  let u = unit(eigenSym3(C).vectors[2]);
  if (closed) u = byLargest(u);
  else if (dot(sub(line[n - 1], line[0]), u) < 0) u = clean(scale(u, -1));
  let lo = Infinity;
  let hi = -Infinity;
  let sq = 0;
  let max = 0;
  line.forEach((p, i) => {
    const d = sub(p, mean);
    const t = dot(d, u);
    lo = Math.min(lo, t);
    hi = Math.max(hi, t);
    const off = norm(sub(d, scale(u, t)));
    sq += (weights[i] * off * off) / total;
    max = Math.max(max, off);
  });
  return {
    point: mean,
    direction: u,
    ends: [add(mean, scale(u, lo)), add(mean, scale(u, hi))],
    length: hi - lo,
    rms: Math.sqrt(sq),
    maxDeviation: max,
    error: null,
  };
}

// The line through `p` square to the plane, along its normal. `foot` is
// where it meets the plane; `length` the distance from the point to the
// plane, `signed` the same with the sign of the side the normal points to.
// Drawn from the plane to the point, or as wide as the plane when the point
// lies on it.
export function perpendicularTo(plane, p) {
  const u = plane.normal.slice();
  const signed = dot(u, p) - plane.d;
  const foot = sub(p, scale(u, signed));
  const length = Math.abs(signed);
  const ends = length > EPS * Math.max(1, plane.size) ? orderAlong([foot, p.slice()], u) : [sub(foot, scale(u, plane.size)), add(foot, scale(u, plane.size))];
  return { point: foot, direction: u, ends, length, signed, foot, error: null };
}

// The line where two planes meet: along n1 × n2, at the point of it nearest
// the middle of the planes' own points; drawn as far each way as the
// larger plane is wide.
export function planesMeet(a, b) {
  const c = cross(a.normal, b.normal);
  const s = norm(c);
  if (s < 1e-9) return noLine('parallel');
  const u = scale(c, 1 / s);
  // The point on both planes and on the plane through the middle square to the line.
  const m = midpoint(a.point, b.point);
  const rows = [a.normal, b.normal, u];
  const rhs = [a.d, b.d, dot(u, m)];
  const det = dot(rows[0], cross(rows[1], rows[2]));
  const x = add(add(scale(cross(rows[1], rows[2]), rhs[0]), scale(cross(rows[2], rows[0]), rhs[1])), scale(cross(rows[0], rows[1]), rhs[2]));
  const point = scale(x, 1 / det);
  const half = Math.max(a.size, b.size);
  return { point, direction: u, ends: [sub(point, scale(u, half)), add(point, scale(u, half))], length: 2 * half, error: null };
}

// The point where a line meets a plane.
export function lineMeetsPlane(line, plane) {
  const along = dot(plane.normal, line.direction);
  if (Math.abs(along) < 1e-9) return { position: null, error: 'parallel' };
  const t = (plane.d - dot(plane.normal, line.point)) / along;
  return { position: add(line.point, scale(line.direction, t)), error: null };
}
