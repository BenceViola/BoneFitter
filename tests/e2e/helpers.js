// Browser test harness: serves the app from disk, swaps the CDN copies of
// three.js for the locally installed ones, and writes test files to upload.
// Adapted from Landmarker3D's tests/e2e/helpers.js.

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { binaryStl, asciiPly, SQUARE_VERTS, landmarkFile } from '../fixtures.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };

export async function startServer() {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    try {
      // Files are served exactly as GitHub Pages serves them: as they are on disk.
      const body = await readFile(join(ROOT, path === '/' ? 'index.html' : path));
      res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}

const LOCAL = {
  'https://cdn.jsdelivr.net/npm/three@0.170.0/': join(ROOT, 'node_modules/three/'),
  'https://cdn.jsdelivr.net/npm/three-mesh-bvh@0.8.3/': join(ROOT, 'node_modules/three-mesh-bvh/'),
};

// Playwright's own Chromium, or the browser named in CHROME_PATH (for
// machines where Playwright's download isn't available).
export async function launch() {
  const path = process.env.CHROME_PATH;
  return chromium.launch(path ? { executablePath: path } : {});
}

// A fresh page with the app loaded and the example on screen.
// `init` is a script run in the page before the app starts.
export async function openApp(browser, url, { width = 1280, height = 800, init = null } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, acceptDownloads: true });
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });

  await page.route('https://cdn.jsdelivr.net/**', async (route) => {
    const u = route.request().url();
    const prefix = Object.keys(LOCAL).find((p) => u.startsWith(p));
    if (!prefix) return route.abort();
    const body = await readFile(LOCAL[prefix] + u.slice(prefix.length));
    return route.fulfill({ body, contentType: 'text/javascript' });
  });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ body: '', contentType: 'text/css' }));

  await page.goto(url);
  await ready(page);
  return { page, context, errors };
}

// Wait until the app has started and nothing is being read.
export async function ready(page) {
  await page.waitForFunction(
    () => document.documentElement.dataset.ready === 'true' && document.getElementById('busy').hidden,
    null,
    { timeout: 30000 }
  );
  await page.waitForTimeout(100); // one more frame so the camera has settled
}

// A click as a person makes it: press and release on the same spot.
export async function clickAt(page, { x, y }) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
}

// Choose a way of making something from the menus above the 3D view:
// 'sphere-fit' is Sphere ▸ Fit to a region.
export async function choose(page, command) {
  await page.locator(`#${command.split('-')[0]}-menu`).click();
  await page.locator(`#menus [data-command="${command}"]`).click();
}

// Where a point of the scene is on the page.
export async function onScreen(page, point) {
  return page.evaluate((p) => window.__bf.viewer.toClient(p), point);
}

// Choose files in the "Open…" dialog and wait until they are in.
export async function openFiles(page, paths) {
  await page.setInputFiles('#file-input', paths);
  await page.waitForFunction(() => document.getElementById('busy').hidden);
  await page.waitForTimeout(150);
}

export async function messageText(page) {
  const el = page.locator('#message');
  await el.waitFor({ state: 'visible', timeout: 10000 });
  return el.innerText();
}

// The object list as shown: [{ id, name, depth, selected, shown, count }].
export async function treeRows(page) {
  return page.$$eval('#tree li', (items) =>
    items.map((li) => {
      const row = li.querySelector(':scope > .tree-row');
      return {
        id: li.dataset.id,
        name: row.querySelector('.label').textContent,
        kind: row.dataset.kind,
        depth: Number(row.style.getPropertyValue('--depth')),
        selected: row.classList.contains('is-selected'),
        shown: row.querySelector('.eye').getAttribute('aria-pressed') === 'true',
        count: row.querySelector('.count')?.textContent ?? null,
      };
    })
  );
}

// The Properties panel as shown: { name, kind, rows: { label: value } }.
export async function properties(page) {
  return page.evaluate(() => {
    const el = document.getElementById('properties');
    const name = el.querySelector('#prop-name');
    if (!name) return null;
    const rows = {};
    for (const dt of el.querySelectorAll('dt')) rows[dt.textContent] = dt.nextElementSibling.textContent;
    return { name: name.value, kind: el.querySelector('.props-kind').textContent, rows };
  });
}

// Meshes and landmark files written to a temp folder for upload.
export async function makeFiles() {
  const dir = await mkdtemp(join(tmpdir(), 'bonefitter-e2e-'));
  const write = async (name, data) => {
    const p = join(dir, name);
    await writeFile(p, typeof data === 'string' ? data : Buffer.from(data));
    return p;
  };
  const ball = (radius, x) => {
    const g = new THREE.SphereGeometry(radius, 48, 32).toNonIndexed();
    g.translate(x, 0, 0);
    return binaryStl(g);
  };

  // Two balls side by side: A (radius 20) around x = 0, B (radius 12) around x = 60.
  const a = ball(20, 0);
  const b = ball(12, 60);
  const facts = (name, buf) => ({
    file: name,
    sha256: createHash('sha256').update(Buffer.from(buf)).digest('hex'),
    faceCount: (buf.byteLength - 84) / 50,
    vertexCount: ((buf.byteLength - 84) / 50) * 3,
  });
  // Landmarks on ball A: one at the point facing +Z, one estimated, one missing.
  const doc = landmarkFile(facts('BALL_A.stl', a));
  doc.landmarks[0].position = [0, 0, 20];
  doc.landmarks[1].position = [20, 0, 0];

  return {
    dir,
    ballA: await write('BALL_A.stl', a),
    ballB: await write('BALL_B.stl', b),
    lmkA: await write('BALL_A.lmk.json', JSON.stringify(doc)),
    lmkElsewhere: await write('OTHER.lmk.json', JSON.stringify(landmarkFile({ file: 'OTHER.ply', sha256: 'ab'.repeat(32), faceCount: 2, vertexCount: 4 }))),
    quad: await write('quad.ply', asciiPly(SQUARE_VERTS, [[0, 1, 2, 3]])),
    text: await write('notes.txt', 'hello'),
  };
}
