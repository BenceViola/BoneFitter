# BoneFitter

A lightweight tool for fitting geometric primitives (lines, planes, spheres, cylinders) to surface meshes of bones, in the browser, to measure structures such as epiphyses and joint surfaces. It is the sister app of [Landmarker3D](https://github.com/BenceViola/Landmarker3D) and shares its foundations.

**Open the app: https://benceviola.github.io/BoneFitter/**

Nothing to install. Meshes are read on your own computer and never uploaded.

## Where it stands (v0.5)

The foundation, curves drawn on a mesh, regions enclosed by closed curves, and spheres, cylinders and planes fitted to them. Constructing, measuring, moving meshes and saving come next.

- Opens binary and ASCII **STL** and **PLY** triangle meshes, several at once, each shown where its file puts it.
- **Objects** (left): every mesh, with what is attached to it nested underneath. Click a name to select it, the eye to hide or show it.
- **Properties** (left, below): the facts and numbers of the selected object, with a button to copy them for a spreadsheet.
- **Toolbar and 3D view** (right): open files, look along an axis, fit everything in view. Click a mesh or a point in the view to select it.
- **Curves**: with the Curve tool, click points on a mesh and the app joins them by the shortest path across the surface. A curve can be left open or closed into a loop. It is listed under its mesh, with its length and centroid in Properties, and its clicked points can be dragged afterwards.
- **Regions**: select a closed curve and press Region to get the part of the mesh it encloses, tinted on the mesh, with its area, triangle count and centroid in Properties. "Use the other side" takes the rest of the surface instead. Further closed curves can be added as boundaries, for a region with a hole or the band between two rings. A region follows its curves when their points are moved. Its edge runs along triangle edges, within about one triangle of the curve.
- **Spheres**: select a region (or a closed curve) and press Sphere to fit a sphere to it: the best fit by distance to the surface, weighted by area. Properties give its centre, radius and diameter, how well it fits (RMS and largest deviation) and how much of the sphere the region covers. The sphere is refitted when its region changes. On the example's head it gives back the head's centre and radius as built.
- **Cylinders**: select a region (or a closed curve) and press Cylinder. Properties give the axis (a point on it and its direction), radius, diameter, the axis ends the region spans and its length, how well it fits, and how far round the axis the region reaches.
- **Planes**: select a region, or a curve, and press Plane. A plane fitted to a curve's path suits rims and margins. Properties give a point on the plane, its normal, its equation and how flat the data are. Flip normal (planes) and Flip direction (cylinders) turn the sign round without moving them.
- Opens **landmark files** (`.lmk.json`) from Landmarker3D: the landmarks appear as points attached to the mesh they were placed on, matched by the mesh's SHA-256.
- Starts with an **example**: a toy femur built from exact shapes, so fits can be checked against known answers.

Coordinates are always in each mesh file's own coordinate system: the app never changes the mesh.

## Mouse and keys

| | |
|---|---|
| click | select the point, fitted shape (by its centre mark), curve, region or mesh under the cursor |
| drag a white diamond | move a clicked point of the selected curve |
| drag / right-drag / scroll | rotate / pan / zoom |
| F, H | fit the view, default view |

With the **Curve** tool on:

| | |
|---|---|
| click on a mesh | start a curve, or add a point to it |
| Enter, or click the last point again | finish the curve as it is |
| C, or click the first point again | close the curve into a loop (three points or more) |
| Backspace | take the last point off |
| Esc | remove the curve being drawn; again to leave the tool |

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
