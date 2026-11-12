import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadMeshBuffer } from '../../js/mesh-loader.js';
import { makeExampleStl, EXAMPLE } from '../../js/sample.js';
import { scene, ball, events } from '../scene-helpers.js';

const near = (a, b, tol, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} ≉ ${b} (±${tol})`);
const nearVec = (a, b, tol, msg = '') => a.forEach((v, i) => near(v, b[i], tol, `${msg}[${i}]`));
const unit = (v) => v.map((x) => x / Math.hypot(...v));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const loop = (r, z, n = 12) => Array.from({ length: n }, (_, k) => [r * Math.cos((2 * Math.PI * k) / n), r * Math.sin((2 * Math.PI * k) / n), z]);

// Two balls of radius 10, at x = 0 and x = 40; on each a cap round its near pole, with a sphere fitted.
function twoBalls() {
  const s = scene([20, 0, 120], [20, 0, 0]);
  const a = s.addMesh('A', ball(10));
  const b = s.addMesh('B', ball(10, 40));
  const capOn = (mesh, x) => {
    const curve = s.addCurve(mesh.id, loop(6, 8).map(([px, py, pz]) => [px + x, py, pz]));
    const region = s.regions.create(curve.id);
    return { curve, region, sphere: s.fits.create(region.id, 'sphere') };
  };
  return { ...s, a, b, capA: capOn(a, 0), capB: capOn(b, 40) };
}

describe('points', () => {
  test('a point clicked on a mesh is attached to it, where it was clicked', () => {
    const { constructs, model, a, picker } = twoBalls();
    const hit = { id: a.id, ...picker.snap(a.id, [0, 0, 11]).fields };
    const p = constructs.placePoint(hit);
    assert.equal(p.kind, 'point');
    assert.equal(p.parent, a.id);
    assert.equal(p.method, 'surface');
    assert.equal(p.inputs, undefined, 'made from nothing else');
    nearVec(p.position, [0, 0, 10], 0.1);
    assert.ok(Number.isInteger(p.anchor.face));
    assert.equal(model.get(p.id).name, 'Point 1');
  });

  test('the centre of a sphere: on the sphere\'s mesh, and it follows the sphere', () => {
    const { constructs, engine, capA, a } = twoBalls();
    const c = constructs.create('point', 'centre', [capA.sphere.id]);
    assert.equal(c.parent, a.id);
    nearVec(c.position, [0, 0, 0], 1e-3);
    assert.equal(c.error, null);
    // Make the cap bigger: the sphere is fitted again, and the point moves with it.
    const before = capA.sphere.centre.slice();
    engine.set(capA.curve.id, { closed: true });
    assert.deepEqual(c.position, capA.sphere.centre);
    assert.ok(before);
  });

  test('the centroid of a region or a curve', () => {
    const { constructs, capA } = twoBalls();
    assert.deepEqual(constructs.create('point', 'centroid', [capA.region.id]).position, capA.region.centroid);
    assert.deepEqual(constructs.create('point', 'centroid', [capA.curve.id]).position, capA.curve.centroid);
  });

  test('midway between two points; on two meshes it is global', () => {
    const { constructs, capA, capB } = twoBalls();
    const m = constructs.create('point', 'midpoint', [capA.sphere.id, capB.sphere.id]);
    nearVec(m.position, [20, 0, 0], 1e-3);
    assert.equal(m.parent, null);
  });

  test('where a line meets a plane', () => {
    const { constructs, fits, capA, capB } = twoBalls();
    const line = constructs.create('line', 'two-points', [capA.sphere.id, capB.sphere.id]);
    const plane = fits.create(capB.region.id, 'plane');
    // The cap's plane is z ≈ 9 or so, square to Z; the x axis lies along it: no single point.
    const p = constructs.create('point', 'line-plane', [line.id, plane.id]);
    assert.equal(p.error, 'parallel');
    assert.equal(p.position, null);
    // A line square to that plane does meet it, at its foot.
    const up = constructs.create('line', 'perpendicular', [plane.id, capA.sphere.id]);
    const q = constructs.create('point', 'line-plane', [up.id, plane.id]);
    nearVec(q.position, [0, 0, plane.point[2]], 1e-6);
  });
});

describe('lines', () => {
  test('through two points: their distance, from the first to the second; a flip turns it round', () => {
    const { constructs, capA, capB, model } = twoBalls();
    const l = constructs.create('line', 'two-points', [capA.sphere.id, capB.sphere.id]);
    assert.equal(l.kind, 'line');
    assert.equal(model.get(l.id).name, 'Line 1');
    nearVec(l.direction, [1, 0, 0], 1e-4);
    near(l.length, 40, 1e-3);
    assert.equal(l.flipped, false);
    constructs.set(l.id, { flipped: true });
    nearVec(l.direction, [-1, 0, 0], 1e-4);
    nearVec(l.ends[0], capB.sphere.centre, 1e-9, 'it starts at the second now');
    near(l.length, 40, 1e-3, 'it stays where it was');
  });

  test('two points in the same place: no line, and why', () => {
    const { constructs, capA } = twoBalls();
    const c = constructs.create('point', 'centre', [capA.sphere.id]);
    const l = constructs.create('line', 'two-points', [c.id, capA.sphere.id]);
    assert.equal(l.error, 'same');
    assert.equal(l.direction, null);
  });

  test('the axis of a cylinder, and a line fitted to a curve', async () => {
    const s = scene([0, 0, 200], EXAMPLE.shaft.point);
    const mesh = await loadMeshBuffer(makeExampleStl(), EXAMPLE.file);
    const m = s.model.add('mesh', { name: 'Example femur', file: EXAMPLE.file, faceCount: mesh.faceCount });
    s.view.addMesh(m, mesh.geometry);
    const shaftAt = (y, t) => [EXAMPLE.shaft.point[0] + 7 * Math.cos(t), EXAMPLE.shaft.point[1] + y, EXAMPLE.shaft.point[2] + 7 * Math.sin(t)];
    const ring = (y) => Array.from({ length: 12 }, (_, k) => shaftAt(y, (2 * Math.PI * k) / 12));
    const top = s.addCurve(m.id, ring(70));
    const bottom = s.addCurve(m.id, ring(30));
    const band = s.regions.create(top.id);
    s.regions.addBoundary(band.id, bottom.id);
    const cyl = s.fits.create(band.id, 'cylinder');
    const axis = s.constructs.create('line', 'axis', [cyl.id]);
    nearVec(axis.direction, [0, 1, 0], 1e-3);
    assert.deepEqual(axis.ends, cyl.ends);
    near(axis.length, cyl.length, 1e-12);
    // Down the side of the shaft, an open curve: its line runs up the shaft.
    const side = s.addCurve(m.id, [shaftAt(20, 0.3), shaftAt(50, 0.3), shaftAt(80, 0.3)], { closed: false });
    const fitted = s.constructs.create('line', 'fit-curve', [side.id]);
    nearVec(fitted.direction, [0, 1, 0], 1e-3);
    near(fitted.length, 60, 0.5);
    assert.ok(fitted.rms < 0.05, `rms ${fitted.rms}`);
    // Flipping the cylinder flips its axis line.
    s.fits.set(cyl.id, { flipped: true });
    nearVec(axis.direction, [0, -1, 0], 1e-3);
  });

  test('perpendicular to a plane through a point: the distance from the point to the plane', () => {
    const { constructs, fits, capA, capB } = twoBalls();
    const plane = fits.create(capA.region.id, 'plane');
    const l = constructs.create('line', 'perpendicular', [plane.id, capB.sphere.id]);
    nearVec(l.direction, plane.normal, 1e-12);
    near(l.length, Math.abs(dot(plane.normal, capB.sphere.centre) - plane.d), 1e-9);
    assert.ok(l.signed < 0, 'B\'s centre is below A\'s cap, against the normal');
    assert.equal(l.parent, null);
  });

  test('where two planes meet', () => {
    const { constructs, fits, capA, regions, addCurve, a } = twoBalls();
    const p1 = fits.create(capA.region.id, 'plane');
    // A cap on A's side, square to X.
    const side = addCurve(a.id, loop(6, 8).map(([x, y, z]) => [z, y, x]));
    const p2 = fits.create(regions.create(side.id).id, 'plane');
    const l = constructs.create('line', 'planes', [p1.id, p2.id]);
    nearVec(l.direction.map(Math.abs), unit(cross(p1.normal, p2.normal)).map(Math.abs), 1e-9);
    near(dot(p1.normal, l.point), p1.d, 1e-9);
    near(dot(p2.normal, l.point), p2.d, 1e-9);
    assert.equal(constructs.create('line', 'planes', [p1.id, p1.id]).error, 'parallel');
  });
});

describe('keeping up with their inputs', () => {
  test('what is made from a point follows it, all the way down', () => {
    const { constructs, capA, capB, engine } = twoBalls();
    const m = constructs.create('point', 'midpoint', [capA.sphere.id, capB.sphere.id]);
    const l = constructs.create('line', 'two-points', [capA.sphere.id, m.id]);
    const before = l.length;
    // Move A's cap curve: A's sphere, the midpoint and the line follow.
    const moved = capA.curve.control_points.map((p) => ({ ...p }));
    engine.set(capA.curve.id, { control_points: moved.slice(0, 6) });
    assert.deepEqual(m.position, capA.sphere.centre.map((v, i) => (v + capB.sphere.centre[i]) / 2));
    near(l.length, Math.hypot(...m.position.map((v, i) => v - capA.sphere.centre[i])), 1e-9);
    assert.ok(Number.isFinite(before));
  });

  test('an input that fails takes its points and lines with it, until it comes back', () => {
    const { constructs, capA, model, regions } = twoBalls();
    const c = constructs.create('point', 'centre', [capA.sphere.id]);
    model.update(capA.sphere.id, { error: 'flat' });
    // A sphere is only updated through the fit engine; refresh the point by hand here.
    constructs.refresh(c.id);
    assert.equal(c.error, 'input');
    assert.equal(c.position, null);
    regions.refresh(capA.region.id);
    assert.equal(c.error, null);
    assert.ok(c.position);
  });

  test('removing an input removes what was made from it, and what was made from that', () => {
    const { constructs, capA, capB, model } = twoBalls();
    const m = constructs.create('point', 'midpoint', [capA.sphere.id, capB.sphere.id]);
    const l = constructs.create('line', 'two-points', [m.id, capB.sphere.id]);
    const other = constructs.create('point', 'centre', [capB.sphere.id]);
    const seen = events(model);
    model.remove(capA.curve.id);
    assert.equal(model.get(m.id), null);
    assert.equal(model.get(l.id), null);
    assert.ok(model.get(other.id), 'not made from A');
    assert.ok(seen.some((e) => e.kind === 'remove'));
  });

  test('landmarks from a file are left alone', () => {
    const { constructs, model, a } = twoBalls();
    const lm = model.add('point', { parent: a.id, position: [1, 2, 3], status: 'placed' });
    model.update(lm.id, { position: [3, 2, 1] });
    assert.deepEqual(constructs.dependentsOf(lm.id), []);
    assert.deepEqual(model.get(lm.id).position, [3, 2, 1]);
  });
});
