// The object tree: everything in the scene and how it hangs together.
// Pure data, no three.js, so it can be tested on its own. scene-view.js
// draws it and tree-panel.js lists it; both listen for `change`.
//
// A node is { id, kind, name, parent, visible, ...fields }.
//
//   kind 'mesh'    a loaded surface. Fields: file, format, sha256, faceCount,
//                  vertexCount, sizeBytes, hasColors, box { min, max }.
//   kind 'group'   a folder under a mesh, e.g. the landmarks of one file.
//   kind 'point'   a point. Fields: position [x, y, z] or null, status,
//                  template_id.
//   kind 'curve'   a curve drawn on a mesh. What was clicked: control_points
//                  [{ position, anchor }], closed, path ('geodesic' or
//                  'euclidean'), as in a landmark file's curve. What was
//                  computed from that (curve-engine.js): line (the path
//                  across the surface), length, centroid, used, warning.
//                  `drawing` is true while it is being drawn.
//   kind 'region'  the triangles of a mesh that closed curves enclose.
//                  What it was made from: boundary (curve ids), flipped
//                  (the other side). What was computed from that
//                  (region-engine.js): faces (the file's face numbers),
//                  faceCount, area, centroid, error.
//   kind 'sphere'  a sphere fitted to a region. What it was made from:
//                  source (the region's id), method. What was computed
//                  (fit-engine.js): centre, radius, rms, maxDeviation,
//                  coverage, faceCount, area, error.
//
// `parent` is the id of the node this one is attached to, or null for the
// top level. Something attached to a mesh is given in that mesh's own file
// coordinates and moves with the mesh; a top-level object that is not a
// mesh is "global" and is given in scene coordinates.
//
// `template_id` is kept on every node (null when there is none): a guiding
// template, when the app gets one, will say which objects to create, and
// this is the link from an object back to the template step it fulfils.

const PREFIX = { mesh: 'm', group: 'g', point: 'p', curve: 'c', region: 'r', sphere: 's' };
const LABEL = { mesh: 'Mesh', group: 'Group', point: 'Point', curve: 'Curve', region: 'Region', sphere: 'Sphere' };

export class SceneModel extends EventTarget {
  constructor() {
    super();
    this.nodes = new Map(); // id -> node, in the order they were added
    this.selectedId = null;
    this._counter = {};
  }

  get(id) {
    return this.nodes.get(id) || null;
  }

  get selected() {
    return this.get(this.selectedId);
  }

  // Nodes attached to `parentId` (null: the top level), in the order added.
  children(parentId = null) {
    return [...this.nodes.values()].filter((n) => n.parent === parentId);
  }

  meshes() {
    return [...this.nodes.values()].filter((n) => n.kind === 'mesh');
  }

  // The mesh a node belongs to (itself for a mesh), or null for a global one.
  meshOf(id) {
    for (let n = this.get(id); n; n = this.get(n.parent)) if (n.kind === 'mesh') return n;
    return null;
  }

  // All nodes under `id`, nearest first.
  descendants(id) {
    const out = [];
    for (const child of this.children(id)) out.push(child, ...this.descendants(child.id));
    return out;
  }

  // Shown only if it and everything above it is switched on.
  isShown(id) {
    for (let n = this.get(id); n; n = this.get(n.parent)) if (!n.visible) return false;
    return this.nodes.has(id);
  }

  add(kind, fields = {}) {
    if (!(kind in PREFIX)) throw new Error(`Unknown kind of object: ${kind}`);
    const parent = fields.parent ?? null;
    if (parent !== null && !this.nodes.has(parent)) throw new Error(`No object ${parent} to attach to`);
    if (kind === 'mesh' && parent !== null) throw new Error('A mesh cannot be attached to another object');
    const n = (this._counter[kind] = (this._counter[kind] || 0) + 1);
    // Without a name of its own, an object is called after its kind: "Curve 2".
    const node = { visible: true, template_id: null, ...fields, id: `${PREFIX[kind]}${n}`, kind, parent };
    if (!node.name) node.name = `${LABEL[kind]} ${n}`;
    this.nodes.set(node.id, node);
    this._changed('add', [node.id]);
    return node;
  }

  // Several nodes at once (a landmark file), announced as one change.
  addMany(list) {
    const ids = [];
    this._quiet = true;
    try {
      for (const [kind, fields] of list) ids.push(this.add(kind, fields).id);
    } finally {
      this._quiet = false;
    }
    this._changed('add', ids);
    return ids.map((id) => this.get(id));
  }

  // Remove a node and everything attached to it. Returns the removed nodes.
  remove(id) {
    const node = this.get(id);
    if (!node) return [];
    const gone = [node, ...this.descendants(id)];
    for (const n of gone) this.nodes.delete(n.id);
    if (gone.some((n) => n.id === this.selectedId)) this.selectedId = null;
    this._changed('remove', gone.map((n) => n.id), gone);
    return gone;
  }

  rename(id, name) {
    const node = this.get(id);
    const clean = String(name).trim();
    if (!node || !clean || clean === node.name) return;
    node.name = clean;
    this._changed('rename', [id]);
  }

  // Change fields of a node (what it is attached to and its kind stay).
  update(id, fields) {
    const node = this.get(id);
    if (!node) return;
    const { id: _id, kind: _kind, parent: _parent, ...rest } = fields;
    Object.assign(node, rest);
    this._changed('update', [id]);
  }

  setVisible(id, visible) {
    const node = this.get(id);
    if (!node || node.visible === !!visible) return;
    node.visible = !!visible;
    this._changed('visible', [id]);
  }

  select(id) {
    const next = id !== null && this.nodes.has(id) ? id : null;
    if (next === this.selectedId) return;
    this.selectedId = next;
    this._changed('select', next ? [next] : []);
  }

  _changed(kind, ids, removed = []) {
    if (this._quiet) return;
    this.dispatchEvent(new CustomEvent('change', { detail: { kind, ids, removed } }));
  }
}
