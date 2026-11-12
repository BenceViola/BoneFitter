// Selecting triangles by drawing on the screen: a lasso (any outline) or a
// box. Pure maths apart from the camera's matrices; no page.
//
// A triangle is selected when its centre falls inside the outline as seen
// on the screen. With "visible surface only" it must also be visible there:
// the first surface along the line of sight from the camera to its centre,
// so the far side of a bone, and anything hidden behind other parts, is left
// out. Without it, everything inside the outline is selected, through the
// bone.
//
// Outlines are given in normalised screen coordinates (x and y from −1 to 1,
// y up), the same whatever the size of the window, and are kept on the
// region with the camera's view, as a record of how it was selected.

// Is (x, y) inside the polygon `points` ([[x, y], …])? Even–odd rule.
export function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// A test for "is this screen point inside the shape?". `shape` is
// { type: 'lasso', points: [[x, y], …] } or { type: 'box', min: [x, y], max: [x, y] }.
export function shapeTest(shape) {
  if (shape.type === 'box') {
    const [x0, y0] = shape.min;
    const [x1, y1] = shape.max;
    return (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  }
  const pts = shape.points;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y);
    x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && pointInPolygon(x, y, pts);
}

/**
 * The faces of a geometry whose centres lie inside `shape` on screen.
 *   geometry    the source geometry (positions in the mesh file's coordinates)
 *   toScreen    a 4 × 4 matrix (16 numbers, column-major, as three.js keeps
 *               them) from file coordinates to clip space: the camera's
 *               projection × view × the mesh's own placement
 *   toScene     a 4 × 4 matrix from file coordinates to scene coordinates
 *   isVisible   (x, y, z in scene coordinates) => bool, or null to select
 *               through the surface
 * Returns the file's face numbers, in rising order.
 */
export function facesInShape(geometry, shape, { toScreen, toScene, isVisible = null }) {
  const inside = shapeTest(shape);
  const pos = geometry.attributes.position;
  const index = geometry.index;
  const nF = (index ? index.count : pos.count) / 3;
  const m = toScreen;
  const s = toScene;
  const out = [];
  for (let f = 0; f < nF; f++) {
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < 3; k++) {
      const v = index ? index.getX(3 * f + k) : 3 * f + k;
      cx += pos.getX(v);
      cy += pos.getY(v);
      cz += pos.getZ(v);
    }
    cx /= 3;
    cy /= 3;
    cz /= 3;
    const w = m[3] * cx + m[7] * cy + m[11] * cz + m[15];
    if (!(w > 0)) continue; // behind the camera
    const x = (m[0] * cx + m[4] * cy + m[8] * cz + m[12]) / w;
    const y = (m[1] * cx + m[5] * cy + m[9] * cz + m[13]) / w;
    const z = (m[2] * cx + m[6] * cy + m[10] * cz + m[14]) / w;
    if (z < -1 || z > 1 || !inside(x, y)) continue;
    if (isVisible) {
      const px = s[0] * cx + s[4] * cy + s[8] * cz + s[12];
      const py = s[1] * cx + s[5] * cy + s[9] * cz + s[13];
      const pz = s[2] * cx + s[6] * cy + s[10] * cz + s[14];
      if (!isVisible(px, py, pz)) continue;
    }
    out.push(f);
  }
  return Uint32Array.from(out);
}

// Two sorted face lists combined: 'add' (either), 'remove' (in a but not b).
export function combineFaces(a, b, mode) {
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (j >= b.length || (i < a.length && a[i] < b[j])) {
      out.push(a[i++]);
    } else if (i >= a.length || b[j] < a[i]) {
      if (mode === 'add') out.push(b[j]);
      j++;
    } else {
      if (mode === 'add') out.push(a[i]);
      i++;
      j++;
    }
  }
  return Uint32Array.from(out);
}

// Every face of a mesh of `count` faces that is not in the sorted list `faces`.
export function otherFaces(faces, count) {
  const out = new Uint32Array(count - faces.length);
  let i = 0;
  let k = 0;
  for (let f = 0; f < count; f++) {
    if (i < faces.length && faces[i] === f) i++;
    else out[k++] = f;
  }
  return out.subarray(0, k);
}

const round = (n) => Math.round(n * 1e6) / 1e6;

// The area of faces of a geometry, and their area-weighted centroid.
export function faceStats(geometry, faces) {
  const pos = geometry.attributes.position;
  const index = geometry.index;
  let area = 0;
  const sum = [0, 0, 0];
  const p = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const f of faces) {
    for (let k = 0; k < 3; k++) {
      const v = index ? index.getX(3 * f + k) : 3 * f + k;
      p[k][0] = pos.getX(v);
      p[k][1] = pos.getY(v);
      p[k][2] = pos.getZ(v);
    }
    const ux = p[1][0] - p[0][0], uy = p[1][1] - p[0][1], uz = p[1][2] - p[0][2];
    const vx = p[2][0] - p[0][0], vy = p[2][1] - p[0][1], vz = p[2][2] - p[0][2];
    const a = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    area += a;
    for (let j = 0; j < 3; j++) sum[j] += (a * (p[0][j] + p[1][j] + p[2][j])) / 3;
  }
  return { area: round(area), centroid: area > 0 ? sum.map((v) => round(v / area)) : null };
}
