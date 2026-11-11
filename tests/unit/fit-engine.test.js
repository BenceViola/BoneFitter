import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadMeshBuffer } from '../../js/mesh-loader.js';
import { makeExampleStl, EXAMPLE } from '../../js/sample.js';
import { describe as describeNode } from '../../js/properties-panel.js';
import { scene, screenOf, events } from '../scene-helpers.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≉ ${b} (±${tol})`);
const nearVec = (a, b, tol, msg) => a.forEach((v, i) => near(v, b[i], tol, `${msg ?? ''}[${i}]`));
const unit = (v) => v.map((x) => x / Math.hypot(...v));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// On the example's head, around the point straight out along the neck:
// n points on the circle `angle` degrees from it.
const AXIS = unit(EXAMPLE.neck.direction);
const E1 = unit(cross(AXIS, [0, 0, 1]));
const E2 = cross(AXIS, E1);
const R = EXAMPLE.head.radius;
const onHead = (angle, t) => {
  const a = (angle * Math.PI) / 180;
  return EXAMPLE.head.centre.map((c, i) => c + R * (Math.cos(a) * AXIS[i] + Math.sin(a) * (Math.cos(t) * E1[i] + Math.sin(t) * E2[i])));
};
const ring = (angle, n = 12) => Array.from({ length: n }, (_, k) => onHead(angle, (2 * Math.PI * k) / n));

// The example femur, seen from straight out along the neck, with a loop on its head.
async function setup(angle = 40) {
  const eye = EXAMPLE.head.centre.map((c, i) => c + 80 * AXIS[i]);
  const s = scene(eye, EXAMPLE.head.centre);
  const mesh = await loadMeshBuffer(makeExampleStl(), EXAMPLE.file);
  const node = s.model.add('mesh', { name: 'Example femur', file: EXAMPLE.file, faceCount: mesh.faceCount });
  s.view.addMesh(node, mesh.geometry);
  const curve = s.addCurve(node.id, ring(angle));
  const region = s.regions.create(curve.id);
  return { ...s, mesh: node, curve, region };
}

describe('fitting a sphere to a region', () => {
  test('on the example\'s head it gives back the head: centre and radius', async () => {
    const { fits, region, mesh } = await setup();
    const sphere = fits.create(region.id);
    assert.equal(sphere.kind, 'sphere');
    assert.equal(sphere.name, 'Sphere 1');
    assert.equal(sphere.parent, mesh.id, 'attached to the mesh, in its file\'s coordinates');
    assert.equal(sphere.source, region.id);
    assert.equal(sphere.error, null);
    nearVec(sphere.centre, EXAMPLE.head.centre, 1e-3);
    near(sphere.radius, EXAMPLE.head.radius, 1e-3);
    assert.ok(sphere.rms < 1e-3 && sphere.maxDeviation < 1e-3, 'the head\'s corners are on the sphere');
    assert.equal(sphere.faceCount, region.faceCount);
    near(sphere.area, region.area, 1e-6);
    // A loop 40° round: a cap covering (1 − cos 40°)/2 of the sphere, give or take a triangle at its edge.
    near(sphere.coverage, (1 - Math.cos((40 * Math.PI) / 180)) / 2, 0.01);
  });

  test('a shallow patch (a cap of 15°) still finds the head', async () => {
    const { fits, region } = await setup(15);
    const sphere = fits.create(region.id);
    nearVec(sphere.centre, EXAMPLE.head.centre, 1e-3);
    near(sphere.radius, EXAMPLE.head.radius, 1e-3);
    assert.ok(sphere.coverage < 0.03);
  });

  test('the sphere follows its region: moving a point of the curve refits it', async () => {
    const { fits, region, engine, curve, cp, mesh, model } = await setup(30);
    const sphere = fits.create(region.id);
    const before = sphere.coverage;
    const points = curve.control_points.slice();
    points[0] = cp(mesh.id, onHead(55, 0));
    const seen = events(model);
    engine.set(curve.id, { control_points: points });
    assert.ok(sphere.coverage > before, 'it covers more of the head now');
    near(sphere.radius, EXAMPLE.head.radius, 1e-3, 'and is still the head');
    assert.ok(seen.some((e) => e.kind === 'update' && e.ids.includes(sphere.id)));
  });

  test('a region that encloses nothing leaves the sphere with a problem until it is put right', async () => {
    const { fits, region, regions, engine, curve, cp, mesh } = await setup(30);
    const sphere = fits.create(region.id);
    const good = curve.control_points;
    const [a, b, c, d] = [0, 3, 6, 9].map((k) => good[k]);
    engine.set(curve.id, { control_points: [a, c, b, d] }); // a crossing loop
    assert.equal(region.error, 'crossing');
    assert.equal(sphere.error, 'region');
    assert.equal(sphere.centre, null);
    engine.set(curve.id, { control_points: good });
    assert.equal(sphere.error, null);
    near(sphere.radius, EXAMPLE.head.radius, 1e-3);
    void regions;
    void cp;
    void mesh;
  });

  test('"the other side" of a loop on the head is the rest of the head (a separate piece in the example): the same sphere, covering more', async () => {
    const { fits, region, regions } = await setup(40);
    const sphere = fits.create(region.id);
    const inside = sphere.coverage;
    regions.set(region.id, { flipped: true });
    assert.equal(sphere.error, null);
    near(sphere.radius, EXAMPLE.head.radius, 1e-3);
    near(sphere.coverage, 1 - inside, 0.01);
  });

  test('removing the region removes the spheres fitted to it, and removing the curve does too', async () => {
    const { fits, region, model, curve } = await setup();
    const a = fits.create(region.id);
    const b = fits.create(region.id);
    assert.equal(b.name, 'Sphere 2');
    model.remove(curve.id);
    assert.equal(model.get(region.id), null);
    assert.equal(model.get(a.id), null);
    assert.equal(model.get(b.id), null);
  });

  test('only a region can be fitted to', async () => {
    const { fits, curve, mesh } = await setup();
    assert.equal(fits.create(curve.id), null);
    assert.equal(fits.create(mesh.id), null);
    assert.equal(fits.create('nope'), null);
  });

  test('the source geometry is only read', async () => {
    const { fits, region, view, mesh } = await setup();
    const g = view.sources.get(mesh.id);
    const before = g.attributes.position.array.slice();
    fits.create(region.id);
    assert.deepEqual(g.attributes.position.array, before);
  });
});

describe('a fitted sphere in the 3D view and in Properties', () => {
  const rows = (d) => Object.fromEntries(d.rows.map(([k, v]) => [k, v]));

  test('drawn under its mesh as an outline at its centre and radius, with a centre mark', async () => {
    const { fits, region, view, mesh, model } = await setup();
    const sphere = fits.create(region.id);
    const obj = view.objectOf(sphere.id);
    assert.equal(obj.parent, view.objectOf(mesh.id));
    const outline = obj.getObjectByName('outline');
    nearVec(outline.position.toArray(), sphere.centre, 1e-9);
    near(outline.scale.x, sphere.radius, 1e-9);
    nearVec(obj.getObjectByName('centre').position.toArray(), sphere.centre, 1e-9);
    assert.equal(obj.visible, true);
    model.setVisible(sphere.id, false);
    assert.equal(obj.visible, false);
    model.remove(mesh.id);
    assert.equal(view.objectOf(sphere.id), null);
  });

  test('a sphere with a problem is not drawn', async () => {
    const { fits, region, regions, view, engine, curve } = await setup(30);
    const sphere = fits.create(region.id);
    const [a, b, c, d] = [0, 3, 6, 9].map((k) => curve.control_points[k]);
    engine.set(curve.id, { control_points: [a, c, b, d] });
    assert.equal(view.objectOf(sphere.id).visible, false);
    void regions;
  });

  test('fitAt finds a sphere by its centre mark, which shows through the mesh', async () => {
    const { fits, region, view, viewer, model } = await setup();
    const sphere = fits.create(region.id);
    assert.equal(view.fitAt(...screenOf(viewer, EXAMPLE.head.centre)), sphere.id);
    assert.equal(view.fitAt(5, 5), null);
    model.setVisible(sphere.id, false);
    assert.equal(view.fitAt(...screenOf(viewer, EXAMPLE.head.centre)), null);
  });

  test('Properties: what it was fitted to, centre, radius, how well it fits, and a row to copy', async () => {
    const { fits, region, model } = await setup();
    const sphere = fits.create(region.id);
    const d = describeNode(model, sphere.id);
    const r = rows(d);
    assert.equal(d.kind, 'Sphere');
    assert.equal(r['Fitted to'], 'Region 1');
    assert.deepEqual(['x', 'y', 'z'].map((k) => r[`Centre ${k}`]), sphere.centre.map((v) => v.toFixed(3)));
    assert.equal(r.Radius, '12.000');
    assert.equal(r.Diameter, '24.000');
    assert.equal(r['RMS deviation'], sphere.rms.toFixed(3));
    assert.equal(r['Largest deviation'], sphere.maxDeviation.toFixed(3));
    assert.match(r.Coverage, /^\d+\.\d% of the sphere \(a cap of \d+°\)$/);
    assert.equal(r.Triangles, sphere.faceCount.toLocaleString('en-US'));
    assert.equal(r.Coordinates, `as in ${EXAMPLE.file}`);
    assert.equal(r.Note, undefined);
    assert.deepEqual(d.copy.split('\n'), [
      'name\tfitted_to\tcentre_x\tcentre_y\tcentre_z\tradius\trms_deviation\tmax_deviation\tcoverage\ttriangles',
      ['Sphere 1', 'Region 1', ...sphere.centre, sphere.radius, sphere.rms, sphere.maxDeviation, sphere.coverage, sphere.faceCount].join('\t'),
    ]);
  });

  test('a shallow patch is noted: the radius is less certain', async () => {
    const { fits, region, model } = await setup(15);
    const sphere = fits.create(region.id);
    assert.match(rows(describeNode(model, sphere.id)).Note, /small part of the sphere/);
  });

  test('a problem is explained instead of numbers', async () => {
    const { fits, region, model, engine, curve } = await setup(30);
    const sphere = fits.create(region.id);
    const [a, b, c, d] = [0, 3, 6, 9].map((k) => curve.control_points[k]);
    engine.set(curve.id, { control_points: [a, c, b, d] });
    const shown = describeNode(model, sphere.id);
    assert.match(rows(shown).Problem, /Region 1.*encloses nothing/);
    assert.equal(rows(shown).Radius, undefined);
    assert.equal(shown.copy, null);
  });
});
