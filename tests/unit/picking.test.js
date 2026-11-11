import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Picker } from '../../js/picking.js';
import { loadMeshBuffer } from '../../js/mesh-loader.js';
import { asciiPly, binaryStl } from '../fixtures.js';

// A camera and a fake 100 × 100 px canvas, enough for Picker.pickAt.
function fakeViewer(cameraPos, target = [0, 0, 0]) {
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
  camera.position.set(...cameraPos);
  camera.lookAt(...target);
  camera.updateMatrixWorld(true);
  const domElement = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) };
  return { camera, renderer: { domElement } };
}

// Point on face `face` from barycentric weights, read straight from the geometry.
function fromAnchor(geometry, { face, bary }) {
  const pos = geometry.attributes.position;
  const idx = geometry.index;
  const out = new THREE.Vector3();
  for (let k = 0; k < 3; k++) {
    const vi = idx ? idx.getX(3 * face + k) : 3 * face + k;
    out.addScaledVector(new THREE.Vector3().fromBufferAttribute(pos, vi), bary[k]);
  }
  return out;
}

// First hit by brute force: every triangle tested, in file order.
function bruteForce(geometry, ray) {
  const pos = geometry.attributes.position;
  const idx = geometry.index;
  const n = idx ? idx.count / 3 : pos.count / 3;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), p = new THREE.Vector3();
  let best = null;
  for (let f = 0; f < n; f++) {
    const [ia, ib, ic] = [0, 1, 2].map((k) => (idx ? idx.getX(3 * f + k) : 3 * f + k));
    a.fromBufferAttribute(pos, ia); b.fromBufferAttribute(pos, ib); c.fromBufferAttribute(pos, ic);
    if (ray.intersectTriangle(a, b, c, false, p)) {
      const d = ray.origin.distanceTo(p);
      if (!best || d < best.d) best = { d, face: f };
    }
  }
  return best;
}

const knot = () => new THREE.TorusKnotGeometry(10, 3, 120, 16);

describe('picking keeps file face order', () => {
  test('non-indexed (STL) geometry is not modified by the BVH', () => {
    const g = knot().toNonIndexed();
    const before = g.attributes.position.array.slice();
    new Picker(fakeViewer([0, 0, 50])).add('m', g);
    assert.equal(g.index, null, 'no index added');
    assert.deepEqual(g.attributes.position.array, before);
  });

  test('indexed (PLY) geometry keeps its index order', () => {
    const g = knot();
    const before = g.index.array.slice();
    new Picker(fakeViewer([0, 0, 50])).add('m', g);
    assert.deepEqual(g.index.array, before, 'a non-indirect BVH would have reordered this');
  });

  for (const [label, make] of [['non-indexed', () => knot().toNonIndexed()], ['indexed', knot]]) {
    test(`${label}: face index matches brute force, and every anchor reproduces its position`, () => {
      const g = make();
      const picker = new Picker(fakeViewer([0, 0, 50]));
      picker.add('m', g);
      let hits = 0;
      const rnd = mulberry32(42);
      for (let i = 0; i < 300; i++) {
        const dir = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
        const ray = new THREE.Ray(dir.clone().multiplyScalar(-60), dir);
        const expected = bruteForce(g, ray);
        picker.raycaster.ray.copy(ray);
        picker.raycaster.near = 0;
        picker.raycaster.far = Infinity;
        const h = picker.raycaster.intersectObject(picker.targets.get('m').mesh)[0];
        if (!expected) {
          assert.equal(h, undefined, `ray ${i}: no hit expected`);
          continue;
        }
        hits++;
        assert.equal(h.faceIndex, expected.face, `ray ${i}: face`);
        const fields = picker._fields(g, h.point, h.faceIndex);
        const back = fromAnchor(g, fields.anchor);
        assert.ok(back.distanceTo(new THREE.Vector3(...fields.position)) < 1e-4, `ray ${i}: anchor`);
        const w = fields.anchor.bary;
        assert.ok(Math.abs(w[0] + w[1] + w[2] - 1) < 1e-5, 'weights sum to 1');
        assert.ok(w.every((x) => x > -1e-6 && x < 1 + 1e-6), 'point lies inside the triangle');
      }
      assert.ok(hits > 50, `enough rays hit (${hits})`);
    });
  }
});

describe('pickAt and helpers', () => {
  // Square in z = 0 from (0,0) to (2,2), viewed straight down from above its centre.
  const square = () => {
    const g = new THREE.PlaneGeometry(2, 2).toNonIndexed();
    g.translate(1, 1, 0);
    return g;
  };

  test('clicking the canvas centre picks the point under it, with normal and rounded numbers', () => {
    const picker = new Picker(fakeViewer([1, 1, 10], [1, 1, 0]));
    picker.add('m', square());
    const r = picker.pickAt(50, 50);
    assert.ok(r, 'something was hit');
    assert.equal(r.id, 'm', 'the hit says which mesh it is on');
    assert.ok(Math.abs(r.position[0] - 1) < 1e-6 && Math.abs(r.position[1] - 1) < 1e-6 && r.position[2] === 0);
    assert.deepEqual(r.normal.map(Math.abs), [0, 0, 1]);
    for (const n of [...r.position, ...r.anchor.bary, ...r.normal]) {
      assert.equal(n, Math.round(n * 1e6) / 1e6, 'at most 6 decimals');
    }
  });

  test('clicking off the mesh picks nothing', () => {
    const picker = new Picker(fakeViewer([1, 1, 10], [1, 1, 0]));
    picker.add('m', square());
    assert.equal(picker.pickAt(0, 0), null);
  });

  test('pickAt with no mesh open returns null', () => {
    assert.equal(new Picker(fakeViewer([0, 0, 5])).pickAt(50, 50), null);
  });

  test('isHidden: a point behind the surface is hidden, one in front is not', () => {
    const picker = new Picker(fakeViewer([1, 1, 10], [1, 1, 0]));
    picker.add('m', square());
    const cam = new THREE.Vector3(1, 1, 10);
    assert.equal(picker.isHidden(new THREE.Vector3(1, 1, -1), cam, 0.01), true);
    assert.equal(picker.isHidden(new THREE.Vector3(1, 1, 0.5), cam, 0.01), false);
    assert.equal(picker.isHidden(new THREE.Vector3(1, 1, 0), cam, 0.01), false, 'a point on the surface is visible');
  });

  test('surfaceDistance along a ray', () => {
    const picker = new Picker(fakeViewer([1, 1, 10], [1, 1, 0]));
    picker.add('m', square());
    const d = picker.surfaceDistance(new THREE.Ray(new THREE.Vector3(1, 1, 10), new THREE.Vector3(0, 0, -1)));
    assert.ok(Math.abs(d - 10) < 1e-6);
    assert.equal(picker.surfaceDistance(new THREE.Ray(new THREE.Vector3(1, 1, 10), new THREE.Vector3(0, 0, 1))), null);
  });

  test('snap moves a point onto the nearest surface point, with a matching anchor', () => {
    const g = square();
    const picker = new Picker(fakeViewer([1, 1, 10], [1, 1, 0]));
    picker.add('m', g);
    const s = picker.snap('m', [0.5, 1.5, 0.3]);
    assert.ok(Math.abs(s.distance - 0.3) < 1e-6);
    assert.deepEqual(s.fields.position, [0.5, 1.5, 0]);
    assert.ok(fromAnchor(g, s.fields.anchor).distanceTo(new THREE.Vector3(0.5, 1.5, 0)) < 1e-6);
  });

  test('snap anchors agree with the file faces on a large indexed mesh', () => {
    const g = knot();
    const picker = new Picker(fakeViewer([0, 0, 50]));
    picker.add('m', g);
    const rnd = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const q = [rnd() * 30 - 15, rnd() * 30 - 15, rnd() * 10 - 5];
      const s = picker.snap('m', q);
      const back = fromAnchor(g, s.fields.anchor);
      assert.ok(back.distanceTo(new THREE.Vector3(...s.fields.position)) < 1e-4, `point ${i}`);
    }
  });

  test('loaded STL and PLY meshes pick the same face as the file defines', async () => {
    // Two triangles side by side; the right one (x > 1) is face 1 in the file.
    const verts = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [2, 0, 0], [2, 1, 0]];
    const ply = await loadMeshBuffer(asciiPly(verts, [[0, 1, 2], [1, 3, 4]]), 'two.ply');
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 1, 0, 0, 2, 0, 0, 2, 1, 0], 3));
    const stl = await loadMeshBuffer(binaryStl(g2), 'two.stl');
    for (const m of [ply, stl]) {
      const picker = new Picker(fakeViewer([1.75, 0.25, 10], [1.75, 0.25, 0]));
      picker.add('m', m.geometry);
      assert.equal(picker.pickAt(50, 50).anchor.face, 1, m.name);
    }
  });
});

describe('several meshes', () => {
  // Two squares facing the camera, one behind the other: z = 0 and z = -3.
  const squareAt = (z) => {
    const g = new THREE.PlaneGeometry(2, 2).toNonIndexed();
    g.translate(1, 1, z);
    return g;
  };

  test('the nearest mesh under the cursor is picked', () => {
    const picker = new Picker(fakeViewer([1, 1, 10], [1, 1, 0]));
    picker.add('far', squareAt(-3));
    picker.add('near', squareAt(0));
    const r = picker.pickAt(50, 50);
    assert.equal(r.id, 'near');
    assert.equal(r.position[2], 0);
  });

  test('a hidden mesh is skipped, so the one behind it is picked', () => {
    const picker = new Picker(fakeViewer([1, 1, 10], [1, 1, 0]));
    picker.add('far', squareAt(-3));
    picker.add('near', squareAt(0));
    picker.canPick = (id) => id !== 'near';
    const r = picker.pickAt(50, 50);
    assert.equal(r.id, 'far');
    assert.equal(r.position[2], -3);
  });

  test('a removed mesh is no longer picked', () => {
    const picker = new Picker(fakeViewer([1, 1, 10], [1, 1, 0]));
    picker.add('near', squareAt(0));
    picker.remove('near');
    assert.equal(picker.has('near'), false);
    assert.equal(picker.pickAt(50, 50), null);
  });

  test('on a mesh that has been moved, a hit is given in the mesh file\'s own coordinates', () => {
    // The square is turned a quarter turn about Y and shifted. A ray is aimed
    // at where the file point (0.5, 1.5, 0) now is in the scene.
    const g = squareAt(0);
    const owner = new THREE.Group();
    owner.rotation.y = Math.PI / 2;
    owner.position.set(40, -7, 12);
    owner.updateMatrixWorld(true);
    const inScene = new THREE.Vector3(0.5, 1.5, 0).applyMatrix4(owner.matrixWorld);
    const facing = new THREE.Vector3(0, 0, 1).transformDirection(owner.matrixWorld); // the square's normal in the scene

    const picker = new Picker(fakeViewer([0, 0, 50]));
    picker.add('moved', g, owner);
    const from = inScene.clone().addScaledVector(facing, 20);
    const r = picker.pickRay(new THREE.Ray(from, facing.clone().negate()));
    assert.equal(r.id, 'moved');
    assert.deepEqual(r.position, [0.5, 1.5, 0], 'file coordinates, not scene coordinates');
    assert.ok(fromAnchor(g, r.anchor).distanceTo(new THREE.Vector3(0.5, 1.5, 0)) < 1e-6, 'the anchor is on the file\'s face');
    assert.deepEqual(r.normal.map(Math.abs), [0, 0, 1], 'the normal is the file\'s too');
    assert.ok(Math.abs(picker.surfaceDistance(new THREE.Ray(from, facing.clone().negate())) - 20) < 1e-6, 'distances are measured in the scene');

    // Moving the owner later is followed without adding the mesh again.
    owner.position.x += 100;
    assert.equal(picker.pickRay(new THREE.Ray(from, facing.clone().negate())), null);
  });
});

// Small seeded random generator, so failures can be reproduced.
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
