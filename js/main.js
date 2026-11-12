// Wires the page together: the 3D view, picking, the object tree and its
// two panels (Objects, Properties), the menus, the tool rail, and opening files.

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
import { SelectTool } from './select-tool.js';
import { FitEngine } from './fit-engine.js';
import { ConstructionEngine } from './construction-engine.js';
import { PointTool } from './point-tool.js';
import { CommandRunner } from './command-runner.js';
import { MENUS } from './commands.js';
import { setupMenus } from './menus.js';
import { meshFromRegion } from './extract.js';
import { stlBytes, plyBytes } from './mesh-export.js';
import { saveFile, prepareSaving } from './file-io.js';

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
  app.select = new SelectTool({ model, picker, view, viewer, regions: app.regions, ui: app });
  app.constructs = new ConstructionEngine(model);
  app.points = new PointTool({ model, picker, view, constructs: app.constructs });
  app.commands = new CommandRunner({ model, regions: app.regions, fits: app.fits, constructs: app.constructs });
  setupInteraction({
    stage: $('stage'),
    viewer,
    picker,
    view,
    model,
    engine: app.engine,
    regions: app.regions,
    tool: app.tool,
    points: app.points,
    select: app.select,
    commands: app.commands,
    overlay: $('select-overlay'),
  });
  app.select.addEventListener('change', renderSelect);
  // One tool at a time: switching one on switches the others off.
  for (const mode of ['lasso', 'box']) {
    $(`${mode}-btn`).addEventListener('click', () => {
      // The button of a paused tool takes you back to selecting; otherwise it switches the tool on or off.
      const on = app.select.mode !== mode || app.select.paused;
      if (on) {
        app.tool.setActive(false);
        app.points.setActive(false);
      }
      app.select.setMode(on ? mode : null);
    });
  }
  $('select-through').addEventListener('change', (e) => app.select.setThrough(e.target.checked));
  $('select-done').addEventListener('click', () => app.select.setMode(null));
  $('select-turn').addEventListener('click', () => app.select.togglePause());
  app.tool.addEventListener('change', renderTool);
  $('curve-btn').addEventListener('click', () => {
    if (!app.tool.active) {
      app.select.setMode(null);
      app.points.setActive(false);
    }
    app.tool.setActive(!app.tool.active);
  });
  app.points.addEventListener('change', renderPoints);
  $('point-btn').addEventListener('click', () => usePointTool(!app.points.active));
  $('point-done').addEventListener('click', () => app.points.setActive(false));
  $('curve-finish').addEventListener('click', () => app.tool.finish());
  $('curve-close').addEventListener('click', () => app.tool.close());
  $('curve-undo').addEventListener('click', () => app.tool.undo());
  $('curve-cancel').addEventListener('click', () => app.tool.cancel());
  // The Select button: back to the plain mouse (click selects, drag turns the view).
  $('pointer-btn').addEventListener('click', () => {
    app.tool.setActive(false);
    app.points.setActive(false);
    app.select.setMode(null);
  });

  // Making things: the menus (one per kind of object), the "Make from this"
  // buttons in Properties, and the strip that asks for what a command needs.
  setupMenus(document.querySelector('.toolbar'), $('menus'), MENUS, run);
  app.run = run;
  app.commands.addEventListener('change', renderPrompt);
  $('prompt-cancel').addEventListener('click', () => app.commands.cancel());
  // While a command asks for an object, a click on a name in the Objects list
  // offers that object to it (the list has selected it just before this), as
  // a click in the 3D view does (interaction.js).
  $('tree').addEventListener('click', (e) => {
    if (app.commands.active && model.selectedId && e.target.closest('[data-act="select"]')) app.commands.offer(model.selectedId);
  });
  app.properties.render(); // now that there are commands to offer
}
const { tool } = app;

// Run a command (commands.js): made at once from the selected object when
// that suits; otherwise the strip asks for what it needs, or a note says
// what to make first. A loop that is still being drawn is closed first.
function run(id) {
  if (tool.draft && tool.state().canClose) tool.close();
  const r = app.commands.start(id);
  if (r.status === 'nothing') showMessage('note', [r.message]);
  else clearMessage();
  if (r.status === 'asking') {
    // Clicks now pick the object, so the drawing tools step aside.
    tool.setActive(false);
    app.points.setActive(false);
    app.select.setMode(null);
  }
  if (r.status === 'tool' && r.tool === 'point') usePointTool(true);
  return r;
}

// The Point tool on (the others off) or off.
function usePointTool(on) {
  if (on) {
    tool.setActive(false);
    app.select.setMode(null);
  }
  app.points.setActive(on);
}

// The Point button, and its strip over the 3D view.
function renderPoints() {
  const s = app.points.state();
  renderRail();
  $('point-btn').setAttribute('aria-pressed', String(s.active));
  $('stage').classList.toggle('is-placing', s.active);
  if ($('point-strip').hidden === s.active) {
    $('point-strip').hidden = !s.active;
    viewer.resize();
  }
  $('point-hint').textContent = s.hint;
}

function renderPrompt() {
  const s = app.commands.state();
  if ($('prompt-strip').hidden === s.active) {
    $('prompt-strip').hidden = !s.active;
    viewer.resize();
  }
  $('prompt-title').textContent = s.title;
  $('prompt-hint').textContent = s.note ?? s.hint;
  $('stage').classList.toggle('is-picking', s.active);
}

// One thing at a time: choosing a drawing tool ends a command that was asking.
function renderRail() {
  const on = tool.active || app.select.active || app.points.active;
  $('pointer-btn').setAttribute('aria-pressed', String(!on));
  if (on) app.commands.cancel();
}

// The Curve button, and the strip of the tool's own buttons over the 3D view.
function renderTool() {
  const t = tool.state();
  renderRail();
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

// The Lasso and Box buttons, and their strip over the 3D view. While one is
// on, a left-drag draws an outline, so the camera doesn't turn (pan and zoom still work).
function renderSelect() {
  const s = app.select.state();
  renderRail();
  $('lasso-btn').setAttribute('aria-pressed', String(s.mode === 'lasso'));
  $('box-btn').setAttribute('aria-pressed', String(s.mode === 'box'));
  $('stage').classList.toggle('is-selecting', s.drawing);
  viewer.controls.noRotate = s.drawing;
  $('select-turn').setAttribute('aria-pressed', String(s.paused));
  $('select-strip').classList.toggle('is-paused', s.paused);
  if ($('select-strip').hidden === !!s.mode) {
    $('select-strip').hidden = !s.mode;
    viewer.resize();
  }
  $('select-hint').textContent = s.hint;
  $('select-through').checked = s.through;
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
  else if (e.key === 'Escape' && app.commands?.active) app.commands.cancel();
  else if (e.key === 'Escape' && app.points?.active) app.points.setActive(false);
  else if (e.key === 'Escape' && app.select?.active) app.select.togglePause();
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

// ---- New meshes from regions, and saving meshes -----------------------------

app.meshFromRegion = async (regionId) => {
  const region = model.get(regionId);
  const big = (region?.faceCount ?? 0) > 200000;
  if (big) {
    setBusy(`Making a mesh of ${region.faceCount.toLocaleString('en-US')} triangles…`);
    await nextFrame();
  }
  try {
    const node = await meshFromRegion(app, regionId);
    if (node) {
      clearMessage();
      model.select(node.id);
    }
    return node;
  } finally {
    if (big) setBusy(null);
  }
};

const STEM = (s) => String(s).replace(/\.(stl|ply)$/i, '');
app.saveMesh = async (id, format) => {
  const node = model.get(id);
  const source = view.sources.get(id);
  if (!node || !source) return null;
  const filename = `${STEM(node.file || node.name)}.${format}`;
  const data = new Uint8Array(format === 'stl' ? stlBytes(source) : plyBytes(source));
  const description = format === 'stl' ? 'STL mesh' : 'PLY mesh';
  try {
    const r = await saveFile({ filename, data, types: [{ description, accept: { 'application/octet-stream': [`.${format}`] } }] });
    if (r.status !== 'cancelled') showMessage('note', [`Saved “${r.name}”.`]);
    return r;
  } catch (err) {
    showMessage('error', [err.message || 'The mesh could not be saved.']);
    return null;
  }
};
prepareSaving();

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
