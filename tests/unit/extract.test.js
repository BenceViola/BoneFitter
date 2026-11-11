import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadMeshBuffer } from '../../js/mesh-loader.js';
import { makeExampleStl, EXAMPLE } from '../../js/sample.js';
import { meshFromRegion } from '../../js/extract.js';
import { stlBytes, plyBytes, meshArea } from '../../js/mesh-export.js';
import { meshFields } from '../../js/opening.js';
import { describe as describeNode } from '../../js/properties-panel.js';
import { scene } from '../scene-helpers.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≉ ${b} (±${tol})`);
const unit = (v) => v.map((x) => x / Math.hypot(...v));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const rows = (d) => Object.fromEntries(d.rows.map(([k, v]) => [k, v]));
const AXIS = unit(EXAMPLE.neck.direction);
const E1 = unit(cross(AXIS, [0, 0, 1]));
const E2 = cross(AXIS, E1);
const headRing = (angle, n = 12) =>
  Array.from({ length: n }, (_, k) => {
    const a = (angle * Math.PI) / 180;
    const t = (2 * Math.PI * k) / n;
    return EXAMPLE.head.centre.map((c, i) => c + EXAMPLE.head.radius * (Math.cos(a) * AXIS[i] + Math.sin(a) * (Math.cos(t) * E1[i] + Math.sin(t) * E2[i])));
  });

async function setup({ example = false } = {}) {
  const s = scene();
  const loaded = await loadMeshBuffer(makeExampleStl(), EXAMPLE.file);
  const mesh = s.model.add('mesh', meshFields(loaded, { name: 'Example femur', ...(example ? { example: true } : {}) }));
  s.view.addMesh(mesh, loaded.geometry);
  const curve = s.addCurve(mesh.id, headRing(40));
  const region = s.regions.create(curve.id);
  return { ...s, mesh, curve, region, app: { model: s.model, view: s.view } };
}

describe('a new mesh from a region', () => {
  test('a mesh of just the region\'s triangles, beside the original, which is not changed', async () => {
    const { app, model, view, mesh, region } = await setup();
    const before = view.sources.get(mesh.id).attributes.position.array.slice();
    const m = await meshFromRegion(app, region.id);
    assert.equal(m.kind, 'mesh');
    assert.equal(m.parent, null, 'a mesh of its own, at the top of the list');
    assert.equal(m.name, 'Region 1 of Example femur');
    assert.equal(m.file, 'example-femur-region-1.stl', 'the name it is saved under');
    assert.equal(m.faceCount, region.faceCount);
    near(m.area, region.area, 1e-6, 'its surface area is the region\'s');
    assert.deepEqual(m.madeFrom, { mesh: 'Example femur', region: 'Region 1', boundary: ['Curve 1'], flipped: false });
    assert.equal(m.coordsFile, EXAMPLE.file);
    assert.deepEqual(view.sources.get(mesh.id).attributes.position.array, before);
    assert.deepEqual(model.meshes().map((n) => n.id), [mesh.id, m.id]);
  });

  test('its triangles are the region\'s, in the original coordinates, in face order', async () => {
    const { app, view, mesh, region } = await setup();
    const m = await meshFromRegion(app, region.id);
    const src = view.sources.get(mesh.id).attributes.position.array;
    const got = view.sources.get(m.id).attributes.position.array;
    for (const i of [0, 1, Math.floor(region.faceCount / 2), region.faceCount - 1]) {
      const f = region.faces[i];
      assert.deepEqual([...got.slice(9 * i, 9 * i + 9)], [...src.slice(9 * f, 9 * f + 9)], `triangle ${i}`);
    }
  });

  test('it is the STL that "Save as STL" writes: same SHA-256, so the saved file is recognised when opened again', async () => {
    const { app, view, region } = await setup();
    const m = await meshFromRegion(app, region.id);
    const saved = await loadMeshBuffer(stlBytes(view.sources.get(m.id)), m.file);
    assert.equal(saved.sha256, m.sha256);
    const ply = await loadMeshBuffer(plyBytes(view.sources.get(m.id)), 'x.ply');
    assert.equal(ply.faceCount, m.faceCount);
    near(meshArea(ply.geometry), m.area, 1e-3);
    assert.ok(ply.vertexCount < m.vertexCount, 'PLY joins corners into shared vertices');
  });

  test('it is a copy: changing the region later does not change it', async () => {
    const { app, regions, region } = await setup();
    const m = await meshFromRegion(app, region.id);
    const faces = m.faceCount;
    regions.set(region.id, { flipped: true });
    assert.equal(m.faceCount, faces);
    const other = await meshFromRegion(app, region.id);
    assert.equal(other.name, 'Region 1 of Example femur');
    assert.equal(other.madeFrom.flipped, true);
    assert.ok(other.faceCount > faces);
  });

  test('the new mesh can have curves, regions and fits of its own', async () => {
    const { app, region, addCurve, regions, fits } = await setup();
    const m = await meshFromRegion(app, region.id);
    const r2 = regions.create(addCurve(m.id, headRing(20)).id);
    assert.equal(r2.error, null);
    const sphere = fits.create(r2.id, 'sphere');
    near(sphere.radius, EXAMPLE.head.radius, 1e-3);
  });

  test('a region that encloses nothing gives no mesh; a mesh made from the example goes with it', async () => {
    const { app, model, region, engine, curve } = await setup({ example: true });
    const m = await meshFromRegion(app, region.id);
    assert.equal(m.example, true);
    const [a, b, c, d] = [0, 3, 6, 9].map((k) => curve.control_points[k]);
    engine.set(curve.id, { control_points: [a, c, b, d] });
    assert.equal(await meshFromRegion(app, region.id), null);
    assert.equal(await meshFromRegion(app, 'nope'), null);
    void model;
  });

  test('Properties: what it was made from, surface area, the original\'s coordinates, a row to copy', async () => {
    const { app, model, region, mesh } = await setup();
    const m = await meshFromRegion(app, region.id);
    const d = describeNode(model, m.id);
    const r = rows(d);
    assert.equal(r['Made from'], 'Region 1 of Example femur');
    assert.equal(r.File, undefined);
    assert.equal(r['Surface area'], m.area.toFixed(3));
    assert.equal(r.Coordinates, `as in ${EXAMPLE.file}`);
    assert.match(r.Note, /does not change when the region does/);
    assert.deepEqual(d.copy.split('\n'), [
      'name\tfile\tmade_from\ttriangles\tvertices\tsurface_area',
      ['Region 1 of Example femur', '', 'Region 1 of Example femur', m.faceCount, m.vertexCount, m.area].join('\t'),
    ]);
    // Every mesh shows its surface area; an opened one its file.
    const o = rows(describeNode(model, mesh.id));
    assert.equal(o.File, EXAMPLE.file);
    near(Number(o['Surface area']), mesh.area, 1e-3);
    // Something attached to the new mesh is in the original file's coordinates.
    const c = model.add('point', { parent: m.id, position: [1, 2, 3] });
    assert.equal(rows(describeNode(model, c.id)).Coordinates, `as in ${EXAMPLE.file}`);
  });
});
