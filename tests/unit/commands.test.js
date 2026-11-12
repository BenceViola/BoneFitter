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
    ]);
    for (const m of MENUS) {
      for (const c of m.commands) {
        assert.equal(COMMANDS[c.id], c);
        assert.equal(c.kind, m.kind);
        assert.ok(c.label && c.title && c.inputs.length >= 1, c.id);
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
  test('a region: sphere, cylinder, plane', () => {
    const { runner, region } = setup({ region: true });
    assert.deepEqual(ids(runner.available(region)), ['sphere-fit', 'cylinder-fit', 'plane-fit']);
    assert.deepEqual(runner.available(region).map((c) => c.short), ['Sphere', 'Cylinder', 'Plane']);
  });
  test('a closed curve: region, sphere, cylinder, and a plane through the curve itself', () => {
    const { runner, closed } = setup();
    assert.deepEqual(ids(runner.available(closed)), ['region-loop', 'sphere-fit', 'cylinder-fit', 'plane-curve']);
  });
  test('an open curve: only a plane', () => {
    const { runner, open } = setup();
    assert.deepEqual(ids(runner.available(open)), ['plane-curve']);
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
