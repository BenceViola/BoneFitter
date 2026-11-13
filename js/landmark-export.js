// Saving a mesh's work as a landmark-json file (the format of Landmarker3D
// and landmarker2D), and opening such a file back with everything.
//
//   landmarks  the landmarks of a landmark file opened on the mesh, and
//              points clicked on it (ad hoc: template_id null)
//   curves     every curve: its clicked points (control_points, with
//              anchors), length and path. No semilandmarks are sampled here
//              ("points" is empty; Landmarker3D samples them when it opens the
//              file). With no template of its own, the file gets one listing
//              the curves, so Landmarker3D shows them.
//   surfaces   every region: boundary = the ids of its curves (null for one
//              drawn with Lasso or Box)
//   extensions.bonefitter
//              the whole scene of this mesh as in a .bonefitter.json
//              (scene-file.js), with `file_ids` giving each object's id in
//              this file, so BoneFitter opens everything again.
//
// Coordinates are the mesh file's own, as the format requires: a mesh's
// placement is in the extension only. Objects made from several meshes are
// not in any mesh's file (only in the scene file).

import { sceneDoc, APP } from './scene-file.js';

export const LMK = { name: 'landmark-json', version: '0.2.0', planesVersion: '0.4.0' };

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const round = (p) => (Array.isArray(p) ? p.map((v) => Math.round(v * 1e6) / 1e6) : p);
const stem = (s) => String(s).replace(/\.(stl|ply)$/i, '');

export function landmarkDoc(model, meshId, { created = null } = {}) {
  const mesh = model.get(meshId);
  const under = [...model.nodes.values()].filter((n) => n.kind !== 'mesh' && !n.drawing && model.meshOf(n.id)?.id === meshId);
  const group = under.find((n) => n.kind === 'group') ?? null;
  // The template of a landmark file opened on this mesh is kept as it is;
  // otherwise the file gets a small one of its own, listing the curves.
  const own = !group?.template;
  const template = own
    ? { id: 'bonefitter', name: 'BoneFitter (no template)', version: '1', dimensions: 3, landmarks: [], curves: [] }
    : clone(group.template);
  const taken = new Set([...(template.landmarks ?? []), ...(template.curves ?? []), ...(template.planes ?? [])].map((d) => d?.id));
  const nextId = (prefix) => {
    for (let i = 1; ; i++) {
      const id = `${prefix}${String(i).padStart(2, '0')}`;
      if (!taken.has(id)) {
        taken.add(id);
        return id;
      }
    }
  };
  const fileIds = {};

  const landmarks = [];
  for (const p of under.filter((n) => n.kind === 'point' && !n.method)) {
    const id = p.code && !landmarks.some((l) => l.id === p.code) ? p.code : nextId('LM');
    taken.add(id);
    fileIds[p.id] = id;
    landmarks.push({
      id,
      template_id: p.template_id ?? null,
      label: p.name,
      status: p.status ?? 'placed',
      position: p.status === 'missing' ? null : round(p.position),
      ...(p.note ? { note: p.note } : {}),
    });
  }
  for (const p of under.filter((n) => n.kind === 'point' && n.method === 'surface')) {
    const id = nextId('P');
    fileIds[p.id] = id;
    landmarks.push({ id, template_id: null, label: p.name, status: 'placed', position: round(p.position), ...(p.anchor ? { anchor: clone(p.anchor) } : {}) });
  }

  const curves = [];
  for (const c of under.filter((n) => n.kind === 'curve')) {
    const id = nextId('C');
    fileIds[c.id] = id;
    if (own) template.curves.push({ id, name: c.name, closed: !!c.closed, path: c.path ?? 'geodesic' });
    curves.push({
      id,
      template_id: own ? id : null,
      label: c.name,
      status: 'placed',
      closed: !!c.closed,
      control_points: c.control_points.map((cp) => ({ position: round(cp.position), ...(cp.anchor ? { anchor: clone(cp.anchor) } : {}) })),
      points: [],
      length: c.length ?? 0,
      sampling: { path: c.used ?? c.path ?? 'geodesic', spacing: 'equal_arc_length', n_points: 0 },
    });
  }
  // Curve entries of an opened landmark file, which this app doesn't show, are written back as they were.
  if (Array.isArray(group?.rawCurves)) curves.push(...clone(group.rawCurves).filter((c) => !curves.some((x) => x.id === c?.id)));

  const surfaces = [];
  for (const r of under.filter((n) => n.kind === 'region')) {
    const id = nextId('S');
    fileIds[r.id] = id;
    surfaces.push({
      id,
      template_id: null,
      label: r.name,
      status: 'placed',
      boundary: r.selection ? null : r.boundary.map((b) => fileIds[b] ?? null),
      method: r.selection ? 'screen_selection' : 'curve_boundary',
      side: r.flipped ? 'other' : 'inside',
      points: [],
    });
  }
  if (own && !template.curves.length) delete template.curves;

  const now = new Date().toISOString();
  const scene = sceneDoc(model, { meshIds: [meshId], created });
  const doc = {
    format: LMK.name,
    version: template.planes?.length ? LMK.planesVersion : LMK.version,
    specimen: {
      id: group?.specimenId ?? stem(mesh.file || mesh.name),
      mesh: { file: mesh.file, sha256: mesh.sha256, units: 'mm', vertex_count: mesh.vertexCount, face_count: mesh.faceCount },
    },
    template,
    landmarks,
  };
  if (curves.length) doc.curves = curves;
  if (surfaces.length) doc.surfaces = surfaces;
  doc.provenance = { software: APP.name, software_version: APP.version, ...(group?.operator ? { operator: group.operator } : {}), created: created ?? now, modified: now };
  doc.extensions = { bonefitter: { ...scene, file_ids: fileIds } };
  return doc;
}

// The scene kept in a landmark file, with changes made to it since in
// another app (a landmark moved in Landmarker3D, a curve's points changed)
// taken from the file's own entries. Null when the file has none.
export function sceneFromLandmarkDoc(doc) {
  const ext = doc?.extensions?.bonefitter;
  if (!ext || ext.format !== 'bonefitter-scene') return null;
  const scene = clone(ext);
  const ids = scene.file_ids ?? {};
  const byId = (list) => new Map((Array.isArray(list) ? list : []).filter((e) => e && typeof e.id === 'string').map((e) => [e.id, e]));
  const landmarks = byId(doc.landmarks);
  const curves = byId(doc.curves);
  for (const rec of scene.objects) {
    const entry = (rec.kind === 'point' ? landmarks : rec.kind === 'curve' ? curves : null)?.get(ids[rec.id]);
    if (!entry) continue;
    if (rec.kind === 'point') {
      if (entry.status) rec.status = rec.method === 'surface' ? rec.status : entry.status;
      if ('position' in entry) rec.position = entry.position;
      if (entry.anchor) rec.anchor = entry.anchor;
    } else if (Array.isArray(entry.control_points) && entry.control_points.length) {
      rec.control_points = entry.control_points.map((cp) => ({ position: cp.position, anchor: cp.anchor ?? null }));
    }
  }
  return scene;
}
