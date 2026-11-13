import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { scene, ball, screenOf } from '../scene-helpers.js';
import { place, turn } from '../../js/placement.js';

const near = (a, b, tol, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} ≉ ${b} (±${tol})`);
const nearVec = (a, b, tol, msg = '') => a.forEach((v, i) => near(v, b[i], tol, `${msg}[${i}]`));
const loop = (r, z, x = 0, n = 12) => Array.from({ length: n }, (_, k) => [x + r * Math.cos((2 * Math.PI * k) / n), r * Math.sin((2 * Math.PI * k) / n), z]);

// Two balls of radius 10, at x = 0 and x = 40, each with a cap on its +Z side, a sphere and a plane fitted.
function setup() {
  const s = scene([20, 0, 150], [20, 0, 0]);
  const a = s.addMesh('A', ball(10));
  const b = s.addMesh('B', ball(10, 40));
  const cap = (mesh, x) => {
    const region = s.regions.create(s.addCurve(mesh.id, loop(6, 8, x)).id);
    return { region, sphere: s.fits.create(region.id, 'sphere'), plane: s.fits.create(region.id, 'plane') };
  };
  return { ...s, a, b, capA: cap(a, 0), capB: cap(b, 40) };
}

describe('orienting a mesh', () => {
  test('stand on a plane: the plane\'s normal turned to −Z, its point to the origin; the mesh moves, its file coordinates do not', () => {
    const { constructs, model, a, capA, view } = setup();
    // The cap plane's normal points out of the ball, up +Z.
    nearVec(capA.plane.normal, [0, 0, 1], 1e-6);
    const o = constructs.create('orient', 'plane', [capA.plane.id]);
    assert.equal(o.kind, 'orient');
    assert.equal(o.name, 'Orientation');
    assert.equal(o.parent, a.id);
    assert.equal(o.axis, '-z');
    const pl = model.get(a.id).placement;
    nearVec(turn(pl, capA.plane.normal), [0, 0, -1], 1e-9, 'standing on the cap: the normal points down');
    nearVec(place(pl, capA.plane.point), [0, 0, 0], 1e-9);
    // Stored coordinates are untouched.
    nearVec(capA.sphere.centre, [0, 0, 0], 1e-3);
    // The drawn mesh has moved: its group carries the placement.
    const group = view.objects.get(a.id);
    group.updateMatrixWorld(true);
    const c = new THREE.Vector3(...capA.sphere.centre).applyMatrix4(group.matrixWorld).toArray();
    nearVec(c, place(pl, capA.sphere.centre), 1e-9);
  });

  test('a line onto an axis, which can be changed; the mesh follows', () => {
    const { constructs, model, a, capA } = setup();
    const up = constructs.create('line', 'perpendicular', [capA.plane.id, capA.sphere.id]);
    const o = constructs.create('orient', 'line', [up.id]);
    assert.equal(o.axis, '+z');
    let pl = model.get(a.id).placement;
    nearVec(turn(pl, up.direction), [0, 0, 1], 1e-9);
    nearVec(place(pl, up.point), [0, 0, 0], 1e-9);
    constructs.set(o.id, { axis: '+x' });
    pl = model.get(a.id).placement;
    nearVec(turn(pl, up.direction), [1, 0, 0], 1e-9);
  });

  test('a coordinate system onto the scene axes: the coordinates of a point in it become its scene coordinates', () => {
    const { constructs, model, a, capA } = setup();
    const p = constructs.placePoint({ id: a.id, position: [3, 4, Math.sqrt(75)], anchor: { face: 0 } });
    const axes = constructs.create('frame', 'three-points', [capA.sphere.id, p.id, constructs.create('point', 'centroid', [capA.region.id]).id]);
    constructs.create('orient', 'frame', [axes.id]);
    const pl = model.get(a.id).placement;
    const inAxes = constructs.create('measure', 'coords', [p.id, axes.id]);
    nearVec(place(pl, p.position), inAxes.values, 1e-9);
    nearVec(place(pl, axes.origin), [0, 0, 0], 1e-9);
  });

  test('one orientation per mesh: a new one replaces the old; removing it puts the mesh back', () => {
    const { constructs, model, a, capA } = setup();
    const first = constructs.create('orient', 'plane', [capA.plane.id]);
    const up = constructs.create('line', 'perpendicular', [capA.plane.id, capA.sphere.id]);
    const second = constructs.create('orient', 'line', [up.id]);
    assert.equal(model.get(first.id), null);
    assert.equal(model.children(a.id).filter((n) => n.kind === 'orient').length, 1);
    model.remove(second.id);
    assert.equal(model.get(a.id).placement, null);
  });

  test('orientations follow their inputs, and go with them', () => {
    const { constructs, model, a, capA, regions } = setup();
    const o = constructs.create('orient', 'plane', [capA.plane.id]);
    constructs.set(o.id, { axis: '+z' });
    nearVec(turn(model.get(a.id).placement, capA.plane.normal), [0, 0, 1], 1e-9);
    // Removing the region takes its plane, the orientation with it, and the mesh goes back.
    regions.refresh(capA.region.id);
    model.remove(capA.region.id);
    assert.equal(model.get(o.id), null);
    assert.equal(model.get(a.id).placement, null);
  });

  test('picking on a moved mesh still gives the file\'s coordinates', () => {
    const { constructs, model, a, capA, picker, viewer } = setup();
    constructs.create('orient', 'plane', [capA.plane.id]);
    const pl = model.get(a.id).placement;
    // A point of ball A that faces the camera once A is turned over (its −Z side is now up).
    const fileP = [3, 0, -Math.sqrt(91)];
    const hit = picker.pickAt(...screenOf(viewer, place(pl, fileP)));
    assert.equal(hit?.id, a.id);
    nearVec(hit.position, fileP, 0.3);
  });
});

describe('objects made from two meshes are in scene coordinates', () => {
  test('a distance between centres on two meshes follows when one mesh moves', () => {
    const { constructs, model, capA, capB, b } = setup();
    const d = constructs.create('measure', 'points', [capA.sphere.id, capB.sphere.id]);
    assert.equal(d.parent, null);
    near(d.value, 40, 1e-3);
    // Stand B on its cap plane: B's centre moves to (0, 0, ~-8): the distance follows.
    constructs.create('orient', 'plane', [capB.plane.id]);
    const moved = place(model.get(b.id).placement, capB.sphere.centre);
    near(d.value, Math.hypot(...moved.map((v, i) => v - capA.sphere.centre[i])), 1e-9);
    // A line through them runs in scene coordinates too.
    const l = constructs.create('line', 'two-points', [capA.sphere.id, capB.sphere.id]);
    nearVec(l.ends[1], moved, 1e-9);
    // A distance on one mesh is unchanged by moving it.
    const own = constructs.create('measure', 'point-plane', [capB.sphere.id, capB.plane.id]);
    assert.equal(own.parent, b.id);
  });
});

describe('Properties of a moved mesh and what is on it', () => {
  test('numbers in the scene by default, or as in the file; the mesh shows its placement; the orientation says how', async () => {
    const { describe: describeNode } = await import('../../js/properties-panel.js');
    const { constructs, model, a, capA } = setup();
    const before = describeNode(model, capA.sphere.id);
    assert.equal(before.moved, false);
    const o = constructs.create('orient', 'plane', [capA.plane.id]);
    const pl = model.get(a.id).placement;
    const rows = (d) => Object.fromEntries(d.rows);
    const inScene = describeNode(model, capA.sphere.id);
    assert.equal(inScene.moved, true);
    assert.equal(inScene.space, 'scene');
    assert.equal(rows(inScene).Coordinates, 'of the scene (A has been moved)');
    const c = place(pl, capA.sphere.centre);
    assert.equal(rows(inScene)['Centre x'], c[0].toFixed(3));
    assert.equal(rows(inScene)['Centre z'], c[2].toFixed(3));
    const inFile = describeNode(model, capA.sphere.id, { space: 'file' });
    assert.equal(rows(inFile)['Centre z'], capA.sphere.centre[2].toFixed(3));
    assert.match(rows(inFile).Coordinates, /^as in /);
    // The mesh: its placement, as a turn and a shift, also in the row to copy.
    const m = describeNode(model, a.id);
    assert.equal(m.moved, false, 'a mesh has no choice to make');
    assert.equal(rows(m).Placement, 'moved by Orientation');
    assert.equal(rows(m).Shift, pl.translation.map((v) => v.toFixed(3)).join('  '));
    assert.equal(m.copy.split('\n')[1].split('\t').length, 18);
    // The orientation.
    const od = describeNode(model, o.id);
    assert.equal(od.kind, 'Orientation');
    assert.equal(rows(od).Moves, 'A');
    assert.match(rows(od).How, /^Standing on Plane 1: its normal along −Z, its point at the scene's origin$/);
  });
});
