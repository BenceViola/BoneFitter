// Builds a small example mesh so the viewer has something to show before a
// file is opened: a toy femur made of exact shapes (a rod for the shaft, a
// thinner rod for the neck, a ball for the head, two balls for the condyles,
// and a ball rounding off the top of the shaft where the neck leaves it).
// Because every part has known measurements (EXAMPLE below), the same mesh
// is the yardstick for the fitting tests: a sphere fitted to the head must
// give back its centre and radius.
//
// It is written out as a real binary STL and read back through the normal
// loader, so it behaves exactly like an opened file. It sits away from the
// origin on purpose: coordinates shown in the app should match the file,
// not a re-centred copy.
//
// Adapted from Landmarker3D's js/sample.js (which builds a pebble).

import * as THREE from 'three';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const OFFSET = [12.5, -40.2, 103.7];
const NECK_SHAFT_ANGLE = 125; // degrees, between the neck and the shaft below it
const SHAFT_LENGTH = 100;
const NECK_LENGTH = 30;

const tilt = THREE.MathUtils.degToRad(180 - NECK_SHAFT_ANGLE);
// The shaft runs up the Y axis, so the example stands upright in the default view.
const neckDir = [Math.sin(tilt), Math.cos(tilt), 0];
const at = (x, y, z) => [x + OFFSET[0], y + OFFSET[1], z + OFFSET[2]];

// The measurements the example was built with, in the file's coordinates.
export const EXAMPLE = {
  file: 'example-femur.stl',
  neckShaftAngle: NECK_SHAFT_ANGLE,
  shaft: { point: at(0, 0, 0), direction: [0, 1, 0], radius: 7, length: SHAFT_LENGTH },
  neck: { point: at(0, SHAFT_LENGTH, 0), direction: neckDir, radius: 5, length: NECK_LENGTH },
  head: {
    centre: at(neckDir[0] * NECK_LENGTH, SHAFT_LENGTH + neckDir[1] * NECK_LENGTH, 0),
    radius: 12,
  },
  trochanter: { centre: at(0, SHAFT_LENGTH, 0), radius: 7 },
  condyles: [
    { centre: at(10, 0, 0), radius: 11 },
    { centre: at(-10, 0, 0), radius: 11 },
  ],
};

// A capped rod from `point` along `direction` (three.js cylinders run along Y).
function rod({ point, direction, radius, length }) {
  const g = new THREE.CylinderGeometry(radius, radius, length, 48, 8).toNonIndexed();
  const dir = new THREE.Vector3(...direction);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
  const mid = new THREE.Vector3(...point).addScaledVector(dir, length / 2);
  g.translate(mid.x, mid.y, mid.z);
  return g;
}

function ball({ centre, radius }) {
  const g = new THREE.SphereGeometry(radius, 48, 32).toNonIndexed();
  g.translate(...centre);
  return g;
}

export function makeExampleStl() {
  const parts = [rod(EXAMPLE.shaft), rod(EXAMPLE.neck), ball(EXAMPLE.head), ball(EXAMPLE.trochanter), ...EXAMPLE.condyles.map(ball)];
  for (const p of parts) p.deleteAttribute('uv');
  const g = mergeGeometries(parts);
  const view = new STLExporter().parse(new THREE.Mesh(g), { binary: true });
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}
