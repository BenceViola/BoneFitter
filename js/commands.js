// The ways to make each kind of object, as the menus above the 3D view list
// them: Sphere ▸ "Fit to a region", Plane ▸ "Fit to a curve", and so on.
//
// A command says what it needs (`inputs`, asked for one at a time by
// command-runner.js) and how to make the object from them (`run`). The same
// list gives the "Make from this" buttons in Properties: a command is offered
// there when the selected object suits its first input.
//
// No page and no three.js. `ctx` is { model, regions, fits }.

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

export const INPUTS = {
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
];

export const COMMANDS = {};
for (const menu of MENUS) {
  for (const command of menu.commands) {
    command.kind = menu.kind;
    command.short = menu.label; // on a "Make from this" button
    command.heading = `${menu.label}: ${command.label[0].toLowerCase()}${command.label.slice(1)}`;
    COMMANDS[command.id] = command;
  }
}
