import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { landmarkDoc, sceneFromLandmarkDoc } from '../../js/landmark-export.js';
import { restoreScene, stringify } from '../../js/scene-file.js';
import { parseLandmarkFile } from '../../js/landmark-file.js';
import { addLandmarks } from '../../js/opening.js';
import { loadMeshBuffer } from '../../js/mesh-loader.js';
import { makeExampleStl, EXAMPLE } from '../../js/sample.js';
import { meshFields } from '../../js/opening.js';
import { scene } from '../scene-helpers.js';

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
async function work() {
  const s = await femur();
  const loop = s.addCurve(s.mesh.id, cap(EXAMPLE.head.centre, 12, EXAMPLE.neck.direction));
  const region = s.regions.create(loop.id);
  const sphere = s.fits.create(region.id, 'sphere');
  const p = s.constructs.placePoint({ id: s.mesh.id, position: cap(EXAMPLE.head.centre, 12, EXAMPLE.neck.direction, 0)[0], anchor: { face: 7, bary: [0.2, 0.3, 0.5] } });
  const d = s.constructs.create('measure', 'point-line', [p.id, s.constructs.create('line', 'two-points', [sphere.id, p.id]).id]);
  return { ...s, loop, region, sphere, p, d };
}
const app = (s) => ({ model: s.model, view: s.view, engine: s.engine, regions: s.regions, fits: s.fits, constructs: s.constructs });

describe('a mesh\'s work as a landmark-json file', () => {
  test('landmarks, curves and surfaces as the format has them; the rest in extensions.bonefitter', async () => {
    const s = await work();
    const doc = landmarkDoc(s.model, s.mesh.id);
    assert.equal(doc.format, 'landmark-json');
    assert.equal(doc.version, '0.2.0');
    assert.deepEqual(doc.specimen.mesh, { file: EXAMPLE.file, sha256: s.mesh.sha256, units: 'mm', vertex_count: s.mesh.vertexCount, face_count: s.mesh.faceCount });
    assert.equal(doc.specimen.id, 'example-femur');
    // A clicked point is an ad hoc landmark, with its anchor.
    assert.deepEqual(doc.landmarks, [{ id: 'P01', template_id: null, label: 'Point 1', status: 'placed', position: s.p.position.map((v) => Math.round(v * 1e6) / 1e6), anchor: { face: 7, bary: [0.2, 0.3, 0.5] } }]);
    // The curve, with a definition in the file's own template so Landmarker3D shows it.
    assert.deepEqual(doc.template.curves, [{ id: 'C01', name: 'Curve 1', closed: true, path: 'geodesic' }]);
    const [c] = doc.curves;
    assert.equal(c.id, 'C01');
    assert.equal(c.template_id, 'C01');
    assert.equal(c.control_points.length, 10);
    assert.ok(c.control_points[0].anchor.face >= 0);
    assert.equal(c.length, s.loop.length);
    assert.deepEqual(c.points, []);
    assert.deepEqual(c.sampling, { path: 'geodesic', spacing: 'equal_arc_length', n_points: 0 });
    // The region, bounded by the curve.
    assert.deepEqual(doc.surfaces, [{ id: 'S01', template_id: null, label: 'Region 1', status: 'placed', boundary: ['C01'], method: 'curve_boundary', side: 'inside', points: [] }]);
    // Everything else, with the ids used in the file.
    const ext = doc.extensions.bonefitter;
    assert.equal(ext.format, 'bonefitter-scene');
    assert.deepEqual(ext.file_ids, { [s.p.id]: 'P01', [s.loop.id]: 'C01', [s.region.id]: 'S01' });
    assert.ok(ext.objects.some((o) => o.kind === 'sphere') && ext.objects.some((o) => o.kind === 'measure'));
    assert.equal(doc.provenance.software, 'BoneFitter');
  });

  test('Landmarker3D\'s reader (as copied here) opens it', async () => {
    const s = await work();
    const parsed = parseLandmarkFile(stringify(landmarkDoc(s.model, s.mesh.id)), 'example-femur.lmk.json');
    assert.equal(parsed.points.length, 1);
    assert.equal(parsed.points[0].id, 'P01');
  });

  test('an opened landmark file\'s template and landmarks are kept, its ids too; new curves become ad hoc', async () => {
    const s = await femur();
    const original = {
      format: 'landmark-json',
      version: '0.4.0',
      specimen: { id: 'FEM_01', mesh: { file: EXAMPLE.file, sha256: s.mesh.sha256, units: 'mm' } },
      template: { id: 'femur', name: 'Femur', version: '2', dimensions: 3, landmarks: [{ id: 'LM01', name: 'Head top' }, { id: 'C01', name: 'not a curve' }], planes: [{ id: 'PL01', name: 'P', landmarks: ['LM01', 'LM01', 'LM01'] }] },
      landmarks: [{ id: 'LM01', template_id: 'LM01', status: 'placed', position: [1, 2, 3] }],
      curves: [{ id: 'CX', template_id: 'CX', status: 'placed', control_points: [] }],
    };
    const parsed = parseLandmarkFile(JSON.stringify(original), 'FEM_01.lmk.json');
    const group = addLandmarks(s.model, parsed, s.mesh.id);
    s.model.update(group.id, { rawCurves: original.curves });
    s.addCurve(s.mesh.id, cap(EXAMPLE.head.centre, 12, EXAMPLE.neck.direction));
    const doc = landmarkDoc(s.model, s.mesh.id);
    assert.equal(doc.version, '0.4.0', 'the template has planes');
    assert.equal(doc.specimen.id, 'FEM_01');
    assert.deepEqual(doc.template, original.template, 'the template is not changed');
    assert.equal(doc.landmarks[0].id, 'LM01');
    assert.deepEqual(doc.landmarks[0].position, [1, 2, 3]);
    assert.equal(doc.curves[0].id, 'C02', 'C01 is taken by the template');
    assert.equal(doc.curves[0].template_id, null);
    assert.equal(doc.curves[1].id, 'CX', 'the file\'s own curves are written back');
  });
});

describe('opening such a file in BoneFitter', () => {
  test('everything comes back from the extension', async () => {
    const s = await work();
    const doc = JSON.parse(stringify(landmarkDoc(s.model, s.mesh.id)));
    const t = await femur();
    await restoreScene(app(t), sceneFromLandmarkDoc(doc), 'example-femur.lmk.json');
    const names = [...t.model.nodes.values()].map((n) => `${n.kind}:${n.name}`).sort();
    assert.deepEqual(names, [...s.model.nodes.values()].map((n) => `${n.kind}:${n.name}`).sort());
    const d = [...t.model.nodes.values()].find((n) => n.kind === 'measure');
    assert.equal(d.value, s.d.value);
  });

  test('a landmark or a curve changed in another app since is taken from the file\'s own entries', async () => {
    const s = await work();
    const doc = JSON.parse(stringify(landmarkDoc(s.model, s.mesh.id)));
    // In Landmarker3D: Point 1 moved, the curve given fewer points.
    const moved = cap(EXAMPLE.head.centre, 12, EXAMPLE.neck.direction, 20)[3];
    doc.landmarks[0].position = moved;
    doc.curves[0].control_points = doc.curves[0].control_points.slice(0, 6);
    const t = await femur();
    await restoreScene(app(t), sceneFromLandmarkDoc(doc));
    const nodes = [...t.model.nodes.values()];
    assert.deepEqual(nodes.find((n) => n.kind === 'point' && n.method === 'surface').position, moved);
    const curve = nodes.find((n) => n.kind === 'curve');
    assert.equal(curve.control_points.length, 6);
    assert.notEqual(nodes.find((n) => n.kind === 'region').faceCount, s.region.faceCount, 'the region follows');
  });

  test('a landmark file without the extension is not a scene', () => {
    assert.equal(sceneFromLandmarkDoc({ format: 'landmark-json', landmarks: [] }), null);
  });
});
