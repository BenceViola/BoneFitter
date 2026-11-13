import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sectionOf, planeAxes } from '../../js/section.js';

const near = (a, b, tol, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} ≉ ${b} (±${tol})`);
const unit = (v) => v.map((x) => x / Math.hypot(...v));
const plane = (point, normal) => {
  const n = unit(normal);
  return { point, normal: n, d: n.reduce((s, v, i) => s + v * point[i], 0) };
};

// A closed prism along Z: an n-gon of radius r (corners on the circle), from z0 to z1,
// as a triangle soup (like STL), outward faces. `inner`: a second, inward-facing
// prism inside it (a hollow tube) joined by rings at the ends.
function prism(n, r, z0, z1, { inner = null, centre = [0, 0] } = {}) {
  const tris = [];
  const ring = (rad, z) => Array.from({ length: n }, (_, k) => [centre[0] + rad * Math.cos((2 * Math.PI * k) / n), centre[1] + rad * Math.sin((2 * Math.PI * k) / n), z]);
  const a0 = ring(r, z0), a1 = ring(r, z1);
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    tris.push([a0[k], a0[j], a1[j]], [a0[k], a1[j], a1[k]]);
  }
  if (inner) {
    const b0 = ring(inner, z0), b1 = ring(inner, z1);
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      tris.push([b0[k], b1[j], b0[j]], [b0[k], b1[k], b1[j]]);
      // End rings.
      tris.push([a0[k], b0[j], a0[j]], [a0[k], b0[k], b0[j]]);
      tris.push([a1[k], a1[j], b1[j]], [a1[k], b1[j], b1[k]]);
    }
  } else {
    const c0 = [centre[0], centre[1], z0], c1 = [centre[0], centre[1], z1];
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      tris.push([c0, a0[j], a0[k]], [c1, a1[k], a1[j]]);
    }
  }
  return new Float32Array(tris.flat(2));
}
const polygonArea = (n, r) => 0.5 * n * r * r * Math.sin((2 * Math.PI) / n);
// Second moment of area of a regular n-gon about a centroidal axis (any axis, by symmetry, n ≥ 3).
const polygonI = (n, r) => (n * r ** 4 * Math.sin((2 * Math.PI) / n) * (2 + Math.cos((2 * Math.PI) / n))) / 24;

describe('cutting a mesh with a plane', () => {
  test('a solid prism cut across: one closed outline, its area, perimeter and centroid', () => {
    const s = sectionOf(prism(64, 10, 0, 40, { centre: [3, -2] }), null, plane([0, 0, 17], [0, 0, 1]));
    assert.equal(s.error, null);
    assert.equal(s.loops.length, 1);
    const [loop] = s.loops;
    assert.equal(loop.closed, true);
    assert.equal(loop.points.length, 128); // each side is two triangles: the cut crosses the diagonal too
    assert.equal(loop.hole, false);
    near(s.area, polygonArea(64, 10), 1e-3);
    near(s.perimeter, 64 * 2 * 10 * Math.sin(Math.PI / 64), 1e-3);
    near(s.centroid[0], 3, 1e-4);
    near(s.centroid[1], -2, 1e-4);
    near(s.centroid[2], 17, 1e-6);
    for (const p of loop.points) near(p[2], 17, 1e-5, 'on the plane');
  });

  test('a hollow tube: the inner outline is a hole; area, second moments and polar moment as for an annulus', () => {
    const n = 96;
    const s = sectionOf(prism(n, 12, 0, 50, { inner: 7 }), null, plane([0, 0, 25], [0, 0, 1]));
    assert.equal(s.loops.length, 2);
    assert.deepEqual(s.loops.map((l) => l.hole).sort(), [false, true]);
    near(s.area, polygonArea(n, 12) - polygonArea(n, 7), 1e-3);
    // Annulus (as polygons): I about any centroidal axis, J = 2I.
    const I = polygonI(n, 12) - polygonI(n, 7);
    near(s.moments.Iu, I, I * 1e-5);
    near(s.moments.Iv, I, I * 1e-5);
    near(s.moments.Iuv, 0, I * 1e-6);
    near(s.moments.J, 2 * I, I * 2e-5);
    near(s.moments.Imax, I, I * 1e-4);
    near(s.moments.Imin, I, I * 1e-4);
    // The outer outline's perimeter and the inner's are both counted.
    near(s.perimeter, n * 2 * 12 * Math.sin(Math.PI / n) + n * 2 * 7 * Math.sin(Math.PI / n), 1e-3);
  });

  test('a slanted cut gives an ellipse-like outline: larger area, and its long axis along the slant', () => {
    const n = 128;
    const tilt = (30 * Math.PI) / 180;
    const s = sectionOf(prism(n, 10, -30, 30), null, plane([0, 0, 0], [Math.sin(tilt), 0, Math.cos(tilt)]));
    near(s.area, polygonArea(n, 10) / Math.cos(tilt), 1e-2);
    assert.ok(s.moments.Imax > s.moments.Imin * 1.2);
  });

  test('the plane misses the mesh: no outline, and why', () => {
    const s = sectionOf(prism(16, 10, 0, 40), null, plane([0, 0, 50], [0, 0, 1]));
    assert.equal(s.error, 'none');
    assert.deepEqual(s.loops, []);
    assert.equal(s.area, 0);
  });

  test('a plane through vertices exactly (at the end of the prism\'s rings) still closes', () => {
    const s = sectionOf(prism(16, 10, 0, 40), null, plane([0, 0, 40 - 1e-9], [0, 0, 1]));
    assert.equal(s.loops.filter((l) => l.closed).length, 1);
  });

  test('an open mesh (a tube with no ends) cut along its length gives open outlines', () => {
    // Just the side wall of a prism.
    const all = prism(16, 10, 0, 40);
    const wall = all.slice(0, 16 * 2 * 9);
    const s = sectionOf(wall, null, plane([0, 0, 0], [1, 0, 0]));
    assert.equal(s.loops.length, 2);
    assert.ok(s.loops.every((l) => !l.closed));
    assert.equal(s.area, 0, 'no area for an outline that doesn\'t close');
    assert.ok(s.perimeter > 79);
  });

  test('indexed geometry (PLY) gives the same as a triangle soup', () => {
    const soup = prism(32, 10, 0, 40);
    const verts = [];
    const index = [];
    const key = new Map();
    for (let i = 0; i < soup.length / 3; i++) {
      const k = `${soup[3 * i]},${soup[3 * i + 1]},${soup[3 * i + 2]}`;
      if (!key.has(k)) {
        key.set(k, verts.length / 3);
        verts.push(soup[3 * i], soup[3 * i + 1], soup[3 * i + 2]);
      }
      index.push(key.get(k));
    }
    const a = sectionOf(soup, null, plane([0, 0, 10], [0, 0, 1]));
    const b = sectionOf(new Float32Array(verts), new Uint32Array(index), plane([0, 0, 10], [0, 0, 1]));
    near(a.area, b.area, 1e-9);
    assert.equal(b.loops.length, 1);
  });

  test('the plane\'s own axes: u and v across the plane, right-handed with the normal', () => {
    for (const n of [[0, 0, 1], unit([1, 2, 3]), [1, 0, 0], [0, -1, 0]]) {
      const { u, v } = planeAxes(n);
      near(u.reduce((s, x, i) => s + x * n[i], 0), 0, 1e-12);
      near(v.reduce((s, x, i) => s + x * n[i], 0), 0, 1e-12);
      const c = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      c.forEach((x, i) => near(x, n[i], 1e-12, 'u × v = n'));
    }
    // Seen from +Z (normal +Z): u along +X, v along +Y.
    const { u, v } = planeAxes([0, 0, 1]);
    assert.deepEqual([u, v], [[1, 0, 0], [0, 1, 0]]);
  });
});
