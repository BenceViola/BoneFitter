import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pointToPoint, pointToLine, pointToPlane, lineToLine, angleBetween, cornerAngle, angleOnPlane, makeFrame, inFrame } from '../../js/measure.js';

const near = (a, b, tol = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} ≉ ${b}`);
const nearVec = (a, b, tol = 1e-9, msg = '') => a.forEach((v, i) => near(v, b[i], tol, `${msg}[${i}]`));
const unit = (v) => v.map((x) => x / Math.hypot(...v));
const line = (point, direction) => ({ kind: 'line', point, direction: unit(direction) });
const plane = (point, normal) => {
  const n = unit(normal);
  return { kind: 'plane', point, normal: n, d: n.reduce((s, v, i) => s + v * point[i], 0) };
};
const deg = (r) => (r * 180) / Math.PI;

describe('distances', () => {
  test('between two points, with how far apart along each axis', () => {
    const r = pointToPoint([1, 2, 3], [4, 6, 3]);
    near(r.value, 5);
    assert.deepEqual(r.delta, [3, 4, 0]);
    assert.deepEqual(r.segment, [[1, 2, 3], [4, 6, 3]]);
  });

  test('from a point to a line: square to it, with the foot', () => {
    const r = pointToLine([3, 4, 7], line([0, 0, 0], [0, 0, 1]));
    near(r.value, 5);
    nearVec(r.foot, [0, 0, 7]);
    assert.deepEqual(r.segment, [[3, 4, 7], r.foot]);
  });

  test('from a point to a plane: the distance, and with a sign for the side', () => {
    const p = plane([0, 0, 2], [0, 0, 1]);
    const above = pointToPlane([1, 1, 5], p);
    near(above.value, 3);
    near(above.signed, 3);
    nearVec(above.foot, [1, 1, 2]);
    near(pointToPlane([1, 1, -1], p).signed, -3);
  });

  test('between two lines: the shortest distance, and where it is', () => {
    // The x axis, and a line along y at height 4 through x = 2.
    const r = lineToLine(line([0, 0, 0], [1, 0, 0]), line([2, -7, 4], [0, 1, 0]));
    near(r.value, 4);
    nearVec(r.segment[0], [2, 0, 0]);
    nearVec(r.segment[1], [2, 0, 4]);
    assert.equal(r.parallel, false);
  });

  test('two parallel lines: the distance between them', () => {
    const r = lineToLine(line([0, 0, 0], [1, 1, 0]), line([5, 5, 3], [-1, -1, 0]));
    near(r.value, 3);
    assert.equal(r.parallel, true);
    near(Math.hypot(...r.segment[1].map((v, i) => v - r.segment[0][i])), 3);
  });
});

describe('angles', () => {
  test('between two lines, by their directions (0–180°), and the smaller one (0–90°)', () => {
    const r = angleBetween(line([0, 0, 0], [1, 0, 0]), line([0, 0, 0], [-1, 1, 0]));
    near(r.value, 135);
    near(r.acute, 45);
    assert.equal(r.between, 'lines');
  });

  test('between a line and a plane: positive when the line points to the side the normal points to', () => {
    const p = plane([0, 0, 0], [0, 0, 1]);
    const up = angleBetween(line([0, 0, 0], [1, 0, 1]), p);
    near(up.value, 45);
    assert.equal(up.between, 'line-plane');
    near(angleBetween(p, line([0, 0, 0], [1, 0, -Math.sqrt(3)])).value, -60, 1e-9, 'either order');
    near(angleBetween(line([0, 0, 0], [1, 0, 0]), p).value, 0, 1e-9, 'a line along the plane');
  });

  test('between two planes: between their normals, and the smaller', () => {
    const r = angleBetween(plane([0, 0, 0], [0, 0, 1]), plane([0, 0, 0], [0, 1, -1]));
    near(r.value, 135);
    near(r.acute, 45);
    assert.equal(r.between, 'planes');
  });

  test('at a corner, between two other points', () => {
    const r = cornerAngle([1, 1, 0], [5, 1, 0], [1, 9, 0]);
    near(r.value, 90);
    assert.deepEqual(r.segments, [[[1, 1, 0], [5, 1, 0]], [[1, 1, 0], [1, 9, 0]]]);
    assert.equal(cornerAngle([1, 1, 0], [1, 1, 0], [2, 2, 2]).error, 'same');
  });

  test('two lines seen on a plane: the turn from the first to the second, about the normal (−180° to 180°)', () => {
    const ground = plane([0, 0, 0], [0, 0, 1]);
    // Tilted out of the plane: only what is seen from above counts.
    const a = line([0, 0, 0], [1, 0, 5]);
    const b = line([3, 3, 3], [1, 1, -2]);
    near(angleOnPlane(a, b, ground).value, 45);
    near(angleOnPlane(b, a, ground).value, -45);
    near(angleOnPlane(a, line([0, 0, 0], [-1, -0.0001, 0]), ground).value, -180 + deg(0.0001), 1e-6);
    // A line square to the plane is a point when seen on it.
    assert.equal(angleOnPlane(a, line([0, 0, 0], [0, 0, 1]), ground).error, 'square');
  });
});

describe('coordinate systems', () => {
  const axes = (f) => [f.x, f.y, f.z];

  test('from an origin and two directions: the first gives its axis exactly, the second is squared up to it', () => {
    const f = makeFrame([1, 2, 3], [0, 0, 2], [1, 0, 1], 'z', 'x');
    assert.deepEqual(f.origin, [1, 2, 3]);
    nearVec(f.z, [0, 0, 1]);
    nearVec(f.x, [1, 0, 0]);
    nearVec(f.y, [0, 1, 0], 1e-12, 'right-handed: y = z × x');
    assert.equal(f.error, null);
  });

  test('every choice of first and second axis is right-handed', () => {
    const a = unit([1, 2, 0.5]);
    const b = unit([-1, 0.3, 2]);
    for (const [p, s] of [['x', 'y'], ['y', 'x'], ['y', 'z'], ['z', 'y'], ['z', 'x'], ['x', 'z']]) {
      const f = makeFrame([0, 0, 0], a, b, p, s);
      nearVec(f[p], a, 1e-12, `${p} is the first direction`);
      const [x, y, z] = axes(f);
      const xy = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
      nearVec(xy, z, 1e-12, `${p}${s}: x × y = z`);
      assert.ok(f[s].reduce((t, v, i) => t + v * b[i], 0) > 0, 'the second axis leans the way of the second direction');
    }
  });

  test('two directions along one line give no coordinate system; nor do two choices of the same axis', () => {
    assert.equal(makeFrame([0, 0, 0], [1, 0, 0], [-2, 0, 0], 'x', 'y').error, 'parallel');
    assert.equal(makeFrame([0, 0, 0], [1, 0, 0], [0, 1, 0], 'x', 'x').error, 'axes');
  });

  test("a point's coordinates in a system", () => {
    const f = makeFrame([10, 0, 0], [0, 1, 0], [-1, 0, 0], 'x', 'y');
    // x along world +y, y along world −x, so z = x × y = world +z.
    nearVec(inFrame([10, 3, 4], f), [3, 0, 4]);
    nearVec(inFrame([8, 0, 0], f), [0, 2, 0]);
  });
});
