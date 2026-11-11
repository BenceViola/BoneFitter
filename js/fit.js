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
