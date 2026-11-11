# BoneFitter

A lightweight tool for fitting geometric primitives (lines, planes, spheres, cylinders) to surface meshes of bones, in the browser, to measure structures such as epiphyses and joint surfaces. It is the sister app of [Landmarker3D](https://github.com/BenceViola/Landmarker3D) and shares its foundations.

**Open the app: https://benceviola.github.io/BoneFitter/** (once GitHub Pages is switched on for this repository)

Nothing to install. Meshes are read on your own computer and never uploaded.

## Where it stands (v0.1)

This first version is the foundation: the page layout and the parts brought over from Landmarker3D. Fitting, constructing, measuring and saving come next.

- Opens binary and ASCII **STL** and **PLY** triangle meshes, several at once, each shown where its file puts it.
- **Objects** (left): every mesh, with what is attached to it nested underneath. Click a name to select it, the eye to hide or show it.
- **Properties** (left, below): the facts and numbers of the selected object, with a button to copy them for a spreadsheet.
- **Toolbar and 3D view** (right): open files, look along an axis, fit everything in view. Click a mesh or a point in the view to select it.
- Opens **landmark files** (`.lmk.json`) from Landmarker3D: the landmarks appear as points attached to the mesh they were placed on, matched by the mesh's SHA-256.
- Starts with an **example**: a toy femur built from exact shapes, so fits can be checked against known answers.

Coordinates are always in each mesh file's own coordinate system: the app never changes the mesh.

## Mouse and keys

| | |
|---|---|
| click | select the mesh or point under the cursor |
| drag / right-drag / scroll | rotate / pan / zoom |
| F, H | fit the view, default view |

You can also drop meshes and landmark files anywhere on the page.

## Development

Plain JavaScript modules with no build step. three.js and three-mesh-bvh load from a CDN at pinned versions (see the import map in `index.html`).

```sh
npm install
npm test                         # unit tests
npx playwright install chromium  # once
npm run test:e2e                 # browser tests
```

To try changes locally, serve the folder with any static server, e.g. `npx serve .`, and open the address it prints. Opening `index.html` straight from disk does not work, because browsers block module scripts from `file://` addresses.

The site is published to GitHub Pages by `.github/workflows/pages.yml` after the tests pass on every push to `main` (repository Settings → Pages → Source must be "GitHub Actions").

More detail on the code and the decisions behind it: [`CLAUDE.md`](CLAUDE.md). What came from Landmarker3D: [`docs/from-landmarker3d.md`](docs/from-landmarker3d.md). Tests: [`tests/README.md`](tests/README.md).

## License

MIT, see [`LICENSE`](LICENSE).
