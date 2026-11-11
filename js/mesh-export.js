// Meshes made from regions, and meshes written out as files.
//
//   regionGeometry  the triangles of a region as a mesh of their own, in the
//                   same coordinates as the mesh they came from
//   meshArea        the surface area of a mesh: the sum of its triangles' areas
//   stlBytes        a binary STL file (triangles with their own corners)
//   plyBytes        a binary PLY file, with corners at the same position
//                   joined into one vertex (smaller, and what most software
//                   expects)
//
// Coordinates are written as they are (single precision, as in the files
// they were read from): nothing is moved or scaled.

import * as THREE from 'three';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';

// The positions of a geometry's triangles, 9 numbers each, in face order.
function corners(geometry, faces = null) {
  const pos = geometry.attributes.position;
  const index = geometry.index;
  const count = faces ? faces.length : (index ? index.count : pos.count) / 3;
  const out = new Float32Array(count * 9);
  for (let i = 0; i < count; i++) {
    const f = faces ? faces[i] : i;
    for (let k = 0; k < 3; k++) {
      const v = index ? index.getX(3 * f + k) : 3 * f + k;
      out[9 * i + 3 * k] = pos.getX(v);
      out[9 * i + 3 * k + 1] = pos.getY(v);
      out[9 * i + 3 * k + 2] = pos.getZ(v);
    }
  }
  return out;
}

// The faces `faces` (the file's face numbers) of `geometry`, as a new
// geometry with only those triangles, in that order.
export function regionGeometry(geometry, faces) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(corners(geometry, faces), 3));
  return g;
}

export function meshArea(geometry) {
  const c = corners(geometry);
  let area = 0;
  for (let o = 0; o < c.length; o += 9) {
    const ux = c[o + 3] - c[o], uy = c[o + 4] - c[o + 1], uz = c[o + 5] - c[o + 2];
    const vx = c[o + 6] - c[o], vy = c[o + 7] - c[o + 1], vz = c[o + 8] - c[o + 2];
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return area;
}

// A binary STL file (ArrayBuffer) of a geometry's triangles, in face order.
export function stlBytes(geometry) {
  const g = regionGeometry(geometry, null);
  const view = new STLExporter().parse(new THREE.Mesh(g), { binary: true });
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}

// A binary PLY file (ArrayBuffer): vertices with corners at exactly the same
// position joined, then the triangles in face order.
export function plyBytes(geometry, { comment = 'made by BoneFitter' } = {}) {
  const c = corners(geometry);
  const bits = new Uint32Array(c.buffer);
  const seen = new Map();
  const verts = [];
  const tri = new Int32Array(c.length / 3);
  for (let i = 0; i < c.length / 3; i++) {
    const key = `${bits[3 * i]},${bits[3 * i + 1]},${bits[3 * i + 2]}`;
    let v = seen.get(key);
    if (v === undefined) {
      v = verts.length / 3;
      seen.set(key, v);
      verts.push(c[3 * i], c[3 * i + 1], c[3 * i + 2]);
    }
    tri[i] = v;
  }
  const nv = verts.length / 3;
  const nf = tri.length / 3;
  const header = new TextEncoder().encode(
    `ply\nformat binary_little_endian 1.0\ncomment ${comment}\nelement vertex ${nv}\nproperty float x\nproperty float y\nproperty float z\nelement face ${nf}\nproperty list uchar int vertex_indices\nend_header\n`
  );
  const out = new ArrayBuffer(header.length + nv * 12 + nf * 13);
  new Uint8Array(out).set(header);
  const dv = new DataView(out);
  let o = header.length;
  for (let i = 0; i < verts.length; i++, o += 4) dv.setFloat32(o, verts[i], true);
  for (let f = 0; f < nf; f++) {
    dv.setUint8(o, 3);
    o += 1;
    for (let k = 0; k < 3; k++, o += 4) dv.setInt32(o, tri[3 * f + k], true);
  }
  return out;
}
