import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { midpoint, lineThrough, fitLineToPath, perpendicularTo, planesMeet, lineMeetsPlane, orderAlong } from '../../js/construct.js';

const near = (a, b, tol = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} ≉ ${b}`);
const nearVec = (a, b, tol = 1e-9, msg = '') => a.forEach((v, i) => near(v, b[i], tol, `${msg}[${i}]`));
const unit = (v) => v.map((x) => x / Math.hypot(...v));
// A plane as fit-engine stores it.
const plane = (point, normal, size = 10) => {
  const n = unit(normal);
  return { point, normal: n, d: n.reduce((s, v, i) => s + v * point[i], 0), size };
};

describe('points', () => {
  test('midpoint', () => {
    assert.deepEqual(midpoint([0, 0, 0], [2, 4, -6]), [1, 2, -3]);
  });

  test('where a line meets a plane', () => {
    const r = lineMeetsPlane({ point: [1, 2, 3], direction: [0, 0, 1] }, plane([0, 0, 10], [0, 0, 1]));
    nearVec(r.position, [1, 2, 10]);
    assert.equal(r.error, null);
    // Slanting: the line from the origin along (1, 1, 1) meets z = 3 at (3, 3, 3).
    nearVec(lineMeetsPlane({ point: [0, 0, 0], direction: unit([1, 1, 1]) }, plane([5, -2, 3], [0, 0, 1])).position, [3, 3, 3]);
  });

  test('a line lying along a plane never meets it at one point', () => {
    const r = lineMeetsPlane({ point: [0, 0, 1], direction: [1, 0, 0] }, plane([0, 0, 0], [0, 0, 1]));
    assert.equal(r.position, null);
    assert.equal(r.error, 'parallel');
  });
});

describe('lines', () => {
  test('through two points: from the first to the second, as long as the distance between them', () => {
    const r = lineThrough([1, 1, 1], [4, 5, 1]);
    nearVec(r.direction, [0.6, 0.8, 0]);
    nearVec(r.point, [1, 1, 1]);
    assert.deepEqual(r.ends, [[1, 1, 1], [4, 5, 1]]);
    near(r.length, 5);
    assert.equal(r.error, null);
  });

  test('two points in the same place give no line', () => {
    const r = lineThrough([1, 2, 3], [1, 2, 3]);
    assert.equal(r.error, 'same');
    assert.equal(r.direction, null);
  });

  test('fitted to a path: the best straight line, pointing from its start towards its end', () => {
    // A slightly wavy path along (1, 2, 2)/3, from (0, 0, 0) to (30, 60, 60).
    const u = unit([1, 2, 2]);
    const side = unit([2, -1, 0]);
    const path = Array.from({ length: 31 }, (_, i) => u.map((v, k) => 90 * (i / 30) * v + 0.5 * Math.sin(i) * side[k]));
    const r = fitLineToPath(path, false);
    nearVec(r.direction, u, 5e-3, "a wobble that does not average out tilts it a little");
    assert.ok(r.rms > 0.2 && r.rms < 0.5, `rms ${r.rms}`);
    assert.ok(r.maxDeviation > 0.45 && r.maxDeviation < 0.6, `largest ${r.maxDeviation}`);
    near(r.length, 90, 0.1);
    // The ends are the path's extremes, laid on the line, in the line's direction.
    nearVec(r.ends[0], [0, 0, 0], 0.5);
    nearVec(r.ends[1], u.map((v) => 90 * v), 0.5);
    // Drawn the other way, the line points the other way.
    nearVec(fitLineToPath(path.slice().reverse(), false).direction, u.map((v) => -v), 5e-3);
  });

  test('a path on a straight line fits exactly; a path with one point does not fit', () => {
    const r = fitLineToPath([[0, 0, 0], [1, 1, 0], [3, 3, 0]], false);
    nearVec(r.direction, unit([1, 1, 0]));
    near(r.rms, 0);
    assert.equal(fitLineToPath([[1, 1, 1]], false).error, 'few');
    assert.equal(fitLineToPath([[1, 1, 1], [1, 1, 1]], false).error, 'few');
  });

  test('a closed loop: the line along its longest way, largest component positive', () => {
    const loop = Array.from({ length: 41 }, (_, i) => {
      const t = (2 * Math.PI * i) / 40;
      return [3 * Math.sin(t), -20 * Math.cos(t), 1];
    });
    const r = fitLineToPath(loop, true);
    nearVec(r.direction, [0, 1, 0], 1e-6);
  });

  test('perpendicular to a plane through a point: along the normal, from the plane to the point', () => {
    const p = plane([0, 0, 2], [0, 0, 1]);
    const r = perpendicularTo(p, [3, 4, 10]);
    nearVec(r.direction, [0, 0, 1]);
    nearVec(r.foot, [3, 4, 2]);
    near(r.length, 8, 1e-9, 'the distance from the point to the plane');
    nearVec(r.ends[0], [3, 4, 2]);
    nearVec(r.ends[1], [3, 4, 10]);
    near(r.signed, 8);
    // A point under the plane: the line still follows the normal; the distance has a sign.
    const below = perpendicularTo(p, [0, 0, -1]);
    nearVec(below.direction, [0, 0, 1]);
    near(below.signed, -3);
    near(below.length, 3);
    nearVec(below.ends[0], [0, 0, -1]);
    nearVec(below.ends[1], [0, 0, 2]);
  });

  test('a point on the plane: the line is drawn as long as the plane is wide', () => {
    const r = perpendicularTo(plane([0, 0, 0], [0, 0, 1], 6), [1, 1, 0]);
    near(r.length, 0);
    nearVec(r.ends[0], [1, 1, -6]);
    nearVec(r.ends[1], [1, 1, 6]);
  });

  test('where two planes meet', () => {
    const a = plane([0, 0, 5], [0, 0, 1], 4);
    const b = plane([7, 3, 0], [1, 0, 0], 8);
    const r = planesMeet(a, b);
    nearVec(r.direction, [0, 1, 0], 1e-12, 'n1 × n2');
    // On both planes, nearest the planes' two points' midpoint.
    near(r.point[0], 7);
    near(r.point[2], 5);
    near(r.point[1], 1.5);
    // Drawn as far each way as the larger plane is wide.
    nearVec(r.ends[0], [7, 1.5 - 8, 5]);
    nearVec(r.ends[1], [7, 1.5 + 8, 5]);
    // At an angle.
    const c = planesMeet(plane([0, 0, 0], [1, 1, 0]), plane([0, 0, 0], [0, 1, 1]));
    nearVec(c.direction, unit([1, -1, 1]));
  });

  test('parallel planes do not meet', () => {
    assert.equal(planesMeet(plane([0, 0, 0], [0, 0, 1]), plane([1, 1, 4], [0, 0, -1])).error, 'parallel');
  });

  test('orderAlong puts two points in the order of a direction', () => {
    assert.deepEqual(orderAlong([[5, 0, 0], [1, 0, 0]], [1, 0, 0]), [[1, 0, 0], [5, 0, 0]]);
    assert.deepEqual(orderAlong([[1, 0, 0], [5, 0, 0]], [1, 0, 0]), [[1, 0, 0], [5, 0, 0]]);
  });
});
