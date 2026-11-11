import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SceneModel } from '../../js/scene-model.js';
import { SceneView } from '../../js/scene-view.js';
import { Picker } from '../../js/picking.js';
import { openFiles, meshFields, addLandmarks } from '../../js/opening.js';
import { parseLandmarkFile } from '../../js/landmark-file.js';
import { loadMeshBuffer } from '../../js/mesh-loader.js';
import { describe as describeNode } from '../../js/properties-panel.js';
import { binaryStl, asciiPly, SQUARE_VERTS, landmarkFile } from '../fixtures.js';

// A file as the browser hands it over.
const file = (name, data) => ({
  name,
  arrayBuffer: async () => data,
  text: async () => (typeof data === 'string' ? data : new TextDecoder().decode(data)),
});

const ballStl = (radius, x = 0) => {
  const g = new THREE.SphereGeometry(radius, 16, 12).toNonIndexed();
  g.translate(x, 0, 0);
  return binaryStl(g);
};

function setup() {
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
  const viewer = {
    scene: new THREE.Scene(),
    camera,
    renderer: { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) } },
    box: null,
    setContentBox(box) { this.box = box; },
    get diagonal() { return 1; },
  };
  const model = new SceneModel();
  const view = new SceneView(viewer, new Picker(viewer), model);
  const busy = [];
  const app = { model, view, setBusy: (t) => busy.push(t), nextFrame: async () => {} };
  return { app, model, view, busy };
}

// The landmark file text for an opened mesh node.
const lmkFor = (node, overrides) => JSON.stringify(landmarkFile(node, overrides));

describe('opening files', () => {
  test('each mesh becomes a mesh object with the facts of its file', async () => {
    const { app, model, busy } = setup();
    const r = await openFiles(app, [file('a.stl', ballStl(5)), file('b.stl', ballStl(7, 50))]);
    assert.deepEqual(r, { opened: 2, errors: [], notes: [] });
    const [a, b] = model.meshes();
    assert.equal(a.name, 'a.stl');
    assert.equal(a.format, 'STL, binary');
    assert.equal(a.faceCount, a.vertexCount / 3);
    assert.match(a.sha256, /^[0-9a-f]{64}$/);
    assert.ok(Math.abs(a.box.max[0] - 5) < 1e-3 && Math.abs(b.box.max[0] - 57) < 1e-3, 'the box is in file coordinates');
    assert.equal(busy.at(-1), null, 'the busy note is taken down');
  });

  test('the example makes way for the first real mesh, but not for a file that fails', async () => {
    const { app, model, view } = setup();
    const mesh = await loadMeshBuffer(ballStl(3), 'example.stl');
    view.addMesh(model.add('mesh', meshFields(mesh, { example: true })), mesh.geometry);

    const bad = await openFiles(app, [file('quad.ply', asciiPly(SQUARE_VERTS, [[0, 1, 2, 3]]))]);
    assert.equal(bad.opened, 0);
    assert.match(bad.errors[0], /more than three corners/);
    assert.equal(model.meshes().length, 1, 'the example is still there');

    await openFiles(app, [file('a.stl', ballStl(5))]);
    assert.deepEqual(model.meshes().map((n) => n.name), ['a.stl']);
  });

  test('a mesh that is already open is not opened twice', async () => {
    const { app, model } = setup();
    await openFiles(app, [file('a.stl', ballStl(5))]);
    const r = await openFiles(app, [file('copy of a.stl', ballStl(5))]);
    assert.equal(r.opened, 0);
    assert.match(r.notes[0], /“copy of a.stl” is already open \(as a.stl\)/);
    assert.equal(model.meshes().length, 1);
  });

  test('a landmark file becomes a folder of points attached to its mesh, even when given first', async () => {
    const { app, model } = setup();
    await openFiles(app, [file('other.stl', ballStl(9, 80))]);
    // Find the hash the mesh will have, to write a landmark file for it.
    const probe = await loadMeshBuffer(ballStl(5), 'FEMUR_007.stl');
    const lmk = lmkFor(meshFields(probe));
    const r = await openFiles(app, [file('FEMUR_007.lmk.json', lmk), file('FEMUR_007.stl', ballStl(5))]);
    assert.deepEqual(r, { opened: 2, errors: [], notes: [] });

    const mesh = model.meshes().find((n) => n.file === 'FEMUR_007.stl');
    const [folder] = model.children(mesh.id);
    assert.equal(folder.kind, 'group');
    assert.equal(folder.name, 'FEMUR_007');
    assert.equal(folder.templateName, 'Tiny set');
    assert.equal(folder.operator, 'student01');
    assert.equal(folder.template.landmarks.length, 3, 'the template travels with the folder');
    const points = model.children(folder.id);
    assert.deepEqual(points.map((p) => [p.code, p.name, p.status, p.position, p.template_id]), [
      ['LM01', 'Head, top', 'placed', [1.5, 2.25, 3], 'LM01'],
      ['LM02', 'Condyle L', 'estimated', [-4, 5, 6.125], 'LM02'],
      ['LM03', 'Condyle R', 'missing', null, 'LM03'],
    ]);
  });

  test('a landmark file whose mesh is not open is refused, naming the mesh', async () => {
    const { app, model } = setup();
    await openFiles(app, [file('a.stl', ballStl(5))]);
    const lmk = lmkFor({ file: 'FEMUR_007.ply', sha256: 'ab'.repeat(32), faceCount: 10, vertexCount: 30 });
    const r = await openFiles(app, [file('FEMUR_007.lmk.json', lmk)]);
    assert.equal(r.opened, 0);
    assert.match(r.errors[0], /were placed on “FEMUR_007.ply”, which isn’t open/);
    assert.equal(model.children(model.meshes()[0].id).length, 0);
  });

  test('other files and broken files are reported, and the rest still open', async () => {
    const { app, model } = setup();
    const r = await openFiles(app, [
      file('skull.obj', new ArrayBuffer(4)),
      file('broken.json', '{ nope'),
      file('a.stl', ballStl(5)),
    ]);
    assert.equal(r.opened, 1);
    assert.equal(r.errors.length, 2);
    assert.match(r.errors[0], /“skull.obj” is not an STL or PLY mesh or a landmark file/);
    assert.match(r.errors[1], /isn’t valid JSON/);
    assert.equal(model.meshes().length, 1);
  });

  test('notes from a landmark file say which file they are about', async () => {
    const { app, model, view } = setup();
    const mesh = await loadMeshBuffer(ballStl(5), 'a.stl');
    const node = model.add('mesh', meshFields(mesh));
    view.addMesh(node, mesh.geometry);
    const r = await openFiles(app, [file('a.lmk.json', lmkFor(node, { curves: [{ id: 'C01' }] }))]);
    assert.match(r.notes[0], /^a\.lmk\.json: Its curve is not shown/);
  });
});

describe('the Properties panel', () => {
  async function scene() {
    const { model, view } = setup();
    const mesh = await loadMeshBuffer(ballStl(5, 20), 'FEMUR_007.stl');
    const node = model.add('mesh', meshFields(mesh));
    view.addMesh(node, mesh.geometry);
    const folder = addLandmarks(model, parseLandmarkFile(lmkFor(node), 'FEMUR_007_r2.lmk.json'), node.id);
    return { model, node, folder, points: model.children(folder.id) };
  }
  const rows = (d) => Object.fromEntries(d.rows.map(([k, v]) => [k, v]));

  test('a mesh: file facts and its size along each axis', async () => {
    const { model, node } = await scene();
    const d = describeNode(model, node.id);
    assert.equal(d.kind, 'Mesh');
    assert.equal(rows(d).File, 'FEMUR_007.stl');
    assert.equal(rows(d).Triangles, node.faceCount.toLocaleString('en-US'));
    assert.match(rows(d)['Size (x × y × z)'], /^10\.000 × 10\.000 × 10\.000$/);
    assert.match(rows(d)['SHA-256'], /^[0-9a-f]{12}…$/);
    assert.equal(d.copy, null);
  });

  test('a point: coordinates to three decimals, and whose coordinates they are', async () => {
    const { model, points } = await scene();
    const d = describeNode(model, points[1].id);
    assert.equal(d.title, 'Condyle L');
    assert.deepEqual([rows(d).x, rows(d).y, rows(d).z], ['-4.000', '5.000', '6.125']);
    assert.equal(rows(d).Coordinates, 'as in FEMUR_007.stl');
    assert.equal(rows(d).Note, 'worn');
    assert.equal(d.copy, 'LM02\tCondyle L\testimated\t-4\t5\t6.125', 'the clipboard gets full precision');
  });

  test('a missing point has no coordinates to show or copy', async () => {
    const { model, points } = await scene();
    const d = describeNode(model, points[2].id);
    assert.equal(rows(d).Position, 'none (missing)');
    assert.equal(d.copy, null);
  });

  test('a landmark file: counts, and a table of all its points to copy', async () => {
    const { model, folder } = await scene();
    const d = describeNode(model, folder.id);
    assert.equal(d.kind, 'Landmark file');
    assert.equal(d.title, 'FEMUR_007_r2');
    assert.equal(rows(d).Landmarks, '2 placed, 1 missing');
    assert.equal(rows(d).Operator, 'student01');
    assert.deepEqual(d.copy.split('\n'), [
      'id\tname\tstatus\tx\ty\tz',
      'LM01\tHead, top\tplaced\t1.5\t2.25\t3',
      'LM02\tCondyle L\testimated\t-4\t5\t6.125',
      'LM03\tCondyle R\tmissing\tNA\tNA\tNA',
    ]);
  });

  test('a global point is in scene coordinates; nothing selected shows nothing', async () => {
    const { model } = await scene();
    const free = model.add('point', { name: 'Origin', position: [0, 0, 0] });
    assert.equal(rows(describeNode(model, free.id)).Coordinates, 'of the scene');
    assert.equal(describeNode(model, null), null);
  });
});
