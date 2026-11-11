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
- `scene-model.test.js`: the object tree: attaching, hiding, removing with everything attached, renaming, selecting.
- `scene-view.test.js`: the tree drawn in three.js: source geometry untouched, nesting, the framed box, markers, clicking a marker.
- `landmark-file.test.js`: reading `.lmk.json` files, every refusal case, matching a file to its mesh.
- `opening.test.js`: opening meshes and landmark files together, duplicates, the example making way, and what the Properties panel shows and copies.
- `sample.test.js`: every vertex of the example mesh lies on one of the shapes `EXAMPLE` describes, so the fitting tests can trust those numbers.

**Browser tests** (`tests/e2e/app.test.js`) run the real page in headless Chromium and use it as a person would: opening files, clicking meshes and markers in the 3D view, hiding, renaming, removing, copying numbers, turning the view. The page is served exactly as it is on disk, as GitHub Pages serves it, and each test fails if anything is logged to the browser console.

The same tests run on GitHub for every push and pull request (`.github/workflows/test.yml`).

Test meshes and landmark files are generated in code (`tests/fixtures.js`), so the repository needs no binary test data.
