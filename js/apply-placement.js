// Applying a mesh's placement to its coordinates (asked for by the owner),
// in two ways:
//
//   applyPlacement         a new mesh whose vertices are where the original
//                          now sits, with the work on it carried over; the
//                          original is kept, hidden (`appliedFrom`)
//   applyPlacementInPlace  the mesh itself gets the new vertices; everything
//                          on it keeps its id and is moved and worked out
//                          again; the mesh records the file it came from and
//                          the whole move (`appliedInPlace`)
//
// Either way the new vertices are built as if saved as an STL file and
// opened again, so "Save as STL" gives the file the mesh matches, and a
// saved scene can make the mesh again from the original file.

import * as THREE from 'three';
import { loadMeshBuffer } from './mesh-loader.js';
import { stlBytes } from './mesh-export.js';
import { meshFields } from './opening.js';
import { matrixElements, place, compose } from './placement.js';
import { sceneDoc, restoreScene } from './scene-file.js';

const stem = (s) => String(s).replace(/\.(stl|ply)$/i, '');
const clone = (v) => JSON.parse(JSON.stringify(v));

// A copy of a geometry with every vertex placed (normals turned with it).
export function placedGeometry(source, placement) {
  return source.clone().applyMatrix4(new THREE.Matrix4().fromArray(matrixElements(placement)));
}

// An object's stored record with its clicked coordinates placed: what was
// clicked on the original is at the same spot of the new mesh. Everything
// else is computed again from these.
function placedRecord(rec, pl) {
  const out = clone(rec);
  if (rec.kind === 'point' && Array.isArray(rec.position) && !rec.inputs) out.position = place(pl, rec.position);
  if (rec.kind === 'curve') out.control_points = rec.control_points.map((c) => ({ ...c, position: place(pl, c.position) }));
  delete out.result;
  return out;
}

// The placed vertices, as a mesh read back from an STL file.
export async function placedMesh(source, placement, file) {
  return loadMeshBuffer(stlBytes(placedGeometry(source, placement)), file);
}

// The mesh `meshId` given the vertices of `loaded` (same faces, same order).
export function swapGeometry(app, meshId, loaded, fields) {
  app.view.replaceGeometry(meshId, loaded.geometry);
  app.engine?.forget(meshId);
  const { name, ...facts } = meshFields(loaded);
  app.model.update(meshId, { ...facts, format: 'placement applied', placement: null, ...fields });
}

/**
 * Apply mesh `meshId`'s placement to its own vertices. `app` as below.
 * Resolves to the mesh node (the same one), or null when it hasn't been moved.
 */
export async function applyPlacementInPlace(app, meshId) {
  const { model } = app;
  const mesh = model.get(meshId);
  const pl = mesh?.placement;
  if (mesh?.kind !== 'mesh' || !pl) return null;
  const before = mesh.appliedInPlace;
  const loaded = await placedMesh(app.view.sources.get(meshId), pl, `${stem(before ? before.file : mesh.file || mesh.name)}-oriented.stl`);
  const under = [...model.nodes.values()].filter((n) => n.id !== meshId && model.meshOf(n.id)?.id === meshId);
  // Its orientation has done its job (it would move the mesh again).
  for (const o of under.filter((n) => n.kind === 'orient')) model.remove(o.id);
  swapGeometry(app, meshId, loaded, {
    appliedInPlace: { file: before ? before.file : mesh.file, sha256: before ? before.sha256 : mesh.sha256, placement: before ? compose(pl, before.placement) : clone(pl) },
  });
  // What was clicked on it moves with it; everything else is worked out again, in the order it was made.
  for (const n of under) {
    if (!model.get(n.id)) continue;
    if (n.kind === 'point' && Array.isArray(n.position) && !n.inputs) model.update(n.id, { position: place(pl, n.position) });
    if (n.kind === 'curve') app.engine.set(n.id, { control_points: n.control_points.map((c) => ({ ...c, position: place(pl, c.position) })) });
  }
  for (const n of under) {
    if (!model.get(n.id)) continue;
    if (n.kind === 'region') app.regions.refresh(n.id);
    else if (n.inputs) app.constructs.refresh(n.id);
    else if (['sphere', 'cylinder', 'plane'].includes(n.kind)) app.fits.refresh(n.id);
  }
  return model.get(meshId);
}

/**
 * Make the new mesh from mesh `meshId` and carry its work over. `app` gives
 * { model, view, engine, regions, fits, constructs }. Resolves to the new
 * mesh node, or null when the mesh hasn't been moved.
 */
export async function applyPlacement(app, meshId) {
  const { model, view } = app;
  const mesh = model.get(meshId);
  const pl = mesh?.placement;
  if (mesh?.kind !== 'mesh' || !pl) return null;
  const file = `${stem(mesh.file || mesh.name)}-oriented.stl`;
  const loaded = await loadMeshBuffer(stlBytes(placedGeometry(view.sources.get(meshId), pl)), file);
  const node = model.add(
    'mesh',
    meshFields(loaded, {
      name: `${mesh.name} (oriented)`,
      format: 'placement applied',
      appliedFrom: { mesh: mesh.name, meshId, placement: clone(pl) },
      ...(mesh.example ? { example: true } : {}),
    })
  );
  view.addMesh(node, loaded.geometry);
  // The work on the original, moved to the new coordinates. The orientation
  // stays with the original: the new mesh needs none.
  const doc = sceneDoc(model, { meshIds: [meshId] });
  doc.objects = doc.objects.filter((o) => o.kind !== 'orient').map((o) => placedRecord(o, pl));
  await restoreScene(app, doc, null, { meshMap: { [meshId]: node.id } });
  model.setVisible(meshId, false);
  return node;
}
