import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { pointInPolygon, shapeTest, facesInShape, combineFaces, otherFaces, faceStats } from '../../js/selection.js';
import { meshArea } from '../../js/mesh-export.js';
import { describe as describeNode } from '../../js/properties-panel.js';
import { scene, ball, events } from '../scene-helpers.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≉ ${b} (±${tol})`);
const rows = (d) => Object.fromEntries(d.rows.map(([k, v]) => [k, v]));
const box = (x0, y0, x1, y1) => ({ type: 'box', min: [x0, y0], max: [x1, y1] });
const R = 10;

// The centre of face f of a non-indexed geometry.
function centreOf(g, f) {
  const p = g.attributes.position.array;
  return [0, 1, 2].map((j) => (p[9 * f + j] + p[9 * f + 3 + j] + p[9 * f + 6 + j]) / 3);
}

describe('outlines on the screen', () => {
  test('point in polygon, for a concave outline', () => {
    const L = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]]; // an L shape
    assert.equal(pointInPolygon(0.5, 0.5, L), true);
    assert.equal(pointInPolygon(1.5, 0.5, L), true);
    assert.equal(pointInPolygon(1.5, 1.5, L), false, 'in the notch of the L');
    assert.equal(pointInPolygon(3, 0.5, L), false);
  });

  test('a box and a lasso as tests', () => {
    assert.equal(shapeTest(box(-0.5, -0.5, 0.5, 0.5))(0.2, -0.4), true);
    assert.equal(shapeTest(box(-0.5, -0.5, 0.5, 0.5))(0.6, 0), false);
    const tri = shapeTest({ type: 'lasso', points: [[0, 0], [1, 0], [0, 1]] });
    assert.equal(tri(0.2, 0.2), true);
    assert.equal(tri(0.8, 0.8), false);
  });
});

describe('combining face lists', () => {
  test('add, take away, and the other faces', () => {
    const a = Uint32Array.from([1, 3, 5, 7]);
    const b = Uint32Array.from([2, 3, 8]);
    assert.deepEqual([...combineFaces(a, b, 'add')], [1, 2, 3, 5, 7, 8]);
    assert.deepEqual([...combineFaces(a, b, 'remove')], [1, 5, 7]);
    assert.deepEqual([...otherFaces(a, 9)], [0, 2, 4, 6, 8]);
    assert.deepEqual([...otherFaces(new Uint32Array(0), 3)], [0, 1, 2]);
  });

  test('area and centroid of some faces', () => {
    const g = new THREE.BoxGeometry(2, 2, 2).toNonIndexed(); // 12 faces, 2 per side
    const all = Uint32Array.from({ length: 12 }, (_, i) => i);
    near(faceStats(g, all).area, meshArea(g), 1e-9);
    const s = faceStats(g, Uint32Array.from([0, 1])); // the +X side
    near(s.area, 4, 1e-9);
    assert.deepEqual(s.centroid.map((v) => Math.round(v * 1e6) / 1e6), [1, 0, 0]);
  });
});

describe('the faces inside an outline', () => {
  // A ball of radius 10 at the origin, seen from +Z.
  function setup() {
    const s = scene();
    const mesh = s.addMesh('ball', ball(R, 0, 64));
    const g = s.view.sources.get(mesh.id);
    const cam = s.viewer.camera;
    const toScreen = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).elements;
    const toScene = new THREE.Matrix4().elements;
    const eye = cam.position.clone();
    const p = new THREE.Vector3();
    const isVisible = (x, y, z) => !s.picker.isHidden(p.set(x, y, z), eye, 0.01);
    return { ...s, mesh, g, toScreen, toScene, isVisible };
  }

  test('visible surface only: just the near side, inside the box', () => {
    const { g, toScreen, toScene, isVisible } = setup();
    const faces = facesInShape(g, box(-0.3, -0.3, 0.3, 0.3), { toScreen, toScene, isVisible });
    assert.ok(faces.length > 20);
    for (const f of faces) assert.ok(centreOf(g, f)[2] > 0, 'only faces facing the camera');
    for (let i = 1; i < faces.length; i++) assert.ok(faces[i] > faces[i - 1], 'in rising order');
  });

  test('through: the far side too, so about twice as many', () => {
    const { g, toScreen, toScene, isVisible } = setup();
    const near_ = facesInShape(g, box(-0.3, -0.3, 0.3, 0.3), { toScreen, toScene, isVisible });
    const through = facesInShape(g, box(-0.3, -0.3, 0.3, 0.3), { toScreen, toScene });
    const back = [...through].filter((f) => centreOf(g, f)[2] < 0);
    assert.ok(back.length > 0.8 * near_.length && through.length > 1.8 * near_.length, `${near_.length} near, ${through.length} through`);
  });

  test('nothing inside the outline, nothing selected', () => {
    const { g, toScreen, toScene, isVisible } = setup();
    assert.equal(facesInShape(g, box(0.8, 0.8, 0.9, 0.9), { toScreen, toScene, isVisible }).length, 0);
  });
});

describe('the Lasso and Box tools', () => {
  function setup() {
    const s = scene();
    const mesh = s.addMesh('ball', ball(R, 0, 64));
    s.select.setMode('box');
    return { ...s, mesh };
  }

  test('a box makes a region of the visible faces inside it, on the only mesh shown', async () => {
    const { select, model, mesh, view } = setup();
    const r = await select.apply(box(-0.3, -0.3, 0.3, 0.3));
    assert.equal(r.done, 'new');
    const region = r.region;
    assert.equal(region.kind, 'region');
    assert.equal(region.parent, mesh.id);
    assert.equal(region.selection, true);
    assert.deepEqual(region.boundary, []);
    assert.equal(region.error, null);
    assert.deepEqual([...region.faces], [...region.picked]);
    assert.equal(region.faceCount, region.picked.length);
    assert.ok(region.centroid[2] > 9, 'the centroid is on the near side');
    assert.equal(model.selectedId, region.id);
    assert.equal(region.strokes.length, 1);
    assert.deepEqual(region.strokes[0].shape, { min: [-0.3, -0.3], max: [0.3, 0.3] });
    assert.equal(region.strokes[0].through, false);
    assert.deepEqual(region.strokes[0].camera.position, [0, 0, 60]);
    for (const f of region.faces) assert.ok(centreOf(view.sources.get(mesh.id), f)[2] > 0);
  });

  test('Shift adds to the selected region; Alt takes away; both are recorded', async () => {
    const { select } = setup();
    const { region } = await select.apply(box(-0.3, -0.3, 0.3, 0.3));
    const first = region.faceCount;
    const r = await select.apply(box(0.15, -0.3, 0.6, 0.3), 'add');
    assert.equal(r.done, 'add');
    assert.ok(region.faceCount > first);
    const added = region.faceCount;
    await select.apply({ type: 'lasso', points: [[-0.36, -0.36], [0, -0.36], [0, 0.36], [-0.36, 0.36]] }, 'remove');
    assert.ok(region.faceCount < added);
    assert.deepEqual(region.strokes.map((s) => [s.type, s.mode]), [['box', 'new'], ['box', 'add'], ['lasso', 'remove']]);
  });

  test('Shift with no lasso or box region selected makes a new one; Alt then says what to do', async () => {
    const { select, model } = setup();
    assert.equal((await select.apply(box(-0.3, -0.3, 0.3, 0.3), 'add')).done, 'new');
    model.select(null);
    assert.deepEqual(await select.apply(box(-0.3, -0.3, 0.3, 0.3), 'remove'), { error: 'not-selection' });
    assert.match(select.state().hint, /Alt takes away from a region made with Lasso or Box/);
  });

  test('"Use the other side" takes every other face of the mesh', async () => {
    const { select, regions, mesh } = setup();
    const { region } = await select.apply(box(-0.3, -0.3, 0.3, 0.3));
    const n = region.faceCount;
    regions.set(region.id, { flipped: true });
    assert.equal(region.faceCount, mesh.faceCount - n);
    assert.equal(regions.candidates(region.id).length, 0, 'no boundary curves can be added');
  });

  test('a region of a lasso can be fitted to: a sphere gives the ball back', async () => {
    const { select, fits } = setup();
    const { region } = await select.apply({ type: 'lasso', points: [[-0.45, -0.3], [0.36, -0.45], [0.45, 0.3], [-0.3, 0.45]] });
    const sphere = fits.create(region.id, 'sphere');
    near(sphere.radius, R, 1e-3);
  });

  test('with several meshes, the selected one is used; with none selected the tool asks', async () => {
    const s = scene();
    const a = s.addMesh('a', ball(5, -8, 32));
    const b = s.addMesh('b', ball(5, 8, 32));
    s.select.setMode('lasso');
    assert.deepEqual(await s.select.apply(box(-1, -1, 1, 1)), { error: 'which-mesh' });
    s.model.select(b.id);
    const { region } = await s.select.apply(box(-1, -1, 1, 1));
    assert.equal(region.parent, b.id);
    s.model.setVisible(b.id, false);
    s.model.select(null);
    const r2 = await s.select.apply(box(-1, -1, 1, 1));
    assert.equal(r2.region.parent, a.id, 'the only mesh shown');
  });

  test('a mesh in front hides what is behind it, unless selecting through', async () => {
    // A small ball in front of a big one, both on the line of sight.
    const s = scene();
    const back = s.addMesh('back', ball(10, 0, 48));
    const front = s.addMesh('front', new THREE.SphereGeometry(4, 32, 16).toNonIndexed().translate(0, 0, 20));
    s.model.select(back.id);
    const a = await s.select.apply(box(-0.1, -0.1, 0.1, 0.1));
    assert.equal(a.error, 'empty');
    s.select.setThrough(true);
    const b = await s.select.apply(box(-0.1, -0.1, 0.1, 0.1));
    assert.equal(b.done, 'new');
    void front;
  });

  test('the tool says what it does and fires change', async () => {
    const { select } = setup();
    const seen = events(select);
    select.setMode('lasso');
    assert.match(select.state().hint, /Drag round the part/);
    select.setMode(null);
    assert.equal(select.active, false);
    assert.equal(seen.length, 2);
  });

  test('Properties: how it was selected, side, triangles, area and centroid', async () => {
    const { select, model, regions } = setup();
    const { region } = await select.apply(box(-0.3, -0.3, 0.3, 0.3));
    await select.apply(box(0.15, -0.3, 0.6, 0.3), 'add');
    let d = describeNode(model, region.id);
    assert.equal(rows(d)['Selected with'], 'Box (2 strokes)');
    assert.equal(rows(d).Boundary, undefined);
    assert.equal(rows(d).Side, 'as selected');
    assert.equal(rows(d).Area, region.area.toFixed(3));
    assert.equal(d.copy.split('\n')[1].split('\t')[1], 'box');
    regions.set(region.id, { flipped: true });
    d = describeNode(model, region.id);
    assert.equal(rows(d).Side, 'the other side');
  });

  test('taking everything away leaves an empty region that says so', async () => {
    const { select, model } = setup();
    const { region } = await select.apply(box(-0.3, -0.3, 0.3, 0.3));
    await select.apply(box(-0.9, -0.9, 0.9, 0.9), 'remove');
    assert.equal(region.error, 'empty');
    assert.match(rows(describeNode(model, region.id)).Problem, /Nothing is selected/);
  });
});
