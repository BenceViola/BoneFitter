// End-to-end tests: the real page in headless Chromium, driven with the
// mouse and keyboard. They check what a user would see.

import { test, describe, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  startServer, launch, openApp, clickAt, onScreen, openFiles, messageText, treeRows, properties, makeFiles,
} from './helpers.js';
import { EXAMPLE } from '../../js/sample.js';

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
