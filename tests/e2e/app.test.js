// End-to-end tests: the real page in headless Chromium, driven with the
// mouse and keyboard. They check what a user would see.

import { test, describe, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  startServer, launch, openApp, clickAt, onScreen, openFiles, messageText, treeRows, properties, makeFiles,
} from './helpers.js';
import { EXAMPLE } from '../../js/sample.js';
import { loadMeshBuffer } from '../../js/mesh-loader.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

let server, url, browser, files, current;

before(async () => {
  ({ server, url } = await startServer());
  browser = await launch();
  files = await makeFiles();
});
after(async () => {
  await browser?.close();
  server?.close();
});
afterEach(async () => {
  if (!current) return;
  const { context, errors } = current;
  current = null;
  await context.close();
  assert.deepEqual(errors, [], 'no errors in the browser console');
});

async function start(opts) {
  current = await openApp(browser, url, opts);
  return current.page;
}

const names = async (page) => (await treeRows(page)).map((r) => r.name);
const isDrawn = (page, id) => page.evaluate((i) => window.__bf.view.objectOf(i)?.visible ?? null, id);

describe('start-up', () => {
  test('opens with the example in the object list and on screen', async () => {
    const page = await start();
    assert.deepEqual(await treeRows(page), [
      { id: 'm1', name: 'Example femur', kind: 'mesh', depth: 0, selected: false, shown: true, count: null },
    ]);
    assert.equal(await page.locator('#space-note').innerText(), '1 mesh · coordinates as in each mesh file');
    assert.match(await page.locator('#properties').innerText(), /Select an object/);
    assert.equal(await page.locator('#stage-empty').isHidden(), true);
    // Something other than the background is drawn where the head is.
    const head = await onScreen(page, EXAMPLE.head.centre);
    const box = await page.locator('#stage canvas').boundingBox();
    assert.ok(head.x > box.x && head.x < box.x + box.width && head.y > box.y && head.y < box.y + box.height, 'the head is in view');
  });

  test('clicking the example in the 3D view selects it; clicking empty space selects nothing', async () => {
    const page = await start();
    await clickAt(page, await onScreen(page, EXAMPLE.head.centre));
    assert.equal((await treeRows(page))[0].selected, true);
    const p = await properties(page);
    assert.equal(p.name, 'Example femur');
    assert.equal(p.kind, 'Mesh');
    assert.equal(p.rows.File, 'example-femur.stl');
    assert.equal(p.rows.Format, 'STL, binary');
    assert.match(p.rows.Triangles, /^\d{1,3}(,\d{3})+$/);

    const box = await page.locator('#stage canvas').boundingBox();
    await clickAt(page, { x: box.x + 8, y: box.y + box.height - 40 });
    assert.equal((await treeRows(page))[0].selected, false);
    assert.equal(await properties(page), null);
  });

  test('dragging to rotate does not change the selection', async () => {
    const page = await start();
    const head = await onScreen(page, EXAMPLE.head.centre);
    await clickAt(page, head);
    const box = await page.locator('#stage canvas').boundingBox();
    // A drag that starts and ends on empty space.
    await page.mouse.move(box.x + 10, box.y + box.height - 40);
    await page.mouse.down();
    await page.mouse.move(box.x + 80, box.y + box.height - 60, { steps: 4 });
    await page.mouse.up();
    assert.equal((await treeRows(page))[0].selected, true, 'still selected');
  });
});

describe('meshes', () => {
  test('opening meshes replaces the example and lists each one', async () => {
    const page = await start();
    await openFiles(page, [files.ballA, files.ballB]);
    assert.deepEqual(await names(page), ['BALL_A.stl', 'BALL_B.stl']);
    assert.equal(await page.locator('#space-note').innerText(), '2 meshes · coordinates as in each mesh file');
    assert.equal(await page.locator('#message').isHidden(), true);

    // Both are in view, each where its file puts it: click one, then the other.
    await clickAt(page, await onScreen(page, [60, 0, 0]));
    assert.equal((await properties(page)).name, 'BALL_B.stl');
    assert.equal((await properties(page)).rows['Size (x × y × z)'], '24.000 × 24.000 × 24.000');
    await clickAt(page, await onScreen(page, [0, 0, 0]));
    assert.equal((await properties(page)).name, 'BALL_A.stl');
  });

  test('the eye hides a mesh, and a hidden mesh cannot be clicked', async () => {
    const page = await start();
    await openFiles(page, [files.ballA, files.ballB]);
    const [a] = await treeRows(page);
    const at = await onScreen(page, [0, 0, 0]);
    await page.locator(`#tree li[data-id="${a.id}"] .eye`).click();
    assert.equal(await isDrawn(page, a.id), false);
    assert.equal((await treeRows(page))[0].shown, false);
    await clickAt(page, at);
    assert.equal(await properties(page), null, 'nothing is selected through a hidden mesh');
    await page.locator(`#tree li[data-id="${a.id}"] .eye`).click();
    assert.equal(await isDrawn(page, a.id), true);
  });

  test('a mesh can be renamed and removed from the Properties panel', async () => {
    const page = await start();
    await openFiles(page, [files.ballA, files.ballB]);
    await page.locator('#tree .tree-name', { hasText: 'BALL_A.stl' }).click();
    await page.locator('#prop-name').fill('Left femur');
    await page.locator('#prop-name').press('Enter');
    assert.deepEqual(await names(page), ['Left femur', 'BALL_B.stl']);
    assert.equal((await properties(page)).rows.File, 'BALL_A.stl', 'the file name stays what it was');

    await page.locator('#prop-remove').click();
    assert.deepEqual(await names(page), ['BALL_B.stl']);
    assert.equal(await properties(page), null);
    assert.equal(await page.evaluate(() => window.__bf.view.root.children.length), 1);
  });

  test('files that can\'t be opened are explained, and the example stays', async () => {
    const page = await start();
    await openFiles(page, [files.quad, files.text]);
    const msg = await messageText(page);
    assert.match(msg, /“notes.txt” is not an STL or PLY mesh or a landmark file/);
    assert.match(msg, /“quad.ply” has faces with more than three corners/);
    assert.deepEqual(await names(page), ['Example femur']);
    await page.locator('#message button').click();
    assert.equal(await page.locator('#message').isHidden(), true);
  });

  test('opening the same mesh again is noted, not doubled', async () => {
    const page = await start();
    await openFiles(page, [files.ballA]);
    await openFiles(page, [files.ballA]);
    assert.match(await messageText(page), /“BALL_A.stl” is already open/);
    assert.deepEqual(await names(page), ['BALL_A.stl']);
  });
});

describe('landmark files', () => {
  test('a landmark file opens as a folded folder of points attached to its mesh', async () => {
    const page = await start();
    await openFiles(page, [files.ballB, files.ballA, files.lmkA]);
    assert.deepEqual((await treeRows(page)).map((r) => [r.name, r.depth, r.count]), [
      ['BALL_B.stl', 0, null],
      ['BALL_A.stl', 0, null],
      ['BALL_A', 1, '3'],
    ]);
    await page.locator('#tree .twist[aria-label="Unfold BALL_A"]').click();
    assert.deepEqual((await treeRows(page)).slice(3).map((r) => [r.name, r.kind, r.depth]), [
      ['Head, top', 'point', 2],
      ['Condyle L', 'point', 2],
      ['Condyle R', 'point', 2],
    ]);

    await page.locator('#tree .tree-name', { hasText: 'Condyle L' }).click();
    const p = await properties(page);
    assert.equal(p.kind, 'Point');
    assert.deepEqual([p.rows.ID, p.rows.Status, p.rows.x, p.rows.y, p.rows.z], ['LM02', 'estimated', '20.000', '0.000', '0.000']);
    assert.equal(p.rows.Coordinates, 'as in BALL_A.stl');
  });

  test('clicking a point marker selects the point and unfolds its folder', async () => {
    const page = await start();
    await openFiles(page, [files.ballA, files.lmkA]);
    assert.equal((await treeRows(page)).length, 2, 'the folder starts folded');
    await clickAt(page, await onScreen(page, [0, 0, 20]));
    const rows = await treeRows(page);
    assert.equal(rows.find((r) => r.selected)?.name, 'Head, top');
    assert.equal((await properties(page)).rows.z, '20.000');
  });

  test('Copy numbers puts the point on the clipboard as a spreadsheet row', async () => {
    const page = await start();
    await openFiles(page, [files.ballA, files.lmkA]);
    await page.locator('#tree .tree-row[data-kind="group"] .tree-name').click();
    assert.equal((await properties(page)).rows.Landmarks, '2 placed, 1 missing');
    await page.locator('#prop-copy').click();
    await page.waitForFunction(() => document.getElementById('prop-copy').textContent !== 'Copy numbers');
    const copied = await page.evaluate(() => window.__bf.lastCopied);
    assert.deepEqual(copied.split('\n'), [
      'id\tname\tstatus\tx\ty\tz',
      'LM01\tHead, top\tplaced\t0\t0\t20',
      'LM02\tCondyle L\testimated\t20\t0\t0',
      'LM03\tCondyle R\tmissing\tNA\tNA\tNA',
    ]);
  });

  test('hiding the mesh hides its landmarks; removing it removes them', async () => {
    const page = await start();
    await openFiles(page, [files.ballA, files.lmkA]);
    await clickAt(page, await onScreen(page, [0, 0, 20]));
    const point = (await treeRows(page)).find((r) => r.selected);
    const at = await onScreen(page, [0, 0, 20]);
    await page.locator('#tree li[data-id="m2"] > .tree-row .eye').click();
    await clickAt(page, at);
    assert.equal(await properties(page), null, 'the marker went with its mesh');
    assert.equal(await isDrawn(page, point.id), true, 'its own switch is still on');

    await page.locator('#tree .tree-name', { hasText: 'BALL_A.stl' }).click();
    await page.locator('#prop-remove').click();
    assert.deepEqual(await treeRows(page), []);
    assert.equal(await page.locator('#stage-empty').isVisible(), true);
    assert.match(await page.locator('#tree').innerText(), /Nothing is open yet/);
  });

  test('a landmark file without its mesh says which mesh to open', async () => {
    const page = await start();
    await openFiles(page, [files.lmkElsewhere]);
    assert.match(await messageText(page), /were placed on “OTHER.ply”, which isn’t open/);
    assert.deepEqual(await names(page), ['Example femur']);
  });
});

describe('curves', () => {
  // Points of the example's head that face the camera in the default view.
  const unit = (v) => v.map((x) => x / Math.hypot(...v));
  const HOME = unit([0.45, 0.35, 1]);
  const onHead = (u, v) => {
    const d = unit([HOME[0] + u, HOME[1] + v, HOME[2]]);
    return EXAMPLE.head.centre.map((c, i) => c + EXAMPLE.head.radius * d[i]);
  };
  const P1 = onHead(-0.4, -0.3);
  const P2 = onHead(0.4, -0.3);
  const P3 = onHead(0, 0.45);
  const clickHead = async (page, p) => clickAt(page, await onScreen(page, p));
  const curve = (page, id = 'c1') => page.evaluate((i) => window.__bf.model.get(i), id);
  const pressed = (page) => page.locator('#curve-btn').getAttribute('aria-pressed');

  test('the Curve button switches the tool on and says what to do; Esc switches it off', async () => {
    const page = await start();
    assert.equal(await page.locator('#tool-strip').isHidden(), true);
    await page.locator('#curve-btn').click();
    assert.equal(await pressed(page), 'true');
    assert.match(await page.locator('#tool-hint').innerText(), /Click on a mesh to start a curve/);
    assert.equal(await page.locator('#curve-finish').isDisabled(), true);
    await page.keyboard.press('Escape');
    assert.equal(await pressed(page), 'false');
    assert.equal(await page.locator('#tool-strip').isHidden(), true);
  });

  test('three clicks and C draw a closed loop, listed under its mesh with its length', async () => {
    const page = await start();
    await page.locator('#curve-btn').click();
    await clickHead(page, P1);
    assert.match(await page.locator('#tool-hint').innerText(), /Click to add points/);
    assert.equal((await properties(page)).rows.Shape, 'being drawn');
    await clickHead(page, P2);
    await clickHead(page, P3);
    assert.equal((await properties(page)).rows['Clicked points'], '3');
    await page.keyboard.press('c');

    assert.deepEqual((await treeRows(page)).map((r) => [r.name, r.kind, r.depth, r.selected]), [
      ['Example femur', 'mesh', 0, false],
      ['Curve 1', 'curve', 1, true],
    ]);
    const p = await properties(page);
    assert.equal(p.kind, 'Curve');
    assert.equal(p.rows.Shape, 'closed loop');
    assert.equal(p.rows.Coordinates, 'as in example-femur.stl');
    const c = await curve(page);
    assert.equal(p.rows.Length, c.length.toFixed(3));
    // The loop lies on the head: every point of its path is at the head's radius.
    for (const q of c.line) {
      const r = Math.hypot(...q.map((v, i) => v - EXAMPLE.head.centre[i]));
      assert.ok(Math.abs(r - EXAMPLE.head.radius) < 0.05, `on the head: ${r}`);
    }
    assert.equal(await pressed(page), 'true', 'the tool stays on for the next curve');
  });

  test('Enter finishes an open curve, even right after pressing the Curve button', async () => {
    const page = await start();
    await page.locator('#curve-btn').click();
    await clickHead(page, P1);
    await clickHead(page, P2);
    await page.keyboard.press('Enter');
    const c = await curve(page);
    assert.equal(c.closed, false);
    assert.equal(c.drawing, false);
    assert.equal(await pressed(page), 'true', 'Enter did not press the Curve button again');
    assert.equal((await properties(page)).rows.Shape, 'open curve');
  });

  test('Backspace takes the last point off; Esc removes the curve being drawn', async () => {
    const page = await start();
    await page.locator('#curve-btn').click();
    await clickHead(page, P1);
    await clickHead(page, P2);
    await clickHead(page, P3);
    await page.keyboard.press('Backspace');
    assert.equal((await curve(page)).control_points.length, 2);
    await page.keyboard.press('Escape');
    assert.deepEqual(await names(page), ['Example femur']);
    assert.equal(await pressed(page), 'true', 'the first Esc only removes the curve');
  });

  test('the strip\'s buttons do the same; a click on the first point closes the loop', async () => {
    const page = await start();
    await page.locator('#curve-btn').click();
    await clickHead(page, P1);
    await clickHead(page, P2);
    assert.equal(await page.locator('#curve-close').isDisabled(), true);
    await page.locator('#curve-finish').click();
    assert.equal((await curve(page, 'c1')).drawing, false);

    await clickHead(page, P3);
    await clickHead(page, P1);
    await clickHead(page, P2);
    await clickHead(page, P3); // its first point again
    const c2 = await curve(page, 'c2');
    assert.equal(c2.closed, true);
    assert.equal(c2.control_points.length, 3);
    await clickHead(page, P1);
    await page.locator('#curve-undo').click();
    assert.equal(await curve(page, 'c3'), null);
    assert.deepEqual(await names(page), ['Example femur', 'Curve 1', 'Curve 2']);
  });

  test('with the tool off, clicking a curve selects it and its handles can be dragged', async () => {
    const page = await start();
    await page.locator('#curve-btn').click();
    await clickHead(page, P1);
    await clickHead(page, P2);
    await clickHead(page, P3);
    await page.keyboard.press('c');
    await page.locator('#curve-btn').click();
    assert.equal(await pressed(page), 'false');

    // Select the mesh, then the curve by clicking on its line.
    await clickAt(page, await onScreen(page, EXAMPLE.shaft.point.map((v, i) => v + [0, 50, 7][i])));
    assert.equal((await properties(page)).kind, 'Mesh');
    const before = await curve(page);
    await clickAt(page, await onScreen(page, before.line[Math.floor(before.line.length / 6)]));
    assert.equal((await properties(page)).name, 'Curve 1');

    // Drag the second clicked point outwards; the camera must not turn.
    const cam = () => page.evaluate(() => window.__bf.viewer.camera.position.toArray());
    const camBefore = await cam();
    const from = await onScreen(page, before.control_points[1].position);
    const to = await onScreen(page, onHead(0.7, -0.5));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 3 });
    await page.mouse.move(to.x, to.y, { steps: 3 });
    await page.mouse.up();
    const after = await curve(page);
    assert.deepEqual(await cam(), camBefore);
    assert.notDeepEqual(after.control_points[1].position, before.control_points[1].position);
    assert.deepEqual(after.control_points[0], before.control_points[0], 'the other points stay');
    assert.ok(after.length > before.length, 'a wider loop is longer');
    assert.equal((await properties(page)).rows.Length, after.length.toFixed(3), 'Properties follow the drag');
  });

  test('Copy numbers gives the curve\'s length and centroid; Remove takes it out', async () => {
    const page = await start();
    await page.locator('#curve-btn').click();
    await clickHead(page, P1);
    await clickHead(page, P2);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    const c = await curve(page);
    await page.locator('#prop-copy').click();
    await page.waitForFunction(() => document.getElementById('prop-copy').textContent !== 'Copy numbers');
    assert.deepEqual((await page.evaluate(() => window.__bf.lastCopied)).split('\n'), [
      'name\tshape\tclicked_points\tlength\tcentroid_x\tcentroid_y\tcentroid_z',
      ['Curve 1', 'open', 2, c.length, ...c.centroid].join('\t'),
    ]);
    await page.locator('#prop-remove').click();
    assert.deepEqual(await names(page), ['Example femur']);
  });

  test('opening a mesh while a curve is being drawn on the example drops the curve with it', async () => {
    const page = await start();
    await page.locator('#curve-btn').click();
    await clickHead(page, P1);
    await openFiles(page, [files.ballA]);
    assert.deepEqual(await names(page), ['BALL_A.stl']);
    assert.match(await page.locator('#tool-hint').innerText(), /Click on a mesh to start a curve/);
    await clickAt(page, await onScreen(page, [0, 0, 20]));
    assert.equal((await curve(page, 'c2')).parent, 'm2');
  });
});

describe('regions', () => {
  // Loops on the example's head round the point that faces the camera in the
  // default view: n points on the circle `angle` degrees away from it.
  const unit = (v) => v.map((x) => x / Math.hypot(...v));
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const HOME = unit([0.45, 0.35, 1]);
  const E1 = unit(cross(HOME, [0, 1, 0]));
  const E2 = cross(HOME, E1);
  const R = EXAMPLE.head.radius;
  const loop = (angle, n = 8) =>
    Array.from({ length: n }, (_, k) => {
      const a = (angle * Math.PI) / 180;
      const t = (2 * Math.PI * k) / n;
      return EXAMPLE.head.centre.map((c, i) => c + R * (Math.cos(a) * HOME[i] + Math.sin(a) * (Math.cos(t) * E1[i] + Math.sin(t) * E2[i])));
    });
  const cap = (angle) => 2 * Math.PI * R * R * (1 - Math.cos((angle * Math.PI) / 180));
  const node = (page, id) =>
    page.evaluate((i) => {
      const { faces, line, ...rest } = window.__bf.model.get(i) ?? {};
      return rest.id ? rest : null;
    }, id);
  const drawn = (page, id) => page.evaluate((i) => {
    const o = window.__bf.view.objectOf(i);
    return o ? { visible: o.visible, triangles: o.geometry.attributes.position.count / 3 } : null;
  }, id);

  // Draw a closed loop with the Curve tool and leave the tool.
  async function drawLoop(page, points) {
    if ((await page.locator('#curve-btn').getAttribute('aria-pressed')) !== 'true') await page.locator('#curve-btn').click();
    for (const p of points) await clickAt(page, await onScreen(page, p));
    await page.keyboard.press('c');
    await page.locator('#curve-btn').click();
  }

  test('Region makes a region from the selected closed curve: listed, tinted, with area and centroid', async () => {
    const page = await start();
    await drawLoop(page, loop(30));
    await page.locator('#region-btn').click();

    assert.deepEqual((await treeRows(page)).map((r) => [r.name, r.kind, r.depth, r.selected]), [
      ['Example femur', 'mesh', 0, false],
      ['Curve 1', 'curve', 1, false],
      ['Region 1', 'region', 1, true],
    ]);
    const p = await properties(page);
    assert.equal(p.kind, 'Region');
    assert.equal(p.rows.Boundary, 'Curve 1');
    assert.equal(p.rows.Side, 'inside the curve');
    assert.equal(p.rows.Coordinates, 'as in example-femur.stl');
    const r = await node(page, 'r1');
    assert.equal(r.error, null);
    assert.equal(p.rows.Triangles, r.faceCount.toLocaleString('en-US'));
    assert.equal(p.rows.Area, r.area.toFixed(3));
    // Eight points on the circle: a little less than the whole cap.
    assert.ok(r.area > 0.8 * cap(30) && r.area < cap(30), `${r.area} against a cap of ${cap(30)}`);
    // Its centroid is under the middle of the loop.
    const dir = unit(r.centroid.map((v, i) => v - EXAMPLE.head.centre[i]));
    assert.ok(dir[0] * HOME[0] + dir[1] * HOME[1] + dir[2] * HOME[2] > 0.995);
    assert.deepEqual(await drawn(page, 'r1'), { visible: true, triangles: r.faceCount });
    assert.equal(await page.locator('#message').isHidden(), true);
  });

  test('with a loop still being drawn, Region closes it first', async () => {
    const page = await start();
    await page.locator('#curve-btn').click();
    for (const p of loop(30, 5)) await clickAt(page, await onScreen(page, p));
    await page.locator('#region-btn').click();
    assert.equal((await node(page, 'c1')).closed, true);
    assert.equal((await properties(page)).name, 'Region 1');
    assert.equal((await node(page, 'r1')).error, null);
  });

  test('Region says what to select when there is no closed curve', async () => {
    const page = await start();
    await page.locator('#region-btn').click();
    assert.match(await messageText(page), /Select a closed curve first/);
    await page.locator('#curve-btn').click();
    for (const p of loop(30, 2)) await clickAt(page, await onScreen(page, p));
    await page.keyboard.press('Enter');
    await page.locator('#region-btn').click();
    assert.match(await messageText(page), /“Curve 1” is not a closed loop/);
    assert.deepEqual(await names(page), ['Example femur', 'Curve 1']);
  });

  test('Use the other side takes the rest of the surface instead', async () => {
    const page = await start();
    await drawLoop(page, loop(30));
    await page.locator('#region-btn').click();
    const inside = (await node(page, 'r1')).area;
    await page.locator('#prop-flip').click();
    const r = await node(page, 'r1');
    assert.equal((await properties(page)).rows.Side, 'the other side');
    const sphere = 4 * Math.PI * R * R;
    assert.ok(Math.abs(inside + r.area - sphere) < 0.02 * sphere, 'the two sides make up the whole head');
    assert.equal((await drawn(page, 'r1')).triangles, r.faceCount);
  });

  test('dragging a point of the curve reshapes its region', async () => {
    const page = await start();
    await drawLoop(page, loop(25));
    await page.locator('#region-btn').click();
    const before = (await node(page, 'r1')).area;
    await page.locator('#tree .tree-name', { hasText: 'Curve 1' }).click();
    const from = await onScreen(page, loop(25)[2]);
    const to = await onScreen(page, loop(50)[2]);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 3 });
    await page.mouse.move(to.x, to.y, { steps: 3 });
    await page.mouse.up();
    const after = await node(page, 'r1');
    assert.ok(after.area > before * 1.1, `${after.area} after, ${before} before`);
    assert.equal((await drawn(page, 'r1')).triangles, after.faceCount, 'the tint follows');
  });

  test('a click inside a region selects it; outside it, the mesh; removing the curve removes the region', async () => {
    const page = await start();
    await drawLoop(page, loop(30));
    await page.locator('#region-btn').click();
    await clickAt(page, await onScreen(page, loop(60)[1]));
    assert.equal((await properties(page)).kind, 'Mesh');
    await clickAt(page, await onScreen(page, loop(0)[0]));
    assert.equal((await properties(page)).name, 'Region 1');

    await page.locator('#tree .tree-name', { hasText: 'Curve 1' }).click();
    await page.locator('#prop-remove').click();
    assert.deepEqual(await names(page), ['Example femur']);
    assert.equal(await drawn(page, 'r1'), null);
  });

  test('a second loop inside the first can be added as a boundary, leaving a hole', async () => {
    const page = await start();
    await page.locator('#curve-btn').click();
    for (const p of loop(40)) await clickAt(page, await onScreen(page, p));
    await page.keyboard.press('c');
    for (const p of loop(15, 6)) await clickAt(page, await onScreen(page, p));
    await page.keyboard.press('c');
    await page.locator('#curve-btn').click();

    await page.locator('#tree .tree-name', { hasText: 'Curve 1' }).click();
    await page.locator('#region-btn').click();
    const whole = (await node(page, 'r1')).area;
    await page.locator('#prop-add-boundary').selectOption({ label: 'Curve 2' });
    const p = await properties(page);
    assert.equal(p.rows.Boundary, 'Curve 1, Curve 2');
    assert.equal(p.rows.Side, 'between its curves');
    const ring = (await node(page, 'r1')).area;
    assert.ok(ring < whole - 0.7 * cap(15) && ring > whole - 1.1 * cap(15), `${ring} of ${whole}`);
    assert.equal(await page.locator('#prop-add-boundary').count(), 0, 'no closed curve is left to add');
    // The hole is not part of the region any more.
    await clickAt(page, await onScreen(page, loop(0)[0]));
    assert.equal((await properties(page)).kind, 'Mesh');
  });

  test('a loop that crosses itself gives no region, and says why', async () => {
    const page = await start();
    const [a, b, c, d] = loop(30, 4);
    await drawLoop(page, [a, c, b, d]);
    await page.locator('#region-btn').click();
    assert.equal((await node(page, 'r1')).error, 'crossing');
    assert.match(await page.locator('#properties .problem').innerText(), /crosses itself/);
    assert.equal((await treeRows(page)).find((r) => r.name === 'Region 1').count, '!');
    assert.equal((await drawn(page, 'r1')).visible, false);

    // Putting the curve right brings the region back and clears the mark.
    await page.locator('#tree .tree-name', { hasText: 'Curve 1' }).click();
    const from = await onScreen(page, c);
    const to = await onScreen(page, loop(30, 8)[1]);
    const from2 = await onScreen(page, b);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await page.mouse.up();
    const to2 = await onScreen(page, loop(30, 8)[5]);
    await page.mouse.move(from2.x, from2.y);
    await page.mouse.down();
    await page.mouse.move(to2.x, to2.y, { steps: 4 });
    await page.mouse.up();
    assert.equal((await node(page, 'r1')).error, null);
    assert.equal((await treeRows(page)).find((r) => r.name === 'Region 1').count, null);
  });
});

describe('fitted spheres', () => {
  // Loops on the example's head round the point facing the camera in the default view.
  const unit = (v) => v.map((x) => x / Math.hypot(...v));
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const HOME = unit([0.45, 0.35, 1]);
  const E1 = unit(cross(HOME, [0, 1, 0]));
  const E2 = cross(HOME, E1);
  const R = EXAMPLE.head.radius;
  const loop = (angle, n = 8) =>
    Array.from({ length: n }, (_, k) => {
      const a = (angle * Math.PI) / 180;
      const t = (2 * Math.PI * k) / n;
      return EXAMPLE.head.centre.map((c, i) => c + R * (Math.cos(a) * HOME[i] + Math.sin(a) * (Math.cos(t) * E1[i] + Math.sin(t) * E2[i])));
    });
  const node = (page, id) =>
    page.evaluate((i) => {
      const { faces, line, ...rest } = window.__bf.model.get(i) ?? {};
      return rest.id ? rest : null;
    }, id);

  async function drawLoop(page, points) {
    await page.locator('#curve-btn').click();
    for (const p of points) await clickAt(page, await onScreen(page, p));
    await page.keyboard.press('c');
    await page.locator('#curve-btn').click();
  }

  test('Sphere on a region gives back the example\'s head: centre and radius as built', async () => {
    const page = await start();
    await drawLoop(page, loop(35));
    await page.locator('#region-btn').click();
    await page.locator('#sphere-btn').click();

    assert.deepEqual((await treeRows(page)).map((r) => [r.name, r.kind, r.depth, r.selected]), [
      ['Example femur', 'mesh', 0, false],
      ['Curve 1', 'curve', 1, false],
      ['Region 1', 'region', 1, false],
      ['Sphere 1', 'sphere', 1, true],
    ]);
    const p = await properties(page);
    assert.equal(p.kind, 'Sphere');
    assert.equal(p.rows['Fitted to'], 'Region 1');
    assert.deepEqual(['x', 'y', 'z'].map((k) => p.rows[`Centre ${k}`]), EXAMPLE.head.centre.map((v) => v.toFixed(3)));
    assert.equal(p.rows.Radius, '12.000');
    assert.equal(p.rows.Diameter, '24.000');
    assert.equal(p.rows['RMS deviation'], '0.000');
    assert.equal(p.rows.Coordinates, 'as in example-femur.stl');
    assert.match(p.rows.Coverage, /% of the sphere \(a cap of 3\d°\)/);
    assert.equal(await page.locator('#message').isHidden(), true);
  });

  test('Sphere on a closed curve makes its region first; on nothing it says what to select', async () => {
    const page = await start();
    await page.locator('#sphere-btn').click();
    assert.match(await messageText(page), /Select a region \(or a closed curve\) first/);
    await drawLoop(page, loop(30));
    await page.locator('#sphere-btn').click();
    assert.deepEqual(await names(page), ['Example femur', 'Curve 1', 'Region 1', 'Sphere 1']);
    assert.equal((await properties(page)).rows.Radius, '12.000');
    // The curve's existing region is used, not a second one.
    await page.locator('#tree .tree-name', { hasText: 'Curve 1' }).click();
    await page.locator('#sphere-btn').click();
    assert.deepEqual(await names(page), ['Example femur', 'Curve 1', 'Region 1', 'Sphere 1', 'Sphere 2']);
  });

  test('moving a point of the curve refits the sphere; it stays the head', async () => {
    const page = await start();
    await drawLoop(page, loop(25));
    await page.locator('#sphere-btn').click();
    const before = await node(page, 's1');
    await page.locator('#tree .tree-name', { hasText: 'Curve 1' }).click();
    const from = await onScreen(page, loop(25)[3]);
    const to = await onScreen(page, loop(50)[3]);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 5 });
    await page.mouse.up();
    const after = await node(page, 's1');
    assert.ok(after.coverage > before.coverage, 'it covers more of the head');
    assert.ok(after.faceCount > before.faceCount);
    assert.ok(Math.abs(after.radius - R) < 1e-3);
  });

  test('a click on the centre mark selects the sphere; Copy numbers gives its row; removing the curve removes it', async () => {
    const page = await start();
    await drawLoop(page, loop(30));
    await page.locator('#sphere-btn').click();
    await page.locator('#tree .tree-name', { hasText: 'Example femur' }).click();
    await clickAt(page, await onScreen(page, EXAMPLE.head.centre));
    assert.equal((await properties(page)).name, 'Sphere 1');

    await page.locator('#prop-copy').click();
    await page.waitForFunction(() => document.getElementById('prop-copy').textContent !== 'Copy numbers');
    const [head, row] = (await page.evaluate(() => window.__bf.lastCopied)).split('\n');
    assert.equal(head, 'name\tfitted_to\tcentre_x\tcentre_y\tcentre_z\tradius\trms_deviation\tmax_deviation\tcoverage\ttriangles');
    const cells = row.split('\t');
    assert.deepEqual(cells.slice(0, 2), ['Sphere 1', 'Region 1']);
    cells.slice(2, 5).forEach((v, i) => assert.ok(Math.abs(Number(v) - EXAMPLE.head.centre[i]) < 1e-3));
    assert.ok(Math.abs(Number(cells[5]) - R) < 1e-3);

    await page.locator('#tree .tree-name', { hasText: 'Curve 1' }).click();
    await page.locator('#prop-remove').click();
    assert.deepEqual(await names(page), ['Example femur']);
  });

  test('a sphere whose region encloses nothing shows the problem until the curve is put right', async () => {
    const page = await start();
    await drawLoop(page, loop(30));
    await page.locator('#sphere-btn').click();
    // Drag two points past each other, so the loop crosses itself.
    await page.locator('#tree .tree-name', { hasText: 'Curve 1' }).click();
    const pts = loop(30);
    const a = await onScreen(page, pts[1]);
    const b = await onScreen(page, pts[5]);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x + (b.x - a.x) * 0.15, b.y + (b.y - a.y) * 0.15, { steps: 6 });
    await page.mouse.up();
    assert.equal((await node(page, 's1')).error, 'region');
    await page.locator('#tree .tree-name', { hasText: 'Sphere 1' }).click();
    assert.match(await page.locator('#properties .problem').innerText(), /encloses nothing/);
    assert.equal((await treeRows(page)).find((r) => r.name === 'Sphere 1').count, '!');
  });
});

describe('fitted cylinders and planes', () => {
  const unit = (v) => v.map((x) => x / Math.hypot(...v));
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const HOME = unit([0.45, 0.35, 1]);
  // The shaft's side facing the camera in the default view, `deg` degrees either side, `y` up it.
  const S = EXAMPLE.shaft;
  const FRONT = (Math.atan2(HOME[2], HOME[0]) * 180) / Math.PI;
  const onShaft = (deg, y) => {
    const t = ((FRONT + deg) * Math.PI) / 180;
    return [S.point[0] + S.radius * Math.cos(t), S.point[1] + y, S.point[2] + S.radius * Math.sin(t)];
  };
  // A loop on the head round the point facing the camera.
  const E1 = unit(cross(HOME, [0, 1, 0]));
  const E2 = cross(HOME, E1);
  const R = EXAMPLE.head.radius;
  const headLoop = (angle, n = 8) =>
    Array.from({ length: n }, (_, k) => {
      const a = (angle * Math.PI) / 180;
      const t = (2 * Math.PI * k) / n;
      return EXAMPLE.head.centre.map((c, i) => c + R * (Math.cos(a) * HOME[i] + Math.sin(a) * (Math.cos(t) * E1[i] + Math.sin(t) * E2[i])));
    });
  const node = (page, id) =>
    page.evaluate((i) => {
      const { faces, line, ...rest } = window.__bf.model.get(i) ?? {};
      return rest.id ? rest : null;
    }, id);
  async function drawLoop(page, points) {
    await page.locator('#curve-btn').click();
    for (const p of points) await clickAt(page, await onScreen(page, p));
    await page.keyboard.press('c');
    await page.locator('#curve-btn').click();
  }

  test('Cylinder on a patch of the shaft gives back the shaft: its axis and radius as built', async () => {
    const page = await start();
    await drawLoop(page, [onShaft(-30, 30), onShaft(0, 30), onShaft(30, 30), onShaft(30, 70), onShaft(0, 70), onShaft(-30, 70)]);
    await page.locator('#cylinder-btn').click();
    assert.deepEqual((await treeRows(page)).map((r) => [r.name, r.kind, r.selected]), [
      ['Example femur', 'mesh', false],
      ['Curve 1', 'curve', false],
      ['Region 1', 'region', false],
      ['Cylinder 1', 'cylinder', true],
    ]);
    const p = await properties(page);
    assert.equal(p.kind, 'Cylinder');
    assert.equal(p.rows.Radius, '7.000');
    assert.deepEqual(['x', 'y', 'z'].map((k) => p.rows[`Direction ${k}`]), ['0.0000', '1.0000', '0.0000']);
    // The axis point lies on the shaft's axis: same x and z as the shaft.
    assert.equal(p.rows['Axis point x'], S.point[0].toFixed(3));
    assert.equal(p.rows['Axis point z'], S.point[2].toFixed(3));
    const c = await node(page, 'y1');
    assert.ok(c.arc >= 55 && c.arc <= 75, `arc ${c.arc}`);
    assert.match(p.rows.Note, /less than a quarter of the way round/);

    await page.locator('#prop-flip-fit').click();
    assert.equal((await properties(page)).rows['Direction y'], '-1.0000');
  });

  test('Plane on a curve fits its path; on a region, the patch; Flip normal turns it round', async () => {
    const page = await start();
    await drawLoop(page, headLoop(30, 10));
    await page.locator('#plane-btn').click();
    assert.deepEqual(await names(page), ['Example femur', 'Curve 1', 'Plane 1']);
    let p = await properties(page);
    assert.equal(p.kind, 'Plane');
    assert.equal(p.rows['Fitted to'], 'Curve 1 (its path)');
    const fromCurve = await node(page, 'f1');
    assert.ok(Math.abs(dot(fromCurve.normal, HOME)) > 0.999, `normal ${fromCurve.normal}`);
    assert.match(p.rows.Equation, /x \+ .* y \+ .* z = /);

    await page.locator('#tree .tree-name', { hasText: 'Curve 1' }).click();
    await page.locator('#region-btn').click();
    await page.locator('#plane-btn').click();
    p = await properties(page);
    assert.equal(p.rows['Fitted to'], 'Region 1');
    const fromRegion = await node(page, 'f2');
    assert.ok(dot(fromRegion.normal, HOME) > 0.999, 'square to the head\'s surface there, facing out');
    await page.locator('#prop-flip-fit').click();
    assert.ok(dot((await node(page, 'f2')).normal, HOME) < -0.999);
  });

  test('a click on a plane\'s centre mark selects it; Plane with nothing selected says what to select', async () => {
    const page = await start();
    await page.locator('#plane-btn').click();
    assert.match(await messageText(page), /Select a region or a curve first/);
    await page.locator('#cylinder-btn').click();
    assert.match(await messageText(page), /Select a region \(or a closed curve\) first, then press Cylinder/);
    await drawLoop(page, headLoop(30, 8));
    await page.locator('#plane-btn').click();
    const f = await node(page, 'f1');
    await page.locator('#tree .tree-name', { hasText: 'Example femur' }).click();
    await clickAt(page, await onScreen(page, f.point));
    assert.equal((await properties(page)).name, 'Plane 1');
  });
});

describe('meshes from regions', () => {
  const unit = (v) => v.map((x) => x / Math.hypot(...v));
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const HOME = unit([0.45, 0.35, 1]);
  const E1 = unit(cross(HOME, [0, 1, 0]));
  const E2 = cross(HOME, E1);
  const R = EXAMPLE.head.radius;
  const headLoop = (angle, n = 8) =>
    Array.from({ length: n }, (_, k) => {
      const a = (angle * Math.PI) / 180;
      const t = (2 * Math.PI * k) / n;
      return EXAMPLE.head.centre.map((c, i) => c + R * (Math.cos(a) * HOME[i] + Math.sin(a) * (Math.cos(t) * E1[i] + Math.sin(t) * E2[i])));
    });
  const node = (page, id) =>
    page.evaluate((i) => {
      const { faces, line, ...rest } = window.__bf.model.get(i) ?? {};
      return rest.id ? rest : null;
    }, id);
  // Browsers with a Save dialog would open it; these tests take the plain download instead.
  const noDialog = () => { delete window.showSaveFilePicker; };

  async function regionOnHead(page) {
    await page.locator('#curve-btn').click();
    for (const p of headLoop(35, 10)) await clickAt(page, await onScreen(page, p));
    await page.keyboard.press('c');
    await page.locator('#curve-btn').click();
    await page.locator('#region-btn').click();
  }

  test('New mesh from region adds a mesh of just the region, with its surface area; the original stays', async () => {
    const page = await start();
    await regionOnHead(page);
    const region = await node(page, 'r1');
    await page.locator('#prop-extract').click();
    await page.waitForFunction(() => window.__bf.model.get('m2'));
    assert.deepEqual((await treeRows(page)).map((r) => [r.name, r.kind, r.depth, r.selected]), [
      ['Example femur', 'mesh', 0, false],
      ['Curve 1', 'curve', 1, false],
      ['Region 1', 'region', 1, false],
      ['Region 1 of Example femur', 'mesh', 0, true],
    ]);
    const p = await properties(page);
    assert.equal(p.kind, 'Mesh');
    assert.equal(p.rows['Made from'], 'Region 1 of Example femur');
    assert.equal(p.rows['Surface area'], region.area.toFixed(3));
    assert.equal(p.rows.Triangles, region.faceCount.toLocaleString('en-US'));
    assert.equal(p.rows.Coordinates, 'as in example-femur.stl');
    assert.equal(await page.locator('#space-note').innerText(), '2 meshes · coordinates as in each mesh file');
    // The original is untouched and still has everything on it.
    assert.equal((await node(page, 'm1')).faceCount, 65280);
  });

  test('hiding the original leaves the new mesh on its own; clicking it selects it', async () => {
    const page = await start();
    await regionOnHead(page);
    await page.locator('#prop-extract').click();
    await page.waitForFunction(() => window.__bf.model.get('m2'));
    await page.locator('#tree li[data-id="m1"] > .tree-row .eye').click();
    await page.locator('#tree li[data-id="m2"] > .tree-row .eye').click();
    await page.locator('#tree li[data-id="m2"] > .tree-row .eye').click();
    await clickAt(page, await onScreen(page, headLoop(0)[0]));
    assert.equal((await properties(page)).name, 'Region 1 of Example femur');
    await clickAt(page, await onScreen(page, EXAMPLE.shaft.point.map((v, i) => v + [0, 50, 7][i])));
    assert.equal(await properties(page), null, 'the hidden original can\'t be clicked');
  });

  test('Save as STL downloads the new mesh; opening that file again is recognised as already open', async () => {
    const page = await start({ init: noDialog });
    await regionOnHead(page);
    await page.locator('#prop-extract').click();
    await page.waitForFunction(() => window.__bf.model.get('m2'));
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#prop-save-stl').click()]);
    assert.equal(download.suggestedFilename(), 'example-femur-region-1.stl');
    const path = join(files.dir, 'saved.stl');
    await download.saveAs(path);
    const saved = await loadMeshBuffer((await readFile(path)).buffer, 'saved.stl');
    const m = await node(page, 'm2');
    assert.equal(saved.faceCount, m.faceCount);
    assert.equal(saved.sha256, m.sha256);
    assert.match(await messageText(page), /Saved “example-femur-region-1.stl”/);
  });

  test('Save as PLY downloads a PLY with shared vertices', async () => {
    const page = await start({ init: noDialog });
    await regionOnHead(page);
    await page.locator('#prop-extract').click();
    await page.waitForFunction(() => window.__bf.model.get('m2'));
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#prop-save-ply').click()]);
    assert.equal(download.suggestedFilename(), 'example-femur-region-1.ply');
    const path = join(files.dir, 'saved.ply');
    await download.saveAs(path);
    const saved = await loadMeshBuffer((await readFile(path)).buffer, 'saved.ply');
    const m = await node(page, 'm2');
    assert.equal(saved.faceCount, m.faceCount);
    assert.ok(saved.vertexCount < m.faceCount, `${saved.vertexCount} vertices`);
  });
});

describe('view', () => {
  test('the axis buttons and F turn and refit the camera', async () => {
    const page = await start();
    const cam = () => page.evaluate(() => {
      const v = window.__bf.viewer;
      return v.camera.position.clone().sub(v.controls.target).normalize().toArray();
    });
    await page.locator('.viewbar [data-view="+x"]').click();
    assert.deepEqual((await cam()).map((n) => Math.round(n * 1e6) / 1e6), [1, 0, 0]);
    await page.locator('.viewbar [data-view="-z"]').click();
    assert.deepEqual((await cam()).map((n) => Math.round(n * 1e6) / 1e6), [0, 0, -1]);
    // Zoom far out, then F brings everything back to fill the view.
    const before = await onScreen(page, EXAMPLE.head.centre);
    await page.mouse.move(before.x, before.y);
    await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(100);
    const zoomed = await onScreen(page, EXAMPLE.head.centre);
    assert.ok(Math.hypot(zoomed.x - before.x, zoomed.y - before.y) > 5, 'zooming moved things');
    await page.keyboard.press('f');
    await page.waitForTimeout(100);
    const after = await onScreen(page, EXAMPLE.head.centre);
    assert.ok(Math.hypot(after.x - before.x, after.y - before.y) < 1, 'F fits the view again');
  });

  test('on a narrow screen the page still loads and lists the example', async () => {
    const page = await start({ width: 390, height: 800 });
    assert.deepEqual(await names(page), ['Example femur']);
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.equal(scroll, 0, 'no sideways scrolling');
  });
});
