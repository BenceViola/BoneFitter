import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadMeshBuffer } from '../../js/mesh-loader.js';
import { makeExampleStl, EXAMPLE } from '../../js/sample.js';
import { scene } from '../scene-helpers.js';
import { describe as describeNode } from '../../js/properties-panel.js';

const near = (a, b, tol, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} ≉ ${b} (±${tol})`);
const nearVec = (a, b, tol, msg = '') => a.forEach((v, i) => near(v, b[i], tol, `${msg}[${i}]`));
const unit = (v) => v.map((x) => x / Math.hypot(...v));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// The example femur with cylinders fitted to bands of its shaft and neck,
// and spheres fitted to caps of its head and both condyles.
let cached;
async function femur() {
  const s = scene([0, 0, 300], EXAMPLE.shaft.point);
  const mesh = await loadMeshBuffer(makeExampleStl(), EXAMPLE.file);
  const m = s.model.add('mesh', { name: 'Example femur', file: EXAMPLE.file, faceCount: mesh.faceCount });
  s.view.addMesh(m, mesh.geometry);
  // A band round an axis: two rings, a region between them, a cylinder.
  const band = (point, dir, r, t0, t1) => {
    const e1 = unit(Math.abs(dir[2]) < 0.9 ? cross(dir, [0, 0, 1]) : cross(dir, [1, 0, 0]));
    const e2 = cross(dir, e1);
    const ring = (t) => Array.from({ length: 12 }, (_, k) => {
      const a = (2 * Math.PI * k) / 12;
      return point.map((v, i) => v + t * dir[i] + r * (Math.cos(a) * e1[i] + Math.sin(a) * e2[i]));
    });
    const top = s.addCurve(m.id, ring(t1));
    const region = s.regions.create(top.id);
    s.regions.addBoundary(region.id, s.addCurve(m.id, ring(t0)).id);
    return s.fits.create(region.id, 'cylinder');
  };
  // A cap round a direction on a ball, and its sphere.
  const cap = (centre, r, dir) => {
    const e1 = unit(Math.abs(dir[2]) < 0.9 ? cross(dir, [0, 0, 1]) : cross(dir, [1, 0, 0]));
    const e2 = cross(dir, e1);
    const a = (35 * Math.PI) / 180;
    const loop = Array.from({ length: 10 }, (_, k) => {
      const t = (2 * Math.PI * k) / 10;
      return centre.map((v, i) => v + r * (Math.cos(a) * dir[i] + Math.sin(a) * (Math.cos(t) * e1[i] + Math.sin(t) * e2[i])));
    });
    return s.fits.create(s.regions.create(s.addCurve(m.id, loop).id).id, 'sphere');
  };
  const shaft = band(EXAMPLE.shaft.point, [0, 1, 0], 7, 30, 70);
  const neck = band(EXAMPLE.neck.point, EXAMPLE.neck.direction, 5, 9, 16);
  const head = cap(EXAMPLE.head.centre, 12, EXAMPLE.neck.direction);
  const medial = cap(EXAMPLE.condyles[0].centre, 11, [0, -1, 0]);
  const lateral = cap(EXAMPLE.condyles[1].centre, 11, [0, -1, 0]);
  const c = s.constructs;
  return { ...s, mesh: m, shaft, neck, head, medial, lateral, shaftAxis: c.create('line', 'axis', [shaft.id]), neckAxis: c.create('line', 'axis', [neck.id]) };
}

describe('measuring the example femur', () => {
  test('the neck-shaft angle: 125°, as built (with the shaft axis pointing down)', async () => {
    const f = await femur();
    const angle = f.constructs.create('measure', 'angle', [f.shaftAxis.id, f.neckAxis.id]);
    assert.equal(angle.name, 'Angle 1');
    assert.equal(angle.unit, 'degrees');
    assert.equal(angle.between, 'lines');
    // Both axes point up (largest component positive): 55° between them.
    near(angle.value, 180 - EXAMPLE.neckShaftAngle, 0.05);
    near(angle.acute, 55, 0.05);
    // Flip the shaft axis to point down the shaft: the measurement follows.
    f.constructs.set(f.shaftAxis.id, { flipped: true });
    near(angle.value, EXAMPLE.neckShaftAngle, 0.05);
    // A cylinder counts as its axis: the same angle straight from the fits.
    near(f.constructs.create('measure', 'angle', [f.shaft.id, f.neck.id]).value, 55, 0.05);
  });

  test('femoral torsion: the neck against the condyles, seen on the plane square to the shaft — 0° on the example', async () => {
    const f = await femur();
    const condylar = f.constructs.create('line', 'two-points', [f.lateral.id, f.medial.id]);
    const t = f.constructs.create('measure', 'on-plane', [condylar.id, f.neckAxis.id, f.shaftAxis.id]);
    near(Math.abs(t.value), 0, 0.1, 'the neck lies in the plane of the condyles');
    // From medial to lateral the condylar axis points the other way: 180°.
    const back = f.constructs.create('line', 'two-points', [f.medial.id, f.lateral.id]);
    near(Math.abs(f.constructs.create('measure', 'on-plane', [back.id, f.neckAxis.id, f.shaftAxis.id]).value), 180, 0.1);
  });

  test('distances: head centre to the condyle centres, to the shaft axis (the offset), to a plane', async () => {
    const f = await femur();
    const d = f.constructs.create('measure', 'points', [f.medial.id, f.head.id]);
    assert.equal(d.name, 'Distance 1');
    const span = EXAMPLE.head.centre.map((v, i) => v - EXAMPLE.condyles[0].centre[i]);
    near(d.value, Math.hypot(...span), 0.01);
    nearVec(d.delta, span, 0.01);
    assert.equal(d.segments.length, 1);
    // Femoral offset: the head centre from the shaft axis.
    const offset = f.constructs.create('measure', 'point-line', [f.head.id, f.shaftAxis.id]);
    near(offset.value, EXAMPLE.head.centre[0] - EXAMPLE.shaft.point[0], 0.01);
    // Shortest distance between the shaft and neck axes: they cross at the top of the shaft.
    near(f.constructs.create('measure', 'lines', [f.shaftAxis.id, f.neckAxis.id]).value, 0, 0.01);
  });

  test('a coordinate system on the femur: origin at the head, Z up the shaft, X along the neck', async () => {
    const f = await femur();
    const axes = f.constructs.create('frame', 'point-directions', [f.head.id, f.shaftAxis.id, f.neckAxis.id]);
    assert.equal(axes.name, 'Axes 1');
    assert.equal(axes.parent, f.mesh.id);
    assert.equal(axes.primary, 'x');
    nearVec(axes.x, [0, 1, 0], 1e-3, 'the first direction gives X (by default)');
    f.constructs.set(axes.id, { primary: 'z', secondary: 'x' });
    nearVec(axes.z, [0, 1, 0], 1e-3, 'now Z');
    nearVec(axes.x, [1, 0, 0], 1e-3, 'the neck, squared up to the shaft, along X');
    nearVec(axes.y, [0, 0, -1], 1e-3, 'right-handed: y = z × x');
    nearVec(axes.origin, EXAMPLE.head.centre, 0.01);
    // The medial condyle's centre in it.
    const c = f.constructs.create('measure', 'coords', [f.medial.id, axes.id]);
    assert.equal(c.name, 'Coordinates 1');
    const rel = EXAMPLE.condyles[0].centre.map((v, i) => v - EXAMPLE.head.centre[i]);
    nearVec(c.values, [rel[0], rel[2] * -1, rel[1]], 0.02);
    // Properties: the axes and the coordinates, ready to copy.
    const p = describeNode(f.model, c.id);
    assert.equal(p.rows.find(([k]) => k === 'In')[1], 'Axes 1');
    assert.match(p.copy, /^name\tpoint\taxes\tx\ty\tz\n/);
  });

  test('three points: origin, the first axis towards the second point, the second leaning to the third', async () => {
    const f = await femur();
    const axes = f.constructs.create('frame', 'three-points', [f.medial.id, f.lateral.id, f.head.id]);
    nearVec(axes.x, [-1, 0, 0], 1e-3, 'condyles[0] is at +x, condyles[1] at −x');
    assert.ok(axes.y[1] > 0.99, 'Y towards the head');
    assert.equal(f.constructs.create('frame', 'three-points', [f.medial.id, f.medial.id, f.head.id]).error, 'same');
  });

  test('an angle at a corner: at the medial condyle, between the head and the lateral condyle', async () => {
    const f = await femur();
    const a = f.constructs.create('measure', 'corner', [f.medial.id, f.head.id, f.lateral.id]);
    const u = unit(EXAMPLE.head.centre.map((v, i) => v - EXAMPLE.condyles[0].centre[i]));
    const w = unit(EXAMPLE.condyles[1].centre.map((v, i) => v - EXAMPLE.condyles[0].centre[i]));
    near(a.value, (Math.acos(u.reduce((s, v, i) => s + v * w[i], 0)) * 180) / Math.PI, 0.05);
    assert.equal(a.segments.length, 2);
  });

  test('a measurement follows its inputs and goes with them', async () => {
    const f = await femur();
    const d = f.constructs.create('measure', 'points', [f.medial.id, f.head.id]);
    const before = d.value;
    f.fits.set(f.head.id, {});
    near(d.value, before, 1e-9);
    f.model.remove(f.head.id);
    assert.equal(f.model.get(d.id), null);
  });
});
