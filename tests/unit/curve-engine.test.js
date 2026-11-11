import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathCentroid } from '../../js/curve-engine.js';
import { scene, ball, events } from '../scene-helpers.js';

const R = 10;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≉ ${b} (±${tol})`);
const radius = (p) => Math.hypot(...p);

// A ball of radius 10 at the origin with a curve through the given points.
function setup(points, fields = {}) {
  const s = scene();
  const mesh = s.addMesh('ball', ball(R, 0, 96));
  const curve = s.model.add('curve', {
    parent: mesh.id,
    path: 'geodesic',
    closed: false,
    control_points: points.map((p) => s.cp(mesh.id, p)),
    ...fields,
  });
  return { ...s, mesh, curve };
}

describe('computing a curve on a mesh', () => {
  test('between two points the path is the shortest way across the surface', () => {
    const { engine, curve } = setup([[R, 0, 0], [0, R, 0]]);
    const r = engine.compute(curve);
    near(r.length, (Math.PI * R) / 2, 0.01 * R, 'a quarter of a great circle');
    assert.ok(r.line.length > 20, 'the path has many points');
    for (const p of r.line) near(radius(p), R, 0.02, 'every point is on the surface');
    assert.equal(r.used, 'geodesic');
    assert.equal(r.warning, null);
  });

  test('a closed loop comes back to its first point; its centroid is that of the whole path', () => {
    const { engine, curve } = setup([[R, 0, 0], [0, R, 0], [-R, 0, 0], [0, -R, 0]], { closed: true });
    const r = engine.compute(curve);
    near(r.length, 2 * Math.PI * R, 0.02 * R, 'the equator');
    assert.deepEqual(r.line[0], r.line.at(-1));
    assert.ok(radius(r.centroid) < 0.05, `the centroid of the equator is the centre: ${r.centroid}`);
  });

  test('the centroid weighs the path by length, not by how many points were clicked', () => {
    // Three clicks crowded at one end of a quarter circle must not pull the centroid there.
    const even = setup([[R, 0, 0], [0, R, 0]]);
    const crowded = setup([[R, 0, 0], [R * Math.cos(0.05), R * Math.sin(0.05), 0], [R * Math.cos(0.1), R * Math.sin(0.1), 0], [0, R, 0]]);
    const a = even.engine.compute(even.curve).centroid;
    const b = crowded.engine.compute(crowded.curve).centroid;
    // (The mean of the clicked points would be about 4 apart.)
    assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 0.15, `${a} vs ${b}`);
    assert.deepEqual(pathCentroid([[0, 0, 0], [2, 0, 0], [2, 2, 0]]), [1.5, 0.5, 0]);
    assert.equal(pathCentroid([[1, 2, 3]]), null);
  });

  test('"euclidean" curves are straight between the points, laid on the surface', () => {
    const { engine, curve } = setup([[R, 0, 0], [0, R, 0]], { path: 'euclidean' });
    const r = engine.compute(curve);
    assert.equal(r.used, 'euclidean');
    // Each short step is put on the nearest triangle, so the path is a little ragged and longer.
    near(r.length, (Math.PI * R) / 2, 0.05 * R);
    assert.equal(engine.isReady(curve.parent), false, 'no corner table is needed for these');
  });

  test('one point is not a curve yet', () => {
    const { engine, curve } = setup([[R, 0, 0]]);
    const r = engine.compute(curve);
    assert.deepEqual(r.line, []);
    assert.equal(r.length, 0);
    assert.equal(r.centroid, null);
  });

  test('the mesh is prepared once, and forgotten when the mesh is removed', () => {
    const { engine, model, mesh, curve } = setup([[R, 0, 0], [0, R, 0]]);
    assert.equal(engine.isReady(mesh.id), false);
    engine.compute(curve);
    assert.equal(engine.isReady(mesh.id), true);
    const table = engine.topo.get(mesh.id);
    engine.compute(curve);
    assert.equal(engine.topo.get(mesh.id), table, 'the same table is used again');
    model.remove(mesh.id);
    assert.equal(engine.isReady(mesh.id), false);
    assert.equal(engine.routes.size, 0);
  });

  test('set() changes a curve and recomputes it as one change', () => {
    const { engine, model, mesh, curve, cp } = setup([[R, 0, 0], [0, R, 0]]);
    engine.refresh(curve.id);
    const before = curve.length;
    const seen = events(model);
    engine.set(curve.id, { control_points: [curve.control_points[0], cp(mesh.id, [-R, 0, 0])] });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].kind, 'update');
    near(curve.length, 2 * before, 0.02 * R, 'half a great circle now');
    assert.equal(curve.line.length > 20, true);
  });

  test('the source geometry is not touched by preparing or computing', () => {
    const { engine, curve, view, mesh } = setup([[R, 0, 0], [0, R, 0]]);
    const g = view.sources.get(mesh.id);
    const before = g.attributes.position.array.slice();
    engine.compute(curve);
    assert.equal(g.index, null);
    assert.deepEqual(g.attributes.position.array, before);
  });
});
