// Wires the page together: the 3D view, picking, the object tree and its
// two panels (Objects, Properties), the toolbar and its tools, and opening files.

import { Viewer } from './viewer.js';
import { Picker } from './picking.js';
import { SceneModel } from './scene-model.js';
import { SceneView } from './scene-view.js';
import { setupTree } from './tree-panel.js';
import { setupProperties } from './properties-panel.js';
import { openFiles, meshFields } from './opening.js';
import { loadMeshBuffer } from './mesh-loader.js';
import { makeExampleStl, EXAMPLE } from './sample.js';
import { CurveEngine } from './curve-engine.js';
import { CurveTool } from './curve-tool.js';
import { setupInteraction } from './interaction.js';
import { RegionEngine } from './region-engine.js';
import { FitEngine } from './fit-engine.js';

const $ = (id) => document.getElementById(id);

const model = new SceneModel();
const app = { model, setBusy, nextFrame, showMessage };

// ---- 3D view -------------------------------------------------------------

let webgl = true;
try {
  app.viewer = new Viewer($('stage'));
  app.picker = new Picker(app.viewer);
  app.view = new SceneView(app.viewer, app.picker, model);
} catch (err) {
  console.error(err);
  webgl = false;
  showMessage('error', ['This browser could not start 3D graphics (WebGL). Try a recent version of Chrome, Edge, Firefox or Safari.']);
}
const { viewer, picker, view } = app;

function applyTheme() {
  const color = getComputedStyle(document.documentElement).getPropertyValue('--viewport').trim();
  if (viewer && color) viewer.setBackground(color);
}
applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

// ---- Panels --------------------------------------------------------------

app.tree = setupTree($('tree'), model);
app.properties = setupProperties($('properties'), { model, copyText, app });
model.addEventListener('change', renderStage);

function renderStage() {
  const meshes = model.meshes();
  $('stage-empty').hidden = meshes.length > 0 || !webgl;
  $('space-note').textContent = meshes.length
    ? `${meshes.length} ${meshes.length === 1 ? 'mesh' : 'meshes'} · coordinates as in each mesh file`
    : '';
}

// ---- Curves, and the mouse in the 3D view -------------------------------------

if (webgl) {
  app.engine = new CurveEngine(model, picker, (id) => view.sources.get(id) || null);
  app.tool = new CurveTool({ model, picker, engine: app.engine, view, ui: app });
  app.regions = new RegionEngine(model, picker, app.engine);
  app.fits = new FitEngine(model, (id) => view.sources.get(id) || null);
  setupInteraction({ stage: $('stage'), viewer, picker, view, model, engine: app.engine, regions: app.regions, tool: app.tool });
  app.tool.addEventListener('change', renderTool);
  $('curve-btn').addEventListener('click', () => app.tool.setActive(!app.tool.active));
  $('curve-finish').addEventListener('click', () => app.tool.finish());
  $('curve-close').addEventListener('click', () => app.tool.close());
  $('curve-undo').addEventListener('click', () => app.tool.undo());
  $('curve-cancel').addEventListener('click', () => app.tool.cancel());
  $('region-btn').addEventListener('click', makeRegion);
  $('sphere-btn').addEventListener('click', fitSphere);
}
const { tool } = app;

// The Region button: a region from the selected closed curve. A loop that is
// still being drawn is closed first.
function makeRegion() {
  if (tool.draft && tool.state().canClose) tool.close();
  const curve = model.selected;
  if (curve?.kind !== 'curve') {
    showMessage('note', ['Select a closed curve first, then press Region. The region is the part of the mesh that the curve encloses.']);
    return;
  }
  const region = app.regions.create(curve.id);
  if (!region) {
    showMessage('note', [`“${curve.name}” is not a closed loop. A region needs a curve that comes back to its first point: draw one and close it with C.`]);
    return;
  }
  clearMessage();
  model.select(region.id);
}

// The Sphere button: fit a sphere to the selected region. With a closed
// curve selected, its region is used, or made first.
function fitSphere() {
  if (tool.draft && tool.state().canClose) tool.close();
  let region = model.selected;
  if (region?.kind === 'curve' && app.regions.canBound(region)) {
    const curve = region;
    region =
      app.regions.regionsOf(curve.id).find((r) => r.boundary.length === 1 && !r.flipped) ?? app.regions.create(curve.id);
  }
  if (region?.kind !== 'region') {
    showMessage('note', ['Select a region (or a closed curve) first, then press Sphere. The sphere is fitted to the part of the mesh the region covers.']);
    return;
  }
  if (region.error) {
    model.select(region.id);
    showMessage('note', [`“${region.name}” encloses nothing at the moment, so there is nothing to fit. Its Properties say why.`]);
    return;
  }
  clearMessage();
  model.select(app.fits.create(region.id).id);
}

// The Curve button, and the strip of the tool's own buttons over the 3D view.
function renderTool() {
  const t = tool.state();
  $('curve-btn').setAttribute('aria-pressed', String(t.active));
  $('stage').classList.toggle('is-drawing', t.active);
  if ($('tool-strip').hidden === t.active) {
    $('tool-strip').hidden = !t.active;
    viewer.resize(); // the strip takes its row from the 3D view
  }
  $('tool-hint').textContent = t.hint;
  $('curve-finish').disabled = !t.canFinish;
  $('curve-close').disabled = !t.canClose;
  $('curve-undo').disabled = t.points === 0;
  $('curve-cancel').disabled = t.points === 0;
}

// ---- Toolbar, keyboard -----------------------------------------------------

for (const btn of document.querySelectorAll('.viewbar [data-view]')) {
  btn.addEventListener('click', () => viewer?.viewFrom(btn.dataset.view));
}
$('fit-btn').addEventListener('click', () => viewer?.fit());

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest?.('input, textarea, select')) return;
  if (e.key === 'f' || e.key === 'F') viewer?.fit();
  else if (e.key === 'h' || e.key === 'H') viewer?.viewFrom('home');
  else if (tool?.active && curveKey(e)) e.preventDefault();
});

// Keys of the Curve tool. Returns true when the key was one of them.
function curveKey(e) {
  if (e.target.closest?.('button') && e.key === 'Enter') return false; // Enter on a button presses that button
  if (e.key === 'Enter') tool.finish();
  else if (e.key === 'c' || e.key === 'C') tool.close();
  else if (e.key === 'Backspace') tool.undo();
  else if (e.key === 'Escape') {
    // First the curve being drawn, then the tool itself.
    if (tool.draft) tool.cancel();
    else tool.setActive(false);
  } else return false;
  return true;
}

// ---- Opening files ---------------------------------------------------------

$('file-input').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = ''; // so the same file can be chosen again
  await open(files);
});

async function open(files) {
  if (!files.length || !webgl) return;
  const wasEmpty = !model.meshes().some((n) => !n.example);
  const { opened, errors, notes } = await openFiles(app, files);
  if (errors.length) showMessage('error', [...errors, ...notes]);
  else if (notes.length) showMessage('note', notes);
  else clearMessage();
  if (opened) {
    if (wasEmpty) viewer.viewFrom('home');
    else viewer.fit();
  }
}

// Dropping files anywhere on the page.
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  $('drop').hidden = false;
});
window.addEventListener('dragover', (e) => {
  if (hasFiles(e)) e.preventDefault();
});
window.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) $('drop').hidden = true;
});
window.addEventListener('drop', async (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  $('drop').hidden = true;
  await open([...e.dataTransfer.files]);
});

// ---- Messages, busy, clipboard ---------------------------------------------

function showMessage(type, lines) {
  const el = $('message');
  el.className = `message ${type}`;
  el.replaceChildren(
    ...lines.map((text) => Object.assign(document.createElement('p'), { textContent: text })),
    Object.assign(document.createElement('button'), { type: 'button', className: 'btn small', textContent: 'OK', onclick: clearMessage })
  );
  el.hidden = false;
}

function clearMessage() {
  $('message').hidden = true;
}

function setBusy(text) {
  $('busy').hidden = !text;
  $('busy-text').textContent = text || '';
}

// Two frames: one for the browser to draw the busy note, one to be sure it is on screen.
function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

async function copyText(text) {
  app.lastCopied = text;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers, or a page that isn't allowed to use the clipboard directly.
    const box = Object.assign(document.createElement('textarea'), { value: text });
    document.body.appendChild(box);
    box.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    box.remove();
    return ok;
  }
}

// ---- Start: show the example ------------------------------------------------

async function start() {
  renderStage();
  if (webgl) {
    setBusy('Preparing the example…');
    await nextFrame();
    const mesh = await loadMeshBuffer(makeExampleStl(), EXAMPLE.file);
    const node = model.add('mesh', meshFields(mesh, { name: 'Example femur', example: true }));
    view.addMesh(node, mesh.geometry);
    viewer.viewFrom('home');
    setBusy(null);
  }
  document.documentElement.dataset.ready = 'true';
}

window.__bf = app; // for the browser tests
start();
