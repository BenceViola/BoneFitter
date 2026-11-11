import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { regionGeometry, meshArea, stlBytes, plyBytes } from '../../js/mesh-export.js';
import { loadMeshBuffer } from '../../js/mesh-loader.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≉ ${b} (±${tol})`);
const positions = (g) => [...regionGeometry(g, null).attributes.position.array];

describe('meshes from regions, and their area', () => {
  test('a region\'s faces become a mesh of their own, in face order, coordinates untouched', () => {
    const g = new THREE.BoxGeometry(2, 4, 6, 2, 2, 2); // indexed
    const faces = Uint32Array.from([3, 10, 11, 40]);
    const r = regionGeometry(g, faces);
    assert.equal(r.index, null);
    assert.equal(r.attributes.position.count, 12);
    const src = g.attributes.position;
    for (let i = 0; i < faces.length; i++) {
      for (let k = 0; k < 3; k++) {
        const v = g.index.getX(3 * faces[i] + k);
        assert.deepEqual(
          [r.attributes.position.getX(3 * i + k), r.attributes.position.getY(3 * i + k), r.attributes.position.getZ(3 * i + k)],
          [src.getX(v), src.getY(v), src.getZ(v)]
        );
      }
    }
  });

  test('surface area is the sum of the triangles\' areas, indexed or not', () => {
    near(meshArea(new THREE.BoxGeometry(10, 20, 30, 3, 3, 3)), 2 * (200 + 300 + 600), 1e-9);
    near(meshArea(new THREE.BoxGeometry(10, 20, 30, 3, 3, 3).toNonIndexed()), 2200, 1e-9);
    near(meshArea(new THREE.SphereGeometry(5, 192, 96)), 4 * Math.PI * 25, 0.01 * 4 * Math.PI * 25);
  });
});

describe('writing meshes', () => {
  test('STL: read back, the same triangles in the same order, and the same area', async () => {
    const g = new THREE.SphereGeometry(3, 16, 8);
    g.translate(100.25, -40.5, 7);
    const m = await loadMeshBuffer(stlBytes(g), 'ball.stl');
    assert.equal(m.format, 'STL, binary');
    assert.equal(m.faceCount, g.index.count / 3);
    assert.deepEqual([...m.geometry.attributes.position.array], positions(g).map(Math.fround));
    near(meshArea(m.geometry), meshArea(g), 1e-6);
  });

  test('the same mesh always gives the same STL bytes, so a saved file is recognised when opened again', async () => {
    const g = new THREE.SphereGeometry(3, 16, 8).toNonIndexed();
    const a = await loadMeshBuffer(stlBytes(g), 'a.stl');
    const b = await loadMeshBuffer(stlBytes(a.geometry), 'b.stl');
    assert.equal(a.sha256, b.sha256);
  });

  test('PLY: corners at the same position become one vertex; read back, the same triangles and area', async () => {
    const g = new THREE.TetrahedronGeometry(2).toNonIndexed(); // 12 corners, 4 places
    const bytes = plyBytes(g);
    const head = new TextDecoder().decode(bytes.slice(0, 200));
    assert.match(head, /format binary_little_endian 1\.0/);
    assert.match(head, /element vertex 4\n/);
    assert.match(head, /element face 4\n/);
    const m = await loadMeshBuffer(bytes, 'tet.ply');
    assert.equal(m.faceCount, 4);
    assert.equal(m.vertexCount, 4);
    const back = positions(m.geometry);
    assert.deepEqual(back, positions(g).map(Math.fround));
    near(meshArea(m.geometry), meshArea(g), 1e-6);
  });

  test('PLY of a large mesh stays compact: about half a vertex per triangle on a closed surface', () => {
    const g = new THREE.SphereGeometry(5, 128, 64).toNonIndexed();
    const bytes = plyBytes(g);
    const nv = Number(/element vertex (\d+)/.exec(new TextDecoder().decode(bytes.slice(0, 300)))[1]);
    const nf = g.attributes.position.count / 3;
    assert.ok(nv < 0.6 * nf, `${nv} vertices for ${nf} triangles`);
  });
});
