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

const point = (id, label, title, inputs, method, short) => ({
  id,
  label,
  title,
  inputs,
  short,
  run: (ctx, nodes) => ctx.constructs.create('point', method, nodes.map((n) => n.id)),
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
