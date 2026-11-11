# BoneFitter: notes for development

Browser app for fitting geometric primitives (lines, planes, spheres, cylinders) to STL/PLY meshes of bones, to quantify structures such as epiphyses and joint surfaces. Sister app of Landmarker3D and landmarker2D: same stack, same look, opened from GitHub Pages, nothing installed, no data leaves the computer. The owner is a morphometrician, not a web developer: explain changes in plain terms.

**State (v0.1):** the foundation only. Meshes and landmark files open into an object tree; nothing is fitted, constructed, measured, moved or saved yet.

## Ground rules (do not break these)

- **The source geometry is never moved, centred, scaled or re-indexed.** A mesh's position in the scene belongs to its scene object (a `THREE.Group`), never to its vertices. What is attached to a mesh is stored in the mesh file's own coordinates.
- **Face order is the file's order.** The BVH is built with `indirect: true` so it never reorders triangles. Vertex merging for smooth shading happens only on a separate display copy (`displayGeometry` in `viewer.js`). `tests/unit/picking.test.js` and `scene-view.test.js` guard this.
- **Triangle meshes only.** PLY files with quads or polygons are refused, not triangulated. Point clouds are refused.
- **The object tree is the scene graph.** `SceneModel` (pure data) says what exists and what is attached to what; `SceneView` nests the three.js objects the same way. Never keep a second idea of "what belongs to which mesh".
- **Every node carries `template_id`** (null when there is none). See Templates below.
- **Plain JavaScript, ES modules, no build step.** Dependencies load from jsDelivr through the import map in `index.html` at pinned versions. `package.json` pins the same versions for the tests; change both together. Keep them the same as Landmarker3D's.
- **Shared code is copied, not linked.** `docs/from-landmarker3d.md` lists what came from Landmarker3D, from which commit, and how it was changed. Update it when more is brought over.

## Code map

| File | Role |
|---|---|
| `index.html` | Page, styles (colour tokens, light and dark), import map |
| `js/main.js` | Wiring: viewer, panels, toolbar, keyboard, drag and drop, messages, clicking in the 3D view |
| `js/scene-model.js` | The object tree: nodes (`mesh`, `group`, `point`), attaching, hiding, removing, selecting. No three.js |
| `js/scene-view.js` | Draws the tree: one three.js object per node, nested as in the tree; markers; the box the camera frames |
| `js/viewer.js` | three.js scene, camera, lights, framing; `displayGeometry` (the drawn copy of a mesh) |
| `js/picking.js` | BVH raycasting over several meshes; hits in the mesh file's coordinates wherever the mesh is |
| `js/mesh-loader.js` | STL/PLY reading, raw counts, SHA-256, triangle-only checks |
| `js/landmark-file.js` | Reading `.lmk.json` (landmarks and the template; not curves yet) |
| `js/opening.js` | Opening files into the tree: meshes, then landmark files matched to them by SHA-256 |
| `js/tree-panel.js` | Objects list (left) |
| `js/properties-panel.js` | Properties of the selected object; `describe()` is the pure part |
| `js/sample.js` | The example mesh shown at start: a toy femur of exact shapes, with its true measurements in `EXAMPLE` |

All changes to the tree go through `SceneModel`, which fires a `change` event (`{ kind, ids, removed }`) that the 3D view and both panels listen to. `window.__bf` exposes the app for the browser tests.

## Tests

`npm test` (unit, ~1 s) and `npm run test:e2e` (headless Chromium, ~1 min). Both run in CI on every push. Work test-first: write the failing test, then the code. The browser tests catch what unit tests can't. Test meshes are generated in `tests/fixtures.js`.

`EXAMPLE` in `js/sample.js` gives the true centre, radius and axis of every part of the example mesh (and its neck-shaft angle, 125°). Use it as the yardstick for fitting and measuring: a sphere fitted to the head must return `EXAMPLE.head`.

## Deployment

GitHub Pages is published by `.github/workflows/pages.yml` after the Tests workflow passes on `main`. The repository's Pages source must be "GitHub Actions" (Settings → Pages). The version in the page header (`v0.1`) shows which version is live.

## Writing for the UI

Short, plain sentences from the user's side of the screen. Errors say what went wrong and what to do about it. No jargon a biology student wouldn't know.

## Decided (by the owner)

- Same stack as the landmarking apps: three.js, plain JS, GitHub Pages. A separate repository, not a fork of Landmarker3D.
- Layout: object tree on the left showing all meshes and primitives; on the right a toolbar across the top and the 3D view under it.
- Primitives are lines, planes, spheres and cylinders. A primitive is either **attached to a mesh** (it moves with the mesh) or **global** (in the scene's coordinate system).
- Every parameter of a primitive must be readable and exportable: the points a plane goes through and its normal, the centre and radius of a sphere, and so on.
- Primitives can also be **constructed** from other primitives, especially points, lines and planes.
- Meshes can be moved, mainly to **orient bones**: by an axis (a femur by its shaft axis) or by a plane (a plane under the condyles, as if the bone stood on a table). **No scaling**, or only under very special circumstances.
- A **measuring tool**: distance between two points, angle between a plane and a line, and the like.
- **Templates come later but are not dropped** (see below).

## Proposed, not yet decided

Raised in the design discussion; check with the owner before building on any of these.

- A Properties panel under the tree for the selected object's parameters (built in v0.1 for meshes and points), with a toggle between mesh and scene coordinates once meshes can be moved.
- Choosing the region a primitive is fitted to: painting or lasso, growing from a seed, a patch bounded by a closed curve (the landmark format's reserved `surfaces` slot), and "fit, drop faces beyond a tolerance, fit again".
- Fitting details: area-weighted fits; a geometric (not algebraic) sphere fit with coverage reported, because shallow joint surfaces constrain the radius poorly; a cylinder's starting axis from the surface normals; an outlier-resistant option.
- Results per fit: RMS and maximum deviation, coverage, number of faces, a deviation map on the mesh.
- A **support plane** (touches the mesh at three points, everything else on one side) as the "standing on a table" plane, distinct from a least-squares plane.
- A **coordinate frame** object (origin and three axes built from primitives); orienting a mesh means aligning its frame with the scene's axes.
- Measurements as tree nodes, including angles projected onto a reference plane (torsion, version).
- A stored sign for plane normals and line directions, with a flip button.
- Saving: a fitted primitive stores both its input (region, method) and its result, like curves in landmark-json; probably a `primitives` section in that format.

## Templates (kept for later)

The owner wants templates in this app eventually: a template that walks a student through selecting features, fitting the primitives and exporting. What is already in place for that:

- `landmark-file.js` reads the template of a landmark file whole, and `opening.js` keeps it on the folder node (`template`).
- Every node has `template_id`; imported landmarks carry theirs.

A BoneFitter template would list steps (select a region, fit a primitive, construct one from others, measure) the way a landmark template lists landmarks, with stable ids, names and instructions. Landmarker3D's `session.js` (template checks, the "to do / placed / missing" states, walking to the next item) and `template-editor.js` are the reference to adapt.

## Not done yet

- Fitting, constructing, measuring, moving meshes, saving and exporting: everything beyond the foundation.
- Undo and redo.
- Curves from landmark files (read past with a note).
- A limit or warning strategy for very large scenes beyond the current note at 3 million triangles. Landmarker3D unloads meshes it isn't showing; here every mesh in the scene stays loaded.
