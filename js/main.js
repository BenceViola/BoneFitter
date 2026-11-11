// Wires the page together: the 3D view, picking, the object tree and its
// two panels (Objects, Properties), the toolbar, and opening files.

import { Viewer } from './viewer.js';
import { Picker } from './picking.js';
import { SceneModel } from './scene-model.js';
import { SceneView } from './scene-view.js';
import { setupTree } from './tree-panel.js';
import { setupProperties } from './properties-panel.js';
import { openFiles, meshFields } from './opening.js';
import { loadMeshBuffer } from './mesh-loader.js';
import { makeExampleStl, EXAMPLE } from './sample.js';

const $ = (id) => document.getElementById(id);
const CLICK_SLOP = 5; // px: a press that moves further is a rotation, not a click
const CLICK_TIME = 600; // ms

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
app.properties = setupProperties($('properties'), { model, copyText });
model.addEventListener('change', renderStage);

function renderStage() {
  const meshes = model.meshes();
  $('stage-empty').hidden = meshes.length > 0 || !webgl;
  $('space-note').textContent = meshes.length
    ? `${meshes.length} ${meshes.length === 1 ? 'mesh' : 'meshes'} · coordinates as in each mesh file`
    : '';
}

// ---- Selecting in the 3D view ---------------------------------------------

if (webgl) {
  const canvas = viewer.renderer.domElement;
  let press = null;
  canvas.addEventListener('pointerdown', (e) => {
    press = e.isPrimary && (e.pointerType !== 'mouse' || e.button === 0)
      ? { id: e.pointerId, x: e.clientX, y: e.clientY, time: performance.now() }
      : null;
  });
  window.addEventListener('pointerup', (e) => {
    if (!press || e.pointerId !== press.id) return;
    const p = press;
    press = null;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > CLICK_SLOP) return;
    if (performance.now() - p.time > CLICK_TIME) return;
    // A point marker wins over the surface it sits on; empty space selects nothing.
    model.select(view.pointAt(e.clientX, e.clientY) ?? picker.pickAt(e.clientX, e.clientY)?.id ?? null);
  });
  window.addEventListener('pointercancel', () => (press = null));
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
});

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
