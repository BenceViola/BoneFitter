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
