# What came from Landmarker3D

BoneFitter starts from the plumbing of [Landmarker3D](https://github.com/BenceViola/Landmarker3D). The files were copied, not linked, so the two apps can change separately. This page records what was taken and how it was changed, so a fix made in one app can be carried to the other.

Copied on 2026-11-10 from Landmarker3D `main` at commit `39f17f1` ("Pages: also publish the advanced branch at /next/"). The curve code was copied on 2026-11-11 from the `advanced` branch at commit `00c1e7f` ("Sliders file for geomorph").

## Brought over

| BoneFitter file | From | Changes |
|---|---|---|
| `js/mesh-loader.js` | `js/mesh-loader.js` | None. |
| `js/picking.js` | `js/picking.js` | Picks over several meshes instead of one (`add` / `remove` instead of `setGeometry`), skips hidden ones, and says which mesh was hit. Each mesh follows its scene object, and a hit is converted back to the mesh file's coordinates. `snap` takes the mesh id. |
| `js/viewer.js` | `js/viewer.js` | Keeps the camera, lights, frame loop, named views and framing. The single-mesh parts (`setGeometry`, shading switches, thumbnails, the label layer) are gone: scene objects are built in `scene-view.js`. The display-copy code is now the function `displayGeometry`. Added `setContentBox` and `toClient`. |
| `js/landmark-file.js` | `js/landmark-file.js` | Reading only (`parseLandmarkFile`, `meshMatches`); nothing is written. No dependency on `session.js`. Reads up to format 0.4. Each point gets the `name` to show. Curves are noted, not read. |
| `js/curves.js`, `js/geodesic.js` | same, `advanced` branch | None. Keep them identical in both apps. BoneFitter draws curves freely, not from a template: it passes a small definition (`closed`, `path`) and ignores the semilandmarks that come back. |
| `js/curve-engine.js` | the computing half of `js/curve-view.js`, `advanced` branch | One corner table per mesh instead of one for the mesh on screen; stretches cached per mesh; results stored on the curve's node; adds the centroid of the path. |
| `js/scene-view.js` (curves) | the drawing half of `js/curve-view.js`, `advanced` branch | The line and the handles (diamonds on the clicked points), nested under the mesh. No semilandmark dots, no labels. Handles show only on the selected curve. |
| `js/interaction.js` | `js/interaction.js` | The same way of telling a click from a drag and of switching the camera controls off while a handle is dragged; the rest is new. |
| `js/file-io.js` | same (`main`, at `39f17f1`) | None. Copied 2026-11-11. |
| `js/sample.js` | `js/sample.js` | Same idea (a generated STL read back through the loader, away from the origin), different shape: a toy femur of exact parts instead of a pebble, with its true measurements exported as `EXAMPLE`. |
| `index.html` (styles) | `index.html` | Colour tokens, fonts, buttons, messages, the busy overlay, the drop overlay and the view buttons. The layout is new. |
| `js/main.js` (parts) | `js/main.js`, `js/interaction.js` | The theme hook, message and busy helpers, drag-and-drop, and the "a press that barely moves is a click" rule. |
| `tests/fixtures.js` | `tests/fixtures.js` | The mesh builders unchanged; landmark fixtures rewritten. |
| `tests/unit/mesh-loader.test.js` | same | The sample-mesh test follows the new example. |
| `tests/unit/curves.test.js`, `tests/unit/geodesic.test.js` | same, `advanced` branch | None. |
| `tests/unit/picking.test.js` | same | Same tests on the new calls, plus tests for several meshes and a moved mesh. |
| `tests/e2e/helpers.js` | same | Server, CDN swap and console-error capture unchanged; the page helpers are new. `CHROME_PATH` can name the browser. |
| `.github/workflows/test.yml` | same | None. |
| `.github/workflows/pages.yml` | same | `main` only (no `/next/` part). |
| `package.json` | same | Same scripts and pinned versions. |

## Not brought over yet, and where to find it

| When BoneFitter needs… | Take from Landmarker3D |
|---|---|
| Zipped hand-ins | `js/zip.js`, `js/handin.js` |
| Equally spaced points along a curve in exports, the geomorph sliders file | `js/export-rows.js`, `js/sliders.js` on the `advanced` branch |
| A plane through points, the 3 × 3 eigen solver, where a plane cuts a mesh | `js/planes.js`, `js/plane-view.js` on the `advanced` branch (with `tests/unit/planes.test.js`) |
| Cut-away views | `setClip` in `js/viewer.js` and `keep` in `js/picking.js` on the `advanced` branch |
| Templates: checks, to-do states, the editor | `js/session.js`, `js/template-editor.js`, `js/landmark-panel.js` |
| Undo and redo | `js/session.js` |
| Labels drawn over the 3D view | the CSS2D label layer in `js/viewer.js`, `js/markers.js` |
| TPS and CSV writers | `js/tps.js`, `js/csv.js` |

## Deliberately different

- **No three-mesh limit.** Landmarker3D shows one specimen at a time and unloads the others (`js/mesh-store.js`). BoneFitter shows every mesh of the scene together, so all stay loaded; it notes when the scene passes 3 million triangles.
- **One scene, not a set of specimens.** There is no specimen strip, no replicates, no operator yet.
