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
      ['plane', 'Plane', ['plane-fit', 'plane-curve']],
      ['point', 'Point', ['point-surface', 'point-centre', 'point-centroid', 'point-midpoint', 'point-line-plane']],
      ['line', 'Line', ['line-two-points', 'line-axis', 'line-curve', 'line-perpendicular', 'line-planes']],
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
    assert.deepEqual(runner.available(sphere).map((c) => c.short), ['Centre point', 'Midpoint', 'Line to a point']);
    const p = constructs.create('point', 'centre', [sphere.id]);
    assert.deepEqual(ids(runner.available(p)), ['point-midpoint', 'line-two-points']);
    const plane = fits.create(region.id, 'plane');
    assert.deepEqual(ids(runner.available(plane)), ['line-perpendicular', 'line-planes']);
    const l = constructs.create('line', 'perpendicular', [plane.id, p.id]);
    assert.deepEqual(ids(runner.available(l)), ['point-line-plane']);
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
