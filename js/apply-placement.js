// Applying a mesh's placement to its coordinates (asked for by the owner):
// a new mesh whose vertices are where the original now sits in the scene,
// with the work on the original carried over in the new coordinates.
//
// The original is not changed (the ground rule: a mesh's coordinates are
// its file's), only hidden; the new mesh is built as if saved as an STL
// file and opened again, so "Save as STL" gives the file it matches. It
// records what it was made from (`appliedFrom`: the original and the
// placement), so a saved scene can make it again from the original.

import * as THREE from 'three';
import { loadMeshBuffer } from './mesh-loader.js';
import { stlBytes } from './mesh-export.js';
import { meshFields } from './opening.js';
import { matrixElements, place } from './placement.js';
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
