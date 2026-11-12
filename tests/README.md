# Tests

Two layers, both on Node's built-in test runner (Node 20 or newer).

```sh
npm install          # three and three-mesh-bvh, the same versions the page loads
npm test             # unit tests, about 1 s
npx playwright install chromium   # once, for the browser tests
npm run test:e2e     # browser tests, about 1 min
npm run test:all     # both
```

If Playwright can't download its own Chromium, point the browser tests at an installed Chrome instead: `CHROME_PATH=/usr/bin/google-chrome npm run test:e2e`.

**Unit tests** (`tests/unit/`) check the modules that hold the logic:

- `mesh-loader.test.js`: STL and PLY reading, raw counts, SHA-256, refusal of quads, point clouds and damaged files.
- `picking.test.js`: the BVH never reorders the file's triangles; face indices match a brute-force search; with several meshes the nearest one shown is picked; on a mesh that has been moved, a hit is still given in the mesh file's own coordinates.
- `scene-model.test.js`: the object tree: attaching, hiding, removing with everything attached, renaming, updating, selecting.
- `curves.test.js`, `geodesic.test.js`: Landmarker3D's tests of the curve maths and of shortest paths across a surface, unchanged.
- `curve-engine.test.js`: a curve computed on a real mesh: length against the known answer on a ball, the centroid, preparing a mesh once.
- `region.test.js`: regions from closed curves: area and centroid against the known answers on a ball (a cap, a ring, a band), the other side, following a moved curve, several boundaries, every case with no inside (a crossing loop, a ring round a handle, a tiny loop), and regions in the 3D view and in Properties.
- `fit.test.js`: the sphere fit on exact, shallow, far-off and noisy data; the geometric fit against the algebraic one; weights; flat patches; coverage; a million triangles.
- `fit.test.js` also covers planes (tilted, noisy, collinear, to triangles, to a path, length weighting) and cylinders (whole, a 90° strip far away, noisy, flat, from normals alone, on a sphere).
- `fit-planes-cylinders.test.js`: a cylinder fitted to a band and to a patch of the example's shaft gives back `EXAMPLE.shaft`; planes on a box face, on the head and on a curve; flipping; drawing; Properties.
- `fit-engine.test.js`: spheres fitted to regions of the example mesh give back `EXAMPLE.head`, follow their region, show problems, are removed with it; drawing and Properties.
- `mesh-export.test.js`: a region's triangles as a mesh, surface area, STL and PLY written and read back (same triangles, same area; PLY joins vertices).
- `extract.test.js`: a new mesh from a region of the example: triangles and area are the region's, the original is untouched, its SHA-256 is that of the saved STL, it is a copy, it can be fitted to, and Properties.
- `selection.test.js`: point in polygon, box and lasso tests, faces inside an outline (visible only, or through), combining and the other faces, area; the Lasso and Box tools making, adding to and taking from regions, choosing the mesh, a mesh in front hiding another, Properties.
- `curve-tool.test.js`: the Curve tool click by click (start, add, finish, close, undo, cancel, another mesh), curves and their handles in the 3D view, and a curve in the Properties panel.
- `scene-view.test.js`: the tree drawn in three.js: source geometry untouched, nesting, the framed box, markers, clicking a marker.
- `landmark-file.test.js`: reading `.lmk.json` files, every refusal case, matching a file to its mesh.
- `opening.test.js`: opening meshes and landmark files together, duplicates, the example making way, and what the Properties panel shows and copies.
- `sample.test.js`: every vertex of the example mesh lies on one of the shapes `EXAMPLE` describes, so the fitting tests can trust those numbers.

**Browser tests** (`tests/e2e/app.test.js`) run the real page in headless Chromium and use it as a person would: opening files, clicking meshes and markers in the 3D view, hiding, renaming, removing, copying numbers, turning the view, drawing curves and dragging their points, making regions and changing them, fitting spheres, cylinders and planes, making meshes from regions and saving them as STL and PLY (real downloads, read back), selecting with Lasso and Box (real drags, with Shift and Alt). The page is served exactly as it is on disk, as GitHub Pages serves it, and each test fails if anything is logged to the browser console.

The same tests run on GitHub for every push and pull request (`.github/workflows/test.yml`).

Test meshes and landmark files are generated in code (`tests/fixtures.js`), so the repository needs no binary test data. `tests/scene-helpers.js` sets up the model, picker, 3D view and curve tool on a fake canvas for the unit tests.
