import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { solve, fitSphere, fitSphereToTriangles, coverage, capAngle, cornersOf } from '../../js/fit.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≉ ${b} (±${tol})`);
const nearVec = (a, b, tol, msg) => a.forEach((v, i) => near(v, b[i], tol, `${msg ?? ''}[${i}]`));

// A seeded random generator, so noisy tests give the same numbers every time.
function rng(seed = 1) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const gauss = (rand) => Math.sqrt(-2 * Math.log(rand() || 1e-12)) * Math.cos(2 * Math.PI * rand());

// Triangles (9 numbers each) of a sphere mesh, keeping those within `maxAngle`
// degrees of the +Z pole.
function sphereTris(centre, radius, { maxAngle = 180, segments = 96 } = {}) {
  const g = new THREE.SphereGeometry(radius, segments, segments / 2).toNonIndexed();
  const p = g.attributes.position.array;
  const out = [];
  for (let o = 0; o < p.length; o += 9) {
    const cy = (p[o + 1] + p[o + 4] + p[o + 7]) / 3; // three.js spheres have their poles on Y
    const cx = (p[o] + p[o + 3] + p[o + 6]) / 3;
    const cz = (p[o + 2] + p[o + 5] + p[o + 8]) / 3;
    const angle = (Math.acos(cy / Math.hypot(cx, cy, cz)) * 180) / Math.PI;
    if (angle > maxAngle) continue;
    for (let k = 0; k < 3; k++) out.push(p[o + 3 * k] + centre[0], p[o + 3 * k + 1] + centre[1], p[o + 3 * k + 2] + centre[2]);
  }
  return new Float64Array(out);
}

describe('solving small linear systems', () => {
  test('a 3 × 3 system, rows in an awkward order', () => {
    const x = solve([[0, 2, 1], [1, 1, 1], [2, 1, 0]], [5, 4, 4]);
    nearVec(x, [1, 2, 1], 1e-12);
  });
  test('a singular system gives null', () => {
    assert.equal(solve([[1, 2], [2, 4]], [3, 6]), null);
    assert.equal(solve([[0, 0], [0, 0]], [0, 0]), null);
  });
});

describe('fitting a sphere to points', () => {
  // Points on a sphere, spread round it (or over a cap of it).
  function onSphere(centre, radius, n, { capDeg = 180, noise = 0, seed = 3 } = {}) {
    const rand = rng(seed);
    const pts = new Float64Array(3 * n);
    const cmin = Math.cos((capDeg * Math.PI) / 180);
    for (let i = 0; i < n; i++) {
      const z = cmin + (1 - cmin) * rand();
      const t = 2 * Math.PI * rand();
      const s = Math.sqrt(1 - z * z);
      const r = radius + noise * gauss(rand);
      pts.set([centre[0] + r * s * Math.cos(t), centre[1] + r * s * Math.sin(t), centre[2] + r * z], 3 * i);
    }
    return pts;
  }
  const ones = (n) => new Float64Array(n).fill(1);

  test('points exactly on a sphere give it back', () => {
    const s = fitSphere(onSphere([1, -2, 3], 5, 200), ones(200));
    assert.equal(s.error, null);
    nearVec(s.centre, [1, -2, 3], 1e-9);
    near(s.radius, 5, 1e-9);
    near(s.rms, 0, 1e-9);
  });

  test('a shallow cap (20° from its pole) still gives the sphere back', () => {
    const s = fitSphere(onSphere([0, 0, 0], 12, 300, { capDeg: 20 }), ones(300));
    nearVec(s.centre, [0, 0, 0], 1e-7);
    near(s.radius, 12, 1e-7);
  });

  test('far from the origin, as scans often are, nothing is lost', () => {
    const s = fitSphere(onSphere([1200.5, -3400.25, 870], 11.5, 300, { capDeg: 60 }), ones(300));
    nearVec(s.centre, [1200.5, -3400.25, 870], 1e-6);
    near(s.radius, 11.5, 1e-6);
  });

  test('with noise, the deviations report it, and the fit stays close', () => {
    const s = fitSphere(onSphere([0, 0, 0], 20, 4000, { capDeg: 70, noise: 0.05 }), ones(4000));
    near(s.radius, 20, 0.05);
    nearVec(s.centre, [0, 0, 0], 0.05);
    near(s.rms, 0.05, 0.005, 'the RMS deviation is the noise');
    assert.ok(s.maxDeviation > 2.5 * s.rms && s.maxDeviation < 6 * s.rms);
  });

  test('on a noisy shallow cap the geometric fit beats the algebraic one, which shrinks the sphere', () => {
    // A shallow cap with noise: the algebraic (Kåsa) radius comes out too small.
    const pts = onSphere([0, 0, 0], 20, 4000, { capDeg: 25, noise: 0.15, seed: 7 });
    const s = fitSphere(pts, ones(4000));
    const kasa = fitSphere(pts, ones(4000), { maxIterations: 0 });
    assert.ok(Math.abs(s.radius - 20) < Math.abs(kasa.radius - 20), `geometric ${s.radius}, algebraic ${kasa.radius}`);
    assert.ok(kasa.radius < 20);
  });

  test('points without weight are left out', () => {
    const good = onSphere([0, 0, 0], 4, 100);
    const pts = new Float64Array(3 * 110);
    pts.set(good);
    for (let i = 100; i < 110; i++) pts.set([50, 50, 50 + i], 3 * i); // far off, weight 0
    const w = ones(110);
    w.fill(0, 100);
    const s = fitSphere(pts, w);
    near(s.radius, 4, 1e-9);
    assert.ok(s.maxDeviation < 1e-9, 'the unweighted points do not count as deviations');
  });

  test('a flat patch or too few points give no sphere, with the reason', () => {
    const rand = rng(5);
    const flat = new Float64Array(300);
    for (let i = 0; i < 100; i++) flat.set([rand() * 10, rand() * 10, 0], 3 * i);
    assert.equal(fitSphere(flat, ones(100)).error, 'flat');
    // Nearly flat: a cap of a sphere far bigger than the patch.
    assert.equal(fitSphere(onSphere([0, 0, -5000], 5000, 200, { capDeg: 0.1 }), ones(200)).error, 'flat');
    assert.equal(fitSphere(onSphere([0, 0, 0], 1, 3), ones(3)).error, 'few');
    assert.equal(fitSphere(new Float64Array(15).fill(2), ones(5)).error, 'few', 'five times the same point');
  });
});

describe('fitting a sphere to triangles', () => {
  test('corners are weighted by area: a patch meshed finely on one side counts by area, not by triangles', () => {
    const { weights, area, mean } = cornersOf(new Float64Array([0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0]));
    near(area, 2.5, 1e-12);
    nearVec([...weights], [2 / 3, 2 / 3, 2 / 3, 1 / 6, 1 / 6, 1 / 6], 1e-12);
    nearVec(mean, [(2 / 3) * 2 / 2.5 + (1 / 6) / 2.5, (2 / 3) * 2 / 2.5 + (1 / 6) / 2.5, 0], 1e-12);
  });

  test('a meshed cap: centre, radius, deviations, coverage, triangles and area', () => {
    const tris = sphereTris([10, 20, 30], 12, { maxAngle: 40 });
    const r = fitSphereToTriangles(tris);
    assert.equal(r.error, null);
    nearVec(r.centre, [10, 20, 30], 1e-5);
    near(r.radius, 12, 1e-5);
    assert.ok(r.maxDeviation < 1e-5, 'the corners are on the sphere');
    assert.equal(r.faceCount, tris.length / 9);
    // The cap is cut along the mesh's rows, so compare with the cap its triangles reach.
    near(r.coverage, (1 - Math.cos((40 * Math.PI) / 180)) / 2, 0.01);
    near(r.area, 4 * Math.PI * 144 * r.coverage, 0.01 * r.area, 'flat triangles have about the area of the sphere they cover');
  });

  test('coverage: a whole sphere is 1, a half is 0.5, and the cap angle follows', () => {
    near(coverage(sphereTris([0, 0, 0], 3), [0, 0, 0]), 1, 1e-6);
    near(coverage(sphereTris([0, 0, 0], 3, { maxAngle: 90 }), [0, 0, 0]), 0.5, 1e-6);
    near(capAngle(0.5), 90, 1e-9);
    near(capAngle(1), 180, 1e-9);
    near(capAngle((1 - Math.cos(Math.PI / 6)) / 2), 30, 1e-9);
  });

  test('a flat patch gives no sphere', () => {
    const g = new THREE.PlaneGeometry(10, 10, 4, 4).toNonIndexed();
    const r = fitSphereToTriangles(new Float64Array(g.attributes.position.array));
    assert.equal(r.error, 'flat');
    assert.equal(r.centre, null);
    near(r.area, 100, 1e-9);
  });

  test('speed: a region of a million triangles', () => {
    const tris = sphereTris([0, 0, 0], 20, { segments: 1440, maxAngle: 180 });
    assert.ok(tris.length / 9 > 1e6);
    const t = performance.now();
    const r = fitSphereToTriangles(tris);
    const ms = performance.now() - t;
    near(r.radius, 20, 1e-4);
    assert.ok(ms < 5000, `${Math.round(ms)} ms`);
  });
});

// ---- Planes and cylinders ---------------------------------------------------

import { eigenSym3, fitPlane, fitPlaneToTriangles, fitPlaneToPath, fitCylinder, fitCylinderToTriangles } from '../../js/fit.js';

const ones = (n) => new Float64Array(n).fill(1);
const unitv = (v) => v.map((x) => x / Math.hypot(...v));
const dotv = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// Same direction, or opposite.
const parallel = (a, b, tol, msg) => near(Math.abs(dotv(unitv(a), unitv(b))), 1, tol, msg);
// Distance of point p from the line through `point` along `dir`.
const toLine = (p, point, dir) => {
  const u = unitv(dir);
  const d = p.map((v, i) => v - point[i]);
  const along = dotv(d, u);
  return Math.hypot(...d.map((v, i) => v - along * u[i]));
};

describe('eigenvalues of a symmetric 3 × 3 matrix', () => {
  test('values in rising order, vectors that satisfy M v = λ v', () => {
    const M = [[4, 1, 2], [1, 3, 0.5], [2, 0.5, 6]];
    const { values, vectors } = eigenSym3(M);
    assert.ok(values[0] <= values[1] && values[1] <= values[2]);
    for (let k = 0; k < 3; k++) {
      const Mv = M.map((row) => dotv(row, vectors[k]));
      nearVec(Mv, vectors[k].map((x) => x * values[k]), 1e-10);
    }
    near(values[0] + values[1] + values[2], 13, 1e-10, 'the trace');
  });
  test('an already diagonal matrix', () => {
    const { values, vectors } = eigenSym3([[3, 0, 0], [0, 1, 0], [0, 0, 2]]);
    nearVec(values, [1, 2, 3], 1e-12);
    parallel(vectors[0], [0, 1, 0], 1e-12);
  });
});

describe('fitting a plane', () => {
  // Points on the plane through `point` with normal `normal`, with optional noise.
  function onPlane(point, normal, n, { noise = 0, size = 10, seed = 2 } = {}) {
    const rand = rng(seed);
    const u = unitv(normal);
    const a = unitv(Math.abs(u[0]) < 0.9 ? [0, -u[2], u[1]] : [-u[1], u[0], 0]);
    const b = [u[1] * a[2] - u[2] * a[1], u[2] * a[0] - u[0] * a[2], u[0] * a[1] - u[1] * a[0]];
    const pts = new Float64Array(3 * n);
    for (let i = 0; i < n; i++) {
      const s = (rand() - 0.5) * 2 * size;
      const t = (rand() - 0.5) * 2 * size;
      const e = noise * gauss(rand);
      pts.set([0, 1, 2].map((j) => point[j] + s * a[j] + t * b[j] + e * u[j]), 3 * i);
    }
    return pts;
  }

  test('points on a tilted plane far from the origin give it back', () => {
    const r = fitPlane(onPlane([500, -230, 1200], [1, 2, -0.5], 300), ones(300));
    assert.equal(r.error, null);
    parallel(r.normal, [1, 2, -0.5], 1e-10);
    near(dotv(r.normal, r.point), dotv(r.normal, [500, -230, 1200]), 1e-8, 'the mean is on the plane');
    near(r.rms, 0, 1e-9);
    assert.ok(r.size > 9 && r.size < 15);
  });

  test('with noise: the RMS deviation is the noise', () => {
    const r = fitPlane(onPlane([0, 0, 0], [0, 0, 1], 5000, { noise: 0.1 }), ones(5000));
    parallel(r.normal, [0, 0, 1], 1e-3);
    near(r.rms, 0.1, 0.01);
  });

  test('points on a line, or too few, give no plane', () => {
    const line = new Float64Array(30);
    for (let i = 0; i < 10; i++) line.set([i, 2 * i, -i], 3 * i);
    assert.equal(fitPlane(line, ones(10)).error, 'line');
    assert.equal(fitPlane(new Float64Array([0, 0, 0, 1, 0, 0]), ones(2)).error, 'few');
  });

  test('to triangles: the normal faces the way the triangles do; d puts the plane where it is', () => {
    const g = new THREE.PlaneGeometry(10, 6, 5, 3).toNonIndexed(); // faces +Z
    g.translate(3, 4, 7);
    const r = fitPlaneToTriangles(new Float64Array(g.attributes.position.array));
    nearVec(r.normal, [0, 0, 1], 1e-9);
    near(r.d, 7, 1e-9);
    nearVec(r.point, [3, 4, 7], 1e-9);
    near(r.area, 60, 1e-9);
    assert.equal(r.faceCount, 30);
    g.rotateX(Math.PI); // now faces −Z
    const flipped = fitPlaneToTriangles(new Float64Array(g.attributes.position.array));
    nearVec(flipped.normal, [0, 0, -1], 1e-9);
  });

  test('to the path of a curve: a loop\'s normal follows its direction; an open curve\'s is settled by sign', () => {
    const circle = (dir) => Array.from({ length: 41 }, (_, k) => {
      const t = (dir * 2 * Math.PI * k) / 40;
      return [5 + 3 * Math.cos(t), 2 + 3 * Math.sin(t), -4];
    });
    const ccw = fitPlaneToPath(circle(1), true);
    nearVec(ccw.normal, [0, 0, 1], 1e-9);
    near(ccw.d, -4, 1e-9);
    nearVec(ccw.point, [5, 2, -4], 1e-6, 'the centre of the loop');
    near(ccw.pathLength, 2 * Math.PI * 3, 0.02);
    nearVec(fitPlaneToPath(circle(-1), true).normal, [0, 0, -1], 1e-9);
    nearVec(fitPlaneToPath(circle(-1).slice(0, 20), false).normal, [0, 0, 1], 1e-9);
    assert.equal(fitPlaneToPath([[0, 0, 0], [1, 1, 1], [2, 2, 2]], false).error, 'line');
  });

  test('points crowded on one stretch of a path don\'t pull the plane: stretches count by length', () => {
    // A square loop in z = 0 with one side cut into many short pieces, and the opposite side lifted.
    const side = Array.from({ length: 50 }, (_, k) => [k / 50, 0, 0]);
    const a = fitPlaneToPath([...side, [1, 0, 0], [1, 1, 0.2], [0, 1, 0.2], [0, 0, 0]], true);
    const b = fitPlaneToPath([[0, 0, 0], [1, 0, 0], [1, 1, 0.2], [0, 1, 0.2], [0, 0, 0]], true);
    nearVec(a.normal, b.normal, 1e-9);
  });
});

describe('fitting a cylinder', () => {
  // Points on a cylinder (axis through `point` along `dir`, radius r), over `arc` degrees and `len` along.
  function onCylinder(point, dir, radius, n, { arc = 360, len = 20, noise = 0, seed = 4 } = {}) {
    const rand = rng(seed);
    const u = unitv(dir);
    const a = unitv(Math.abs(u[0]) < 0.9 ? [0, -u[2], u[1]] : [-u[1], u[0], 0]);
    const b = [u[1] * a[2] - u[2] * a[1], u[2] * a[0] - u[0] * a[2], u[0] * a[1] - u[1] * a[0]];
    const pts = new Float64Array(3 * n);
    for (let i = 0; i < n; i++) {
      const t = ((rand() - 0.5) * arc * Math.PI) / 180;
      const h = (rand() - 0.5) * len;
      const rr = radius + noise * gauss(rand);
      pts.set([0, 1, 2].map((j) => point[j] + h * u[j] + rr * (Math.cos(t) * a[j] + Math.sin(t) * b[j])), 3 * i);
    }
    return pts;
  }

  test('a whole cylinder, starting from a rough axis, gives itself back', () => {
    const r = fitCylinder(onCylinder([1, 2, 3], [0.2, 1, 0.1], 7, 500), ones(500), [0.4, 1, -0.1]);
    assert.equal(r.error, null);
    parallel(r.direction, [0.2, 1, 0.1], 1e-9);
    near(r.radius, 7, 1e-9);
    near(toLine([1, 2, 3], r.point, r.direction), 0, 1e-8, 'the axis goes through the true axis');
    near(r.rms, 0, 1e-9);
    assert.equal(r.arc, 360);
  });

  test('a strip of 90° far from the origin, as on a condyle', () => {
    const r = fitCylinder(onCylinder([800, -1500, 300], [1, 0, 0], 11, 600, { arc: 90, len: 15 }), ones(600), [1, 0.15, 0.1]);
    parallel(r.direction, [1, 0, 0], 1e-8);
    near(r.radius, 11, 1e-7);
    near(toLine([800, -1500, 300], r.point, r.direction), 0, 1e-6);
    assert.ok(r.arc >= 85 && r.arc <= 100, `arc ${r.arc}`);
    near(Math.hypot(...r.ends[1].map((v, j) => v - r.ends[0][j])), 15, 0.5, 'the length the points cover');
  });

  test('with noise, the RMS deviation is the noise', () => {
    const r = fitCylinder(onCylinder([0, 0, 0], [0, 0, 1], 10, 5000, { noise: 0.05, arc: 180 }), ones(5000), [0.05, 0, 1]);
    near(r.radius, 10, 0.02);
    parallel(r.direction, [0, 0, 1], 1e-3);
    near(r.rms, 0.05, 0.005);
  });

  test('too few points, or a flat patch, give no cylinder', () => {
    assert.equal(fitCylinder(new Float64Array(12), ones(4), [0, 0, 1]).error, 'few');
    const rand = rng(9);
    const flat = new Float64Array(600);
    for (let i = 0; i < 200; i++) flat.set([rand() * 10, rand() * 10, 0], 3 * i);
    assert.equal(fitCylinder(flat, ones(200), [1, 0, 0]).error, 'flat');
  });

  test('to triangles: the axis is found from the normals alone, with its ends and the arc', () => {
    const g = new THREE.CylinderGeometry(6, 6, 30, 64, 30, true, 0, Math.PI).toNonIndexed(); // half a tube along Y
    g.rotateZ(0.3);
    g.translate(40, -10, 25);
    const r = fitCylinderToTriangles(new Float64Array(g.attributes.position.array));
    assert.equal(r.error, null);
    const axis = [-Math.sin(0.3), Math.cos(0.3), 0];
    parallel(r.direction, axis, 1e-6);
    assert.ok(Math.abs(r.direction[1]) >= Math.abs(r.direction[0]) && r.direction[1] > 0, 'the largest component is positive');
    near(r.radius, 6, 1e-4);
    near(toLine([40, -10, 25], r.point, r.direction), 0, 1e-4);
    near(r.length, 30, 1e-3);
    assert.ok(r.arc >= 180 && r.arc <= 190, `arc ${r.arc}`); // counted in 5° steps, so up to two steps over
    assert.ok(r.spread < 0.01, `spread ${r.spread}`);
  });

  test('on a piece of a sphere the normals spread every way, and spread says so', () => {
    const r = fitCylinderToTriangles(sphereTris([0, 0, 0], 10, { maxAngle: 40 }));
    assert.ok(r.spread > 0.5, `spread ${r.spread}`);
  });
});
