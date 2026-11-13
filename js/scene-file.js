// Saving and reopening a whole scene (.bonefitter.json): every mesh (by its
// SHA-256, with its placement) and every object, with what it was made from
// (its inputs) and what was computed (its result, for anyone reading the
// file). On reopening, the meshes are matched by SHA-256 and everything is
// computed again from its inputs, so the file never has to be trusted for
// results.
//
// Coordinates are the mesh files' own, as in landmark-json; a mesh's
// placement says where it sat in the scene. Objects made from several
// meshes (top level) are in scene coordinates.
//
// The same records go into landmark-json files under extensions.bonefitter
// (landmark-export.js), one mesh each.

import { loadMeshBuffer } from './mesh-loader.js';
import { regionGeometry, stlBytes } from './mesh-export.js';
import { meshFields } from './opening.js';
import { FIT_KINDS } from './fit-engine.js';
import { isConstructed } from './construction-engine.js';

export const SCENE_FORMAT = { name: 'bonefitter-scene', version: '0.1.0' };
export const APP = { name: 'BoneFitter', version: '0.12' };

export class SceneFileError extends Error {}

// What each kind of object is made from: written to the file and read back.
// Everything else on the node is computed (written as `result`, not read).
const INPUTS = {
  group: ['file', 'specimenId', 'templateName', 'template', 'operator', 'rawCurves'],
  point: ['code', 'status', 'position', 'note', 'method', 'anchor', 'inputs'],
  curve: ['control_points', 'closed', 'path'],
  region: ['boundary', 'flipped', 'selection', 'picked', 'strokes'],
  sphere: ['source', 'method', 'flipped'],
  cylinder: ['source', 'method', 'flipped'],
  plane: ['source', 'method', 'flipped'],
  line: ['method', 'inputs', 'flipped'],
  frame: ['method', 'inputs', 'primary', 'secondary'],
  measure: ['method', 'inputs'],
  orient: ['method', 'inputs', 'axis'],
};
const META = new Set(['id', 'kind', 'name', 'parent', 'visible', 'template_id']);
// Computed, but too big to be worth writing: the path of a curve, a region's face list.
const BIG = new Set(['line', 'faces', 'drawing']);

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// ---- Writing --------------------------------------------------------------

export function meshRecord(model, mesh) {
  const rec = {
    id: mesh.id,
    name: mesh.name,
    file: mesh.file,
    sha256: mesh.sha256,
    face_count: mesh.faceCount,
    vertex_count: mesh.vertexCount,
    units: 'mm',
    visible: mesh.visible,
    placement: clone(mesh.placement ?? null),
  };
  if (mesh.example) rec.example = true;
  if (mesh.coordsFile) rec.coords_file = mesh.coordsFile;
  if (mesh.madeFrom) rec.made_from = clone(mesh.madeFrom);
  return rec;
}

export function objectRecord(node) {
  const rec = { id: node.id, kind: node.kind, name: node.name, parent: node.parent, visible: node.visible, template_id: node.template_id ?? null };
  const inputs = INPUTS[node.kind] ?? [];
  for (const k of inputs) if (node[k] !== undefined) rec[k] = clone(node[k]);
  const result = {};
  for (const [k, v] of Object.entries(node)) {
    if (META.has(k) || inputs.includes(k) || BIG.has(k) || v === undefined) continue;
    result[k] = clone(v);
  }
  if (Object.keys(result).length) rec.result = result;
  return rec;
}

// The scene as a document. `meshIds`: only these meshes and what hangs under
// them (default: everything, objects made from several meshes included).
export function sceneDoc(model, { meshIds = null, created = null } = {}) {
  const meshes = model.meshes().filter((m) => !meshIds || meshIds.includes(m.id));
  const keep = (n) => (meshIds ? meshIds.includes(model.meshOf(n.id)?.id) : true);
  // Creation order: everything comes after what it was made from.
  const objects = [...model.nodes.values()].filter((n) => n.kind !== 'mesh' && !n.drawing && keep(n)).map(objectRecord);
  const now = new Date().toISOString();
  return {
    format: SCENE_FORMAT.name,
    version: SCENE_FORMAT.version,
    provenance: { software: APP.name, software_version: APP.version, created: created ?? now, modified: now },
    meshes: meshes.map((m) => meshRecord(model, m)),
    objects,
  };
}

// Pretty JSON, with short number arrays kept on one line.
export function stringify(doc) {
  return (
    JSON.stringify(doc, null, 2).replace(/\[\s+(-?[\d.eE+-]+(?:,\s+-?[\d.eE+-]+)*)\s+\]/g, (_, inner) => `[${inner.split(/,\s+/).join(', ')}]`) + '\n'
  );
}

// ---- Reading --------------------------------------------------------------

export const isSceneDoc = (doc) => doc?.format === SCENE_FORMAT.name;

export function checkSceneDoc(doc, name) {
  if (!isSceneDoc(doc)) throw new SceneFileError(`“${name}” is not a BoneFitter scene.`);

  const major = Number(/^(\d+)\./.exec(String(doc.version || ''))?.[1]);
  if (major !== Number(SCENE_FORMAT.version.split('.')[0])) {
    throw new SceneFileError(`“${name}” is a BoneFitter scene of format version ${doc.version}, which this version can't read.`);
  }
  if (!Array.isArray(doc.meshes) || !Array.isArray(doc.objects)) throw new SceneFileError(`“${name}” has no list of meshes or objects.`);
}

/**
 * Put a scene document back. `app` gives { model, view, engine, regions,
 * fits, constructs } and optionally loadExample() (resolves to the example's
 * mesh node). The meshes must be open already (matched by SHA-256); a mesh
 * made from a region is made again from its original if its own file isn't
 * open. Throws SceneFileError naming the mesh files that are missing.
 * Returns { meshes, objects, ids } (ids: old id → new id).
 */
export async function restoreScene(app, doc, name = null) {
  const { model, view } = app;
  checkSceneDoc(doc, name ?? 'the scene');
  const what = name ? `“${name}”` : 'The scene';
  const ids = new Map();
  const used = new Set();
  const missing = [];
  const free = (sha) => model.meshes().find((m) => m.sha256 === sha && !used.has(m.id));

  // Meshes first: those opened from files, then those made from regions of them.
  for (const rec of doc.meshes) {
    let mesh = free(rec.sha256);
    if (!mesh && rec.example && app.loadExample) mesh = await app.loadExample();
    if (!mesh && rec.made_from?.faces && ids.has(rec.made_from.meshId)) {
      const original = model.get(ids.get(rec.made_from.meshId));
      const source = view.sources.get(original.id);
      const loaded = await loadMeshBuffer(stlBytes(regionGeometry(source, rec.made_from.faces)), rec.file);
      if (loaded.sha256 === rec.sha256) {
        mesh = model.add('mesh', meshFields(loaded, { format: 'made from a region', coordsFile: rec.coords_file ?? original.file, madeFrom: clone(rec.made_from), ...(original.example ? { example: true } : {}) }));
        view.addMesh(mesh, loaded.geometry);
      }
    }
    if (!mesh) {
      // A mesh made from a region of a missing mesh comes back with its original: name only the original.
      if (!(rec.made_from?.faces && doc.meshes.some((m) => m.id === rec.made_from.meshId))) missing.push(rec.file || rec.name);
      continue;
    }
    used.add(mesh.id);
    ids.set(rec.id, mesh.id);
  }
  if (missing.length) {
    const list = missing.map((f) => `“${f}”`).join(', ');
    throw new SceneFileError(
      `${what} needs ${missing.length === 1 ? 'the mesh' : 'these meshes'} ${list}, which ${missing.length === 1 ? 'isn’t' : 'aren’t'} open. Open ${missing.length === 1 ? 'it' : 'them'} together with the scene file (select or drop them all at once).`
    );
  }
  for (const rec of doc.meshes) {
    model.update(ids.get(rec.id), { name: rec.name, placement: clone(rec.placement ?? null) });
    if (rec.visible === false) model.setVisible?.(ids.get(rec.id), false);
  }

  // Objects in the order they were made, each computed again from its inputs.
  const map = (id) => (id == null ? id : ids.get(id) ?? null);
  let count = 0;
  for (const rec of doc.objects) {
    const inputs = INPUTS[rec.kind];
    if (!inputs) continue;
    const parent = map(rec.parent);
    if (rec.parent != null && parent == null) continue; // its parent wasn't restored
    const fields = { name: rec.name, visible: rec.visible !== false, template_id: rec.template_id ?? null, parent };
    for (const k of inputs) if (rec[k] !== undefined) fields[k] = clone(rec[k]);
    if (fields.inputs) fields.inputs = fields.inputs.map(map);
    if (fields.boundary) fields.boundary = fields.boundary.map(map);
    if (fields.source) fields.source = map(fields.source);
    if ([fields.inputs, fields.boundary].some((l) => l?.some((x) => x == null)) || (rec.source && !fields.source)) continue;
    // Results are taken as written until computed again (a landmark has nothing to compute).
    const node = model.add(rec.kind, { ...clone(rec.result ?? {}), ...fields });
    ids.set(rec.id, node.id);
    count++;
    if (rec.kind === 'curve') app.engine.refresh(node.id);
    else if (rec.kind === 'region') app.regions.refresh(node.id);
    else if (FIT_KINDS.has(rec.kind)) app.fits.refresh(node.id);
    else if (isConstructed(node)) app.constructs.refresh(node.id);
  }
  return { meshes: doc.meshes.length, objects: count, ids };
}
