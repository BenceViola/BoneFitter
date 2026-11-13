// Runs a command from commands.js: takes what is selected when that suits,
// otherwise asks for each input in turn ("click a region…") until the object
// can be made.
//
//   start(id)     begin a command. { status: 'done', node } when it was made
//                 at once; 'asking' when it now waits for a pick; 'nothing'
//                 (with a message) when nothing in the scene could be used.
//   offer(nodeId) the object the person picked, in the 3D view or the list
//   cancel()      stop asking
//
// No page and no mouse, so it is unit-tested; main.js shows `state()` in the
// strip above the 3D view. Fires `change` when its state changes.

import { COMMANDS, INPUTS } from './commands.js';

const KIND_WORDS = { mesh: 'a mesh', group: 'a landmark file', point: 'a point', line: 'a line', frame: 'a coordinate system', measure: 'a measurement', orient: 'an orientation', curve: 'a curve', region: 'a region', sphere: 'a sphere', cylinder: 'a cylinder', plane: 'a plane' };

export class CommandRunner extends EventTarget {
  constructor({ model, regions, fits, constructs }) {
    super();
    this.ctx = { model, regions, fits, constructs };
    this.model = model;
    this.command = null; // the command that is asking, or null
    this.picked = []; // the inputs given so far
    this.note = null;
    // An input that is removed while the rest are asked for ends the command.
    model.addEventListener('change', (e) => {
      if (this.command && e.detail.kind === 'remove' && this.picked.some((n) => !model.get(n.id))) this.cancel();
    });
  }

  get active() {
    return this.command !== null;
  }

  // The input being asked for.
  get _input() {
    return this.command ? INPUTS[this.command.inputs[this.picked.length]] : null;
  }

  _accepts(input, node) {
    return node ? input.accepts(this.ctx, node) : false;
  }

  // The first input that the scene has too few objects for (two points
  // for a line need two different points), or null.
  _missing(command) {
    const all = [...this.model.nodes.values()];
    const needed = {};
    for (const kind of command.inputs) needed[kind] = (needed[kind] ?? 0) + 1;
    return command.inputs.find((kind) => all.filter((n) => INPUTS[kind].accepts(this.ctx, n) === true).length < needed[kind]) ?? null;
  }

  // The commands that can start from this object, and be finished with what
  // is in the scene: the "Make from this" and "Measure from this" buttons.
  available(node) {
    if (!node) return [];
    return Object.values(COMMANDS).filter((c) => {
      if (!c.inputs.length || this._missing(c)) return false;
      // Where a closed curve could stand for its region, the plane is the one through the curve itself.
      if (c.id === 'plane-fit' && node.kind === 'curve') return false;
      return this._accepts(INPUTS[c.inputs[0]], node) === true;
    });
  }

  start(id) {
    const command = COMMANDS[id];
    if (!command) return { status: 'unknown' };
    // A command that is a tool of the rail: main.js switches it on.
    if (command.tool) {
      this.cancel();
      return { status: 'tool', tool: command.tool };
    }
    const was = this.active;
    // Anything the command needs that nothing in the scene could give: say what to make first, don't ask.
    // (The first input, when missing, is dealt with below, where the selection can say why it won't do.)
    const missing = this._missing(command);
    if (missing && missing !== command.inputs[0]) {
      if (was) this.cancel();
      return { status: 'nothing', message: INPUTS[missing].none };
    }
    this.command = command;
    this.picked = [];
    this.note = null;
    // What is selected is the first input, when it suits.
    const selected = this.model.selected;
    const verdict = this._accepts(this._input, selected);
    if (verdict === true) return this._take(selected);
    // Nothing to pick from: say what to make first, don't ask.
    const any = [...this.model.nodes.values()].some((n) => this._input.accepts(this.ctx, n) === true);
    if (!any) {
      const message = typeof verdict === 'string' ? verdict : this._input.none;
      this.command = null;
      if (was) this._changed();
      return { status: 'nothing', message };
    }
    if (typeof verdict === 'string') this.note = `${verdict} Click ${this._input.ask}.`;
    this._changed();
    return { status: 'asking' };
  }

  // Of the things under a click, the one to select: the first that suits the
  // input being asked for, else the first (so the prompt can say why not).
  prefer(ids) {
    if (this.active) {
      const good = ids.find((id) => !this.picked.some((n) => n.id === id) && this._accepts(this._input, this.model.get(id)) === true);
      if (good) return good;
    }
    return ids[0] ?? null;
  }

  offer(nodeId) {
    if (!this.active) return { status: 'off' };
    const node = this.model.get(nodeId);
    if (!node) return { status: 'rejected' };
    if (this.picked.some((n) => n.id === nodeId)) {
      this.note = `That is “${node.name}” again. Click ${this._input.ask}, a different one.`;
      this._changed();
      return { status: 'rejected' };
    }
    const verdict = this._accepts(this._input, node);
    if (verdict === true) return this._take(node);
    const why = typeof verdict === 'string' ? verdict : `“${node.name}” is ${KIND_WORDS[node.kind] ?? 'something else'}.`;
    this.note = `${why} Click ${this._input.ask}.`;
    this._changed();
    return { status: 'rejected' };
  }

  cancel() {
    if (!this.active) return;
    this.command = null;
    this.picked = [];
    this.note = null;
    this._changed();
  }

  // Take an input; with the last one, make the object and select it.
  _take(node) {
    this.picked.push(node);
    this.note = null;
    if (this.picked.length < this.command.inputs.length) {
      this._changed();
      return { status: 'asking' };
    }
    const { command, picked } = this;
    this.command = null;
    this.picked = [];
    const made = command.run(this.ctx, picked);
    this._changed();
    if (!made) return { status: 'failed' };
    this.model.select(made.id);
    return { status: 'done', node: made };
  }

  state() {
    const c = this.command;
    if (!c) return { active: false, command: null, title: '', hint: '', note: null, step: 0, of: 0 };
    const of = c.inputs.length;
    const step = this.picked.length + 1;
    const hint = `Click ${this._input.ask}, in the 3D view or in the Objects list. Esc cancels.`;
    const so = this.picked.length ? ` (${this.picked.map((n) => `“${n.name}”`).join(', ')} taken)` : '';
    return { active: true, command: c.id, title: c.heading, hint: of > 1 ? `Step ${step} of ${of}${so}. ${hint}` : hint, note: this.note, step, of };
  }

  _changed() {
    this.dispatchEvent(new CustomEvent('change', { detail: this.state() }));
  }
}
