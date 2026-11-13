// Where a mesh sits in the scene: its placement, a turn and a shift (no
// scaling, ever). Scene coordinates = rotation · file coordinates + translation.
//
// A mesh's vertices and everything attached to it stay in the mesh file's
// own coordinates (the ground rule, and the landmark-json format's); only
// the placement says where it all appears. `null` means where the file puts it.
//
//   placement = { rotation: [[r00, r01, r02], [r10, r11, r12], [r20, r21, r22]], translation: [x, y, z] }
//
// No page, no three.js.

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const clean = (a) => a.map((v) => v || 0);

export const IDENTITY = { rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], translation: [0, 0, 0] };

// Has this placement moved anything?
export function isMoved(pl) {
  if (!pl) return false;
  const r = pl.rotation;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(pl.translation[i]) > 1e-12) return true;
    for (let j = 0; j < 3; j++) if (Math.abs(r[i][j] - (i === j ? 1 : 0)) > 1e-12) return true;
  }
  return false;
}

// A direction turned with the mesh.
export const turn = (pl, v) => (pl ? clean(pl.rotation.map((row) => dot(row, v))) : v.slice());
// A point moved with the mesh.
export const place = (pl, p) => (pl ? turn(pl, p).map((v, i) => v + pl.translation[i]) : p.slice());

// The placement that undoes this one.
export function inverse(pl) {
  const R = pl.rotation;
  const Rt = [0, 1, 2].map((i) => [R[0][i], R[1][i], R[2][i]]);
  const t = Rt.map((row) => -dot(row, pl.translation));
  return { rotation: Rt, translation: clean(t) };
}

// The rotation that turns unit vector `a` onto unit vector `b` by the
// smallest turn (about the axis square to both). Rows, as in a placement.
export function rotationBetween(a, b) {
  const c = dot(a, b);
  const v = cross(a, b);
  const s = norm(v);
  if (s < 1e-12) {
    if (c > 0) return IDENTITY.rotation.map((r) => r.slice());
    // Opposite: half a turn about any axis square to a.
    const helper = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const k = cross(a, helper).map((x, _, arr) => x / norm(arr));
    return [0, 1, 2].map((i) => [0, 1, 2].map((j) => 2 * k[i] * k[j] - (i === j ? 1 : 0)));
  }
  // Rodrigues: R = I + [v]× + [v]×² (1 − c) / s².
  const K = [[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]];
  const K2 = [0, 1, 2].map((i) => [0, 1, 2].map((j) => K[i][0] * K[0][j] + K[i][1] * K[1][j] + K[i][2] * K[2][j]));
  const f = (1 - c) / (s * s);
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => (i === j ? 1 : 0) + K[i][j] + K2[i][j] * f));
}

// The 16 numbers of the placement as a three.js Matrix4 takes them (column by column).
export function matrixElements(pl) {
  const p = pl ?? IDENTITY;
  const R = p.rotation;
  const t = p.translation;
  return [R[0][0], R[1][0], R[2][0], 0, R[0][1], R[1][1], R[2][1], 0, R[0][2], R[1][2], R[2][2], 0, t[0], t[1], t[2], 1];
}

// Fields of an object that are points, lists of points, and directions.
const POINTS = ['position', 'centre', 'point', 'origin', 'foot', 'centroid'];
const POINT_LISTS = ['ends', 'line'];
const DIRECTIONS = ['normal', 'direction', 'x', 'y', 'z', 'delta'];

// A copy of an object (a tree node) with every position and direction in it
// moved with the mesh: what it is in scene coordinates. Lengths, angles and
// coordinates within a coordinate system don't change and are kept.
export function nodeInScene(node, pl) {
  if (!node || !isMoved(pl)) return node;
  const out = { ...node };
  for (const k of POINTS) if (Array.isArray(node[k]) && node[k].length === 3 && typeof node[k][0] === 'number') out[k] = place(pl, node[k]);
  for (const k of POINT_LISTS) if (Array.isArray(node[k]) && Array.isArray(node[k][0])) out[k] = node[k].map((p) => place(pl, p));
  for (const k of DIRECTIONS) if (Array.isArray(node[k]) && node[k].length === 3 && typeof node[k][0] === 'number') out[k] = turn(pl, node[k]);
  if (Array.isArray(node.segments)) out.segments = node.segments.map((s) => s.map((p) => place(pl, p)));
  if (Array.isArray(node.control_points)) out.control_points = node.control_points.map((c) => ({ ...c, position: place(pl, c.position) }));
  // A plane's equation n · x = d moves with it.
  if (node.kind === 'plane' && out.normal && out.point) out.d = dot(out.normal, out.point);
  return out;
}
