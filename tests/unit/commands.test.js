import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MENUS, COMMANDS } from '../../js/commands.js';
import { scene, ball, events } from '../scene-helpers.js';

// A ball of radius 10 seen from +Z, with a closed loop round its near pole,
// an open curve, and (optionally) the loop's region.
const loop = (r = 4, n = 8) => Array.from({ length: n }, (_, k) => [r * Math.cos((2 * Math.PI * k) / n), r * Math.sin((2 * Math.PI * k) / n), 10]);
function setup({ region = false } = {}) {
  const s = scene();
  const mesh = s.addMesh('Ball', ball(10));
  const closed = s.addCurve(mesh.id, loop());
  const open = s.addCurve(mesh.id, [[-6, -6, 10], [0, -7, 10], [6, -6, 10]], { closed: false });
  const made = region ? s.regions.create(closed.id) : null;
  return { ...s, mesh, closed, open, region: made };
}
const kinds = (model) => [...model.nodes.values()].map((n) => n.kind);

describe('the list of commands', () => {
  test('one menu per kind of object, each listing the ways to make it', () => {
    assert.deepEqual(MENUS.map((m) => [m.kind, m.label, m.commands.map((c) => c.id)]), [
      ['region', 'Region', ['region-loop']],
      ['sphere', 'Sphere', ['sphere-fit']],
      ['cylinder', 'Cylinder', ['cylinder-fit']],
      ['plane', 'Plane', ['plane-fit', 'plane-curve', 'plane-line', 'plane-line-point']],
      ['point', 'Point', ['point-surface', 'point-centre', 'point-centroid', 'point-midpoint', 'point-line-plane']],
      ['line', 'Line', ['line-two-points', 'line-axis', 'line-curve', 'line-perpendicular', 'line-planes']],
      ['frame', 'Axes', ['frame-directions', 'frame-points']],
      ['orient', 'Orient', ['orient-frame', 'orient-line', 'orient-plane', 'orient-apply', 'orient-apply-copy', 'orient-reset']],
      ['measure', 'Measure', ['measure-points', 'measure-point-to', 'measure-lines', 'measure-angle', 'measure-corner', 'measure-on-plane', 'measure-section', 'measure-section-mesh', 'measure-coords']],
    ]);
    for (const m of MENUS) {
      for (const c of m.commands) {
        assert.equal(COMMANDS[c.id], c);
        assert.equal(c.kind, m.kind);
        assert.ok(c.label && c.title && (c.inputs.length >= 1 || c.tool), c.id);
      }
    }
  });
});

describe('starting a command', () => {
  test('with a suitable object selected it is made at once and selected', () => {
    const { runner, model, region } = setup({ region: true });
    model.select(region.id);
    const r = runner.start('sphere-fit');
    assert.equal(r.status, 'done');
    assert.equal(r.node.kind, 'sphere');
    assert.equal(r.node.source, region.id);
    assert.equal(model.selectedId, r.node.id);
    assert.equal(runner.active, false);
  });

  test('a sphere or cylinder from a closed curve uses the curve\'s region, making it first', () => {
    const { runner, model, regions, closed } = setup();
    model.select(closed.id);
    const sphere = runner.start('sphere-fit').node;
    const [region] = regions.regionsOf(closed.id);
    assert.equal(sphere.source, region.id);
    model.select(closed.id);
    const cylinder = runner.start('cylinder-fit').node;
    assert.equal(cylinder.source, region.id, 'the same region, not a second one');
    assert.equal(regions.regionsOf(closed.id).length, 1);
  });

  test('a plane is fitted to a region, or to a curve\'s own path', () => {
    const { runner, model, region, open, closed } = setup({ region: true });
    model.select(region.id);
    assert.equal(runner.start('plane-fit').node.source, region.id);
    model.select(open.id);
    assert.equal(runner.start('plane-curve').node.source, open.id);
    model.select(closed.id);
    assert.equal(runner.start('plane-curve').node.source, closed.id);
  });

  test('a region is made from the selected closed curve', () => {
    const { runner, model, closed } = setup();
    model.select(closed.id);
    const r = runner.start('region-loop');
    assert.equal(r.status, 'done');
    assert.deepEqual(r.node.boundary, [closed.id]);
    assert.equal(model.selectedId, r.node.id);
  });

  test('with nothing suitable selected it asks for the input', () => {
    const { runner, model, mesh } = setup({ region: true });
    const seen = events(runner);
    model.select(mesh.id);
    const r = runner.start('sphere-fit');
    assert.equal(r.status, 'asking');
    assert.equal(runner.active, true);
    const s = runner.state();
    assert.equal(s.command, 'sphere-fit');
    assert.equal(s.title, 'Sphere: fit to a region');
    assert.match(s.hint, /^Click a region or a closed curve, in the 3D view or in the Objects list\./);
    assert.equal(s.note, null);
    assert.equal(seen.length, 1);
    assert.equal(kinds(model).includes('sphere'), false);
  });

  test('when the selected object nearly suits, the prompt says why it does not', () => {
    const { runner, model, open } = setup({ region: true });
    model.select(open.id);
    assert.equal(runner.start('sphere-fit').status, 'asking');
    assert.match(runner.state().note, /“Curve 2” is not a closed loop/);
  });

  test('when nothing in the scene could be used, it does not ask but says what to make first', () => {
    const s = scene();
    s.addMesh('Ball', ball(10));
    const r = s.runner.start('sphere-fit');
    assert.equal(r.status, 'nothing');
    assert.match(r.message, /no region yet/i);
    assert.match(r.message, /Lasso or Box/);
    assert.equal(s.runner.active, false);
    assert.match(s.runner.start('region-loop').message, /no closed curve yet/i);
    assert.match(s.runner.start('plane-curve').message, /no curve yet/i);
  });

  test('an unknown command does nothing', () => {
    const { runner } = setup();
    assert.equal(runner.start('teapot').status, 'unknown');
    assert.equal(runner.active, false);
  });
});

describe('picking the input', () => {
  test('offering a suitable object makes the thing, selects it and ends the prompt', () => {
    const { runner, model, region } = setup({ region: true });
    runner.start('cylinder-fit');
    const seen = events(runner);
    const r = runner.offer(region.id);
    assert.equal(r.status, 'done');
    assert.equal(r.node.kind, 'cylinder');
    assert.equal(model.selectedId, r.node.id);
    assert.equal(runner.active, false);
    assert.equal(seen.at(-1).active, false);
  });

  test('offering something unsuitable keeps asking and says why', () => {
    const { runner, model, mesh, open, region } = setup({ region: true });
    runner.start('sphere-fit');
    assert.equal(runner.offer(mesh.id).status, 'rejected');
    assert.match(runner.state().note, /“Ball” is a mesh/);
    assert.equal(runner.offer(open.id).status, 'rejected');
    assert.match(runner.state().note, /“Curve 2” is not a closed loop/);
    assert.equal(runner.active, true);
    assert.equal(kinds(model).includes('sphere'), false);
    assert.equal(runner.offer(region.id).status, 'done');
  });

  test('a region that encloses nothing is not taken', () => {
    const { runner, model, region } = setup({ region: true });
    model.update(region.id, { error: 'small' });
    runner.start('sphere-fit');
    assert.equal(runner.offer(region.id).status, 'rejected');
    assert.match(runner.state().note, /encloses nothing at the moment/);
  });

  test('Plane fitted to a region takes a region only; a curve is for the other way', () => {
    const { runner, closed } = setup({ region: true });
    runner.start('plane-fit');
    assert.equal(runner.offer(closed.id).status, 'rejected');
    assert.match(runner.state().note, /“Curve 1” is a curve/);
  });

  test('prefer() takes, of the things under a click, the first that suits', () => {
    const { runner, mesh, closed, region } = setup({ region: true });
    assert.equal(runner.prefer([mesh.id, region.id]), mesh.id, 'no prompt: the first, as always');
    runner.start('plane-fit');
    assert.equal(runner.prefer([closed.id, region.id, mesh.id]), region.id);
    assert.equal(runner.prefer([mesh.id]), mesh.id, 'nothing suits: the first, so the prompt can say why');
    assert.equal(runner.prefer([]), null);
  });

  test('cancel ends the prompt and makes nothing; offering afterwards does nothing', () => {
    const { runner, model, region } = setup({ region: true });
    runner.start('sphere-fit');
    const seen = events(runner);
    runner.cancel();
    assert.equal(runner.active, false);
    assert.equal(seen.length, 1);
    assert.equal(runner.offer(region.id).status, 'off');
    assert.equal(kinds(model).includes('sphere'), false);
    runner.cancel();
    assert.equal(seen.length, 1, 'cancelling twice says nothing new');
  });

  test('starting another command replaces the one that was asking', () => {
    const { runner, region } = setup({ region: true });
    runner.start('sphere-fit');
    runner.start('cylinder-fit');
    assert.equal(runner.state().command, 'cylinder-fit');
    assert.equal(runner.offer(region.id).node.kind, 'cylinder');
  });
});

describe('what can be made from the selected object', () => {
  const ids = (list) => list.map((c) => c.id);
  test('a region: sphere, cylinder, plane, its centroid', () => {
    const { runner, region } = setup({ region: true });
    assert.deepEqual(ids(runner.available(region)), ['sphere-fit', 'cylinder-fit', 'plane-fit', 'point-centroid']);
    assert.deepEqual(runner.available(region).map((c) => c.short), ['Sphere', 'Cylinder', 'Plane', 'Centroid point']);
  });
  test('a sphere: its centre, a midpoint, a line; a point: a midpoint, a line; a plane: lines', () => {
    const { runner, region, model, fits, constructs } = setup({ region: true });
    const sphere = fits.create(region.id, 'sphere');
    const making = (node) => runner.available(node).filter((c) => c.kind === 'point' || c.kind === 'line');
    // Alone, a sphere has only its centre to give: a midpoint or a line needs a second point.
    assert.deepEqual(making(sphere).map((c) => c.short), ['Centre point']);
    const p = constructs.create('point', 'centre', [sphere.id]);
    assert.deepEqual(making(sphere).map((c) => c.short), ['Centre point', 'Midpoint', 'Line to a point']);
    assert.deepEqual(ids(making(p)), ['point-midpoint', 'line-two-points']);
    const plane = fits.create(region.id, 'plane');
    assert.deepEqual(ids(making(plane)), ['line-perpendicular'], 'one plane: no second plane to meet');
    const l = constructs.create('line', 'perpendicular', [plane.id, p.id]);
    assert.deepEqual(ids(making(l)), ['point-line-plane']);
    // Axes and measurements start from points, lines and planes too.
    // (Only what the scene can finish: two points, so no axes from three points; no axes yet, so no coordinates.)
    assert.deepEqual(ids(runner.available(p).filter((c) => c.kind !== 'point' && c.kind !== 'line')), ['frame-directions', 'measure-points', 'measure-point-to', 'measure-corner']);
    assert.deepEqual(ids(runner.available(l).filter((c) => c.kind === 'measure')), ['measure-angle'], 'one line: nothing to measure against another line');
    assert.deepEqual(ids(runner.available(plane).filter((c) => c.kind === 'measure')), ['measure-angle', 'measure-section', 'measure-section-mesh'], 'a plane on a mesh: cut it (or another mesh)');
    // A landmark that is missing has nothing to offer.
    assert.deepEqual(runner.available(model.add('point', { position: null, status: 'missing' })), []);
  });
  test('a closed curve: region, sphere, cylinder, a plane and a line through the curve itself, its centroid', () => {
    const { runner, closed } = setup();
    assert.deepEqual(ids(runner.available(closed)), ['region-loop', 'sphere-fit', 'cylinder-fit', 'plane-curve', 'point-centroid', 'line-curve']);
  });
  test('an open curve: a plane, its centroid, a line', () => {
    const { runner, open } = setup();
    assert.deepEqual(ids(runner.available(open)), ['plane-curve', 'point-centroid', 'line-curve']);
    assert.deepEqual(runner.available(open).map((c) => c.short), ['Plane', 'Centroid point', 'Line']);
  });
  test('a mesh, a curve being drawn, an empty region, nothing: none', () => {
    const { runner, model, mesh, region, open } = setup({ region: true });
    assert.deepEqual(runner.available(mesh), []);
    assert.deepEqual(runner.available(null), []);
    model.update(open.id, { drawing: true });
    assert.deepEqual(runner.available(model.get(open.id)), []);
    model.update(region.id, { error: 'small' });
    assert.deepEqual(runner.available(model.get(region.id)), []);
  });
});

describe('points and lines from the menus', () => {
  test('Point ▸ Click on a surface switches on the Point tool; it asks nothing', () => {
    const { runner } = setup();
    assert.deepEqual(runner.start('point-surface'), { status: 'tool', tool: 'point' });
    assert.equal(runner.active, false);
  });

  test('two inputs: the selected point is the first, the strip asks for the second', () => {
    const { runner, model, fits, region, constructs } = setup({ region: true });
    const sphere = fits.create(region.id, 'sphere');
    const p = constructs.placePoint({ id: model.meshes()[0].id, position: [0, 0, 10], anchor: { face: 0 } });
    model.select(sphere.id);
    assert.equal(runner.start('line-two-points').status, 'asking');
    const s = runner.state();
    assert.equal(s.title, 'Line: through two points');
    assert.equal(s.step, 2);
    assert.match(s.hint, /^Step 2 of 2 \(“Sphere 1” taken\)\. Click a point or a sphere \(its centre\)/);
    // The same sphere again is not taken.
    assert.equal(runner.offer(sphere.id).status, 'rejected');
    assert.match(runner.state().note, /^That is “Sphere 1” again\./);
    const r = runner.offer(p.id);
    assert.equal(r.status, 'done');
    assert.deepEqual(r.node.inputs, [sphere.id, p.id]);
    assert.equal(model.selectedId, r.node.id);
  });

  test('nothing selected: both inputs are asked for in turn', () => {
    const { runner, region, fits, mesh } = setup({ region: true });
    const plane = fits.create(region.id, 'plane');
    const sphere = fits.create(region.id, 'sphere');
    runner.model.select(mesh.id);
    runner.start('line-perpendicular');
    assert.match(runner.state().hint, /^Step 1 of 2\. Click a plane/);
    assert.equal(runner.offer(sphere.id).status, 'rejected');
    assert.match(runner.state().note, /“Sphere 1” is a sphere\. Click a plane\./);
    runner.offer(plane.id);
    assert.match(runner.state().hint, /^Step 2 of 2 \(“Plane 1” taken\)\. Click a point or a sphere/);
    const r = runner.offer(sphere.id);
    assert.equal(r.node.kind, 'line');
    assert.equal(r.node.method, 'perpendicular');
  });

  test('a missing landmark is not a point to build on', () => {
    const { runner, model, mesh, region, fits } = setup({ region: true });
    fits.create(region.id, 'sphere');
    const lm = model.add('point', { parent: mesh.id, name: 'Nasion', position: null, status: 'missing' });
    runner.start('point-midpoint');
    runner.offer(lm.id);
    assert.match(runner.state().note, /“Nasion” has no position: it is a missing landmark\./);
  });

  test('with no sphere, no plane or no line yet, it says which to make first', () => {
    const { runner } = setup({ region: true });
    assert.match(runner.start('point-centre').message, /no sphere yet/);
    assert.match(runner.start('line-perpendicular').message, /no plane yet/);
    assert.match(runner.start('point-line-plane').message, /no line yet/);
    assert.match(runner.start('line-two-points').message, /no point yet/);
  });

  test('prefer() never offers the first input again', () => {
    const { runner, model, region, fits } = setup({ region: true });
    const a = fits.create(region.id, 'sphere');
    const b = runner.ctx.constructs.create('point', 'centre', [a.id]);
    model.select(a.id);
    runner.start('point-midpoint');
    assert.equal(runner.prefer([a.id, b.id]), b.id);
  });
});

describe('measuring from the menus', () => {
  test('distance from a point: to a plane or to a line, chosen by what is clicked second', () => {
    const { runner, model, region, fits, constructs } = setup({ region: true });
    const sphere = fits.create(region.id, 'sphere');
    const plane = fits.create(region.id, 'plane');
    const line = constructs.create('line', 'perpendicular', [plane.id, sphere.id]);
    model.select(sphere.id);
    runner.start('measure-point-to');
    assert.equal(runner.offer(plane.id).node.method, 'point-plane');
    model.select(sphere.id);
    runner.start('measure-point-to');
    const r = runner.offer(line.id);
    assert.equal(r.node.method, 'point-line');
    assert.equal(r.node.kind, 'measure');
    assert.equal(r.node.name, 'Distance 2');
  });

  test('three inputs: the angle seen on a plane asks for two lines, then the plane', () => {
    const { runner, model, region, fits, constructs, mesh } = setup({ region: true });
    const sphere = fits.create(region.id, 'sphere');
    const plane = fits.create(region.id, 'plane');
    const a = constructs.create('line', 'perpendicular', [plane.id, sphere.id]);
    const b = constructs.create('line', 'two-points', [sphere.id, constructs.placePoint({ id: mesh.id, position: [5, 5, 8], anchor: { face: 0 } }).id]);
    model.select(a.id);
    runner.start('measure-on-plane');
    assert.match(runner.state().hint, /^Step 2 of 3 \(“Line 1” taken\)\. Click a line \(or a cylinder: its axis\)/);
    runner.offer(b.id);
    assert.match(runner.state().hint, /^Step 3 of 3 \(“Line 1”, “Line 2” taken\)\. Click the plane to see them on/);
    const r = runner.offer(plane.id);
    assert.equal(r.node.method, 'on-plane');
    assert.equal(r.node.name, 'Angle 1');
  });

  test('coordinates need a coordinate system first', () => {
    const { runner, model, region, fits } = setup({ region: true });
    model.select(fits.create(region.id, 'sphere').id);
    const r = runner.start('measure-coords');
    assert.equal(r.status, 'nothing');
    assert.match(r.message, /no coordinate system yet/);
  });
});

describe('orienting from the menu', () => {
  test('Orient ▸ Stand on a plane with a plane selected moves its mesh; Back to the file\'s position undoes it', () => {
    const { runner, model, region, fits, mesh } = setup({ region: true });
    const plane = fits.create(region.id, 'plane');
    model.select(plane.id);
    const r = runner.start('orient-plane');
    assert.equal(r.status, 'done');
    assert.equal(r.node.kind, 'orient');
    assert.ok(model.get(mesh.id).placement);
    model.select(mesh.id);
    assert.equal(runner.start('orient-reset').status, 'done');
    assert.equal(model.get(mesh.id).placement, null);
    assert.equal(model.children(mesh.id).filter((n) => n.kind === 'orient').length, 0);
    assert.match(runner.start('orient-reset').message, /“Ball” is where its file puts it already/);
    model.select(null);
    assert.match(runner.start('orient-reset').message, /No mesh has been moved/);
  });

  test('a line made from two meshes can\'t orient either of them', () => {
    const { runner, model, constructs, mesh } = setup({ region: true });
    const other = model.add('mesh', { name: 'Other', faceCount: 0 });
    const a = constructs.placePoint({ id: mesh.id, position: [0, 0, 10], anchor: { face: 0 } });
    const b = model.add('point', { parent: other.id, method: 'surface', position: [5, 5, 5] });
    const l = constructs.create('line', 'two-points', [a.id, b.id]);
    model.select(l.id);
    const r = runner.start('orient-line');
    assert.equal(r.status, 'nothing');
    assert.match(r.message, /made from objects on more than one mesh/);
  });
});

describe('a command that takes a while', () => {
  test('Orient ▸ Apply to the coordinates hands the mesh to the app, and selects the new mesh when it is ready', async () => {
    const s = setup({ region: true });
    const { CommandRunner } = await import('../../js/command-runner.js');
    let asked = null;
    const made = s.model.add('mesh', { name: 'New', faceCount: 0 });
    const runner = new CommandRunner({ ...s, actions: { applyPlacement: async (id) => ((asked = id), made) } });
    s.model.update(s.mesh.id, { placement: { rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], translation: [1, 0, 0] } });
    s.model.select(s.mesh.id);
    const r = runner.start('orient-apply');
    assert.equal(r.status, 'pending');
    assert.equal(await r.done, made);
    assert.equal(asked, s.mesh.id);
    assert.equal(s.model.selectedId, made.id);
  });
});

describe('cross-sections from the Measure menu', () => {
  test('a plane on a mesh cuts its own mesh at once; a chosen mesh is asked for', async () => {
    const { scene, ball } = await import('../scene-helpers.js');
    const { CommandRunner } = await import('../../js/command-runner.js');
    const s = scene([0, 0, 100], [0, 0, 0]);
    const a = s.addMesh('A', ball(10));
    const b = s.addMesh('B', ball(10, 40));
    const plane = s.model.add('plane', { parent: b.id, point: [40, 0, 3], normal: [0, 0, 1], d: 3 });
    const runner = new CommandRunner({ model: s.model, regions: s.regions, fits: s.fits, constructs: s.constructs });
    s.model.select(plane.id);
    const r = runner.start('measure-section');
    assert.equal(r.status, 'done');
    const own = r.node;
    assert.equal(own.kind, 'section');
    assert.equal(own.parent, b.id);
    assert.ok(own.area > 0);
    s.model.select(plane.id);
    assert.equal(runner.start('measure-section-mesh').status, 'asking');
    assert.match(JSON.stringify(runner.state()), /the mesh to cut/);
    const other = runner.offer(a.id).node;
    assert.equal(other.kind, 'section');
    assert.equal(other.parent, a.id);
    assert.ok(Math.abs(other.area - own.area) < 1e-3 * own.area, `the same cut of the same ball: ${other.area} vs ${own.area}`);
  });
});
