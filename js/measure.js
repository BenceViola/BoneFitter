// The maths of measuring, and of coordinate systems. No page, no three.js.
//
// Inputs are plain geometry: a point [x, y, z]; a line { point, direction }
// (unit direction); a plane { point, normal, d } (unit normal, normal · x = d).
// Results carry `value` (a length, or degrees), what to draw (`segment` or
// `segments`), and extra numbers where they mean something.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => scale(a, 1 / norm(a));
const clean = (a) => a.map((v) => v || 0);
const DEG = 180 / Math.PI;
const acosDeg = (c) => Math.acos(Math.max(-1, Math.min(1, c))) * DEG;
const EPS = 1e-9;

// ---- Distances ------------------------------------------------------------

export function pointToPoint(a, b) {
  const delta = sub(b, a);
  return { value: norm(delta), delta, segment: [a.slice(), b.slice()], error: null };
}

export function pointToLine(p, line) {
  const foot = add(line.point, scale(line.direction, dot(sub(p, line.point), line.direction)));
  return { value: norm(sub(p, foot)), foot, segment: [p.slice(), foot], error: null };
}

// `signed` is positive on the side the normal points to.
export function pointToPlane(p, plane) {
  const signed = dot(plane.normal, p) - plane.d;
  const foot = sub(p, scale(plane.normal, signed));
  return { value: Math.abs(signed), signed, foot, segment: [p.slice(), foot], error: null };
}

// The shortest distance between two lines, between the two points where
// they come nearest (for parallel lines: from the first line's point).
export function lineToLine(a, b) {
  const w = sub(a.point, b.point);
  const c = cross(a.direction, b.direction);
  if (norm(c) < EPS) {
    const r = pointToLine(a.point, b);
    return { value: r.value, segment: [a.point.slice(), r.foot], parallel: true, error: null };
  }
  const B = dot(a.direction, b.direction);
  const D = dot(a.direction, w);
  const E = dot(b.direction, w);
  const den = 1 - B * B;
  const s = (B * E - D) / den;
  const t = (E - B * D) / den;
  const p = add(a.point, scale(a.direction, s));
  const q = add(b.point, scale(b.direction, t));
  return { value: norm(sub(q, p)), segment: [p, q], parallel: false, error: null };
}

// ---- Angles -------------------------------------------------------------

// Between two lines (by their directions, 0–180°), a line and a plane (from
// the plane, positive towards the side its normal points to: −90° to 90°),
// or two planes (between their normals, 0–180°). `acute` is the smaller
// angle the two make, whichever way they point (0–90°).
export function angleBetween(a, b) {
  if (a.kind === 'plane' && b.kind === 'line') return angleBetween(b, a);
  if (a.kind === 'line' && b.kind === 'plane') {
    const value = Math.asin(Math.max(-1, Math.min(1, dot(a.direction, b.normal)))) * DEG;
    return { value, acute: Math.abs(value), between: 'line-plane', error: null };
  }
  const u = a.kind === 'plane' ? a.normal : a.direction;
  const v = b.kind === 'plane' ? b.normal : b.direction;
  const value = acosDeg(dot(u, v));
  return { value, acute: Math.min(value, 180 - value), between: a.kind === 'plane' ? 'planes' : 'lines', error: null };
}

// The angle at `corner` between the directions to `a` and to `b`.
export function cornerAngle(corner, a, b) {
  const u = sub(a, corner);
  const v = sub(b, corner);
  if (norm(u) < EPS || norm(v) < EPS) return { value: 0, segments: null, error: 'same' };
  return { value: acosDeg(dot(unit(u), unit(v))), segments: [[corner.slice(), a.slice()], [corner.slice(), b.slice()]], error: null };
}

// Two lines as seen on a plane (looking at it against its normal): how far
// the first must turn to lie along the second, anticlockwise about the
// normal positive (−180° to 180°). Torsion and version angles are this,
// on the plane square to a bone's long axis.
export function angleOnPlane(a, b, plane) {
  const n = plane.normal;
  const pa = sub(a.direction, scale(n, dot(a.direction, n)));
  const pb = sub(b.direction, scale(n, dot(b.direction, n)));
  if (norm(pa) < 1e-6 || norm(pb) < 1e-6) return { value: 0, error: 'square' };
  const value = Math.atan2(dot(n, cross(pa, pb)), dot(pa, pb)) * DEG;
  return { value, error: null };
}

// ---- Coordinate systems -----------------------------------------------------

const NEXT = { x: 'y', y: 'z', z: 'x' };

// A right-handed coordinate system at `origin`: the axis named `primary`
// along `first`, the axis named `secondary` along `second` squared up to
// the first (the part of it across the first), the third axis to make
// x × y = z. Returns { origin, x, y, z, error }.
export function makeFrame(origin, first, second, primary, secondary) {
  const fail = (error) => ({ origin: null, x: null, y: null, z: null, error });
  if (primary === secondary || !NEXT[primary] || !NEXT[secondary]) return fail('axes');
  const p = unit(first);
  const across = sub(second, scale(p, dot(second, p)));
  if (norm(across) < 1e-6 * norm(second)) return fail('parallel');
  const s = unit(across);
  const third = Object.keys(NEXT).find((k) => k !== primary && k !== secondary);
  // In the order x → y → z → x, the third follows the second if the second follows the first.
  const t = NEXT[primary] === secondary ? cross(p, s) : cross(s, p);
  return { origin: origin.slice(), ...{ [primary]: clean(p), [secondary]: clean(s), [third]: clean(t) }, error: null };
}

// A point's coordinates in a coordinate system.
export function inFrame(p, frame) {
  const d = sub(p, frame.origin);
  return [dot(d, frame.x), dot(d, frame.y), dot(d, frame.z)];
}
