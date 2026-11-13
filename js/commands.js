// The ways to make each kind of object, as the menus above the 3D view list
// them: Sphere ▸ "Fit to a region", Plane ▸ "Fit to a curve", and so on.
//
// A command says what it needs (`inputs`, asked for one at a time by
// command-runner.js) and how to make the object from them (`run`). The same
// list gives the "Make from this" buttons in Properties: a command is offered
// there when the selected object suits its first input.
//
// No page and no three.js. `ctx` is { model, regions, fits, constructs }.
//
// A command with `tool` instead of inputs switches on a tool of the rail
// (Point ▸ Click on a surface turns on the Point tool).

const quoted = (node) => `“${node.name}”`;

// What a command can ask for. `accepts(ctx, node)` gives true, or a sentence
// saying why not, or false when the object is simply another kind of thing.
// `none` is said when nothing in the scene could be used.
const closedCurve = (ctx, node) => {
  if (node.kind !== 'curve') return false;
  if (node.drawing) return `${quoted(node)} is still being drawn. Finish it first.`;
  if (!node.closed) return `${quoted(node)} is not a closed loop, so it encloses no region.`;
  return true;
};
const wholeRegion = (ctx, node) => {
  if (node.kind !== 'region') return false;
  if (node.error) return `${quoted(node)} encloses nothing at the moment, so there is nothing to fit. Its Properties say why.`;
  return true;
};

// An object of one kind that has a result (a fit that worked, say).
const made = (kind) => (ctx, node) => {
  if (node.kind !== kind) return false;
  if (node.error) return `${quoted(node)} has no result at the moment (its Properties say why).`;
  return true;
};

export const INPUTS = {
  // A point, or a sphere standing for its centre.
  point: {
    ask: 'a point or a sphere (its centre)',
    accepts: (ctx, node) => {
      if (node.kind === 'sphere') return made('sphere')(ctx, node);
      if (node.kind !== 'point') return false;
      if (!Array.isArray(node.position)) return `${quoted(node)} has no position${node.error ? ' at the moment (its Properties say why)' : ': it is a missing landmark'}.`;
      return true;
    },
    none: 'There is no point yet. Place one with Point ▸ Click on a surface, or fit a sphere.',
  },
  sphere: { ask: 'a sphere', accepts: made('sphere'), none: 'There is no sphere yet. Fit one with Sphere ▸ Fit to a region.' },
  cylinder: { ask: 'a cylinder', accepts: made('cylinder'), none: 'There is no cylinder yet. Fit one with Cylinder ▸ Fit to a region.' },
  plane: { ask: 'a plane', accepts: made('plane'), none: 'There is no plane yet. Fit one from the Plane menu.' },
  line: { ask: 'a line', accepts: made('line'), none: 'There is no line yet. Make one from the Line menu.' },
  // A line, or a cylinder standing for its axis.
  lineLike: {
    ask: 'a line (or a cylinder: its axis)',
    accepts: (ctx, node) => (node.kind === 'cylinder' ? made('cylinder') : made('line'))(ctx, node),
    none: 'There is no line yet. Make one from the Line menu, or fit a cylinder.',
  },
  lineOrPlane: {
    ask: 'a line or a plane (or a cylinder: its axis)',
    accepts: (ctx, node) => (['line', 'plane', 'cylinder'].includes(node.kind) ? made(node.kind)(ctx, node) : false),
    none: 'There is no line or plane yet. Make one from the Line or Plane menu.',
  },
  direction: {
    ask: 'a direction: a line, a plane (its normal) or a cylinder (its axis)',
    accepts: (ctx, node) => (['line', 'plane', 'cylinder'].includes(node.kind) ? made(node.kind)(ctx, node) : false),
    none: 'There is no line or plane yet to give a direction. Make one from the Line or Plane menu.',
  },
  reference: {
    ask: 'the plane to see them on: a plane, or a line (the plane square to it)',
    accepts: (ctx, node) => (['line', 'plane', 'cylinder'].includes(node.kind) ? made(node.kind)(ctx, node) : false),
    none: 'There is no plane or line yet to see the angle on.',
  },
  corner: {
    ask: 'the corner: a point or a sphere (its centre)',
    accepts: (ctx, node) => INPUTS.point.accepts(ctx, node),
    none: 'There is no point yet. Place one with Point ▸ Click on a surface, or fit a sphere.',
  },
  frame: { ask: 'a coordinate system (Axes)', accepts: made('frame'), none: 'There is no coordinate system yet. Make one from the Axes menu.' },
  // What can orient a mesh: it must belong to one mesh, the one that moves.
  meshFrame: {
    ask: 'a coordinate system (Axes) on the mesh to move',
    accepts: (ctx, node) => onOneMesh(made('frame')(ctx, node), node),
    none: 'There is no coordinate system on a mesh yet. Make one from the Axes menu, from objects on that mesh.',
  },
  meshLine: {
    ask: 'a line (or a cylinder: its axis) on the mesh to move',
    accepts: (ctx, node) => onOneMesh((node.kind === 'cylinder' ? made('cylinder') : made('line'))(ctx, node), node),
    none: 'There is no line on a mesh yet. Make one from the Line menu, or fit a cylinder.',
  },
  meshPlane: {
    ask: 'a plane on the mesh to move',
    accepts: made('plane'),
    none: 'There is no plane yet. Fit one from the Plane menu.',
  },
  movedMesh: {
    ask: 'a mesh that has been moved',
    accepts: (ctx, node) => {
      if (node.kind !== 'mesh') return false;
      return node.placement ? true : `“${node.name}” is where its file puts it already.`;
    },
    none: 'No mesh has been moved.',
  },
  // What has a centroid.
  centroid: {
    ask: 'a region or a curve',
    accepts: (ctx, node) => {
      if (node.kind === 'region') return wholeRegion(ctx, node);
      if (node.kind !== 'curve') return false;
      if (node.drawing) return `${quoted(node)} is still being drawn. Finish it first.`;
      return Array.isArray(node.centroid) ? true : `${quoted(node)} has no path yet.`;
    },
    none: 'There is no region or curve yet. Draw a curve on the mesh with the Curve tool.',
  },

  // A region; a closed curve stands for the region it encloses.
  region: {
    ask: 'a region or a closed curve',
    accepts: (ctx, node) => (node.kind === 'curve' ? closedCurve(ctx, node) : wholeRegion(ctx, node)),
    none: 'There is no region yet. Draw a closed curve on the mesh, or select part of it with Lasso or Box, first.',
  },
  regionOnly: {
    ask: 'a region',
    accepts: wholeRegion,
    none: 'There is no region yet. Draw a closed curve on the mesh and make a region from it, or select part of the mesh with Lasso or Box, first.',
  },
  loop: {
    ask: 'a closed curve',
    accepts: closedCurve,
    none: 'There is no closed curve yet. Draw one with the Curve tool and close it with C.',
  },
  curve: {
    ask: 'a curve',
    accepts: (ctx, node) => {
      if (node.kind !== 'curve') return false;
      if (node.drawing) return `${quoted(node)} is still being drawn. Finish it first.`;
      return true;
    },
    none: 'There is no curve yet. Draw one on the mesh with the Curve tool.',
  },
};

// The region a picked region or closed curve stands for: the curve's own
// single-boundary region, made first if there is none.
function regionOf(ctx, node) {
  if (node.kind === 'region') return node;
  return ctx.regions.regionsOf(node.id).find((r) => r.boundary.length === 1 && !r.flipped) ?? ctx.regions.create(node.id);
}

const fitToRegion = (kind, input = 'region') => ({
  id: `${kind}-fit`,
  label: 'Fit to a region',
  title: `Fit a ${kind} to the part of the mesh a region covers`,
  inputs: [input],
  run: (ctx, [node]) => ctx.fits.create(regionOf(ctx, node).id, kind),
});

// An object made from several meshes belongs to none of them, so it can't say which to move.
function onOneMesh(verdict, node) {
  if (verdict !== true) return verdict;
  return node.parent ? true : `“${node.name}” is made from objects on more than one mesh, so it doesn't belong to one mesh to move.`;
}
const orient = (id, label, title, inputs, method, short) => ({
  id,
  label,
  title,
  inputs,
  short,
  run: (ctx, nodes) => ctx.constructs.create('orient', method, nodes.map((n) => n.id)),
});

const point = (id, label, title, inputs, method, short) => ({
  id,
  label,
  title,
  inputs,
  short,
  run: (ctx, nodes) => ctx.constructs.create('point', method, nodes.map((n) => n.id)),
});
const measure = (id, label, title, inputs, method, short) => ({
  id,
  label,
  title,
  inputs,
  short,
  run: (ctx, nodes) => ctx.constructs.create('measure', typeof method === 'function' ? method(nodes) : method, nodes.map((n) => n.id)),
});
const frame = (id, label, title, inputs, method, short) => ({
  id,
  label,
  title,
  inputs,
  short,
  run: (ctx, nodes) => ctx.constructs.create('frame', method, nodes.map((n) => n.id)),
});
const line = (id, label, title, inputs, method, short) => ({
  id,
  label,
  title,
  inputs,
  short,
  run: (ctx, nodes) => ctx.constructs.create('line', method, nodes.map((n) => n.id)),
});

export const MENUS = [
  {
    kind: 'region',
    label: 'Region',
    commands: [
      {
        id: 'region-loop',
        label: 'Inside a closed curve',
        title: 'The part of the mesh that a closed curve encloses',
        inputs: ['loop'],
        run: (ctx, [curve]) => ctx.regions.create(curve.id),
      },
    ],
  },
  { kind: 'sphere', label: 'Sphere', commands: [fitToRegion('sphere')] },
  { kind: 'cylinder', label: 'Cylinder', commands: [fitToRegion('cylinder')] },
  {
    kind: 'plane',
    label: 'Plane',
    commands: [
      fitToRegion('plane', 'regionOnly'),
      {
        id: 'plane-curve',
        label: 'Fit to a curve',
        title: 'Fit a plane to the path of a curve: a rim or a margin',
        inputs: ['curve'],
        run: (ctx, [curve]) => ctx.fits.create(curve.id, 'plane'),
      },
    ],
  },
  {
    kind: 'point',
    label: 'Point',
    commands: [
      { id: 'point-surface', label: 'Click on a surface', title: 'Place points by clicking on a mesh (the Point tool)', inputs: [], tool: 'point' },
      point('point-centre', 'Centre of a sphere', 'A point at the centre of a fitted sphere', ['sphere'], 'centre', 'Centre point'),
      point('point-centroid', 'Centroid of a region or curve', 'A point at the centroid of a region or of a curve', ['centroid'], 'centroid', 'Centroid point'),
      point('point-midpoint', 'Midway between two points', 'A point halfway between two points (a sphere counts as its centre)', ['point', 'point'], 'midpoint', 'Midpoint'),
      point('point-line-plane', 'Where a line meets a plane', 'The point where a line passes through a plane', ['line', 'plane'], 'line-plane', 'Point where it meets a plane'),
    ],
  },
  {
    kind: 'line',
    label: 'Line',
    commands: [
      line('line-two-points', 'Through two points', 'A line from one point through another (a sphere counts as its centre)', ['point', 'point'], 'two-points', 'Line to a point'),
      line('line-axis', 'Axis of a cylinder', 'The axis of a fitted cylinder as a line of its own', ['cylinder'], 'axis', 'Axis line'),
      line('line-curve', 'Fit to a curve', 'The straight line nearest the path of a curve', ['curve'], 'fit-curve', 'Line'),
      line('line-perpendicular', 'Perpendicular to a plane', 'A line square to a plane, through a point', ['plane', 'point'], 'perpendicular', 'Perpendicular line'),
      line('line-planes', 'Where two planes meet', 'The line along which two planes cross', ['plane', 'plane'], 'planes', 'Line where it meets a plane'),
    ],
  },
  {
    kind: 'frame',
    label: 'Axes',
    commands: [
      frame('frame-directions', 'From an origin and two directions', 'A coordinate system: its origin at a point, one axis along a line or a plane\'s normal, a second squared up to another', ['point', 'direction', 'direction'], 'point-directions', 'Axes with origin here'),
      frame('frame-points', 'From three points', 'A coordinate system: its origin at the first point, one axis towards the second, a second axis leaning towards the third', ['point', 'point', 'point'], 'three-points', 'Axes from three points'),
    ],
  },
  {
    kind: 'orient',
    label: 'Orient',
    commands: [
      orient('orient-frame', 'By a coordinate system', 'Move the mesh so a coordinate system on it lies on the scene\'s axes: its origin at the scene\'s origin', ['meshFrame'], 'frame', 'Orient by these axes'),
      orient('orient-line', 'By a line', 'Turn the mesh so a line on it points along an axis of the scene (Z at first), its point at the origin', ['meshLine'], 'line', 'Orient along this line'),
      orient('orient-plane', 'Stand on a plane', 'Turn the mesh so it stands on a plane: the plane\'s normal points down (−Z), its point at the origin', ['meshPlane'], 'plane', 'Stand on this plane'),
      {
        id: 'orient-reset',
        label: 'Back to the file\'s position',
        title: 'Put the mesh back where its file puts it',
        inputs: ['movedMesh'],
        short: 'Back to the file\'s position',
        run: (ctx, [mesh]) => {
          for (const o of ctx.model.children(mesh.id).filter((n) => n.kind === 'orient')) ctx.model.remove(o.id);
          ctx.model.update(mesh.id, { placement: null });
          return mesh;
        },
      },
    ],
  },
  {
    kind: 'measure',
    label: 'Measure',
    commands: [
      measure('measure-points', 'Distance between two points', 'The distance between two points (a sphere counts as its centre)', ['point', 'point'], 'points', 'Distance to a point'),
      measure('measure-point-to', 'Distance from a point to a line or plane', 'The shortest distance from a point to a line or a plane', ['point', 'lineOrPlane'], (n) => (n[1].kind === 'plane' ? 'point-plane' : 'point-line'), 'Distance to a line or plane'),
      measure('measure-lines', 'Distance between two lines', 'The shortest distance between two lines', ['lineLike', 'lineLike'], 'lines', 'Distance to a line'),
      measure('measure-angle', 'Angle between lines or planes', 'The angle between two lines, a line and a plane, or two planes', ['lineOrPlane', 'lineOrPlane'], 'angle', 'Angle'),
      measure('measure-corner', 'Angle at a point, between two others', 'The angle at a corner point between the directions to two other points', ['corner', 'point', 'point'], 'corner', 'Angle at this point'),
      measure('measure-on-plane', 'Angle between two lines, seen on a plane', 'Two lines as seen on a plane (or on the plane square to a line): torsion and version angles', ['lineLike', 'lineLike', 'reference'], 'on-plane', 'Angle seen on a plane'),
      measure('measure-coords', 'Coordinates of a point in a coordinate system', 'Where a point is in a coordinate system (Axes)', ['point', 'frame'], 'coords', 'Coordinates in axes'),
    ],
  },
];

export const COMMANDS = {};
for (const menu of MENUS) {
  for (const command of menu.commands) {
    command.kind = menu.kind;
    command.short ??= menu.label; // on a "Make from this" button
    command.heading = `${menu.label}: ${command.label[0].toLowerCase()}${command.label.slice(1)}`;
    COMMANDS[command.id] = command;
  }
}
