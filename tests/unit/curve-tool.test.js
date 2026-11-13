import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { scene, ball, screenOf, events } from '../scene-helpers.js';
import { describe as describeNode } from '../../js/properties-panel.js';

// A ball of radius 5 at the origin and a smaller one beside it, seen from +Z.
// front(x, y) is the point of the big ball facing the camera above (x, y).
const front = (x, y) => [x, y, Math.sqrt(25 - x * x - y * y)];
const A = front(-2, -1);
const B = front(2, -1);
const C = front(0, 2);

function setup() {
  const s = scene();
  const big = s.addMesh('big', ball(5));
  const small = s.addMesh('small', ball(2, 9));
  s.tool.setActive(true);
  return { ...s, big, small };
}
const curves = (model) => [...model.nodes.values()].filter((n) => n.kind === 'curve');

describe('drawing a curve', () => {
  test('the first click starts a curve attached to the mesh that was clicked', async () => {
    const { tool, model, big, engine, clickOn } = setup();
    assert.equal(await clickOn(A), 'started');
    const [c] = curves(model);
    assert.equal(c.parent, big.id);
    assert.equal(c.name, 'Curve 1');
    assert.equal(c.drawing, true);
    assert.equal(c.closed, false);
    assert.equal(c.path, 'geodesic');
    assert.equal(c.control_points.length, 1);
    assert.ok(Number.isInteger(c.control_points[0].anchor.face), 'the clicked point remembers its triangle');
    assert.equal(model.selectedId, c.id, 'the curve being drawn is selected');
    assert.equal(tool.draft, c);
    assert.equal(engine.isReady(big.id), true, 'the mesh is prepared for paths across the surface');
  });

  test('further clicks add points, and the path follows the surface between them', async () => {
    const { model, clickOn } = setup();
    await clickOn(A);
    assert.equal(await clickOn(B), 'added');
    const [c] = curves(model);
    assert.equal(c.control_points.length, 2);
    assert.ok(c.line.length > 5);
    const straight = Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
    assert.ok(c.length > straight && c.length < straight * 1.1, `over the ball, not through it: ${c.length} vs ${straight}`);
    for (const p of c.line) assert.ok(Math.abs(Math.hypot(...p) - 5) < 0.02);
  });

  test('a click beside the mesh adds nothing', async () => {
    const { model, tool, viewer } = setup();
    assert.equal(await tool.click(2, 2), 'missed');
    assert.equal(curves(model).length, 0);
    assert.equal(tool.draft, null);
    void viewer;
  });

  test('a curve stays on the mesh it started on', async () => {
    const { model, tool, clickOn } = setup();
    await clickOn(A);
    assert.equal(await clickOn([9, 0, 2]), 'other-mesh');
    assert.equal(curves(model)[0].control_points.length, 1);
    assert.match(tool.state().hint, /stays on the mesh it started on/);
  });

  test('Finish needs two points; the curve is then done and the tool is ready for the next', async () => {
    const { model, tool, clickOn } = setup();
    await clickOn(A);
    assert.equal(tool.finish(), false);
    assert.equal(tool.state().canFinish, false);
    await clickOn(B);
    assert.equal(tool.state().canFinish, true);
    assert.equal(tool.finish(), true);
    const [c] = curves(model);
    assert.equal(c.drawing, false);
    assert.equal(c.closed, false);
    assert.equal(tool.draft, null);
    assert.equal(tool.active, true);
    assert.equal(model.selectedId, c.id);
    await clickOn(C);
    assert.deepEqual(curves(model).map((n) => n.name), ['Curve 1', 'Curve 2']);
  });

  test('Close loop needs three points and joins the last to the first', async () => {
    const { model, tool, clickOn } = setup();
    await clickOn(A);
    await clickOn(B);
    assert.equal(tool.close(), false);
    assert.equal(tool.state().canClose, false);
    await clickOn(C);
    const open = curves(model)[0].length;
    assert.equal(tool.close(), true);
    const [c] = curves(model);
    assert.equal(c.closed, true);
    assert.equal(c.drawing, false);
    assert.ok(c.length > open * 1.2, 'the closing stretch is part of the loop');
    assert.deepEqual(c.line[0], c.line.at(-1));
  });

  test('clicking the first point again closes the loop', async () => {
    const { model, clickOn } = setup();
    await clickOn(A);
    await clickOn(B);
    assert.equal(await clickOn(A), 'added', 'with two points there is nothing to close yet');
    const { model: m2, clickOn: click2 } = setup();
    await click2(A);
    await click2(B);
    await click2(C);
    assert.equal(await click2(A), 'closed');
    assert.equal(curves(m2)[0].closed, true);
    assert.equal(curves(m2)[0].control_points.length, 3);
    void model;
  });

  test('clicking the last point again finishes the curve', async () => {
    const { model, clickOn, tool } = setup();
    let now = 0;
    tool.now = () => now;
    await clickOn(A);
    await clickOn(B);
    now += 1000;
    assert.equal(await clickOn(B), 'finished');
    const [c] = curves(model);
    assert.equal(c.control_points.length, 2, 'no point is added twice');
    assert.equal(c.drawing, false);
  });

  // Reported on a 910,000-triangle humerus: points placed close together kept
  // finishing the curve, and the next click started a new one. A click had to
  // be within 1.8 handle radii of the last point, and handles are sized by the
  // scene (about 3.5 mm on that bone), so zoomed in that was most of the screen.
  describe('placing points close together', () => {
    // Zoomed right in on the big ball: its front is 3 units from the camera.
    function zoomedIn() {
      const s = scene([0, 0, 8], [0, 0, 0]);
      s.addMesh('big', ball(5));
      s.addMesh('small', ball(2, 9));
      s.tool.setActive(true);
      let now = 0;
      s.tool.now = () => now;
      return { ...s, wait: (ms) => (now += ms) };
    }
    const px = (viewer, p) => screenOf(viewer, p);

    test('a click a few pixels from the last point adds a point; it does not finish the curve', async () => {
      const { tool, model, viewer, wait } = zoomedIn();
      const [x, y] = px(viewer, front(0, 0));
      assert.equal(await tool.click(x, y), 'started');
      wait(1000);
      // 10 px further on is well inside the handle's old reach (16 px here).
      assert.equal(await tool.click(x + 10, y), 'added');
      wait(1000);
      assert.equal(await tool.click(x + 20, y), 'added');
      wait(1000);
      assert.equal(await tool.click(x + 30, y), 'added');
      assert.equal(curves(model).length, 1, 'still one curve');
      assert.equal(curves(model)[0].control_points.length, 4);
    });

    test('a click a few pixels from the first point adds a point; it does not close the loop', async () => {
      const { tool, model, viewer, wait } = zoomedIn();
      const [x, y] = px(viewer, front(0, 0));
      for (const [dx, dy] of [[0, 0], [12, 0], [12, 12]]) {
        await tool.click(x + dx, y + dy);
        wait(1000);
      }
      assert.equal(await tool.click(x - 9, y + 3), 'added');
      assert.equal(curves(model)[0].closed, false);
      wait(1000);
      // Right on the first point, it closes.
      assert.equal(await tool.click(x, y), 'closed');
    });

    test('a double-click adds one point and does not finish the curve', async () => {
      const { tool, model, viewer, wait } = zoomedIn();
      const [x, y] = px(viewer, front(0, 0));
      await tool.click(x, y);
      wait(1000);
      assert.equal(await tool.click(x + 20, y), 'added');
      wait(150);
      assert.equal(await tool.click(x + 20, y), 'double', 'the second click of a double-click');
      wait(1000);
      assert.equal(await tool.click(x + 40, y), 'added');
      assert.equal(curves(model).length, 1);
      assert.equal(curves(model)[0].control_points.length, 3);
      assert.equal(curves(model)[0].drawing, true);
    });

    test('when a click on the last point does finish the curve, the hint says so', async () => {
      const { tool, viewer, wait } = zoomedIn();
      const [x, y] = px(viewer, front(0, 0));
      await tool.click(x, y);
      wait(1000);
      await tool.click(x + 20, y);
      wait(1000);
      assert.equal(await tool.click(x + 20, y), 'finished');
      assert.match(tool.state().hint, /^Curve 1 finished\. Click on a mesh to start a new curve\./);
    });
  });

  test('Undo point takes points off from the end, and the curve with the last one', async () => {
    const { model, tool, clickOn } = setup();
    await clickOn(A);
    await clickOn(B);
    await clickOn(C);
    tool.undo();
    assert.equal(curves(model)[0].control_points.length, 2);
    tool.undo();
    assert.deepEqual(curves(model)[0].line, []);
    tool.undo();
    assert.equal(curves(model).length, 0);
    assert.equal(tool.draft, null);
  });

  test('Cancel removes the curve being drawn, and only that one', async () => {
    const { model, tool, clickOn } = setup();
    await clickOn(A);
    await clickOn(B);
    tool.finish();
    await clickOn(C);
    tool.cancel();
    assert.deepEqual(curves(model).map((n) => n.name), ['Curve 1']);
    assert.equal(tool.active, true);
  });

  test('switching the tool off keeps a curve with two points and drops one with fewer', async () => {
    const { model, tool, clickOn } = setup();
    await clickOn(A);
    await clickOn(B);
    tool.setActive(false);
    assert.equal(curves(model)[0].drawing, false);
    tool.setActive(true);
    await clickOn(C);
    tool.setActive(false);
    assert.equal(curves(model).length, 1);
  });

  test('removing the curve being drawn from elsewhere leaves the tool ready', async () => {
    const { model, tool, clickOn } = setup();
    await clickOn(A);
    const seen = events(tool);
    model.remove(curves(model)[0].id);
    assert.equal(tool.draft, null);
    assert.ok(seen.length > 0, 'the tool says its state changed');
    assert.equal(await clickOn(B), 'started');
  });

  test('the hint says what to do next', async () => {
    const { tool, clickOn } = setup();
    assert.match(tool.state().hint, /Click on a mesh to start a curve/);
    await clickOn(A);
    assert.match(tool.state().hint, /Click to add points/);
    await clickOn(B);
    assert.match(tool.state().hint, /Enter finishes/);
    tool.setActive(false);
    assert.equal(tool.state().active, false);
  });

  test('a large mesh shows a busy note while it is prepared', async () => {
    const s = scene();
    const mesh = s.addMesh('big', ball(5, 0, 96));
    mesh.faceCount = 500000; // as if it were a large scan
    s.tool.setActive(true);
    await s.clickOn(A);
    assert.match(s.busy[0], /Preparing 500,000 triangles/);
    assert.equal(s.busy.at(-1), null);
  });
});

describe('curves in the 3D view', () => {
  async function drawn() {
    const s = setup();
    await s.clickOn(A);
    await s.clickOn(B);
    await s.clickOn(C);
    s.tool.close();
    s.tool.setActive(false);
    return { ...s, curve: curves(s.model)[0] };
  }

  test('a curve is drawn under its mesh, so it is hidden and removed with it', async () => {
    const { view, model, curve, big } = await drawn();
    const obj = view.objectOf(curve.id);
    assert.equal(obj.parent, view.objectOf(big.id));
    assert.equal(obj.getObjectByName('line').visible, true);
    model.remove(big.id);
    assert.equal(view.objectOf(curve.id), null);
  });

  test('the clicked points are shown as handles only on the selected curve', async () => {
    const { view, model, curve, big } = await drawn();
    const handles = () => view.objectOf(curve.id).getObjectByName('handles').children.length;
    assert.equal(model.selectedId, curve.id);
    assert.equal(handles(), 3);
    model.select(big.id);
    assert.equal(handles(), 0);
    model.select(curve.id);
    assert.equal(handles(), 3);
  });

  test('handleAt finds the clicked point under the cursor', async () => {
    const { view, viewer, curve, model } = await drawn();
    assert.deepEqual(view.handleAt(...screenOf(viewer, B)), { id: curve.id, index: 1 });
    assert.equal(view.handleAt(...screenOf(viewer, front(0, -3))), null);
    model.select(null);
    assert.equal(view.handleAt(...screenOf(viewer, B)), null, 'no handles are shown when the curve is not selected');
  });

  test('curveAt finds a curve under the cursor, but not through the mesh or when hidden', async () => {
    const { view, viewer, curve, model } = await drawn();
    const mid = curve.line[Math.floor(curve.line.length / 6)];
    assert.equal(view.curveAt(...screenOf(viewer, mid)), curve.id);
    assert.equal(view.curveAt(...screenOf(viewer, front(0, -4))), null, 'more than a few pixels from the line is not the curve');
    model.setVisible(curve.id, false);
    assert.equal(view.curveAt(...screenOf(viewer, mid)), null);
  });

  test('a curve on the far side is not picked through the mesh', async () => {
    const s = setup();
    const back = (x, y) => [x, y, -Math.sqrt(25 - x * x - y * y)];
    const c = s.model.add('curve', { parent: s.big.id, path: 'geodesic', closed: false, control_points: [s.cp(s.big.id, back(-2, 0)), s.cp(s.big.id, back(2, 0))] });
    s.engine.refresh(c.id);
    const mid = c.line[Math.floor(c.line.length / 2)];
    assert.equal(s.view.curveAt(...screenOf(s.viewer, mid)), null);
  });
});

describe('a curve in the Properties panel', () => {
  const rows = (d) => Object.fromEntries(d.rows.map(([k, v]) => [k, v]));

  test('while it is drawn: how far it has got', async () => {
    const { model, clickOn } = setup();
    await clickOn(A);
    const d = describeNode(model, curves(model)[0].id);
    assert.equal(d.kind, 'Curve');
    assert.equal(d.title, 'Curve 1');
    assert.equal(rows(d).Shape, 'being drawn');
    assert.equal(rows(d)['Clicked points'], '1');
    assert.equal(rows(d).Length, '0.000');
    assert.equal(d.copy, null, 'nothing to copy before there is a path');
  });

  test('a finished loop: shape, length and centroid in the mesh file\'s coordinates, and a row to copy', async () => {
    const { model, tool, clickOn } = setup();
    await clickOn(A);
    await clickOn(B);
    await clickOn(C);
    tool.close();
    const c = curves(model)[0];
    const d = describeNode(model, c.id);
    assert.equal(rows(d).Shape, 'closed loop');
    assert.equal(rows(d)['Clicked points'], '3');
    assert.equal(rows(d).Path, 'shortest across the surface');
    assert.equal(rows(d).Length, c.length.toFixed(3));
    assert.deepEqual(['x', 'y', 'z'].map((k) => rows(d)[`Centroid ${k}`]), c.centroid.map((v) => v.toFixed(3)));
    assert.equal(rows(d).Coordinates, 'as in big.stl');
    assert.deepEqual(d.copy.split('\n'), [
      'name\tshape\tclicked_points\tlength\tcentroid_x\tcentroid_y\tcentroid_z',
      ['Curve 1', 'closed', 3, c.length, ...c.centroid].join('\t'),
    ]);
  });

  test('an open curve says so, and points on separate pieces are noted', async () => {
    const { model, tool, clickOn } = setup();
    await clickOn(A);
    await clickOn(B);
    tool.finish();
    const c = curves(model)[0];
    assert.equal(rows(describeNode(model, c.id)).Shape, 'open curve');
    model.update(c.id, { warning: 'apart' });
    assert.match(rows(describeNode(model, c.id)).Note, /separate pieces of the mesh/);
  });
});
