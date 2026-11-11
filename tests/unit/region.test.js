import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildTopology } from '../../js/geodesic.js';
import { faceNeighbours } from '../../js/region.js';
import { describe as describeNode } from '../../js/properties-panel.js';
import { scene, ball, screenOf, events } from '../scene-helpers.js';

const R = 10;
const SPHERE = 4 * Math.PI * R * R;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≉ ${b} (±${tol})`);
const deg = (d) => (d * Math.PI) / 180;

// n points on the circle `angle` degrees away from the +Z axis of a ball of radius R.
const ring = (angle, n = 16, z = 1) =>
  Array.from({ length: n }, (_, k) => {
    const t = (2 * Math.PI * k) / n;
    return [R * Math.sin(deg(angle)) * Math.cos(t), R * Math.sin(deg(angle)) * Math.sin(t), z * R * Math.cos(deg(angle))];
  });
// The area of the cap inside that circle.
const cap = (angle) => 2 * Math.PI * R * R * (1 - Math.cos(deg(angle)));

// A ball of radius 10 at the origin (fine enough that one triangle is small beside the loops).
function setup() {
  const s = scene();
  const mesh = s.addMesh('ball', ball(R, 0, 192));
  const total = mesh.faceCount;
  // The direction of a face's centre from the ball's centre, as an angle from +Z.
  const pos = s.view.sources.get(mesh.id).attributes.position.array;
  const angleOf = (f) => {
    const c = [0, 1, 2].map((k) => (pos[9 * f + k] + pos[9 * f + 3 + k] + pos[9 * f + 6 + k]) / 3);
    return (Math.acos(c[2] / Math.hypot(...c)) * 180) / Math.PI;
  };
  return { ...s, mesh, total, angleOf };
}

describe('which triangles share an edge', () => {
  const soup = (g) => buildTopology(g.toNonIndexed().attributes.position.array, null);

  test('on a closed solid every triangle has three neighbours, and they agree', () => {
    const topo = soup(new THREE.TetrahedronGeometry(1));
    const { nbr } = faceNeighbours(topo);
    assert.equal(nbr.length, 12);
    for (let f = 0; f < 4; f++) {
      const mine = [nbr[3 * f], nbr[3 * f + 1], nbr[3 * f + 2]];
      assert.deepEqual([...mine].sort(), [0, 1, 2, 3].filter((g) => g !== f), `face ${f}`);
      for (const g of mine) assert.ok([nbr[3 * g], nbr[3 * g + 1], nbr[3 * g + 2]].includes(f));
    }
  });

  test('an open edge has no neighbour', () => {
    const topo = soup(new THREE.PlaneGeometry(1, 1)); // two triangles
    const { nbr } = faceNeighbours(topo);
    assert.equal([...nbr].filter((g) => g === -1).length, 4, 'the four sides of the square');
    assert.equal([...nbr].filter((g) => g === 1).length, 1);
    assert.equal([...nbr].filter((g) => g === 0).length, 1);
  });
});

describe('the region a closed curve encloses', () => {
  test('a loop round a cap: the triangles inside it, with their area and centroid', () => {
    const { regions, mesh, addCurve, angleOf } = setup();
    const curve = addCurve(mesh.id, ring(30));
    const r = regions.create(curve.id);
    assert.equal(r.kind, 'region');
    assert.equal(r.parent, mesh.id);
    assert.deepEqual(r.boundary, [curve.id]);
    assert.equal(r.error, null);
    assert.equal(r.faces.length, r.faceCount);
    assert.ok(r.faceCount > 1000);
    near(r.area, cap(30), 0.03 * cap(30), 'the area of the cap');
    // The centroid of a cap lies on its axis, halfway between its rim and its top.
    near(r.centroid[0], 0, 0.05);
    near(r.centroid[1], 0, 0.05);
    near(r.centroid[2], (R * (1 + Math.cos(deg(30)))) / 2, 0.05);
    // Accurate to about one triangle: nothing far outside the loop, nothing missing well inside.
    const inside = new Set(r.faces);
    for (const f of r.faces) assert.ok(angleOf(f) < 32, `face ${f} at ${angleOf(f)}° is outside the loop`);
    for (let f = 0; f < mesh.faceCount; f++) if (angleOf(f) < 27) assert.ok(inside.has(f), `face ${f} is missing`);
  });

  test('the faces are the file\'s face numbers, in order', () => {
    const { regions, mesh, addCurve } = setup();
    const r = regions.create(addCurve(mesh.id, ring(30)).id);
    assert.ok(r.faces instanceof Uint32Array);
    for (let i = 1; i < r.faces.length; i++) assert.ok(r.faces[i] > r.faces[i - 1]);
    assert.ok(r.faces.at(-1) < mesh.faceCount);
  });

  test('the smaller part is taken as the inside, whichever way round the loop was drawn', () => {
    const { regions, mesh, addCurve } = setup();
    const a = regions.create(addCurve(mesh.id, ring(30)).id);
    const b = regions.create(addCurve(mesh.id, ring(30).reverse()).id);
    assert.equal(a.faceCount, b.faceCount);
    // A loop round more than half the ball encloses the far cap.
    const c = regions.create(addCurve(mesh.id, ring(120)).id);
    near(c.area, cap(60), 0.03 * cap(60));
    assert.ok(c.centroid[2] < -7);
  });

  test('"the other side" is everything else on the surface', () => {
    const { regions, mesh, addCurve, total } = setup();
    const r = regions.create(addCurve(mesh.id, ring(30)).id);
    const inside = r.faceCount;
    regions.set(r.id, { flipped: true });
    near(r.area, SPHERE - cap(30), 0.03 * cap(30));
    assert.ok(Math.abs(inside + r.faceCount - total) <= 12, 'the two sides share at most a few triangles on the line');
    assert.ok(r.centroid[2] < 0);
  });

  test('moving a point of the curve changes the region with it', () => {
    const { regions, engine, mesh, addCurve, cp, model } = setup();
    const curve = addCurve(mesh.id, ring(30, 8));
    const r = regions.create(curve.id);
    const before = r.area;
    const points = curve.control_points.slice();
    points[0] = cp(mesh.id, ring(50, 8)[0]);
    const seen = events(model);
    engine.set(curve.id, { control_points: points });
    assert.ok(r.area > before * 1.05, `${r.area} vs ${before}`);
    assert.deepEqual(seen.map((e) => e.ids[0]).sort(), [curve.id, r.id], 'both the curve and its region are announced as changed');
  });

  test('on a large mesh, a region waits while its curve is being dragged', () => {
    const { regions, engine, mesh, addCurve, cp } = setup();
    const curve = addCurve(mesh.id, ring(30, 8));
    const r = regions.create(curve.id);
    const before = r.area;
    const moved = [cp(mesh.id, ring(50, 8)[0]), ...curve.control_points.slice(1)];
    mesh.faceCount = 500000; // as if it were a large scan
    regions.pause();
    engine.set(curve.id, { control_points: moved });
    assert.equal(r.area, before, 'not recomputed at every step of the drag');
    regions.resume();
    assert.ok(r.area > before * 1.05, 'brought up to date when the drag ends');
  });

  test('on a small mesh the region follows the drag as it happens', () => {
    const { regions, engine, mesh, addCurve, cp } = setup();
    const curve = addCurve(mesh.id, ring(30, 8));
    const r = regions.create(curve.id);
    const before = r.area;
    regions.pause();
    engine.set(curve.id, { control_points: [cp(mesh.id, ring(50, 8)[0]), ...curve.control_points.slice(1)] });
    assert.ok(r.area > before * 1.05);
    regions.resume();
  });

  test('the source geometry is only read', () => {
    const { regions, mesh, addCurve, view } = setup();
    const g = view.sources.get(mesh.id);
    const before = g.attributes.position.array.slice();
    regions.create(addCurve(mesh.id, ring(30)).id);
    assert.equal(g.index, null);
    assert.deepEqual(g.attributes.position.array, before);
  });
});

describe('regions with several boundaries', () => {
  test('a second loop inside the first leaves a hole: the region is the ring between them', () => {
    const { regions, mesh, addCurve, angleOf } = setup();
    const outer = addCurve(mesh.id, ring(40));
    const inner = addCurve(mesh.id, ring(15));
    const r = regions.create(outer.id);
    regions.addBoundary(r.id, inner.id);
    assert.deepEqual(r.boundary, [outer.id, inner.id]);
    assert.equal(r.error, null);
    near(r.area, cap(40) - cap(15), 0.03 * cap(40));
    for (const f of r.faces) assert.ok(angleOf(f) > 13 && angleOf(f) < 42, `face at ${angleOf(f)}°`);
  });

  test('two rings round the ball: the region is the band between them', () => {
    const { regions, mesh, addCurve } = setup();
    const r = regions.create(addCurve(mesh.id, ring(60)).id);
    regions.addBoundary(r.id, addCurve(mesh.id, ring(60, 16, -1)).id);
    // A band on a sphere has area 2πR × its height.
    const band = 2 * Math.PI * R * (2 * R * Math.cos(deg(60)));
    near(r.area, band, 0.03 * band);
    near(r.centroid[2], 0, 0.05);
    regions.set(r.id, { flipped: true });
    near(r.area, SPHERE - band, 0.03 * band, 'the other side is the two caps');
  });

  test('a curve cannot bound the same region twice, and only closed curves on the same mesh count', () => {
    const s = setup();
    const other = s.addMesh('other', ball(3, 40, 24));
    const a = s.addCurve(s.mesh.id, ring(40));
    const b = s.addCurve(s.mesh.id, ring(15));
    const open = s.addCurve(s.mesh.id, ring(20, 4), { closed: false });
    const elsewhere = s.addCurve(other.id, [[43, 0, 0], [40, 3, 0], [40, 0, 3]]);
    const r = s.regions.create(a.id);
    assert.deepEqual(s.regions.candidates(r.id).map((c) => c.id), [b.id]);
    assert.equal(s.regions.addBoundary(r.id, a.id), false);
    assert.equal(s.regions.addBoundary(r.id, open.id), false);
    assert.equal(s.regions.addBoundary(r.id, elsewhere.id), false);
    assert.deepEqual(r.boundary, [a.id]);
    assert.equal(s.regions.create(open.id), null, 'no region from an open curve');
  });

  test('removing a boundary curve takes it off the region; the last one takes the region with it', () => {
    const { regions, mesh, addCurve, model } = setup();
    const outer = addCurve(mesh.id, ring(40));
    const inner = addCurve(mesh.id, ring(15));
    const r = regions.create(outer.id);
    regions.addBoundary(r.id, inner.id);
    model.remove(inner.id);
    assert.deepEqual(r.boundary, [outer.id]);
    near(r.area, cap(40), 0.03 * cap(40), 'the hole is filled again');
    model.remove(outer.id);
    assert.equal(model.get(r.id), null);
  });
});

describe('curves that enclose nothing', () => {
  test('a loop that crosses itself is refused', () => {
    const { regions, mesh, addCurve } = setup();
    const [a, b, c, d] = ring(30, 4);
    const r = regions.create(addCurve(mesh.id, [a, c, b, d]).id); // a figure of eight
    assert.equal(r.error, 'crossing');
    assert.equal(r.faceCount, 0);
    assert.equal(r.area, 0);
    assert.equal(r.centroid, null);
  });

  test('a ring round a handle does not divide the surface, and is refused', () => {
    const s = scene();
    const g = new THREE.TorusGeometry(10, 3, 32, 96).toNonIndexed();
    const mesh = s.addMesh('torus', g);
    // Round the tube where it crosses the X axis.
    const round = Array.from({ length: 8 }, (_, k) => [10 + 3 * Math.cos((Math.PI * k) / 4), 0, 3 * Math.sin((Math.PI * k) / 4)]);
    const r = s.regions.create(s.addCurve(mesh.id, round).id);
    assert.equal(r.error, 'open');
    assert.equal(r.faceCount, 0);
  });

  test('a loop smaller than a few triangles is refused', () => {
    const s = scene();
    const mesh = s.addMesh('coarse', ball(R, 0, 12));
    const r = s.regions.create(s.addCurve(mesh.id, ring(2, 3)).id);
    assert.equal(r.error, 'small');
  });

  test('a curve that jumps between separate pieces is refused', () => {
    const { regions, mesh, addCurve, model } = setup();
    const curve = addCurve(mesh.id, ring(30));
    model.update(curve.id, { warning: 'apart' });
    assert.equal(regions.create(curve.id).error, 'apart');
  });

  test('loops with no area between them all are refused', () => {
    // Three rings one inside the other: no part of the surface touches all three.
    const { regions, mesh, addCurve } = setup();
    const r = regions.create(addCurve(mesh.id, ring(50)).id);
    regions.addBoundary(r.id, addCurve(mesh.id, ring(30)).id);
    regions.addBoundary(r.id, addCurve(mesh.id, ring(10)).id);
    assert.equal(r.error, 'no-common');
  });

  test('a region comes back when its curve is put right', () => {
    const { regions, engine, mesh, addCurve } = setup();
    const [a, b, c, d] = ring(30, 4).map((p) => p);
    const curve = addCurve(mesh.id, [a, c, b, d]);
    const r = regions.create(curve.id);
    const [p0, p1, p2, p3] = curve.control_points;
    engine.set(curve.id, { control_points: [p0, p2, p1, p3] });
    assert.equal(r.error, null);
    assert.ok(r.faceCount > 100);
  });
});

describe('regions in the 3D view and in Properties', () => {
  // Seen from +Z, a loop round the point of the ball facing the camera.
  function drawn() {
    const s = setup();
    const curve = s.addCurve(s.mesh.id, ring(30));
    const r = s.regions.create(curve.id);
    return { ...s, curve, r };
  }
  const rows = (d) => Object.fromEntries(d.rows.map(([k, v]) => [k, v]));

  test('a region is drawn as its own triangles, under its mesh', () => {
    const { view, r, mesh, model } = drawn();
    const obj = view.objectOf(r.id);
    assert.equal(obj.parent, view.objectOf(mesh.id));
    assert.equal(obj.geometry.attributes.position.count, r.faceCount * 3);
    assert.equal(obj.material.transparent, true);
    model.remove(mesh.id);
    assert.equal(view.objectOf(r.id), null);
  });

  test('the tint follows the region when it changes, and a refused region draws nothing', () => {
    const { view, r, regions, curve, engine } = drawn();
    const before = view.objectOf(r.id).geometry.attributes.position.count;
    regions.set(r.id, { flipped: true });
    assert.equal(view.objectOf(r.id).geometry.attributes.position.count, r.faceCount * 3);
    assert.ok(r.faceCount * 3 > before);
    const [p0, p1, ...rest] = curve.control_points;
    engine.set(curve.id, { control_points: [p0, rest[6], ...rest.slice(0, 6), p1, ...rest.slice(7)] });
    assert.equal(r.error, 'crossing');
    assert.equal(view.objectOf(r.id).visible, false);
  });

  test('regionAt finds the region under the cursor', () => {
    const { view, viewer, r, model } = drawn();
    assert.equal(view.regionAt(...screenOf(viewer, [0, 0, R])), r.id);
    assert.equal(view.regionAt(...screenOf(viewer, [R * Math.sin(deg(50)), 0, R * Math.cos(deg(50))])), null, 'outside the loop');
    assert.equal(view.regionAt(2, 2), null, 'beside the mesh');
    model.setVisible(r.id, false);
    assert.equal(view.regionAt(...screenOf(viewer, [0, 0, R])), null);
  });

  test('where regions overlap, the smaller one is picked', () => {
    const { view, viewer, regions, mesh, addCurve, r } = drawn();
    const small = regions.create(addCurve(mesh.id, ring(10)).id);
    assert.equal(view.regionAt(...screenOf(viewer, [0, 0, R])), small.id);
    assert.equal(view.regionAt(...screenOf(viewer, [R * Math.sin(deg(20)), 0, R * Math.cos(deg(20))])), r.id);
  });

  test('Properties: boundary, side, triangles, area and centroid, and a row to copy', () => {
    const { model, r, regions, mesh, addCurve } = drawn();
    let d = describeNode(model, r.id);
    assert.equal(d.kind, 'Region');
    assert.equal(d.title, 'Region 1');
    assert.equal(rows(d).Boundary, 'Curve 1');
    assert.equal(rows(d).Side, 'inside the curve');
    assert.equal(rows(d).Triangles, r.faceCount.toLocaleString('en-US'));
    assert.equal(rows(d).Area, r.area.toFixed(3));
    assert.deepEqual(['x', 'y', 'z'].map((k) => rows(d)[`Centroid ${k}`]), r.centroid.map((v) => v.toFixed(3)));
    assert.equal(rows(d).Coordinates, 'as in ball.stl');
    assert.deepEqual(d.copy.split('\n'), [
      'name\tboundary\tside\ttriangles\tarea\tcentroid_x\tcentroid_y\tcentroid_z',
      ['Region 1', 'Curve 1', 'inside', r.faceCount, r.area, ...r.centroid].join('\t'),
    ]);

    regions.set(r.id, { flipped: true });
    assert.equal(rows(describeNode(model, r.id)).Side, 'the other side');
    regions.set(r.id, { flipped: false });
    regions.addBoundary(r.id, addCurve(mesh.id, ring(10)).id);
    d = describeNode(model, r.id);
    assert.equal(rows(d).Boundary, 'Curve 1, Curve 2');
    assert.equal(rows(d).Side, 'between its curves');
  });

  test('Properties say why a curve gives no region', () => {
    const { model, regions, mesh, addCurve } = setup();
    const [a, b, c, d] = ring(30, 4);
    const r = regions.create(addCurve(mesh.id, [a, c, b, d]).id);
    const shown = describeNode(model, r.id);
    assert.match(rows(shown).Problem, /crosses itself/);
    assert.equal(rows(shown).Area, undefined);
    assert.equal(shown.copy, null);
  });
});
