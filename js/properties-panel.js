// The Properties panel: the facts and numbers of the selected object, with
// a button to copy them (tab-separated, so they paste into a spreadsheet).
//
// `describe(model, id)` is pure, so the rows can be tested without a page.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const int = (n) => Number(n).toLocaleString('en-US');
const num = (n) => Number(n).toFixed(3);
import { isMoved, nodeInScene } from './placement.js';
import { capAngle } from './fit.js';
import { FIT_KINDS } from './fit-engine.js';

// Above this, a cylinder's surface curves almost as much along it as round it.
const ROUND_SPREAD = 0.3;
const dir = (n) => Number(n).toFixed(4);

// Below this cap angle (degrees) a fitted sphere's size is poorly fixed.
const SHALLOW_CAP = 30;

const KIND = { mesh: 'Mesh', group: 'Landmark file', point: 'Point', line: 'Line', frame: 'Coordinate system', measure: 'Measurement', orient: 'Orientation', curve: 'Curve', region: 'Region', sphere: 'Sphere', plane: 'Plane', cylinder: 'Cylinder' };

// Why curves give no region, for the person looking at it.
const REGION_PROBLEMS = {
  small: 'The curve is no bigger than a few triangles, too small to enclose a region.',
  apart: 'Part of the curve jumps between separate pieces of the mesh, so it does not close off an area.',
  open: 'The curve does not divide the surface in two, so it has no inside. This happens on a surface with holes, or with a ring round a bar of bone that is joined up at both ends.',
  crossing: 'The curve crosses itself or another boundary, so it is not clear what it encloses. Move its points until nothing crosses.',
  'no-common': 'No part of the surface lies between all of these curves.',
  'not-closed': 'A boundary has to be a closed loop.',
  'no-curve': 'Its boundary curve is gone.',
  empty: 'Nothing is selected. Select with Lasso or Box again, holding Shift to add to this region.',
};

/**
 * What the panel shows for a node: { title, kind, rows: [[label, value,
 * mono?]], copy } where `copy` is the text the Copy button puts on the
 * clipboard (null when there is nothing worth copying).
 */
// `opts.space`: 'scene' (the default) or 'file'. For something on a mesh that
// has been moved, numbers are shown where it now is in the scene, or as in
// the mesh file; `moved` says whether there is a difference to choose.
export function describe(model, id, opts = {}) {
  const stored = model.get(id);
  if (!stored) return null;
  const mesh = model.meshOf(id);
  const moved = !!mesh && stored.kind !== 'mesh' && isMoved(mesh.placement);
  const inScene = moved && opts.space !== 'file';
  const node = inScene ? nodeInScene(stored, mesh.placement) : stored;
  const rows = [];
  let copy = null;
  // Coordinates of something attached to a mesh are the mesh file's own,
  // unless the mesh has been moved and they are shown in the scene.
  // A mesh made from a region keeps the coordinates of the file it came from.
  const space = !mesh ? 'of the scene' : inScene ? `of the scene (${mesh.name} has been moved)` : `as in ${mesh.coordsFile ?? mesh.file}`;

  if (node.kind === 'mesh') {
    const size = node.box ? node.box.max.map((v, i) => v - node.box.min[i]) : null;
    const from = node.madeFrom;
    if (from) {
      rows.push(['Made from', `${from.region} of ${from.mesh}`]);
      rows.push(['Note', 'A copy of the region as it was. It does not change when the region does.']);
    } else {
      rows.push(['File', node.file]);
      rows.push(['Format', node.format]);
    }
    rows.push(['Triangles', int(node.faceCount), true]);
    rows.push(['Vertices', int(node.vertexCount), true]);
    rows.push(['Surface area', num(node.area ?? 0), true]);
    if (size) rows.push(['Size (x × y × z)', size.map(num).join(' × '), true]);
    if (from) rows.push(['Coordinates', space]);
    if (node.sha256) rows.push(['SHA-256', `${node.sha256.slice(0, 12)}…`, true]);
    const pl = isMoved(node.placement) ? node.placement : null;
    if (pl) {
      const by = model.children(id).find((n) => n.kind === 'orient');
      rows.push(['Placement', by ? `moved by ${by.name}` : 'moved']);
      pl.rotation.forEach((row, i) => rows.push([`Turn, row ${i + 1}`, row.map(dir).join('  '), true]));
      rows.push(['Shift', pl.translation.map(num).join('  '), true]);
      rows.push(['Note', 'Scene = turn × file coordinates + shift. The file and what is stored keep the file\'s coordinates.']);
    } else {
      rows.push(['Placement', 'where its file puts it']);
    }
    const flat = pl ? [...pl.rotation.flat(), ...pl.translation] : [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
    copy = [
      'name\tfile\tmade_from\ttriangles\tvertices\tsurface_area\tr11\tr12\tr13\tr21\tr22\tr23\tr31\tr32\tr33\tshift_x\tshift_y\tshift_z',
      [node.name, from ? '' : node.file, from ? `${from.region} of ${from.mesh}` : '', node.faceCount, node.vertexCount, node.area ?? 0, ...flat].join('\t'),
    ].join('\n');
  } else if (node.kind === 'group') {
    const points = model.children(id).filter((n) => n.kind === 'point');
    const missing = points.filter((p) => !p.position).length;
    rows.push(['File', node.file]);
    if (node.specimenId) rows.push(['Specimen', node.specimenId]);
    if (node.templateName) rows.push(['Template', node.templateName]);
    if (node.operator) rows.push(['Operator', node.operator]);
    rows.push(['Landmarks', missing ? `${points.length - missing} placed, ${missing} missing` : String(points.length)]);
    rows.push(['Coordinates', space]);
    copy = ['id\tname\tstatus\tx\ty\tz', ...points.map((p) => pointLine(inScene ? nodeInScene(p, mesh.placement) : p))].join('\n');
  } else if (node.kind === 'point' && node.method) {
    copy = describeMade(model, node, rows, space);
  } else if (node.kind === 'line') {
    copy = describeMade(model, node, rows, space);
  } else if (node.kind === 'frame') {
    copy = describeFrame(model, node, rows, space);
  } else if (node.kind === 'measure') {
    copy = describeMeasure(model, node, rows, space);
  } else if (node.kind === 'point') {
    if (node.code) rows.push(['ID', node.code, true]);
    if (node.status) rows.push(['Status', node.status]);
    if (node.position) {
      ['x', 'y', 'z'].forEach((axis, i) => rows.push([axis, num(node.position[i]), true]));
      rows.push(['Coordinates', space]);
      copy = pointLine(node);
    } else {
      rows.push(['Position', 'none (missing)']);
    }
    if (node.note) rows.push(['Note', node.note]);
  } else if (node.kind === 'curve') {
    rows.push(['Shape', node.drawing ? 'being drawn' : node.closed ? 'closed loop' : 'open curve']);
    rows.push(['Clicked points', String(node.control_points?.length ?? 0), true]);
    rows.push(['Path', node.used === 'euclidean' ? 'straight between the points' : 'shortest across the surface']);
    rows.push(['Length', num(node.length ?? 0), true]);
    if (node.centroid) {
      ['x', 'y', 'z'].forEach((axis, i) => rows.push([`Centroid ${axis}`, num(node.centroid[i]), true]));
      rows.push(['Coordinates', space]);
      copy = [
        'name\tshape\tclicked_points\tlength\tcentroid_x\tcentroid_y\tcentroid_z',
        [node.name, node.closed ? 'closed' : 'open', node.control_points.length, node.length, ...node.centroid].join('\t'),
      ].join('\n');
    }
    if (node.warning === 'apart') {
      rows.push(['Note', 'Some of its points are on separate pieces of the mesh. The curve is straight between those.']);
    }
  } else if (node.kind === 'region') {
    // A region drawn round with Lasso or Box has strokes instead of boundary curves.
    const tool = node.selection ? (node.strokes[0]?.type === 'lasso' ? 'lasso' : 'box') : null;
    const boundary = tool ?? node.boundary.map((id) => model.get(id)?.name ?? '?').join(', ');
    const side = node.flipped ? 'the other side' : tool ? 'as selected' : node.boundary.length > 1 ? 'between its curves' : 'inside the curve';
    if (tool) {
      const n = node.strokes.length;
      const kinds = new Set(node.strokes.map((s) => s.type));
      const how = kinds.size > 1 ? 'Lasso and Box' : tool === 'lasso' ? 'Lasso' : 'Box';
      rows.push(['Selected with', `${how} (${n} stroke${n === 1 ? '' : 's'})`]);
      if (node.strokes.some((s) => s.through)) rows.push(['Through', 'some strokes selected through the surface']);
    } else {
      rows.push(['Boundary', boundary]);
    }
    rows.push(['Side', side]);
    if (node.error) {
      rows.push(['Problem', REGION_PROBLEMS[node.error] ?? 'These curves enclose no region.']);
    } else {
      rows.push(['Triangles', int(node.faceCount), true]);
      rows.push(['Area', num(node.area), true]);
      ['x', 'y', 'z'].forEach((axis, i) => rows.push([`Centroid ${axis}`, num(node.centroid[i]), true]));
      rows.push(['Coordinates', space]);
      copy = [
        'name\tboundary\tside\ttriangles\tarea\tcentroid_x\tcentroid_y\tcentroid_z',
        [node.name, boundary, node.flipped ? 'other' : tool ? 'selected' : node.boundary.length > 1 ? 'between' : 'inside', node.faceCount, node.area, ...node.centroid].join('\t'),
      ].join('\n');
    }
  } else if (FIT_KINDS.has(node.kind)) {
    copy = describeFit(model, node, rows, space);
  } else if (node.kind === 'orient') {
    copy = describeOrient(model, node, rows);
  }
  return { title: node.name, kind: KIND[node.kind], rows, copy, moved, space: inScene ? 'scene' : 'file' };
}

const AXIS_WORDS = { '+x': '+X', '-x': '−X', '+y': '+Y', '-y': '−Y', '+z': '+Z', '-z': '−Z' };

function describeOrient(model, node, rows) {
  const input = model.get(node.inputs[0]);
  const name = input?.name ?? '?';
  const mesh = model.get(node.parent);
  const how = {
    frame: `${name} put on the scene's axes: its origin at the scene's origin, its X, Y and Z along the scene's`,
    line: `${name} turned to point along ${AXIS_WORDS[node.axis]}, its point at the scene's origin`,
    plane: `Standing on ${name}: its normal along ${AXIS_WORDS[node.axis]}, its point at the scene's origin`,
  }[node.method];
  rows.push(['Moves', mesh?.name ?? '?']);
  rows.push(['How', how]);
  if (node.error) {
    rows.push(['Problem', `“${name}” has no result at the moment, so ${mesh?.name ?? 'the mesh'} is back where its file puts it.`]);
    return null;
  }
  if (node.method !== 'frame') rows.push(['Note', 'Of all the turns that do this, the smallest is used. To fix the turn about that axis as well, orient by a coordinate system.']);
  node.placement.rotation.forEach((row, i) => rows.push([`Turn, row ${i + 1}`, row.map(dir).join('  '), true]));
  rows.push(['Shift', node.placement.translation.map(num).join('  '), true]);
  return [
    'name\tmoves\thow\tr11\tr12\tr13\tr21\tr22\tr23\tr31\tr32\tr33\tshift_x\tshift_y\tshift_z',
    [node.name, mesh?.name ?? '', how, ...node.placement.rotation.flat(), ...node.placement.translation].join('\t'),
  ].join('\n');
}

// The rows for a fitted primitive. Returns the text to copy, or null.
function describeFit(model, node, rows, space) {
  const source = model.get(node.source);
  const what = { sphere: 'sphere', plane: 'plane', cylinder: 'cylinder' }[node.kind];
  rows.push(['Fitted to', source ? (source.kind === 'curve' ? `${source.name} (its path)` : source.name) : '?']);
  rows.push(['Method', 'best fit: smallest squared distances']);
  if (node.error) {
    const problems = {
      region: `“${source?.name}” encloses nothing at the moment, so there is nothing to fit. See its Properties.`,
      curve: `“${source?.name}” has no path yet.`,
      'no-source': 'What it was fitted to is gone.',
      flat: `The region is (nearly) flat, so no ${what} fits it. A plane would.`,
      few: `There are too few points to fit a ${what} to.`,
      line: 'The points lie on one line, so no single plane goes through them.',
    };
    rows.push(['Problem', problems[node.error] ?? `No ${what} could be fitted.`]);
    return null;
  }
  const xyz = (label, v, f = num) => ['x', 'y', 'z'].forEach((axis, i) => rows.push([`${label} ${axis}`, f(v[i]), true]));
  const fit = () => {
    rows.push(['RMS deviation', num(node.rms), true]);
    rows.push(['Largest deviation', num(node.maxDeviation), true]);
  };
  const fromRegion = source?.kind === 'region';
  const name = source?.name ?? '';
  if (node.kind === 'sphere') {
    xyz('Centre', node.centre);
    rows.push(['Radius', num(node.radius), true]);
    rows.push(['Diameter', num(2 * node.radius), true]);
    fit();
    rows.push(['Coverage', `${(100 * node.coverage).toFixed(1)}% of the sphere (a cap of ${Math.round(capAngle(node.coverage))}°)`]);
    rows.push(['Triangles', int(node.faceCount), true]);
    rows.push(['Coordinates', space]);
    if (capAngle(node.coverage) < SHALLOW_CAP) {
      rows.push(['Note', 'The region covers only a small part of the sphere, so the radius and centre are less certain than the deviations suggest.']);
    }
    return [
      'name\tfitted_to\tcentre_x\tcentre_y\tcentre_z\tradius\trms_deviation\tmax_deviation\tcoverage\ttriangles',
      [node.name, name, ...node.centre, node.radius, node.rms, node.maxDeviation, node.coverage, node.faceCount].join('\t'),
    ].join('\n');
  }
  if (node.kind === 'plane') {
    xyz('Point', node.point);
    xyz('Normal', node.normal, dir);
    rows.push(['Equation', `${dir(node.normal[0])} x + ${dir(node.normal[1])} y + ${dir(node.normal[2])} z = ${num(node.d)}`, true]);
    fit();
    rows.push(fromRegion ? ['Triangles', int(node.faceCount), true] : ['Path length', num(node.pathLength), true]);
    rows.push(['Coordinates', space]);
    return [
      `name\tfitted_to\tpoint_x\tpoint_y\tpoint_z\tnormal_x\tnormal_y\tnormal_z\td\trms_deviation\tmax_deviation\t${fromRegion ? 'triangles' : 'path_length'}`,
      [node.name, name, ...node.point, ...node.normal, node.d, node.rms, node.maxDeviation, fromRegion ? node.faceCount : node.pathLength].join('\t'),
    ].join('\n');
  }
  xyz('Axis point', node.point);
  xyz('Direction', node.direction, dir);
  rows.push(['Radius', num(node.radius), true]);
  rows.push(['Diameter', num(2 * node.radius), true]);
  rows.push(['Length', num(node.length), true]);
  xyz('End 1', node.ends[0]);
  xyz('End 2', node.ends[1]);
  fit();
  rows.push(['Arc covered', `${node.arc}°`]);
  rows.push(['Triangles', int(node.faceCount), true]);
  rows.push(['Coordinates', space]);
  if (node.spread > ROUND_SPREAD) {
    rows.push(['Note', 'The surface curves in every direction, not just round an axis, so the axis is poorly fixed. A sphere may fit better.']);
  } else if (node.arc < 90) {
    rows.push(['Note', 'The region covers less than a quarter of the way round, so the radius and axis are less certain than the deviations suggest.']);
  }
  return [
    'name\tfitted_to\tpoint_x\tpoint_y\tpoint_z\tdirection_x\tdirection_y\tdirection_z\tradius\tlength\tend1_x\tend1_y\tend1_z\tend2_x\tend2_y\tend2_z\trms_deviation\tmax_deviation\tarc_degrees\ttriangles',
    [node.name, name, ...node.point, ...node.direction, node.radius, node.length, ...node.ends[0], ...node.ends[1], node.rms, node.maxDeviation, node.arc, node.faceCount].join('\t'),
  ].join('\n');
}

// How a point or line was made, in words.
function madeAs(model, node) {
  const name = (i) => {
    const n = model.get(node.inputs?.[i]);
    if (!n) return '?';
    if (n.kind === 'sphere' && node.method !== 'centre') return `${n.name} (its centre)`;
    if (n.kind === 'cylinder' && node.method !== 'axis') return `${n.name} (its axis)`;
    if (n.kind === 'plane' && node.method === 'point-directions') return `${n.name} (its normal)`;
    return n.name;
  };
  const P = (node.primary ?? 'x').toUpperCase();
  const S = (node.secondary ?? 'y').toUpperCase();
  const seenOn = () => {
    const n = model.get(node.inputs?.[2]);
    return n && n.kind !== 'plane' ? `the plane square to ${n.name}` : name(2);
  };
  switch (node.method) {
    case 'surface': return `Clicked on ${model.get(node.parent)?.name ?? 'a mesh'}`;
    case 'centre': return `Centre of ${name(0)}`;
    case 'centroid': return `Centroid of ${name(0)}`;
    case 'midpoint': return `Midway between ${name(0)} and ${name(1)}`;
    case 'line-plane': return `Where ${name(0)} meets ${name(1)}`;
    case 'two-points': return `From ${name(0)} through ${name(1)}`;
    case 'axis': return `Axis of ${name(0)}`;
    case 'fit-curve': return `Fitted to ${name(0)} (its path)`;
    case 'perpendicular': return `Perpendicular to ${name(0)}, through ${name(1)}`;
    case 'planes': return `Where ${name(0)} and ${name(1)} meet`;
    case 'point-directions': return `Origin at ${name(0)}; ${P} along ${name(1)}, ${S} towards ${name(2)}`;
    case 'three-points': return `Origin at ${name(0)}; ${P} towards ${name(1)}, ${S} towards ${name(2)}`;
    case 'points':
    case 'point-line':
    case 'point-plane': return `From ${name(0)} to ${name(1)}`;
    case 'lines':
    case 'angle': return `Between ${name(0)} and ${name(1)}`;
    case 'corner': return `At ${name(0)}, between ${name(1)} and ${name(2)}`;
    case 'on-plane': return `From ${name(0)} to ${name(1)}, seen on ${seenOn()}`;
    case 'coords': return `${name(0)} in ${name(1)}`;
    default: return '?';
  }
}

// The rows for a point placed or made here, or a line. Returns the text to copy, or null.
function describeMade(model, node, rows, space) {
  rows.push(['Made as', madeAs(model, node)]);
  if (node.error) {
    const failing = node.inputs?.map((id) => model.get(id)).find((n) => n && (n.error || n.drawing || (n.kind === 'point' && !n.position)));
    const problems = {
      'no-input': 'What it was made from is gone.',
      input: `“${failing?.name ?? 'What it was made from'}” has no result at the moment, so neither does this.`,
      parallel: node.kind === 'point' ? 'The line runs along the plane, so it does not pass through it at one point.' : 'The planes are parallel, so they never meet.',
      same: 'The two points are in the same place, so no single line goes through them.',
      few: 'The curve is too short to fit a line to.',
    };
    rows.push(['Problem', problems[node.error] ?? 'It could not be made.']);
    return null;
  }
  const xyz = (label, v, f = num) => ['x', 'y', 'z'].forEach((axis, i) => rows.push([`${label}${axis}`, f(v[i]), true]));
  const how = madeAs(model, node);
  if (node.kind === 'point') {
    xyz('', node.position);
    rows.push(['Coordinates', space]);
    return ['name\tmade_as\tx\ty\tz', [node.name, how, ...node.position].join('\t')].join('\n');
  }
  xyz('Point ', node.point);
  xyz('Direction ', node.direction, dir);
  const LENGTH = {
    'two-points': 'Distance between the points',
    perpendicular: 'Distance from the point to the plane',
    axis: 'Length (as the cylinder)',
    'fit-curve': 'Length (the curve along it)',
  };
  const ends = node.method !== 'planes';
  if (LENGTH[node.method]) rows.push([LENGTH[node.method], num(node.length), true]);
  if (node.method === 'perpendicular') rows.push(['Side of the plane', node.signed >= 0 ? 'the side the normal points to' : 'the side away from the normal']);
  if (node.method === 'fit-curve') {
    rows.push(['RMS deviation', num(node.rms), true]);
    rows.push(['Largest deviation', num(node.maxDeviation), true]);
  }
  if (ends) {
    xyz('End 1 ', node.ends[0]);
    xyz('End 2 ', node.ends[1]);
  }
  rows.push(['Coordinates', space]);
  if (node.method === 'planes') rows.push(['Note', 'The line goes on without end; it is drawn as far as the larger plane reaches.']);
  return [
    'name\tmade_as\tpoint_x\tpoint_y\tpoint_z\tdirection_x\tdirection_y\tdirection_z\tlength\tend1_x\tend1_y\tend1_z\tend2_x\tend2_y\tend2_z',
    [node.name, how, ...node.point, ...node.direction, ends ? node.length : '', ...(ends ? [...node.ends[0], ...node.ends[1]] : ['', '', '', '', '', ''])].join('\t'),
  ].join('\n');
}

// Why a coordinate system or a measurement has no result.
function madeProblem(model, node) {
  const failing = node.inputs?.map((id) => model.get(id)).find((n) => n && (n.error || n.drawing || (n.kind === 'point' && !n.position)));
  return {
    'no-input': 'What it was made from is gone.',
    input: `“${failing?.name ?? 'What it was made from'}” has no result at the moment, so neither does this.`,
    parallel: 'The two directions lie along one line, so they don\'t fix a coordinate system. Choose a second direction across the first.',
    axes: 'The first and the second direction must give different axes.',
    same: 'Two of the points are in the same place.',
    square: 'One of the lines is square to the plane, so seen on the plane it is only a point.',
  }[node.error] ?? 'It could not be worked out.';
}

const deg = (v) => `${Number(v).toFixed(2)}°`;

// A measurement's value in a few characters, for the Objects list.
export function measureText(node) {
  if (node.error || (node.value === null && !node.values)) return '';
  if (node.unit === 'degrees') return deg(node.value);
  if (node.unit === 'coordinates') return '';
  return num(node.value);
}

function describeFrame(model, node, rows, space) {
  rows.push(['Made as', madeAs(model, node)]);
  if (node.error) {
    rows.push(['Problem', madeProblem(model, node)]);
    return null;
  }
  const xyz = (label, v, f) => ['x', 'y', 'z'].forEach((axis, i) => rows.push([`${label} ${axis}`, f(v[i]), true]));
  xyz('Origin', node.origin, num);
  xyz('X axis', node.x, dir);
  xyz('Y axis', node.y, dir);
  xyz('Z axis', node.z, dir);
  rows.push(['Coordinates', space]);
  return [
    'name\tmade_as\torigin_x\torigin_y\torigin_z\tx_axis_x\tx_axis_y\tx_axis_z\ty_axis_x\ty_axis_y\ty_axis_z\tz_axis_x\tz_axis_y\tz_axis_z',
    [node.name, madeAs(model, node), ...node.origin, ...node.x, ...node.y, ...node.z].join('\t'),
  ].join('\n');
}

function describeMeasure(model, node, rows, space) {
  const how = madeAs(model, node);
  rows.push(['Measures', how]);
  if (node.error) {
    rows.push(['Problem', madeProblem(model, node)]);
    return null;
  }
  if (node.unit === 'coordinates') {
    const frame = model.get(node.inputs[1]);
    rows.push(['In', frame?.name ?? '?']);
    ['x', 'y', 'z'].forEach((axis, i) => rows.push([axis, num(node.values[i]), true]));
    return [
      'name\tpoint\taxes\tx\ty\tz',
      [node.name, model.get(node.inputs[0])?.name ?? '', frame?.name ?? '', ...node.values].join('\t'),
    ].join('\n');
  }
  const extra = [];
  if (node.unit === 'length') {
    rows.push(['Distance', num(node.value), true]);
    if (node.method === 'points') {
      ['x', 'y', 'z'].forEach((axis, i) => rows.push([`Along ${axis}`, num(node.delta[i]), true]));
      extra.push(['dx', node.delta[0]], ['dy', node.delta[1]], ['dz', node.delta[2]]);
    }
    if (node.method === 'point-plane') {
      rows.push(['Signed distance', num(node.signed), true]);
      rows.push(['Side', node.signed >= 0 ? 'the side the plane\'s normal points to' : 'the side away from the normal']);
      extra.push(['signed', node.signed]);
    }
    if (node.method === 'lines' && node.parallel) rows.push(['Note', 'The lines are parallel: this is the distance between them anywhere along them.']);
    rows.push(['Coordinates', space]);
  } else {
    rows.push(['Angle', deg(node.value), true]);
    if (node.method === 'angle' && node.between !== 'line-plane') {
      rows.push(['Smaller angle', deg(node.acute), true]);
      rows.push(['Note', node.between === 'lines' ? 'The angle is between the lines\' directions (0–180°); flip a line to measure the other way round.' : 'The angle is between the planes\' normals (0–180°).']);
      extra.push(['smaller_angle', node.acute]);
    }
    if (node.between === 'line-plane') {
      rows.push(['Note', 'Positive when the line points to the side the plane\'s normal points to (−90° to 90°).']);
    }
    if (node.method === 'on-plane') {
      rows.push(['Note', 'Looking at the plane against its normal, turning anticlockwise from the first line to the second is positive (−180° to 180°).']);
    }
  }
  const unit = node.unit === 'degrees' ? 'degrees' : 'length';
  return [
    ['name', 'measures', 'value', 'unit', ...extra.map(([k]) => k)].join('\t'),
    [node.name, how, node.value, unit, ...extra.map(([, v]) => v)].join('\t'),
  ].join('\n');
}

// Full precision goes on the clipboard; the panel shows three decimals.
function pointLine(p) {
  const xyz = p.position ? p.position.join('\t') : 'NA\tNA\tNA';
  return `${p.code ?? p.id}\t${p.name}\t${p.status ?? ''}\t${xyz}`;
}

// `app.regions`, `app.commands` and the rest are looked up when needed: they are made after this panel.
export function setupProperties(el, { model, copyText, app }) {
  // Show numbers in the scene (where moved meshes now are) or as in the mesh files.
  let space = 'scene';
  function render() {
    const d = describe(model, model.selectedId, { space });
    if (!d) {
      el.innerHTML = '<p class="props-empty">Select an object in the list or in the 3D view to see its numbers.</p>';
      return;
    }
    const node = model.selected;
    // A region can take further closed curves of its mesh as boundaries.
    const others = node.kind === 'region' ? (app.regions?.candidates(node.id) ?? []) : [];
    const more = others.length
      ? `<label class="props-more">Add a boundary (a hole in the region, or the other end of a band)
          <select id="prop-add-boundary">
            <option value="">Choose a closed curve…</option>
            ${others.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
          </select>
        </label>`
      : '';
    // What can be made from this object: the commands it suits (commands.js), and a mesh from a region.
    // Measurements get a row of their own.
    const offered = app.commands?.available(node) ?? [];
    const button = (c) => `<button type="button" class="btn small" data-make="${c.id}" title="${esc(c.title)}">${esc(c.short)}</button>`;
    const make = offered.filter((c) => c.kind !== 'measure').map(button);
    const measures = offered.filter((c) => c.kind === 'measure').map(button);
    if (node.kind === 'region' && !node.error) {
      make.push('<button type="button" class="btn small" id="prop-extract" title="Make a new mesh of just this region. The original mesh stays as it is.">New mesh</button>');
    }
    const makeRow =
      (make.length
        ? `<div class="props-make" id="prop-make"><span class="props-make-label">Make from this</span><div class="props-actions">${make.join('')}</div></div>`
        : '') +
      (measures.length
        ? `<div class="props-make" id="prop-measure"><span class="props-make-label">Measure from this</span><div class="props-actions">${measures.join('')}</div></div>`
        : '');
    // Which axes a coordinate system's two directions give.
    const axisSelect = (id, value) =>
      `<select id="${id}">${['x', 'y', 'z'].map((a) => `<option value="${a}"${a === value ? ' selected' : ''}>${a.toUpperCase()}</option>`).join('')}</select>`;
    const axesRow =
      node.kind === 'frame'
        ? `<div class="props-axes">
            <label for="prop-primary">The first direction gives</label>${axisSelect('prop-primary', node.primary)}
            <label for="prop-secondary">The second gives</label>${axisSelect('prop-secondary', node.secondary)}
          </div>`
        : '';
    // An orientation along a line or a plane: which scene axis.
    const orientRow =
      node.kind === 'orient' && node.method !== 'frame'
        ? `<div class="props-axes">
            <label for="prop-orient-axis">${node.method === 'plane' ? 'The normal points along' : 'The line points along'}</label>
            <select id="prop-orient-axis">${Object.entries(AXIS_WORDS).map(([k, w]) => `<option value="${k}"${k === node.axis ? ' selected' : ''}>${w}</option>`).join('')}</select>
          </div>`
        : '';
    el.innerHTML = `
      <div class="props-head">
        <input type="text" id="prop-name" aria-label="Name" value="${esc(d.title)}">
      </div>
      <div class="props-kind">${d.kind}</div>
      ${
        d.moved
          ? `<div class="props-space" role="group" aria-label="Coordinates shown">
              <span>Coordinates</span>
              <button type="button" class="btn small" id="prop-space-scene" aria-pressed="${d.space === 'scene'}" title="Where it is now that its mesh has been moved">In the scene</button>
              <button type="button" class="btn small" id="prop-space-file" aria-pressed="${d.space === 'file'}" title="As in the mesh file, as stored and saved">As in the file</button>
            </div>`
          : ''
      }
      ${orientRow}
      <dl class="props-list">
        ${d.rows.map(([k, v, mono]) => (k === 'Problem' ? `<dd class="problem" style="grid-column: 1 / -1">${esc(v)}</dd>` : `<dt>${esc(k)}</dt><dd${mono ? ' class="mono"' : ''}>${esc(v)}</dd>`)).join('')}
      </dl>
      ${axesRow}
      ${makeRow}
      <div class="props-actions">
        ${d.copy ? '<button type="button" class="btn small" id="prop-copy">Copy numbers</button>' : ''}
        ${node.kind === 'region' ? '<button type="button" class="btn small" id="prop-flip" title="Take the part on the other side of the boundary instead">Use the other side</button>' : ''}
        ${node.kind === 'plane' && !node.error ? '<button type="button" class="btn small" id="prop-flip-fit" title="Turn the normal the other way; the plane stays where it is">Flip normal</button>' : ''}
        ${node.kind === 'cylinder' && !node.error ? '<button type="button" class="btn small" id="prop-flip-fit" title="Turn the axis direction the other way; the axis stays where it is">Flip direction</button>' : ''}
        ${node.kind === 'line' && !node.error ? '<button type="button" class="btn small" id="prop-flip-line" title="Turn the direction the other way; the line stays where it is">Flip direction</button>' : ''}
        ${node.kind === 'mesh' ? '<button type="button" class="btn small" id="prop-save-stl" title="Save this mesh as a binary STL file">Save as STL</button><button type="button" class="btn small" id="prop-save-ply" title="Save this mesh as a binary PLY file">Save as PLY</button>' : ''}
        <button type="button" class="btn small" id="prop-remove">Remove</button>
      </div>
      ${more}`;
  }

  el.addEventListener('change', (e) => {
    if (e.target.id === 'prop-orient-axis') {
      app.constructs.set(model.selectedId, { axis: e.target.value });
      app.frameView?.();
      return;
    }
    if (e.target.id === 'prop-primary' || e.target.id === 'prop-secondary') {
      // Choosing the axis the other direction gives swaps the two.
      const node = model.selected;
      const key = e.target.id === 'prop-primary' ? 'primary' : 'secondary';
      const other = key === 'primary' ? 'secondary' : 'primary';
      const fields = { [key]: e.target.value };
      if (node[other] === e.target.value) fields[other] = node[key];
      app.constructs.set(node.id, fields);
      return;
    }
    if (e.target.id === 'prop-add-boundary' && e.target.value) {
      app.regions.addBoundary(model.selectedId, e.target.value);
      return;
    }
    if (e.target.id !== 'prop-name') return;
    const id = model.selectedId;
    model.rename(id, e.target.value);
    e.target.value = model.get(id)?.name ?? ''; // an empty name is not taken
  });

  el.addEventListener('click', async (e) => {
    const id = model.selectedId;
    if (e.target.id === 'prop-space-scene' || e.target.id === 'prop-space-file') {
      space = e.target.id === 'prop-space-file' ? 'file' : 'scene';
      render();
      return;
    }
    if (e.target.dataset.make) {
      app.run(e.target.dataset.make);
    } else if (e.target.id === 'prop-remove') {
      model.remove(id);
    } else if (e.target.id === 'prop-extract') {
      e.target.disabled = true;
      await app.meshFromRegion(id);
    } else if (e.target.id === 'prop-save-stl' || e.target.id === 'prop-save-ply') {
      await app.saveMesh(id, e.target.id === 'prop-save-stl' ? 'stl' : 'ply');
    } else if (e.target.id === 'prop-flip-fit') {
      app.fits.set(id, { flipped: !model.get(id).flipped });
    } else if (e.target.id === 'prop-flip-line') {
      app.constructs.set(id, { flipped: !model.get(id).flipped });
    } else if (e.target.id === 'prop-flip') {
      app.regions.set(id, { flipped: !model.get(id).flipped });
    } else if (e.target.id === 'prop-copy') {
      const ok = await copyText(describe(model, id, { space }).copy);
      e.target.textContent = ok ? 'Copied' : 'Could not copy';
      setTimeout(() => {
        if (e.target.isConnected) e.target.textContent = 'Copy numbers';
      }, 1500);
    }
  });

  model.addEventListener('change', (e) => {
    // Names are only changed in this panel's own box, which already shows the
    // new one. Rebuilding the panel here would swallow a click that is under way.
    if (e.detail.kind === 'rename') return;
    render();
  });

  render();
  return { render };
}
