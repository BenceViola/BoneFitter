// Reading Landmark JSON files (.lmk.json), the format the landmarking apps
// save: one file per specimen, with the template and every placed landmark
// in the mesh file's own coordinates.
//
// Adapted from Landmarker3D's js/landmark-file.js. This app only reads
// landmark files (their points become objects attached to the mesh), so the
// writing half is left out. The template is read and kept as it is, so a
// later version can use it to guide the work.

// The newest format version this reader knows; newer minor versions are read with a note.
export const FORMAT = { name: 'landmark-json', readVersion: '0.4.0' };

const STATUSES = new Set(['placed', 'estimated', 'missing']);
const clone = (o) => JSON.parse(JSON.stringify(o));

export class LandmarkFileError extends Error {}

// Is this file's name that of a landmark file?
export const isLandmarkFileName = (name) => /\.json$/i.test(name);

// Parse and check a landmark file. Throws LandmarkFileError with a message
// for the user; returns non-fatal problems in `warnings`.
export function parseLandmarkFile(text, name) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new LandmarkFileError(`“${name}” isn’t valid JSON, so it can’t be a landmark file.`);
  }
  if (!doc || typeof doc !== 'object' || doc.format !== FORMAT.name) {
    throw new LandmarkFileError(`“${name}” is a JSON file, but not a landmark file (its "format" isn’t "landmark-json").`);
  }

  const warnings = [];
  const m = /^(\d+)\.(\d+)/.exec(String(doc.version || ''));
  if (!m) throw new LandmarkFileError(`“${name}” has no readable format version.`);
  const [ourMajor, ourMinor] = FORMAT.readVersion.split('.').map(Number);
  const major = Number(m[1]);
  const minor = Number(m[2]);
  if (major !== ourMajor) {
    throw new LandmarkFileError(
      `“${name}” uses format version ${doc.version}, which this app (format ${FORMAT.readVersion}) can’t read safely.`
    );
  }
  if (minor > ourMinor) {
    warnings.push(`It uses a newer format version (${doc.version}); only what this app knows is read.`);
  }

  if (doc.specimen?.image) {
    throw new LandmarkFileError(`“${name}” holds 2D landmarks on an image. This app works with 3D meshes only.`);
  }
  if (!doc.specimen?.mesh) {
    throw new LandmarkFileError(`“${name}” doesn’t say which mesh it belongs to (no "specimen.mesh").`);
  }

  const t = doc.template;
  if (!t || !Array.isArray(t.landmarks)) {
    if (t?.ref) {
      throw new LandmarkFileError(
        `“${name}” refers to a separate template file (${t.ref}) instead of including the template. Opening such files isn’t supported yet.`
      );
    }
    throw new LandmarkFileError(`“${name}” has no template.`);
  }
  const dims = t.dimensions ?? 3;
  if (dims !== 3) {
    throw new LandmarkFileError(`The template in “${name}” is for ${dims === 2 ? '2D images' : 'something other than 3D meshes'}. This app works with 3D meshes only.`);
  }
  const defs = new Map();
  for (const d of t.landmarks) {
    if (!d || typeof d.id !== 'string' || !d.id || defs.has(d.id)) {
      throw new LandmarkFileError(`The template in “${name}” has a landmark with a missing or repeated ID.`);
    }
    if (typeof d.name !== 'string' || !d.name) d.name = d.id;
    defs.set(d.id, d);
  }

  const points = [];
  const seen = new Set();
  let skipped = 0;
  for (const p of Array.isArray(doc.landmarks) ? doc.landmarks : []) {
    if (!p || typeof p.id !== 'string' || !p.id || seen.has(p.id) || !STATUSES.has(p.status)) {
      skipped++;
      continue;
    }
    const pt = clone(p);
    if (pt.status === 'missing') {
      pt.position = null;
    } else if (!(Array.isArray(pt.position) && pt.position.length === 3 && pt.position.every(Number.isFinite))) {
      skipped++;
      continue;
    }
    if (pt.template_id === undefined) pt.template_id = defs.has(pt.id) ? pt.id : null;
    if (pt.template_id !== null && !defs.has(pt.template_id)) pt.template_id = null; // an ad hoc point
    // The name shown: the point's own label, else the template's name for it.
    pt.name = pt.label || defs.get(pt.template_id)?.name || pt.id;
    seen.add(pt.id);
    points.push(pt);
  }
  if (skipped) warnings.push(`${skipped} landmark entr${skipped === 1 ? 'y was' : 'ies were'} unreadable and left out.`);
  const curves = Array.isArray(doc.curves) ? doc.curves.length : 0;
  if (curves) warnings.push(`Its ${curves === 1 ? 'curve is' : `${curves} curves are`} not shown: this app reads landmarks only for now.`);

  return { doc, specimen: doc.specimen, template: clone(t), points, warnings, name };
}

// Do this file and this mesh belong together? `fileMesh` is the file's
// specimen.mesh; `mesh` has { file, sha256, faceCount }.
export function meshMatches(fileMesh, mesh) {
  if (!fileMesh || !mesh) return false;
  if (fileMesh.sha256 && mesh.sha256) return fileMesh.sha256.toLowerCase() === mesh.sha256.toLowerCase();
  return fileMesh.file === mesh.file && fileMesh.face_count === mesh.faceCount;
}
