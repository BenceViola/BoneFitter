import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDENTITY, isMoved, place, turn, inverse, rotationBetween, matrixElements, nodeInScene } from '../../js/placement.js';

const near = (a, b, tol = 1e-12, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} ≉ ${b}`);
const nearVec = (a, b, tol = 1e-12, msg = '') => a.forEach((v, i) => near(v, b[i], tol, `${msg}[${i}]`));
const unit = (v) => v.map((x) => x / Math.hypot(...v));
// A quarter turn about Z (x → y), then a shift.
const quarter = { rotation: [[0, -1, 0], [1, 0, 0], [0, 0, 1]], translation: [10, 0, -5] };

test('nothing and the identity move nothing', () => {
  assert.equal(isMoved(null), false);
  assert.equal(isMoved(IDENTITY), false);
  assert.equal(isMoved(quarter), true);
  assert.deepEqual(place(null, [1, 2, 3]), [1, 2, 3]);
});

test('points turn and shift, directions only turn; inverse undoes it', () => {
  nearVec(place(quarter, [1, 0, 0]), [10, 1, -5]);
  nearVec(turn(quarter, [1, 0, 0]), [0, 1, 0]);
  const back = inverse(quarter);
  nearVec(place(back, place(quarter, [3, -4, 7])), [3, -4, 7]);
});

test('rotationBetween turns one direction onto another, by the smallest turn', () => {
  for (const [a, b] of [
    [[1, 0, 0], [0, 0, 1]],
    [unit([1, 2, 3]), unit([-2, 0.5, 1])],
    [[0, 0, 1], [0, 0, 1]],
    [[0, 0, 1], [0, 0, -1]],
    [unit([1, 1, 0]), unit([-1, -1, 0])],
  ]) {
    const R = rotationBetween(a, b);
    nearVec(turn({ rotation: R, translation: [0, 0, 0] }, a), b, 1e-12, `${a} → ${b}`);
    // A rotation: rows orthonormal, determinant +1.
    const det = R[0][0] * (R[1][1] * R[2][2] - R[1][2] * R[2][1]) - R[0][1] * (R[1][0] * R[2][2] - R[1][2] * R[2][0]) + R[0][2] * (R[1][0] * R[2][1] - R[1][1] * R[2][0]);
    near(det, 1, 1e-12);
  }
  // The axis it turns about stays put.
  const R = rotationBetween([1, 0, 0], [0, 1, 0]);
  nearVec(turn({ rotation: R, translation: [0, 0, 0] }, [0, 0, 1]), [0, 0, 1]);
});

test('matrixElements: the order three.js reads (column by column)', () => {
  const e = matrixElements(quarter);
  // Column 0 is where x goes: (0, 1, 0); column 3 the shift.
  assert.deepEqual(e.slice(0, 4), [0, 1, 0, 0]);
  assert.deepEqual(e.slice(12), [10, 0, -5, 1]);
});

test('nodeInScene moves every position and direction of an object, and nothing else', () => {
  const plane = { kind: 'plane', point: [1, 0, 0], normal: [1, 0, 0], d: 1, rms: 0.1, size: 4 };
  const p = nodeInScene(plane, quarter);
  nearVec(p.point, [10, 1, -5]);
  nearVec(p.normal, [0, 1, 0]);
  near(p.d, 1, 1e-12, 'n · point');
  assert.equal(p.rms, 0.1);
  assert.equal(plane.point[0], 1, 'the original is untouched');
  const line = { kind: 'line', point: [0, 0, 0], direction: [1, 0, 0], ends: [[0, 0, 0], [2, 0, 0]], length: 2 };
  const l = nodeInScene(line, quarter);
  nearVec(l.ends[1], [10, 2, -5]);
  assert.equal(l.length, 2);
  const m = nodeInScene({ kind: 'measure', delta: [1, 0, 0], value: 1, values: [1, 2, 3], segments: [[[0, 0, 0], [1, 0, 0]]] }, quarter);
  nearVec(m.delta, [0, 1, 0]);
  assert.deepEqual(m.values, [1, 2, 3], 'coordinates in a coordinate system stay');
  nearVec(m.segments[0][1], [10, 1, -5]);
  const curve = nodeInScene({ kind: 'curve', control_points: [{ position: [1, 0, 0], anchor: { face: 3 } }], line: [[1, 0, 0]], centroid: [1, 0, 0] }, quarter);
  nearVec(curve.control_points[0].position, [10, 1, -5]);
  assert.deepEqual(curve.control_points[0].anchor, { face: 3 });
  nearVec(curve.line[0], [10, 1, -5]);
  assert.equal(nodeInScene(plane, null), plane, 'not moved: the same object');
});
