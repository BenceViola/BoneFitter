import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadMeshBuffer } from '../../js/mesh-loader.js';
import { makeExampleStl, EXAMPLE } from '../../js/sample.js';
import { meshFields } from '../../js/opening.js';
import { meshFromRegion } from '../../js/extract.js';
import { sceneDoc, restoreScene, stringify, SceneFileError } from '../../js/scene-file.js';
import { scene } from '../scene-helpers.js';

const unit = (v) => v.map((x) => x / Math.hypot(...v));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// A loop round a ball's cap facing `dir`.
const cap = (c, R, dir, angle = 35, n = 10) => {
  const e1 = unit(Math.abs(dir[2]) < 0.9 ? cross(dir, [0, 0, 1]) : cross(dir, [1, 0, 0]));
  const e2 = cross(dir, e1);
  const a = (angle * Math.PI) / 180;
  return Array.from({ length: n }, (_, k) => {
    const t = (2 * Math.PI * k) / n;
    return c.map((v, i) => v + R * (Math.cos(a) * dir[i] + Math.sin(a) * (Math.cos(t) * e1[i] + Math.sin(t) * e2[i])));
  });
};

async function femurScene() {
  const s = scene([0, 0, 300], EXAMPLE.shaft.point);
  const loaded = await loadMeshBuffer(makeExampleStl(), EXAMPLE.file);
  const mesh = s.model.add('mesh', meshFields(loaded, { name: 'Example femur', example: true }));
  s.view.addMesh(mesh, loaded.geometry);
  return { ...s, mesh };
}

// Everything the app can make, on the example.
async function fullScene() {
  const s = await femurScene();
  const { model, regions, fits, constructs, mesh } = s;
  const headLoop = s.addCurve(mesh.id, cap(EXAMPLE.head.centre, 12, EXAMPLE.neck.direction));
  const condLoop = s.addCurve(mesh.id, cap(EXAMPLE.condyles[0].centre, 11, [0, -1, 0]));
  const open = s.addCurve(mesh.id, cap(EXAMPLE.head.centre, 12, EXAMPLE.neck.direction, 50).slice(0, 4), { closed: false });
  const head = regions.create(headLoop.id);
  const cond = regions.create(condLoop.id);
  regions.set(cond.id, { flipped: false });
  const sphere = fits.create(head.id, 'sphere');
  const condSphere = fits.create(cond.id, 'sphere');
  const plane = fits.create(cond.id, 'plane');
  fits.set(plane.id, { flipped: true });
  const curvePlane = fits.create(open.id, 'plane');
  const centre = constructs.create('point', 'centre', [sphere.id]);
  const placed = constructs.placePoint({ id: mesh.id, position: cap(EXAMPLE.head.centre, 12, EXAMPLE.neck.direction, 0)[0], anchor: { face: 0 } });
  const line = constructs.create('line', 'two-points', [condSphere.id, centre.id]);
  constructs.set(line.id, { flipped: true });
  const axes = constructs.create('frame', 'point-directions', [centre.id, line.id, plane.id]);
  constructs.set(axes.id, { primary: 'z', secondary: 'x' });
  const dist = constructs.create('measure', 'points', [condSphere.id, sphere.id]);
  const angle = constructs.create('measure', 'angle', [line.id, plane.id]);
  const coords = constructs.create('measure', 'coords', [placed.id, axes.id]);
  const orient = constructs.create('orient', 'frame', [axes.id]);
  const section = constructs.create('section', 'plane', [plane.id]);
  model.update(curvePlane.id, { visible: false });
  model.rename?.(open.id, 'Rim');
  const derived = await meshFromRegion({ model, view: s.view }, head.id);
  return { ...s, nodes: { headLoop, open, head, cond, sphere, condSphere, plane, curvePlane, centre, placed, line, axes, dist, angle, coords, orient, section }, derived };
}

const app = (s, extra = {}) => ({ model: s.model, view: s.view, engine: s.engine, regions: s.regions, fits: s.fits, constructs: s.constructs, ...extra });
const byName = (model) => new Map([...model.nodes.values()].map((n) => [n.name + ':' + n.kind, n]));

describe('saving a scene', () => {
  test('the document lists meshes by SHA-256 with their placement, and every object with its inputs and its result', async () => {
    const s = await fullScene();
    const doc = sceneDoc(s.model);
    assert.equal(doc.format, 'bonefitter-scene');
    assert.equal(doc.version, '0.1.0');
    assert.equal(doc.provenance.software, 'BoneFitter');
    assert.equal(doc.meshes.length, 2);
    const [m, d] = doc.meshes;
    assert.equal(m.sha256, s.mesh.sha256);
    assert.equal(m.example, true);
    assert.deepEqual(m.placement, s.model.get(s.mesh.id).placement, 'where it sat');
    assert.equal(d.made_from.meshId, s.mesh.id);
    assert.equal(d.made_from.faces.length, s.nodes.head.faceCount);
    const rec = (id) => doc.objects.find((o) => o.id === id);
    const line = rec(s.nodes.line.id);
    assert.deepEqual(line.inputs, [s.nodes.condSphere.id, s.nodes.centre.id]);
    assert.equal(line.flipped, true);
    assert.deepEqual(line.result.direction, s.nodes.line.direction, 'the result, for anyone reading the file');
    const curve = rec(s.nodes.headLoop.id);
    assert.equal(curve.control_points.length, 10);
    assert.equal(curve.result.line, undefined, 'the computed path is left out (it is made again)');
    assert.equal(rec(s.nodes.head.id).result.faces, undefined, 'and a region\'s face list');
    assert.equal(rec(s.nodes.curvePlane.id).visible, false);
    const section = rec(s.nodes.section.id);
    assert.deepEqual(section.inputs, [s.nodes.plane.id]);
    assert.equal(section.result.segments, undefined, 'the outline is written once, as its loops');
    assert.ok(section.result.loops.length > 0);
    // Plain JSON, nothing lost in writing it.
    assert.deepEqual(JSON.parse(stringify(doc)), doc);
    assert.match(stringify(doc), /"centre": \[-?[\d.]+, -?[\d.]+, -?[\d.]+\]/, 'coordinates on one line');
  });
});

describe('opening a saved scene', () => {
  test('into an empty scene with the mesh open: everything comes back, the same, made again from its inputs', async () => {
    const s = await fullScene();
    const doc = JSON.parse(stringify(sceneDoc(s.model)));
    const t = await femurScene();
    const r = await restoreScene(app(t), doc, 'femur.bonefitter.json');
    assert.equal(r.objects, doc.objects.length);
    const before = byName(s.model);
    const after = byName(t.model);
    assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort(), 'the same objects, with the same names');
    for (const [key, old] of before) {
      const now = after.get(key);
      for (const f of ['position', 'centre', 'radius', 'normal', 'direction', 'value', 'values', 'length', 'faceCount', 'area', 'origin', 'x', 'z', 'placement', 'visible', 'flipped', 'primary', 'secondary', 'closed', 'perimeter', 'loopCount', 'moments']) {
        if (old[f] === undefined) continue;
        assert.deepEqual(JSON.parse(JSON.stringify(now[f])), JSON.parse(JSON.stringify(old[f])), `${key} ${f}`);
      }
    }
    // Ids are new, references follow them.
    const line = after.get('Line 1:line');
    assert.deepEqual(line.inputs, [after.get('Sphere 2:sphere').id, after.get('Point 1:point').id]);
    assert.equal(t.model.get(line.inputs[0]).kind, 'sphere');
    // The mesh made from a region was made again from the original (its own file isn't open).
    const derived = t.model.meshes().find((m) => m.madeFrom);
    assert.equal(derived.sha256, s.derived.sha256);
    // A new object afterwards doesn't repeat a restored name.
    const next = t.constructs.create('measure', 'points', [after.get('Sphere 1:sphere').id, after.get('Point 1:point').id]);
    assert.equal(next.name, 'Distance 2');
    const curve = t.model.add('curve', { parent: t.mesh.id, control_points: [] });
    assert.equal([...t.model.nodes.values()].filter((n) => n.name === curve.name).length, 1, `${curve.name} is new`);
  });

  test('the scene follows its inputs again afterwards: moving a curve point refits and remeasures', async () => {
    const s = await fullScene();
    const t = await femurScene();
    await restoreScene(app(t), sceneDoc(s.model));
    const after = byName(t.model);
    const loop = after.get('Curve 1:curve');
    const region = after.get('Region 1:region');
    const before = region.faceCount;
    t.engine.set(loop.id, { control_points: loop.control_points.slice(0, 7) });
    assert.notEqual(region.faceCount, before, 'the region follows its curve');
  });

  test('a mesh that isn\'t open: nothing is restored and the message names it', async () => {
    const s = await fullScene();
    const doc = sceneDoc(s.model);
    doc.meshes[0].sha256 = 'f'.repeat(64);
    doc.meshes[0].file = 'femur_014.ply';
    const t = await femurScene();
    const count = t.model.nodes.size;
    await assert.rejects(() => restoreScene(app(t), doc, 'femur.bonefitter.json'), (err) => {
      assert.ok(err instanceof SceneFileError);
      assert.match(err.message, /^“femur\.bonefitter\.json” needs the mesh “femur_014\.ply”, which isn’t open\. Open it together with the scene file/);
      return true;
    });
    assert.equal(t.model.nodes.size, count);
  });

  test('a file that isn\'t a scene, or a scene from a newer major version, is refused', async () => {
    const t = await femurScene();
    await assert.rejects(() => restoreScene(app(t), { format: 'landmark-json' }, 'x.json'), /“x\.json” is not a BoneFitter scene/);
    await assert.rejects(() => restoreScene(app(t), { format: 'bonefitter-scene', version: '1.0.0', meshes: [], objects: [] }, 'x.json'), /format version 1\.0\.0/);
  });
});
