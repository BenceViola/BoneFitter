# BoneFitter: notes for development

Browser app for fitting geometric primitives (lines, planes, spheres, cylinders) to STL/PLY meshes of bones, to quantify structures such as epiphyses and joint surfaces. Sister app of Landmarker3D and landmarker2D: same stack, same look, opened from GitHub Pages, nothing installed, no data leaves the computer. The owner is a morphometrician, not a web developer: explain changes in plain terms.

**State (v0.3):** meshes and landmark files open into an object tree; curves can be drawn on a mesh (open or closed, following the surface); closed curves can be turned into regions (the triangles they enclose). Nothing is fitted, constructed, measured, moved or saved yet. Next: the first fit (see Build order).

## Ground rules (do not break these)

- **The source geometry is never moved, centred, scaled or re-indexed.** A mesh's position in the scene belongs to its scene object (a `THREE.Group`), never to its vertices. What is attached to a mesh is stored in the mesh file's own coordinates.
- **Face order is the file's order.** The BVH is built with `indirect: true` so it never reorders triangles. Vertex merging for smooth shading happens only on a separate display copy (`displayGeometry` in `viewer.js`). `tests/unit/picking.test.js` and `scene-view.test.js` guard this.
- **Triangle meshes only.** PLY files with quads or polygons are refused, not triangulated. Point clouds are refused.
- **The object tree is the scene graph.** `SceneModel` (pure data) says what exists and what is attached to what; `SceneView` nests the three.js objects the same way. Never keep a second idea of "what belongs to which mesh".
- **Every node carries `template_id`** (null when there is none). See Templates below.
- **Plain JavaScript, ES modules, no build step.** Dependencies load from jsDelivr through the import map in `index.html` at pinned versions. `package.json` pins the same versions for the tests; change both together. Keep them the same as Landmarker3D's.
- **Shared code is copied, not linked.** `docs/from-landmarker3d.md` lists what came from Landmarker3D, from which commit, and how it was changed. Update it when more is brought over.
- **`js/curves.js` and `js/geodesic.js` (and their tests) are Landmarker3D's files, unchanged.** Keep them identical so a fix in one app can be copied to the other; what BoneFitter needs differently goes in `js/curve-engine.js`.

## Code map

| File | Role |
|---|---|
| `index.html` | Page, styles (colour tokens, light and dark), import map |
| `js/main.js` | Wiring: viewer, panels, toolbar and tool buttons, keyboard, drag and drop, messages |
| `js/interaction.js` | Mouse and touch in the 3D view: click to select (or to the tool in use), dragging a curve's handle |
| `js/scene-model.js` | The object tree: nodes (`mesh`, `group`, `point`, `curve`, `region`), attaching, hiding, removing, updating, selecting. No three.js |
| `js/scene-view.js` | Draws the tree: one three.js object per node, nested as in the tree; markers, curve lines and handles, region tints; what is under the cursor (`pointAt`, `curveAt`, `handleAt`, `regionAt`); the box the camera frames |
| `js/viewer.js` | three.js scene, camera, lights, framing; `displayGeometry` (the drawn copy of a mesh) |
| `js/picking.js` | BVH raycasting over several meshes; hits in the mesh file's coordinates wherever the mesh is |
| `js/mesh-loader.js` | STL/PLY reading, raw counts, SHA-256, triangle-only checks |
| `js/landmark-file.js` | Reading `.lmk.json` (landmarks and the template; not curves yet) |
| `js/opening.js` | Opening files into the tree: meshes, then landmark files matched to them by SHA-256 |
| `js/tree-panel.js` | Objects list (left) |
| `js/properties-panel.js` | Properties of the selected object; `describe()` is the pure part |
| `js/curves.js`, `js/geodesic.js` | Landmarker3D's curve maths and shortest paths across a surface, unchanged. Pure maths, no three.js |
| `js/curve-engine.js` | Computes a curve node on its mesh: path across the surface, length, centroid. One corner table per mesh, built on first use; cached stretches |
| `js/region.js` | Which triangles closed curves enclose: a fence along triangle edges following each curve, spreading over the surface, choosing the part. Pure maths on the corner table, no three.js |
| `js/region-engine.js` | Regions as tree objects: made from closed curves, recomputed when a boundary curve changes, removed with their last boundary |
| `js/curve-tool.js` | The Curve tool as a state machine (`click`, `finish`, `close`, `undo`, `cancel`); no page or mouse, so it is unit-tested |
| `js/sample.js` | The example mesh shown at start: a toy femur of exact shapes, with its true measurements in `EXAMPLE` |

All changes to the tree go through `SceneModel`, which fires a `change` event (`{ kind, ids, removed }`, kinds `add`, `remove`, `rename`, `visible`, `update`, `select`) that the 3D view and both panels listen to. `window.__bf` exposes the app for the browser tests.

A curve node holds what was clicked (`control_points` with the triangle each is on, `closed`, `path`) in the same form as a curve entry of a landmark file, plus what was computed from that (`line`, `length`, `centroid`, `used`, `warning`). Change a curve only through `CurveEngine.set()` or `refresh()`, so the computed part never goes stale. A curve being drawn is a real node from its first point (`drawing: true`).

A region node holds what it was made from (`boundary`: curve ids, `flipped`) and what was computed from that (`faces`: the file's face numbers in rising order, `faceCount`, `area`, `centroid`, `error`). Change a region only through `RegionEngine` (`create`, `set`, `addBoundary`, `refresh`). The region engine listens to the tree, so moving a curve's point recomputes its regions; because it reacts inside the curve's `update` event, later listeners see the region's `update` before the curve's.

This is the pattern for everything that depends on something else (curve → region → fitted primitive): the dependent stores the ids it was made from, an engine recomputes it when those change, and the computed fields are never edited directly.

`tests/scene-helpers.js` builds the model, picker, view, engines and tool on a fake 100 × 100 px canvas, so anything short of real pixels can be unit-tested.

## Tests

`npm test` (unit, ~1 s) and `npm run test:e2e` (headless Chromium, ~1 min). Both run in CI on every push. Work test-first: write the failing test, then the code. The browser tests catch what unit tests can't. Test meshes are generated in `tests/fixtures.js`.

`EXAMPLE` in `js/sample.js` gives the true centre, radius and axis of every part of the example mesh (and its neck-shaft angle, 125°). Use it as the yardstick for fitting and measuring: a sphere fitted to the head must return `EXAMPLE.head`.

## Deployment

GitHub Pages is published by `.github/workflows/pages.yml` after the Tests workflow passes on `main`. The repository's Pages source must be "GitHub Actions" (Settings → Pages). The version in the page header (`v0.3`) shows which version is live; raise it with each feature that goes live.

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
- **Regions are defined by curves drawn on the mesh**, reusing Landmarker3D's curves, so there is a record of exactly what was selected. Curves are objects in their own right that can be operated on: a plane fitted to one, its centroid, and so on.
- **Templates come later but are not dropped** (see below).

## Proposed, not yet decided

Raised in the design discussion; check with the owner before building on any of these.

- A Properties panel under the tree for the selected object's parameters (built in v0.1 for meshes and points), with a toggle between mesh and scene coordinates once meshes can be moved.
- Cutting triangles along the curve, if a region edge that follows triangle edges (within about one triangle of the curve) proves too coarse on real scans.
- Taking a single boundary off a region (for now: remove that curve, or the region).
- "Fit, drop faces beyond a tolerance, fit again" to make a fit less dependent on exactly where the boundary was drawn. Painting or lasso only as a fallback.
- Operations on curves: a plane or a circle fitted to a curve, the area and centroid of the region it encloses. These use the computed path at even spacing, never the clicked points.
- The chain curve → region → fitted primitive, each remembering what it was made from, so moving one clicked point updates everything after it.
- Curves saved in landmark-json's existing `curves` form (with `n_points` optional), so a margin traced in Landmarker3D opens here as a boundary and a template can ask for it by id.
- Fitting details: area-weighted fits; a geometric (not algebraic) sphere fit with coverage reported, because shallow joint surfaces constrain the radius poorly; a cylinder's starting axis from the surface normals; an outlier-resistant option.
- Results per fit: RMS and maximum deviation, coverage, number of faces, a deviation map on the mesh.
- A **support plane** (touches the mesh at three points, everything else on one side) as the "standing on a table" plane, distinct from a least-squares plane.
- A **coordinate frame** object (origin and three axes built from primitives); orienting a mesh means aligning its frame with the scene's axes.
- Measurements as tree nodes, including angles projected onto a reference plane (torsion, version).
- A stored sign for plane normals and line directions, with a flip button.
- Saving: a fitted primitive stores both its input (region, method) and its result, like curves in landmark-json; probably a `primitives` section in that format.

## How regions work (built in v0.3 as proposed to the owner)

- A region is made from the selected closed curve with the Region button and hangs under the curve's mesh. It corresponds to the landmark format's reserved `surfaces` entry with `boundary` = curve ids.
- One curve: the smaller of the two parts it divides the surface into is the inside. "Use the other side" (`flipped`) takes everything else; the choice is stored.
- Several curves (up to 8): the region is the part of the surface that touches all of them, such as the ring between an outer and an inner loop (an articular surface minus the fovea) or the band between two rings (a shaft segment).
- No region, with the reason shown in Properties and a mark in the tree, when a curve crosses itself, does not divide the surface (a ring round a handle, a surface with holes), is no bigger than a few triangles, or jumps between separate pieces of the mesh.
- Removing a boundary curve takes it off its regions; a region left without a boundary is removed with it.
- While a curve's point is dragged, its regions follow at once on meshes up to 200,000 triangles and wait for the end of the drag on larger ones.

## Build order (agreed)

1. Curves on the mesh: done in v0.2.
2. Closed curves into regions, shown as a tint on the mesh with area and triangle count: done in v0.3.
3. The first fit: a sphere on a region of the example's head, checked against `EXAMPLE.head`.

## Templates (kept for later)

The owner wants templates in this app eventually: a template that walks a student through selecting features, fitting the primitives and exporting. What is already in place for that:

- `landmark-file.js` reads the template of a landmark file whole, and `opening.js` keeps it on the folder node (`template`).
- Every node has `template_id`; imported landmarks carry theirs.

A BoneFitter template would list steps (select a region, fit a primitive, construct one from others, measure) the way a landmark template lists landmarks, with stable ids, names and instructions. Landmarker3D's `session.js` (template checks, the "to do / placed / missing" states, walking to the next item) and `template-editor.js` are the reference to adapt.

## Not done yet

- Fitting, constructing, measuring, moving meshes, saving and exporting.
- On a finished curve: adding or removing single points, opening or closing it again, and choosing straight (`euclidean`) paths. The engine supports all of these; there are no buttons for them yet.
- Undo and redo.
- Opening the curves of a landmark file (read past with a note).
- A limit or warning strategy for very large scenes beyond the current note at 3 million triangles. Landmarker3D unloads meshes it isn't showing; here every mesh in the scene stays loaded.
