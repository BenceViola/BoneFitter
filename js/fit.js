// Fitting primitives to a patch of surface. Pure maths, no three.js.
//
// The data are the triangles of a region. Their corners are the measured
// points (a scanner puts vertices on the surface; the flat triangles
// between them cut a little inside a curved surface), so the fit uses the
// corners, each weighted by a third of the area of the triangle it belongs
// to. That way a patch that was meshed finely in one place and coarsely in
// another counts by its area, not by how many triangles it has.
//
// Sphere: "best fit" means the smallest sum of squared distances from the
// surface to the sphere (a geometric fit). It is found in two steps:
//   1. an algebraic fit (Kåsa), which needs no starting guess but leans
//      towards too small a sphere on shallow, noisy patches;
//   2. from there, the geometric fit (Levenberg–Marquardt on the distances).
//
// Coverage says how much of the sphere the patch covers: the solid angle
// the patch fills, seen from the centre, as a share of the whole sphere.
// A shallow patch (a small share) fixes the radius poorly.
//
// Plane: the least-squares plane (smallest sum of squared distances), whose
// normal is the direction in which the points spread least (the eigenvector
// of their covariance with the smallest eigenvalue). It can be fitted to a
// patch of surface or to the path of a curve (a rim, a margin).
//
// Cylinder: like the sphere, a geometric fit of the distances to the
// surface. The starting axis comes from the surface normals: on a cylinder
// every normal is square to the axis, so the axis is the direction the
// normals spread least in. Then the circle across that axis is fitted, and
// all five numbers (axis position and direction, radius) are refined
// together by Levenberg–Marquardt.

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const round = (n) => Math.round(n * 1e6) / 1e6;

// A sphere this many times wider than the patch means the patch is flat.
const FLAT = 200;

/**
 * Solve the n × n system A x = b (A as an array of rows) by Gaussian
 * elimination with partial pivoting. Returns null when A is (nearly) singular.
 */
export function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  let scale = 0;
  for (const row of A) for (const v of row) scale = Math.max(scale, Math.abs(v));
  if (!(scale > 0)) return null;
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > Math.abs(M[p][k])) p = i;
    if (Math.abs(M[p][k]) <= scale * 1e-13) return null;
    [M[k], M[p]] = [M[p], M[k]];
    for (let i = k + 1; i < n; i++) {
      const f = M[i][k] / M[k][k];
      for (let j = k; j <= n; j++) M[i][j] -= f * M[k][j];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

/**
 * Corners and weights from triangles. `tris` is a flat array, 9 numbers per
 * triangle. Returns { points (3 numbers per corner), weights, area, mean, extent }:
 * `mean` is the weighted mean point, `extent` the largest distance of a
 * corner from it.
 */
export function cornersOf(tris) {
  const m = tris.length / 9;
  const points = new Float64Array(9 * m);
  const weights = new Float64Array(3 * m);
  let area = 0;
  const mean = [0, 0, 0];
  for (let t = 0; t < m; t++) {
    const o = 9 * t;
    const ux = tris[o + 3] - tris[o], uy = tris[o + 4] - tris[o + 1], uz = tris[o + 5] - tris[o + 2];
    const vx = tris[o + 6] - tris[o], vy = tris[o + 7] - tris[o + 1], vz = tris[o + 8] - tris[o + 2];
    const a = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    area += a;
    for (let k = 0; k < 9; k++) points[o + k] = tris[o + k];
    for (let k = 0; k < 3; k++) {
      weights[3 * t + k] = a / 3;
      for (let j = 0; j < 3; j++) mean[j] += (a / 3) * tris[o + 3 * k + j];
    }
  }
  if (area > 0) for (let j = 0; j < 3; j++) mean[j] /= area;
  let extent = 0;
  for (let i = 0; i < 3 * m; i++) {
    extent = Math.max(extent, Math.hypot(points[3 * i] - mean[0], points[3 * i + 1] - mean[1], points[3 * i + 2] - mean[2]));
  }
  return { points, weights, area, mean, extent };
}

/**
 * Fit a sphere to weighted points (`points`: 3 numbers per point). Returns
 * { centre, radius, rms, maxDeviation, iterations, error }: `rms` and
 * `maxDeviation` are the weighted root-mean-square and the largest distance
 * of a point from the sphere; `error` is null, or
 *   'few'   fewer than four points with weight (or all in one place)
 *   'flat'  the points lie (nearly) in a plane: no sphere fits them well
 */
export function fitSphere(points, weights, { maxIterations = 100 } = {}) {
  const n = weights.length;
  const fail = (error) => ({ centre: null, radius: 0, rms: 0, maxDeviation: 0, iterations: 0, error });
  let W = 0;
  let used = 0;
  const mean = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    if (!(weights[i] > 0)) continue;
    W += weights[i];
    used++;
    for (let j = 0; j < 3; j++) mean[j] += weights[i] * points[3 * i + j];
  }
  if (used < 4 || !(W > 0)) return fail('few');
  for (let j = 0; j < 3; j++) mean[j] /= W;
  // Work relative to the mean, scaled to about 1, so far-off coordinates lose no precision.
  let extent = 0;
  for (let i = 0; i < n; i++) {
    if (weights[i] > 0) extent = Math.max(extent, Math.hypot(points[3 * i] - mean[0], points[3 * i + 1] - mean[1], points[3 * i + 2] - mean[2]));
  }
  if (!(extent > 0)) return fail('few');
  const q = new Float64Array(3 * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < 3; j++) q[3 * i + j] = (points[3 * i + j] - mean[j]) / extent;

  // 1. Algebraic fit: |q|² = 2 c·q + d, linear in (c, d); r² = d + |c|².
  const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  const b = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const w = weights[i];
    if (!(w > 0)) continue;
    const row = [2 * q[3 * i], 2 * q[3 * i + 1], 2 * q[3 * i + 2], 1];
    const rhs = q[3 * i] ** 2 + q[3 * i + 1] ** 2 + q[3 * i + 2] ** 2;
    for (let r = 0; r < 4; r++) {
      b[r] += w * row[r] * rhs;
      for (let c = 0; c < 4; c++) A[r][c] += w * row[r] * row[c];
    }
  }
  const alg = solve(A, b);
  if (!alg) return fail('flat');
  let c = [alg[0], alg[1], alg[2]];
  const r2 = alg[3] + dot(c, c);
  if (!(r2 > 0) || Math.sqrt(r2) > FLAT) return fail('flat');
  let r = Math.sqrt(r2);

  // 2. Geometric fit: minimise Σ w (|q − c| − r)².
  const cost = (cc, rr) => {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const w = weights[i];
      if (!(w > 0)) continue;
      const e = Math.hypot(q[3 * i] - cc[0], q[3 * i + 1] - cc[1], q[3 * i + 2] - cc[2]) - rr;
      s += w * e * e;
    }
    return s;
  };
  let current = cost(c, r);
  let lambda = 1e-4;
  let iterations = 0;
  for (; iterations < maxIterations; iterations++) {
    const JtJ = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    const Jte = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      const w = weights[i];
      if (!(w > 0)) continue;
      const dx = q[3 * i] - c[0], dy = q[3 * i + 1] - c[1], dz = q[3 * i + 2] - c[2];
      const d = Math.hypot(dx, dy, dz) || 1e-12;
      const J = [-dx / d, -dy / d, -dz / d, -1];
      const e = d - r;
      for (let a = 0; a < 4; a++) {
        Jte[a] += w * J[a] * e;
        for (let k = 0; k < 4; k++) JtJ[a][k] += w * J[a] * J[k];
      }
    }
    let step = null;
    let next = current;
    // Damped steps, made smaller until one lowers the sum of squares.
    for (let tries = 0; tries < 12; tries++) {
      const M = JtJ.map((row, a) => row.map((v, k) => (a === k ? v * (1 + lambda) : v)));
      const delta = solve(M, Jte.map((v) => -v));
      if (!delta) {
        lambda *= 10;
        continue;
      }
      const cc = [c[0] + delta[0], c[1] + delta[1], c[2] + delta[2]];
      const rr = r + delta[3];
      const k = cost(cc, rr);
      if (k <= current) {
        step = { cc, rr, size: Math.hypot(...delta) };
        next = k;
        lambda = Math.max(lambda / 10, 1e-12);
        break;
      }
      lambda *= 10;
    }
    if (!step) break;
    const gain = current - next;
    c = step.cc;
    r = step.rr;
    current = next;
    if (step.size < 1e-12 || gain <= current * 1e-15) break;
  }
  if (!(r > 0) || r > FLAT) return fail('flat');

  let sq = 0;
  let maxDeviation = 0;
  for (let i = 0; i < n; i++) {
    const w = weights[i];
    if (!(w > 0)) continue;
    const e = Math.abs(Math.hypot(q[3 * i] - c[0], q[3 * i + 1] - c[1], q[3 * i + 2] - c[2]) - r);
    sq += w * e * e;
    maxDeviation = Math.max(maxDeviation, e);
  }
  return {
    centre: c.map((v, j) => v * extent + mean[j]),
    radius: r * extent,
    rms: Math.sqrt(sq / W) * extent,
    maxDeviation: maxDeviation * extent,
    iterations,
    error: null,
  };
}

/**
 * The share of a sphere (0 to 1) that triangles cover, seen from its centre:
 * the solid angle they fill over 4π (Van Oosterom & Strackee). Folds or
 * overlaps would count twice, so the result is capped at 1.
 */
export function coverage(tris, centre) {
  let omega = 0;
  const a = [0, 0, 0];
  const b = [0, 0, 0];
  const c = [0, 0, 0];
  for (let o = 0; o < tris.length; o += 9) {
    for (let j = 0; j < 3; j++) {
      a[j] = tris[o + j] - centre[j];
      b[j] = tris[o + 3 + j] - centre[j];
      c[j] = tris[o + 6 + j] - centre[j];
    }
    const la = Math.hypot(...a);
    const lb = Math.hypot(...b);
    const lc = Math.hypot(...c);
    const triple = a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
    const den = la * lb * lc + dot(a, b) * lc + dot(a, c) * lb + dot(b, c) * la;
    omega += Math.abs(2 * Math.atan2(triple, den));
  }
  return Math.min(1, omega / (4 * Math.PI));
}

// The half-angle (degrees) of the cap of a sphere that has this coverage.
export const capAngle = (share) => (Math.acos(1 - 2 * Math.min(1, Math.max(0, share))) * 180) / Math.PI;

/**
 * Fit a sphere to triangles (9 numbers each). Returns the fields a fitted
 * sphere stores: { centre, radius, rms, maxDeviation, coverage, faceCount,
 * area, error }, numbers rounded to 6 decimal places.
 */
export function fitSphereToTriangles(tris) {
  const faceCount = tris.length / 9;
  const { points, weights, area } = cornersOf(tris);
  const s = fitSphere(points, weights);
  if (s.error) return { centre: null, radius: 0, rms: 0, maxDeviation: 0, coverage: 0, faceCount, area: round(area), error: s.error };
  return {
    centre: s.centre.map(round),
    radius: round(s.radius),
    rms: round(s.rms),
    maxDeviation: round(s.maxDeviation),
    coverage: round(coverage(tris, s.centre)),
    faceCount,
    area: round(area),
    error: null,
  };
}

// ---- Shared helpers ---------------------------------------------------------

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 0 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 0];
};

// Two unit vectors square to `u` and to each other (u, e1, e2 right-handed).
function basis(u) {
  const a = Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = unit(a.map((v, i) => v - dot(a, u) * u[i]));
  return [e1, cross(u, e1)];
}

/**
 * Eigenvalues and eigenvectors of a symmetric 3 × 3 matrix (Jacobi
 * rotations). Returns { values, vectors }, smallest value first; vectors[k]
 * belongs to values[k] and has unit length.
 */
export function eigenSym3(M) {
  const a = M.map((row) => row.slice());
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    if (off < 1e-300) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const sn = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p];
        const akq = a[k][q];
        a[k][p] = c * akp - sn * akq;
        a[k][q] = sn * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k];
        const aqk = a[q][k];
        a[p][k] = c * apk - sn * aqk;
        a[q][k] = sn * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k][p];
        const vkq = v[k][q];
        v[k][p] = c * vkp - sn * vkq;
        v[k][q] = sn * vkp + c * vkq;
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[i][i] - a[j][j]);
  return { values: order.map((i) => a[i][i]), vectors: order.map((i) => unit([v[0][i], v[1][i], v[2][i]])) };
}

// Weighted points relative to their mean, scaled to about 1 (so far-off
// coordinates lose no precision). Null when fewer than `need` points have weight.
function centred(points, weights, need) {
  const n = weights.length;
  let W = 0;
  let used = 0;
  const mean = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    if (!(weights[i] > 0)) continue;
    W += weights[i];
    used++;
    for (let j = 0; j < 3; j++) mean[j] += weights[i] * points[3 * i + j];
  }
  if (used < need || !(W > 0)) return null;
  for (let j = 0; j < 3; j++) mean[j] /= W;
  let extent = 0;
  for (let i = 0; i < n; i++) {
    if (weights[i] > 0) extent = Math.max(extent, Math.hypot(points[3 * i] - mean[0], points[3 * i + 1] - mean[1], points[3 * i + 2] - mean[2]));
  }
  if (!(extent > 0)) return null;
  const q = new Float64Array(3 * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < 3; j++) q[3 * i + j] = (points[3 * i + j] - mean[j]) / extent;
  return { n, q, W, mean, extent };
}

// The sum of the triangles' normals, each as long as twice its triangle's area.
function areaNormal(tris) {
  const s = [0, 0, 0];
  for (let o = 0; o < tris.length; o += 9) {
    const u = [tris[o + 3] - tris[o], tris[o + 4] - tris[o + 1], tris[o + 5] - tris[o + 2]];
    const v = [tris[o + 6] - tris[o], tris[o + 7] - tris[o + 1], tris[o + 8] - tris[o + 2]];
    const c = cross(u, v);
    for (let j = 0; j < 3; j++) s[j] += c[j];
  }
  return s;
}

// A direction's sign when nothing else decides it: its largest component positive.
const byLargest = (u) => {
  let k = 0;
  for (let j = 1; j < 3; j++) if (Math.abs(u[j]) > Math.abs(u[k])) k = j;
  return u[k] < 0 ? u.map((v) => -v) : u;
};

// ---- Plane ------------------------------------------------------------------

/**
 * Fit a plane to weighted points. Returns { point, normal, rms,
 * maxDeviation, size, error }: `point` is the weighted mean (it lies on the
 * plane), `normal` a unit vector (its sign is left to the caller), `size`
 * the largest distance of a point from `point` within the plane; `error`
 * is null, 'few' (fewer than three points) or 'line' (all on one line).
 */
export function fitPlane(points, weights) {
  const c = centred(points, weights, 3);
  if (!c) return { point: null, normal: null, rms: 0, maxDeviation: 0, size: 0, error: 'few' };
  const { n, q, W, mean, extent } = c;
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < n; i++) {
    const w = weights[i];
    if (!(w > 0)) continue;
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a][b] += w * q[3 * i + a] * q[3 * i + b];
  }
  const { values, vectors } = eigenSym3(C.map((row) => row.map((v) => v / W)));
  if (!(values[1] > 1e-12 * values[2])) return { point: null, normal: null, rms: 0, maxDeviation: 0, size: 0, error: 'line' };
  const normal = vectors[0];
  let sq = 0;
  let maxDeviation = 0;
  let size = 0;
  for (let i = 0; i < n; i++) {
    if (!(weights[i] > 0)) continue;
    const p = [q[3 * i], q[3 * i + 1], q[3 * i + 2]];
    const e = dot(p, normal);
    sq += weights[i] * e * e;
    maxDeviation = Math.max(maxDeviation, Math.abs(e));
    size = Math.max(size, Math.sqrt(Math.max(0, dot(p, p) - e * e)));
  }
  return { point: mean, normal, rms: Math.sqrt(sq / W) * extent, maxDeviation: maxDeviation * extent, size: size * extent, error: null };
}

// What a fitted plane stores, from a fitPlane result with its normal's sign settled.
function planeFields(r, extra) {
  if (r.error) return { point: null, normal: null, d: 0, rms: 0, maxDeviation: 0, size: 0, ...extra, error: r.error };
  return {
    point: r.point.map(round),
    normal: r.normal.map(round),
    d: round(dot(r.normal, r.point)),
    rms: round(r.rms),
    maxDeviation: round(r.maxDeviation),
    size: round(r.size),
    ...extra,
    error: null,
  };
}

/**
 * Fit a plane to triangles (9 numbers each). The normal points the way the
 * triangles face on the whole (out of the bone, for a mesh whose triangles
 * face outwards). Returns { point, normal, d, rms, maxDeviation, size,
 * faceCount, area, error }; the plane is normal · x = d.
 */
export function fitPlaneToTriangles(tris) {
  const { points, weights, area } = cornersOf(tris);
  const r = fitPlane(points, weights);
  if (!r.error && dot(r.normal, areaNormal(tris)) < 0) r.normal = r.normal.map((v) => -v);
  return planeFields(r, { faceCount: tris.length / 9, area: round(area) });
}

/**
 * Fit a plane to the path of a curve (an array of [x, y, z]), each stretch
 * counted by its length. For a closed curve the normal follows the loop's
 * direction (right-hand rule); otherwise its largest component is positive.
 */
export function fitPlaneToPath(line, closed) {
  const n = line.length;
  const points = new Float64Array(3 * n);
  const weights = new Float64Array(n);
  let length = 0;
  line.forEach((p, i) => points.set(p, 3 * i));
  for (let i = 1; i < n; i++) {
    const len = Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1], line[i][2] - line[i - 1][2]);
    length += len;
    weights[i - 1] += len / 2;
    weights[i] += len / 2;
  }
  const r = fitPlane(points, weights);
  if (!r.error) {
    if (closed) {
      const area = [0, 0, 0];
      for (let i = 1; i < n; i++) {
        const a = line[i - 1].map((v, j) => v - r.point[j]);
        const b = line[i].map((v, j) => v - r.point[j]);
        const c = cross(a, b);
        for (let j = 0; j < 3; j++) area[j] += c[j];
      }
      if (dot(area, r.normal) < 0) r.normal = r.normal.map((v) => -v);
    } else {
      r.normal = byLargest(r.normal);
    }
  }
  return planeFields(r, { pathLength: round(length) });
}

// ---- Cylinder ---------------------------------------------------------------

/**
 * Fit a cylinder to weighted points, starting from the axis direction `u0`.
 * Returns { point, direction, radius, rms, maxDeviation, ends, arc,
 * iterations, error }: `point` is the point of the axis nearest the points'
 * mean, `direction` a unit vector along the axis, `ends` the two points of
 * the axis between which the points lie, `arc` how many degrees round the
 * axis they cover (in 5° steps). `error` is null, 'few' or 'flat'.
 */
export function fitCylinder(points, weights, u0, { maxIterations = 100 } = {}) {
  const fail = (error) => ({ point: null, direction: null, radius: 0, rms: 0, maxDeviation: 0, ends: null, arc: 0, iterations: 0, error });
  const c0 = centred(points, weights, 5);
  if (!c0) return fail('few');
  const { n, q, W, mean, extent } = c0;
  let u = unit(u0);
  if (!(Math.hypot(...u) > 0)) return fail('few');

  // The circle across the starting axis (algebraic fit in the plane square to it).
  let [e1, e2] = basis(u);
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const b = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const w = weights[i];
    if (!(w > 0)) continue;
    const p = [q[3 * i], q[3 * i + 1], q[3 * i + 2]];
    const x = dot(p, e1);
    const y = dot(p, e2);
    const row = [2 * x, 2 * y, 1];
    for (let r = 0; r < 3; r++) {
      b[r] += w * row[r] * (x * x + y * y);
      for (let k = 0; k < 3; k++) A[r][k] += w * row[r] * row[k];
    }
  }
  const circle = solve(A, b);
  if (!circle) return fail('flat');
  let c = e1.map((v, j) => circle[0] * v + circle[1] * e2[j]);
  const r2 = circle[2] + circle[0] ** 2 + circle[1] ** 2;
  if (!(r2 > 0) || Math.sqrt(r2) > FLAT) return fail('flat');
  let r = Math.sqrt(r2);

  // Distance of point i from the axis through c along u, and the parts the Jacobian needs.
  const cost = (cc, uu, rr) => {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const w = weights[i];
      if (!(w > 0)) continue;
      const d = [q[3 * i] - cc[0], q[3 * i + 1] - cc[1], q[3 * i + 2] - cc[2]];
      const along = dot(d, uu);
      const e = Math.sqrt(Math.max(0, dot(d, d) - along * along)) - rr;
      s += w * e * e;
    }
    return s;
  };
  let current = cost(c, u, r);
  let lambda = 1e-4;
  let iterations = 0;
  for (; iterations < maxIterations; iterations++) {
    [e1, e2] = basis(u);
    // Parameters: c moves by s e1 + t e2, u tilts by a e1 + b e2, r by dr.
    const JtJ = Array.from({ length: 5 }, () => [0, 0, 0, 0, 0]);
    const Jte = [0, 0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      const w = weights[i];
      if (!(w > 0)) continue;
      const d = [q[3 * i] - c[0], q[3 * i + 1] - c[1], q[3 * i + 2] - c[2]];
      const along = dot(d, u);
      const perp = [d[0] - along * u[0], d[1] - along * u[1], d[2] - along * u[2]];
      const rho = Math.hypot(...perp) || 1e-12;
      const nh = perp.map((v) => v / rho);
      const n1 = dot(nh, e1);
      const n2 = dot(nh, e2);
      const J = [-n1, -n2, -along * n1, -along * n2, -1];
      const e = rho - r;
      for (let a = 0; a < 5; a++) {
        Jte[a] += w * J[a] * e;
        for (let k = 0; k < 5; k++) JtJ[a][k] += w * J[a] * J[k];
      }
    }
    let step = null;
    let next = current;
    for (let tries = 0; tries < 12; tries++) {
      const M = JtJ.map((row, a) => row.map((v, k) => (a === k ? v * (1 + lambda) + 1e-15 : v)));
      const delta = solve(M, Jte.map((v) => -v));
      if (!delta) {
        lambda *= 10;
        continue;
      }
      const cc = c.map((v, j) => v + delta[0] * e1[j] + delta[1] * e2[j]);
      const uu = unit(u.map((v, j) => v + delta[2] * e1[j] + delta[3] * e2[j]));
      const rr = r + delta[4];
      const k = cost(cc, uu, rr);
      if (k <= current) {
        step = { cc, uu, rr, size: Math.hypot(...delta) };
        next = k;
        lambda = Math.max(lambda / 10, 1e-12);
        break;
      }
      lambda *= 10;
    }
    if (!step) break;
    const gain = current - next;
    c = step.cc;
    u = step.uu;
    r = step.rr;
    current = next;
    if (step.size < 1e-12 || gain <= current * 1e-15) break;
  }
  if (!(r > 0) || r > FLAT) return fail('flat');

  // The axis point nearest the mean (the origin here), and what the points cover.
  c = c.map((v, j) => v - dot(c, u) * u[j]);
  [e1, e2] = basis(u);
  let sq = 0;
  let maxDeviation = 0;
  let lo = Infinity;
  let hi = -Infinity;
  const bins = new Uint8Array(72);
  for (let i = 0; i < n; i++) {
    const w = weights[i];
    if (!(w > 0)) continue;
    const d = [q[3 * i] - c[0], q[3 * i + 1] - c[1], q[3 * i + 2] - c[2]];
    const along = dot(d, u);
    const perp = d.map((v, j) => v - along * u[j]);
    const e = Math.abs(Math.hypot(...perp) - r);
    sq += w * e * e;
    maxDeviation = Math.max(maxDeviation, e);
    lo = Math.min(lo, along);
    hi = Math.max(hi, along);
    const angle = Math.atan2(dot(perp, e2), dot(perp, e1));
    bins[Math.min(71, Math.floor(((angle + Math.PI) / (2 * Math.PI)) * 72))] = 1;
  }
  const point = c.map((v, j) => v * extent + mean[j]);
  return {
    point,
    direction: u,
    radius: r * extent,
    rms: Math.sqrt(sq / W) * extent,
    maxDeviation: maxDeviation * extent,
    ends: [point.map((v, j) => v + lo * extent * u[j]), point.map((v, j) => v + hi * extent * u[j])],
    arc: 5 * bins.reduce((s, v) => s + v, 0),
    iterations,
    error: null,
  };
}

/**
 * How many degrees round an axis triangles cover, in 5° steps: each
 * triangle covers the angles from its first corner to its last, the short
 * way round. (Counting corners alone would leave gaps on a coarse mesh.)
 */
export function arcCovered(tris, point, direction) {
  const u = unit(direction);
  const [e1, e2] = basis(u);
  const bins = new Uint8Array(72);
  const angleOf = (o) => {
    const d = [tris[o] - point[0], tris[o + 1] - point[1], tris[o + 2] - point[2]];
    return Math.atan2(dot(d, e2), dot(d, e1));
  };
  const wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
  for (let o = 0; o < tris.length; o += 9) {
    const a0 = angleOf(o);
    const d1 = wrap(angleOf(o + 3) - a0);
    const d2 = wrap(angleOf(o + 6) - a0);
    const lo = a0 + Math.min(0, d1, d2);
    const hi = a0 + Math.max(0, d1, d2);
    const first = Math.floor(((lo + Math.PI) / (2 * Math.PI)) * 72);
    const last = Math.floor(((hi + Math.PI) / (2 * Math.PI)) * 72);
    for (let b = first; b <= last; b++) bins[((b % 72) + 72) % 72] = 1;
  }
  return 5 * bins.reduce((sum, v) => sum + v, 0);
}

/**
 * Fit a cylinder to triangles (9 numbers each). The starting axis is the
 * direction the triangles' normals spread least in. Returns { point,
 * direction, radius, length, ends, rms, maxDeviation, arc, spread,
 * faceCount, area, error }. `spread` (0 to 1) is how much the normals also
 * spread along the axis: near 0 for a cylinder, large for a surface that
 * curves every way (then the axis is poorly fixed). The direction's largest
 * component is positive.
 */
export function fitCylinderToTriangles(tris) {
  const faceCount = tris.length / 9;
  const { points, weights, area } = cornersOf(tris);
  const T = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let o = 0; o < tris.length; o += 9) {
    const nn = cross([tris[o + 3] - tris[o], tris[o + 4] - tris[o + 1], tris[o + 5] - tris[o + 2]], [tris[o + 6] - tris[o], tris[o + 7] - tris[o + 1], tris[o + 8] - tris[o + 2]]);
    const a2 = Math.hypot(...nn);
    if (!(a2 > 0)) continue;
    // Each normal, as a unit vector, counted by its triangle's area.
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) T[i][j] += (nn[i] * nn[j]) / a2;
  }
  const { values, vectors } = eigenSym3(T);
  const empty = { point: null, direction: null, radius: 0, length: 0, ends: null, rms: 0, maxDeviation: 0, arc: 0, spread: 0, faceCount, area: round(area) };
  if (!(values[2] > 0)) return { ...empty, error: 'few' };
  const spread = round(Math.max(0, values[0]) / Math.max(values[1], 1e-300));
  const r = fitCylinder(points, weights, vectors[0]);
  if (r.error) return { ...empty, spread, error: r.error };
  const direction = byLargest(r.direction);
  const arc = arcCovered(tris, r.point, r.direction);
  const ends = dot(direction, r.direction) < 0 ? [r.ends[1], r.ends[0]] : r.ends;
  return {
    point: r.point.map(round),
    direction: direction.map(round),
    radius: round(r.radius),
    length: round(Math.hypot(...ends[1].map((v, j) => v - ends[0][j]))),
    ends: ends.map((e) => e.map(round)),
    rms: round(r.rms),
    maxDeviation: round(r.maxDeviation),
    arc,
    spread,
    faceCount,
    area: round(area),
    error: null,
  };
}
