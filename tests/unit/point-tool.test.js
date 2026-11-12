import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PointTool } from '../../js/point-tool.js';
import { scene, ball, screenOf, events } from '../scene-helpers.js';

function setup() {
  const s = scene([0, 0, 60], [0, 0, 0]);
  const mesh = s.addMesh('Ball', ball(10));
  const tool = new PointTool({ model: s.model, picker: s.picker, view: s.view, constructs: s.constructs });
  return { ...s, mesh, points: tool };
}

test('off, a click does nothing', () => {
  const { points, model } = setup();
  assert.equal(points.click(50, 50).status, 'off');
  assert.equal([...model.nodes.values()].filter((n) => n.kind === 'point').length, 0);
});

test('a click on the mesh places a point there and selects it; each click another', () => {
  const { points, model, mesh, viewer } = setup();
  const seen = events(points);
  points.setActive(true);
  const r = points.click(...screenOf(viewer, [0, 0, 10]));
  assert.equal(r.status, 'placed');
  assert.equal(r.node.parent, mesh.id);
  assert.equal(r.node.method, 'surface');
  r.node.position.forEach((v, i) => assert.ok(Math.abs(v - [0, 0, 10][i]) < 0.2));
  assert.equal(model.selectedId, r.node.id);
  const r2 = points.click(...screenOf(viewer, [5, 0, Math.sqrt(75)]));
  assert.equal(r2.node.name, 'Point 2');
  assert.deepEqual(seen.map((e) => e.active), [true, true, true]);
});

test('a click on an existing point selects it instead of placing another', () => {
  const { points, model, viewer } = setup();
  points.setActive(true);
  const first = points.click(...screenOf(viewer, [0, 0, 10])).node;
  model.select(null);
  const r = points.click(...screenOf(viewer, first.position));
  assert.deepEqual(r, { status: 'selected', id: first.id });
  assert.equal([...model.nodes.values()].filter((n) => n.kind === 'point').length, 1);
});

test('a click beside the mesh places nothing', () => {
  const { points } = setup();
  points.setActive(true);
  assert.equal(points.click(2, 2).status, 'missed');
});
