import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadMeshBuffer } from '../../js/mesh-loader.js';
import { makeExampleStl, EXAMPLE } from '../../js/sample.js';
import { describe as describeNode } from '../../js/properties-panel.js';
import { scene, screenOf } from '../scene-helpers.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≉ ${b} (±${tol})`);
const nearVec = (a, b, tol, msg) => a.forEach((v, i) => near(v, b[i], tol, `${msg ?? ''}[${i}]`));
const unit = (v) => v.map((x) => x / Math.hypot(...v));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const toLine = (p, point, dir) => {
  const d = p.map((v, i) => v - point[i]);
  const along = dot(d, dir);
  return Math.hypot(...d.map((v, i) => v - along * dir[i]));
};
const rows = (d) => Object.fromEntries(d.rows.map(([k, v]) => [k, v]));

// Points of the example's shaft: at height y above its bottom, `deg` degrees round from +X.
const S = EXAMPLE.shaft;
const onShaft = (deg, y) => {
  const t = (deg * Math.PI) / 180;
  return [S.point[0] + S.radius * Math.cos(t), S.point[1] + y, S.point[2] + S.radius * Math.sin(t)];
};
const shaftRing = (y, n = 8) => Array.from({ length: n }, (_, k) => onShaft((360 * k) / n, y));

// Points of the example's head, `angle` degrees from the point straight out along the neck.
const AXIS = unit(EXAMPLE.neck.direction);
const E1 = unit(cross(AXIS, [0, 0, 1]));
const E2 = cross(AXIS, E1);
const headRing = (angle, n = 12) =>
  Array.from({ length: n }, (_, k) => {
    const a = (angle * Math.PI) / 180;
    const t = (2 * Math.PI * k) / n;
    return EXAMPLE.head.centre.map((c, i) => c + EXAMPLE.head.radius * (Math.cos(a) * AXIS[i] + Math.sin(a) * (Math.cos(t) * E1[i] + Math.sin(t) * E2[i])));
  });

async function example() {
  const s = scene([S.point[0] + 30, S.point[1] + 50, S.point[2] + 200], [S.point[0], S.point[1] + 50, S.point[2]]);
  const mesh = await loadMeshBuffer(makeExampleStl(), EXAMPLE.file);
  const node = s.model.add('mesh', { name: 'Example femur', file: EXAMPLE.file, faceCount: mesh.faceCount });
  s.view.addMesh(node, mesh.geometry);
  return { ...s, mesh: node };
}

describe('fitting a cylinder', () => {
  test('to the band between two rings round the example\'s shaft: the shaft\'s axis and radius', async () => {
    const { fits, regions, addCurve, mesh } = await example();
    const region = regions.create(addCurve(mesh.id, shaftRing(20)).id);
    regions.addBoundary(region.id, addCurve(mesh.id, shaftRing(80)).id);
    assert.equal(region.error, null);
    const c = fits.create(region.id, 'cylinder');
    assert.equal(c.kind, 'cylinder');
    assert.equal(c.name, 'Cylinder 1');
    assert.equal(c.parent, mesh.id);
    assert.equal(c.error, null);
    nearVec(c.direction, [0, 1, 0], 1e-4, 'along the shaft, pointing up');
    near(c.radius, S.radius, 1e-3);
    near(toLine(S.point, c.point, c.direction), 0, 1e-3, 'the axis is the shaft\'s');
    near(c.length, 60, 1.5, 'between the rings');
    assert.ok(c.ends[1][1] > c.ends[0][1], 'the ends go the way of the direction');
    assert.equal(c.arc, 360);
    assert.ok(c.rms < 1e-3);
    assert.ok(c.spread < 0.01);
  });

  test('to a patch on one side of the shaft (a third of the way round): still the shaft', async () => {
    const { fits, regions, addCurve, mesh } = await example();
    const patch = [onShaft(30, 30), onShaft(90, 30), onShaft(150, 30), onShaft(150, 70), onShaft(90, 70), onShaft(30, 70)];
    const region = regions.create(addCurve(mesh.id, patch).id);
    const c = fits.create(region.id, 'cylinder');
    nearVec(c.direction, [0, 1, 0], 1e-3);
    near(c.radius, S.radius, 1e-3);
    near(toLine(S.point, c.point, c.direction), 0, 1e-3);
    assert.ok(c.arc >= 115 && c.arc <= 135, `arc ${c.arc}`);
  });

  test('a cylinder on a round surface: fitted, but spread says the axis is poorly fixed', async () => {
    const { fits, regions, addCurve, mesh, model } = await example();
    const region = regions.create(addCurve(mesh.id, headRing(40)).id);
    const c = fits.create(region.id, 'cylinder');
    assert.ok(c.spread > 0.5, `spread ${c.spread}`);
    assert.match(rows(describeNode(model, c.id)).Note, /curves in every direction/);
  });

  test('Flip direction turns the axis round and swaps its ends; the axis stays where it is', async () => {
    const { fits, regions, addCurve, mesh } = await example();
    const region = regions.create(addCurve(mesh.id, shaftRing(20)).id);
    regions.addBoundary(region.id, addCurve(mesh.id, shaftRing(80)).id);
    const c = fits.create(region.id, 'cylinder');
    const before = { ...c };
    fits.set(c.id, { flipped: true });
    nearVec(c.direction, before.direction.map((v) => -v), 1e-12);
    assert.deepEqual(c.ends, [before.ends[1], before.ends[0]]);
    assert.deepEqual(c.point, before.point);
    fits.set(c.id, { flipped: false });
    assert.deepEqual(c.direction, before.direction);
  });

  test('Properties: axis point and direction, radius, ends, length, arc, and a row to copy', async () => {
    const { fits, regions, addCurve, mesh, model } = await example();
    const region = regions.create(addCurve(mesh.id, shaftRing(20)).id);
    regions.addBoundary(region.id, addCurve(mesh.id, shaftRing(80)).id);
    const c = fits.create(region.id, 'cylinder');
    const d = describeNode(model, c.id);
    const r = rows(d);
    assert.equal(d.kind, 'Cylinder');
    assert.equal(r['Fitted to'], 'Region 1');
    assert.deepEqual(['x', 'y', 'z'].map((k) => r[`Axis point ${k}`]), c.point.map((v) => v.toFixed(3)));
    assert.deepEqual(['x', 'y', 'z'].map((k) => r[`Direction ${k}`]), c.direction.map((v) => v.toFixed(4)));
    assert.equal(r.Radius, '7.000');
    assert.equal(r.Diameter, '14.000');
    assert.equal(r.Length, c.length.toFixed(3));
    assert.equal(r['Arc covered'], '360°');
    assert.equal(r.Coordinates, `as in ${EXAMPLE.file}`);
    assert.deepEqual(d.copy.split('\n'), [
      'name\tfitted_to\tpoint_x\tpoint_y\tpoint_z\tdirection_x\tdirection_y\tdirection_z\tradius\tlength\tend1_x\tend1_y\tend1_z\tend2_x\tend2_y\tend2_z\trms_deviation\tmax_deviation\tarc_degrees\ttriangles',
      ['Cylinder 1', 'Region 1', ...c.point, ...c.direction, c.radius, c.length, ...c.ends[0], ...c.ends[1], c.rms, c.maxDeviation, c.arc, c.faceCount].join('\t'),
    ]);
  });
});

describe('fitting a plane', () => {
  // A box of side 20 at the origin; its +Z face is at z = 10.
  function box() {
    const s = scene();
    const mesh = s.addMesh('box', new THREE.BoxGeometry(20, 20, 20, 20, 20, 20).toNonIndexed());
    return { ...s, mesh };
  }

  test('to a region on a flat face: the face\'s plane, its normal facing out of the box', () => {
    const { fits, regions, addCurve, mesh } = box();
    const region = regions.create(addCurve(mesh.id, [[-5, -5, 10], [5, -5, 10], [5, 5, 10], [-5, 5, 10]]).id);
    const p = fits.create(region.id, 'plane');
    assert.equal(p.kind, 'plane');
    assert.equal(p.name, 'Plane 1');
    assert.equal(p.error, null);
    nearVec(p.normal, [0, 0, 1], 1e-9);
    near(p.d, 10, 1e-6);
    near(p.point[2], 10, 1e-6);
    near(p.point[0], 0, 0.6);
    near(p.point[1], 0, 0.6);
    assert.ok(p.rms < 1e-6);
    assert.ok(p.size > 5 && p.size < 9, `size ${p.size}`);
    assert.equal(p.faceCount, region.faceCount);
  });

  test('to a region on the example\'s head: square to the neck\'s direction, facing out', async () => {
    const { fits, regions, addCurve, mesh } = await example();
    const p = fits.create(regions.create(addCurve(mesh.id, headRing(30)).id).id, 'plane');
    assert.ok(dot(p.normal, AXIS) > 0.9999, `normal ${p.normal}`);
    assert.ok(p.rms > 0.1, 'a curved patch is not flat, and the deviations say so');
  });

  test('to a curve: the plane of a rim; a loop\'s normal follows its direction', async () => {
    const { fits, addCurve, mesh, model } = await example();
    const curve = addCurve(mesh.id, headRing(30, 24));
    const p = fits.create(curve.id, 'plane');
    assert.equal(p.source, curve.id);
    assert.equal(p.error, null);
    assert.ok(dot(p.normal, AXIS) > 0.9999, `normal ${p.normal}`);
    // The loop's points are 30° round the head: its plane is cos 30° × radius out from the centre.
    near(dot(p.normal, p.point) - dot(p.normal, EXAMPLE.head.centre), EXAMPLE.head.radius * Math.cos(Math.PI / 6), 0.1);
    near(p.pathLength, curve.length, 1e-6);
    assert.equal(rows(describeNode(model, p.id))['Fitted to'], 'Curve 1 (its path)');
  });

  test('a plane fitted to a curve follows the curve, and goes when the curve is removed', async () => {
    const { fits, addCurve, mesh, model, engine, cp } = await example();
    const curve = addCurve(mesh.id, headRing(30, 8));
    const p = fits.create(curve.id, 'plane');
    const before = p.normal;
    const points = curve.control_points.slice();
    points[0] = cp(mesh.id, headRing(60, 8)[0]);
    engine.set(curve.id, { control_points: points });
    assert.ok(dot(p.normal, before) < 0.999, 'tilted by the moved point');
    model.remove(curve.id);
    assert.equal(model.get(p.id), null);
  });

  test('only planes can be fitted to curves, and only to finished ones', async () => {
    const { fits, addCurve, mesh, model } = await example();
    const curve = addCurve(mesh.id, headRing(30, 8));
    assert.equal(fits.create(curve.id, 'sphere'), null);
    assert.equal(fits.create(curve.id, 'cylinder'), null);
    model.update(curve.id, { drawing: true });
    assert.equal(fits.create(curve.id, 'plane'), null);
  });

  test('Flip normal turns the normal and d round; the plane stays where it is', () => {
    const { fits, regions, addCurve, mesh } = box();
    const p = fits.create(regions.create(addCurve(mesh.id, [[-5, -5, 10], [5, -5, 10], [5, 5, 10], [-5, 5, 10]]).id).id, 'plane');
    fits.set(p.id, { flipped: true });
    nearVec(p.normal, [0, 0, -1], 1e-9);
    near(p.d, -10, 1e-6);
    near(p.point[2], 10, 1e-6);
  });

  test('Properties: point, normal, the equation, how flat, and a row to copy', () => {
    const { fits, regions, addCurve, mesh, model } = box();
    const p = fits.create(regions.create(addCurve(mesh.id, [[-5, -5, 10], [5, -5, 10], [5, 5, 10], [-5, 5, 10]]).id).id, 'plane');
    const d = describeNode(model, p.id);
    const r = rows(d);
    assert.equal(d.kind, 'Plane');
    assert.deepEqual(['x', 'y', 'z'].map((k) => r[`Point ${k}`]), p.point.map((v) => v.toFixed(3)));
    assert.deepEqual(['x', 'y', 'z'].map((k) => r[`Normal ${k}`]), ['0.0000', '0.0000', '1.0000']);
    assert.equal(r.Equation, '0.0000 x + 0.0000 y + 1.0000 z = 10.000');
    assert.equal(r['RMS deviation'], '0.000');
    assert.equal(r.Coordinates, 'as in box.stl');
    assert.deepEqual(d.copy.split('\n'), [
      'name\tfitted_to\tpoint_x\tpoint_y\tpoint_z\tnormal_x\tnormal_y\tnormal_z\td\trms_deviation\tmax_deviation\ttriangles',
      ['Plane 1', 'Region 1', ...p.point, ...p.normal, p.d, p.rms, p.maxDeviation, p.faceCount].join('\t'),
    ]);
  });
});

describe('planes and cylinders in the 3D view', () => {
  test('each is drawn under its mesh, placed and turned as fitted, with a centre mark that selects it', async () => {
    const { fits, regions, addCurve, mesh, view, viewer } = await example();
    const region = regions.create(addCurve(mesh.id, shaftRing(20)).id);
    regions.addBoundary(region.id, addCurve(mesh.id, shaftRing(80)).id);
    const c = fits.create(region.id, 'cylinder');
    const obj = view.objectOf(c.id);
    assert.equal(obj.parent, view.objectOf(mesh.id));
    const outline = obj.getObjectByName('outline');
    const mid = c.ends[0].map((v, i) => (v + c.ends[1][i]) / 2);
    nearVec(outline.position.toArray(), mid, 1e-6);
    nearVec(new THREE.Vector3(0, 1, 0).applyQuaternion(outline.quaternion).toArray(), c.direction, 1e-6);
    nearVec(outline.scale.toArray(), [c.radius, c.length, c.radius], 1e-6);
    assert.equal(view.fitAt(...screenOf(viewer, obj.getObjectByName('centre').position.toArray())), c.id);

    const p = fits.create(region.id, 'plane');
    const pobj = view.objectOf(p.id);
    nearVec(pobj.getObjectByName('outline').position.toArray(), p.point, 1e-6);
    nearVec(new THREE.Vector3(0, 0, 1).applyQuaternion(pobj.getObjectByName('outline').quaternion).toArray(), p.normal, 1e-6);
    assert.ok(pobj.getObjectByName('fill'));
  });

  test('a fit with a problem is not drawn', async () => {
    const { fits, addCurve, mesh, view, engine } = await example();
    const curve = addCurve(mesh.id, [onShaft(0, 30), onShaft(0, 60), onShaft(0, 90)], { closed: false });
    const p = fits.create(curve.id, 'plane');
    assert.equal(p.error, 'line', 'three points straight up the shaft lie on a line');
    assert.equal(view.objectOf(p.id).visible, false);
    void engine;
  });
});
