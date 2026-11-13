// The Curve tool: draw a curve on a mesh by clicking points on it.
//
//   click on a mesh        start a curve there / add a point
//   click the first point  close the curve into a loop (three points or more)
//   click the last point   finish the curve as it is
//   Finish, Close loop, Undo point, Cancel: the buttons and keys call the
//   methods of the same names.
//
// The curve being drawn is a real object in the tree from its first point
// (`drawing: true`), so it is listed, drawn and shown in Properties like any
// other; cancelling removes it. A curve belongs to the mesh it was started
// on and stays on it. The tool stays on after a curve is finished, ready
// for the next one.
//
// No page or mouse here: `click(x, y)` takes a screen position, so the tool
// can be tested on its own. It fires `change` when its state changes.

import { BIG_MESH } from './curve-engine.js';

// A click finishes the curve (on its last point) or closes it (on its first)
// only this close to the point on screen, in pixels, however far in the view
// is zoomed; anything further away adds a point.
export const ON_POINT_PX = 6;
// The second click of a double-click on the point just placed is ignored, so
// a double-click adds one point instead of adding it and finishing the curve.
export const DOUBLE_CLICK_MS = 500;

const HINTS = {
  start: 'Click on a mesh to start a curve.',
  one: 'Click to add points.',
  more: 'Click to add points. Enter finishes the curve.',
  loop: 'Enter finishes the curve; C or a click on its first point closes it into a loop.',
  missed: 'That click was beside the mesh. Click on the mesh to add a point.',
  'other-mesh': 'That is another mesh. A curve stays on the mesh it started on.',
  finished: '{name} finished. Click on a mesh to start a new curve.',
  closed: '{name} closed into a loop. Click on a mesh to start a new curve.',
};

export class CurveTool extends EventTarget {
  constructor({ model, picker, engine, view, ui }) {
    super();
    Object.assign(this, { model, picker, engine, view, ui });
    this.active = false;
    this.draftId = null;
    this.note = null; // the last thing that went wrong (or the curve just finished), for the hint
    this.noteName = null;
    this.now = () => Date.now(); // a clock tests can set
    this.lastAdded = null; // { time, index } of the point placed last
    model.addEventListener('change', (e) => {
      if (e.detail.kind === 'remove' && this.draftId && !model.get(this.draftId)) {
        this.draftId = null;
        this._changed();
      }
    });
  }

  // The curve being drawn, or null.
  get draft() {
    return this.model.get(this.draftId);
  }

  // Switching the tool off keeps what was drawn if it is a curve already.
  setActive(on) {
    if (this.active === !!on) return;
    if (!on && this.draft && !this.finish()) this.cancel();
    this.active = !!on;
    this.note = null;
    this._changed();
  }

  // What the page shows: which buttons apply, and what to do next.
  state() {
    const n = this.draft?.control_points.length ?? 0;
    const step = n === 0 ? 'start' : n === 1 ? 'one' : n === 2 ? 'more' : 'loop';
    const hint = (HINTS[this.note] || HINTS[step]).replace('{name}', this.noteName ?? 'The curve');
    return { active: this.active, points: n, canFinish: n >= 2, canClose: n >= 3, hint };
  }

  /**
   * A click at a screen position. Returns what it did: 'started', 'added',
   * 'closed', 'finished', 'missed' (nothing there), 'other-mesh', or
   * 'double' (the second click of a double-click, ignored).
   */
  async click(clientX, clientY) {
    if (!this.active) return 'off';
    const draft = this.draft;
    if (draft) {
      const handle = this.view.handleAt(clientX, clientY, ON_POINT_PX);
      if (handle?.id === draft.id) {
        const n = draft.control_points.length;
        const last = this.lastAdded;
        if (handle.index === n - 1 && last?.index === n - 1 && this.now() - last.time < DOUBLE_CLICK_MS) return 'double';
        const name = draft.name;
        const done = (code, ok) => {
          if (!ok) return 'missed';
          this.note = code;
          this.noteName = name;
          this._changed();
          return code;
        };
        if (handle.index === 0 && n >= 3) return done('closed', this.close());
        if (handle.index === n - 1 && n >= 2) return done('finished', this.finish());
      }
    }
    const hit = this.picker.pickAt(clientX, clientY);
    if (!hit) return this._miss('missed');
    const point = { position: hit.position, anchor: hit.anchor };

    if (!draft) {
      await this._prepare(hit.id);
      const node = this.model.add('curve', { parent: hit.id, path: 'geodesic', closed: false, drawing: true, control_points: [point] });
      this.draftId = node.id;
      this.lastAdded = { time: this.now(), index: 0 };
      this.engine.refresh(node.id);
      this.model.select(node.id);
      this.note = null;
      this._changed();
      return 'started';
    }
    if (hit.id !== draft.parent) return this._miss('other-mesh');
    this.engine.set(draft.id, { control_points: [...draft.control_points, point] });
    this.lastAdded = { time: this.now(), index: draft.control_points.length - 1 };
    this.note = null;
    this._changed();
    return 'added';
  }

  // Take the last point off again; the curve goes with its only point.
  undo() {
    const draft = this.draft;
    if (!draft) return;
    if (draft.control_points.length <= 1) return this.cancel();
    this.engine.set(draft.id, { control_points: draft.control_points.slice(0, -1) });
    this.note = null;
    this._changed();
  }

  // Finish the curve as an open curve. Needs two points.
  finish() {
    return this._done(false, 2);
  }

  // Finish the curve as a loop back to its first point. Needs three points.
  close() {
    return this._done(true, 3);
  }

  // Remove the curve being drawn.
  cancel() {
    const id = this.draftId;
    this.draftId = null;
    this.note = null;
    if (id) this.model.remove(id);
    this._changed();
  }

  _done(closed, need) {
    const draft = this.draft;
    if (!draft || draft.control_points.length < need) return false;
    this.draftId = null;
    this.note = null;
    this.engine.set(draft.id, { closed, drawing: false });
    this.model.select(draft.id);
    this._changed();
    return true;
  }

  _miss(code) {
    this.note = code;
    this._changed();
    return code;
  }

  // The first curve on a mesh has it prepared for paths across the surface.
  async _prepare(meshId) {
    if (this.engine.isReady(meshId)) return;
    const faces = this.model.get(meshId)?.faceCount ?? 0;
    const big = faces > BIG_MESH;
    if (big) {
      this.ui.setBusy(`Preparing ${faces.toLocaleString('en-US')} triangles for curves across the surface…`);
      await this.ui.nextFrame();
    }
    try {
      this.engine.prepare(meshId);
    } finally {
      if (big) this.ui.setBusy(null);
    }
  }

  _changed() {
    this.dispatchEvent(new CustomEvent('change', { detail: this.state() }));
  }
}
