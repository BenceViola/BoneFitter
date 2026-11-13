import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadMeshBuffer } from '../../js/mesh-loader.js';
import { makeExampleStl, EXAMPLE } from '../../js/sample.js';
import { meshFields } from '../../js/opening.js';
import { applyPlacement } from '../../js/apply-placement.js';
import { sceneDoc, restoreScene, stringify } from '../../js/scene-file.js';
import { place, turn } from '../../js/placement.js';
import { stlBytes } from '../../js/mesh-export.js';
import { scene } from '../scene-helpers.js';

const near = (a, b, tol, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} ≉ ${b} (±${tol})`);
const nearVec = (a, b, tol, msg = '') => a.forEach((v, i) => near(v, b[i], tol, `${msg}[${i}]`));
const unit = (v) => v.map((x) => x / Math.hypot(...v));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const cap = (c, R, dir, angle = 35, n = 10) => {
  const e1 = unit(Math.abs(dir[2]) < 0.9 ? cross(dir, [0, 0, 1]) : cross(dir, [1, 0, 0]));
  const e2 = cross(dir, e1);
  const a = (angle * Math.PI) / 180;
  return Array.from({ length: n }, (_, k) => {
    const t = (2 * Math.PI * k) / n;
    return c.map((v, i) => v + R * (Math.cos(a) * dir[i] + Math.sin(a) * (Math.cos(t) * e1[i] + Math.sin(t) * e2[i])));
  });
};

async function femur() {
  const s = scene([0, 0, 300], EXAMPLE.shaft.point);
  const loaded = await loadMeshBuffer(makeExampleStl(), EXAMPLE.file);
  const mesh = s.model.add('mesh', meshFields(loaded, { name: 'Example femur', example: true }));
  s.view.addMesh(mesh, loaded.geometry);
  return { ...s, mesh };
}
// The femur stood on a plane under a condyle, with a head sphere and a point on it.
async function oriented() {
  const s = await femur();
  const head = s.regions.create(s.addCurve(s.mesh.id, cap(EXAMPLE.head.centre, 12, EXAMPLE.neck.direction)).id);
  const sphere = s.fits.create(head.id, 'sphere');
  const condyle = s.regions.create(s.addCurve(s.mesh.id, cap(EXAMPLE.condyles[0].centre, 11, [0, -1, 0])).id);
  const plane = s.fits.create(condyle.id, 'plane');
  const p = s.constructs.placePoint({ id: s.mesh.id, position: cap(EXAMPLE.head.centre, 12, EXAMPLE.neck.direction, 0)[0], anchor: { face: 0, bary: [1, 0, 0] } });
  const d = s.constructs.create('measure', 'points', [sphere.id, p.id]);
  s.constructs.create('orient', 'plane', [plane.id]);
  return { ...s, sphere, plane, p, d, placement: s.model.get(s.mesh.id).placement };
}
const app = (s) => ({ model: s.model, view: s.view, engine: s.engine, regions: s.regions, fits: s.fits, constructs: s.constructs });

describe('applying a placement to a mesh\'s coordinates', () => {
  test('a new mesh with the turned and shifted coordinates; the original is kept as it was, hidden', async () => {
    const s = await oriented();
    const before = Array.from(s.view.sources.get(s.mesh.id).attributes.position.array);
    const m = await applyPlacement(app(s), s.mesh.id);
    assert.equal(m.kind, 'mesh');
    assert.equal(m.name, 'Example femur (oriented)');
    assert.equal(m.file, 'example-femur-oriented.stl');
    assert.equal(m.placement ?? null, null, 'it sits where its own coordinates put it');
    assert.equal(m.faceCount, s.mesh.faceCount);
    assert.deepEqual(m.appliedFrom.placement, s.placement);
    assert.equal(m.appliedFrom.meshId, s.mesh.id);
    // Its vertices are the original's, placed (to float precision, as in an STL file).
    const src = s.view.sources.get(s.mesh.id).attributes.position;
    const out = s.view.sources.get(m.id).attributes.position;
    for (const i of [0, 1234, src.count - 1]) nearVec([out.getX(i), out.getY(i), out.getZ(i)], place(s.placement, [src.getX(i), src.getY(i), src.getZ(i)]), 1e-3, `vertex ${i}`);
    // Where it is drawn is where the original was shown.
    // The original: untouched, still placed, hidden.
    assert.deepEqual(Array.from(s.view.sources.get(s.mesh.id).attributes.position.array), before);
    assert.deepEqual(s.model.get(s.mesh.id).placement, s.placement);
    assert.equal(s.model.get(s.mesh.id).visible, false);
    // Its SHA-256 is that of the STL file Save as STL writes, so the saved file is recognised.
    const again = await loadMeshBuffer(stlBytes(s.view.sources.get(m.id)), 'x.stl');
    assert.equal(again.sha256, m.sha256);
  });

  test('the work on the mesh comes along, in the new coordinates; the orientation does not', async () => {
    const s = await oriented();
    const m = await applyPlacement(app(s), s.mesh.id);
    const under = [...s.model.nodes.values()].filter((n) => s.model.meshOf(n.id)?.id === m.id && n.id !== m.id);
    assert.deepEqual(under.map((n) => `${n.kind}:${n.name}`), ['curve:Curve 1', 'region:Region 1', 'sphere:Sphere 1', 'curve:Curve 2', 'region:Region 2', 'plane:Plane 1', 'point:Point 1', 'measure:Distance 1']);
    const get = (kind, name) => under.find((n) => n.kind === kind && n.name === name);
    // Fitted again on the new mesh: the head sphere is where the original's is shown.
    nearVec(get('sphere', 'Sphere 1').centre, place(s.placement, s.sphere.centre), 2e-3);
    near(get('sphere', 'Sphere 1').radius, s.sphere.radius, 1e-3);
    nearVec(get('point', 'Point 1').position, place(s.placement, s.p.position), 1e-9);
    nearVec(get('plane', 'Plane 1').normal, turn(s.placement, s.plane.normal), 1e-4);
    // The plane it stood on is now the floor: normal straight down.
    nearVec(get('plane', 'Plane 1').normal, [0, 0, -1], 1e-4);
    near(get('measure', 'Distance 1').value, s.d.value, 2e-3, 'lengths don\'t change');
    assert.equal(under.some((n) => n.kind === 'orient'), false);
  });

  test('a mesh that hasn\'t been moved has nothing to apply', async () => {
    const s = await femur();
    assert.equal(await applyPlacement(app(s), s.mesh.id), null);
  });

  test('a saved scene makes the new mesh again from its original if its own file isn\'t open', async () => {
    const s = await oriented();
    const m = await applyPlacement(app(s), s.mesh.id);
    const doc = JSON.parse(stringify(sceneDoc(s.model)));
    assert.equal(doc.meshes[1].applied_from.meshId, s.mesh.id);
    const t = await femur();
    await restoreScene(app(t), doc);
    const made = t.model.meshes().find((x) => x.appliedFrom);
    assert.equal(made.sha256, m.sha256);
    assert.equal(made.visible, true);
    assert.equal(t.model.meshes().find((x) => x.example && !x.appliedFrom).visible, false);
  });
});
