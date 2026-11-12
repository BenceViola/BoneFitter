// End-to-end tests: the real page in headless Chromium, driven with the
// mouse and keyboard. They check what a user would see.

import { test, describe, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  startServer, launch, openApp, choose, clickAt, onScreen, openFiles, messageText, treeRows, properties, makeFiles,
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
    await choose(page, 'region-loop');

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
    await choose(page, 'region-loop');
    assert.equal((await node(page, 'c1')).closed, true);
    assert.equal((await properties(page)).name, 'Region 1');
    assert.equal((await node(page, 'r1')).error, null);
  });

  test('Region says what to select when there is no closed curve', async () => {
    const page = await start();
    await choose(page, 'region-loop');
    assert.match(await messageText(page), /There is no closed curve yet/);
    assert.equal(await page.locator('#prompt-strip').isHidden(), true, 'nothing to pick from, so it does not ask');
    await page.locator('#curve-btn').click();
    for (const p of loop(30, 2)) await clickAt(page, await onScreen(page, p));
    await page.keyboard.press('Enter');
    await choose(page, 'region-loop');
    assert.match(await messageText(page), /“Curve 1” is not a closed loop/);
    assert.deepEqual(await names(page), ['Example femur', 'Curve 1']);
  });

  test('Use the other side takes the rest of the surface instead', async () => {
    const page = await start();
    await drawLoop(page, loop(30));
    await choose(page, 'region-loop');
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
    await choose(page, 'region-loop');
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
    await choose(page, 'region-loop');
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
    await choose(page, 'region-loop');
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
    await choose(page, 'region-loop');
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
    await choose(page, 'region-loop');
    await choose(page, 'sphere-fit');

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
    await choose(page, 'sphere-fit');
    assert.match(await messageText(page), /There is no region yet/);
    await drawLoop(page, loop(30));
    await choose(page, 'sphere-fit');
    assert.deepEqual(await names(page), ['Example femur', 'Curve 1', 'Region 1', 'Sphere 1']);
    assert.equal((await properties(page)).rows.Radius, '12.000');
    // The curve's existing region is used, not a second one.
    await page.locator('#tree .tree-name', { hasText: 'Curve 1' }).click();
    await choose(page, 'sphere-fit');
    assert.deepEqual(await names(page), ['Example femur', 'Curve 1', 'Region 1', 'Sphere 1', 'Sphere 2']);
  });

  test('moving a point of the curve refits the sphere; it stays the head', async () => {
    const page = await start();
    await drawLoop(page, loop(25));
    await choose(page, 'sphere-fit');
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
    await choose(page, 'sphere-fit');
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
    await choose(page, 'sphere-fit');
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
    await choose(page, 'cylinder-fit');
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
    await choose(page, 'plane-curve');
    assert.deepEqual(await names(page), ['Example femur', 'Curve 1', 'Plane 1']);
    let p = await properties(page);
    assert.equal(p.kind, 'Plane');
    assert.equal(p.rows['Fitted to'], 'Curve 1 (its path)');
    const fromCurve = await node(page, 'f1');
    assert.ok(Math.abs(dot(fromCurve.normal, HOME)) > 0.999, `normal ${fromCurve.normal}`);
    assert.match(p.rows.Equation, /x \+ .* y \+ .* z = /);

    await page.locator('#tree .tree-name', { hasText: 'Curve 1' }).click();
    await choose(page, 'region-loop');
    await choose(page, 'plane-fit');
    p = await properties(page);
    assert.equal(p.rows['Fitted to'], 'Region 1');
    const fromRegion = await node(page, 'f2');
    assert.ok(dot(fromRegion.normal, HOME) > 0.999, 'square to the head\'s surface there, facing out');
    await page.locator('#prop-flip-fit').click();
    assert.ok(dot((await node(page, 'f2')).normal, HOME) < -0.999);
  });

  test('a click on a plane\'s centre mark selects it; Plane with nothing selected says what to select', async () => {
    const page = await start();
    await choose(page, 'plane-curve');
    assert.match(await messageText(page), /There is no curve yet/);
    await choose(page, 'cylinder-fit');
    assert.match(await messageText(page), /There is no region yet/);
    await drawLoop(page, headLoop(30, 8));
    await choose(page, 'plane-curve');
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
    await choose(page, 'region-loop');
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

describe('lasso and box selection', () => {
  const R = EXAMPLE.head.radius;
  const node = (page, id) =>
    page.evaluate((i) => {
      const { faces, picked, line, ...rest } = window.__bf.model.get(i) ?? {};
      return rest.id ? rest : null;
    }, id);
  const cam = (page) => page.evaluate(() => window.__bf.viewer.camera.position.toArray());
  // A drag from a to b (page coordinates) through the points between, with keys held.
  async function drag(page, points, keys = []) {
    for (const k of keys) await page.keyboard.down(k);
    await page.mouse.move(...points[0]);
    await page.mouse.down();
    for (const p of points.slice(1)) await page.mouse.move(...p, { steps: 3 });
    await page.mouse.up();
    for (const k of keys) await page.keyboard.up(k);
    await page.waitForTimeout(100);
  }
  // The head's centre on the page, and how many pixels its radius is there.
  async function head(page) {
    const c = await onScreen(page, EXAMPLE.head.centre);
    const e = await onScreen(page, EXAMPLE.head.centre.map((v, i) => v + (i === 1 ? R : 0)));
    return { x: c.x, y: c.y, r: Math.hypot(e.x - c.x, e.y - c.y) };
  }

  test('Box: a drag over the head makes a region of its visible part; a sphere on it is the head', async () => {
    const page = await start();
    await page.locator('#box-btn').click();
    assert.equal(await page.locator('#box-btn').getAttribute('aria-pressed'), 'true');
    assert.match(await page.locator('#select-hint').innerText(), /Drag a box over the part/);
    const h = await head(page);
    const before = await cam(page);
    await drag(page, [[h.x - 0.5 * h.r, h.y - 0.5 * h.r], [h.x + 0.5 * h.r, h.y + 0.5 * h.r]]);
    assert.deepEqual(await cam(page), before, 'the camera did not turn');
    assert.equal(await page.locator('#select-overlay').isHidden(), true);

    const p = await properties(page);
    assert.equal(p.kind, 'Region');
    assert.equal(p.rows['Selected with'], 'Box (1 stroke)');
    const r = await node(page, 'r1');
    assert.equal(r.error, null);
    assert.ok(r.faceCount > 100);
    await choose(page, 'sphere-fit');
    assert.equal((await properties(page)).rows.Radius, '12.000');
  });

  test('Shift-drag adds to the region, Alt-drag takes away', async () => {
    const page = await start();
    await page.locator('#box-btn').click();
    const h = await head(page);
    await drag(page, [[h.x - 0.5 * h.r, h.y - 0.5 * h.r], [h.x, h.y + 0.5 * h.r]]);
    const first = (await node(page, 'r1')).faceCount;
    await drag(page, [[h.x, h.y - 0.5 * h.r], [h.x + 0.5 * h.r, h.y + 0.5 * h.r]], ['Shift']);
    const added = (await node(page, 'r1')).faceCount;
    assert.ok(added > 1.5 * first, `${first} then ${added}`);
    await drag(page, [[h.x - 0.6 * h.r, h.y - 0.6 * h.r], [h.x + 0.6 * h.r, h.y]], ['Alt']);
    const r = await node(page, 'r1');
    assert.ok(r.faceCount < added);
    assert.deepEqual(r.strokes.map((s) => s.mode), ['new', 'add', 'remove']);
    assert.deepEqual(await names(page), ['Example femur', 'Region 1']);
  });

  test('Lasso: an outline round the head; visible surface only unless "through" is ticked', async () => {
    const page = await start();
    await page.locator('#lasso-btn').click();
    const h = await head(page);
    const ring = Array.from({ length: 13 }, (_, k) => [h.x + 0.6 * h.r * Math.cos((2 * Math.PI * k) / 12), h.y + 0.6 * h.r * Math.sin((2 * Math.PI * k) / 12)]);
    // While dragging, the outline is drawn over the view.
    await page.mouse.move(...ring[0]);
    await page.mouse.down();
    for (const p of ring.slice(1, 6)) await page.mouse.move(...p, { steps: 2 });
    assert.equal(await page.locator('#select-overlay').isVisible(), true);
    assert.match(await page.locator('#select-path').getAttribute('d'), /^M[\d.]+ [\d.]+(L[\d.]+ [\d.]+){4,}Z$/);
    for (const p of ring.slice(6)) await page.mouse.move(...p, { steps: 2 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#select-overlay').isVisible(), false);
    const visible = await node(page, 'r1');
    assert.equal((await properties(page)).rows['Selected with'], 'Lasso (1 stroke)');
    await page.locator('#select-through').check();
    await page.locator('#tree .tree-name', { hasText: 'Example femur' }).click();
    await drag(page, ring);
    const through = await node(page, 'r2');
    assert.ok(through.faceCount > 1.7 * visible.faceCount, `${visible.faceCount} visible, ${through.faceCount} through`);
    assert.equal(through.strokes[0].through, true);
  });

  test('one tool at a time; Done leaves the tool, and the camera turns again', async () => {
    const page = await start();
    await page.locator('#lasso-btn').click();
    await page.locator('#box-btn').click();
    assert.equal(await page.locator('#lasso-btn').getAttribute('aria-pressed'), 'false');
    await page.locator('#curve-btn').click();
    assert.equal(await page.locator('#box-btn').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('#select-strip').isHidden(), true);
    await page.locator('#box-btn').click();
    assert.equal(await page.locator('#curve-btn').getAttribute('aria-pressed'), 'false');
    await page.locator('#select-done').click();
    assert.equal(await page.locator('#box-btn').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('#select-strip').isHidden(), true);
    const before = await cam(page);
    const box = await page.locator('#stage canvas').boundingBox();
    await drag(page, [[box.x + 20, box.y + box.height - 40], [box.x + 120, box.y + box.height - 60]]);
    assert.notDeepEqual(await cam(page), before, 'without the tool, a drag turns the view');
  });

  test('Esc toggles between selecting and turning the view, and Shift still adds to the same region', async () => {
    const page = await start();
    await page.locator('#box-btn').click();
    const h = await head(page);
    await drag(page, [[h.x - 0.5 * h.r, h.y - 0.5 * h.r], [h.x, h.y + 0.5 * h.r]]);
    const first = (await node(page, 'r1')).faceCount;

    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#box-btn').getAttribute('aria-pressed'), 'true', 'the tool stays chosen');
    assert.equal(await page.locator('#select-turn').getAttribute('aria-pressed'), 'true');
    assert.match(await page.locator('#select-hint').innerText(), /Turning the view/);
    const before = await cam(page);
    const box = await page.locator('#stage canvas').boundingBox();
    await drag(page, [[box.x + 20, box.y + box.height - 40], [box.x + 60, box.y + box.height - 50]]);
    assert.notDeepEqual(await cam(page), before, 'a drag turns the view');
    assert.equal((await node(page, 'r1')).faceCount, first, 'and selects nothing');
    assert.equal((await properties(page)).name, 'Region 1', 'the region is still selected');

    await page.keyboard.press('Escape');
    assert.match(await page.locator('#select-hint').innerText(), /Drag a box over the part/);
    const turned = await cam(page);
    const h2 = await head(page);
    await drag(page, [[h2.x, h2.y - 0.4 * h2.r], [h2.x + 0.5 * h2.r, h2.y + 0.4 * h2.r]], ['Shift']);
    assert.deepEqual(await cam(page), turned, 'selecting again: the view stays put');
    const r = await node(page, 'r1');
    assert.ok(r.faceCount > first, 'added to the same region');
    assert.deepEqual(await names(page), ['Example femur', 'Region 1']);

    // The Turn view button does the same; the tool's own button goes back to selecting.
    await page.locator('#select-turn').click();
    assert.equal(await page.locator('#select-turn').getAttribute('aria-pressed'), 'true');
    await page.locator('#box-btn').click();
    assert.equal(await page.locator('#select-turn').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('#box-btn').getAttribute('aria-pressed'), 'true');
  });

  test('with the tool on, a click still selects what is under it; a drag beside the mesh says nothing was inside', async () => {
    const page = await start();
    await page.locator('#box-btn').click();
    await clickAt(page, await onScreen(page, EXAMPLE.head.centre.map((v, i) => v + (i === 2 ? R : 0))));
    assert.equal((await properties(page)).kind, 'Mesh');
    const box = await page.locator('#stage canvas').boundingBox();
    await drag(page, [[box.x + 10, box.y + box.height - 80], [box.x + 60, box.y + box.height - 30]]);
    assert.match(await page.locator('#select-hint').innerText(), /Nothing of the mesh was inside the outline/);
    assert.deepEqual(await names(page), ['Example femur']);
  });
});

describe('view', () => {
  test('the axis buttons and F turn and refit the camera', async () => {
    const page = await start();
    const cam = () => page.evaluate(() => {
      const v = window.__bf.viewer;
      return v.camera.position.clone().sub(v.controls.target).normalize().toArray();
    });
    await page.locator('#view-menu').click();
    await page.locator('.viewbar [data-view="+x"]').click();
    assert.equal(await page.locator('.view-list').isHidden(), true, 'the menu closes once a view is chosen');
    assert.deepEqual((await cam()).map((n) => Math.round(n * 1e6) / 1e6), [1, 0, 0]);
    await page.locator('#view-menu').click();
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

describe('menus, the tool rail and the prompts that ask for what a command needs', () => {
  const unit = (v) => v.map((x) => x / Math.hypot(...v));
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const HOME = unit([0.45, 0.35, 1]);
  const E1 = unit(cross(HOME, [0, 1, 0]));
  const E2 = cross(HOME, E1);
  const R = EXAMPLE.head.radius;
  const onHead = (angle, t) => {
    const a = (angle * Math.PI) / 180;
    return EXAMPLE.head.centre.map((c, i) => c + R * (Math.cos(a) * HOME[i] + Math.sin(a) * (Math.cos(t) * E1[i] + Math.sin(t) * E2[i])));
  };
  const loop = (angle, n = 8) => Array.from({ length: n }, (_, k) => onHead(angle, (2 * Math.PI * k) / n));
  const pressed = (page, id) => page.locator(`#${id}`).getAttribute('aria-pressed');
  const box = (page, sel) => page.locator(sel).boundingBox();
  const strip = async (page) => ((await page.locator('#prompt-strip').isHidden()) ? null : page.locator('#prompt-text').innerText());

  async function drawLoop(page, points) {
    await page.locator('#curve-btn').click();
    for (const p of points) await clickAt(page, await onScreen(page, p));
    await page.keyboard.press('c');
    await page.locator('#pointer-btn').click();
  }
  // A closed curve on the head with its region; the mesh is left selected.
  async function withRegion(page) {
    await drawLoop(page, loop(30));
    await choose(page, 'region-loop');
    await page.locator('#tree .tree-name', { hasText: 'Example femur' }).click();
  }

  test('the bar above the 3D view is one row: Open, a menu per kind of object, the views', async () => {
    const page = await start();
    assert.deepEqual(await page.$$eval('.toolbar .menu-btn', (els) => els.map((e) => e.textContent.trim())), ['Region', 'Sphere', 'Cylinder', 'Plane', 'Point', 'Line', 'Axes', 'Measure', 'View']);
    const bar = await box(page, '.toolbar');
    assert.ok(bar.height < 60, `one row, ${bar.height}px high`);
    for (const id of ['region-btn', 'sphere-btn', 'cylinder-btn', 'plane-btn']) assert.equal(await page.locator(`#${id}`).count(), 0);
  });

  test('the rail beside the 3D view holds the mouse tools; it never covers the view', async () => {
    const page = await start();
    assert.deepEqual(await page.$$eval('.rail .rail-btn', (els) => els.map((e) => e.textContent.trim())), ['Select', 'Curve', 'Point', 'Lasso', 'Box']);
    const rail = await box(page, '.rail');
    const stage = await box(page, '#stage');
    assert.ok(rail.x + rail.width <= stage.x + 0.5, 'the rail ends where the 3D view begins');
    assert.ok(rail.height > 3 * rail.width, 'a column');
    const canvas = await box(page, '#stage canvas');
    assert.ok(Math.abs(canvas.width - stage.width) < 1 && Math.abs(canvas.height - stage.height) < 1, 'the view fills its place');

    assert.equal(await pressed(page, 'pointer-btn'), 'true');
    await page.locator('#lasso-btn').click();
    assert.deepEqual([await pressed(page, 'pointer-btn'), await pressed(page, 'lasso-btn')], ['false', 'true']);
    await page.locator('#curve-btn').click();
    assert.deepEqual([await pressed(page, 'pointer-btn'), await pressed(page, 'lasso-btn'), await pressed(page, 'curve-btn')], ['false', 'false', 'true']);
    await page.locator('#pointer-btn').click();
    assert.deepEqual([await pressed(page, 'pointer-btn'), await pressed(page, 'curve-btn')], ['true', 'false']);
    assert.equal(await page.locator('#tool-strip').isHidden(), true);
    // A click now selects again.
    await clickAt(page, await onScreen(page, onHead(0, 0)));
    assert.equal((await properties(page)).name, 'Example femur');
  });

  test('a menu lists the ways to make that kind of object; Esc or a click elsewhere closes it', async () => {
    const page = await start();
    const list = page.locator('#plane-menu + .menu-list');
    assert.equal(await list.isHidden(), true);
    await page.locator('#plane-menu').click();
    assert.equal(await page.locator('#plane-menu').getAttribute('aria-expanded'), 'true');
    assert.deepEqual(await list.locator('button').allInnerTexts(), ['Fit to a region', 'Fit to a curve']);
    // Under its button, over the 3D view.
    const [b, l] = [await box(page, '#plane-menu'), await list.boundingBox()];
    assert.ok(l.y >= b.y + b.height && Math.abs(l.x - b.x) < 2);
    assert.equal(await page.evaluate(() => {
      const r = document.querySelector('#plane-menu + .menu-list button').getBoundingClientRect();
      return document.elementFromPoint(r.left + 5, r.top + 5).dataset.command;
    }), 'plane-fit');

    await page.keyboard.press('Escape');
    assert.equal(await list.isHidden(), true);
    // Another menu takes its place; a click in the 3D view closes it.
    await page.locator('#plane-menu').click();
    await page.locator('#sphere-menu').click();
    assert.equal(await list.isHidden(), true);
    assert.equal(await page.locator('#sphere-menu + .menu-list').isVisible(), true);
    await clickAt(page, await onScreen(page, onHead(0, 0)));
    assert.equal(await page.locator('#sphere-menu + .menu-list').isHidden(), true);
  });

  test('with the keyboard: Enter opens a menu, the arrows walk it, Enter chooses', async () => {
    const page = await start();
    await drawLoop(page, loop(30));
    await page.locator('#plane-menu').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.command), 'plane-fit');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.command), 'plane-curve');
    await page.keyboard.press('Enter');
    assert.equal((await properties(page)).rows['Fitted to'], 'Curve 1 (its path)');
    assert.equal(await page.locator('#plane-menu + .menu-list').isHidden(), true);
  });

  test('a command asks for what it needs: click the region in the 3D view and the sphere is fitted', async () => {
    const page = await start();
    await withRegion(page);
    const before = await box(page, '#stage');
    await choose(page, 'sphere-fit');
    assert.match(await strip(page), /^Sphere: fit to a region\s+Click a region or a closed curve, in the 3D view or in the Objects list\. Esc cancels\.$/);
    assert.deepEqual(await names(page), ['Example femur', 'Curve 1', 'Region 1'], 'nothing made yet');
    // The strip has a row of its own: the 3D view gives it up and the picture still fits.
    const during = await box(page, '#stage');
    assert.ok(during.height < before.height);
    const canvas = await box(page, '#stage canvas');
    assert.ok(Math.abs(canvas.height - during.height) < 1);

    // The shaft is not a region: the strip says so and keeps asking.
    const h = Math.hypot(HOME[0], HOME[2]);
    const onShaft = [EXAMPLE.shaft.point[0] + (EXAMPLE.shaft.radius * HOME[0]) / h, EXAMPLE.shaft.point[1] + 50, EXAMPLE.shaft.point[2] + (EXAMPLE.shaft.radius * HOME[2]) / h];
    await clickAt(page, await onScreen(page, onShaft));
    await page.waitForFunction(() => /is a mesh/.test(document.getElementById('prompt-text').innerText));
    assert.match(await strip(page), /“Example femur” is a mesh\. Click a region or a closed curve\./);

    // In the middle of the region, the region is what a click picks.
    await clickAt(page, await onScreen(page, onHead(0, 0)));
    await page.waitForFunction(() => window.__bf.model.selected?.kind === 'sphere');
    assert.equal(await strip(page), null);
    const p = await properties(page);
    assert.equal(p.rows['Fitted to'], 'Region 1');
    assert.equal(p.rows.Radius, '12.000');
    assert.equal((await box(page, '#stage')).height, before.height);
  });

  test('the object can also be picked in the Objects list; a curve is taken over the region under it where it suits', async () => {
    const page = await start();
    await withRegion(page);
    await choose(page, 'cylinder-fit');
    await page.locator('#tree .tree-name', { hasText: 'Region 1' }).click();
    await page.waitForFunction(() => window.__bf.model.selected?.kind === 'cylinder');
    assert.equal((await properties(page)).rows['Fitted to'], 'Region 1');

    // Plane ▸ Fit to a curve: a click on the curve's line takes the curve, not the region or the mesh.
    await page.locator('#tree .tree-name', { hasText: 'Example femur' }).click();
    await choose(page, 'plane-curve');
    assert.match(await strip(page), /^Plane: fit to a curve\s+Click a curve/);
    await clickAt(page, await onScreen(page, loop(30)[2]));
    await page.waitForFunction(() => window.__bf.model.selected?.kind === 'plane');
    assert.equal((await properties(page)).rows['Fitted to'], 'Curve 1 (its path)');

    // Plane ▸ Fit to a region: a click on the same spot of the curve takes the region under it.
    await page.locator('#tree .tree-name', { hasText: 'Example femur' }).click();
    await choose(page, 'plane-fit');
    await clickAt(page, await onScreen(page, onHead(10, 0)));
    await page.waitForFunction(() => window.__bf.model.selected?.name === 'Plane 2');
    assert.equal((await properties(page)).rows['Fitted to'], 'Region 1');
  });

  test('Esc, Cancel and choosing a tool all stop a command that is asking; nothing is made', async () => {
    const page = await start();
    await withRegion(page);
    await choose(page, 'sphere-fit');
    await page.keyboard.press('Escape');
    assert.equal(await strip(page), null);
    await choose(page, 'sphere-fit');
    await page.locator('#prompt-cancel').click();
    assert.equal(await strip(page), null);
    await choose(page, 'sphere-fit');
    await page.locator('#lasso-btn').click();
    assert.equal(await strip(page), null);
    assert.equal(await page.locator('#select-strip').isVisible(), true);
    // And the other way round: a command that has to ask puts the tool away.
    await choose(page, 'sphere-fit');
    assert.match(await strip(page), /^Sphere: fit to a region/);
    assert.equal(await page.locator('#select-strip').isHidden(), true);
    assert.deepEqual([await pressed(page, 'lasso-btn'), await pressed(page, 'pointer-btn')], ['false', 'true']);
    await page.keyboard.press('Escape');
    // After a cancel a click only selects.
    await page.locator('#tree .tree-name', { hasText: 'Region 1' }).click();
    assert.deepEqual(await names(page), ['Example femur', 'Curve 1', 'Region 1']);
  });

  test('with a suitable object selected nothing is asked, and a tool that is on stays on', async () => {
    const page = await start();
    await withRegion(page);
    await page.locator('#tree .tree-name', { hasText: 'Region 1' }).click();
    await page.locator('#box-btn').click();
    await choose(page, 'sphere-fit');
    assert.equal(await strip(page), null);
    assert.equal((await properties(page)).name, 'Sphere 1');
    assert.equal(await pressed(page, 'box-btn'), 'true');
  });

  test('Properties offer what can be made from the selected object, in one click', async () => {
    const page = await start();
    const offered = () => page.$$eval('#prop-make button', (els) => els.map((e) => e.textContent));
    assert.equal(await page.locator('#prop-make').count(), 0, 'nothing selected');
    await withRegion(page);
    assert.equal(await page.locator('#prop-make').count(), 0, 'nothing is made from a mesh yet');

    await page.locator('#tree .tree-name', { hasText: 'Region 1' }).click();
    assert.equal(await page.locator('#prop-make .props-make-label').innerText(), 'Make from this');
    assert.deepEqual(await offered(), ['Sphere', 'Cylinder', 'Plane', 'Centroid point', 'New mesh']);
    await page.locator('#prop-make [data-make="sphere-fit"]').click();
    let p = await properties(page);
    assert.deepEqual([p.name, p.rows['Fitted to'], p.rows.Radius], ['Sphere 1', 'Region 1', '12.000']);
    assert.deepEqual(await offered(), ['Centre point'], 'from a sphere on its own, only its centre: the rest need more objects');
    assert.equal(await page.locator('#prop-measure').count(), 0, 'nothing to measure against yet');

    await page.locator('#tree .tree-name', { hasText: 'Curve 1' }).click();
    assert.deepEqual(await offered(), ['Region', 'Sphere', 'Cylinder', 'Plane', 'Centroid point', 'Line']);
    await page.locator('#prop-make [data-make="plane-curve"]').click();
    p = await properties(page);
    assert.deepEqual([p.name, p.rows['Fitted to']], ['Plane 1', 'Curve 1 (its path)']);

    // An open curve: only a plane.
    await page.locator('#curve-btn').click();
    for (const q of [onHead(50, 0), onHead(50, 0.5), onHead(50, 1)]) await clickAt(page, await onScreen(page, q));
    await page.keyboard.press('Enter');
    await page.locator('#pointer-btn').click();
    assert.equal((await properties(page)).name, 'Curve 2');
    assert.deepEqual(await offered(), ['Plane', 'Centroid point', 'Line']);
  });

  test('on a narrow screen the menus, the rail and the strip still fit', async () => {
    const page = await start({ width: 420, height: 800 });
    await page.locator('#sphere-menu').click();
    const l = await box(page, '#sphere-menu + .menu-list');
    assert.ok(l.x >= 0 && l.x + l.width <= 420, 'the menu is on the screen');
    await page.keyboard.press('Escape');
    const rail = await box(page, '.rail');
    const stage = await box(page, '#stage');
    assert.ok(rail.x + rail.width <= stage.x + 0.5 && stage.x + stage.width <= 420.5);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'nothing sticks out sideways');
  });
});

describe('points and lines', () => {
  const unit = (v) => v.map((x) => x / Math.hypot(...v));
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const HOME = unit([0.45, 0.35, 1]);
  const E1 = unit(cross(HOME, [0, 1, 0]));
  const E2 = cross(HOME, E1);
  const onBall = (c, R, angle, t) => {
    const a = (angle * Math.PI) / 180;
    return c.map((v, i) => v + R * (Math.cos(a) * HOME[i] + Math.sin(a) * (Math.cos(t) * E1[i] + Math.sin(t) * E2[i])));
  };
  const loop = (c, R, angle, n = 8) => Array.from({ length: n }, (_, k) => onBall(c, R, angle, (2 * Math.PI * k) / n));
  const H = Math.hypot(HOME[0], HOME[2]);
  const onShaft = (y) => [EXAMPLE.shaft.point[0] + (7 * HOME[0]) / H, EXAMPLE.shaft.point[1] + y, EXAMPLE.shaft.point[2] + (7 * HOME[2]) / H];
  const vec = (p, label) => ['x', 'y', 'z'].map((a) => Number(p.rows[`${label}${a}`]));
  const close = (a, b, tol, msg) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) <= tol, `${msg} [${i}] ${v} ≉ ${b[i]}`));
  const strip = async (page) => ((await page.locator('#prompt-strip').isHidden()) ? null : page.locator('#prompt-text').innerText());

  async function drawLoop(page, points) {
    await page.locator('#curve-btn').click();
    for (const p of points) await clickAt(page, await onScreen(page, p));
    await page.keyboard.press('c');
    await page.locator('#pointer-btn').click();
  }
  // A sphere fitted to a cap of a ball of the example (its loop is selected first).
  async function capSphere(page, c, R) {
    await drawLoop(page, loop(c, R, 35));
    await page.locator('#prop-make [data-make="sphere-fit"]').click();
  }
  const select = (page, name) => page.locator(`#tree .tree-name[title="${name}"]`).click();

  test('the Point tool places points where the mesh is clicked, until Esc', async () => {
    const page = await start();
    await page.locator('#point-btn').click();
    assert.equal(await page.locator('#point-btn').getAttribute('aria-pressed'), 'true');
    assert.match(await page.locator('#point-strip').innerText(), /Click on a mesh to place a point/);
    await clickAt(page, await onScreen(page, onShaft(40)));
    await clickAt(page, await onScreen(page, onShaft(70)));
    assert.deepEqual(await names(page), ['Example femur', 'Point 1', 'Point 2']);
    const p = await properties(page);
    assert.equal(p.name, 'Point 2');
    assert.equal(p.rows['Made as'], 'Clicked on Example femur');
    close(vec(p, ''), onShaft(70), 0.05, 'on the shaft where clicked');
    // A click on an existing point selects it.
    await clickAt(page, await onScreen(page, onShaft(40)));
    assert.equal((await properties(page)).name, 'Point 1');
    assert.equal((await names(page)).length, 3);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#point-strip').isHidden(), true);
    assert.equal(await page.locator('#pointer-btn').getAttribute('aria-pressed'), 'true');
    // Point ▸ Click on a surface switches it on too; Done switches it off.
    await choose(page, 'point-surface');
    assert.equal(await page.locator('#point-btn').getAttribute('aria-pressed'), 'true');
    await page.locator('#point-done').click();
    assert.equal(await page.locator('#point-btn').getAttribute('aria-pressed'), 'false');
  });

  test('a line through the centres of the head and a condyle: two steps, its length and direction', async () => {
    const page = await start();
    await capSphere(page, EXAMPLE.head.centre, EXAMPLE.head.radius);
    await capSphere(page, EXAMPLE.condyles[0].centre, EXAMPLE.condyles[0].radius);
    // Sphere 2 (the condyle) is selected: it is the first point, the strip asks for the second.
    await choose(page, 'line-two-points');
    assert.match(await strip(page), /^Line: through two points\s+Step 2 of 2 \(“Sphere 2” taken\)\. Click a point or a sphere \(its centre\)/);
    // Click the head's centre mark in the 3D view.
    await clickAt(page, await onScreen(page, EXAMPLE.head.centre));
    await page.waitForFunction(() => window.__bf.model.selected?.kind === 'line');
    const p = await properties(page);
    assert.equal(p.name, 'Line 1');
    assert.equal(p.rows['Made as'], 'From Sphere 2 (its centre) through Sphere 1 (its centre)');
    const span = EXAMPLE.head.centre.map((v, i) => v - EXAMPLE.condyles[0].centre[i]);
    assert.ok(Math.abs(Number(p.rows['Distance between the points']) - Math.hypot(...span)) < 0.002);
    close(vec(p, 'Direction '), unit(span), 1e-4, 'from the condyle up to the head');
    close(vec(p, 'End 1 '), EXAMPLE.condyles[0].centre, 1e-3, 'starts at the condyle');
    // Flip: same line, the other way.
    await page.locator('#prop-flip-line').click();
    const f = await properties(page);
    close(vec(f, 'Direction '), unit(span).map((v) => -v), 1e-4, 'flipped');
    close(vec(f, 'End 1 '), EXAMPLE.head.centre, 1e-3, 'now starts at the head');
    assert.equal(f.rows['Distance between the points'], p.rows['Distance between the points']);
  });

  test('a line is selected by clicking it in the 3D view, and goes with what it was made from', async () => {
    const page = await start();
    await capSphere(page, EXAMPLE.head.centre, EXAMPLE.head.radius);
    await capSphere(page, EXAMPLE.condyles[0].centre, EXAMPLE.condyles[0].radius);
    await page.locator('#prop-make [data-make="line-two-points"]').click();
    await select(page, 'Sphere 1');
    await page.waitForFunction(() => window.__bf.model.selected?.kind === 'line');
    // Partway along the line, off the mesh's own outline.
    const mid = EXAMPLE.head.centre.map((v, i) => v + 0.3 * (EXAMPLE.condyles[0].centre[i] - v));
    await select(page, 'Example femur');
    await clickAt(page, await onScreen(page, mid));
    assert.equal((await properties(page)).name, 'Line 1');
    // Removing the head's region takes its sphere, and the line made from the sphere.
    await select(page, 'Region 1');
    await page.locator('#prop-remove').click();
    assert.deepEqual(await names(page), ['Example femur', 'Curve 1', 'Curve 2', 'Region 2', 'Sphere 2']);
  });

  test('the centre of the head as a point, drawn through the mesh; the axis of the shaft as a line', async () => {
    const page = await start();
    await capSphere(page, EXAMPLE.head.centre, EXAMPLE.head.radius);
    await page.locator('#prop-make [data-make="point-centre"]').click();
    let p = await properties(page);
    assert.equal(p.rows['Made as'], 'Centre of Sphere 1');
    close(vec(p, ''), EXAMPLE.head.centre, 0.002, 'the head centre');
    // It is inside the head, but a click on it selects it.
    await select(page, 'Example femur');
    await clickAt(page, await onScreen(page, EXAMPLE.head.centre));
    assert.equal((await properties(page)).name, 'Point 1');

    // A band of the shaft from y = 30 to 70, boxed through the surface seen from +Z; a cylinder; its axis.
    await page.locator('#view-menu').click();
    await page.locator('.viewbar [data-view="+z"]').click();
    await page.locator('#box-btn').click();
    await page.locator('#select-through').check();
    const a = await onScreen(page, [EXAMPLE.shaft.point[0] - 9, EXAMPLE.shaft.point[1] + 30, EXAMPLE.shaft.point[2]]);
    const b = await onScreen(page, [EXAMPLE.shaft.point[0] + 9, EXAMPLE.shaft.point[1] + 70, EXAMPLE.shaft.point[2]]);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForFunction(() => window.__bf.model.selected?.kind === 'region');
    await page.locator('#select-done').click();
    await page.locator('#prop-make [data-make="cylinder-fit"]').click();
    await page.locator('#prop-make [data-make="line-axis"]').click();
    p = await properties(page);
    assert.equal(p.rows['Made as'], 'Axis of Cylinder 1');
    close(vec(p, 'Direction ').map(Math.abs), [0, 1, 0], 1e-3, 'up the shaft');
    const length = Number(p.rows['Length (as the cylinder)']);
    // The box takes a little more of the far side of the shaft (in perspective, it looks smaller).
    assert.ok(length > 39 && length < 43, `length ${length}`);
    await select(page, 'Cylinder 1');
    assert.equal(Number((await properties(page)).rows.Length), length, 'as long as the cylinder');
  });

  test('perpendicular to a plane through a point: the distance from the point to the plane', async () => {
    const page = await start();
    await capSphere(page, EXAMPLE.head.centre, EXAMPLE.head.radius);
    await select(page, 'Region 1');
    await page.locator('#prop-make [data-make="plane-fit"]').click();
    await choose(page, 'line-perpendicular');
    assert.match(await strip(page), /Step 2 of 2 \(“Plane 1” taken\)/);
    await select(page, 'Sphere 1');
    await page.waitForFunction(() => window.__bf.model.selected?.kind === 'line');
    const p = await properties(page);
    assert.equal(p.rows['Made as'], 'Perpendicular to Plane 1, through Sphere 1 (its centre)');
    // The cap plane cuts the head about R·cos(cap) out from the centre; its normal points out of the bone.
    const d = Number(p.rows['Distance from the point to the plane']);
    assert.ok(d > 8 && d < 11.5, `distance ${d}`);
    assert.equal(p.rows['Side of the plane'], 'the side away from the normal');
    close(vec(p, 'Direction '), HOME, 0.02, 'along the plane\'s normal, out of the head');
    // And the point where that line meets the plane.
    await choose(page, 'point-line-plane');
    await select(page, 'Plane 1');
    await page.waitForFunction(() => window.__bf.model.selected?.kind === 'point');
    const q = await properties(page);
    assert.equal(q.rows['Made as'], 'Where Line 1 meets Plane 1');
    close(vec(q, ''), EXAMPLE.head.centre.map((v, i) => v + d * HOME[i]), 0.25, 'on the plane, straight out from the centre');
  });
});

describe('measuring and coordinate systems', () => {
  const unit = (v) => v.map((x) => x / Math.hypot(...v));
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const HOME = unit([0.45, 0.35, 1]);
  const E1 = unit(cross(HOME, [0, 1, 0]));
  const E2 = cross(HOME, E1);
  const onBall = (c, R, angle, t) => {
    const a = (angle * Math.PI) / 180;
    return c.map((v, i) => v + R * (Math.cos(a) * HOME[i] + Math.sin(a) * (Math.cos(t) * E1[i] + Math.sin(t) * E2[i])));
  };
  const loop = (c, R, angle, n = 8) => Array.from({ length: n }, (_, k) => onBall(c, R, angle, (2 * Math.PI * k) / n));
  const select = (page, name) => page.locator(`#tree .tree-name[title="${name}"]`).click();
  const value = (page, name) => page.locator(`#tree .tree-name[title="${name}"] .count`).innerText();
  const vec = (p, label) => ['x', 'y', 'z'].map((a) => Number(p.rows[`${label}${a}`]));
  const close = (a, b, tol, msg) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) <= tol, `${msg} [${i}] ${v} ≉ ${b[i]}`));

  async function capSphere(page, c, R) {
    await page.locator('#curve-btn').click();
    for (const p of loop(c, R, 35)) await clickAt(page, await onScreen(page, p));
    await page.keyboard.press('c');
    await page.locator('#pointer-btn').click();
    await page.locator('#prop-make [data-make="sphere-fit"]').click();
  }
  // Seen from +Z, a lasso through the surface round a stretch of a bar, then a cylinder fitted to it.
  async function band(page, point, dir, r, t0, t1) {
    const across = [-dir[1], dir[0], 0];
    const corners = [[t0, -r - 0.8], [t1, -r - 0.8], [t1, r + 0.8], [t0, r + 0.8]].map(([t, w]) => point.map((v, i) => v + t * dir[i] + w * across[i]));
    // The tool first: its strip takes a row from the 3D view, which moves everything on screen.
    await page.locator('#lasso-btn').click();
    await page.locator('#select-through').check();
    const screen = [];
    for (const c of corners) screen.push(await onScreen(page, c));
    await page.mouse.move(screen[0].x, screen[0].y);
    await page.mouse.down();
    for (const q of [...screen.slice(1), screen[0]]) await page.mouse.move(q.x, q.y, { steps: 4 });
    await page.mouse.up();
    await page.waitForFunction(() => window.__bf.model.selected?.kind === 'region');
    await page.locator('#select-done').click();
    await page.locator('#prop-make [data-make="cylinder-fit"]').click();
  }

  test('the neck-shaft angle of the example: 55° between the axes as fitted, 125° with the shaft pointing down', async () => {
    const page = await start();
    await page.locator('#view-menu').click();
    await page.locator('.viewbar [data-view="+z"]').click();
    await band(page, EXAMPLE.shaft.point, [0, 1, 0], 7, 30, 70);
    // Clear of the trochanter and the head: in perspective their near sides look larger than their middles.
    await band(page, EXAMPLE.neck.point, EXAMPLE.neck.direction, 5, 8, 16);
    // Cylinder 2 (the neck) is selected: measure the angle to Cylinder 1 (the shaft).
    await page.locator('#prop-measure [data-make="measure-angle"]').click();
    assert.match(await page.locator('#prompt-text').innerText(), /^Measure: angle between lines or planes\s+Step 2 of 2 \(“Cylinder 2” taken\)\./);
    await select(page, 'Cylinder 1');
    await page.waitForFunction(() => window.__bf.model.selected?.kind === 'measure');
    let p = await properties(page);
    assert.equal(p.name, 'Angle 1');
    assert.equal(p.rows.Measures, 'Between Cylinder 2 (its axis) and Cylinder 1 (its axis)');
    assert.ok(Math.abs(parseFloat(p.rows.Angle) - 55) < 0.2, `angle ${p.rows.Angle}`);
    assert.equal(await value(page, 'Angle 1'), p.rows.Angle, 'the value shows in the Objects list');
    // Turn the shaft's axis round: the angle follows.
    await select(page, 'Cylinder 1');
    await page.locator('#prop-flip-fit').click();
    await select(page, 'Angle 1');
    p = await properties(page);
    assert.ok(Math.abs(parseFloat(p.rows.Angle) - EXAMPLE.neckShaftAngle) < 0.2, p.rows.Angle);
    assert.equal(p.rows['Smaller angle'].slice(0, 2), '55');
  });

  test('a distance between the head and a condyle; clicking its line in the 3D view selects it', async () => {
    const page = await start();
    await capSphere(page, EXAMPLE.head.centre, EXAMPLE.head.radius);
    await capSphere(page, EXAMPLE.condyles[0].centre, EXAMPLE.condyles[0].radius);
    await choose(page, 'measure-points');
    await clickAt(page, await onScreen(page, EXAMPLE.head.centre));
    await page.waitForFunction(() => window.__bf.model.selected?.kind === 'measure');
    const p = await properties(page);
    const span = EXAMPLE.head.centre.map((v, i) => v - EXAMPLE.condyles[0].centre[i]);
    assert.equal(p.name, 'Distance 1');
    assert.ok(Math.abs(Number(p.rows.Distance) + 0 - Math.hypot(...span)) < 0.005);
    close([p.rows['Along x'], p.rows['Along y'], p.rows['Along z']].map(Number), span, 0.005, 'from the condyle (selected first) to the head');
    assert.equal(await value(page, 'Distance 1'), p.rows.Distance);
    // Copy numbers: a row for a spreadsheet.
    await select(page, 'Example femur');
    const along = EXAMPLE.head.centre.map((v, i) => v + 0.4 * (EXAMPLE.condyles[0].centre[i] - v));
    await clickAt(page, await onScreen(page, along));
    assert.equal((await properties(page)).name, 'Distance 1');
  });

  test('a coordinate system from three points; which axes its directions give can be changed; a point\'s coordinates in it follow', async () => {
    const page = await start();
    await capSphere(page, EXAMPLE.condyles[0].centre, EXAMPLE.condyles[0].radius);
    await capSphere(page, EXAMPLE.head.centre, EXAMPLE.head.radius);
    const H = Math.hypot(HOME[0], HOME[2]);
    const onShaft = [EXAMPLE.shaft.point[0] + (7 * HOME[0]) / H, EXAMPLE.shaft.point[1] + 50, EXAMPLE.shaft.point[2] + (7 * HOME[2]) / H];
    await page.locator('#point-btn').click();
    await clickAt(page, await onScreen(page, onShaft));
    await page.keyboard.press('Escape');
    // Origin at the condyle, X towards the head, Y leaning towards the point on the shaft.
    await select(page, 'Example femur');
    await choose(page, 'frame-points');
    assert.match(await page.locator('#prompt-text').innerText(), /^Axes: from three points\s+Step 1 of 3/);
    await select(page, 'Sphere 1');
    await select(page, 'Sphere 2');
    await select(page, 'Point 1');
    await page.waitForFunction(() => window.__bf.model.selected?.kind === 'frame');
    const shaftPoint = vec(await (async () => {
      const id = await page.evaluate(() => window.__bf.model.selectedId);
      await select(page, 'Point 1');
      const q = await properties(page);
      await page.evaluate((k) => window.__bf.model.select(k), id);
      return q;
    })(), '');
    let p = await properties(page);
    assert.equal(p.name, 'Axes 1');
    assert.equal(p.rows['Made as'], 'Origin at Sphere 1 (its centre); X towards Sphere 2 (its centre), Y towards Point 1');
    const c0 = EXAMPLE.condyles[0].centre;
    const span = EXAMPLE.head.centre.map((v, i) => v - c0[i]);
    const u = unit(span);
    const toP = shaftPoint.map((v, i) => v - c0[i]);
    const v = unit(toP.map((x, i) => x - toP.reduce((t, w, k) => t + w * u[k], 0) * u[i]));
    close(vec(p, 'Origin '), c0, 0.005, 'at the condyle centre');
    close(vec(p, 'X axis '), u, 2e-4, 'towards the head');
    close(vec(p, 'Y axis '), v, 2e-4, 'squared up towards the shaft point');
    close(vec(p, 'Z axis '), cross(u, v), 2e-4, 'x × y');
    // The head in these axes: straight along X.
    await choose(page, 'measure-coords');
    assert.match(await page.locator('#prompt-text').innerText(), /Step 1 of 2/);
    await select(page, 'Sphere 2');
    await select(page, 'Axes 1');
    await page.waitForFunction(() => window.__bf.model.selected?.kind === 'measure');
    p = await properties(page);
    assert.equal(p.name, 'Coordinates 1');
    assert.equal(p.rows.In, 'Axes 1');
    const d = Math.hypot(...span);
    close([p.rows.x, p.rows.y, p.rows.z].map(Number), [d, 0, 0], 0.005, 'the head along X');
    // The first direction gives Z instead (the second still Y): the coordinates follow.
    await select(page, 'Axes 1');
    await page.locator('#prop-primary').selectOption('z');
    p = await properties(page);
    close(vec(p, 'Z axis '), u, 2e-4, 'now Z towards the head');
    close(vec(p, 'X axis '), cross(v, u), 2e-4, 'y × z');
    // Choosing Y for the first direction swaps it with the second.
    await page.locator('#prop-primary').selectOption('y');
    assert.equal(await page.locator('#prop-secondary').inputValue(), 'z');
    await select(page, 'Coordinates 1');
    p = await properties(page);
    close([p.rows.x, p.rows.y, p.rows.z].map(Number), [0, d, 0], 0.005, 'the head along Y now');
  });
});
