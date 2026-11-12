// The Point tool: while it is on, a click on a mesh places a point there
// (attached to that mesh, in its file's coordinates) and a click on a point
// selects it. No mouse handling here (interaction.js passes the clicks on),
// so it is unit-tested. Fires `change` when it is switched on or off or
// places a point.

export class PointTool extends EventTarget {
  constructor({ model, picker, view, constructs }) {
    super();
    Object.assign(this, { model, picker, view, constructs });
    this.active = false;
  }

  setActive(on) {
    if (this.active === !!on) return;
    this.active = !!on;
    this._changed();
  }

  // A click at a screen position. Returns { status: 'placed', node },
  // { status: 'selected', id } or { status: 'missed' }.
  click(clientX, clientY) {
    if (!this.active) return { status: 'off' };
    const id = this.view.pointAt(clientX, clientY);
    if (id) {
      this.model.select(id);
      return { status: 'selected', id };
    }
    const hit = this.picker.pickAt(clientX, clientY);
    if (!hit) return { status: 'missed' };
    const node = this.constructs.placePoint(hit);
    this.model.select(node.id);
    this._changed();
    return { status: 'placed', node };
  }

  state() {
    return {
      active: this.active,
      hint: 'Click on a mesh to place a point; click a point to select it. Esc or Done when finished.',
    };
  }

  _changed() {
    this.dispatchEvent(new CustomEvent('change', { detail: this.state() }));
  }
}
