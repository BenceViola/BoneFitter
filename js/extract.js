// A new mesh from a region: the region's triangles become a mesh of their
// own, beside the original (which is not changed). It is built exactly as if
// it had been saved as an STL file and opened again, so it has the same
// SHA-256 as the file "Save as STL" writes, and that file is recognised when
// opened later. Its coordinates are the original mesh file's.
//
// The new mesh is a copy: it does not follow later changes to the region.
// What it was made from is kept on it (`madeFrom`) for the record.

import { loadMeshBuffer } from './mesh-loader.js';
import { regionGeometry, stlBytes } from './mesh-export.js';
import { meshFields } from './opening.js';

const slug = (s) => String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'region';
const stem = (s) => String(s).replace(/\.(stl|ply)$/i, '');

/**
 * Make a new mesh from region `regionId`. `app` gives { model, view }.
 * Resolves to the new mesh node, or null when the region encloses nothing.
 */
export async function meshFromRegion(app, regionId) {
  const { model, view } = app;
  const region = model.get(regionId);
  if (region?.kind !== 'region' || region.error || !region.faceCount) return null;
  const mesh = model.get(region.parent);
  const source = view.sources.get(mesh.id);
  const file = `${stem(mesh.file || mesh.name)}-${slug(region.name)}.stl`;
  const loaded = await loadMeshBuffer(stlBytes(regionGeometry(source, region.faces)), file);
  const node = model.add(
    'mesh',
    meshFields(loaded, {
      name: `${region.name} of ${mesh.name}`,
      format: 'made from a region',
      // Coordinates are those of the original file.
      coordsFile: mesh.coordsFile ?? mesh.file,
      madeFrom: { mesh: mesh.name, region: region.name, boundary: region.boundary.map((id) => model.get(id)?.name ?? id), flipped: !!region.flipped },
      // A mesh made from the example goes with the example.
      ...(mesh.example ? { example: true } : {}),
    })
  );
  view.addMesh(node, loaded.geometry);
  return node;
}
