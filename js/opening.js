// Opening files: meshes (STL, PLY) become mesh objects; landmark files
// (.lmk.json) become a folder of points attached to the mesh they were
// placed on. Meshes are read first, so a mesh and its landmark file can be
// opened or dropped together.

import { loadMeshBuffer, MeshLoadError } from './mesh-loader.js';
import { meshArea } from './mesh-export.js';
import { parseLandmarkFile, meshMatches, isLandmarkFileName, LandmarkFileError } from './landmark-file.js';

// Above this many triangles in total, the view may get slow on a laptop.
export const MANY_TRIANGLES = 3_000_000;

// The mesh node fields for a loaded mesh (the result of loadMeshBuffer).
export function meshFields(mesh, extra = {}) {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const { min, max } = mesh.geometry.boundingBox;
  return {
    name: mesh.name,
    file: mesh.name,
    format: mesh.format,
    sha256: mesh.sha256,
    faceCount: mesh.faceCount,
    vertexCount: mesh.vertexCount,
    sizeBytes: mesh.sizeBytes,
    hasColors: mesh.hasColors,
    area: Math.round(meshArea(mesh.geometry) * 1e6) / 1e6,
    box: { min: min.toArray(), max: max.toArray() },
    ...extra,
  };
}

// The nodes for a parsed landmark file, attached to mesh node `meshId`:
// one folder, then its points. In the form SceneModel.addMany takes, except
// that the points' parent (the folder) is only known once the folder exists,
// so this returns { group, points } and addLandmarks() below puts them in.
export function landmarkNodes(parsed, meshId) {
  const stem = parsed.name.replace(/\.lmk\.json$|\.json$/i, '');
  const group = {
    parent: meshId,
    name: stem,
    file: parsed.name,
    specimenId: parsed.specimen?.id ?? null,
    templateName: parsed.template?.name || parsed.template?.id || null,
    template: parsed.template, // kept whole: a guiding template will build on it
    operator: parsed.doc.provenance?.operator ?? null,
  };
  const points = parsed.points.map((p) => ({
    name: p.name,
    code: p.id,
    status: p.status,
    position: p.position,
    template_id: p.template_id,
    note: p.note ?? null,
  }));
  return { group, points };
}

export function addLandmarks(model, parsed, meshId) {
  const { group, points } = landmarkNodes(parsed, meshId);
  const folder = model.add('group', group);
  model.addMany(points.map((p) => ['point', { ...p, parent: folder.id }]));
  return folder;
}

/**
 * Open the chosen or dropped files. `app` gives { model, view, setBusy,
 * nextFrame }. Returns { opened, errors, notes } for the caller to report.
 */
export async function openFiles(app, files) {
  const { model, view } = app;
  const list = [...files];
  const meshFiles = list.filter((f) => /\.(stl|ply)$/i.test(f.name));
  const lmkFiles = list.filter((f) => isLandmarkFileName(f.name));
  const errors = [];
  const notes = [];
  let opened = 0;

  for (const f of list) {
    if (!meshFiles.includes(f) && !lmkFiles.includes(f)) {
      errors.push(`“${f.name}” is not an STL or PLY mesh or a landmark file (.lmk.json).`);
    }
  }

  for (const f of meshFiles) {
    app.setBusy(`Reading ${f.name}…`);
    await app.nextFrame();
    try {
      const mesh = await loadMeshBuffer(await f.arrayBuffer(), f.name);
      const twin = model.meshes().find((n) => !n.example && n.sha256 && n.sha256 === mesh.sha256);
      if (twin) {
        notes.push(`“${f.name}” is already open${twin.file === f.name ? '' : ` (as ${twin.file})`}.`);
        continue;
      }
      // The example makes way for the first real mesh.
      if (!opened) for (const n of model.meshes().filter((m) => m.example)) model.remove(n.id);
      const node = model.add('mesh', meshFields(mesh));
      view.addMesh(node, mesh.geometry);
      opened++;
    } catch (err) {
      if (!(err instanceof MeshLoadError)) console.error(err);
      errors.push(err instanceof MeshLoadError ? err.message : `“${f.name}” could not be read.`);
    }
  }

  for (const f of lmkFiles) {
    try {
      const parsed = parseLandmarkFile(await f.text(), f.name);
      const mesh = model.meshes().find((n) => meshMatches(parsed.specimen.mesh, n));
      if (!mesh) {
        const want = parsed.specimen.mesh.file ? `“${parsed.specimen.mesh.file}”` : 'its mesh';
        errors.push(`The landmarks in “${f.name}” were placed on ${want}, which isn’t open. Open that mesh first, then this file again.`);
        continue;
      }
      addLandmarks(model, parsed, mesh.id);
      opened++;
      for (const w of parsed.warnings) notes.push(`${f.name}: ${w}`);
    } catch (err) {
      if (!(err instanceof LandmarkFileError)) console.error(err);
      errors.push(err instanceof LandmarkFileError ? err.message : `“${f.name}” could not be read.`);
    }
  }

  const triangles = model.meshes().reduce((s, n) => s + n.faceCount, 0);
  if (meshFiles.length && triangles > MANY_TRIANGLES) {
    notes.push(`The open meshes have ${triangles.toLocaleString('en-US')} triangles together. If the view gets slow, remove the ones you don’t need.`);
  }
  app.setBusy(null);
  return { opened, errors, notes };
}
