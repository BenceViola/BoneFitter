// The Lasso and Box tools: select a region by drawing on the screen.
//
//   drag            a new region of the faces inside the outline
//   Shift + drag    add them to the selected region (made with these tools)
//   Alt + drag      take them out of it
//
// With "visible surface only" (the default) only faces you can see are
// selected; otherwise everything inside the outline, through the bone.
//
// The region is made on the mesh of the selected object, or on the only
// mesh shown. No mouse here: `apply(shape, mode)` takes the outline in
// normalised screen coordinates, so the tool can be tested on its own;
// interaction.js turns a drag into a shape. Fires `change` when its state changes.

import * as THREE from 'three';
import { facesInShape, combineFaces } from './selection.js';
import { BIG_MESH } from './curve-engine.js';

const HINTS = {
  lasso: 'Drag round the part to select. Shift adds to the selected region, Alt takes away. Right-drag pans, scroll zooms; Esc leaves the tool to turn the view.',
  box: 'Drag a box over the part to select. Shift adds to the selected region, Alt takes away. Right-drag pans, scroll zooms; Esc leaves the tool to turn the view.',
};
const PROBLEMS = {
  'which-mesh': 'Several meshes are shown. Select the mesh to select on (or something on it) first.',
  'no-mesh': 'There is no mesh shown to select on.',
  empty: 'Nothing of the mesh was inside the outline.',
  'not-selection': 'Alt takes away from a region made with Lasso or Box. Select one first.',
};

const r4 = (n) => Math.round(n * 1e4) / 1e4;

export class SelectTool extends EventTarget {
  constructor({ model, picker, view, viewer, regions, ui }) {
    super();
    Object.assign(this, { model, picker, view, viewer, regions, ui });
    this.mode = null; // 'lasso', 'box' or null
    this.through = false; // select through the surface, not only what is visible
    this.note = null;
  }

  get active() {
    return this.mode !== null;
  }

  setMode(mode) {
    const next = mode === 'lasso' || mode === 'box' ? mode : null;
    if (next === this.mode) return;
    this.mode = next;
    this.note = null;
    this._changed();
  }

  setThrough(on) {
    this.through = !!on;
    this._changed();
  }

  state() {
    return { mode: this.mode, through: this.through, hint: PROBLEMS[this.note] ?? HINTS[this.mode] ?? '' };
  }

  // The mesh to select on, and the region to change (for add and remove).
  target(combine) {
    const sel = this.model.selected;
    const isSelection = sel?.kind === 'region' && sel.selection;
    if (combine !== 'new' && isSelection && this.model.isShown(sel.parent)) return { mesh: this.model.get(sel.parent), region: sel };
    if (combine === 'remove') return { error: 'not-selection' };
    const shown = this.model.meshes().filter((m) => this.model.isShown(m.id));
    const own = sel ? this.model.meshOf(sel.id) : null;
    if (own && this.model.isShown(own.id)) return { mesh: own };
    if (shown.length === 1) return { mesh: shown[0] };
    return { error: shown.length ? 'which-mesh' : 'no-mesh' };
  }

  /**
   * Select with an outline. `shape` is { type: 'lasso', points } or
   * { type: 'box', min, max } in normalised screen coordinates; `combine` is
   * 'new', 'add' or 'remove'. Returns { done: 'new' | 'add' | 'remove', region }
   * or { error }.
   */
  async apply(shape, combine = 'new') {
    const t = this.target(combine);
    if (t.error) return this._fail(t.error);
    const { mesh, region } = t;
    const geometry = this.view.sources.get(mesh.id);
    const camera = this.viewer.camera;
    camera.updateMatrixWorld(true);
    const group = this.view.objectOf(mesh.id);
    group.updateWorldMatrix(true, false);
    const toScreen = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(group.matrixWorld);
    const eye = camera.getWorldPosition(new THREE.Vector3());
    const margin = this.viewer.diagonal * 0.001;
    const p = new THREE.Vector3();
    const isVisible = this.through ? null : (x, y, z) => !this.picker.isHidden(p.set(x, y, z), eye, margin);

    const big = mesh.faceCount > BIG_MESH;
    if (big) {
      this.ui.setBusy(`Selecting among ${mesh.faceCount.toLocaleString('en-US')} triangles…`);
      await this.ui.nextFrame();
    }
    let faces;
    try {
      faces = facesInShape(geometry, shape, { toScreen: toScreen.elements, toScene: group.matrixWorld.elements, isVisible });
    } finally {
      if (big) this.ui.setBusy(null);
    }

    const stroke = {
      type: shape.type,
      mode: region ? combine : 'new',
      through: this.through,
      shape: shape.type === 'box' ? { min: shape.min.map(r4), max: shape.max.map(r4) } : { points: shape.points.map((q) => q.map(r4)) },
      camera: {
        position: camera.position.toArray(),
        target: this.viewer.controls?.target.toArray() ?? null,
        up: camera.up.toArray(),
        fov: camera.fov,
        aspect: camera.aspect,
      },
    };
    if (!region) {
      if (!faces.length) return this._fail('empty');
      const node = this.regions.createSelection(mesh.id, faces, stroke);
      this.model.select(node.id);
      this.note = null;
      this._changed();
      return { done: 'new', region: node };
    }
    this.regions.set(region.id, { picked: combineFaces(region.picked, faces, combine), strokes: [...region.strokes, stroke] });
    this.note = null;
    this._changed();
    return { done: combine, region };
  }

  _fail(error) {
    this.note = error;
    this._changed();
    return { error };
  }

  _changed() {
    this.dispatchEvent(new CustomEvent('change', { detail: this.state() }));
  }
}
