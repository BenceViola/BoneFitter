import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadMeshBuffer } from '../../js/mesh-loader.js';
import { makeExampleStl, EXAMPLE } from '../../js/sample.js';

// The example is the yardstick for the fitting tests to come, so the numbers
// in EXAMPLE have to be true of the mesh that is actually written.

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// Distance of p from the line through `point` along the unit vector `dir`, and how far along it.
function toAxis(p, { point, direction }) {
  const d = [p[0] - point[0], p[1] - point[1], p[2] - point[2]];
  const along = d[0] * direction[0] + d[1] * direction[1] + d[2] * direction[2];
  return { along, radial: Math.hypot(d[0] - along * direction[0], d[1] - along * direction[1], d[2] - along * direction[2]) };
}

async function vertices() {
  const m = await loadMeshBuffer(makeExampleStl(), EXAMPLE.file);
  const a = m.geometry.attributes.position.array;
  const out = [];
  for (let i = 0; i < a.length; i += 3) out.push([a[i], a[i + 1], a[i + 2]]);
  return out;
}

test('the example\'s neck leaves the shaft at the stated angle', () => {
  const s = new THREE.Vector3(...EXAMPLE.shaft.direction).negate(); // down the shaft, away from the neck
  const n = new THREE.Vector3(...EXAMPLE.neck.direction);
  assert.ok(Math.abs(THREE.MathUtils.radToDeg(s.angleTo(n)) - EXAMPLE.neckShaftAngle) < 1e-9);
  assert.ok(Math.abs(n.length() - 1) < 1e-12, 'directions are unit vectors');
});

test('every vertex of the example lies on one of its stated shapes', async () => {
  const tol = 1e-3; // STL stores single-precision numbers
  const onBall = (p, b) => Math.abs(dist(p, b.centre) - b.radius) < tol;
  const onRod = (p, r) => {
    const { along, radial } = toAxis(p, r);
    const side = Math.abs(radial - r.radius) < tol && along > -tol && along < r.length + tol;
    const cap = radial < r.radius + tol && (Math.abs(along) < tol || Math.abs(along - r.length) < tol);
    return side || cap;
  };
  const counts = { head: 0, condyles: 0, trochanter: 0, shaft: 0, neck: 0 };
  for (const p of await vertices()) {
    if (onBall(p, EXAMPLE.head)) counts.head++;
    else if (EXAMPLE.condyles.some((c) => onBall(p, c))) counts.condyles++;
    else if (onBall(p, EXAMPLE.trochanter)) counts.trochanter++;
    else if (onRod(p, EXAMPLE.shaft)) counts.shaft++;
    else if (onRod(p, EXAMPLE.neck)) counts.neck++;
    else assert.fail(`vertex ${p} is on none of the stated shapes`);
  }
  for (const [part, n] of Object.entries(counts)) assert.ok(n > 500, `${part} has vertices (${n})`);
});

test('the head sits at the end of the neck', () => {
  const { point, direction, length } = EXAMPLE.neck;
  const end = point.map((v, i) => v + direction[i] * length);
  assert.ok(dist(end, EXAMPLE.head.centre) < 1e-9);
});
