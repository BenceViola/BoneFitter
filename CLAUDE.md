# BoneFitter: notes for development

Browser app for fitting geometric primitives (lines, planes, spheres, cylinders) to STL/PLY meshes of bones, to quantify structures such as epiphyses and joint surfaces. Sister app of Landmarker3D and landmarker2D: same stack, same look, opened from GitHub Pages, nothing installed, no data leaves the computer. The owner is a morphometrician, not a web developer: explain changes in plain terms.

**State (v0.10):** meshes and landmark files open into an object tree; curves can be drawn on a mesh (open or closed, following the surface); closed curves can be turned into regions (the triangles they enclose), and regions can also be selected on the screen with Lasso or Box; spheres, cylinders and planes can be fitted to regions, and planes also to a curve's path; points can be placed on a mesh or made from other objects (a sphere's centre, a centroid, a midpoint, a line meeting a plane), and lines made from them (through two points, a cylinder's axis, fitted to a curve, perpendicular to a plane, two planes meeting); a region can be made into a mesh of its own; every mesh shows its surface area and can be saved as STL or PLY. Things are made from menus (one per kind of object) or from the selected object's Properties; mouse tools sit on a rail beside the 3D view. Coordinate systems, measuring, moving meshes and saving are not built yet.

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
| `js/main.js` | Wiring: viewer, panels, menus, tool rail, the strips of the tool or command in use, keyboard, drag and drop, messages |
| `js/interaction.js` | Mouse and touch in the 3D view: click to select (or to the tool in use, or the object a command asks for), dragging a curve's handle, drawing a lasso or box outline |
| `js/scene-model.js` | The object tree: nodes (`mesh`, `group`, `point`, `line`, `curve`, `region`, `sphere`, `cylinder`, `plane`), attaching, hiding, removing, updating, selecting. No three.js |
| `js/scene-view.js` | Draws the tree: one three.js object per node, nested as in the tree; markers, curve lines and handles, region tints, fitted primitives (outline, a faint fill for planes, and a centre mark, all drawn through the mesh); what is under the cursor (`pointAt`, `fitAt`, `curveAt`, `handleAt`, `regionAt`); made points and lines (drawn through the mesh, a line with an arrowhead); `lineAt`; the box the camera frames |
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
| `js/fit.js` | Fitting maths: area-weighted corners of a region's triangles; geometric sphere fit (algebraic start, then Levenberg–Marquardt) and coverage; least-squares plane (to triangles or a path); geometric cylinder fit (axis started from the surface normals) and arc covered; a 3 × 3 symmetric eigen solver. Pure maths, no three.js |
| `js/fit-engine.js` | Fitted primitives as tree objects: fitted to a region (planes also to a curve), refitted when it changes, removed with it; `flipped` for planes and cylinders |
| `js/mesh-export.js` | A region's triangles as a geometry of their own, surface area, binary STL and PLY writers (PLY joins corners at the same position). No page |
| `js/extract.js` | New mesh from a region: built as if saved as STL and opened again, kept beside the original |
| `js/file-io.js` | Landmarker3D's saving module, unchanged: Save dialog, claude.ai download capability, plain download |
| `js/selection.js` | Faces inside a screen outline (lasso or box), visible or through; combining face lists, the other faces, area and centroid. No page |
| `js/select-tool.js` | The Lasso and Box tools as a state machine (`setMode`, `setThrough`, `apply(shape, 'new' / 'add' / 'remove')`); no mouse, so it is unit-tested |
| `js/curve-tool.js` | The Curve tool as a state machine (`click`, `finish`, `close`, `undo`, `cancel`); no page or mouse, so it is unit-tested |
| `js/construct.js` | Maths for made points and lines: midpoint, line through two points, line fitted to a path, perpendicular to a plane, two planes meeting, a line meeting a plane. No three.js |
| `js/construction-engine.js` | Made points and lines as tree objects (`method`, `inputs`, `flipped`), made again when an input changes, removed with it; points placed on a mesh (`placePoint`). A sphere stands for its centre (`positionOf`) |
| `js/point-tool.js` | The Point tool: a click on a mesh places a point, a click on a point selects it; no mouse, so it is unit-tested |
| `js/commands.js` | The ways to make each kind of object (`MENUS`, `COMMANDS`): what each needs (`inputs`, from `INPUTS`) and how it is made (`run`). No page |
| `js/command-runner.js` | Runs a command: takes the selected object when it suits, otherwise asks for each input in turn (`start`, `offer`, `prefer`, `cancel`, `available(node)`); no page or mouse, so it is unit-tested |
| `js/menus.js` | The menus above the 3D view, built from `MENUS` |
| `js/sample.js` | The example mesh shown at start: a toy femur of exact shapes, with its true measurements in `EXAMPLE` |

All changes to the tree go through `SceneModel`, which fires a `change` event (`{ kind, ids, removed }`, kinds `add`, `remove`, `rename`, `visible`, `update`, `select`) that the 3D view and both panels listen to. `window.__bf` exposes the app for the browser tests.

A curve node holds what was clicked (`control_points` with the triangle each is on, `closed`, `path`) in the same form as a curve entry of a landmark file, plus what was computed from that (`line`, `length`, `centroid`, `used`, `warning`). Change a curve only through `CurveEngine.set()` or `refresh()`, so the computed part never goes stale. A curve being drawn is a real node from its first point (`drawing: true`).

A region node holds what it was made from (`boundary`: curve ids, `flipped`) and what was computed from that (`faces`: the file's face numbers in rising order, `faceCount`, `area`, `centroid`, `error`). Change a region only through `RegionEngine` (`create`, `set`, `addBoundary`, `refresh`). The region engine listens to the tree, so moving a curve's point recomputes its regions; because it reacts inside the curve's `update` event, later listeners see the region's `update` before the curve's.

A fitted node (`sphere`, `cylinder`, `plane`) holds what it was made from (`source`: a region's id, or a curve's for a plane; `method`; `flipped` for planes and cylinders) and what was computed (see the top of `fit-engine.js`; every kind has `rms`, `maxDeviation`, `error`), in the mesh file's coordinates. Change it only through `FitEngine` (`create(sourceId, kind)`, `set`, `refresh`). A failed fit clears every computed field (`EMPTY` in `fit-engine.js`), because `SceneModel.update` merges. The fit engine reacts to a region's or curve's `update`, so a moved curve point flows curve → region → fit in one go.

A made point or line holds `method` and `inputs` (ids, in order) and, for lines, `flipped`; what is computed is listed at the top of `construction-engine.js`. Change it only through `ConstructionEngine` (`create(kind, method, inputs)`, `set`, `refresh`). It reacts to any input's `update`, so chains (sphere → its centre → a line through it → where that meets a plane) follow in one go. It hangs under the mesh all its inputs share, or at the top level when they come from different meshes.

This is the pattern for everything that depends on something else (curve → region → fitted primitive → point → line): the dependent stores the ids it was made from, an engine recomputes it when those change, and the computed fields are never edited directly.

`tests/scene-helpers.js` builds the model, picker, view, engines and tool on a fake 100 × 100 px canvas, so anything short of real pixels can be unit-tested.

## Tests

`npm test` (unit, ~1 s) and `npm run test:e2e` (headless Chromium, ~1 min). Both run in CI on every push. Work test-first: write the failing test, then the code. The browser tests catch what unit tests can't. Test meshes are generated in `tests/fixtures.js`.

`EXAMPLE` in `js/sample.js` gives the true centre, radius and axis of every part of the example mesh (and its neck-shaft angle, 125°). Use it as the yardstick for fitting and measuring: a sphere fitted to the head must return `EXAMPLE.head`.

## Deployment

GitHub Pages is published by `.github/workflows/pages.yml` after the Tests workflow passes on `main`. The repository's Pages source must be "GitHub Actions" (Settings → Pages). The version in the page header (`v0.10`) shows which version is live; raise it with each feature that goes live.

## Writing for the UI

Short, plain sentences from the user's side of the screen. Errors say what went wrong and what to do about it. No jargon a biology student wouldn't know.

## Decided (by the owner)

- Same stack as the landmarking apps: three.js, plain JS, GitHub Pages. A separate repository, not a fork of Landmarker3D.
- Layout: object tree on the left showing all meshes and primitives; on the right a toolbar across the top and the 3D view under it. Since v0.9 the toolbar holds menus and the mouse tools are on a rail (see "How making things works").
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

- A region is made from a closed curve (Region ▸ Inside a closed curve) and hangs under the curve's mesh. It corresponds to the landmark format's reserved `surfaces` entry with `boundary` = curve ids.
- One curve: the smaller of the two parts it divides the surface into is the inside. "Use the other side" (`flipped`) takes everything else; the choice is stored.
- Several curves (up to 8): the region is the part of the surface that touches all of them, such as the ring between an outer and an inner loop (an articular surface minus the fovea) or the band between two rings (a shaft segment).
- No region, with the reason shown in Properties and a mark in the tree, when a curve crosses itself, does not divide the surface (a ring round a handle, a surface with holes), is no bigger than a few triangles, or jumps between separate pieces of the mesh.
- Removing a boundary curve takes it off its regions; a region left without a boundary is removed with it.
- While a curve's point is dragged, its regions follow at once on meshes up to 200,000 triangles and wait for the end of the drag on larger ones.

## How sphere fitting works (built in v0.4)

- Sphere ▸ Fit to a region: fits to a region; given a closed curve, uses its single-boundary region or makes one first.
- The data are the corners of the region's triangles, each weighted by a third of its triangle's area (corners are the measured points; flat triangles cut inside a curved surface; weighting by area makes uneven meshing not matter).
- Geometric least squares: algebraic (Kåsa) fit as the start, then Levenberg–Marquardt on the distances, computed relative to the patch's mean and scaled, so far-off scan coordinates lose no precision.
- Reported: centre, radius, diameter, RMS and largest deviation, coverage (solid angle of the region seen from the centre, as % of the sphere and as the equivalent cap angle), triangles. Below a 30° cap, Properties note that the radius is less certain.
- No sphere (with the reason) for a flat region (sphere over 200 × wider than the patch), too few triangles, or a region that encloses nothing; it comes back when the region is put right.
- Drawn as an outline and a centre mark, both through the mesh. A click on the centre mark selects the sphere.
- Removing a region removes the fits made from it.

## How planes and cylinders work (built in v0.5)

- Cylinder: like Sphere (a region, or a closed curve's region). Plane: Fit to a region (a region only), or Fit to a curve: the path of a curve (open or closed), for rims and margins.
- Plane: least-squares (smallest eigenvector of the area- or length-weighted covariance). From a region the normal faces the way the triangles face (out of the bone); from a closed curve it follows the loop (right-hand rule); otherwise its largest component is positive. Reported: point (the weighted mean, on the plane), unit normal, equation n·x = d, RMS and largest deviation, triangles or path length.
- Cylinder: the starting axis is the direction the area-weighted surface normals spread least in; the circle across it is fitted algebraically; then axis point, direction and radius are refined together (Levenberg–Marquardt, analytic Jacobian). Reported: axis point (nearest the data's mean), unit direction (largest component positive), radius, diameter, the two axis ends the data span and the length between them, RMS and largest deviation, arc covered round the axis (from the triangles' angular spans, in 5° steps). Notes: the normals also spread along the axis (`spread` > 0.3: a round surface, axis poorly fixed), or the arc is under 90°.
- Flip normal / Flip direction (`flipped`, stored): the plane or axis stays put, only its sign changes (d and the ends swap with it). This is the first part of the proposed "stored sign".

## Meshes from regions, and saving meshes (built in v0.6, asked for by the owner)

- "New mesh" (region Properties, under Make from this) makes a new top-level mesh of the region's triangles. The original is not changed. The new mesh is built by writing the triangles as a binary STL and reading that back, so it has the SHA-256 of the file "Save as STL" writes and that file is recognised when opened again.
- It is a copy (snapshot): it keeps `madeFrom` (mesh, region, boundary curve names, side) for the record but does not follow later changes to the region. Its coordinates are the original file's (`coordsFile`), and it can have curves, regions and fits of its own. Made from the example, it goes with the example.
- It is drawn in its own colour and slightly in front of the original it overlaps; hide the original to see it alone.
- Every mesh shows its surface area (sum of triangle areas, `area` from `meshFields`) and has a row to copy.
- Save as STL (binary, triangles with their own corners) and Save as PLY (binary little-endian, corners at exactly the same position joined into one vertex) for any mesh, through `file-io.js`. Vertex colours are not carried over.

## How making things works (built in v0.9; layout chosen by the owner)

The one-row toolbar had run out of room. The owner chose a combination of two routes to the same commands, plus a rail:

- **Menus, starting from what you want to make.** One menu per kind of object above the 3D view (Region, Sphere, Cylinder, Plane now; Point, Line, Coordinate system, then Measure and Orient later), each listing the ways to make it (`MENUS` in `commands.js`). The owner's example: "a sphere by defining a point and a radius" must be startable without first knowing what to select.
- **A prompt strip, asking for inputs one at a time.** If the selected object suits the command's first input it is taken; when every input is there the object is made and selected. Otherwise the strip (`#prompt-strip`) says what to click, and the next object clicked in the 3D view (`interaction.js`) or in the Objects list (`main.js`) is selected and then offered to the command (`CommandRunner.offer`); offering is done after the click's own selecting, never inside a `select` event. A click in the 3D view takes, of the things under it, the first the command can use (`prefer`). An unsuitable pick leaves the strip asking, with the reason. Esc, Cancel, or choosing a drawing tool ends it. When nothing in the scene could be used, there is no prompt: a note says what to make first. The owner chose this "pick the next one" prompt over multi-selection for commands with several inputs.
- **Properties, starting from what is selected.** "Make from this" lists `available(node)`: the commands whose first input the selected object suits, one click each. For a closed curve the plane offered is the one through the curve itself. "New mesh" (from a region) sits there too.
- **The rail** beside the 3D view (never over it) holds what changes the mouse: Select, Curve, Lasso, Box (Measure and Move mesh later). One tool at a time; a command that has to ask switches the drawing tool off, one that is made at once leaves it on.

To add a way of making something: add a command to `MENUS` (new input kinds go in `INPUTS`) and an icon in `menus.js` for a new menu. The menus, the prompt and the Properties buttons follow. Inputs that are numbers (a radius) are not built yet: the plan is a box in the prompt strip.

## How points and lines work (built in v0.10, asked for by the owner)

- Point tool (rail, or Point ▸ Click on a surface): each click on a mesh places a point there (`method: 'surface'`, `anchor`, attached to the mesh); a click on a point selects it; Esc or Done ends it. Placed points can't be dragged yet.
- Point ▸ Centre of a sphere, Centroid of a region or curve, Midway between two points, Where a line meets a plane. Line ▸ Through two points, Axis of a cylinder, Fit to a curve (least squares through the length-weighted path, pointing from the curve's start to its end; a closed loop: largest component positive), Perpendicular to a plane (inputs: plane, then point; along the plane's normal; length = distance from the point to the plane, `signed` = which side), Where two planes meet (along n1 × n2, at the point nearest the middle of the planes' points, drawn as far as the larger plane reaches).
- Wherever a point is asked for, a sphere is taken as its centre (`INPUTS.point`), so a line through two head centres needs no extra points.
- A line is { point, direction, ends, length }: the direction's sign is stored (Flip direction, `flipped`), ends are in its order, and what `length` measures depends on the method (Properties label it).
- Made points and lines are drawn through the mesh in violet; placed points are drawn like landmarks (blue, hidden behind the surface).
- Commands with two inputs use the prompt strip: the selected object is the first if it suits, then "Step 2 of 2 (“Sphere 2” taken)". The same object can't be given twice.
- Inputs from different meshes make a global (top-level) object; the maths treats file coordinates as scene coordinates, which is right only while meshes can't move. **When moving meshes is built, `construction-engine.js` must bring inputs into scene coordinates first.**

## Lasso and Box selection (built in v0.7, asked for by the owner)

- The Lasso and Box buttons on the rail switch a selection tool on (one tool at a time, with Curve). While on, a left-drag draws the outline and the camera doesn't turn (`controls.noRotate`); right-drag pans, scroll zooms. A click (no outline) still selects what is under it.
- Esc toggles a pause (v0.8, asked for by the owner): paused, the tool stays chosen but a left-drag turns the view (strip turns amber, "Turn view" pressed); Esc again (or the Turn view button, or the tool's own button) goes back to selecting with the same tool. The selected region stays selected, so Shift and Alt carry on adding to it. Done leaves the tool. `SelectTool`: `paused`, `drawing` (= chosen and not paused), `togglePause()`; choosing a tool ends a pause.
- A triangle is selected when its centre is inside the outline on screen. "Visible surface only" is the default: the centre must be the first surface along the line of sight from the camera (BVH ray test; other meshes in front hide too). "Select through the surface" takes everything inside the outline.
- Plain drag: a new region on the mesh of the selected object, or the only mesh shown (otherwise the tool asks which). Shift-drag adds to the selected Lasso/Box region, Alt-drag takes away (a Shift-drag with no such region selected makes a new one).
- A selection region (`selection: true`) keeps the faces picked (`picked`) and every stroke (`strokes`: type, mode, through, outline in normalised screen coordinates, camera position, target, up, fov, aspect) as the record. It has no boundary curves and doesn't change unless selected on again. "Use the other side" gives every other face of the mesh. Fits, new meshes and saving work on it like on any region.
- Taking everything away leaves the region empty, with the reason in Properties.

## Build order (agreed)

1. Curves on the mesh: done in v0.2.
2. Closed curves into regions, shown as a tint on the mesh with area and triangle count: done in v0.3.
3. The first fit: a sphere on a region of the example's head, checked against `EXAMPLE.head`: done in v0.4.

## Templates (kept for later)

The owner wants templates in this app eventually: a template that walks a student through selecting features, fitting the primitives and exporting. What is already in place for that:

- `landmark-file.js` reads the template of a landmark file whole, and `opening.js` keeps it on the folder node (`template`).
- Every node has `template_id`; imported landmarks carry theirs.

A BoneFitter template would list steps (select a region, fit a primitive, construct one from others, measure) the way a landmark template lists landmarks, with stable ids, names and instructions. Landmarker3D's `session.js` (template checks, the "to do / placed / missing" states, walking to the next item) and `template-editor.js` are the reference to adapt.

## Not done yet

- Coordinate systems; measuring (distances, angles); moving meshes; saving the scene (curves, regions, fits, points, lines) and exporting numbers.
- Dragging a placed point; more ways to make points (projected onto a plane or line, typed coordinates) and lines (through a point parallel to another line).
- A support plane (standing on a table) is still only proposed; the least-squares plane is not that.
- A deviation map on the mesh, and refitting without faces beyond a tolerance (both proposed).
- On a finished curve: adding or removing single points, opening or closing it again, and choosing straight (`euclidean`) paths. The engine supports all of these; there are no buttons for them yet.
- Undo and redo.
- Inputs typed as numbers in the prompt strip (a sphere from a centre and a radius).
- The view buttons are in the View menu since v0.10 (F and H still work).
- Opening the curves of a landmark file (read past with a note).
- A limit or warning strategy for very large scenes beyond the current note at 3 million triangles. Landmarker3D unloads meshes it isn't showing; here every mesh in the scene stays loaded.
